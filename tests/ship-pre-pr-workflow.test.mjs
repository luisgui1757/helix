import assert from 'node:assert/strict'
import test from 'node:test'
import { createReceiptSigner } from './evidence-fixtures.mjs'
import { runWorkflow, workflowFileForMode } from './workflow-harness.mjs'

const file = workflowFileForMode('helix-ship-pre-pr.js')
const verificationArgv = ['npm', 'run', 'verify']
const releaseCheckArgv = ['npm', 'run', 'release-check']
const taskPaths = ['lib/a.mjs']

function setup() {
  const signer = createReceiptSigner()
  const input = {
    task: 'Ship the completed feature', repository: 'acme/repo', headBranch: 'feat/change', baseBranch: 'main', taskPaths, verificationArgv, releaseCheckArgv, evidenceSession: signer.session,
    commitMessage: 'feat: add feature', pullRequestTitle: 'Add feature', pullRequestBody: 'Verified change.',
    confirmOpenPullRequest: true,
  }
  let preflightSequence
  const preflight = ({ verificationExit = 0, releaseExit = 0 } = {}) => {
    const receipt = signer.receipt('pre-pr', { repository: input.repository, headBranch: input.headBranch, baseBranch: 'main', taskPaths, verificationArgv, releaseCheckArgv }, {
      repository: {
        owner: 'acme', repo: 'repo', slug: 'acme/repo', origin: 'https://github.com/acme/repo.git',
        branch: 'feat/change', head: 'b'.repeat(40), baseSha: 'c'.repeat(40), fingerprint: 'd'.repeat(64),
      },
      verification: { exitCode: verificationExit, signal: null, executionErrorCode: null, stdoutSha256: 'e'.repeat(64), stderrSha256: 'f'.repeat(64) },
      releaseCheck: { exitCode: releaseExit, signal: null, executionErrorCode: null, stdoutSha256: 'e'.repeat(64), stderrSha256: 'f'.repeat(64) },
      diffCheck: { exitCode: 0, signal: null, executionErrorCode: null, stdoutSha256: 'e'.repeat(64), stderrSha256: 'f'.repeat(64) },
    })
    preflightSequence = receipt.sequence
    return receipt
  }
  const shipment = (overrides = {}) => {
    const headSha = overrides.headSha || 'a'.repeat(40)
    const repository = overrides.repository || 'acme/repo'
    return signer.receipt('ship', {
      preflightSequence,
      commitMessage: input.commitMessage,
      pullRequestTitle: input.pullRequestTitle,
      pullRequestBody: input.pullRequestBody,
    }, {
      repository, origin: overrides.origin || 'https://github.com/acme/repo.git', headBranch: 'feat/change', headSha,
      baseBranch: 'main', remoteBranchVerified: true,
      pullRequest: {
        number: 7, url: `https://github.com/${repository}/pull/7`, state: 'OPEN', isDraft: false,
        headRefName: 'feat/change', headRefOid: overrides.prHeadSha || headSha, baseRefName: 'main',
        headRepository: { nameWithOwner: overrides.prRepository || repository },
        headRepositoryOwner: { login: overrides.prOwner || repository.split('/')[0] },
        title: input.pullRequestTitle, body: input.pullRequestBody, mergedAt: null,
      },
    })
  }
  const defaults = ({ label }) => {
    if (label === 'ship:intent') return { headBranch: 'feat/change', baseBranch: 'main', taskChanges: taskPaths, excludedChanges: [], handoff: 'one PR' }
    if (label === 'ship:document') return { filesChanged: ['README.md'], truthChecks: ['docs match'], openDrift: [] }
    if (label === 'ship:evidence') return { receipt: preflight() }
    if (label === 'ship:review' || label === 'ship:redteam') return { verdict: 'pass', findings: [], checks: ['diff inspected'] }
    if (label === 'ship:verify') return { approved: true, reason: 'ready for PR', requiredFixes: [] }
    if (label === 'ship:commit-push-pr') return { receipt: shipment() }
    throw new Error(`unhandled ${label}`)
  }
  return { signer, input, defaults, preflight, shipment }
}

test('ship-pre-pr requires explicit PR confirmation before invoking any agent', async () => {
  const { input, defaults } = setup()
  const calls = []
  await assert.rejects(runWorkflow(file, { ...input, confirmOpenPullRequest: false }, options => { calls.push(options.label); return defaults(options) }), /must be exactly true/)
  assert.deepEqual(calls, [])
})

test('ship-pre-pr verifies signed preflight before its capability-limited shipping operation', async () => {
  const { input, defaults } = setup()
  const { result, calls } = await runWorkflow(file, input, defaults)
  assert.equal(result.approved, true)
  assert.equal(result.shipment.verified, true)
  assert.deepEqual(calls.map(call => call.options.label), [
    'ship:intent', 'ship:document', 'ship:evidence', 'ship:review', 'ship:redteam', 'ship:verify', 'ship:commit-push-pr',
  ])
})

test('ship-pre-pr never invokes the shipper after failed signed evidence or review', async () => {
  const { input, defaults, preflight } = setup()
  const calls = []
  await assert.rejects(
    runWorkflow(file, input, options => {
      calls.push(options.label)
      if (options.label === 'ship:evidence') return { receipt: preflight({ verificationExit: 1 }) }
      return defaults(options)
    }),
    /pre-PR receipt does not prove/,
  )
  assert.equal(calls.includes('ship:commit-push-pr'), false)

  const release = setup()
  await assert.rejects(
    runWorkflow(file, release.input, options => options.label === 'ship:evidence'
      ? { receipt: release.preflight({ releaseExit: 1 }) }
      : release.defaults(options)),
    /pre-PR receipt does not prove/,
  )
})

test('ship-pre-pr rejects unsafe branches and foreign or stale signed PR receipts', async () => {
  const first = setup()
  await assert.rejects(runWorkflow(file, { ...first.input, baseBranch: '../main' }, first.defaults), /not a safe branch name/)
  await assert.rejects(runWorkflow(file, { ...first.input, headBranch: 'main' }, first.defaults), /safe non-default branch name/)
  await assert.rejects(runWorkflow(file, { ...first.input, repository: 'other/repo' }, first.defaults), /pre-PR receipt does not prove|repository identity is invalid/)
  const foreign = setup()
  await assert.rejects(
    runWorkflow(file, foreign.input, options => options.label === 'ship:commit-push-pr'
      ? { receipt: foreign.shipment({ repository: 'unrelated/other-repo', origin: 'https://github.com/unrelated/other-repo.git' }) }
      : foreign.defaults(options)),
    /shipment receipt does not match/,
  )
  const stale = setup()
  await assert.rejects(
    runWorkflow(file, stale.input, options => options.label === 'ship:commit-push-pr'
      ? { receipt: stale.shipment({ prHeadSha: '9'.repeat(40) }) }
      : stale.defaults(options)),
    /live pull-request state is not the exact/,
  )
  const wrongOwner = setup()
  await assert.rejects(
    runWorkflow(file, wrongOwner.input, options => options.label === 'ship:commit-push-pr'
      ? { receipt: wrongOwner.shipment({ prOwner: 'fork-owner', prRepository: 'fork-owner/repo' }) }
      : wrongOwner.defaults(options)),
    /live pull-request state is not the exact/,
  )
})

test('ship-pre-pr validates and canonicalizes trusted command and task-path inputs before agents', async () => {
  const { input, defaults } = setup()
  for (const override of [
    { verificationArgv: ['./verify.sh'] },
    { taskPaths: ['.git/config'] },
    { taskPaths: ['./.git/config'] },
    { taskPaths: ['.//tmp/x'] },
    { taskPaths: ['.//.git/config'] },
    { taskPaths: ['lib/a.mjs', './lib/a.mjs'] },
    { commitMessage: 'ship\nnow' },
    { commitMessage: 'ship\rnow' },
    { pullRequestTitle: 'ship\nnow' },
    { pullRequestTitle: 'ship\rnow' },
  ]) {
    const calls = []
    await assert.rejects(
      runWorkflow(file, { ...input, ...override }, options => { calls.push(options.label) }),
      /PATH-resolved executable|bounded repository-relative paths|outside \.git|must not contain duplicates|single-line/,
    )
    assert.deepEqual(calls, [])
  }
  const normalized = await runWorkflow(file, { ...input, taskPaths: ['./lib/a.mjs'] }, defaults)
  assert.deepEqual(normalized.result.intent.taskChanges, ['lib/a.mjs'])
  assert.equal(normalized.result.shipment.verified, true)
})

test('ship-pre-pr accepts an exact existing open PR terminal receipt', async () => {
  const { input, defaults } = setup()
  const { result } = await runWorkflow(file, input, defaults)
  assert.equal(result.shipment.result.remoteBranchVerified, true)
  assert.equal(result.shipment.result.pullRequest.state, 'OPEN')
  assert.equal(result.shipment.result.pullRequest.mergedAt, null)
})

test('ship-pre-pr binds the model intent to explicit task paths before effects', async () => {
  const { input, defaults } = setup()
  await assert.rejects(
    runWorkflow(file, input, options => options.label === 'ship:intent'
      ? { ...defaults(options), taskChanges: ['lib/other.mjs'] }
      : defaults(options)),
    /intent did not match the explicit safe branch and task paths/,
  )
})
