import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MINIMUM_CLAUDE_WORKFLOW_VERSION,
  classifyClaudeAuth,
  classifyCodexAuth,
  collectDoctor,
  formatDoctor,
  versionAtLeast,
} from '../lib/doctor.mjs'

const missingSettings = () => {
  const error = new Error('not found')
  error.code = 'ENOENT'
  throw error
}

test('classifyClaudeAuth drops account identifiers and keeps only a safe status class', () => {
  const accountIdentifier = 'private-account@example.invalid'
  const result = classifyClaudeAuth({
    status: 0,
    stdout: JSON.stringify({
      loggedIn: true,
      authMethod: 'claude.ai',
      apiProvider: 'firstParty',
      email: accountIdentifier,
      orgId: 'private-org-id',
    }),
  })
  assert.deepEqual(result, { verified: true, method: 'claude-subscription' })
  assert.equal(JSON.stringify(result).includes(accountIdentifier), false)
})

test('classifyCodexAuth distinguishes subscription from API credentials without returning raw output', () => {
  assert.deepEqual(classifyCodexAuth({ status: 0, stdout: 'Logged in using ChatGPT\n' }), {
    verified: true,
    method: 'chatgpt-subscription',
  })
  assert.deepEqual(classifyCodexAuth({ status: 0, stdout: 'Logged in using an API key\n' }), {
    verified: true,
    method: 'openai-api-key',
  })
})

test('versionAtLeast compares all semantic version components', () => {
  assert.equal(versionAtLeast('pi 0.80.3', '0.80.6'), false)
  assert.equal(versionAtLeast('pi 0.80.6', '0.80.6'), true)
  assert.equal(versionAtLeast('pi 0.81.0', '0.80.6'), true)
  assert.equal(versionAtLeast('unknown', '0.80.6'), false)
})

test('collectDoctor reports only credential presence and classifies execution paths', async () => {
  const secret = 'do-not-leak-this-value'
  const outputs = new Map([
    ['claude --version', { status: 0, stdout: '2.1.210\n' }],
    ['claude auth status', {
      status: 0,
      stdout: '{"loggedIn":true,"authMethod":"claude.ai","email":"private-account@example.invalid"}\n',
    }],
    ['codex --version', { status: 0, stdout: 'codex-cli 0.144.4\n' }],
    ['codex login status', { status: 0, stdout: 'Logged in using ChatGPT\n' }],
    ['pi --version', { status: 0, stdout: '0.80.3\n' }],
    ['copilot --version', { error: { code: 'ENOENT' } }],
    ['az version --output json', { status: 0, stdout: '{"azure-cli":"2.80.0"}\n' }],
    ['az account show --output none', { status: 0, stdout: '' }],
  ])
  const runner = (command, args) => outputs.get(`${command} ${args.join(' ')}`) || { error: { code: 'ENOENT' } }
  const report = await collectDoctor({
    env: {
      OPENROUTER_API_KEY: secret,
      ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
      ANTHROPIC_AUTH_TOKEN: secret,
      ANTHROPIC_API_KEY: '',
      CLAUDE_CODE_USE_FOUNDRY: '1',
      ANTHROPIC_FOUNDRY_RESOURCE: secret,
    },
    runner,
    readFile: missingSettings,
  })

  assert.equal(report.paths.codexPeer.ready, true)
  assert.equal(report.paths.nativeClaudeWorkflow.ready, false)
  assert.equal(report.paths.nativeClaudeWorkflow.locallyReady, true)
  assert.equal(report.paths.nativeClaudeWorkflow.state, 'local-preconditions-verified-policy-unverified')
  assert.equal(report.paths.nativeClaudeWorkflow.versionCompatible, true)
  assert.equal(report.paths.nativeClaudeWorkflow.subagentModelOverridePresent, false)
  assert.equal(report.paths.openRouterClaudeGateway.ready, false)
  assert.equal(report.paths.openRouterClaudeGateway.state, 'configured-credential-unverified')
  assert.equal(report.paths.microsoftFoundryClaude.ready, false)
  assert.equal(report.paths.microsoftFoundryClaude.locallyReady, true)
  assert.equal(report.paths.microsoftFoundryClaude.state, 'verified-azure-cli-session')
  assert.equal(report.paths.githubCopilotPeer.ready, false)
  assert.equal(report.paths.githubCopilotNativeWorkflow.ready, false)
  assert.equal(report.paths.microsoftFoundryGptGateway.ready, false)
  assert.equal(report.paths.piProviderBridge.dynamicWorkflowsPeerCompatible, false)
  assert.equal(JSON.stringify(report).includes(secret), false)
  assert.equal(formatDoctor(report).includes(secret), false)
  assert.equal(formatDoctor(report).includes('private-account@example.invalid'), false)
})

test('native workflow local prerequisites fail closed on old versions and disablement while reporting override signals', async () => {
  const outputs = new Map([
    ['claude --version', { status: 0, stdout: '2.1.100\n' }],
    ['claude auth status', { status: 0, stdout: '{"loggedIn":true,"authMethod":"claude.ai"}\n' }],
  ])
  const runner = (command, args) => outputs.get(`${command} ${args.join(' ')}`) || { error: { code: 'ENOENT' } }
  const old = await collectDoctor({ env: {}, runner, readFile: missingSettings })
  assert.equal(old.paths.nativeClaudeWorkflow.ready, false)
  assert.equal(old.paths.nativeClaudeWorkflow.locallyReady, false)
  assert.equal(old.paths.nativeClaudeWorkflow.state, 'incompatible-version')
  assert.equal(old.paths.nativeClaudeWorkflow.minimumVersion, MINIMUM_CLAUDE_WORKFLOW_VERSION)

  outputs.set('claude --version', { status: 0, stdout: `${MINIMUM_CLAUDE_WORKFLOW_VERSION}\n` })
  const disabled = await collectDoctor({
    env: {
      CLAUDE_CODE_DISABLE_WORKFLOWS: '1',
      CLAUDE_CODE_SUBAGENT_MODEL: 'policy-selected-model',
    },
    runner,
    readFile: missingSettings,
  })
  assert.equal(disabled.paths.nativeClaudeWorkflow.ready, false)
  assert.equal(disabled.paths.nativeClaudeWorkflow.locallyReady, false)
  assert.equal(disabled.paths.nativeClaudeWorkflow.state, 'disabled-by-environment')
  assert.equal(disabled.paths.nativeClaudeWorkflow.subagentModelOverridePresent, true)
  assert.equal(JSON.stringify(disabled).includes('policy-selected-model'), false)
})

test('native workflow local preconditions honor readable settings and fail closed on unreadable settings', async () => {
  const outputs = new Map([
    ['claude --version', { status: 0, stdout: `${MINIMUM_CLAUDE_WORKFLOW_VERSION}\n` }],
    ['claude auth status', { status: 0, stdout: '{"loggedIn":true,"authMethod":"claude.ai"}\n' }],
  ])
  const runner = (command, args) => outputs.get(`${command} ${args.join(' ')}`) || { error: { code: 'ENOENT' } }
  const disabledBySettings = await collectDoctor({
    env: {},
    runner,
    cwd: '/workspace',
    home: '/home/test',
    platform: 'linux',
    readFile(path) {
      if (path === '/workspace/.claude/settings.local.json') {
        return JSON.stringify({ disableWorkflows: true })
      }
      return missingSettings()
    },
  })
  assert.equal(disabledBySettings.paths.nativeClaudeWorkflow.locallyReady, false)
  assert.equal(disabledBySettings.paths.nativeClaudeWorkflow.state, 'disabled-by-settings')
  assert.equal(disabledBySettings.paths.nativeClaudeWorkflow.disabledBySettings, true)

  const unreadable = await collectDoctor({
    env: {},
    runner,
    cwd: '/workspace',
    home: '/home/test',
    platform: 'linux',
    readFile(path) {
      if (path === '/workspace/.claude/settings.json') throw new SyntaxError('invalid JSON')
      return missingSettings()
    },
  })
  assert.equal(unreadable.paths.nativeClaudeWorkflow.locallyReady, false)
  assert.equal(unreadable.paths.nativeClaudeWorkflow.state, 'settings-unreadable')
  assert.equal(unreadable.paths.nativeClaudeWorkflow.settingsInspectionComplete, false)
})

test('CLIProxyAPI readiness uses an authenticated loopback catalog without requiring Claude subscription auth', async () => {
  const secret = 'local-proxy-token-that-must-not-be-returned'
  const outputs = new Map([
    ['claude --version', { status: 0, stdout: `${MINIMUM_CLAUDE_WORKFLOW_VERSION}\n` }],
    ['claude auth status', { status: 1, stdout: '{"loggedIn":false}\n' }],
  ])
  const runner = (command, args) => outputs.get(`${command} ${args.join(' ')}`) || { error: { code: 'ENOENT' } }
  let authorization
  const report = await collectDoctor({
    env: {
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:18317',
      ANTHROPIC_AUTH_TOKEN: secret,
      ANTHROPIC_API_KEY: '',
    },
    runner,
    readFile: missingSettings,
    fetcher: async (_url, options) => {
      authorization = options.headers.Authorization
      return new Response(JSON.stringify({ data: [{ id: 'gpt-5.6-luna' }, { id: 'gpt-5.4-mini' }] }))
    },
  })

  assert.equal(authorization, `Bearer ${secret}`)
  assert.equal(report.paths.nativeClaudeWorkflow.locallyReady, false)
  assert.equal(report.paths.cliProxyNativeWorkflow.ready, false)
  assert.equal(report.paths.cliProxyNativeWorkflow.locallyReady, true)
  assert.equal(report.paths.cliProxyNativeWorkflow.state, 'models-verified-workflow-unverified')
  assert.deepEqual(report.paths.cliProxyNativeWorkflow.models, ['gpt-5.4-mini', 'gpt-5.6-luna'])
  assert.equal(JSON.stringify(report).includes(secret), false)
  assert.equal(formatDoctor(report).includes(secret), false)
})

test('doctor accepts a live wrapper preflight after Claude scrubs direct gateway values', async () => {
  const outputs = new Map([
    ['claude --version', { status: 0, stdout: `${MINIMUM_CLAUDE_WORKFLOW_VERSION}\n` }],
    ['claude auth status', { status: 1, stdout: '{"loggedIn":false}\n' }],
  ])
  const runner = (command, args) => outputs.get(`${command} ${args.join(' ')}`) || { error: { code: 'ENOENT' } }
  const env = {
    ANTHROPIC_API_KEY: '',
    HELIX_CC_ACTIVE_GATEWAY_SESSION: JSON.stringify({
      version: 1,
      ownerPid: 4321,
      gatewayPid: 4322,
      providers: ['codex', 'copilot'],
      models: ['openai/gpt-5.6-luna', 'copilot/gpt-5.4'],
    }),
  }
  const report = await collectDoctor({
    env,
    runner,
    readFile: missingSettings,
    processAlive: pid => [4321, 4322].includes(pid),
  })

  assert.equal(report.paths.nativeClaudeWorkflow.locallyReady, false)
  assert.equal(report.paths.cliProxyNativeWorkflow.locallyReady, true)
  assert.equal(report.paths.cliProxyNativeWorkflow.state, 'wrapper-preflight-verified-workflow-unverified')
  assert.equal(report.paths.cliProxyNativeWorkflow.catalogSource, 'active-wrapper-session')
  assert.deepEqual(report.paths.cliProxyNativeWorkflow.providers, ['codex', 'copilot'])
  assert.deepEqual(report.paths.cliProxyNativeWorkflow.models, ['openai/gpt-5.6-luna', 'copilot/gpt-5.4'])
  assert.equal(report.paths.cliProxyNativeWorkflow.credentialPresent, false)

  const stale = await collectDoctor({
    env,
    runner,
    readFile: missingSettings,
    processAlive: () => false,
  })
  assert.equal(stale.paths.cliProxyNativeWorkflow.locallyReady, false)
  assert.equal(stale.paths.cliProxyNativeWorkflow.state, 'active-session-owner-not-running')
})
