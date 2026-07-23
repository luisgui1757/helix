# Helix graph-mode migration plan

- **Status:** in progress
- **Branch:** `graph-mode`
- **Base:** `main` at `9a098f19f3ae9b969284f89417ac2939e8b141b7`
- **Authority:** controlling implementation plan for graph-mode until feature completion
- **Delivery:** one commit on the dedicated branch; no pull request

## 1. Objective

Ship a compatibility-preserving graph interpretation of WorkflowDefinition v4.
Every workflow continues to use the same closed definition, validation,
normalization, provider binding, objective gate, workspace, journal, checkpoint,
and event contracts. A run selects one of two explicit execution modes:

- `original-mode`: the current direct node-field interpreter and the default for
  new runs and every legacy run record;
- `graph-mode`: routing through one canonical typed graph compiled from the same
  validated WorkflowDefinition v4.

The two modes must produce equivalent externally observable outcomes for the
same deterministic effects. Graph-mode is secondary and opt-in. It must not
silently replace, weaken, or reinterpret original-mode.

## 2. Source of truth and non-negotiable invariants

The source of truth is the current WorkflowDefinition v4 contract plus the
operator request for a secondary graph-mode. Existing Helix workflow-kernel
invariants remain binding, especially:

- exactly one final deterministic objective gate and one succeeded terminal;
- the final gate's `on_pass` is the succeeded terminal's only incoming edge;
- bounded and explicitly marked cycles with a valid `loops_off` escape;
- one independently budgeted and journaled effect per actual model invocation;
- exact run, visit, attempt, child, workspace, journal, and checkpoint identity;
- structural non-maskability of kernel, identity, budget, cancellation,
  workspace, gate, and persistence failures;
- public graph projections contain structural data only;
- named workflows normalize to v4 before execution;
- no arbitrary JavaScript, expression evaluation, implicit truthiness, fallback
  routing, automatic semantic merge, or second persisted workflow language.

Mode-specific invariants:

1. Mode is a closed enum: `original-mode` or `graph-mode`.
2. Omitted mode means `original-mode`.
3. Mode is displayed during preflight and consent.
4. Graph-mode adds an explicit discriminator to the execution-binding identity
   before run creation; original-mode deliberately preserves the legacy binding
   hash input so its consent/runtime identity does not drift.
5. Graph-mode adds the same discriminator inside the kernel's effective runtime
   identity. New original-mode scheduler checkpoints use schema 4; graph-mode
   uses schema 5 with explicit mode. Both bind a canonical rolling event-prefix
   ref. Every new run persists its mode and the same prefix ref in public state.
6. Resume reuses the recorded mode; callers cannot change it.
7. Legacy public run-state shape means `original-mode` for inspection, but an
   unbound legacy public/private checkpoint cannot authorize continuation.
8. Child workflows inherit the selected parent run mode because one scheduler
   recursively owns the parent/child execution tree.
9. Graph compilation is deterministic, bounded, total on malformed input, and
   performed only from the validated definition at the scheduler boundary.
10. A graph compilation or routing mismatch refuses with a stable kernel code;
    it never falls back to original-mode.

## 3. Terminology

- **Definition graph:** the finite typed control-flow graph authored in v4.
- **Typed edge:** `{from, to, kind, ordinal}` plus only the metadata appropriate
  to that edge kind.
- **Execution trace:** the ordered structural events emitted by one run.
- **Runtime configuration:** current node, visits, outputs, active/in-flight
  effects, budgets, journal evidence, workspace state, child state, and elapsed
  duration. This is larger than the definition graph.
- **Compound node:** pipeline, parallel, map, or subworkflow node whose internal
  effects or child nodes remain explicit without pretending they are ordinary
  top-level control-flow edges.
- **Parity:** equivalent normalized result, terminal, failure code, outputs,
  visits, budgets, journal identities/content, and public structural trace after
  excluding mode-identifying fields and run-specific ids.

## 4. Product contract

### 4.1 Selection

The attended command accepts:

```text
/helix-run <workflow> --execution-mode original-mode -- <task>
/helix-run <workflow> --execution-mode graph-mode -- <task>
```

Omitting `--execution-mode` selects `original-mode`. Unknown, duplicated,
misplaced, or missing flag values refuse before input collection, consent, run
directory creation, worktree creation, or provider preflight.

Non-TUI preflight accepts the corresponding structural form:

```text
run <workflow> --execution-mode <mode>
```

The preflight, confirmation, run status, watch view, and completion details show
the selected/recorded mode. Resume has no mode option and reports the recorded
mode before confirmation.

### 4.2 Persisted compatibility

New public workflow run state adds `execution_mode` through an additive schema
version. Existing schema-v4 public state remains readable and maps exactly to
`original-mode`. New writers never emit the legacy shape. Legacy definition and
journal readers retain their compatibility rules. New scheduler checkpoint
schema 4 is original-mode and schema 5 is graph-mode; each recursively binds its
mode/runtime/task identity and exact ordered event-prefix ref. Schemas 1/2/3
remain readable history but cannot resume. Graph-mode does not make historical
state resumable.

Graph-mode is included in the runtime reference and execution binding.
Original-mode retains the exact historical hash input. A public
state/checkpoint/runtime mismatch refuses. Run listing, status, watch, prune,
and cleanup retain legacy behavior.

## 5. Canonical graph model

Add one provider-neutral module under `dispatch/workflow/` that owns:

- execution-mode constants and validation;
- closed edge-kind constants;
- total extraction of typed edges from every v4 node kind;
- deterministic graph compilation with canonical lexical node order and
  authored outgoing-edge order;
- adjacency and reverse-adjacency indexes;
- runtime edges and loops-disabled operational edges;
- reachability, reverse reachability, path existence, and strongly connected
  components needed by validation and diagnostics;
- typed routing helpers for `next`, decision, and gate outcomes;
- structural graph projection suitable for bounded public visualization.

Edge kinds:

| Node | Edges |
|---|---|
| agent, pipeline, parallel, map, reduce, checkpoint, subworkflow | `next` |
| decision | ordered `condition`, one `default`, optional `loops-off` |
| gate | `pass`, `fail`, optional `loops-off` |
| terminal | none |

Conditions remain authored data. Public projections expose safe structural
fields and condition references, not prompts, tasks, responses, provider
bodies, accounts, workspace content, or other private material.

## 6. Scheduler integration

The existing scheduler remains the only workflow engine.

- At entry, validate the mode and definition.
- In `original-mode`, retain direct node-field routing.
- In `graph-mode`, compile once per parent/child scheduler invocation and route
  only through the typed graph.
- Node effect execution, concurrency, mutation serialization, budgets, retry,
  structured repair, journaling, checkpoints, cancellation, gates, artifacts,
  subworkflows, and terminal admission remain shared code.
- A graph edge may select only a target already admitted by the validated
  definition. Missing/ambiguous/inconsistent edges refuse.
- The mode reaches recursive child schedulers unchanged.
- Scheduler events add the execution mode only where needed to bind or explain
  the run; raw/private data remains excluded.

Graph-mode is not a multi-token dependency scheduler. Multiple ready nodes,
implicit fan-out, implicit joins, and automatic dataflow are outside this
migration. Parallel and map remain explicit compound nodes.

## 7. Visualization and authoring

### 7.1 Planned graph

Enrich the planned graph projection with typed edges while preserving existing
node ids and `targets` compatibility. Show edge labels for condition/default,
pass/fail, loop, loops-off, and next. Display compound-node summaries without
flattening dynamic map instances into false static nodes.

### 7.2 Observed graph

Overlay:

- recorded mode;
- node visits, effects, and terminal status;
- traversed edge counts and order;
- current/last node;
- nested child structural progress;
- planned-but-unvisited edges without claiming execution.

Malformed or definition-inconsistent events refuse at their existing trust
boundary rather than being rendered as valid progress.

### 7.3 Construction

Extend the pure builder with hygienic graph fragments/combinators only where
they remove real repetition. They generate ordinary v4 JSON and pass through the
same validator. Initial supported compositions:

- sequence;
- conditional branch;
- bounded evaluator/optimizer loop;
- bounded fan-out/reduce;
- explicit subgraph connection with collision refusal.

No builder program runs inside Helix. Existing low-level constructors and JSON
imports remain supported. Guided legacy builders continue to normalize to v4.

## 8. Test plan

### 8.1 Graph unit tests

- every node kind and every edge kind;
- stable edge ordering and stable public projection;
- duplicate targets with different edge semantics;
- empty, singleton, maximum-size, and malformed inputs;
- unknown nodes/kinds/targets and invalid edge metadata;
- self-loop, multi-node cycle, overlapping cycles, cyclic default, and
  loops-disabled escape behavior;
- reachability, reverse reachability, SCCs, and successful-gate postcondition;
- public-safety checks and canonical size/depth boundaries;
- fragment id collisions, dangling ports, and deterministic composition.

### 8.2 Scheduler parity matrix

Run identical deterministic fixtures once in each mode and compare normalized
outcomes for:

- agent, pipeline, parallel, map, reduce, decision, gate, checkpoint,
  subworkflow, and all terminal statuses;
- condition selected/default, gate pass/fail, loops on/off, repeated visits,
  cyclic defaults, and final-gate retry;
- empty/single/max map and parallel cardinality;
- abort and settle policies, allowed typed agent failures, decisive failure
  attribution, queued-work cancellation, and reservation release;
- retries, structured repair, failed-call usage, effect/token/cost ceilings, and
  arithmetic boundaries;
- read-only overlap, shared writers, isolated proposals, conflicts, rollback,
  finalize, and snapshot failure;
- output/journal/checkpoint capacity refusal;
- pause/resume, journal-ahead reconciliation, legacy journal readability,
  missing/corrupt evidence, and exact visit/instance/run namespace binding;
- child budgets, child checkpoints, parent/child name collisions, input-schema
  compatibility, and nested-depth refusal;
- cancellation and deadline at every practical lifecycle boundary;
- malformed adapter envelopes, gate results, artifact evidence, and callbacks.

Parity comparison must normalize only fields expected to differ: run id,
mode-binding hashes, timestamps/elapsed duration, and the explicit mode label.
It must not normalize status, code, outputs, visits, budgets, journal content,
effect ordering, transition path, or workspace result.

### 8.3 Product and persistence tests

- default/explicit mode parsing and every malformed flag shape;
- preflight and consent display;
- mode included in binding and drift detection;
- no run/worktree/provider effects on invalid mode;
- new state round-trip and legacy state as original-mode;
- resume mode immutability and mismatch refusal;
- run list/status/watch/completion rendering;
- planned/observed graph rendering and privacy;
- package contents and extracted-package command discovery.

### 8.4 Smoke and end-to-end tests

- provider-free runtime smoke executes both modes in isolated worktrees and
  asserts parity while candidate artifacts are written inside counted effects,
  verified from disk, and evaluated by the real authored deterministic gate;
- every stock workflow template executes in both modes;
- native v4 graphs covering every node/edge kind execute in both modes;
- attended extension command path selects graph-mode, confirms it, executes the
  real kernel boundary, persists mode, watches it, pauses/resumes it, and cleans
  up;
- no-live-egress and package/RPC proofs remain green;
- no live provider call is required by this migration.

## 9. Documentation and ledgers

Update in the same change:

- `README.md`: feature summary, commands, default, compatibility, and limits;
- `docs/workflows.md`: graph semantics, typed edges, modes, parity, examples,
  authoring, visualization, and non-goals;
- `docs/architecture.md`: canonical graph layer, scheduler routing, state versus
  control graph, persistence and child-mode binding;
- `docs/manual.md`: exact commands, status/watch/resume behavior, refusal help;
- `ROADMAP_SOL.md`: graph-mode extension status and completed items;
- `reviews/workflows/SUMMARY.md`: append implementation and verification;
- `reviews/workflows/ASSUMPTIONS.md`: append durable mode/graph invariants and
  rejected alternatives;
- `AGENTS.md`: only if implementation discovers a new durable project invariant
  not already captured in the project overlay;
- package/file manifests and docs-truth pins if required by repository checks.

## 10. Verification gates

Run focused checks during implementation, then the complete current gate:

```text
node --test tests/workflow-graph.test.mjs
node --test tests/workflow-v4-schema.test.mjs tests/workflow-kernel.test.mjs
node --test tests/helix-workflow-execution.test.mjs tests/helix-command-core.test.mjs tests/helix-command-extension.test.mjs
npm run check:workflow-conformance
npm test
npm run check:resources
npm run check:docs-truth
npm run check:no-live-egress
npm run check:provider-contracts
npm run check:package
git diff --check
```

Also run any repository-required worktree, loop, package extraction, static
policy, and supported-Node matrix gates available without installing or
substituting dependencies. Record pass, fail, unavailable, and intentionally
not-run states separately.

## 11. Review loop

After implementation and a green full gate:

1. Dispatch a fresh-context, branch-wide principal-engineer review with the
   complete plan, diff, invariants, and verification evidence.
2. Require findings to include severity, exact location, wrong behavior,
   reproduction/proof, source of truth, multi-location check, recommended fix,
   and confidence.
3. Review the entire branch scope: graph correctness, parity, scheduler,
   persistence/resume, budgets, concurrency, identity, product UX, public safety,
   authoring, visualization, tests, docs, and packaging.
4. Fix every critical, high, and medium finding. Add regression tests and update
   documentation/ledgers in the same change.
5. Re-run focused and full verification.
6. Dispatch another fresh all-scope review.
7. Repeat until one complete review reports no critical, high, or medium
   findings. Low findings are fixed when correctness-related or inexpensive;
   any retained low finding is documented with rationale.

The requested reviewer is GPT-5.6 Sol xhigh. If the available agent interface
cannot attest that exact model/effort identity, record the limitation and do not
mislabel another reviewer as that identity. Continue with the strongest
available independent review while preserving the unverified-model boundary.

### 11.1 Review ledger

- **Review 1 — 2026-07-22 — HOLD:** fresh read-only Codex session
  `019f8a18-20d9-7b52-8b54-b996453aaf04` attested `gpt-5.6-sol` with
  `model_reasoning_effort="xhigh"`. It reported no Critical, one High, three
  Medium, and two Low findings.
- **High closure:** caller-injected runtime refs are now mode-bound inside the
  kernel; graph scheduler checkpoints use schema 3 with explicit recursive mode,
  while schemas 1/2 remain original-only. Both switch directions and child
  tampering refuse before effects.
- **Medium closures:** event admission is closed and state-mode-aware; graph
  transitions require exact edge identity; pinned direct-child definitions and
  forwarded child structure drive nested/current/last visualization; smoke
  parity compares complete normalized results from independent worktrees.
- **Low closures:** the attended extension test executes graph-mode through
  consent, durable pause, watch, resume, completion, and cleanup; this ledger and
  `reviews/workflows/SUMMARY.md` now record the work.
- **Current review state:** implementation closures and focused regressions are
  complete. Post-fix verification passes: `npm test` 769/769, workflow
  conformance 130/130, provider contracts 35/35, extracted-package validation
  across 100 files with real Pi RPC/default-factory proof, and active Docker
  no-egress 5/5. Documentation truth, resources, repository policy, public
  safety, and static no-live-egress checks also pass. A supported Node 22.19/26
  matrix is unavailable locally without installing or substituting runtimes;
  the full local gate ran on Node 24.16.0 and is not mislabeled as matrix proof.
  Review 2 remains pending, so the branch stays HOLD until a fresh all-scope
  review reports no Critical/High/Medium findings.
- **Review 2 — 2026-07-22 — HOLD:** fresh read-only Codex session
  `019f8a40-3b98-78f1-9f50-ae8340c0b91c` attested `gpt-5.6-sol` with
  `model_reasoning_effort="xhigh"`. It reported no Critical or High, two Medium,
  and two Low findings: observed streams were not exact or definition-bound;
  injected effects could mutate original-mode routing after graph compilation;
  canonical ordering depended on locale; and combinators could invoke accessors.
- **Review 2 closures:** every scheduler invocation now owns one cloned, deeply
  immutable definition and sends detached callback inputs; parent/child event
  streams require exact per-kind fields, binding hash/mode, run/sequence, and a
  first start/resume event; graph and fragment identifiers use code-unit order;
  every combinator descriptor-safely refuses accessors, proxies, cycles, and
  excessive depth. Focused graph/schema/parity tests pass 46/46 and product
  command/execution/E2E tests pass 92/92.
- **Current review state after Review 2:** all four findings are closed with
  adversarial regressions. Complete locally available re-verification passes:
  `npm test` 771/771 plus worktree 12/12 and objective loop 8/8; workflow
  conformance 132/132; provider contracts 35/35; product command/execution/E2E
  122/122; extracted-package validation across 100 files with installed Pi
  0.80.10 RPC/default-factory proof; and active Docker no-egress 5/5.
  Documentation truth, resources, repository policy, public safety, static
  no-live-egress, and diff checks also pass. Review 3 remains pending, so the
  branch remains HOLD.
- **Review 3 — 2026-07-22 — HOLD:** fresh read-only Codex session
  `019f8a65-cee8-7eb1-9fd8-040caf33924d` was launched by the CLI under its
  host-reported `gpt-5.6-sol` model and `xhigh` reasoning effort. The reviewer's
  final response correctly noted that its own interface could not independently
  expose or attest those effective fields. It reported no Critical or High,
  five Medium, and two Low findings.
- **Review 3 closures:** scheduler schema 3 is graph-only and recursive child
  admission inherits the parent's expected runtime/task bindings before any
  resolver or checkpoint callback; observed child ids bind parent run/node/visit
  identity and gate finality/result binds the authored gate and next edge;
  schema-4 child wrappers have an explicit opaque original-mode watch path;
  pinned child-definition artifacts are strict managed run companions; fragment
  admission detects proxies without traps and enforces the exact canonical byte
  ceiling. Historical Review 2 claims remain intact as history, with corrective
  entries appended here and in the workflow ledgers.
- **Review 3 parity closure:** the existing complete 51-test kernel adversarial
  suite is parameterized and rerun under graph-mode, covering retry/repair,
  fan-out abort/settlement, budgets, workspace rollback/conflict, journal and
  checkpoint recovery, capacity refusal, child continuation, cancellation, and
  deadlines. Focused graph/schema/parity/product regressions pass 117/117 and the
  graph-mode kernel matrix passes 51/51. Complete re-verification and Review 4
  remain pending, so the branch stays HOLD.
- **Current review state after Review 3:** complete locally available
  re-verification passes `npm test` 827/827 (776 primary plus 51 graph-mode
  kernel) with worktree 12/12 and objective loop 8/8; workflow conformance
  186/186 (135 primary plus 51 graph-mode kernel); provider contracts 35/35;
  extracted-package validation across 100 files with installed Pi 0.80.10
  RPC/default-factory proof; and active Docker no-egress 5/5. Documentation
  truth, resources, repository policy, public safety, static no-live-egress, and
  diff checks pass. The exact CI Node 22.19/26 matrix remains unavailable locally
  without installing or substituting runtimes; local full gates ran on supported
  Node 24.16.0 and are not mislabeled as that matrix. Review 4 remains pending,
  so the branch stays HOLD.
- **Review 4 — 2026-07-22 — HOLD:** fresh read-only Codex session
  `019f8a83-c2a4-7213-99a6-9ed6c41645bc` was launched by the CLI under its
  host-reported `gpt-5.6-sol` model and `xhigh` reasoning effort. It reported no
  Critical or High, three Medium, and one Low finding: observed lifecycle
  admission accepted orphan effect ends and forged nonterminal success; valid
  workflow ids and the maximum version were not consistently recognized in
  child companion filenames; fragment input was cloned before its canonical
  byte limit; and artifact callbacks received the kernel's frozen reference.
- **Review 4 closures:** observed streams now reconcile exact effect starts,
  completions, retries/resumes, node/run finality, authored succeeded terminals,
  and final-gate pass evidence; completed public state must match the admitted
  run-end. One shared child companion generator/parser enforces the exact
  workflow-id and version grammar across execution, watch, and run discovery.
  Fragment admission applies the canonical UTF-8 ceiling before structured
  clone, and artifact callbacks receive detached mutable copies. Focused graph,
  schema, run-manager, kernel, execution, and product regressions pass 164/164.
  Complete locally available re-verification passes `npm test` 829/829 (778
  primary plus the 51-test graph-mode kernel), worktree 12/12, objective loop
  8/8, workflow conformance 188/188 (137 primary plus the same graph kernel
  matrix), and provider contracts 35/35. Resources, documentation truth,
  repository policy, public-safety diff, static no-live-egress, syntax, and diff
  checks pass. Both 100-file extracted-package paths pass, including installed
  Pi 0.80.10 RPC/default-factory proof; active Docker lockdown passes 5/5.
  Exact Node 22.19/26 matrix binaries remain unavailable locally without
  installation/substitution, so Node 24.16.0 evidence is not represented as
  matrix proof. Review 5 remains pending, so the branch stays HOLD.
- **Review 5 — 2026-07-22 — HOLD:** fresh read-only Codex session
  `019f8aa5-4c60-7113-9287-44c65e1f3e8b` ran under the CLI's host-reported
  `gpt-5.6-sol` model and `xhigh` reasoning effort. It reported no Critical or
  High, three Medium, and no Low findings: orphan `effect-resumed` evidence was
  accepted; a parent subworkflow could advance with no successful child run;
  and complete early kernel failures persisted without an admissible run-end,
  making legitimate named runs unwatchable.
- **Review 5 closures:** schema-5 effect evidence is now a per-node-visit
  automaton: only effect-capable nodes admit it, resume closes an exact preserved
  start, ids cannot be reused, and retry/repair names the exact failed agent
  attempt and failure class. A successful parent subworkflow visit requires its
  exact child run-end before parent completion or transition. The scheduler
  terminalizes every complete post-start failed/refused/cancelled outcome at
  its current node and checkpoints the terminal evidence, while preserving
  checkpoint-derived resumable interruptions. Observed admission permits this
  exact nonterminal failure shape but retains final-gate/terminal authority for
  success only. Focused kernel/schema and product watch regressions pass 76/76
  across original-mode and graph-mode. Complete locally available
  re-verification passes `npm test` 829/829 (778 primary plus the 51-test
  graph-mode kernel), worktree 12/12, objective loop 8/8, workflow conformance
  188/188 (137 primary plus the same graph kernel matrix), provider contracts
  35/35, resources, documentation truth, repository policy, public-safety diff,
  static no-live-egress, syntax, and diff checks. Both 100-file extracted-package
  paths pass, including installed Pi 0.80.10 RPC/default-factory proof; active
  Docker lockdown passes 5/5. Exact Node 22.19/26 remains unavailable locally
  without installation/substitution (installed 22.16.0 and current 24.16.0 are
  not mislabeled as matrix proof). Fresh Review 6 remains pending, so the branch
  stays HOLD.
- **Review 6 — 2026-07-22 — INTERRUPTED/HOLD:** fresh read-only Codex session
  `019f8ac9-9c5a-7951-be6b-bfcd812000e0` ran under the CLI's host-reported
  `gpt-5.6-sol` model and `xhigh` reasoning effort. After extensive branch-wide
  inspection and focused reproductions in both modes, the reviewer service
  blocked final report generation at 360,549 tokens. This is not counted as a
  completed clean review. Before interruption it reproduced four medium-class
  lifecycle/persistence defects: a closed failed checkpoint replayed its
  provider effect; journal-ahead recovery emitted an orphan resumed-effect
  history after truncation to the durable prefix; first-checkpoint failure left
  only `run-start`; and sequential retry evidence could exceed the authored
  retry contract.
- **Review 6 reproduced-defect closures:** private terminal checkpoints now bind
  exact terminal status/code and replay as effect-free idempotent results.
  Journal-ahead recovery emits a distinct `effect-recovered` event, while
  `effect-resumed` still closes only an exact durable public start. The observed
  automaton binds canonical instance structure and visit plus ordinary and
  structured retry counts to the authored ceilings; runtime expansion cannot
  raise the authored maximum. Checkpoint-derived interruption is resumable only
  after a prior durable checkpoint. The later Review 11 product correction
  clarifies that failure of the first private checkpoint leaves an incomplete
  nonresumable initialization record with an empty committed prefix. Focused evidence
  passes kernel/schema 79/79, the full graph-mode kernel matrix 54/54, and
  graph/product command, persistence, watch, resume, child, smoke, and attended
  E2E coverage 149/149. Complete locally available re-verification passes
  `npm test` 837/837 (783 primary plus the 54-test graph-mode kernel), worktree
  12/12, objective loop 8/8, workflow conformance 196/196 (142 primary plus the
  same graph kernel matrix), and provider contracts 35/35. Resources,
  documentation truth, repository policy, public-safety diff, static
  no-live-egress, syntax, and diff checks pass. Both 100-file extracted-package
  paths pass, including installed Pi 0.80.10 RPC/default-factory proof; active
  Docker lockdown passes 5/5. Exact Node 22.19/26 remains unavailable locally
  without installation/substitution, and current Node 24.16.0 evidence is not
  represented as matrix proof. Fresh Review 7 remains pending, so the branch
  stays HOLD.
- **Review 7 — 2026-07-22 — HOLD:** fresh read-only Codex session
  `019f8aeb-5127-7d93-8763-36152196cc32` was launched by the CLI under its
  host-reported `gpt-5.6-sol` model and `xhigh` reasoning effort. The reviewer
  interface itself exposed only “GPT-5 Codex” and no separate effort label, so
  the host attestation remains the exact boundary. It reported no Critical or
  High, three Medium, and no Low findings: successful observed history could
  omit or launder agent effects; graph-mode binding hashes depended on host
  locale; and runtime smoke manufactured artifact/gate success outside its
  counted candidate effect.
- **Review 7 closures:** every agent-bearing visit now emits a bounded
  `effect-plan` and schema-5 admission proves all agent, pipeline, parallel, and
  map slots, ordered pipeline settlement, contiguous panel members, explicit
  retry/repair control before later attempts, and final successful or authored
  allowlisted outcomes. Empty maps use a zero-slot plan, and the same admission
  recursively rejects forged child success. Graph-mode binding sorts presets
  and pinned children by Unicode code unit while original-mode preserves its
  exact legacy locale-aware identity. Smoke candidates write required artifacts
  inside the counted transaction; verification hashes the real file and the
  authored file/command gate executes against the disposable worktree. Focused
  lifecycle, locale, renderer, kernel, smoke, product, and nested regressions
  pass, and `npm test` passes 840/840 (786 primary plus the 54-test graph-mode
  kernel), worktree 12/12, objective loop 8/8, workflow conformance 198/198
  (144 primary plus the same graph kernel matrix), and provider contracts
  35/35. Resources, documentation truth, repository policy, public-safety diff,
  static no-live-egress, syntax, and diff checks pass. Both 100-file package
  paths pass, including installed Pi 0.80.10 RPC/default-factory proof; active
  Docker lockdown passes 5/5. Exact Node 22.19/26 remains unavailable without
  installation/substitution. A fresh all-scope review is pending, so the branch
  stays HOLD.
- **Review 8 — 2026-07-22 — HOLD:** exact CLI session
  `019f8b0f-e8a8-7822-9436-6639b98c300a` under host-reported `gpt-5.6-sol`
  with `xhigh` reasoning returned no Critical, one High, one Medium, and no Low.
  It reproduced successful terminal checkpoint publication after a terminal
  event-sink failure and unrestricted mutation authority in authored command
  objective gates.
- **Review 8 closures:** every structural event is now an execution barrier;
  terminal markers follow their exact admitted terminal event pair and product
  resume reconstructs only from the checkpointed event prefix. Authored command
  gates run in a network-denied, credential-sanitized macOS/Linux OS sandbox
  with a read-only candidate and ephemeral scratch. Exact workspace
  fingerprints bind evidence, while named/staged paths privately snapshot and
  restore detected drift. Focused event barriers pass in both modes, product
  terminal event-file interruption/resume passes in both modes, command-gate
  candidate/outside write denial and guard restoration pass on macOS and Linux,
  and both complete workflow-kernel matrices pass 60/60. Full verification is
  green at `npm test` 855/855 (795 primary plus the 60-test graph-mode kernel),
  worktree 12/12, objective loop 8/8, workflow conformance 211/211, provider
  contracts 35/35, both 101-file extracted-package paths including real Pi
  proof, and active no-egress 5/5. Static/docs/policy/resource checks pass.
  Exact Node 22.19/26 remains unavailable without installation/substitution.
  Review 9 remains pending, so the branch stays HOLD.
- **Review 9 — 2026-07-22 — HOLD:** exact CLI session
  `019f8b42-2fd1-7bf1-999e-77733f90a688` under host-reported
  `gpt-5.6-sol` with `xhigh` reasoning returned no Critical, two High, one
  Medium, and no Low. It proved that checkpoints authenticated only event
  length, watch trusted an uncheckpointed suffix, command sandboxes retained
  ambient host-read/Git/IPC access, and cancellation finalized evidence before
  process termination was confirmed.
- **Review 9 closures:** public state and original/graph scheduler schemas 4/5
  now bind a rolling canonical ref over the exact ordered parent/child event
  prefix. Resume validates it before truncation or effects, watch renders only
  that prefix, nested downgraded checkpoints refuse, and schemas 1/2/3 remain
  history-only. macOS uses explicit read admission; both platforms receive a
  sanitized ephemeral Git view rather than the Git common directory; Linux adds
  IPC isolation. Timeout/cancellation waits for process-group close before
  cleanup/fingerprint/restore/evidence. Unconfirmed termination returns a
  stable refusal while preserving scratch and guard material. Focused retained
  prefix tamper, suffix watch, child tamper, outside-read, Git-status,
  namespace, timeout, and unconfirmed-termination regressions pass. A
  capability-enabled Linux run additionally found and closed a chroot mount
  ordering defect for candidates below `/tmp`; the corrected 20-test Linux
  sandbox/task-loop suite passes with network disabled. Complete locally
  available re-verification passes `npm test` 860/860 (799 primary plus the
  61-test graph-mode kernel), worktree 12/12, objective loop 8/8, workflow
  conformance 213/213 (152 primary plus the same graph kernel), provider
  contracts 35/35, both 101-file package paths including installed Pi 0.80.10
  RPC/default-factory proof, and active no-egress 5/5. Documentation truth,
  resources, repository policy, public-safety diff, static no-live-egress,
  syntax, and diff checks pass. Exact Node 22.19/26 remains unavailable without
  installation/substitution; supported Node 24.16.0 ran the complete local gate,
  while the Node 22.16 Linux container is represented only as sandbox proof.
  Review 10 remains pending, so the branch stays HOLD.
- **Review 10 — 2026-07-22 — HOLD:** exact CLI session
  `019f8b7b-fd40-7b11-815f-450c664c2eb0` under host-reported
  `gpt-5.6-sol` with `xhigh` reasoning returned no Critical, four High, no
  Medium, and one Low. It reproduced public/private and nested event-prefix
  divergence, terminal cancellation while provider/gate work remained live,
  routable sandbox-integrity failures, host Git-object exposure through
  alternates, and an omitted static package-load dependency.
- **Review 10 closures:** public count/ref now projects only from the last
  committed private checkpoint; parent and derived child prefixes authenticate
  before provider certification, worktree restore, truncation, or other effects.
  Cancellation waits a bounded settlement window, journals real late usage, and
  leaves an unconfirmed provider/boundary outcome nonterminal without replay or
  terminal evidence. Sandbox, termination, fingerprint, restore, and cleanup
  uncertainty returns a typed non-routable gate error. Command sandboxes build a
  capped self-contained Git database containing only the admitted current tree
  and staged index objects, with a synthetic parentless HEAD and no host object
  store/history mount. Static package-load proof includes the sandbox module.
  Focused kernel, parity, product-resume, sandbox, and package regressions pass
  130/130. Complete verification passes 866/866 repository tests (803 primary
  plus the 63-test graph-mode kernel), worktree 12/12, objective loop 8/8,
  workflow conformance 219/219 (156 primary plus the same graph kernel), provider
  contracts 35/35, both 101-file package paths including installed Pi 0.80.10
  RPC/default-factory proof, active no-egress 5/5, and capability-enabled Linux
  sandbox/task-loop 20/20 with network disabled. Static syntax, resources,
  documentation truth, repository policy, public-safety diff, no-live-egress,
  and diff checks pass. The complete local gate ran on supported Node 24.16.0;
  Linux sandbox proof ran on Node 24.18.0. Exact Node 22.19/26 remains
  unavailable without installation/substitution. Fresh all-scope Review 11 is
  pending, so the branch stays HOLD.
- **Review 11 interrupted attempt — 2026-07-22 — NOT COUNTED:** exact CLI
  session `019f8bb4-422a-77a1-869e-270264d27f4c` ran under host-reported
  `gpt-5.6-sol` with `xhigh` reasoning, but the reviewer service stopped during
  classification without a verdict. It is retained as interrupted evidence,
  not represented as a completed review.
- **Review 11 — 2026-07-22 — HOLD:** fresh exact CLI session
  `019f8bc1-65c1-7332-9baa-cc0d129b3693` under host-reported `gpt-5.6-sol`
  with `xhigh` reasoning reviewed all 41 feature files and repeated the exact
  repository identity gate. It reported no Critical, two High, two Medium, and
  two Low findings: unconfirmed gates could relaunch; CLI cancellation could
  mask a recoverable unknown outcome; initial checkpoint failure could claim an
  unwatcheable completion; resume followed/unboundedly read the event path;
  untracked fingerprints assumed SHA-1; and run discovery accepted negative
  counts.
- **Review 11 closures:** gate intent and settled result are now checkpointed
  against exact run, definition, node, visit, and objective identity; in-flight
  or unconfirmed gates never relaunch. The CLI preserves recoverable kernel
  failures so interrupted runs retain their continuation. Without a first
  private checkpoint, product state remains incomplete, nonresumable, and
  watchable at its empty committed prefix. Resume admits only a regular
  non-symlink event file no larger than 64 MiB. Git fingerprints use the
  repository's SHA-1 or SHA-256 object format, and public counts must be
  nonnegative. Focused closure coverage passes 113/113. Complete verification
  passes 870/870 repository tests (807 primary plus the 63-test graph-mode
  kernel), worktree 12/12, objective loop 8/8, workflow conformance 222/222
  (159 primary plus the same graph kernel), provider contracts 35/35, both
  101-file package paths including installed Pi 0.80.10 RPC/default-factory
  proof, active no-egress 5/5, and capability-enabled Linux sandbox/task-loop
  21/21 with network disabled. Static syntax, resources, documentation truth,
  repository policy, public-safety diff, no-live-egress, and diff checks pass.
  The complete gate ran on supported Node 24.16.0 and Linux sandbox proof on
  Node 24.18.0. Exact Node 22.19/26 remains unavailable without installation or
  substitution. Fresh all-scope Review 12 is pending, so the branch stays HOLD.
- **Review 12 — 2026-07-22 — HOLD:** fresh exact CLI session
  `019f8be7-92ee-7023-9b0d-0d4bb625d535` under host-reported `gpt-5.6-sol`
  with `xhigh` reasoning reviewed all 41 feature files, passed its repeated
  identity gate, and returned no Critical, no High, one Medium, and no Low.
  Review 11 had closed negative counts in run discovery but not in watch,
  resume rendering, or actual continuation; a hostile public journal count
  could therefore reach provider certification without matching private
  scheduler authority.
- **Review 12 closure:** one shared public-count validator now requires safe,
  nonnegative event and journal cardinalities in discovery, watch, resume
  rendering, and continuation. Actual resume also refuses either public count
  leading its private scheduler, requires equality without durable projection
  debt, and repairs documented lag before provider certification. Hostile
  negative, fractional, unsafe, and journal-ahead cases refuse before adapter
  access. Focused command/discovery and product suites pass 85/85. Complete
  verification passes 871/871 repository tests (808 primary plus the 63-test
  graph-mode kernel), worktree 12/12, objective loop 8/8, workflow conformance
  222/222 (159 primary plus the same graph kernel), provider contracts 35/35,
  both 101-file package paths including installed Pi 0.80.10 RPC/default-factory
  proof, active no-egress 5/5, and capability-enabled Linux sandbox/task-loop
  21/21 with network disabled. Static resources, documentation truth,
  repository policy, public-safety diff, no-live-egress, syntax, and diff checks
  pass. The complete gate ran on supported Node 24.16.0 and Linux sandbox proof
  on Node 24.18.0. Exact Node 22.19/26 remains unavailable without installation
  or substitution. Fresh all-scope Review 13 is pending, so the branch stays
  HOLD.

- **Review 13 — 2026-07-22 — interrupted then HOLD:** initial exact CLI session
  `019f8bfd-ac03-7cd1-a62e-7924f3ee6100` stopped in reviewer classification
  without a verdict and is retained only as interrupted evidence. Replacement
  exact session `019f8c04-7b03-7a21-b7e1-22144b22dc49`, under host-reported
  `gpt-5.6-sol` with `xhigh` reasoning, reviewed all 41 feature files, repeated
  the identity gate, and returned no Critical, two High, no Medium, and one Low.
  A provider success settling after cancellation/timeout could commit and
  advance; ordinary-checkout `.git` remained readable inside command sandboxes;
  and valid public projection-debt repair lacked a positive regression.
- **Review 13 closure:** an aborted agent boundary now retains valid late usage
  while forcing the exact cancellation/deadline/timeout result before workspace
  commit or routing. Mutations roll back and no later objective starts. macOS
  admits bounded top-level candidate entries while excluding `.git`; Linux
  masks both in-tree metadata directories and linked-worktree pointer files, so
  the sanitized snapshot is the only readable Git database. The interrupted
  product resume E2E now proves valid lagging event/journal projection repair
  and debt clearing before the next workflow event. Focused regressions pass in
  both execution modes and on macOS/Linux. Complete verification passes 874/874
  repository tests (810 primary plus the 64-test graph-mode kernel), worktree
  12/12, objective loop 8/8, workflow conformance 224/224 (160 primary plus the
  same graph kernel), provider contracts 35/35, both 101-file package paths
  including installed Pi 0.80.10 RPC/default-factory proof, active no-egress
  5/5, and capability-enabled Linux sandbox/task-loop 22/22 with network
  disabled. Static resources, documentation truth, repository policy,
  public-safety diff, no-live-egress, syntax, and diff checks pass on Node
  24.16.0, with Linux proof on Node 24.18.0. Exact Node 22.19/26 remains
  unavailable without installation or substitution. Fresh all-scope Review 14
  is pending, so the branch stays HOLD.
- **Review 14 — 2026-07-22 — interrupted then HOLD:** one malformed effort
  launch (`019f8c25-5893-7c00-86e1-287d163a9849`) was rejected before review,
  and exact replacement session `019f8c25-b3de-7b30-aa22-860f2992d1f1`
  stalled without a verdict and was interrupted. Neither supplies review
  evidence. Exact all-scope session `019f8c56-96d6-7922-adbf-f4cfce7a23ae`
  ran under host-reported `gpt-5.6-sol` with `xhigh` reasoning, reviewed the
  exact 41-file scope, repeated identity, and returned HOLD with no Critical,
  two High, two Medium, and no Low findings. Direct scheduler continuation
  accepted a bound checkpoint without its retained event prefix; a gate pass
  settling after cancellation could become reusable after terminal checkpoint
  failure; projection-debt clearing failure was swallowed before certification;
  and legacy schema-4 watch rendered a valid suffix beyond its recorded count.
- **Review 14 closure:** every schema-4/5 scheduler continuation now requires
  its explicit exact prefix before callbacks. Late gates persist the causal
  cancellation/deadline error rather than pass/fail. Projection debt must be
  durably cleared or resume refuses before adapter access, and schema-4 watch
  slices to its recorded authority. Both-mode adversarial regressions cover
  missing/forged prefixes and late gate settlement with terminal persistence
  failure; product and legacy-watch regressions cover the two Medium findings.
  Complete verification passes 878/878 repository tests (812 primary plus the
  66-test graph-mode kernel), worktree 12/12, objective loop 8/8, workflow
  conformance 228/228 (162 primary plus the same graph kernel), provider
  contracts 35/35, both 101-file package paths including installed Pi 0.80.10
  RPC/default-factory proof, active no-egress 5/5, and capability-enabled Linux
  sandbox/task-loop 22/22 with network disabled. Resources, documentation
  truth, repository policy, public-safety diff, static no-live-egress, syntax,
  and diff checks pass. A fresh all-scope review remains pending, so the branch
  stays HOLD.
- **Review 15 — 2026-07-22 — HOLD:** exact session
  `019f8c75-5324-79c0-8eb2-3b54b1ec15b4` ran under host-reported
  `gpt-5.6-sol` with `xhigh` reasoning, repeated the identity/scope gate, and
  returned no Critical, three High, one Medium, and no Low findings. An
  admitted checker/dependency ancestor could re-expose candidate `.git`; Linux
  containment helpers could fall back to authored `PATH`; confirmed timeout,
  cancellation, spawn, and process failures became authored gate `fail`; and
  malformed staged gate results were coerced into fail transitions.
- **Review 15 closure:** external checkers are admitted as exact files and
  overlapping ancestor roots refuse; Linux boundary helpers resolve only from
  fixed trusted system/Nix roots and metadata masking follows external binds.
  Termination cause remains a typed non-routable error after confirmed close,
  while only genuine checker exits yield pass/fail. Staged execution accepts
  only closed pass/fail or valid typed-error results. Focused ordinary/linked
  parent-checker, hostile-helper, timeout/cancellation/spawn/process, and staged
  malformed-result regressions pass. Complete verification passes 882/882
  repository tests (816 primary plus the 66-test graph-mode kernel), worktree
  12/12, objective loop 8/8, workflow conformance 228/228 (162 primary plus the
  same graph kernel), provider contracts 35/35, both 101-file package paths
  including installed Pi RPC/default-factory proof, active no-egress 5/5, and
  capability-enabled Linux sandbox/task-loop 25/25 with network disabled.
  Resources, documentation truth, repository policy, public-safety diff,
  static no-live-egress, syntax, and diff checks pass. Fresh all-scope Review 16
  remains pending, so the branch stays HOLD. The complete gate ran on supported
  Node 24.16.0 and Linux proof on Node 24.18.0; exact Node 22.19/26 remains
  unavailable without installation/substitution.
- **Review 16 — 2026-07-22 — HOLD:** exact session
  `019f8c96-124b-77d3-9076-90d342ee87de` ran under host-reported
  `gpt-5.6-sol` with `xhigh` reasoning, repeated the identity/scope gate over
  all 42 files, and returned no Critical, three High, two Medium, and no Low
  findings. Descendant/symlink grants could re-expose physical Git metadata;
  a completed retained effect could gain a duplicate resumed completion; a
  resumed parent could lose its retained successful child terminal; staged
  gate objects accepted unknown fields; and late operator-cancelled gates were
  durably labeled failed.
- **Review 16 closure:** sandbox admission now rejects every command,
  dependency, or runtime path intersecting either physical Git representation
  in either direction, including linked-worktree metadata. Retained-prefix
  effect state permits one completion only: ordinary resume closes an open
  start, journal-ahead recovery has no retained start, and an already-closed
  effect emits nothing. Observed child terminal evidence remains bound across
  continuation of the same parent node/visit. Staged gate objects use exact
  fields and bounded types, and `kernel-run-cancelled` retains `cancelled`
  status. Focused kernel/sandbox/staged coverage passes 116/116; both-mode
  product regressions prove effect and child-terminal resume histories through
  the watch boundary. Complete verification passes 888/888 repository tests
  (820 primary plus the 68-test graph-mode kernel), worktree 12/12, objective
  loop 8/8, workflow conformance 233/233 (165 primary plus the same graph
  kernel), provider contracts 35/35, both 101-file package paths including
  installed Pi 0.80.10 RPC/default-factory proof, active no-egress 5/5, and
  capability-enabled Linux sandbox/task-loop 26/26 with network disabled.
  Resources, documentation truth, repository policy, public-safety diff,
  static no-live-egress, syntax, and diff checks pass. Fresh all-scope Review 17
  remains pending, so the branch stays HOLD. The complete gate ran on supported
  Node 24.16.0 and Linux proof on Node 24.18.0; exact Node 22.19/26 remains
  unavailable without installation/substitution.
- **Review 17 — 2026-07-22 — HOLD:** exact session
  `019f8cc2-3418-77e3-be8d-778fa09102bd` ran under host-reported
  `gpt-5.6-sol` with `xhigh` reasoning, repeated the identity/scope gate over
  all 42 files, and returned no Critical, two High, one Medium, and no Low
  findings. Linked worktrees denied their pointer and per-worktree
  administration directory but not the resolved shared common Git directory.
  Fallback workspace fingerprints invoked ambient Git before containment and
  dereferenced untracked symlinks on the host.
- **Review 17 closure:** candidate metadata resolution now validates and denies
  a linked worktree's shared common directory as well as its pointer and
  per-worktree administration data; explicit and implicit platform grants use
  the same bidirectional test. All host-side fingerprint and sanitized-view Git
  calls use fixed trusted discovery, a closed configuration environment, and
  disabled repository-local executable helpers. Untracked symlinks hash only
  target text, non-regular entries are structural markers, and contained
  regular files have per-file and aggregate byte ceilings. Focused command-
  boundary coverage passes 30/30 on macOS and capability-enabled networkless
  Linux, including hostile `PATH`/`GIT_*`/fsmonitor, common-root grants,
  external large symlinks, oversized regular files, and FIFOs. Complete
  verification passes 892/892 repository tests (824 primary plus the 68-test
  graph-mode kernel), worktree 12/12, objective loop 8/8, workflow conformance
  233/233 (165 primary plus the same graph kernel), provider contracts 35/35,
  both 101-file package paths including installed Pi 0.80.10
  RPC/default-factory proof, active no-egress 5/5, and capability-enabled Linux
  sandbox/task-loop 30/30 with network disabled. Resources, documentation truth,
  repository policy, public-safety diff, static no-live-egress, syntax, and diff
  checks pass. Fresh all-scope Review 18 remains pending, so the branch stays
  HOLD. The complete gate ran on supported Node 24.16.0 and Linux proof on Node
  24.18.0; exact Node 22.19/26 remains unavailable without installation or
  substitution.
- **Review 18 — 2026-07-22 — INTERRUPTED:** exact session
  `019f8cdf-b302-7a72-a8cb-876ce1895dfc` ran under host-reported
  `gpt-5.6-sol` with `xhigh` reasoning and repeated the exact 42-file identity
  gate, but the platform stopped the read-only audit before it could write a
  report or severity verdict. It is not counted as a completed all-scope
  review. Its partial scheduler trace identified a terminal/checkpoint
  cancellation race, which an independent in-memory reproduction confirmed in
  both modes: cancellation during a successful terminal-checkpoint write could
  make the direct call return `cancelled` after the persisted terminal event
  and checkpoint had already committed `succeeded`.
- **Review 18 partial-finding closure:** a successfully persisted terminal
  checkpoint is now the scheduler's authoritative terminal result. A late
  cancellation cannot replace it after the terminal event pair and terminal
  marker commit. The dual-mode regression proves the returned result, final
  event, and durable marker remain identical. Focused kernel verification
  passes 69/69. A fresh complete Review 19 remains required, so the branch
  stays HOLD.
- **Review 19 — 2026-07-22 — HOLD:** exact session
  `019f8cec-4d25-7330-b82a-4e64dc4f0013` ran under host-reported
  `gpt-5.6-sol` with `xhigh` reasoning, repeated the opening and closing
  identity/scope gate over all 42 files, and returned no Critical, one High,
  one Medium, and no Low findings. Cancellation and whole-run deadlines were
  not re-arbitrated after the terminal node-entry checkpoint, and the fresh-run
  command could relabel a durably committed failed/refused result from a late
  outer abort.
- **Review 19 closure:** both execution modes now recheck interruption after
  the terminal node-entry checkpoint and before terminal publication. The
  terminal event pair carries one exact status/code, and successful terminal
  checkpoint persistence exposes explicit authority through the product
  result. Fresh-run command arbitration preserves that authority while still
  translating genuine nonterminal cancellation/deadline outcomes. Dual-mode
  regressions cover pre-commit cancellation and deadline across succeeded,
  failed, refused, and authored-cancelled terminals; product regressions bind
  every committed terminal through execution state and watch; command-core
  regressions cover late outer aborts, recoverable failures, deadlines, and
  adapter fallback. Complete verification passes 898/898 repository tests (828
  primary plus the 70-test graph-mode kernel), worktree 12/12, objective loop
  8/8, workflow conformance 238/238 (168 primary plus the same graph kernel),
  provider contracts 35/35, both 101-file package paths including installed Pi
  0.80.10 RPC/default-factory proof, active no-egress 5/5, and capability-
  enabled Linux sandbox/task-loop 30/30 with network disabled. Resources,
  documentation truth, repository policy, public-safety diff, static no-live-
  egress, syntax, and diff checks pass. Fresh all-scope Review 20 remains
  required, so the branch stays HOLD. The complete gate ran on supported Node
  24.16.0 and Linux proof on Node 24.18.0; exact Node 22.19/26 remains
  unavailable without installation or substitution.
- **Review 20 — 2026-07-22 — HOLD:** exact session
  `019f8d0c-bfc6-7971-ad88-01c551c85306` ran under host-reported
  `gpt-5.6-sol` with `xhigh` reasoning, repeated the opening and closing exact
  42-file scope gate, and returned no Critical, two High, one Medium, and no Low
  findings. Repository-local clean/process filters could execute on the host
  during fallback fingerprinting; replacement refs could substitute a
  historical tree while building the private checker database; and exact
  terminal completion was projected only after its checkpoint had already
  cleared projection debt.
- **Review 20 closure:** fallback fingerprints no longer invoke worktree-
  converting Git porcelain. Fixed/config-sterile Git reads the actual HEAD,
  object format, index, and untracked path set with replacement refs disabled;
  bounded descriptor-safe filesystem reads bind tracked and untracked bytes,
  symlink text, missing paths, and structural entries without invoking authored
  filters. Sanitized Git-view preparation also disables replacement refs for
  ordinary and linked worktrees. A terminal checkpoint now projects its exact
  completed status/code before clearing debt. Persistent projection failure
  leaves the private terminal and explicit debt authoritative; resume repairs
  state from that authenticated marker without provider or worktree effects.
  Focused command-boundary coverage passes 32/32 and product execution passes
  42/42, including all four authored terminal statuses in both modes. Complete
  verification passes 901/901 repository tests (831 primary plus the 70-test
  graph-mode kernel), worktree 12/12, objective loop 8/8, workflow conformance
  239/239 (169 primary plus the same graph kernel), provider contracts 35/35,
  both 101-file package paths including installed Pi 0.80.10 RPC/default-
  factory proof, active no-egress 5/5, and capability-enabled Linux sandbox/
  task-loop 32/32 with network disabled. Resources, documentation truth,
  repository policy, public-safety diff, static no-live-egress, syntax, and
  diff checks pass. Fresh all-scope Review 21 remains required, so the branch
  stays HOLD. The complete gate ran on supported Node 24.16.0 and Linux proof
  on Node 24.18.0; exact Node 22.19/26 remains unavailable without installation
  or substitution.
- **Review 21 — 2026-07-22 — HOLD:** exact session
  `019f8d2f-422c-7890-bd4d-fdc25cb00862` ran under host-reported
  `gpt-5.6-sol` with `xhigh` reasoning, repeated the opening and closing exact
  42-file scope gate, and returned no Critical, two High, no Medium, and no Low
  findings. Terminal projection repair authenticated the retained event prefix
  but could publish a forged scheduler terminal before canonical task/runtime/
  mode/budget/journal/terminal admission. Runtime smoke used ambient Git diff
  porcelain for workspace identity, allowing repository-local textconv or
  related Git helpers to execute on the host.
- **Review 21 closure:** terminal projection repair now calls the scheduler's
  actual terminal-resume admission path before any public event/state or private
  debt write. The shared path binds the task, definition, execution mode,
  runtime cast, immutable budget, exact journal prefix, terminal semantics, and
  final `node-end`/`run-end` status-code pair; refusal leaves every projection
  byte and debt marker untouched. Runtime smoke now binds both modes to one
  replacement-disabled commit, creates filter-free no-checkout worktrees,
  populates their index with raw tree metadata, materializes exact blobs,
  executable modes, and symlink text, and reuses the bounded physical workspace
  fingerprint. Adversarial product tests cover forged terminal authority and
  unchanged debt in both modes. Ordinary and linked-worktree smoke tests cover
  textconv, clean/smudge/process filters, fsmonitor, hooks, ambient `GIT_*`,
  replacement refs, external symlinks, and source-HEAD drift between mode runs.
  Focused regressions pass 2/2. Complete verification passes `npm test` 903/903
  repository tests (833 primary plus the 70-test graph-mode kernel), worktree
  12/12, objective loop 8/8, workflow conformance 241/241 (171 primary plus the
  same graph kernel), and provider contracts 35/35. Both 101-file package paths
  pass, including installed Pi 0.80.10 RPC/default-factory proof; active Docker
  no-egress passes 5/5; and capability-enabled Linux sandbox/task-loop passes
  32/32 with network disabled. Resources, documentation truth, repository
  policy, public-safety diff, static no-live-egress, syntax, and diff checks
  pass. The complete gate ran on supported Node 24.16.0 and Linux proof on Node
  24.18.0; exact Node 22.19/26 remains unavailable without installation or
  substitution. Fresh all-scope Review 22 remains required, so the branch stays
  HOLD.
- **Review 22 — 2026-07-23 — HOLD:** exact session
  `019f8d55-ed21-7fa0-aec6-f885422a0e22` ran under host-reported
  `gpt-5.6-sol` with `xhigh` reasoning over the complete 42-file branch scope
  and returned no Critical, three High, three Medium, and no Low findings. A
  resumed active terminal could bypass cancellation/deadline arbitration; a
  private terminal without explicit projection debt could reach certification;
  pre-sandbox Nix closure discovery inherited ambient plugins/configuration/
  remotes; smoke accumulated the materialized tree before aggregate admission;
  raw Git path and symlink bytes were decoded lossily; and cleanup destroyed
  recovery state or leaked untyped failures when worktree/root removal failed.
- **Review 22 closure:** the scheduler now re-arbitrates cancellation and the
  cumulative deadline after every fresh or resumed active node-entry checkpoint
  and before terminal publication, including nested-child continuation.
  Product resume enforces a closed public/private projection relation:
  nonterminal private state requires incomplete public state, private terminal
  state requires explicit schema-2 debt, and any already-completed public
  terminal under that debt must match status, code, and node exactly. Matching
  completed state is a maintenance retry that clears debt before provider
  certification. Nix closure discovery now uses a fixed helper, private
  home/configuration, the local daemon, and disabled plugins, substituters, and
  builders, independent of ambient Nix state and `PATH`.
  Runtime smoke pre-admits one immutable raw-tree manifest before registering a
  worktree. It bounds object ids, modes, byte paths, prefix collisions,
  individual and aggregate bytes, and count with checked arithmetic; preserves
  POSIX filenames and symlink targets as bytes; and refuses before registration
  when the filesystem cannot represent the tree. Cleanup independently removes
  and reconciles every Git registration and lexical/physical checkout identity,
  retains the recovery root on uncertainty, and reports a stable typed cleanup
  result. Focused verification passes kernel/graph 80/80, product execution
  49/49, and command/sandbox configuration 33/33. Complete verification passes
  `npm test` 913/913 repository tests (841 primary plus the 72-test graph-mode
  kernel), worktree 12/12, objective loop 8/8, workflow conformance 250/250
  (178 primary plus the same graph kernel), and provider contracts 35/35. Both
  101-file package paths pass, including installed Pi 0.80.10 RPC/default-
  factory proof; active Docker no-egress passes 5/5; and capability-enabled
  Linux sandbox/task-loop passes 32/32 with network disabled (the Nix-only case
  is skipped in the Nix-free image and passes on the Nix host). Resources,
  documentation truth, repository policy, public-safety diff, static
  no-live-egress, syntax, and diff checks pass. The complete gate ran on
  supported Node 24.16.0 and Linux proof on Node 24.18.0; exact Node 22.19/26
  remains unavailable without installation or substitution. Fresh all-scope
  Review 23 remains required, so the branch stays HOLD.
- **Review 23 — 2026-07-23 — HOLD:** exact session
  `019f8d9c-476d-75a3-91a4-3f90068a235d` ran under host-reported
  `gpt-5.6-sol` with `xhigh` reasoning, repeated the opening and closing
  identity gates over the exact 42-file branch scope, and returned no Critical,
  no High, two Medium, and no Low findings. Filesystem preflight skipped raw
  paths during collision analysis and approximated Unicode case folding, so a
  valid Git tree could collide only after worktree registration. Cleanup
  captured a physical checkout identity but required filesystem absence only
  for its lexical alias.
- **Review 23 closure:** runtime smoke now materializes the complete manifest
  path/type skeleton in a disposable pre-registration tree, enumerates every
  path as raw bytes, verifies exact symlink payloads, and requires successful
  probe removal. It therefore proves the target filesystem's actual collision
  behavior instead of approximating Unicode normalization or case folding.
  Lexical and physical root identities are captured while the scratch root
  exists; checkout identities are derived before any partial add, and cleanup
  requires all of them to be absent from Git registration and the filesystem
  before removing the root. Raw/Unicode collision, partial-add residue,
  lexical-alias removal with a physical survivor, existing recovery, and root
  failure regressions pass; the full product execution suite passes 52/52.
  Complete verification passes `npm test` 916/916 repository tests (844 primary
  plus the 72-test graph-mode kernel), worktree 12/12, objective loop 8/8,
  workflow conformance 253/253 (181 primary plus the same graph kernel), and
  provider contracts 35/35. Both 101-file package paths pass, including
  installed Pi 0.80.10 RPC/default-factory proof; dispatch and revision smokes
  pass; active Docker no-egress passes 5/5; and capability-enabled Linux
  sandbox/task-loop passes 32/32 with network disabled (the Nix-only case is
  skipped in the Nix-free image and passes on the Nix host). Resources,
  documentation truth, repository policy, public-safety diff, static
  no-live-egress, syntax, and diff checks pass. The complete gate ran on
  supported Node 24.16.0 and Linux proof on Node 24.18.0; exact Node 22.19/26
  remains unavailable without installation or substitution. Fresh all-scope
  Review 24 remains required, so the branch stays HOLD.
- **Review 24 — 2026-07-23 — HOLD:** exact session
  `019f8dbd-c0c8-77d0-92b4-56d0dfea165c` ran under host-reported
  `gpt-5.6-sol` with `xhigh` reasoning, repeated both identity gates over the
  exact 42-file scope, and returned no Critical, no High, two Medium, and no
  Low findings. The pre-registration probe erased executable-mode identity,
  while objective-sandbox setup could conceal scratch-cleanup failure or throw
  after a workspace guard opened without rolling it back.
- **Review 24 closure:** runtime smoke now creates and explicitly chmods every
  regular probe file to its manifest mode, enumerates the actual executable
  bit, and compares `100644`/`100755` exactly before registration. Sandbox
  preparation funnels every post-scratch refusal and exception through
  verified cleanup; its caller catches preparation exceptions and always
  rolls back an opened workspace guard, preserving cleanup-failure precedence.
  Focused executable-loss, cleanup-failure, and rollback regressions pass.
  Complete verification passes `npm test` 919/919 repository tests (847
  primary plus the 72-test graph-mode kernel), worktree 12/12, objective loop
  8/8, workflow conformance 254/254 (182 primary plus the same graph kernel),
  and provider contracts 35/35. Both 101-file package paths pass, including
  installed Pi 0.80.10 RPC/default-factory proof; dispatch and revision smokes
  pass; active Docker no-egress passes 5/5; and capability-enabled Linux
  sandbox/task-loop passes 34/34 with network disabled (the Nix-only case is
  skipped in the Nix-free image and passes on the Nix host). Resources,
  documentation truth, repository policy, public-safety diff, static
  no-live-egress, syntax, and diff checks pass. The complete gate ran on
  supported Node 24.16.0 and Linux proof on Node 24.18.0; exact Node 22.19/26
  remains unavailable without installation or substitution. Fresh all-scope
  Review 25 remains required, so the branch stays HOLD.
- **Review 25 — 2026-07-23 — SHIP:** exact session
  `019f8ddd-923b-7f73-9868-e1491cce1c37` ran under host-reported
  `gpt-5.6-sol` with `xhigh` reasoning, read the controlling plan and both
  append-only workflow ledgers, inspected the complete 42-file branch scope,
  revalidated every earlier closure, and repeated the repository identity and
  scope gates at the end. It returned no Critical, High, Medium, or Low
  findings: **SHIP — C0/H0/M0/L0**. The review was strictly read-only, so it
  independently traced the supplied verification evidence rather than
  rerunning the suites. The iterative review gate is complete.
- **PR #18 pre-merge CI finding — 2026-07-23:** required run
  `29991995114` exercised the exact Node 22.19/26 and Pi 0.80.7/0.80.10 matrix
  on GitHub's Ubuntu 24.04 image and failed before merge. AppArmor denied the
  unprivileged user-namespace capabilities required by the real Linux command
  sandbox, and the raw-tree probe admitted an invalid-UTF-8 regular path after
  proving creation but before proving the byte-exact `realpath` operation used
  by physical fingerprinting.
- **PR #18 CI closure:** the ephemeral matrix applies Canonical's documented
  one-boot AppArmor setting, proves the exact `unshare` boundary, and continues
  to run the production sandbox rather than skipping or mocking it.
  Pre-registration filesystem proof now exercises every parent and regular-file
  `realpath` operation required by the downstream fingerprint; unsupported raw
  paths refuse before any worktree registration. The repository-governance and
  Linux raw-path regressions bind both repairs. The PR remains unmergeable until
  the replacement exact-head `test` check succeeds.

## 12. Commit and completion contract

Before committing:

- all planned implementation and documentation items are complete;
- full verification is green or any genuinely unavailable gate is explicitly
  reported and does not have an unapproved substitute;
- iterative review has no critical/high/medium findings;
- `git diff --check` passes;
- branch contains only scoped changes and no secrets/private artifacts;
- no temporary worktrees, run records, caches, or scratch artifacts remain;
- no PR exists and no remote/default-branch mutation occurred;
- documentation counts and claims match observed evidence.

Create exactly one commit on `graph-mode`. Verify the commit contains the full
feature, tests, plan, docs, and review-ledger updates. Do not push, open a PR,
merge, tag, release, or rewrite another branch unless separately authorized.

## 13. Progress ledger

- [x] Dedicated `graph-mode` branch created from the recorded base.
- [x] Controlling migration plan created.
- [x] Canonical typed graph module implemented.
- [x] Original/graph scheduler modes implemented.
- [x] Product selection, consent binding, persistence, and resume implemented.
- [x] Visualization and authoring extensions implemented.
- [x] Unit/parity/smoke/E2E/persistence/package tests implemented.
- [x] Documentation and ledgers synchronized.
- [x] Review 24 findings fixed and complete verification green.
- [x] Review 25 completed over the exact 42-file scope with
  **SHIP — C0/H0/M0/L0**.
- [x] Review/fix loop complete with no critical/high/medium findings.
- [x] Supported-Node 22.19/26 unavailability is explicitly disclosed; no
  installation or substitute runtime was used.
- [x] Final single commit created and verified.
- [ ] PR #18 replacement exact-head Node/Pi matrix passes and the squash-only
  merge is verified on remote and local `main`.
