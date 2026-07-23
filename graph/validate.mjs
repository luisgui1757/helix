import { createHash } from 'node:crypto'
import {
  EFFECTS,
  GRAPH_VERSION,
  NODE_KINDS,
  assertClosedObject,
  isPlainObject,
  stableStringify,
} from './schema.mjs'

const ID = /^[a-z][a-z0-9-]{0,63}$/
const CONTEXT_KEY = /^[a-z][A-Za-z0-9]{0,63}$/
const DEFINITION_KEYS = [
  'version', 'id', 'title', 'description', 'entry', 'initialContext', 'nodes',
  'cycles', 'approvalTerminals', 'approvalRequirements',
]
const NODE_KEYS = ['id', 'label', 'kind', 'operation', 'effect', 'mutatesCheckout', 'reads', 'writes', 'tags', 'transitions']
const CYCLE_KEYS = ['id', 'entry', 'nodes', 'limit']
const LIMIT_KEYS = ['input', 'fixed', 'maximum']
const CATALOG_KEYS = ['version', 'id', 'operations']
const OPERATION_KEYS = ['name', 'kind', 'effect', 'mutatesCheckout', 'reads', 'writes', 'tags', 'outcomes']

const unique = values => new Set(values).size === values.length

function adjacency(definition) {
  return new Map(definition.nodes.map(node => [node.id, Object.values(node.transitions || {})]))
}

function reachableFrom(entry, edges, excluded = new Set()) {
  const seen = new Set()
  const pending = excluded.has(entry) ? [] : [entry]
  while (pending.length) {
    const node = pending.pop()
    if (seen.has(node) || excluded.has(node)) continue
    seen.add(node)
    for (const next of edges.get(node) || []) if (!seen.has(next) && !excluded.has(next)) pending.push(next)
  }
  return seen
}

function stronglyConnectedComponents(nodes, edges) {
  let index = 0
  const indexes = new Map()
  const low = new Map()
  const stack = []
  const onStack = new Set()
  const components = []

  const visit = node => {
    indexes.set(node, index)
    low.set(node, index)
    index += 1
    stack.push(node)
    onStack.add(node)
    for (const next of edges.get(node) || []) {
      if (!indexes.has(next)) {
        visit(next)
        low.set(node, Math.min(low.get(node), low.get(next)))
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node), indexes.get(next)))
      }
    }
    if (low.get(node) !== indexes.get(node)) return
    const component = []
    while (stack.length) {
      const member = stack.pop()
      onStack.delete(member)
      component.push(member)
      if (member === node) break
    }
    components.push(component)
  }

  for (const node of nodes) if (!indexes.has(node)) visit(node)
  return components
}

function isCyclic(component, edges) {
  return component.length > 1 || (edges.get(component[0]) || []).includes(component[0])
}

function containsCycle(nodes, edges, excluded = new Set()) {
  const allowed = new Set(nodes.filter(node => !excluded.has(node)))
  const visiting = new Set()
  const visited = new Set()
  const visit = node => {
    if (visiting.has(node)) return true
    if (visited.has(node)) return false
    visiting.add(node)
    for (const next of edges.get(node) || []) {
      if (allowed.has(next) && visit(next)) return true
    }
    visiting.delete(node)
    visited.add(node)
    return false
  }
  return [...allowed].some(visit)
}

function everyApprovalPathSatisfies(definition, nodesById, errors) {
  const approvals = new Set(definition.approvalTerminals)
  const requirements = definition.approvalRequirements
  if (!approvals.size || !requirements.length) return
  const initialMask = 0
  const completeMask = (1 << requirements.length) - 1
  const pending = [{ id: definition.entry, mask: initialMask }]
  const seen = new Set()

  while (pending.length) {
    const item = pending.pop()
    const key = `${item.id}:${item.mask}`
    if (seen.has(key)) continue
    seen.add(key)
    const node = nodesById.get(item.id)
    let mask = item.mask
    if (approvals.has(node.id) && mask !== completeMask) {
      const missing = requirements.filter((_tag, index) => !(mask & (1 << index)))
      errors.push(`approval terminal ${node.id} is reachable without fresh requirements: ${missing.join(', ')}`)
      return
    }
    if (node.mutatesCheckout) mask = 0
    for (const tag of node.tags) {
      const index = requirements.indexOf(tag)
      if (index >= 0) mask |= 1 << index
    }
    for (const next of Object.values(node.transitions)) pending.push({ id: next, mask })
  }
}

export function validateOperationCatalog(catalog) {
  const errors = []
  if (!assertClosedObject(catalog, CATALOG_KEYS, 'operation catalog', errors)) return { valid: false, errors }
  if (catalog.version !== GRAPH_VERSION) errors.push(`operation catalog version must be ${GRAPH_VERSION}`)
  if (typeof catalog.id !== 'string' || !ID.test(catalog.id)) errors.push('operation catalog id is invalid')
  if (!Array.isArray(catalog.operations) || catalog.operations.length < 2 || catalog.operations.length > 128) {
    errors.push('operation catalog must contain 2 through 128 entries')
    return { valid: false, errors }
  }
  const names = new Set()
  for (const [index, operation] of catalog.operations.entries()) {
    const label = `operations[${index}]`
    if (!assertClosedObject(operation, OPERATION_KEYS, label, errors)) continue
    if (typeof operation.name !== 'string' || !ID.test(operation.name) || names.has(operation.name)) errors.push(`${label}.name is invalid or duplicated`)
    else names.add(operation.name)
    if (!NODE_KINDS.includes(operation.kind)) errors.push(`${label}.kind is invalid`)
    if (!EFFECTS.includes(operation.effect)) errors.push(`${label}.effect is invalid`)
    if (typeof operation.mutatesCheckout !== 'boolean') errors.push(`${label}.mutatesCheckout must be boolean`)
    for (const field of ['reads', 'writes', 'tags', 'outcomes']) {
      const maximum = field === 'tags' ? 8 : field === 'outcomes' ? 32 : 128
      const grammar = ['reads', 'writes'].includes(field) ? CONTEXT_KEY : ID
      if (!Array.isArray(operation[field]) || operation[field].length > maximum || !unique(operation[field])
        || operation[field].some(value => typeof value !== 'string' || !grammar.test(value))) {
        errors.push(`${label}.${field} must contain unique bounded identifiers`)
      }
    }
    if (!Array.isArray(operation.outcomes)) continue
    if (operation.kind === 'terminal' && operation.outcomes.length) errors.push(`${label} terminal cannot expose outcomes`)
    if (operation.kind !== 'terminal' && !operation.outcomes.length) errors.push(`${label} non-terminal needs outcomes`)
    if (operation.kind !== 'decision' && operation.kind !== 'terminal'
      && stableStringify([...operation.outcomes].sort()) !== stableStringify(['next'])) {
      errors.push(`${label} ${operation.kind} must expose exactly the next outcome`)
    }
    if (operation.kind === 'fork' && (operation.effect !== 'read' || operation.mutatesCheckout)) errors.push(`${label} fork must be read-only and non-mutating`)
    if (['write', 'ship'].includes(operation.effect) && operation.mutatesCheckout !== true) errors.push(`${label} ${operation.effect} effect must mutate checkout`)
    if (operation.mutatesCheckout && operation.tags?.length) errors.push(`${label} mutating operation cannot attest freshness tags`)
  }
  return { valid: errors.length === 0, errors }
}

function validateContextDataflow(definition, nodesById, edges, errors) {
  const predecessors = new Map(definition.nodes.map(node => [node.id, []]))
  for (const node of definition.nodes) {
    for (const next of Object.values(node.transitions)) predecessors.get(next)?.push(node.id)
  }
  const allKeys = new Set([
    ...definition.initialContext,
    ...definition.nodes.flatMap(node => node.writes),
  ])
  const mustIn = new Map()
  const mustOut = new Map()
  const universe = new Set(allKeys)
  for (const node of definition.nodes) {
    mustIn.set(node.id, node.id === definition.entry ? new Set(definition.initialContext) : new Set(universe))
    mustOut.set(node.id, new Set(universe))
  }

  let changed = true
  let rounds = 0
  const maximumRounds = definition.nodes.length * Math.max(1, allKeys.size) + 1
  while (changed && rounds <= maximumRounds) {
    changed = false
    rounds += 1
    for (const node of definition.nodes) {
      let incoming
      if (node.id === definition.entry) incoming = new Set(definition.initialContext)
      else {
        const prior = predecessors.get(node.id) || []
        incoming = prior.length
          ? new Set([...mustOut.get(prior[0])].filter(key => prior.every(id => mustOut.get(id).has(key))))
          : new Set()
      }
      const outgoing = new Set([...incoming, ...node.writes])
      if (stableStringify([...incoming].sort()) !== stableStringify([...mustIn.get(node.id)].sort())) {
        mustIn.set(node.id, incoming)
        changed = true
      }
      if (stableStringify([...outgoing].sort()) !== stableStringify([...mustOut.get(node.id)].sort())) {
        mustOut.set(node.id, outgoing)
        changed = true
      }
    }
  }
  if (changed) errors.push('context dataflow did not converge within its finite bound')

  for (const node of definition.nodes) {
    const absent = node.reads.filter(key => !mustIn.get(node.id).has(key))
    if (absent.length) errors.push(`node ${node.id} can read unavailable context: ${absent.join(', ')}`)
  }

  for (const node of definition.nodes) {
    if ((edges.get(node.id) || []).includes(node.id) && node.writes.some(key => !node.reads.includes(key))) {
      errors.push(`self-loop node ${node.id} must declare each repeated write as a read`)
    }
  }
}

export function validateGraph(definition, { operationNames, catalog } = {}) {
  const errors = []
  if (!assertClosedObject(definition, DEFINITION_KEYS, 'graph definition', errors)) return { valid: false, errors }
  if (definition.version !== GRAPH_VERSION) errors.push(`graph version must be ${GRAPH_VERSION}`)
  if (typeof definition.id !== 'string' || !ID.test(definition.id)) errors.push('graph id is invalid')
  if (typeof definition.title !== 'string' || !definition.title.trim() || definition.title.length > 160) errors.push('graph title must contain 1 through 160 characters')
  if (typeof definition.description !== 'string' || !definition.description.trim() || definition.description.length > 4096) errors.push('graph description must contain 1 through 4,096 characters')
  if (typeof definition.entry !== 'string' || !ID.test(definition.entry)) errors.push('graph entry is invalid')
  if (!Array.isArray(definition.initialContext) || definition.initialContext.length > 128 || !unique(definition.initialContext)
    || definition.initialContext.some(key => typeof key !== 'string' || !CONTEXT_KEY.test(key))) errors.push('initialContext must contain unique context keys')
  if (!Array.isArray(definition.nodes) || definition.nodes.length < 2 || definition.nodes.length > 128) {
    errors.push('graph nodes must contain 2 through 128 entries')
    return { valid: false, errors }
  }
  if (!Array.isArray(definition.cycles) || definition.cycles.length > 16) errors.push('graph cycles must be an array of at most 16 entries')
  if (!Array.isArray(definition.approvalTerminals) || definition.approvalTerminals.length > 32
    || !unique(definition.approvalTerminals) || definition.approvalTerminals.some(id => typeof id !== 'string' || !ID.test(id))) {
    errors.push('approvalTerminals must contain at most 32 unique node IDs')
  }
  if (!Array.isArray(definition.approvalRequirements) || definition.approvalRequirements.length > 8
    || !unique(definition.approvalRequirements) || definition.approvalRequirements.some(tag => typeof tag !== 'string' || !ID.test(tag))) {
    errors.push('approvalRequirements must contain at most eight unique tags')
  }
  if (operationNames != null && (!Array.isArray(operationNames) || !unique(operationNames)
    || operationNames.some(name => typeof name !== 'string' || !ID.test(name)))) {
    errors.push('operationNames must contain unique valid operation IDs')
  }
  let operationsByName
  if (catalog != null) {
    const catalogValidation = validateOperationCatalog(catalog)
    errors.push(...catalogValidation.errors)
    if (catalogValidation.valid) {
      if (catalog.id !== definition.id) errors.push(`operation catalog id ${catalog.id} does not match graph ${definition.id}`)
      operationsByName = new Map(catalog.operations.map(operation => [operation.name, operation]))
    }
  }

  const nodesById = new Map()
  for (const [index, node] of definition.nodes.entries()) {
    const label = `nodes[${index}]`
    if (!assertClosedObject(node, NODE_KEYS, label, errors)) continue
    if (typeof node.id !== 'string' || !ID.test(node.id)) errors.push(`${label}.id is invalid`)
    else if (nodesById.has(node.id)) errors.push(`duplicate node id: ${node.id}`)
    else nodesById.set(node.id, node)
    if (typeof node.label !== 'string' || !node.label.trim() || node.label.length > 160) errors.push(`${label}.label is invalid`)
    if (!NODE_KINDS.includes(node.kind)) errors.push(`${label}.kind is invalid`)
    if (typeof node.operation !== 'string' || !ID.test(node.operation)) errors.push(`${label}.operation is invalid`)
    if (!EFFECTS.includes(node.effect)) errors.push(`${label}.effect is invalid`)
    if (typeof node.mutatesCheckout !== 'boolean') errors.push(`${label}.mutatesCheckout must be boolean`)
    for (const field of ['reads', 'writes', 'tags']) {
      const maximum = field === 'tags' ? 8 : 128
      const grammar = ['reads', 'writes'].includes(field) ? CONTEXT_KEY : ID
      if (!Array.isArray(node[field]) || node[field].length > maximum || !unique(node[field])
        || node[field].some(value => typeof value !== 'string' || !grammar.test(value))) {
        errors.push(`${label}.${field} must contain unique bounded identifiers`)
      }
    }
    if (!isPlainObject(node.transitions)) errors.push(`${label}.transitions must be an object`)
    else {
      if (Object.keys(node.transitions).length > 32) errors.push(`${label}.transitions has more than 32 outcomes`)
      for (const [outcome, target] of Object.entries(node.transitions)) {
        if (typeof target !== 'string' || !ID.test(outcome) || !ID.test(target)) errors.push(`${label} has an invalid transition ${outcome}`)
      }
    }
    if (node.kind === 'terminal' && Object.keys(node.transitions || {}).length) errors.push(`terminal node ${node.id} cannot have transitions`)
    if (node.kind !== 'terminal' && !Object.keys(node.transitions || {}).length) errors.push(`non-terminal node ${node.id} needs transitions`)
    if (node.kind !== 'decision' && node.kind !== 'terminal'
      && stableStringify(Object.keys(node.transitions || {}).sort()) !== stableStringify(['next'])) {
      errors.push(`${node.kind} node ${node.id} must expose exactly the next outcome`)
    }
    if (node.kind === 'fork' && (node.effect !== 'read' || node.mutatesCheckout)) errors.push(`fork node ${node.id} must be read-only and non-mutating`)
    if (['write', 'ship'].includes(node.effect) && node.mutatesCheckout !== true) errors.push(`${node.effect} node ${node.id} must mutate checkout`)
    if (node.mutatesCheckout && Array.isArray(node.tags) && node.tags.length) errors.push(`mutating node ${node.id} cannot attest freshness tags`)
  }

  if (errors.length) return { valid: false, errors }

  if (!nodesById.has(definition.entry)) errors.push(`entry node does not exist: ${definition.entry}`)
  for (const node of definition.nodes) {
    for (const target of Object.values(node.transitions || {})) if (!nodesById.has(target)) errors.push(`node ${node.id} targets missing node ${target}`)
  }
  if (operationNames != null) {
    const expected = [...new Set(definition.nodes.map(node => node.operation))].sort()
    const actual = [...new Set(operationNames)].sort()
    if (stableStringify(expected) !== stableStringify(actual)) errors.push(`catalog operations do not match graph definition; expected ${expected.join(', ')}; found ${actual.join(', ')}`)
  }
  if (operationsByName) {
    const expected = [...new Set(definition.nodes.map(node => node.operation))].sort()
    const actual = [...operationsByName.keys()].sort()
    if (stableStringify(expected) !== stableStringify(actual)) {
      errors.push(`operation catalog entries do not match graph definition; expected ${expected.join(', ')}; found ${actual.join(', ')}`)
    }
    for (const node of definition.nodes) {
      const operation = operationsByName.get(node.operation)
      if (!operation) continue
      const nodeContract = {
        name: node.operation,
        kind: node.kind,
        effect: node.effect,
        mutatesCheckout: node.mutatesCheckout,
        reads: [...node.reads].sort(),
        writes: [...node.writes].sort(),
        tags: [...node.tags].sort(),
        outcomes: Object.keys(node.transitions).sort(),
      }
      const catalogContract = {
        ...operation,
        reads: [...operation.reads].sort(),
        writes: [...operation.writes].sort(),
        tags: [...operation.tags].sort(),
        outcomes: [...operation.outcomes].sort(),
      }
      if (stableStringify(nodeContract) !== stableStringify(catalogContract)) {
        errors.push(`node ${node.id} does not match registered operation contract ${node.operation}`)
      }
    }
  }

  if (errors.length) return { valid: false, errors }
  const edges = adjacency(definition)
  const reachable = reachableFrom(definition.entry, edges)
  const unreachable = definition.nodes.map(node => node.id).filter(id => !reachable.has(id))
  if (unreachable.length) errors.push(`unreachable nodes: ${unreachable.join(', ')}`)

  const terminals = definition.nodes.filter(node => node.kind === 'terminal')
  if (!terminals.length) errors.push('graph requires at least one terminal')
  for (const id of definition.approvalTerminals) {
    if (!nodesById.has(id) || nodesById.get(id).kind !== 'terminal') errors.push(`approval terminal is not a terminal node: ${id}`)
  }

  const components = stronglyConnectedComponents(definition.nodes.map(node => node.id), edges).filter(component => isCyclic(component, edges))
  const cyclesById = new Map()
  for (const [index, cycle] of definition.cycles.entries()) {
    const label = `cycles[${index}]`
    if (!assertClosedObject(cycle, CYCLE_KEYS, label, errors)) continue
    if (typeof cycle.id !== 'string' || !ID.test(cycle.id) || cyclesById.has(cycle.id)) errors.push(`${label}.id is invalid or duplicated`)
    else cyclesById.set(cycle.id, cycle)
    if (typeof cycle.entry !== 'string' || !ID.test(cycle.entry) || !nodesById.has(cycle.entry)) errors.push(`${label}.entry is invalid`)
    if (!Array.isArray(cycle.nodes) || !cycle.nodes.length || cycle.nodes.length > 128 || !unique(cycle.nodes)
      || cycle.nodes.some(id => typeof id !== 'string' || !ID.test(id) || !nodesById.has(id))) errors.push(`${label}.nodes are invalid`)
    if (assertClosedObject(cycle.limit, LIMIT_KEYS, `${label}.limit`, errors)) {
      const modes = [cycle.limit.input != null, cycle.limit.fixed != null].filter(Boolean).length
      if (modes !== 1) errors.push(`${label}.limit requires exactly one of input or fixed`)
      if (cycle.limit.input != null && (typeof cycle.limit.input !== 'string' || !CONTEXT_KEY.test(cycle.limit.input) || !definition.initialContext.includes(cycle.limit.input))) errors.push(`${label}.limit.input must name initial context`)
      if (cycle.limit.fixed != null && (!Number.isInteger(cycle.limit.fixed) || cycle.limit.fixed < 1 || cycle.limit.fixed > 100)) errors.push(`${label}.limit.fixed is invalid`)
      if (!Number.isInteger(cycle.limit.maximum) || cycle.limit.maximum < 1 || cycle.limit.maximum > 100) errors.push(`${label}.limit.maximum is invalid`)
      if (Number.isInteger(cycle.limit.fixed) && Number.isInteger(cycle.limit.maximum)
        && cycle.limit.fixed > cycle.limit.maximum) errors.push(`${label}.limit.fixed cannot exceed maximum`)
    }
  }

  if (errors.length) return { valid: false, errors }

  for (const component of components) {
    const matching = definition.cycles.filter(cycle => stableStringify([...cycle.nodes].sort()) === stableStringify([...component].sort()))
    if (matching.length !== 1) {
      errors.push(`cyclic component requires exactly one matching cycle declaration: ${[...component].sort().join(', ')}`)
      continue
    }
    const cycle = matching[0]
    if (!component.includes(cycle.entry)) errors.push(`cycle ${cycle.id} entry is outside its component`)
    if (containsCycle(component, edges, new Set([cycle.entry]))) errors.push(`cycle ${cycle.id} has a path that can loop without crossing entry ${cycle.entry}`)
  }
  if (definition.cycles.length !== components.length) errors.push('cycle declarations contain a non-cyclic or unmatched component')

  validateContextDataflow(definition, nodesById, edges, errors)
  everyApprovalPathSatisfies(definition, nodesById, errors)

  const maximumVisits = definition.cycles.reduce((sum, cycle) => sum + cycle.limit.maximum * cycle.nodes.length, 0)
  const maxSteps = definition.nodes.length + maximumVisits
  if (!Number.isSafeInteger(maxSteps) || maxSteps > 10000) errors.push('derived graph step ceiling is invalid')

  if (errors.length) return { valid: false, errors }

  return {
    valid: true,
    errors,
    digest: createHash('sha256').update(stableStringify(definition)).digest('hex'),
    maxSteps,
    components,
  }
}

export function assertValidGraph(definition, options) {
  const result = validateGraph(definition, options)
  if (!result.valid) throw new Error(`invalid graph ${definition?.id || '<unknown>'}: ${result.errors.join('; ')}`)
  return result
}
