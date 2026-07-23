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

## 2026-07-22 — Graph-mode interpretation invariants

- WorkflowDefinition v4 is already the persisted control-flow graph. Graph-mode
  compiles a typed operational view of that definition; it is not a second IR,
  runner, scheduler, provider boundary, or convergence authority.
- Execution mode is a closed, resume-bound identity. Original-mode intentionally
  omits the discriminator from historical execution/runtime hash inputs;
  graph-mode includes it. Public state schema 4 means original-mode and schema 5
  requires an explicit valid mode.
- Canonical graph node order is lexical by node id, independent of object-key
  insertion order. Decision edges retain authored array order. This distinction
  is required because canonical persisted JSON sorts object keys but decision
  priority is semantic.
- Edge identity includes the authored port, not only endpoints. Two conditions
  may legally route from the same node to the same target and remain different
  edges with different conditions and ordinals.
- Planned/observed public graph data may expose node/edge ids, kinds, ports,
  structural condition operator/path, and hashes. It must not expose condition
  values, prompts, tasks, responses, provider bodies, accounts, or workspace
  content.
- An opaque caller-supplied runtime hash is not proof that execution mode is
  bound inside it. The kernel preserves that raw ref for original-mode but
  derives graph-mode's effective ref itself. Scheduler checkpoint schemas 1/2
  are original-only; schema 3 explicitly and recursively binds graph-mode.
- Observed events are admitted as a closed mode-aware stream. Graph-mode never
  uses endpoint inference and requires exact edge id/kind. Parent events retain
  bounded child targets, edges, mode, and progress; the run's pinned child
  definitions, not mutable catalog state, validate nested projection.
- A parity claim covers complete normalized results from independent identical
  workspaces: status/code/terminal, outputs, visits, budgets, event order/path,
  journal structure, and workspace fingerprint. Equal aggregate counts are not
  parity. Only explicit run/mode/time-derived identities may normalize away.

Rejected alternatives:

- “Use graph-mode as a general multi-ready-node DAG scheduler”: rejected. V4
  control flow has one current node; parallelism and joins remain explicit
  bounded compound nodes. Implicit readiness would change effect ordering,
  budgets, persistence, and recovery semantics.
- “Persist a second graph schema for graph-mode”: rejected. It would create
  definition drift and two migration/validation authorities. Both resolvers
  consume the same normalized v4 document.
- “Fall back to original-mode when graph compilation or routing fails”:
  rejected. That converts integrity drift into silent semantic substitution;
  graph-mode refuses instead.
- “Trust an injected runtime hash to contain the graph-mode discriminator”:
  rejected. Hash opacity cannot prove semantic composition and permitted a
  schema-2 original checkpoint to resume through graph routing.
- “Treat a graph transition without edge metadata as ambiguous legacy history”:
  rejected. That inference exists only for original streams; graph-mode missing
  metadata is corruption and refuses.

## 2026-07-22 — Graph-mode Review 2 closure invariants

- A validated definition does not remain caller-owned scheduler state. Each
  parent/child invocation clones and deeply freezes one admitted definition;
  hashing, direct routing, graph compilation, and checkpoint identity use that
  copy. Injected boundaries receive detached values and cannot mutate routing.
- A nonempty observed parent or child stream starts with `run-start` or
  `run-resume`, binds the exact pinned definition and execution mode, and has
  one run id with contiguous sequence numbers. Each event kind admits only its
  exact required and optional fields; mode fields occur only on binding events.
- Canonical graph and fragment ordering is Unicode code-unit order, not ambient
  locale collation. Authored decision-array order remains semantic and is not
  sorted.
- Fragment combinators admit descriptor-safe bounded JSON before reading input.
  Accessors, proxies, cycles, excessive depth, and executable values refuse
  without execution.

Rejected alternatives:

- “Trust shipped adapters not to mutate nodes”: rejected. The kernel boundary,
  not current adapter behavior, owns parity and transition authority.
- “Validate only event values used by the renderer”: rejected. Ignored unknown
  fields, misplaced mode, or a missing binding event can make corrupted history
  appear authoritative.
- “Use `localeCompare` for human-friendly canonical order”: rejected. Process
  locale is environmental state and changes ordinals and public projections.

## 2026-07-22 — Graph-mode Review 3 closure invariants

- Scheduler checkpoint schema identifies execution authority: schema 3 means
  graph-mode only, while schemas 1/2 mean original-mode only. Recursive child
  admission receives the enclosing runtime/task bindings; a child checkpoint's
  own copies cannot attest themselves.
- A child event namespace is derived data, exactly
  `<parent-run>.<parent-node>.<visit>`. Gate events bind the authored `final`
  property, and their result constrains the next typed pass/fail/loops-off edge.
- Schema-4 subworkflow wrappers are historical opaque parent progress. They are
  readable only through an explicit original-mode adapter and do not authorize
  reconstructing a nested graph from current catalog contents.
- Pinned child definitions are run companions. Their strict filename grammar is
  part of run-record hygiene; list/status never interprets them as independent
  run records.
- Descriptor-safe authoring includes non-trapping proxy detection before any
  reflection and an exact canonical UTF-8 byte ceiling. Refusal without throwing
  is insufficient proof if an input trap executed first.
- Graph parity includes the full shared kernel adversarial suite, not only typed
  routing fixtures. Any shared kernel test must be runnable under graph-mode so
  route selection cannot hide divergence in retry, recovery, workspace, budget,
  capacity, child, cancellation, or deadline behavior.

Rejected alternatives:

- “Validate nested runtime/task refs later after resolving the child”: rejected.
  Resolver and checkpoint callbacks are effects at the admission boundary; known
  parent-binding drift must refuse before either runs.
- “Upgrade historical child wrappers using the current child definition”:
  rejected. Mutable catalog state is not historical evidence; opaque parent
  progress is the strongest truthful projection of that schema.
- “A refused Proxy proves author input was not executed”: rejected. Proxy traps
  are execution even when the helper catches the exception and returns a stable
  refusal.

## 2026-07-22 — Graph-mode Review 4 closure invariants

- Observed lifecycle evidence is causal, not a bag of valid-shaped events. An
  effect end closes one exact open start; node/run completion has no open
  effects; retry/repair follows a completed attempt; and successful run-end
  matches the authored succeeded terminal after the recorded final-gate pass.
- Completed public state is not independent authority. Its terminal status and
  code must match the last admitted run-end before watch renders completion.
- A child-definition companion name has one shared generator/parser and admits
  the complete canonical workflow-id grammar plus the exact bounded version
  grammar. Filename heuristics are not a second schema.
- Descriptor-safe authoring applies the canonical byte ceiling before structured
  clone. An over-limit input must refuse without allocating a complete clone.
- An immutable admitted definition remains kernel-owned, but adapter callbacks
  receive detached values. Immutability cannot change the callback contract into
  a frozen shared-reference contract.

Rejected alternatives:

- “Closed event fields make lifecycle order trustworthy”: rejected. Individually
  valid events can still invent completion, leave work open, or declare success
  from a nonterminal node.
- “Recognize companion files by a convenient identifier subset”: rejected. The
  persisted filename boundary must use exactly the same public id/version grammar
  as the workflow schema.
- “Clone first, measure later because the final result is bounded”: rejected.
  Admission must bound resource use before the expensive allocation it protects.

## 2026-07-22 — Graph-mode Review 5 closure invariants

- Schema-5 effect history is a per-node-visit automaton. Effects exist only on
  agent-bearing nodes; each completion or resume closes an exact open start;
  instance ids are single-use; and retry/repair identifies the exact failed
  agent attempt and failure class it consumes. Schema-4 remains a historical
  compatibility reader and cannot authorize schema-5 evidence.
- A parent subworkflow may expose partial child progress while active, but it
  may end successfully or transition only after the exact derived child run has
  an admitted successful run-end. Failed/refused/cancelled parent termination
  remains truthful when child startup or execution itself fails.
- Authored terminal nodes own workflow success, not workflow failure reporting.
  A complete post-start failed/refused/cancelled result receives exact
  node-end/run-end evidence at its current nonterminal node and a terminal
  checkpoint. Checkpoint-derived recoverable outcomes remain active and
  resumable instead of receiving false terminal evidence.

Rejected alternatives:

- “Let `run-resume` authorize any later `effect-resumed`”: rejected. The durable
  prefix contains the exact open attempt; accepting an unrelated instance would
  manufacture completion.
- “Treat child wrappers as optional diagnostics”: rejected for schema 5. A
  parent cannot prove successful subworkflow execution without the exact child
  terminal stream that the scheduler always forwards.
- “Loosen watch binding for complete failures without adding events”: rejected.
  Public state is not its own evidence; the scheduler must emit the causal
  structural terminal record that watch verifies.

## 2026-07-22 — Graph-mode Review 6 interrupted-audit closure invariants

- `active: null` does not prove completion because it also represents a
  between-node checkpoint. A durably closed checkpoint carries an exact
  terminal status/code marker; direct replay returns that outcome with no node,
  gate, child, or provider effect.
- A public effect start emitted after the in-flight-intent checkpoint is not in
  the durable prefix. Journal-ahead reconciliation therefore emits an explicit
  recovered-effect event. Ordinary resumed-effect evidence remains valid only
  when it closes the exact preserved public start.
- Retry/repair event order is necessary but not sufficient. The observed
  automaton binds effect instance structure to the active node/visit and rejects
  ordinary or structured retries beyond the authored agent/definition ceilings.
  Runtime expansion may narrow, but never raise, the authored retry maximum.
- A checkpoint-derived interruption is resumable only after a prior checkpoint
  is durable. If the first private checkpoint fails, the direct scheduler can
  return a closed failure without executing the node, but product state remains
  incomplete and nonresumable with an empty committed prefix; there is no
  private state from which completion or continuation could be truthful.

Rejected alternatives:

- “Infer completed state from `active: null` plus current node”: rejected. The
  same shape is intentionally written after a transition and before the next
  node starts.
- “Call a journal-ahead result `effect-resumed` without a preserved start”:
  rejected. That reintroduces the orphan-resume authority Review 5 closed.
- “Sequential retry counters are enough”: rejected. A well-ordered forged trace
  can still exceed the workflow's admitted retry contract.

## 2026-07-22 — Graph-mode Review 7 closure invariants

- A successful agent-bearing node visit proves a complete execution obligation,
  not merely the absence of open effects. A bounded structural effect plan
  declares logical slots; every agent, pipeline stage, parallel branch, and map
  item must have a final accepted outcome. Empty maps alone have zero slots.
- Pipeline stages settle in authored order. Runtime panel expansion is visible
  as contiguous member indices within a logical slot. Every later invocation
  attempt follows an explicit retry/repair control of the exact prior failed
  agent attempt; a failed final outcome is accepted only by the authored
  parallel/map settle allowlist.
- Graph-mode binding identity is locale-independent for both preset ids and
  pinned `id@version` child keys. Original-mode retains its historical
  locale-aware sort because preserving its existing hash is an explicit
  compatibility requirement.
- Provider-free smoke preserves production effect ownership. Synthetic
  artifacts are candidate mutations inside the counted workspace transaction;
  verification reads and hashes the actual file; and the authored deterministic
  gate executes read-only against that worktree. A preferred route is not gate
  evidence.

Rejected alternatives:

- “No open effect means an agent node completed”: rejected. A zero-effect visit
  and a visit whose only effect failed both satisfy that weaker predicate.
- “Use one new canonical sort for both modes”: rejected. That would repair
  graph-mode determinism by silently changing historical original-mode consent
  hashes.
- “A smoke may synthesize gate success because its model is synthetic”:
  rejected. The model boundary may be deterministic, but workspace mutation,
  artifact verification, and objective-gate authority remain production
  contracts.

## 2026-07-22 — Graph-mode Review 8 closure invariants

- Structural event persistence is part of execution, not optional telemetry.
  Failure of any event sink prevents the operation represented by that event
  from advancing. A successful terminal checkpoint is published only after its
  exact terminal `node-end` and `run-end` pair succeeds.
- A recoverable event interruption resumes from the last durable scheduler/event
  prefix. Product resume removes any event-file suffix beyond that checkpoint;
  work after the prefix is re-observed rather than inferred from an unbound
  public event.
- Authored command gates are read-only observers. macOS uses a deny-by-default
  sandbox profile; Linux uses isolated user, mount, network, and PID namespaces,
  a minimal read-only chroot, and a capability-free authored process. The
  command receives sanitized environment state and no network, and only an
  ephemeral private temp area is writable.
- Exact workspace fingerprints before and after the command bind its evidence.
  Named and staged runs guard the observation with a private snapshot and must
  restore detected drift. Boundary, fingerprint, restore, or cleanup uncertainty
  is a failed gate, never convergence evidence.

Rejected alternatives:

- “The terminal checkpoint is enough even if the public sink failed”: rejected.
  It permits completed state whose authoritative event stream cannot prove the
  claimed outcome.
- “Fingerprint after an unrestricted command”: rejected. Detection after an
  outside-worktree or external mutation does not make the command read-only.
- “Clear proxy variables and trust the checker”: rejected. Filesystem, local IPC,
  ambient credentials, and non-proxy network paths remain mutation channels.
- “Run the gate in a writable disposable candidate”: rejected. It limits damage
  to that candidate but does not prevent arbitrary host or external mutation and
  weakens the invariant that gates only observe counted candidate effects.

## 2026-07-22 — Graph-mode Review 9 closure invariants

- Event-prefix authority is content-addressed, not inferred from a count. Every
  new public state and scheduler checkpoint carries the same rolling canonical
  ref over the exact ordered prefix, including child wrapper events. The ref is
  advanced only after the sink accepts the event.
- Active watch renders only the checkpointed prefix and verifies its ref. A
  valid-looking suffix left after an interrupted sink is not authority. Resume
  verifies the retained prefix before truncating any suffix or performing an
  effect. Scheduler schemas 1/2/3 and legacy public schema 4 are history-only.
- A bound parent cannot contain an unbound nested child checkpoint. Original
  and graph scheduler schemas 4/5 carry event refs recursively; downgrade,
  retained-event mutation, prefix reordering, or parent/child wrapper drift
  refuses before effects.
- Authored command gates receive the minimum read authority needed for their
  candidate and runtime. The Git view has a private writable index/config with
  no remotes or credential helpers and read-only object alternates, never the
  host common directory. Linux isolates IPC in addition to user, mount,
  network, and PID namespaces. Its chroot mounts the private `/tmp` before
  binding the candidate and dependency paths because legitimate run worktrees
  may themselves live below `/tmp`; reversing that order hides those binds.
  Host-side Git/Nix discovery uses fixed system helper paths and sanitized Git
  environment state; an authored `PATH` entry is never executable preparation
  authority.
- Cancellation and timeout are not final until the contained process group
  closes. Cleanup, after-fingerprint, restoration, and normal evidence occur
  only after that boundary. Bounded failure to confirm termination preserves
  scratch and guard material and returns
  `objective-gate-termination-unconfirmed`.

Rejected alternatives:

- “Event count plus closed lifecycle validation authenticates a checkpoint”:
  rejected. A same-length retained event can be changed without violating
  sequence or shape.
- “Render all valid events beyond an active state's count”: rejected. Those
  events may be the exact suffix whose sink/checkpoint transaction failed.
- “Expose the host Git directory read-only”: rejected. Repository configuration
  and worktree metadata are ambient authority unrelated to objective evidence.
- “Signal means terminated”: rejected. Final fingerprint/restoration before the
  child `close` boundary races a still-running process or descendant.

## 2026-07-22 — Graph-mode Review 10 closure invariants

- Private checkpoint installation, not event-file append, advances public
  event-prefix authority. Public state is a projection of that exact durable
  count/ref; a newer JSONL tail is unauthoritative crash residue.
- Resume authenticates the parent event prefix and derives each nested child
  prefix from exact parent wrapper events before provider certification,
  worktree creation/restore, truncation, or any other execution effect. A child
  cannot self-assert a syntactically valid but unauthenticated ref.
- Cancellation does not convert a live boundary into terminal evidence. After
  abort, the scheduler waits a bounded settlement interval and accounts valid
  late usage. If settlement remains unknown, the run remains nonterminal and an
  in-flight provider intent cannot be replayed.
- Only a genuine objective checker exit is routable as `pass` or `fail`.
  Sandbox, termination, fingerprint, restoration, and cleanup uncertainty is a
  typed structural error across kernel, staged, and smoke adapters.
- The command-gate Git view is a self-contained bounded snapshot: current HEAD
  tree closure plus staged index objects, a private index/config, and a
  deterministic parentless synthetic HEAD. It has no alternate or mount into
  the host object database and therefore exposes no repository history.

Rejected alternatives:

- “Advance public state after every accepted event”: rejected. The public
  projection can then authorize a suffix the private scheduler cannot resume.
- “A child checkpoint's valid-looking ref proves its own prefix”: rejected.
  Only the authenticated parent wrappers establish what the child emitted.
- “Abort means zero usage and terminal cancellation”: rejected. The provider
  may settle later with billable usage or remain live after final evidence.
- “Return sandbox uncertainty as an ordinary failed checker”: rejected. An
  authored `on_fail` edge could launder lost containment into later success.
- “Read-only Git alternates are harmless”: rejected. Git plumbing can enumerate
  and read history-only objects even when the common directory itself is hidden.

## 2026-07-22 — Graph-mode Review 11 closure invariants

- Objective gates are recoverable effects even though they are deterministic
  observers. Before launch, the scheduler checkpoints an exact run,
  definition, node, visit, and objective identity; before routing, it
  checkpoints the closed result. An in-flight or unconfirmed gate is never
  relaunched during resume.
- External cancellation and deadline signals do not replace a recoverable
  kernel outcome. Unknown effect or boundary state remains interrupted and
  visibly resumable until durable terminal evidence exists.
- Public completion is private-checkpoint-derived. A direct scheduler may close
  after failure of its first checkpoint, but product state remains incomplete
  and nonresumable at the empty committed prefix because no private terminal
  authority exists.
- The persisted event path is hostile input. Watch and resume require a regular
  non-symlink file no larger than 64 MiB before reading it.
- Git object identity follows the repository object format. SHA-1 and SHA-256
  repositories use their exact 40- or 64-character object ids; an untracked
  artifact cannot make an otherwise valid repository unsupported.
- Public event and journal counts are cardinalities and therefore safe,
  nonnegative integers at discovery as well as authoritative readers.

Rejected alternatives:

- “A deterministic gate is safe to retry after uncertain termination”:
  rejected. The checker may still be live and its containment/guard outcome is
  unknown; relaunch compounds the unknown effect.
- “Cancellation is the more useful display code”: rejected. It hides the
  stronger fact that a provider or contained boundary may still be live and
  suppresses the truthful continuation path.
- “Read the event file, then validate its prefix”: rejected. A final symlink or
  oversized suffix is already an authority and resource-boundary violation at
  the read itself.

## 2026-07-22 — Graph-mode Review 12 closure invariants

- Public event and journal counts use one validation boundary across run
  discovery, watch, resume rendering, and actual continuation. Both are safe,
  nonnegative integer cardinalities; no reader may accept a weaker shape.
- Private scheduler state is the continuation authority. Public event or
  journal count may lag only while its private checkpoint carries explicit
  projection debt, never lead, and must be repaired before provider
  certification or workflow effects.

Rejected alternatives:

- “Run discovery validation is enough”: rejected. Direct watch and resume
  commands read the public state independently and must fail closed themselves.
- “Journal count is display-only”: rejected. It is a public projection of the
  exact durable effect prefix and must reconcile before continuation can trust
  provider/workspace state.

## 2026-07-22 — Graph-mode Review 13 closure invariants

- Cancellation, the cumulative run deadline, and the per-call timeout are
  causal boundaries. A provider success settling after one wins cannot commit,
  advance, or manufacture successful effect evidence. Valid late usage remains
  lifetime usage and is durably accounted; mutating work rolls back.
- A command checker cannot read the candidate's physical `.git` directory or
  linked-worktree pointer file. Its only Git database is the bounded sanitized
  snapshot of admitted current tree/index objects.
- Durable projection debt may authorize only lag. Resume repairs event count,
  event ref, and journal count and clears the debt before the next workflow
  effect; public state can never lead private scheduler authority.

Rejected alternatives:

- “A late provider success is the exact settled outcome”: rejected. Settlement
  supplies usage truth, but it cannot reverse an already-won cancellation or
  timeout and causally advance the workflow.
- “`GIT_DIR` is sufficient isolation”: rejected. Raw filesystem reads and an
  explicit `--git-dir` bypass environment selection unless physical metadata is
  excluded or masked.

## 2026-07-22 — Graph-mode Review 14 closure invariants

- A schema-4/5 scheduler checkpoint never authenticates itself. Every direct or
  product continuation supplies the exact retained event array matching its
  count and rolling ref; omission refuses before any journal, workspace, gate,
  checkpoint, provider, or child-resolution callback.
- Cancellation and the cumulative run deadline are causal for gates as well as
  agents. A late gate `pass` or `fail` is converted to the exact interruption
  before boundary checkpointing and can never survive a later terminal write
  failure as reusable convergence evidence.
- Projection debt is not cleared until the private maintenance marker is
  durably replaced. If that write fails, resume refuses before cast/provider
  certification and preserves the marker for a later retry.
- Incomplete schema-4 watch is historical and nonresumable, but its recorded
  event count remains its display authority. A valid contiguous file suffix is
  ignored exactly as it is for schema 5.

Rejected alternatives:

- “Validate an event prefix only when the caller supplies one”: rejected. That
  makes omission an authentication bypass rather than a malformed continuation.
- “Persist a late gate pass, then check cancellation before routing”: rejected.
  The pass can outlive the current call and be reused after a later persistence
  failure.
- “Leave projection debt set and continue conservatively”: rejected. Provider
  work would begin while the durable projection transaction remains unfinished.
- “Legacy watch may render the whole structurally valid file”: rejected. A
  suffix beyond recorded authority is crash residue regardless of schema.

## 2026-07-22 — Graph-mode Review 15 closure invariants

- An authored checker executable is an exact file capability, not authority to
  its parent directory. Any dependency/read root that contains the candidate
  refuses. Linux applies the physical `.git` mask after external read binds.
- Linux containment helpers are host policy, not authored configuration.
  `unshare`, `mount`, `chroot`, and `setpriv` resolve only through fixed trusted
  system/Nix roots; absence refuses and authored `PATH` is never consulted.
- Pass/fail means a genuine checker process exited with an integer status.
  Pre-abort, timeout, spawn failure, process error, unconfirmed termination,
  sandbox, fingerprint, restoration, and cleanup failure remain typed errors.
- Staged compatibility routing admits only `pass`/`fail` without an error code,
  or `error` with one valid public code. Null, missing, unknown, accessor-failed,
  and contradictory shapes refuse before any authored gate transition.

Rejected alternatives:

- “Mount the executable's parent for convenience”: rejected. A sibling
  candidate then inherits that parent grant and its excluded metadata reappears.
- “Use `PATH` only when a Linux helper is missing”: rejected. The fallback runs
  before the containment boundary whose absence it is meant to repair.
- “A killed checker closed nonzero, so it failed the objective”: rejected. The
  host caused termination; it did not observe a genuine checker verdict.
- “Malformed gate output is equivalent to fail”: rejected. Converting boundary
  uncertainty into authored control flow violates structural non-maskability.

## 2026-07-22 — Graph-mode Review 16 closure invariants

- Every admitted checker, dependency, and runtime path is disjoint in both
  directions from every physical candidate Git-metadata path. This includes an
  ordinary `.git` directory and both the pointer file and resolved common
  directory of a linked worktree.
- Retained-prefix effect state has exactly three cases: an open start may close
  once with `effect-resumed`; no retained start may reconcile journal-ahead
  state with `effect-recovered`; an already-closed reference emits no second
  completion. Any mismatch refuses continuation.
- A checkpoint-authenticated successful child terminal remains valid across a
  resume segment only for the same parent node and visit. A fresh visit resets
  child projection state.
- Staged compatibility gate results have exact fields and bounded types.
  Unknown keys cannot enter authored control flow. A late operator cancellation
  keeps both code `kernel-run-cancelled` and status `cancelled`.

Rejected alternatives:

- “Mask Git metadata after admitting a descendant symlink”: rejected. macOS
  profile admission would still grant the resolved metadata path directly.
- “Emit `effect-resumed` whenever checkpoint state says completed”: rejected.
  Checkpoint state and the authenticated public prefix must agree; duplicate
  closure creates a canonically impossible history.
- “Replay child terminal events from a closed child checkpoint”: rejected. A
  closed checkpoint is idempotent; the already-authenticated parent prefix is
  the durable proof and must not be duplicated.
- “Ignore harmless extra gate metadata”: rejected. Closed boundary shapes keep
  uncertainty and future semantic drift out of authored transitions.

## 2026-07-22 — Graph-mode Review 17 closure invariants

- A linked worktree has three physical Git-metadata authorities: its `.git`
  pointer, its per-worktree administration directory, and the resolved shared
  common directory. Sandbox admission denies each lexical/real root and every
  ancestor or descendant grant that intersects one.
- Host preparation never resolves Git through ambient `PATH` and never inherits
  ambient repository-targeting or dynamic configuration variables. Fingerprint
  and sanitized-view calls use fixed trusted Git, closed global/system config,
  and command-line disabling of fsmonitor, hooks, untracked cache, and external
  attributes.
- An untracked symlink contributes only a hash of its link text. Non-regular
  entries contribute a structural kind/mode marker. Regular content must resolve
  under the canonical candidate root and fit both per-file and aggregate byte
  ceilings; otherwise the fingerprint refuses.
- Implicit platform read mounts are capabilities too. They undergo the same
  candidate/Git-metadata disjointness test as authored checker, dependency, and
  runtime grants.

Rejected alternatives:

- “The per-worktree administration directory contains `commondir`, so denying
  that directory is enough”: rejected. The pointer names the shared root but
  does not make that root its filesystem descendant.
- “Sanitize Git after the fingerprint”: rejected. The first bare Git process is
  already unrestricted host execution and can already be redirected.
- “Hash a symlink with Git because only the object id survives”: rejected. Git
  must read the target bytes to compute that id; the forbidden read happens
  before the digest exists.
- “Ignore non-regular or oversized untracked entries”: rejected. Silent omission
  would let workspace drift evade evidence; structural admission must either
  represent the entry or refuse.

## 2026-07-22 — Graph-mode Review 18 interrupted-trace invariant

- The terminal event pair and successful terminal-checkpoint write form one
  commit. Once the terminal marker is durable, its status/code is authoritative
  for the completing call and every resume; cancellation observed during that
  successful write cannot replace only the direct result.

Rejected alternative:

- “Cancellation always wins until the scheduler function returns”: rejected.
  After terminal evidence and its checkpoint are committed, returning a
  different status creates two authoritative outcomes for one run. Cancellation
  must win before terminal commit or not rewrite that commit afterward.

## 2026-07-22 — Graph-mode Review 19 terminal-arbitration invariant

- Cancellation and the whole-run deadline are rechecked after a terminal
  node-entry checkpoint settles and before terminal publication begins. An
  interruption already observed at that boundary wins over every authored
  terminal status in both execution modes.
- The terminal `node-end`, `run-end`, and durable terminal marker carry one
  exact status/code. A successful marker write makes that result authoritative
  through the execution response, public state, resume, and watch.
- A fresh-run outer timer or operator signal may translate only a nonterminal
  scheduler interruption. It cannot relabel a durably committed failed,
  refused, or authored-cancelled terminal.

Rejected alternatives:

- “Checking interruption at the top of the scheduler loop is enough”:
  rejected. Cancellation and the deadline can settle while the node-entry
  checkpoint is awaited, before any terminal evidence exists.
- “The command can prefer its outer abort flag over every non-OK result”:
  rejected. A durable terminal marker is the source of truth even when its
  authored result is non-success.
- “A terminal code is needed only on `run-end`”: rejected. The event lifecycle
  binds the terminal `node-end` and `run-end` as one exact status/code pair.

## 2026-07-22 — Graph-mode Review 20 host-preparation and projection invariants

- Pre-sandbox fingerprinting never invokes a Git operation that converts
  worktree content. Indexed metadata and bounded descriptor-safe physical
  tracked/untracked entries define the observation, so authored clean/process
  filters are never executable host preparation.
- Every preparatory Git process disables replacement refs. The admitted current
  commit/tree and index cannot be redirected through `refs/replace/*`, in either
  an ordinary or linked worktree.
- A durable terminal checkpoint projects its exact completed status/code before
  public projection debt is cleared. If projection fails, the private terminal
  marker and explicit debt remain authoritative; resume repairs that terminal
  before provider certification or worktree creation.

Rejected alternatives:

- “Disable known filter driver names”: rejected. Attribute-selected names are
  authored and unbounded; avoiding worktree conversion removes the executable
  surface instead of attempting a blacklist.
- “`--no-textconv` disables every Git content helper”: rejected. Clean/process
  filters belong to check-in conversion and remain independently executable.
- “A replacement ref only changes history display”: rejected. Tree peeling and
  object packing honor replacements and can copy history-only content into the
  sanitized database.
- “Write completed public state after the terminal checkpoint returns”:
  rejected. That creates an untracked failure window after the private terminal
  has already cleared its projection debt.

## 2026-07-22 — Graph-mode Review 21 canonical-admission and smoke invariants

- Projection repair may publish a terminal only after the scheduler's canonical
  resume admission binds the exact task, definition, execution mode, runtime
  cast, immutable budget, journal prefix, authored terminal semantics, and
  final event pair. Authentication of event bytes alone is not terminal
  authority.
- Admission refusal has zero projection side effects: it cannot truncate the
  event file, update public counts/status, or clear private projection debt.
- Runtime smoke compares original-mode and graph-mode from one exact commit,
  even if the source branch moves between runs. Worktree population uses raw
  objects and modes; it never grants checkout filters, hooks, fsmonitor,
  replacement refs, or ambient `GIT_*` authority.
- Smoke workspace equality is the shared bounded physical fingerprint over the
  exact index plus tracked/untracked bytes and symlink text. It does not use Git
  diff conversion as an implementation shortcut.

Rejected alternatives:

- “An authenticated private checkpoint can be projected directly”: rejected.
  The prefix hash proves retained bytes, not that task/runtime/budget/journal or
  terminal semantics agree with the current authorized resume.
- “Validate after repairing the public files”: rejected. Refusal would already
  have mutated durable state and could erase the only explicit debt marker.
- “`--no-textconv` is enough for smoke”: rejected. Checkout clean/smudge/process
  filters, hooks, fsmonitor, repository targeting, and replacement refs are
  independent authority surfaces.
- “Create two worktrees from `HEAD`”: rejected. `HEAD` may move after the first
  mode, making the parity comparison about different source trees.

## 2026-07-23 — Graph-mode Review 22 continuation, manifest, and cleanup invariants

- Interruption arbitration applies after every fresh or resumed active
  node-entry checkpoint. A continued terminal and a nested continued child have
  no exception: cancellation or the cumulative deadline observed before
  terminal publication wins without adding a visit or publishing authored
  success.
- The public/private resume relation is closed. Nonterminal private state
  requires incomplete public state. Private terminal state requires explicit
  schema-2 projection debt. Completed public state under that debt is admitted
  only when terminal status, code, and node exactly match the private marker,
  and then only as a debt-clearing maintenance retry before certification.
- Pre-sandbox Nix closure discovery has no ambient authority. It uses the fixed
  helper, a private home/configuration, the local daemon store, and explicitly
  disables plugins, substituters, and builders.
- Runtime smoke admits one complete immutable raw-tree manifest before
  registering either disposable worktree. Count, per-entry bytes, aggregate
  bytes, object ids, modes, raw path relations, and symlink constraints are
  checked before any tree materialization.
- POSIX Git filenames and symlink targets are byte strings. A filesystem that
  cannot represent every admitted path and target refuses before worktree
  registration; decoding with replacement characters is never parity evidence.
- Smoke cleanup is a recovery protocol. Each registered worktree is attempted
  independently, registration and lexical/physical checkout absence are both
  reconciled, and the private root survives any uncertainty or cleanup failure.

Rejected alternatives:

- “Only fresh nodes need interruption arbitration”: rejected. A resumed active
  terminal may have been checkpointed before cancellation or deadline expiry.
- “A terminal marker implies its projection debt”: rejected. Without an
  explicit durable marker, a private terminal cannot authorize public lag or
  suppress provider certification.
- “Sanitize `NIX_CONFIG` only”: rejected. User/system config paths, plugins,
  remotes, builders, credentials, helper lookup, and daemon selection are
  independent host-execution surfaces.
- “Enforce the aggregate limit while writing files”: rejected. The process may
  already have read or retained an oversized tree and partially mutated a
  worktree before discovering the limit.
- “Git paths are UTF-8 strings in practice”: rejected. Git path and symlink
  payloads are arbitrary non-NUL bytes on POSIX and must remain exact.
- “Always remove the temporary root in `finally`”: rejected. It erases the only
  operator recovery evidence when registration or checkout cleanup is
  unresolved.

## 2026-07-23 — Graph-mode Review 23 filesystem-proof invariants

- Filesystem representability is a property of the complete admitted raw tree,
  not a small set of feature flags. Before worktree registration, runtime smoke
  must materialize every path/type skeleton entry and symlink payload in
  disposable scratch, enumerate the result as bytes, compare it to the
  immutable manifest, and remove the probe successfully.
- Unicode normalization and lowercase conversion cannot model arbitrary
  filesystem equivalence. This includes invalid-UTF-8 names with an otherwise
  case-folding prefix and full case-fold pairs not represented by
  `toLowerCase()`.
- Cleanup identity is established from the existing scratch root before any
  worktree add. Both lexical and physical child identities therefore remain
  known after partial registration, alias removal, or alias retargeting.
- Cleanup certainty requires every derived checkout identity to be absent from
  both Git registration and the filesystem. Lexical absence never proves that
  its captured physical target is absent.

Rejected alternatives:

- “Probe representative case and normalization pairs”: rejected. A few names
  cannot prove the equivalence relation applied by the target filesystem to an
  arbitrary admitted manifest.
- “A failed `git worktree add` created nothing”: rejected. Registration and
  checkout creation can fail independently and leave a partial path requiring
  recovery.
- “Git no longer lists the lexical checkout, so cleanup is complete”: rejected.
  The physical checkout can survive after an alias disappears or changes.

## 2026-07-23 — Graph-mode Review 24 mode and sandbox-cleanup invariants

- Git regular-file mode identity is the executable bit. The pre-registration
  filesystem proof must create, explicitly apply, enumerate, and compare
  `100644` versus `100755`; normalizing both to a non-executable file defers
  representability failure until after worktree registration.
- Once objective-sandbox scratch exists, preparation is a cleanup-aware
  transaction. Every refusal and exception attempts cleanup and verifies
  absence; cleanup uncertainty is reported as
  `objective-gate-sandbox-cleanup-failed`.
- Workspace-guard rollback is independent of sandbox preparation success.
  Preparation may return refusal or throw, and both paths must roll back an
  already-opened transaction. A simultaneous scratch-cleanup failure remains
  the primary recovery code.

Rejected alternatives:

- “Materialization checks executable mode later anyway”: rejected. By then Git
  has registered a worktree, violating the pre-registration representability
  boundary.
- “Setup failures are all sandbox unavailable”: rejected. Losing scratch
  cleanup evidence is materially different from capability unavailability and
  must retain its typed recovery signal.
- “A thrown preparation owns no workspace state”: rejected. The caller can
  already have opened a workspace guard before invoking the sandbox boundary.

## 2026-07-23 — Graph-mode Review 25 closure confirmation

- The clean all-scope review introduced no new invariant and rejected no
  additional implementation alternative. It independently revalidated the
  complete graph-mode branch trace, including every earlier accepted closure,
  over the exact 42-file scope.
- Review completion means no Critical, High, Medium, or Low finding remained
  after Review 24's fixes. It does not convert unavailable exact Node 22.19/26
  execution into evidence; that platform gap remains explicitly disclosed.

## 2026-07-23 — PR #18 CI capability and raw-path invariants

- A required CI environment must provide and prove the production command-gate
  sandbox boundary before running product tests. Ubuntu 24.04's default
  AppArmor user-namespace restriction is environment unavailability, not
  evidence that command-gate behavior may be skipped.
- Raw-path representability includes every host operation used after admission.
  Creating and enumerating a byte path is insufficient when the physical
  fingerprint also requires a byte-preserving parent or regular-file
  `realpath`; unsupported operations refuse before worktree registration.

Rejected alternatives:

- “Skip command-gate tests on GitHub-hosted Linux”: rejected. It would remove
  the exact-platform production boundary from the required check.
- “Treat sandbox-unavailable as an expected product result in E2E fixtures”:
  rejected. Those fixtures promise executable objective-gate coverage.
- “The filesystem accepted the raw filename, so later fingerprint refusal is
  correct”: rejected. Admission owns every downstream representability
  prerequisite and must fail before registering disposable worktrees.

## 2026-07-23 — Raw collision fixture capability invariant

- A platform fixture may classify raw path pairs as supported only after it
  proves every host operation whose success production admission requires.
  Filename creation alone cannot predict whether Node can perform the byte-root
  and regular-file `realpath` operations used by physical fingerprinting.

Rejected alternative:

- “Expect a worktree add whenever both raw names can be created”: rejected. On
  Linux, invalid-UTF-8 names may be created while byte-path `realpath` refuses;
  production must then stop before registration.
