import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createEvidenceService } from '../lib/trusted-evidence.mjs'
import { createReceiptSigner } from './evidence-fixtures.mjs'
import { runWorkflow, workflowFileForMode } from './workflow-harness.mjs'

const file = workflowFileForMode('helix-research.js')
const measurementArgv = ['node', 'scripts/measure.mjs']
const testArgv = ['npm', 'test']

function setup(values = [12]) {
  const signer = createReceiptSigner()
  let measurementIndex = 0
  const input = {
    task: 'Reduce latency', metric: 'p95 latency', target: { comparator: 'lte', value: 15, unit: 'ms' },
    measurementArgv, testArgv, evidenceSession: signer.session,
  }
  const defaults = ({ label }) => {
    if (label.startsWith('hypothesis:')) return { hypothesis: label, rationale: 'evidence', experiment: 'one bounded change', expectedSignal: 'metric improves', stopCondition: 'target met' }
    if (label.startsWith('experiment:')) return { summary: label, filesChanged: ['lib/a.mjs'], testsChanged: ['tests/a.test.mjs'], commandsRun: [], openBlockers: [] }
    if (label.startsWith('measure:')) return { receipt: signer.command({ argv: measurementArgv, purpose: 'measurement', metric: { metric: 'p95 latency', unit: 'ms', value: values[Math.min(measurementIndex++, values.length - 1)] } }) }
    if (label.startsWith('test:')) return { receipt: signer.command({ argv: testArgv, purpose: 'tests' }) }
    if (label.startsWith('document:')) return { filesChanged: ['RESEARCH.md'], truthChecks: ['measurement recorded'], openDrift: [] }
    if (label.startsWith('review:')) return { verdict: 'approve', targetMet: true, refuted: false, successorHypothesis: '', reason: 'target proven', findings: [] }
    if (label.startsWith('verify:')) return { approved: true, reason: 'evidence complete', requiredFixes: [] }
    throw new Error(`unhandled ${label}`)
  }
  return { input, defaults }
}

test('research uses signed typed measurement and test receipts from the final checkout before approval', async () => {
  const { input, defaults } = setup()
  const { result, calls } = await runWorkflow(file, input, defaults)
  assert.equal(result.approved, true)
  assert.equal(result.stopReason, 'target-met')
  assert.equal(result.measurement.targetMet, true)
  assert.deepEqual(calls.map(call => call.options.label), [
    'hypothesis:pass-1',
    'experiment:pass-1',
    'measure:preliminary-pass-1',
    'document:pass-1',
    'measure:final-pass-1',
    'test:final-pass-1',
    'review:pass-1',
    'verify:pass-1',
  ])
})

test('research carries a signed target miss into a distinct next hypothesis', async () => {
  const { input, defaults } = setup([30, 30, 12, 12])
  const responder = options => {
    if (options.label === 'review:pass-1') return { verdict: 'revise', targetMet: false, refuted: false, successorHypothesis: '', reason: 'too slow', findings: [] }
    if (options.label === 'verify:pass-1') return { approved: false, reason: 'target not met', requiredFixes: ['new experiment'] }
    return defaults(options)
  }
  const { result, calls } = await runWorkflow(file, { ...input, maxPasses: 2 }, responder)
  assert.equal(result.passes, 2)
  assert.match(calls.find(call => call.options.label === 'hypothesis:pass-2').prompt, /"value": 30/)
})

test('research experiment contract distinguishes an expected miss from an execution blocker', async () => {
  const { input, defaults } = setup([30, 30])
  const { result, calls } = await runWorkflow(file, { ...input, maxPasses: 1 }, options => {
    if (options.label.startsWith('review:')) return { verdict: 'revise', targetMet: false, refuted: false, successorHypothesis: 'try the next bounded experiment', reason: 'the target remains unmet', findings: [] }
    if (options.label.startsWith('verify:')) return { approved: false, reason: 'research has not converged', requiredFixes: ['continue'] }
    return defaults(options)
  })
  const prompt = calls.find(call => call.options.label === 'experiment:pass-1').prompt
  assert.match(prompt, /expected target miss.*research evidence, not an execution blocker/)
  assert.match(prompt, /return openBlockers: \[\] exactly/)
  assert.equal(result.stopReason, 'max-iterations')
  assert.deepEqual(result.problems, [])
})

test('research returns a refuted hypothesis without a successor as a valuable dead-end result', async () => {
  const { input, defaults } = setup([30, 30])
  const { result } = await runWorkflow(file, input, options => {
    if (options.label.startsWith('review:')) return { verdict: 'approve', targetMet: false, refuted: true, successorHypothesis: '', reason: 'the hypothesis was disproved with no successor', findings: [] }
    if (options.label.startsWith('verify:')) return { approved: true, reason: 'the signed refutation is a valuable terminal result', requiredFixes: [] }
    return defaults(options)
  })
  assert.equal(result.approved, true)
  assert.equal(result.stopReason, 'dead-end')
  assert.equal(result.passes, 1)
})

test('research continues after refutation when a successor hypothesis exists', async () => {
  const { input, defaults } = setup([30, 30, 12, 12])
  const { result, calls } = await runWorkflow(file, { ...input, maxPasses: 2 }, options => {
    if (options.label === 'review:pass-1') return { verdict: 'revise', targetMet: false, refuted: true, successorHypothesis: 'try the bounded successor', reason: 'the first hypothesis was refuted', findings: [] }
    if (options.label === 'verify:pass-1') return { approved: false, reason: 'a successor remains', requiredFixes: ['run the successor'] }
    return defaults(options)
  })
  assert.equal(result.approved, true)
  assert.equal(result.stopReason, 'target-met')
  assert.equal(result.passes, 2)
  assert.match(calls.find(call => call.options.label === 'hypothesis:pass-2').prompt, /try the bounded successor/)
})

test('research stops with structured diminishing-returns and max-iteration outcomes', async () => {
  const continuing = defaults => options => {
    if (options.label.startsWith('review:')) return { verdict: 'revise', targetMet: false, refuted: false, successorHypothesis: '', reason: 'the target remains unmet', findings: [] }
    if (options.label.startsWith('verify:')) return { approved: false, reason: 'research has not converged', requiredFixes: ['continue'] }
    return defaults(options)
  }
  const plateau = setup([30, 30, 30, 30])
  const plateauResult = await runWorkflow(file, { ...plateau.input, maxPasses: 2, plateauAfter: 1 }, continuing(plateau.defaults))
  assert.equal(plateauResult.result.approved, false)
  assert.equal(plateauResult.result.stopReason, 'diminishing-returns')
  assert.equal(plateauResult.result.passes, 2)

  const exhausted = setup([30, 30])
  const exhaustedResult = await runWorkflow(file, { ...exhausted.input, maxPasses: 1 }, continuing(exhausted.defaults))
  assert.equal(exhaustedResult.result.approved, false)
  assert.equal(exhaustedResult.result.stopReason, 'max-iterations')
})

test('equality research counts progress only when measurement distance to the target shrinks', async () => {
  const { input, defaults } = setup([0, 0, 5, 5, 100, 100])
  const { result } = await runWorkflow(file, {
    ...input,
    target: { comparator: 'eq', value: 10, unit: 'ms' },
    maxPasses: 3,
    plateauAfter: 1,
  }, options => {
    if (options.label.startsWith('review:')) return { verdict: 'revise', targetMet: false, refuted: false, successorHypothesis: '', reason: 'the exact target remains unmet', findings: [] }
    if (options.label.startsWith('verify:')) return { approved: false, reason: 'research has not converged', requiredFixes: ['continue'] }
    return defaults(options)
  })
  assert.equal(result.approved, false)
  assert.equal(result.stopReason, 'diminishing-returns')
  assert.equal(result.passes, 3)
})

test('research rejects substituted or forged measurement receipts', async () => {
  const { input, defaults } = setup()
  await assert.rejects(
    runWorkflow(file, input, options => options.label === 'measure:preliminary-pass-1'
      ? { receipt: createReceiptSigner().command({ argv: ['npm', 'test'], purpose: 'measurement', metric: { metric: 'p95 latency', unit: 'ms', value: 12 } }) }
      : defaults(options)),
    /receipt envelope is invalid|receipt signature is invalid|command receipt does not match/,
  )
  await assert.rejects(
    runWorkflow(file, input, options => options.label === 'measure:final-pass-1'
      ? { receipt: createReceiptSigner().command({ argv: ['npm', 'test'], purpose: 'measurement', metric: { metric: 'p95 latency', unit: 'ms', value: 12 } }) }
      : defaults(options)),
    /receipt envelope is invalid|receipt signature is invalid|command receipt does not match/,
  )
})

test('research rejects unmeasurable typed input before launching an agent', async () => {
  const { input, defaults } = setup()
  await assert.rejects(runWorkflow(file, { ...input, target: { comparator: 'lte', value: Number.NaN, unit: 'ms' } }, defaults), /args\.target must contain/)
  await assert.rejects(runWorkflow(file, { ...input, models: { stranger: 'x' } }, defaults), /unknown model bindings/)
  await assert.rejects(runWorkflow(file, { ...input, maxPasses: 2, plateauAfter: 3 }, defaults), /args\.plateauAfter/)
  const calls = []
  await assert.rejects(
    runWorkflow(file, { ...input, measurementArgv: ['./measure.sh'] }, options => { calls.push(options.label) }),
    /PATH-resolved executables/,
  )
  assert.deepEqual(calls, [])
})

test('research returns a structured max-iteration result when documentation evidence is vacuous', async () => {
  const { input, defaults } = setup()
  const { result } = await runWorkflow(file, { ...input, maxPasses: 1 }, options => options.label === 'document:pass-1'
    ? { filesChanged: [], truthChecks: [], openDrift: [] }
    : defaults(options))
  assert.equal(result.approved, false)
  assert.equal(result.stopReason, 'max-iterations')
  assert.match(result.problems.join('; '), /documentation evidence is incomplete/)
})

test('research remeasures and retests after its documentation writer changes the checkout', async t => {
  const root = await mkdtemp(join(tmpdir(), 'helix-cc-research-final-tree-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const git = args => execFileSync('git', args, { cwd: root, stdio: 'ignore' })
  git(['init', '-b', 'research'])
  git(['config', 'user.name', 'Helix CC Test'])
  git(['config', 'user.email', 'helix-cc@example.invalid'])
  await writeFile(join(root, 'RESEARCH.md'), 'ok\n')
  git(['add', 'RESEARCH.md'])
  git(['commit', '-m', 'fixture'])
  git(['remote', 'add', 'origin', 'https://github.com/example/research-fixture.git'])

  const service = createEvidenceService({ cwd: root })
  const actualMeasurementArgv = [
    'node',
    '-e',
    "const fs=require('fs');process.stdout.write(JSON.stringify({metric:'research bytes',unit:'bytes',value:fs.statSync('RESEARCH.md').size}))",
  ]
  const actualTestArgv = ['node', '-e', 'process.exit(0)']
  const session = service.startSession({
    authorization: {
      commands: [
        { argv: actualMeasurementArgv, purpose: 'measurement', metric: { metric: 'research bytes', unit: 'bytes' } },
        { argv: actualTestArgv, purpose: 'tests', metric: null },
      ],
      tdd: null,
      prePr: null,
    },
  })
  const responder = async options => {
    if (options.label.startsWith('hypothesis:')) return { hypothesis: 'keep the ledger small', rationale: 'size is the requested metric', experiment: 'measure the current ledger', expectedSignal: 'at most ten bytes', stopCondition: 'the final tree meets the target' }
    if (options.label.startsWith('experiment:')) return { summary: 'fixture is ready', filesChanged: [], testsChanged: [], commandsRun: [], openBlockers: [] }
    if (options.label.startsWith('measure:')) return { receipt: service.runCommand({ sessionId: session.id, argv: actualMeasurementArgv, purpose: 'measurement', metric: { metric: 'research bytes', unit: 'bytes' } }) }
    if (options.label.startsWith('test:')) return { receipt: service.runCommand({ sessionId: session.id, argv: actualTestArgv, purpose: 'tests' }) }
    if (options.label.startsWith('document:')) {
      await writeFile(join(root, 'RESEARCH.md'), `${'x'.repeat(100)}\n`)
      return { filesChanged: ['RESEARCH.md'], truthChecks: ['research ledger updated'], openDrift: [] }
    }
    if (options.label.startsWith('review:')) return { verdict: 'revise', targetMet: false, refuted: false, successorHypothesis: '', reason: 'the supplied receipt missed the target', findings: [] }
    if (options.label.startsWith('verify:')) return { approved: true, reason: 'the supplied receipts verify', requiredFixes: [] }
    throw new Error(`unhandled ${options.label}`)
  }

  const { result } = await runWorkflow(file, {
      task: 'Keep RESEARCH.md at or below ten bytes after the completed workflow',
      metric: 'research bytes',
      target: { comparator: 'lte', value: 10, unit: 'bytes' },
      measurementArgv: actualMeasurementArgv,
      testArgv: actualTestArgv,
      evidenceSession: session,
      maxPasses: 1,
    }, responder)
  assert.equal(result.approved, false)
  assert.equal(result.stopReason, 'max-iterations')
  assert.equal((await stat(join(root, 'RESEARCH.md'))).size > 10, true)
})
