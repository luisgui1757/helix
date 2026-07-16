# Helix command manual

Helix is a Pi extension. Configure providers in Pi first; Helix consumes the
available inventory and never manages credentials or silently chooses a route.
Supported Pi versions are `>=0.80.7 <0.81.0`.

## Start

- `/helix` opens the structural dashboard.
- `/helix-help` shows first steps and stable refusal guidance without loading
  mutable configuration.
- `/helix-onboarding` reruns the four-screen tour. On cold startup, **Later**
  writes nothing, **Don't show again** stores dismissal, and completion stores a
  completed marker.

Mutable settings, profiles, workflow definitions, and run records live below
`~/.pi/agent/helix`, `HELIX_STATE_DIR`, or Pi's configured agent directory.

## Build and inspect workflows

`/helix-workflow-create` opens the guided common-case builder. Pick a template,
objective gate, stages, role panels, retry/back/stop routes, outputs, casts,
concurrency, and deadlines. The UI validates and simulates before its atomic
save. `/helix-workflow-edit`, `/helix-workflow-clone`, and
`/helix-workflow-delete` manage personal definitions; built-ins are immutable.

`/helix-workflows [list | show <id> | test <id>]` lists or graphs definitions
and performs provider-free schema/simulation checks plus deployment preflight.
In TUI mode, `test` may also run the existing deterministic mock smoke in an
isolated disposable worktree. It never claims the user's task succeeded.

`/helix-workflows import <repository-relative-v4.json>` is the expert deploy
surface. It requires attended confirmation, a regular contained file no larger
than 256 KiB, schema version 4, `source: "user"`, a runnable objective gate, a
successful graph simulation, a non-conflicting id, and an atomic destination.
The pure API in `dispatch/workflow/builder.mjs` produces the same validated JSON;
Helix does not execute the program that generated it.

## Run, watch, and recover

`/helix-run [workflow-id] -- <task>` resolves the graph, current profile,
feature toggles, cast, exact provider/model/effort/route/account requirements,
objective gate, worktree, concurrency, and deadlines. Print/RPC modes stop at
preflight. TUI mode requires confirmation and rechecks the complete binding
before creating the run or contacting a provider.

Every named workflow, including legacy saved definitions and tracked built-ins,
normalizes into WorkflowDefinition v4 and runs through the same kernel. The
kernel reserves effects, propagates cancellation, serializes shared writers,
promotes isolated proposals only from an unchanged base, records an append-only
effect journal, and permits success only through the final objective gate.

- `/helix-runs` lists structural records.
- `/helix-run-status <run-id>` shows one structural record.
- `/helix-run-watch <run-id>` validates the pinned definition, lifecycle
  snapshot, state, event sequence, and graph before rendering stable node ids,
  visits, effects, gates, and terminal state. Later workflow edits cannot rewrite
  history.
- `/helix-run-resume <run-id>` is attended for v4 runs. It asks for the original
  task, verifies its hash, reloads the pinned definition, revalidates policy and
  exact cast, restores the retained worktree from the last private bounded
  snapshot, trims orphan event/journal suffixes, and resumes completed effects
  without replaying them. Completed runs are a no-op. Old staged-run records
  remain read-only compatible through their historical validator.
- `/helix-run-prune <run-id>` removes a structural run directory only after TUI
  confirmation. It does not guess ownership of retained worktrees or private
  checkpoints.

A hard process stop can leave events or a journal record newer than the last
scheduler checkpoint. Resume treats the checkpoint and its exact workspace
snapshot as the commit point, discards only the uncommitted suffix, and refuses
truncation, corruption, task drift, workflow drift, runtime drift, account
drift, missing snapshots, wrong repositories, or worktree ownership mismatch.

## Models and settings

- `/helix-models` shows structural cast presets and the available inventory.
- `/helix-chains` shows tracked compatibility inputs; chains are not a second
  runtime engine.
- `/helix-profiles` manages saved cast overlays.
- `/helix-setup` builds an exact per-stage cast from Pi's current inventory.
- `/helix-settings` opens keyboard toggles for multi-model, loops,
  autoresearch, context engine, worktrees, and visual cues.
- `/helix-research …` preflights the existing attended metric loop. It remains a
  separate product command while its historical records stay readable.

Explicit effort is checked before execution and again at the runtime boundary.
`default` and `provider-managed` are intentionally not claims of a specific
effective effort. A requested exact effort requires response, deployment, or
session evidence appropriate to that provider.

## Provider states

Helix distinguishes installed, configured, entitled, exact-capable, and
live-certified. Configuration is not entitlement; requested values are not
effective identity. Uncertified paths are visible as exact-disabled and produce
zero provider calls. See [providers.md](providers.md).

The Pi adapter uses fresh in-memory sessions. The current executable exact path
is OpenRouter: preflight requires one active ZDR/tool-capable route, binds the
Pi-synced API-key account, displays the route and account reference for consent,
and audits every streamed call through a session-local `127.0.0.1` proxy. A
route/account change before execution refuses without creating a run. Official
Anthropic, OpenAI Responses, Codex Business/Enterprise, GitHub Copilot,
Foundry Claude, and Azure OpenAI adapter contracts are installed but remain
exact-disabled until a short-lived capability attestation proves every required
field. CLIProxyAPI and Anthropic consumer OAuth are policy-blocked.

## Security and limits

Workflows are closed JSON; conditions cannot execute code. Command gates are
bounded argv vectors with `shell: false`. File paths are contained and exclude
`.git`. Definitions cap nodes, effects, map cardinality, pipeline width,
concurrency, visits, retries, runtime, call time, and serialized bytes. Raw
tasks, credentials, provider bodies, and private outputs are never rendered by
run views. Private checkpoints cap file count, individual bytes, and total
bytes and refuse special files.

Pi tools and objective commands retain the user's local authority. Worktrees
are Git-state isolation, not an OS sandbox. Read-only agents do not receive
mutation tools; mutating effects use checkpoint-backed transactions.

Helix installs no arbitrary context-percentage compaction hook and keeps the
selected runtime's default compaction policy.

## Verification

Deterministic gates:

```sh
npm test
npm run check:resources
npm run check:docs-truth
npm run check:no-live-egress
npm run check:public-safety-diff
npm run check:workflow-conformance
npm run check:provider-contracts
npm run check:package
```

`bash tools/lockdown/no-egress-smoke.sh --active` performs the enforcing Docker
proof with `--network none`. `tools/ci/run-node-matrix.sh` requires explicit
preinstalled Node 22 and Node 26 binary paths and performs no installation.

Live certification is opt-in and never substitutes a model, route, or account:

```sh
HELIX_LIVE_TESTS=1 \
HELIX_LIVE_PROVIDER=openrouter \
HELIX_LIVE_MODEL='<exact-free-model>' \
HELIX_LIVE_ROUTE='<exact-provider-route>' \
HELIX_LIVE_EXPECTED_ACCOUNT='<opaque-account-handle>' \
npm run test:live:provider-certification
```

The provider credential must already be available to that explicit tool. The
model must be a `:free` route. Missing configuration is a refusal, not a skip or
a fallback to a paid/different path.
