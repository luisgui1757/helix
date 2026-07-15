export const meta = {
  name: 'provider-proof',
  description: 'Run one no-tools subagent and return a marker that proves the native Workflow path completed',
  whenToUse:
    'Use only for a bounded provider-routing smoke test before a real Helix CC delivery workflow.',
  phases: [{ title: 'Prove', detail: 'one low-effort, no-tools subagent round trip' }],
}

if (!args || typeof args !== 'object' || Array.isArray(args)) {
  throw new Error('provider-proof args must be an object')
}
const unknownKeys = Object.keys(args).filter(key => !['model', 'marker'].includes(key))
if (unknownKeys.length) throw new Error(`provider-proof received unknown args: ${unknownKeys.join(', ')}`)

const printable = (value, field, limit) => {
  if (typeof value !== 'string' || !value || value.length > limit || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`provider-proof args.${field} must be a non-empty printable string of at most ${limit} characters`)
  }
  return value
}
const model = printable(args.model, 'model', 256)
const marker = printable(args.marker, 'marker', 128)

const result = await agent(
  `Return the marker below exactly in the required JSON field. Do not call tools and do not add commentary.\n\nMARKER:\n${marker}`,
  {
    agentType: 'helix-cc:provider-probe',
    label: 'provider-proof:subagent',
    phase: 'Prove',
    model,
    effort: 'low',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['marker'],
      properties: { marker: { type: 'string' } },
    },
  },
)

if (!result || result.marker !== marker) throw new Error('provider-proof subagent returned the wrong marker')
return { marker, completed: true }
