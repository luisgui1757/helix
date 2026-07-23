import assert from 'node:assert/strict'
import test from 'node:test'
import { runWorkflow, workflowFileForMode } from './workflow-harness.mjs'

const file = workflowFileForMode('helix-scout.js')
const recon = { summary: 'trace', entrypoints: ['bin/tool'], relevantFiles: ['lib/a.mjs'], dataFlow: ['bin -> lib'], invariants: ['read-only'], tests: ['tests/a.test.mjs'], unknowns: [] }
const brief = { objective: 'change safely', scope: ['lib/a.mjs'], nonGoals: [], implementationSteps: ['add behavior'], verification: ['npm test'], documentation: ['README.md'], openDecisions: [] }

test('scout uses only read-only reconnaissance and planning roles in sequence', async () => {
  const { result, calls } = await runWorkflow(file, { task: 'Map the subsystem' }, options => options.label === 'scout:reconnaissance' ? recon : brief)
  assert.equal(result.completed, true)
  assert.deepEqual(calls.map(call => call.options.agentType), ['helix-cc:scout', 'helix-cc:planner'])
  assert.match(calls[0].prompt, /Do not edit, create, delete/)
  assert.match(calls[1].prompt, /Do not implement or write repository files/)
})

test('scout rejects incomplete reconnaissance before planning', async () => {
  const calls = []
  await assert.rejects(
    runWorkflow(file, { task: 'Map' }, options => { calls.push(options.label); return { ...recon, relevantFiles: [] } }),
    /reconnaissance evidence is incomplete/,
  )
  assert.deepEqual(calls, ['scout:reconnaissance'])
})

test('scout validates input and forwards independent models', async () => {
  await assert.rejects(runWorkflow(file, { task: '', models: {} }, () => recon), /requires a non-empty args\.task/)
  const { calls } = await runWorkflow(file, { task: 'Map', models: { scout: 's', planner: 'p' } }, options => options.label === 'scout:reconnaissance' ? recon : brief)
  assert.deepEqual(calls.map(call => call.options.model), ['s', 'p'])
})
