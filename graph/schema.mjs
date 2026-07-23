export const GRAPH_VERSION = 1

export const NODE_KINDS = Object.freeze(['operation', 'fork', 'decision', 'terminal'])
export const EFFECTS = Object.freeze(['control', 'read', 'write', 'evidence', 'ship'])

export const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
export function assertClosedObject(value, allowed, label, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${label} must be an object`)
    return false
  }
  const unknown = Object.keys(value).filter(key => !allowed.includes(key))
  if (unknown.length) errors.push(`${label} has unknown keys: ${unknown.sort().join(', ')}`)
  return true
}
