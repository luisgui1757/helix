import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const read = path => readFile(new URL(path, root), 'utf8')

test('CI is least-privilege, digest-pinned, and emits one stable required check', async () => {
  const workflow = await read('.github/workflows/ci.yml')
  const actionRefs = [...workflow.matchAll(/^\s*- uses:\s*([^\s]+).*$/gm)].map(match => match[1])

  assert.deepEqual(actionRefs, [
    'actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0',
    'actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e',
  ])
  assert.match(workflow, /^permissions:\n  contents: read$/m)
  assert.doesNotMatch(workflow, /pull_request_target/)
  assert.match(workflow, /^  push:\n    branches:\n      - main$/m)
  assert.match(workflow, /npm ci --ignore-scripts --include=optional/)
  assert.match(workflow, /^  test:\n    name: test$/m)
  assert.match(workflow, /MATRIX_RESULT.*needs\.test_matrix\.result/s)
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

  assert.equal(codeql.enforcement, 'disabled')
  assert.deepEqual(codeql.bypass_actors, [])
  assert.deepEqual(codeql.rules[0].parameters.code_scanning_tools, [{
    tool: 'CodeQL',
    alerts_threshold: 'errors',
    security_alerts_threshold: 'high_or_higher',
  }])
})

test('Renovate owns routine updates without automerge or advisory security feeds', async () => {
  const config = JSON.parse(await read('renovate.json'))

  assert.deepEqual(config.enabledManagers, ['npm', 'github-actions'])
  assert.equal(config.automerge, false)
  assert.equal(config.rebaseWhen, 'behind-base-branch')
  assert.equal(config.vulnerabilityAlerts.enabled, false)
  assert.equal(config.lockFileMaintenance.enabled, true)
  assert.equal(config.dependencyDashboardOSVVulnerabilitySummary, undefined)
  assert.ok(config.extends.includes('helpers:pinGitHubActionDigests'))
  assert.ok(config.extends.includes('security:minimumReleaseAgeNpm'))

  const actions = config.packageRules.find(rule => rule.matchManagers?.includes('github-actions'))
  const majors = config.packageRules.find(rule => rule.matchUpdateTypes?.includes('major'))
  assert.equal(actions.pinDigests, true)
  assert.equal(actions.automerge, false)
  assert.equal(majors.dependencyDashboardApproval, true)
})
