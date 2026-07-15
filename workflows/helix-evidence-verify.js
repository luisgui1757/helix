export const meta = {
  name: 'helix-evidence-verify',
  description: 'Deterministically verifies one signed Helix CC trusted-evidence receipt',
  whenToUse: 'Internal child workflow used by Helix CC writer loops; do not invoke directly.',
  phases: [],
}

const fail = message => { throw new Error(`trusted evidence rejected: ${message}`) }
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
const exactKeys = (value, keys) => plain(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const stable = value => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
}
const base64url = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) fail('signature or public key is not base64url')
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  let bits = 0
  let count = 0
  const output = []
  for (const character of value) {
    const index = alphabet.indexOf(character)
    if (index < 0) fail('signature or public key is not base64url')
    bits = bits * 64 + index
    count += 6
    if (count >= 8) {
      count -= 8
      output.push((bits >> count) & 255)
      bits &= (1 << count) - 1
    }
  }
  if (count && bits !== 0) fail('base64url has non-zero trailing bits')
  return output
}
const bytesToBigInt = bytes => {
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  return value
}
const modPow = (base, exponent, modulus) => {
  if (modulus <= 0n) fail('RSA modulus is invalid')
  let result = 1n
  let factor = base % modulus
  let power = exponent
  while (power > 0n) {
    if (power & 1n) result = (result * factor) % modulus
    factor = (factor * factor) % modulus
    power >>= 1n
  }
  return result
}
const utf8 = value => {
  const output = []
  for (let index = 0; index < value.length; index += 1) {
    let point = value.charCodeAt(index)
    if (point >= 0xd800 && point <= 0xdbff) {
      const low = value.charCodeAt(index + 1)
      if (low < 0xdc00 || low > 0xdfff) fail('receipt contains invalid UTF-16')
      point = 0x10000 + ((point - 0xd800) << 10) + (low - 0xdc00)
      index += 1
    } else if (point >= 0xdc00 && point <= 0xdfff) fail('receipt contains invalid UTF-16')
    if (point < 0x80) output.push(point)
    else if (point < 0x800) output.push(0xc0 | (point >> 6), 0x80 | (point & 63))
    else if (point < 0x10000) output.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 63), 0x80 | (point & 63))
    else output.push(0xf0 | (point >> 18), 0x80 | ((point >> 12) & 63), 0x80 | ((point >> 6) & 63), 0x80 | (point & 63))
  }
  return output
}
const SHA256_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]
const rotate = (value, count) => (value >>> count) | (value << (32 - count))
const sha256 = bytes => {
  const message = [...bytes, 0x80]
  while (message.length % 64 !== 56) message.push(0)
  const bitLength = BigInt(bytes.length) * 8n
  for (let shift = 56n; shift >= 0n; shift -= 8n) message.push(Number((bitLength >> shift) & 255n))
  let state = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
  for (let offset = 0; offset < message.length; offset += 64) {
    const words = new Array(64)
    for (let index = 0; index < 16; index += 1) {
      const start = offset + index * 4
      words[index] = ((message[start] << 24) | (message[start + 1] << 16) | (message[start + 2] << 8) | message[start + 3]) >>> 0
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = (rotate(words[index - 15], 7) ^ rotate(words[index - 15], 18) ^ (words[index - 15] >>> 3)) >>> 0
      const s1 = (rotate(words[index - 2], 17) ^ rotate(words[index - 2], 19) ^ (words[index - 2] >>> 10)) >>> 0
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = state
    for (let index = 0; index < 64; index += 1) {
      const s1 = (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) >>> 0
      const choice = ((e & f) ^ (~e & g)) >>> 0
      const temporary1 = (h + s1 + choice + SHA256_CONSTANTS[index] + words[index]) >>> 0
      const s0 = (rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) >>> 0
      const majority = ((a & b) ^ (a & c) ^ (b & c)) >>> 0
      const temporary2 = (s0 + majority) >>> 0
      h = g; g = f; f = e; e = (d + temporary1) >>> 0; d = c; c = b; b = a; a = (temporary1 + temporary2) >>> 0
    }
    state = state.map((value, index) => (value + [a, b, c, d, e, f, g, h][index]) >>> 0)
  }
  return state.flatMap(value => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255])
}
const verifySignature = (body, signature, publicKey) => {
  if (!exactKeys(publicKey, ['kty', 'n', 'e']) || publicKey.kty !== 'RSA') fail('public key is invalid')
  if (!Array.isArray(signature) || signature.length !== 6
    || signature.some((chunk, index) => typeof chunk !== 'string' || chunk.length !== (index < 5 ? 64 : 22))) {
    fail('receipt signature chunks are invalid')
  }
  const modulusBytes = base64url(publicKey.n)
  const exponentBytes = base64url(publicKey.e)
  const signatureBytes = base64url(signature.join(''))
  if (modulusBytes.length !== 256 || signatureBytes.length !== modulusBytes.length
    || !same(exponentBytes, [1, 0, 1])) fail('RSA key or signature length is invalid')
  const modulus = bytesToBigInt(modulusBytes)
  const exponent = bytesToBigInt(exponentBytes)
  const encodedValue = modPow(bytesToBigInt(signatureBytes), exponent, modulus)
  const encoded = new Array(modulusBytes.length).fill(0)
  let remainder = encodedValue
  for (let index = encoded.length - 1; index >= 0; index -= 1) { encoded[index] = Number(remainder & 255n); remainder >>= 8n }
  const digestPrefix = [0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20]
  const expectedTail = [...digestPrefix, ...sha256(utf8(stable(body)))]
  const separator = encoded.length - expectedTail.length - 1
  if (encoded[0] !== 0 || encoded[1] !== 1 || separator < 10 || encoded[separator] !== 0) fail('receipt signature is invalid')
  for (let index = 2; index < separator; index += 1) if (encoded[index] !== 255) fail('receipt signature is invalid')
  if (!same(encoded.slice(separator + 1), expectedTail)) fail('receipt signature is invalid')
}
const goodCommand = value => plain(value) && value.exitCode === 0 && value.signal === null && value.executionErrorCode === null
const compare = (value, comparator, target) => comparator === 'lte' ? value <= target
  : comparator === 'lt' ? value < target
    : comparator === 'gte' ? value >= target
      : comparator === 'gt' ? value > target
        : comparator === 'eq' ? value === target : false

const input = args
if (!exactKeys(input, ['session', 'receipt', 'expectation'])) fail('args must contain exactly session, receipt, and expectation')
if (!exactKeys(input.session, ['id', 'publicKey']) || typeof input.session.id !== 'string') fail('evidence session is invalid')
const receipt = input.receipt
if (!exactKeys(receipt, ['version', 'sessionId', 'sequence', 'operation', 'request', 'result', 'signature'])
  || receipt.version !== 2 || receipt.sessionId !== input.session.id || !Number.isInteger(receipt.sequence) || receipt.sequence < 1) fail('receipt envelope is invalid')
const body = { version: receipt.version, sessionId: receipt.sessionId, sequence: receipt.sequence, operation: receipt.operation, request: receipt.request, result: receipt.result }
verifySignature(body, receipt.signature, input.session.publicKey)

const expected = input.expectation
let derived = {}
if (!plain(expected) || typeof expected.kind !== 'string') fail('receipt expectation is invalid')
if (expected.kind === 'baseline') {
  if (receipt.operation !== 'baseline' || !Array.isArray(expected.testPaths) || expected.testPaths.length < 1
    || !same(receipt.request?.testPaths, expected.testPaths) || !plain(receipt.result?.repository)
    || receipt.result.repository.fingerprint?.length !== 64) fail('baseline receipt is invalid')
} else if (expected.kind === 'command') {
  if (receipt.operation !== 'command' || !same(receipt.request?.argv, expected.argv) || receipt.request?.purpose !== expected.purpose) fail('command receipt does not match the requested operation')
  const command = receipt.result?.command
  const checkout = receipt.result?.checkout
  if (!plain(command) || command.signal !== null || command.executionErrorCode !== null) fail('command did not execute normally')
  if (!exactKeys(checkout, ['head', 'branch', 'changedPaths']) || !/^[0-9a-f]{40}$/.test(checkout.head || '')
    || typeof checkout.branch !== 'string' || !checkout.branch || !Array.isArray(checkout.changedPaths)
    || checkout.changedPaths.length > 2048 || checkout.changedPaths.some(path => typeof path !== 'string' || !path)) {
    fail('command receipt final checkout evidence is invalid')
  }
  if (expected.exit === 'zero' && command.exitCode !== 0) fail('command did not exit zero')
  if (expected.exit === 'red' && (!Number.isInteger(command.exitCode) || command.exitCode < 1 || command.exitCode > 125)) fail('red command was not a real non-infrastructure failure')
  if (expected.repository === 'unchanged' && (receipt.result.repositoryBefore !== receipt.result.repositoryAfter || receipt.result.changedPaths?.length !== 0)) fail('verification command changed the repository')
  if (expected.repository === 'tests-only' && (!Array.isArray(expected.testPaths) || expected.testPaths.length < 1
    || !same(receipt.request?.testPaths, expected.testPaths) || !Array.isArray(receipt.result.changedPaths)
    || receipt.result.changedPaths.length < 1 || receipt.result.changedPaths.some(path => !expected.testPaths.includes(path)))) {
    fail('TDD red was not bound exclusively to the signed testPaths scope')
  }
  if (expected.baselineSequence != null && receipt.request.baselineSequence !== expected.baselineSequence) fail('command receipt is not bound to the expected baseline')
  if (expected.metric != null) {
    const metric = receipt.result.metric
    const target = expected.metric
    if (!plain(metric) || metric.metric !== target.metric || metric.unit !== target.unit || typeof metric.value !== 'number' || !Number.isFinite(metric.value)) fail('measured metric did not match the typed target')
    derived = { targetMet: compare(metric.value, target.comparator, target.value) }
  }
} else if (expected.kind === 'pre-pr') {
  if (receipt.operation !== 'pre-pr' || receipt.request?.repository !== expected.repository
    || receipt.request?.headBranch !== expected.headBranch || receipt.request?.baseBranch !== expected.baseBranch
    || !same(receipt.request?.taskPaths, expected.taskPaths) || !same(receipt.request?.verificationArgv, expected.verificationArgv)
    || !same(receipt.request?.releaseCheckArgv, expected.releaseCheckArgv)
    || !goodCommand(receipt.result?.verification) || !goodCommand(receipt.result?.releaseCheck)
    || !goodCommand(receipt.result?.diffCheck)) fail('pre-PR receipt does not prove the exact requested gates')
  if (!plain(receipt.result?.repository) || receipt.result.repository.slug !== expected.repository
    || receipt.result.repository.branch !== expected.headBranch || receipt.result.repository.branch === expected.baseBranch
    || typeof receipt.result.repository.head !== 'string') fail('pre-PR repository identity is invalid')
} else if (expected.kind === 'ship') {
  const result = receipt.result
  const request = receipt.request
  if (receipt.operation !== 'ship' || request?.preflightSequence !== expected.preflightSequence
    || request?.commitMessage !== expected.commitMessage || request?.pullRequestTitle !== expected.pullRequestTitle
    || request?.pullRequestBody !== expected.pullRequestBody || result?.remoteBranchVerified !== true
    || result?.repository !== expected.repository || result?.origin !== expected.origin
    || result?.headBranch !== expected.headBranch || result?.baseBranch !== expected.baseBranch
    || !/^[0-9a-f]{40}$/.test(result?.headSha || '')) fail('shipment receipt does not match the verified request')
  const pr = result.pullRequest
  const expectedUrl = `https://github.com/${expected.repository}/pull/${pr?.number}`
  if (!plain(pr) || !Number.isInteger(pr.number) || pr.number < 1 || pr.url !== expectedUrl || pr.state !== 'OPEN'
    || pr.isDraft !== false || pr.headRefName !== expected.headBranch || pr.headRefOid !== result.headSha
    || pr.baseRefName !== expected.baseBranch || pr.headRepositoryOwner?.login !== expected.repository.split('/')[0]
    || pr.headRepository?.nameWithOwner !== expected.repository || pr.title !== expected.pullRequestTitle
    || pr.body !== expected.pullRequestBody || pr.mergedAt !== null) fail('live pull-request state is not the exact open unmerged target')
} else fail('receipt expectation kind is unknown')

return { verified: true, operation: receipt.operation, sequence: receipt.sequence, result: receipt.result, ...derived }
