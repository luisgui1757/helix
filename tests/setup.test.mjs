import assert from 'node:assert/strict'
import { chmod, lstat, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))
const launcher = join(root, 'bin', 'claudex')
const setup = join(root, 'setup.sh')

async function fakeCommand(directory, name) {
  const path = join(directory, name)
  await writeFile(path, '#!/usr/bin/env bash\nprintf "%s\\n" "$@"\n')
  await chmod(path, 0o755)
  return path
}

test('claudex launches native Claude with Helix CC loaded', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'claudex-native-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await fakeCommand(directory, 'claude')
  const result = spawnSync(launcher, ['--model', 'fable'], {
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, CLAUDEX_PROVIDERS: '' },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(result.stdout.trim().split('\n'), ['--plugin-dir', root.replace(/\/$/, ''), '--model', 'fable'])
})

test('claudex requires an explicit provider model and parses launcher options in any order', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'claudex-provider-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await fakeCommand(directory, 'node')
  const missing = spawnSync(launcher, ['--providers', 'copilot'], {
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
    encoding: 'utf8',
  })
  assert.equal(missing.status, 2)
  assert.match(missing.stderr, /provider-backed mode requires --model/)

  const mixed = spawnSync(launcher, ['--model', 'openai/gpt-5.6-luna', '--providers', 'codex,copilot'], {
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
    encoding: 'utf8',
  })
  assert.equal(mixed.status, 0, mixed.stderr)
  assert.deepEqual(mixed.stdout.trim().split('\n'), [
    join(root, 'bin', 'helix-cc-cliproxy'),
    'run',
    '--providers',
    'codex,copilot',
    '--',
    '--model',
    'openai/gpt-5.6-luna',
  ])

  const fromEnvironment = spawnSync(launcher, ['--providers', 'codex', '--effort', 'high'], {
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      CLAUDEX_MODEL: 'gpt-5.6-luna',
    },
    encoding: 'utf8',
  })
  assert.equal(fromEnvironment.status, 0, fromEnvironment.stderr)
  assert.deepEqual(fromEnvironment.stdout.trim().split('\n').slice(-4), [
    '--model',
    'gpt-5.6-luna',
    '--effort',
    'high',
  ])

  const conflicting = spawnSync(launcher, ['--native', '--providers', 'codex', '--model', 'gpt-5.6-luna'], {
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
    encoding: 'utf8',
  })
  assert.equal(conflicting.status, 2)
  assert.match(conflicting.stderr, /cannot be combined/)

  const duplicate = spawnSync(launcher, ['--providers', 'codex', '--providers=copilot', '--model', 'copilot/gpt-5.4'], {
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
    encoding: 'utf8',
  })
  assert.equal(duplicate.status, 2)
  assert.match(duplicate.stderr, /may be specified only once/)
})

test('setup installs the claudex symlink idempotently and refuses collisions', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'claudex-setup-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = spawnSync(setup, ['--launcher-only', '--bin-dir', directory], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }
  const target = join(directory, 'claudex')
  assert.equal((await lstat(target)).isSymbolicLink(), true)
  assert.equal(await realpath(target), await realpath(launcher))

  const collisionDirectory = await mkdtemp(join(tmpdir(), 'claudex-collision-'))
  t.after(() => rm(collisionDirectory, { recursive: true, force: true }))
  await writeFile(join(collisionDirectory, 'claudex'), 'user-owned\n')
  const collision = spawnSync(setup, ['--launcher-only', '--bin-dir', collisionDirectory], { encoding: 'utf8' })
  assert.equal(collision.status, 1)
  assert.match(collision.stderr, /refusing to replace existing launcher/)
})

test('setup reports the exact PATH handoff when the launcher directory is not discoverable', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'claudex-path-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const env = {
    HOME: join(directory, 'home'),
    PATH: '/usr/bin:/bin',
    SHELL: '/bin/zsh',
  }
  const binDirectory = join(directory, 'commands')
  const result = spawnSync(setup, ['--launcher-only', '--bin-dir', binDirectory], {
    env,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /installation complete, but claudex is not on the invoking shell's PATH/)
  assert.match(result.stdout, new RegExp(`export PATH=${JSON.stringify(`${binDirectory}:$PATH`).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  assert.match(result.stdout, /\.zshrc/)
  assert.doesNotMatch(result.stdout, /claudex is ready/)

  const discoverable = spawnSync(setup, ['--launcher-only', '--bin-dir', binDirectory], {
    env: { ...env, PATH: `${binDirectory}:${env.PATH}` },
    encoding: 'utf8',
  })
  assert.equal(discoverable.status, 0, discoverable.stderr)
  assert.match(discoverable.stdout, /claudex is ready at/)
})

test('setup uses the official stable installer without a curl-to-shell pipeline', async () => {
  const source = await readFile(setup, 'utf8')
  assert.match(source, /https:\/\/claude\.ai\/install\.sh/)
  assert.match(source, /curl -fsSL [^\n]+ -o/)
  assert.match(source, /bash "\$temporary_dir\/claude-install\.sh" stable/)
  assert.doesNotMatch(source, /curl[^\n|]*\|\s*bash/)
  const syntax = spawnSync('bash', ['-n', setup, launcher], { encoding: 'utf8' })
  assert.equal(syntax.status, 0, syntax.stderr)
  const directory = await mkdtemp(join(tmpdir(), 'claudex-dry-run-'))
  try {
    const dryRun = spawnSync(setup, ['--dry-run', '--bin-dir', directory], { encoding: 'utf8' })
    assert.equal(dryRun.status, 0, dryRun.stderr)
    assert.match(dryRun.stdout, /Dry run complete; no changes were made/)
    await assert.rejects(lstat(join(directory, 'claudex')), /ENOENT/)

    const fakeBin = directory
    await fakeCommand(fakeBin, 'claude')
    await writeFile(join(fakeBin, 'claude'), '#!/usr/bin/env bash\necho "2.1.100"\n')
    await chmod(join(fakeBin, 'claude'), 0o755)
    const oldClaude = spawnSync(setup, ['--dry-run', '--bin-dir', directory], {
      env: {
        ...process.env,
        HOME: join(directory, 'home'),
        PATH: `${fakeBin}:${process.env.PATH}`,
      },
      encoding: 'utf8',
    })
    assert.equal(oldClaude.status, 0, oldClaude.stderr)
    assert.match(oldClaude.stdout, /Would install Claude Code from Anthropic's official stable installer/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
