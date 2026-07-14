# Architecture

Helix is an extension-only Pi package with three entrypoints:

- `helix-command.ts` registers the native slash commands and terminal UI.
- `helix-fence.ts` guards attended shell and write operations.
- `helix-answer.ts` captures structured answers without adding another command.

The command extension is an outer adapter. It projects Pi context and model
inventory into the Pi-independent policy in `extensions/lib/helix-command-core.mjs`.
Stable workflow, validation, persistence, and public-safety policy live under
`dispatch/lib/`; tracked configs and role briefs live under `dispatch/config/`.

## Workflow model

`dispatch/lib/workflows.mjs` is the canonical user-facing model. A version-1
workflow contains named stages, candidate-role panel steps, finite per-stage
passes, a required durable output per stage, explicit conditions and
transitions, an objective gate, a global pass and time rail, and deployment
defaults. Transition actions are `advance`,
`retry`, `back` to an earlier stage, or `stop`. Verdict stages cover all three
verdicts from one candidate role; gate stages cover both gate results. The two
condition families cannot be mixed.

User workflows are declarative JSON building blocks, not arbitrary executable
JavaScript. The hardened staged runner remains the only effect boundary. This
authority split makes complete save-time validation, public-safe persistence,
and deterministic provider-free workflow testing possible.

Tracked chains use schema version 3 and author the same native transition
blocks. `workflowToExecution()` is the sole compatibility projection into the
hardened staged runner. A tracked chain becomes a built-in workflow only when a
tracked run config supplies its real gate and deployment settings; no defaults
are fabricated for view-only chain shapes. User workflows store their original
runtime `chain_id`, so a config such as `mock-core-loop` remains bound to the
tracked `full-cycle` chain identity.

Save-time and runtime step ordering share
`dispatch/lib/stage-schedule.mjs`. Each stage needs at least one candidate role;
judge and synthesizer are panel mechanisms rather than ordinary steps; verifier
is a distinct verification block; typed local checks and handoffs follow the
one executable ordering. Workflows that request host effects not injected by
the Pi workflow executor are labeled non-runnable and refuse before run state
is reserved. Every named-workflow stage requires a planner or builder plus a
contained durable output; at least one output must be the objective-gate file.
Tracked stages without an explicit artifact normalize to that gate output when
projected into the named-workflow model. Named workflows currently accept only
the confirmed current repository as their run target.

Workflow outputs and gates share the persistence layer's canonical file-path
validator. It rejects empty, dot, traversal, doubled/trailing segments and the
worktree's protected `.git` metadata before save or execution.

`testWorkflow()` validates the closed schema, selects every transition
condition, checks its action/target/stop code, proves retry-at-ceiling refusal,
validates every output and the runner deployment projection, and simulates the
success path with the same transition and terminal semantics as the runtime
state machine. The creator will not save until that test passes. Repository
tests additionally execute every stock template through the staged runner in
an empty committed repository with the provider-free mock cast.

## Execution boundary

The TUI command resolves the named workflow and active profile, filters global
profile assignments to the selected stage ids with explicit warnings for
ignored overrides, and asks the user to confirm the exact task, cast, stage
order, repository, worktree toggle, and bounded durations. The default workflow
rails are ten minutes for the whole run and two minutes for each provider call;
both are workflow data, shown in preflight, bound into execution identity, and
stored structurally in run state. A hash of the exact workflow, active profile,
effective toggles, and effective presets binds consent to execution; drift
refuses before the run directory or any provider effect. The runner propagates
one whole-run abort boundary through stages and effects, while the provider
adapter starts each call deadline before session/resource creation.

Mock casts use the deterministic staged adapter. Real casts use
`dispatch/lib/pi-agent-adapter.mjs`, which resolves exact, case-preserving
provider/model ids from Pi's configured `ModelRegistry`, reuses Pi authentication
storage, and creates fresh in-memory Pi agent sessions in the run worktree.
Helix has no provider-selection or credential layer. Mixed casts route each
mock member to the deterministic adapter and each configured member to Pi.
Writer-bearing stages are forced to sequential candidate execution in their
shared worktree; read-only panels honor the configured concurrency cap. Planner
and builder workflow sessions receive mutation tools; other workflow candidate
roles are read-only. Judge, synthesis, and verification receive the exact task
as well as their structural projections.

Each role prompt names the exact durable stage output and the complete objective
gate path plus marker. Mock casts create the same declared outputs, so provider-
free execution exercises the runtime handoff and gate contracts rather than
only transition signals. Prompt templates use one-pass substitution, so braces
inside tasks, markers, artifacts, or handoffs remain exact input text.

The worktree is a Git-state boundary, not an OS sandbox; Pi tools retain their
normal trust model. Session extensions, skills, prompt templates, and themes are
disabled inside workflow sub-sessions to prevent recursive Helix loading, while
repository context discovery remains enabled.

Helix installs no threshold-based auto-compaction policy and no compaction
hooks. Each in-memory Pi `AgentSession` keeps Pi's default compaction policy.

Package resources are immutable after installation. Mutable state is rooted at
`~/.pi/agent/helix` (or `HELIX_STATE_DIR`) and contains settings, profiles,
onboarding status, atomic user workflow JSON, and structural run data. No
command writes into the installed package directory.

The command extension listens for Pi's `session_start` event and considers only
the cold `startup` reason in TUI mode. When no valid onboarding marker exists,
it offers Start, Later, and Don't show again actions. Later writes nothing;
completion and dismissal use the same root-confined atomic persistence boundary
as other user-local Helix state. `/helix-onboarding` bypasses the one-time marker
so the guide always remains discoverable and rerunnable.

Every command output crosses the public-safety renderer before Pi displays it.
Mutations validate first, write atomically, and require attended confirmation
unless they are reversible settings toggles in the checkbox UI. Real execution
never uses mock as an implicit fallback. The exact task remains in memory; run
state stores only its hash-bound execution identity and a structural
`task_bound` marker. Task-bound in-process resume is not yet implemented, so the
resume surface refuses explicitly and never emits the legacy config-only CLI.
