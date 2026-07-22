import { readFile } from 'node:fs/promises'
import { parse } from 'acorn'
import { analyze } from 'eslint-scope'
import { assertValidGraph } from './validate.mjs'

const TOKENS = [
  '__GRAPH_DEFINITION__', '__GRAPH_DIGEST__', '__GRAPH_MAX_STEPS__',
  '__GRAPH_CONTEXT_SHADOWS__', '__GRAPH_OPERATION_REGISTRY__', '__GRAPH_RUNTIME__',
]

const operationBinding = name => `GRAPH_OPERATION_${name.replaceAll('-', '_')}`
const RESERVED_BINDINGS = new Set([
  'arguments', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
  'debugger', 'default', 'delete', 'do', 'else', 'enum', 'eval', 'export',
  'extends', 'false', 'finally', 'for', 'function', 'if', 'implements', 'import',
  'in', 'instanceof', 'interface', 'let', 'new', 'null', 'package', 'private',
  'protected', 'public', 'return', 'static', 'super', 'switch', 'this', 'throw',
  'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
])
const BOUNDARY_BINDINGS = new Set(['agent', 'workflow'])
const RECEIVER_MUTATORS = new Set([
  'add', 'clear', 'copyWithin', 'delete', 'fill', 'pop', 'push', 'reverse',
  'set', 'shift', 'sort', 'splice', 'unshift',
])
const STATIC_MUTATORS = new Map([
  ['Object', new Set(['assign', 'defineProperties', 'defineProperty', 'freeze', 'preventExtensions', 'seal', 'setPrototypeOf'])],
  ['Reflect', new Set(['defineProperty', 'deleteProperty', 'preventExtensions', 'set', 'setPrototypeOf'])],
])
const FUNCTION_NODES = new Set(['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'])

const nodeContains = (outer, inner) => outer.range[0] <= inner.range[0] && inner.range[1] <= outer.range[1]

function variableDeclarators(root) {
  const declarators = []
  const pending = [root]
  while (pending.length) {
    const value = pending.pop()
    if (value == null || typeof value !== 'object') continue
    if (value.type === 'VariableDeclarator') declarators.push(value)
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) pending.push(...child)
      else if (child && typeof child === 'object' && typeof child.type === 'string') pending.push(child)
    }
  }
  return declarators
}

function syntaxNodes(root) {
  const nodes = []
  const pending = [root]
  while (pending.length) {
    const value = pending.pop()
    if (value == null || typeof value !== 'object') continue
    if (typeof value.type === 'string') nodes.push(value)
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) pending.push(...child)
      else if (child && typeof child === 'object' && typeof child.type === 'string') pending.push(child)
    }
  }
  return nodes
}

function baseIdentifier(node) {
  let current = node
  while (current?.type === 'MemberExpression') current = current.object
  return current?.type === 'Identifier' ? current : null
}

function memberName(node) {
  if (node?.type !== 'MemberExpression') return null
  if (!node.computed && node.property.type === 'Identifier') return node.property.name
  if (node.computed && node.property.type === 'Literal' && typeof node.property.value === 'string') return node.property.value
  return null
}

function initializerDependencies(initializer, scopes) {
  const dependencies = new Set()
  for (const scope of scopes) {
    for (const reference of scope.references) {
      if (!nodeContains(initializer, reference.identifier)) continue
      dependencies.add(reference.resolved || reference.identifier.name)
    }
  }
  return dependencies
}

function resolvedVariables(node, scopes) {
  return [...initializerDependencies(node, scopes)].filter(dependency => typeof dependency !== 'string')
}

function variableDependencies(variable, scopes) {
  const dependencies = new Set()
  for (const definition of variable.defs) {
    const source = definition.type === 'Variable' ? definition.node?.init
      : ['FunctionName', 'ClassName'].includes(definition.type) ? definition.node
        : null
    if (source) for (const dependency of initializerDependencies(source, scopes)) dependencies.add(dependency)
  }
  for (const reference of variable.references) {
    if (!reference.isWrite() || !reference.writeExpr) continue
    for (const dependency of initializerDependencies(reference.writeExpr, scopes)) dependencies.add(dependency)
  }
  return dependencies
}

export function assertOperationIsolation(template, contextKeys, operationNames) {
  let ast
  try {
    ast = parse(template, { ecmaVersion: 'latest', sourceType: 'module', ranges: true })
  } catch (error) {
    throw new Error(`graph template is not valid JavaScript: ${error.message}`)
  }
  const scopeManager = analyze(ast, { ecmaVersion: 2024, sourceType: 'module' })
  const moduleScope = scopeManager.scopes.find(scope => scope.type === 'module')
  if (!moduleScope) throw new Error('graph template has no analyzable module scope')
  const bindings = new Map()
  for (const scope of scopeManager.scopes) {
    for (const variable of scope.variables) {
      const dependencies = variableDependencies(variable, scopeManager.scopes)
      if (dependencies.size || variable.defs.some(definition => ['Variable', 'FunctionName', 'ClassName'].includes(definition.type))) {
        bindings.set(variable, dependencies)
      }
    }
  }
  const references = new Map()
  for (const scope of scopeManager.scopes) {
    for (const reference of scope.references) references.set(`${reference.identifier.start}:${reference.identifier.end}`, reference)
  }
  const operationInitializers = variableDeclarators(ast)
    .filter(declaration => declaration.id?.type === 'Identifier'
      && operationNames.includes(declaration.id.name.replace(/^GRAPH_OPERATION_/, '').replaceAll('_', '-')))
    .map(declaration => declaration.init)
    .filter(Boolean)
  const insideOperation = node => operationInitializers.some(initializer => nodeContains(initializer, node))
  const resolvedIdentifier = identifier => identifier?.type === 'Identifier'
    ? references.get(`${identifier.start}:${identifier.end}`)?.resolved
    : null
  const variableDeclaredWithin = (variable, container) => variable?.defs.some(definition => definition.node && nodeContains(container, definition.node)) === true
  const variableInitializer = variable => {
    const declaration = variable?.defs.find(definition => definition.type === 'Variable' && definition.node?.init)?.node
    if (!declaration) return null
    if (declaration.id.type === 'ObjectPattern') {
      const property = declaration.id.properties.find(candidate => {
        if (candidate.type !== 'Property') return false
        const target = candidate.value.type === 'AssignmentPattern' ? candidate.value.left : candidate.value
        return target.type === 'Identifier' && target.name === variable.name
      })
      if (property) {
        return {
          type: 'MemberExpression',
          object: declaration.init,
          property: property.key,
          computed: property.computed || property.key.type !== 'Identifier',
        }
      }
    }
    return declaration.init
  }
  const classNode = variable => variable?.defs.find(definition => definition.type === 'ClassName' && definition.node?.type === 'ClassDeclaration')?.node || null
  const functionNode = variable => {
    for (const definition of variable?.defs || []) {
      if (definition.type === 'Variable' && ['ArrowFunctionExpression', 'FunctionExpression'].includes(definition.node?.init?.type)) return definition.node.init
      if (definition.type === 'FunctionName' && definition.node?.type === 'FunctionDeclaration') return definition.node
      if (definition.type === 'ClassName' && definition.node?.type === 'ClassDeclaration') {
        return definition.node.body.body.find(element => element.type === 'MethodDefinition' && element.kind === 'constructor')?.value || null
      }
    }
    return null
  }
  const functionVariables = [...bindings.keys()].filter(variable => functionNode(variable) || classNode(variable))
  const parameterVariables = new Map(functionVariables.map(variable => {
    const callable = functionNode(variable)
    if (!callable) return [variable, []]
    const scope = scopeManager.scopes.find(candidate => candidate.block === callable)
    const parameters = callable.params.map(parameter => (
      parameter.type === 'Identifier' ? scope?.variables.find(candidate => candidate.name === parameter.name) || null : null
    ))
    return [variable, parameters]
  }))
  const reachesVariable = (variable, target, seen = new Set()) => {
    if (!variable || seen.has(variable)) return false
    if (variable === target) return true
    seen.add(variable)
    return [...(bindings.get(variable) || [])].some(dependency => typeof dependency !== 'string' && reachesVariable(dependency, target, seen))
  }
  const expressionReaches = (expression, variable) => resolvedVariables(expression, scopeManager.scopes)
    .some(candidate => reachesVariable(candidate, variable))
  const directMutationTargets = node => {
    if (node.type === 'AssignmentExpression') return syntaxNodes(node.left).filter(candidate => candidate.type === 'MemberExpression')
    if (node.type === 'UpdateExpression' && node.argument.type === 'MemberExpression') return [node.argument]
    if (node.type === 'UnaryExpression' && node.operator === 'delete' && node.argument.type === 'MemberExpression') return [node.argument]
    return []
  }
  const locallyDefinedMember = expression => {
    if (expression.type !== 'MemberExpression') return false
    const method = memberName(expression)
    if (method == null) return false
    const objectVariable = expression.object.type === 'Identifier' ? resolvedIdentifier(expression.object) : null
    const initializer = objectVariable ? variableInitializer(objectVariable) : expression.object
    if (initializer?.type === 'ObjectExpression') {
      if (initializer.properties.some(property => property.type === 'Property'
        && ((!property.computed && property.key.type === 'Identifier' && property.key.name === method)
          || (property.key.type === 'Literal' && property.key.value === method))
        && (property.method || FUNCTION_NODES.has(property.value.type)))) return true
    }
    const instance = initializer?.type === 'NewExpression' ? initializer : expression.object.type === 'NewExpression' ? expression.object : null
    const classVariable = instance?.callee.type === 'Identifier' ? resolvedIdentifier(instance.callee) : objectVariable
    const definition = classNode(classVariable)
    if (definition?.body.body.some(element => element.type === 'MethodDefinition' && memberName({
      type: 'MemberExpression', object: { type: 'Identifier', name: 'class' }, property: element.key, computed: element.computed,
    }) === method)) return true
    if (!objectVariable) return false
    return syntaxNodes(ast).some(node => node.type === 'AssignmentExpression'
      && node.left.type === 'MemberExpression' && memberName(node.left) === method
      && resolvedIdentifier(baseIdentifier(node.left)) === objectVariable
      && FUNCTION_NODES.has(node.right.type))
  }
  const mutationParameters = new Map(functionVariables.map(variable => [variable, new Set()]))
  for (const variable of functionVariables) if (classNode(variable)?.superClass) mutationParameters.get(variable).add('*')
  const callableMutation = (expression, seen = new Set()) => {
    if (!expression || seen.has(expression)) return { parameters: new Set(), receiver: false, boundTargets: [] }
    seen.add(expression)
    if (expression.type === 'MemberExpression') {
      const method = memberName(expression)
      const owner = baseIdentifier(expression.object)
      if (owner && STATIC_MUTATORS.get(owner.name)?.has(method)) return { parameters: new Set([0]), receiver: false, boundTargets: [] }
      if (locallyDefinedMember(expression)) return { parameters: new Set(['*']), receiver: true, boundTargets: [] }
      if (RECEIVER_MUTATORS.has(method)) return { parameters: new Set(), receiver: true, boundTargets: [] }
    }
    if (expression.type === 'CallExpression' && expression.callee.type === 'MemberExpression' && memberName(expression.callee) === 'bind') {
      const base = callableMutation(expression.callee.object, seen)
      const boundArguments = expression.arguments.slice(1)
      const boundTargets = [...base.boundTargets]
      if (base.receiver && expression.arguments[0]) boundTargets.push(expression.arguments[0])
      const parameters = new Set()
      for (const index of base.parameters) {
        if (index === '*') parameters.add('*')
        else if (index < boundArguments.length) boundTargets.push(boundArguments[index])
        else parameters.add(index - boundArguments.length)
      }
      return { parameters, receiver: false, boundTargets }
    }
    if (expression.type !== 'Identifier') return { parameters: new Set(), receiver: false, boundTargets: [] }
    const variable = resolvedIdentifier(expression)
    if (!variable) return { parameters: new Set(), receiver: false, boundTargets: [] }
    if (mutationParameters.has(variable)) return { parameters: new Set(mutationParameters.get(variable)), receiver: false, boundTargets: [] }
    const initializer = variableInitializer(variable)
    return initializer ? callableMutation(initializer, seen) : { parameters: new Set(), receiver: false, boundTargets: [] }
  }
  const arrayElement = (container, index, seen = new Set()) => {
    if (!container || seen.has(container)) return null
    seen.add(container)
    if (container.type === 'ArrayExpression') {
      const element = container.elements[index]
      return element?.type === 'SpreadElement' ? element.argument : element || null
    }
    if (container.type !== 'Identifier') return null
    const initializer = variableInitializer(resolvedIdentifier(container))
    return initializer ? arrayElement(initializer, index, seen) : null
  }
  const callMutationTargets = node => {
    if (!['CallExpression', 'NewExpression'].includes(node.type)) return []
    let callable = node.callee
    let argumentsList = node.arguments
    let argumentsContainer = null
    let receiver = node.callee.type === 'MemberExpression' ? node.callee.object : null
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression'
      && baseIdentifier(node.callee.object)?.name === 'Reflect' && ['apply', 'construct'].includes(memberName(node.callee))) {
      callable = node.arguments[0]
      receiver = memberName(node.callee) === 'apply' ? node.arguments[1] : null
      argumentsList = null
      argumentsContainer = memberName(node.callee) === 'apply' ? node.arguments[2] : node.arguments[1]
    } else if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression'
      && ['call', 'apply'].includes(memberName(node.callee))) {
      callable = node.callee.object
      receiver = node.arguments[0]
      if (memberName(node.callee) === 'apply') {
        argumentsList = null
        argumentsContainer = node.arguments[1]
      } else argumentsList = node.arguments.slice(1)
    }
    const summary = callableMutation(callable)
    const targets = [...summary.boundTargets]
    if (summary.receiver && receiver) targets.push(receiver)
    if (summary.parameters.has('*')) {
      if (argumentsList) targets.push(...argumentsList.map(argument => argument.type === 'SpreadElement' ? argument.argument : argument))
      else if (argumentsContainer) targets.push(argumentsContainer)
      return targets
    }
    for (const index of summary.parameters) {
      const argument = argumentsList
        ? argumentsList[index] && (argumentsList[index].type === 'SpreadElement' ? argumentsList[index].argument : argumentsList[index])
        : arrayElement(argumentsContainer, index)
      if (argument) targets.push(argument)
      else if (argumentsContainer) targets.push(argumentsContainer)
    }
    return targets
  }
  let mutationSummaryChanged = true
  while (mutationSummaryChanged) {
    mutationSummaryChanged = false
    for (const variable of functionVariables) {
      const callable = functionNode(variable)
      const parameters = parameterVariables.get(variable)
      if (!callable || !parameters.length) continue
      const targets = []
      for (const node of syntaxNodes(callable.body || callable)) {
        targets.push(...directMutationTargets(node))
        targets.push(...callMutationTargets(node))
      }
      for (const [index, parameter] of parameters.entries()) {
        if (parameter && targets.some(target => expressionReaches(target, parameter)) && !mutationParameters.get(variable).has(index)) {
          mutationParameters.get(variable).add(index)
          mutationSummaryChanged = true
        }
      }
    }
  }
  const addVariableDependencies = (variable, source) => {
    if (!variable || !bindings.has(variable)) return
    const dependencies = initializerDependencies(source, scopeManager.scopes)
    dependencies.delete(variable)
    for (const dependency of dependencies) bindings.get(variable).add(dependency)
  }
  const addMutationDependencies = (target, source) => {
    const base = baseIdentifier(target)
    addVariableDependencies(base && references.get(`${base.start}:${base.end}`)?.resolved, source)
  }
  const addExpressionMutationDependencies = (expression, source) => {
    for (const variable of resolvedVariables(expression, scopeManager.scopes)) addVariableDependencies(variable, source)
  }
  for (const node of syntaxNodes(ast)) {
    if (node.type === 'Identifier' && ['eval', 'Function'].includes(node.name) && !resolvedIdentifier(node)) {
      throw new Error('graph templates may not use direct eval or dynamic source constructors')
    }
    if (node.type === 'MemberExpression' && memberName(node) === 'constructor') {
      throw new Error('graph templates may not use constructor-derived callables')
    }
    if (node.type === 'CallExpression' && !node.optional && node.callee.type === 'Identifier' && node.callee.name === 'eval') {
      throw new Error('graph templates may not use direct eval')
    }
    if (node.type === 'AssignmentExpression') {
      for (const target of syntaxNodes(node.left).filter(candidate => candidate.type === 'MemberExpression')) {
        addMutationDependencies(target, node)
      }
      continue
    }
    if (!['CallExpression', 'NewExpression'].includes(node.type)) continue
    if (insideOperation(node)) {
      for (const target of callMutationTargets(node)) addMutationDependencies(target, node)
      continue
    }
    if (node.callee.type === 'MemberExpression') addMutationDependencies(node.callee.object, node)
    for (const argument of node.arguments) {
      const expression = argument.type === 'SpreadElement' ? argument.argument : argument
      addExpressionMutationDependencies(expression, node)
    }
  }
  const context = new Set(['input', ...contextKeys])
  const unsafeDependency = dependency => {
    if (typeof dependency === 'string') return dependency === 'args' || dependency === 'arguments' || context.has(dependency)
    return dependency.name === 'arguments' || tainted.has(dependency)
  }
  const tainted = new Set(moduleScope.variables.filter(variable => context.has(variable.name)))
  for (const [variable] of bindings) {
    const definition = variable.defs.find(candidate => candidate.type === 'Variable' && candidate.node?.init)
    if (context.has(variable.name) && definition?.node.init?.type === 'UnaryExpression' && definition.node.init.operator === 'void') tainted.add(variable)
  }
  const graphState = moduleScope.variables.find(variable => variable.name === 'GRAPH_STATE')
  const pendingStateSources = graphState ? [...(bindings.get(graphState) || [])] : []
  while (pendingStateSources.length) {
    const source = pendingStateSources.pop()
    if (typeof source === 'string' || tainted.has(source)) continue
    tainted.add(source)
    pendingStateSources.push(...(bindings.get(source) || []))
  }
  let changed = true
  while (changed) {
    changed = false
    for (const [variable, dependencies] of bindings) {
      if (!tainted.has(variable) && [...dependencies].some(unsafeDependency)) {
        tainted.add(variable)
        changed = true
      }
    }
  }
  const declarations = variableDeclarators(ast)
  for (const name of operationNames) {
    const binding = operationBinding(name)
    const declaration = declarations.find(candidate => candidate.id?.type === 'Identifier' && candidate.id.name === binding)
    if (!declaration?.init) throw new Error(`graph operation ${name} has no analyzable function binding`)
    const operationVariable = [...bindings.keys()].find(variable => variable.defs.some(definition => definition.node === declaration))
    const dependencies = operationVariable ? bindings.get(operationVariable) : new Set()
    const unsafe = [...dependencies]
      .filter(unsafeDependency)
      .map(dependency => typeof dependency === 'string' ? dependency : dependency.name)
      .sort()
    if (unsafe.length) {
      throw new Error(`graph operation ${name} can reach raw context bindings: ${unsafe.join(', ')}`)
    }
    const outerWrites = []
    for (const scope of scopeManager.scopes) {
      for (const reference of scope.references) {
        if (!nodeContains(declaration.init, reference.identifier) || !reference.isWrite() || !reference.resolved) continue
        const declaredInside = reference.resolved.defs.some(definition => definition.node && nodeContains(declaration.init, definition.node))
        if (!declaredInside) outerWrites.push(reference.resolved.name)
      }
    }
    const operationNodes = syntaxNodes(declaration.init)
    for (const node of operationNodes) {
      if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
        throw new Error(`graph operation ${name} may not declare classes`)
      }
      if (node.type === 'VariableDeclarator' && node.id.type !== 'Identifier') {
        throw new Error(`graph operation ${name} may not use destructuring declarations`)
      }
      if (node.type === 'AssignmentExpression' && ['ObjectPattern', 'ArrayPattern'].includes(node.left.type)) {
        throw new Error(`graph operation ${name} may not use destructuring assignments`)
      }
      if (FUNCTION_NODES.has(node.type) && node !== declaration.init) {
        if (node.params.some(parameter => parameter.type !== 'Identifier')) {
          throw new Error(`graph operation ${name} helper parameters must be simple identifiers`)
        }
        const callableScope = scopeManager.scopes.find(scope => scope.block === node)
        const parameters = node.params
          .map(parameter => callableScope?.variables.find(variable => variable.name === parameter.name) || null)
          .filter(Boolean)
        const targets = syntaxNodes(node.body || node)
          .flatMap(candidate => [...directMutationTargets(candidate), ...callMutationTargets(candidate)])
        if (parameters.some(parameter => targets.some(target => expressionReaches(target, parameter)))) {
          throw new Error(`graph operation ${name} may not mutate helper or callback parameters`)
        }
      }
      if (node.type === 'Identifier' && ['eval', 'Function'].includes(node.name) && !resolvedIdentifier(node)) {
        throw new Error(`graph operation ${name} may not use dynamic source constructors`)
      }
      if (['CallExpression', 'NewExpression'].includes(node.type)
        && (node.callee.type === 'SequenceExpression'
          || syntaxNodes(node.callee).some(candidate => candidate.type === 'MemberExpression' && memberName(candidate) === 'constructor'))) {
        throw new Error(`graph operation ${name} uses an unanalyzable callable form`)
      }
      if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.computed && memberName(node.callee) == null) {
        throw new Error(`graph operation ${name} uses a dynamic computed method call`)
      }
      const targets = [...directMutationTargets(node), ...callMutationTargets(node)]
      for (const target of targets) {
        const pending = [...resolvedVariables(target, scopeManager.scopes)]
        const seen = new Set()
        while (pending.length) {
          const variable = pending.pop()
          if (seen.has(variable)) continue
          seen.add(variable)
          if (!variableDeclaredWithin(variable, declaration.init)) outerWrites.push(variable.name)
          else for (const dependency of bindings.get(variable) || []) if (typeof dependency !== 'string') pending.push(dependency)
        }
      }
    }
    if (outerWrites.length) {
      throw new Error(`graph operation ${name} writes outer lexical bindings: ${[...new Set(outerWrites)].sort().join(', ')}`)
    }
  }
}

export function operationNamesFromTemplate(template) {
  const markers = [...template.matchAll(/^\/\/ graph-operation: ([a-z][a-z0-9-]{0,63})$/gm)].map(match => match[1])
  const bindings = [...template.matchAll(/^\/\/ graph-operation: ([a-z][a-z0-9-]{0,63})\r?\n\s*const (GRAPH_OPERATION_[a-z0-9_]+) = async\b/gm)]
  if (bindings.length !== markers.length) throw new Error('every graph operation marker must be immediately bound to its async operation constant')
  for (const [, marker, binding] of bindings) {
    const expected = operationBinding(marker)
    if (binding !== expected) throw new Error(`graph operation marker ${marker} is bound to operation constant ${binding}; expected ${expected}`)
  }
  if (new Set(markers).size !== markers.length) throw new Error('graph operation markers must be unique')
  const declaredBindings = [...template.matchAll(/^\s*const (GRAPH_OPERATION_[a-z0-9_]+) = async\b/gm)].map(match => match[1])
  if (declaredBindings.length !== bindings.length) throw new Error('unmarked graph operation constants are forbidden')
  const graphIdentifiers = [...template.matchAll(/\bGRAPH_[A-Za-z0-9_]+\b/g)].map(match => match[0])
  const expectedIdentifiers = [
    'GRAPH_DEFINITION', 'GRAPH_DIGEST', 'GRAPH_MAX_STEPS', 'GRAPH_STATE',
    'GRAPH_OPERATION_ENTRIES', ...declaredBindings,
  ].sort()
  if (JSON.stringify(graphIdentifiers.sort()) !== JSON.stringify(expectedIdentifiers)) {
    throw new Error('graph templates may reference only their single declarations and compiler placeholders')
  }
  return markers
}

export function compileGraph({ definition, catalog, template, runtime, originalPrelude }) {
  const operationNames = operationNamesFromTemplate(template)
  if (catalog == null) throw new Error(`graph ${definition?.id || '<unknown>'} requires an operation catalog`)
  const validation = assertValidGraph(definition, { operationNames, catalog })
  for (const token of TOKENS) {
    const count = template.split(token).length - 1
    if (count !== 1) throw new Error(`graph template ${definition.id} must contain ${token} exactly once; found ${count}`)
  }
  if (!template.startsWith('export const meta =')) throw new Error(`graph template ${definition.id} metadata must be the first statement`)
  const templateWithPrelude = template.replace('__ORIGINAL_PRELUDE__', originalPrelude || '')
  const renderedDefinition = JSON.stringify(definition, null, 2)
  const contextKeys = [...new Set([
    'args', 'input',
    ...definition.initialContext,
    ...definition.nodes.flatMap(node => [...node.reads, ...node.writes]),
  ])]
  assertOperationIsolation(templateWithPrelude, contextKeys, operationNames)
  const contextShadows = contextKeys
    .filter(key => !RESERVED_BINDINGS.has(key) && !BOUNDARY_BINDINGS.has(key))
    .map(key => `  const ${key} = void 0`)
    .concat([
      '  const agent = (...values) => GRAPH_BOUNDARY_AGENT(values)',
      '  const workflow = (...values) => GRAPH_BOUNDARY_WORKFLOW(values)',
    ])
    .join('\n')
  const operationRegistry = `Object.freeze([\n${operationNames.map(name => `    Object.freeze([${JSON.stringify(name)}, ${operationBinding(name)}]),`).join('\n')}\n  ])`
  const preludeCount = template.split('__ORIGINAL_PRELUDE__').length - 1
  if (preludeCount !== (originalPrelude == null ? 0 : 1)) {
    throw new Error(`graph template ${definition.id} has an invalid original prelude placeholder count`)
  }
  const generated = templateWithPrelude
    .replace('__GRAPH_DEFINITION__', renderedDefinition)
    .replace('__GRAPH_DIGEST__', JSON.stringify(validation.digest))
    .replace('__GRAPH_MAX_STEPS__', String(validation.maxSteps))
    .replace('__GRAPH_CONTEXT_SHADOWS__', contextShadows)
    .replace('__GRAPH_OPERATION_REGISTRY__', operationRegistry)
    .replace('__GRAPH_RUNTIME__', runtime.trim())
  if (/__GRAPH_[A-Z_]+__/.test(generated)) throw new Error(`graph template ${definition.id} left an unresolved generator token`)
  return { source: `${generated.trimEnd()}\n`, ...validation }
}

export async function compileGraphFiles({ definitionPath, catalogPath, templatePath, runtimePath, originalPath, preludeEnd }) {
  const [definitionSource, catalogSource, template, runtime, original] = await Promise.all([
    readFile(definitionPath, 'utf8'),
    readFile(catalogPath, 'utf8'),
    readFile(templatePath, 'utf8'),
    readFile(runtimePath, 'utf8'),
    originalPath ? readFile(originalPath, 'utf8') : null,
  ])
  let definition
  let catalog
  try {
    definition = JSON.parse(definitionSource)
  } catch (error) {
    throw new Error(`invalid graph JSON ${definitionPath}: ${error.message}`)
  }
  try {
    catalog = JSON.parse(catalogSource)
  } catch (error) {
    throw new Error(`invalid operation catalog JSON ${catalogPath}: ${error.message}`)
  }
  let originalPrelude
  if (original != null) {
    const start = original.search(/^const parse(?:Input|Object) =/m)
    const end = original.indexOf(preludeEnd, start)
    if (start < 0 || end < 0 || end <= start) throw new Error(`could not extract original prelude for ${definition.id}`)
    originalPrelude = original.slice(start, end).trimEnd()
  }
  return { definition, catalog, ...compileGraph({ definition, catalog, template, runtime, originalPrelude }) }
}
