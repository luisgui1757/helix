import { appendFile } from 'node:fs/promises'
import { createServer } from 'node:http'

const options = JSON.parse(Buffer.from(process.argv[2] || '', 'base64url').toString('utf8'))
const models = Array.isArray(options.models) ? options.models : []

const server = createServer((request, response) => {
  const authorization = request.headers.authorization || ''
  if (authorization !== `Bearer ${options.token}`) {
    response.writeHead(401, { 'content-type': 'application/json' })
    response.end('{"error":"unauthorized"}')
    return
  }
  if (options.ready !== true) {
    response.writeHead(503, { 'content-type': 'application/json' })
    response.end('{"error":"not-ready"}')
    return
  }
  if (request.method === 'GET' && request.url === '/_helix/ready') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('{"status":"helix-attested-proxy-ready"}')
    return
  }
  if (request.method === 'GET' && request.url === '/v1/models') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      data: models.map(id => ({
        id,
        model_picker_enabled: true,
        supported_endpoints: ['/responses'],
        capabilities: {
          type: 'chat',
          supports: { tool_calls: true, reasoning_effort: ['low', 'medium', 'high'] },
        },
      })),
    }))
    return
  }
  response.writeHead(404, { 'content-type': 'application/json' })
  response.end('{"error":"not-found"}')
})

server.listen(options.port, '127.0.0.1', async () => {
  await appendFile(options.reportPath, `${JSON.stringify({
    stage: options.stage,
    boundary: options.boundary,
    ordinal: options.ordinal,
    pid: process.pid,
    port: options.port,
  })}\n`)
})

process.on('SIGINT', () => {})
process.on('SIGTERM', () => {})
