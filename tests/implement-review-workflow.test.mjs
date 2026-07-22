import assert from 'node:assert/strict'
import test from 'node:test'
import { createReceiptSigner } from './evidence-fixtures.mjs'
import { runWorkflow, workflowFileForMode } from './workflow-harness.mjs'

const file = workflowFileForMode('helix-implement-review.js')
const verificationArgv = ['npm', 'run', 'verify']

function setup() {
  const signer = createReceiptSigner()
  const args = { task: 'Implement the settled change', verificationArgv, evidenceSession: signer.session }
  const defaults = ({ label }) => {
    if (label.startsWith('implement:')) return { summary: label, filesChanged: ['lib/a.mjs'], testsChanged: ['tests/a.test.mjs'], commandsRun: ['npm test'], openBlockers: [] }
    if (label.startsWith('test:')) return { passed: true, commands: [{ command: 'npm run verify', exitCode: 0, result: 'pass' }], failures: [], coverageGaps: [] }
    if (label.startsWith('document:')) return { filesChanged: ['README.md'], truthChecks: ['workflow table matches source'], openDrift: [] }
    if (label.startsWith('evidence:')) return { receipt: signer.command({ argv: verificationArgv }) }
    if (label.startsWith('review:')) return { verdict: 'pass', findings: [], checks: ['diff inspected'] }
    if (label.startsWith('verify:')) return { approved: true, reason: 'evidence is complete', requiredFixes: [] }
    throw new Error(`unhandled ${label}`)
  }
  return { signer, args, defaults }
}

test('implement-review executes one writer before a signed complete evidence gate', async () => {
  const { args, defaults } = setup()
  const { result, calls } = await runWorkflow(file, args, defaults)
  assert.equal(result.approved, true)
  assert.equal(result.trustedEvidence.verified, true)
  assert.deepEqual(calls.map(call => call.options.label), [
    'implement:initial', 'test:pass-1', 'document:pass-1', 'evidence:pass-1',
    'review:correctness-1', 'review:redteam-1', 'verify:pass-1',
  ])
})

test('implement-review remediates and repeats the signed gate after rejected evidence', async () => {
  const { args, defaults } = setup()
  const responder = options => {
    if (options.label === 'review:redteam-1') return { verdict: 'revise', findings: [{ severity: 'high', location: 'lib/a.mjs:1', problem: 'boundary', proof: 'repro', fix: 'validate' }], checks: ['repro'] }
    if (options.label === 'verify:pass-1') return { approved: false, reason: 'review failed', requiredFixes: ['validate'] }
    return defaults(options)
  }
  const { result, calls } = await runWorkflow(file, { ...args, maxPasses: 2 }, responder)
  assert.equal(result.passes, 2)
  assert.equal(calls.filter(call => call.options.label === 'implement:remediate-1').length, 1)
  assert.equal(calls.filter(call => call.options.label.startsWith('evidence:pass-')).length, 2)
})

test('implement-review rejects invalid input, vacuous reports, and forged receipts', async () => {
  const { args, defaults } = setup()
  await assert.rejects(runWorkflow(file, { ...args, task: '' }, defaults), /requires args\.task/)
  await assert.rejects(runWorkflow(file, { ...args, models: { unknown: 'model' } }, defaults), /unknown model bindings/)
  const calls = []
  await assert.rejects(
    runWorkflow(file, { ...args, verificationArgv: ['./verify.sh'] }, options => { calls.push(options.label) }),
    /PATH-resolved executable/,
  )
  assert.deepEqual(calls, [])
  await assert.rejects(
    runWorkflow(file, { ...args, maxPasses: 1 }, options => options.label === 'test:pass-1'
      ? { passed: true, commands: [], failures: [], coverageGaps: [] }
      : defaults(options)),
    /exhausted 1 passes.*no executed command evidence/,
  )
  await assert.rejects(
    runWorkflow(file, args, options => {
      const value = defaults(options)
      if (options.label === 'evidence:pass-1') value.receipt.result.command.stdoutSha256 = '0'.repeat(64)
      return value
    }),
    /receipt signature is invalid/,
  )
})

test('implement-review forwards explicit role models only to model-mediated stages', async () => {
  const { args, defaults } = setup()
  const models = { builder: 'b', tester: 't', documenter: 'd', reviewer: 'r', redteam: 'x', verifier: 'v' }
  const { calls } = await runWorkflow(file, { ...args, models }, defaults)
  const routed = Object.fromEntries(calls.filter(call => call.options.model).map(call => [call.options.agentType, call.options.model]))
  assert.deepEqual(routed, {
    'helix-cc:builder': 'b', 'helix-cc:tester': 't', 'helix-cc:documenter': 'd',
    'helix-cc:reviewer': 'r', 'helix-cc:redteam': 'x', 'helix-cc:verifier': 'v',
  })
})
