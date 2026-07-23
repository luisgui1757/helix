# Architecture

Helix has one product workflow engine: the Helix Workflow Kernel (HWK).

```text
guided UI / v1 compatibility / v4 JSON / pure builder
                         |
                         v
             WorkflowDefinition v4 validator
                         |
                         v
 canonical typed graph compiler + selected transition resolver
          original-mode | graph-mode (one scheduler)
                         |
                         v
 scheduler -> budget -> runtime effect -> workspace transaction -> journal
                         |
                         v
           deterministic final objective gate
```

`extensions/helix-command.ts` owns Pi UI, onboarding, attended consent, and
run/watch/resume commands. `extensions/lib/helix-command-core.mjs` is the
Pi-runtime-free rendering/preflight boundary. `dispatch/workflow` owns the
closed IR, migration, pure constructors/fragments, conditions, hashing, typed
graph compilation, analyses, routing, and graph views.
`dispatch/kernel` owns scheduling, effect attempts, budgets, cancellation,
workspace transactions, private checkpoints, and recovery. `dispatch/runtime`
owns volatile Pi/provider seams, policy, attestation, and protocol-specific
request/response identity checks.

Stable policy imports no UI or provider transport. Runtimes never choose graph
transitions. UI cannot fabricate readiness. The compatibility stage runner
remains only for historical records and research; named execution and optional
workflow runtime smoke both use HWK. `original-mode` reads admitted transition
fields directly; `graph-mode` resolves the corresponding canonical typed edge.
This is one engine with two transition resolvers, not a second runner or a
multi-ready-node dataflow scheduler.

At each parent or child scheduler entry, the validated definition is cloned
into deeply immutable run-owned data. Graph compilation, direct routing,
hashing, checkpoints, and execution all use that one copy. Injected expansion,
agent, gate, and artifact boundaries receive detached values, so an adapter
cannot mutate original-mode routing while graph-mode retains a compiled route.

## Definition and scheduling

WorkflowDefinition v4 is closed and byte-bounded. Reachability validation
requires exactly one successful terminal whose only incoming edge is the
unique final objective gate's `on_pass`. That node cannot carry a second gate;
the scheduler executes the top-level `objective_gate`, and terminal success
also requires recorded final-gate pass evidence. Cycles are explicit and
bounded. Conditions read safe JSON pointers and cannot execute user code.

The graph compiler sorts node ids canonically, preserves authored decision-edge
order, assigns stable edge ids such as `route:condition:0` and
`objective:pass`, and builds forward/reverse indexes plus edge-view-specific
reachability and strongly connected components. Canonical node ordering is
independent of JavaScript object insertion order so persisted, stable-key-sorted
definitions reconstruct the same lifecycle projection. Public projections
replace condition values with structural operator/path data and a hash.

The scheduler uses stable node/instance/attempt ids. Parallel and map output is
definition-ordered; instance and child-run ids also include the current node
visit so a later visit cannot collide with an earlier attempt. Every actual
model invocation is a budgeted, journaled
effect; multi-member panels reserve the complete first wave atomically before
dispatch, then journal each member and retry independently. Resume reuses
completed member attempts before reserving only the unfinished first wave.
Agent failures carry an explicit scheduler-recognized class; authored allowlists
can settle only that class, never kernel-owned integrity or recovery failures.
With abort policy, the first decisive failure stops workers from claiming more
indices; already-started effects settle, and every unused reservation is
released. The scheduler retains that first decisive result as the terminal
failure; a lower-index sibling stopped afterward cannot replace it with a
synthetic cancellation. Provider usage is a closed pair of nonnegative safe integers, and
every reservation, provider sum, and lifetime-total addition is checked before
state changes. Failed provider calls retain and durably account any valid usage;
malformed usage becomes a stable failure. Definition ceilings are immutable,
and caller-supplied or resumed budget state may report consumed overshoot but
cannot raise the original maximums.
Each child invocation receives a scoped ledger: its declared effect ceiling is
checkpointed locally while every reservation, consumption, and usage value is
also committed to the one shared parent lifetime ledger. A larger parent limit
cannot raise the child, a larger child limit cannot raise the parent, and a
fresh later child invocation gets a fresh local allowance without resetting
the parent total. Continuation recursively verifies that the child's effects,
tokens, cost, and reservations do not exceed the enclosing parent snapshot;
an inconsistent nested checkpoint refuses before any new invocation. The root
budget must independently cover the exact durable journal prefix plus every
checkpointed in-flight or completed invocation not yet present in that prefix,
so resetting every level together cannot reset lifetime accounting.
One run abort signal propagates through nodes, provider calls, objective commands, and
workspaces. After abort, the scheduler waits a bounded settlement window for a
provider, gate, artifact, checkpoint, or child-resolution promise so late usage
and the exact outcome remain durable. If a provider reports success only after
cancellation, the run deadline, or its call timeout won, valid usage is retained
but the semantic result remains the interruption/timeout; mutation rolls back
and no successful effect, transition, or objective observation follows. A boundary that still cannot confirm
settlement returns a nonterminal unknown outcome: it publishes no terminal
event/checkpoint, and a provider intent remains in flight rather than being
replayed. Child workflows receive the parent abort signal. The elapsed run
deadline is checkpointed and cumulative across pause/interruption continuations. Read-only work may overlap; mutating
work enters one writer queue. A mutating attempt computes its workspace-bound
identity only after entering that queue, and `begin` compares the captured
fingerprint with the snapshot it creates or reuses. A process-restart
generation collision therefore retakes stale crash residue instead of treating
it as the current rollback state.

Every model effect identity binds the workflow hash, node/attempt/invocation,
canonical inputs/upstream outputs, runtime/cast ref, tool and mutation policy,
current visit, declared artifact, and current workspace fingerprint. The
product prompt binds the tracked prompt contract, stage, visit, attempt,
iteration, exact run namespace, upstream/item/revision context, and artifact
summary. The RoleEnvelope response must repeat the complete requested and
effective identity and return a status and value valid for the declared output
schema. Before a provider call, the scheduler
consumes one effect and durably checkpoints an in-flight intent. After the call,
it checkpoints the validated result and any pending workspace finalization,
appends the matching journal record, then checkpoints that journal position.
This ordering lets continuation reconcile a journal-ahead read-only result
without another call. Mutating work may be reused only with its verified
workspace fingerprint; a rolled-back attempt is a failed invocation and any
retry consumes a new effect. An in-flight intent with no provable result refuses
as outcome-unknown instead of guessing or replaying. Recovery material is
finalized only after the durable result/journal checkpoints; cleanup failure is
checkpointed and retried idempotently on resume.

Objective gates use the same no-replay principle without pretending to be model
effects. Before launch, the active node checkpoints a gate identity bound to the
run, definition, node, visit, and objective. A closed pass/fail/error result is
checkpointed before routing. Resume reuses a settled result; an in-flight or
unconfirmed gate returns its durable unknown/error code without launching a
second command. If cancellation or the cumulative run deadline wins before a
gate settles, a late pass/fail is replaced by that interruption before the
result checkpoint, so it cannot become reusable after a later write failure.
Boundary identity drift refuses before events or callbacks.

Malformed `semantic-v2` or reviewer `verdict-v1` output may be repaired only by
another explicit invocation. Each repair consumes and journals a new lifetime
effect, is independently bounded, and stops at the definition's
`structured_repair_attempts` ceiling. There is no unmetered parser retry.

## Workspace model

Each run owns one canonical Git worktree with a deterministic branch and owner
ref. Named workflows require this policy and refuse before consent when the
worktree feature is disabled. `shared-serialized` effects checkpoint the exact
tracked, untracked, index, and file state outside Git objects before mutation.
Failure restores it and retains the recovery snapshot unless restoration is
verified.

`isolated-proposal` creates a disposable real Git worktree, copies a bounded
regular-file view of the exact canonical state, and runs the effect there.
Promotion requires the canonical fingerprint to remain unchanged. Tree copy or
promotion failure restores the private checkpoint. Proposal and before-state
material are deleted only after durable journal/checkpoint completion; failed
restoration preserves both and returns a non-maskable workspace refusal.
Symlinks, special files, oversized trees, conflicts, and ambiguous cleanup
refuse. This is Git-state isolation, not an OS sandbox.

## Recovery

The public state/event projection contains hashes and structural fields. Public
run-state schema 5 also binds `execution_mode`. Schema 4 remains readable as
legacy `original-mode`; graph-mode never masquerades as that shape. The mode is
part of graph-mode's execution binding. The kernel also derives a graph-specific
effective runtime ref even from a caller-injected hash. Original-mode retains
the historical runtime-ref input. New original-mode scheduler checkpoints use
schema 4; graph-mode uses schema 5 with explicit `execution_mode`. Both contain
the rolling canonical `event_ref`. Schemas 1/2/3 remain structurally readable
history but cannot authorize continuation, so unbound-prefix and cross-mode
resume refuse recursively for parent and child state. Resume derives the mode
from state and cannot override it. Graph-mode execution bindings sort preset and pinned-child identities by
Unicode code unit, independently of host collation. Original-mode retains its
legacy locale-aware binding order so historical hashes stay unchanged.
Recursive child admission uses the parent's expected runtime and task
bindings; a nested checkpoint cannot self-authorize those hashes. The private checkpoint contains scheduler outputs, visit counts, completed and
in-flight attempt state, cumulative elapsed time, journal length, budget usage,
event sequence, and the exact workspace snapshot ref—but not the raw task. A
closed checkpoint additionally records its exact terminal status/code. That
marker distinguishes durable completion from an active between-node snapshot,
so replay returns the recorded outcome without another node or provider call.
Observed parent and child streams are admitted only when their first event is
an exact start/resume binding for the pinned definition and execution mode.
Each event kind has closed required and optional fields; run identity and
sequence are continuous, and graph transitions carry an exact compiled edge.
Unknown fields, misplaced mode data, a wrong definition hash, or an unbound
child stream refuse instead of producing an authoritative-looking projection.
Child run ids are fixed by parent run/node/visit identity. Gate event finality
must match the pinned node and its result must agree with the following typed
transition. Effects are legal only on agent-bearing nodes. Completion and
resume close exact open references, while an effect already closed in the
retained prefix emits no duplicate completion. Instance ids cannot be reused, and schema-5
retry/repair controls identify the exact failed agent attempt and remain within
the authored agent/definition ceilings. Runtime expansion may narrow an
agent's retry policy but cannot raise it. Agent-bearing nodes emit a bounded
effect-plan count. Successful node-end evidence covers every logical slot,
ordered pipeline settlement, contiguous observed panel members, explicitly
controlled prior attempts, and final successful or authored-settled outcomes;
an empty map is represented by a zero-slot plan. A journal result ahead of the scheduler
checkpoint emits a distinct recovered-effect event because its public start was
not part of the durable prefix. A successful
parent subworkflow visit requires its derived child stream to end successfully
before the parent ends or transitions; the exact retained terminal remains
proof only for a continuation of that parent node and visit. A node or run cannot complete with open
effects. Successful run-end evidence must match the authored succeeded terminal
after a recorded final-gate pass. Every other complete post-start outcome is
terminalized at its current nonterminal node as failed, refused, or cancelled
and durably checkpointed. If the first checkpoint itself fails, the direct
scheduler may close its in-memory lifecycle, but product public state remains a
nonresumable initialization failure at the empty committed prefix rather than
claiming completed scheduler authority. A checkpoint-derived interruption is
resumable only when an earlier durable checkpoint exists.
Completed public state is admitted only when
its terminal status and code match that last run-end. The historical schema-4 child wrapper remains an explicit
opaque original-mode watch adapter; exact nested projection is schema-5-only.
Files and totals are bounded and streamed. Agent results and derived effect
inputs must also fit bounded canonical journal serialization; values outside
that boundary return stable kernel failures rather than throwing. Scheduler
state is admitted against a 15 MiB payload ceiling inside the 16 MiB private
checkpoint document envelope. The append-only effect journal is bounded to
8 MiB on both write and read. Both paths reserve 16 KiB for a compact terminal
failure, so aggregate accepted values become
`kernel-result-capacity-exceeded` before either durable format is unreadable.

The private checkpoint's atomic install is the scheduler commit point. Its
`event_seq` and `event_ref` bind the exact ordered parent/child wrapper prefix,
not merely its length. Public state projects count/ref only after that private
commit; accepted JSONL events beyond it remain unauthoritative. Every bound
scheduler continuation requires an explicitly supplied exact prefix. Product
resume verifies the parent prefix and derives every nested child prefix from
its exact parent wrappers before provider certification, worktree restoration,
suffix truncation, or any other execution effect. Omission refuses before host
callbacks. Active schema-4 and schema-5 watch both render only the recorded
authoritative prefix and reject retained-prefix drift. A successfully written
terminal checkpoint is also the direct call's commit point. The scheduler
rechecks cancellation and the whole-run deadline after every fresh or resumed
active node-entry checkpoint and before publishing a terminal event pair. An
interruption observed there wins; after the terminal status/code pair and
marker are durably committed, later cancellation cannot replace the recorded
result. Product execution carries this terminal authority to the command
boundary so an outer timer cannot relabel a committed failed, refused, or
authored-cancelled run. The terminal checkpoint projects that exact completed
state before clearing maintenance debt. If projection fails, the private marker
retains debt and resume reconstructs the completed state from the authenticated
terminal before provider certification or worktree creation.
That repair is admitted by the scheduler itself, not by a product-local terminal
shortcut. The same validation binds task, definition, execution mode, runtime
cast, immutable budget, journal evidence, terminal semantics, and the exact
final `node-end`/`run-end` pair before any projection write.
Public event and journal cardinalities are safe, nonnegative integers at
discovery, watch, resume rendering, and continuation. A public count may lag
its private scheduler only while explicit projection debt is durable; it can
never lead, and resume repairs the projection and durably clears its debt marker
before provider certification. A debt-clear write failure refuses continuation
and leaves the conservative marker intact. The cross-document relation is
closed: nonterminal private state requires incomplete public state; private
terminal state requires schema-2 `public_projection_pending: true`; and an
already-completed public state under that debt must exactly match the private
terminal's status, code, and node. A matching completed projection is a
maintenance retry that clears debt and returns before provider certification;
every other relation refuses before durable writes.
Old-snapshot cleanup and public-state projection run afterward as explicit
maintenance fields in checkpoint document schema 2. Failure in either phase
leaves conservative durable debt for the next checkpoint; it never rewrites an
already-published scheduler checkpoint as an undurable failure. Scheduler
schemas 1/2/3 remain structurally readable for historical inspection, but
kernel continuation refuses them because they lack an authenticated event
prefix (and schema 1 also lacks trustworthy cumulative elapsed duration).

At resume, Helix first requires the event path to be a regular non-symlink file
no larger than 64 MiB. Helix then requires the original task and fresh consent/runtime evidence.
It verifies task hash, pinned definition/version, subworkflow closure, policy,
profile/toggles/presets, cast, runtime ref, repository, owner ref, event prefix,
journal prefix, and snapshot. A journal suffix newer than the checkpoint is
preserved and accepted only when every suffix identity maps to durable pending
or in-flight state in the complete parent/child checkpoint tree; extra or
conflicting evidence is terminal drift. An in-flight suffix record must match
its checkpointed run namespace, node, instance, base identity, and mutation
mode; an identity cannot move between parallel/map instances or between parent
and child schedulers. Journal schema 3 records the executing run namespace and
the effect base identity includes it. Schema 1/2 journal records remain readable
history but cannot reconcile active continuation state. Every loaded result is re-hashed and
its status must match its journal record. Every `active.completed` entry must
map to that exact journal identity; active visit state, visit counters, budget
totals, and nested child scheduler state are recursively validated before any
node runs. Completed attempts and reconciled
read-only results are not re-executed. Mutating reconciliation additionally
requires the recorded workspace fingerprint. Corrupt, missing, stale,
ambiguous, or mismatched state refuses.

Checkpoint nodes use the same mechanism: the first encounter pauses; an
attended resume is a one-shot continue action bound to the recorded visit.
Revisiting the same node requires fresh consent. Child checkpoint state is
stored under its parent node and child-run namespace, so one attended resume
continues exactly that checkpoint. Version-pinned subworkflows share the parent
lifetime budget, journal, cancellation, and canonical workspace, retain their
own local effect ceiling, have depth one, and
project child events—including transition target, edge identity, and mode—into
parent structural events. The run retains each pinned direct-child definition,
so watch can validate and render nested current/last progress without trusting
later catalog state. Child-definition artifacts are managed run companions and
use the same exact workflow-id/version filename grammar for write, read, watch,
and run discovery; they never appear as independent/corrupt records in list or
status. A child receives its own
definition id and objective at the prompt boundary, and its input schema must
accept the complete normalized parent input. Import, run preflight,
inventory checks, exact-runtime preparation, and consent resolve the same closed
direct-child bundle and complete effective cast.

## Runtime and identity

`dispatch/runtime/pi-runtime.mjs` is the only dynamic import seam for Pi and
accepts `>=0.80.7 <0.81.0`. AgentRuntime instances use a private WeakSet brand;
a matching `kind` string cannot forge one. Runtime resolution selects one exact
provider path and never falls back after refusal.
The seam selects the exported session-runtime contract by capability: the
supported 0.80.7 SDK uses an isolated in-memory AuthStorage/ModelRegistry pair,
while later compatible SDKs use ModelRuntime. Both construct the same exact
model and credential binding; product code does not branch on a guessed version.

A short-lived CapabilityAttestation separates requested and effective
provider/model/effort/route/account fields, per-field evidence grade, credential
class, policy state, certification state, session binding, and certification
key. Exact execution refuses requested-only evidence, account mismatch,
response/deployment substitution, expired policy, stale certification, or
unobservable fields before egress where possible and after response where only
the response proves identity. Exact mode always requires an opaque account
binding. Provider and model may be response-verified; effort is labeled
session-verified when the session configuration is the strongest available
evidence and is never promoted to response evidence by association.

Provider-specific adapters independently shape Anthropic Messages, OpenAI
Responses, Codex app-server, Copilot SDK, OpenRouter Chat Completions, Foundry
Claude, and Azure OpenAI calls. OpenRouter exact mode pins `only` and `order`,
sets `allow_fallbacks: false`, `require_parameters: true`,
`data_collection: "deny"`, and `zdr: true`, then verifies the returned model and
provider route. Its provider control-plane proof uses `/key`'s
`creator_user_id` as the account, selects exactly one active endpoint by model,
endpoint tag, provider name, supported parameters, and quantization, pins the
tag and quantization on the request, then verifies response and generation
identity: the streamed response model is mandatory, optional streamed route
metadata must not drift, and generation model/provider is the route proof.

The Pi AgentSession adapter is the installed broad-provider discovery path, but
real product execution additionally requires an exact provider certificate.
OpenRouter currently satisfies that contract by binding Pi's configured API-key
account, selecting one active ZDR route with the required token/reasoning
parameters, injecting Pi's native `openRouterRouting` controls, and auditing
the request and streamed identity through a session-local `127.0.0.1`
byte-forwarding proxy. Exact real Pi execution is one read-only, tool-free
provider turn with all Pi transport retries disabled. A real tool-bearing or
mutating definition refuses before credential/control-plane access until Helix
can own and journal every internal turn; deterministic mocks still receive the
validated tools and mutation mode. Consent binds the certificate; drift refuses
before run-directory creation. The adapter parses only one complete closed JSON
object. Unsupported provider/account proof remains
exact-disabled rather than being renamed “connected.”

Deterministic mock execution preserves the same effect boundary. A synthetic
artifact, when required by a mock candidate, is written inside that counted
adapter call. Artifact verification and objective gates are read-only evidence
observers and cannot create a successful artifact or convergence marker. The
runtime smoke uses those same candidate/observer boundaries and executes the
authored deterministic gate against each disposable worktree. Both modes bind
one exact replacement-disabled commit. Before registering a worktree, one
immutable raw-tree manifest validates object ids, modes, byte paths, prefix
collisions, individual blob/symlink sizes, file count, and aggregate bytes with
checked arithmetic. Raw indexed blobs then materialize without checkout filters,
and bounded physical fingerprints do not invoke authored Git helpers or ambient
configuration. POSIX paths and symlink targets remain byte-exact. Before
registration, a disposable probe must materialize and enumerate the complete
raw path/type skeleton, round-trip every regular-file executable bit, verify
every symlink payload, and remove itself; no Unicode normalization/case
heuristic stands in for actual filesystem behavior.
Cleanup derives both identities from the existing scratch root, independently
removes and reconciles every checkout against Git and the filesystem, and
preserves the private recovery root on any uncertainty. Authored command
gates run with sanitized environment state, no network, a read-only candidate,
and only ephemeral scratch writes. Every refusal after scratch creation verifies
cleanup before returning; a preparation exception also rolls back an
already-opened workspace guard, and cleanup uncertainty takes precedence over
generic sandbox unavailability. macOS admits explicit
runtime/system/candidate read roots; Linux isolates user, mount, network, IPC,
and PID namespaces in a minimal read-only chroot. Both build a self-contained
credential-free Git database and writable private index from the admitted HEAD
tree plus staged index objects, capped at 64 MiB. The synthetic parentless HEAD
preserves current `git status` semantics without mounting the host object store,
history, remotes, or credential metadata. Exact
physical candidate `.git` metadata is excluded on macOS and masked inside the
Linux namespace, including ordinary-checkout directories and linked-worktree
pointer, per-worktree administration, and resolved shared common directories,
so an explicit `--git-dir` cannot bypass the private view. Exact
external checker files are mounted/admitted individually. Command, dependency,
and runtime paths must be disjoint in both directions from every physical Git
metadata path; a read root that contains the candidate also refuses. Linux
discovers `unshare`, `mount`, `chroot`, and `setpriv` only below fixed trusted
system/Nix roots and installs the metadata mask after external read binds.
The Ubuntu 24.04 CI matrix uses
[Canonical's documented one-boot AppArmor setting](https://discourse.ubuntu.com/t/ubuntu-24-04-lts-noble-numbat-release-notes/39890)
on its ephemeral runner, then proves the exact `unshare` namespace boundary
before running tests. The matrix fails rather than treating an unavailable
production sandbox as a skipped test.
Nix closure discovery uses a private home/configuration and fixed helper path
against the local daemon store with plugins, substituters, and builders
disabled; ambient Nix remotes, credentials, configuration, and `PATH` have no
host-preparation authority. Host fingerprint and private-view discovery use a fixed Git binary, closed
configuration environment, and disabled replacement refs. Fingerprinting never
runs Git content conversion: it combines indexed metadata with descriptor-safe,
byte-bounded physical tracked/untracked entries, so clean/process filters cannot
execute. Symlinks hash only target text and non-regular entries become
structural markers. Pre-registration filesystem proof includes every
byte-preserving parent and regular-file `realpath` operation required by that
fingerprint; a filesystem/runtime pair that cannot preserve it refuses before
worktree registration. Workspace fingerprints bind the observation, while named/staged execution
restores from a private guard snapshot if any drift is detected. Timeout or
cancellation waits for the contained process group to close before cleanup,
fingerprint, restoration, or evidence finalization. If termination is not
confirmed within the bound, Helix preserves scratch/guard material and returns
a typed structural failure. Sandbox, fingerprint, cleanup, and restoration
uncertainty use the same non-routable boundary. Pre-abort, timeout, spawn
failure, process error, and malformed staged gate outcomes are typed errors;
only a genuine checker exit may produce an authored pass/fail edge. Unsupported
sandbox boundaries refuse before command execution.

Structural event publication is also an execution boundary, not telemetry.
Failure to persist any run, node, effect, gate, child, retry, or transition event
stops advancement. Terminal checkpoint publication occurs only after the exact
terminal node/run pair is admitted. Every checkpoint binds a rolling canonical
event-prefix ref; resume validates it before truncation and truthfully re-emits
work after that prefix, while watch ignores an uncheckpointed suffix.

## Content and privacy

Prompt inputs are classified as trusted policy, operator task, repository data,
or agent output. Repository and agent content is framed data and cannot alter
tools, casts, budgets, transitions, or gates. Structured role envelopes drive
decisions; unstructured verdict extraction is forbidden.

Raw tasks remain in memory. Public run views never render prompts, responses,
provider bodies, account handles, credentials, or private workspace data.
Private transcripts are off by default. Package resources are immutable;
mutable state is root-confined below the Helix state directory.

Helix adds no percentage-triggered compaction. Each selected runtime retains its
native default compaction behavior.
