import assert from 'node:assert/strict'
import test from 'node:test'
import { createReceiptSigner } from './evidence-fixtures.mjs'
import { runWorkflow, workflowFileForMode } from './workflow-harness.mjs'

const file = workflowFileForMode('helix-tdd-fix.js')
const reproductionArgv = ['npm', 'test', '--', 'bug']
const verificationArgv = ['npm', 'run', 'verify']
const testPaths = ['tests/bug.test.mjs']

function setup({ redExit = 1, redPaths = ['tests/bug.test.mjs'] } = {}) {
  const signer = createReceiptSigner()
  let baselineSequence
  const input = { task: 'Fix the bug', testPaths, reproductionArgv, verificationArgv, evidenceSession: signer.session }
  const defaults = ({ label }) => {
    if (label === 'evidence:baseline') {
      const receipt = signer.receipt('baseline', { testPaths }, { repository: { fingerprint: 'a'.repeat(64) } })
      baselineSequence = receipt.sequence
      return { receipt }
    }
    if (label.startsWith('reproduce:')) return { receipt: signer.command({ argv: reproductionArgv, purpose: 'tdd-red', exitCode: redExit, changedPaths: redPaths, baselineSequence, testPaths }) }
    if (label.startsWith('fix:')) return { summary: label, filesChanged: ['lib/bug.mjs'], testsChanged: ['tests/bug.test.mjs'], commandsRun: ['npm test'], openBlockers: [] }
    if (label.startsWith('test:')) return { passed: true, commands: [{ command: 'npm run verify', exitCode: 0, result: 'pass' }], failures: [], coverageGaps: [] }
    if (label.startsWith('document:')) return { filesChanged: ['STATUS.md'], truthChecks: ['fixed ledger updated'], openDrift: [] }
    if (label.startsWith('evidence:pass-')) return { receipt: signer.command({ argv: verificationArgv }) }
    if (label.startsWith('review:')) return { verdict: 'pass', findings: [], checks: ['root cause and regression inspected'] }
    if (label.startsWith('verify:')) return { approved: true, reason: 'signed red and green proven', requiredFixes: [] }
    throw new Error(`unhandled ${label}`)
  }
  return { signer, input, defaults }
}

test('TDD fix binds red to a signed changed-test command before the production fixer', async () => {
  const { input, defaults } = setup()
  const { result, calls } = await runWorkflow(file, input, defaults)
  assert.equal(result.approved, true)
  assert.equal(result.reproduction.result.command.exitCode, 1)
  assert.deepEqual(calls.map(call => call.options.label), [
    'evidence:baseline', 'reproduce:pass-1', 'fix:initial', 'test:pass-1', 'document:pass-1',
    'evidence:pass-1', 'review:pass-1', 'verify:pass-1',
  ])
})

test('TDD fix retries a signed green result and never starts the fixer when red is absent', async () => {
  const { input, defaults } = setup({ redExit: 0 })
  const calls = []
  await assert.rejects(
    runWorkflow(file, { ...input, reproductionPasses: 2 }, options => { calls.push(options.label); return defaults(options) }),
    /could not prove a signed failing test reproduction in 2 passes/,
  )
  assert.deepEqual(calls, ['evidence:baseline', 'reproduce:pass-1', 'reproduce:pass-2'])
})

test('TDD fix rejects signed red evidence that includes production paths or command-not-found', async () => {
  const production = setup({ redPaths: ['tests/a.test.mjs', 'lib/a.mjs'] })
  await assert.rejects(runWorkflow(file, production.input, production.defaults), /not bound exclusively to the signed testPaths scope/)
  const missing = setup({ redExit: 127 })
  await assert.rejects(runWorkflow(file, missing.input, missing.defaults), /not a real non-infrastructure failure/)
})

test('TDD fix rejects a production export even when its path has a test-like directory name', async () => {
  const production = setup({ redPaths: ['src/test/runtime.mjs'] })
  await assert.rejects(runWorkflow(file, production.input, production.defaults), /not bound exclusively to the signed testPaths scope/)
})

test('TDD fix canonicalizes signed test paths and rejects unreachable argv before any agent', async () => {
  const { input, defaults } = setup()
  for (const override of [
    { reproductionArgv: ['./reproduce.sh'] },
    { testPaths: ['.//tmp/x.test.mjs'] },
    { testPaths: ['tests/bug.test.mjs', './tests/bug.test.mjs'] },
    { testPaths: ['.//.git/config'] },
  ]) {
    const calls = []
    await assert.rejects(
      runWorkflow(file, { ...input, ...override }, options => { calls.push(options.label) }),
      /PATH-resolved executable|repository-relative test paths|must not contain duplicates/,
    )
    assert.deepEqual(calls, [])
  }
  const normalized = await runWorkflow(file, { ...input, testPaths: ['./tests/bug.test.mjs'] }, defaults)
  assert.deepEqual(normalized.result.baseline.result.repository.fingerprint, 'a'.repeat(64))
})

test('TDD fix rejects a signed final receipt for a substituted command', async () => {
  const { signer, input, defaults } = setup()
  await assert.rejects(
    runWorkflow(file, input, options => options.label === 'evidence:pass-1'
      ? { receipt: signer.command({ argv: ['npm', 'test'] }) }
      : defaults(options)),
    /command receipt does not match/,
  )
})

test('TDD fix rejects a failed supplemental tester command even when trusted verification passed', async () => {
  const { input, defaults } = setup()
  await assert.rejects(
    runWorkflow(file, { ...input, maxPasses: 1 }, options => options.label === 'test:pass-1'
      ? { passed: true, commands: [{ command: 'npm run verify', exitCode: 0, result: 'pass' }, { command: 'npm run lint', exitCode: 1, result: 'fail' }], failures: [], coverageGaps: [] }
      : defaults(options)),
    /exhausted 1 fix passes.*reported verification commands failed/,
  )
})

test('TDD fix forwards the reproducer and fixer models independently', async () => {
  const { input, defaults } = setup()
  const { calls } = await runWorkflow(file, { ...input, models: { reproducer: 'red-model', builder: 'fix-model' } }, defaults)
  assert.equal(calls.find(call => call.options.label === 'reproduce:pass-1').options.model, 'red-model')
  assert.equal(calls.find(call => call.options.label === 'fix:initial').options.model, 'fix-model')
})
