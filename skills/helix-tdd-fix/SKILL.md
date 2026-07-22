---
name: helix-tdd-fix
description: Prove a defect with a failing regression test before running a bounded fix, documentation, review, and verification loop.
argument-hint: <bug and expected behavior>
disable-model-invocation: true
---

# Helix TDD fix loop

Use this loop only when the defect can be reproduced deterministically. Its first production edit is forbidden until a focused regression test has proven red.

## Required launch protocol

1. Treat `$ARGUMENTS` as the exact bug and expected behavior. If empty, ask and stop.
2. Read repository rules and identify the exact repository-relative Git-visible test paths, narrow reproduction argv, and final verification argv. All are user-confirmed bounded values. Accept at most one leading `./`; after removing it, reject ignored, absolute, empty-segment, dot-segment, backslash, and `.git` paths. Each argv must begin with a PATH-resolved executable name without `/`, `\\`, or a leading dash; pass repository scripts to an interpreter. The reproduction argv must address the exact test paths the trusted operation may create or replace; directory-name or filename heuristics are never an authorization boundary.
3. Select `mode`: `original` by default, or explicit `graph`. Original uses
   `${CLAUDE_PLUGIN_ROOT}/workflows/helix-tdd-fix.js`; graph uses
   `${CLAUDE_PLUGIN_ROOT}/workflows/graph/helix-tdd-fix.js`. If a supplied mode
   is neither exact `original` nor exact `graph`, stop before doctor,
   evidence-session, or Workflow invocation. Configure
   `reproductionPasses` (`1..2`, default `2`), `maxPasses` (`1..5`, default
   `3`), and optional models for `reproducer`, `builder`, `tester`,
   `documenter`, `reviewer`, and `verifier`.
4. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/helix-cc-doctor" --json`. Require a locally ready native or CLIProxyAPI workflow path. Stop for a global subagent-model override when role models were requested.
5. For CLIProxyAPI, require exact catalog membership and a successful exact-model proof for every new provider/model binding. Use provider prefixes in mixed casts, reject OpenRouter, and consult `${CLAUDE_PLUGIN_ROOT}/STATUS.md`.
6. Show the task, selected mode and exact script path, exact test paths,
   reproduction and verification argv, red/fix pass bounds, role models, and
   expected production scope. Obtain explicit confirmation.
7. Call `mcp__plugin_helix-cc_helix-cc-evidence__start_session` exactly once. Stop if it fails, and pass its exact `{id, publicKey}` result without reconstruction.
8. Invoke:

```text
Workflow({
  scriptPath: "<exact selected original or graph script path>",
  args: {
    task: "<exact confirmed defect>",
    testPaths: ["tests/focused-regression.test.mjs"],
    reproductionArgv: ["node", "--test", "tests/focused-regression.test.mjs"],
    verificationArgv: ["npm", "run", "verify"],
    evidenceSession: <exact start_session result>,
    reproductionPasses: 2,
    maxPasses: 3,
    models: {
      reproducer: "",
      builder: "",
      tester: "",
      documenter: "",
      reviewer: "",
      verifier: ""
    }
  }
})
```

Omit empty model fields. The reproducer has no direct write, edit, or shell tool:
it supplies complete contents for signed test paths to the trusted
`reproduce_red` operation. That operation retains only a valid scoped red and
runs its command inside a disposable copy with redirected project, Git, HOME,
and temporary process state. Ignored, Git-internal, HOME, sibling,
no-test-delta, green, infrastructure, or out-of-scope effects are discarded
with that copy. Only the
exact proposed signed test contents are applied to the user checkout after a
normal exit `1..125` that changes no repository file while executing. If red
cannot be proven without production edits, the workflow must stop.

Never run original and graph TDD modes against the same checkout. Each live
comparison side needs an equivalent disposable repository and a fresh evidence
session.

## Handoff

Verify that the returned receipt contains a non-zero reproduction bound to the exact confirmed `testPaths`, no pre-red path outside that signed scope, and the exact final command with exit code zero. Inspect the actual diff before reporting completion.
