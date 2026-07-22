import { stableStringify } from './schema.mjs'
import { assertValidGraph } from './validate.mjs'

const MERMAID_ENTITIES = Object.freeze({
  '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;',
  '[': '&#91;', ']': '&#93;', '{': '&#123;', '}': '&#125;',
  '(': '&#40;', ')': '&#41;', '|': '&#124;', '`': '&#96;',
})
const escapeMermaid = value => String(value)
  .replace(/[\r\n\u2028\u2029]+/g, ' ')
  .replace(/[&"<>\[\]{}()|`]/g, character => MERMAID_ENTITIES[character])

export function renderGraphMermaid(definition) {
  const validation = assertValidGraph(definition)
  const ids = new Map(definition.nodes.map((node, index) => [node.id, `n${index}`]))
  const lines = ['flowchart TD']
  for (const node of definition.nodes) {
    const id = ids.get(node.id)
    const capabilities = node.mutatesCheckout ? `${node.effect} · mutates checkout` : node.effect
    const label = `${escapeMermaid(node.label)}<br/><small>${escapeMermaid(capabilities)}</small>`
    if (node.kind === 'decision') lines.push(`  ${id}{"${label}"}`)
    else if (node.kind === 'terminal') lines.push(`  ${id}(["${label}"])`)
    else if (node.kind === 'fork') lines.push(`  ${id}[["${label}"]]`)
    else lines.push(`  ${id}["${label}"]`)
  }
  for (const node of definition.nodes) {
    for (const [outcome, target] of Object.entries(node.transitions)) {
      const edge = outcome === 'next' ? '-->' : `-->|${escapeMermaid(outcome)}|`
      lines.push(`  ${ids.get(node.id)} ${edge} ${ids.get(target)}`)
    }
  }
  lines.push('  classDef read fill:#e8f1ff,stroke:#4677b5,color:#10243e')
  lines.push('  classDef write fill:#fff1d6,stroke:#b7791f,color:#3d2705')
  lines.push('  classDef evidence fill:#e5f7ed,stroke:#2f855a,color:#123c2a')
  lines.push('  classDef ship fill:#ffe5e5,stroke:#c53030,color:#4a1111')
  lines.push('  classDef control fill:#eee9ff,stroke:#6b46c1,color:#26164e')
  for (const effect of ['read', 'write', 'evidence', 'ship', 'control']) {
    const members = definition.nodes.filter(node => node.effect === effect).map(node => ids.get(node.id))
    if (members.length) lines.push(`  class ${members.join(',')} ${effect}`)
  }
  return { mermaid: `${lines.join('\n')}\n`, digest: validation.digest, maxSteps: validation.maxSteps }
}

export function renderGraphDocument(definitions) {
  const ordered = [...definitions].sort((left, right) => left.id.localeCompare(right.id))
  const sections = ordered.map(definition => {
    const rendered = renderGraphMermaid(definition)
    const cycles = definition.cycles.length
      ? definition.cycles.map(cycle => `- \`${cycle.id}\`: entry \`${cycle.entry}\`, maximum ${cycle.limit.maximum} traversals.`).join('\n')
      : '- None; this workflow is acyclic.'
    return `## ${definition.title}\n\n${definition.description}\n\nDefinition digest: \`${rendered.digest}\`. Derived absolute step ceiling: \`${rendered.maxSteps}\`.\n\n\`\`\`mermaid\n${rendered.mermaid}\`\`\`\n\nCycles:\n\n${cycles}`
  })
  return `# Workflow graphs\n\nThis file is generated from the validated graph-mode definitions. Do not edit it directly; run \`npm run graph:generate\`. Original mode remains the default, and these diagrams describe only the secondary graph-mode scripts.\n\n${sections.join('\n\n')}\n`
}

export function graphDocumentFingerprint(definitions) {
  return stableStringify(definitions.map(definition => ({ id: definition.id, nodes: definition.nodes, cycles: definition.cycles })))
}
