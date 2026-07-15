import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))
const helper = join(root, 'bin', 'helix-cc-cliproxy')

test('CLIProxyAPI entrypoint exposes help and fails clearly on an unknown command', () => {
  const help = spawnSync(process.execPath, [helper, '--help'], { encoding: 'utf8' })
  assert.equal(help.status, 0, help.stderr)
  assert.match(help.stdout, /Usage: helix-cc-cliproxy/)
  assert.match(help.stdout, /proof-matrix/)

  const unknown = spawnSync(process.execPath, [helper, 'not-a-command'], { encoding: 'utf8' })
  assert.equal(unknown.status, 1)
  assert.match(unknown.stderr, /unknown command: not-a-command/)
})

test('CLIProxyAPI status is a read-only process-level entrypoint', async t => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'helix-cc-entrypoint-state-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const result = spawnSync(process.execPath, [helper, 'status'], {
    env: { ...process.env, HELIX_CC_CLIPROXY_DIR: stateRoot },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.equal(report.status, 'not-configured')
  assert.equal(report.modelCount, 0)
  assert.deepEqual(await readdir(stateRoot), [])
})

test('CLIProxyAPI launch and proof commands reject route-model mismatches before preparing state', async t => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'helix-cc-entrypoint-model-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  for (const [args, message] of [
    [['run', '--providers', 'copilot', '--'], /exactly one --model/],
    [['run', '--providers', 'codex,copilot', '--', '--model', 'azure/deployment'], /does not belong/],
    [['proof', '--providers', 'copilot', '--model', 'azure/deployment'], /does not belong/],
    [['proof-matrix', '--providers', 'codex,copilot', '--models', 'openai/gpt-5.6-luna,openai/gpt-5.4'], /selected provider copilot/],
  ]) {
    const result = spawnSync(process.execPath, [helper, ...args], {
      env: { ...process.env, HELIX_CC_CLIPROXY_DIR: stateRoot },
      encoding: 'utf8',
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, message)
    assert.deepEqual(await readdir(stateRoot), [])
  }
})
