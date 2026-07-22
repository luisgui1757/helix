import { readFile } from 'node:fs/promises'

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

export function workflowFileForMode(file, mode = process.env.HELIX_CC_WORKFLOW_MODE) {
  const selected = mode === undefined ? 'original' : mode
  if (selected !== 'original' && selected !== 'graph') {
    throw new Error(`HELIX_CC_WORKFLOW_MODE must be original or graph; received ${JSON.stringify(selected)}`)
  }
  return selected === 'graph' ? `graph/${file}` : file
}

export async function runWorkflow(file, args, responder) {
  const calls = []
  const logs = []
  const execute = async (workflowFile, workflowArgs) => {
    const source = await readFile(new URL(`../workflows/${workflowFile}`, import.meta.url), 'utf8')
    const compiled = source.replace('export const meta =', 'const meta =')
    const agent = async (prompt, options) => {
      calls.push({ prompt, options })
      return responder(options, calls)
    }
    const parallel = thunks => Promise.all(thunks.map(thunk => thunk()))
    const childWorkflow = async (name, childArgs) => {
      const localName = name.startsWith('helix-cc:') ? name.slice('helix-cc:'.length) : name
      return execute(`${localName}.js`, childArgs)
    }
    const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'workflow', 'args', 'budget', 'log', compiled)
    return fn(agent, parallel, undefined, childWorkflow, workflowArgs, { total: null, remaining: () => Infinity }, message => logs.push(message))
  }
  const result = await execute(file, args)
  return { result, calls, logs }
}
