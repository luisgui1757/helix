---
name: helix-loop
description: Run the Helix full-cycle/plan-implement loop with bounded planning, implementation, testing, documentation, adversarial review, and verification.
argument-hint: <task>
disable-model-invocation: true
---

# Helix loop

Use the plugin's native Claude Code mapping of Helix `full-cycle` and guided `plan-implement` for a repository change that deserves independent planning and adversarial verification.

## Required launch protocol

1. Treat `$ARGUMENTS` as the exact task. If it is empty, ask for the task and stop.
2. Read repository rules and inspect enough of the target to identify the likely write scope and canonical verification argv vector. Do not encode shell syntax. The first item must be a PATH-resolved executable name without `/`, `\\`, or a leading dash; use `["npm", "run", "verify"]` or `["node", "scripts/check.mjs"]`, never `["./scripts/check.mjs"]`.
3. Build a requested configuration:
   - `mode`: `original` by default, or explicit `graph`. `original` uses
     `${CLAUDE_PLUGIN_ROOT}/workflows/helix-delivery.js`; `graph` uses the
     generated `${CLAUDE_PLUGIN_ROOT}/workflows/graph/helix-delivery.js`.
     If a supplied mode is neither exact `original` nor exact `graph`, stop
     before doctor, evidence-session, or Workflow invocation.
   - `maxPasses`: default `3`, allowed `1..5`.
   - `models.planners`: either empty or two to four model identifiers accepted by the active Claude Code backend or authenticated gateway. Empty means two planners inheriting the session model.
   - `models.judge`, `builder`, `tester`, `documenter`, `reviewer`, `redteam`, `verifier`: optional backend/gateway model identifiers. Omitted means the role inherits the session model.
   - Role effort is defined in `agents/*.md`: planning, building, red-team, and verification use `xhigh`; test, documentation, and correctness review use `high`.
4. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/helix-cc-doctor" --json`. Continue only if either
   `paths.nativeClaudeWorkflow.locallyReady` or
   `paths.cliProxyNativeWorkflow.locallyReady` is true. Even then, explain that
   managed policy and exact launch/effective-model behavior remain unverified
   until an actual Workflow launch confirms them. If the selected path reports
   `subagentModelOverridePresent`, stop when per-role model selection was
   requested: the global override has higher precedence than every Workflow
   `agent(..., {model})` value.
5. Show the user the exact task, selected `original` or `graph` mode and exact
   script path, requested role/model values, `maxPasses`, expected writer scope,
   and verification argv. Ask for explicit confirmation before launching. State
   that this skill confirmation is advisory: a direct `Workflow` tool call,
   SDK/headless execution, or permissive approval mode can bypass it. Claude
   Code's script approval is a separate control and is not deterministic
   task/configuration consent.
6. For a CLIProxyAPI session, require every explicit role model to appear
   exactly in `paths.cliProxyNativeWorkflow.models`; catalog absence is a hard
   preflight failure. Explain that `agent()` still launches the native Claude
   Code harness while the sidecar translates inference to the catalog model.
   Catalog presence alone does not prove the route. Before the first real use
   of a new single-provider binding, require
   `node "${CLAUDE_PLUGIN_ROOT}/bin/helix-cc-cliproxy" proof --providers <codex|copilot|azure> --model <id>`.
   For a mixed binding, require
   `node "${CLAUDE_PLUGIN_ROOT}/bin/helix-cc-cliproxy" proof-matrix --providers <comma-separated-provider-set> --models <comma-separated-namespaced-ids>`.
   If a new proof is needed from an active wrapped session, stop that session,
   run the exact route command, then relaunch it. The current receipts cover `gpt-5.6-luna`,
   `copilot/gpt-5.4`, and their mixed Workflow matrix. For mixed casts,
   require namespaced IDs: `openai/<id>`, `copilot/<id>`, or
   `azure/<deployment>`. Azure has an implemented boundary but no current live
   receipt; check `STATUS.md` for the exact promoted routes. OpenRouter is
   deferred and must be rejected. Never
   translate or substitute a model silently.
7. After confirmation, call `mcp__plugin_helix-cc_helix-cc-evidence__start_session` exactly once. Stop if it fails. Pass its exact `{id, publicKey}` result to the workflow; do not reconstruct or edit it.
8. Invoke with the public structured-object `args` contract:

```text
Workflow({
  scriptPath: "<exact selected original or graph script path>",
  args: {
    task: "<exact confirmed task>",
    verificationArgv: ["npm", "run", "verify"],
    evidenceSession: <exact start_session result>,
    maxPasses: 3,
    models: {
      planners: [],
      judge: "",
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

Omit empty model fields. The public Workflow input does not expose a portable token-budget field; do not invent or pass one. If a hard token cap is required, explain that this plugin cannot enforce it and stop before launch.

Never run both modes sequentially against the same write checkout as a live
comparison. Use the deterministic parity suite, or separate equivalent
disposable repository copies with fresh evidence sessions.

## Handoff

Inspect the actual diff and final test evidence after the workflow returns. A structured agent report is not proof by itself. Report changed files, exact checks and results, residual risk, and whether the gate approved. Never describe an exhausted or interrupted workflow as complete.
