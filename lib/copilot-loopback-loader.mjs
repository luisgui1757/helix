import { createHash } from 'node:crypto'

const START_MODULE = '/@jeffreycao/copilot-api/dist/start-B0sr92AZ.js'
const EXPECTED_SHA256 = 'b5138e87435aed6f0ba4bb1e375d0cd8014f0e9bcc72cf58e48c398ca3961570'
const SOURCE = 'serve({\n\t\tfetch: server.fetch,\n\t\tport: options.port,'
const REPLACEMENT = 'serve({\n\t\tfetch: server.fetch,\n\t\thostname: "127.0.0.1",\n\t\tport: options.port,'

export function patchCopilotApiStartSource(source) {
  const text = String(source)
  const digest = createHash('sha256').update(text).digest('hex')
  if (digest !== EXPECTED_SHA256) throw new Error('copilot-api start module does not match the pinned 1.14.9 artifact')
  if (text.split(SOURCE).length !== 2) throw new Error('copilot-api loopback patch target is ambiguous')
  return text.replace(SOURCE, REPLACEMENT)
}

export function load(url, context, nextLoad) {
  const loaded = nextLoad(url, context)
  if (!url.replaceAll('\\', '/').includes(START_MODULE)) return loaded
  return { ...loaded, source: patchCopilotApiStartSource(loaded.source) }
}
