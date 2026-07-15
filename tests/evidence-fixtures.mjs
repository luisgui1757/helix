import { constants, generateKeyPairSync, sign } from 'node:crypto'

const stable = value => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
}

export function createReceiptSigner() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 0x10001 })
  const jwk = publicKey.export({ format: 'jwk' })
  const session = { id: `hxe_${'1'.repeat(48)}`, publicKey: { kty: 'RSA', n: jwk.n, e: jwk.e } }
  let sequence = 0
  const receipt = (operation, request, result) => {
    const body = { version: 2, sessionId: session.id, sequence: ++sequence, operation, request, result }
    const signature = sign('sha256', Buffer.from(stable(body)), { key: privateKey, padding: constants.RSA_PKCS1_PADDING })
      .toString('base64url').match(/.{1,64}/g)
    return { ...body, signature }
  }
  const command = ({ argv, purpose = 'verification', exitCode = 0, changedPaths = [], checkoutChangedPaths = [], baselineSequence = null, testPaths = null, metric = null }) => receipt('command', {
    argv, purpose, baselineSequence, testPaths, metric: metric ? { metric: metric.metric, unit: metric.unit } : null,
  }, {
    command: { exitCode, signal: null, executionErrorCode: null, stdoutSha256: 'a'.repeat(64), stderrSha256: 'b'.repeat(64) },
    repositoryBefore: 'c'.repeat(64), repositoryAfter: 'c'.repeat(64), changedPaths,
    checkout: { head: 'd'.repeat(40), branch: 'feature/evidence', changedPaths: checkoutChangedPaths },
    ...(metric ? { metric: { metric: metric.metric, unit: metric.unit, value: metric.value } } : {}),
  })
  return { session, receipt, command }
}
