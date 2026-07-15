import { spawn } from 'node:child_process'
import { once } from 'node:events'

const SIGNAL_EXIT_CODES = Object.freeze({ SIGINT: 130, SIGTERM: 143 })

export function signalExitCode(signal) {
  return SIGNAL_EXIT_CODES[signal] || 1
}

export function createProcessLifecycleOwner({ terminationGraceMs = 3000 } = {}) {
  const children = new Set()
  const foregroundChildren = new Set()
  const stopping = new Map()
  let receivedSignal

  const stopChild = (child, signal = 'SIGTERM') => {
    if (!child || child.exitCode != null || child.signalCode != null || child.pid == null) {
      children.delete(child)
      foregroundChildren.delete(child)
      return Promise.resolve()
    }
    if (stopping.has(child)) return stopping.get(child)
    const stopped = new Promise(resolve => {
      let escalation
      const finish = () => {
        clearTimeout(escalation)
        child.off('exit', finish)
        child.off('error', finish)
        children.delete(child)
        foregroundChildren.delete(child)
        stopping.delete(child)
        resolve()
      }
      child.once('exit', finish)
      child.once('error', finish)
      child.kill(signal)
      escalation = setTimeout(() => {
        if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL')
      }, terminationGraceMs)
      escalation.unref()
    })
    stopping.set(child, stopped)
    return stopped
  }

  const stopAll = async (signal = 'SIGTERM', { interrupted = false } = {}) => {
    await Promise.all([...children].map(child => stopChild(
      child,
      interrupted && foregroundChildren.has(child) ? signal : 'SIGTERM',
    )))
  }

  const handlers = Object.fromEntries(['SIGINT', 'SIGTERM'].map(signal => [signal, () => {
    if (!receivedSignal) receivedSignal = signal
    process.exitCode = signalExitCode(receivedSignal)
    void stopAll(signal, { interrupted: true })
  }]))
  for (const [signal, handler] of Object.entries(handlers)) process.on(signal, handler)

  return {
    get receivedSignal() { return receivedSignal },
    register(child, { foreground = false } = {}) {
      if (!child) return child
      children.add(child)
      if (foreground) foregroundChildren.add(child)
      const release = () => {
        children.delete(child)
        foregroundChildren.delete(child)
      }
      child.once('exit', release)
      child.once('error', release)
      if (receivedSignal) void stopChild(child, foreground ? receivedSignal : 'SIGTERM')
      return child
    },
    stopChild,
    stopAll,
    throwIfInterrupted() {
      if (!receivedSignal) return
      const error = new Error(`process interrupted by ${receivedSignal}`)
      error.exitCode = signalExitCode(receivedSignal)
      throw error
    },
    async close() {
      await stopAll()
      for (const [signal, handler] of Object.entries(handlers)) process.off(signal, handler)
    },
  }
}

export function spawnOwned(lifecycle, command, args, options = {}) {
  const { foreground = false, ...spawnOptions } = options
  lifecycle?.throwIfInterrupted()
  const child = spawn(command, args, spawnOptions)
  return lifecycle?.register(child, { foreground }) || child
}

export async function waitForForegroundChild(child, {
  capture = false,
  maxBuffer = 16 * 1024 * 1024,
  timeoutMs,
  terminationGraceMs = 3000,
  lifecycle,
} = {}) {
  lifecycle?.register(child, { foreground: true })
  if (child.exitCode != null || child.signalCode != null) {
    const receivedSignal = lifecycle?.receivedSignal
    return {
      status: child.exitCode,
      signal: child.signalCode,
      stdout: '',
      stderr: '',
      interrupted: Boolean(receivedSignal),
      exitCode: receivedSignal ? signalExitCode(receivedSignal) : child.exitCode ?? signalExitCode(child.signalCode),
    }
  }
  let stdout = ''
  let stderr = ''
  let receivedSignal
  let timedOut = false
  let bufferExceeded = false
  let escalation

  const terminate = signal => {
    if (child.exitCode != null || child.signalCode != null) return
    if (lifecycle) {
      void lifecycle.stopChild(child, signal)
      return
    }
    child.kill(signal)
    clearTimeout(escalation)
    escalation = setTimeout(() => {
      if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL')
    }, terminationGraceMs)
    escalation.unref()
  }

  const handlers = lifecycle ? {} : Object.fromEntries(['SIGINT', 'SIGTERM'].map(signal => [signal, () => {
    if (!receivedSignal) receivedSignal = signal
    terminate(signal)
  }]))
  for (const [signal, handler] of Object.entries(handlers)) process.on(signal, handler)

  const append = (target, chunk) => {
    if (bufferExceeded) return target
    const next = target + chunk
    if (Buffer.byteLength(next) > maxBuffer) {
      bufferExceeded = true
      terminate('SIGTERM')
      return target
    }
    return next
  }
  if (capture) {
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', chunk => { stdout = append(stdout, chunk) })
    child.stderr?.on('data', chunk => { stderr = append(stderr, chunk) })
  }

  const timeout = timeoutMs == null ? undefined : setTimeout(() => {
    timedOut = true
    terminate('SIGTERM')
  }, timeoutMs)
  timeout?.unref()

  let status
  let signal
  try {
    ;[status, signal] = await once(child, 'exit')
  } finally {
    clearTimeout(timeout)
    clearTimeout(escalation)
    for (const [name, handler] of Object.entries(handlers)) process.off(name, handler)
  }

  if (timedOut) throw new Error(`child process timed out after ${timeoutMs} ms`)
  if (bufferExceeded) throw new Error(`child process output exceeded ${maxBuffer} bytes`)
  receivedSignal ||= lifecycle?.receivedSignal
  return {
    status,
    signal,
    stdout,
    stderr,
    interrupted: Boolean(receivedSignal),
    exitCode: receivedSignal ? signalExitCode(receivedSignal) : status ?? signalExitCode(signal),
  }
}

export async function runForeground(command, args, options = {}) {
  const capture = options.capture === true
  const child = spawnOwned(options.lifecycle, command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : options.stdio || 'inherit',
    foreground: true,
  })
  return waitForForegroundChild(child, options)
}
