import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { compileGraphFiles } from './compile.mjs'
import { renderGraphDocument } from './render.mjs'

const root = new URL('../', import.meta.url)
const definitionsDir = new URL('graph/definitions/', root)
const catalogsDir = new URL('graph/catalogs/', root)
const templatesDir = new URL('graph/templates/', root)
const runtimePath = fileURLToPath(new URL('graph/runtime.inline.js', root))
const workflowsDir = new URL('workflows/graph/', root)
const documentPath = new URL('docs/workflow-graphs.md', root)
const PRELUDE_END = Object.freeze({
  'helix-delivery': 'const plannerCount =',
  'helix-implement-review': 'let work =',
  'helix-research': 'let priorEvidence =',
  'helix-scout': 'const recon =',
  'helix-ship-pre-pr': 'const intent =',
  'helix-tdd-fix': 'const baselineReport =',
})
const EXTRACTED_PRELUDE = new Set(['helix-delivery', 'helix-research', 'helix-ship-pre-pr', 'helix-tdd-fix'])

const basenames = (files, suffix) => files.filter(file => file.endsWith(suffix)).map(file => file.slice(0, -suffix.length)).sort()

export function assertMatchingGraphSources({ definitions, catalogs, templates }) {
  const expected = basenames(definitions, '.json')
  const catalogIds = basenames(catalogs, '.json')
  const templateIds = basenames(templates, '.template.js')
  if (JSON.stringify(catalogIds) !== JSON.stringify(expected)) {
    throw new Error(`graph catalog set must exactly match definitions; definitions=${expected.join(',')}; catalogs=${catalogIds.join(',')}`)
  }
  if (JSON.stringify(templateIds) !== JSON.stringify(expected)) {
    throw new Error(`graph template set must exactly match definitions; definitions=${expected.join(',')}; templates=${templateIds.join(',')}`)
  }
  return expected.map(id => `${id}.json`)
}

async function graphSourceFiles() {
  const [definitions, catalogs, templates] = await Promise.all([
    readdir(definitionsDir), readdir(catalogsDir), readdir(templatesDir),
  ])
  return assertMatchingGraphSources({ definitions, catalogs, templates })
}

export async function buildGraphArtifacts() {
  const artifacts = []
  const definitions = []
  for (const file of await graphSourceFiles()) {
    const id = file.slice(0, -'.json'.length)
    const result = await compileGraphFiles({
      definitionPath: fileURLToPath(new URL(file, definitionsDir)),
      catalogPath: fileURLToPath(new URL(file, catalogsDir)),
      templatePath: fileURLToPath(new URL(`${id}.template.js`, templatesDir)),
      runtimePath,
      originalPath: EXTRACTED_PRELUDE.has(id) ? fileURLToPath(new URL(`workflows/${id}.js`, root)) : undefined,
      preludeEnd: EXTRACTED_PRELUDE.has(id) ? PRELUDE_END[id] : undefined,
    })
    definitions.push(result.definition)
    artifacts.push({ path: new URL(`${id}.js`, workflowsDir), source: result.source })
  }
  artifacts.push({ path: documentPath, source: renderGraphDocument(definitions) })
  return artifacts
}

export async function writeGraphArtifacts() {
  const artifacts = await buildGraphArtifacts()
  await mkdir(workflowsDir, { recursive: true })
  await mkdir(new URL('docs/', root), { recursive: true })
  for (const artifact of artifacts) await writeFile(artifact.path, artifact.source)
  return artifacts
}

export async function checkGraphArtifacts() {
  const artifacts = await buildGraphArtifacts()
  const drift = []
  for (const artifact of artifacts) {
    let current
    try { current = await readFile(artifact.path, 'utf8') } catch { current = null }
    if (current !== artifact.source) drift.push(fileURLToPath(artifact.path))
  }
  const expectedWorkflows = artifacts
    .filter(artifact => artifact.path.href.startsWith(workflowsDir.href))
    .map(artifact => fileURLToPath(artifact.path))
    .sort()
  const actualWorkflows = (await readdir(workflowsDir))
    .filter(file => file.endsWith('.js'))
    .map(file => fileURLToPath(new URL(file, workflowsDir)))
    .sort()
  for (const file of actualWorkflows) if (!expectedWorkflows.includes(file)) drift.push(file)
  return { ok: drift.length === 0, drift, artifacts }
}
