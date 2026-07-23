# Workflow architecture review ledger

Append-only implementation and verification record.

## 2026-07-16 — HWK v4 consolidated implementation

Status: implementation-complete on `helix-workflow-kernel-v1`; the complete
local all-or-nothing gate passed. Exact remote-head and branch-CI proof are
post-commit delivery gates and must still pass before the branch is called
shipped.

Accepted findings and resolution:

- P0 product resume refusal: replaced with task-aware, effect-aware private
  checkpoint restore and attended resume. Orphan journal/event suffixes are
  reconciled to the durable scheduler/workspace prefix.
- P0 output-only mutation replay: mutating reuse requires exact workspace state;
  shared and isolated writers commit checkpoint-backed transactions before
  journal completion.
- P0 exact provider/account gap: added closed CapabilityAttestation, structural
  runtime branding, policy expiry, exact registry resolution, protocol-specific
  adapters, and zero-egress negative tests. Unobservable paths are
  exact-disabled.
- P1 dual product engines: all named v1/v4 and built-in workflows normalize to
  v4 and run through HWK. Historical runner readers and research remain isolated.
- P1 unstructured verdict parsing: the Pi adapter accepts only one complete
  closed JSON object. Explicit retry attempts are scheduler effects and consume
  the shared budget.
- P1 mutation isolation: isolated proposals now use disposable Git worktrees,
  bounded regular-file copying, unchanged-base promotion, rollback, and cleanup.
- P1 UX/observability: planned and observed graphs share stable ids; v4 import,
  pure programmatic construction, run/watch/checkpoint/resume, and structural
  nested progress are exposed.

Verification evidence is recorded only after commands run; see the final
section appended to this file before push.

### Live adversarial findings closed during implementation

- OpenRouter's provider-issued account label contained repeated dots. The
  account contract had incorrectly applied path-traversal semantics to a
  non-path opaque identifier. Validation now allows the provider shape while
  still rejecting whitespace/control characters; raw labels remain memory-only.
- The first live tool proof showed that provider-specific contracts alone did
  not make the product Pi path exact. Product execution now requires a
  consent-bound exact adapter before run-directory creation.
- Pi's OpenRouter stream omits route identity from AgentSession. A
  session-local `127.0.0.1` audit proxy now rejects outbound routing drift,
  forwards request bytes without prompt transformation, observes every streamed
  model/route, and closes with the session.
- Pi's generic OpenAI defaults used `store:false` and
  `max_completion_tokens`; the sole certified ZDR endpoint requires
  `max_tokens` under strict parameter filtering. The exact OpenRouter model
  boundary now sets the supported compatibility fields without weakening
  `require_parameters`.

### Final local verification evidence

- `npm test`: 638/638 Node tests passed; worktree self-test 12/12; objective
  loop self-test 8/8.
- `npm run check:workflow-conformance`: 32/32 passed.
- `npm run check:provider-contracts`: 27/27 passed.
- Docs truth, resources, static no-live-egress, public-safety diff, and
  `git diff --check`: passed.
- Extracted-package proof: passed; 98 files; required NOTICE/security/kernel/
  runtime/docs resources loaded from the tarball.
- Supported Pi `0.80.7` runtime RPC: package load, all 20 Helix commands, and
  isolated no-live behavior passed.
- Active Docker `--network none`: 5/5 passed, including blocked external DNS,
  offline package startup, and localhost-only mock inference.
- Explicit Node matrix: Node `22.19.0` 638/638; Node `26.5.0` 638/638; resource,
  docs-truth, and no-live checks passed on both.
- Authorized free OpenRouter certification: exact model
  `tencent/hy3:free`, route `Novita`, configured account match, strict ZDR/no
  fallback request, and returned identity passed. No credential/account value
  was printed or persisted.
- Production-path live proof in a disposable Pi `0.80.7` installation: fresh
  Pi AgentSession, exact consent binding, localhost audit proxy, streamed
  model/route verification, and attestation ownership passed. No prompt,
  response, credential, or account value was retained.

### 2026-07-16 — First exact-head branch CI attempt

- Exact remote SHA `d9b57ffe7696c8e6de52509741c941172d74374e`
  ran both Node matrix jobs. All 638 tests and every gate through package,
  dispatch, and revision smoke passed on both Node versions.
- Both jobs then failed before Pi startup with `rpc-spawn-failed:ENOENT` because
  CI supplied `node_modules/.bin/pi` and the helper treated a relative path with
  a slash as a PATH lookup from its isolated temporary working directory.
- Canonical local correction: resolve slash-containing relative `--pi-bin`
  values against the verified package root; bare command names still use PATH
  and absolute paths remain unchanged. A focused regression covers all three
  shapes. The failed remote commit remains unchanged; no force-push or hidden
  rerun was attempted.

## 2026-07-18 — Exact-head adversarial audit remediation

Status: local implementation and all-or-nothing verification complete. The
remediation is shipped only as one normal commit whose exact-head GitHub CI
check passes.

Accepted findings and canonical resolution:

- P0 single-gated success: validation previously required a final gate but did
  not forbid another node from targeting the succeeded terminal. Every
  target-bearing node field is now checked; only the unique final gate's
  `on_pass` may enter success. The scheduler independently refuses terminal
  success unless that exact final node has recorded pass evidence.
- P0 split objective authority: a final node could carry a different `gate`
  from the top-level objective displayed, hashed, and consent-bound. Final nodes
  can no longer contain a local objective and the scheduler always executes the
  top-level `objective_gate`. The pure builder exposes `objectiveGate()` for
  this closed shape; non-final `gate()` remains local evidence routing.
- P2 malformed external input: node traversal, v1 migration, normalization,
  and import are total. Malformed `nodes`, transitions, tools, stop, deployment,
  and stage shapes return stable invalid/migration refusals without writes or
  provider calls.
- P2 false-positive v4 testing: structural edges and ceilings are labeled
  validated, never executed. Optional smoke normalizes every accepted workflow
  to v4, runs one deterministic path through HWK in a detached worktree, and
  reports only observed nodes, effects, transitions, and final-gate routing.
- P3 inert live-certification policy: `require_live_certification: true` now
  requires an adapter that can provide current live-certified evidence and
  refuses before provider preflight otherwise. The shipped Pi adapter
  truthfully advertises no reusable live certification; standalone live proof
  never silently authorizes later product execution.

Regression and adversarial coverage added:

- all target fields across agent, pipeline, parallel, map, reduce, decision,
  gate, checkpoint, and subworkflow nodes, including final-gate fail/loops-off;
- duplicate final gates, node-local final objectives, direct terminal resume
  without pass evidence, and top-level objective execution;
- malformed v1/v4 corpora and no-write import refusal;
- native v4 kernel smoke with an observed decision path and truthful coverage;
- live-certification refusal before adapter preflight; stock templates,
  execution, resume, providers, and historical compatibility remain green.

Local verification:

- First full `npm test`: functional result was correct, but one unchanged
  legacy deadline test exceeded its `<2s` wall-clock assertion under parallel
  load (646/647). The exact test passed alone in 1.23s; no threshold or test was
  changed. A fresh complete rerun passed 647/647, worktree 12/12, and objective
  loop 8/8.
- `check:workflow-conformance`: 40/40 passed.
- `check:provider-contracts`: 27/27 passed.
- `check:docs-truth`, `check:resources`, static `check:no-live-egress`,
  `check:public-safety-diff`, `check:package` (98 files), and
  `git diff --check`: passed.
- Active Docker `--network none` initially passed 4/5 but the synchronized
  checkout bind mount twice returned host `Resource deadlock avoided` before
  the active probe opened. An exact disposable copy under the local cache,
  using the unchanged built image and read-only mount, passed 5/5: both external
  destinations blocked, Pi 0.80.7 loaded Helix offline, and the session reached
  only the localhost mock. No product/harness code was changed.
- The local host has Node 26.5.0 but no Node 22 executable or installed Pi RPC
  binary. The supported Node 22/26, packaged Pi-RPC, and exact-head checks remain
  mandatory remote CI gates. Live OpenRouter variables were absent, so no new
  live-provider call was claimed or attempted.

## 2026-07-18 — Release-quality audit closure

Status: all confirmed functional findings from the independent Fable/Opus and
Codex exact-head reviews are closed canonically on the implementation branch.
The single remediation commit is shippable only after the complete local gate,
normal push, remote-SHA equality, and exact-head Node 22/26 CI succeed.

Accepted findings and resolution:

- Workspace recovery was not transactional under secondary restoration or
  cleanup failures. Shared and isolated mutations now keep before-state and
  proposal material through apply, journal append, scheduler checkpoint, and an
  idempotent finalize checkpoint. Failed restoration is non-maskable and keeps
  every recovery artifact. Injected apply/journal/restore/cleanup failures prove
  the canonical tree is restored or recoverable; no failed effect is silently
  committed. Recoverable workspace/journal/checkpoint failures remain
  incomplete in public state and render as interrupted with the resume action.
- Journal reads used URL path semantics and accepted a missing expected prefix.
  Reads and writes now use one root-confined filesystem resolver; missing,
  short, duplicate, corrupt, Unicode, or spaced-root prefixes refuse.
- Child checkpoints lost their scheduler namespace on resume. Parent snapshots
  now retain closed child state keyed by parent node and child run id; one
  attended resume advances exactly that child once.
- One scheduler effect could hide several panel calls. The kernel expands each
  cast member into an independent identity, budget reservation, journal entry,
  and checkpoint. The first panel wave reserves atomically, so an insufficient
  effect budget launches zero calls.
- Workflow `inputs` were declarative but not a product boundary. A bounded
  closed JSON-schema subset is now validated before run creation; the attended
  UI collects required and optional values, applies defaults, lists only bound
  names at consent, and binds the canonical input object to resume identity.
- Named workflow execution ignored an explicit worktree-off setting. Named
  workflows now require `canonical-worktree` and refuse before consent and run
  creation when the feature is off; the legacy staged path retains its existing
  current-checkout behavior.
- Exact status allowed absent account evidence and used one evidence grade for
  several fields. Exact mode now requires an opaque requested/effective account,
  grades provider/model/effort independently, and labels Pi effort as
  session-verified rather than response-verified.
- Import saved structurally valid but undeployable assignments. Import now runs
  the canonical deployment, cast, gate, effort, and workspace preflight before
  its atomic write.
- Checkpoint pauses were rendered as failures. Paused is now a distinct
  nonterminal presentation with the exact `/helix-run-resume <id>` action.
- Decision defaults could form an implicit loop that ignored loops-off. Defaults
  are typed edges; cyclic defaults require `loop: true`, and loop-disabled runs
  take the declared escape. Condition validation/evaluation also shares an
  explicit depth ceiling and is total on hostile nesting.
- Private snapshot limits are exported, documented, and tested at exact/one-over
  boundaries: 16,384 files, 16 MiB per file, 64 MiB total.
- Runtime smoke now binds exact direct-child workflow versions. CI package proof
  now invokes Pi RPC from the extracted tarball, not the source checkout.
- Scheduler-owned cancellation now bounds gate, artifact, checkpoint, and
  child-resolution boundaries; a deterministic non-cooperative-gate regression
  proves the whole-run deadline returns cancellation.

Focused regression evidence before the final gate:

- Kernel behavior: 26/26, including transaction failure windows, journal path
  and absence, panel reservation, typed input, cyclic defaults, and child resume.
- Workflow v4 schema: 10/10; provider/runtime contracts and Pi adapter focused
  suites passed.
- Complete Node test suite: 669/669; worktree self-test 12/12; objective-loop
  self-test 8/8.
- Workflow conformance: 56/56; provider contracts: 27/27; docs truth,
  resources, static no-live-egress, public-safety diff, package extraction
  (98 files), both deterministic smokes, and `git diff --check` passed.
- Active Docker `--network none`: 5/5 passed, including blocked external DNS,
  offline Pi 0.80.7 package load, and localhost-only mock inference.
- No live provider endpoint was needed or contacted for these deterministic
  remediations. Remote matrix/package/no-egress results belong to the exact
  pushed remediation SHA and must not be inferred from an earlier commit.

## 2026-07-18 — Consolidated exact-head review closure

Status: the union of the subsequent Fable 5 and Codex 5.6 exact-head findings
is closed canonically in one implementation change. Local evidence is complete;
remote evidence belongs only to the exact commit after its normal push.

Accepted findings and resolution:

- A result could exist beyond the last scheduler checkpoint, while continuation
  either replayed a stored recoverable failure forever or truncated the newer
  journal suffix and repeated a completed call. Checkpoint schema v2 now stores
  a durable pre-invocation intent, consumed lifetime effect, invocation ordinal,
  cumulative elapsed time, and result phase. The journal retains every suffix;
  continuation reconciles one exact outcome into the prior intent, heals a
  pending journal write, or refuses an absent/ambiguous outcome. A completed
  call is never repeated. A rolled-back incomplete mutating attempt may retry
  only as a new counted invocation.
- Adapter exceptions and invalid envelopes could share an allowlistable code.
  Outcomes now carry a closed failure class. Only explicit agent failures are
  retryable or settle-maskable; scheduler-, identity-, workspace-, journal-,
  budget-, cancellation-, adapter-, and envelope-owned failures are
  structurally non-maskable in parallel and map nodes.
- Parent import and consent validated only the parent's cast. Deployment
  preflight now resolves the complete pinned direct-child closure and includes
  every child cast, effort, inventory, provider, account, certification, host
  effect, and objective-check requirement before write or confirmation.
- Parallel/map dispatch could launch a partial wave before discovering that the
  whole first wave did not fit. All pending first attempts reserve atomically;
  insufficient capacity launches zero calls. Cancellation status is preserved
  instead of being rewritten as failure.
- Decision transition loops were not graph-validated. Every cyclic decision
  edge now requires `loop: true` and a valid `loops_off` escape; loop markers on
  acyclic edges refuse. The validator covers both transitions and defaults.
- Mixed mock/configured casts now route each member to its matching adapter.
  Import/create commands receive current model inventory. Exact runtime status
  requires non-null requested/effective account values and rejects an
  unrequested effective route. Provider certification reports prospective
  session/deployment evidence without claiming a response that has not run.
- `max_run_ms` is cumulative across pause and interruption. Runtime smoke builds
  and validates a recursive schema witness, includes child events in observed
  counts, and accepts bounded nested inputs. Public builder, visualization, and
  canonical serialization surfaces return bounded stable refusals for malformed
  JSON-compatible input.
- Workflow and workspace limits now come from exported constants, have
  exact/one-over regressions, and are value-pinned in documentation. Legacy v1
  definitions containing host-effect steps refuse instead of silently dropping
  them. Watch, pause, input, authoring, refusal guidance, and Pi path behavior
  received focused product regressions. CI now crosses both supported Node jobs
  with Pi 0.80.7 and 0.80.9 while retaining one aggregate required check.

Final local evidence:

- `npm test`: 685/685; worktree self-test 12/12; objective-loop self-test 8/8.
- Workflow conformance: 67/67; provider contracts: 27/27; docs truth,
  resources, static no-live-egress, public-safety diff, and both deterministic
  smokes passed. The extracted package contains 99 files and passed Pi RPC.
- Active Docker `--network none`: 5/5, including both denied external
  destinations, offline Pi 0.80.7 package loading, and localhost-only mock use.
- Focused continuation tests prove read-only result-checkpoint recovery and
  transient journal healing each use one call/effect; workspace-commit retry
  uses a second counted invocation; impossible parallel/map waves launch zero.
- Product regressions prove adapter/envelope failures cannot converge when
  allowlisted, mixed casts route correctly, and parent preflight renders the
  complete child cast.
- Boundary regressions prove 256/257 nodes, 256 KiB/one-over definitions,
  1 MiB/one-over inputs, condition depth 32/33, transition width 16/17, and the
  shared 16,384-file / 16-MiB-file / 64-MiB-total workspace limits.
- Live provider calls are outside this deterministic remediation and are not
  claimed. Exact-head Node 22.19/26, package RPC, and active no-egress results
  must come from the pushed commit's CI run.

## 2026-07-19 — Composed-boundary review closure

Status: the union of the Fable 5 and Codex exact-head findings against
`8a1adad6c21e8075e2a2dab783bf70f7461ca87f` is closed in one canonical change.
The central final-gate and lifetime-effect invariants remained sound; the
accepted findings were persistence, composition, schema, and product-boundary
defects.

Accepted findings and resolution:

- Journal loading now recomputes every `result_ref`, requires result/record
  status agreement, and rejects malformed values. Resume accepts a newer
  suffix only when every record identity maps to durable pending/in-flight
  state across the full parent/child checkpoint tree. Foreign suffixes are
  terminal drift; child journal-ahead results reconcile without replay.
- Private checkpoint publication is the scheduler commit point. Checkpoint
  document schema 2 durably carries old-snapshot cleanup and public-projection
  debt; failure after canonical publication no longer makes the scheduler roll
  back or report an undurable checkpoint. Schema 1 remains readable.
- Checkpoint continue consent is one-shot and bound to the recorded node visit,
  including child checkpoints. Concurrent named resumes are serialized by the
  existing repository-private run lease.
- Oversized, deeply nested, or aggregate-unhashable effect data returns stable
  non-maskable kernel failures. Workspace-fingerprint exceptions likewise
  close at the scheduler boundary instead of escaping as rejections.
- Child agents compile their own definition id, objective, and child run id.
  Parent/child input schemas are checked semantically before import, consent,
  run creation, and again at scheduler entry; no input projection or silent
  field dropping is permitted. Gate-only and child-only v4 workflows now pass
  product deployment.
- Complete reachability replaces distance-based cycle classification. Every
  cyclic decision edge is explicit, and escape validity is proved in the graph
  that actually runs when loops are disabled. Migration derives the required
  metadata without changing legacy loop semantics.
- The input-schema root must be the closed task object, and every accepted
  integer interval contains a safe integer. `uncertified-disabled` is
  unconditionally ineligible for exact runtime selection.
- v4 persistence writes canonical JSON. A separate bounded 512 KiB read
  envelope admits historical/pretty JSON before enforcing the 256 KiB
  canonical definition limit; exact-limit save/list/watch/resume round trips.
- Cancellation and pause render truthfully, blank non-string prompt values use
  default/omit semantics, and pre-run refusals no longer point at nonexistent
  watch records.

Focused evidence before the full gate: 140/140 across kernel, schema/limits,
runtime contract, product execution, and command UX suites. The final complete
local counts and exact-head remote CI result are appended only after those
checks execute on the committed head.

Complete local evidence before commit: `npm test` passed 698/698 with 0
skipped, plus worktree self-test 12/12 and objective-loop self-test 8/8.
Workflow conformance passed 79/79 and provider contracts 27/27. Documentation
truth, resources, static no-live-egress, public-safety diff, both deterministic
smokes, and `git diff --check` passed. The extracted package contains 99 files
and passed real Pi 0.80.9 RPC. Active Docker `--network none` passed 5/5 with
both external destinations denied, offline Pi 0.80.7 package loading, and the
localhost-only mock path. No live provider call was made or claimed. Exact-head
Node 22.19/26 and Pi 0.80.7/0.80.9 evidence belongs to the pushed commit's CI.

## 2026-07-19 — Independent recovery and execution-boundary closure

Status before this change: HOLD at exact head
`77421126a63efa3f97be92bdbd4208ce4919a2da`. The union of the independent
Fable 5 and Codex findings was accepted. A separate read-only GPT-5.6 Sol
review reproduced every blocking mechanism and found the coupled
serialized-writer identity race. The canonical closure is:

- Shared writers now acquire the writer mutex before resume/cache/identity and
  before-state work. `workspace.begin` compares that locked fingerprint with
  the private snapshot; a stale process-restart generation is removed and
  retaken. A real checkpoint-effect crash-residue regression proves rollback
  preserves intervening committed work, and concurrent writers prove every
  journal `before_ref` equals its transaction before-state.
- Scheduler output and active-result admission use a 15 MiB payload ceiling
  inside the 16 MiB checkpoint document and retain 16 KiB compact-failure
  headroom. The effect journal enforces the same 8 MiB ceiling on append and
  reopen. Aggregate overflow is rolled back and durably recorded as the compact
  `kernel-result-capacity-exceeded`; an on-disk regression reopens the journal
  and resumes with zero additional calls.
- Usage is a closed nonnegative safe-integer pair. Malformed telemetry fails
  without false zero accounting, provider and panel sums use checked addition,
  and budget reserve/account/commit overflow refuses without mutating totals.
- Abort-policy parallel/map dispatch is stop-aware. It drains only work already
  started, prevents queued shared writers from calling after the decisive
  failure, and releases every unused first-wave reservation.
- General reachability now follows operational decision edges. An inert
  acyclic `loops_off` is rejected and removed during migration; valid cyclic
  loop-disabled escapes remain supported.
- Event, clock, artifact, checkpoint, and child-resolution host failures close
  into stable kernel results. Timer and abort-listener ownership is bounded.
  Internal run deadlines are failed timeouts, external aborts are cancellations,
  and schema-1 continuation refuses rather than resetting elapsed lifetime.
- Attended workflow numbers use complete JSON number tokens; workflow iteration
  and cast-member counts use canonical unsigned decimal tokens. Hexadecimal,
  leading-zero, signed-plus, exponent-count, and unsafe count spellings refuse
  before mutation confirmation.

Focused regression evidence before the complete release gate: 172/172 across
kernel, schema/limits, runtime contract, product execution, command core,
extension, and control-surface suites. Complete local evidence before commit:
`npm test` passed 708/708 with 0 skipped, worktree self-test 12/12, and
objective-loop self-test 8/8. Workflow conformance passed 86/86 and provider
contracts 27/27. Documentation truth, resources, static no-live-egress,
public-safety diff, both deterministic smokes, and `git diff --check` passed.
The extracted package contains exactly 99 files and passed real Pi 0.80.10 RPC.
The existing pinned Docker image passed the active `--network none` smoke 5/5,
including offline Pi 0.80.7 package loading and the localhost-only mock path.
No live provider call was made or claimed. Exact-head CI and the independent
post-ship review are appended below after they exist.

Remote evidence for remediation commit
`5dfbc81eda3b4aff9c0aa1ff81602c135cdd1082`: exact-head push CI run
`29675265619` completed successfully. All four Node 22.19/26 × Pi
0.80.7/0.80.9 matrix jobs passed every substantive step, including 708/708,
package RPC, deterministic smokes, active Docker, and diff checks; the aggregate
`test` job also completed successfully. The independent post-ship review is the
remaining release-quality gate before live testing.

## 2026-07-19 — Exact agent-contract and durable-state closure

Status before this change: HOLD at exact head
`b8384c92c5436455f18722fea29c45a12892cdee`. The fresh-context GPT-5.6 Sol
xhigh review revalidated the earlier Fable/Codex recovery closure and accepted
the following additional contract and composition findings. The canonical
closure is:

- Executable v4 roles, prompt id, output schema, tool allowlist, mutation mode,
  workspace policy, artifact contract, visit, attempt, iteration, and run
  namespace are now closed at schema validation and propagated without
  widening through prompt construction, product execution, Pi session
  creation, and RoleEnvelope validation. A non-`ok` envelope,
  requested/effective tuple drift, or schema-invalid value cannot converge.
- Every `active.completed` value must map to its exact reconciled journal
  identity. Active visit state, visit counters, immutable definition ceilings,
  safe budget totals, and nested child scheduler state are recursively
  validated before execution. Caller-supplied and checkpoint budget state may
  report a truthful provider overshoot but cannot raise the workflow maxima.
- Provider usage is absent/zero or one complete safe-integer pair. Valid usage
  from failed calls is retained and durably accounted; malformed, partial, or
  aggregate-unsafe usage becomes a stable failure. Journal-ahead accounting is
  reverted if its checkpoint cannot be published, so a later continuation
  neither loses nor double-counts it.
- Repeated agent, pipeline, parallel, map, and subworkflow visits use
  visit-scoped instance and child-run identities. An earlier visit can never be
  mistaken for a later visit's completed work or checkpoint namespace.
- Mutating execution now requires the complete workspace transaction surface;
  declared artifacts require an exact verifier and hash. Workspace begin,
  serialize, commit, rollback, and finalize failures close as scheduler
  results, and serialization failure restores before-state. Gate exceptions
  and malformed gate returns are kernel failures rather than authored
  `on_fail` evidence.
- `limits.structured_repair_attempts` is implemented as a real bounded repair
  loop. Every repair is a separately reserved, called, journaled, and observed
  lifetime effect. The closed workspace policy is limited to the one supported
  canonical-worktree/unchanged/off combination; unsupported persisted policy
  values refuse instead of being ignored.
- Deterministic mock artifacts are created inside the counted candidate adapter
  call. Host artifact verification and objective gates only observe evidence;
  they no longer write convergence markers or unjournaled workspace state.
- OpenRouter preflight binds `/key`'s `creator_user_id`, exactly one active
  endpoint's model/tag/provider/quantization/parameters, and pins its tag and
  quantization. Execution requires the documented streamed response model,
  rejects optional route drift, and requires generation model/provider evidence.
  The opt-in certification CLI derives its attestation
  only after the same account, endpoint, response, usage, and generation checks
  succeed; no live command was run during this closure.

Focused suites and the complete local `npm test` gate pass 723/723 with zero
failures or skips, plus worktree self-test 12/12 and objective-loop self-test
8/8. Exact-head conformance, provider, documentation, package/Pi, Docker,
remote CI, and independent post-push review evidence are appended only after
they execute on the committed head.

Complete local evidence before commit: `npm test` passed 723/723 with zero
failures or skips, worktree self-test 12/12, and objective-loop self-test 8/8.
Workflow conformance passed 96/96 and provider contracts 32/32. Documentation
truth, resources, static no-live-egress, public-safety diff, both deterministic
smokes, and `git diff --check` passed. The extracted package contains exactly
99 files and passed RPC loading through local Pi 0.80.10. The active Docker
`--network none` proof passed 5/5 with both external destinations denied,
offline Pi 0.80.7 package loading, and the localhost-only mock path. No live
provider or model service was contacted. Exact-head remote CI and the
independent post-push review remain pending until the committed head exists.

## 2026-07-19 — Scoped-budget and production Pi-path review closure

Review identity: fresh-context GPT-5.6 Sol xhigh reviewed exact head
`e167966e87baaa3664f90e23d1bf2995aee6e61c` after exact-head CI run
`29678122220` passed. The review returned HOLD and identified four canonical
closure requirements:

- The OpenRouter audit proxy accepted no quantization control and conflated the
  endpoint tag with the response/generation provider name. The request now
  requires the complete exact routing object including `quantizations`, compares
  it semantically rather than by property order, and compares provider metadata
  with the certified provider name. Distinct tag/provider fixtures and a
  substituted-provider regression prove both sides.
- Injecting the shared parent budget directly into a child could raise the
  child's `max_total_effects`. Each child invocation now owns a checkpointed
  scoped ledger enforcing the child ceiling while forwarding every reservation,
  consumption, usage account, reversal, and release to the one parent lifetime
  ledger. Regressions cover parent-greater, child-greater, repeated child visits,
  and paused-child continuation.
- Pi may perform several assistant/provider turns while satisfying one prompt
  through tools. Exact real Pi execution is therefore one read-only, tool-free
  provider turn with all Pi retry layers disabled. Tool-bearing or mutating real
  definitions refuse before credential/control-plane access, and a session
  returning more than one assistant turn is rejected. Deterministic mocks retain
  the complete workflow tool/mutation contract.
- The old package/Pi evidence loaded commands and raw Pi but did not traverse
  the shipped adapter's default session factory. `check:package -- --pi-bin`
  now imports the extracted adapter, uses the actual supported Pi SDK and real
  default factory, sends one exact request through the localhost audit proxy to
  an injected in-memory upstream, and verifies the pinned route, quantization,
  provider, model, usage, one-turn count, generation observation, and
  attestation. A retryable fixture failure also proves the default factory makes
  exactly one provider attempt. It performs no live provider call.

Focused closure evidence: kernel/product/adapter/proxy 102/102, provider
contracts 35/35, and workflow conformance 98/98. The complete local `npm test`
gate passes 728/728 with zero failures or skips, worktree self-test 12/12, and
objective-loop self-test 8/8. Documentation truth, resources, static
no-live-egress, public-safety diff, both deterministic smokes, active Docker
5/5, and `git diff --check` pass. Every package mode produces exactly 99 files;
disposable Pi 0.80.7 and local Pi 0.80.10 both pass extracted RPC plus the real
default-factory proof. No live provider or model service was contacted. Committed exact-head CI and
fresh-context Sol rereview remain pending.

First exact-head CI attempt `29679831694` exposed one compatibility defect in
the new proof: Pi 0.80.9 passed on Node 22.19/26, but both Pi 0.80.7 legs failed
inside the real default factory because 0.80.7 exports the pre-ModelRuntime
AuthStorage/ModelRegistry session contract. The canonical correction belongs in
the single Pi import seam: it capability-selects ModelRuntime when exported and
otherwise requires the supported in-memory AuthStorage/ModelRegistry pair. The
adapter builds the same isolated exact provider/model/key binding through either
surface. The failed run remains historical evidence; a new exact-head run must
pass every leg before rereview.

## 2026-07-19 — Nested continuation-budget containment

Exact-head CI run `29680060803` passed all four Node/Pi matrix legs and the
aggregate gate at `836b8efef8cdb02fc4738ac313f94de592f33102`. A fresh-context
Sol rereview passed the identity gate and independently reproduced a checkpoint
consistency defect twice before its review run was interrupted: a paused parent
and child snapshot could reset the outer effects/tokens/cost totals below the
nested child ledger. Resume then treated the reset parent total as authoritative,
made additional provider calls beyond the declared parent lifetime ceiling, and
could report success with the understated outer total.

Recursive checkpoint validation now requires nested child effects, tokens,
cost, and reservations to be no greater than the enclosing parent snapshot.
The paused-child continuation regression resets all consumed parent totals,
expects `kernel-checkpoint-child-invalid`, and proves that no additional call
starts; the unchanged checkpoint still resumes and preserves exact totals.
Post-fix local evidence: `npm test` passes the unchanged 728/728 Node baseline,
worktree 12/12, and objective loop 8/8; workflow conformance passes 98/98 and
provider contracts 35/35. Documentation truth, resources, static checks, both
deterministic smokes, `git diff --check`, the 99-file extracted package with
real default-factory proof, and active Docker 5/5 all pass. Exact-head CI and
fresh-context review evidence follow only after they run on the committed fix.

The next fresh review found the necessary second-order closure: resetting the
parent and child totals together satisfied containment while discarding the
same lifetime usage at both levels. A deterministic paused-child probe resumed
a second provider call and reported only one effect despite two durable journal
records. Root checkpoint admission now computes an independent lower bound from
the exact durable journal prefix plus in-flight/completed checkpoint state not
yet represented by that prefix. Stored effects, tokens, and cost below this
evidence refuse as `kernel-checkpoint-budget-invalid`; the coordinated-reset
regression proves zero additional calls while the original journal-ahead and
unchanged-resume paths remain supported.

Post-closure local evidence: `npm test` passes 728/728 with zero skips,
worktree 12/12, and objective loop 8/8; workflow conformance passes 98/98 and
provider contracts 35/35. Documentation truth, resources, both deterministic
smokes, static checks, `git diff --check`, the extracted 99-file package with
Pi RPC/default-factory proof, and active Docker 5/5 all pass. Exact-head CI and
a fresh final review remain pending until this closure is committed and pushed.

The following exact-head review reproduced one adjacent reconciliation defect:
two journal-ahead in-flight identities could be swapped while their durable
records retained distinct node-instance bindings. Suffix set membership still
passed, and resume assigned each result and usage to the other parallel member.
`validateCompletedJournalState` now validates every found in-flight record's
node, instance, base identity, and mutation mode before suffix admission. A
two-member deterministic result-checkpoint failure leaves both records ahead,
swaps only checkpoint identities, and proves `kernel-checkpoint-journal-invalid`
with zero additional calls.

Post-fix local evidence: `npm test` passes the 729/729 Node baseline with zero
failures, worktree 12/12, and objective loop 8/8; workflow conformance passes
99/99 and provider contracts 35/35. Documentation truth, resources, static
checks, both deterministic smokes, `git diff --check`, the extracted 99-file
package with Pi RPC/default-factory proof, and active Docker 5/5 all pass. The
focused kernel suite and the journal-ahead parent/child recovery paths also pass.
Exact-head CI and a fresh final review remain pending until this closure is
committed and pushed.

The final Fable exact-head review confirmed every prior closure but reproduced
two composition defects. First, a genuine child journal-ahead intent could be
promoted into a colliding parent node because journal records and effect base
identities lacked the executing scheduler namespace. Resume then consumed the
child result as parent work, skipped the declared parent call, and succeeded.
Journal schema 3 now persists `run_id`, base identities include it, every
lookup/reconciliation path requires it, and schema-1/2 records remain readable
but cannot prove active continuation. The regression constructs the exact
parent/child collision, proves refusal with zero additional calls, then proves
the unchanged checkpoint resumes the child and executes the real parent effect.

Second, abort fan-out rediscovered its terminal failure by definition order, so
a lower-index retrying sibling's synthetic `kernel-branch-aborted` result could
replace the higher-index agent failure that triggered the stop and render as an
operator cancellation. Coordination now retains the first stop-triggering
result and all three selection sites use it. Parallel, map, and expanded-member
regressions prove the decisive agent code remains a failed terminal while no
unstarted provider work is launched.

Post-fix local evidence: `npm test` passes 731/731 with zero failures or skips,
worktree 12/12, and objective loop 8/8; workflow conformance passes 101/101 and
provider contracts 35/35. Documentation truth, resources, both deterministic
smokes, static checks, `git diff --check`, the extracted 99-file package with Pi
RPC/default-factory proof, and active Docker 5/5 all pass. Exact-head CI and a
fresh-context review remain pending until this closure is committed and pushed.

## 2026-07-20 — Original Fable architecture review preservation

The original review-only architecture roadmap was recovered from the retired
Documents checkout and archived byte-for-byte as
`reviews/workflows/FABLE_ARCHITECTURE_ROADMAP_2026-07-16.md`. Its SHA-256 is
`31fbbf714c920310a7c58bd43d623e7981900e246cf683123bb2ab4fa2ed7f79`.
`ROADMAP_SOL.md` remains the controlling architecture and supersedes the
historical review wherever their recommendations differ. This preservation
changes documentation provenance only; it does not change implementation or
release status.

## 2026-07-22 — Graph-mode implementation Review 1 and closure

The dedicated `graph-mode` branch adds a secondary typed-edge transition
resolver over the same normalized WorkflowDefinition v4 and the same scheduler,
effects, budgets, workspace, journal, checkpoint, child, and final-gate paths.
Original-mode remains default and retains its legacy execution/runtime hashes.
The product now consents and persists mode, renders typed planned/observed
graphs, provides hygienic graph-fragment construction, and compares deterministic
original/graph execution without provider calls.

Fresh read-only Codex review session
`019f8a18-20d9-7b52-8b54-b996453aaf04` attested model `gpt-5.6-sol` and
reasoning effort `xhigh`. Review 1 returned **HOLD** with no Critical, one High,
three Medium, and two Low findings: injected kernel runtime refs could bypass
resume-mode identity; observed events admitted corrupt modes/kinds/edges;
current/last and child projection were absent; smoke compared aggregate counts;
the attended graph E2E stopped at confirmation; and this ledger was missing.

All six findings now have branch-scoped closures and regressions. The kernel
derives graph runtime identity and uses explicit scheduler checkpoint schema 3,
while schemas 1/2 remain original-only recursively. Observed admission is closed
and mode-aware, graph transitions require exact edge identity, child structural
events retain mode/target/edge fields, and pinned child definitions support
nested current/last rendering. Smoke uses independent worktrees and compares the
complete normalized result, ordered trace, journal structure, and final
workspace fingerprint. The attended extension test now covers graph consent,
pause, watch, resume, completion, and cleanup.

Focused post-fix evidence currently includes graph/schema/parity 24/24 and the
attended extension suite 25/25. The pre-review full gate was 764/764 plus all
document, resource, policy, package-structure, public-safety, and deterministic
no-egress checks, but that evidence predates these closures. The branch remains
**HOLD** until the complete gate is rerun and a fresh exact-model all-scope
review reports no Critical, High, or Medium findings.

Post-closure full verification is now complete for every locally available
gate. `npm test` passes 769/769 with zero failures or skips, including worktree
12/12 and objective loop 8/8; workflow conformance passes 130/130; provider
contracts pass 35/35. Documentation truth, resources, repository policy,
public-safety diff, and static no-live-egress checks pass. The extracted
100-file package passes through the installed Pi 0.80.10 real RPC and default
session factory. Active Docker lockdown passes 5/5 with both external probes
blocked, offline package loading, and localhost-only mock execution. The
machine has Node 24.16.0 and an installed Node 22.16.0, but no supported exact
Node 22.19 or Node 26 runtime; the supported-node matrix is therefore recorded
unavailable without installing or substituting dependencies and the Node 24
result is not represented as matrix evidence. The branch remains **HOLD** only
for the required fresh exact-model all-scope Review 2.

## 2026-07-22 — Graph-mode implementation Review 2 and closure

Fresh read-only Codex session `019f8a40-3b98-78f1-9f50-ae8340c0b91c`
attested model `gpt-5.6-sol` and reasoning effort `xhigh`. Review 2 returned
**HOLD** with no Critical or High, two Medium, and two Low findings. It
reproduced non-exact, non-definition-bound observed streams; mode divergence
when an injected adapter mutated a live node; locale-dependent canonical graph
and fragment order; and accessor execution in public combinators.

All four findings are closed. Each parent/child scheduler now clones and deeply
freezes its admitted definition, while expansion, agent, gate, and artifact
callbacks receive detached copies. Observed parent and pinned-child streams now
require an exact start/resume binding, definition hash, mode placement, run id,
contiguous sequence, and closed required/optional fields for every event kind.
Canonical graph and fragment ordering uses locale-independent code-unit
comparison. Every new combinator admits descriptor-safe bounded JSON and
returns stable refusals for getters, proxies, cycles, excessive depth, and
executable values without invoking them.

Focused post-closure evidence passes graph/schema/parity 46/46 and the product
command, attended E2E, execution, persistence, watch, resume, and child suites
122/122. Complete locally available re-verification now passes `npm test`
771/771 plus worktree 12/12 and objective loop 8/8, workflow conformance
132/132, and provider contracts 35/35. Documentation truth, resources,
repository policy, public-safety diff, static no-live-egress, and diff checks
pass. The extracted 100-file package passes through installed Pi 0.80.10 real
RPC and default session factory; active Docker lockdown passes 5/5. The exact
supported Node 22.19/26 matrix remains unavailable locally without installing
or substituting runtimes and has not been misrepresented by the Node 24.16.0
result. Fresh exact-model Review 3 remains pending, so the branch stays
**HOLD**.

## 2026-07-22 — Graph-mode implementation Review 3 and closure

Fresh read-only Codex session `019f8a65-cee8-7eb1-9fd8-040caf33924d` was
launched under the CLI's host-reported `gpt-5.6-sol` model and `xhigh` reasoning
effort. Its final report preserved the narrower attestation boundary that those
fields were not independently visible from inside the reviewer interface.
Review 3 returned **HOLD** with no Critical or High, five Medium, and two Low
findings. It reproduced a schema-3/original checkpoint combination, self-trusted
child runtime/task hashes, unbound child event namespaces, contradictory gate
histories, a schema-4 subworkflow watch regression, corrupt run-list entries for
child-definition companions, Proxy trap execution, missing canonical fragment
size admission, overstated prior closure, and an incomplete graph parity matrix.

All findings are closed without rewriting the historical Review 2 record.
Scheduler schema 3 is graph-only; schemas 1/2 remain original-only; recursive
child checkpoints inherit the parent's expected runtime/task hashes and refuse
before resolver/checkpoint callbacks. Observed child ids derive from the exact
parent run/node/visit, and gate events bind authored finality plus their
pass/fail/loops-off transition. Schema-4 child wrappers have a closed opaque
original-mode adapter that preserves parent watch progress without trusting a
mutable child definition. Strict child-definition companion filenames no longer
surface as corrupt records. Fragment admission detects proxies before reflection
and enforces the exact canonical UTF-8 byte limit.

The shared 51-test kernel adversarial suite is now parameterized and rerun under
graph-mode in both the repository and workflow-conformance gates. This exercises
retry/repair accounting, fan-out abort attribution and reservations, workspace
rollback/conflict/finalization, journal/checkpoint reconciliation, capacity,
child budgets and continuation, cancellation, and deadlines through the
secondary resolver. Focused graph/schema/parity/product evidence passes 117/117;
the graph-mode kernel matrix passes 51/51. Complete gate re-verification and a
fresh Review 4 remain pending, so the branch stays **HOLD**.

Complete locally available post-closure verification now passes `npm test`
827/827 (776 primary plus 51 graph-mode kernel), worktree 12/12, objective loop
8/8, workflow conformance 186/186 (135 primary plus the same 51-test graph-mode
kernel matrix), and provider contracts 35/35. Documentation truth, resources,
repository policy, public-safety diff, static no-live-egress, and diff checks
pass. The extracted 100-file package passes installed Pi 0.80.10 real RPC and
default-factory execution; active Docker lockdown passes 5/5. Exact local Node
22.19/26 matrix binaries remain unavailable without installation/substitution;
the full local Node 24.16.0 results are not represented as matrix evidence. The
branch remains **HOLD** only for fresh all-scope Review 4.

## 2026-07-22 — Graph-mode implementation Review 4 and closure

Fresh read-only Codex session `019f8a83-c2a4-7213-99a6-9ed6c41645bc` was
launched under the CLI's host-reported `gpt-5.6-sol` model and `xhigh` reasoning
effort. Review 4 returned **HOLD** with no Critical or High, three Medium, and
one Low finding. It reproduced orphan effect completion and forged nonterminal
success in observed admission; rejected valid digit-, dot-, and underscore-led
workflow ids plus the maximum version in child companion discovery; cloned
over-limit fragment input before measuring its canonical bytes; and exposed a
frozen kernel artifact reference to adapter callbacks.

All four findings are closed. Observed lifecycle admission now requires exact
effect start/end correlation, no open effects at node/run completion, valid
retry/resume history, and an authored succeeded terminal reached through a
recorded final-gate pass; completed public state must match the last run-end.
One shared schema helper generates and parses strict child companion names with
the complete workflow-id/version grammar. Fragment admission enforces the exact
canonical UTF-8 ceiling before structured clone. Artifact callbacks receive a
detached mutable copy while kernel state remains immutable. Focused graph,
schema, run-manager, kernel, execution, and product regressions pass 164/164.
Complete locally available re-verification passes `npm test` 829/829 (778
primary plus the 51-test graph-mode kernel), worktree 12/12, objective loop 8/8,
workflow conformance 188/188 (137 primary plus the same graph kernel matrix),
and provider contracts 35/35. Resources, documentation truth, repository policy,
public-safety diff, static no-live-egress, syntax, and diff checks pass. Both
100-file extracted-package paths pass, including installed Pi 0.80.10
RPC/default-factory proof; active Docker lockdown passes 5/5. Exact Node
22.19/26 matrix binaries remain unavailable locally without
installation/substitution, and Node 24.16.0 evidence is not represented as
matrix proof. Fresh all-scope Review 5 remains pending, so the branch stays
**HOLD**.

## 2026-07-22 — Graph-mode implementation Review 5 and closure

Fresh read-only Codex session `019f8aa5-4c60-7113-9287-44c65e1f3e8b` was
launched under the CLI's host-reported `gpt-5.6-sol` model and `xhigh` reasoning
effort. Review 5 returned **HOLD** with no Critical or High, three Medium, and
no Low findings. It reproduced an orphan `effect-resumed` completion, a parent
subworkflow advancing without any successful child run, and legitimate complete
kernel failures that had no run-end and therefore could not pass watch binding.

All three findings are closed. Schema-5 effect admission is now scoped to
effect-capable node visits, closes exact preserved starts on resume, prevents
instance reuse, and binds repair/retry to the exact failed agent attempt and
failure class. A successful subworkflow node requires its derived child stream
to end successfully before parent completion or transition. Every complete
post-start failed/refused/cancelled result now passes through one scheduler
terminalizer, which emits and checkpoints exact node-end/run-end evidence at the
current nonterminal node; checkpoint-derived recoverable interruptions preserve
their continuation. Successful terminal authority remains exclusively with the
authored final objective gate. Focused kernel/schema plus high-fidelity product
failure/resume watch regressions pass 76/76 in original-mode and graph-mode.
Complete locally available re-verification passes `npm test` 829/829 (778
primary plus the 51-test graph-mode kernel), worktree 12/12, objective loop 8/8,
workflow conformance 188/188 (137 primary plus the same graph kernel matrix),
and provider contracts 35/35. Resources, documentation truth, repository policy,
public-safety diff, static no-live-egress, syntax, and diff checks pass. Both
100-file extracted-package paths pass, including installed Pi 0.80.10
RPC/default-factory proof; active Docker lockdown passes 5/5. Exact Node
22.19/26 remains unavailable locally without installation/substitution; the
installed 22.16.0 and current 24.16.0 results are not represented as matrix
proof. Fresh all-scope Review 6 remains pending, so the branch stays **HOLD**.

## 2026-07-22 — Graph-mode implementation Review 6 interrupted audit and closure

Fresh read-only Codex session `019f8ac9-9c5a-7951-be6b-bfcd812000e0` was
launched under the CLI's host-reported `gpt-5.6-sol` model and `xhigh` reasoning
effort. It completed identity checks and extensive branch-wide inspection, then
reproduced four lifecycle/persistence defects in both execution modes before
the reviewer service blocked final report generation after 360,549 tokens. The
audit is recorded as interrupted, not as a completed clean review. Its evidence
showed that a closed failure checkpoint replayed the provider; a journal-ahead
result lost its public start and then emitted an inadmissible resumed event; a
first-checkpoint failure left only `run-start`; and a sequential forged retry
trace could exceed the authored retry maximum.

All four reproduced paths are closed. Closed private checkpoints now carry an
exact terminal result and replay it without effects. Journal-ahead admission has
a distinct recovered-effect event, while ordinary resume still requires an
exact preserved start. The observed automaton binds canonical instance shape,
visit, retry count, and structured-repair count to the authored definition;
runtime expansion cannot raise the authored retry ceiling. A checkpoint-derived
failure remains resumable only after a prior durable checkpoint, while failure
of the first checkpoint leaves an incomplete nonresumable product initialization
record with an empty committed prefix. Regression
evidence passes kernel/schema 79/79, the complete graph-mode kernel matrix 54/54,
and graph/product command, persistence, watch, resume, child, smoke, and attended
E2E coverage 149/149. Complete locally available re-verification passes
`npm test` 837/837 (783 primary plus 54 graph-mode kernel), worktree 12/12,
objective loop 8/8, workflow conformance 196/196 (142 primary plus the same
graph kernel matrix), and provider contracts 35/35. Resources, documentation
truth, repository policy, public-safety diff, static no-live-egress, syntax, and
diff checks pass. Both 100-file extracted-package paths pass, including
installed Pi 0.80.10 RPC/default-factory proof; active Docker lockdown passes
5/5. Exact Node 22.19/26 remains unavailable locally without installation or
substitution, and current Node 24.16.0 evidence is not represented as matrix
proof. A fresh all-scope Review 7 remains pending, so the branch stays **HOLD**.

## 2026-07-22 — Graph-mode implementation Review 7 and closure

Fresh read-only Codex session `019f8aeb-5127-7d93-8763-36152196cc32` was
launched under the CLI's host-reported `gpt-5.6-sol` model and `xhigh` reasoning
effort. The reviewer interface reported only “GPT-5 Codex” and did not expose a
separate effort label, so those exact fields remain host-attested. Review 7
returned **HOLD** with no Critical or High, three Medium, and no Low findings.
It reproduced successful agent, pipeline, and parallel public histories with no
effects; laundering of a failed agent effect into node success; graph-mode
binding hashes that changed between `en-US` and `da-DK`; and deterministic smoke
success whose host verifier and gate invented evidence absent from the
workspace.

All three findings are closed. Agent-bearing visits emit a bounded structural
effect plan, and schema-5 admission proves every logical agent, pipeline,
parallel, and map slot before successful node completion. Pipeline stages must
settle in order; panel member indices are contiguous; a later attempt requires
an explicit retry/repair control of its predecessor; and the final outcome must
be successful or an authored settled-agent allowlist match. Empty maps remain
valid zero-slot visits, and recursive child admission applies the same rule.
Graph-mode consent identity uses Unicode code-unit ordering for presets and
pinned child keys, while original-mode retains its exact historical
locale-sensitive input. Runtime smoke now writes required synthetic artifacts
inside the counted candidate transaction, hashes the actual file during
verification, and executes the authored deterministic gate against the
disposable worktree. It no longer selects a preferred gate result.

Focused lifecycle, retry, panel, map, nested-child, locale, renderer, smoke,
kernel, and product regressions pass. The complete repository gate passes
840/840 (786 primary plus the 54-test graph-mode kernel), worktree 12/12, and
objective loop 8/8. Workflow conformance passes 198/198 (144 primary plus the
same graph kernel matrix), and provider contracts pass 35/35. Resources,
documentation truth, repository policy, public-safety diff, static
no-live-egress, syntax, and diff checks pass. Both 100-file extracted-package
paths pass, including installed Pi 0.80.10 RPC/default-factory proof; active
Docker lockdown passes 5/5. Exact Node 22.19/26 remains unavailable without
installation/substitution. A fresh all-scope review remains pending, so the
branch is **HOLD**.

## 2026-07-22 — Graph-mode implementation Review 8 and closure

Fresh read-only Codex session `019f8b0f-e8a8-7822-9436-6639b98c300a` ran under
the CLI's host-reported `gpt-5.6-sol` model and `xhigh` reasoning effort and
returned **HOLD** with no Critical, one High, one Medium, and no Low findings.
It reproduced a terminal event-sink failure that still persisted a successful
terminal checkpoint and then resumed as success without terminal event
evidence. It also proved that an authored `command-exit-zero` gate could execute
an unrestricted mutation while Helix described the gate as read-only.

Both findings are closed. Every structural `emit()` is now authoritative before
the scheduler may call a provider, reuse/retry/repair an effect, route a gate,
forward a child event, transition, or publish a terminal checkpoint. Event-file
resume truncates to the last checkpointed prefix and re-emits the truthful
terminal pair. Command gates now preflight and execute through a macOS deny-by-
default sandbox or a Linux user/mount/network/PID namespace with a minimal
read-only chroot and dropped capabilities. Ambient credential variables are
removed, only ephemeral scratch is writable, and unsupported boundaries fail
closed. Exact before/after workspace fingerprints bind the evidence; named and
staged execution also snapshots and restores detected drift before returning a
failed gate.

Focused original-mode and graph-mode event-barrier tests pass 14/14. The product
event-file terminal interruption/resume E2E passes in both modes, command-gate
unit/integration coverage proves successful read-only execution, candidate and
outside-write denial, pre-aborted no-spawn behavior, drift refusal, and guard
restoration, and the full workflow-kernel matrices pass 60/60 in each mode. The
complete repository gate passes 855/855 (795 primary plus the 60-test graph-mode
kernel), worktree 12/12, objective loop 8/8, workflow conformance 211/211 (151
primary plus the same graph kernel), and provider contracts 35/35. Resources,
documentation truth, repository policy, public-safety diff, static no-live-
egress, syntax, and diff checks pass. Both 101-file extracted-package paths pass,
including installed Pi 0.80.10 RPC/default-factory proof; active Docker lockdown
passes 5/5. The command-gate write-denial integration passes on macOS and in a
capability-enabled Linux container; a restricted Linux container refuses the
sandbox probe before the authored command. Exact Node 22.19/26 remains
unavailable without installation/substitution. A fresh all-scope Review 9
remains pending, so the branch is **HOLD**.

## 2026-07-22 — Graph-mode implementation Review 9 and closure

Fresh read-only Codex session `019f8b42-2fd1-7bf1-999e-77733f90a688` ran under
the CLI's host-reported `gpt-5.6-sol` model and `xhigh` reasoning effort and
returned **HOLD** with no Critical, two High, one Medium, and no Low findings.
It proved that scheduler checkpoints bound only the event count, so a retained
event could be altered and active watch could render an uncheckpointed suffix.
It also found macOS global host reads, missing Linux IPC isolation, exposure of
the host Git common directory, and timeout/cancellation evidence finalized
before the child process confirmed closure.

All findings are closed. Public state and original/graph scheduler schemas 4/5
carry one rolling canonical ref over the exact ordered parent/child event
prefix. Event refs advance only after sink success. Resume authenticates the
prefix before truncation or effects; active watch authenticates and renders only
that prefix. Legacy scheduler schemas 1/2/3 and public schema 4 remain readable
history but cannot continue, including when nested beneath a bound parent.

The macOS deny-default profile now admits explicit candidate, runtime,
dependency, and fixed system read roots rather than global file reads. Both
platforms use a private credential-free Git configuration/index with read-only
object alternates instead of the host common directory; Linux adds its IPC
namespace. Timeout/cancellation sends a process-group kill and awaits `close`
before cleanup, after-fingerprinting, guard restoration, and normal evidence.
If bounded termination cannot be confirmed, Helix returns the stable
`objective-gate-termination-unconfirmed` failure and deliberately preserves
scratch/guard material rather than racing a live process.

Focused retained-prefix tamper, pre-resume suffix watch, nested-child binding,
outside/credential read denial, candidate read, sanitized `git status`, Linux
namespace flags, running-timeout ordering, and unconfirmed-termination tests
pass. Complete gate re-verification and fresh all-scope Review 10 remain
pending, so the branch is **HOLD**.

The first capability-enabled Linux verification exposed and closed one
platform-only mount-order defect: mounting the chroot's private `/tmp` after a
candidate below `/tmp` hid the candidate bind. Linux now mounts private scratch
first and then binds the read-only candidate/dependencies. The corrected
20-test container suite proves candidate read, candidate/outside write denial,
outside-credential read denial, sanitized Git status, IPC flags, and termination
behavior with network disabled. Host preparation also ignores a planted
`PATH`-selected Git executable, and the macOS profile has no broad
`/private/etc` or `/dev` read subtree.

Complete locally available re-verification passes `npm test` 860/860 (799
primary plus the 61-test graph-mode kernel), worktree 12/12, objective loop 8/8,
workflow conformance 213/213 (152 primary plus the same graph kernel), and
provider contracts 35/35. Both 101-file extracted-package paths pass, including
installed Pi 0.80.10 RPC/default-factory proof, and active Docker no-egress
passes 5/5. Resources, documentation truth, repository policy, public-safety
diff, static no-live-egress, syntax, and diff checks pass. Exact Node 22.19/26
remains unavailable without installation/substitution; the complete local gate
ran on supported Node 24.16.0, and the Node 22.16 Linux container is claimed
only as sandbox evidence. Fresh all-scope Review 10 remains pending, so the
branch is **HOLD**.

## 2026-07-22 — Graph-mode implementation Review 10 and closure

Fresh read-only Codex session `019f8b7b-fd40-7b11-815f-450c664c2eb0` ran under
the CLI's host-reported `gpt-5.6-sol` model and `xhigh` reasoning effort and
returned **HOLD** with no Critical, four High, no Medium, and one Low finding.
It reproduced public event authority ahead of its private checkpoint, a forged
nested child event ref, cancellation terminalizing while a provider or gate was
still live and losing late usage, routable sandbox-integrity failures, exposure
of the host Git object store through alternates, and an incomplete static
package-load inventory.

All findings are closed. Public count/ref authority now advances only after the
private scheduler checkpoint commits. Accepted JSONL tail events remain
unauthoritative; resume authenticates the parent prefix and derives every child
prefix from exact parent wrappers before provider certification, worktree
creation/restore, or suffix truncation. A checkpoint-write interruption E2E in
both modes proves public state stays on the durable prefix, active watch hides
the suffix, and resume replaces it with one contiguous truthful continuation.

Scheduler cancellation and deadlines abort the boundary, then wait a bounded
settlement window. A settled provider result retains and journals its actual
usage even when cancellation wins; a boundary that remains live returns a
nonterminal unknown outcome with no `run-end` or terminal checkpoint. Provider
in-flight identity remains durable and cannot be replayed. Sandbox,
termination, workspace-fingerprint, restoration, and cleanup uncertainty now
uses a typed structural gate error that original-mode, graph-mode, staged, and
smoke paths cannot route through an authored fail edge.

The objective-gate Git view no longer uses alternates or mounts a host object
directory. It packs the admitted HEAD-tree closure plus staged index objects
into a private database capped at 64 MiB, installs the exact private index, and
creates a deterministic parentless synthetic HEAD. Current `git status` works,
while a historical host-only object is unreadable in the sandbox. The sandbox
module is also named by the static extracted-package proof.

Focused kernel, graph-parity, product-resume, sandbox, and package tests pass
130/130. Complete verification passes `npm test` 866/866 (803 primary plus the
63-test graph-mode kernel), worktree 12/12, objective loop 8/8, workflow
conformance 219/219 (156 primary plus the same graph kernel), and provider
contracts 35/35. Both 101-file extracted-package paths pass, including installed
Pi 0.80.10 RPC/default-factory proof; active Docker no-egress passes 5/5, and the
capability-enabled Linux sandbox/task-loop suite passes 20/20 with network
disabled. Resources, documentation truth, repository policy, public-safety
diff, static no-live-egress, syntax, and diff checks pass. The complete local
gate ran on supported Node 24.16.0 and Linux sandbox proof on Node 24.18.0.
Exact Node 22.19/26 remains unavailable without installation/substitution.
Fresh all-scope Review 11 remains pending, so the branch is **HOLD**.

## 2026-07-22 — Graph-mode Review 11 closure

One exact `gpt-5.6-sol`/`xhigh` CLI attempt was interrupted by the reviewer
service before a verdict and is not counted. Fresh exact session
`019f8bc1-65c1-7332-9baa-cc0d129b3693` then completed the all-scope read-only
review of all 41 feature files, repeated the exact repository identity gate,
and returned **HOLD** with no Critical, two High, two Medium, and two Low
findings.

The accepted findings crossed gate recovery, product rendering, persistence,
Git object formats, and run discovery. Objective-gate launch previously lacked
a durable intent, so an unconfirmed command could run again after resume. The
CLI could overwrite that recoverable unknown result with cancellation/timeout.
A failure before the first private checkpoint could project completed public
state without an admitted terminal prefix. Resume read the event path without
the watch boundary's file-type and byte checks. Untracked fingerprints assumed
40-character Git object ids, and public schema-5 counts admitted negatives.

Every gate launch now checkpoints its exact run, definition, node, visit, and
objective identity, and every closed result is checkpointed before routing.
Resume reuses settled results and returns an unknown outcome for in-flight or
unconfirmed gates without relaunch. The CLI preserves recoverable kernel codes.
Product state without a first private checkpoint remains incomplete,
nonresumable, and watchable at the empty committed prefix. Resume admits only a
regular non-symlink event file no larger than 64 MiB. Untracked fingerprints
resolve the repository's SHA-1 or SHA-256 object format, and run discovery
requires nonnegative counts.

Focused closure evidence passes 113/113. Complete verification passes `npm
test` 870/870 (807 primary plus the 63-test graph-mode kernel), worktree 12/12,
objective loop 8/8, workflow conformance 222/222 (159 primary plus the same
graph kernel), and provider contracts 35/35. Both 101-file extracted-package
paths pass, including installed Pi 0.80.10 RPC/default-factory proof; active
Docker no-egress passes 5/5; and the capability-enabled Linux sandbox/task-loop
suite passes 21/21 with network disabled. Resources, documentation truth,
repository policy, public-safety diff, static no-live-egress, syntax, and diff
checks pass. The complete gate ran on supported Node 24.16.0 and Linux sandbox
proof on Node 24.18.0. Exact Node 22.19/26 remains unavailable without
installation/substitution. Fresh all-scope Review 12 remains pending, so the
branch is **HOLD**.

## 2026-07-22 — Graph-mode Review 12 closure

Fresh exact CLI session `019f8be7-92ee-7023-9b0d-0d4bb625d535` ran under the
host-reported `gpt-5.6-sol` model with `xhigh` reasoning, reviewed all 41 feature
files, repeated the exact repository identity gate, and returned **HOLD** with
no Critical, no High, one Medium, and no Low finding. Its 57/57 read-only
graph/schema slice passed.

The finding corrected the final overclaim in Review 11 count admission. Run
discovery rejected negative schema-5 event and journal counts, but watch,
resume rendering, and actual continuation did not share that boundary. Actual
resume checked only event count, so a hostile negative journal cardinality
could pass event-prefix authentication and reach provider certification.

One shared validator now requires event and journal cardinalities to be safe
and nonnegative at discovery, watch, resume rendering, and actual continuation.
Continuation additionally refuses either public count leading its private
scheduler and requires exact equality when no durable projection debt exists.
Documented projection lag is repaired, including journal count, before provider
certification. Negative, fractional, unsafe-integer, and journal-ahead fixtures
prove refusal before adapter access.

Focused command/discovery and product evidence passes 85/85. Complete
verification passes `npm test` 871/871 (808 primary plus the 63-test graph-mode
kernel), worktree 12/12, objective loop 8/8, workflow conformance 222/222 (159
primary plus the same graph kernel), and provider contracts 35/35. Both
101-file extracted-package paths pass, including installed Pi 0.80.10
RPC/default-factory proof; active Docker no-egress passes 5/5; and the
capability-enabled Linux sandbox/task-loop suite passes 21/21 with network
disabled. Resources, documentation truth, repository policy, public-safety
diff, static no-live-egress, syntax, and diff checks pass. The complete gate ran
on supported Node 24.16.0 and Linux sandbox proof on Node 24.18.0. Exact Node
22.19/26 remains unavailable without installation/substitution. Fresh all-scope
Review 13 remains pending, so the branch is **HOLD**.

## 2026-07-22 — Graph-mode Review 13 closure

Initial exact CLI session `019f8bfd-ac03-7cd1-a62e-7924f3ee6100` stopped in
reviewer classification without a verdict and is retained only as interrupted
evidence. Replacement exact session `019f8c04-7b03-7a21-b7e1-22144b22dc49`
ran under host-reported `gpt-5.6-sol` with `xhigh` reasoning, reviewed all 41
feature files, repeated the exact identity gate, and returned **HOLD** with no
Critical, two High, no Medium, and one Low finding.

Late provider success could override an already-won cancellation, run deadline,
or call timeout, allowing a mutation commit and later objective routing.
Command sandboxes exposed physical `.git` when the admitted candidate was an
ordinary checkout, despite also supplying a private sanitized Git database.
The valid projection-debt repair path traced correctly but had no positive
regression.

The agent boundary now converts every settled post-abort success to the exact
interruption/timeout result before commit or routing while retaining valid
usage in the lifetime budget and journal. Mutation rolls back and the objective
never starts. macOS admits only bounded candidate top-level entries other than
`.git`; Linux overlays in-tree metadata directories and linked-worktree pointer
files, leaving the sanitized snapshot as the only readable Git database. The
interrupted-resume E2E constructs valid lagging event/journal projections under
durable debt and proves repair plus debt clearing before the next workflow
event.

Complete verification passes `npm test` 874/874 repository tests (810 primary
plus the 64-test graph-mode kernel), worktree 12/12, objective loop 8/8,
workflow conformance 224/224 (160 primary plus the same graph kernel), and
provider contracts 35/35. Both 101-file extracted-package paths pass, including
installed Pi 0.80.10 RPC/default-factory proof; active Docker no-egress passes
5/5; and the capability-enabled Linux sandbox/task-loop suite passes 22/22 with
network disabled. Resources, documentation truth, repository policy,
public-safety diff, static no-live-egress, syntax, and diff checks pass. The
complete gate ran on Node 24.16.0 and Linux sandbox proof on Node 24.18.0. Exact
Node 22.19/26 remains unavailable without installation/substitution. Fresh
all-scope Review 14 remains pending, so the branch is **HOLD**.

## 2026-07-22 — Graph-mode Review 14 closure

The malformed-effort launch `019f8c25-5893-7c00-86e1-287d163a9849` was
rejected before review. Exact session `019f8c25-b3de-7b30-aa22-860f2992d1f1`
then stalled without a verdict and was interrupted. Neither is review evidence.
Exact replacement session `019f8c56-96d6-7922-adbf-f4cfce7a23ae` ran under
host-reported `gpt-5.6-sol` with `xhigh` reasoning, audited all 41 feature files,
repeated identity, and returned **HOLD — C0/H2/M2/L0**.

A syntactically bound schema-4/5 scheduler checkpoint could omit its retained
event array and bypass rolling-ref authentication before effects. A gate pass
settling after cancellation could be durably reused if terminal checkpointing
then failed. Product resume swallowed failure to clear repaired projection
debt before adapter certification. Incomplete legacy schema-4 watch parsed an
entire valid event file rather than slicing to its recorded count.

Checkpoint validation now requires the explicit exact event prefix for every
bound continuation and refuses omission before callbacks. Gate settlement
replaces any late pass/fail with the causal cancellation/deadline error before
checkpointing. Projection-debt clearing is a required durable write and its
failure refuses before adapter access. Schema-4 watch slices to recorded
authority. New both-mode kernel regressions cover forged omission and late gate
settlement followed by terminal persistence failure; product persistence and
legacy-watch regressions cover the two Medium paths.

Complete verification passes `npm test` 878/878 repository tests (812 primary
plus the 66-test graph-mode kernel), worktree 12/12, objective loop 8/8,
workflow conformance 228/228 (162 primary plus the same graph kernel), and
provider contracts 35/35. Both 101-file extracted-package paths pass, including
installed Pi 0.80.10 RPC/default-factory proof; active Docker no-egress passes
5/5; and the capability-enabled Linux sandbox/task-loop suite passes 22/22 with
network disabled. Resources, documentation truth, repository policy,
public-safety diff, static no-live-egress, syntax, and diff checks pass. Review
15 remains pending, so the branch is **HOLD**.

## 2026-07-22 — Graph-mode Review 15 closure

Exact all-scope session `019f8c75-5324-79c0-8eb2-3b54b1ec15b4` ran under
host-reported `gpt-5.6-sol` with `xhigh` reasoning, audited the exact 41-file
scope, repeated identity, and returned **HOLD — C0/H3/M1/L0**.

External checker/dependency ancestors could undo candidate `.git` exclusion;
Linux boundary helpers could fall back to authored `PATH` before containment;
timeout, cancellation, spawn failure, and process error were collapsed into an
authored `fail`; and malformed staged gate results could enter the same route.

External checkers now receive an exact-file admission only, any read root
containing the candidate refuses, and Linux installs its metadata mask after
external binds. `unshare`, `mount`, `chroot`, and `setpriv` resolve only from
fixed trusted system/Nix roots. Confirmed non-exit termination retains its typed
error cause after cleanup/restoration; only a real integer checker exit yields
pass/fail. The staged state machine admits only pass/fail without a code or a
valid typed error and refuses all other shapes.

Focused ordinary/linked parent-checker, hostile-helper, timeout, pre-abort,
spawn/process-error, and malformed staged-result regressions pass. Complete
verification passes `npm test` 882/882 repository tests (816 primary plus the
66-test graph-mode kernel), worktree 12/12, objective loop 8/8, workflow
conformance 228/228 (162 primary plus the same graph kernel), and provider
contracts 35/35. Both 101-file package paths pass, including installed Pi
RPC/default-factory proof; active Docker no-egress passes 5/5; and the
capability-enabled Linux sandbox/task-loop suite passes 25/25 with network
disabled. Resources, documentation truth, repository policy, public-safety
diff, static no-live-egress, syntax, and diff checks pass. Review 16 remains
pending, so the branch is **HOLD**. The complete gate ran on supported Node
24.16.0 and Linux proof on Node 24.18.0; exact Node 22.19/26 remains unavailable
without installation/substitution.

## 2026-07-22 — Graph-mode Review 16 closure

Exact all-scope session `019f8c96-124b-77d3-9076-90d342ee87de` ran under
host-reported `gpt-5.6-sol` with `xhigh` reasoning, audited the exact 42-file
scope, repeated identity, and returned **HOLD — C0/H3/M2/L0**.

Descendant and symlinked checker/dependency grants could expose physical Git
metadata; a retained `effect-end` could be followed by duplicate
`effect-resumed`; a resumed parent could discard the successful child terminal
it had authenticated; staged gate objects accepted extra fields; and late
operator-cancelled gates returned and persisted `failed` status.

Sandbox admission now resolves both ordinary and linked-worktree physical Git
metadata and rejects every command/runtime/dependency path intersecting it in
either direction. Scheduler resume derives retained effect state from the exact
event prefix, closes an open start once, emits recovered evidence only for an
absent journal-ahead start, and emits nothing for an already-closed effect.
Observed child terminal proof persists only through continuation of the same
parent node/visit. Staged gate admission now closes fields and types, while a
late `kernel-run-cancelled` gate remains status `cancelled`.

Focused kernel/sandbox/staged verification passes 116/116. Both-mode product
regressions prove unique effect completion and retained child success through
resume and watch. Complete verification passes `npm test` 888/888 repository
tests (820 primary plus the 68-test graph-mode kernel), worktree 12/12,
objective loop 8/8, workflow conformance 233/233 (165 primary plus the same
graph kernel), and provider contracts 35/35. Both 101-file package paths pass,
including installed Pi 0.80.10 RPC/default-factory proof; active Docker
no-egress passes 5/5; and the capability-enabled Linux sandbox/task-loop suite
passes 26/26 with network disabled. Resources, documentation truth, repository
policy, public-safety diff, static no-live-egress, syntax, and diff checks pass.
Review 17 remains pending, so the branch is **HOLD**. The complete gate ran on
supported Node 24.16.0 and Linux proof on Node 24.18.0; exact Node 22.19/26
remains unavailable without installation/substitution.

## 2026-07-22 — Graph-mode Review 17 closure

Exact all-scope session `019f8cc2-3418-77e3-be8d-778fa09102bd` ran under
host-reported `gpt-5.6-sol` with `xhigh` reasoning, audited the exact 42-file
scope, repeated identity, and returned **HOLD — C0/H2/M1/L0**.

Linked worktree admission covered its pointer and per-worktree administration
directory but omitted the resolved shared common Git directory. Fallback
command-gate fingerprints ran bare ambient Git before sandbox preparation, so
`PATH`, repository-targeting/configuration variables, or a local fsmonitor
could execute or redirect host discovery. Untracked symlinks were passed to
`git hash-object`, which dereferenced their external targets.

Candidate metadata resolution now validates and denies the shared common
directory as well as the linked pointer and per-worktree administration data;
explicit grants and implicit platform roots use the same bidirectional
intersection rule. Fingerprint and private Git-view discovery use fixed trusted
Git, a closed config-independent environment, and disabled repository-local
executable helpers. Untracked symlinks hash only their target text, non-regular
entries become structural markers, and regular contents must remain contained
and within per-file/aggregate byte ceilings.

Focused command-boundary coverage passes 30/30 on both macOS and capability-
enabled networkless Linux. Complete verification passes `npm test` 892/892
repository tests (824 primary plus the 68-test graph-mode kernel), worktree
12/12, objective loop 8/8, workflow conformance 233/233 (165 primary plus the
same graph kernel), and provider contracts 35/35. Both 101-file package paths
pass, including installed Pi 0.80.10 RPC/default-factory proof; active Docker
no-egress passes 5/5; and the capability-enabled Linux sandbox/task-loop suite
passes 30/30 with network disabled. Resources, documentation truth, repository
policy, public-safety diff, static no-live-egress, syntax, and diff checks pass.
Review 18 remains pending, so the branch is **HOLD**. The complete gate ran on
supported Node 24.16.0 and Linux proof on Node 24.18.0; exact Node 22.19/26
remains unavailable without installation/substitution.

## 2026-07-22 — Graph-mode Review 18 interrupted trace closure

Exact session `019f8cdf-b302-7a72-a8cb-876ce1895dfc` ran under host-reported
`gpt-5.6-sol` with `xhigh` reasoning and repeated the exact 42-file identity
gate, but a platform content-classification stop terminated the read-only audit
before it produced a report or severity verdict. Review 18 is therefore not an
admissible all-scope review result.

The partial trace nevertheless exposed a material terminal commit hypothesis.
Independent in-memory reproduction confirmed it in original-mode and graph-
mode: cancellation raised while a successful terminal checkpoint was being
persisted caused the direct call to return `cancelled` even though its final
event and durable terminal marker already recorded `succeeded`.

The scheduler now treats a successfully written terminal checkpoint as the
authoritative terminal commit and returns the same status/code as its retained
event prefix and marker. A dual-mode regression aborts inside terminal
checkpoint persistence and proves the returned result, `run-end`, and durable
terminal result remain `succeeded`. Focused kernel verification passes 69/69.
Fresh all-scope Review 19 remains required, so the branch is **HOLD**.

## 2026-07-22 — Graph-mode Review 19 closure

Exact all-scope session `019f8cec-4d25-7330-b82a-4e64dc4f0013` ran under
host-reported `gpt-5.6-sol` with `xhigh` reasoning, repeated the exact 42-file
opening and closing identity/scope gate, and returned
**HOLD — C0/H1/M1/L0**.

The High finding reproduced in both modes and for all four authored terminal
statuses: cancellation or the whole-run deadline could arrive while the
terminal node-entry checkpoint settled, yet the scheduler would still publish
the authored terminal. The Medium finding showed that fresh-run command
rendering could subsequently replace an already durable failed/refused result
with a late outer cancellation or timeout. Closure testing also found that an
authored non-success terminal's `node-end` omitted its code while `run-end`
included it, making the truthful persisted run fail watch validation.

The scheduler now arbitrates interruption immediately after node-entry
checkpointing and before terminal publication, while preserving the Review 18
rule that a successfully persisted terminal marker is authoritative. Authored
terminal `node-end` and `run-end` evidence now carries one matching status/code.
Product execution reports explicit terminal authority, and command arbitration
does not relabel that authority with a later outer abort. Dual-mode regressions
cover cancellation and deadlines across succeeded, failed, refused, and
authored-cancelled terminals. Product tests bind all four statuses through
execution state and watch, and command-core tests cover terminal, recoverable,
deadline, cancellation, and adapter-fallback cases. The targeted closure gate
passes 8/8. Complete verification passes `npm test` 898/898 repository tests
(828 primary plus the 70-test graph-mode kernel), worktree 12/12, objective loop
8/8, workflow conformance 238/238 (168 primary plus the same graph kernel), and
provider contracts 35/35. Both 101-file package paths pass, including installed
Pi 0.80.10 RPC/default-factory proof; active Docker no-egress passes 5/5; and
the capability-enabled Linux sandbox/task-loop suite passes 30/30 with network
disabled. Resources, documentation truth, repository policy, public-safety
diff, static no-live-egress, syntax, and diff checks pass. The complete gate ran
on supported Node 24.16.0 and Linux proof on Node 24.18.0; exact Node 22.19/26
remains unavailable without installation or substitution. Fresh all-scope
Review 20 remains pending, so the branch is **HOLD**.

## 2026-07-22 — Graph-mode Review 20 closure

Exact all-scope session `019f8d0c-bfc6-7971-ad88-01c551c85306` ran under
host-reported `gpt-5.6-sol` with `xhigh` reasoning, audited the exact 42-file
scope, repeated identity, and returned **HOLD — C0/H2/M1/L0**.

The two High findings established executable host authority before containment.
Fallback fingerprints invoked worktree-converting Git operations, so a tracked
`.gitattributes` clean/process filter could execute from repository-local
configuration. Preparatory Git also honored `refs/replace/*`, allowing a
history-only tree to become the sanitized checker's synthetic HEAD. The Medium
finding showed that terminal checkpointing projected a still-running public
state and cleared debt before a later unguarded completion write, allowing an
exact durable terminal to be rendered as a generic runner failure and watched
as running.

Fallback fingerprints now avoid Git content conversion entirely: fixed,
configuration-sterile Git supplies actual HEAD/object-format/index/path metadata
with replacement refs disabled, while bounded contained physical reads hash
tracked and untracked bytes, symlink text, missing paths, and structural
entries. Private Git-view preparation disables replacement refs in ordinary and
linked worktrees. Terminal checkpoint persistence projects the exact completed
status/code before clearing debt; a failed projection retains explicit private
debt and the authored terminal response, and resume repairs it from the
authenticated marker before provider or worktree effects. Focused command-
boundary coverage passes 32/32 and product execution passes 42/42 across all
four authored terminal statuses and both execution modes. Complete verification
passes `npm test` 901/901 repository tests (831 primary plus the 70-test graph-
mode kernel), worktree 12/12, objective loop 8/8, workflow conformance 239/239
(169 primary plus the same graph kernel), and provider contracts 35/35. Both
101-file package paths pass, including installed Pi 0.80.10 RPC/default-factory
proof; active Docker no-egress passes 5/5; and the capability-enabled Linux
sandbox/task-loop suite passes 32/32 with network disabled. Resources,
documentation truth, repository policy, public-safety diff, static no-live-
egress, syntax, and diff checks pass. The complete gate ran on supported Node
24.16.0 and Linux proof on Node 24.18.0; exact Node 22.19/26 remains unavailable
without installation or substitution. Fresh all-scope Review 21 remains
pending, so the branch is **HOLD**.

## 2026-07-22 — Graph-mode Review 21 closure

Exact all-scope session `019f8d2f-422c-7890-bd4d-fdc25cb00862` ran under
host-reported `gpt-5.6-sol` with `xhigh` reasoning, repeated the exact 42-file
opening and closing scope/identity gate, and returned **HOLD — C0/H2/M0/L0**.

The first High finding showed that terminal projection repair authenticated the
retained event prefix but then trusted `scheduler.terminal_result` without the
scheduler's task, runtime, mode, immutable-budget, journal, and terminal-
semantic admission. A forged private marker could therefore publish or return
success. The second High finding showed that runtime smoke fingerprinted
candidate changes with ambient Git diff porcelain, allowing repository-local
textconv and related helpers to execute on the host after a tracked mutation.

Terminal projection repair now invokes the scheduler's actual terminal-resume
path in a side-effect-free admission mode before any public event/state or
private debt write. It validates the exact task, definition, mode-bound runtime
cast, immutable budget, journal prefix, authored terminal evidence, and final
`node-end`/`run-end` status-code pair. Product regressions forge each authority
dimension in original-mode and graph-mode, prove every repair refuses, and
assert public state, events, and debt remain unchanged before authentic repair.

Runtime smoke now resolves fixed configuration-sterile Git once, binds both
modes to one replacement-disabled commit, creates no-checkout worktrees,
populates their indexes with raw tree metadata, materializes raw regular blobs,
executable modes, gitlinks, and symlink text, and uses the shared bounded
physical workspace fingerprint. The ordinary/linked-worktree regression covers
textconv, clean/smudge/process filters, fsmonitor, post-checkout hooks, ambient
`GIT_*`, replacement refs, an external tracked symlink, and source-HEAD drift
between the two mode runs. Focused regressions pass 2/2. Complete verification
passes `npm test` 903/903 repository tests (833 primary plus the 70-test graph-
mode kernel), worktree 12/12, objective loop 8/8, workflow conformance 241/241
(171 primary plus the same graph kernel), and provider contracts 35/35. Both
101-file package paths pass, including installed Pi 0.80.10 RPC/default-factory
proof; active Docker no-egress passes 5/5; and the capability-enabled Linux
sandbox/task-loop suite passes 32/32 with network disabled. Resources,
documentation truth, repository policy, public-safety diff, static no-live-
egress, syntax, and diff checks pass. The complete gate ran on supported Node
24.16.0 and Linux proof on Node 24.18.0; exact Node 22.19/26 remains unavailable
without installation or substitution. Fresh all-scope Review 22 remains
pending, so the branch is **HOLD**.

## 2026-07-23 — Graph-mode Review 22 closure

Exact all-scope session `019f8d55-ed21-7fa0-aec6-f885422a0e22` ran under
host-reported `gpt-5.6-sol` with `xhigh` reasoning over the complete 42-file
branch scope and returned **HOLD — C0/H3/M3/L0**.

The three High findings showed that a resumed active terminal could skip
cancellation/deadline arbitration; product resume could admit a private terminal
without explicit projection debt and reach provider certification; and
pre-sandbox `nix-store -qR` inherited ambient plugins, configuration, remotes,
and helper resolution. The three Medium findings showed that runtime smoke
could allocate/read the aggregate tree before its bound was admitted, decoded
raw Git filenames and symlink targets through lossy UTF-8 strings, and removed
its recovery root or escaped with an untyped exception when worktree/root
cleanup failed.

The scheduler now re-arbitrates cancellation and the cumulative whole-run
deadline after every fresh or resumed active node-entry checkpoint and before
terminal publication, including nested-child continuation. Product resume
enforces a closed cross-document relation: nonterminal private state requires
incomplete public state; private terminal state requires explicit schema-2
projection debt; and an already-completed public terminal under that debt must
match the private status, code, and node. The matching completed case is a
maintenance retry that clears debt before provider certification; every other
relation refuses before projection writes.

Nix closure discovery now resolves a fixed helper and runs it against the local
daemon under a private home/configuration while disabling plugins, substituters,
and builders. Ambient Nix configuration, remotes, credentials, proxies, and
`PATH` cannot direct host preparation. Runtime smoke now pre-admits a single
immutable raw-tree manifest before worktree registration. It validates object
ids, modes, byte paths, prefix collisions, per-entry and aggregate byte limits,
and file count with checked arithmetic; preserves POSIX path and symlink-target
bytes; and refuses before registration on an incapable filesystem. Cleanup
independently attempts every registered worktree, reconciles registration and
lexical/physical checkout identity, preserves the private recovery root on
uncertainty, and returns a stable typed cleanup result.

Focused verification passes kernel/graph 80/80, product execution 49/49, and
command/sandbox configuration 33/33. Complete verification passes `npm test`
913/913 repository tests (841 primary plus the 72-test graph-mode kernel),
worktree 12/12, objective loop 8/8, workflow conformance 250/250 (178 primary
plus the same graph kernel), and provider contracts 35/35. Both 101-file
package paths pass, including installed Pi 0.80.10 RPC/default-factory proof;
active Docker no-egress passes 5/5; and capability-enabled Linux sandbox/
task-loop passes 32/32 with network disabled (the Nix-only case is skipped in
the Nix-free image and passes on the Nix host). Resources, documentation truth,
repository policy, public-safety diff, static no-live-egress, syntax, and diff
checks pass. The complete gate ran on supported Node 24.16.0 and Linux proof on
Node 24.18.0; exact Node 22.19/26 remains unavailable without installation or
substitution. Fresh all-scope Review 23 remains pending, so the branch is
**HOLD**.

## 2026-07-23 — Graph-mode Review 23 closure

Exact all-scope session `019f8d9c-476d-75a3-91a4-3f90068a235d` ran under
host-reported `gpt-5.6-sol` with `xhigh` reasoning, repeated the opening and
closing repository identity gates over the exact 42-file branch scope, and
returned **HOLD — C0/H0/M2/L0**.

The first Medium finding showed that preflight omitted non-UTF-8 paths from
collision analysis and approximated Unicode filesystem case folding with
JavaScript lowercase conversion. A byte-valid Git tree could therefore collide
only after worktree registration. The second showed that cleanup captured a
physical checkout identity for Git comparison but checked filesystem absence
only through the lexical checkout alias.

Runtime smoke now creates a disposable probe below the already-created scratch
root before registering either worktree. It materializes the entire manifest
path/type skeleton with exact raw path bytes, verifies every symlink payload,
enumerates the resulting paths as bytes, compares that enumeration to the
immutable manifest, and requires successful probe removal. This directly proves
the filesystem's behavior for the admitted tree without a Unicode
normalization/case approximation.

Cleanup captures lexical and physical scratch-root identities while the root
exists and derives both checkout identities before any worktree add can
partially succeed. After each removal attempt, all derived identities must be
absent from both Git registration and the filesystem; otherwise the private
root remains recovery evidence and the result is the stable typed cleanup
failure. Raw/Unicode collision, partial-add residue, lexical alias removal with
a physical survivor, registered-removal failure, and root-removal failure
regressions pass. The complete product workflow execution suite passes 52/52.

Complete verification passes `npm test` 916/916 repository tests (844 primary
plus the 72-test graph-mode kernel), worktree 12/12, objective loop 8/8,
workflow conformance 253/253 (181 primary plus the same graph kernel), and
provider contracts 35/35. Both 101-file package paths pass, including installed
Pi 0.80.10 RPC/default-factory proof; dispatch and revision smokes pass; active
Docker no-egress passes 5/5; and capability-enabled Linux sandbox/task-loop
passes 32/32 with network disabled (the Nix-only case is skipped in the
Nix-free image and passes on the Nix host). Resources, documentation truth,
repository policy, public-safety diff, static no-live-egress, syntax, and diff
checks pass. The complete gate ran on supported Node 24.16.0 and Linux proof on
Node 24.18.0; exact Node 22.19/26 remains unavailable without installation or
substitution. Fresh all-scope Review 24 remains pending, so the branch is
**HOLD**.

## 2026-07-23 — Graph-mode Review 24 closure

Exact all-scope session `019f8dbd-c0c8-77d0-92b4-56d0dfea165c` ran under
host-reported `gpt-5.6-sol` with `xhigh` reasoning, repeated the opening and
closing repository identity gates over the exact 42-file branch scope, and
returned **HOLD — C0/H0/M2/L0**.

The first Medium finding showed that the pre-registration filesystem probe
created and enumerated every regular file as non-executable, normalizing Git
mode `100755` to `100644`; executable-bit loss was therefore discovered only
after worktree registration. The second showed that objective-sandbox setup
discarded cleanup failures on refusal, allowed post-scratch filesystem
exceptions to escape cleanup, and let a thrown preparation bypass rollback of
an already-opened workspace guard.

The probe now creates regular files with their admitted Git mode, explicitly
applies that mode, enumerates the executable bit from the resulting filesystem
entry, and compares `100644`/`100755` exactly before any worktree add. The
regression injects an executable-bit-dropping filesystem boundary and proves
zero worktree registrations.

Objective-sandbox preparation now treats all work after scratch creation as one
cleanup-aware transaction. Every refusal or exception attempts cleanup,
verifies that scratch is absent, and preserves
`objective-gate-sandbox-cleanup-failed` instead of replacing it with generic
unavailability. The caller catches preparation exceptions, rolls back any
opened workspace guard, and gives cleanup uncertainty precedence when cleanup
and rollback both fail. Focused executable-mode, sandbox-cleanup, and
workspace-rollback regressions pass. Complete verification passes `npm test`
919/919 repository tests (847 primary plus the 72-test graph-mode kernel),
worktree 12/12, objective loop 8/8, workflow conformance 254/254 (182 primary
plus the same graph kernel), and provider contracts 35/35. Both 101-file
package paths pass, including installed Pi 0.80.10 RPC/default-factory proof;
dispatch and revision smokes pass; active Docker no-egress passes 5/5; and
capability-enabled Linux sandbox/task-loop passes 34/34 with network disabled
(the Nix-only case is skipped in the Nix-free image and passes on the Nix
host). Resources, documentation truth, repository policy, public-safety diff,
static no-live-egress, syntax, and diff checks pass. The complete gate ran on
supported Node 24.16.0 and Linux proof on Node 24.18.0; exact Node 22.19/26
remains unavailable without installation or substitution. Fresh all-scope
Review 25 remains pending, so the branch is **HOLD**.

## 2026-07-23 — Graph-mode Review 25 clean closure

Exact all-scope session `019f8ddd-923b-7f73-9868-e1491cce1c37` ran under
host-reported `gpt-5.6-sol` with `xhigh` reasoning in strict read-only mode. It
read the controlling migration plan and both workflow ledgers, inspected every
one of the exact 36 modified and six untracked files, revalidated Reviews 1–24,
and repeated the repository identity and scope gates before returning.

No material findings remained. The executable-mode pre-registration proof and
the objective-sandbox cleanup/rollback transaction introduced after Review 24
were traced through their production callers and focused regressions. Earlier
continuation, persistence, budget, terminal, provider-boundary, raw-tree,
filesystem, cleanup, command-sandbox, visualization, and original/graph parity
closures remained mutually consistent. Documentation and review history
matched the supplied verification evidence.

The review did not rerun tests because it was strictly read-only. Its closing
`git diff --check` passed, the branch still contained exactly one primary
worktree at the unchanged base SHA, and the final verdict was
**SHIP — C0/H0/M0/L0**. The iterative graph-mode review gate is complete.

## 2026-07-23 — PR #18 exact-matrix pre-merge findings

Required PR run `29991995114` tested exact head
`dcbbda180457ae03c9c1c3c8968652ace54ff03c` under Node 22.19 and 26 with Pi
0.80.7 and 0.80.10. All four jobs failed before merge. The shared failure was
not model/runtime behavior: GitHub's Ubuntu 24.04 image enforced AppArmor's
unprivileged-user-namespace restriction, so the production command sandbox
correctly returned `objective-gate-sandbox-unavailable`. The matrix had not
prepared the ephemeral runner for the real boundary it required.

The same run independently reproduced a raw-path admission defect. The
pre-registration probe created and enumerated an invalid-UTF-8 regular path, but
Node's Linux `realpathSync(Buffer, { encoding: "buffer" })` could not recover
that name. Physical fingerprinting therefore returned
`workflow-runtime-smoke-baseline-invalid` only after worktree registration.

The CI matrix now applies Canonical's documented one-boot AppArmor setting on
the ephemeral runner and proves the full `unshare` flag set before `npm test`.
No production sandbox test is skipped, mocked, or downgraded. Raw-tree
preflight now proves byte-preserving parent and regular-file `realpath`
operations during the disposable filesystem probe; lack of support returns the
typed pre-registration baseline-unsupported result. Repository-governance and
Linux raw-path regressions cover both closures. PR #18 must remain open until
the replacement exact-head required `test` check succeeds.
