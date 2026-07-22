#!/usr/bin/env node
import { checkGraphArtifacts, writeGraphArtifacts } from '../graph/artifacts.mjs'

const command = process.argv[2] || 'check'
if (command === 'generate') {
  const artifacts = await writeGraphArtifacts()
  process.stdout.write(`generated ${artifacts.length - 1} graph workflows and one graph document\n`)
} else if (command === 'check') {
  const result = await checkGraphArtifacts()
  if (!result.ok) {
    process.stderr.write(`graph artifacts are stale or missing:\n${result.drift.map(path => `- ${path}`).join('\n')}\n`)
    process.exitCode = 1
  } else process.stdout.write(`verified ${result.artifacts.length - 1} graph workflows and one graph document\n`)
} else {
  process.stderr.write(`unknown graph-workflows command: ${command}\n`)
  process.exitCode = 1
}
