import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { Readable } from 'node:stream'

const MAX_REQUEST_BYTES = 16 * 1024 * 1024
const MAX_ERROR_BYTES = 2 * 1024 * 1024
const MAX_ATTESTATION_BYTES = 1024 * 1024
const SAFE_RESPONSE_HEADERS = new Set([
  'cache-control',
  'content-type',
  'retry-after',
  'x-ms-ratelimit-remaining-requests',
  'x-ms-ratelimit-remaining-tokens',
])

function plainString(value, label, limit = 4096) {
  if (typeof value !== 'string' || !value || value.length > limit || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} must be a non-empty printable string of at most ${limit} characters`)
  }
  return value
}

function timingSafeStringEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false
  let mismatch = 0
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return mismatch === 0
}

export function normalizeFoundryEndpoint(value) {
  const raw = plainString(value, 'Azure Foundry endpoint')
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error('Azure Foundry endpoint must be an absolute URL')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port) {
    throw new Error('Azure Foundry endpoint must be a credential-free HTTPS origin/path without a port, query, or fragment')
  }
  const host = url.hostname.toLowerCase()
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:openai\.azure\.com|services\.ai\.azure\.com)$/.test(host)) {
    throw new Error('Azure Foundry endpoint host is not a supported openai.azure.com or services.ai.azure.com resource')
  }
  const path = url.pathname.replace(/\/+$/, '')
  if (!path.endsWith('/openai/v1')) {
    throw new Error('Azure Foundry endpoint path must end in /openai/v1')
  }
  url.pathname = path
  return url.toString().replace(/\/$/, '')
}

export function normalizeExpectedModels(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('expectedModels must be a non-empty object')
  }
  const entries = Object.entries(value)
  if (entries.length === 0 || entries.length > 128) throw new Error('expectedModels must contain 1 through 128 entries')
  return Object.fromEntries(entries.map(([requested, served]) => [
    plainString(requested, 'requested model', 256),
    plainString(served, `served model for ${requested}`, 256),
  ]))
}

async function readBounded(stream, maximumBytes, label) {
  if (!stream) return new Uint8Array()
  const reader = stream.getReader()
  const chunks = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maximumBytes) {
      await reader.cancel()
      throw new Error(`${label} exceeds ${maximumBytes} bytes`)
    }
    chunks.push(value)
  }
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function modelFromSseText(text) {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const data = trimmed.slice(5).trim()
    if (!data || data === '[DONE]') continue
    try {
      const parsed = JSON.parse(data)
      if (typeof parsed?.model === 'string') return parsed.model
      if (typeof parsed?.response?.model === 'string') return parsed.response.model
    } catch {
      // A partial SSE line is completed by a later chunk.
    }
  }
  return undefined
}

function sanitizedHeaders(source) {
  const headers = new Headers()
  for (const [name, value] of source) {
    if (SAFE_RESPONSE_HEADERS.has(name.toLowerCase())) headers.set(name, value)
  }
  return headers
}

async function attestedBody(response, expectedModel) {
  const headerModel = response.headers.get('x-ms-served-model')
  if (headerModel) {
    if (headerModel !== expectedModel) throw new Error('provider-identity-mismatch')
    return response.body
  }
  if (!response.body) throw new Error('provider-identity-unavailable')

  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('text/event-stream')) {
    const bytes = await readBounded(response.body, MAX_ATTESTATION_BYTES, 'provider response before model attestation')
    let parsed
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes))
    } catch {
      throw new Error('provider-identity-unavailable')
    }
    if (parsed?.model !== expectedModel) {
      throw new Error(typeof parsed?.model === 'string' ? 'provider-identity-mismatch' : 'provider-identity-unavailable')
    }
    return new Response(bytes).body
  }

  const reader = response.body.getReader()
  const buffered = []
  const decoder = new TextDecoder()
  let text = ''
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) throw new Error('provider-identity-unavailable')
    size += value.byteLength
    if (size > MAX_ATTESTATION_BYTES) {
      await reader.cancel()
      throw new Error('provider-identity-unavailable')
    }
    buffered.push(value)
    text += decoder.decode(value, { stream: true })
    const model = modelFromSseText(text)
    if (!model) continue
    if (model !== expectedModel) {
      await reader.cancel()
      throw new Error('provider-identity-mismatch')
    }
    return new ReadableStream({
      start(controller) {
        for (const chunk of buffered) controller.enqueue(chunk)
        const pump = async () => {
          try {
            while (true) {
              const next = await reader.read()
              if (next.done) {
                controller.close()
                return
              }
              controller.enqueue(next.value)
            }
          } catch (error) {
            controller.error(error)
          }
        }
        void pump()
      },
      cancel(reason) {
        return reader.cancel(reason)
      },
    })
  }
}

function jsonError(status, code) {
  return new Response(JSON.stringify({ error: { type: code, message: code } }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export function createAttestedProxyHandler({
  upstreamBaseUrl,
  inboundToken,
  expectedModels,
  upstreamHeaders,
  fetcher = fetch,
}) {
  const baseUrl = new URL(`${plainString(upstreamBaseUrl, 'upstreamBaseUrl').replace(/\/$/, '')}/`)
  if (!['http:', 'https:'].includes(baseUrl.protocol)) throw new Error('upstreamBaseUrl must use HTTP or HTTPS')
  plainString(inboundToken, 'inboundToken')
  const models = normalizeExpectedModels(expectedModels)
  if (typeof upstreamHeaders !== 'function') throw new Error('upstreamHeaders must be a function')

  return async request => {
    const authorization = request.headers.get('authorization') || ''
    const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
    if (!timingSafeStringEqual(supplied, inboundToken)) return jsonError(401, 'proxy-authentication-failed')
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/_helix/ready' && !url.search) {
      return new Response(JSON.stringify({ status: 'helix-attested-proxy-ready' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (request.method !== 'POST' || !['/v1/chat/completions', '/v1/responses'].includes(url.pathname) || url.search) {
      return jsonError(404, 'provider-route-refused')
    }

    let body
    let payload
    try {
      body = await readBounded(request.body, MAX_REQUEST_BYTES, 'provider request')
      payload = JSON.parse(new TextDecoder().decode(body))
    } catch (error) {
      return jsonError(error?.message?.includes('exceeds') ? 413 : 400, 'provider-request-invalid')
    }
    const requestedModel = payload?.model
    if (typeof requestedModel !== 'string' || !Object.hasOwn(models, requestedModel)) {
      return jsonError(400, 'provider-model-not-allowlisted')
    }

    const headers = new Headers({
      accept: request.headers.get('accept') || 'application/json',
      'content-type': 'application/json',
      ...(await upstreamHeaders()),
    })
    let response
    try {
      const upstreamPath = url.pathname === '/v1/responses' ? 'responses' : 'chat/completions'
      response = await fetcher(new URL(upstreamPath, baseUrl), {
        method: 'POST',
        headers,
        body,
        redirect: 'error',
        signal: request.signal,
      })
    } catch {
      return jsonError(502, 'provider-upstream-unreachable')
    }
    const responseHeaders = sanitizedHeaders(response.headers)
    if (!response.ok) {
      try {
        const errorBody = await readBounded(response.body, MAX_ERROR_BYTES, 'provider error response')
        return new Response(errorBody, { status: response.status, headers: responseHeaders })
      } catch {
        return jsonError(502, 'provider-error-response-invalid')
      }
    }
    try {
      const bodyStream = await attestedBody(response, models[requestedModel])
      return new Response(bodyStream, { status: response.status, headers: responseHeaders })
    } catch (error) {
      return jsonError(502, error?.message === 'provider-identity-mismatch'
        ? 'provider-identity-mismatch'
        : 'provider-identity-unavailable')
    }
  }
}

export function createAzureCliTokenProvider({ runner = spawnSync, env = process.env } = {}) {
  let cached
  return async () => {
    if (cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) {
      return { Authorization: `Bearer ${cached.token}` }
    }
    const result = runner('az', [
      'account', 'get-access-token',
      '--resource', 'https://cognitiveservices.azure.com',
      '--output', 'json',
    ], {
      env,
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (result.error?.code === 'ENOENT') throw new Error('azure-cli-unavailable')
    if (result.error || result.status !== 0) throw new Error('azure-cli-token-unavailable')
    let parsed
    try {
      parsed = JSON.parse(result.stdout)
    } catch {
      throw new Error('azure-cli-token-unparseable')
    }
    const token = parsed?.accessToken
    const expiresAt = Date.parse(parsed?.expiresOn)
    if (typeof token !== 'string' || !token || !Number.isFinite(expiresAt)) {
      throw new Error('azure-cli-token-invalid')
    }
    cached = { token, expiresAt }
    return { Authorization: `Bearer ${token}` }
  }
}

export async function startAttestedProxy({ port, handler }) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('proxy port must be an integer from 1024 through 65535')
  if (typeof handler !== 'function') throw new Error('handler must be a function')
  const server = createServer({
    headersTimeout: 10000,
    requestTimeout: 10 * 60 * 1000,
    keepAliveTimeout: 5000,
  }, async (request, response) => {
    try {
      const origin = `http://127.0.0.1:${port}`
      const webRequest = new Request(new URL(request.url || '/', origin), {
        method: request.method,
        headers: request.headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : Readable.toWeb(request),
        duplex: 'half',
      })
      const result = await handler(webRequest)
      response.writeHead(result.status, Object.fromEntries(result.headers))
      if (!result.body) {
        response.end()
        return
      }
      Readable.fromWeb(result.body).pipe(response)
    } catch {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end('{"error":{"type":"proxy-internal-error","message":"proxy-internal-error"}}')
    }
  })
  server.maxConnections = 64
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  return server
}
