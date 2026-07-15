import assert from 'node:assert/strict'
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  artifactFor,
  claudeGatewayEnvironment,
  extractResolvedModels,
  expectedTranscriptModel,
  hardenCodexAuthFiles,
  inspectCliProxyState,
  isLoopbackBaseUrl,
  prepareCliProxyArchive,
  probeCliProxyModels,
  renderCliProxyConfig,
  resolvedModelsExactlyMatch,
  resolveCliProxyPaths,
  sanitizeCliProxyLoginLine,
  setCodexAuthPrefix,
  sidecarProcessEnvironment,
  verifyCodexOnlyAuthDir,
  waitForResolvedModels,
} from '../lib/cliproxy.mjs'

test('pinned release artifacts are explicit per supported platform and architecture', () => {
  const darwin = artifactFor('darwin', 'arm64')
  assert.equal(darwin.name, 'CLIProxyAPI_7.2.80_darwin_aarch64.tar.gz')
  assert.equal(darwin.sha256, '7b13a17670a7d24318e3d6a3f24ff38696cf23ab44894fc93fbd53fbb68dfda6')
  assert.match(darwin.url, /\/v7\.2\.80\/CLIProxyAPI_7\.2\.80_darwin_aarch64\.tar\.gz$/)
  assert.throws(() => artifactFor('win32', 'x64'), /no pinned artifact/)
  assert.throws(() => artifactFor('aix', 'ppc64'), /no pinned artifact/)
})

test('archive preparation bounds downloads, verifies the digest, and removes partial files', async t => {
  const root = await mkdtemp(join(tmpdir(), 'helix-cc-archive-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const paths = resolveCliProxyPaths({
    env: { HELIX_CC_CLIPROXY_DIR: root },
    platform: 'darwin',
    arch: 'arm64',
  })
  await assert.rejects(
    prepareCliProxyArchive({
      paths,
      fetcher: async () => new Response('small', { headers: { 'content-length': String(257 * 1024 * 1024) } }),
    }),
    /256 MiB/,
  )
  await assert.rejects(
    prepareCliProxyArchive({ paths, fetcher: async () => new Response('wrong archive') }),
    /checksum mismatch/,
  )
  assert.deepEqual((await readdir(paths.releaseRoot)).filter(name => name.includes('.partial-')), [])
})

test('generated sidecar config is loopback-only and disables retries, rotation, plugins, and management', () => {
  const config = renderCliProxyConfig({
    authDir: '/tmp/helix auth',
    apiKey: 'local-token',
    port: 18317,
    forceModelPrefix: true,
    routes: [{
      name: 'azure-foundry',
      prefix: 'azure',
      baseUrl: 'http://127.0.0.1:18320/v1',
      apiKey: 'route-token',
      models: ['deployment'],
    }, {
      name: 'github-copilot',
      prefix: 'copilot',
      baseUrl: 'http://127.0.0.1:18319/v1',
      apiKey: 'copilot-route-token',
      models: [{ id: 'gpt-5.4', efforts: ['low', 'high', 'xhigh'] }],
      transport: 'responses',
    }],
  })
  for (const contract of [
    'host: "127.0.0.1"',
    'secret-key: ""',
    'disable-control-panel: true',
    'plugins:\n  enabled: false',
    'request-retry: 0',
    'max-retry-credentials: 1',
    'disable-cooling: true',
    'switch-project: false',
    'switch-preview-model: false',
    'antigravity-credits: false',
    'identity-confuse: false',
    'force-model-prefix: true',
    'prefix: "azure"',
    'base-url: "http://127.0.0.1:18320/v1"',
    'force-mapping: true',
    'levels: ["low","medium","high"]',
    'codex-api-key:',
    'prefix: "copilot"',
    'websockets: false',
    'excluded-models:\n      - "gpt-image-1.5"\n      - "gpt-image-2"',
  ]) assert.match(config, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(config, /auth-dir: "\/tmp\/helix auth"/)
  assert.match(config, /- "local-token"/)
})

test('gateway environment clears conflicting providers and carries a bounded active-session receipt', () => {
  const env = claudeGatewayEnvironment({
    env: {
      KEEP: 'yes',
      CLAUDE_CODE_USE_FOUNDRY: '1',
      ANTHROPIC_FOUNDRY_RESOURCE: 'old',
      CLAUDE_CODE_SUBAGENT_MODEL: 'override',
      HELIX_CC_AZURE_API_KEY: 'must-not-pass',
      GH_TOKEN: 'must-not-pass',
    },
    baseUrl: 'http://127.0.0.1:18317',
    apiKey: 'token',
    claudeConfigDir: '/tmp/claude-proof',
    activeSession: {
      ownerPid: 4321,
      gatewayPid: 4322,
      providers: ['codex', 'copilot'],
      models: ['openai/gpt-5.6-luna', 'copilot/gpt-5.4'],
    },
  })
  assert.equal(env.KEEP, 'yes')
  assert.equal(env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:18317')
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, 'token')
  assert.equal(env.ANTHROPIC_API_KEY, '')
  assert.equal(env.CLAUDE_CONFIG_DIR, '/tmp/claude-proof')
  assert.equal(env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB, '1')
  assert.deepEqual(JSON.parse(env.HELIX_CC_ACTIVE_GATEWAY_SESSION), {
    version: 1,
    ownerPid: 4321,
    gatewayPid: 4322,
    providers: ['codex', 'copilot'],
    models: ['openai/gpt-5.6-luna', 'copilot/gpt-5.4'],
  })
  assert.equal(Object.hasOwn(env, 'CLAUDE_CODE_USE_FOUNDRY'), false)
  assert.equal(Object.hasOwn(env, 'ANTHROPIC_FOUNDRY_RESOURCE'), false)
  assert.equal(Object.hasOwn(env, 'CLAUDE_CODE_SUBAGENT_MODEL'), false)
  assert.equal(Object.hasOwn(env, 'HELIX_CC_AZURE_API_KEY'), false)
  assert.equal(Object.hasOwn(env, 'GH_TOKEN'), false)
  assert.throws(
    () => claudeGatewayEnvironment({ baseUrl: 'https://example.invalid', apiKey: 'token' }),
    /loopback/,
  )
  assert.throws(
    () => claudeGatewayEnvironment({
      baseUrl: 'http://127.0.0.1:18317',
      apiKey: 'token',
      activeSession: { ownerPid: 1, gatewayPid: 4322, providers: ['codex'], models: ['gpt-5.6-luna'] },
    }),
    /ownerPid/,
  )
})

test('sidecar and login subprocesses receive only operational environment values', () => {
  const env = sidecarProcessEnvironment({
    PATH: '/bin',
    HOME: '/home/test',
    HTTPS_PROXY: 'http://proxy.invalid',
    GH_TOKEN: 'must-not-pass',
    ANTHROPIC_AUTH_TOKEN: 'must-not-pass',
    OPENAI_API_KEY: 'must-not-pass',
  })
  assert.deepEqual(env, {
    HOME: '/home/test',
    HTTPS_PROXY: 'http://proxy.invalid',
    PATH: '/bin',
  })
})

test('login output removes account-derived filenames and one-time browser authorization URLs', () => {
  assert.equal(
    sanitizeCliProxyLoginLine('Saving credentials to /tmp/auth/codex-person@example.com-pro.json'),
    'Saving the Codex OAuth credential to the dedicated Helix CC auth directory.',
  )
  assert.equal(
    sanitizeCliProxyLoginLine('Authentication saved to C:\\auth\\codex-person@example.com-plus.json'),
    'The Codex OAuth credential was saved to the dedicated Helix CC auth directory.',
  )
  assert.equal(
    sanitizeCliProxyLoginLine('Attempting to open URL in browser: https://auth.openai.com/oauth/authorize?state=private'),
    'Opening OpenAI authorization page in browser.',
  )
  assert.equal(sanitizeCliProxyLoginLine('https://auth.openai.com/oauth/authorize?state=private'), '')
  assert.equal(sanitizeCliProxyLoginLine('account person@example.com'), 'account <account>')
})

test('loopback recognition and model probing fail closed', async () => {
  assert.equal(isLoopbackBaseUrl('http://127.0.0.1:8317'), true)
  assert.equal(isLoopbackBaseUrl('http://localhost:8317/'), false)
  assert.equal(isLoopbackBaseUrl('https://127.0.0.1:8317'), false)
  assert.equal(isLoopbackBaseUrl('http://127.0.0.1:8317/v1'), false)
  let called = false
  const remote = await probeCliProxyModels({
    baseUrl: 'https://proxy.example.invalid',
    apiKey: 'token',
    fetcher: async () => {
      called = true
      return new Response('{}')
    },
  })
  assert.equal(remote.state, 'non-loopback-refused')
  assert.equal(called, false)

  const valid = await probeCliProxyModels({
    baseUrl: 'http://127.0.0.1:18317',
    apiKey: 'token',
    fetcher: async () => new Response(JSON.stringify({
      data: [{ id: 'gpt-5.6-luna' }, { id: 'gpt-5.6-luna' }, { id: 'gpt-5.4-mini' }, { id: 12 }],
    })),
  })
  assert.deepEqual(valid, {
    verified: true,
    state: 'models-verified',
    models: ['gpt-5.4-mini', 'gpt-5.6-luna'],
  })
  const filtered = await probeCliProxyModels({
    baseUrl: 'http://127.0.0.1:18317',
    apiKey: 'token',
    modelFilter: entry => entry.kind === 'chat',
    fetcher: async () => new Response(JSON.stringify({
      data: [{ id: 'chat-model', kind: 'chat' }, { id: 'embedding-model', kind: 'embedding' }],
    })),
  })
  assert.deepEqual(filtered.models, ['chat-model'])
  const invalid = await probeCliProxyModels({
    baseUrl: 'http://127.0.0.1:18317',
    apiKey: 'token',
    fetcher: async () => new Response('{not-json'),
  })
  assert.equal(invalid.state, 'response-unparseable')
  const oversized = await probeCliProxyModels({
    baseUrl: 'http://127.0.0.1:18317',
    apiKey: 'token',
    fetcher: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)),
  })
  assert.equal(oversized.state, 'response-too-large')
})

test('dedicated auth inspection returns only provider class and count', async t => {
  const root = await mkdtemp(join(tmpdir(), 'helix-cc-cliproxy-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.deepEqual(await verifyCodexOnlyAuthDir(root), { verified: false, count: 0, state: 'missing' })
  await writeFile(join(root, 'codex-account-plus.json'), '{"type":"codex","access_token":"must-not-be-returned"}\n', { mode: 0o644 })
  assert.deepEqual(await verifyCodexOnlyAuthDir(root), { verified: true, count: 1, state: 'codex-only' })
  assert.deepEqual(await hardenCodexAuthFiles(root), { verified: true, count: 1, state: 'codex-only' })
  const { mode } = await stat(join(root, 'codex-account-plus.json'))
  assert.equal(mode & 0o777, 0o600)
  await writeFile(join(root, 'claude-account.json'), '{}\n')
  assert.deepEqual(await verifyCodexOnlyAuthDir(root), { verified: false, count: 2, state: 'mixed-providers' })
})

test('a Codex-looking filename with the wrong provider record fails closed', async t => {
  const root = await mkdtemp(join(tmpdir(), 'helix-cc-cliproxy-invalid-auth-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'codex-not-really.json'), '{"type":"claude"}\n')
  assert.deepEqual(await verifyCodexOnlyAuthDir(root), { verified: false, count: 1, state: 'invalid-record' })
})

test('Codex auth prefix reconciles mixed and single-provider runs without overwriting custom state', async t => {
  const root = await mkdtemp(join(tmpdir(), 'helix-cc-codex-prefix-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'codex-account.json')
  await writeFile(path, '{"type":"codex","access_token":"not-returned"}\n', { mode: 0o600 })
  await setCodexAuthPrefix(root, 'openai')
  assert.equal(JSON.parse(await readFile(path, 'utf8')).prefix, 'openai')
  await setCodexAuthPrefix(root, '')
  assert.equal(Object.hasOwn(JSON.parse(await readFile(path, 'utf8')), 'prefix'), false)
  await writeFile(path, '{"type":"codex","prefix":"operator-prefix"}\n', { mode: 0o600 })
  await assert.rejects(setCodexAuthPrefix(root, 'openai'), /conflicting model prefix/)
})

test('proof evidence requires a marker-bearing Workflow subagent transcript and extracts only model names', async t => {
  const root = await mkdtemp(join(tmpdir(), 'helix-cc-transcript-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workflow = join(root, 'project', 'session', 'subagents', 'workflows', 'wf_test')
  await mkdir(workflow, { recursive: true })
  await writeFile(join(workflow, 'agent-one.jsonl'), [
    JSON.stringify({ type: 'user', message: { content: 'marker-123' } }),
    JSON.stringify({ type: 'assistant', message: { model: 'gpt-5.6-luna', content: [] } }),
    '',
  ].join('\n'))
  await writeFile(join(workflow, 'journal.jsonl'), JSON.stringify({ marker: 'marker-123', model: 'fake-journal-model' }))
  const evidence = await extractResolvedModels(root, { marker: 'marker-123' })
  assert.deepEqual(evidence, { matchedTranscripts: 1, models: ['gpt-5.6-luna'] })
})

test('proof evidence waits for marker-first transcript model persistence before attesting the model', async t => {
  const root = await mkdtemp(join(tmpdir(), 'helix-cc-transcript-convergence-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workflow = join(root, 'project', 'session', 'subagents', 'workflows', 'wf_test')
  await mkdir(workflow, { recursive: true })
  const transcriptPath = join(workflow, 'agent-delayed.jsonl')
  await writeFile(transcriptPath, `${JSON.stringify({ type: 'user', message: { content: 'marker-delayed' } })}\n`)
  const pendingWrite = new Promise((resolve, reject) => {
    setTimeout(() => {
      appendFile(transcriptPath, `${JSON.stringify({ type: 'assistant', message: { model: 'gpt-5.6-luna', content: [] } })}\n`).then(resolve, reject)
    }, 50)
  })
  const evidence = await waitForResolvedModels(root, {
    marker: 'marker-delayed',
    expectedTranscripts: 1,
    expectedModels: ['gpt-5.6-luna'],
    timeoutMs: 1000,
    pollMs: 10,
  })
  await pendingWrite
  assert.deepEqual(evidence, { matchedTranscripts: 1, models: ['gpt-5.6-luna'] })
})

test('proof evidence waits through a partially written assistant record', async t => {
  const root = await mkdtemp(join(tmpdir(), 'helix-cc-transcript-partial-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workflow = join(root, 'project', 'session', 'subagents', 'workflows', 'wf_test')
  await mkdir(workflow, { recursive: true })
  const transcriptPath = join(workflow, 'agent-partial.jsonl')
  await writeFile(transcriptPath, `${JSON.stringify({ type: 'user', message: { content: 'marker-partial' } })}\n{"type":"assistant","message":{"model":"gpt`)
  const pendingWrite = new Promise((resolve, reject) => {
    setTimeout(() => appendFile(transcriptPath, '-5.6-luna","content":[]}}\n').then(resolve, reject), 50)
  })
  const evidence = await waitForResolvedModels(root, {
    marker: 'marker-partial',
    expectedTranscripts: 1,
    expectedModels: ['gpt-5.6-luna'],
    timeoutMs: 1000,
    pollMs: 10,
  })
  await pendingWrite
  assert.deepEqual(evidence, { matchedTranscripts: 1, models: ['gpt-5.6-luna'] })
})

test('proof evidence waits for every model in a staggered matrix', async t => {
  const root = await mkdtemp(join(tmpdir(), 'helix-cc-transcript-matrix-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workflow = join(root, 'project', 'session', 'subagents', 'workflows', 'wf_test')
  await mkdir(workflow, { recursive: true })
  await writeFile(join(workflow, 'agent-openai.jsonl'), [
    JSON.stringify({ type: 'user', message: { content: 'marker-matrix' } }),
    JSON.stringify({ type: 'assistant', message: { model: 'gpt-5.6-luna', content: [] } }),
    '',
  ].join('\n'))
  const copilotPath = join(workflow, 'agent-copilot.jsonl')
  await writeFile(copilotPath, `${JSON.stringify({ type: 'user', message: { content: 'marker-matrix' } })}\n`)
  const pendingWrite = new Promise((resolve, reject) => {
    setTimeout(() => appendFile(copilotPath, `${JSON.stringify({ type: 'assistant', message: { model: 'gpt-5.4', content: [] } })}\n`).then(resolve, reject), 50)
  })
  const evidence = await waitForResolvedModels(root, {
    marker: 'marker-matrix',
    expectedTranscripts: 2,
    expectedModels: ['gpt-5.4', 'gpt-5.6-luna'],
    timeoutMs: 1000,
    pollMs: 10,
  })
  await pendingWrite
  assert.deepEqual(evidence, { matchedTranscripts: 2, models: ['gpt-5.4', 'gpt-5.6-luna'] })
})

test('proof evidence refuses an unexpected resolved model', async t => {
  const root = await mkdtemp(join(tmpdir(), 'helix-cc-transcript-unexpected-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workflow = join(root, 'project', 'session', 'subagents', 'workflows', 'wf_test')
  await mkdir(workflow, { recursive: true })
  await writeFile(join(workflow, 'agent-one.jsonl'), [
    JSON.stringify({ type: 'user', message: { content: 'marker-unexpected' } }),
    JSON.stringify({ type: 'assistant', message: { model: 'gpt-5.6-luna', content: [] } }),
    JSON.stringify({ type: 'assistant', message: { model: 'unexpected-model', content: [] } }),
    '',
  ].join('\n'))
  const evidence = await waitForResolvedModels(root, {
    marker: 'marker-unexpected',
    expectedTranscripts: 1,
    expectedModels: ['gpt-5.6-luna'],
    timeoutMs: 20,
    pollMs: 5,
  })
  assert.deepEqual(evidence, { matchedTranscripts: 1, models: ['gpt-5.6-luna', 'unexpected-model'] })
  assert.equal(resolvedModelsExactlyMatch(evidence.models, ['gpt-5.6-luna']), false)
})

test('proof transcript convergence remains bounded and interruptible before exact equality', async t => {
  const root = await mkdtemp(join(tmpdir(), 'helix-cc-transcript-bound-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workflow = join(root, 'project', 'session', 'subagents', 'workflows', 'wf_test')
  await mkdir(workflow, { recursive: true })
  await writeFile(join(workflow, 'agent-one.jsonl'), `${JSON.stringify({ type: 'user', message: { content: 'marker-bound' } })}\n`)
  const timedOut = await waitForResolvedModels(root, {
    marker: 'marker-bound',
    expectedTranscripts: 1,
    expectedModels: ['gpt-5.6-luna'],
    timeoutMs: 20,
    pollMs: 5,
  })
  assert.deepEqual(timedOut, { matchedTranscripts: 1, models: [] })
  let checks = 0
  await assert.rejects(waitForResolvedModels(root, {
    marker: 'marker-bound',
    expectedTranscripts: 1,
    expectedModels: ['gpt-5.6-luna'],
    timeoutMs: 1000,
    pollMs: 5,
    assertActive: () => { if (++checks === 2) throw new Error('interrupted') },
  }), /interrupted/)
})

test('provider prefixes are route selectors while transcripts retain upstream model identity', () => {
  assert.equal(expectedTranscriptModel('gpt-5.6-luna'), 'gpt-5.6-luna')
  assert.equal(expectedTranscriptModel('openai/gpt-5.6-luna'), 'gpt-5.6-luna')
  assert.equal(expectedTranscriptModel('copilot/gpt-5-mini'), 'gpt-5-mini')
  assert.equal(expectedTranscriptModel('azure/deployment'), 'deployment')
  assert.throws(() => expectedTranscriptModel('copilot/'), /non-empty/)
})

test('state paths are configurable without embedding a machine-specific home path', () => {
  const paths = resolveCliProxyPaths({
    env: { HELIX_CC_CLIPROXY_DIR: '/tmp/helix-state', HELIX_CC_CLIPROXY_PORT: '19000' },
    home: '/home/ignored',
    platform: 'linux',
    arch: 'x64',
  })
  assert.equal(paths.stateRoot, '/tmp/helix-state')
  assert.equal(paths.baseUrl, 'http://127.0.0.1:19000')
  assert.equal(paths.binaryPath, '/tmp/helix-state/v7.2.80/bin/cli-proxy-api')
  assert.throws(
    () => resolveCliProxyPaths({ env: { HELIX_CC_CLIPROXY_PORT: '80' }, platform: 'linux', arch: 'x64' }),
    /1024 through 65535/,
  )
  assert.throws(
    () => resolveCliProxyPaths({ env: { HELIX_CC_CLIPROXY_DIR: '.local-state' }, platform: 'linux', arch: 'x64' }),
    /absolute path/,
  )
})

test('status inspection never creates or rewrites gateway state', async t => {
  const root = await mkdtemp(join(tmpdir(), 'helix-cc-inspect-state-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const paths = resolveCliProxyPaths({
    env: { HELIX_CC_CLIPROXY_DIR: root },
    platform: 'linux',
    arch: 'x64',
  })
  const missing = await inspectCliProxyState({ paths })
  assert.equal(missing.configured, false)
  assert.deepEqual(await readdir(root), [])
  await writeFile(paths.clientTokenPath, 'existing-token\n')
  const present = await inspectCliProxyState({ paths })
  assert.equal(present.configured, true)
  assert.equal(present.apiKey, 'existing-token')
  assert.deepEqual(await readdir(root), ['client-token'])
})

test('base state preparation can preserve an existing runtime config', async t => {
  const root = await mkdtemp(join(tmpdir(), 'helix-cc-preserve-config-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const paths = resolveCliProxyPaths({
    env: { HELIX_CC_CLIPROXY_DIR: root },
    platform: 'linux',
    arch: 'x64',
  })
  await mkdir(root, { recursive: true })
  await writeFile(paths.configPath, 'existing-runtime-config\n')
  const { ensureCliProxyState } = await import('../lib/cliproxy.mjs')
  await ensureCliProxyState({ paths, writeConfig: false })
  assert.equal(await readFile(paths.configPath, 'utf8'), 'existing-runtime-config\n')
})
