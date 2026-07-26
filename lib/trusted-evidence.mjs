import { constants, createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { cpSync, chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const MAX_ARGV = 32
const MAX_ARG = 4096
const MAX_PATHS = 2048
const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_BASELINE_BYTES = 64 * 1024 * 1024
const MAX_ISOLATED_BYTES = 1024 * 1024 * 1024
const MAX_OUTPUT_BYTES = 1024 * 1024
const MAX_SESSIONS = 64
const MAX_RECEIPTS_PER_SESSION = 256
const SAFE_BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/
export const TRUSTED_EVIDENCE_TOOL_NAMES = Object.freeze([
  'start_session', 'capture_baseline', 'reproduce_red', 'run_command', 'verify_pre_pr', 'ship_pre_pr',
])

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function safeBranch(value) {
  return typeof value === 'string' && value.length <= 256 && SAFE_BRANCH.test(value)
    && !value.startsWith('-') && !value.endsWith('/') && !value.endsWith('.')
    && !value.endsWith('.lock') && !value.includes('..') && !value.includes('//') && !value.includes('@{')
}

function validateArgv(argv, label = 'argv') {
  if (!Array.isArray(argv) || argv.length < 1 || argv.length > MAX_ARGV) throw new Error(`${label} must contain 1 through ${MAX_ARGV} arguments`)
  for (const value of argv) {
    if (typeof value !== 'string' || value.length < 1 || value.length > MAX_ARG || value.includes('\0')) {
      throw new Error(`${label} contains an invalid argument`)
    }
  }
  if (argv[0].includes('/') || argv[0].includes('\\') || argv[0].startsWith('-')) {
    throw new Error(`${label}[0] must be a PATH-resolved executable name`)
  }
  return [...argv]
}

function exactObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`${label} must contain exactly ${keys.join(', ')}`)
  }
  return value
}

function boundedText(value, label, limit, { singleLine = false } = {}) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || value.includes('\0')) throw new Error(`${label} is invalid`)
  if (singleLine && /[\r\n]/.test(value)) throw new Error(`${label} must be single-line`)
  return value
}

function normalizeMetric(metric) {
  if (metric === null || metric === undefined) return null
  exactObject(metric, ['metric', 'unit'], 'metric authorization')
  return {
    metric: boundedText(metric.metric, 'metric name', 256),
    unit: boundedText(metric.unit, 'metric unit', 64),
  }
}

function normalizeCommandAuthorization(value) {
  exactObject(value, ['argv', 'metric', 'purpose'], 'command authorization')
  const purpose = value.purpose
  if (!['verification', 'measurement', 'tests'].includes(purpose)) throw new Error('command authorization purpose is invalid')
  const metric = normalizeMetric(value.metric)
  if ((purpose === 'measurement') !== (metric !== null)) throw new Error('only measurement command authorization may include a metric')
  return { argv: validateArgv(value.argv), purpose, metric }
}

function validatePath(path, root) {
  if (typeof path !== 'string' || !path || path.length > 512 || path.includes('\0') || path.includes('\\')) {
    throw new Error('task path is invalid')
  }
  const normalized = path.startsWith('./') ? path.slice(2) : path
  const segments = normalized.split('/')
  if (!normalized || normalized.startsWith('/') || segments.some(segment => !segment || segment === '.' || segment === '..')
    || normalized === '.git' || normalized.startsWith('.git/')) throw new Error('task path is invalid')
  const absolute = resolve(root, normalized)
  if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) throw new Error('task path escapes the repository')
  return normalized
}

function normalizeAuthorization(authorization, root) {
  exactObject(authorization, ['commands', 'prePr', 'tdd'], 'evidence authorization')
  if (!Array.isArray(authorization.commands) || authorization.commands.length > 8) {
    throw new Error('evidence authorization commands must contain at most 8 entries')
  }
  const commands = authorization.commands.map(normalizeCommandAuthorization)
  if (new Set(commands.map(command => stable(command))).size !== commands.length) {
    throw new Error('evidence authorization commands must not contain duplicates')
  }

  let tdd = null
  if (authorization.tdd !== null) {
    exactObject(authorization.tdd, ['reproductionArgv', 'testPaths'], 'TDD authorization')
    if (!Array.isArray(authorization.tdd.testPaths) || authorization.tdd.testPaths.length < 1
      || authorization.tdd.testPaths.length > MAX_PATHS) {
      throw new Error('TDD authorization testPaths must contain one or more repository-relative paths')
    }
    const testPaths = authorization.tdd.testPaths.map(path => validatePath(path, root)).sort()
    if (new Set(testPaths).size !== testPaths.length) throw new Error('TDD authorization testPaths must not contain duplicates')
    tdd = { testPaths, reproductionArgv: validateArgv(authorization.tdd.reproductionArgv, 'reproductionArgv') }
  }

  let prePr = null
  if (authorization.prePr !== null) {
    exactObject(authorization.prePr, [
      'baseBranch', 'commitMessage', 'headBranch', 'pullRequestBody', 'pullRequestTitle',
      'releaseCheckArgv', 'repository', 'taskPaths', 'verificationArgv',
    ], 'pre-PR authorization')
    const value = authorization.prePr
    if (typeof value.repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repository)) {
      throw new Error('pre-PR authorization repository is invalid')
    }
    if (!safeBranch(value.headBranch) || !safeBranch(value.baseBranch) || value.headBranch === value.baseBranch) {
      throw new Error('pre-PR authorization branches are invalid')
    }
    if (!Array.isArray(value.taskPaths) || value.taskPaths.length < 1 || value.taskPaths.length > MAX_PATHS) {
      throw new Error('pre-PR authorization taskPaths must contain one or more repository-relative paths')
    }
    const taskPaths = value.taskPaths.map(path => validatePath(path, root)).sort()
    if (new Set(taskPaths).size !== taskPaths.length) throw new Error('pre-PR authorization taskPaths must not contain duplicates')
    prePr = {
      repository: value.repository,
      headBranch: value.headBranch,
      baseBranch: value.baseBranch,
      taskPaths,
      verificationArgv: validateArgv(value.verificationArgv, 'verificationArgv'),
      releaseCheckArgv: validateArgv(value.releaseCheckArgv, 'releaseCheckArgv'),
      commitMessage: boundedText(value.commitMessage, 'commit message', 512, { singleLine: true }),
      pullRequestTitle: boundedText(value.pullRequestTitle, 'pull-request title', 512, { singleLine: true }),
      pullRequestBody: boundedText(value.pullRequestBody, 'pull-request body', 16384),
    }
  }
  return { commands, tdd, prePr }
}

function parseStatus(buffer) {
  const records = buffer.toString('utf8').split('\0')
  const entries = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (!record) continue
    if (record.length < 4) throw new Error('git status returned an invalid record')
    const status = record.slice(0, 2)
    const path = record.slice(3)
    entries.push({ path, status })
    if (/[RC]/.test(status)) {
      const original = records[++index]
      if (!original) throw new Error('git status returned an incomplete rename record')
      entries.push({ path: original, status: `${status}:source` })
    }
    if (entries.length > MAX_PATHS) throw new Error(`working tree exceeds the ${MAX_PATHS}-path evidence limit`)
  }
  return entries
}

function parsePaths(buffer, label) {
  const records = buffer.toString('utf8').split('\0')
  if (records.at(-1) !== '') throw new Error(`${label} returned an unterminated path record`)
  const paths = records.slice(0, -1)
  if (paths.some(path => !path)) throw new Error(`${label} returned an invalid path record`)
  return paths
}

function parseNameStatus(buffer) {
  const records = parsePaths(buffer, 'staged path inspection')
  const paths = []
  for (let index = 0; index < records.length;) {
    const status = records[index++]
    if (!/^[ACDMRTUXB][0-9]*$/.test(status)) throw new Error('staged path inspection returned an invalid status')
    const count = /^[RC]/.test(status) ? 2 : 1
    for (let offset = 0; offset < count; offset += 1) {
      const path = records[index++]
      if (!path) throw new Error('staged path inspection returned an incomplete record')
      paths.push(path)
    }
    if (paths.length > MAX_PATHS) throw new Error(`staged change exceeds the ${MAX_PATHS}-path evidence limit`)
  }
  return [...new Set(paths)].sort()
}

function fileDigest(root, path) {
  const absolute = resolve(root, path)
  try {
    const stat = lstatSync(absolute)
    const mode = (stat.mode & 0o7777).toString(8).padStart(4, '0')
    if (stat.isSymbolicLink()) return `symlink:${mode}:${sha256(readlinkSync(absolute))}`
    if (!stat.isFile()) return `other:${mode}`
    if (stat.size > MAX_FILE_BYTES) throw new Error(`repository file exceeds the ${MAX_FILE_BYTES}-byte evidence limit: ${path}`)
    return `file:${mode}:${sha256(readFileSync(absolute))}`
  } catch (error) {
    if (error?.code === 'ENOENT') return 'missing'
    throw error
  }
}

function captureSignedTargets(root, paths) {
  let totalBytes = 0
  const files = new Map()
  const missingDirectories = new Set()
  for (const path of paths) {
    const absolute = resolve(root, path)
    let parent = dirname(absolute)
    while (parent !== root) {
      try {
        const parentStat = lstatSync(parent)
        if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new Error(`TDD test path has a non-directory or symbolic-link parent: ${path}`)
      } catch (error) {
        if (error?.code === 'ENOENT') missingDirectories.add(parent)
        else throw error
      }
      parent = dirname(parent)
    }
    try {
      const stat = lstatSync(absolute)
      const mode = stat.mode & 0o7777
      if (stat.isFile() && !stat.isSymbolicLink()) {
        if (stat.size > MAX_FILE_BYTES) throw new Error(`repository file exceeds the ${MAX_FILE_BYTES}-byte evidence limit: ${path}`)
        const content = readFileSync(absolute)
        totalBytes += content.length
        files.set(path, { kind: 'file', mode, content })
      } else {
        throw new Error(`TDD test path must be a regular file or missing: ${path}`)
      }
      if (totalBytes > MAX_BASELINE_BYTES) throw new Error(`TDD baseline exceeds the ${MAX_BASELINE_BYTES}-byte restoration limit`)
    } catch (error) {
      if (error?.code === 'ENOENT') files.set(path, { kind: 'missing' })
      else throw error
    }
  }
  return { files, missingDirectories: [...missingDirectories].sort((left, right) => right.length - left.length) }
}

function isolatedProcessEnvironment(temporaryRoot, isolatedRoot) {
  const environment = {
    ...process.env,
    HOME: temporaryRoot,
    TMPDIR: temporaryRoot,
    TMP: temporaryRoot,
    TEMP: temporaryRoot,
    CLAUDE_PROJECT_DIR: isolatedRoot,
    INIT_CWD: isolatedRoot,
    PWD: isolatedRoot,
    OLDPWD: isolatedRoot,
  }
  for (const name of ['BASH_ENV', 'ENV', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_WORK_TREE', 'NODE_OPTIONS', 'NODE_PATH']) {
    delete environment[name]
  }
  return environment
}

function copyIsolatedRepository(root, origin, branch, maxBytes) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'helix-cc-tdd-'))
  const isolatedRoot = join(temporaryRoot, 'repository')
  let copiedBytes = 0
  try {
    cpSync(root, isolatedRoot, {
      recursive: true,
      verbatimSymlinks: true,
      filter(source) {
        if (source === join(root, '.git')) return false
        const stat = lstatSync(source)
        if (stat.isFile()) {
          copiedBytes += stat.size
          if (copiedBytes > maxBytes) {
            const path = source === root ? '.' : source.slice(root.length + 1)
            throw new Error(`TDD isolated working-tree copy exceeds the ${maxBytes}-byte limit at: ${path}`)
          }
          return true
        }
        if (!stat.isSymbolicLink()) return true
        const target = readlinkSync(source)
        const resolvedTarget = isAbsolute(target) ? target : resolve(dirname(source), target)
        if (isAbsolute(target) || (resolvedTarget !== root && !resolvedTarget.startsWith(`${root}${sep}`))) {
          throw new Error(`TDD isolation refuses an escaping symbolic link: ${source.slice(root.length + 1)}`)
        }
        return true
      },
    })
    const environment = isolatedProcessEnvironment(temporaryRoot, isolatedRoot)
    const git = argv => commandResult(spawnSync, ['git', ...argv], isolatedRoot, { env: environment })
    const requireGit = (argv, label) => {
      const result = git(argv)
      if (result.executionErrorCode || result.signal || result.exitCode !== 0) throw new Error(`TDD isolated ${label} failed`)
    }
    requireGit(['init', '-b', safeBranch(branch) ? branch : 'helix-tdd'], 'Git initialization')
    requireGit(['add', '-A', '--', '.'], 'baseline staging')
    requireGit(['-c', 'user.name=Helix CC', '-c', 'user.email=helix-cc@example.invalid', 'commit', '--allow-empty', '-m', 'isolated TDD baseline'], 'baseline commit')
    requireGit(['remote', 'add', 'origin', origin], 'origin setup')
    return { temporaryRoot, isolatedRoot, environment }
  } catch (error) {
    rmSync(temporaryRoot, { recursive: true, force: true })
    throw error
  }
}

function githubRepository(remote) {
  if (typeof remote !== 'string') return null
  const match = remote.trim().match(/^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/)
  if (!match) return null
  return { owner: match[1], repo: match[2], slug: `${match[1]}/${match[2]}` }
}

function commandResult(run, argv, cwd, options = {}) {
  const result = run(argv[0], argv.slice(1), {
    cwd,
    encoding: null,
    maxBuffer: MAX_OUTPUT_BYTES,
    timeout: options.timeoutMs ?? 10 * 60 * 1000,
    env: options.env,
  })
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout || '')
  const stderr = Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(result.stderr || '')
  return {
    exitCode: Number.isInteger(result.status) ? result.status : null,
    signal: typeof result.signal === 'string' ? result.signal : null,
    executionErrorCode: typeof result.error?.code === 'string' ? result.error.code : null,
    stdout,
    stderr,
  }
}

function outputReceipt(result) {
  return {
    exitCode: result.exitCode,
    signal: result.signal,
    executionErrorCode: result.executionErrorCode,
    stdoutSha256: sha256(result.stdout),
    stderrSha256: sha256(result.stderr),
  }
}

function exactJsonMetric(stdout, spec) {
  let parsed
  try { parsed = JSON.parse(stdout.toString('utf8').trim()) } catch { throw new Error('measurement command must emit one JSON object') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || JSON.stringify(Object.keys(parsed).sort()) !== JSON.stringify(['metric', 'unit', 'value'])) {
    throw new Error('measurement JSON must contain exactly metric, unit, and value')
  }
  if (parsed.metric !== spec.metric || parsed.unit !== spec.unit || typeof parsed.value !== 'number' || !Number.isFinite(parsed.value)) {
    throw new Error('measurement JSON does not match the requested metric and unit')
  }
  return parsed
}

export function createEvidenceService({
  cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd(),
  run = spawnSync,
  random = randomBytes,
  keyPair = generateKeyPairSync,
  maxIsolatedBytes = MAX_ISOLATED_BYTES,
} = {}) {
  const root = resolve(cwd)
  const sessions = new Map()
  if (!Number.isSafeInteger(maxIsolatedBytes) || maxIsolatedBytes < 1) throw new Error('maxIsolatedBytes must be a positive safe integer')

  const gitAt = (workRoot, runner, argv, env) => commandResult(runner, ['git', ...argv], workRoot, { env })
  const git = argv => gitAt(root, run, argv)
  const textResult = (result, label) => {
    if (result.executionErrorCode || result.signal || result.exitCode !== 0) throw new Error(`${label} failed`)
    return result.stdout.toString('utf8').trim()
  }
  const snapshotAt = (workRoot, runner = spawnSync, env) => {
    const workGit = argv => gitAt(workRoot, runner, argv, env)
    const head = textResult(workGit(['rev-parse', 'HEAD']), 'git head inspection')
    const branch = textResult(workGit(['branch', '--show-current']), 'git branch inspection')
    const origin = textResult(workGit(['remote', 'get-url', 'origin']), 'git origin inspection')
    const status = workGit(['status', '--porcelain=v1', '-z', '--untracked-files=all'])
    if (status.executionErrorCode || status.signal || status.exitCode !== 0) throw new Error('git status inspection failed')
    const entries = parseStatus(status.stdout).map(entry => ({ ...entry, digest: fileDigest(workRoot, entry.path) }))
      .sort((left, right) => left.path.localeCompare(right.path) || left.status.localeCompare(right.status))
    const tracked = workGit(['ls-files', '-z'])
    if (tracked.executionErrorCode || tracked.signal || tracked.exitCode !== 0) throw new Error('git tracked-file inspection failed')
    const trackedEntries = parsePaths(tracked.stdout, 'git tracked-file inspection')
      .map(path => ({ path, digest: fileDigest(workRoot, path) }))
      .sort((left, right) => left.path.localeCompare(right.path))
    const trackedState = { count: trackedEntries.length, fingerprint: sha256(stable(trackedEntries)) }
    const value = { head, branch, origin, entries, trackedState }
    const pathStates = new Map(trackedEntries.map(entry => [entry.path, `tracked:${entry.digest}`]))
    for (const entry of entries) pathStates.set(entry.path, `dirty:${entry.status}:${entry.digest}`)
    return { value: { ...value, fingerprint: sha256(stable(value)) }, pathStates }
  }
  const snapshot = () => snapshotAt(root, run)
  const changedPaths = (before, after) => [...new Set([...before.pathStates.keys(), ...after.pathStates.keys()])]
    .filter(path => before.pathStates.get(path) !== after.pathStates.get(path)).sort()
  const writeSignedFiles = (workRoot, mutations, targets) => {
    for (const file of mutations) {
      const absolute = resolve(workRoot, file.path)
      mkdirSync(dirname(absolute), { recursive: true })
      const target = targets.files.get(file.path)
      const mode = target?.kind === 'file' ? target.mode : 0o644
      const temporary = `${absolute}.helix-tdd-partial-${process.pid}-${random(8).toString('hex')}`
      try {
        writeFileSync(temporary, file.content, { mode })
        chmodSync(temporary, mode)
        renameSync(temporary, absolute)
      } finally {
        rmSync(temporary, { force: true })
      }
    }
  }
  const restoreSignedTargets = targets => {
    for (const [path, entry] of targets.files) {
      const absolute = resolve(root, path)
      rmSync(absolute, { recursive: true, force: true })
      if (entry.kind === 'file') {
        mkdirSync(dirname(absolute), { recursive: true })
        writeFileSync(absolute, entry.content, { mode: entry.mode })
        chmodSync(absolute, entry.mode)
      }
    }
    for (const directory of targets.missingDirectories) {
      try { rmdirSync(directory) } catch (error) {
        if (!['ENOENT', 'ENOTEMPTY'].includes(error?.code)) throw error
      }
    }
  }
  const session = id => {
    const value = sessions.get(id)
    if (!value) throw new Error('evidence session is unknown or expired')
    return value
  }
  const signed = (current, operation, request, result) => {
    if (current.sequence >= MAX_RECEIPTS_PER_SESSION) throw new Error('evidence session receipt limit reached')
    current.sequence += 1
    const body = { version: 2, sessionId: current.id, sequence: current.sequence, operation, request, result }
    const encodedSignature = sign('sha256', Buffer.from(stable(body)), {
      key: current.privateKey,
      padding: constants.RSA_PKCS1_PADDING,
    }).toString('base64url')
    const signature = encodedSignature.match(/.{1,64}/g)
    if (!signature || signature.length !== 6) throw new Error('evidence signature encoding failed')
    return { ...body, signature }
  }

  return {
    toolNames: TRUSTED_EVIDENCE_TOOL_NAMES,

    startSession({ authorization } = {}) {
      if (sessions.size >= MAX_SESSIONS) throw new Error('evidence server session limit reached; restart Claude Code')
      const normalizedAuthorization = normalizeAuthorization(authorization, root)
      const id = `hxe_${random(24).toString('hex')}`
      if (sessions.has(id)) throw new Error('evidence session identifier collision')
      const { privateKey, publicKey } = keyPair('rsa', { modulusLength: 2048, publicExponent: 0x10001 })
      const publicJwk = publicKey.export({ format: 'jwk' })
      const current = {
        id,
        privateKey,
        publicKey: { kty: 'RSA', n: publicJwk.n, e: publicJwk.e },
        authorization: normalizedAuthorization,
        sequence: 0,
        baselines: new Map(),
        preflights: new Map(),
      }
      sessions.set(id, current)
      return { id, publicKey: current.publicKey }
    },

    captureBaseline({ sessionId, testPaths }) {
      const current = session(sessionId)
      if (!Array.isArray(testPaths) || testPaths.length < 1 || testPaths.length > MAX_PATHS) throw new Error('testPaths must contain one or more repository-relative paths')
      const paths = [...new Set(testPaths.map(path => validatePath(path, root)))].sort()
      if (paths.length !== testPaths.length) throw new Error('testPaths must not contain duplicates')
      if (!current.authorization.tdd || stable(paths) !== stable(current.authorization.tdd.testPaths)) {
        throw new Error('TDD baseline does not match the evidence-session authorization')
      }
      for (const path of paths) {
        const ignored = git(['check-ignore', '-q', '--', path])
        if (ignored.executionErrorCode || ignored.signal || ![0, 1].includes(ignored.exitCode)) throw new Error('TDD test-path ignore inspection failed')
        if (ignored.exitCode === 0) throw new Error(`TDD test path must be Git-visible: ${path}`)
      }
      const state = snapshot()
      const indexTree = textResult(git(['write-tree']), 'TDD baseline index capture')
      const targets = captureSignedTargets(root, paths)
      const receipt = signed(current, 'baseline', { testPaths: paths }, { repository: state.value })
      current.baselines.set(receipt.sequence, { state, testPaths: paths, indexTree, targets })
      return receipt
    },

    reproduceRed({ sessionId, baselineSequence, argv, files }) {
      const current = session(sessionId)
      const baseline = current.baselines.get(baselineSequence)
      if (!baseline) throw new Error('baseline receipt is unknown for this evidence session')
      const command = validateArgv(argv)
      if (!current.authorization.tdd || stable(command) !== stable(current.authorization.tdd.reproductionArgv)) {
        throw new Error('TDD reproduction argv does not match the evidence-session authorization')
      }
      if (!Array.isArray(files) || files.length < 1 || files.length > baseline.testPaths.length) {
        throw new Error('TDD reproduction files must contain one or more signed test-path writes')
      }
      const mutations = files.map(file => {
        if (!file || typeof file !== 'object' || Array.isArray(file)
          || JSON.stringify(Object.keys(file).sort()) !== JSON.stringify(['content', 'path'])
          || typeof file.content !== 'string' || Buffer.byteLength(file.content) > MAX_FILE_BYTES) {
          throw new Error('TDD reproduction file is invalid')
        }
        return { path: validatePath(file.path, root), content: file.content }
      })
      const paths = mutations.map(file => file.path)
      if (new Set(paths).size !== paths.length || paths.some(path => !baseline.testPaths.includes(path))) {
        throw new Error('TDD reproduction files must exactly use unique signed testPaths')
      }
      const before = snapshot()
      if (before.value.fingerprint !== baseline.state.value.fingerprint) {
        throw new Error('repository changed after the signed TDD baseline')
      }
      const currentIndexTree = textResult(git(['write-tree']), 'TDD pre-reproduction index inspection')
      if (currentIndexTree !== baseline.indexTree) throw new Error('repository index changed after the signed TDD baseline')
      const isolated = copyIsolatedRepository(root, baseline.state.value.origin, baseline.state.value.branch, maxIsolatedBytes)
      let executed
      let observedChanges
      let commandMutations
      try {
        const isolatedBaseline = snapshotAt(isolated.isolatedRoot, spawnSync, isolated.environment)
        const isolatedTargets = captureSignedTargets(isolated.isolatedRoot, baseline.testPaths)
        writeSignedFiles(isolated.isolatedRoot, mutations, isolatedTargets)
        const prepared = snapshotAt(isolated.isolatedRoot, spawnSync, isolated.environment)
        executed = commandResult(run, command, isolated.isolatedRoot, {
          env: isolated.environment,
        })
        const afterExecution = snapshotAt(isolated.isolatedRoot, spawnSync, isolated.environment)
        observedChanges = changedPaths(isolatedBaseline, afterExecution)
        commandMutations = changedPaths(prepared, afterExecution)
      } finally {
        rmSync(isolated.temporaryRoot, { recursive: true, force: true })
      }
      const outOfScope = observedChanges.some(path => !baseline.testPaths.includes(path))
      const validRed = !outOfScope && observedChanges.length > 0 && commandMutations.length === 0
        && executed.executionErrorCode === null && executed.signal === null
        && Number.isInteger(executed.exitCode) && executed.exitCode >= 1 && executed.exitCode <= 125
      let finalState = baseline.state
      if (outOfScope || commandMutations.length) {
        throw new Error('TDD red changed repository files while executing outside the signed proposed test contents; isolated workspace discarded')
      }
      if (validRed) {
        const stillCurrent = snapshot()
        if (stillCurrent.value.fingerprint !== baseline.state.value.fingerprint
          || textResult(git(['write-tree']), 'TDD pre-apply index inspection') !== baseline.indexTree) {
          throw new Error('repository changed while the isolated TDD reproduction was running')
        }
        try {
          writeSignedFiles(root, mutations, baseline.targets)
          finalState = snapshot()
          const appliedChanges = changedPaths(baseline.state, finalState)
          if (JSON.stringify(appliedChanges) !== JSON.stringify(observedChanges)) {
            throw new Error('applied TDD test contents do not match the isolated reproduction')
          }
        } catch (error) {
          restoreSignedTargets(baseline.targets)
          textResult(git(['read-tree', baseline.indexTree]), 'TDD apply index restoration')
          const restored = snapshot()
          if (restored.value.fingerprint !== baseline.state.value.fingerprint) {
            throw new Error(`${error.message}; TDD signed-path restoration did not reproduce the exact checkout`)
          }
          throw error
        }
      }
      return signed(current, 'command', {
        argv: command,
        purpose: 'tdd-red',
        baselineSequence,
        testPaths: baseline.testPaths,
        metric: null,
      }, {
        command: outputReceipt(executed),
        repositoryBefore: baseline.state.value.fingerprint,
        repositoryAfter: finalState.value.fingerprint,
        changedPaths: observedChanges,
        restored: !validRed,
        checkout: {
          head: finalState.value.head,
          branch: finalState.value.branch,
          changedPaths: [...new Set(finalState.value.entries.map(entry => entry.path))].sort(),
        },
      })
    },

    runCommand({ sessionId, argv, purpose, metric }) {
      const current = session(sessionId)
      const command = validateArgv(argv)
      if (!['verification', 'measurement', 'tests'].includes(purpose)) throw new Error('command purpose is invalid')
      const normalizedMetric = normalizeMetric(metric)
      if ((purpose === 'measurement') !== (normalizedMetric !== null)) throw new Error('only measurement commands may include a metric')
      const requested = { argv: command, purpose, metric: normalizedMetric }
      if (!current.authorization.commands.some(authorized => stable(authorized) === stable(requested))) {
        throw new Error('command does not match the evidence-session authorization')
      }
      const before = snapshot()
      const executed = commandResult(run, command, root)
      const after = snapshot()
      const mutations = changedPaths(before, after)
      const result = {
        command: outputReceipt(executed),
        repositoryBefore: before.value.fingerprint,
        repositoryAfter: after.value.fingerprint,
        changedPaths: mutations,
        checkout: {
          head: after.value.head,
          branch: after.value.branch,
          changedPaths: [...new Set(after.value.entries.map(entry => entry.path))].sort(),
        },
      }
      if (purpose === 'measurement') {
        result.metric = exactJsonMetric(executed.stdout, normalizedMetric)
      }
      return signed(current, 'command', {
        argv: command,
        purpose,
        baselineSequence: null,
        testPaths: null,
        metric: normalizedMetric,
      }, result)
    },

    verifyPrePr({ sessionId, repository: expectedRepository, headBranch, baseBranch, taskPaths, verificationArgv, releaseCheckArgv }) {
      const current = session(sessionId)
      if (typeof expectedRepository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(expectedRepository)) throw new Error('repository is invalid')
      if (!safeBranch(headBranch)) throw new Error('head branch is invalid')
      if (!safeBranch(baseBranch)) throw new Error('base branch is invalid')
      if (!Array.isArray(taskPaths)) throw new Error('task paths are invalid')
      const paths = [...new Set(taskPaths.map(path => validatePath(path, root)))].sort()
      if (!paths.length || paths.length > MAX_PATHS) throw new Error('task paths are empty or too broad')
      const command = validateArgv(verificationArgv, 'verificationArgv')
      const releaseCommand = validateArgv(releaseCheckArgv, 'releaseCheckArgv')
      const authorized = current.authorization.prePr
      const requestedAuthorization = {
        repository: expectedRepository,
        headBranch,
        baseBranch,
        taskPaths: paths,
        verificationArgv: command,
        releaseCheckArgv: releaseCommand,
      }
      const authorizedPreflight = authorized && {
        repository: authorized.repository,
        headBranch: authorized.headBranch,
        baseBranch: authorized.baseBranch,
        taskPaths: authorized.taskPaths,
        verificationArgv: authorized.verificationArgv,
        releaseCheckArgv: authorized.releaseCheckArgv,
      }
      if (!authorizedPreflight || stable(requestedAuthorization) !== stable(authorizedPreflight)) {
        throw new Error('pre-PR verification does not match the evidence-session authorization')
      }
      const before = snapshot()
      const repository = githubRepository(before.value.origin)
      if (!repository) throw new Error('origin is not a supported GitHub repository')
      if (repository.slug !== expectedRepository) throw new Error('origin does not match the requested GitHub repository')
      if (before.value.branch !== headBranch || headBranch === baseBranch) throw new Error('head branch does not match the requested non-default branch')
      const actualPaths = before.value.entries.map(entry => entry.path).sort()
      if (JSON.stringify(actualPaths) !== JSON.stringify(paths)) throw new Error('working-tree changes do not exactly match taskPaths')
      const fetched = git(['fetch', '--no-tags', 'origin', `refs/heads/${baseBranch}:refs/remotes/origin/${baseBranch}`])
      textResult(fetched, 'remote base refresh')
      const baseRef = git(['rev-parse', `refs/remotes/origin/${baseBranch}`])
      const baseSha = textResult(baseRef, 'remote base inspection')
      const ancestor = git(['merge-base', '--is-ancestor', baseSha, before.value.head])
      if (ancestor.executionErrorCode || ancestor.signal || ancestor.exitCode !== 0) throw new Error('head is not synchronized with the requested remote base')
      const verification = commandResult(run, command, root)
      const releaseCheck = commandResult(run, releaseCommand, root)
      const diffCheck = git(['diff', '--check'])
      const after = snapshot()
      if (after.value.fingerprint !== before.value.fingerprint) throw new Error('pre-PR checks changed the repository')
      const receipt = signed(current, 'pre-pr', {
        repository: expectedRepository,
        headBranch,
        baseBranch,
        taskPaths: paths,
        verificationArgv: command,
        releaseCheckArgv: releaseCommand,
      }, {
        repository: { ...repository, origin: before.value.origin, branch: before.value.branch, head: before.value.head, baseSha, fingerprint: before.value.fingerprint },
        verification: outputReceipt(verification),
        releaseCheck: outputReceipt(releaseCheck),
        diffCheck: outputReceipt(diffCheck),
      })
      current.preflights.set(receipt.sequence, receipt)
      return receipt
    },

    shipPrePr({ sessionId, preflightSequence, commitMessage, pullRequestTitle, pullRequestBody }) {
      const current = session(sessionId)
      const preflight = current.preflights.get(preflightSequence)
      if (!preflight) throw new Error('pre-PR receipt is unknown for this evidence session')
      boundedText(commitMessage, 'commit message', 512, { singleLine: true })
      boundedText(pullRequestTitle, 'pull-request title', 512, { singleLine: true })
      boundedText(pullRequestBody, 'pull-request body', 16384)
      const { request, result } = preflight
      const authorized = current.authorization.prePr
      const requestedAuthorization = {
        repository: request.repository,
        headBranch: request.headBranch,
        baseBranch: request.baseBranch,
        taskPaths: request.taskPaths,
        verificationArgv: request.verificationArgv,
        releaseCheckArgv: request.releaseCheckArgv,
        commitMessage,
        pullRequestTitle,
        pullRequestBody,
      }
      if (!authorized || stable(requestedAuthorization) !== stable(authorized)) {
        throw new Error('shipment does not match the evidence-session authorization')
      }
      const currentState = snapshot()
      if (currentState.value.fingerprint !== result.repository.fingerprint) throw new Error('repository changed after pre-PR verification')
      const indexTree = textResult(git(['write-tree']), 'pre-shipment index capture')
      let committed = false
      try {
        const add = git(['add', '-A', '--', '.'])
        textResult(add, 'task-file staging')
        const staged = git(['diff', '--cached', '--name-status', '-z'])
        if (staged.executionErrorCode || staged.signal || staged.exitCode !== 0) throw new Error('staged path inspection failed')
        const stagedPaths = parseNameStatus(staged.stdout)
        if (JSON.stringify(stagedPaths) !== JSON.stringify(request.taskPaths)) throw new Error('staged paths do not exactly match the verified task paths')
        textResult(git(['commit', '-m', commitMessage]), 'task commit')
        committed = true
      } catch (error) {
        if (!committed) {
          try { textResult(git(['read-tree', indexTree]), 'pre-shipment index restoration') } catch {
            throw new Error(`${error.message}; pre-shipment index restoration failed`)
          }
        }
        throw error
      }
      const head = textResult(git(['rev-parse', 'HEAD']), 'post-commit head inspection')
      textResult(git(['push', 'origin', `HEAD:refs/heads/${result.repository.branch}`]), 'non-force branch push')
      const remoteLine = textResult(git(['ls-remote', '--heads', 'origin', `refs/heads/${result.repository.branch}`]), 'remote branch inspection')
      const remoteHead = remoteLine.split(/\s+/)[0]
      if (remoteHead !== head) throw new Error('remote branch does not match the committed head')
      const repo = result.repository.slug
      const prFields = 'number,url,state,isDraft,headRefName,headRefOid,baseRefName,title,body,mergedAt,headRepository,headRepositoryOwner'
      const list = commandResult(run, ['gh', 'pr', 'list', '--repo', repo, '--head', result.repository.branch, '--base', request.baseBranch, '--state', 'open', '--json', prFields], root)
      const listText = textResult(list, 'pull-request lookup')
      let matches
      try { matches = JSON.parse(listText) } catch { throw new Error('pull-request lookup returned invalid JSON') }
      if (!Array.isArray(matches)) throw new Error('pull-request lookup returned an invalid result')
      const exactMatches = matches.filter(match => match?.headRepositoryOwner?.login === result.repository.owner
        && match?.headRepository?.nameWithOwner === repo && match?.headRefName === result.repository.branch
        && match?.headRefOid === head && match?.baseRefName === request.baseBranch)
      if (exactMatches.length > 1) throw new Error('expected at most one exact open pull request')
      let url = exactMatches[0]?.url
      if (!url) {
        url = textResult(commandResult(run, ['gh', 'pr', 'create', '--repo', repo, '--head', result.repository.branch, '--base', request.baseBranch, '--title', pullRequestTitle, '--body', pullRequestBody], root), 'pull-request creation')
      }
      const view = commandResult(run, ['gh', 'pr', 'view', url, '--repo', repo, '--json', prFields], root)
      let pr
      try { pr = JSON.parse(textResult(view, 'pull-request verification')) } catch { throw new Error('pull-request verification returned invalid JSON') }
      const expectedUrl = `https://github.com/${repo}/pull/${pr.number}`
      if (!Number.isInteger(pr.number) || pr.number < 1 || pr.url !== expectedUrl || pr.state !== 'OPEN' || pr.isDraft !== false
        || pr.headRefName !== result.repository.branch || pr.headRefOid !== head || pr.baseRefName !== request.baseBranch
        || pr.headRepositoryOwner?.login !== result.repository.owner || pr.headRepository?.nameWithOwner !== repo
        || pr.title !== pullRequestTitle || pr.body !== pullRequestBody || pr.mergedAt !== null) {
        throw new Error('pull-request terminal state does not match the verified shipment')
      }
      return signed(current, 'ship', { preflightSequence, commitMessage, pullRequestTitle, pullRequestBody }, {
        repository: repo,
        origin: result.repository.origin,
        headBranch: result.repository.branch,
        headSha: head,
        baseBranch: request.baseBranch,
        pullRequest: pr,
        remoteBranchVerified: true,
      })
    },
  }
}

export const trustedEvidenceInternals = Object.freeze({ stable, safeBranch, validateArgv, githubRepository })
