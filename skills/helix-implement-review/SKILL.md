---
name: helix-implement-review
description: Run a bounded implement, test, document, review, verify, and remediation loop for an already-scoped repository change.
argument-hint: <task>
disable-model-invocation: true
---

# Helix implement-review loop

Use this loop when the implementation direction is already settled and a separate planning phase would add no value.

## Required launch protocol

1. Treat `$ARGUMENTS` as the exact task. If it is empty, ask for the task and stop.
2. Read repository rules, inspect the target, and identify the expected writer scope plus canonical verification argv vector. Do not encode shell syntax. The first item must be a PATH-resolved executable name without `/`, `\\`, or a leading dash; pass repository scripts to `node` or another interpreter instead of executing `./…` directly.
3. Select `mode`: `original` by default, or explicit `graph`. Original uses
   `${CLAUDE_PLUGIN_ROOT}/workflows/helix-implement-review.js`; graph uses
   `${CLAUDE_PLUGIN_ROOT}/workflows/graph/helix-implement-review.js`. If a
   supplied mode is neither exact `original` nor exact `graph`, stop before
   doctor, evidence-session, or Workflow invocation. Configure
   `maxPasses` (`1..5`, default `3`) and optional role models for `builder`,
   `tester`, `documenter`, `reviewer`, `redteam`, and `verifier`. Omitted roles
   inherit the session model.
4. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/helix-cc-doctor" --json`. Continue only when `paths.nativeClaudeWorkflow.locallyReady` or `paths.cliProxyNativeWorkflow.locallyReady` is true. Stop when a global subagent-model override is present and per-role models were requested.
5. In a CLIProxyAPI session, require every explicit model to appear exactly in `paths.cliProxyNativeWorkflow.models`. Require a successful exact-model proof before first use of a provider/model combination. Use provider-prefixed IDs for mixed casts, reject OpenRouter, and check `${CLAUDE_PLUGIN_ROOT}/STATUS.md` for the promoted routes.
6. Show the exact task, selected mode and exact script path, scope, role models,
   pass bound, and verification argv. Obtain explicit confirmation before launch.
7. Call `mcp__plugin_helix-cc_helix-cc-evidence__start_session` exactly once with `{ "authorization": { "commands": [{ "argv": <exact verification argv>, "purpose": "verification", "metric": null }], "tdd": null, "prePr": null } }`. This binds the trusted service before any effect can run. Stop if it fails, and pass its exact `{id, publicKey}` result without reconstruction.
8. Invoke:

```text
Workflow({
  scriptPath: "<exact selected original or graph script path>",
  args: {
    task: "<exact confirmed task>",
    verificationArgv: ["npm", "run", "verify"],
    evidenceSession: <exact start_session result>,
    maxPasses: 3,
    models: {
      builder: "",
      tester: "",
      documenter: "",
      reviewer: "",
      redteam: "",
      verifier: ""
    }
  }
})
```

Omit empty model fields. Do not invent a token-budget field.

Never compare the modes live in the same write checkout. Use deterministic
parity fixtures or separate equivalent disposable repository copies.

## Handoff

Inspect the actual diff and command evidence after the workflow returns. Report changed files, checks, gate result, and residual risk. An exhausted or interrupted loop is not complete.
