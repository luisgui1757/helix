import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { main } from '../../bin/helix-cc-cliproxy'
import { createProcessLifecycleOwner } from '../../lib/process-lifecycle.mjs'

const stage = process.argv[2]
if (![
  'copilot-backend-readiness',
  'copilot-attestation-readiness',
  'azure-attestation-readiness',
  'gateway-catalog-readiness',
  'active-claude',
  'active-proof',
].includes(stage)) process.exit(2)

const boundaryProcess = fileURLToPath(new URL('provider-boundary-process.mjs', import.meta.url))

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(error => error ? reject(error) : resolve(port))
    })
  })
}

const root = await mkdtemp(join(tmpdir(), 'helix-cc-production-lifecycle-'))
const reportPath = join(root, 'children.jsonl')
const [gatewayPort, copilotBackendPort, copilotProxyPort, azureProxyPort, foregroundPort] = await Promise.all(
  Array.from({ length: 5 }, () => reservePort()),
)
const gatewayToken = 'gateway-token'
const backendToken = 'copilot-backend-token'
const copilotProxyToken = 'copilot-proxy-token'
const azureProxyToken = 'azure-proxy-token'
const paths = {
  stateRoot: root,
  authDir: join(root, 'auth'),
  claudeConfigDir: join(root, 'claude'),
  configPath: join(root, 'gateway.yaml'),
  logPath: join(root, 'gateway.log'),
  binaryPath: join(root, 'gateway'),
  port: gatewayPort,
  baseUrl: `http://127.0.0.1:${gatewayPort}`,
}
await Promise.all([mkdir(paths.authDir), mkdir(paths.claudeConfigDir)])

let ordinal = 0
function boundaryCommand(boundary, { port, token, models = [], ready = true }) {
  const encoded = Buffer.from(JSON.stringify({
    stage,
    boundary,
    ordinal: ordinal++,
    port,
    token,
    models,
    ready,
    reportPath,
  })).toString('base64url')
  return { command: process.execPath, args: [boundaryProcess, encoded] }
}

const copilot = {
  root: join(root, 'copilot'),
  apiHome: join(root, 'copilot', 'api-home'),
  backendPort: copilotBackendPort,
  proxyPort: copilotProxyPort,
  backendBaseUrl: `http://127.0.0.1:${copilotBackendPort}`,
  proxyBaseUrl: `http://127.0.0.1:${copilotProxyPort}`,
  backendToken,
  proxyToken: copilotProxyToken,
  backendLogPath: join(root, 'copilot-backend.log'),
  proxyLogPath: join(root, 'copilot-proxy.log'),
  proxyConfigPath: join(root, 'copilot-proxy.json'),
}
await mkdir(copilot.apiHome, { recursive: true })

const azure = {
  root: join(root, 'azure'),
  port: azureProxyPort,
  baseUrl: `http://127.0.0.1:${azureProxyPort}`,
  configPath: join(root, 'azure-proxy.json'),
  logPath: join(root, 'azure-proxy.log'),
  inboundToken: azureProxyToken,
  routeModels: [{ id: 'deployment', efforts: ['low', 'medium', 'high'] }],
  authMode: 'azure-api-key',
}
await mkdir(azure.root)

const dependencies = {
  ensureBinary: async () => {},
  inspectCliProxyState: async () => ({ ...paths, configured: false }),
  ensureCliProxyState: async () => ({ ...paths, apiKey: gatewayToken }),
  requireCodexAuth: async () => ({ verified: true, count: 1, state: 'codex-only' }),
  setCodexAuthPrefix: async () => ({ verified: true }),
  verifyCopilotApiInstallation: async () => ({ version: 'fixture' }),
  ensureCopilotState: async () => copilot,
  hardenCopilotCredential: async () => ({ verified: true, state: 'github-copilot-only', count: 1 }),
  readCopilotPins: async () => ({ 'gpt-5.4': 'gpt-5.4' }),
  ensureAzureState: async () => azure,
  copilotBackendCommand: () => boundaryCommand('copilot-backend', {
    port: copilotBackendPort,
    token: backendToken,
    models: ['gpt-5.4'],
    ready: stage !== 'copilot-backend-readiness',
  }),
  attestedProxyCommand: (_configPath, context) => context.provider === 'copilot'
    ? boundaryCommand('copilot-attestation', {
        port: copilotProxyPort,
        token: copilotProxyToken,
        models: ['gpt-5.4'],
        ready: stage !== 'copilot-attestation-readiness',
      })
    : boundaryCommand('azure-attestation', {
        port: azureProxyPort,
        token: azureProxyToken,
        models: ['deployment'],
        ready: stage !== 'azure-attestation-readiness',
      }),
  sidecarCommand: () => boundaryCommand('gateway-catalog', {
    port: gatewayPort,
    token: gatewayToken,
    models: stage === 'gateway-catalog-readiness' ? [] : ['copilot/gpt-5.4'],
  }),
  claudeCommand: () => boundaryCommand(stage === 'active-proof' ? 'active-proof' : 'active-claude', {
    port: foregroundPort,
    token: 'foreground-token',
  }),
}

let forwardedBytes = 0
async function forwardReports() {
  let source = ''
  try { source = await readFile(reportPath, 'utf8') } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  if (source.length <= forwardedBytes) return
  process.stdout.write(source.slice(forwardedBytes))
  forwardedBytes = source.length
}
const reportTimer = setInterval(() => { void forwardReports() }, 10)

const argv = stage === 'azure-attestation-readiness'
  ? ['run', '--providers', 'azure', '--', '--model', 'azure/deployment']
  : stage === 'active-proof'
    ? ['proof', '--providers', 'copilot', '--model', 'copilot/gpt-5.4']
    : ['run', '--providers', 'copilot', '--', '--model', 'copilot/gpt-5.4']
const lifecycle = createProcessLifecycleOwner({ terminationGraceMs: 100 })
try {
  await main(lifecycle, { argv, paths, dependencies })
} catch (error) {
  process.exitCode = error.exitCode || process.exitCode || 1
} finally {
  clearInterval(reportTimer)
  await lifecycle.close()
  await forwardReports()
  await rm(root, { recursive: true, force: true })
}
