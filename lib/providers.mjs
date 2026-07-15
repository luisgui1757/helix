import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { normalizeFoundryEndpoint, normalizeExpectedModels } from './attested-proxy.mjs'

const PROVIDERS = new Set(['codex', 'azure', 'copilot'])

export function parseProviderList(value = 'codex') {
  if (typeof value !== 'string' || !value) throw new Error('providers must be a comma-separated string')
  const providers = value.split(',').map(item => item.trim()).filter(Boolean)
  if (providers.length === 0 || providers.length > PROVIDERS.size || new Set(providers).size !== providers.length) {
    throw new Error('providers must contain one or more unique provider names')
  }
  for (const provider of providers) {
    if (!PROVIDERS.has(provider)) throw new Error(`unsupported provider: ${provider}`)
  }
  return providers
}

export function validateProviderModel(providers, value) {
  if (!Array.isArray(providers) || providers.length === 0) throw new Error('provider model validation requires selected providers')
  if (typeof value !== 'string' || !value || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('provider-backed mode requires one printable --model value of at most 256 characters')
  }
  if (providers.length === 1 && providers[0] === 'codex') {
    if (value.includes('/')) throw new Error('single-Codex mode requires an unprefixed model ID')
    return value
  }
  const match = value.match(/^(openai|copilot|azure)\/(.+)$/)
  if (!match) throw new Error('non-default provider mode requires a provider-prefixed model ID')
  const provider = match[1] === 'openai' ? 'codex' : match[1]
  if (!providers.includes(provider)) throw new Error(`model ${value} does not belong to the selected providers`)
  return value
}

function parsePort(value, fallback, label) {
  const port = Number(value || fallback)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`${label} must be an integer from 1024 through 65535`)
  return port
}

async function localToken(path) {
  try {
    const token = (await readFile(path, 'utf8')).trim()
    if (!token) throw new Error('stored local token is empty')
    return token
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    const token = randomBytes(32).toString('base64url')
    await writeFile(path, `${token}\n`, { mode: 0o600, flag: 'wx' })
    return token
  }
}

export async function ensureAzureState(paths, env = process.env) {
  const root = join(paths.stateRoot, 'azure')
  const port = parsePort(env.HELIX_CC_AZURE_PROXY_PORT, paths.port + 3, 'HELIX_CC_AZURE_PROXY_PORT')
  if (port === paths.port) throw new Error('Azure proxy and CLIProxyAPI ports must be distinct')
  const endpoint = normalizeFoundryEndpoint(env.HELIX_CC_AZURE_ENDPOINT)
  let parsedModels
  try {
    parsedModels = JSON.parse(env.HELIX_CC_AZURE_MODELS || '')
  } catch {
    throw new Error('HELIX_CC_AZURE_MODELS must be JSON mapping deployment names to expected served-model identities')
  }
  if (!parsedModels || typeof parsedModels !== 'object' || Array.isArray(parsedModels)) {
    throw new Error('HELIX_CC_AZURE_MODELS must be an object')
  }
  const expectedModels = normalizeExpectedModels(Object.fromEntries(Object.entries(parsedModels).map(([deployment, value]) => [
    deployment,
    typeof value === 'string' ? value : value?.servedModel,
  ])))
  const routeModels = Object.entries(parsedModels).map(([id, value]) => ({
    id,
    efforts: typeof value === 'string'
      ? ['low', 'medium', 'high']
      : Array.isArray(value?.efforts)
        ? value.efforts
        : ['low', 'medium', 'high'],
  }))
  for (const model of routeModels) {
    if (model.efforts.length === 0 || model.efforts.some(level => !['low', 'medium', 'high', 'xhigh'].includes(level))) {
      throw new Error(`Azure effort levels for ${model.id} must use low, medium, high, or xhigh`)
    }
  }
  await mkdir(root, { recursive: true, mode: 0o700 })
  await chmod(root, 0o700)
  const tokenPath = join(root, 'proxy-token')
  const inboundToken = await localToken(tokenPath)
  await chmod(tokenPath, 0o600)
  const authMode = env.HELIX_CC_AZURE_API_KEY ? 'azure-api-key' : 'azure-cli'
  const configPath = join(root, 'attestation-proxy.json')
  const config = { port, upstreamBaseUrl: endpoint, inboundToken, authMode, expectedModels }
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  await chmod(configPath, 0o600)
  return {
    root,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    configPath,
    logPath: join(root, 'attestation-proxy.log'),
    inboundToken,
    expectedModels,
    routeModels,
    authMode,
  }
}

export function providerRoute({ name, prefix, baseUrl, apiKey, models, transport = 'chat-completions' }) {
  if (!Array.isArray(models) || models.length === 0) throw new Error(`${name} route needs at least one model`)
  if (!['chat-completions', 'responses'].includes(transport)) throw new Error(`${name} route transport is unsupported`)
  return { name, prefix, baseUrl, apiKey, models, transport }
}
