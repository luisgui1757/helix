import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../workflows/provider-matrix-proof.js', import.meta.url), 'utf8')
const compiled = source.replace('export const meta =', 'const meta =')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

async function run(args, responder) {
  const calls = []
  const agent = async (prompt, options) => {
    calls.push({ prompt, options })
    return responder ? responder(prompt, options) : { marker: args.marker }
  }
  const parallel = async tasks => Promise.all(tasks.map(task => task()))
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'workflow', 'args', 'budget', 'log', compiled)
  const result = await fn(agent, parallel, undefined, undefined, args, {}, () => {})
  return { result, calls }
}

test('provider matrix proof launches one low-effort subagent per exact model', async () => {
  const models = ['openai/gpt-5.6-luna', 'copilot/gpt-5-mini', 'azure/deployment']
  const { result, calls } = await run({ models, marker: 'matrix-marker' })
  assert.deepEqual(result, { marker: 'matrix-marker', completed: true, agents: 3 })
  assert.deepEqual(calls.map(call => call.options.model), models)
  assert.deepEqual(calls.map(call => call.options.label), [
    'provider-matrix-proof:1',
    'provider-matrix-proof:2',
    'provider-matrix-proof:3',
  ])
  assert.equal(calls.every(call => call.options.agentType === 'helix-cc:provider-probe'), true)
  assert.equal(calls.every(call => call.options.effort === 'low'), true)
})

test('provider matrix proof rejects invalid cardinality and duplicate models before calls', async () => {
  for (const [args, expected] of [
    [{ models: ['one'], marker: 'ok' }, /two through four/],
    [{ models: ['one', 'one'], marker: 'ok' }, /unique/],
    [{ models: ['one', 'two'], marker: 'bad\nmarker' }, /args\.marker/],
    [{ models: ['one', 'two'], marker: 'ok', extra: true }, /unknown args/],
  ]) await assert.rejects(run(args), expected)
})

test('provider matrix proof fails if any subagent returns a wrong marker', async () => {
  let index = 0
  await assert.rejects(
    run({ models: ['one', 'two'], marker: 'ok' }, async () => ({ marker: index++ === 0 ? 'ok' : 'wrong' })),
    /wrong marker/,
  )
})
