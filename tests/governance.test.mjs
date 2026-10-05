import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const read = path => readFile(new URL(path, root), 'utf8')

test('CI is least-privilege, bounded, digest-pinned, and emits one stable required check', async () => {
  const workflow = await read('.github/workflows/ci.yml')
  const actionRefs = [...workflow.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s]+).*$/gm)].map(match => match[1])

  assert.deepEqual(actionRefs, [
    'actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0',
    'actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e',
    'actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294',
  ])
  assert.match(workflow, /^permissions:\n  contents: read$/m)
  assert.match(workflow, /^concurrency:\n  group: .*github\.workflow.*github\.event\.pull_request\.number \|\| github\.ref.*\n  cancel-in-progress: true$/m)
  assert.doesNotMatch(workflow, /pull_request_target/)
  assert.match(workflow, /^  push:\n    branches:\n      - main$/m)
  assert.match(workflow, /node --test tests\/\*\.test\.mjs/)
  assert.doesNotMatch(workflow, /npm (?:ci|audit|run)/)
  assert.match(workflow, /runs-on: \$\{\{ matrix\.os \}\}/)
  assert.match(workflow, /os: macos-latest\n\s+node-version: 22\.19\.0/)
  assert.deepEqual([...workflow.matchAll(/^\s+timeout-minutes: (\d+)$/gm)].map(match => Number(match[1])), [15, 5, 5])
  assert.match(workflow, /^  dependency_review:\n    name: dependency-review$/m)
  assert.match(workflow, /github\.event_name == 'pull_request'.*actions\/dependency-review-action@/s)
  assert.match(workflow, /github\.event_name != 'pull_request'.*run: ':'/s)
  assert.match(workflow, /^  test:\n    name: test$/m)
  assert.match(workflow, /needs: \[test_matrix, dependency_review\]/)
  assert.match(workflow, /MATRIX_RESULT.*needs\.test_matrix\.result/s)
  assert.match(workflow, /DEPENDENCY_REVIEW_RESULT.*needs\.dependency_review\.result/s)
  assert.match(workflow, /MATRIX_RESULT.*!= success.*DEPENDENCY_REVIEW_RESULT.*!= success/s)
})

test('checked-in branch governance preserves integrity and pull-request-only owner bypass', async () => {
  const integrity = JSON.parse(await read('.github/rulesets/main-integrity.json'))
  const review = JSON.parse(await read('.github/rulesets/main-review.json'))
  const codeql = JSON.parse(await read('.github/rulesets/main-codeql-public.json'))

  assert.equal(integrity.enforcement, 'active')
  assert.deepEqual(integrity.bypass_actors, [])
  assert.deepEqual(integrity.rules.map(rule => rule.type), [
    'deletion',
    'non_fast_forward',
    'required_linear_history',
    'required_status_checks',
  ])
  const statusChecks = integrity.rules.find(rule => rule.type === 'required_status_checks').parameters
  assert.equal(statusChecks.strict_required_status_checks_policy, true)
  assert.deepEqual(statusChecks.required_status_checks, [{ context: 'test', integration_id: 15368 }])

  assert.deepEqual(review.bypass_actors, [{
    actor_id: 139752288,
    actor_type: 'User',
    bypass_mode: 'pull_request',
  }])
  const pullRequest = review.rules.find(rule => rule.type === 'pull_request').parameters
  assert.equal(pullRequest.required_approving_review_count, 1)
  assert.equal(pullRequest.require_code_owner_review, true)
  assert.equal(pullRequest.require_last_push_approval, true)
  assert.equal(pullRequest.required_review_thread_resolution, true)
  assert.deepEqual(pullRequest.allowed_merge_methods, ['squash'])

  assert.equal(codeql.enforcement, 'active')
  assert.deepEqual(codeql.bypass_actors, [])
  assert.deepEqual(codeql.rules[0].parameters.code_scanning_tools, [{
    tool: 'CodeQL',
    alerts_threshold: 'errors',
    security_alerts_threshold: 'high_or_higher',
  }])
})

test('Renovate owns routine updates without automerge or advisory security feeds', async () => {
  const config = JSON.parse(await read('renovate.json'))

  assert.deepEqual(config.enabledManagers, ['github-actions'])
  assert.equal(config.automerge, false)
  assert.equal(config.rebaseWhen, 'behind-base-branch')
  assert.equal(config.vulnerabilityAlerts.enabled, false)
  assert.equal(config.lockFileMaintenance, undefined)
  assert.equal(config.dependencyDashboardOSVVulnerabilitySummary, undefined)
  assert.ok(config.extends.includes('helpers:pinGitHubActionDigests'))

  const actions = config.packageRules.find(rule => rule.matchManagers?.includes('github-actions'))
  assert.equal(actions.pinDigests, true)
  assert.equal(actions.automerge, false)
  assert.deepEqual(config.packageRules.map(rule => rule.matchManagers), [['github-actions']])
})
