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
definition-ordered. Every actual model invocation is a budgeted, journaled
effect; multi-member panels reserve the complete first wave atomically before
dispatch, then journal each member and retry independently. Resume reuses
completed member attempts before reserving only the unfinished first wave.
Agent failures carry an explicit scheduler-recognized class; authored allowlists
can settle only that class, never kernel-owned integrity or recovery failures.
One run abort signal propagates through nodes, provider calls, objective commands, and
workspaces. Scheduler-owned races bound even a non-cooperative injected gate,
artifact, checkpoint, or child-resolution promise; child workflows receive the
parent abort signal. The elapsed run deadline is checkpointed and cumulative
across pause/interruption continuations. Read-only work may overlap; mutating
work enters one writer queue.

Every model effect identity binds the workflow hash, node/attempt/invocation,
canonical inputs/upstream outputs, runtime/cast ref, tool and mutation policy,
and current workspace fingerprint. Before a provider call, the scheduler
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
that boundary return stable kernel failures rather than throwing.

The private checkpoint's atomic install is the scheduler commit point.
Old-snapshot cleanup and public-state projection run afterward as explicit
maintenance fields in checkpoint document schema 2. Failure in either phase
leaves conservative durable debt for the next checkpoint; it never rewrites an
already-published scheduler checkpoint as an undurable failure. Schema-1
documents remain readable and acquire the maintenance fields on their next
successful write.

At resume, Helix requires the original task and fresh consent/runtime evidence.
It verifies task hash, pinned definition/version, subworkflow closure, policy,
profile/toggles/presets, cast, runtime ref, repository, owner ref, event prefix,
journal prefix, and snapshot. A journal suffix newer than the checkpoint is
preserved and accepted only when every suffix identity maps to durable pending
or in-flight state in the complete parent/child checkpoint tree; extra or
conflicting evidence is terminal drift. Every loaded result is re-hashed and
its status must match its journal record. Completed attempts and reconciled
read-only results are not re-executed. Mutating reconciliation additionally
requires the recorded workspace fingerprint. Corrupt, missing, stale,
ambiguous, or mismatched state refuses.

Checkpoint nodes use the same mechanism: the first encounter pauses; an
attended resume is a one-shot continue action bound to the recorded visit.
Revisiting the same node requires fresh consent. Child checkpoint state is
stored under its parent node and child-run namespace, so one attended resume
continues exactly that checkpoint. Version-pinned subworkflows share parent
budget, journal, cancellation, and canonical workspace, have depth one, and
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
provider route.

The Pi AgentSession adapter is the installed broad-provider discovery path, but
real product execution additionally requires an exact provider certificate.
OpenRouter currently satisfies that contract by binding Pi's configured API-key
account, selecting one active ZDR/tool-capable route, injecting Pi's native
`openRouterRouting` controls, and auditing every streamed call through a
session-local `127.0.0.1` byte-forwarding proxy. Consent binds the certificate;
drift refuses before run-directory creation. The adapter parses only one
complete closed JSON object. Unsupported provider/account proof remains
exact-disabled rather than being renamed “connected.”

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
