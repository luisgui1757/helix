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
