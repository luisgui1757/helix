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
4. Select `mode`: `original` by default, or explicit `graph`. Original uses
   `${CLAUDE_PLUGIN_ROOT}/workflows/helix-ship-pre-pr.js`; graph uses
   `${CLAUDE_PLUGIN_ROOT}/workflows/graph/helix-ship-pre-pr.js`. If a supplied
   mode is neither exact `original` nor exact `graph`, stop before doctor,
   evidence-session, or Workflow invocation. Configure
   optional models for `planner`, `documenter`, `tester`, `reviewer`, `redteam`,
   `verifier`, and `shipper`.
5. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/helix-cc-doctor" --json`. Require a locally ready workflow path. For CLIProxyAPI, require exact catalog membership and proof for every explicit model. Stop for a global subagent-model override when role models were requested.
6. Show the exact identity, selected mode and exact script path, branch/base,
   task files, excluded files, verification argv, separate release-boundary
   check argv, commit message, pull-request title/body, models, and the complete
   external-action boundary. Ask: “Open or reuse exactly one pull request after
   all gates pass?” Continue only on explicit confirmation.
7. Call `mcp__plugin_helix-cc_helix-cc-evidence__start_session` exactly once with `{ "authorization": { "commands": [], "tdd": null, "prePr": { "repository": <exact owner/repository>, "headBranch": <exact head>, "baseBranch": <exact base>, "taskPaths": <exact task paths>, "verificationArgv": <exact verification argv>, "releaseCheckArgv": <exact release-check argv>, "commitMessage": <exact commit message>, "pullRequestTitle": <exact title>, "pullRequestBody": <exact body> } } }`. This binds the trusted service before any effect can run, including preflight, Git, push, and PR effects. Stop if it fails, and pass its exact `{id, publicKey}` result without reconstruction.
8. Invoke with `confirmOpenPullRequest: true` only after that confirmation:

```text
Workflow({
  scriptPath: "<exact selected original or graph script path>",
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

Never execute both shipping modes for comparison. Compare shipping through
deterministic fixtures only; two live runs would create duplicate external
effects.

If shipment fails after the commit is created, the local commit remains for
operator inspection and is not rolled back. This is deliberate because the
push may already have taken effect; pre-commit refusals still restore the exact
prior index tree.

## Handoff

Verify the remote branch SHA and pull-request URL independently. Report the branch, full SHA, base, checks, URL, and any residual risk. State explicitly that the pull request remains unmerged.
