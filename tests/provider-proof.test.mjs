import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../workflows/provider-proof.js', import.meta.url), 'utf8')
const compiled = source.replace('export const meta =', 'const meta =')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

async function run(args, responder) {
  const calls = []
  const agent = async (prompt, options) => {
    calls.push({ prompt, options })
    return responder ? responder(prompt, options) : { marker: args.marker }
  }
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'workflow', 'args', 'budget', 'log', compiled)
  const result = await fn(agent, undefined, undefined, undefined, args, {}, () => {})
  return { result, calls }
}

test('provider proof sends one low-effort native Workflow subagent to the exact requested model', async () => {
  const { result, calls } = await run({ model: 'gpt-5.6-luna', marker: 'proof-marker' })
  assert.deepEqual(result, { marker: 'proof-marker', completed: true })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].options.agentType, 'helix-cc:provider-probe')
  assert.equal(calls[0].options.model, 'gpt-5.6-luna')
  assert.equal(calls[0].options.effort, 'low')
  assert.equal(calls[0].options.label, 'provider-proof:subagent')
  assert.deepEqual(calls[0].options.schema.required, ['marker'])
})

test('provider proof rejects malformed input before spawning an agent', async () => {
  for (const [args, expected] of [
    [undefined, /args must be an object/],
    [{ model: 'gpt-5.6-luna', marker: 'ok', extra: true }, /unknown args: extra/],
    [{ model: '', marker: 'ok' }, /args\.model/],
    [{ model: 'gpt-5.6-luna', marker: 'bad\nmarker' }, /args\.marker/],
  ]) {
    await assert.rejects(run(args), expected)
  }
})

test('provider proof fails when the subagent does not echo the exact marker', async () => {
  await assert.rejects(
    run({ model: 'gpt-5.6-luna', marker: 'expected' }, async () => ({ marker: 'different' })),
    /wrong marker/,
  )
})
