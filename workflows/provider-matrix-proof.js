export const meta = {
  name: 'provider-matrix-proof',
  description: 'Run two to four no-tools subagents with explicit models to prove one heterogeneous native Workflow cast',
  whenToUse:
    'Use only for a bounded mixed-provider routing smoke test before a real Helix CC delivery workflow.',
  phases: [{ title: 'Prove matrix', detail: 'two to four parallel low-effort, no-tools subagent round trips' }],
}

if (!args || typeof args !== 'object' || Array.isArray(args)) {
  throw new Error('provider-matrix-proof args must be an object')
}
const unknownKeys = Object.keys(args).filter(key => !['models', 'marker'].includes(key))
if (unknownKeys.length) throw new Error(`provider-matrix-proof received unknown args: ${unknownKeys.join(', ')}`)
if (!Array.isArray(args.models) || args.models.length < 2 || args.models.length > 4) {
  throw new Error('provider-matrix-proof args.models must contain two through four entries')
}
const printable = (value, field, limit) => {
  if (typeof value !== 'string' || !value || value.length > limit || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`provider-matrix-proof args.${field} must be a non-empty printable string of at most ${limit} characters`)
  }
  return value
}
const models = args.models.map((model, index) => printable(model, `models[${index}]`, 256))
if (new Set(models).size !== models.length) throw new Error('provider-matrix-proof args.models must be unique')
const marker = printable(args.marker, 'marker', 128)

const results = await parallel(models.map((model, index) => () => agent(
  `Return the marker below exactly in the required JSON field. Do not call tools and do not add commentary.\n\nMARKER:\n${marker}\n\nMATRIX INDEX: ${index + 1}`,
  {
    agentType: 'helix-cc:provider-probe',
    label: `provider-matrix-proof:${index + 1}`,
    phase: 'Prove matrix',
    model,
    effort: 'low',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['marker'],
      properties: { marker: { type: 'string' } },
    },
  },
)))

if (results.length !== models.length || results.some(result => !result || result.marker !== marker)) {
  throw new Error('provider-matrix-proof subagent returned the wrong marker')
}
return { marker, completed: true, agents: results.length }
