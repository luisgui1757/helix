import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, mkdir, symlink, writeFile, lstat, readlink, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import test from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))
const skills = ['helix', 'second-opinion', 'setup-helix', 'unslop']

test('retiring the runtime preserves ignore protection for existing private state', () => {
  const paths = [
    '.helix-cc-local/auth/account.json', '.helix-cc-local/config.yaml',
    '.helix-cc-local/client-token', 'review-prompts/local-review.md',
  ]
  const ignored = execFileSync('git', ['check-ignore', '--no-index', ...paths], {
    cwd: root, encoding: 'utf8',
  }).trim().split('\n')
  assert.deepEqual(ignored, paths)
})

test('the four skills use portable metadata without a product runtime', async () => {
  assert.deepEqual((await readdir(join(root, 'skills'))).sort(), skills)
  for (const name of skills) {
    const content = await readFile(join(root, 'skills', name, 'SKILL.md'), 'utf8')
    const frontmatter = content.match(/^---\n([\s\S]*?)\n---\n/)
    assert.ok(frontmatter, `${name}: standard YAML frontmatter is required`)
    const entries = frontmatter[1].split('\n').map(line => line.split(/: (.*)/s).slice(0, 2))
    assert.deepEqual(entries.map(([key]) => key), ['name', 'description'])
    assert.equal(entries[0][1], name)
    assert.ok(entries[1][1].length > 0 && entries[1][1].length <= 1024)
    assert.doesNotMatch(content, /\$\{CLAUDE_|\$ARGUMENTS|\bWorkflow\(|\bmcp__|^context: fork$/m)
  }
  for (const file of ['codex.md', 'claude-code.md']) {
    const content = await readFile(join(root, 'skills/setup-helix/references', file), 'utf8')
    assert.doesNotMatch(content, /\$\{CLAUDE_|\$ARGUMENTS|\bWorkflow\(|\bmcp__|^context: fork$/m)
  }
  const files = await readdir(root)
  for (const retired of ['package.json', 'package-lock.json', '.mcp.json', 'setup.sh']) {
    assert.ok(!files.includes(retired), `${retired} must not be required by the skill`)
  }
})

for (const [label, host] of [['Codex', '.agents'], ['Claude Code', '.claude']]) {
  for (const missingSource of ['wrong working directory', 'one missing skill']) {
    test(`${label} documented installation rejects ${missingSource} without writing links`, async () => {
      const fixture = await mkdtemp(join(tmpdir(), 'helix-install-source-'))
      try {
        if (missingSource === 'one missing skill') {
          for (const name of skills.filter(name => name !== 'unslop')) {
            await cp(join(root, 'skills', name), join(fixture, 'skills', name), { recursive: true })
          }
        }
        const readme = await readFile(join(root, 'README.md'), 'utf8')
        const commands = readme.match(/```sh\n([\s\S]*?)\n```/)[1]
          .split(`# ${label}\n`)[1].split('\n# ')[0]
          .replaceAll('$HOME', '$HELIX_INSTALL_TEST_ROOT')
        const result = spawnSync('sh', ['-c', commands], {
          cwd: fixture, encoding: 'utf8',
          env: { ...process.env, HELIX_INSTALL_TEST_ROOT: join(fixture, 'user') },
        })
        assert.notEqual(result.status, 0, 'an incomplete source must not report successful installation')
        assert.match(result.stderr, /missing.*SKILL\.md/)
        await assert.rejects(lstat(join(fixture, 'user', host)), { code: 'ENOENT' },
          'source preflight must finish before creating the destination')
      } finally {
        await rm(fixture, { recursive: true, force: true })
      }
    })
  }
  for (const existing of ['absent', 'link', 'other link', 'directory', 'file', 'dangling link']) {
    test(`${label} documented installation preserves ${existing === 'absent' ? 'the installed skill' : `an existing ${existing}`}`, async () => {
      const fixture = await mkdtemp(join(tmpdir(), 'helix-install-'))
      try {
        for (const name of skills) {
          await cp(join(root, 'skills', name), join(fixture, 'skills', name), { recursive: true })
        }
        const source = join(fixture, 'skills/unslop')
        const destination = join(fixture, 'user', host, 'skills/unslop')
        await mkdir(dirname(destination), { recursive: true })
        if (existing === 'link') await symlink(source, destination, 'dir')
        if (existing === 'other link') await symlink(join(fixture, 'skills/helix'), destination, 'dir')
        if (existing === 'dangling link') await symlink(join(fixture, 'missing'), destination, 'dir')
        if (existing === 'directory') {
          await mkdir(destination)
          await writeFile(join(destination, 'keep.txt'), 'existing skill')
        }
        if (existing === 'file') await writeFile(destination, 'existing file')
        const readme = await readFile(join(root, 'README.md'), 'utf8')
        const commands = readme.match(/```sh\n([\s\S]*?)\n```/)[1]
          .split(`# ${label}\n`)[1].split('\n# ')[0]
          .replaceAll('$HOME', join(fixture, 'user'))
        const result = spawnSync('sh', ['-c', commands], { cwd: fixture, encoding: 'utf8' })
        if (existing === 'absent' || existing === 'link') {
          assert.equal(result.status, 0, result.stderr)
          for (const name of skills) {
            assert.equal(await readFile(join(fixture, 'user', host, 'skills', name, 'SKILL.md'), 'utf8'),
              await readFile(join(root, 'skills', name, 'SKILL.md'), 'utf8'))
          }
          const repeat = spawnSync('sh', ['-c', commands], { cwd: fixture, encoding: 'utf8' })
          for (const file of ['unslop/LICENSE', 'setup-helix/references/codex.md', 'setup-helix/references/claude-code.md', 'setup-helix/scripts/discover-models.mjs']) {
            assert.equal(await readFile(join(fixture, 'user', host, 'skills', file), 'utf8'),
              await readFile(join(root, 'skills', file), 'utf8'))
          }
          assert.equal(repeat.status, 0, repeat.stderr)
        } else {
          assert.equal(result.status, 1, result.stderr)
          assert.match(result.stderr, /already exists/)
          if (existing.includes('link')) {
            assert.ok((await lstat(destination)).isSymbolicLink())
            assert.equal(await readlink(destination), existing === 'other link' ? join(fixture, 'skills/helix') : join(fixture, 'missing'))
          }
          if (existing === 'directory') assert.equal(await readFile(join(destination, 'keep.txt'), 'utf8'), 'existing skill')
          if (existing === 'file') assert.equal(await readFile(destination, 'utf8'), 'existing file')
          assert.deepEqual(await readdir(dirname(destination)), ['unslop'], 'preflight must prevent partial installation')
        }
        for (const name of skills) assert.deepEqual(await readdir(join(fixture, 'skills', name)),
          await readdir(join(root, 'skills', name)), 'installation must not create a nested link')
      } finally {
        await rm(fixture, { recursive: true, force: true })
      }
    })
  }
}

test('current documentation has no dangling local file links', async () => {
  const documents = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.md'], {
    cwd: root, encoding: 'utf8',
  }).trim().split('\n')
  for (const document of documents) {
    const content = await readFile(join(root, document), 'utf8')
    for (const [, target] of content.matchAll(/\[[^\]\n]+\]\(([^\s)]+)\)/g)) {
      if (/^(?:https?:|#)/.test(target)) continue
      const path = resolve(root, dirname(document), target.split('#')[0])
      assert.ok(path.startsWith(root), `${document}: link leaves the repository: ${target}`)
      await readFile(path)
    }
  }
})


test('active retirement links retain the archived engine revision', async () => {
  const archive = await readFile(join(root, 'docs/history/README.md'), 'utf8')
  const revision = archive.match(/\b[a-f0-9]{40}\b/)[0]
  for (const document of ['README.md', 'docs/security-governance.md']) {
    const content = await readFile(join(root, document), 'utf8')
    const links = [...content.matchAll(/https:\/\/github\.com\/luisgui1757\/helix\/(?:tree|blob)\/([a-f0-9]+)(?:[)/])/g)]
    assert.ok(links.length, `${document}: missing canonical retirement link`)
    for (const [, linkedRevision] of links) assert.equal(linkedRevision, revision, `${document}: corrupted archive revision`)
  }
})

test('the archived comparison protocol matches its execution receipt', async () => {
  const receipt = JSON.parse(await readFile(join(root, 'evals/results/2026-10-03-comparison.json'), 'utf8'))
  const artifact = await readFile(join(root, receipt.protocolProvenance.executionArtifact))
  assert.equal(createHash('sha256').update(artifact).digest('hex'),
    receipt.executionSourceHashes['evals/comparison.md'])
})
