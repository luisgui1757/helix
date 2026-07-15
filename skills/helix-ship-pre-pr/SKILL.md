---
name: helix-ship-pre-pr
description: Verify a completed change, then commit, non-force push, and open or reuse one pull request without merging.
argument-hint: <completed task to ship>
disable-model-invocation: true
---

# Helix ship-pre-PR loop

This loop performs an external repository handoff. It never merges, closes, approves, retargets, enables auto-merge, tags, or releases.

## Required launch protocol

1. Treat `$ARGUMENTS` as the exact completed task. If empty, ask and stop.
2. Read repository rules. Inspect repository identity, current non-default branch, status, intended base, task diff, unrelated changes, and existing pull requests. Stop for detached/default branch, conflicts, unrelated changes that cannot be excluded, or a mismatched remote.
3. Identify the exact GitHub `owner/repository`, non-default head branch, base branch, task-relative paths, general verification argv, separate repository-specific release-boundary check argv, single-line commit message, single-line pull-request title, and pull-request body. Accept at most one leading `./` on task paths; after removing it, reject absolute, empty-segment, dot-segment, backslash, and `.git` paths. Each argv must begin with a PATH-resolved executable name without `/`, `\\`, or a leading dash; pass repository scripts to an interpreter. The preflight also requires a freshly fetched base, task-only working tree, and `git diff --check`. It reports stale state and never rebases or merges automatically.
4. Configure optional models for `planner`, `documenter`, `tester`, `reviewer`, `redteam`, `verifier`, and `shipper`.
5. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/helix-cc-doctor" --json`. Require a locally ready workflow path. For CLIProxyAPI, require exact catalog membership and proof for every explicit model. Stop for a global subagent-model override when role models were requested.
6. Show the exact identity, branch/base, task files, excluded files, verification argv, separate release-boundary check argv, commit message, pull-request title/body, models, and the complete external-action boundary. Ask: “Open or reuse exactly one pull request after all gates pass?” Continue only on explicit confirmation.
7. Call `mcp__plugin_helix-cc_helix-cc-evidence__start_session` exactly once. Stop if it fails, and pass its exact `{id, publicKey}` result without reconstruction.
8. Invoke with `confirmOpenPullRequest: true` only after that confirmation:

```text
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/helix-ship-pre-pr.js",
  args: {
    task: "<exact confirmed completed task>",
    repository: "owner/repository",
    headBranch: "feature/exact-branch",
    baseBranch: "main",
    taskPaths: ["<exact/task/file>"],
    verificationArgv: ["npm", "run", "verify"],
    releaseCheckArgv: ["npm", "run", "release-check"],
    evidenceSession: <exact start_session result>,
    commitMessage: "<exact commit message>",
    pullRequestTitle: "<exact title>",
    pullRequestBody: "<exact body>",
    confirmOpenPullRequest: true,
    models: {
      planner: "",
      documenter: "",
      tester: "",
      reviewer: "",
      redteam: "",
      verifier: "",
      shipper: ""
    }
  }
})
```

Omit empty model fields. Never infer confirmation from a prior request to implement, commit, or push; opening a pull request must be explicitly included.

## Handoff

Verify the remote branch SHA and pull-request URL independently. Report the branch, full SHA, base, checks, URL, and any residual risk. State explicitly that the pull request remains unmerged.
