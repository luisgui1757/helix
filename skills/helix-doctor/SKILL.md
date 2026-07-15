---
name: helix-doctor
description: Diagnose local Claude Code, Codex subscription, Pi provider, OpenRouter, Microsoft Foundry, and GitHub Copilot readiness without printing credentials.
disable-model-invocation: true
---

# Helix provider doctor

Run `node "${CLAUDE_PLUGIN_ROOT}/bin/helix-cc-doctor" --json` with Bash and summarize its safe status classes. The command is read-only and reports credential presence as booleans; never print the environment variables themselves.

Interpret provider readiness using `${CLAUDE_PLUGIN_ROOT}/docs/providers.md`. Keep these states separate:

- native Claude Code backend;
- CLIProxyAPI translation while retaining the native Claude Code Workflow harness;
- provider-prefixed Codex, Copilot, and Azure routes inside that gateway;
- Anthropic-compatible gateway for the whole Claude Code process;
- peer worker invoked through Codex CLI, GitHub Copilot CLI, or Pi.

Do not claim that a detected executable is authenticated unless the diagnostic explicitly verified authentication.
Treat `paths.nativeClaudeWorkflow.locallyReady` only as a local precondition, not
proof that a workflow can launch. `paths.nativeClaudeWorkflow.ready` remains
false because active managed policy, service-delivered settings, plan eligibility,
and effective model selection cannot be proven by this local diagnostic. Confirm
those in Claude Code `/status` or by launching the workflow. Report an
incompatible Claude version, `CLAUDE_CODE_DISABLE_WORKFLOWS=1`, or a present
global subagent-model override explicitly; the doctor never returns the raw
override value.
Treat `paths.cliProxyNativeWorkflow.locallyReady` as proof only that Claude Code
workflow prerequisites and the authenticated loopback model catalog passed.
`ready` remains false until a real Workflow subagent launch succeeds. Report
the catalog model IDs because exact membership is required for per-role routing,
but never report the proxy token, OAuth filename, account identifier, or local
state path.
Treat `paths.githubCopilotNativeWorkflow` and
`paths.microsoftFoundryGptGateway` as provider-specific preconditions, not
proof. A Copilot catalog requires the pinned unofficial gateway and an exact
`copilot/<id>` proof. An Azure configuration requires an exact endpoint/model
map plus API-key or Azure CLI auth and an `azure/<deployment>` proof whose
attestation boundary accepted the served-model identity. OpenRouter is deferred
even if unrelated OpenRouter environment variables are present.
