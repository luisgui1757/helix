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
v4 kernel from an independent identical disposable worktree in each execution
mode. It refuses unless complete normalized results match: status, output,
visits, budgets, ordered structural trace, journal structure, and final
workspace fingerprint. Only mode/run/time-derived identity fields are removed.
The deterministic candidate writes any synthetic artifact inside its counted
transaction; verification hashes the actual file and the authored objective
checker executes read-only against the worktree. Command checkers use the same
network-denied OS sandbox as named runs, receive no ambient credential
variables, see only admitted runtime/candidate evidence plus a self-contained
current-snapshot Git database, and can write only private ephemeral scratch
space. Host Git history, object storage, and physical candidate `.git` metadata
are absent in both ordinary and linked worktrees, even when the checker is an
executable beside the candidate. External executables are admitted exactly;
command/dependency/runtime paths intersecting physical Git metadata and
ancestor read roots refuse, including a linked worktree's shared common Git
directory. Host fingerprinting uses fixed, configuration-sterile Git with
replacement refs disabled and no worktree-to-Git conversion. It reads indexed
metadata and hashes bounded contained physical tracked/untracked bytes, so
repository clean/process filters cannot execute; symlink text is never
dereferenced and non-regular entries remain structural. Linux uses only fixed trusted containment helpers and isolates IPC as well as network/process state. Before/after workspace fingerprints must match;
named and staged execution additionally restores from a private snapshot on
detected drift. Cancellation waits for confirmed process-group closure before
final evidence. Sandbox, termination, cleanup, fingerprint, or restoration
uncertainty is a typed structural failure and cannot take an authored fail edge.
The same is true for pre-abort, timeout, spawn/process failure, and malformed
staged gate results; only an actual zero/nonzero checker exit yields pass/fail.
macOS and Linux are the supported command-gate boundaries; other platforms fail
closed at preflight.
It reports that one path and never claims every branch or real model/task
objective passed.

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
The pure API in `dispatch/workflow/builder.mjs` produces the same validated JSON.
Its fragment combinators cover sequence, conditional, bounded
evaluator/optimizer, fan-out/reduce, and explicit namespaced composition;
Helix does not execute the program that generated it. Combinator input is
descriptor-safe bounded JSON: accessors, proxies, cycles, excessive depth, and
executable values refuse without invocation. The exact canonical UTF-8 byte
limit is checked before structured cloning author input.

## Run, watch, and recover

`/helix-run [workflow-id] [--execution-mode original-mode|graph-mode] -- <task>`
resolves the graph, current profile,
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

Omitting the flag selects `original-mode`. `graph-mode` is opt-in and changes
only transition lookup: a canonical typed graph resolves the same admitted v4
edges inside the same kernel. Unknown, duplicated, missing, or misplaced mode
arguments refuse before consent or run creation. Preflight, confirmation,
completion, list/status, and watch show the mode. Graph transitions additionally
record stable edge id/kind. The selected mode is execution-bound and cannot be
changed on resume; legacy schema-4 public run state means `original-mode` but is
history-only for continuation. New original-mode scheduler checkpoints use
schema 4; graph-mode uses schema 5 with explicit mode. Both bind the exact
canonical event-prefix ref. Scheduler schemas 1/2/3 remain inspectable history
but cannot resume. A caller-supplied runtime hash, altered retained event, or
cross-mode checkpoint cannot authorize continuation.

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
counted. A success settling after cancellation, the run deadline, or its call
timeout retains valid usage but cannot commit or advance; mutation rolls back
to the exact before-state. Malformed usage fails, and resume cannot raise the definition's
effect/token/cost ceilings.
The whole-run deadline is cumulative: elapsed time is stored in the private
checkpoint, and continuation receives only the remaining duration. Historical
scheduler schemas 1/2/3 can still be inspected, but named kernel continuation
refuses them because they contain no authenticated event prefix; schema 1 also
has no trustworthy elapsed lifetime. A deadline
is rendered as a timeout; only an external/operator abort is rendered as
operator cancellation. An internal fan-out stop retains the decisive branch
failure and cannot be rendered as an operator action merely because a sibling
observed the stop.

- `/helix-runs` lists structural records.
- `/helix-run-status <run-id>` shows one structural record.
- `/helix-run-watch <run-id>` validates the pinned definition, lifecycle
  snapshot, pinned direct-child definitions, state, closed event schema, and
  graph before rendering stable node ids, typed planned edges, exact traversals,
  parent/child current and last positions, visits, effects, gates, mode, and
  terminal state. Nonempty parent/child streams require their exact first
  binding, contiguous run/sequence identity, and closed fields per event kind.
  Unknown/extra fields, wrong definition hashes, invalid statuses, mode drift,
  child ids outside the parent run/node/visit namespace, a parent advancing
  before its child succeeds, contradictory gate finality/results, effects on
  non-effect nodes, unmatched or reused attempts, retry/repair controls beyond
  the authored ceilings, a missing or contradictory effect-plan, omitted
  agent/pipeline/parallel/map slots, overlapping pipeline stages, panel-member
  gaps, uncontrolled later attempts, disallowed final agent failures,
  duplicate completion of an already-closed retained effect, loss of a retained
  child terminal on the same parent visit, open effects, run-end/terminal disagreement, public completion drift, or
  graph-mode transitions without exact edge identity refuse. A successful run
  must record the authored final-gate pass and matching succeeded terminal. A
  complete failure is watchable through an exact failed/refused/cancelled
  run-end at its current node; it cannot claim authored success.
  Historical schema-4 subworkflow wrappers remain watchable as opaque
  original-mode parent progress; schema-5 runs require pinned child definitions
  for nested projection. Later edits cannot rewrite history.
- `/helix-run-resume <run-id>` is attended for v4 runs. It asks for the original
  task and declared typed inputs, verifies their hash, reloads the pinned definition, revalidates policy and
  exact cast, restores the retained worktree from the last private bounded
snapshot, reconciles any provable journal-ahead result, and resumes completed
effects without replaying them. A journal-ahead result emits explicit recovered
effect evidence; it is not disguised as a resume of a public start that was
never durable. Closed terminal checkpoints return their recorded outcome
without executing a node or provider again. The same recorded outcome is
returned by the completing call even if operator cancellation arrives while
the successful terminal-checkpoint write settles. Cancellation or the whole-
run deadline is rechecked after every fresh or resumed active node entry; when
observed before terminal publication it wins instead. A committed failed,
refused, or authored-cancelled terminal keeps
  its recorded status/code in the fresh-run response, state, and watch view; an
  outer command timer cannot relabel it. Completed public state is projected
  inside that terminal checkpoint transaction. A failed projection retains
  explicit private debt; attended resume reconstructs the exact terminal from
  the authenticated marker before provider or worktree effects. Journal evidence must bind the exact
parent or child run namespace; older journal schemas remain readable but cannot
prove an active continuation. The retained event prefix must match its rolling
canonical ref before provider certification, worktree restoration, truncation,
or other effects. Each nested child ref is derived from the authenticated parent
wrappers. Public count/ref authority advances only with the committed private
checkpoint. The event path must be a regular non-symlink file at most 64 MiB;
an uncheckpointed file suffix is ignored by watch and removed only
during authenticated resume. Event and journal counts are safe, nonnegative
cardinalities at discovery, watch, resume preflight, and continuation. They
cannot lead the private scheduler; documented projection debt may lag and is
repaired before provider certification. Nonterminal private state requires an
incomplete public projection. Private terminal state requires explicit schema-2
projection debt, and an already-completed public projection under that debt
must exactly match the private terminal's status, code, and node. That matching
case is a maintenance retry that clears debt before provider certification;
all other cross-document combinations refuse before writes. Completed runs
are a no-op. Historical staged
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
same explicit resume action. A failure before the first checkpoint remains an
incomplete, nonresumable initialization record; it never claims completed
checkpoint authority or advertises resume, but watch can still render its empty
committed prefix.
- `/helix-run-prune <run-id>` removes a structural run directory only after TUI
  confirmation. It does not guess ownership of retained worktrees or private
  checkpoints.

A hard process stop can leave a journal record newer than the last scheduler
checkpoint. Resume never destructively truncates that evidence: it reconciles
the suffix only against a durable in-flight/result identity and the exact
workspace fingerprint where mutation occurred. A missing or ambiguous outcome,
truncation, corruption, task drift, workflow drift, runtime drift, account
drift, missing snapshot, wrong repository, or ownership mismatch refuses.
Cancellation and deadlines also wait a bounded interval for provider/boundary
settlement so completed failed calls retain their actual lifetime usage. If the
boundary remains live, the run stays nonterminal with an unknown outcome; no
`run-end` or terminal checkpoint is manufactured, and an in-flight provider
intent is not replayed.
Objective commands also checkpoint a run/node/visit/objective identity before
launch and a closed result before routing. An unconfirmed or in-flight gate is
reported again from that private state on resume; the command is never relaunched.
Terminal projection repair first passes the scheduler's complete resume
admission for the exact task, runtime cast, mode, immutable budget, journal
prefix, authored terminal, and final event pair. A refusal does not rewrite the
event file, public state, or private debt marker.
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
not create it. Runtime smoke executes the authored deterministic gate against
the disposable workspace rather than selecting a preferred route. Both modes
start from one exact replacement-disabled commit. Before worktree registration,
one immutable raw manifest bounds the full tree's object ids, modes, byte paths,
prefix relations, per-entry and aggregate bytes, and file count. Raw blob
materialization and physical fingerprinting preserve POSIX path/symlink bytes
without executing repository filters, hooks, fsmonitor, or ambient Git
configuration. An incapable filesystem refuses before registration; cleanup
preflight proves that capability by materializing, byte-enumerating, and
removing the complete raw path/type skeleton, exact regular-file executable
bits, and exact symlink payloads, not by inferred Unicode case/normalization
rules. Cleanup preserves the recovery root unless every Git registration and
every lexical/physical checkout identity derived from the scratch root is
confirmed absent from the filesystem. Objective-sandbox setup attempts and
verifies scratch cleanup after every post-creation refusal; cleanup failure is
reported exactly, and an opened workspace guard is rolled back even when
preparation throws.

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
active ZDR endpoint with the required token/reasoning parameters for the exact
model, endpoint tag, provider, and quantization, displays the route and account
reference for consent, pins the tag and quantization, and audits the request and
streamed identity through a session-local `127.0.0.1` proxy. Exact real Pi
execution is one read-only, tool-free provider turn with transport retries
disabled; tool-bearing or mutating real definitions refuse before credential
or provider-control access. Response and generation model/provider observations must both
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

Pi tools retain the user's local authority; command objective gates instead use
the fail-closed OS sandbox described above. Worktrees by themselves are
Git-state isolation, not an OS sandbox. Read-only agents do not receive mutation
tools; mutating effects use checkpoint-backed transactions.

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
requires all Helix commands to be discovered, then imports the extracted
adapter and exercises its real default Pi AgentSession factory through the
localhost audit proxy and a deterministic in-memory upstream. The proof requires
the exact pinned request, one provider turn, usage, response/generation identity,
attestation, and exactly one attempt for a retryable fixture failure, with no
provider-service call. It runs across the complete Node
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
