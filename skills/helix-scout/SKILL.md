---
name: helix-scout
description: Run read-only repository reconnaissance and return a decision-ready implementation brief without writing files.
argument-hint: <question or proposed change>
disable-model-invocation: true
---

# Helix scout loop

Use this loop to understand an unfamiliar change surface before implementation. Both stages are read-only; the result is returned as structured output rather than written to `BRIEF.md`.

## Required launch protocol

1. Treat `$ARGUMENTS` as the exact reconnaissance question. If empty, ask and stop.
2. Read repository rules and state that the loop will not create, edit, delete, format, install, migrate, or implement.
3. Configure optional `scout` and `planner` models. Omitted roles inherit the session model.
4. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/helix-cc-doctor" --json`. Require a locally ready native or CLIProxyAPI workflow path. Stop for a global subagent-model override when explicit role models were requested.
5. For CLIProxyAPI, require exact catalog membership and an exact-model proof before first use of a new provider/model binding. Use provider prefixes for mixed casts and reject OpenRouter.
6. Show the exact question, read-only boundary, and models. Obtain explicit confirmation.
7. Invoke:

```text
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/helix-scout.js",
  args: {
    task: "<exact confirmed question>",
    models: {
      scout: "",
      planner: ""
    }
  }
})
```

Omit empty model fields.

## Handoff

Confirm the checkout is unchanged, then report verified observations, unknowns, the bounded implementation brief, and any choice that still requires the user.
