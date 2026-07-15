import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

test('packaged trusted-evidence MCP server starts, exposes only narrow tools, and executes an exact argv receipt', async t => {
  const root = await mkdtemp(join(tmpdir(), 'helix-cc-mcp-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'README.md'), 'fixture\n')
  const git = (await import('node:child_process')).spawnSync
  for (const argv of [
    ['init', '-b', 'main'], ['config', 'user.name', 'Helix Test'], ['config', 'user.email', 'helix@example.invalid'],
    ['add', 'README.md'], ['commit', '-m', 'fixture'], ['remote', 'add', 'origin', 'https://github.com/acme/example.git'],
  ]) {
    const result = git('git', argv, { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }

  const client = new Client({ name: 'helix-cc-test', version: '1.0.0' })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [new URL('../bin/helix-cc-evidence-mcp', import.meta.url).pathname],
    cwd: root,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    stderr: 'pipe',
  })
  t.after(() => client.close())
  await client.connect(transport)
  const listed = await client.listTools()
  assert.deepEqual(listed.tools.map(tool => tool.name), [
    'start_session', 'capture_baseline', 'reproduce_red', 'run_command', 'verify_pre_pr', 'ship_pre_pr',
  ])
  assert.deepEqual(listed.tools.find(tool => tool.name === 'capture_baseline').inputSchema.required, ['sessionId', 'testPaths'])
  assert.equal(listed.tools.find(tool => tool.name === 'verify_pre_pr').inputSchema.required.includes('releaseCheckArgv'), true)
  const started = await client.callTool({ name: 'start_session', arguments: {} })
  const session = JSON.parse(started.content[0].text)
  assert.match(session.id, /^hxe_[0-9a-f]{48}$/)
  const called = await client.callTool({
    name: 'run_command',
    arguments: { sessionId: session.id, argv: ['node', '-e', 'process.exit(0)'], purpose: 'verification' },
  })
  const receipt = JSON.parse(called.content[0].text).receipt
  assert.deepEqual(receipt.request.argv, ['node', '-e', 'process.exit(0)'])
  assert.equal(receipt.result.command.exitCode, 0)
  assert.equal(receipt.result.command.executionErrorCode, null)
  assert.equal(receipt.result.repositoryBefore, receipt.result.repositoryAfter)
  assert.deepEqual(receipt.result.checkout.changedPaths, [])
  assert.deepEqual(receipt.signature.map(chunk => chunk.length), [64, 64, 64, 64, 64, 22])

  await writeFile(join(root, 'README.md'), 'already dirty\n')
  const modeChange = await client.callTool({
    name: 'run_command',
    arguments: { sessionId: session.id, argv: ['node', '-e', "require('node:fs').chmodSync('README.md', 0o755)"], purpose: 'verification' },
  })
  const modeReceipt = JSON.parse(modeChange.content[0].text).receipt
  assert.notEqual(modeReceipt.result.repositoryBefore, modeReceipt.result.repositoryAfter)
  assert.deepEqual(modeReceipt.result.changedPaths, ['README.md'])
  assert.deepEqual(modeReceipt.result.checkout.changedPaths, ['README.md'])

  const baselineCall = await client.callTool({
    name: 'capture_baseline',
    arguments: { sessionId: session.id, testPaths: ['tests/red.test.mjs'] },
  })
  const baseline = JSON.parse(baselineCall.content[0].text).receipt
  const reproduced = await client.callTool({
    name: 'reproduce_red',
    arguments: {
      sessionId: session.id,
      baselineSequence: baseline.sequence,
      argv: ['node', '-e', 'process.exit(1)'],
      files: [{ path: 'tests/red.test.mjs', content: 'red\n' }],
    },
  })
  const redReceipt = JSON.parse(reproduced.content[0].text).receipt
  assert.equal(redReceipt.result.command.exitCode, 1)
  assert.deepEqual(redReceipt.result.changedPaths, ['tests/red.test.mjs'])
  assert.equal(redReceipt.result.restored, false)
})
