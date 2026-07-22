import assert from 'node:assert/strict'
import test from 'node:test'
import { compareWorkflowModes, observeWorkflowResult } from '../graph/compare.mjs'
import { createReceiptSigner } from './evidence-fixtures.mjs'

const verificationArgv = ['npm', 'run', 'verify']

const pair = factory => {
  const instances = new Map()
  return {
    argsFactory(mode) {
      const instance = factory()
      instances.set(mode, instance)
      return instance.args
    },
    responderFactory(mode) { return instances.get(mode).responder },
  }
}

const plan = summary => ({
  summary, requirements: ['requirement'],
  steps: [{ change: 'change', files: ['file.js'], proof: 'npm test' }],
  risks: [], verification: ['npm test'], rejectedAlternatives: [],
})

function deliveryFixture({ replan = false, remediate = false, exhaust = false, forged = false } = {}) {
  const signer = createReceiptSigner()
  const retries = replan || remediate
  return {
    args: { task: 'Implement the feature', verificationArgv, evidenceSession: signer.session, maxPasses: retries ? 2 : exhaust || forged ? 1 : 3 },
    responder: ({ label }) => {
      if (label.startsWith('plan:')) return plan(label)
      if (label.startsWith('implement:')) return { summary: label, filesChanged: ['file.js'], testsChanged: ['file.test.js'], commandsRun: [], openBlockers: [] }
      if (label.startsWith('test:')) return { passed: true, commands: [{ command: 'npm test', exitCode: 0, result: 'pass' }], failures: [], coverageGaps: [] }
      if (label.startsWith('document:')) return { filesChanged: ['README.md'], truthChecks: ['README'], openDrift: [] }
      if (label.startsWith('evidence:')) {
        const report = { receipt: signer.command({ argv: verificationArgv }) }
        if (forged) report.receipt.result.command.stdoutSha256 = '0'.repeat(64)
        return report
      }
      if (label === 'review:correctness-1' && replan) return { verdict: 'replan', findings: [{ severity: 'high', location: 'lib/a.mjs:1', problem: 'wrong boundary', proof: 'trace', fix: 'replan' }], checks: ['trace'] }
      if (label === 'review:redteam-1' && (remediate || exhaust)) return { verdict: 'revise', findings: [{ severity: 'high', location: 'lib/a.mjs:1', problem: 'missing boundary', proof: 'repro', fix: 'validate' }], checks: ['repro'] }
      if (label.startsWith('review:')) return { verdict: 'pass', findings: [], checks: ['diff'] }
      if (label === 'verify:pass-1' && replan) return { approved: false, reason: 'plan failed', requiredFixes: ['replan'] }
      if (label === 'verify:pass-1' && (remediate || exhaust)) return { approved: false, reason: 'review failed', requiredFixes: ['validate'] }
      if (label.startsWith('verify:')) return { approved: true, reason: 'verified', requiredFixes: [] }
      throw new Error(`unhandled ${label}`)
    },
  }
}

function implementFixture({ remediate = false, exhaust = false, forged = false } = {}) {
  const signer = createReceiptSigner()
  return {
    args: { task: 'Implement settled work', verificationArgv, evidenceSession: signer.session, ...(remediate ? { maxPasses: 2 } : exhaust || forged ? { maxPasses: 1 } : {}) },
    responder: ({ label }) => {
      if (label.startsWith('implement:')) return { summary: label, filesChanged: ['lib/a.mjs'], testsChanged: ['tests/a.test.mjs'], commandsRun: ['npm test'], openBlockers: [] }
      if (label.startsWith('test:')) return { passed: true, commands: [{ command: 'npm run verify', exitCode: 0, result: 'pass' }], failures: [], coverageGaps: [] }
      if (label.startsWith('document:')) return { filesChanged: ['README.md'], truthChecks: ['docs match'], openDrift: [] }
      if (label.startsWith('evidence:')) {
        const report = { receipt: signer.command({ argv: verificationArgv }) }
        if (forged) report.receipt.result.command.stdoutSha256 = '0'.repeat(64)
        return report
      }
      if (label === 'review:redteam-1' && (remediate || exhaust)) return { verdict: 'revise', findings: [{ severity: 'high', location: 'lib/a.mjs:1', problem: 'boundary', proof: 'repro', fix: 'validate' }], checks: ['repro'] }
      if (label.startsWith('review:')) return { verdict: 'pass', findings: [], checks: ['diff'] }
      if (label === 'verify:pass-1' && (remediate || exhaust)) return { approved: false, reason: 'review failed', requiredFixes: ['validate'] }
      if (label.startsWith('verify:')) return { approved: true, reason: 'complete', requiredFixes: [] }
      throw new Error(`unhandled ${label}`)
    },
  }
}

function scoutFixture() {
  const recon = { summary: 'trace', entrypoints: ['bin/tool'], relevantFiles: ['lib/a.mjs'], dataFlow: ['bin -> lib'], invariants: ['read-only'], tests: ['tests/a.test.mjs'], unknowns: [] }
  const brief = { objective: 'change safely', scope: ['lib/a.mjs'], nonGoals: [], implementationSteps: ['add behavior'], verification: ['npm test'], documentation: ['README.md'], openDecisions: [] }
  return { args: { task: 'Map the subsystem' }, responder: ({ label }) => label === 'scout:reconnaissance' ? recon : brief }
}

function tddFixture({ green = false, remediate = false, exhaust = false, forged = false } = {}) {
  const signer = createReceiptSigner()
  const testPaths = ['tests/bug.test.mjs']
  const reproductionArgv = ['npm', 'test', '--', 'bug']
  let baselineSequence
  return {
    args: {
      task: 'Fix the bug', testPaths, reproductionArgv, verificationArgv, evidenceSession: signer.session,
      reproductionPasses: green ? 2 : 1,
      ...(remediate ? { maxPasses: 2 } : exhaust || forged ? { maxPasses: 1 } : {}),
    },
    responder: ({ label }) => {
      if (label === 'evidence:baseline') {
        const receipt = signer.receipt('baseline', { testPaths }, { repository: { fingerprint: 'a'.repeat(64) } })
        baselineSequence = receipt.sequence
        return { receipt }
      }
      if (label.startsWith('reproduce:')) return { receipt: signer.command({ argv: reproductionArgv, purpose: 'tdd-red', exitCode: green ? 0 : 1, changedPaths: testPaths, baselineSequence, testPaths }) }
      if (label.startsWith('fix:')) return { summary: label, filesChanged: ['lib/bug.mjs'], testsChanged: testPaths, commandsRun: ['npm test'], openBlockers: [] }
      if (label.startsWith('test:')) return { passed: true, commands: [{ command: 'npm run verify', exitCode: 0, result: 'pass' }], failures: [], coverageGaps: [] }
      if (label.startsWith('document:')) return { filesChanged: ['STATUS.md'], truthChecks: ['fixed'], openDrift: [] }
      if (label.startsWith('evidence:pass-')) {
        const report = { receipt: signer.command({ argv: verificationArgv }) }
        if (forged) report.receipt.result.command.stdoutSha256 = '0'.repeat(64)
        return report
      }
      if (label === 'review:pass-1' && (remediate || exhaust)) return { verdict: 'revise', findings: [{ severity: 'high', location: 'lib/bug.mjs:1', problem: 'incomplete fix', proof: 'repro', fix: 'repair' }], checks: ['repro'] }
      if (label.startsWith('review:')) return { verdict: 'pass', findings: [], checks: ['root cause'] }
      if (label === 'verify:pass-1' && (remediate || exhaust)) return { approved: false, reason: 'review failed', requiredFixes: ['repair'] }
      if (label.startsWith('verify:')) return { approved: true, reason: 'red and green', requiredFixes: [] }
      throw new Error(`unhandled ${label}`)
    },
  }
}

function researchFixture({ outcome = 'target' } = {}) {
  const signer = createReceiptSigner()
  const measurementArgv = ['node', 'scripts/measure.mjs']
  const testArgv = ['npm', 'test']
  let measurementIndex = 0
  const values = outcome === 'target' ? [12, 12]
    : outcome === 'successor' ? [30, 30, 12, 12]
      : [30, 30, 30, 30]
  const passFor = label => Number(label.match(/pass-(\d+)/)?.[1] || 1)
  return {
    args: {
      task: 'Reduce latency', metric: 'p95 latency', target: { comparator: 'lte', value: 15, unit: 'ms' },
      measurementArgv, testArgv, evidenceSession: signer.session,
      ...(outcome === 'plateau' ? { maxPasses: 2, plateauAfter: 1 }
        : outcome === 'successor' ? { maxPasses: 2 }
          : outcome === 'max' ? { maxPasses: 1 } : {}),
    },
    responder: ({ label }) => {
      if (label.startsWith('hypothesis:')) return { hypothesis: label, rationale: 'evidence', experiment: 'bounded change', expectedSignal: 'improves', stopCondition: 'target' }
      if (label.startsWith('experiment:')) return { summary: label, filesChanged: ['lib/a.mjs'], testsChanged: ['tests/a.test.mjs'], commandsRun: [], openBlockers: [] }
      if (label.startsWith('measure:')) return { receipt: signer.command({ argv: measurementArgv, purpose: 'measurement', metric: { metric: 'p95 latency', unit: 'ms', value: values[Math.min(measurementIndex++, values.length - 1)] } }) }
      if (label.startsWith('test:')) return { receipt: signer.command({ argv: testArgv, purpose: 'tests' }) }
      if (label.startsWith('document:')) return { filesChanged: ['RESEARCH.md'], truthChecks: ['recorded'], openDrift: [] }
      if (label.startsWith('review:')) {
        if (outcome === 'dead-end') return { verdict: 'approve', targetMet: false, refuted: true, successorHypothesis: '', reason: 'valuable dead end', findings: [] }
        if (outcome === 'successor' && passFor(label) === 1) return { verdict: 'revise', targetMet: false, refuted: true, successorHypothesis: 'test cache locality', reason: 'successor exists', findings: [] }
        if (outcome === 'plateau' || outcome === 'max') return { verdict: 'revise', targetMet: false, refuted: false, successorHypothesis: '', reason: 'unmet', findings: [] }
        return { verdict: 'approve', targetMet: true, refuted: false, successorHypothesis: '', reason: 'met', findings: [] }
      }
      if (label.startsWith('verify:')) {
        if (outcome === 'dead-end') return { approved: true, reason: 'dead end verified', requiredFixes: [] }
        if (outcome === 'successor' && passFor(label) === 1) return { approved: false, reason: 'continue', requiredFixes: ['try successor'] }
        if (outcome === 'plateau' || outcome === 'max') return { approved: false, reason: 'continue', requiredFixes: ['continue'] }
        return { approved: true, reason: 'complete', requiredFixes: [] }
      }
      throw new Error(`unhandled ${label}`)
    },
  }
}

function shipFixture({ refuse = false } = {}) {
  const signer = createReceiptSigner()
  const releaseCheckArgv = ['npm', 'run', 'release-check']
  const taskPaths = ['lib/a.mjs']
  const args = {
    task: 'Ship feature', repository: 'acme/repo', headBranch: 'feat/change', baseBranch: 'main', taskPaths,
    verificationArgv, releaseCheckArgv, evidenceSession: signer.session,
    commitMessage: 'feat: add feature', pullRequestTitle: 'Add feature', pullRequestBody: 'Verified.', confirmOpenPullRequest: true,
  }
  let preflightSequence
  return {
    args,
    responder: ({ label }) => {
      if (label === 'ship:intent') return { headBranch: 'feat/change', baseBranch: 'main', taskChanges: taskPaths, excludedChanges: [], handoff: 'one PR' }
      if (label === 'ship:document') return { filesChanged: ['README.md'], truthChecks: ['docs'], openDrift: [] }
      if (label === 'ship:evidence') {
        const command = { exitCode: 0, signal: null, executionErrorCode: null, stdoutSha256: 'e'.repeat(64), stderrSha256: 'f'.repeat(64) }
        const receipt = signer.receipt('pre-pr', { repository: 'acme/repo', headBranch: 'feat/change', baseBranch: 'main', taskPaths, verificationArgv, releaseCheckArgv }, { repository: { owner: 'acme', repo: 'repo', slug: 'acme/repo', origin: 'https://github.com/acme/repo.git', branch: 'feat/change', head: 'b'.repeat(40), baseSha: 'c'.repeat(40), fingerprint: 'd'.repeat(64) }, verification: command, releaseCheck: command, diffCheck: command })
        preflightSequence = receipt.sequence
        return { receipt }
      }
      if (label === 'ship:redteam' && refuse) return { verdict: 'revise', findings: [{ severity: 'high', location: 'lib/a.mjs:1', problem: 'unsafe handoff', proof: 'trace', fix: 'repair' }], checks: ['trace'] }
      if (label === 'ship:review' || label === 'ship:redteam') return { verdict: 'pass', findings: [], checks: ['diff'] }
      if (label === 'ship:verify') return refuse
        ? { approved: false, reason: 'not ready', requiredFixes: ['repair'] }
        : { approved: true, reason: 'ready', requiredFixes: [] }
      if (label === 'ship:commit-push-pr') {
        const headSha = 'a'.repeat(40)
        return { receipt: signer.receipt('ship', { preflightSequence, commitMessage: args.commitMessage, pullRequestTitle: args.pullRequestTitle, pullRequestBody: args.pullRequestBody }, { repository: 'acme/repo', origin: 'https://github.com/acme/repo.git', headBranch: 'feat/change', headSha, baseBranch: 'main', remoteBranchVerified: true, pullRequest: { number: 7, url: 'https://github.com/acme/repo/pull/7', state: 'OPEN', isDraft: false, headRefName: 'feat/change', headRefOid: headSha, baseRefName: 'main', headRepository: { nameWithOwner: 'acme/repo' }, headRepositoryOwner: { login: 'acme' }, title: args.pullRequestTitle, body: args.pullRequestBody, mergedAt: null } }) }
      }
      throw new Error(`unhandled ${label}`)
    },
  }
}

for (const [name, id, factory] of [
  ['delivery success', 'helix-delivery', deliveryFixture],
  ['delivery replan', 'helix-delivery', () => deliveryFixture({ replan: true })],
  ['delivery remediation', 'helix-delivery', () => deliveryFixture({ remediate: true })],
  ['delivery exhausted rail', 'helix-delivery', () => deliveryFixture({ exhaust: true })],
  ['delivery forged evidence', 'helix-delivery', () => deliveryFixture({ forged: true })],
  ['implement-review success', 'helix-implement-review', implementFixture],
  ['implement-review remediation', 'helix-implement-review', () => implementFixture({ remediate: true })],
  ['implement-review exhausted rail', 'helix-implement-review', () => implementFixture({ exhaust: true })],
  ['implement-review forged evidence', 'helix-implement-review', () => implementFixture({ forged: true })],
  ['scout success', 'helix-scout', scoutFixture],
  ['TDD success', 'helix-tdd-fix', tddFixture],
  ['TDD reproduction exhaustion', 'helix-tdd-fix', () => tddFixture({ green: true })],
  ['TDD remediation', 'helix-tdd-fix', () => tddFixture({ remediate: true })],
  ['TDD exhausted rail', 'helix-tdd-fix', () => tddFixture({ exhaust: true })],
  ['TDD forged evidence', 'helix-tdd-fix', () => tddFixture({ forged: true })],
  ['research target', 'helix-research', researchFixture],
  ['research dead end', 'helix-research', () => researchFixture({ outcome: 'dead-end' })],
  ['research successor', 'helix-research', () => researchFixture({ outcome: 'successor' })],
  ['research plateau', 'helix-research', () => researchFixture({ outcome: 'plateau' })],
  ['research max iterations', 'helix-research', () => researchFixture({ outcome: 'max' })],
  ['ship success', 'helix-ship-pre-pr', shipFixture],
  ['ship refusal', 'helix-ship-pre-pr', () => shipFixture({ refuse: true })],
]) {
  test(`original and graph modes have exact observable parity: ${name}`, async () => {
    const result = await compareWorkflowModes({ id, ...pair(factory) })
    assert.equal(result.ok, true)
  })
}

test('parity comparison rejects unequal mode inputs before either workflow executes', async () => {
  await assert.rejects(compareWorkflowModes({
    id: 'helix-scout',
    argsFactory: mode => ({ task: mode }),
    responderFactory: () => () => { throw new Error('must not execute') },
  }), /comparison args differ for helix-scout/)
})

test('parity comparison detects mode-aware boundary response divergence', async () => {
  await assert.rejects(compareWorkflowModes({
    id: 'helix-scout',
    argsFactory: () => ({ task: 'Map the subsystem' }),
    responderFactory: mode => ({ label }) => label === 'scout:reconnaissance'
      ? { summary: mode, entrypoints: ['bin/tool'], relevantFiles: ['lib/a.mjs'], dataFlow: ['bin -> lib'], invariants: ['read-only'], tests: ['tests/a.test.mjs'], unknowns: [] }
      : { objective: 'change safely', scope: ['lib/a.mjs'], nonGoals: [], implementationSteps: ['add behavior'], verification: ['npm test'], documentation: ['README.md'], openDecisions: [] },
  }), /original\/graph parity mismatch for helix-scout/)
})

test('parity observation includes parallel groups and child workflow arguments and results', async () => {
  const comparison = await compareWorkflowModes({ id: 'helix-delivery', ...pair(deliveryFixture) })
  const events = comparison.result.events
  assert.ok(events.some(event => event.type === 'parallel:start' && event.count === 2))
  const childCall = events.find(event => event.type === 'workflow:call')
  const childReturn = events.find(event => event.type === 'workflow:return')
  assert.equal(childCall.name, 'helix-cc:helix-evidence-verify')
  assert.equal(childCall.args.expectation.kind, 'command')
  assert.equal(childReturn.value.verified, true)
})

test('parity observation removes only exact generated traces from graph mode', () => {
  const result = {
    ok: true,
    value: 1,
    events: [],
    logs: [
      '[graph:helix-scout@0123456789ab] reconnaissance',
      '[graph:ordinary] keep this workflow log',
      '[graph:helix-scout@not-a-digest] keep this too',
    ],
  }
  assert.deepEqual(observeWorkflowResult(result).logs, result.logs)
  assert.deepEqual(observeWorkflowResult(result, { graphId: 'helix-scout' }).logs, result.logs.slice(1))

  const ordinaryLeft = observeWorkflowResult({ ok: true, value: { signature: ['left'] }, events: [], logs: [] })
  const ordinaryRight = observeWorkflowResult({ ok: true, value: { signature: ['right'] }, events: [], logs: [] })
  assert.notDeepEqual(ordinaryLeft, ordinaryRight)

  const receipt = signature => ({ version: 2, sessionId: 'hxe_session', sequence: 1, operation: 'command', request: {}, result: {}, signature: Array(6).fill(signature) })
  assert.deepEqual(
    observeWorkflowResult({ ok: true, value: receipt('left'), events: [], logs: [] }),
    observeWorkflowResult({ ok: true, value: receipt('right'), events: [], logs: [] }),
  )
})
