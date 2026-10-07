import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { discoverModels } from '../skills/setup-helix/scripts/discover-models.mjs'

// The fake executable is the external host boundary; use the real transport.
async function withHost(source, run) {
  const directory = await mkdtemp(join(tmpdir(), 'helix-catalog-'))
  const originalPath = process.env.PATH
  try {
    for (const host of ['codex', 'claude']) {
      await writeFile(join(directory, host), `#!${process.execPath}\n${source}`, { mode: 0o755 })
    }
    process.env.PATH = `${directory}:${originalPath}`
    await run(directory)
  } finally {
    process.env.PATH = originalPath
    await rm(directory, { recursive: true, force: true })
  }
}

const server = body => `
import { createInterface } from 'node:readline';
const send = value => console.log(JSON.stringify(value));
createInterface({input: process.stdin}).on('line', line => {
  const request = JSON.parse(line);
  ${body}
});`
const codexModel = { model: 'sample-model', displayName: 'Sample', hidden: false,
  supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }] }
const codex = result => server(`
if (request.method === 'initialize') send({id: request.id, result: {}});
if (request.method === 'model/list') send({id: request.id, result: ${JSON.stringify(result)}});`)

test('discovery follows native pagination and excludes hidden models', async () => {
  await withHost(server(`
if (request.method === 'initialize') send({id: request.id, result: {}});
if (request.method === 'model/list') {
  if (request.params.includeHidden !== false) process.exit(1);
  const data = request.params.cursor ? [${JSON.stringify({ ...codexModel, model: 'second-model' })}]
    : [${JSON.stringify(codexModel)}, ${JSON.stringify({ ...codexModel, model: 'hidden', hidden: true })}];
  send({id: request.id, result: {data, nextCursor: request.params.cursor ? null : 'next'}});
}`), async () => {
    const result = await discoverModels('codex')
    assert.deepEqual(result.models.map(model => model.id), ['sample-model', 'second-model'])
    assert.deepEqual(result.models[0].efforts, ['low', 'high'])
    assert.equal(result.accessVerified, false)
  })
})

test('the helper executes through a symlinked skill installation', async () => {
  await withHost(codex({ data: [codexModel], nextCursor: null }), async directory => {
    const installed = join(directory, 'installed-skill')
    await symlink(fileURLToPath(new URL('../skills/setup-helix/', import.meta.url)), installed, 'dir')
    for (const flags of [[], ['--preserve-symlinks-main']]) {
      const output = execFileSync(process.execPath, [...flags, join(installed, 'scripts/discover-models.mjs'), 'codex'], { encoding: 'utf8' })
      assert.equal(JSON.parse(output).models[0].id, 'sample-model')
    }
  })
})

test('Claude aliases resolve to literal IDs and expose only model metadata', async () => {
  const response = { account: { secret: 'private-account-sentinel' }, models: [
    { value: 'default', resolvedModel: 'example-1', displayName: 'Default' },
    { value: 'example', resolvedModel: 'example-1', displayName: 'Example', supportedEffortLevels: ['high'] },
    { value: 'alias', resolvedModel: 'example-1', displayName: 'Alias', supportedEffortLevels: ['high'] },
    { value: 'small', resolvedModel: 'small-1', displayName: 'Small' },
  ] }
  await withHost(server(`send({type:'control_response', response:{subtype:'success', request_id:request.request_id, response:${JSON.stringify(response)}}});`), async () => {
    const result = await discoverModels('claude')
    assert.deepEqual(result.models, [
      { id: 'example-1', name: 'Example', efforts: ['high'] },
      { id: 'small-1', name: 'Small', efforts: null },
    ])
    assert.ok(!JSON.stringify(result).includes('private-account-sentinel'))
  })
})

test('Claude discovery preserves existing catalog visibility settings', async () => {
  const keys = ['DISABLE_TELEMETRY', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC']
  const original = keys.map(key => process.env[key])
  try {
    for (const settings of [[undefined, undefined], ['1', undefined], [undefined, '1']]) {
      keys.forEach((key, i) => {
        if (settings[i] === undefined) delete process.env[key]
        else process.env[key] = settings[i]
      })
      await withHost(server(`send({type:'control_response', response:{subtype:'success',
        request_id:request.request_id, response:{models:[{value:'sample',
          resolvedModel:process.env.DISABLE_TELEMETRY === '1' || process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC === '1' ? 'restricted-catalog' : 'full-catalog',
          displayName:'Sample'}]}}});`), async () => {
        const result = await discoverModels('claude')
        assert.equal(result.models[0].id, settings.includes('1') ? 'restricted-catalog' : 'full-catalog')
      })
    }
  } finally {
    keys.forEach((key, i) => {
      if (original[i] === undefined) delete process.env[key]
      else process.env[key] = original[i]
    })
  }
})

test('an empty catalog is an error, never an invented model list', async () => {
  await withHost(codex({ data: [], nextCursor: null }), async () => {
    await assert.rejects(discoverModels('codex'), /no selectable models/)
  })
})

test('malformed model metadata and repeated pagination fail visibly', async () => {
  for (const result of [
    { data: [{ ...codexModel, model: null }], nextCursor: null },
    { data: [codexModel], nextCursor: 'repeated' },
    { data: [{ ...codexModel, supportedReasoningEfforts: [{ reasoningEffort: 3 }] }], nextCursor: null },
  ]) {
    await withHost(codex(result), async () => {
      await assert.rejects(discoverModels('codex'), /metadata|pagination/)
    })
  }
})

test('protocol rejection does not expose the host error payload', async () => {
  await withHost(server(`send({id: request.id, error: {message:'private-error-sentinel'}});`), async () => {
    await assert.rejects(discoverModels('codex'), { message: 'Codex initialization failed.' })
  })
})

test('a hung host is bounded and terminated', async () => {
  await withHost('setInterval(() => {}, 1000)', async () => {
    await assert.rejects(discoverModels('codex', 100), /timed out/)
  })
})

test('server requests with colliding IDs cannot masquerade as Codex replies', async () => {
  await withHost(server(`
if (request.method === 'initialize') {
  send({id:request.id, method:'server/request', params:{}});
  send({id:request.id, result:{}});
}
if (request.method === 'model/list') {
  send({id:request.id, method:'server/request', params:{}});
  send({id:request.id, result:{data:[${JSON.stringify(codexModel)}], nextCursor:null}});
}`), async () => {
    assert.equal((await discoverModels('codex')).models[0].id, 'sample-model')
  })
})

test('cleanup kills a resistant host and its stdout-holding child within the deadline', async () => {
  await withHost(`
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], {stdio:['ignore',1,'ignore']});
writeFileSync(join(dirname(process.argv[1]),'pids.json'), JSON.stringify([process.pid,child.pid]));
process.on('SIGTERM',()=>{});
setInterval(()=>{},1000);
`, async directory => {
    const url = new URL('../skills/setup-helix/scripts/discover-models.mjs', import.meta.url).href
    const worker = `import {discoverModels} from ${JSON.stringify(url)}; await discoverModels('codex',500)`
    let pids = []
    try {
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', worker], { encoding: 'utf8', timeout: 4_000 })
      pids = JSON.parse(await readFile(join(directory, 'pids.json'), 'utf8'))
      assert.equal(result.error, undefined, 'cleanup exceeded its deadline')
      assert.match(result.stderr, /discovery timed out/)
      for (const pid of pids) {
        const state = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })
        assert.ok(!state.stdout.trim() || state.stdout.trim().startsWith('Z'), `process ${pid} survived cleanup`)
      }
    } finally {
      // Also clean up the intentionally broken baseline during regression reproduction.
      for (const pid of pids) {
        try { process.kill(pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
      }
    }
  })
})

test('invalid JSON, oversized output and early exit are visible failures', async () => {
  for (const [source, message] of [
    ['console.log("not JSON"); setInterval(() => {}, 1000)', /Invalid host/],
    ['console.log("null"); setInterval(() => {}, 1000)', /Invalid host/],
    ['console.log("x".repeat(2_000_001)); setInterval(() => {}, 1000)', /too large/],
    ['process.exit(2)', /exited/],
  ]) {
    await withHost(source, async () => {
      await assert.rejects(discoverModels('codex'), message)
    })
  }
})

test('a missing native executable fails without installing or falling back', async () => {
  const originalPath = process.env.PATH
  try {
    process.env.PATH = '/nonexistent-helix-test-directory'
    await assert.rejects(discoverModels('codex'), /Could not start/)
  } finally {
    process.env.PATH = originalPath
  }
})

test('unsupported hosts are rejected before launch', async () => {
  await assert.rejects(discoverModels('other'), /Choose codex or claude/)
})
