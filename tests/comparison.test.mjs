import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync, chmodSync, existsSync, symlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acceptance, claudeUsage, codexUsage, schedule, skillObserved, reportsComplete, run } from '../evals/compare.mjs'
import { tasks } from '../evals/fixtures.mjs'

test('comparison pairs reverse order in the second repetition', () => {
  const runs = schedule()
  assert.equal(runs.length, 16)
  for (const host of ['codex', 'claude']) for (const task of Object.keys(tasks)) {
    const pair = repetition => runs.filter(r => r.host === host && r.task === task && r.repetition === repetition).map(r => r.mode)
    assert.deepEqual(pair(1).toSorted(), ['helix', 'plain'])
    assert.deepEqual(pair(2), pair(1).toReversed())
  }
})

test('Claude session totals include children once despite repeated results and message chunks', () => {
  const message = (id, model, input, cached, writes) => ({ type: 'assistant', message: { id, model,
    usage: { input_tokens: input, cache_read_input_tokens: cached, cache_creation_input_tokens: writes } } })
  const result = { type: 'result', modelUsage: {
    writer: { inputTokens: 2, cacheReadInputTokens: 100, cacheCreationInputTokens: 20, outputTokens: 30, thinkingTokens: 5 },
    reviewer: { inputTokens: 3, cacheReadInputTokens: 40, cacheCreationInputTokens: 10, outputTokens: 20, thinkingTokens: 6 },
  } }
  const writer = message('a', 'writer', 2, 100, 20)
  const usage = claudeUsage([writer, writer, result, message('b', 'reviewer', 3, 40, 10), result])
  assert.deepEqual(usage, [
    { model: 'writer', input: 122, cached: 100, cacheWrites: 20, noncached: 22, output: 30, thinking: 5 },
    { model: 'reviewer', input: 53, cached: 40, cacheWrites: 10, noncached: 13, output: 20, thinking: 6 },
  ])
  assert.throws(() => claudeUsage([writer, result]), /reconcile/)
})

test('Codex repeated cumulative events are not added together and thinking stays within output', () => {
  const event = input => ({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: {
    input_tokens: input, cached_input_tokens: 50, cache_write_input_tokens: 10,
    output_tokens: 30, reasoning_output_tokens: 20,
  } } } })
  assert.deepEqual(codexUsage([event(100), event(200), event(200)]), {
    input: 200, cached: 50, cacheWrites: 10, noncached: 150, output: 30, thinking: 20,
  })
  assert.throws(() => codexUsage([]), /No cumulative/)
  assert.throws(() => codexUsage([event(10)]), /Inconsistent/)
})

test('skill evidence accepts native injection and successful file reads, not a catalog listing or a read request', () => {
  const skill = '---\nname: example\ndescription: Example\n---\n# Example\n\nFull instructions.\n'
  const injected = { type: 'user', message: { content: [{ type: 'text', text: '# Example\n\nFull instructions.\n' }] } }
  const read = { type: 'response_item', payload: { type: 'function_call_output', output: [
    { type: 'text', text: JSON.stringify({ output: skill }) },
  ] } }
  assert.equal(skillObserved([injected], skill), true)
  assert.equal(skillObserved([read], skill), true)
  assert.equal(skillObserved([{ type: 'user', message: { content: 'example: Example (SKILL.md)' } }], skill), false)
  assert.equal(skillObserved([{ type: 'response_item', payload: { type: 'function_call', arguments: 'cat SKILL.md' } }], skill), false)
})

test('held-out checks reject both starting implementations and accept independent solutions', () => {
  const work = mkdtempSync(join(tmpdir(), 'helix-oracle-'))
  const solutions = {
    csv: `export function encodeRows(rows) {
      return rows.map(row => row.map(value => {
        const s = value == null ? '' : String(value)
        return /[,"\\r\\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s
      }).join(',')).join('\\r\\n')
    }`,
    preferences: `export function readPreferences(raw) {
      const value = raw === null ? {} : JSON.parse(raw)
      const object = v => v !== null && typeof v === 'object' && !Array.isArray(v)
      if (!object(value)) throw new TypeError('root')
      if (Object.hasOwn(value, 'version') && value.version !== 1 && value.version !== 2) throw new RangeError('version')
      const appearance = value.version === 2 ? (Object.hasOwn(value,'appearance') ? value.appearance : {}) : value
      if (!object(appearance)) throw new TypeError('appearance')
      const theme = Object.hasOwn(appearance,'theme') ? appearance.theme : 'system'
      const compact = Object.hasOwn(appearance,'compact') ? appearance.compact : false
      const refreshSeconds = Object.hasOwn(value,'refreshSeconds') ? value.refreshSeconds : 60
      if (!['light','dark','system'].includes(theme) || typeof compact !== 'boolean' ||
        !Number.isInteger(refreshSeconds) || refreshSeconds < 0 || refreshSeconds > 3600) throw new TypeError('known field')
      const result = {...value, version:2, appearance:{...(value.version === 2 ? appearance : {}),theme,compact},refreshSeconds}
      delete result.theme; delete result.compact
      return result
    }`,
  }
  try {
    for (const [name, task] of Object.entries(tasks)) {
      writeFileSync(join(work, 'module.mjs'), task.source)
      assert.ok(acceptance(name, work).passed < task.checks.length, `${name}: baseline unexpectedly passes`)
      writeFileSync(join(work, 'module.mjs'), solutions[name])
      const score = acceptance(name, work)
      assert.equal(score.passed, score.total, JSON.stringify(score))
    }
  } finally { rmSync(work, { recursive: true, force: true }) }
})

test('published results retain the paired schedule and reconcile all token aggregates', () => {
  const data = JSON.parse(readFileSync(new URL('../evals/results/2026-10-03-comparison.json', import.meta.url)))
  assert.deepEqual(data.runs.map(({ host, task, repetition, mode }) => ({ host, task, repetition, mode })), schedule())
  for (const run of data.runs) {
    for (const key of Object.keys(run.totals)) {
      assert.equal(run.totals[key], run.byModel.reduce((sum, u) => sum + u[key], 0), `${run.id}: ${key}`)
    }
    assert.equal(run.totals.input, run.totals.cached + run.totals.noncached)
    assert.ok(run.totals.thinking <= run.totals.output)
  }
  for (const aggregate of data.summary) {
    const runs = data.runs.filter(r => r.host === aggregate.host && r.mode === aggregate.mode)
    assert.equal(runs.length, aggregate.runs)
    for (const key of Object.keys(runs[0].totals)) assert.equal(aggregate[key], runs.reduce((sum, r) => sum + r.totals[key], 0))
    assert.ok(Math.abs(aggregate.seconds - runs.reduce((sum, r) => sum + r.seconds, 0)) < 0.001)
  }
})

test('completion evidence requires a positive status at the start of the final report', () => {
  for (const text of ['COMPLETE', '**COMPLETE.** Verified.', '**COMPLETE**\nChecks passed.']) assert.equal(reportsComplete(text), true)
  for (const text of ['Not COMPLETE', 'BLOCKED\nDo not report COMPLETE.', 'COMPLETEly wrong', '']) assert.equal(reportsComplete(text), false)
})

for (const failure of ['cannot-start', 'truncated-output']) {
  test(`a CLI that ${failure} closes telemetry and retains external scores`, { timeout: 10000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'helix-cli-failure-'))
    const originalPath = process.env.PATH
    try {
      const bin = join(root, 'bin'); mkdirSync(bin)
      const git = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
      symlinkSync(git, join(bin, 'git'))
      const stub = join(bin, 'claude')
      writeFileSync(stub, failure === 'cannot-start' ? '#!/nonexistent/helix-test-interpreter\n' : "#!/bin/sh\nprintf '{'\n")
      chmodSync(stub, 0o700)
      // execvp can continue searching PATH after a missing shebang interpreter.
      // Permit only the stub and Git; never leave a real agent CLI as a fallback.
      process.env.PATH = bin
      const result = await run(root, { host: 'claude', task: 'csv', repetition: 1, mode: 'plain' })
      assert.ok(result.accountingError)
      if (failure === 'cannot-start') assert.match(result.launchError, /ENOENT/)
      assert.equal(result.reportsComplete, false)
      assert.ok(result.acceptance.passed < result.acceptance.total)
      const artifact = join(root, 'claude-csv-1-plain')
      assert.ok(existsSync(join(artifact, 'acceptance.json')))
      // This file is written only after server.close() completes.
      assert.deepEqual(JSON.parse(readFileSync(join(artifact, 'requests.json'))), [])
    } finally {
      if (originalPath === undefined) delete process.env.PATH
      else process.env.PATH = originalPath
      rmSync(root, { recursive: true, force: true })
    }
  })
}
