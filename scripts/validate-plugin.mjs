import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../', import.meta.url)
const errors = []
const read = path => readFileSync(new URL(path, root), 'utf8')

function check(condition, message) {
  if (!condition) errors.push(message)
}

const manifest = JSON.parse(read('.claude-plugin/plugin.json'))
check(manifest.name === 'helix-cc', 'manifest name must be helix-cc')
check(/^\d+\.\d+\.\d+$/.test(manifest.version || ''), 'manifest version must be semver')
check(!JSON.stringify(manifest).includes('[TODO:'), 'manifest must not contain TODO placeholders')

const workflowDir = new URL('workflows/', root)
const workflowFiles = readdirSync(workflowDir).filter(file => file.endsWith('.js')).sort()
const requiredWorkflows = [
  'helix-delivery.js',
  'helix-evidence-verify.js',
  'helix-implement-review.js',
  'helix-research.js',
  'helix-scout.js',
  'helix-ship-pre-pr.js',
  'helix-tdd-fix.js',
  'provider-matrix-proof.js',
  'provider-proof.js',
]
check(JSON.stringify(workflowFiles) === JSON.stringify(requiredWorkflows), `expected exactly ${requiredWorkflows.length} workflow scripts`)
const referencedAgents = new Set()
for (const file of workflowFiles) {
  const workflowPath = `workflows/${file}`
  const workflow = read(workflowPath)
  check(Buffer.byteLength(workflow) <= 512 * 1024, `${workflowPath} exceeds Claude Code 512 KiB limit`)
  check(workflow.startsWith('export const meta ='), `${workflowPath} metadata must be the first statement`)
  check(!/^\s*(?:import|export\s+\{)/m.test(workflow.slice('export const meta ='.length)), `${workflowPath} must not import modules`)
  check(!/\b(?:require|process|Date\.now|Math\.random)\s*\(/.test(workflow), `${workflowPath} uses a forbidden host or nondeterministic API`)
  for (const match of workflow.matchAll(/agentType: 'helix-cc:([^']+)'/g)) referencedAgents.add(match[1])
  try {
    const compiled = workflow.replace('export const meta =', 'const meta =')
    new Function('agent', 'parallel', 'pipeline', 'workflow', 'args', 'budget', 'log', `return (async () => {\n${compiled}\n})()`)
  } catch (error) {
    errors.push(`${workflowPath} does not compile in the local Node syntax harness: ${error.message}`)
  }
}

const agentDir = new URL('agents/', root)
const agentFiles = readdirSync(agentDir).filter(file => file.endsWith('.md')).sort()
const requiredAgents = ['builder', 'documenter', 'evidence', 'plan-judge', 'planner', 'provider-probe', 'redteam', 'reproducer', 'reviewer', 'scout', 'shipper', 'tester', 'verifier']
check(agentFiles.length === requiredAgents.length, `expected ${requiredAgents.length} agent definitions`)
for (const name of requiredAgents) {
  const path = `agents/${name}.md`
  check(agentFiles.includes(`${name}.md`), `missing ${path}`)
  if (!agentFiles.includes(`${name}.md`)) continue
  const source = read(path)
  check(source.startsWith('---\n'), `${path} must start with YAML frontmatter`)
  check(new RegExp(`\\nname: ${name}\\n`).test(source), `${path} has the wrong name`)
  check(/\ndescription: .+\n/.test(source), `${path} needs a description`)
  check(/\ntools: .+\n/.test(source), `${path} needs an explicit tool policy`)
  check(/\neffort: (?:low|high|xhigh)\n/.test(source), `${path} needs a calibrated effort`)
}
check(JSON.stringify([...referencedAgents].sort()) === JSON.stringify(requiredAgents), 'workflow agent references must resolve to the exact agent catalog')

const skillDir = new URL('skills/', root)
const skillNames = readdirSync(skillDir).filter(name => {
  try { return statSync(new URL(`skills/${name}/SKILL.md`, root)).isFile() } catch { return false }
}).sort()
const requiredSkills = [
  'helix-doctor',
  'helix-implement-review',
  'helix-loop',
  'helix-research',
  'helix-scout',
  'helix-ship-pre-pr',
  'helix-tdd-fix',
]
check(JSON.stringify(skillNames) === JSON.stringify(requiredSkills), `expected exactly ${requiredSkills.length} skills`)
for (const name of requiredSkills) {
  const path = `skills/${name}/SKILL.md`
  const source = read(path)
  check(source.startsWith('---\n'), `${path} must start with YAML frontmatter`)
  check(new RegExp(`\\nname: ${name}\\n`).test(source), `${path} has the wrong name`)
  check(/\ndescription: .+\n/.test(source), `${path} needs a description`)
  check(/\ndisable-model-invocation: true\n/.test(source), `${path} must require explicit user invocation`)
  if (name !== 'helix-doctor') {
    check(source.includes(`scriptPath: "\${CLAUDE_PLUGIN_ROOT}/workflows/${name === 'helix-loop' ? 'helix-delivery' : name}.js"`), `${path} must invoke its canonical workflow path`)
    check(source.includes('node "${CLAUDE_PLUGIN_ROOT}/bin/helix-cc-doctor" --json'), `${path} must use the installed doctor path`)
    if (name !== 'helix-scout') {
      check(source.includes('mcp__plugin_helix-cc_helix-cc-evidence__start_session'), `${path} must start a trusted evidence session`)
      check(source.includes('evidenceSession: <exact start_session result>'), `${path} must pass the exact trusted evidence session`)
    }
  }
}

for (const path of ['docs/providers.md', 'docs/quickstart.md', 'docs/workflows.md']) {
  try {
    check(statSync(new URL(path, root)).isFile(), `missing ${path}`)
  } catch {
    errors.push(`missing ${path}`)
  }
}

const mcp = JSON.parse(read('.mcp.json'))
const evidenceMcp = mcp?.mcpServers?.['helix-cc-evidence']
check(evidenceMcp?.command === 'node', 'trusted evidence MCP server must use node')
check(JSON.stringify(evidenceMcp?.args) === JSON.stringify(['${CLAUDE_PLUGIN_ROOT}/bin/helix-cc-evidence-mcp']), 'trusted evidence MCP server must use its installed plugin path')
check(evidenceMcp?.env?.CLAUDE_PROJECT_DIR === '${CLAUDE_PROJECT_DIR}', 'trusted evidence MCP server must bind the active project directory')
check(evidenceMcp?.alwaysLoad === true, 'trusted evidence MCP server must always load')
check((statSync(new URL('bin/helix-cc-evidence-mcp', root)).mode & 0o111) !== 0, 'trusted evidence MCP server must be executable')
const pkg = JSON.parse(read('package.json'))
check(pkg.dependencies?.['@modelcontextprotocol/sdk'] === '1.29.0', 'trusted evidence MCP SDK must be an exact runtime dependency')

if (errors.length) {
  process.stderr.write(`${errors.map(error => `- ${error}`).join('\n')}\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`validated helix-cc: ${workflowFiles.length} workflows, ${agentFiles.length} agents, ${skillNames.length} skills\n`)
}
