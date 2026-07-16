# Helix command manual

Helix is a Pi extension package. Its commands inspect or mutate Helix state; they
do not ask the active model to interpret a pseudo-command.

## Install and open

```sh
npm install -g @earendil-works/pi-coding-agent
pi install git:github.com/luisgui1757/helix
pi
```

Before using Helix, configure or sync the providers you want in Pi. Helix reads
Pi's already available model inventory; provider login, selection, and setup
remain Pi concerns.

On the first cold Pi startup, Helix offers a four-step keyboard tour covering
that prerequisite, optional feature settings, casts, and run inspection. Choose
**Later** to leave no marker and offer the tour again on the next cold startup.
Choose **Don't show again** to persist a dismissal. Finishing the tour persists
completion. Run `/helix-help` after installation or `/helix` to return to the
dashboard.

## Commands

### `/helix`

Shows the active config, cast, feature toggles, live-transport status, and latest
structural runs. The older `/helix <verb>` form remains compatible, but dedicated
commands are the primary interface.

### `/helix-help`

Shows install guidance, the native command map, the live-transport boundary, and
the next safe action for refusals. It is view-only and does not load mutable
state.

### `/helix-onboarding`

Reruns the getting-started tour even when it was completed or dismissed. Use ↑
and ↓ to move between screens, Enter to advance or finish, and Esc to defer.
The tour does not select a provider or change feature, profile, cast, or workflow
configuration.

### `/helix-run [workflow-id] -- <task>`

Preflights a named workflow. With no workflow or task, the TUI prompts for them.
The preflight resolves the stages, active-profile cast, exact providers, models,
efforts, instance counts, feature toggles, concurrency, objective gate, pass
ceilings, 10-minute default whole-run deadline, 2-minute default
per-provider-call deadline, repository, and worktree setting. It validates every
explicit effort across the full cast before confirmation; an unavailable
capability refuses the entire run before any Pi session or provider prompt. The
attended confirmation displays those exact cast tuples before execution.
Non-interactive modes stop after preflight.

The recommended objective check is a bounded argv command such as `npm test`.
Helix verifies that its executable exists before save and run, displays the
exact command in the consent preview, and invokes it directly in the run
worktree with no shell. A file-text check remains available for repositories
without an independent command, but the UI labels it weaker because a model can
write the expected text itself.

Configure or sign in to providers in Pi before running Helix. Helix reuses Pi's
configured `ModelRegistry` and authentication storage; it does not select,
configure, or persist provider credentials. OpenRouter free models are treated
like any other configured and available model. A configured real cast never
falls back to mock. Partially configured casts are valid: real members route to
Pi and remaining mock members route to the deterministic adapter.

Planner and builder workflow blocks receive Pi's normal mutation tools;
other candidate roles are read-only. The selected worktree setting is shown in
the confirmation. Writer-bearing stages run their panel serially against the
shared worktree; read-only stages may use the configured concurrency cap. A Git
worktree protects Git state but is not an OS sandbox.

### `/helix-runs`

Lists structural run records. Prompts, responses, provider payloads, private code,
and credentials are never rendered or persisted by this surface.

### `/helix-run-status <run-id>`

Shows one run's structural state and gate outcome.

### `/helix-run-watch <run-id>`

Renders the run's event stream as a compact progress view with a stage flow,
current/completed/pending indicators, pass counts, and forward, retry, and back
arrows. Each new run stores a hash-bound immutable workflow snapshot; watch uses
that snapshot, so later edits or deletion of a personal workflow cannot rewrite
the history being displayed. Legacy records without a snapshot use the current
definition when it is still available.

### `/helix-run-resume <run-id>`

Validates whether an interrupted legacy config run is resumable and prints its
bound invocation. New Pi workflow runs bind the exact in-memory task into their
execution identity and explicitly refuse with `workflow-resume-unsupported`;
Helix never prints a config-only command that would lose the task. Completed,
malformed, mismatched, and unsafe records also refuse.

### `/helix-run-prune <run-id>`

Deletes one structural run directory after an attended confirmation. RPC and
print modes cannot authorize deletion.

### `/helix-models`

Shows Pi's currently available models alongside Helix's composite cast presets.
Provider/model entries are validated against Pi's inventory before they can be
saved.

### `/helix-chains`

Shows tracked workflow chains, stages, handoff artifacts, and whether each chain
is runnable by the loop engine.

Chains are architecture/view data. Only chains with a real run config become a
built-in named workflow; Helix does not invent gates or deployment settings for
the other tracked chain shapes.

### `/helix-workflows [list | show <id> | test <id>]`

Lists built-in and user-local named workflows, shows their stage panels and
explicit transitions, or tests one without provider calls. `show` includes the
same compact flow diagram used by run watch.

Testing reports proof layers separately:

1. Definition: the closed schema, every authored condition/action/target,
   retry-at-ceiling refusal, declared outputs, and a deterministic success-path
   simulation.
2. Deployment: casts, configured provider availability, repository target,
   limits, and objective-check executable resolution.
3. Isolated runtime smoke (optional in TUI): the real staged runner, transitions,
   checkpoints, outputs, and cleanup in a temporary detached worktree using the
   deterministic mock cast and simulated gate results.
4. Task proof: not claimed by testing; only an actual run executes the real
   objective check against the requested task.

Each stage has one candidate-role panel, a
finite pass ceiling, and one condition family:

- verdict: `approve`, `revise`, and `revise-jump` from one candidate role;
- gate: `pass` and `fail` from the deterministic objective gate; or
- `always`.

Conditions route to advance, retry the current stage, return to a named earlier
stage, or stop with a stable code. A final `always` may be a fallback. Gate and
verdict families cannot be mixed in one stage.

### `/helix-workflow-create`

Opens the keyboard-first workflow builder. Choose `implement-review`,
`plan-implement`, or `tdd-fix` as a safe starting point, then use the building
block menu to:

- add, remove, and reorder named stages;
- edit each stage's repository-relative durable output and kind
  (`.`, empty/trailing segments, traversal, and `.git` are refused);
- edit panels built from scout, planner, builder, reviewer, red-team, and an
  optional verifier block;
- replace a condition family and edit transition actions, back targets, or stop
  codes;
- set the default or per-stage cast preset and maximum concurrency;
- choose a recommended command check or weaker file-text check, then set global
  passes, per-stage passes, whole-run deadline, and
  per-call deadline.

Invalid removals or moves that would break a back target are refused in place.
Every stage retains at least one candidate role and a declared durable output.
Planner and builder make a stage writer-bearing and therefore serial. A stage
containing only read-only candidates can use the configured concurrency cap;
Helix writes its structured aggregate output at the runtime boundary. For a
file-text objective check, the checked path must be one of the stage outputs.
Documenter and internal panel-mechanism roles are not offered as stage blocks.
Named workflows currently target only the confirmed current repository. Before
save, Helix validates deployability, output obligations, bounds, and objective
executable availability; tests every transition and ceiling; simulates
end-to-end success; and shows the complete
panel, output, transition, deployment, current-repository target, gate, and
duration preview. Workflows are atomically saved
under `~/.pi/agent/helix/workflows/` and cannot shadow built-ins.

### `/helix-workflow-edit [id]`

Reopens a personal workflow in the same guided builder. Built-ins are immutable.
The complete definition and deployment checks run again before an atomic replace.

### `/helix-workflow-clone [id]`

Copies a personal workflow to a new safe name, retargets its chain and structural
references, opens it in the builder, and saves only after full validation.

### `/helix-workflow-delete [id]`

Deletes one personal definition after attended confirmation. Existing run
records and their immutable workflow snapshots remain inspectable.

The [workflow cookbook](workflows.md) documents allowed/required blocks,
defaults, limits, visual notation, direct JSON customization, and examples.

### `/helix-settings [<feature> on|off]`

With no arguments, opens the native checkbox interface:

```text
[x] Multi-model
[x] Loops
[x] Autoresearch
[x] Context engine
[x] Worktrees
[x] Visual cues
```

Use ↑/↓ to move, Enter or Space to toggle, and Esc to close. Changes save
immediately because each toggle is local and reversible. An explicit command is
also available, for example `/helix-settings loops off`.

### `/helix-profiles [show <id> | switch <id> | create <id>]`

Lists, inspects, activates, or creates saved casts. Create and switch operations
require attended confirmation.

### `/helix-setup [profile assignments…]`

With no arguments, shows profiles, stages, presets, and Pi's available model
inventory. Assign a preset or model to a stage:

```text
/helix-setup deep-work plan=overlord implement=openai-codex/gpt-5:high
```

Composite members use `<preset>.<role>=<provider>/<model>[:effort][*instances]`.
Effort accepts `default`, `low`, `medium`, `high`, `xhigh`, `max`, or
`provider-managed`. On live Pi sessions, `low` through `xhigh` are exact
requests and `max` means Pi `xhigh`; Helix refuses an explicit level the model
declares unsupported instead of allowing Pi to clamp it. `default` and
`provider-managed` intentionally defer the level to Pi/provider policy.
Helix validates the complete change before atomically saving and activating the
profile. Profiles are global overlays; when a named workflow has different
stage ids, irrelevant stage overrides are ignored with an explicit preflight
warning instead of breaking cast resolution.

### `/helix-research <question> --metric <name> <cmp> <target> --max <n> [--plateau <n>]`

Validates an attended research specification and prints the deterministic runner
invocation. A metric, comparison target, and iteration cap are mandatory. The
command refuses when Autoresearch is disabled or the session is unattended.

## State and safety

Helix writes `onboarding.json`, `settings.json`, `profiles/`, `workflows/`, and
`runs/` under
`~/.pi/agent/helix`. `PI_CODING_AGENT_DIR` changes Pi's agent directory;
`HELIX_STATE_DIR` overrides only the Helix state root.

`onboarding.json` contains only a schema version and `completed` or `dismissed`
status. **Later** writes nothing. The tour is offered only for a cold attended
TUI startup, never for reload, new-session, resume, fork, print, JSON, or RPC
session starts.

Run launch plus mutating profile, setup, and prune commands require an attended
Pi confirmation. Settings toggles save directly from the checkbox interface. All malformed,
unsafe, unavailable, or unsupported inputs fail closed with a stable code,
reason, and next safe action.

Personal workflow JSON is trusted local configuration, but it is still closed,
bounded, and revalidated at load, save, test, and run. It cannot contain shell or
filesystem effect steps. A declared objective command is the sole executable
workflow-owned check; it is argv-only, bounded by its timeout and the whole-run
deadline, and receives no shell expansion.

The fence and answer-capture extensions remain independent of command state.
Helix ships no skill, theme, project settings file, provider credentials, or
telemetry override.

Helix registers no context-usage threshold, automatic-compaction policy, or
compaction hook. Every workflow sub-session retains Pi's default compaction
policy.

The raw workflow task is never written to disk. Only a hash-bound execution
identity and structural `task_bound: true` marker enter run state. Provider
prompts and responses are not persisted by the workflow command surface.
