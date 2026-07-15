import { createHash, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { isLoopbackBaseUrl } from './cliproxy.mjs'

const require = createRequire(import.meta.url)

export const COPILOT_API_RELEASE = Object.freeze({
  package: '@jeffreycao/copilot-api',
  version: '1.14.9',
  tag: 'v1.14.9',
  commit: '2b6b113a3aa137a3529e552aed4e30923b751f64',
  integrity: 'sha512-N3pft4pIm1KCXATisLBwoEH2uaTZPy/U31pm7a5e0rUQ+ehBLDL3KCw7yd+pULfE3Ejnfs3H79en9GkaSvOpqg==',
  startModule: 'dist/start-B0sr92AZ.js',
  startModuleSha256: 'b5138e87435aed6f0ba4bb1e375d0cd8014f0e9bcc72cf58e48c398ca3961570',
})

function plainString(value, label, limit = 4096) {
  if (typeof value !== 'string' || !value || value.length > limit || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} must be a non-empty printable string of at most ${limit} characters`)
  }
  return value
}

async function sha256File(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

export async function verifyCopilotApiInstallation() {
  let packagePath
  try {
    packagePath = require.resolve(`${COPILOT_API_RELEASE.package}/package.json`)
  } catch {
    throw new Error(`${COPILOT_API_RELEASE.package} ${COPILOT_API_RELEASE.version} is not installed; run npm ci --ignore-scripts --include=optional`)
  }
  const metadata = JSON.parse(await readFile(packagePath, 'utf8'))
  if (metadata?.version !== COPILOT_API_RELEASE.version) {
    throw new Error(`installed copilot-api version is not ${COPILOT_API_RELEASE.version}`)
  }
  const packageRoot = dirname(packagePath)
  const startPath = join(packageRoot, COPILOT_API_RELEASE.startModule)
  const digest = await sha256File(startPath)
  if (digest !== COPILOT_API_RELEASE.startModuleSha256) {
    throw new Error('installed copilot-api start module does not match the pinned artifact')
  }
  return { packageRoot, startPath, version: metadata.version }
}

export function resolveCopilotPaths(paths, env = process.env) {
  const root = join(paths.stateRoot, 'copilot')
  const backendPort = Number(env.HELIX_CC_COPILOT_BACKEND_PORT || paths.port + 1)
  const proxyPort = Number(env.HELIX_CC_COPILOT_PROXY_PORT || paths.port + 2)
  for (const [label, port] of [['backend', backendPort], ['proxy', proxyPort]]) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`Copilot ${label} port must be an integer from 1024 through 65535`)
  }
  if (new Set([paths.port, backendPort, proxyPort]).size !== 3) throw new Error('CLIProxyAPI and Copilot ports must be distinct')
  return {
    root,
    apiHome: join(root, 'api-home'),
    githubTokenPath: join(root, 'api-home', 'github_token'),
    configPath: join(root, 'api-home', 'config.json'),
    backendTokenPath: join(root, 'backend-token'),
    proxyTokenPath: join(root, 'proxy-token'),
    backendLogPath: join(root, 'copilot-api.log'),
    proxyLogPath: join(root, 'attestation-proxy.log'),
    proxyConfigPath: join(root, 'attestation-proxy.json'),
    pinsPath: join(root, 'served-model-pins.json'),
    backendPort,
    proxyPort,
    backendBaseUrl: `http://127.0.0.1:${backendPort}`,
    proxyBaseUrl: `http://127.0.0.1:${proxyPort}`,
  }
}

async function tokenFile(path) {
  try {
    const token = (await readFile(path, 'utf8')).trim()
    return plainString(token, 'stored local token')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    const token = randomBytes(32).toString('base64url')
    await writeFile(path, `${token}\n`, { mode: 0o600, flag: 'wx' })
    return token
  }
}

export async function ensureCopilotState(paths) {
  const copilot = resolveCopilotPaths(paths)
  await mkdir(copilot.apiHome, { recursive: true, mode: 0o700 })
  await chmod(copilot.root, 0o700)
  await chmod(copilot.apiHome, 0o700)
  const [backendToken, proxyToken] = await Promise.all([
    tokenFile(copilot.backendTokenPath),
    tokenFile(copilot.proxyTokenPath),
  ])
  await Promise.all([chmod(copilot.backendTokenPath, 0o600), chmod(copilot.proxyTokenPath, 0o600)])
  let existing = {}
  try {
    existing = JSON.parse(await readFile(copilot.configPath, 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
  }
  if (existing?.providers && Object.keys(existing.providers).length > 0) {
    throw new Error('Copilot state contains third-party providers; use a clean HELIX_CC_CLIPROXY_DIR')
  }
  if (await fileExists(join(copilot.apiHome, 'codex_credentials.json'))) {
    const info = await stat(join(copilot.apiHome, 'codex_credentials.json'))
    if (info.size > 0) throw new Error('Copilot state contains Codex credentials; use a clean HELIX_CC_CLIPROXY_DIR')
  }
  const config = {
    ...existing,
    auth: { apiKeys: [backendToken], adminApiKey: existing?.auth?.adminApiKey || randomBytes(32).toString('base64url') },
    providers: {},
    modelMappings: {},
    useMessagesApi: true,
    useResponsesApiWebSocket: false,
    useResponsesApiWebSearch: false,
  }
  await writeFile(copilot.configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  await chmod(copilot.configPath, 0o600)
  return { ...copilot, backendToken, proxyToken }
}

async function fileExists(path) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

export async function verifyCopilotCredential(copilot) {
  try {
    const info = await stat(copilot.githubTokenPath)
    if (!info.isFile() || info.size < 16 || info.size > 16 * 1024) return { verified: false, state: 'invalid-record' }
    if ((info.mode & 0o077) !== 0) return { verified: false, state: 'invalid-permissions', count: 0 }
    plainString((await readFile(copilot.githubTokenPath, 'utf8')).trim(), 'Copilot credential', 16 * 1024)
    return { verified: true, state: 'github-copilot-only', count: 1 }
  } catch (error) {
    if (error?.code === 'ENOENT') return { verified: false, state: 'missing', count: 0 }
    return { verified: false, state: 'invalid-record', count: 0 }
  }
}

export async function hardenCopilotCredential(copilot) {
  try {
    await chmod(copilot.githubTokenPath, 0o600)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return verifyCopilotCredential(copilot)
}

export function renderCopilotAttestationConfig(copilot, models) {
  const expectedModels = Object.fromEntries(models.map(model => [
    typeof model === 'string' ? model : model.id,
    typeof model === 'string' ? model : model.servedModel,
  ]))
  return {
    port: copilot.proxyPort,
    upstreamBaseUrl: `${copilot.backendBaseUrl}/v1`,
    inboundToken: copilot.proxyToken,
    upstreamToken: copilot.backendToken,
    authMode: 'bearer',
    expectedModels,
  }
}

export async function readCopilotPins(copilot) {
  try {
    const parsed = JSON.parse(await readFile(copilot.pinsPath, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Copilot served-model pins must be an object')
    const entries = Object.entries(parsed)
    if (entries.length > 128) throw new Error('Copilot served-model pins exceed 128 entries')
    return Object.fromEntries(entries.map(([requested, served]) => [
      plainString(requested, 'pinned requested model', 256),
      plainString(served, `pinned served model for ${requested}`, 256),
    ]))
  } catch (error) {
    if (error?.code === 'ENOENT') return {}
    throw error
  }
}

export async function writeCopilotPin(copilot, requestedModel, servedModel) {
  const requested = plainString(requestedModel, 'requested Copilot model', 256)
  const served = plainString(servedModel, 'served Copilot model', 256)
  assertCopilotServedModel(requested, served)
  const pins = await readCopilotPins(copilot)
  const temporary = `${copilot.pinsPath}.partial-${process.pid}`
  await writeFile(temporary, `${JSON.stringify({ ...pins, [requested]: served }, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, copilot.pinsPath)
  await chmod(copilot.pinsPath, 0o600)
  return { requestedModel: requested, servedModel: served }
}

function assertCopilotServedModel(requested, served) {
  const escaped = requested.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (served !== requested && !new RegExp(`^${escaped}-\\d{4}-\\d{2}-\\d{2}$`).test(served)) {
    throw new Error('Copilot served model is neither the requested ID nor its dated snapshot')
  }
}

export async function discoverCopilotServedModel({ baseUrl, apiKey, model, fetcher = fetch }) {
  if (!isLoopbackBaseUrl(baseUrl)) throw new Error('Copilot discovery endpoint must be loopback')
  plainString(apiKey, 'Copilot discovery API key')
  const requested = plainString(model, 'Copilot discovery model', 256)
  const response = await fetcher(new URL('/v1/responses', baseUrl), {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: requested,
      input: 'Return only OK.',
      stream: false,
      reasoning: { effort: 'low' },
      max_output_tokens: 16,
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(60000),
  })
  if (!response.ok || !response.body) throw new Error(`Copilot served-model discovery failed with HTTP ${response.status}`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let text = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 1024 * 1024) {
      await reader.cancel()
      throw new Error('Copilot served-model discovery response exceeds 1 MiB')
    }
    text += decoder.decode(value, { stream: true })
  }
  text += decoder.decode()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Copilot served-model discovery response is invalid')
  }
  const served = plainString(parsed?.model, 'discovered Copilot served model', 256)
  assertCopilotServedModel(requested, served)
  return { requestedModel: requested, servedModel: served }
}

export function isCopilotResponsesModel(entry) {
  if (!entry || typeof entry !== 'object' || entry.model_picker_enabled !== true) return false
  if (entry.capabilities?.type !== 'chat') return false
  if (entry.capabilities?.supports?.tool_calls !== true) return false
  if (!entry.capabilities?.supports?.reasoning_effort?.includes('low')) return false
  return Array.isArray(entry.supported_endpoints)
    && entry.supported_endpoints.includes('/responses')
}

export async function probeCopilotCatalog({ baseUrl, apiKey, fetcher = fetch, timeoutMs = 3000 }) {
  if (!isLoopbackBaseUrl(baseUrl)) return { verified: false, state: 'non-loopback-refused', models: [] }
  if (typeof apiKey !== 'string' || !apiKey) return { verified: false, state: 'credential-missing', models: [] }
  let response
  try {
    response = await fetcher(new URL('/v1/models', baseUrl), {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    return { verified: false, state: 'unreachable', models: [] }
  }
  if (!response.ok || !response.body) return { verified: false, state: `http-${response.status}`, models: [] }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 2 * 1024 * 1024) {
        await reader.cancel()
        return { verified: false, state: 'response-too-large', models: [] }
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    const body = JSON.parse(text)
    if (!Array.isArray(body?.data)) return { verified: false, state: 'response-invalid', models: [] }
    const models = body.data.filter(isCopilotResponsesModel).map(entry => ({
      id: entry.id,
      efforts: Array.isArray(entry.capabilities?.supports?.reasoning_effort)
        ? entry.capabilities.supports.reasoning_effort.filter(level => [
            'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max',
          ].includes(level))
        : [],
    })).filter(entry => typeof entry.id === 'string' && entry.id.length <= 256)
    if (models.length === 0) return { verified: false, state: 'no-responses-models', models: [] }
    return { verified: true, state: 'models-verified', models }
  } catch {
    return { verified: false, state: 'response-unparseable', models: [] }
  }
}

export function sanitizeCopilotLoginLine(value) {
  const line = String(value)
  if (/Logged in as /i.test(line)) return 'GitHub Copilot authentication succeeded.'
  if (/GitHub token written to/i.test(line)) return 'The GitHub Copilot credential was saved to the dedicated Helix CC state directory.'
  if (/GitHub token:/i.test(line) || /device_code|access_token|copilot token/i.test(line)) return ''
  return line.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<account>')
}
