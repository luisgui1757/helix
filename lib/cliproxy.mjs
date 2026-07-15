import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export const CLIPROXY_RELEASE = Object.freeze({
  version: '7.2.80',
  tag: 'v7.2.80',
  commit: '09da52ad509e2c18e7b9540db3b98c2214c280aa',
  repository: 'router-for-me/CLIProxyAPI',
})

const ARTIFACTS = Object.freeze({
  'darwin-arm64': {
    name: 'CLIProxyAPI_7.2.80_darwin_aarch64.tar.gz',
    sha256: '7b13a17670a7d24318e3d6a3f24ff38696cf23ab44894fc93fbd53fbb68dfda6',
  },
  'darwin-x64': {
    name: 'CLIProxyAPI_7.2.80_darwin_amd64.tar.gz',
    sha256: 'e442331bf90e908adac1da0b5536c360318dd95708f21423705ed0ae6d311fcc',
  },
  'linux-arm64': {
    name: 'CLIProxyAPI_7.2.80_linux_aarch64.tar.gz',
    sha256: 'c86b709019e6a86ca068772a1ec6f528f314030076163655789f8243be928549',
  },
  'linux-x64': {
    name: 'CLIProxyAPI_7.2.80_linux_amd64.tar.gz',
    sha256: '6c973562831c4ace016b057708ccb6529ba88af93fe67841ed109b81fe030b9a',
  },
})

function assertPlainString(value, label) {
  if (typeof value !== 'string' || !value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} must be a non-empty string without control characters`)
  }
  return value
}

function parsePort(value) {
  const port = Number(value == null || value === '' ? 18317 : value)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('HELIX_CC_CLIPROXY_PORT must be an integer from 1024 through 65535')
  }
  return port
}

export function artifactFor(platform = process.platform, arch = process.arch) {
  const artifact = ARTIFACTS[`${platform}-${arch}`]
  if (!artifact) throw new Error(`CLIProxyAPI ${CLIPROXY_RELEASE.tag} has no pinned artifact for ${platform}/${arch}`)
  return {
    ...artifact,
    url: `https://github.com/${CLIPROXY_RELEASE.repository}/releases/download/${CLIPROXY_RELEASE.tag}/${artifact.name}`,
  }
}

export function resolveCliProxyPaths({
  env = process.env,
  home = homedir(),
  platform = process.platform,
  arch = process.arch,
} = {}) {
  const stateRoot = env.HELIX_CC_CLIPROXY_DIR
    ? assertPlainString(env.HELIX_CC_CLIPROXY_DIR, 'HELIX_CC_CLIPROXY_DIR')
    : join(env.XDG_STATE_HOME || join(home, '.local', 'state'), 'helix-cc', 'cliproxy')
  if (!isAbsolute(stateRoot)) throw new Error('CLIProxyAPI state directory must be an absolute path')
  const releaseRoot = join(stateRoot, CLIPROXY_RELEASE.tag)
  const artifact = artifactFor(platform, arch)
  const executableName = 'cli-proxy-api'
  const port = parsePort(env.HELIX_CC_CLIPROXY_PORT)
  return {
    stateRoot,
    releaseRoot,
    archivePath: join(releaseRoot, artifact.name),
    binaryPath: join(releaseRoot, 'bin', executableName),
    authDir: join(stateRoot, 'auth'),
    configPath: join(stateRoot, 'config.yaml'),
    clientTokenPath: join(stateRoot, 'client-token'),
    logPath: join(stateRoot, 'cliproxy.log'),
    claudeConfigDir: join(stateRoot, 'claude'),
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    artifact,
    platform,
  }
}

export function isLoopbackBaseUrl(value) {
  if (typeof value !== 'string' || !value) return false
  let url
  try {
    url = new URL(value)
  } catch {
    return false
  }
  const loopback = url.hostname === '127.0.0.1'
  return url.protocol === 'http:' && loopback && (url.pathname === '/' || url.pathname === '')
}

export function renderCliProxyConfig({ authDir, apiKey, port, forceModelPrefix = false, routes = [] }) {
  assertPlainString(authDir, 'authDir')
  assertPlainString(apiKey, 'apiKey')
  const resolvedPort = parsePort(port)
  const lines = [
    'host: "127.0.0.1"',
    `port: ${resolvedPort}`,
    'tls:',
    '  enable: false',
    'remote-management:',
    '  allow-remote: false',
    '  secret-key: ""',
    '  disable-control-panel: true',
    '  disable-auto-update-panel: true',
    `auth-dir: ${JSON.stringify(authDir)}`,
    'api-keys:',
    `  - ${JSON.stringify(apiKey)}`,
    'debug: false',
    'pprof:',
    '  enable: false',
    'plugins:',
    '  enabled: false',
    'commercial-mode: true',
    'logging-to-file: false',
    'usage-statistics-enabled: false',
    `force-model-prefix: ${forceModelPrefix ? 'true' : 'false'}`,
    'passthrough-headers: false',
    'request-retry: 0',
    'max-retry-credentials: 1',
    'max-retry-interval: 0',
    'disable-cooling: true',
    'save-cooldown-status: false',
    'transient-error-cooldown-seconds: -1',
    'disable-claude-cloak-mode: true',
    'disable-image-generation: "passthrough"',
    'quota-exceeded:',
    '  switch-project: false',
    '  switch-preview-model: false',
    '  antigravity-credits: false',
    'routing:',
    '  strategy: "fill-first"',
    '  session-affinity: false',
    'codex:',
    '  identity-confuse: false',
    'ws-auth: true',
  ]
  const chatRoutes = routes.filter(route => route.transport !== 'responses')
  const responsesRoutes = routes.filter(route => route.transport === 'responses')
  if (chatRoutes.length) {
    lines.push('openai-compatibility:')
    for (const route of chatRoutes) {
      assertPlainString(route.name, 'route.name')
      assertPlainString(route.prefix, 'route.prefix')
      assertPlainString(route.baseUrl, 'route.baseUrl')
      assertPlainString(route.apiKey, 'route.apiKey')
      if (!Array.isArray(route.models) || route.models.length === 0 || route.models.length > 128) {
        throw new Error('route.models must contain 1 through 128 model IDs')
      }
      lines.push(
        `  - name: ${JSON.stringify(route.name)}`,
        `    prefix: ${JSON.stringify(route.prefix)}`,
        `    base-url: ${JSON.stringify(route.baseUrl.replace(/\/$/, ''))}`,
        '    disable-cooling: true',
        '    api-key-entries:',
        `      - api-key: ${JSON.stringify(route.apiKey)}`,
        '    models:',
      )
      for (const rawModel of route.models) {
        const model = assertPlainString(typeof rawModel === 'string' ? rawModel : rawModel?.id, 'route model')
        if (model.length > 256) throw new Error('route model must be at most 256 characters')
        const levels = typeof rawModel === 'string'
          ? ['low', 'medium', 'high']
          : rawModel.efforts
        if (!Array.isArray(levels) || levels.some(level => !['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(level))) {
          throw new Error(`route model ${model} has invalid effort levels`)
        }
        lines.push(
          `      - name: ${JSON.stringify(model)}`,
          `        alias: ${JSON.stringify(model)}`,
          '        force-mapping: true',
          '        input-modalities: ["text", "image"]',
          '        output-modalities: ["text"]',
          '        thinking:',
          `          levels: ${JSON.stringify(levels)}`,
        )
      }
    }
  }
  if (responsesRoutes.length) {
    lines.push('codex-api-key:')
    for (const route of responsesRoutes) {
      assertPlainString(route.prefix, 'route.prefix')
      assertPlainString(route.baseUrl, 'route.baseUrl')
      assertPlainString(route.apiKey, 'route.apiKey')
      if (!Array.isArray(route.models) || route.models.length === 0 || route.models.length > 128) {
        throw new Error('route.models must contain 1 through 128 model IDs')
      }
      lines.push(
        `  - api-key: ${JSON.stringify(route.apiKey)}`,
        `    prefix: ${JSON.stringify(route.prefix)}`,
        `    base-url: ${JSON.stringify(route.baseUrl.replace(/\/$/, ''))}`,
        '    websockets: false',
        '    disable-cooling: true',
        '    excluded-models:',
        '      - "gpt-image-1.5"',
        '      - "gpt-image-2"',
        '    models:',
      )
      for (const rawModel of route.models) {
        const model = assertPlainString(typeof rawModel === 'string' ? rawModel : rawModel?.id, 'route model')
        lines.push(
          `      - name: ${JSON.stringify(model)}`,
          `        alias: ${JSON.stringify(model)}`,
          '        force-mapping: true',
        )
      }
    }
  }
  lines.push('')
  return lines.join('\n')
}

function activeGatewaySession(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('activeSession must be an object')
  }
  if (!Number.isInteger(value.ownerPid) || value.ownerPid < 2) {
    throw new Error('activeSession.ownerPid must be an integer greater than one')
  }
  if (!Number.isInteger(value.gatewayPid) || value.gatewayPid < 2) {
    throw new Error('activeSession.gatewayPid must be an integer greater than one')
  }
  const providers = Array.isArray(value.providers) ? value.providers : []
  if (providers.length < 1 || providers.length > 3 || new Set(providers).size !== providers.length
    || providers.some(provider => !['codex', 'copilot', 'azure'].includes(provider))) {
    throw new Error('activeSession.providers must contain one through three unique supported providers')
  }
  const models = Array.isArray(value.models) ? value.models : []
  if (models.length < 1 || models.length > 256 || new Set(models).size !== models.length
    || models.some(model => typeof model !== 'string' || !model || model.length > 256 || /[\u0000-\u001f\u007f]/.test(model))) {
    throw new Error('activeSession.models must contain one through 256 unique printable model IDs')
  }
  return { version: 1, ownerPid: value.ownerPid, gatewayPid: value.gatewayPid, providers, models }
}

export function claudeGatewayEnvironment({ env = process.env, baseUrl, apiKey, claudeConfigDir, activeSession } = {}) {
  if (!isLoopbackBaseUrl(baseUrl)) throw new Error('CLIProxyAPI base URL must be a loopback HTTP origin')
  assertPlainString(apiKey, 'apiKey')
  const next = { ...env }
  for (const name of [
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_FOUNDRY',
    'CLAUDE_CODE_USE_VERTEX',
    'ANTHROPIC_FOUNDRY_API_KEY',
    'ANTHROPIC_FOUNDRY_RESOURCE',
    'ANTHROPIC_VERTEX_PROJECT_ID',
    'ANTHROPIC_VERTEX_REGION',
    'CLAUDE_CODE_SUBAGENT_MODEL',
    'HELIX_CC_AZURE_API_KEY',
    'HELIX_CC_AZURE_ENDPOINT',
    'HELIX_CC_AZURE_MODELS',
    'HELIX_CC_AZURE_PROXY_PORT',
    'HELIX_CC_COPILOT_BACKEND_PORT',
    'HELIX_CC_COPILOT_PROXY_PORT',
    'COPILOT_GITHUB_TOKEN',
    'GITHUB_TOKEN',
    'GH_TOKEN',
    'OPENAI_API_KEY',
    'OPENROUTER_API_KEY',
    'HELIX_CC_ACTIVE_GATEWAY_SESSION',
  ]) {
    delete next[name]
  }
  next.ANTHROPIC_BASE_URL = baseUrl
  next.ANTHROPIC_AUTH_TOKEN = apiKey
  next.ANTHROPIC_API_KEY = ''
  next.ENABLE_TOOL_SEARCH = 'false'
  next.CLAUDE_CODE_ALWAYS_ENABLE_EFFORT = '1'
  next.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB = '1'
  if (activeSession) next.HELIX_CC_ACTIVE_GATEWAY_SESSION = JSON.stringify(activeGatewaySession(activeSession))
  if (claudeConfigDir) next.CLAUDE_CONFIG_DIR = claudeConfigDir
  return next
}

export function sidecarProcessEnvironment(env = process.env) {
  const allowed = [
    'ALL_PROXY',
    'BROWSER',
    'DISPLAY',
    'HOME',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'LOGNAME',
    'NO_PROXY',
    'PATH',
    'SHELL',
    'SSL_CERT_DIR',
    'SSL_CERT_FILE',
    'TEMP',
    'TERM',
    'TMP',
    'TMPDIR',
    'TZ',
    'USER',
    'WAYLAND_DISPLAY',
    'AZURE_CONFIG_DIR',
    'XDG_RUNTIME_DIR',
    'all_proxy',
    'http_proxy',
    'https_proxy',
    'no_proxy',
  ]
  return Object.fromEntries(allowed.filter(name => typeof env[name] === 'string').map(name => [name, env[name]]))
}

export function sanitizeCliProxyLoginLine(value) {
  const line = String(value)
  if (/Attempting to open URL in browser:/i.test(line)) return 'Opening OpenAI authorization page in browser.'
  if (/https:\/\/auth\.openai\.com\/oauth\/authorize\?/i.test(line)) return ''
  if (/Visit the following URL to continue authentication:/i.test(line)) {
    return 'Browser authorization was unavailable; rerun with `helix-cc-cliproxy login --device`.'
  }
  if (/Saving credentials to /i.test(line)) return 'Saving the Codex OAuth credential to the dedicated Helix CC auth directory.'
  if (/Authentication saved to /i.test(line)) return 'The Codex OAuth credential was saved to the dedicated Helix CC auth directory.'
  return line
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<account>')
    .replace(/codex-[^\s/\\]+\.json/gi, 'codex-<account>.json')
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

async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function downloadVerified(artifact, destination, fetcher) {
  const maximumBytes = 256 * 1024 * 1024
  const temporary = `${destination}.partial-${process.pid}`
  await rm(temporary, { force: true })
  const response = await fetcher(artifact.url, { redirect: 'follow', signal: AbortSignal.timeout(120000) })
  if (!response.ok || !response.body) throw new Error(`CLIProxyAPI download failed with HTTP ${response.status}`)
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await response.body.cancel()
    throw new Error('CLIProxyAPI archive exceeds the 256 MiB download limit')
  }
  let receivedBytes = 0
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      receivedBytes += chunk.length
      callback(receivedBytes > maximumBytes
        ? new Error('CLIProxyAPI archive exceeds the 256 MiB download limit')
        : undefined, chunk)
    },
  })
  try {
    await pipeline(Readable.fromWeb(response.body), limiter, createWriteStream(temporary, { mode: 0o600 }))
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
  const digest = await sha256File(temporary)
  if (digest !== artifact.sha256) {
    await rm(temporary, { force: true })
    throw new Error(`CLIProxyAPI archive checksum mismatch: expected ${artifact.sha256}, received ${digest}`)
  }
  await rename(temporary, destination)
}

export async function prepareCliProxyArchive({
  paths = resolveCliProxyPaths(),
  fetcher = fetch,
} = {}) {
  await mkdir(paths.releaseRoot, { recursive: true, mode: 0o700 })
  await chmod(paths.releaseRoot, 0o700)
  if (await fileExists(paths.archivePath)) {
    const digest = await sha256File(paths.archivePath)
    if (digest === paths.artifact.sha256) return { downloaded: false, archivePath: paths.archivePath }
    throw new Error(`existing CLIProxyAPI archive checksum mismatch at ${paths.archivePath}`)
  }
  await downloadVerified(paths.artifact, paths.archivePath, fetcher)
  return { downloaded: true, archivePath: paths.archivePath }
}

export async function ensureCliProxyState({
  paths = resolveCliProxyPaths(),
  forceModelPrefix = false,
  routes = [],
  writeConfig = true,
} = {}) {
  await mkdir(paths.stateRoot, { recursive: true, mode: 0o700 })
  await mkdir(paths.authDir, { recursive: true, mode: 0o700 })
  await mkdir(paths.claudeConfigDir, { recursive: true, mode: 0o700 })
  await Promise.all([
    chmod(paths.stateRoot, 0o700),
    chmod(paths.authDir, 0o700),
    chmod(paths.claudeConfigDir, 0o700),
  ])
  let apiKey
  try {
    apiKey = (await readFile(paths.clientTokenPath, 'utf8')).trim()
    assertPlainString(apiKey, 'stored CLIProxyAPI client token')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    apiKey = randomBytes(32).toString('base64url')
    try {
      await writeFile(paths.clientTokenPath, `${apiKey}\n`, { mode: 0o600, flag: 'wx' })
    } catch (writeError) {
      if (writeError?.code !== 'EEXIST') throw writeError
      apiKey = (await readFile(paths.clientTokenPath, 'utf8')).trim()
      assertPlainString(apiKey, 'stored CLIProxyAPI client token')
    }
  }
  await chmod(paths.clientTokenPath, 0o600)
  if (writeConfig) {
    await writeFile(paths.configPath, renderCliProxyConfig({
      authDir: paths.authDir,
      apiKey,
      port: paths.port,
      forceModelPrefix,
      routes,
    }), { mode: 0o600 })
    await chmod(paths.configPath, 0o600)
  }
  await writeFile(join(paths.claudeConfigDir, 'settings.json'), '{\n  "disableWorkflows": false\n}\n', { mode: 0o600 })
  return { ...paths, apiKey }
}

export async function inspectCliProxyState({ paths = resolveCliProxyPaths() } = {}) {
  let apiKey
  try {
    apiKey = (await readFile(paths.clientTokenPath, 'utf8')).trim()
    assertPlainString(apiKey, 'stored CLIProxyAPI client token')
  } catch (error) {
    if (error?.code === 'ENOENT') return { ...paths, configured: false }
    throw error
  }
  return { ...paths, apiKey, configured: true }
}

export async function probeCliProxyModels({ baseUrl, apiKey, fetcher = fetch, timeoutMs = 3000, modelFilter } = {}) {
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
  if (!response.ok) return { verified: false, state: `http-${response.status}`, models: [] }
  let body
  try {
    if (!response.body) return { verified: false, state: 'response-invalid', models: [] }
    const limit = 2 * 1024 * 1024
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let bytes = 0
    let text = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > limit) {
        await reader.cancel()
        return { verified: false, state: 'response-too-large', models: [] }
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    body = JSON.parse(text)
  } catch {
    return { verified: false, state: 'response-unparseable', models: [] }
  }
  if (!Array.isArray(body?.data)) return { verified: false, state: 'response-invalid', models: [] }
  const entries = typeof modelFilter === 'function' ? body.data.filter(modelFilter) : body.data
  const models = [...new Set(entries.map(entry => entry?.id).filter(
    id => typeof id === 'string' && id.length <= 256 && !/[\u0000-\u001f\u007f]/.test(id),
  ))].sort()
  return { verified: true, state: 'models-verified', models }
}

export async function verifyCodexOnlyAuthDir(authDir) {
  const { readdir } = await import('node:fs/promises')
  let entries
  try {
    entries = await readdir(authDir, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return { verified: false, count: 0, state: 'missing' }
    throw error
  }
  const files = entries.filter(entry => entry.isFile() && entry.name.endsWith('.json')).map(entry => entry.name)
  if (files.length === 0) return { verified: false, count: 0, state: 'missing' }
  if (files.some(name => !name.startsWith('codex-'))) {
    return { verified: false, count: files.length, state: 'mixed-providers' }
  }
  for (const name of files) {
    try {
      const path = join(authDir, name)
      const info = await stat(path)
      if (info.size > 1024 * 1024) return { verified: false, count: files.length, state: 'invalid-record' }
      const record = JSON.parse(await readFile(path, 'utf8'))
      if (record?.type !== 'codex') return { verified: false, count: files.length, state: 'invalid-record' }
    } catch {
      return { verified: false, count: files.length, state: 'invalid-record' }
    }
  }
  return { verified: true, count: files.length, state: 'codex-only' }
}

export async function hardenCodexAuthFiles(authDir) {
  const verification = await verifyCodexOnlyAuthDir(authDir)
  if (!verification.verified) return verification
  const { readdir } = await import('node:fs/promises')
  const names = await readdir(authDir)
  await Promise.all(names.filter(name => name.startsWith('codex-') && name.endsWith('.json'))
    .map(name => chmod(join(authDir, name), 0o600)))
  return verification
}

export async function setCodexAuthPrefix(authDir, prefix) {
  if (prefix !== '') assertPlainString(prefix, 'Codex model prefix')
  const verification = await verifyCodexOnlyAuthDir(authDir)
  if (!verification.verified) return verification
  const { readdir } = await import('node:fs/promises')
  const names = (await readdir(authDir)).filter(name => name.startsWith('codex-') && name.endsWith('.json'))
  for (const name of names) {
    const path = join(authDir, name)
    const record = JSON.parse(await readFile(path, 'utf8'))
    const existing = record.prefix == null ? '' : record.prefix
    if (existing !== '' && existing !== 'openai' && existing !== prefix) {
      throw new Error('Codex credential already has a conflicting model prefix')
    }
    const updated = { ...record }
    if (prefix) updated.prefix = prefix
    else delete updated.prefix
    const temporary = `${path}.partial-${process.pid}`
    await writeFile(temporary, `${JSON.stringify(updated, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, path)
    await chmod(path, 0o600)
  }
  return verification
}

export async function extractResolvedModels(root, { marker, modifiedAfter = 0 } = {}) {
  assertPlainString(marker, 'marker')
  const { readdir } = await import('node:fs/promises')
  const models = new Set()
  let matchedTranscripts = 0
  async function visit(path) {
    let entries
    try {
      entries = await readdir(path, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) {
        await visit(child)
      } else if (entry.isFile() && entry.name.startsWith('agent-') && entry.name.endsWith('.jsonl')) {
        const info = await stat(child)
        if (info.mtimeMs < modifiedAfter || info.size > 16 * 1024 * 1024) continue
        const source = await readFile(child, 'utf8')
        if (!source.includes(marker)) continue
        matchedTranscripts += 1
        for (const line of source.split(/\r?\n/)) {
          if (!line) continue
          try {
            const record = JSON.parse(line)
            const model = record?.message?.model
            if (typeof model === 'string' && model.length <= 256) models.add(model)
          } catch {
            // A partially-written final line is ignored; complete records remain authoritative.
          }
        }
      }
    }
  }
  await visit(root)
  return { matchedTranscripts, models: [...models].sort() }
}

export async function waitForResolvedModels(root, {
  marker,
  modifiedAfter = 0,
  expectedTranscripts,
  expectedModels,
  timeoutMs = 5000,
  pollMs = 100,
  assertActive = () => {},
} = {}) {
  if (!Number.isInteger(expectedTranscripts) || expectedTranscripts < 1 || expectedTranscripts > 4) {
    throw new Error('expected transcript count must be an integer from 1 through 4')
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 30000) {
    throw new Error('transcript timeout must be an integer from 0 through 30000 milliseconds')
  }
  if (!Number.isInteger(pollMs) || pollMs < 1 || pollMs > 1000) {
    throw new Error('transcript poll interval must be an integer from 1 through 1000 milliseconds')
  }
  if (!Array.isArray(expectedModels) || expectedModels.length < 1 || expectedModels.length > 4) {
    throw new Error('expected resolved models must contain one through four unique model IDs')
  }
  const normalizedExpectedModels = [...new Set(expectedModels.map(model => assertPlainString(model, 'expected resolved model')))].sort()
  if (normalizedExpectedModels.length !== expectedModels.length) {
    throw new Error('expected resolved models must contain one through four unique model IDs')
  }
  if (typeof assertActive !== 'function') throw new Error('transcript activity check must be a function')

  const deadline = Date.now() + timeoutMs
  let evidence
  do {
    assertActive()
    evidence = await extractResolvedModels(root, { marker, modifiedAfter })
    if (evidence.matchedTranscripts > expectedTranscripts
      || (evidence.matchedTranscripts === expectedTranscripts
        && resolvedModelsExactlyMatch(evidence.models, normalizedExpectedModels))
      || Date.now() >= deadline) return evidence
    await new Promise(resolve => setTimeout(resolve, Math.min(pollMs, Math.max(1, deadline - Date.now()))))
  } while (true)
}

export function resolvedModelsExactlyMatch(actual, expected) {
  if (!Array.isArray(actual) || !Array.isArray(expected)) return false
  const normalizedActual = [...new Set(actual)].sort()
  const normalizedExpected = [...new Set(expected)].sort()
  return normalizedActual.length === actual.length
    && normalizedExpected.length === expected.length
    && normalizedActual.length === normalizedExpected.length
    && normalizedActual.every((model, index) => model === normalizedExpected[index])
}

export function expectedTranscriptModel(requestedModel) {
  assertPlainString(requestedModel, 'requested model')
  for (const prefix of ['openai/', 'copilot/', 'azure/']) {
    if (requestedModel.startsWith(prefix)) {
      const resolved = requestedModel.slice(prefix.length)
      return assertPlainString(resolved, 'resolved upstream model')
    }
  }
  return requestedModel
}

export function archiveBasename(paths) {
  return basename(paths.archivePath)
}

export function binaryDirectory(paths) {
  return dirname(paths.binaryPath)
}
