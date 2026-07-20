# Workflow architecture assumptions and rejected findings

Append-only provider, policy, and architecture ledger.

## 2026-07-16

Assumptions requiring periodic revalidation:

- Provider policy entries expire on 2026-08-15. Expiry exact-disables new
  sessions until official documentation is reviewed again.
- Pi `>=0.80.7 <0.81.0` is the supported volatile runtime range. Changed public
  exports or response identity fields require a seam/matrix update.
- OpenRouter's official request fields remain `only`, `order`,
  `allow_fallbacks`, `require_parameters`, `data_collection`, and `zdr`; the
  returned `provider` remains the route evidence required by exact mode.
- Pi's OpenRouter stream continues to carry model and provider identity in raw
  SSE chunks even though AgentSession omits the route. The localhost audit proxy
  exact-disables the path if that wire evidence disappears or changes shape.
- Account handles must come from official session/status evidence. A configured
  credential or caller-copied label is not entitlement proof.
- Account handles are not filesystem paths: provider-issued repeated dots are
  valid, while whitespace and control characters remain invalid. Raw handles
  stay memory-only; durable records carry only attestation references.

Rejected findings / false alarms:

- “Adopt a dynamic-workflows package as the kernel”: rejected. Neither package
  simultaneously preserves Helix exact multi-provider binding, effect-aware
  workspace recovery, and current operator UX. No source or fixtures from the
  unlicensed Michaelliv repository were copied.
- “Use CLIProxyAPI as the provider spine”: rejected. Pool rotation, aliases,
  fallback, account invisibility, and protocol translation violate exact tuple
  and instruction-boundary invariants.
- “Build on Claude Agent SDK/Workflow JavaScript”: rejected as the global
  substrate because it cannot satisfy the required provider breadth. It remains
  a possible future Claude-specific runtime beneath the same kernel.
- “A Git worktree is an OS sandbox”: rejected. Documentation consistently calls
  it Git-state isolation and leaves tool/process authority explicit.
- “Requested model/effort proves effective identity”: rejected. Requested-only
  evidence exact-disables the path.

## 2026-07-18

New durable invariants:

- The top-level `objective_gate` is the sole final objective authority. A final
  gate node contains routing only; no other node field may target the succeeded
  terminal, and terminal/resume success requires its recorded pass evidence.
- V4 definition checks distinguish structurally validated edges from edges
  actually observed in a kernel run. One deterministic smoke path is not branch
  coverage and is never presented as such.
- A standalone live-certification proof is not ambient product authorization.
  `require_live_certification: true` refuses before provider preflight unless
  the selected adapter can present current live-certified evidence.

Rejected findings / bounded false alarms:

- “Stock templates currently bypass the final gate”: rejected. Their v1-to-v4
  migration already produced a single-gated graph. The defect was reachable
  through supported native-v4 import and programmatic construction, so the
  validator/runtime fix was still mandatory.
- “The first full-suite deadline failure proves a scheduler regression”:
  rejected after the unchanged test returned the correct timeout code, passed
  alone in 1.23s, and passed in the next complete 647-test run. No timing
  threshold, test, or legacy runner behavior was changed.

## 2026-07-18 — Release-quality closure invariants

New durable invariants:

- Workspace application is not completion. Recovery material remains owned by
  the effect until the response, accounting, journal, scheduler checkpoint, and
  workspace snapshot are durable; cleanup is an idempotent checkpointed phase.
  A failed restore never deletes the before-state or proposal.
- A private checkpoint's expected journal length is mandatory evidence. An
  absent or shorter journal is corruption, including when the state-root path
  contains spaces or non-ASCII characters.
- Every actual model invocation is one effect. Logical roles and panels cannot
  aggregate provider calls beneath one reservation or journal identity. Resume
  reuses completed panel members before atomically reserving unfinished members.
- Typed workflow inputs are a closed execution contract, not documentation.
  They validate before run artifacts and are hash-bound across resume.
- Child continuation state is namespaced by parent node and child run id.
  Comparing bare node ids across workflow namespaces is invalid.
- Named workflows have one mutation-location contract: the canonical per-run
  worktree. A disabled worktree feature refuses before consent; it does not
  silently select either the current checkout or a hidden worktree.
- Exact identity requires an observable opaque account and per-field evidence.
  Session evidence for effort is not response evidence, even when the same
  response independently proves its provider or model.
- Import means deployment-valid and write-atomic. Structural-only definitions
  may be inspected in memory but are never persisted with a successful import
  result.
- Cyclic edges are explicit. A decision default is a typed edge and requires a
  loop marker plus an escape before it may participate in a cycle.

Rejected findings / bounded false alarms:

- “A user who can edit Helix's private state can forge checkpoint evidence, so
  checkpoint documents need authentication before release”: rejected as a
  release defect. The private state root is within the operator's own trust
  boundary, and the same authority can directly edit the public run record.
  Authentication could detect accidental/external tampering only under a new
  key-management contract; it is not implied by the current local persistence
  model.
- “Always using a worktree is safe enough even when consent says worktrees are
  off”: rejected. Safer isolation does not make contradictory consent truthful;
  the canonical resolution is a pre-consent refusal for named workflows.
- “One panel is one effect because it is one logical role”: rejected. The
  documented ceiling bounds provider invocations, cost, cancellation, and
  replay, so each member and retry requires its own effect identity.

## 2026-07-18 — Effect reconciliation and composed-deployment invariants

New durable invariants:

- A provider call begins only after its invocation identity and lifetime effect
  consumption are durable in the scheduler checkpoint. Usage is accounted onto
  that same reservation after the response; it is never a second reservation.
- A journal suffix newer than the scheduler checkpoint is evidence, not debris.
  Continuation never truncates it. It reconciles one exact result to the durable
  inflight identity or refuses an absent, conflicting, or ambiguous outcome.
- A successful read-only result may be reconciled from its journal record. A
  mutating result is reusable only when its workspace transaction remains
  verifiable. Rolled-back incomplete mutation retries consume a new invocation.
- Stored non-success results are not completed work. Recoverable failures are
  cleared and retried when the incomplete transaction permits it; completed
  successful results and panel members are reused without new reservations.
- Failure authority is structural. Only outcomes explicitly classified as
  agent failures can be retried or allowlisted; stable-code spelling is not a
  substitute for a closed failure class.
- Deployment preflight is compositional. A parent and every pinned direct child
  form one effective cast for inventory, effort, account, certification,
  provider display, consent, and import atomicity.
- Parallel and map dispatch reserve their complete pending first-attempt set
  before launching any branch. A budget that cannot cover that known set causes
  zero calls.
- `max_run_ms` measures cumulative active scheduler time across continuation.
  Pause and interrupted wall time outside the scheduler do not consume it.
- Every cyclic decision edge is explicit and has a loop-disabled escape. A loop
  marker on an acyclic edge is invalid metadata, not a dormant annotation.
- Kernel-compatible v1 migration preserves all supported semantics or refuses.
  Host-effect steps are never silently narrowed out of a v4 definition.

Rejected findings / bounded false alarms:

- “A result-checkpoint failure permits repeating a successful read-only call”:
  rejected. The durable intent plus exact journal outcome is sufficient to
  reconcile it without another call.
- “Truncating journal records beyond `expected_records` restores consistency”:
  rejected. It destroys the only evidence for the post-checkpoint outcome and
  can repeat completed work; consistency comes from identity reconciliation.
- “A stable-code denylist is enough to make kernel failures non-maskable”:
  rejected. Codes can be translated at adapter boundaries; failure authority is
  an explicit closed class owned by the scheduler.
- “Child assignments can wait for execution-time preflight”: rejected. Import
  and attended consent promise a complete runnable deployment and therefore must
  resolve the same direct-child closure before writing or confirmation.

## 2026-07-19 — Persistence and composition boundary invariants

New durable invariants:

- A journal result is evidence only when its bounded canonical content hashes
  to `result_ref` and its status equals the record status. Hash syntax alone is
  never integrity evidence.
- Journal-ahead reconciliation is an exact-set operation over the complete
  parent/child checkpoint tree. Every suffix identity must match durable
  pending or in-flight state; extra evidence is terminal drift, not resumable
  storage failure.
- Atomic installation of the private checkpoint commits scheduler authority.
  Old-snapshot cleanup and public projection are separately durable,
  idempotent maintenance debt and can never make a committed scheduler state
  appear undurable.
- Attended checkpoint consent authorizes one exact node visit. It is consumed
  once across the parent/child namespace; revisiting a node or starting a new
  deterministic child run requires fresh consent.
- A child executes under its own id, objective, and run namespace. Because the
  kernel deliberately passes the complete normalized parent input, deployment
  is valid only when the child's closed schema accepts every parent-valid
  value. Compatibility refuses early; data is never silently projected.
- Workflow deployability does not require a local agent. Deterministic
  gate-only graphs and parents whose agents exist only in pinned children are
  first-class v4 workflows.
- Cycle metadata follows graph reachability, not traversal distance. Escape is
  evaluated under actual loops-disabled semantics, including gate `loops_off`
  behavior.
- The 256 KiB workflow limit is canonical-document size. Saved files add one
  newline; bounded readers may accept a 512 KiB transport representation only
  to parse and re-enforce the canonical limit.
- `uncertified-disabled` means exact-disabled in every policy mode. Disabling a
  live-certification requirement does not elevate an uncertified path.

Rejected findings / bounded false alarms:

- “Any journal-prefixed code should remain resumable”: rejected. Only named
  transient write/storage failures are recoverable. Corruption, identity
  collision, invalid records, and suffix drift are terminal fail-closed states.
- “Passing only the child-declared subset of parent input is an adequate fix”:
  rejected. Projection silently changes the composed contract and can hide
  authoring errors; schema compatibility is the canonical preflight boundary.
- “Checkpoint cleanup must finish before publication”: rejected. Removing the
  old snapshot first creates a crash window in which the still-canonical
  checkpoint has no recovery material. Publish new authority first and retain
  cleanup as durable debt.

## 2026-07-19 — Recovery-capacity and operational-boundary invariants

- Shared-writer identity and snapshot selection are one serialized operation.
  A process-local generation name is not proof that an existing snapshot is
  the current before-state; its tree reference must equal the locked canonical
  fingerprint, or the stale generation is removed and retaken.
- Result bounds apply to aggregate retained state, not only to each individual
  value. Checkpoint and journal admission reserve space for a compact failure,
  and the journal write ceiling is identical to its read ceiling.
- Usage is absent/zero or an exact closed pair of nonnegative safe integers.
  Malformed telemetry is never normalized to zero, and every aggregate addition
  is checked before mutation.
- Abort means “do not start more work.” Already-started parallel/map effects may
  settle, but queued indices and queued shared writers observe the stop token
  before provider dispatch, and unused reservations are released.
- General reachability uses operational edges. A decision `loops_off` edge is
  operational only when the decision contains an actual cyclic `loop: true`
  edge; inert escape metadata cannot make dead nodes deployment-valid.
- Schema-1 kernel checkpoints remain historical read shapes, not resumable
  lifetime evidence. Because they omit elapsed duration, continuation refuses
  them rather than silently resetting the cumulative deadline.
- “Raising the private checkpoint or journal limits fixes aggregate result
  overflow”: rejected. It only moves the same unbounded-aggregation defect and
  can still create a file that the matching reader refuses.
- “A hard run deadline is an operator cancellation”: rejected. Deadlines are
  failed timeouts; only an externally requested abort is operator cancellation.

## 2026-07-19 — Executable contract and continuation-state invariants

- A validated agent field is an executable contract. Prompt id, output schema,
  tools, mutation mode, artifact, visit, attempt, iteration, run id, and
  requested/effective runtime identity must reach the adapter and return
  envelope unchanged; schema presence alone is not implementation evidence.
- Completed scheduler state is never self-authenticating. Every completed
  instance must have exact reconciled journal evidence, and active visit,
  nested child scheduler, and budget state must validate as one recursive
  continuation document before any effect can be reused.
- Journal evidence is scoped to the scheduler run namespace that produced it.
  Schema-3 records persist that namespace and effect base identities include it;
  schema-1/2 records remain readable but cannot reconcile active state. Matching
  node and instance strings are insufficient across a parent/child boundary.
- Workflow budget maxima are immutable lifetime bindings. A provider may
  truthfully overshoot an enforced soft token/cost maximum, but resume or an
  injected ledger cannot increase the configured ceiling to legalize it.
- Usage from a completed failed provider call is still consumed lifetime usage.
  It must be durably accounted exactly once; malformed or partial usage cannot
  be replaced with zero, and unsafe aggregate arithmetic cannot mutate totals.
- Abort fan-out reports the exact result that first triggered the stop. A later
  `kernel-branch-aborted` placeholder describes only the stopped sibling and
  cannot replace the decisive failure or be rendered as operator cancellation.
- Node visit is part of effect and child-run identity. Stable node ids alone are
  insufficient when an authored loop revisits parallel, map, pipeline, agent,
  checkpoint, or subworkflow work.
- Structured repair is provider work, not parsing housekeeping. Each repair is
  a separately bounded and journaled effect and the declared repair ceiling is
  executable policy, not dormant metadata.
- Host artifact verifiers and deterministic gates are evidence observers. Mock
  and real convergence material must originate inside a counted agent/workspace
  transaction; a host callback cannot create the artifact it then approves.
- Exact OpenRouter evidence binds the provider-issued creator account, unique
  endpoint tag, provider name, quantization, supported parameters, response
  identity, and generation identity. A route label or self-authored prospective
  attestation is not equivalent evidence.

Rejected findings / bounded false alarms:

- “A structurally valid checkpoint can trust `active.completed` without its
  journal record”: rejected. That turns caller-controlled state into replay
  authority and permits unperformed work to be reused.
- “Failed calls need no usage accounting because the node did not succeed”:
  rejected. Provider work was performed and lifetime ceilings apply to calls,
  not only to successful workflow values.
- “Role defaults may widen a declared tool list at runtime”: rejected. The
  declared list is the consented executable capability set; defaults belong in
  normalization before hashing and consent.
- “Deterministic mocks may write gate markers from the verifier or gate host
  callback”: rejected. That bypasses the journaled agent transaction and makes
  the observer manufacture its own proof.

## 2026-07-19 — Scoped-budget and provider-turn invariants

- Subworkflow sharing means shared lifetime accounting, not inherited authority
  to raise a child definition's ceiling. Each child invocation enforces its own
  `max_total_effects` while every consumed effect and usage value also advances
  the parent ledger. A repeated child visit gets a new local allowance but never
  resets the parent total; a resumed child restores its local consumption.
- One kernel effect must correspond to one provider turn. Because Pi tool loops
  can contain multiple assistant/provider turns behind one outer prompt, exact
  real Pi sessions are restricted to one read-only, tool-free turn with runtime
  retries disabled until Helix can durably expose and journal each internal turn.
- OpenRouter endpoint tag, provider name, and quantization are distinct binding
  fields. The exact request pins tag plus quantization; streamed provider
  metadata and generation metadata compare with provider name. Property order
  in the request object is not identity.
- Production-path package evidence must import the extracted adapter and execute
  its shipped default session factory. Loading commands through Pi RPC, using an
  injected session factory, or exercising a raw Pi mock proves a different seam.
- “Let the parent ledger replace the child's ledger because both count the same
  effects”: rejected. It silently changes the child's declared contract whenever
  the parent ceiling is larger.
- “Count one Pi prompt as one effect even if tools cause more provider turns”:
  rejected. Provider work, usage, retry ownership, and continuation evidence are
  per provider turn, not per outer prompt API call.
