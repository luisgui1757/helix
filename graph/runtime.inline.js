const GRAPH_NODE_BY_ID = new Map(GRAPH_DEFINITION.nodes.map(node => [node.id, node]))
const GRAPH_CYCLE_BY_ENTRY = new Map(GRAPH_DEFINITION.cycles.map(cycle => [cycle.entry, cycle]))
const GRAPH_CYCLE_COUNTS = Object.create(null)
let GRAPH_CURRENT = GRAPH_DEFINITION.entry
let GRAPH_STEPS = 0
const GRAPH_EXPECTED_OPERATIONS = [...new Set(GRAPH_DEFINITION.nodes.map(node => node.operation))].sort()
if (!Array.isArray(GRAPH_OPERATION_ENTRIES)
  || GRAPH_OPERATION_ENTRIES.some(entry => !Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || typeof entry[1] !== 'function')) {
  throw new Error(`graph ${GRAPH_DEFINITION.id} operation registry is malformed`)
}
const GRAPH_REGISTERED_OPERATIONS = GRAPH_OPERATION_ENTRIES.map(entry => entry[0]).sort()
if (new Set(GRAPH_REGISTERED_OPERATIONS).size !== GRAPH_REGISTERED_OPERATIONS.length
  || JSON.stringify(GRAPH_REGISTERED_OPERATIONS) !== JSON.stringify(GRAPH_EXPECTED_OPERATIONS)) {
  throw new Error(`graph ${GRAPH_DEFINITION.id} operation registry does not exactly match its definition`)
}

let GRAPH_ACTIVE_COPY = null
let GRAPH_ACTIVE_COPY_VALUES = null
const GRAPH_BOUNDARY_ARGUMENTS = (values, boundary) => {
  if (typeof GRAPH_ACTIVE_COPY_VALUES !== 'function') throw new Error(`graph ${boundary} boundary used outside an active operation`)
  return GRAPH_ACTIVE_COPY_VALUES(values, boundary)
}
const GRAPH_BOUNDARY_AGENT = values => agent(...GRAPH_BOUNDARY_ARGUMENTS(values, 'agent'))
const GRAPH_BOUNDARY_WORKFLOW = values => workflow(...GRAPH_BOUNDARY_ARGUMENTS(values, 'workflow'))

const GRAPH_COPY_STRUCTURED = (inputValue, contextKey, seen = new WeakMap(), unwrap = value => value) => {
  const value = unwrap(inputValue)
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function' || typeof value === 'symbol') throw new Error(`graph context ${contextKey} contains an unsupported ${typeof value} value`)
    return value
  }
  if (seen.has(value)) return seen.get(value)
  const error = value instanceof Error
  const descriptors = []
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw new Error(`graph context ${contextKey} contains an unsupported symbol property`)
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
    if (error && key === 'stack' && descriptor && !Object.prototype.hasOwnProperty.call(descriptor, 'value')) continue
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new Error(`graph context ${contextKey} contains an unsupported accessor property`)
    }
    if (!descriptor.configurable && !descriptor.writable && descriptor.value !== null
      && (typeof descriptor.value === 'object' || typeof descriptor.value === 'function')) {
      throw new Error(`graph context ${contextKey} contains an unsupported immutable object property`)
    }
    descriptors.push([key, descriptor])
  }
  const prototype = Reflect.getPrototypeOf(value)
  const plain = prototype === null || prototype === Object.prototype
  if (!Array.isArray(value) && !plain && !error) {
    throw new Error(`graph context ${contextKey} contains an unsupported non-structured value`)
  }
  const copy = Array.isArray(value) ? [] : error ? new Error() : Object.create(prototype)
  if (error) Reflect.deleteProperty(copy, 'stack')
  seen.set(value, copy)
  for (const [key, descriptor] of descriptors) {
    const copied = { ...descriptor, value: GRAPH_COPY_STRUCTURED(descriptor.value, contextKey, seen, unwrap) }
    if (!Reflect.defineProperty(copy, key, copied)) throw new Error(`graph context ${contextKey} could not be copied safely`)
  }
  return copy
}

const GRAPH_INITIAL_COPY_SEEN = new WeakMap()
for (const key of Reflect.ownKeys(GRAPH_STATE)) {
  if (typeof key !== 'string') throw new Error('graph state contains an unsupported symbol key')
  const descriptor = Reflect.getOwnPropertyDescriptor(GRAPH_STATE, key)
  if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
    throw new Error(`graph context ${key} contains an unsupported accessor property`)
  }
  Reflect.defineProperty(GRAPH_STATE, key, {
    ...descriptor,
    value: GRAPH_COPY_STRUCTURED(descriptor.value, key, GRAPH_INITIAL_COPY_SEEN),
  })
}

const GRAPH_OPERATION_CAPABILITY = graphNode => {
  const declaredReads = new Set(graphNode.reads)
  const declaredWrites = new Set(graphNode.writes)
  const observedWrites = new Set()
  const readonlyValues = new WeakMap()
  const readonlyMethods = new WeakMap()
  const proxyToRaw = new WeakMap()
  const stateCapabilities = new WeakSet()
  const revokes = []
  const mutation = (operation, contextKey) => { throw new Error(`graph operation attempted nested context ${operation} ${contextKey}`) }
  const propertyDescriptor = (target, key) => {
    let current = target
    while (current !== null) {
      const descriptor = Reflect.getOwnPropertyDescriptor(current, key)
      if (descriptor) return descriptor
      current = Reflect.getPrototypeOf(current)
    }
    return undefined
  }
  const readonlyDescriptor = (descriptor, contextKey) => {
    if (!descriptor) return descriptor
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new Error(`graph context ${contextKey} contains an unsupported accessor property`)
    }
    if (!descriptor.configurable && !descriptor.writable && descriptor.value !== null
      && (typeof descriptor.value === 'object' || typeof descriptor.value === 'function')) {
      throw new Error(`graph context ${contextKey} contains an unsupported immutable object property`)
    }
    return { ...descriptor, value: readonlyValue(descriptor.value, contextKey) }
  }
  const readonlyValue = (value, contextKey) => {
    if (value === null || typeof value !== 'object') {
      if (typeof value === 'function' || typeof value === 'symbol') throw new Error(`graph context ${contextKey} contains an unsupported ${typeof value} value`)
      return value
    }
    if (readonlyValues.has(value)) return readonlyValues.get(value)
    const revocable = Proxy.revocable(value, {
      get(target, key, receiver) {
        const descriptor = propertyDescriptor(target, key)
        if (descriptor && !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
          throw new Error(`graph context ${contextKey} contains an unsupported accessor property`)
        }
        const result = Reflect.get(target, key, receiver)
        if (typeof result === 'function' && Object.prototype.hasOwnProperty.call(target, key)) {
          throw new Error(`graph context ${contextKey} contains an unsupported function value`)
        }
        if (typeof result === 'function') {
          let receivers = readonlyMethods.get(result)
          if (!receivers) {
            receivers = new WeakMap()
            readonlyMethods.set(result, receivers)
          }
          if (receivers.has(receiver)) return receivers.get(receiver)
          const callable = (...args) => Reflect.apply(result, receiver, args)
          const protectedCallable = new Proxy(callable, {
            apply(_target, _thisArgument, argumentsList) { return Reflect.apply(result, receiver, argumentsList) },
            construct() { return mutation('construction through', contextKey) },
            get(_target, key) {
              if (key === Symbol.species) return undefined
              throw new Error(`graph context ${contextKey} does not expose inherited function properties`)
            },
            getPrototypeOf() { return null },
            set() { return mutation('mutation of', contextKey) },
            defineProperty() { return mutation('definition in', contextKey) },
            deleteProperty() { return mutation('deletion in', contextKey) },
            setPrototypeOf() { return mutation('prototype change in', contextKey) },
            preventExtensions() { return mutation('extension lock in', contextKey) },
          })
          receivers.set(receiver, protectedCallable)
          return protectedCallable
        }
        return readonlyValue(result, contextKey)
      },
      getPrototypeOf(target) {
        return readonlyValue(Reflect.getPrototypeOf(target), `${contextKey} prototype`)
      },
      getOwnPropertyDescriptor(target, key) {
        return readonlyDescriptor(Reflect.getOwnPropertyDescriptor(target, key), contextKey)
      },
      set() { return mutation('mutation of', contextKey) },
      defineProperty() { return mutation('definition in', contextKey) },
      deleteProperty() { return mutation('deletion in', contextKey) },
      setPrototypeOf() { return mutation('prototype change in', contextKey) },
      preventExtensions() { return mutation('extension lock in', contextKey) },
    })
    readonlyValues.set(value, revocable.proxy)
    proxyToRaw.set(revocable.proxy, value)
    revokes.push(revocable.revoke)
    return revocable.proxy
  }
  const unwrap = candidate => {
    if (stateCapabilities.has(candidate)) throw new Error('graph operation cannot copy its state capability')
    return proxyToRaw.get(candidate) || candidate
  }
  const copy = (value, contextKey, seen = new WeakMap()) => GRAPH_COPY_STRUCTURED(
    value,
    contextKey,
    seen,
    unwrap,
  )
  const copyValues = (values, boundary) => {
    const seen = new WeakMap()
    return values.map((value, index) => copy(value, `${boundary} argument ${index}`, seen))
  }
  const stateCapability = Proxy.revocable(GRAPH_STATE, {
    get(target, key, receiver) {
      if (typeof key !== 'string' || (!declaredReads.has(key) && !observedWrites.has(key))) {
        throw new Error(`graph operation attempted undeclared context read ${String(key)}`)
      }
      return readonlyValue(Reflect.get(target, key, receiver), key)
    },
    has(target, key) {
      if (typeof key !== 'string' || (!declaredReads.has(key) && !observedWrites.has(key))) {
        throw new Error(`graph operation attempted undeclared context read ${String(key)}`)
      }
      return Reflect.has(target, key)
    },
    ownKeys() {
      return [...new Set([...declaredReads, ...observedWrites])]
    },
    getOwnPropertyDescriptor(target, key) {
      if (typeof key !== 'string' || (!declaredReads.has(key) && !observedWrites.has(key))) return undefined
      return readonlyDescriptor(Reflect.getOwnPropertyDescriptor(target, key), key)
    },
    getPrototypeOf(target) {
      return readonlyValue(Reflect.getPrototypeOf(target), 'state prototype')
    },
    set(target, key, value) {
      if (typeof key !== 'string' || !declaredWrites.has(key)) {
        throw new Error(`graph operation attempted undeclared context write ${String(key)}`)
      }
      const safeValue = copy(value, key)
      observedWrites.add(key)
      return Reflect.set(target, key, safeValue)
    },
    defineProperty(_target, key) {
      throw new Error(`graph operation attempted context definition ${String(key)}`)
    },
    deleteProperty(_target, key) {
      throw new Error(`graph operation attempted context deletion ${String(key)}`)
    },
    setPrototypeOf() { throw new Error('graph operation attempted context prototype change') },
    preventExtensions() { throw new Error('graph operation attempted context extension lock') },
  })
  stateCapabilities.add(stateCapability.proxy)
  revokes.push(stateCapability.revoke)
  return {
    state: stateCapability.proxy,
    observedWrites,
    copy,
    copyValues,
    revoke() {
      for (const revoke of revokes.reverse()) revoke()
    },
  }
}

while (true) {
  GRAPH_STEPS += 1
  if (GRAPH_STEPS > GRAPH_MAX_STEPS) throw new Error(`graph ${GRAPH_DEFINITION.id} exceeded its derived ${GRAPH_MAX_STEPS}-step ceiling`)
  const graphNode = GRAPH_NODE_BY_ID.get(GRAPH_CURRENT)
  if (!graphNode) throw new Error(`graph ${GRAPH_DEFINITION.id} selected unknown node ${GRAPH_CURRENT}`)
  const graphCycle = GRAPH_CYCLE_BY_ENTRY.get(graphNode.id)
  if (graphCycle) {
    const graphLimit = graphCycle.limit.input == null ? graphCycle.limit.fixed : GRAPH_STATE[graphCycle.limit.input]
    if (!Number.isInteger(graphLimit) || graphLimit < 1 || graphLimit > graphCycle.limit.maximum) {
      throw new Error(`graph ${GRAPH_DEFINITION.id} cycle ${graphCycle.id} resolved an invalid bound`)
    }
    GRAPH_CYCLE_COUNTS[graphCycle.id] = (GRAPH_CYCLE_COUNTS[graphCycle.id] || 0) + 1
    if (GRAPH_CYCLE_COUNTS[graphCycle.id] > graphLimit) throw new Error(`graph ${GRAPH_DEFINITION.id} cycle ${graphCycle.id} exceeded its bound`)
  }
  for (const key of graphNode.reads) {
    if (!Object.prototype.hasOwnProperty.call(GRAPH_STATE, key)) throw new Error(`graph node ${graphNode.id} requires missing context ${key}`)
  }
  log(`[graph:${GRAPH_DEFINITION.id}@${GRAPH_DIGEST.slice(0, 12)}] ${graphNode.id}`)
  const graphOperation = GRAPH_OPERATION_ENTRIES.find(entry => entry[0] === graphNode.operation)?.[1]
  if (typeof graphOperation !== 'function') throw new Error(`graph node ${graphNode.id} has no registered operation ${graphNode.operation}`)
  const capability = GRAPH_OPERATION_CAPABILITY(graphNode)
  let graphResult
  let terminalResult
  try {
    GRAPH_ACTIVE_COPY = capability.copy
    GRAPH_ACTIVE_COPY_VALUES = capability.copyValues
    graphResult = await graphOperation(capability.state)
    if (graphNode.kind === 'terminal') terminalResult = capability.copy(graphResult, 'terminal result')
  } finally {
    GRAPH_ACTIVE_COPY = null
    GRAPH_ACTIVE_COPY_VALUES = null
    capability.revoke()
  }
  for (const key of graphNode.writes) {
    if (!capability.observedWrites.has(key)) throw new Error(`graph node ${graphNode.id} did not write declared context ${key}`)
  }
  if (graphNode.kind === 'terminal') return terminalResult
  const graphOutcome = graphNode.kind === 'decision' ? graphResult : 'next'
  if (typeof graphOutcome !== 'string' || !Object.prototype.hasOwnProperty.call(graphNode.transitions, graphOutcome)) {
    throw new Error(`graph node ${graphNode.id} returned undeclared outcome ${String(graphOutcome)}`)
  }
  GRAPH_CURRENT = graphNode.transitions[graphOutcome]
}
