# Native roles and execution evidence

Use the [how-to](how-to.md) for writer launch commands, saved reviewer settings
and per-task examples. The writer is the current native session. Helix and
second-opinion use that host's delegation; the skills contain no model router.

## Configuration sources

- [Codex setup reference](../skills/setup-helix/references/codex.md): native
  defaults apply to all subagents in the selected scope. Project configuration
  requires a trusted project. Named-role selection remains unverified on the
  tested Codex CLI 0.160.0, even though current host documentation describes it.
- [Claude Code setup reference](../skills/setup-helix/references/claude-code.md):
  the canonical `helix-reviewer` template, project/user precedence and launch
  syntax. Helix and second-opinion can use the same role.

The Claude template permits only Read, Glob and Grep. It cannot run Git or tests,
so the writer must supply the full staged, unstaged and new-file delta and actual
verification output. Shell access would change this boundary; it is not part of
the template. Protected configuration edits use the host's approval flow.

## Verify what ran

A configuration file or an agent's claim about itself is not execution proof.
Claude's per-invocation model argument can override a role, and organizational
allowlists can cause substitution. Use literal model IDs when the version
matters, then verify the actual request; a literal ID does not defeat policy.
See Claude's [model selection rules](https://code.claude.com/docs/en/sub-agents#choose-a-model).

Match native records to the actual child dispatch, including re-review turns:

- Codex records the child's parent and each turn's resolved model and effort.
  Inspect the child tool calls and final response as well as those settings.
- Claude Code reports the response model in session events. Its
  [request telemetry](https://code.claude.com/docs/en/monitoring-usage) exposes
  `model`, `effort` and `query_source`. On the tested version, a custom subagent
  appears as `agent:custom`, not its role name. Match it to the native Agent call
  and child transcript; that label alone cannot identify a named role.

Keep prompt and tool-content export disabled, and inspect only records for the
task. The earlier evaluations used a temporary local metadata collector; it is
not a product dependency. These records establish the host's settings and
requests, not what the provider ran internally. Unobservable settings remain
unverified; timing, response length and thinking text do not prove effort.

[Status](../STATUS.md) summarizes observed combinations and limits. The dated
[role evaluation](reviews/2026-10-03-native-role-verification.md) and
[collection evaluation](reviews/2026-10-04-four-skills.md) retain the evidence.
