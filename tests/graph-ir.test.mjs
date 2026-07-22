import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'
import { assertMatchingGraphSources, checkGraphArtifacts } from '../graph/artifacts.mjs'
import { compileGraph } from '../graph/compile.mjs'
import { renderGraphMermaid } from '../graph/render.mjs'
import { validateGraph, validateOperationCatalog } from '../graph/validate.mjs'

const root = new URL('../', import.meta.url)
const runtime = await readFile(new URL('graph/runtime.inline.js', root), 'utf8')

async function definitions() {
  const files = (await readdir(new URL('graph/definitions/', root))).filter(file => file.endsWith('.json')).sort()
  return Promise.all(files.map(async file => JSON.parse(await readFile(new URL(`graph/definitions/${file}`, root), 'utf8'))))
}

const mini = () => ({
  version: 1,
  id: 'mini-graph',
  title: 'Mini graph',
  description: 'A minimal valid graph.',
  entry: 'work',
  initialContext: ['input'],
  nodes: [
    { id: 'work', label: 'Work', kind: 'operation', operation: 'work', effect: 'read', mutatesCheckout: false, reads: ['input'], writes: ['output'], tags: [], transitions: { next: 'complete' } },
    { id: 'complete', label: 'Complete', kind: 'terminal', operation: 'complete', effect: 'control', mutatesCheckout: false, reads: ['output'], writes: [], tags: [], transitions: {} },
  ],
  cycles: [], approvalTerminals: ['complete'], approvalRequirements: [],
})

const catalogFor = graph => ({
  version: 1,
  id: graph.id,
  operations: graph.nodes.map(node => ({
    name: node.operation,
    kind: node.kind,
    effect: node.effect,
    mutatesCheckout: node.mutatesCheckout,
    reads: [...node.reads],
    writes: [...node.writes],
    tags: [...node.tags],
    outcomes: Object.keys(node.transitions),
  })),
})

test('every shipped graph definition is closed, reachable, bounded, and digestible', async () => {
  const graphs = await definitions()
  assert.deepEqual(graphs.map(graph => graph.id), [
    'helix-delivery', 'helix-implement-review', 'helix-research',
    'helix-scout', 'helix-ship-pre-pr', 'helix-tdd-fix',
  ])
  for (const graph of graphs) {
    const catalog = JSON.parse(await readFile(new URL(`graph/catalogs/${graph.id}.json`, root), 'utf8'))
    assert.equal(validateOperationCatalog(catalog).valid, true)
    const result = validateGraph(graph, { catalog })
    assert.equal(result.valid, true, `${graph.id}: ${result.errors.join('; ')}`)
    assert.match(result.digest, /^[0-9a-f]{64}$/)
    assert.ok(result.maxSteps >= graph.nodes.length)
    assert.ok(result.maxSteps <= 10000)
  }
  const reproduction = graphs.find(graph => graph.id === 'helix-tdd-fix').nodes.find(node => node.id === 'reproduce')
  assert.deepEqual({ effect: reproduction.effect, mutatesCheckout: reproduction.mutatesCheckout }, { effect: 'evidence', mutatesCheckout: true })
})

test('definitions, catalogs, and templates must remain a closed one-to-one source set', () => {
  const valid = { definitions: ['a.json'], catalogs: ['a.json'], templates: ['a.template.js'] }
  assert.deepEqual(assertMatchingGraphSources(valid), ['a.json'])
  assert.throws(() => assertMatchingGraphSources({ ...valid, catalogs: ['a.json', 'orphan.json'] }), /catalog set must exactly match/)
  assert.throws(() => assertMatchingGraphSources({ ...valid, templates: [] }), /template set must exactly match/)
})

test('graph validation rejects malformed structure and catalog drift', () => {
  const cases = [
    ['unknown definition field', graph => { graph.extra = true }, /unknown keys: extra/],
    ['duplicate node', graph => { graph.nodes[1].id = 'work' }, /duplicate node id/],
    ['missing entry', graph => { graph.entry = 'missing' }, /entry node does not exist/],
    ['unreachable node', graph => { graph.nodes.push({ id: 'orphan', label: 'Orphan', kind: 'terminal', operation: 'orphan', effect: 'control', mutatesCheckout: false, reads: [], writes: [], tags: [], transitions: {} }) }, /unreachable nodes: orphan/],
    ['missing target', graph => { graph.nodes[0].transitions.next = 'missing' }, /targets missing node/],
    ['terminal transition', graph => { graph.nodes[1].transitions.next = 'work' }, /terminal node complete cannot have transitions/],
    ['missing nonterminal transition', graph => { graph.nodes[0].transitions = {} }, /needs transitions/],
    ['parallel writer', graph => { graph.nodes[0].kind = 'fork'; graph.nodes[0].effect = 'write' }, /fork node work must be read-only/],
    ['unavailable context', graph => { graph.nodes[0].reads.push('absent') }, /unavailable context: absent/],
    ['writer without mutation capability', graph => { graph.nodes[0].effect = 'write' }, /must mutate checkout/],
  ]
  for (const [name, mutate, expected] of cases) {
    const graph = mini()
    mutate(graph)
    assert.match(validateGraph(graph).errors.join('; '), expected, name)
  }
  assert.match(validateGraph(mini(), { operationNames: ['work'] }).errors.join('; '), /catalog operations do not match/)
  const graph = mini()
  const catalog = catalogFor(graph)
  catalog.operations[0].effect = 'write'
  catalog.operations[0].mutatesCheckout = true
  assert.match(validateGraph(graph, { catalog }).errors.join('; '), /does not match registered operation contract/)
})

test('context keys use the JavaScript-safe grammar while graph IDs may remain hyphenated', () => {
  for (const field of ['reads', 'writes']) {
    const graph = mini()
    graph.nodes[0][field] = ['bad-key']
    assert.match(validateGraph(graph).errors.join('; '), new RegExp(`nodes\\[0\\]\\.${field}`))

    const catalog = catalogFor(mini())
    catalog.operations[0][field] = ['bad-key']
    assert.match(validateOperationCatalog(catalog).errors.join('; '), new RegExp(`operations\\[0\\]\\.${field}`))
  }

  const graph = mini()
  graph.nodes[0].tags = ['fresh-proof']
  graph.approvalRequirements = ['fresh-proof']
  assert.equal(validateGraph(graph).valid, true)
})

test('graph validation reports malformed container types without throwing', () => {
  const cases = [
    ['initial context', graph => { graph.initialContext = null }, /initialContext/],
    ['cycles', graph => { graph.cycles = null }, /graph cycles/],
    ['approval terminals', graph => { graph.approvalTerminals = null }, /approvalTerminals/],
    ['approval requirements', graph => { graph.approvalRequirements = null }, /approvalRequirements/],
    ['node', graph => { graph.nodes[0] = null }, /nodes\[0\] must be an object/],
    ['node reads', graph => { graph.nodes[0].reads = null }, /nodes\[0\]\.reads/],
    ['node transitions', graph => { graph.nodes[0].transitions = null }, /nodes\[0\]\.transitions/],
    ['cycle', graph => { graph.cycles = [null] }, /cycles\[0\] must be an object/],
    ['cycle limit', graph => { graph.cycles = [{ id: 'loop', entry: 'work', nodes: ['work'], limit: null }] }, /cycles\[0\]\.limit must be an object/],
  ]
  for (const [name, mutate, expected] of cases) {
    const graph = mini()
    mutate(graph)
    let result
    assert.doesNotThrow(() => { result = validateGraph(graph) }, name)
    assert.equal(result.valid, false, name)
    assert.match(result.errors.join('; '), expected, name)
  }
  assert.doesNotThrow(() => validateGraph(mini(), { operationNames: null }))
  assert.match(validateGraph(mini(), { operationNames: 'work' }).errors.join('; '), /operationNames/)
})

test('every identifier-bearing graph and catalog field rejects non-string values', () => {
  const invalidIdentifiers = [null, true, 7, {}]
  const graphMutations = [
    graph => { graph.id = graph.value },
    graph => { graph.entry = graph.value },
    graph => { graph.initialContext[0] = graph.value },
    graph => { graph.approvalTerminals[0] = graph.value },
    graph => { graph.approvalRequirements = [graph.value] },
    graph => { graph.nodes[0].id = graph.value },
    graph => { graph.nodes[0].operation = graph.value },
    graph => { graph.nodes[0].reads[0] = graph.value },
    graph => { graph.nodes[0].writes[0] = graph.value },
    graph => { graph.nodes[0].tags = [graph.value] },
    graph => { graph.nodes[0].transitions.next = graph.value },
  ]
  for (const value of invalidIdentifiers) {
    for (const mutate of graphMutations) {
      const graph = mini()
      graph.value = value
      mutate(graph)
      delete graph.value
      assert.doesNotThrow(() => validateGraph(graph))
      assert.equal(validateGraph(graph).valid, false, `graph accepted ${JSON.stringify(value)}`)
    }
    assert.equal(validateGraph(mini(), { operationNames: [value] }).valid, false)

    for (const field of ['id', 'entry', 'nodes', 'input']) {
      const graph = mini()
      graph.nodes[1] = { id: 'decide', label: 'Decide', kind: 'decision', operation: 'decide', effect: 'control', mutatesCheckout: false, reads: ['output'], writes: [], tags: [], transitions: { repeat: 'work', stop: 'complete' } }
      graph.nodes.push({ id: 'complete', label: 'Complete', kind: 'terminal', operation: 'complete', effect: 'control', mutatesCheckout: false, reads: ['output'], writes: [], tags: [], transitions: {} })
      graph.nodes[0].transitions.next = 'decide'
      graph.cycles = [{ id: 'main-loop', entry: 'work', nodes: ['work', 'decide'], limit: { fixed: 1, maximum: 1 } }]
      if (field === 'nodes') graph.cycles[0].nodes[0] = value
      else if (field === 'input') {
        delete graph.cycles[0].limit.fixed
        graph.cycles[0].limit.input = value
      } else graph.cycles[0][field] = value
      assert.doesNotThrow(() => validateGraph(graph))
      assert.equal(validateGraph(graph).valid, false, `cycle ${field} accepted ${JSON.stringify(value)}`)
    }

    const catalogId = catalogFor(mini())
    catalogId.id = value
    assert.equal(validateOperationCatalog(catalogId).valid, false)
    const catalogName = catalogFor(mini())
    catalogName.operations[0].name = value
    assert.equal(validateOperationCatalog(catalogName).valid, false)
    for (const field of ['reads', 'writes', 'tags', 'outcomes']) {
      const catalog = catalogFor(mini())
      catalog.operations[0][field] = [value]
      assert.equal(validateOperationCatalog(catalog).valid, false, `catalog ${field} accepted ${JSON.stringify(value)}`)
    }
  }
})

test('checkout mutation capability is independent, fail-closed, and allowed only before terminal approval', () => {
  const evidenceMutation = mini()
  evidenceMutation.nodes[0].effect = 'evidence'
  evidenceMutation.nodes[0].mutatesCheckout = true
  assert.equal(validateGraph(evidenceMutation).valid, true)

  const unsafeFork = mini()
  unsafeFork.nodes[0].kind = 'fork'
  unsafeFork.nodes[0].mutatesCheckout = true
  assert.match(validateGraph(unsafeFork).errors.join('; '), /fork node work must be read-only and non-mutating/)

  const unmarkedWriter = mini()
  unmarkedWriter.nodes[0].effect = 'write'
  assert.match(validateGraph(unmarkedWriter).errors.join('; '), /write node work must mutate checkout/)

  const shipment = mini()
  shipment.nodes[0].tags = ['trusted-evidence']
  shipment.nodes[1].effect = 'ship'
  shipment.nodes[1].mutatesCheckout = true
  shipment.approvalRequirements = ['trusted-evidence']
  assert.equal(validateGraph(shipment).valid, true)
})

test('cyclic components require one finite entry-crossing rail', () => {
  const graph = mini()
  graph.nodes[1] = { id: 'decide', label: 'Decide', kind: 'decision', operation: 'decide', effect: 'control', mutatesCheckout: false, reads: ['output'], writes: [], tags: [], transitions: { repeat: 'work', stop: 'complete' } }
  graph.nodes.push({ id: 'complete', label: 'Complete', kind: 'terminal', operation: 'complete', effect: 'control', mutatesCheckout: false, reads: ['output'], writes: [], tags: [], transitions: {} })
  graph.nodes[0].transitions.next = 'decide'
  assert.match(validateGraph(graph).errors.join('; '), /requires exactly one matching cycle declaration/)
  graph.cycles = [{ id: 'main-loop', entry: 'work', nodes: ['work', 'decide'], limit: { fixed: 2, maximum: 2 } }]
  assert.equal(validateGraph(graph).valid, true)
  graph.cycles[0].limit.fixed = 3
  assert.match(validateGraph(graph).errors.join('; '), /limit\.fixed cannot exceed maximum/)
  graph.cycles[0].limit.fixed = 2
  graph.cycles[0].entry = 'decide'
  assert.equal(validateGraph(graph).valid, true)
  graph.initialContext.push('output')
  graph.nodes[0].kind = 'decision'
  graph.nodes[0].reads.push('output')
  graph.nodes[0].writes = []
  graph.nodes[0].transitions = { again: 'work', next: 'decide' }
  assert.match(validateGraph(graph).errors.join('; '), /loop without crossing entry decide/)

})

test('approval analysis rejects a writer-to-success bypass around fresh requirements', () => {
  const graph = mini()
  graph.nodes[0].effect = 'write'
  graph.nodes[0].mutatesCheckout = true
  graph.nodes.splice(1, 0, { id: 'evidence', label: 'Evidence', kind: 'operation', operation: 'evidence', effect: 'evidence', mutatesCheckout: false, reads: ['output'], writes: ['proof'], tags: ['trusted-evidence'], transitions: { next: 'complete' } })
  graph.nodes[2].reads.push('proof')
  graph.nodes[0].transitions = { next: 'evidence' }
  graph.approvalRequirements = ['trusted-evidence']
  assert.equal(validateGraph(graph).valid, true)
  graph.nodes[0].tags = ['trusted-evidence']
  graph.nodes.splice(1, 1)
  graph.nodes[1].reads = ['output']
  graph.nodes[0].transitions = { next: 'complete' }
  assert.match(validateGraph(graph).errors.join('; '), /mutating node work cannot attest freshness tags/)

  graph.nodes[0].tags = []
  assert.match(validateGraph(graph).errors.join('; '), /approval terminal complete is reachable without fresh requirements/)
})

test('compiler binds operation catalogs, digest, ceiling, and standalone runtime deterministically', () => {
  const graph = mini()
  const template = `export const meta = { name: 'mini', description: 'mini', whenToUse: 'test', phases: [] }\nconst GRAPH_DEFINITION = __GRAPH_DEFINITION__\nconst GRAPH_DIGEST = __GRAPH_DIGEST__\nconst GRAPH_MAX_STEPS = __GRAPH_MAX_STEPS__\nconst GRAPH_STATE = { input: 1 }\nconst GRAPH_OPERATION_ENTRIES = (() => {\n__GRAPH_CONTEXT_SHADOWS__\n// graph-operation: work\nconst GRAPH_OPERATION_work = async state => { state.output = state.input + 1 }\n// graph-operation: complete\nconst GRAPH_OPERATION_complete = async state => state.output\n  return __GRAPH_OPERATION_REGISTRY__\n})()\n__GRAPH_RUNTIME__\n`
  const catalog = catalogFor(graph)
  const first = compileGraph({ definition: graph, catalog, template, runtime })
  const second = compileGraph({ definition: structuredClone(graph), catalog: structuredClone(catalog), template, runtime })
  assert.equal(first.source, second.source)
  assert.match(first.source, new RegExp(first.digest))
  assert.doesNotMatch(first.source, /__GRAPH_/)
  assert.match(first.source, /Object\.freeze\(\["work", GRAPH_OPERATION_work\]\)/)
  assert.throws(() => compileGraph({ definition: graph, catalog, template: template.replace('// graph-operation: work\n', ''), runtime }), /unmarked graph operation constants/)
  assert.throws(() => compileGraph({ definition: graph, catalog, template: template.replace('GRAPH_OPERATION_work', 'GRAPH_OPERATION_renamed'), runtime }), /expected GRAPH_OPERATION_work/)
  const duplicate = template.replace('// graph-operation: complete', '// graph-operation: work\nconst GRAPH_OPERATION_work = async () => 99\n// graph-operation: complete')
  assert.throws(() => compileGraph({ definition: graph, catalog, template: duplicate, runtime }), /markers must be unique/)
  const decoy = template.replace('  return __GRAPH_OPERATION_REGISTRY__', 'const GRAPH_OPERATION_decoy = async () => 99\n  return __GRAPH_OPERATION_REGISTRY__')
  assert.throws(() => compileGraph({ definition: graph, catalog, template: decoy, runtime }), /unmarked graph operation constants/)
  const directState = template.replace('state.input + 1', 'GRAPH_STATE.input + 1')
  assert.throws(() => compileGraph({ definition: graph, catalog, template: directState, runtime }), /single declarations and compiler placeholders/)
  const directOperation = template.replace('state.input + 1', 'await GRAPH_OPERATION_complete(state)')
  assert.throws(() => compileGraph({ definition: graph, catalog, template: directOperation, runtime }), /single declarations and compiler placeholders/)
})

test('compiled runtime rejects undeclared outcomes and missing declared writes', async () => {
  const decision = mini()
  decision.nodes[0] = { id: 'work', label: 'Work', kind: 'decision', operation: 'work', effect: 'control', mutatesCheckout: false, reads: ['input'], writes: ['output'], tags: [], transitions: { done: 'complete' } }
  const template = `export const meta = { name: 'mini', description: 'mini', whenToUse: 'test', phases: [] }\nconst GRAPH_DEFINITION = __GRAPH_DEFINITION__\nconst GRAPH_DIGEST = __GRAPH_DIGEST__\nconst GRAPH_MAX_STEPS = __GRAPH_MAX_STEPS__\nconst GRAPH_STATE = { input: 1 }\nconst GRAPH_OPERATION_ENTRIES = (() => {\n__GRAPH_CONTEXT_SHADOWS__\n// graph-operation: work\nconst GRAPH_OPERATION_work = async state => 'wrong'\n// graph-operation: complete\nconst GRAPH_OPERATION_complete = async state => state.output\n  return __GRAPH_OPERATION_REGISTRY__\n})()\n__GRAPH_RUNTIME__\n`
  const catalog = catalogFor(decision)
  const source = compileGraph({ definition: decision, catalog, template, runtime }).source.replace('export const meta =', 'const meta =')
  const fn = new (Object.getPrototypeOf(async function () {}).constructor)('agent', 'parallel', 'pipeline', 'workflow', 'args', 'budget', 'log', source)
  await assert.rejects(fn(null, null, null, null, {}, {}, () => {}), /did not write declared context output/)

  const writes = template.replace("const GRAPH_OPERATION_work = async state => 'wrong'", "const GRAPH_OPERATION_work = async state => { state.output = 2; return 'wrong' }")
  const wrongOutcome = compileGraph({ definition: decision, catalog, template: writes, runtime }).source.replace('export const meta =', 'const meta =')
  const wrongFn = new (Object.getPrototypeOf(async function () {}).constructor)('agent', 'parallel', 'pipeline', 'workflow', 'args', 'budget', 'log', wrongOutcome)
  await assert.rejects(wrongFn(null, null, null, null, {}, {}, () => {}), /returned undeclared outcome wrong/)

  const stale = template.replace('const GRAPH_STATE = { input: 1 }', 'const GRAPH_STATE = { input: 1, output: 41 }')
  const staleSource = compileGraph({ definition: decision, catalog, template: stale, runtime }).source.replace('export const meta =', 'const meta =')
  const staleFn = new (Object.getPrototypeOf(async function () {}).constructor)('agent', 'parallel', 'pipeline', 'workflow', 'args', 'budget', 'log', staleSource)
  await assert.rejects(staleFn(null, null, null, null, {}, {}, () => {}), /did not write declared context output/)

  const extra = template.replace("const GRAPH_OPERATION_work = async state => 'wrong'", "const GRAPH_OPERATION_work = async state => { state.extra = 2; return 'wrong' }")
  const extraSource = compileGraph({ definition: decision, catalog, template: extra, runtime }).source.replace('export const meta =', 'const meta =')
  const extraFn = new (Object.getPrototypeOf(async function () {}).constructor)('agent', 'parallel', 'pipeline', 'workflow', 'args', 'budget', 'log', extraSource)
  await assert.rejects(extraFn(null, null, null, null, {}, {}, () => {}), /undeclared context write extra/)

  const nestedTemplate = template
    .replace('const GRAPH_STATE = { input: 1 }', 'const GRAPH_STATE = { input: { value: 1 } }')
    .replace("const GRAPH_OPERATION_work = async state => 'wrong'", "const GRAPH_OPERATION_work = async state => { state.input.value = 2; state.output = 2; return 'done' }")
  const nestedSource = compileGraph({ definition: decision, catalog, template: nestedTemplate, runtime }).source.replace('export const meta =', 'const meta =')
  const nestedFn = new (Object.getPrototypeOf(async function () {}).constructor)('agent', 'parallel', 'pipeline', 'workflow', 'args', 'budget', 'log', nestedSource)
  await assert.rejects(nestedFn(null, null, null, null, {}, {}, () => {}), /nested context mutation of input/)

  const undeclaredRead = template
    .replace('const GRAPH_STATE = { input: 1 }', 'const GRAPH_STATE = { input: 1, secret: 42 }')
    .replace("const GRAPH_OPERATION_work = async state => 'wrong'", 'const GRAPH_OPERATION_work = async state => { state.output = state.secret; return \'done\' }')
  const undeclaredReadSource = compileGraph({ definition: decision, catalog, template: undeclaredRead, runtime }).source.replace('export const meta =', 'const meta =')
  const undeclaredReadFn = new (Object.getPrototypeOf(async function () {}).constructor)('agent', 'parallel', 'pipeline', 'workflow', 'args', 'budget', 'log', undeclaredReadSource)
  await assert.rejects(undeclaredReadFn(null, null, null, null, {}, {}, () => {}), /undeclared context read secret/)

  const lexicalCapture = template
    .replace('const GRAPH_STATE = { input: 1 }', 'const input = 42\nconst GRAPH_STATE = { input }')
    .replace("const GRAPH_OPERATION_work = async state => 'wrong'", 'const GRAPH_OPERATION_work = async state => { state.output = input; return \'done\' }')
  assert.throws(() => compileGraph({ definition: decision, catalog, template: lexicalCapture, runtime }), /can reach raw context bindings: input/)

  const implicitArgumentsCapture = template
    .replace('const GRAPH_STATE = { input: 1 }', 'const GRAPH_STATE = { input: args.input }')
    .replace("const GRAPH_OPERATION_work = async state => 'wrong'", "const GRAPH_OPERATION_work = async state => { arguments[4].input.value = 2; state.output = state.input.value; return 'done' }")
  assert.throws(() => compileGraph({ definition: decision, catalog, template: implicitArgumentsCapture, runtime }), /can reach raw context bindings: arguments/)

  const evaluatedCapture = template
    .replace('const GRAPH_STATE = { input: 1 }', 'const GRAPH_STATE = { input: args.input }')
    .replace("const GRAPH_OPERATION_work = async state => 'wrong'", "const GRAPH_OPERATION_work = async state => { state.output = eval('args.input'); return 'done' }")
  assert.throws(() => compileGraph({ definition: decision, catalog, template: evaluatedCapture, runtime }), /may not use direct eval/)

  const helperCapture = template
    .replace('const GRAPH_STATE = { input: 1 }', 'const secret = 42\nconst helper = () => secret\nconst GRAPH_STATE = { input: 1, secret }')
    .replace("const GRAPH_OPERATION_work = async state => 'wrong'", 'const GRAPH_OPERATION_work = async state => { state.output = helper(); return \'done\' }')
  const helperGraph = structuredClone(decision)
  helperGraph.initialContext.push('secret')
  assert.throws(() => compileGraph({ definition: helperGraph, catalog: catalogFor(helperGraph), template: helperCapture, runtime }), /can reach raw context bindings: helper/)

  const aliasCapture = template
    .replace('const GRAPH_STATE = { input: 1 }', 'const secret = 42\nconst alias = secret\nconst helper = () => alias\nconst GRAPH_STATE = { input: 1, secret }')
    .replace("const GRAPH_OPERATION_work = async state => 'wrong'", 'const GRAPH_OPERATION_work = async state => { state.output = helper(); return \'done\' }')
  assert.throws(() => compileGraph({ definition: helperGraph, catalog: catalogFor(helperGraph), template: aliasCapture, runtime }), /can reach raw context bindings: helper/)

  const renamedCapture = template
    .replace('const GRAPH_STATE = { input: 1 }', 'const rawValue = 42\nfunction helper() { return rawValue }\nconst GRAPH_STATE = { input: rawValue }')
    .replace("const GRAPH_OPERATION_work = async state => 'wrong'", 'const GRAPH_OPERATION_work = async state => { state.output = helper(); return \'done\' }')
  assert.throws(() => compileGraph({ definition: decision, catalog, template: renamedCapture, runtime }), /can reach raw context bindings: helper/)

  const assignedCapture = template
    .replace('const GRAPH_STATE = { input: 1 }', 'const rawValue = 42\nlet helper\nhelper = () => rawValue\nconst GRAPH_STATE = { input: rawValue }')
    .replace("const GRAPH_OPERATION_work = async state => 'wrong'", 'const GRAPH_OPERATION_work = async state => { state.output = helper(); return \'done\' }')
  assert.throws(() => compileGraph({ definition: decision, catalog, template: assignedCapture, runtime }), /can reach raw context bindings: helper/)

  const propertyCapture = template
    .replace('const GRAPH_STATE = { input: 1 }', 'const helpers = {}\nhelpers.read = () => input\nconst GRAPH_STATE = { input: 1 }')
    .replace("const GRAPH_OPERATION_work = async state => 'wrong'", 'const GRAPH_OPERATION_work = async state => { state.output = helpers.read(); return \'done\' }')
  assert.throws(() => compileGraph({ definition: decision, catalog, template: propertyCapture, runtime }), /can reach raw context bindings: helpers/)

  const aggregateCaptures = [
    ['destructuring assignment', 'const holder = {}\n;({ picked: holder.value } = { picked: rawValue })'],
    ['computed Object.assign', "const holder = {}\nObject['assign'](holder, { value: rawValue })"],
    ['Object.defineProperty', "const holder = {}\nObject.defineProperty(holder, 'value', { value: rawValue })"],
    ['computed array mutator', "const holder = []\nholder['push'](rawValue)"],
    ['call-mediated mutation', 'const holder = {}\nconst attach = (target, value) => { target.value = value }\nattach(holder, rawValue)'],
    ['nested call argument', 'const holder = {}\nconst attach = bundle => { bundle.target.value = bundle.value }\nattach({ target: holder, value: rawValue })'],
    ['Reflect.apply argument array', 'const holder = {}\nconst attach = (target, value) => { target.value = value }\nReflect.apply(attach, null, [holder, rawValue])'],
    ['constructor-mediated mutation', 'const holder = {}\nfunction Attach(target, value) { target.value = value }\nnew Attach(holder, rawValue)'],
  ]
  for (const [name, setup] of aggregateCaptures) {
    const capture = template
      .replace('const GRAPH_STATE = { input: 1 }', `const rawValue = { value: 1 }\n${setup}\nconst GRAPH_STATE = { input: rawValue }`)
      .replace("const GRAPH_OPERATION_work = async state => 'wrong'", "const GRAPH_OPERATION_work = async state => { holder.value.value = 2; state.output = state.input.value; return 'done' }")
    assert.throws(() => compileGraph({ definition: decision, catalog, template: capture, runtime }), /can reach raw context bindings: holder/, name)
  }

  for (const [name, assignment] of [
    ['scalar escape', 'hidden = state.input.value'],
    ['nested escape', 'hidden = state.input'],
  ]) {
    const escape = template
      .replace('const GRAPH_STATE = { input: 1 }', 'let hidden\nconst GRAPH_STATE = { input: { value: 1 } }')
      .replace("const GRAPH_OPERATION_work = async state => 'wrong'", `const GRAPH_OPERATION_work = async state => { ${assignment}; state.output = 1; return 'done' }`)
    assert.throws(() => compileGraph({ definition: decision, catalog, template: escape, runtime }), /writes outer lexical bindings: .*hidden/, name)
  }

  for (const [name, setup, mutation] of [
    ['property assignment', 'const hidden = {}', 'hidden.value = state.input.value'],
    ['property update', 'const hidden = { value: 0 }', 'hidden.value++'],
    ['property deletion', 'const hidden = { value: 0 }', 'delete hidden.value'],
    ['Object.assign', 'const hidden = {}', 'Object.assign(hidden, { value: state.input.value })'],
    ['receiver mutator', 'const hidden = []', 'hidden.push(state.input.value)'],
    ['custom mutator', 'const hidden = {}\nconst attach = (target, value) => { target.value = value }', 'attach(hidden, state.input.value)'],
    ['nested custom mutator', 'const hidden = {}\nconst attach = bundle => { bundle.target.value = bundle.value }', 'attach({ target: hidden, value: state.input.value })'],
    ['Reflect.apply mutator', 'const hidden = {}\nconst attach = (target, value) => { target.value = value }', 'Reflect.apply(attach, null, [hidden, state.input.value])'],
    ['constructor mutator', 'const hidden = {}\nfunction Attach(target, value) { target.value = value }', 'new Attach(hidden, state.input.value)'],
    ['class constructor mutator', 'const hidden = {}\nclass Attach { constructor(target, value) { target.value = value } }', 'new Attach(hidden, state.input.value)'],
    ['aliased built-in mutator', 'const hidden = {}\nconst assign = Object.assign', 'assign(hidden, { value: state.input.value })'],
    ['built-in call mutator', 'const hidden = {}', 'Object.assign.call(null, hidden, { value: state.input.value })'],
    ['built-in Reflect.apply mutator', 'const hidden = {}', 'Reflect.apply(Object.assign, null, [hidden, { value: state.input.value }])'],
    ['operation-local aggregate mutator', 'const hidden = {}\nconst attach = bundle => { bundle.target.value = bundle.value }', 'const box = { target: hidden, value: state.input.value }; attach(box)'],
    ['variable apply arguments', 'const hidden = {}\nconst attach = (target, value) => { target.value = value }', 'const callArgs = [hidden, state.input.value]; Reflect.apply(attach, null, callArgs)'],
    ['mutated variable apply arguments', 'const hidden = {}\nconst attach = (target, value) => { target.value = value }', 'const callArgs = []; callArgs.push(hidden, state.input.value); Reflect.apply(attach, null, callArgs)'],
    ['operation-local target alias', 'const hidden = {}\nfunction Attach(target, value) { target.value = value }', 'const target = hidden; new Attach(target, state.input.value)'],
    ['function apply mutator', 'const hidden = {}\nconst attach = (target, value) => { target.value = value }', 'attach.apply(null, [hidden, state.input.value])'],
    ['bound mutator', 'const hidden = {}\nconst attach = (target, value) => { target.value = value }\nconst bound = attach.bind(null, hidden)', 'bound(state.input.value)'],
    ['Reflect.construct mutator', 'const hidden = {}\nfunction Attach(target, value) { target.value = value }', 'Reflect.construct(Attach, [hidden, state.input.value])'],
  ]) {
    const escape = template
      .replace('const GRAPH_STATE = { input: 1 }', `${setup}\nconst GRAPH_STATE = { input: { value: 1 } }`)
      .replace("const GRAPH_OPERATION_work = async state => 'wrong'", `const GRAPH_OPERATION_work = async state => { ${mutation}; state.output = 1; return 'done' }`)
    assert.throws(() => compileGraph({ definition: decision, catalog, template: escape, runtime }), /writes outer lexical bindings: .*hidden/, name)
  }

  const dynamicMethod = template
    .replace('const GRAPH_STATE = { input: 1 }', "const hidden = {}\nconst method = 'assign'\nconst GRAPH_STATE = { input: { value: 1 } }")
    .replace("const GRAPH_OPERATION_work = async state => 'wrong'", "const GRAPH_OPERATION_work = async state => { Object[method](hidden, { value: state.input.value }); state.output = 1; return 'done' }")
  assert.throws(() => compileGraph({ definition: decision, catalog, template: dynamicMethod, runtime }), /dynamic computed method call/)

  for (const [name, mutation] of [
    ['destructured object parameter', 'const mutate = ({ target }) => { target.value = 1 }; mutate({ target: hidden })'],
    ['destructured array parameter', 'const mutate = ([target]) => { target.value = 1 }; mutate([hidden])'],
    ['rest parameter', 'const mutate = (...targets) => { targets[0].value = 1 }; mutate(hidden)'],
    ['aggregate method', 'const helpers = { mutate(target) { target.value = 1 } }; helpers.mutate(hidden)'],
    ['assigned aggregate method', 'const helpers = {}; helpers.mutate = target => { target.value = 1 }; helpers.mutate(hidden)'],
    ['class method', 'class Helper { mutate(target) { target.value = 1 } }; new Helper().mutate(hidden)'],
    ['inline IIFE', '((target) => { target.value = 1 })(hidden)'],
    ['sequence callee', 'const mutate = target => { target.value = 1 }; (0, mutate)(hidden)'],
    ['mutating callback', '[hidden].forEach(target => { target.value = 1 })'],
    ['destructured built-in', 'const { assign } = Object; assign(hidden, { value: 1 })'],
    ['dynamic function constructor', 'new Function(\'target\', \'target.value = 1\')(hidden)'],
  ]) {
    const escape = template
      .replace('const GRAPH_STATE = { input: 1 }', 'const hidden = {}\nconst GRAPH_STATE = { input: { value: 1 } }')
      .replace("const GRAPH_OPERATION_work = async state => 'wrong'", `const GRAPH_OPERATION_work = async state => { ${mutation}; state.output = 1; return 'done' }`)
    assert.throws(() => compileGraph({ definition: decision, catalog, template: escape, runtime }), /graph operation work|graph templates may not/, name)
  }

  for (const [name, setup, mutation, expected] of [
    ['outer destructured built-in', 'const hidden = {}\nconst { assign } = Object', 'assign(hidden, { value: state.input.value })', /writes outer lexical bindings: .*hidden/],
    ['outer object method', 'const hidden = {}\nconst helpers = { mutate(target) { target.value = 1 } }', 'helpers.mutate(hidden)', /writes outer lexical bindings: .*hidden/],
    ['outer assigned object method', 'const hidden = {}\nconst helpers = {}\nhelpers.mutate = target => { target.value = 1 }', 'helpers.mutate(hidden)', /writes outer lexical bindings: .*hidden/],
    ['aliased eval', 'const run = eval', "run('1')", /may not use direct eval/],
    ['constructor-derived callable', 'const Factory = (() => {}).constructor', "Factory('return 1')()", /constructor-derived callables/],
  ]) {
    const escape = template
      .replace('const GRAPH_STATE = { input: 1 }', `${setup}\nconst GRAPH_STATE = { input: { value: 1 } }`)
      .replace("const GRAPH_OPERATION_work = async state => 'wrong'", `const GRAPH_OPERATION_work = async state => { ${mutation}; state.output = 1; return 'done' }`)
    assert.throws(() => compileGraph({ definition: decision, catalog, template: escape, runtime }), expected, name)
  }

  const pureHelper = template
    .replace('const GRAPH_STATE = { input: 1 }', 'const helper = value => value + 1\nconst GRAPH_STATE = { input: 1 }')
    .replace("const GRAPH_OPERATION_work = async state => 'wrong'", "const GRAPH_OPERATION_work = async state => { state.output = helper(state.input); return 'done' }")
  const pureSource = compileGraph({ definition: decision, catalog, template: pureHelper, runtime }).source.replace('export const meta =', 'const meta =')
  const pureFn = new (Object.getPrototypeOf(async function () {}).constructor)('agent', 'parallel', 'pipeline', 'workflow', 'args', 'budget', 'log', pureSource)
  assert.equal(await pureFn(null, null, null, null, {}, {}, () => {}), 2)
})

test('compiled runtime rejects nested mutation at the attempt, including mutate-restore and descriptor paths', async () => {
  const graph = mini()
  graph.initialContext = ['input']
  graph.nodes[0].reads = ['input']
  const catalog = catalogFor(graph)
  const base = operation => `export const meta = { name: 'mini', description: 'mini', whenToUse: 'test', phases: [] }\nconst GRAPH_DEFINITION = __GRAPH_DEFINITION__\nconst GRAPH_DIGEST = __GRAPH_DIGEST__\nconst GRAPH_MAX_STEPS = __GRAPH_MAX_STEPS__\nconst inputValue = { nested: { value: 1 }, list: [1] }\ninputValue.self = inputValue\nconst GRAPH_STATE = { input: inputValue }\nconst GRAPH_OPERATION_ENTRIES = (() => {\n__GRAPH_CONTEXT_SHADOWS__\n// graph-operation: work\nconst GRAPH_OPERATION_work = async state => { ${operation} }\n// graph-operation: complete\nconst GRAPH_OPERATION_complete = async state => state.output\n  return __GRAPH_OPERATION_REGISTRY__\n})()\n__GRAPH_RUNTIME__\n`
  const execute = async (operation, agentFn = null) => {
    const source = compileGraph({ definition: graph, catalog, template: base(operation), runtime }).source.replace('export const meta =', 'const meta =')
    const fn = new (Object.getPrototypeOf(async function () {}).constructor)('agent', 'parallel', 'pipeline', 'workflow', 'args', 'budget', 'log', source)
    return fn(agentFn, null, null, null, {}, {}, () => {})
  }
  await assert.rejects(execute('state.input.nested.value = 2; state.input.nested.value = 1; state.output = 2'), /nested context mutation of input/)
  await assert.rejects(execute("const nested = Object.getOwnPropertyDescriptor(state.input, 'nested').value; nested.value = 2; state.output = 2"), /nested context mutation of input/)
  await assert.rejects(execute("const raw = Object.getOwnPropertyDescriptor(state, 'input').value; raw.nested.value = 2; state.output = 2"), /nested context mutation of input/)
  await assert.rejects(execute('state.input.list.push(2); state.output = 2'), /nested context mutation of input/)
  await assert.rejects(execute('Object.setPrototypeOf(state.input.nested, null); state.output = 2'), /nested context prototype change in input/)
  await assert.rejects(execute('Object.preventExtensions(state.input.nested); state.output = 2'), /nested context extension lock in input/)
  await assert.rejects(execute("Object.defineProperty(state, 'output', { value: 2 })"), /context definition output/)
  await assert.rejects(execute('Object.freeze(state)'), /context extension lock/)
  await assert.rejects(execute('state.output = new Map()'), /unsupported non-structured value/)
  await assert.rejects(execute("state.output = Object.defineProperty({}, 'value', { get() { return 1 } })"), /unsupported accessor property/)
  await assert.rejects(execute('state.output = { leaked: state }'), /cannot copy its state capability/)
  await assert.rejects(execute('state.output = state'), /cannot copy its state capability/)
  await assert.rejects(execute('state.output = await agent(state)', async () => true), /cannot copy its state capability/)
  await assert.rejects(execute("Object.getPrototypeOf(state.input.nested).graphModePolluted = true; state.output = 2"), /nested context mutation/)
  assert.equal(Object.prototype.graphModePolluted, undefined)
  await assert.rejects(execute("state.input.nested.toString.graphModePolluted = true; state.output = 2"), /nested context mutation/)
  assert.equal(Object.prototype.toString.graphModePolluted, undefined)
  assert.equal(await execute("state.output = state.input.list.join(',')"), '1')
  assert.equal(await execute('state.output = state.input.list.flatMap(value => [value, value + 1]).join(\',\')'), '1,2')
  assert.equal(await execute('state.output = state.input.self === state.input'), true)

  let getterCalls = 0
  const accessorInput = {}
  Object.defineProperty(accessorInput, 'secret', {
    enumerable: true,
    get() { getterCalls += 1; return 9 },
  })
  const accessorTemplate = base('state.output = state.input.secret')
    .replace('const inputValue = { nested: { value: 1 }, list: [1] }\ninputValue.self = inputValue', 'const inputValue = args.input')
  const accessorSource = compileGraph({ definition: graph, catalog, template: accessorTemplate, runtime }).source.replace('export const meta =', 'const meta =')
  const accessorFn = new (Object.getPrototypeOf(async function () {}).constructor)('agent', 'parallel', 'pipeline', 'workflow', 'args', 'budget', 'log', accessorSource)
  await assert.rejects(accessorFn(null, null, null, null, { input: accessorInput }, {}, () => {}), /unsupported accessor property/)
  assert.equal(getterCalls, 0)

  let prototypeGetterCalls = 0
  const accessorPrototype = Object.create(null)
  Object.defineProperty(accessorPrototype, 'constructor', {
    get() { prototypeGetterCalls += 1; return Object },
  })
  const customPrototypeInput = Object.create(accessorPrototype)
  customPrototypeInput.secret = 9
  await assert.rejects(accessorFn(null, null, null, null, { input: customPrototypeInput }, {}, () => {}), /unsupported non-structured value/)
  assert.equal(prototypeGetterCalls, 0)

  await assert.rejects(accessorFn(null, null, null, null, { input: { secret: Symbol('secret') } }, {}, () => {}), /unsupported symbol value/)

  const aliasGraph = mini()
  aliasGraph.initialContext = ['left', 'right']
  aliasGraph.nodes[0].reads = ['left', 'right']
  const aliasTemplate = `export const meta = { name: 'alias', description: 'alias', whenToUse: 'test', phases: [] }
const GRAPH_DEFINITION = __GRAPH_DEFINITION__
const GRAPH_DIGEST = __GRAPH_DIGEST__
const GRAPH_MAX_STEPS = __GRAPH_MAX_STEPS__
const GRAPH_STATE = { left: args.left, right: args.right }
const GRAPH_OPERATION_ENTRIES = (() => {
__GRAPH_CONTEXT_SHADOWS__
// graph-operation: work
const GRAPH_OPERATION_work = async state => { state.output = state.left === state.right }
// graph-operation: complete
const GRAPH_OPERATION_complete = async state => state.output
  return __GRAPH_OPERATION_REGISTRY__
})()
__GRAPH_RUNTIME__
`
  const aliasSource = compileGraph({ definition: aliasGraph, catalog: catalogFor(aliasGraph), template: aliasTemplate, runtime }).source.replace('export const meta =', 'const meta =')
  const aliasFn = new (Object.getPrototypeOf(async function () {}).constructor)('agent', 'parallel', 'pipeline', 'workflow', 'args', 'budget', 'log', aliasSource)
  const shared = { value: 1 }
  assert.equal(await aliasFn(null, null, null, null, { left: shared, right: shared }, {}, () => {}), true)

  const boundaryAliasTemplate = aliasTemplate.replace(
    'state.output = state.left === state.right',
    'state.output = await agent(state.left, state.right)',
  )
  const boundaryAliasSource = compileGraph({ definition: aliasGraph, catalog: catalogFor(aliasGraph), template: boundaryAliasTemplate, runtime }).source.replace('export const meta =', 'const meta =')
  const boundaryAliasFn = new (Object.getPrototypeOf(async function () {}).constructor)('agent', 'parallel', 'pipeline', 'workflow', 'args', 'budget', 'log', boundaryAliasSource)
  assert.equal(await boundaryAliasFn((left, right) => left === right, null, null, null, { left: shared, right: shared }, {}, () => {}), true)
})

test('operation capabilities are revoked before an unawaited callback can reuse state', async () => {
  const graph = mini()
  graph.nodes[0].writes = ['marker']
  graph.nodes[1].reads = ['marker']
  const template = `export const meta = { name: 'mini', description: 'mini', whenToUse: 'test', phases: [] }
const GRAPH_DEFINITION = __GRAPH_DEFINITION__
const GRAPH_DIGEST = __GRAPH_DIGEST__
const GRAPH_MAX_STEPS = __GRAPH_MAX_STEPS__
let resolveLate
const late = new Promise(resolve => { resolveLate = resolve })
const GRAPH_STATE = { input: args.input }
const GRAPH_OPERATION_ENTRIES = (() => {
__GRAPH_CONTEXT_SHADOWS__
// graph-operation: work
const GRAPH_OPERATION_work = async state => {
  setTimeout(() => {
    try { resolveLate(state.input.value) } catch (error) { resolveLate(error.message) }
  }, 0)
  state.marker = true
}
// graph-operation: complete
const GRAPH_OPERATION_complete = async state => { if (!state.marker) throw new Error('missing marker'); return late }
  return __GRAPH_OPERATION_REGISTRY__
})()
__GRAPH_RUNTIME__
`
  const source = compileGraph({ definition: graph, catalog: catalogFor(graph), template, runtime }).source.replace('export const meta =', 'const meta =')
  const fn = new (Object.getPrototypeOf(async function () {}).constructor)('agent', 'parallel', 'pipeline', 'workflow', 'args', 'budget', 'log', source)
  assert.match(await fn(null, null, null, null, { input: { value: 7 } }, {}, () => {}), /revoked/)
})

test('compiled runtime enforces the declared cycle traversal bound', async () => {
  const graph = mini()
  graph.nodes[1] = { id: 'decide', label: 'Decide', kind: 'decision', operation: 'decide', effect: 'control', mutatesCheckout: false, reads: ['output'], writes: [], tags: [], transitions: { repeat: 'work', stop: 'complete' } }
  graph.nodes.push({ id: 'complete', label: 'Complete', kind: 'terminal', operation: 'complete', effect: 'control', mutatesCheckout: false, reads: ['output'], writes: [], tags: [], transitions: {} })
  graph.nodes[0].transitions.next = 'decide'
  graph.cycles = [{ id: 'main-loop', entry: 'work', nodes: ['work', 'decide'], limit: { fixed: 1, maximum: 1 } }]
  const template = `export const meta = { name: 'mini', description: 'mini', whenToUse: 'test', phases: [] }\nconst GRAPH_DEFINITION = __GRAPH_DEFINITION__\nconst GRAPH_DIGEST = __GRAPH_DIGEST__\nconst GRAPH_MAX_STEPS = __GRAPH_MAX_STEPS__\nconst GRAPH_STATE = { input: 1 }\nconst GRAPH_OPERATION_ENTRIES = (() => {\n__GRAPH_CONTEXT_SHADOWS__\n// graph-operation: work\nconst GRAPH_OPERATION_work = async state => { state.output = state.input + 1 }\n// graph-operation: decide\nconst GRAPH_OPERATION_decide = async () => 'repeat'\n// graph-operation: complete\nconst GRAPH_OPERATION_complete = async state => state.output\n  return __GRAPH_OPERATION_REGISTRY__\n})()\n__GRAPH_RUNTIME__\n`
  const source = compileGraph({ definition: graph, catalog: catalogFor(graph), template, runtime }).source.replace('export const meta =', 'const meta =')
  const fn = new (Object.getPrototypeOf(async function () {}).constructor)('agent', 'parallel', 'pipeline', 'workflow', 'args', 'budget', 'log', source)
  await assert.rejects(fn(null, null, null, null, {}, {}, () => {}), /cycle main-loop exceeded its bound/)
})

test('renderer escapes labels and generated artifacts are current', async () => {
  const graph = mini()
  graph.nodes[0].label = 'Read <source> "safely" ] | `code`\nnext'
  graph.nodes[0].mutatesCheckout = true
  const rendered = renderGraphMermaid(graph)
  assert.match(rendered.mermaid, /Read &lt;source&gt; &quot;safely&quot; &#93; &#124; &#96;code&#96; next/)
  assert.match(rendered.mermaid, /read · mutates checkout/)
  assert.doesNotMatch(rendered.mermaid, /Read <source>/)
  assert.doesNotMatch(rendered.mermaid, /\nnext/)
  const artifacts = await checkGraphArtifacts()
  assert.equal(artifacts.ok, true, artifacts.drift.join('\n'))
})

test('graph generation CLI provides a clean end-to-end drift check', () => {
  const result = spawnSync(process.execPath, ['scripts/graph-workflows.mjs', 'check'], { cwd: new URL('../', import.meta.url), encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /verified 6 graph workflows and one graph document/)
})
