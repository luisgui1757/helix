import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { isLoopbackBaseUrl, probeCliProxyModels } from './cliproxy.mjs'

const TOOL_PROBES = [
  { name: 'claude', command: 'claude', args: ['--version'] },
  { name: 'codex', command: 'codex', args: ['--version'] },
  { name: 'pi', command: 'pi', args: ['--version'] },
  { name: 'copilot', command: 'copilot', args: ['--version'] },
  { name: 'az', command: 'az', args: ['version', '--output', 'json'] },
]

export const MINIMUM_CLAUDE_WORKFLOW_VERSION = '2.1.154'

function firstLine(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean)
}

function runProbe(command, args, runner) {
  const result = runner(command, args, {
    encoding: 'utf8',
    timeout: 5000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error?.code === 'ENOENT') return { installed: false }
  if (result.error) return { installed: true, ok: false, error: result.error.code || result.error.name || 'probe-error' }
  return {
    installed: true,
    ok: result.status === 0,
    version: result.status === 0 ? firstLine(result.stdout || result.stderr) : undefined,
    exitCode: result.status,
  }
}

export function classifyCodexAuth(result) {
  if (!result || result.error?.code === 'ENOENT') return { verified: false, method: 'unavailable' }
  const output = `${result.stdout || ''}\n${result.stderr || ''}`
  if (result.status !== 0) return { verified: false, method: 'not-authenticated' }
  if (/logged in using chatgpt/i.test(output)) return { verified: true, method: 'chatgpt-subscription' }
  if (/api key/i.test(output)) return { verified: true, method: 'openai-api-key' }
  if (/access token/i.test(output)) return { verified: true, method: 'codex-access-token' }
  return { verified: true, method: 'authenticated-unknown' }
}

export function classifyClaudeAuth(result) {
  if (!result || result.error?.code === 'ENOENT') return { verified: false, method: 'unavailable' }
  if (result.error || result.status !== 0) return { verified: false, method: 'not-authenticated' }
  let status
  try {
    status = JSON.parse(result.stdout || '')
  } catch {
    return { verified: false, method: 'status-unparseable' }
  }
  if (status?.loggedIn !== true) return { verified: false, method: 'not-authenticated' }
  if (status.authMethod === 'claude.ai') return { verified: true, method: 'claude-subscription' }
  if (status.authMethod === 'api_key') return { verified: true, method: 'anthropic-api-key' }
  return { verified: true, method: 'authenticated-unknown' }
}

function has(env, name) {
  return typeof env[name] === 'string' && env[name].length > 0
}

function defaultProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function activeGatewaySession(env, processAlive) {
  const source = env.HELIX_CC_ACTIVE_GATEWAY_SESSION
  if (typeof source !== 'string' || !source) return { present: false, verified: false, state: 'absent', providers: [], models: [] }
  let value
  try {
    value = JSON.parse(source)
  } catch {
    return { present: true, verified: false, state: 'invalid-json', providers: [], models: [] }
  }
  const providers = Array.isArray(value?.providers) ? value.providers : []
  const models = Array.isArray(value?.models) ? value.models : []
  const valid = value?.version === 1
    && Number.isInteger(value?.ownerPid)
    && value.ownerPid >= 2
    && Number.isInteger(value?.gatewayPid)
    && value.gatewayPid >= 2
    && providers.length >= 1
    && providers.length <= 3
    && new Set(providers).size === providers.length
    && providers.every(provider => ['codex', 'copilot', 'azure'].includes(provider))
    && models.length >= 1
    && models.length <= 256
    && new Set(models).size === models.length
    && models.every(model => typeof model === 'string' && model.length >= 1 && model.length <= 256 && !/[\u0000-\u001f\u007f]/.test(model))
  if (!valid) return { present: true, verified: false, state: 'invalid-receipt', providers: [], models: [] }
  if (!processAlive(value.ownerPid)) return { present: true, verified: false, state: 'owner-not-running', providers: [], models: [] }
  if (!processAlive(value.gatewayPid)) return { present: true, verified: false, state: 'gateway-not-running', providers: [], models: [] }
  return { present: true, verified: true, state: 'active', providers, models }
}

function parseVersion(value) {
  const match = String(value || '').match(/\b(\d+)\.(\d+)\.(\d+)\b/)
  return match ? match.slice(1).map(Number) : undefined
}

export function versionAtLeast(value, floor) {
  const actual = parseVersion(value)
  const required = parseVersion(floor)
  if (!actual || !required) return false
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] > required[index]) return true
    if (actual[index] < required[index]) return false
  }
  return true
}

function readOptionalSettings(path, readFile) {
  try {
    const value = JSON.parse(readFile(path, 'utf8'))
    return { found: true, value }
  } catch (error) {
    if (error?.code === 'ENOENT') return { found: false }
    return { found: true, unreadable: true }
  }
}

function inspectWorkflowSettings({ env, cwd, home, platform, readFile }) {
  const configRoot = has(env, 'CLAUDE_CONFIG_DIR') ? env.CLAUDE_CONFIG_DIR : join(home, '.claude')
  const ordinaryPaths = [
    join(configRoot, 'settings.json'),
    join(cwd, '.claude', 'settings.json'),
    join(cwd, '.claude', 'settings.local.json'),
  ]
  const managedPath = platform === 'darwin'
    ? '/Library/Application Support/ClaudeCode/managed-settings.json'
    : platform === 'linux'
      ? '/etc/claude-code/managed-settings.json'
      : platform === 'win32'
        ? 'C:\\Program Files\\ClaudeCode\\managed-settings.json'
        : undefined
  let disabled
  let inspectionComplete = true

  for (const path of [...ordinaryPaths, ...(managedPath ? [managedPath] : [])]) {
    const settings = readOptionalSettings(path, readFile)
    if (settings.unreadable) {
      inspectionComplete = false
      continue
    }
    if (settings.found && typeof settings.value?.disableWorkflows === 'boolean') {
      disabled = settings.value.disableWorkflows
    }
  }

  return {
    disabled: disabled === true,
    inspectionComplete,
  }
}

export async function collectDoctor({
  env = process.env,
  runner = spawnSync,
  cwd = process.cwd(),
  home = homedir(),
  platform = process.platform,
  readFile = readFileSync,
  fetcher = fetch,
  processAlive = defaultProcessAlive,
} = {}) {
  const tools = Object.fromEntries(
    TOOL_PROBES.map(probe => [probe.name, runProbe(probe.command, probe.args, runner)]),
  )
  const codexAuth = tools.codex.installed
    ? classifyCodexAuth(
        runner('codex', ['login', 'status'], {
          encoding: 'utf8',
          timeout: 5000,
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      )
    : { verified: false, method: 'unavailable' }
  const claudeAuth = tools.claude.installed
    ? classifyClaudeAuth(
        runner('claude', ['auth', 'status'], {
          encoding: 'utf8',
          timeout: 5000,
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      )
    : { verified: false, method: 'unavailable' }

  const openRouterBase = env.ANTHROPIC_BASE_URL === 'https://openrouter.ai/api'
  const openRouterTokenPresent = has(env, 'ANTHROPIC_AUTH_TOKEN')
  const anthropicApiKeyExplicitlyEmpty = Object.hasOwn(env, 'ANTHROPIC_API_KEY') && env.ANTHROPIC_API_KEY === ''
  const openRouterConfigured = openRouterBase && openRouterTokenPresent && anthropicApiKeyExplicitlyEmpty
  const foundryEnabled = env.CLAUDE_CODE_USE_FOUNDRY === '1'
  const foundryResourceConfigured = has(env, 'ANTHROPIC_FOUNDRY_RESOURCE')
  const foundryApiKeyPresent = has(env, 'ANTHROPIC_FOUNDRY_API_KEY')
  const azureAccount = tools.az.installed && foundryEnabled && foundryResourceConfigured && !foundryApiKeyPresent
    ? runner('az', ['account', 'show', '--output', 'none'], {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    : undefined
  const azureAccountVerified = azureAccount?.status === 0
  const copilotTokenPresent = has(env, 'GITHUB_TOKEN') || has(env, 'GH_TOKEN') || has(env, 'COPILOT_GITHUB_TOKEN')
  const azureGptEndpointConfigured = has(env, 'HELIX_CC_AZURE_ENDPOINT')
  const azureGptModelsConfigured = has(env, 'HELIX_CC_AZURE_MODELS')
  const azureGptApiKeyPresent = has(env, 'HELIX_CC_AZURE_API_KEY')
  const piVersionCompatible = tools.pi.installed && versionAtLeast(tools.pi.version, '0.80.6')
  const claudeWorkflowVersionCompatible = tools.claude.installed
    && versionAtLeast(tools.claude.version, MINIMUM_CLAUDE_WORKFLOW_VERSION)
  const claudeWorkflowsDisabled = env.CLAUDE_CODE_DISABLE_WORKFLOWS === '1'
  const workflowSettings = inspectWorkflowSettings({ env, cwd, home, platform, readFile })
  const subagentModelOverridePresent = has(env, 'CLAUDE_CODE_SUBAGENT_MODEL')
  const workflowRuntimeLocallyReady = tools.claude.installed
    && claudeWorkflowVersionCompatible
    && !claudeWorkflowsDisabled
    && !workflowSettings.disabled
    && workflowSettings.inspectionComplete
  const nativeClaudeWorkflowLocallyReady = workflowRuntimeLocallyReady && claudeAuth.verified
  const nativeClaudeWorkflowState = !tools.claude.installed
    ? 'unavailable'
    : !claudeWorkflowVersionCompatible
      ? 'incompatible-version'
      : claudeWorkflowsDisabled
        ? 'disabled-by-environment'
        : !workflowSettings.inspectionComplete
          ? 'settings-unreadable'
          : workflowSettings.disabled
            ? 'disabled-by-settings'
            : !claudeAuth.verified
              ? 'authentication-unverified'
              : 'local-preconditions-verified-policy-unverified'
  const wrapperSession = activeGatewaySession(env, processAlive)
  const cliProxyLoopback = isLoopbackBaseUrl(env.ANTHROPIC_BASE_URL)
  const cliProxyDirectlyConfigured = cliProxyLoopback && openRouterTokenPresent && anthropicApiKeyExplicitlyEmpty
  const cliProxyConfigured = cliProxyDirectlyConfigured || wrapperSession.verified
  const cliProxyProbe = cliProxyDirectlyConfigured
    ? await probeCliProxyModels({
        baseUrl: env.ANTHROPIC_BASE_URL,
        apiKey: env.ANTHROPIC_AUTH_TOKEN,
        fetcher,
      })
    : wrapperSession.verified
      ? { verified: true, state: 'wrapper-preflight-verified', models: wrapperSession.models }
    : { verified: false, state: 'not-configured', models: [] }
  const cliProxyLocallyReady = workflowRuntimeLocallyReady && cliProxyConfigured && cliProxyProbe.verified
  const inferredCliProxyProviders = [
    ...(cliProxyProbe.models.some(model => model.startsWith('openai/')) ? ['codex'] : []),
    ...(cliProxyProbe.models.some(model => model.startsWith('copilot/')) ? ['copilot'] : []),
    ...(cliProxyProbe.models.some(model => model.startsWith('azure/')) ? ['azure'] : []),
  ]
  const cliProxyProviders = wrapperSession.verified ? wrapperSession.providers : inferredCliProxyProviders
  const cliProxyState = !tools.claude.installed
    ? 'unavailable'
    : !claudeWorkflowVersionCompatible
      ? 'incompatible-version'
      : claudeWorkflowsDisabled
        ? 'disabled-by-environment'
        : !workflowSettings.inspectionComplete
          ? 'settings-unreadable'
          : workflowSettings.disabled
            ? 'disabled-by-settings'
            : !cliProxyConfigured
              ? wrapperSession.present ? `active-session-${wrapperSession.state}` : 'not-configured'
              : !cliProxyProbe.verified
                ? cliProxyProbe.state
                : wrapperSession.verified
                  ? 'wrapper-preflight-verified-workflow-unverified'
                  : 'models-verified-workflow-unverified'

  return {
    generatedAt: new Date().toISOString(),
    tools,
    authentication: {
      claude: claudeAuth,
      codex: codexAuth,
      signals: {
        anthropicApiKey: has(env, 'ANTHROPIC_API_KEY'),
        anthropicApiKeyExplicitlyEmpty,
        anthropicAuthToken: has(env, 'ANTHROPIC_AUTH_TOKEN'),
        openRouterApiKey: has(env, 'OPENROUTER_API_KEY'),
        foundryApiKey: has(env, 'ANTHROPIC_FOUNDRY_API_KEY'),
        azureCliSessionVerified: azureAccountVerified,
        githubToken: copilotTokenPresent,
        azureGptApiKey: azureGptApiKeyPresent,
      },
    },
    paths: {
      nativeClaudeWorkflow: {
        ready: false,
        locallyReady: nativeClaudeWorkflowLocallyReady,
        state: nativeClaudeWorkflowState,
        minimumVersion: MINIMUM_CLAUDE_WORKFLOW_VERSION,
        versionCompatible: Boolean(claudeWorkflowVersionCompatible),
        disabledByEnvironment: claudeWorkflowsDisabled,
        disabledBySettings: workflowSettings.disabled,
        settingsInspectionComplete: workflowSettings.inspectionComplete,
        managedPolicyVerified: false,
        subagentModelOverridePresent,
        note: `Local executable, version, authentication, environment, and readable file-settings checks do not prove launch readiness. Active managed policy, service-delivered settings, plan eligibility, and effective model selection must be confirmed with Claude Code /status or an actual workflow launch. Role model values are requests and can be superseded by policy or CLAUDE_CODE_SUBAGENT_MODEL.${subagentModelOverridePresent ? ' A global subagent model override is present.' : ''}`,
      },
      cliProxyNativeWorkflow: {
        ready: false,
        locallyReady: cliProxyLocallyReady,
        state: cliProxyState,
        loopbackBaseUrl: cliProxyLoopback || wrapperSession.verified,
        credentialPresent: openRouterTokenPresent,
        anthropicApiKeyExplicitlyEmpty,
        modelCatalogVerified: cliProxyProbe.verified,
        catalogSource: wrapperSession.verified
          ? 'active-wrapper-session'
          : cliProxyDirectlyConfigured ? 'direct-catalog-probe' : 'none',
        models: cliProxyProbe.models,
        providers: cliProxyProviders,
        subagentModelOverridePresent,
        note: `CLIProxyAPI can translate Claude Code's Anthropic protocol while Claude Code retains the native Workflow scheduler, journals, subagent contexts, and tool loop. Local readiness requires either a direct authenticated catalog probe or a live wrapper receipt created after that probe; an actual Workflow launch is still required to prove the requested model and subscription route.${subagentModelOverridePresent ? ' A global subagent model override is present and supersedes every per-invocation workflow model.' : ''}`,
      },
      codexPeer: {
        ready: tools.codex.installed && codexAuth.verified,
        state: !tools.codex.installed ? 'unavailable' : codexAuth.verified ? 'verified' : 'authentication-unverified',
        authMethod: codexAuth.method,
        note: 'A peer worker; it does not replace the model behind workflow agent().',
      },
      openRouterClaudeGateway: {
        ready: false,
        state: !tools.claude.installed
          ? 'unavailable'
          : openRouterConfigured
            ? 'configured-credential-unverified'
            : 'not-configured',
        anthropicBaseUrlExact: openRouterBase,
        authTokenPresent: openRouterTokenPresent,
        anthropicApiKeyExplicitlyEmpty,
        note: 'Process-wide Anthropic-compatible gateway. OpenRouter guarantees Claude Code compatibility only for Anthropic first-party models.',
      },
      microsoftFoundryClaude: {
        ready: false,
        locallyReady: Boolean(
          tools.claude.installed &&
          foundryEnabled &&
          foundryResourceConfigured &&
          azureAccountVerified
        ),
        state: !tools.claude.installed
          ? 'unavailable'
          : foundryEnabled && foundryResourceConfigured && azureAccountVerified
            ? 'verified-azure-cli-session'
            : foundryEnabled && foundryResourceConfigured && foundryApiKeyPresent
              ? 'configured-credential-unverified'
              : 'not-configured',
        enabled: foundryEnabled,
        resourceConfigured: foundryResourceConfigured,
        note: 'Native Claude-on-Foundry backend, not an Azure OpenAI/GPT backend. A local Azure CLI session or present key is only a precondition; deployment policy and a real launch remain unverified.',
      },
      microsoftFoundryGptGateway: {
        ready: false,
        locallyConfigured: azureGptEndpointConfigured && azureGptModelsConfigured,
        state: !azureGptEndpointConfigured || !azureGptModelsConfigured
          ? 'not-configured'
          : azureGptApiKeyPresent
            ? 'api-key-configured-live-call-unverified'
            : tools.az.installed
              ? 'azure-cli-configured-live-call-unverified'
              : 'azure-cli-unavailable',
        authMode: azureGptApiKeyPresent ? 'api-key' : 'azure-cli-entra',
        note: 'Azure OpenAI-compatible Foundry route. Production proof requires an exact azure/<deployment> Workflow transcript and the local attestation proxy to match x-ms-served-model or the response model before forwarding output.',
      },
      githubCopilotNativeWorkflow: {
        ready: false,
        locallyReady: cliProxyLocallyReady && cliProxyProviders.includes('copilot'),
        state: !cliProxyConfigured
          ? 'not-configured'
          : !cliProxyProbe.verified
            ? cliProxyProbe.state
            : cliProxyProviders.includes('copilot')
              ? 'models-verified-workflow-unverified'
              : 'copilot-models-not-advertised',
        note: 'Third-party pinned Copilot API translation behind a loopback-only model-attesting boundary and CLIProxyAPI. A bounded Workflow proof is still required for each model; this is distinct from GitHub\'s official Copilot CLI/SDK peer runtime.',
      },
      githubCopilotPeer: {
        ready: false,
        state: !tools.copilot.installed
          ? 'unavailable'
          : copilotTokenPresent
            ? 'configured-credential-unverified'
            : 'authentication-unverified',
        authenticationVerified: false,
        piFallbackAvailable: tools.pi.installed,
        note: 'Official GitHub Copilot CLI/SDK peer path. It owns a separate agent session and does not replace the inference model behind Workflow agent().',
      },
      piProviderBridge: {
        ready: false,
        state: tools.pi.installed ? 'available-provider-unverified' : 'unavailable',
        dynamicWorkflowsPeerCompatible: Boolean(piVersionCompatible),
        requiredPiVersion: '0.80.6',
        note: 'Exact provider/model readiness still requires Pi ModelRegistry and auth inspection inside Pi.',
      },
    },
  }
}

export function formatDoctor(report) {
  const lines = ['Helix CC provider doctor', '']
  for (const [name, tool] of Object.entries(report.tools)) {
    lines.push(`${name}: ${tool.installed ? tool.version || (tool.ok ? 'installed' : 'probe failed') : 'not installed'}`)
  }
  lines.push(
    '',
    `Claude auth: ${report.authentication.claude.method}`,
    `Codex auth: ${report.authentication.codex.method}`,
    '',
    'Execution paths:',
  )
  for (const [name, path] of Object.entries(report.paths)) {
    lines.push(`- ${name}: ${path.state} — ${path.note}`)
  }
  lines.push('', 'Credential values and account identifiers were not returned or printed; only safe status classes are shown.')
  return lines.join('\n')
}
