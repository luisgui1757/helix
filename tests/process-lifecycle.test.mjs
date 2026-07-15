import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { connect } from 'node:net'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { waitForForegroundChild } from '../lib/process-lifecycle.mjs'

const harness = fileURLToPath(new URL('fixtures/process-lifecycle-harness.mjs', import.meta.url))
const startupHarness = fileURLToPath(new URL('fixtures/process-lifecycle-startup-harness.mjs', import.meta.url))

function processExists(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') return false
    throw error
  }
}

function portAcceptsConnections(port) {
  return new Promise(resolve => {
    const socket = connect({ host: '127.0.0.1', port })
    socket.setTimeout(250)
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('timeout', () => { socket.destroy(); resolve(false) })
    socket.once('error', () => resolve(false))
  })
}

test('foreground wait preserves an exit observed before ownership attaches', async () => {
  const child = spawn(process.execPath, ['-e', 'process.exit(7)'])
  await once(child, 'exit')
  const result = await waitForForegroundChild(child)
  assert.equal(result.status, 7)
  assert.equal(result.exitCode, 7)
  assert.equal(result.interrupted, false)
})

test('foreground lifecycle forwards termination and kills an unresponsive child within the bound', async t => {
  const parent = spawn(process.execPath, [harness], { stdio: ['ignore', 'pipe', 'pipe'] })
  t.after(() => {
    if (parent.exitCode == null) parent.kill('SIGKILL')
  })
  parent.stdout.setEncoding('utf8')
  const childPid = await new Promise((resolve, reject) => {
    let output = ''
    const timeout = setTimeout(() => reject(new Error('child PID was not reported')), 3000)
    parent.stdout.on('data', chunk => {
      output += chunk
      const line = output.split(/\r?\n/)[0]
      if (!/^\d+$/.test(line)) return
      clearTimeout(timeout)
      resolve(Number(line))
    })
  })
  assert.equal(processExists(childPid), true)
  parent.kill('SIGTERM')
  const [status, signal] = await once(parent, 'exit')
  assert.equal(signal, null)
  assert.equal(status, 143)
  assert.equal(processExists(childPid), false)
})

for (const [stage, childCount, signal, expectedStatus] of [
  ['copilot-backend-readiness', 1, 'SIGTERM', 143],
  ['copilot-attestation-readiness', 2, 'SIGINT', 130],
  ['azure-attestation-readiness', 1, 'SIGTERM', 143],
  ['gateway-catalog-readiness', 3, 'SIGINT', 130],
  ['active-claude', 4, 'SIGTERM', 143],
  ['active-proof', 4, 'SIGINT', 130],
]) {
  test(`production provider controller owns ${stage} before interruption`, async t => {
    const parent = spawn(process.execPath, [startupHarness, stage], { stdio: ['ignore', 'pipe', 'pipe'] })
    t.after(() => {
      if (parent.exitCode == null) parent.kill('SIGKILL')
    })
    parent.stdout.setEncoding('utf8')
    const reports = []
    const children = await new Promise((resolve, reject) => {
      let output = ''
      const timeout = setTimeout(() => reject(new Error(`${stage} children were not reported`)), 3000)
      parent.stdout.on('data', chunk => {
        output += chunk
        const lines = output.split(/\r?\n/)
        output = lines.pop()
        for (const line of lines) {
          if (!line) continue
          try { reports.push(JSON.parse(line)) } catch { continue }
        }
        if (reports.length !== childCount) return
        clearTimeout(timeout)
        resolve(reports.sort((left, right) => left.ordinal - right.ordinal))
      })
    })
    assert.equal(children.length, childCount)
    for (const [ordinal, child] of children.entries()) {
      assert.equal(child.stage, stage)
      assert.equal(child.ordinal, ordinal)
      assert.equal(processExists(child.pid), true)
      assert.equal(await portAcceptsConnections(child.port), true)
    }
    parent.kill(signal)
    const [status, exitSignal] = await once(parent, 'exit')
    assert.equal(exitSignal, null)
    assert.equal(status, expectedStatus)
    assert.equal(reports.length, childCount, 'the interrupted controller must not spawn another boundary')
    for (const child of children) {
      assert.equal(processExists(child.pid), false)
      assert.equal(await portAcceptsConnections(child.port), false)
    }
  })
}
