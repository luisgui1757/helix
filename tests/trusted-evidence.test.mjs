import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createEvidenceService } from '../lib/trusted-evidence.mjs'
import { runWorkflow } from './workflow-harness.mjs'

const verificationArgv = ['node', '-e', 'process.exit(0)']
const releaseCheckArgv = ['node', '-e', 'process.exit(0)']

const authorizedCommand = (argv, purpose = 'verification', metric = null) => ({ argv, purpose, metric })
const sessionAuthorization = ({ commands = [], tdd = null, prePr = null } = {}) => ({
  authorization: { commands, tdd, prePr },
})
const shippingAuthorization = ({
  taskPaths,
  commitMessage = 'Ship trusted evidence',
  pullRequestTitle = 'Ship evidence',
  pullRequestBody = 'Exact body',
  repository = 'acme/example',
  headBranch = 'feature/evidence',
  baseBranch = 'main',
} = {}) => sessionAuthorization({
  prePr: {
    repository,
    headBranch,
    baseBranch,
    taskPaths,
    verificationArgv,
    releaseCheckArgv,
    commitMessage,
    pullRequestTitle,
    pullRequestBody,
  },
})

const execute = (command, argv, cwd) => {
  const result = spawnSync(command, argv, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`${command} ${argv.join(' ')} failed: ${result.stderr}`)
  return result.stdout.trim()
}

async function repository() {
  const root = await mkdtemp(join(tmpdir(), 'helix-cc-evidence-'))
  execute('git', ['init', '-b', 'main'], root)
  execute('git', ['config', 'user.name', 'Helix Test'], root)
  execute('git', ['config', 'user.email', 'helix@example.invalid'], root)
  await writeFile(join(root, 'README.md'), 'fixture\n')
  execute('git', ['add', 'README.md'], root)
  execute('git', ['commit', '-m', 'fixture'], root)
  execute('git', ['remote', 'add', 'origin', 'https://github.com/acme/example.git'], root)
  execute('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], root)
  execute('git', ['switch', '-c', 'feature/evidence'], root)
  return root
}

function githubRun(invocations, { stagedOverride, pushFailure = false } = {}) {
  return (command, argv, options) => {
    invocations.push([command, ...argv])
    if (command === 'git' && argv[0] === 'fetch') return { status: 0, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
    if (command === 'git' && argv[0] === 'push') {
      return { status: pushFailure ? 1 : 0, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
    }
    if (command === 'git' && argv[0] === 'ls-remote') {
      const head = execute('git', ['rev-parse', 'HEAD'], options.cwd)
      return { status: 0, signal: null, stdout: Buffer.from(`${head}\trefs/heads/feature/evidence\n`), stderr: Buffer.alloc(0) }
    }
    if (stagedOverride && command === 'git' && argv[0] === 'diff' && argv.includes('--name-status')) {
      return { status: 0, signal: null, stdout: stagedOverride, stderr: Buffer.alloc(0) }
    }
    if (command === 'gh' && argv[0] === 'pr' && argv[1] === 'list') {
      const head = execute('git', ['rev-parse', 'HEAD'], options.cwd)
      const candidate = overrides => ({
        number: 7, url: 'https://github.com/acme/example/pull/7', headRefName: 'feature/evidence', headRefOid: head,
        baseRefName: 'main', headRepository: { nameWithOwner: 'acme/example' }, headRepositoryOwner: { login: 'acme' },
        ...overrides,
      })
      return {
        status: 0, signal: null, stderr: Buffer.alloc(0), stdout: Buffer.from(JSON.stringify([
          candidate({ number: 4, url: 'https://github.com/acme/example/pull/4', headRepository: { nameWithOwner: 'fork/example' }, headRepositoryOwner: { login: 'fork' } }),
          candidate({ number: 5, url: 'https://github.com/acme/example/pull/5', baseRefName: 'release' }),
          candidate({ number: 6, url: 'https://github.com/acme/example/pull/6', headRefOid: '9'.repeat(40) }),
          candidate({}),
        ])),
      }
    }
    if (command === 'gh' && argv[0] === 'pr' && argv[1] === 'create') {
      return { status: 0, signal: null, stdout: Buffer.from('https://github.com/acme/example/pull/7\n'), stderr: Buffer.alloc(0) }
    }
    if (command === 'gh' && argv[0] === 'pr' && argv[1] === 'view') {
      const head = execute('git', ['rev-parse', 'HEAD'], options.cwd)
      return {
        status: 0, signal: null, stderr: Buffer.alloc(0),
        stdout: Buffer.from(JSON.stringify({
          number: 7, url: 'https://github.com/acme/example/pull/7', state: 'OPEN', isDraft: false,
          headRefName: 'feature/evidence', headRefOid: head, baseRefName: 'main', title: 'Ship evidence', body: 'Exact body', mergedAt: null,
          headRepository: { nameWithOwner: 'acme/example' }, headRepositoryOwner: { login: 'acme' },
        })),
      }
    }
    return spawnSync(command, argv, options)
  }
}

async function verify(session, receipt, expectation) {
  return runWorkflow('helix-evidence-verify.js', { session, receipt, expectation }, () => {
    throw new Error('evidence verifier must not invoke an agent')
  })
}

test('trusted command receipts bind exact argv, process outcome, repository delta, and typed metrics', async t => {
  const root = await repository()
  t.after(() => rm(root, { recursive: true, force: true }))
  const service = createEvidenceService({ cwd: root })
  assert.deepEqual(service.toolNames, ['start_session', 'capture_baseline', 'reproduce_red', 'run_command', 'verify_pre_pr', 'ship_pre_pr'])
  const testPaths = ['tests/red.test.mjs']
  const cleanArgv = ['node', '-e', 'process.exit(0)']
  const missingArgv = ['helix-command-that-does-not-exist']
  const redArgv = ['node', '-e', 'process.exit(1)']
  const metricArgv = ['node', '-e', "process.stdout.write(JSON.stringify({metric:'latency',value:1000,unit:'ms'}))"]
  const session = service.startSession(sessionAuthorization({
    commands: [
      authorizedCommand(cleanArgv),
      authorizedCommand(missingArgv),
      authorizedCommand(metricArgv, 'measurement', { metric: 'latency', unit: 'ms' }),
    ],
    tdd: { testPaths, reproductionArgv: redArgv },
  }))
  assert.throws(() => service.captureBaseline({ sessionId: session.id, testPaths: ['.//tmp/red.test.mjs'] }), /task path is invalid/)
  assert.throws(() => service.captureBaseline({ sessionId: session.id, testPaths: ['tests/red.test.mjs', './tests/red.test.mjs'] }), /must not contain duplicates/)
  const baseline = service.captureBaseline({ sessionId: session.id, testPaths })
  assert.equal((await verify(session, baseline, { kind: 'baseline', testPaths })).result.verified, true)

  const clean = service.runCommand({
    sessionId: session.id,
    argv: cleanArgv,
    purpose: 'verification',
  })
  const cleanResult = await verify(session, clean, {
    kind: 'command', argv: cleanArgv, purpose: 'verification', exit: 'zero', repository: 'unchanged',
  })
  assert.equal(cleanResult.result.verified, true)
  assert.deepEqual(cleanResult.result.result.checkout.changedPaths, [])
  await assert.rejects(
    verify(session, { ...clean, signature: clean.signature.slice(0, 5) }, {
      kind: 'command', argv: clean.request.argv, purpose: 'verification', exit: 'zero', repository: 'unchanged',
    }),
    /receipt signature chunks are invalid/,
  )
  await assert.rejects(
    verify(session, clean, { kind: 'command', argv: ['npm', 'test'], purpose: 'verification', exit: 'zero', repository: 'unchanged' }),
    /does not match the requested operation/,
  )

  const missing = service.runCommand({ sessionId: session.id, argv: missingArgv, purpose: 'verification' })
  await assert.rejects(
    verify(session, missing, { kind: 'command', argv: missingArgv, purpose: 'verification', exit: 'zero', repository: 'unchanged' }),
    /did not execute normally/,
  )

  const red = service.reproduceRed({
    sessionId: session.id,
    baselineSequence: baseline.sequence,
    argv: redArgv,
    files: [{ path: 'tests/red.test.mjs', content: 'red\n' }],
  })
  const redResult = await verify(session, red, {
    kind: 'command', argv: red.request.argv, purpose: 'tdd-red', exit: 'red', repository: 'tests-only', baselineSequence: baseline.sequence, testPaths,
  })
  assert.deepEqual(redResult.result.result.changedPaths, ['tests/red.test.mjs'])
  assert.deepEqual(redResult.result.result.checkout.changedPaths, ['tests/red.test.mjs'])

  const metric = service.runCommand({
    sessionId: session.id,
    argv: metricArgv,
    purpose: 'measurement',
    metric: { metric: 'latency', unit: 'ms' },
  })
  const measured = await verify(session, metric, {
    kind: 'command', argv: metric.request.argv, purpose: 'measurement', exit: 'zero', repository: 'unchanged',
    metric: { metric: 'latency', unit: 'ms', comparator: 'lte', value: 10 },
  })
  assert.equal(measured.result.targetMet, false)
})

test('trusted snapshots reject an executable-mode mutation on an already-dirty tracked file', async t => {
  const root = await repository()
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'README.md'), 'already dirty\n')
  const service = createEvidenceService({ cwd: root })
  const argv = ['node', '-e', "require('node:fs').chmodSync('README.md', 0o755)"]
  const session = service.startSession(sessionAuthorization({ commands: [authorizedCommand(argv)] }))
  const receipt = service.runCommand({
    sessionId: session.id,
    argv,
    purpose: 'verification',
  })
  assert.deepEqual(receipt.result.changedPaths, ['README.md'])
  assert.deepEqual(receipt.result.checkout.changedPaths, ['README.md'])
  await assert.rejects(
    verify(session, receipt, {
      kind: 'command', argv: receipt.request.argv, purpose: 'verification', exit: 'zero', repository: 'unchanged',
    }),
    /verification command changed the repository/,
  )
})

test('trusted evidence refuses unbound command and TDD argv before execution', async t => {
  const root = await repository()
  t.after(() => rm(root, { recursive: true, force: true }))
  const sentinel = join(root, '..', `helix-cc-unauthorized-${process.pid}-${Date.now()}`)
  t.after(() => rm(sentinel, { force: true }))
  const authorizedRed = ['node', '-e', 'process.exit(1)']
  const unauthorized = [
    'node',
    '-e',
    `require('node:fs').writeFileSync(${JSON.stringify(sentinel)},'executed\\n');process.exit(1)`,
  ]
  const service = createEvidenceService({ cwd: root })
  assert.throws(() => service.startSession(), /evidence authorization/)
  const session = service.startSession(sessionAuthorization({
    tdd: { testPaths: ['tests/bug.test.mjs'], reproductionArgv: authorizedRed },
  }))
  assert.throws(() => service.runCommand({
    sessionId: session.id,
    argv: unauthorized,
    purpose: 'verification',
  }), /does not match the evidence-session authorization/)
  await assert.rejects(stat(sentinel), /ENOENT/)
  const baseline = service.captureBaseline({ sessionId: session.id, testPaths: ['tests/bug.test.mjs'] })
  assert.throws(() => service.reproduceRed({
    sessionId: session.id,
    baselineSequence: baseline.sequence,
    argv: unauthorized,
    files: [{ path: 'tests/bug.test.mjs', content: 'red\n' }],
  }), /does not match the evidence-session authorization/)
  await assert.rejects(stat(sentinel), /ENOENT/)
})

test('trusted TDD reproduction refuses an oversized isolated working-tree copy with a typed path', async t => {
  const root = await repository()
  t.after(() => rm(root, { recursive: true, force: true }))
  const reproductionArgv = ['node', '-e', 'process.exit(1)']
  const service = createEvidenceService({ cwd: root, maxIsolatedBytes: 4 })
  const session = service.startSession(sessionAuthorization({
    tdd: { testPaths: ['tests/bug.test.mjs'], reproductionArgv },
  }))
  const baseline = service.captureBaseline({ sessionId: session.id, testPaths: ['tests/bug.test.mjs'] })
  assert.throws(() => service.reproduceRed({
    sessionId: session.id,
    baselineSequence: baseline.sequence,
    argv: reproductionArgv,
    files: [{ path: 'tests/bug.test.mjs', content: 'red\n' }],
  }), /isolated working-tree copy exceeds the 4-byte limit at: README\.md/)
  await assert.rejects(stat(join(root, 'tests', 'bug.test.mjs')), /ENOENT/)
})

test('trusted baseline and pre-PR authorization mismatches fail before repository effects', async t => {
  const root = await repository()
  t.after(() => rm(root, { recursive: true, force: true }))
  const invocations = []
  const run = (command, argv, options) => {
    invocations.push([command, ...argv])
    return spawnSync(command, argv, options)
  }
  const service = createEvidenceService({ cwd: root, run })
  const tddSession = service.startSession(sessionAuthorization({
    tdd: { testPaths: ['tests/authorized.test.mjs'], reproductionArgv: ['node', '-e', 'process.exit(1)'] },
  }))
  assert.throws(() => service.captureBaseline({
    sessionId: tddSession.id,
    testPaths: ['tests/different.test.mjs'],
  }), /baseline does not match the evidence-session authorization/)
  assert.deepEqual(invocations, [])

  const prePrSession = service.startSession(shippingAuthorization({ taskPaths: ['task.txt'] }))
  assert.throws(() => service.verifyPrePr({
    sessionId: prePrSession.id,
    repository: 'acme/example',
    headBranch: 'feature/evidence',
    baseBranch: 'main',
    taskPaths: ['task.txt'],
    verificationArgv: ['node', '-e', 'process.exit(2)'],
    releaseCheckArgv,
  }), /pre-PR verification does not match the evidence-session authorization/)
  assert.deepEqual(invocations, [])
})

test('trusted TDD red discards every out-of-scope mutation class without changing the checkout or index', async t => {
  const scenarios = [
    ['tracked edit', "require('node:fs').writeFileSync('README.md', 'changed\\n')"],
    ['new file', "require('node:fs').writeFileSync('outside.mjs', 'new\\n')"],
    ['deletion', "require('node:fs').unlinkSync('README.md')"],
    ['rename', "require('node:fs').renameSync('README.md', 'GUIDE.md')"],
    ['mode and index', "require('node:fs').chmodSync('README.md', 0o755); require('node:child_process').spawnSync('git', ['add', 'README.md'])"],
  ]
  for (const [name, mutation] of scenarios) {
    const root = await repository()
    t.after(() => rm(root, { recursive: true, force: true }))
    await writeFile(join(root, 'README.md'), 'staged\n')
    execute('git', ['add', 'README.md'], root)
    await writeFile(join(root, 'README.md'), 'unstaged\n')
    await writeFile(join(root, 'keep.txt'), 'keep\n')
    const beforeStatus = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: root }).stdout
    const beforeIndex = spawnSync('git', ['diff', '--cached', '--raw', '-z'], { cwd: root }).stdout
    const beforeMode = (await stat(join(root, 'README.md'))).mode & 0o777
    const service = createEvidenceService({ cwd: root })
    const reproductionArgv = ['node', '-e', `${mutation}; process.exit(1)`]
    const session = service.startSession(sessionAuthorization({
      tdd: { testPaths: ['tests/bug.test.mjs'], reproductionArgv },
    }))
    const baseline = service.captureBaseline({ sessionId: session.id, testPaths: ['tests/bug.test.mjs'] })
    await assert.rejects(
      Promise.resolve().then(() => service.reproduceRed({
        sessionId: session.id,
        baselineSequence: baseline.sequence,
        argv: reproductionArgv,
        files: [{ path: 'tests/bug.test.mjs', content: 'red\n' }],
      })),
      /isolated workspace discarded/,
      name,
    )
    assert.deepEqual(spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: root }).stdout, beforeStatus, name)
    assert.deepEqual(spawnSync('git', ['diff', '--cached', '--raw', '-z'], { cwd: root }).stdout, beforeIndex, name)
    assert.equal(await readFile(join(root, 'README.md'), 'utf8'), 'unstaged\n', name)
    assert.equal((await stat(join(root, 'README.md'))).mode & 0o777, beforeMode, name)
    assert.equal(await readFile(join(root, 'keep.txt'), 'utf8'), 'keep\n', name)
    for (const path of ['GUIDE.md', 'outside.mjs', 'tests/bug.test.mjs']) {
      await assert.rejects(stat(join(root, path)), /ENOENT/, `${name}: ${path}`)
    }
  }
})

test('trusted TDD red discards a green attempt before allowing a revised reproduction', async t => {
  const root = await repository()
  t.after(() => rm(root, { recursive: true, force: true }))
  const service = createEvidenceService({ cwd: root })
  const reproductionArgv = [
    'node',
    '-e',
    "process.exit(require('node:fs').readFileSync('tests/bug.test.mjs','utf8')==='red\\n'?1:0)",
  ]
  const session = service.startSession(sessionAuthorization({
    tdd: { testPaths: ['tests/bug.test.mjs'], reproductionArgv },
  }))
  const baseline = service.captureBaseline({ sessionId: session.id, testPaths: ['tests/bug.test.mjs'] })
  const green = service.reproduceRed({
    sessionId: session.id,
    baselineSequence: baseline.sequence,
    argv: reproductionArgv,
    files: [{ path: 'tests/bug.test.mjs', content: 'not red\n' }],
  })
  assert.equal(green.result.restored, true)
  assert.deepEqual(green.result.checkout.changedPaths, [])
  await assert.rejects(stat(join(root, 'tests/bug.test.mjs')), /ENOENT/)
  const red = service.reproduceRed({
    sessionId: session.id,
    baselineSequence: baseline.sequence,
    argv: reproductionArgv,
    files: [{ path: 'tests/bug.test.mjs', content: 'red\n' }],
  })
  assert.equal(red.result.restored, false)
  assert.deepEqual(red.result.changedPaths, ['tests/bug.test.mjs'])
})

test('trusted TDD baseline rejects ignored test paths and red without a proposed test delta', async t => {
  const root = await repository()
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, '.gitignore'), 'ignored/\n')
  await writeFile(join(root, 'existing.test.mjs'), 'already present\n')
  execute('git', ['add', '.gitignore', 'existing.test.mjs'], root)
  execute('git', ['commit', '-m', 'TDD visibility fixture'], root)
  const service = createEvidenceService({ cwd: root })
  const ignoredSession = service.startSession(sessionAuthorization({
    tdd: { testPaths: ['ignored/bug.test.mjs'], reproductionArgv: ['node', '-e', 'process.exit(1)'] },
  }))
  assert.throws(() => service.captureBaseline({ sessionId: ignoredSession.id, testPaths: ['ignored/bug.test.mjs'] }), /must be Git-visible/)
  const reproductionArgv = ['node', '-e', 'process.exit(1)']
  const session = service.startSession(sessionAuthorization({
    tdd: { testPaths: ['existing.test.mjs'], reproductionArgv },
  }))
  const baseline = service.captureBaseline({ sessionId: session.id, testPaths: ['existing.test.mjs'] })
  const receipt = service.reproduceRed({
    sessionId: session.id,
    baselineSequence: baseline.sequence,
    argv: reproductionArgv,
    files: [{ path: 'existing.test.mjs', content: 'already present\n' }],
  })
  assert.equal(receipt.result.restored, true)
  assert.deepEqual(receipt.result.changedPaths, [])
  assert.equal(await readFile(join(root, 'existing.test.mjs'), 'utf8'), 'already present\n')
})

test('trusted TDD reproduction isolates ignored, Git-internal, home, and sibling filesystem effects for red and green attempts', async t => {
  for (const exitCode of [0, 1]) {
    const root = await repository()
    t.after(() => rm(root, { recursive: true, force: true }))
    await writeFile(join(root, '.gitignore'), 'ignored/\n')
    await mkdir(join(root, 'ignored'))
    await writeFile(join(root, 'ignored', 'existing.txt'), 'original\n')
    execute('git', ['add', '.gitignore'], root)
    execute('git', ['commit', '-m', 'ignore fixture state'], root)
    const siblingName = `helix-cc-tdd-sibling-${process.pid}-${exitCode}`
    const sibling = join(root, '..', siblingName)
    t.after(() => rm(sibling, { force: true }))
    const service = createEvidenceService({ cwd: root })
    const script = [
      "const fs=require('node:fs')",
      "fs.writeFileSync('ignored/existing.txt','changed\\n')",
      "fs.writeFileSync('ignored/new.txt','new\\n')",
      "fs.writeFileSync('.git/sentinel','git\\n')",
      `fs.writeFileSync('../${siblingName}','sibling\\n')`,
      "fs.writeFileSync(require('node:path').join(process.env.HOME,'home-sentinel'),'home\\n')",
      `process.exit(${exitCode})`,
    ].join(';')
    const reproductionArgv = ['node', '-e', script]
    const session = service.startSession(sessionAuthorization({
      tdd: { testPaths: ['tests/bug.test.mjs'], reproductionArgv },
    }))
    const baseline = service.captureBaseline({ sessionId: session.id, testPaths: ['tests/bug.test.mjs'] })
    const receipt = service.reproduceRed({
      sessionId: session.id,
      baselineSequence: baseline.sequence,
      argv: reproductionArgv,
      files: [{ path: 'tests/bug.test.mjs', content: 'red\n' }],
    })
    assert.equal(receipt.result.restored, exitCode === 0)
    assert.equal(await readFile(join(root, 'ignored', 'existing.txt'), 'utf8'), 'original\n')
    for (const path of [join(root, 'ignored', 'new.txt'), join(root, '.git', 'sentinel'), sibling]) {
      await assert.rejects(stat(path), /ENOENT/)
    }
    if (exitCode === 0) await assert.rejects(stat(join(root, 'tests', 'bug.test.mjs')), /ENOENT/)
    else assert.equal(await readFile(join(root, 'tests', 'bug.test.mjs'), 'utf8'), 'red\n')
  }
})

test('trusted TDD reproduction clears inherited checkout redirects and points project state at the disposable copy', async t => {
  const root = await repository()
  t.after(() => rm(root, { recursive: true, force: true }))
  const inherited = {
    BASH_ENV: join(root, 'shell-init'),
    ENV: join(root, 'shell-init'),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: join(root, '.git', 'objects'),
    GIT_DIR: join(root, '.git'),
    GIT_INDEX_FILE: join(root, '.git', 'index'),
    GIT_OBJECT_DIRECTORY: join(root, '.git', 'objects'),
    GIT_WORK_TREE: root,
    NODE_OPTIONS: '--require=/definitely/not/a/real/module.cjs',
    NODE_PATH: root,
  }
  const originalHome = process.env.HOME ?? ''
  const previous = Object.fromEntries(Object.keys(inherited).map(name => [name, process.env[name]]))
  Object.assign(process.env, inherited)
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })
  const service = createEvidenceService({ cwd: root })
  const script = [
    `const forbidden=${JSON.stringify(Object.keys(inherited))}`,
    'if(forbidden.some(name=>process.env[name]!==undefined))process.exit(2)',
    'if(process.env.CLAUDE_PROJECT_DIR===process.argv[1])process.exit(3)',
    'if(process.env.PWD!==process.env.CLAUDE_PROJECT_DIR||process.env.INIT_CWD!==process.env.CLAUDE_PROJECT_DIR)process.exit(4)',
    'if(process.env.HOME===process.argv[2])process.exit(5)',
    'process.exit(1)',
  ].join(';')
  const reproductionArgv = ['node', '-e', script, root, originalHome]
  const session = service.startSession(sessionAuthorization({
    tdd: { testPaths: ['tests/bug.test.mjs'], reproductionArgv },
  }))
  const baseline = service.captureBaseline({ sessionId: session.id, testPaths: ['tests/bug.test.mjs'] })
  const receipt = service.reproduceRed({
    sessionId: session.id,
    baselineSequence: baseline.sequence,
    argv: reproductionArgv,
    files: [{ path: 'tests/bug.test.mjs', content: 'red\n' }],
  })
  assert.equal(receipt.result.command.exitCode, 1)
  assert.equal(receipt.result.restored, false)
  assert.equal(await readFile(join(root, 'tests', 'bug.test.mjs'), 'utf8'), 'red\n')
})

test('trusted pre-PR and shipment receipts bind one GitHub repository, exact files, non-force push, and one open PR', async t => {
  const root = await repository()
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'task.txt'), 'task\n')
  const invocations = []
  const run = (command, argv, options) => {
    invocations.push([command, ...argv])
    if (command === 'git' && argv[0] === 'fetch') return { status: 0, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
    if (command === 'git' && argv[0] === 'push') return { status: 0, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
    if (command === 'git' && argv[0] === 'ls-remote') {
      const head = execute('git', ['rev-parse', 'HEAD'], options.cwd)
      return { status: 0, signal: null, stdout: Buffer.from(`${head}\trefs/heads/feature/evidence\n`), stderr: Buffer.alloc(0) }
    }
    if (command === 'gh' && argv[0] === 'pr' && argv[1] === 'list') {
      return { status: 0, signal: null, stdout: Buffer.from('[]'), stderr: Buffer.alloc(0) }
    }
    if (command === 'gh' && argv[0] === 'pr' && argv[1] === 'create') {
      return { status: 0, signal: null, stdout: Buffer.from('https://github.com/acme/example/pull/7\n'), stderr: Buffer.alloc(0) }
    }
    if (command === 'gh' && argv[0] === 'pr' && argv[1] === 'view') {
      const head = execute('git', ['rev-parse', 'HEAD'], options.cwd)
      return {
        status: 0, signal: null, stderr: Buffer.alloc(0),
        stdout: Buffer.from(JSON.stringify({
          number: 7, url: 'https://github.com/acme/example/pull/7', state: 'OPEN', isDraft: false,
          headRefName: 'feature/evidence', headRefOid: head, baseRefName: 'main', title: 'Ship evidence', body: 'Exact body', mergedAt: null,
          headRepository: { nameWithOwner: 'acme/example' }, headRepositoryOwner: { login: 'acme' },
        })),
      }
    }
    return spawnSync(command, argv, options)
  }
  const service = createEvidenceService({ cwd: root, run })
  const otherRepositorySession = service.startSession(shippingAuthorization({
    taskPaths: ['task.txt'], repository: 'other/repository',
  }))
  await assert.rejects(
    Promise.resolve().then(() => service.verifyPrePr({
      sessionId: otherRepositorySession.id, repository: 'other/repository', headBranch: 'feature/evidence', baseBranch: 'main', taskPaths: ['task.txt'], verificationArgv, releaseCheckArgv,
    })),
    /origin does not match/,
  )
  const otherHeadSession = service.startSession(shippingAuthorization({
    taskPaths: ['task.txt'], headBranch: 'feature/other',
  }))
  await assert.rejects(
    Promise.resolve().then(() => service.verifyPrePr({
      sessionId: otherHeadSession.id, repository: 'acme/example', headBranch: 'feature/other', baseBranch: 'main', taskPaths: ['task.txt'], verificationArgv, releaseCheckArgv,
    })),
    /head branch does not match/,
  )
  assert.throws(
    () => service.startSession(shippingAuthorization({ taskPaths: ['.git/config'] })),
    /task path is invalid/,
  )
  const otherPathSession = service.startSession(shippingAuthorization({ taskPaths: ['README.md'] }))
  await assert.rejects(
    Promise.resolve().then(() => service.verifyPrePr({
      sessionId: otherPathSession.id, repository: 'acme/example', headBranch: 'feature/evidence', baseBranch: 'main', taskPaths: ['README.md'], verificationArgv, releaseCheckArgv,
    })),
    /exactly match taskPaths/,
  )
  const session = service.startSession(shippingAuthorization({ taskPaths: ['task.txt'] }))
  const preflight = service.verifyPrePr({
    sessionId: session.id, repository: 'acme/example', headBranch: 'feature/evidence', baseBranch: 'main', taskPaths: ['task.txt'], verificationArgv, releaseCheckArgv,
  })
  assert.equal((await verify(session, preflight, {
    kind: 'pre-pr', repository: 'acme/example', headBranch: 'feature/evidence', baseBranch: 'main', taskPaths: ['task.txt'], verificationArgv, releaseCheckArgv,
  })).result.verified, true)

  const headBeforeUnauthorizedShipment = execute('git', ['rev-parse', 'HEAD'], root)
  assert.throws(() => service.shipPrePr({
    sessionId: session.id,
    preflightSequence: preflight.sequence,
    commitMessage: 'Ship trusted evidence',
    pullRequestTitle: 'Different title',
    pullRequestBody: 'Exact body',
  }), /shipment does not match the evidence-session authorization/)
  assert.equal(execute('git', ['rev-parse', 'HEAD'], root), headBeforeUnauthorizedShipment)

  for (const metadata of [
    { commitMessage: 'Ship\nnow', pullRequestTitle: 'Ship evidence' },
    { commitMessage: 'Ship\rnow', pullRequestTitle: 'Ship evidence' },
    { commitMessage: 'Ship trusted evidence', pullRequestTitle: 'Ship\nnow' },
    { commitMessage: 'Ship trusted evidence', pullRequestTitle: 'Ship\rnow' },
  ]) assert.throws(() => service.shipPrePr({
    sessionId: session.id,
    preflightSequence: preflight.sequence,
    pullRequestBody: 'Exact body',
    ...metadata,
  }), /must be single-line/)

  const shipment = service.shipPrePr({
    sessionId: session.id,
    preflightSequence: preflight.sequence,
    commitMessage: 'Ship trusted evidence',
    pullRequestTitle: 'Ship evidence',
    pullRequestBody: 'Exact body',
  })
  const shipped = await verify(session, shipment, {
    kind: 'ship', preflightSequence: preflight.sequence, commitMessage: 'Ship trusted evidence', pullRequestTitle: 'Ship evidence', pullRequestBody: 'Exact body',
    repository: 'acme/example', origin: 'https://github.com/acme/example.git', headBranch: 'feature/evidence', baseBranch: 'main',
  })
  assert.equal(shipped.result.result.pullRequest.number, 7)
  assert.ok(invocations.some(argv => JSON.stringify(argv) === JSON.stringify(['git', 'push', 'origin', 'HEAD:refs/heads/feature/evidence'])))
  const lookup = invocations.find(argv => argv[0] === 'gh' && argv[1] === 'pr' && argv[2] === 'list')
  assert.equal(lookup[lookup.indexOf('--head') + 1], 'feature/evidence')
  assert.equal(lookup.includes('acme:feature/evidence'), false)
  assert.equal(invocations.some(argv => argv.includes('--force') || argv.includes('--force-with-lease') || argv.includes('merge')), false)
})

test('trusted shipment accepts pure renames and rename-plus-edit task scopes', async t => {
  for (const edited of [false, true]) {
    const root = await repository()
    t.after(() => rm(root, { recursive: true, force: true }))
    execute('git', ['mv', 'README.md', 'GUIDE.md'], root)
    if (edited) await writeFile(join(root, 'GUIDE.md'), 'fixture with a material edit\n')
    const invocations = []
    const service = createEvidenceService({ cwd: root, run: githubRun(invocations) })
    const taskPaths = ['GUIDE.md', 'README.md']
    const commitMessage = edited ? 'Rename and edit guide' : 'Rename guide'
    const session = service.startSession(shippingAuthorization({ taskPaths, commitMessage }))
    const preflight = service.verifyPrePr({
      sessionId: session.id, repository: 'acme/example', headBranch: 'feature/evidence', baseBranch: 'main',
      taskPaths, verificationArgv, releaseCheckArgv,
    })
    const shipment = service.shipPrePr({
      sessionId: session.id, preflightSequence: preflight.sequence, commitMessage,
      pullRequestTitle: 'Ship evidence', pullRequestBody: 'Exact body',
    })
    assert.equal(shipment.result.pullRequest.state, 'OPEN')
    assert.equal(invocations.some(argv => argv[0] === 'gh' && argv[1] === 'pr' && argv[2] === 'create'), false)
    assert.equal(execute('git', ['status', '--porcelain'], root), '')
  }
})

test('failed shipment restores the exact pre-call index', async t => {
  const root = await repository()
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'task.txt'), 'task\n')
  const invocations = []
  const service = createEvidenceService({
    cwd: root,
    run: githubRun(invocations, { stagedOverride: Buffer.from('M\0unexpected.txt\0') }),
  })
  const session = service.startSession(shippingAuthorization({ taskPaths: ['task.txt'] }))
  const preflight = service.verifyPrePr({
    sessionId: session.id, repository: 'acme/example', headBranch: 'feature/evidence', baseBranch: 'main',
    taskPaths: ['task.txt'], verificationArgv, releaseCheckArgv,
  })
  const beforeIndex = spawnSync('git', ['diff', '--cached', '--raw', '-z'], { cwd: root }).stdout
  assert.throws(() => service.shipPrePr({
    sessionId: session.id, preflightSequence: preflight.sequence, commitMessage: 'Ship trusted evidence',
    pullRequestTitle: 'Ship evidence', pullRequestBody: 'Exact body',
  }), /staged paths do not exactly match/)
  const afterIndex = spawnSync('git', ['diff', '--cached', '--raw', '-z'], { cwd: root }).stdout
  assert.deepEqual(afterIndex, beforeIndex)
  assert.equal(execute('git', ['status', '--porcelain'], root), '?? task.txt')
})

test('post-commit shipment failure leaves the local commit for operator inspection', async t => {
  const root = await repository()
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'task.txt'), 'task\n')
  const invocations = []
  const service = createEvidenceService({ cwd: root, run: githubRun(invocations, { pushFailure: true }) })
  const session = service.startSession(shippingAuthorization({ taskPaths: ['task.txt'] }))
  const preflight = service.verifyPrePr({
    sessionId: session.id,
    repository: 'acme/example',
    headBranch: 'feature/evidence',
    baseBranch: 'main',
    taskPaths: ['task.txt'],
    verificationArgv,
    releaseCheckArgv,
  })
  const beforeHead = execute('git', ['rev-parse', 'HEAD'], root)
  assert.throws(() => service.shipPrePr({
    sessionId: session.id,
    preflightSequence: preflight.sequence,
    commitMessage: 'Ship trusted evidence',
    pullRequestTitle: 'Ship evidence',
    pullRequestBody: 'Exact body',
  }), /non-force branch push failed/)
  assert.notEqual(execute('git', ['rev-parse', 'HEAD'], root), beforeHead)
  assert.equal(execute('git', ['status', '--porcelain'], root), '')
})
