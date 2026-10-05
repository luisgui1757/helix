import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { gunzipSync } from 'node:zlib'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync,
  existsSync, copyFileSync, chmodSync, openSync, readSync, closeSync } from 'node:fs'
import { tasks } from './fixtures.mjs'

const repo = fileURLToPath(new URL('../', import.meta.url))
const skillPath = join(repo, 'skills/helix/SKILL.md')
const profiles = {
  codex: { writer: 'gpt-6.1-sol', effort: 'medium', reviewer: 'gpt-6-luna', reviewEffort: 'high' },
  claude: { writer: 'claude-sonnet-5-5', effort: 'low', reviewer: 'claude-opus-5-5', reviewEffort: 'xhigh' },
}
const editable = ['module.mjs', 'module.test.mjs', 'README.md']
const hash = value => createHash('sha256').update(value).digest('hex')
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const readEvents = path => readFileSync(path, 'utf8').split('\n').filter(Boolean).map(JSON.parse)

export function schedule() {
  const runs = []
  for (let repetition = 1; repetition <= 2; repetition++) {
    for (const [taskIndex, task] of Object.keys(tasks).entries()) {
      for (const [hostIndex, host] of Object.keys(profiles).entries()) {
        const modes = (repetition + taskIndex + hostIndex) % 2 ? ['plain', 'helix'] : ['helix', 'plain']
        for (const mode of modes) runs.push({ host, task, repetition, mode })
      }
    }
  }
  return runs
}

function counts(input, cached, writes, output, thinking) {
  for (const value of [input, cached, writes, output, thinking]) {
    assert.ok(Number.isSafeInteger(value) && value >= 0, 'Missing or invalid usage counter')
  }
  assert.ok(cached + writes <= input && thinking <= output, 'Inconsistent usage counters')
  return { input, cached, cacheWrites: writes, noncached: input - cached, output, thinking }
}

export function claudeUsage(events) {
  const last = events.filter(e => e.type === 'result').at(-1)
  assert.ok(last?.modelUsage, 'No final Claude model usage')
  const usage = Object.entries(last.modelUsage).map(([model, u]) => ({ model,
    ...counts(u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens,
      u.cacheReadInputTokens, u.cacheCreationInputTokens, u.outputTokens, u.thinkingTokens ?? 0),
  }))
  // Stream chunks can repeat one message ID. Input counters describe the message,
  // not each chunk. Result usage is session-wide and can repeat after background work.
  const messages = new Map()
  for (const e of events) if (e.type === 'assistant' && e.message?.usage) messages.set(e.message.id, e.message)
  for (const u of usage) {
    const parts = [...messages.values()].filter(m => m.model === u.model).map(m => m.usage)
    const total = key => parts.reduce((sum, p) => sum + p[key], 0)
    assert.equal(total('input_tokens') + total('cache_read_input_tokens') + total('cache_creation_input_tokens'), u.input,
      `Forwarded input counters do not reconcile for ${u.model}`)
  }
  return usage
}

export function codexUsage(events) {
  const info = events.filter(e => e.type === 'event_msg' && e.payload?.type === 'token_count' && e.payload.info).at(-1)?.payload.info
  assert.ok(info?.total_token_usage, 'No cumulative Codex usage')
  const u = info.total_token_usage
  return counts(u.input_tokens, u.cached_input_tokens, u.cache_write_input_tokens ?? 0,
    u.output_tokens, u.reasoning_output_tokens ?? 0)
}

export function skillObserved(events, skill) {
  const body = skill.replace(/^---\n[\s\S]*?\n---\n/, '').trim()
  function contains(value) {
    if (Array.isArray(value)) return value.some(contains)
    if (value && typeof value === 'object') return Object.values(value).some(contains)
    if (typeof value !== 'string') return false
    if (value.includes(body)) return true
    // Native tool outputs may contain another JSON envelope around the text.
    let decoded
    try { decoded = JSON.parse(value) } catch { return false /* ordinary text, not JSON */ }
    return decoded !== value && contains(decoded)
  }
  return events.some(e => {
    const p = e.type === 'response_item' ? e.payload : e.message
    if (e.type === 'user' || (p?.type === 'message' && p.role === 'user')) return contains(p)
    if (['function_call_output', 'custom_tool_call_output'].includes(p?.type)) return contains(p.output)
    return false
  })
}

export function acceptance(task, work) {
  const code = `import assert from 'node:assert/strict';
import * as m from ${JSON.stringify(pathToFileURL(join(work, 'module.mjs')).href)};
const checks = ${JSON.stringify(tasks[task].checks)};
const results = checks.map(([name, code]) => {
  try { new Function('assert', 'm', code)(assert, m); return {name, pass:true} }
  catch (error) { return {name, pass:false, error:error.message} }
});
console.log(JSON.stringify(results));`
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 10000 })
  if (result.status !== 0) return { passed: 0, total: tasks[task].checks.length, error: result.stderr || result.error?.message }
  const checks = JSON.parse(result.stdout)
  return { passed: checks.filter(c => c.pass).length, total: checks.length, checks }
}

function prepare(work, host, task) {
  mkdirSync(work, { recursive: true })
  const instructions = `This is a disposable JavaScript fixture. Read TASK.md for the requirements.
Change only module.mjs, module.test.mjs and README.md. Add regression tests and
update documentation. Run the required gate: node verify.mjs. Do not modify the
gate, TASK.md, these instructions, notes.txt, skill or host configuration. Preserve
unrelated staged and unstaged work. Do not commit, stage, install packages, use
network tools, inspect account files, or launch another agent CLI. Use native
delegation only when requested. A reviewer must inspect without editing.
`
  const files = {
    'AGENTS.md': instructions, 'CLAUDE.md': instructions,
    'TASK.md': tasks[task].request + '\n',
    'module.mjs': tasks[task].source, 'module.test.mjs': tasks[task].test,
    'README.md': '# Fixture\n\nThis module is under development.\n',
    'notes.txt': 'Original unrelated note.\n',
    'verify.mjs': "import { spawnSync } from 'node:child_process'\nconst r = spawnSync(process.execPath, ['--test', 'module.test.mjs'], { stdio: 'inherit' })\nprocess.exit(r.status ?? 1)\n",
    [host === 'codex' ? '.agents/skills/helix/SKILL.md' : '.claude/skills/helix/SKILL.md']: readFileSync(skillPath, 'utf8'),
  }
  if (host === 'claude') {
    files['.claude/settings.json'] = JSON.stringify({ disableAllHooks: true, autoMemoryEnabled: false,
      sandbox: { enabled: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false } })
    files['.claude/agents/helix-reviewer.md'] = `---
name: helix-reviewer
description: Independent read-only review of the requested repository change.
model: ${profiles.claude.reviewer}
effort: ${profiles.claude.reviewEffort}
tools: Read, Glob, Grep
---
Inspect the actual files and diff against TASK.md. Report concrete defects and
verification gaps with evidence, or no findings. Do not edit, run commands,
delegate or add requirements. Keep the review concise.
`
  }
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(work, name)), { recursive: true })
    writeFileSync(join(work, name), content)
  }
  git(work, 'init', '-q'); git(work, 'add', '.')
  git(work, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture baseline')
  writeFileSync(join(work, 'notes.txt'), 'Staged unrelated note.\n'); git(work, 'add', 'notes.txt')
  writeFileSync(join(work, 'notes.txt'), 'Staged unrelated note.\nUnstaged unrelated note.\n')
  return { head: git(work, 'rev-parse', 'HEAD'), index: git(work, 'write-tree'),
    protected: Object.fromEntries(Object.keys(files).filter(p => !editable.includes(p)).map(p => [p, hash(readFileSync(join(work, p)))])),
  }
}

function environment() {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (/^(ANTHROPIC_|CLAUDE_CODE_SUBAGENT_|OTEL_)/.test(key) ||
      ['CODEX_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'CLAUDECODE', 'CLAUDE_CODE_SIMPLE',
        'CLAUDE_CODE_SAFE_MODE', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'].includes(key)) delete env[key]
  }
  return env
}

async function telemetry(artifact, env) {
  const records = [], errors = []
  const server = createServer(async (request, response) => {
    try {
      const chunks = []; let size = 0
      for await (const chunk of request) {
        size += chunk.length; assert.ok(size <= 4_000_000); chunks.push(chunk)
      }
      const body = Buffer.concat(chunks)
      const payload = JSON.parse(request.headers['content-encoding'] === 'gzip' ? gunzipSync(body, { maxOutputLength: 8_000_000 }) : body)
      for (const resource of payload.resourceLogs ?? []) for (const scope of resource.scopeLogs ?? []) for (const record of scope.logRecords ?? []) {
        const attributes = Object.fromEntries((record.attributes ?? []).map(a => [a.key, Object.values(a.value)[0]]))
        if (['api_request', 'api_error'].includes(attributes['event.name'])) {
          records.push(Object.fromEntries(['event.name', 'model', 'effort', 'query_source', 'agent.name'].filter(k => k in attributes).map(k => [k, attributes[k]])))
        }
      }
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{}')
    } catch (error) { errors.push(error.message); response.writeHead(400); response.end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  Object.assign(env, { CLAUDE_CODE_ENABLE_TELEMETRY: '1', OTEL_LOGS_EXPORTER: 'otlp',
    OTEL_METRICS_EXPORTER: 'none', OTEL_TRACES_EXPORTER: 'none', OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: 'http/json',
    OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `http://127.0.0.1:${server.address().port}/v1/logs`,
    OTEL_LOGS_EXPORT_INTERVAL: '1000', OTEL_LOG_USER_PROMPTS: '0', OTEL_LOG_TOOL_DETAILS: '0', OTEL_LOG_TOOL_CONTENT: '0' })
  return { records, close: async () => {
    await new Promise(resolve => server.close(resolve))
    json(join(artifact, 'requests.json'), records); json(join(artifact, 'telemetry-errors.json'), errors)
    assert.deepEqual(errors, [], 'Telemetry collector failed')
  } }
}

function nativeCodex(artifact, parent, start) {
  const directory = join(process.env.CODEX_HOME || homedir() + '/.codex', 'sessions')
  const candidates = []
  for (const date of new Set([new Date(start).toISOString().slice(0, 10), new Date().toISOString().slice(0, 10)])) {
    const day = join(directory, ...date.split('-'))
    if (!existsSync(day)) continue
    for (const name of readdirSync(day)) {
      const path = join(day, name)
      if (!name.endsWith('.jsonl') || statSync(path).mtimeMs < start) continue
      const fd = openSync(path, 'r'), buffer = Buffer.alloc(65536)
      let header = ''
      try {
        while (!header.includes('\n')) {
          const length = readSync(fd, buffer)
          if (!length) break
          header += buffer.subarray(0, length).toString('utf8')
          assert.ok(header.length < 4_000_000, 'Unexpected session metadata size')
        }
      } finally { closeSync(fd) }
      const meta = JSON.parse(header.split('\n')[0]).payload
      candidates.push({ path, meta })
    }
  }
  const selected = new Set([parent])
  // Include descendants if a host unexpectedly delegates more than one level.
  let changed = true
  while (changed) {
    changed = false
    for (const c of candidates) if (!selected.has(c.meta.id) && [...selected].some(id => JSON.stringify(c.meta.source ?? {}).includes(id))) {
      selected.add(c.meta.id); changed = true
    }
  }
  return candidates.filter(c => selected.has(c.meta.id)).map((c, index) => {
    copyFileSync(c.path, join(artifact, `native-${index}.jsonl`))
    const events = readEvents(c.path)
    const settings = [...new Map(events.filter(e => e.type === 'turn_context')
      .map(e => [{ model: e.payload.model, effort: e.payload.effort }]).map(([s]) => [JSON.stringify(s), s])).values()]
    return { role: c.meta.id === parent ? 'writer' : 'reviewer', settings,
      inheritedHistory: !!c.meta.forked_from_id, skillObserved: skillObserved(events, readFileSync(skillPath, 'utf8')), ...codexUsage(events) }
  })
}

export function reportsComplete(final) {
  return /^\s*(?:\*\*)?COMPLETE(?=[\s.:*]|$)/.test(final)
}

export async function run(root, spec) {
  const id = `${spec.host}-${spec.task}-${spec.repetition}-${spec.mode}`
  const artifact = join(root, id), work = join(artifact, 'work')
  mkdirSync(artifact)
  const baseline = prepare(work, spec.host, spec.task)
  const p = profiles[spec.host], env = environment()
  const available = 'Read,Write,Edit,Bash,Glob,Grep,Skill,Agent'
  const args = spec.host === 'codex'
    ? ['exec', '--ignore-user-config', '--sandbox', 'workspace-write', '-c', 'approval_policy="never"',
      '--model', p.writer, '-c', `model_reasoning_effort="${p.effort}"`, '--json', '-']
    : ['--print', '--model', p.writer, '--effort', p.effort, '--output-format', 'stream-json', '--verbose',
      '--forward-subagent-text', '--setting-sources', 'project', '--settings', '{"disableAllHooks":true,"autoMemoryEnabled":false}',
      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--tools', available, '--allowedTools', available,
      '--permission-mode', 'dontAsk', '--no-chrome']
  const request = 'Implement TASK.md, add tests, update README.md, and run the required gate. Preserve unrelated work. Keep the final report concise.'
  let prompt = `Work directly without invoking skills or delegating. ${request}`
  if (spec.mode === 'helix') {
    prompt = `${spec.host === 'codex' ? '$helix' : '/helix'} ${request} `
    prompt += spec.host === 'codex'
      ? `Use a fresh native reviewer with model ${p.reviewer}, reasoning effort ${p.reviewEffort}, and fork_turns="none". These settings are explicitly authorized; do not substitute them.`
      : `Use the configured helix-reviewer role without overriding its model. Writer ${p.writer}/${p.effort}; reviewer ${p.reviewer}/${p.reviewEffort}. These settings are explicitly authorized; use a fresh reviewer context.`
  }
  writeFileSync(join(artifact, 'prompt.txt'), prompt + '\n')
  const snapshots = []; let previous
  const snapshot = () => {
    const files = Object.fromEntries(editable.filter(n => existsSync(join(work, n))).map(n => [n, readFileSync(join(work, n), 'utf8')]))
    const digest = hash(JSON.stringify(files))
    if (digest !== previous) { snapshots.push({ timestamp: new Date().toISOString(), digest, files }); previous = digest }
  }
  snapshot()
  const collector = spec.host === 'claude' ? await telemetry(artifact, env) : null
  const start = Date.now(), started = performance.now()
  const dispatch = { ...spec, args, startedAt: new Date(start).toISOString(), baseline }
  json(join(artifact, 'dispatch.json'), dispatch)
  console.log(JSON.stringify({ started: id }))
  const child = spawn(spec.host, args, { cwd: work, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = '', stderr = '', timeout = false, launchError = null
  child.stdout.on('data', chunk => { stdout += chunk }); child.stderr.on('data', chunk => { stderr += chunk })
  child.stdin.on('error', error => { launchError = error.message })
  child.stdin.end(prompt)
  const sampler = setInterval(snapshot, 100)
  const timer = setTimeout(() => { timeout = true; process.kill(-child.pid, 'SIGTERM') }, 600000)
  const hardTimer = setTimeout(() => { process.kill(-child.pid, 'SIGKILL') }, 615000)
  let exitCode = null, seconds
  try { exitCode = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve) }) }
  catch (error) { launchError = error.message }
  finally {
    seconds = (performance.now() - started) / 1000
    clearInterval(sampler); clearTimeout(timer); clearTimeout(hardTimer)
    try {
      snapshot(); json(join(artifact, 'snapshots.json'), snapshots)
      writeFileSync(join(artifact, 'events.jsonl'), stdout); writeFileSync(join(artifact, 'stderr.txt'), stderr)
    } finally { if (collector) await collector.close() }
  }
  const gate = spawnSync(process.execPath, ['verify.mjs'], { cwd: work, encoding: 'utf8', timeout: 30000 })
  writeFileSync(join(artifact, 'gate.txt'), gate.stdout + gate.stderr)
  const score = acceptance(spec.task, work); json(join(artifact, 'acceptance.json'), score)
  const protectedOkay = Object.entries(baseline.protected).every(([name, digest]) => existsSync(join(work, name)) && hash(readFileSync(join(work, name))) === digest)
  const changed = [...git(work, 'diff', '--name-only', 'HEAD').split('\n'), ...git(work, 'ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean)
  const preservation = protectedOkay && git(work, 'rev-parse', 'HEAD') === baseline.head && git(work, 'write-tree') === baseline.index && changed.every(n => editable.includes(n) || n === 'notes.txt')
  writeFileSync(join(artifact, 'changes.diff'), git(work, 'diff', 'HEAD'))
  let usage, roles, final, accountingError = null, permissionDenials = 0
  try {
    const events = readEvents(join(artifact, 'events.jsonl'))
    if (spec.host === 'codex') {
      const parent = events.find(e => e.type === 'thread.started')?.thread_id
      assert.ok(parent, 'No native parent session')
      roles = nativeCodex(artifact, parent, start)
      assert.equal(roles.filter(r => r.role === 'writer').length, 1)
      usage = roles.map(r => ({ role: r.role, model: r.settings[0]?.model, ...counts(r.input, r.cached, r.cacheWrites, r.output, r.thinking) }))
      final = events.filter(e => e.type === 'item.completed' && e.item?.type === 'agent_message').at(-1)?.item.text ?? ''
    } else {
      usage = claudeUsage(events)
      roles = [...new Map(collector.records.filter(r => r['event.name'] === 'api_request').map(r => {
        const role = r.query_source?.startsWith('agent:') ? 'reviewer' : 'writer'
        const entry = { role, model: r.model, effort: r.effort }
        return [JSON.stringify(entry), entry]
      })).values()]
      final = events.filter(e => e.type === 'result').at(-1)?.result ?? ''
      permissionDenials = events.filter(e => e.type === 'result').reduce((n, e) => n + (e.permission_denials?.length ?? 0), 0)
    }
  } catch (error) { accountingError = error.message }
  writeFileSync(join(artifact, 'final.md'), final ?? '')
  const result = { id, ...spec, seconds: Math.round(seconds * 100) / 100, exitCode, timeout, launchError,
    acceptance: { passed: score.passed, total: score.total }, gatePassed: gate.status === 0, preservation,
    testsUpdated: changed.includes('module.test.mjs'), docsUpdated: changed.includes('README.md'),
    usage, roles, accountingError, permissionDenials, reportsComplete: reportsComplete(final ?? '') }
  json(join(artifact, 'result.json'), result)
  console.log(JSON.stringify({ finished: id, seconds: result.seconds, acceptance: result.acceptance, accountingError }))
  return result
}

async function main() {
  assert.equal(process.argv.length, 3, 'Usage: node evals/compare.mjs /new/output/directory')
  const root = resolve(process.argv[2])
  assert.ok(!root.startsWith(repo.endsWith(sep) ? repo : repo + sep), 'Keep raw artifacts outside the repository')
  assert.ok(!existsSync(root), 'Output directory already exists')
  mkdirSync(root, { recursive: true, mode: 0o700 }); chmodSync(root, 0o700)
  const sources = ['evals/compare.mjs', 'evals/fixtures.mjs', 'evals/comparison.md', 'skills/helix/SKILL.md']
  const sourceHashes = Object.fromEntries(sources.map(p => [p, hash(readFileSync(join(repo, p)))]))
  for (const file of sources) { const target = join(root, 'source', file); mkdirSync(dirname(target), { recursive: true }); copyFileSync(join(repo, file), target) }
  const manifest = { startedAt: new Date().toISOString(), sourceHashes, profiles, schedule: schedule(),
    versions: Object.fromEntries(['codex', 'claude', 'node', 'git'].map(name => [name, execFileSync(name, ['--version'], { encoding: 'utf8' }).trim()])) }
  json(join(root, 'manifest.json'), manifest)
  console.log(JSON.stringify({ artifacts: root, runs: manifest.schedule.length }))
  const results = []
  for (const spec of manifest.schedule) {
    try { results.push(await run(root, spec)) }
    catch (error) { results.push({ ...spec, harnessError: error.message }); console.error(JSON.stringify(results.at(-1))) }
    json(join(root, 'results.json'), results)
    for (const [file, digest] of Object.entries(sourceHashes)) assert.equal(hash(readFileSync(join(repo, file))), digest, `Source changed during benchmark: ${file}`)
  }
  console.log(JSON.stringify({ completed: results.length, artifacts: root }))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
