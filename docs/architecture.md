# Architecture

Helix has one product workflow engine: the Helix Workflow Kernel (HWK).

```text
guided UI / v1 compatibility / v4 JSON / pure builder
                         |
                         v
             WorkflowDefinition v4 validator
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
closed IR, migration, pure constructors, conditions, hashing, and graph views.
`dispatch/kernel` owns scheduling, effect attempts, budgets, cancellation,
workspace transactions, private checkpoints, and recovery. `dispatch/runtime`
owns volatile Pi/provider seams, policy, attestation, and protocol-specific
request/response identity checks.

Stable policy imports no UI or provider transport. Runtimes never choose graph
transitions. UI cannot fabricate readiness. The compatibility stage runner
remains only for historical records and research; named execution and optional
workflow runtime smoke both use HWK.

## Definition and scheduling

WorkflowDefinition v4 is closed and byte-bounded. Reachability validation
requires exactly one successful terminal whose only incoming edge is the
unique final objective gate's `on_pass`. That node cannot carry a second gate;
the scheduler executes the top-level `objective_gate`, and terminal success
also requires recorded final-gate pass evidence. Cycles are explicit and
bounded. Conditions read safe JSON pointers and cannot execute user code.

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
workspaces. Scheduler-owned races bound even a non-cooperative injected gate,
artifact, checkpoint, or child-resolution promise; child workflows receive the
parent abort signal. The elapsed run deadline is checkpointed and cumulative
across pause/interruption continuations. Read-only work may overlap; mutating
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

The public state/event projection contains hashes and structural fields. The
private checkpoint contains scheduler outputs, visit counts, completed and
in-flight attempt state, cumulative elapsed time, journal length, budget usage,
event sequence, and the exact workspace snapshot ref—but not the raw task.
Files and totals are bounded and streamed. Agent results and derived effect
inputs must also fit bounded canonical journal serialization; values outside
that boundary return stable kernel failures rather than throwing. Scheduler
state is admitted against a 15 MiB payload ceiling inside the 16 MiB private
checkpoint document envelope. The append-only effect journal is bounded to
8 MiB on both write and read. Both paths reserve 16 KiB for a compact terminal
failure, so aggregate accepted values become
`kernel-result-capacity-exceeded` before either durable format is unreadable.

The private checkpoint's atomic install is the scheduler commit point.
Old-snapshot cleanup and public-state projection run afterward as explicit
maintenance fields in checkpoint document schema 2. Failure in either phase
leaves conservative durable debt for the next checkpoint; it never rewrites an
already-published scheduler checkpoint as an undurable failure. Schema-1
documents remain structurally readable for historical inspection, but kernel
continuation refuses them with `kernel-checkpoint-elapsed-unknown`: they do not
contain the cumulative elapsed duration needed to enforce the lifetime
deadline truthfully.

At resume, Helix requires the original task and fresh consent/runtime evidence.
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
project child events into parent structural events. A child receives its own
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
observers and cannot create a successful artifact or convergence marker.

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
