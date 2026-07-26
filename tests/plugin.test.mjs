import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { readdir } from 'node:fs/promises'
import { stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { TRUSTED_EVIDENCE_TOOL_NAMES } from '../lib/trusted-evidence.mjs'
import { workflowFileForMode } from './workflow-harness.mjs'

const root = new URL('../', import.meta.url)
const rootPath = fileURLToPath(root)

async function workflowPaths() {
  const original = (await readdir(new URL('workflows/', root))).filter(file => file.endsWith('.js')).map(file => `workflows/${file}`)
  const graph = (await readdir(new URL('workflows/graph/', root))).filter(file => file.endsWith('.js')).map(file => `workflows/graph/${file}`)
  return [...original, ...graph].sort()
}

test('Claude plugin manifest and package versions agree', async () => {
  const manifest = JSON.parse(await readFile(new URL('.claude-plugin/plugin.json', root), 'utf8'))
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  const loopSkill = await readFile(new URL('skills/helix-loop/SKILL.md', root), 'utf8')
  assert.equal(manifest.name, 'helix-cc')
  assert.equal(manifest.version, pkg.version)
  assert.match(manifest.description, /Helix|helix/i)
  assert.match(loopSkill, /nativeClaudeWorkflow\.locallyReady/)
  assert.match(loopSkill, /cliProxyNativeWorkflow\.locallyReady/)
  assert.match(loopSkill, /gpt-5\.6-luna/)
  assert.match(loopSkill, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/helix-cc-doctor" --json/)
  assert.match(loopSkill, /managed policy[\s\S]*exact launch\/effective-model behavior remain unverified/)
  assert.doesNotMatch(loopSkill, /Stop if native workflow readiness is false/)
})

test('CLIProxyAPI helper is packaged as an executable and public docs contain no account identifier', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  const helper = await stat(new URL('bin/helix-cc-cliproxy', root))
  const launcher = await stat(new URL('bin/claudex', root))
  const setup = await stat(new URL('setup.sh', root))
  const readme = await readFile(new URL('README.md', root), 'utf8')
  const quickstart = await readFile(new URL('docs/quickstart.md', root), 'utf8')
  const proof = await readFile(new URL('docs/history/openai-subscription-proof.md', root), 'utf8')
  assert.equal(manifest.bin['helix-cc-cliproxy'], 'bin/helix-cc-cliproxy')
  assert.equal(manifest.bin.claudex, 'bin/claudex')
  assert.notEqual(helper.mode & 0o111, 0)
  assert.notEqual(launcher.mode & 0o111, 0)
  assert.notEqual(setup.mode & 0o111, 0)
  assert.match(readme, /Claudex HOW-TO/)
  assert.match(readme, /Provider reference/)
  assert.match(quickstart.replace(/\\\n\s*/g, ' ').replace(/\s+/g, ' '), /claudex --providers codex,copilot/)
  assert.match(proof, /workflowResolvedModels/)
  assert.doesNotMatch(`${readme}\n${quickstart}\n${proof}`, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  assert.doesNotMatch(`${readme}\n${quickstart}\n${proof}`, /\/Users\/(?!<)[^/\s]+|codex-[^/\s]+@[A-Z0-9.-]+/i)
})

test('every workflow role resolves to a plugin agent definition', async () => {
  const workflowFiles = await workflowPaths()
  const workflows = await Promise.all(workflowFiles.map(file => readFile(new URL(file, root), 'utf8')))
  const files = (await readdir(new URL('agents/', root))).filter(file => file.endsWith('.md'))
  const roles = workflows.flatMap(workflow => [...workflow.matchAll(/agentType: 'helix-cc:([^']+)'/g)].map(match => match[1]))
  assert.deepEqual([...new Set(roles)].sort(), files.map(file => file.replace(/\.md$/, '')).sort())
  assert.equal(workflowFiles.length, 15)
  assert.equal(files.length, 13)
})

test('writer roles are serialized and every read-only role has a non-mutating tool allowlist', async () => {
  const workflowFiles = await workflowPaths()
  for (const file of workflowFiles) {
    const workflow = await readFile(new URL(file, root), 'utf8')
    const parallelBlocks = [...workflow.matchAll(/await parallel\(([\s\S]*?)\n\s*\)/g)].map(match => match[1])
    assert.equal(parallelBlocks.some(block => /helix-cc:(?:builder|documenter|reproducer|shipper|tester)/.test(block)), false, file)
  }

  for (const role of ['planner', 'plan-judge', 'provider-probe', 'reviewer', 'redteam', 'scout', 'verifier']) {
    const source = await readFile(new URL(`agents/${role}.md`, root), 'utf8')
    assert.doesNotMatch(source.split('---')[1], /(?:Write|Edit|Bash)/)
    assert.match(source, /read-only|do not edit|without changing files/i)
  }

  const documenter = await readFile(new URL('agents/documenter.md', root), 'utf8')
  assert.match(documenter.split('---')[1], /Bash/)
  for (const agent of ['builder', 'tester', 'documenter']) {
    const source = await readFile(new URL(`agents/${agent}.md`, root), 'utf8')
    assert.match(source, /Never stage, commit, push, open a pull request, tag, release, or rewrite Git history/)
  }
  const evidence = await readFile(new URL('agents/evidence.md', root), 'utf8')
  const shipper = await readFile(new URL('agents/shipper.md', root), 'utf8')
  for (const source of [evidence, shipper]) {
    const frontmatter = source.split('---')[1]
    assert.match(frontmatter, /\ntools: mcp__plugin_helix-cc_helix-cc-evidence__/)
    assert.doesNotMatch(frontmatter, /(?:Bash|Edit|Read|Write)/)
  }
  assert.match(evidence, /mcp__plugin_helix-cc_helix-cc-evidence__run_command/)
  assert.match(shipper, /mcp__plugin_helix-cc_helix-cc-evidence__ship_pre_pr/)
  const reproducer = await readFile(new URL('agents/reproducer.md', root), 'utf8')
  const reproducerFrontmatter = reproducer.split('---')[1]
  assert.match(reproducerFrontmatter, /mcp__plugin_helix-cc_helix-cc-evidence__reproduce_red/)
  assert.doesNotMatch(reproducerFrontmatter, /(?:Write|Edit|Bash)/)

  for (const workflow of workflowFiles.filter(file => /(?:delivery|implement-review|tdd-fix|research|ship-pre-pr)/.test(file))) {
    const source = await readFile(new URL(workflow, root), 'utf8')
    assert.match(source, /workflow\('helix-cc:helix-evidence-verify'/)
    assert.doesNotMatch(source, /workflow\('helix-evidence-verify'/)
    assert.match(source, /const RECEIPT_SEMANTICS =/)
    assert.match(source, /Equal (?:fingerprints|pre\/post state).*do(?:es)? not (?:mean|erase)/)
  }
  for (const workflow of workflowFiles.filter(file => /(?:delivery|implement-review|tdd-fix|research)/.test(file))) {
    const source = await readFile(new URL(workflow, root), 'utf8')
    assert.match(source, /Leave changes in the working checkout; never stage, commit, push, open a pull request, tag, release, or rewrite history/)
  }
})

test('trusted evidence MCP server is packaged and bound to the active plugin project', async () => {
  const mcp = JSON.parse(await readFile(new URL('.mcp.json', root), 'utf8'))
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  const helper = await stat(new URL('bin/helix-cc-evidence-mcp', root))
  assert.deepEqual(mcp, {
    mcpServers: {
      'helix-cc-evidence': {
        command: 'node',
        args: ['${CLAUDE_PLUGIN_ROOT}/bin/helix-cc-evidence-mcp'],
        env: { CLAUDE_PROJECT_DIR: '${CLAUDE_PROJECT_DIR}' },
        alwaysLoad: true,
      },
    },
  })
  assert.equal(pkg.dependencies['@modelcontextprotocol/sdk'], '1.29.0')
  assert.notEqual(helper.mode & 0o111, 0)
})

test('provider launcher registers every asynchronous child with one process lifecycle owner', async () => {
  const launcher = await readFile(new URL('bin/helix-cc-cliproxy', root), 'utf8')
  assert.match(launcher, /const lifecycle = createProcessLifecycleOwner\(\)/)
  assert.match(launcher, /export async function main\(lifecycle/)
  assert.match(launcher, /createProviderRuntimeDependencies\(dependencyOverrides\)/)
  assert.match(launcher, /await main\(lifecycle\)/)
  assert.doesNotMatch(launcher, /\bspawn\(/)
  assert.match(launcher, /spawnOwned\(lifecycle, command\.command, command\.args/)
  assert.match(launcher, /spawnOwned\(lifecycle, command, args/)
  assert.match(launcher, /spawnOwned\(lifecycle, process\.execPath/)
  for (const stage of ['waitForSidecar', 'waitForModels', 'waitForGatewayCatalog', 'waitForAttestationProxy']) {
    assert.match(launcher, new RegExp(`async function ${stage}\\([^)]*lifecycle`))
  }
  assert.match(launcher, /if \(directExecution\)[\s\S]*finally \{\n    await lifecycle\.close\(\)\n  \}/)
})

test('trusted evidence documentation names the exact six-tool service catalog', async () => {
  assert.equal(TRUSTED_EVIDENCE_TOOL_NAMES.length, 6)
  for (const path of ['docs/providers.md', 'docs/workflows.md']) {
    const documentation = await readFile(new URL(path, root), 'utf8')
    assert.match(documentation, /six (?:bounded operations|narrow tools)/)
    for (const name of TRUSTED_EVIDENCE_TOOL_NAMES) assert.equal(documentation.includes(`\`${name}\``), true, `${path}: ${name}`)
  }
})

test('the public skill catalog maps every distinct Helix loop to its audited workflow', async () => {
  const mapping = {
    'helix-loop': 'helix-delivery.js',
    'helix-implement-review': 'helix-implement-review.js',
    'helix-tdd-fix': 'helix-tdd-fix.js',
    'helix-scout': 'helix-scout.js',
    'helix-research': 'helix-research.js',
    'helix-ship-pre-pr': 'helix-ship-pre-pr.js',
  }
  const skillDirs = (await readdir(new URL('skills/', root), { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
  assert.deepEqual(skillDirs, ['helix-doctor', ...Object.keys(mapping)].sort())
  for (const [skill, workflow] of Object.entries(mapping)) {
    const source = await readFile(new URL(`skills/${skill}/SKILL.md`, root), 'utf8')
    assert.match(source, /disable-model-invocation: true/)
    assert.ok(source.includes(`\${CLAUDE_PLUGIN_ROOT}/workflows/${workflow}`))
    assert.ok(source.includes(`\${CLAUDE_PLUGIN_ROOT}/workflows/graph/${workflow}`))
    assert.match(source, /`mode`: `original` by default, or explicit `graph`/)
    assert.match(source, /neither exact `original` nor exact `graph`/)
    assert.match(source, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/helix-cc-doctor" --json/)
    if (skill !== 'helix-scout') {
      assert.match(source, /mcp__plugin_helix-cc_helix-cc-evidence__start_session/)
      assert.match(source, /"authorization"/)
      assert.match(source, /binds .* before any effect can run/i)
      assert.match(source, /evidenceSession: <exact start_session result>/)
    }
    if (skill === 'helix-loop') {
      assert.match(source, /proof --providers <codex\|copilot\|azure> --model <id>/)
      assert.match(source, /proof-matrix --providers <comma-separated-provider-set> --models <comma-separated-namespaced-ids>/)
    }
  }
  assert.equal(workflowFileForMode('helix-scout.js', undefined), 'helix-scout.js')
  assert.equal(workflowFileForMode('helix-scout.js', 'original'), 'helix-scout.js')
  assert.equal(workflowFileForMode('helix-scout.js', 'graph'), 'graph/helix-scout.js')
  assert.throws(() => workflowFileForMode('helix-scout.js', 'invalid'), /must be original or graph/)
  const catalog = await readFile(new URL('docs/workflows.md', root), 'utf8')
  for (const name of ['full-cycle', 'plan-implement', 'implement-review', 'tdd-fix', 'scout', 'research', 'ship-pre-pr']) {
    assert.match(catalog, new RegExp(`\\b${name}\\b`))
  }
})

test('current documentation links resolve and provider launch examples include an explicit model', async () => {
  const markdown = [
    'README.md',
    'STATUS.md',
    ...(await readdir(new URL('docs/', root), { recursive: true }))
      .filter(path => path.endsWith('.md'))
      .map(path => `docs/${path}`),
    ...(await readdir(new URL('skills/', root), { recursive: true }))
      .filter(path => path.endsWith('.md'))
      .map(path => `skills/${path}`),
  ]
  for (const path of markdown) {
    const source = await readFile(new URL(path, root), 'utf8')
    for (const match of source.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1].split('#')[0]
      if (!target || /^[a-z]+:/i.test(target)) continue
      const resolved = resolve(rootPath, dirname(path), target)
      await assert.doesNotReject(stat(resolved), `${path} links to missing ${target}`)
    }
  }

  const quickstart = await readFile(new URL('docs/quickstart.md', root), 'utf8')
  const commands = [...quickstart.matchAll(/```bash\n([\s\S]*?)```/g)]
    .flatMap(match => match[1].replace(/\\\n\s*/g, ' ').split(/\r?\n/))
    .map(line => line.trim())
    .filter(line => line.startsWith('claudex ') && line.includes('--providers'))
  assert.ok(commands.length >= 4)
  for (const command of commands) assert.match(command, /--model(?:=|\s+)\S+/)

  const skillPaths = (await readdir(new URL('skills/', root), { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => `skills/${entry.name}/SKILL.md`)
  for (const path of skillPaths) {
    const source = await readFile(new URL(path, root), 'utf8')
    assert.match(source, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/helix-cc-doctor" --json/)
  }
})

test('current documentation distinguishes historical evidence and implemented recovery boundaries', async () => {
  const [readme, status, quickstart, security, migration, setup] = await Promise.all([
    readFile(new URL('README.md', root), 'utf8'),
    readFile(new URL('STATUS.md', root), 'utf8'),
    readFile(new URL('docs/quickstart.md', root), 'utf8'),
    readFile(new URL('SECURITY.md', root), 'utf8'),
    readFile(new URL('graph-migration.md', root), 'utf8'),
    readFile(new URL('setup.sh', root), 'utf8'),
  ])
  assert.doesNotMatch(readme, /Live-proven/)
  assert.match(readme, /Historical evidence from 2026-07-19/)
  assert.doesNotMatch(quickstart, /invokes the official stable installer/)
  assert.doesNotMatch(setup, /claude\.ai\/install\.sh|curl|wget/)
  assert.match(quickstart, /not an operating-system sandbox/)
  assert.doesNotMatch(security, /after this repository becomes public/)
  assert.match(migration, /merged to `main` through pull request #4/)
  assert.match(status, /privacy rewrite replaced those Git objects[\s\S]*intentionally do not resolve/)
  for (const [, revision] of status.matchAll(/Production revision `([0-9a-f]{7,40})`/g)) {
    const resolves = spawnSync('git', ['cat-file', '-e', `${revision}^{commit}`], { cwd: rootPath }).status === 0
    if (!resolves) assert.match(status, /pre-publication Workflow receipts are historical/)
  }
})

test('Fable-facing evaluations preserve delivery contracts and exclude unrelated review domains', async () => {
  const ignore = await readFile(new URL('.gitignore', root), 'utf8')
  const helix = await readFile(
    new URL('review-prompts/helix-claude-code-gap-independent-evaluation.md', root),
    'utf8',
  )
  const helixCc = await readFile(
    new URL('review-prompts/helix-cc-multiprovider-independent-evaluation.md', root),
    'utf8',
  )

  assert.match(ignore, /review-prompts\/\*\*/)
  assert.match(ignore, /!review-prompts\/helix-claude-code-gap-independent-evaluation\.md/)
  assert.match(ignore, /!review-prompts\/helix-cc-multiprovider-independent-evaluation\.md/)
  assert.match(ignore, /!review-prompts\/helix-cc-repository-wide-user-test-readiness-review\.md/)
  const isIgnored = path =>
    spawnSync('git', ['check-ignore', '-q', '--no-index', path], { cwd: rootPath }).status === 0
  assert.equal(isIgnored('review-prompts/local-review-notes.md'), true)
  assert.equal(isIgnored('review-prompts/helix-claude-code-gap-independent-evaluation.md'), false)
  assert.equal(isIgnored('review-prompts/helix-cc-multiprovider-independent-evaluation.md'), false)
  assert.equal(isIgnored('review-prompts/helix-cc-repository-wide-user-test-readiness-review.md'), false)

  for (const prompt of [helix, helixCc]) {
    const normalized = prompt.replace(/\s+/g, ' ')
    assert.match(normalized, /ROADMAP\.md/)
    assert.match(normalized, /ONE consolidated change on ONE fresh non-default branch/i)
    assert.match(normalized, /NO pull request/i)
    assert.match(normalized, /push without force/i)
    assert.match(normalized, /remote identity\/visibility/i)
    assert.match(normalized, /Claude Agent SDK/)
    assert.match(normalized, /CLIProxyAPI/)
    assert.match(normalized, /IMPLEMENTATION DISPATCH PROMPT/)
    assert.match(normalized, /exact provider\/model\/effort/i)
    assert.match(normalized, /dedicated disposable temporary root/i)
    assert.doesNotMatch(normalized, /Fetch and record current/i)
    for (const excluded of [
      /security/i,
      /safeguard/i,
      /privacy/i,
      /credential/i,
      /secret/i,
      /vulnerab/i,
      /threat/i,
      /supply[- ]chain/i,
      /redact/i,
      /public[- ]safe/i,
      /weaponizable/i,
      /exploit/i,
      /attack/i,
      /malicious/i,
      /hostile/i,
      /prompt injection/i,
      /red-team/i,
      /denial-of-service/i,
      /request cloaking/i,
      /defensive/i,
      /private/i,
      /\bauth/i,
      /\bsafe\b/i,
      /\brisk\b/i,
      /integrity/i,
      /provenance/i,
      /untrusted/i,
      /mitigation/i,
      /\baudit(?:or|ed|ing|s)?\b/i,
    ]) {
      assert.doesNotMatch(normalized, excluded)
    }

    const dispatch = normalized.slice(normalized.lastIndexOf('IMPLEMENTATION DISPATCH PROMPT'))
    assert.match(dispatch, /one fresh non-default branch/i)
    assert.match(dispatch, /open no PR/i)
    assert.match(dispatch, /never merge\/tag\/release the default branch/i)
    assert.doesNotMatch(dispatch, /\bforce-push\b/i)
    assert.doesNotMatch(dispatch, /open (?:a|the) pull request/i)
    assert.doesNotMatch(dispatch, /push (?:directly )?to (?:main|master)/i)
  }

  assert.match(helix, /BIAS-CONTROL PROTOCOL/)
  assert.match(helix, /closer\s+to Claude Code than either dynamic-workflows/i)
  assert.doesNotMatch(helix, /no-nested-subagent constraint/i)
  assert.match(helix, /QuintinShaw\/pi-dynamic-workflows/)
  assert.match(helix, /Michaelliv\/pi-dynamic-workflows/)
  for (const provider of ['OpenAI subscription', 'GitHub Copilot', 'Azure Foundry', 'OpenRouter']) {
    assert.match(helixCc, new RegExp(provider))
  }
  for (const contract of [
    'Copilot SDK',
    'ACP server',
    'allowAccountRotation: false',
    'allow_fallbacks: false',
    'zero proxy-added',
    'Agent SDK account policy',
  ]) {
    assert.match(helixCc, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})
