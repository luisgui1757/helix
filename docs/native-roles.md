# Model settings and verification

The current native session is the writer. Helix and Second-opinion use the
host's delegation and model settings. Use [setup-helix](how-to.md#choose-models-and-effort)
for guided configuration.

| Host | Configuration and scope |
|---|---|
| Codex | Native `[agents]` defaults apply to every subagent in the selected project or user scope. Project configuration requires trust. See the [Codex reference](../skills/setup-helix/references/codex.md). |
| Claude Code | A project `helix-reviewer` role overrides the user-level role. See the [Claude reference](../skills/setup-helix/references/claude-code.md). |
| T3 Code | Use its live catalog and task targets. Native reviewer defaults and role tool limits do not automatically carry over. See the [T3 reference](../skills/helix/references/t3.md). |

Claude's supplied role allows Read, Glob and Grep. It cannot run Git or tests,
so the writer supplies the full diff and captured check output. Existing saved
roles need an explicit update; installing a newer skill does not rewrite them.
Codex children inherit the launching turn's sandbox. T3's review role does not
make execution read-only. Report the controls observed for each review.

## Verify what ran

Match native execution records to the child dispatch and each review round:

- Codex records the child's parent and resolved model and effort per turn.
- Claude session events report the response model. Its
  [request telemetry](https://code.claude.com/docs/en/monitoring-usage) can expose
  model, effort and query source. A generic `agent:custom` label alone cannot
  identify a named role; correlate the Agent call and child transcript.
- T3 returns provider/model and task, thread and run IDs. Verify effective effort
  against correlated provider records when available.

Inspect only this task's records and keep prompt/tool-content export disabled.
Literal model IDs identify the request, not guaranteed execution: invocation
options or organization policy can override a role. Configuration, self-reports,
response length and timing do not prove settings. Mark unexposed values
unverified; host records do not establish provider-internal computation.
