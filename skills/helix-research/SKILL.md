---
name: helix-research
description: Run a bounded hypothesis, experiment, measurement, documentation, review, and verification loop against an explicit target.
argument-hint: <research objective>
disable-model-invocation: true
---

# Helix research loop

Use this loop when a repository decision needs measured experiments rather than an implementation plan alone.

## Required launch protocol

1. Treat `$ARGUMENTS` as the exact research objective. If empty, ask and stop.
2. Read repository rules and define a named metric, its unit, a finite numeric target plus comparator (`lt`, `lte`, `eq`, `gte`, or `gt`), an exact measurement argv, and an exact test argv. Each argv must begin with a PATH-resolved executable name without `/`, `\\`, or a leading dash; use an interpreter for repository scripts. The measurement must emit exactly one JSON object shaped as `{ "metric": <name>, "value": <finite number>, "unit": <unit> }`. If that contract cannot be measured repeatably, stop.
3. Select `mode`: `original` by default, or explicit `graph`. Original uses
   `${CLAUDE_PLUGIN_ROOT}/workflows/helix-research.js`; graph uses
   `${CLAUDE_PLUGIN_ROOT}/workflows/graph/helix-research.js`. If a supplied mode
   is neither exact `original` nor exact `graph`, stop before doctor,
   evidence-session, or Workflow invocation. Configure
   `maxPasses` (`1..5`, default `5`), optional `plateauAfter`
   (`1..maxPasses`; omit to disable early plateau termination), and optional
   models for `planner`, `builder`, `tester`, `documenter`, `reviewer`, and
   `verifier`.
4. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/helix-cc-doctor" --json`. Require a locally ready native or CLIProxyAPI workflow path. Stop for a global subagent-model override when per-role models were requested.
5. For CLIProxyAPI, require every explicit model in the exact catalog and require an exact-model proof before a new provider/model is used. Use namespaced IDs for mixed casts, reject OpenRouter, and check `${CLAUDE_PLUGIN_ROOT}/STATUS.md`.
6. Show the objective, selected mode and exact script path, metric, typed
   target, exact measurement and test argv, pass bound, optional plateau bound,
   expected experiment scope, all four terminal reasons, and models. Obtain
   explicit confirmation.
7. Call `mcp__plugin_helix-cc_helix-cc-evidence__start_session` exactly once with `{ "authorization": { "commands": [{ "argv": <exact measurement argv>, "purpose": "measurement", "metric": { "metric": <exact metric name>, "unit": <exact unit> } }, { "argv": <exact test argv>, "purpose": "tests", "metric": null }], "tdd": null, "prePr": null } }`. This binds the trusted service before any effect can run. Stop if it fails, and pass its exact `{id, publicKey}` result without reconstruction.
8. Invoke:

```text
Workflow({
  scriptPath: "<exact selected original or graph script path>",
  args: {
    task: "<exact confirmed objective>",
    metric: "latency_ms",
    target: { comparator: "lte", value: 10, unit: "ms" },
    measurementArgv: ["node", "scripts/measure-latency.mjs"],
    testArgv: ["npm", "test"],
    evidenceSession: <exact start_session result>,
    maxPasses: 5,
    plateauAfter: 2,
    models: {
      planner: "",
      builder: "",
      tester: "",
      documenter: "",
      reviewer: "",
      verifier: ""
    }
  }
})
```

Omit empty model fields and omit `plateauAfter` when no early plateau stop is
wanted. Each pass may make one bounded experiment. The workflow takes a
preliminary signed measurement for the ledger writer, then reruns both the exact
measurement and test argv after that writer; only those final-checkout receipts
can approve a result. An expected target miss or remaining successor is research
evidence, not an execution blocker. `target-met` and a reviewed refutation with no successor
(`dead-end`) return `approved: true`. `diminishing-returns` and
`max-iterations` return structured `approved: false` results. Equality progress
means strictly decreasing distance from the declared target. A non-refuted miss
may still name a concrete successor; only a refutation without one is a
dead-end.

Never run both modes against the same research checkout. Live comparison
requires equivalent disposable copies and fresh evidence sessions.

## Handoff

Inspect the actual changes and `RESEARCH.md` or the repository's established ledger. Report the exact metric command, observed result, target comparison, pass count, `stopReason`, gate result, and limitations.
