import { createProcessLifecycleOwner, runForeground } from '../../lib/process-lifecycle.mjs'

const childScript = `
process.stdout.write(String(process.pid) + '\\n')
process.on('SIGTERM', () => {})
setInterval(() => {}, 1000)
`

const lifecycle = createProcessLifecycleOwner({ terminationGraceMs: 100 })
try {
  const result = await runForeground(process.execPath, ['-e', childScript], {
    stdio: 'inherit',
    lifecycle,
  })
  process.exitCode = result.exitCode
} finally {
  await lifecycle.close()
}
