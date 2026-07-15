import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { claudeGatewayEnvironment } from '../lib/cliproxy.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const doctor = join(root, 'bin', 'helix-cc-doctor')

test('wrapped provider session keeps doctor preflight truthful after subprocess scrubbing', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'helix-cc-provider-session-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const fakeClaude = join(directory, 'claude')
  await writeFile(fakeClaude, `#!/usr/bin/env bash
if [[ "\${1:-}" == "--version" ]]; then
  echo "2.1.214"
  exit 0
fi
if [[ "\${1:-}" == "auth" && "\${2:-}" == "status" ]]; then
  echo '{"loggedIn":false}'
  exit 1
fi
exit 2
`)
  await chmod(fakeClaude, 0o755)

  const secret = 'gateway-value-that-must-not-reach-the-doctor'
  const env = claudeGatewayEnvironment({
    env: { PATH: `${directory}:${process.env.PATH}` },
    baseUrl: 'http://127.0.0.1:18317',
    apiKey: secret,
    claudeConfigDir: join(directory, 'claude-config'),
    activeSession: {
      ownerPid: process.pid,
      gatewayPid: process.ppid,
      providers: ['codex', 'copilot'],
      models: ['openai/gpt-5.6-luna', 'copilot/gpt-5.4'],
    },
  })
  delete env.ANTHROPIC_BASE_URL
  delete env.ANTHROPIC_AUTH_TOKEN

  const result = spawnSync(process.execPath, [doctor, '--json'], { env, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.equal(report.paths.cliProxyNativeWorkflow.locallyReady, true)
  assert.equal(report.paths.cliProxyNativeWorkflow.catalogSource, 'active-wrapper-session')
  assert.deepEqual(report.paths.cliProxyNativeWorkflow.providers, ['codex', 'copilot'])
  assert.deepEqual(report.paths.cliProxyNativeWorkflow.models, ['openai/gpt-5.6-luna', 'copilot/gpt-5.4'])
  assert.equal(result.stdout.includes(secret), false)
})
