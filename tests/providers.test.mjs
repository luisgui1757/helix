import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { resolveCliProxyPaths } from '../lib/cliproxy.mjs'
import {
  COPILOT_API_RELEASE,
  discoverCopilotServedModel,
  ensureCopilotState,
  hardenCopilotCredential,
  isCopilotResponsesModel,
  probeCopilotCatalog,
  readCopilotPins,
  resolveCopilotPaths,
  sanitizeCopilotLoginLine,
  verifyCopilotApiInstallation,
  verifyCopilotCredential,
  writeCopilotPin,
} from '../lib/copilot.mjs'
import { patchCopilotApiStartSource } from '../lib/copilot-loopback-loader.mjs'
import { ensureAzureState, parseProviderList, validateProviderModel } from '../lib/providers.mjs'

test('provider selection is explicit, unique, and closed', () => {
  assert.deepEqual(parseProviderList(), ['codex'])
  assert.deepEqual(parseProviderList('copilot,azure,codex'), ['copilot', 'azure', 'codex'])
  assert.throws(() => parseProviderList('copilot,copilot'), /unique/)
  assert.throws(() => parseProviderList('openrouter'), /unsupported provider/)
})

test('provider-backed controllers are explicit and belong to the selected route set', () => {
  assert.equal(validateProviderModel(['codex'], 'gpt-5.6-luna'), 'gpt-5.6-luna')
  assert.equal(validateProviderModel(['copilot'], 'copilot/gpt-5.4'), 'copilot/gpt-5.4')
  assert.equal(validateProviderModel(['codex', 'copilot'], 'openai/gpt-5.6-luna'), 'openai/gpt-5.6-luna')
  assert.throws(() => validateProviderModel(['copilot'], 'gpt-5.4'), /provider-prefixed/)
  assert.throws(() => validateProviderModel(['codex'], 'openai/gpt-5.6-luna'), /unprefixed/)
  assert.throws(() => validateProviderModel(['codex', 'copilot'], 'azure/deployment'), /does not belong/)
})

test('Copilot routing exposes only tool-capable low-effort Responses chat models', () => {
  assert.equal(isCopilotResponsesModel({ model_picker_enabled: false, capabilities: { type: 'chat' } }), false)
  assert.equal(isCopilotResponsesModel({ model_picker_enabled: true, capabilities: { type: 'embeddings' } }), false)
  assert.equal(isCopilotResponsesModel({
    model_picker_enabled: true,
    capabilities: { type: 'chat', supports: { tool_calls: false, reasoning_effort: ['low'] } },
    supported_endpoints: ['/responses'],
  }), false)
  assert.equal(isCopilotResponsesModel({
    model_picker_enabled: true,
    capabilities: { type: 'chat', supports: { tool_calls: true, reasoning_effort: ['high'] } },
    supported_endpoints: ['/responses'],
  }), false)
  assert.equal(isCopilotResponsesModel({
    model_picker_enabled: true,
    capabilities: { type: 'chat', supports: { tool_calls: true, reasoning_effort: ['low'] } },
    supported_endpoints: ['/responses'],
  }), true)
  assert.equal(isCopilotResponsesModel({
    model_picker_enabled: true,
    capabilities: { type: 'chat', supports: { tool_calls: true, reasoning_effort: ['low'] } },
    supported_endpoints: ['/v1/embeddings'],
  }), false)
})

test('Copilot capability probe returns only eligible Responses models with bounded effort metadata', async () => {
  const result = await probeCopilotCatalog({
    baseUrl: 'http://127.0.0.1:18318',
    apiKey: 'token',
    fetcher: async () => new Response(JSON.stringify({ data: [
      {
        id: 'gpt-responses',
        model_picker_enabled: true,
        supported_endpoints: ['/responses'],
        capabilities: { type: 'chat', supports: { tool_calls: true, reasoning_effort: ['low', 'high', 'future-value'] } },
      },
      {
        id: 'gpt-chat-only',
        model_picker_enabled: true,
        supported_endpoints: ['/chat/completions'],
        capabilities: { type: 'chat', supports: { tool_calls: true, reasoning_effort: ['low'] } },
      },
    ] })),
  })
  assert.deepEqual(result, {
    verified: true,
    state: 'models-verified',
    models: [{ id: 'gpt-responses', efforts: ['low', 'high'] }],
  })
})

test('the pinned Copilot API package and loopback patch target are exact', async () => {
  const installation = await verifyCopilotApiInstallation()
  assert.equal(installation.version, COPILOT_API_RELEASE.version)
  const source = await readFile(installation.startPath, 'utf8')
  const patched = patchCopilotApiStartSource(source)
  assert.match(patched, /hostname: "127\.0\.0\.1"/)
  assert.throws(() => patchCopilotApiStartSource(`${source}\n// drift`), /does not match/)
})

test('Copilot launcher accepts api-home only as a single global option token', () => {
  const launcher = fileURLToPath(new URL('../bin/helix-cc-copilot-api', import.meta.url))
  const result = spawnSync(process.execPath, [launcher, '--api-home=/tmp/state with spaces', 'start', '--help'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /Start the Copilot API server/)
  assert.doesNotMatch(result.stderr, /Unknown command/)
})

test('Copilot launcher accepts provider only as a single auth option token', () => {
  const launcher = fileURLToPath(new URL('../bin/helix-cc-copilot-api', import.meta.url))
  const result = spawnSync(process.execPath, [launcher, '--api-home=/tmp/provider-help', 'auth', '--provider=copilot', '--help'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /Run authentication flows/)
  assert.doesNotMatch(result.stderr, /Unknown command/)
})

test('Copilot state is provider-isolated and credentials are only classified', async t => {
  const root = await mkdtemp(join(tmpdir(), 'helix-cc-copilot-state-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const paths = resolveCliProxyPaths({
    env: { HELIX_CC_CLIPROXY_DIR: root },
    platform: 'darwin',
    arch: 'arm64',
  })
  const copilot = await ensureCopilotState(paths)
  assert.deepEqual(await verifyCopilotCredential(copilot), { verified: false, state: 'missing', count: 0 })
  await writeFile(copilot.githubTokenPath, 'credential-value-not-returned\n', { mode: 0o644 })
  assert.deepEqual(await verifyCopilotCredential(copilot), { verified: false, state: 'invalid-permissions', count: 0 })
  assert.equal((await stat(copilot.githubTokenPath)).mode & 0o777, 0o644)
  assert.deepEqual(await hardenCopilotCredential(copilot), { verified: true, state: 'github-copilot-only', count: 1 })
  assert.deepEqual(await verifyCopilotCredential(copilot), { verified: true, state: 'github-copilot-only', count: 1 })
  assert.equal((await stat(copilot.githubTokenPath)).mode & 0o777, 0o600)
  const config = JSON.parse(await readFile(copilot.configPath, 'utf8'))
  assert.deepEqual(config.providers, {})
  assert.equal(config.auth.apiKeys.length, 1)
  assert.equal(config.useResponsesApiWebSocket, false)
  assert.equal(resolveCopilotPaths(paths).backendBaseUrl, 'http://127.0.0.1:18318')
  assert.equal(resolveCopilotPaths(paths, { HELIX_CC_COPILOT_BACKEND_PORT: '19318' }).backendPort, 19318)
  assert.deepEqual(await readCopilotPins(copilot), {})
})

test('Copilot served-model discovery accepts only exact or dated snapshot identities', async t => {
  const root = await mkdtemp(join(tmpdir(), 'helix-cc-copilot-pins-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const paths = resolveCliProxyPaths({
    env: { HELIX_CC_CLIPROXY_DIR: root },
    platform: 'linux',
    arch: 'x64',
  })
  const copilot = await ensureCopilotState(paths)
  let requestBody
  const discovered = await discoverCopilotServedModel({
    baseUrl: 'http://127.0.0.1:18318',
    apiKey: 'local-token',
    model: 'gpt-5.4',
    fetcher: async (_url, init) => {
      requestBody = JSON.parse(init.body)
      return new Response(JSON.stringify({ model: 'gpt-5.4-2026-03-05', output: [] }))
    },
  })
  assert.equal(requestBody.model, 'gpt-5.4')
  assert.equal(requestBody.reasoning.effort, 'low')
  assert.deepEqual(discovered, { requestedModel: 'gpt-5.4', servedModel: 'gpt-5.4-2026-03-05' })
  await writeCopilotPin(copilot, discovered.requestedModel, discovered.servedModel)
  assert.deepEqual(await readCopilotPins(copilot), { 'gpt-5.4': 'gpt-5.4-2026-03-05' })
  await assert.rejects(
    writeCopilotPin(copilot, 'gpt-5.4', 'different-model'),
    /neither the requested ID nor its dated snapshot/,
  )
})

test('Copilot state refuses configured third-party providers', async t => {
  const root = await mkdtemp(join(tmpdir(), 'helix-cc-copilot-mixed-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const paths = resolveCliProxyPaths({
    env: { HELIX_CC_CLIPROXY_DIR: root },
    platform: 'linux',
    arch: 'x64',
  })
  const copilot = await ensureCopilotState(paths)
  await writeFile(copilot.configPath, JSON.stringify({ providers: { custom: { enabled: true } } }))
  await assert.rejects(ensureCopilotState(paths), /third-party providers/)
})

test('Copilot login output removes identity and credential paths', () => {
  assert.equal(sanitizeCopilotLoginLine('Logged in as private-user'), 'GitHub Copilot authentication succeeded.')
  assert.equal(
    sanitizeCopilotLoginLine('GitHub token written to /private/state/github_token'),
    'The GitHub Copilot credential was saved to the dedicated Helix CC state directory.',
  )
  assert.equal(sanitizeCopilotLoginLine('GitHub token: secret'), '')
})

test('Azure state requires endpoint and deployment-to-served-model attestation mapping', async t => {
  const root = await mkdtemp(join(tmpdir(), 'helix-cc-azure-state-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const paths = resolveCliProxyPaths({
    env: { HELIX_CC_CLIPROXY_DIR: root },
    platform: 'linux',
    arch: 'x64',
  })
  const state = await ensureAzureState(paths, {
    HELIX_CC_AZURE_ENDPOINT: 'https://example.services.ai.azure.com/openai/v1',
    HELIX_CC_AZURE_MODELS: '{"deployment":"gpt-snapshot"}',
    HELIX_CC_AZURE_API_KEY: 'presence-only',
  })
  assert.equal(state.authMode, 'azure-api-key')
  assert.deepEqual(state.expectedModels, { deployment: 'gpt-snapshot' })
  assert.deepEqual(state.routeModels, [{ id: 'deployment', efforts: ['low', 'medium', 'high'] }])
  const config = JSON.parse(await readFile(state.configPath, 'utf8'))
  assert.equal(Object.hasOwn(config, 'apiKey'), false)
  await assert.rejects(ensureAzureState(paths, {
    HELIX_CC_AZURE_ENDPOINT: 'https://example.services.ai.azure.com/openai/v1',
    HELIX_CC_AZURE_MODELS: '{}',
  }), /1 through 128/)
  const xhigh = await ensureAzureState(paths, {
    HELIX_CC_AZURE_ENDPOINT: 'https://example.services.ai.azure.com/openai/v1',
    HELIX_CC_AZURE_MODELS: '{"deployment":{"servedModel":"gpt-snapshot","efforts":["low","high","xhigh"]}}',
  })
  assert.deepEqual(xhigh.routeModels, [{ id: 'deployment', efforts: ['low', 'high', 'xhigh'] }])
})
