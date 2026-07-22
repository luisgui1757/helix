import { readFile } from 'node:fs/promises'
import { isDeepStrictEqual, inspect } from 'node:util'

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const root = new URL('../', import.meta.url)

async function execute(file, args, responder) {
  const agentCalls = []
  const events = []
  const logs = []
  let parallelSequence = 0
  const run = async (workflowFile, workflowArgs) => {
    const source = await readFile(new URL(`workflows/${workflowFile}`, root), 'utf8')
    const compiled = source.replace('export const meta =', 'const meta =')
    const agent = async (prompt, options) => {
      const call = { prompt, options }
      agentCalls.push(call)
      events.push({ type: 'agent:call', ...call })
      try {
        const response = await responder(options, agentCalls)
        events.push({ type: 'agent:return', label: options?.label, response })
        return response
      } catch (error) {
        events.push({ type: 'agent:throw', label: options?.label, error: { name: error?.name, message: error?.message } })
        throw error
      }
    }
    const parallel = async thunks => {
      const group = ++parallelSequence
      events.push({ type: 'parallel:start', group, count: thunks.length })
      try {
        const value = await Promise.all(thunks.map(thunk => thunk()))
        events.push({ type: 'parallel:return', group, count: value.length })
        return value
      } catch (error) {
        events.push({ type: 'parallel:throw', group, error: { name: error?.name, message: error?.message } })
        throw error
      }
    }
    const childWorkflow = async (name, childArgs) => {
      const localName = name.startsWith('helix-cc:') ? name.slice('helix-cc:'.length) : name
      events.push({ type: 'workflow:call', name, args: childArgs })
      try {
        const value = await run(`${localName}.js`, childArgs)
        events.push({ type: 'workflow:return', name, value })
        return value
      } catch (error) {
        events.push({ type: 'workflow:throw', name, error: { name: error?.name, message: error?.message } })
        throw error
      }
    }
    const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'workflow', 'args', 'budget', 'log', compiled)
    return fn(agent, parallel, undefined, childWorkflow, workflowArgs, { total: null, remaining: () => Infinity }, message => logs.push(message))
  }
  try {
    return { ok: true, value: await run(file, args), events, logs }
  } catch (error) {
    return { ok: false, error: { name: error?.name, message: error?.message }, events, logs }
  }
}

const normalizeEntropy = (value, path = []) => {
  if (Array.isArray(value)) {
    return value.map((item, index) => normalizeEntropy(item, [...path, index]))
  }
  if (!value || typeof value !== 'object') return value
  const receipt = Number.isInteger(value.version)
    && typeof value.sessionId === 'string'
    && Number.isInteger(value.sequence)
    && typeof value.operation === 'string'
    && value.request && typeof value.request === 'object' && !Array.isArray(value.request)
    && value.result && typeof value.result === 'object' && !Array.isArray(value.result)
    && Array.isArray(value.signature) && value.signature.length === 6
    && value.signature.every(chunk => typeof chunk === 'string')
  const publicKey = path.at(-1) === 'publicKey'
    && value.kty === 'RSA' && value.e === 'AQAB'
    && typeof value.n === 'string' && /^[A-Za-z0-9_-]{342}$/.test(value.n)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (key === 'signature' && receipt) return [key, item.map(() => '<signature-chunk>')]
    if (key === 'n' && publicKey) return [key, '<rsa-modulus>']
    return [key, normalizeEntropy(item, [...path, key])]
  }))
}

export const observeWorkflowResult = (result, { graphId } = {}) => {
  const trace = graphId == null
    ? null
    : new RegExp(`^\\[graph:${graphId}@[0-9a-f]{12}\\] [a-z][a-z0-9-]{0,63}$`)
  return normalizeEntropy({
  ok: result.ok,
  ...(result.ok ? { value: result.value } : { error: result.error }),
  events: result.events,
    logs: trace ? result.logs.filter(line => !trace.test(line)) : result.logs,
  })
}

const firstDifference = (left, right, path = '$') => {
  if (isDeepStrictEqual(left, right)) return null
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return { path, left, right }
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (!isDeepStrictEqual(leftKeys.sort(), rightKeys.sort())) return { path: `${path} keys`, left: leftKeys, right: rightKeys }
  for (const key of leftKeys) {
    const difference = firstDifference(left[key], right[key], `${path}.${key}`)
    if (difference) return difference
  }
  return { path, left, right }
}

export async function compareWorkflowModes({ id, argsFactory, responderFactory }) {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw new Error('comparison workflow id is invalid')
  if (typeof argsFactory !== 'function' || typeof responderFactory !== 'function') throw new Error('comparison requires args and responder factories')
  const originalArgs = argsFactory('original')
  const graphArgs = argsFactory('graph')
  if (!isDeepStrictEqual(normalizeEntropy(originalArgs), normalizeEntropy(graphArgs))) {
    throw new Error(`comparison args differ for ${id}\nORIGINAL:\n${inspect(normalizeEntropy(originalArgs), { depth: 8, maxArrayLength: 100 })}\nGRAPH:\n${inspect(normalizeEntropy(graphArgs), { depth: 8, maxArrayLength: 100 })}`)
  }
  const [original, graph] = await Promise.all([
    execute(`${id}.js`, originalArgs, responderFactory('original')),
    execute(`graph/${id}.js`, graphArgs, responderFactory('graph')),
  ])
  const left = observeWorkflowResult(original)
  const right = observeWorkflowResult(graph, { graphId: id })
  if (!isDeepStrictEqual(left, right)) {
    const difference = firstDifference(left, right)
    throw new Error(`original/graph parity mismatch for ${id}\nFIRST DIFFERENCE:\n${inspect(difference, { depth: 8, maxArrayLength: 100 })}\nORIGINAL:\n${inspect(left, { depth: 8, maxArrayLength: 100 })}\nGRAPH:\n${inspect(right, { depth: 8, maxArrayLength: 100 })}`)
  }
  return { id, ok: true, result: left }
}
