import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createAttestedProxyHandler,
  createAzureCliTokenProvider,
  normalizeFoundryEndpoint,
} from '../lib/attested-proxy.mjs'

function request(payload, token = 'local-token', path = '/v1/chat/completions') {
  return new Request(`http://127.0.0.1:19000${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

test('Foundry endpoint validation accepts current resource and project v1 endpoints only', () => {
  assert.equal(
    normalizeFoundryEndpoint('https://example.openai.azure.com/openai/v1/'),
    'https://example.openai.azure.com/openai/v1',
  )
  assert.equal(
    normalizeFoundryEndpoint('https://example.services.ai.azure.com/api/projects/demo/openai/v1'),
    'https://example.services.ai.azure.com/api/projects/demo/openai/v1',
  )
  for (const value of [
    'http://example.openai.azure.com/openai/v1',
    'https://example.invalid/openai/v1',
    'https://example.openai.azure.com/models',
    'https://user@example.openai.azure.com/openai/v1',
    'https://example.openai.azure.com:8443/openai/v1',
  ]) assert.throws(() => normalizeFoundryEndpoint(value), /Azure Foundry endpoint/)
})

test('attested proxy refuses unauthenticated, unknown-model, and unknown-route requests before egress', async () => {
  let calls = 0
  const handler = createAttestedProxyHandler({
    upstreamBaseUrl: 'https://example.openai.azure.com/openai/v1',
    inboundToken: 'local-token',
    expectedModels: { deployment: 'gpt-snapshot' },
    upstreamHeaders: async () => ({ 'api-key': 'upstream-secret' }),
    fetcher: async () => {
      calls += 1
      return new Response('{}')
    },
  })
  assert.equal((await handler(request({ model: 'deployment' }, 'wrong'))).status, 401)
  assert.equal((await handler(request({ model: 'other' }))).status, 400)
  assert.equal((await handler(new Request('http://127.0.0.1:19000/', {
    headers: { Authorization: 'Bearer local-token' },
  }))).status, 404)
  assert.equal(calls, 0)
})

test('attested proxy readiness receipt is authenticated and fixed-shape', async () => {
  const handler = createAttestedProxyHandler({
    upstreamBaseUrl: 'https://example.openai.azure.com/openai/v1',
    inboundToken: 'local-token',
    expectedModels: { deployment: 'gpt-snapshot' },
    upstreamHeaders: async () => ({ 'api-key': 'upstream-secret' }),
  })
  const denied = await handler(new Request('http://127.0.0.1/_helix/ready'))
  assert.equal(denied.status, 401)
  const ready = await handler(new Request('http://127.0.0.1/_helix/ready', {
    headers: { Authorization: 'Bearer local-token' },
  }))
  assert.equal(ready.status, 200)
  assert.deepEqual(await ready.json(), { status: 'helix-attested-proxy-ready' })
})

test('attested proxy preserves an SSE stream only after an exact response-model match', async () => {
  const source = [
    'event: message',
    'data: {"id":"one","model":"gpt-snapshot","choices":[]}',
    '',
    'data: [DONE]',
    '',
  ].join('\n')
  let upstreamAuthorization
  const handler = createAttestedProxyHandler({
    upstreamBaseUrl: 'https://example.openai.azure.com/openai/v1',
    inboundToken: 'local-token',
    expectedModels: { deployment: 'gpt-snapshot' },
    upstreamHeaders: async () => ({ Authorization: 'Bearer entra-token' }),
    fetcher: async (_url, init) => {
      upstreamAuthorization = new Headers(init.headers).get('authorization')
      return new Response(source, { headers: { 'content-type': 'text/event-stream', 'x-private': 'drop-me' } })
    },
  })
  const response = await handler(request({ model: 'deployment', stream: true }))
  assert.equal(response.status, 200)
  assert.equal(await response.text(), source)
  assert.equal(response.headers.get('x-private'), null)
  assert.equal(upstreamAuthorization, 'Bearer entra-token')
})

test('attested proxy fails closed on a mismatched or absent served-model identity', async () => {
  for (const body of [
    'data: {"model":"different-model"}\n\n',
    'data: {"choices":[]}\n\ndata: [DONE]\n\n',
  ]) {
    const handler = createAttestedProxyHandler({
      upstreamBaseUrl: 'https://example.openai.azure.com/openai/v1',
      inboundToken: 'local-token',
      expectedModels: { deployment: 'gpt-snapshot' },
      upstreamHeaders: async () => ({}),
      fetcher: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
    })
    const response = await handler(request({ model: 'deployment', stream: true }))
    assert.equal(response.status, 502)
    assert.match(await response.text(), /provider-identity-(?:mismatch|unavailable)/)
  }
})

test('x-ms-served-model attests a response before its body is consumed', async () => {
  const handler = createAttestedProxyHandler({
    upstreamBaseUrl: 'https://example.openai.azure.com/openai/v1',
    inboundToken: 'local-token',
    expectedModels: { deployment: 'gpt-snapshot' },
    upstreamHeaders: async () => ({}),
    fetcher: async () => new Response('opaque-stream', {
      headers: { 'content-type': 'application/octet-stream', 'x-ms-served-model': 'gpt-snapshot' },
    }),
  })
  const response = await handler(request({ model: 'deployment' }))
  assert.equal(response.status, 200)
  assert.equal(await response.text(), 'opaque-stream')
})

test('Responses SSE attestation accepts nested response.model and preserves the Responses route', async () => {
  let upstreamPath
  const handler = createAttestedProxyHandler({
    upstreamBaseUrl: 'http://127.0.0.1:18318/v1',
    inboundToken: 'local-token',
    expectedModels: { 'gpt-5.4': 'gpt-5.4' },
    upstreamHeaders: async () => ({ Authorization: 'Bearer backend-token' }),
    fetcher: async (url) => {
      upstreamPath = new URL(url).pathname
      return new Response('event: response.created\ndata: {"response":{"model":"gpt-5.4"}}\n\ndata: [DONE]\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      })
    },
  })
  const response = await handler(request({ model: 'gpt-5.4', stream: true }, 'local-token', '/v1/responses'))
  assert.equal(response.status, 200)
  assert.equal(upstreamPath, '/v1/responses')
  assert.match(await response.text(), /response\.created/)
})

test('Azure CLI token provider caches only a valid unexpired token', async () => {
  let calls = 0
  const provider = createAzureCliTokenProvider({
    env: { PATH: '/bin' },
    runner(command, args, options) {
      calls += 1
      assert.equal(command, 'az')
      assert.deepEqual(args.slice(0, 3), ['account', 'get-access-token', '--resource'])
      assert.deepEqual(options.env, { PATH: '/bin' })
      return {
        status: 0,
        stdout: JSON.stringify({ accessToken: 'secret-token', expiresOn: new Date(Date.now() + 60 * 60 * 1000).toISOString() }),
      }
    },
  })
  assert.deepEqual(await provider(), { Authorization: 'Bearer secret-token' })
  assert.deepEqual(await provider(), { Authorization: 'Bearer secret-token' })
  assert.equal(calls, 1)
})
