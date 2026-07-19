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
and performs provider-free schema checks plus deployment preflight. V4 edges
are reported as structurally validated, not executed. In TUI mode, `test` may
also normalize the definition and run one deterministic path through the real
v4 kernel in an isolated disposable worktree. It reports only observed
nodes/effects/transitions and never claims every branch or the user's task
succeeded.

`/helix-workflows import <repository-relative-v4.json>` is the expert deploy
surface. It requires attended confirmation, a regular contained JSON transport
file no larger than 512 KiB, schema version 4, `source: "user"`, a runnable objective gate, a
closed single-gated graph, deployment-valid assignments, a non-conflicting id,
and an atomic destination. All structural, deployment, gate, and workspace
checks pass before the user definition is written. Its canonical representation
must fit 256 KiB; Helix persists that canonical form plus one newline.
Pi's current model inventory is supplied to import/create preflight, including
every pinned direct child's cast; invalid or undeployable input refuses before
the mutation confirmation dialog.
The pure API in `dispatch/workflow/builder.mjs` produces the same validated JSON;
Helix does not execute the program that generated it.

## Run, watch, and recover

`/helix-run [workflow-id] -- <task>` resolves the graph, current profile,
feature toggles, cast, exact provider/model/effort/route/account requirements,
objective gate, worktree, concurrency, and deadlines. Print/RPC modes stop at
preflight. TUI mode requires confirmation and rechecks the complete binding
before creating the run or contacting a provider. Every declared non-task input
is editable: blank accepts a declared default, omits an optional value, or
refuses a required value without a default. String inputs preserve spaces and
accept `""` as an explicit empty string. The complete object is validated before
run creation and bound into the resume identity. Consent lists bound input
names, not their values, and includes every pinned direct child's effective
cast. Named workflows require canonical worktrees; disabling the worktree
feature produces a pre-consent refusal rather than changing the approved
mutation location.

Every kernel-compatible named workflow, including legacy saved definitions and
tracked built-ins, normalizes into WorkflowDefinition v4 and runs through the
same kernel. A legacy definition that declares host-only check/handoff steps
refuses migration rather than silently dropping them. The
kernel reserves effects, propagates cancellation, serializes shared writers,
promotes isolated proposals only from an unchanged base, records an append-only
effect journal, and permits success only through the final objective gate.
The final node has no second objective: it executes the top-level
`objective_gate`, and the successful terminal has no other incoming edge.
Every candidate, panel member, and retry is one independently budgeted and
journaled model effect; structured-output repairs are additional counted
effects and stop at the definition's declared repair ceiling. A panel cannot
start unless its whole first wave fits. Valid usage from a failed call is still
counted, malformed usage fails, and resume cannot raise the definition's
effect/token/cost ceilings.
The whole-run deadline is cumulative: elapsed time is stored in the private
checkpoint, and continuation receives only the remaining duration. Historical
schema-1 checkpoints can still be inspected, but named kernel continuation
refuses them because they contain no trustworthy elapsed lifetime. A deadline
is rendered as a timeout; only an external/operator abort is rendered as
operator cancellation.

- `/helix-runs` lists structural records.
- `/helix-run-status <run-id>` shows one structural record.
- `/helix-run-watch <run-id>` validates the pinned definition, lifecycle
  snapshot, state, event sequence, and graph before rendering stable node ids,
  visits, effects, gates, and terminal state. Later workflow edits cannot rewrite
  history.
- `/helix-run-resume <run-id>` is attended for v4 runs. It asks for the original
  task and declared typed inputs, verifies their hash, reloads the pinned definition, revalidates policy and
  exact cast, restores the retained worktree from the last private bounded
  snapshot, reconciles any provable journal-ahead result, and resumes completed
  effects without replaying them. Completed runs are a no-op. Historical staged
  records remain validated and may still render their bound staged-run resume
  invocation; they are compatibility records, not a second named-workflow
  engine.

A normal checkpoint is rendered as **paused**, not failed, and includes the
exact `/helix-run-resume <run-id>` continue command. That attended consent is
consumed by the exact recorded node visit; revisiting the checkpoint pauses
again. Checkpoints inside a pinned child workflow carry namespaced child state
and consume the same one-shot parent-resume consent.
Workspace, journal, or scheduler-checkpoint recovery failures with a durable
private checkpoint remain incomplete and render as **interrupted** with the
same explicit resume action. A failure before the first checkpoint is terminal
and never advertises resume.
- `/helix-run-prune <run-id>` removes a structural run directory only after TUI
  confirmation. It does not guess ownership of retained worktrees or private
  checkpoints.

A hard process stop can leave a journal record newer than the last scheduler
checkpoint. Resume never destructively truncates that evidence: it reconciles
the suffix only against a durable in-flight/result identity and the exact
workspace fingerprint where mutation occurred. A missing or ambiguous outcome,
truncation, corruption, task drift, workflow drift, runtime drift, account
drift, missing snapshot, wrong repository, or ownership mismatch refuses.
The scheduler also admits aggregate results before they enter durable state.
Its payload is capped below the private checkpoint envelope, and journal writes
enforce the same 8 MiB limit as journal reads. If a valid individual result
would exhaust the reserved compact-failure headroom, the attempt becomes the
stable `kernel-result-capacity-exceeded` result; mutation is rolled back, the
compact record remains reopenable, and continuation does not repeat the call.
Resume also validates every completed result against its exact journal identity,
the active node visit, recursively nested child state, and immutable lifetime
budget before execution continues.

Each agent call receives the validated `tracked-step-v1` prompt contract,
declared output schema, exact tool allowlist, mutation mode, artifact contract,
visit, attempt, and run namespace. A returned RoleEnvelope must agree with that
identity and status. Deterministic mock workflows preserve the same counted
agent boundary; artifact verifiers and objective gates observe evidence but do
not create it.

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
is OpenRouter: preflight binds the provider-issued creator account, requires one
active ZDR/tool-capable endpoint for the exact model, endpoint tag, provider,
and quantization, displays the route and account reference for consent, pins the
tag and quantization, and audits every streamed call through a session-local
`127.0.0.1` proxy. Response and generation model/provider observations must both
match their documented contracts: the streamed response model is mandatory,
optional route metadata cannot drift, and generation model/provider proves the
endpoint. A
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
run views. Private checkpoints accept at most 16,384 regular files, 16 MiB per
file, and 64 MiB total; exact boundaries are accepted and one-byte/file-over
inputs refuse. Workspace proposal copies use those same exported constants.
The complete workflow/input ceilings are listed in
[the workflow guide](workflows.md) and checked from the runtime constants.
Special files refuse.

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

Local `check:package` verifies the extracted artifact structurally. CI passes
`--pi-bin node_modules/.bin/pi`, loads that extracted artifact through Pi RPC,
and requires all Helix commands to be discovered across the complete Node
22.19/26 and Pi 0.80.7/0.80.9 compatibility matrix. One aggregate `test` check
requires every matrix leg.

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
