# Helix Workflow/Subagent Architecture — Consolidated Solution Roadmap

- **Evaluation date:** 2026-07-16
- **Consolidation date:** 2026-07-16
- **Reviewer:** consolidated principal-architecture review (Fable 5 evidence review reconciled with an independent fresh-context adversarial review)
- **Repository:** `luisgui1757/helix` (public; default branch `main`; not a fork at evaluation time)
- **Exact target SHA:** `bb1c37f62ee1808a5c24bac06d975023f73dcb3b`
- **Relationship to the Fable review:** the [original Fable review](reviews/workflows/FABLE_ARCHITECTURE_ROADMAP_2026-07-16.md) is preserved as historical evidence; this file preserves its verified evidence and correct findings while superseding its implementation recommendation.
- **Authority:** this is the decision-complete specification for the eventual implementation branch. If current primary-source evidence or repository state contradicts it, the implementation agent must stop and report the drift rather than improvise.

## 2. Executive verdict

Helix should keep one provider-neutral orchestration engine and retain the parts it already does unusually well: exact preflight binding, explicit consent, deterministic objective gates, append-only events, two-phase state commits, refusal codes, worktree ownership, and public-safe persistence.

The canonical replacement is a **Helix Workflow Kernel (HWK)** built around a closed, typed workflow intermediate representation and a durable effect scheduler. The existing guided builder, JSON definitions, bundled templates, and a programmatic builder API all produce the same validated IR. Runtime arbitrary JavaScript is not the engine and is outside this implementation. Advanced users compose IR through the pure builder library and submit its validated output.

> **Implementation status (2026-07-16):** implementation-complete on the
> isolated `helix-workflow-kernel-v1` branch. WS1-WS14 and the complete §22
> local gate passed, including the authorized free OpenRouter standalone and
> production Pi-path proofs. Delivery remains valid only when the post-commit
> remote branch SHA and exact-head branch CI also pass; those post-commit facts
> are verified externally because a commit cannot truthfully contain evidence
> about its own future push. The implementation ledger is
> `reviews/workflows/SUMMARY.md`.

> **Exact-head audit remediation status (2026-07-18):** the independent audits
> found that native v4 input could bypass or redefine the final objective gate,
> malformed imports could throw through the validation boundary, v4 definition
> checks mislabeled structural edge counts as executed transitions, and the
> live-certification policy bit was not enforced by the product path. The
> remediation makes the top-level objective the sole convergence authority,
> forbids every other incoming success edge, requires recorded final-gate pass
> evidence at the terminal (including resume), makes migration/import total,
> runs optional smoke tests through HWK, reports only observed coverage, and
> exact-disables unprovable live-certification policy before provider preflight.
> The complete local suite passed at 647/647 plus worktree 12/12 and objective
> loop 8/8. Exact-head remote CI is the delivery gate; its authoritative result
> is the GitHub check attached to the remediation commit.

> **Release-quality audit closure (2026-07-18):** independent exact-head reviews
> then exercised composed and failure-boundary behavior absent from the original
> suite. The canonical closure adds two-phase workspace finalization with
> retained recovery material, strict journal-prefix verification, namespaced
> child-checkpoint continuation, invocation-level panel accounting, complete
> typed-input UX, canonical-worktree pre-consent refusal, mandatory exact account
> evidence, deployment-atomic import, distinct pause rendering, explicit cyclic
> default edges, bounded condition depth, per-field evidence grades, exact
> checkpoint limits, child-aware runtime smoke, and extracted-package Pi RPC in
> CI. The updated complete suite passes 669/669 plus worktree 12/12 and objective
> loop 8/8. The append-only evidence and finding closure are recorded in
> `reviews/workflows/{SUMMARY,ASSUMPTIONS}.md`; exact-head remote CI remains the
> delivery authority after the single normal remediation push.

> **Consolidated exact-head closure (2026-07-18):** the subsequent Fable 5 and
> Codex 5.6 reviews independently found a journal/checkpoint continuation gap,
> replayed recoverable failures, maskable kernel-owned failures, incomplete
> child deployment preflight, and bounded composition/authoring defects. The
> canonical closure durably checkpoints each pre-invocation intent and consumed
> effect, reconciles journal-ahead outcomes without destructive truncation or
> repeated completed calls, retries only genuinely incomplete work as a new
> counted invocation, and uses a closed failure class so scheduler-owned
> failures cannot be allowlisted. Direct-child casts now participate in import,
> inventory, consent, and runtime binding; parallel/map first waves reserve
> atomically; every cyclic decision edge has explicit loop metadata and an
> escape; deadlines are cumulative across continuation; runtime smoke generates
> schema-valid witnesses; and public workflow helpers and operational limits are
> bounded from one exported source. The final complete local suite passes
> 685/685 plus worktree 12/12 and objective loop 8/8. Exact-head remote CI after
> the single normal push remains the delivery authority.

> **Composed-boundary audit closure (2026-07-19):** the next independent Fable
> 5 and Codex reviews agreed that final-gate authority was sound and exposed a
> disjoint persistence/composition set. The canonical closure verifies journal
> result hashes and exact parent/child suffix identities; makes private
> checkpoint publication authoritative while retaining cleanup/projection as
> durable maintenance debt; binds checkpoint consent to one exact visit; bounds
> agent results and derived effect inputs with closed failures; compiles child
> prompts from the child definition; and rejects incompatible parent/child
> input schemas before import, consent, or run creation. Full reachability now
> classifies decision cycles in the loops-disabled graph, accepted integer
> schemas always contain a safe witness, gate-only and child-only workflows are
> deployable, and exact runtime selection rejects `uncertified-disabled` paths.
> Canonical persistence round-trips the exact 256 KiB definition limit through
> save, list, watch, and resume; named-run leases serialize concurrent resumes.
> Focused closure suites pass 140/140. The complete local gate passes 698/698
> plus worktree 12/12 and objective loop 8/8; workflow conformance passes 79/79,
> provider contracts 27/27, the extracted 99-file package passes Pi RPC, and
> active Docker network denial passes 5/5. Exact-head remote CI after the single
> normal push remains the final delivery authority.

> **Runtime-contract and durable-state closure (2026-07-19):** the next
> independent exact-head reviews found that validated agent fields were not all
> executable contracts, resumed completion/budget state admitted forged or
> drifting combinations, visit identities could collide, host/mock callbacks
> could manufacture effects, and OpenRouter proof did not bind the complete
> account/endpoint/generation tuple. The canonical closure carries prompt,
> output, tools, mutation, artifact, visit, attempt, run, and RoleEnvelope
> identity through every product/runtime boundary; recursively validates
> completed journal evidence, visits, child state, and immutable lifetime
> budgets; counts failed usage and structured repairs; namespaces repeated
> visits; closes every host effect; and keeps mock mutation inside the counted
> candidate adapter. OpenRouter preflight and the opt-in certification tool now
> bind creator account, unique endpoint tag/quantization/provider, response,
> and generation observations before certification. The complete local suite
> passes 723/723 plus worktree 12/12 and objective loop 8/8. Exact-head remote
> CI and independent post-push review remain the authority for live-testing
> readiness.

> **Scoped-budget and production Pi-path closure (2026-07-19):** the next
> fresh-context GPT-5.6 Sol xhigh review at exact head
> `e167966e87baaa3664f90e23d1bf2995aee6e61c` found three connected boundary
> defects: the OpenRouter audit proxy omitted quantization and compared a route
> tag with the provider name; parent budget injection could raise a child's
> declared effect ceiling; and a Pi AgentSession could hide several provider
> turns inside one kernel effect. It also found that prior package evidence did
> not traverse the shipped adapter's default session factory. The canonical
> closure gives every child invocation a checkpointed local ledger over the
> shared parent lifetime ledger, aligns exact routing with endpoint tag,
> quantization, and provider-name semantics, and exact-disables tool-bearing or
> mutating real Pi definitions until every internal provider turn can be owned
> and journaled. Real exact Pi sessions are one read-only, tool-free turn with
> all Pi transport retries disabled. The package matrix now imports the
> extracted adapter and executes its real default AgentSession factory through
> the localhost audit proxy and deterministic in-memory upstream. No live
> provider or model call is part of this closure. The complete local gate passes
> 728/728 with zero skips, worktree 12/12, objective loop 8/8, conformance 98/98,
> provider contracts 35/35, all package modes with exactly 99 files and Pi RPC/
> default-factory proof, and active Docker 5/5. Exact-head CI and independent
> rereview remain mandatory before live testing.

> **Nested continuation-budget containment (2026-07-19):** exact-head Sol
> rereview found that recursive checkpoint validation accepted a child ledger
> whose consumed totals exceeded a reset enclosing parent ledger. Continuation
> could therefore execute beyond the parent lifetime ceiling while reporting
> only the reset outer total. The checkpoint validator now requires every
> nested child's effects, tokens, cost, and reservations to be contained by its
> parent snapshot before execution; the paused-child regression resets all
> three consumed totals and proves refusal with zero additional calls.

> A second fresh review then reset both parent and child totals together and
> showed that containment alone was insufficient. Root checkpoint admission
> now derives an independent minimum from the exact durable journal prefix and
> checkpointed invocations not yet in that prefix. Effects, tokens, and cost
> below that evidence refuse before execution, closing coordinated nested
> resets without rejecting journal-ahead recovery.

> **Journal-ahead instance binding (2026-07-19):** final review then swapped
> two in-flight identities while leaving their durable records unchanged. The
> suffix identity set still matched, but continuation assigned each result to
> the other parallel instance. Reconciliation now verifies every found
> in-flight record's node, instance, base identity, and mutation mode before
> suffix admission; the two-result crash-window regression proves refusal with
> zero replay.

> **Cross-level journal and abort-attribution closure (2026-07-19):** final
> Fable review then promoted genuine child journal-ahead state into a colliding
> parent node and showed that string-only bindings could consume the child's
> result as parent work. Journal schema 3 now records the executing run
> namespace, effect base identities include it, and active reconciliation plus
> reuse require an exact namespace match; legacy records remain readable but
> cannot prove continuation. The same review showed a lower-index retrying
> sibling could replace the decisive abort failure with a synthetic stopped
> result. Fan-out coordination now retains the first stop-triggering result
> across parallel, map, and expanded members.

Every model invocation is an explicit effect handled through an `AgentRuntime` adapter. Pi remains the default broad-provider adapter, but it is not treated as proof of entitlement, account selection, effective model, or policy legitimacy. Provider-specific adapters may be used where their official surface is required for correct request shaping or subscription use. Multiple adapters under one scheduler are not multiple workflow engines.

The other load-bearing changes are:

1. **Capability and identity attestation:** requested and effective provider, model, effort, route, and opaque account identity are bound before egress and recorded with an evidence grade.
2. **Provider certification:** configured, contract-tested, live-certified, and policy-permitted are distinct states. A provider path is disabled until its required state is proven.
3. **Effect-aware recovery:** mutating model calls are never replayed from text-only cache entries. Their repository effects are atomically committed, journaled, restored, and verified.
4. **One canonical run workspace:** isolated writers produce proposals that are deterministically promoted into the canonical run worktree before downstream stages execute.
5. **Typed trust boundaries:** operator policy, task text, repository data, and agent output are different content classes. Delimiter fencing is defense in depth, not authorization.
6. **Visual and testable workflows:** users can preview the planned graph and hard bounds before execution and inspect the observed state/effect graph afterward.

Neither `pi-dynamic-workflows` implementation, Claude Agent SDK, native Claude Workflow JavaScript, Helix CC, nor CLIProxyAPI should replace the Helix kernel. Quintin Shaw's MIT implementation is a useful mechanism reference; Michaelliv's repository may be used only as black-box behavioral research unless its licensing is resolved. Claude Workflow is the mechanical reference. Helix CC is a complementary Claude-only reference. CLIProxyAPI is rejected.

Everything lands together on one fresh non-default branch. Nothing is presented as available until the complete architecture, migrations, tests, documentation, packaging checks, provider-state truthfulness, and verification gate are present.

> **Graph-mode extension status (2026-07-22):** implementation is complete on
> the dedicated `graph-mode` branch pending its required iterative review gate.
> WorkflowDefinition v4 now has one canonical typed graph compiler, structural
> analyses and projection, stable edge identity, and hygienic fragment
> composition. `original-mode` remains the default direct resolver and retains
> historical binding/runtime identity; opt-in `graph-mode` swaps only transition
> resolution inside the same scheduler. Mode is consented, persisted in public
> state schema 5, inherited by children, and fixed for continuation; schema-4
> run state remains legacy original-mode. Provider-free smoke and product E2E
> paths compare both modes, while graph unit/construction/parity suites cover
> edge identity, cycles, routing, persistence, visualization, and malformed
> boundaries. `graph-migration.md` is the controlling completion and review
> ledger for this extension.
>
> The first exact GPT-5.6 Sol xhigh branch review returned HOLD with one High,
> three Medium, and two Low findings. All six are implemented: kernel-owned
> checkpoint mode binding, closed event admission, pinned nested/current graph
> projection, full normalized independent-worktree parity, attended graph
> pause/resume E2E, and append-only ledgers. Full locally available
> re-verification is green; the supported Node 22.19/26 matrix is unavailable
> without dependency installation. The second exact-model review returned HOLD
> with two Medium and two Low findings. All four are implemented: immutable
> run-owned definitions with detached effect inputs, exact definition-bound
> event schemas, locale-independent canonical ordering, and total
> descriptor-safe combinators. Full locally available re-verification is green
> at 771/771 repository tests, 132/132 workflow conformance, 35/35 provider
> contracts, extracted-package real Pi proof, and active no-egress 5/5. The
> third all-scope review returned HOLD with no Critical/High, five Medium, and
> two Low findings. Its checkpoint, event-correlation, historical-watch,
> run-companion, fragment-admission, ledger, and parity gaps are now closed with
> focused regressions. The full 51-test kernel adversarial suite also passes
> under graph-mode. Complete locally available re-verification is green at
> 827/827 repository tests, 186/186 workflow conformance, 35/35 provider
> contracts, extracted-package real Pi proof, and active no-egress 5/5. The fresh
> fourth all-scope review returned HOLD with no Critical/High, three Medium, and
> one Low finding. Its observed lifecycle, child-companion grammar, pre-clone
> fragment admission, and detached artifact callback gaps are closed with
> 164/164 focused tests. Complete locally available re-verification is green at
> 829/829 repository tests, 188/188 workflow conformance, 35/35 provider
> contracts, both extracted-package paths including real Pi proof, and active
> no-egress 5/5. The fifth all-scope review returned HOLD with no Critical/High,
> three Medium, and no Low findings. Its orphan-resume, child-success causality,
> and completed-failure watch gaps are closed with 76/76 focused kernel/schema
> and product regressions across both modes. Complete locally available
> re-verification is green again at 829/829 repository tests, 188/188 workflow
> conformance, 35/35 provider contracts, both extracted-package paths, and active
> no-egress 5/5. Review 6 was interrupted by the reviewer service after
> reproducing four additional lifecycle/persistence defects in both modes:
> terminal replay, journal-ahead observed evidence, first-checkpoint failure
> evidence, and retry-policy admission. All four are closed with terminal-result
> checkpoints, explicit recovered-effect events, authored retry/repair bounds,
> and durable-checkpoint-aware terminalization. Focused evidence passes 79/79
> kernel/schema, 54/54 graph-mode kernel, and 149/149 graph/product tests. Full
> locally available re-verification passes 837/837 repository tests, 196/196
> workflow conformance, 35/35 provider contracts, both 100-file extracted
> package paths including real Pi proof, and active no-egress 5/5. Exact Node
> 22.19/26 remains unavailable without dependency installation. Review 7 then
> returned HOLD with no Critical/High, three Medium, and no Low findings. Its
> incomplete observed-effect obligations, locale-dependent graph binding, and
> smoke-manufactured convergence are closed through structural effect plans,
> slot/final-outcome admission, code-unit graph binding order, and real
> candidate-owned artifact plus deterministic-gate smoke boundaries. The
> repository gate now passes 840/840 (786 primary plus 54 graph-mode kernel),
> worktree 12/12, objective loop 8/8, workflow conformance 198/198, provider
> contracts 35/35, both 100-file package paths including real Pi proof, and
> active no-egress 5/5. Static/docs/policy/resource gates also pass. A fresh
> all-scope review remains required before this status can become DONE.
> Review 8 then returned HOLD with no Critical, one High, one Medium, and no
> Low: terminal event-write failure could still be checkpointed as success, and
> authored command objective gates were not actually read-only. Both are closed
> through authoritative structural event barriers, terminal-prefix resume,
> macOS/Linux network-denied read-only command sandboxes, sanitized environment
> state, exact fingerprint-bound evidence, and private drift restoration for
> named/staged runs. Kernel matrices pass 60/60 in each mode plus product
> terminal-resume and macOS/Linux candidate/outside-write denial coverage. Full
> verification passes 855/855 repository tests, 211/211 workflow conformance,
> 35/35 provider contracts, both 101-file package paths with real Pi proof, and
> active no-egress 5/5. Review 9 remains required before this status can become
> DONE.
> Review 9 returned HOLD with no Critical, two High, one Medium, and no Low:
> checkpoints counted but did not authenticate their event prefix; command
> sandboxes retained ambient host-read, Git-common-dir, and Linux IPC exposure;
> and cancellation finalized evidence before confirming process termination.
> All three are closed through rolling canonical event-prefix refs in public and
> private state, history-only legacy checkpoints, authoritative-prefix watch,
> explicit macOS read admission, credential-free ephemeral Git metadata, Linux
> IPC isolation, and bounded process-group termination confirmation. Focused
> retained-prefix tamper, suffix-watch, nested-child, outside-read, Git-status,
> namespace, timeout, and unconfirmed-termination regressions pass. Complete
> verification passes 860/860 repository tests, 213/213 workflow conformance,
> 35/35 provider contracts, worktree 12/12, objective loop 8/8, both 101-file
> package paths with real Pi proof, active no-egress 5/5, and the static/docs/
> policy/resource gates. The corrected capability-enabled Linux sandbox suite
> passes 20/20 with network disabled. Review 10 remains required before this
> status can become DONE.
> Review 10 returned HOLD with no Critical, four High, no Medium, and one Low:
> public state and nested child refs could outrun/escape the durable checkpoint;
> cancellation could terminalize live provider/gate work and lose usage;
> sandbox-integrity failures were routable; the Git view exposed the host object
> store; and static package proof omitted its sandbox module. All are closed
> through private-checkpoint-owned public projection, pre-effect recursive
> prefix authentication, bounded boundary settlement with nonterminal unknown
> outcomes, typed non-routable gate errors, a self-contained capped current-
> snapshot Git database, and complete package inventory. Focused coverage passes
> 130/130. Complete verification passes 866/866 repository tests, 219/219
> workflow conformance, 35/35 provider contracts, worktree 12/12, objective loop
> 8/8, both 101-file package paths with real Pi proof, active no-egress 5/5,
> capability-enabled Linux sandbox/task-loop 20/20, and all static/docs/policy/
> resource gates. Review 11 remains required before this status can become DONE.
> Review 11 returned HOLD with no Critical, two High, two Medium, and two Low:
> gate uncertainty could replay; CLI cancellation could hide continuation;
> first-checkpoint product state could claim completion without a terminal
> prefix; resume followed/unboundedly read its event path; fingerprints assumed
> SHA-1; and discovery admitted negative counts. All six are closed through
> checkpointed gate intent/results, recoverable-code preservation,
> private-checkpoint-derived product completion, bounded non-symlink event
> admission, repository-object-format-aware fingerprints, and nonnegative
> counts. Focused evidence passes 113/113. Complete verification passes 870/870
> repository tests, 222/222 workflow conformance, 35/35 provider contracts,
> worktree 12/12, objective loop 8/8, both 101-file package paths with real Pi
> proof, active no-egress 5/5, capability-enabled Linux sandbox/task-loop 21/21,
> and all static/docs/policy/resource gates. Review 12 remains required before
> this status can become DONE.
> Review 12 returned HOLD with no Critical/High, one Medium, and no Low: public
> journal cardinality remained weaker in watch, resume rendering, and actual
> continuation than in run discovery. The closure centralizes safe nonnegative
> event/journal count validation across all four readers, binds both counts to
> private scheduler authority, permits only explicit projection-debt lag, and
> repairs that lag before provider certification. Hostile negative, fractional,
> unsafe, and journal-ahead fixtures refuse before adapter access. Focused
> evidence passes 85/85. Complete verification passes 871/871 repository tests,
> 222/222 workflow conformance, 35/35 provider contracts, worktree 12/12,
> objective loop 8/8, both 101-file package paths with real Pi proof, active
> no-egress 5/5, capability-enabled Linux sandbox/task-loop 21/21, and all
> static/docs/policy/resource gates. Review 13 remains required before this
> status can become DONE.
> Review 13's first exact session was interrupted without a verdict; its
> replacement returned HOLD with no Critical, two High, no Medium, and one Low:
> late provider success could outrun cancellation/timeouts and commit mutation;
> ordinary-checkout Git metadata was still readable inside command sandboxes;
> and valid projection-debt repair lacked a positive regression. The closures
> force aborted agent settlement to retain usage but roll back and stop before
> routing, make physical `.git` unreadable on macOS and Linux for ordinary and
> linked worktrees, and exercise valid lag repair before the next workflow
> event. Complete verification passes 874/874 repository tests, 224/224
> workflow conformance, 35/35 provider contracts, worktree 12/12, objective loop
> 8/8, both 101-file package paths with real Pi proof, active no-egress 5/5,
> capability-enabled Linux sandbox/task-loop 22/22, and all static/docs/policy/
> resource gates. Review 14 remains required before this status can become DONE.
> Review 14 returned HOLD with no Critical, two High, two Medium, and no Low:
> bound direct continuation could omit event-prefix authentication; late gate
> pass could survive cancellation plus terminal persistence failure;
> projection-debt clearing failure was ignored before provider certification;
> and legacy schema-4 watch rendered beyond its recorded event count. The
> closures require an explicit exact prefix for every bound continuation,
> checkpoint causal gate interruption instead of late pass/fail, refuse until
> repaired projection debt is durably cleared, and slice both watch schemas to
> recorded authority. Complete verification passes 878/878 repository tests,
> 228/228 workflow conformance, 35/35 provider contracts, worktree 12/12,
> objective loop 8/8, both 101-file package paths with real Pi proof, active
> no-egress 5/5, capability-enabled Linux sandbox/task-loop 22/22, and all
> static/docs/policy/resource gates. Review 15 remains required before this
> status can become DONE.
> Review 15 returned HOLD with no Critical, three High, one Medium, and no Low:
> ancestor read admission could bypass physical Git-metadata isolation; Linux
> containment helpers could fall back to authored `PATH`; non-exit command
> termination was routable as authored failure; and malformed staged gate
> results were likewise routed. The closures admit exact external executables,
> reject candidate-containing roots, trust only fixed Linux helper roots, keep
> timeout/cancellation/spawn/process causes as typed errors, and close staged
> gate admission. Complete verification passes 882/882 repository tests,
> 228/228 workflow conformance, 35/35 provider contracts, worktree 12/12,
> objective loop 8/8, both 101-file package paths with real Pi proof, active
> no-egress 5/5, capability-enabled Linux sandbox/task-loop 25/25, and all
> static/docs/policy/resource gates. Review 16 remains required before this
> status can become DONE.
> Review 16 returned HOLD with no Critical, three High, two Medium, and no Low:
> descendant/symlink grants could expose physical Git metadata; retained effects
> and child terminals produced invalid combined resume histories; staged gate
> objects admitted extra fields; and late operator cancellation was labeled
> failed. The closures reject bidirectional Git-metadata intersections, derive
> unique effect completion from the authenticated prefix, retain child terminal
> proof for the same parent visit, close staged gate shapes, and preserve
> cancellation status. Complete verification passes 888/888 repository tests,
> 233/233 workflow conformance, 35/35 provider contracts, worktree 12/12,
> objective loop 8/8, both 101-file package paths with real Pi proof, active
> no-egress 5/5, capability-enabled Linux sandbox/task-loop 26/26, and all
> static/docs/policy/resource gates. Review 17 remains required before this
> status can become DONE.
> Review 17 returned HOLD with no Critical, two High, one Medium, and no Low:
> linked-worktree shared common metadata remained admissible; fallback
> fingerprints ran ambient Git before containment; and untracked symlinks were
> dereferenced on the host. The closures resolve and deny every common metadata
> root, use fixed configuration-sterile Git throughout host preparation, and
> structurally hash bounded untracked entries without following symlinks.
> Complete verification passes 892/892 repository tests, 233/233 workflow
> conformance, 35/35 provider contracts, worktree 12/12, objective loop 8/8,
> both 101-file package paths with real Pi proof, active no-egress 5/5,
> capability-enabled Linux sandbox/task-loop 30/30, and all static/docs/policy/
> resource gates. Review 18 repeated the exact scope under GPT-5.6 Sol xhigh
> but was interrupted by the platform before producing an all-scope verdict.
> Its partial trace exposed a terminal commit race: cancellation during a
> successful terminal-checkpoint write could contradict the already-persisted
> succeeded event/checkpoint. The closure makes the durable terminal marker
> authoritative and adds a both-mode regression, currently passing in the
> 69/69 focused kernel suite. Review 19 then returned HOLD with C0/H1/M1/L0:
> cancellation/deadline after terminal node-entry checkpointing could still
> lose before terminal publication, and fresh-run rendering could relabel an
> already durable non-success terminal. The closure re-arbitrates interruption
> at the pre-commit boundary, emits matching terminal status/code evidence,
> carries explicit terminal authority through product execution, and prevents
> outer command aborts from rewriting it. Targeted dual-mode kernel/product/
> command closure passes 8/8. Complete verification passes 898/898 repository
> tests, 238/238 workflow conformance, 35/35 provider contracts, worktree 12/12,
> objective loop 8/8, both 101-file package paths with installed Pi proof,
> active no-egress 5/5, capability-enabled networkless Linux 30/30, and every
> static/docs/policy/resource gate. Review 20 returned HOLD with C0/H2/M1/L0:
> repository clean/process filters could execute during pre-sandbox
> fingerprinting, replacement refs could import historical trees into the
> sanitized checker database, and terminal completion projection sat outside
> the durable debt transaction. The closure fingerprints physical
> tracked/untracked bytes without Git conversion, disables replacement refs in
> every preparatory Git environment, and projects or debt-marks exact terminal
> state inside its checkpoint transaction. Focused security and all-status,
> both-mode persistence/repair suites pass. Complete verification passes
> 901/901 repository tests, 239/239 workflow conformance, 35/35 provider
> contracts, worktree 12/12, objective loop 8/8, both 101-file package paths
> with installed Pi proof, active no-egress 5/5, capability-enabled networkless
> Linux 32/32, and every static/docs/policy/resource gate. Review 21 then found
> two High issues: terminal projection repair had not passed canonical scheduler
> admission, and smoke fingerprinting could run ambient Git content helpers.
> The closure routes repair through scheduler admission and uses a fixed,
> filter-free raw-object materialization/fingerprint path. Review 22 returned
> HOLD with C0/H3/M3/L0: resumed terminals skipped interruption arbitration,
> private terminals lacked a closed projection-debt relation, Nix closure
> discovery inherited ambient host authority, smoke admitted aggregate size too
> late, raw Git bytes were decoded lossily, and cleanup erased recovery evidence
> or escaped untyped. The closure re-arbitrates every fresh/resumed active node,
> enforces the exact public/private debt relation, sterilizes local-daemon Nix
> discovery, pre-admits one immutable byte-native raw-tree manifest, and
> reconciles cleanup while preserving uncertain recovery state. Focused
> kernel/graph 80/80, product execution 49/49, and command/sandbox 33/33 suites
> pass.
> Complete verification passes 913/913 repository tests, 250/250 workflow
> conformance, 35/35 provider contracts, worktree 12/12, objective loop 8/8,
> both 101-file package paths with installed Pi proof, active no-egress 5/5,
> capability-enabled networkless Linux 32/32, and every static/docs/policy/
> resource gate. Review 23 returned HOLD with C0/H0/M2/L0: filesystem
> preflight approximated collisions and cleanup did not prove physical checkout
> absence. The closure now round-trips the complete byte-exact path/type
> skeleton and symlink payloads in disposable scratch before registration,
> derives physical identities from the created root, and requires every
> lexical/physical identity to disappear from Git and the filesystem. Focused
> collision, partial-add, alias, survivor, and product execution coverage passes
> 52/52. Complete verification passes 916/916 repository tests, 253/253 workflow
> conformance, 35/35 provider contracts, worktree 12/12, objective loop 8/8,
> both 101-file package paths with installed Pi proof, active no-egress 5/5,
> capability-enabled networkless Linux 32/32, and every static/docs/policy/
> resource gate. Review 24 returned HOLD with C0/H0/M2/L0: the filesystem probe
> erased executable-mode identity, and sandbox preparation could conceal
> scratch-cleanup failure or bypass an opened workspace rollback. The closure
> now round-trips `100644`/`100755` before registration, verifies cleanup on
> every post-scratch refusal or exception, and rolls back the workspace guard
> when preparation throws. Complete verification passes 919/919 repository
> tests, 254/254 workflow conformance, 35/35 provider contracts, both 101-file
> package paths with installed Pi proof, active no-egress 5/5,
> capability-enabled networkless Linux 34/34, and every static/docs/policy/
> resource gate. Review 25 then completed a strict read-only all-scope trace
> over the exact 42-file branch scope, repeated both identity gates, and
> returned **SHIP — C0/H0/M0/L0**. The graph-mode extension review gate is
> **DONE**. Exact Node 22.19/26 execution remains explicitly unavailable without
> installation or substitution and is not claimed. PR #18's first required
> exact Node 22.19/26 and Pi 0.80.7/0.80.10 matrix then exposed two pre-merge
> portability gaps: Ubuntu 24.04 AppArmor denied the real user-namespace
> sandbox, and invalid-UTF-8 path creation did not prove the byte-exact
> `realpath` operation required by fingerprinting. The repaired matrix enables
> and proves Canonical's documented ephemeral user-namespace boundary without
> skipping production sandbox tests; raw-tree preflight now refuses before
> registration when any required physical-path operation is unsupported. The
> required replacement exact-head `test` check remains the merge gate.

## 3. Direct answers

### How close is Helix to Claude Code workflows mechanically?

Helix is strong at closed workflow definitions, guarded transitions, deterministic convergence, and persistence, but materially behind Claude Workflow on dynamic fan-out/fan-in, typed per-agent structured output, durable call-level replay, live per-agent observability, and convenient pipeline composition.

The gap is not correctly summarized as “Helix lacks arbitrary JavaScript.” The meaningful gap is that Helix's current workflow IR cannot yet express and durably execute bounded dynamic collections, pipelines, nested subworkflows, and effect-aware recovery. This roadmap closes those capabilities without making an in-process JavaScript VM the source of truth.

Helix deliberately remains stricter than Claude where Claude's behavior conflicts with the owner's requirements: no silent model fallback, no untyped `null` error masking, no implicit permission escalation, and no success based solely on model judgment.

### How close is Helix to the required multi-provider outcome?

Helix and Pi provide the strongest starting point of the evaluated options, but the current implementation is not yet close enough to claim exact multi-provider execution. Registry presence and configured credentials do not prove entitlement, selected account, effective model, effective effort, or server-side routing.

The target can reach the required outcome only by introducing attested runtime adapters and refusing any path whose external surface cannot prove the required tuple. Provider families for which served identity or account identity is not observable remain visibly disabled in exact mode; they are never silently degraded to requested-only operation.

### Is Helix closer to Claude Code than either dynamic-workflows repository?

| Axis | Closest today | Decision |
|---|---|---|
| Workflow-JavaScript mechanics | Quintin | Use as a behavior/mechanism reference, not a dependency spine |
| Fresh context per worker | Helix and Quintin | Retain Helix's explicit context construction and fresh session per effect |
| Fan-out, pipelines, bounded dynamic collections | Quintin | Add to the typed Helix IR |
| Provider breadth | Helix/Pi | Retain, but add attestation and certification |
| Exactness and deterministic gates | Helix | Strengthen; do not inherit either package's fallback semantics |
| Cross-process recovery | Quintin | Port/reimplement the durable ideas with effect-aware repository state |
| Worktree ownership and public-safe persistence | Helix | Retain and complete the promotion/cleanup lifecycle |
| Operator workflow builder | Helix | Preserve as the primary surface and extend with graph visualization |
| Live workflow navigator | Quintin | Rebuild over Helix's event/effect journal |
| Michaelliv package overall | Neither | Do not adopt or copy unresolved-license fixtures |

### What is the single recommended target architecture?

The **Helix Workflow Kernel**:

```text
guided builder   JSON/YAML import   programmatic IR builder
       \              |                    /
        \-------------+-------------------/
                      v
              WorkflowDefinition v4
           closed validation + simulation
                      v
         durable scheduler / effect journal
          |            |                 |
   workspace txn   objective gates   observability
          |                              |
          +---------- AgentRuntime -------+
                  adapter boundary
        Pi | Codex | Copilot | Azure | OpenRouter
```

### Which substrates should Helix use?

- **Pi:** default broad-provider runtime, behind one versioned adapter seam.
- **Claude Agent SDK:** not the outer engine and not shipped in this branch. Keep the provider-neutral SPI capable of a later Claude-specific executor, but require a separate future decision and the same attestation/effect contract.
- **Native Claude Workflow JavaScript:** semantic and UX reference only; it is not a host API for the Helix scheduler.
- **Quintin's package:** no canonical dependency. Reimplement or selectively port MIT-licensed mechanisms with explicit provenance and independent Helix tests.
- **Michaelliv's package:** no code or fixture copying while licensing remains unresolved. Independently authored behavioral tests are allowed.
- **CLIProxyAPI:** no role in the target.
- **Provider-specific official executors:** allowed and required when Pi cannot satisfy legitimate account use, request shaping, cancellation, or attestation. They implement `AgentRuntime`; they do not own scheduling.

### Remove, retain, rewrite, and add

- **Retain:** consent binding; deterministic-gate-only convergence; two-phase event/state commit; append-only validated events; refusal taxonomy; judge blinding; public-safety scans; lifecycle snapshots; workflow templates; guided builder; transition simulator; writer serialization; current run containment.
- **Rewrite:** workflow execution onto HWK; provider binding into capability attestations; structured output; disagreement representation; replay/checkpoints; worktree lifecycle; content provenance; provider readiness; observability.
- **Remove only after proven migration:** legacy execution paths, duplicate mock adapters, duplicate route tables, unreachable chains, and duplicate worktree tooling. Each removal requires a consumer/export table and replacement test. User-facing research behavior and historical-run readers must not disappear accidentally.
- **Add:** WorkflowDefinition v4; typed node/effect schemas; programmatic builder; durable journal; workspace transactions; canonical-worktree promotion; runtime adapters; provider policy/certification registry; planned and observed graphs; package/runtime matrix tests; opt-in live certification.

## 4. Scope, permissions, constraints, and limitations

- The original evaluation was review-only with one permitted `reviews/workflows/FABLE_ARCHITECTURE_ROADMAP_2026-07-16.md` write. This consolidated document is a separately authorized documentation artifact. No code, configuration, provider account, branch, remote, issue, pull request, tag, or release was changed while producing it.
- The target remains commit `bb1c37f62ee1808a5c24bac06d975023f73dcb3b`. The implementation must re-verify current `origin/main`, remote identity, visibility, rulesets, CI triggers, and branch collision before editing and again before push.
- No paid/live provider call was made by the consolidation review. The earlier Helix workflow work did execute one real OpenRouter workflow, but that was an ad-hoc proof using an injected session boundary, not repeatable proof of the default production factory.
- Claims about current providers and policies must be re-fetched from primary sources during implementation. A dated policy registry is data, not timeless truth.
- The exact model label of the independent comparison agent was not controllable by the orchestration surface. Its context was kept independent and its architecture was frozen before reading Fable's recommendation; no exact-model identity is claimed.
- Claude installed-artifact observations are reference evidence, not a public stability promise. Hard-coded installed-only caps must not become Helix invariants without compatibility probes.
- No workflow runtime may call a live provider during deterministic tests. Live certification is separately opted in, minimized, and recorded.

## 5. Evidence ledger

### Exact evidence versions

- Helix: `bb1c37f62ee1808a5c24bac06d975023f73dcb3b`
- Helix CC: `842fa87f5e1dd34c9de2d01ec7ece93e64b1b6b6`
- QuintinShaw/pi-dynamic-workflows: `2f28a74799ca83cd2dc35afc068091ba52167e04`
- Michaelliv/pi-dynamic-workflows: `31b2aca0f1cb195aafbfc5e3ee2b8c83ad3f21a2`
- router-for-me/CLIProxyAPI: `09da52ad509e2c18e7b9540db3b98c2214c280aa`
- Installed Claude Code: `2.1.211`
- Installed Pi: `0.80.3`; registry latest observed by Fable: `0.80.7`
- Installed Codex CLI: `0.144.4`
- Published `@anthropic-ai/claude-agent-sdk`: `0.3.211`
- Published `@quintinshaw/pi-dynamic-workflows`: `2.13.2`
- Published `pi-dynamic-workflows`: `1.0.1`, with `dist/` absent from its tarball

### Reproduced evaluation commands and results

| Evidence | Result |
|---|---|
| `git ls-remote` for the five target repositories | Exact SHAs recorded; Quintin head drifted by one behaviorally minor commit |
| Helix clone `npm test` | 598/598 Node tests; 12/12 worktree checks; 8/8 loop checks |
| Helix resource/docs/no-live/public-safety checks | Passed |
| Quintin test suite | 861 tests in 63 suites passed under its resolved Pi 0.80.6 |
| Michaelliv test suite | 24/24 passed under Pi 0.78.0 |
| Published-package extraction and source comparison | Quintin release artifact matched its release source; Michaelliv artifact lacked `dist/` |
| Agent SDK package/type inspection | Public surface and Claude-only provider/runtime constraints established |
| Installed Claude bounded inspection | Workflow input/output, globals, caps, same-session resume, and observability behavior established |
| Pi no-egress effort probe | Helix currently refuses the same unsupported thinking levels Pi would otherwise clamp in the probed cases |
| Helix CC validation | 19/19 tests and strict plugin validation passed |

### Primary sources

- [Claude Code workflows](https://code.claude.com/docs/en/workflows)
- [Claude Code subagents](https://code.claude.com/docs/en/sub-agents)
- [Claude Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- [Claude Agent SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions)
- [Claude Agent SDK structured outputs](https://code.claude.com/docs/en/agent-sdk/structured-outputs)
- [OpenAI Codex access tokens](https://learn.chatgpt.com/docs/enterprise/access-tokens)
- [OpenAI Codex SDK](https://developers.openai.com/codex/sdk)
- [OpenAI model/effort guidance](https://developers.openai.com/api/docs/guides/latest-model#update-api-and-model-parameters)
- [GitHub Copilot CLI programmatic reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference)
- [GitHub Copilot SDK](https://docs.github.com/en/copilot/how-tos/copilot-sdk/getting-started)
- [GitHub Copilot ACP server](https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server)
- [Azure Foundry Claude Code configuration](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/configure-claude-code)
- [OpenRouter provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)
- Exact source and tests at the evidence commits above
- Installed Pi public types/docs, notably `AssistantMessage.model` and optional `AssistantMessage.responseModel`

## 6. Owner requirements and acceptance tests

| # | Requirement | Acceptance test |
|---|---|---|
| R1 | Claude-class orchestration while remaining multi-provider | The same v4 workflow performs two-model planning, implementation, test, documentation, review, bounded remediation, and deterministic gate through at least two mock runtime adapters; a separately authorized OpenRouter-free run proves the production Pi path |
| R2 | Easy named workflow creation | A new user creates, validates, visualizes, simulates, saves, deploys, tests, and runs a named workflow without editing raw JSON; every screen names required and optional fields and shows defaults |
| R3 | Conditions, stop, retry, advance, and backtracking | Property and table tests cover every transition, ceilings, unreachable states, cycles, empty/single-node graphs, and terminal behavior |
| R4 | Dynamic fan-out/fan-in and pipelines | Typed `map`, `parallel`, `pipeline`, and `reduce` nodes preserve order, cardinality, per-item failures, cancellation, and bounds |
| R5 | Exact provider/model/effort/route/account | Unknown or unattestable tuple refuses before egress; mismatched response/deployment/account fails; no adapter fallback is possible outside an explicit workflow transition |
| R6 | Required provider families | Every required family has an official adapter path or a policy-registry entry that explains why exact mode is disabled; no configured-only path is shown as available |
| R7 | Durable recovery | Kill at every effect boundary, then resume to the same terminal state and canonical workspace; completed mutating effects are restored, not merely text-cached |
| R8 | Deterministic success | Only the objective command/file gate can mark convergence; model recommendations remain evidence, never authority |
| R9 | Observable and testable | Planned graph, observed graph, effect states, usage, attestations, workspace commits, refusals, and gate evidence are inspectable without exposing secrets |
| R10 | Safe content boundaries | Repository data and upstream output cannot modify tools, permissions, tuple binding, budgets, or gates; adversarial fixtures prove this |
| R11 | No regression | Every current valid workflow and stock template migrates losslessly; current behavior tests pass through the new kernel; historical run records remain readable |
| R12 | Package/runtime truth | Extracted tarball loads through real Pi RPC, no-egress active probe passes, and Node 22.19/current 26 gates pass locally and remotely on the exact branch head |

Non-negotiable invariants:

- No silent fallback of provider, model, effort, route, account, tools, permission, workspace, or gate.
- No text-only cache hit for a mutating effect.
- No provider path is called connected, entitled, exact, or certified without the corresponding evidence.
- No arbitrary repository text becomes policy or control state.
- No model-only judgment marks success.
- No public artifact stores secrets, raw provider payloads, or opaque credentials.
- No test is weakened or skipped to complete the branch.

## 7. Current Helix architecture at `bb1c37f`

Helix is `pi-helix`, a Pi extension package with a guided workflow builder, saved definitions, templates, a stage machine, provider/profile/cast resolution, a Pi session adapter, worktree execution, objective gates, persistence, and extensive deterministic tests.

```text
/helix-run <workflow> -- <task>
  -> load workflow/profile/settings/provider inventory
  -> project workflow to chain execution
  -> validate cast and efforts
  -> preflight objective gate
  -> hash binding and display consent
  -> reload + verify binding drift
  -> create run directory and worktree
  -> for each stage/pass:
       checkpoint full checkout
       compile prompts
       candidate panel -> judge -> synthesis -> verifier
       validate role envelopes
       evaluate stage transition
       two-phase append event + state
  -> objective command/file gate
  -> converged only if deterministic gate passes
```

Current strengths:

- Closed workflow definitions and explicit transition actions.
- Builder validation, simulation, templates, and workflow tests.
- Unknown model and unsupported effort refusal on the production adapter path.
- Consent-binding drift detection.
- Fresh in-memory Pi session per agent call.
- Writer serialization.
- Deterministic gate as the only converged exit.
- Append-only events, atomic state, lifecycle snapshots, PID leases, and corruption refusals.
- Public-safety scanning and package-scope governance.

Current gaps:

- Product/TUI runs are task-bound and cannot use the existing resume machinery.
- Provider inventory failure can weaken consent-time validation.
- Envelopes copy requested identity instead of recording attestation evidence.
- Semantic output searches arbitrary trailing JSON and has no bounded repair.
- Disagreement preservation depends partly on keyword matching.
- Full-tree checkpoints read every file into memory without a complete privacy/size algorithm.
- Worktrees are created but not promoted, surfaced, merged, or cleaned through a complete lifecycle.
- Existing dynamic behavior is limited to fixed stage/panel counts.
- No planned/observed workflow graph UI or per-effect live navigator exists.
- No checked-in test proves the default Pi production session factory against a real provider.
- Pi peer dependency is unbounded and Pi imports are distributed.
- Legacy and production-looking modules overlap, but not every proposed deletion is actually consumer-free.

Current call-graph source map:

| Edge/responsibility | Source at target SHA |
|---|---|
| `/helix-run` entry and inventory | `extensions/helix-command.ts:1162`, inventory handling around `:185-205` |
| Preflight construction | `extensions/lib/helix-command-core.mjs:631` |
| Workflow-to-execution projection and binding hash | `dispatch/lib/workflows.mjs:421,781` |
| Cast/profile/preset resolution | `dispatch/lib/presets.mjs:326` and surrounding resolver |
| Effort capability validation | `dispatch/lib/pi-effort.mjs:36` and adapter `:137-145` |
| Objective-gate preflight | `dispatch/lib/task-loop.mjs:117` |
| Named workflow execution boundary | `extensions/lib/helix-execution.mjs:26` |
| Staged run coordinator | `dispatch/lib/runner.mjs:2389` |
| Worktree ownership/creation | `dispatch/lib/runner.mjs:975-1094` |
| Candidate/judge/synthesis/verifier orchestration | `dispatch/lib/orchestrate.mjs:252` onward |
| Pi production session factory | `dispatch/lib/pi-agent-adapter.mjs:84-110` |
| Pi response envelope construction | `dispatch/lib/pi-agent-adapter.mjs:217-240` |
| Stage transition machine | `dispatch/lib/stage-machine.mjs:202` onward |
| Converged-only-after-gate invariant | `dispatch/lib/events.mjs:189-199` |

Current state machine:

```text
stage[i]
  --advance--> stage[i+1]
  --retry----> stage[i]
  --back-----> stage[j < i]
  --stop-----> conclusion

conclusion --objective pass--> converged
conclusion --objective fail--> failed/refused
```

Persisted state is post-transition. This correct invariant must be retained when the kernel generalizes the state graph.

## 8. Reference architectures and decisions

### 8.1 Claude Workflow and subagents

Claude Workflow provides a productive JavaScript authoring model with fresh agent contexts, `agent`, `parallel`, `pipeline`, phases, budgets, journaled prefix reuse, background execution, structured-output repair, optional worktrees, and a live workflow navigator.

Reference behaviors worth matching:

- Concise fan-out/fan-in and pipeline authoring.
- Fresh context per worker.
- Ordered results and per-item pipeline independence.
- Bounded concurrency and lifetime call limits.
- Structured output with bounded repair.
- Durable per-call transcripts and useful progress navigation.
- Planned labels/phases and usage visibility.

Behaviors Helix must deliberately reject or tighten:

- Silent inherited-model fallback.
- Error-to-`null` masking without a typed, explicit allowance.
- Same-session-only recovery.
- Workflow-specific permission modes that bypass Helix consent.
- In-process script semantics as the persistence contract.
- Installed-only hard caps treated as stable public constants.

### 8.2 Claude Agent SDK

The SDK is the closest Claude-specific runtime: rich `AgentDefinition`, structured outputs, hooks, sessions, budgets, and Claude-native tool behavior. It remains Claude-only and launches a substantial bundled runtime. It should not own Helix scheduling or persistence.

Decision: preserve an `AgentRuntime` seam capable of hosting an SDK executor, but do not ship one in this branch. A future SDK executor requires a separate architecture decision and must satisfy identical attestation, cancellation, content, workspace, effect, and certification contracts; consumer Claude subscription reuse remains blocked absent documented approval.

### 8.3 Durable workflow systems

The durability reference is not Claude's JavaScript syntax. The kernel adopts the standard durable-execution principles that matter here:

- Deterministic state transitions.
- Explicit effect boundaries.
- Idempotency keys and input/environment binding.
- Atomic journal/state commits.
- Replay of state plus side effects, not outputs alone.
- Retry taxonomy and bounded backoff.
- Cancellation propagation.
- Compensation or explicit manual resolution for partial mutations.
- Versioned workflow definitions and migration gates.
- Complete event history and observable state.

### 8.4 Dynamic-workflows repositories

Quintin's implementation is closest to Claude mechanics and has valuable recovery, quota, structured-output, worktree, and TUI mechanisms. It is not the canonical engine because exact binding can fall back, Helix invariants would remain bolt-ons, its Pi floor differs, and dependency ownership is external. MIT-licensed code may be selectively ported only with exact provenance and `NOTICE` attribution; independent Helix tests remain authoritative.

Michaelliv's implementation does not provide real per-agent model isolation/binding and its published package is incomplete. Missing or unresolved licensing is a hard bar against copying source or fixtures. Publicly observable behavior may be independently re-tested.

### 8.5 Helix CC

Helix CC remains a complementary Claude-only product/reference. Retain as evidence:

- The usefulness of concise workflow composition.
- Doctor's separation of local configuration from entitlement.
- Exhaustive enumeration of prompt-interpolation boundaries.

Do not copy these defects:

- Treating configuration as readiness.
- Requesting model/effort without effective evidence.
- Treating delimiter fencing as authority.
- Allowing model evidence checks to replace deterministic objective proof.

### 8.6 CLIProxyAPI

Rejected. Account pooling, aliasing, retries, automatic failover, protocol translation, cloaking, serving-account invisibility, incomplete provider-family support, and policy risk conflict directly with exact and legitimate routing. Neither sidecar nor embedded Go SDK belongs in the target.

## 9. Provider, account, and protocol architecture

### 9.1 Required attestation

Every executable session carries:

```ts
type EvidenceGrade =
  | "verified-response"
  | "verified-deployment"
  | "verified-session"
  | "requested-only"
  | "unavailable";

interface CapabilityAttestation {
  providerPath: string;
  requested: {
    provider: string;
    model: string;
    effort: string;
    route?: string;
    expectedAccount?: string; // opaque, never a credential
  };
  effective: {
    provider?: string;
    model?: string;
    effort?: string;
    route?: string;
    account?: string; // opaque stable handle
  };
  evidence: {
    provider: EvidenceGrade;
    model: EvidenceGrade;
    effort: EvidenceGrade;
    route: EvidenceGrade;
    account: EvidenceGrade;
    source: string;
    observedAt: string;
  };
  credentialClass: "api-key" | "workspace-token" | "oauth" | "managed-identity" | "unknown";
  policy: "official" | "gray-unstable" | "prohibited";
  certification: "uncertified-disabled" | "contract-verified" | "live-certified" | "policy-blocked";
  sessionBinding: string;
}
```

Exact mode accepts only the evidence grades required by the provider contract. `requested-only` and `unavailable` never silently pass. `prohibited` never has an override. `gray-unstable` may be explicitly enabled only when the policy register states that use is not prohibited, the risk is displayed at consent, and all technical exactness checks still pass.

### 9.2 Provider truth table and target path

| Path | Legitimate account mechanism | Required target adapter | Exact-mode rule |
|---|---|---|---|
| Anthropic API | API key or official managed backend | Explicit Anthropic adapter, using Pi transport only behind the runtime seam where equivalent | Response model and effort capability must attest; expected account handle must bind |
| Anthropic consumer Claude subscription in third-party Helix | Consumer OAuth | Policy registry only | `prohibited` while current policy forbids it; hard refusal, no override |
| OpenAI API | API key/project | Explicit OpenAI Responses adapter | Response model/effort/project handle must match |
| Codex Business/Enterprise automation | Official Codex access token for trusted local automation | Codex app-server/SDK adapter | Workspace/account token class, thread config, model, effort, and no-fallback behavior must be proven; otherwise disabled |
| Personal ChatGPT/Codex OAuth in third-party Helix | OAuth/device flow | Policy registry only in v1 | Separate from Business/Enterprise token path and exact-disabled; future enablement requires a new architecture/policy review |
| GitHub Copilot subscription | Official Copilot CLI/SDK/ACP auth | Copilot adapter | Exact model and account/session must be attestable; server-scoped or unverifiable effort refuses exact workflows |
| Azure Foundry Claude | Entra/key and explicit deployment | Foundry-Claude adapter | Deployment-to-model mapping, region, account/tenant handle, and effort capability must attest |
| Azure OpenAI/Foundry GPT | Entra/key and explicit deployment | Azure-OpenAI adapter | Deployment plus served-model header/field and tenant/account handle must match; Model Router forbidden |
| OpenRouter | API key | Explicit strict OpenRouter adapter | Every request pins `only/order`, `allow_fallbacks:false`, `require_parameters:true`, data/ZDR policy, and returned model/route; permissive defaults forbidden |
| CLIProxyAPI | Impersonated/pool/translated flows | None | Rejected |

Provider discovery is split into five truths:

1. **Installed:** adapter/runtime exists.
2. **Configured:** credential material is discoverable without exposing it.
3. **Entitled:** official non-mutating status evidence says the account may use the path.
4. **Exact-capable:** required tuple/account/route evidence can be attested.
5. **Certified:** deterministic contract tests pass and, where required, an authorized minimal live probe passed for the installed environment.

Only paths satisfying all required truths appear selectable for an exact workflow.

Attestation and certification freshness rules:

- Preflight attestations are session-bound and expire after five minutes, any provider/settings/auth inventory change, any runtime restart, or any workflow binding change, whichever comes first.
- The execute boundary re-resolves the attestation immediately before the first egress and binds it to the session. Every response adds response/deployment evidence; a session may not reuse another session's attestation.
- A certification key hashes adapter version, runtime version, provider-path configuration excluding secrets, model/deployment mapping, opaque account handle, and policy-register version. Any component change returns the path to `contract-verified` or `uncertified-disabled` as defined by that adapter.
- Policy entries require `reviewed_at`, `valid_until` no more than 30 days later, and primary-source links. Expired policy evidence disables new exact sessions until refreshed; an already-running consent-bound session may finish only if the policy did not become explicitly prohibited.
- Account handles must come from provider-issued account, project, tenant, workspace, organization, or subscription identifiers. Helix never hashes or derives an identity from a token/secret.

## 10. Capability delta matrix

| Capability | Claude reference | Helix today | HWK target | Severity |
|---|---|---|---|---|
| Closed declarative definition | Saved workflow script + metadata | Strong JSON workflow model | Versioned typed v4 IR | Low |
| Programmatic creation | JavaScript | None as first-class builder API | Pure builder library emitting v4 IR | Medium |
| Runtime arbitrary code | Core | None | Deliberate non-goal for v1; typed nodes cover required dynamics | — |
| Fresh worker contexts | Yes | Yes per Pi call | Required per effect | Low |
| Exact tuple/account binding | Claude may fall back | Requested tuple mostly checked; effective/account absent | CapabilityAttestation, no fallback | Critical |
| Multi-provider stage mixing | No | Yes through Pi | Yes through explicit adapters | Low foundation / high proof gap |
| Structured output | Forced tool + repair | Trailing-JSON scan | Schema tool + bounded repair | High |
| Deterministic objective gate | Advisory/model-driven | Strong | Retain unchanged authority | Ahead |
| Fan-out/fan-in | `parallel` | Fixed panels | Typed parallel/map/reduce | High |
| Ordered pipelines | `pipeline` | Fixed stages | Typed per-item pipeline | High |
| Failure semantics | Often null-masked | Refusals/throws | Typed settled result; explicit `allowFailure` | Medium |
| Writer conflicts | Optional worktrees | Serialized roles, incomplete lifecycle | Canonical worktree + transactional promotion | High |
| Tools/permissions/MCP/skills | Rich Claude policies | Role tool allowlists | Adapter capabilities bound into consent | Medium |
| Trust boundaries | Prompt discipline | Prompt discipline | Typed provenance + structured handoffs + fence defense | High |
| Budgets | Calls/tokens/cost/time | Runtime/time partial | Reservations, per-effect limits, bounded overshoot | High |
| Recovery | Same-session prefix cache | Strong internals, product resume refused | Cross-process effect-aware replay | Critical |
| Visualization | Live workflow tree | Builder text/simulation | Planned graph + observed state/effect graph | High UX |
| Provider readiness | Vendor status | Nullable inventory/config | Installed/configured/entitled/exact/certified split | Critical |
| Package verification | Vendor-owned | Dry-run/static load | Extracted artifact + runtime RPC + no-egress | Medium |
| Live provider proof | Vendor-owned | Historical ad-hoc OpenRouter only | Opt-in certification harness | High |

## 11. Material findings

### F-1 — P0: product workflow recovery is unreachable

- **Location:** `extensions/lib/helix-command-core.mjs:1660-1676`; recovery machinery in `dispatch/lib/runner.mjs`.
- **Wrong behavior:** task-bound TUI runs refuse resume even though leases, checkpoints, pending events, and reconciliation exist.
- **Evidence/source:** unconditional refusal; owner recovery requirement.
- **Multi-location check:** legacy mock/config CLI can resume, product surface cannot.
- **Fix:** WS5 moves product runs to the effect journal and revalidates consent/attestation on resume.
- **Refutation:** no alternate TUI resume path exists.
- **Confidence:** high.

### F-2 — P0: provider/account exactness is not implemented

- **Location:** `dispatch/lib/pi-agent-adapter.mjs:226-240`; current role envelopes; roadmap provider paths.
- **Wrong behavior:** requested provider/model is copied into output; effective effort, route, account, and evidence source are absent.
- **Evidence/source:** Pi message types expose requested `model` and optional `responseModel`; configured auth is not entitlement or account attestation.
- **Multi-location check:** Azure/OpenRouter/Codex/Copilot have different response and account evidence; one generic assumption cannot cover them.
- **Fix:** WS2 and WS7 introduce `CapabilityAttestation`, provider-specific exactness, and certification.
- **Refutation:** preflight prevents many unknown tuples but cannot prove what was served.
- **Confidence:** high.

### F-3 — P0: mutating replay would restore text without effects

- **Location:** proposed call-identity/prefix replay in original `reviews/workflows/FABLE_ARCHITECTURE_ROADMAP_2026-07-16.md` §§14/16; mutating roles in `dispatch/lib/pi-agent-adapter.mjs`.
- **Wrong behavior:** a cached builder/documenter envelope could be returned after crash while its file/git effects are absent.
- **Evidence/source:** output identity did not bind before/after workspace state or a committed mutation artifact.
- **Multi-location check:** downstream tester, documenter, verifier, and objective gate all depend on the canonical filesystem state.
- **Fix:** WS4/WS5 effect journal and workspace transaction records; no cache for uncommitted mutating effects.
- **Refutation:** deterministic model output alone cannot recreate file effects.
- **Confidence:** high.

### F-4 — P0: required provider paths can be called complete without live certification

- **Location:** current tests never exercise `defaultSessionFactory`; original roadmap made live tests optional.
- **Wrong behavior:** mock inventory and mock HTTP prove shape, not entitlement/account/served tuple.
- **Evidence/source:** no checked-in production-factory real-provider proof; prior OpenRouter proof used an injected session factory.
- **Multi-location check:** every provider family has external state unavailable to mocks.
- **Fix:** WS7/WS12 certification states and an authorized minimal OpenRouter end-to-end proof; unproven installed paths remain disabled.
- **Refutation:** existing 598-test green suite proves the mock universe, not live identity.
- **Confidence:** high.

### F-5 — P1: inventory failure weakens consent-time truth

- **Location:** `extensions/helix-command.ts:202-204`; `extensions/lib/helix-command-core.mjs:579-629`.
- **Wrong behavior:** inventory exceptions become null and some validation is skipped.
- **Consequence:** consent may display a cast not validated against current inventory, even though later session creation still refuses.
- **Fix:** WS2 `inventory-unavailable` pre-egress refusal.
- **Confidence:** high.

### F-6 — P1: semantic output and disagreement handling are brittle

- **Location:** `dispatch/lib/pi-agent-adapter.mjs:44-60`; `dispatch/lib/synthesis.mjs:31`; exact reviewer verdict transitions.
- **Wrong behavior:** trailing/example JSON can be mistaken for the answer; no bounded repair; disagreement detection depends on prose keywords.
- **Fix:** WS6 forced structured-output tool, bounded repair, typed verdict and disagreement schemas.
- **Confidence:** high.

### F-7 — P1: worktree fan-in and ownership are incomplete

- **Location:** `dispatch/lib/runner.mjs:975-1094`; completion rendering and worktree tooling.
- **Wrong behavior:** worktrees are created but no deterministic promotion makes isolated writer changes visible to downstream stages; cleanup and discovery are incomplete.
- **Fix:** WS4 canonical workspace transaction model and WS9 lifecycle UI.
- **Confidence:** high.

### F-8 — P1: workflow UX would regress if declarative workflows become script compatibility input

- **Location:** current builder/workflow modules and original proposed chain-to-script compilation.
- **Wrong behavior:** the primary easy/testable authoring surface could become secondary to arbitrary code; static visualization becomes impossible for general scripts.
- **Fix:** WS3/WS8 keep v4 IR canonical, preserve round-trip builder semantics, add planned and observed graphs, and make programmatic authoring emit IR.
- **Confidence:** high.

### F-9 — P1: repository content is an untrusted instruction surface

- **Location:** prompt compilation/handoff boundaries; Helix CC `fence()` proposal.
- **Wrong behavior:** delimiter framing alone cannot stop repository text or prior agent output from impersonating policy/tool results.
- **Fix:** WS10 typed provenance, structured handoffs, policy isolation, adversarial fixtures; fencing retained only as defense in depth.
- **Confidence:** high.

### F-10 — P1: budgets cannot be called hard when measured only after calls

- **Location:** current runtime limits; proposed use of `session.getSessionStats()` after execution.
- **Wrong behavior:** one in-flight call can exceed a token/cost ceiling before accounting observes it.
- **Fix:** WS4 reservations, per-call output/turn limits, provider capability checks, explicit maximum overshoot, cancellation, and post-call reconciliation.
- **Confidence:** high.

### F-11 — P1: prohibited policy paths must not have overrides

- **Location:** provider policy design.
- **Wrong behavior:** user acknowledgment was proposed as a way to execute a prohibited Anthropic consumer-subscription path.
- **Fix:** WS7 hard-blocks `prohibited`; only non-prohibited `gray-unstable` paths may have disclosed opt-in.
- **Confidence:** high.

### F-12 — P2: checkpoint algorithm is unbounded and replacement was under-specified

- **Location:** `dispatch/lib/runner.mjs:299-474`.
- **Wrong behavior:** full checkout reads are O(repository) and unbounded; naïve Git-object snapshots risk retaining secrets and mishandling ignored/untracked/partially staged state.
- **Fix:** WS5 private content-addressed snapshot store outside the repository object database, explicit inclusion rules, streaming limits, restore fidelity, and GC.
- **Confidence:** high.

### F-13 — P2: Pi dependency and import surface are unstable

- **Location:** `package.json`; distributed `@earendil-works/*` imports.
- **Wrong behavior:** peer dependency `*` permits untested substrate changes.
- **Fix:** WS1 pins a tested range, centralizes imports, and tests exact versions without modifying a user's global Pi.
- **Confidence:** high.

### F-14 — P2: legacy deletion scope is overconfident

- **Location:** `task-loop.mjs`, `debate.mjs`, `revision-effect.mjs`, routes/chains, research surfaces, historical record validators.
- **Wrong behavior:** several modules called dead still own live symbols, tests, or user-facing behavior.
- **Fix:** WS11 builds a symbol/consumer/public-surface migration ledger; delete only after replacement and regression proof.
- **Confidence:** high.

### F-15 — P2: final verification can false-green

- **Location:** package scripts, `tools/smoke/pi-e2e-load.mjs`, `tools/lockdown`, package dry run, CI triggers.
- **Wrong behavior:** static extension load and `npm pack --dry-run` do not prove packaged runtime behavior; branch pushes currently have no remote CI; Node matrix execution is not operationally specified.
- **Fix:** WS12/WS14 add extracted-package RPC, active no-egress, explicit local Node binaries, branch-push CI, and exact-head remote verification.
- **Confidence:** high.

### F-16 — P3: capability guard uses a string convention

- **Location:** `dispatch/lib/runner.mjs` checks `adapter.kind`.
- **Wrong behavior:** production/mock separation is conventional rather than structurally branded.
- **Fix:** module-private `WeakSet` or closure brand in WS2.
- **Severity rationale:** no external attacker-controlled construction path was reproduced, so this is maintainability/defense-in-depth rather than a demonstrated P1 exploit.
- **Confidence:** high.

## 12. Rejected findings and false alarms

| Candidate | Decision and rationale |
|---|---|
| Helix silently clamps explicit unsupported effort today | Rejected for the probed Pi 0.80.3 cases: Helix's refusal set matched Pi's clamp set. Retain a conformance test because the coupling is undocumented and can drift |
| CLIProxyAPI should unify subscription access | Rejected: provider gaps, account invisibility, failover/alias semantics, translation loss, and policy risk violate exactness |
| Michaelliv offers real per-agent model routing | Rejected: model choice is prompt text on the inspected path; published artifact is incomplete |
| Native Claude Workflow can be invoked as Helix's deterministic host | Rejected: no public host `runWorkflow()` contract; model-invoked and Claude-only |
| Arbitrary runtime JavaScript is the only way to close the gap | Rejected: typed map/pipeline/decision/subworkflow nodes satisfy the required workflows with stronger validation, visualization, and recovery |
| `node:vm` is a sandbox | Rejected: it is not an OS/resource boundary and cannot by itself stop memory/CPU/promise/regex exhaustion |
| Delimiter fencing makes repository content trusted | Rejected: framing does not grant authority or prevent semantic injection |
| Pi registry presence means account is connected and entitled | Rejected: installed/configured/entitled/exact/certified are separate truths |
| No real-provider proof has ever existed | Narrowed: one historical OpenRouter workflow ran, but it did not exercise the default production factory and is not a checked-in repeatable certification test |
| Every named legacy module is safe to delete immediately | Rejected until the consumer/public-surface migration ledger proves replacement and historical compatibility |

## 13. Architecture options, scorecard, and sensitivity

Hard gates: required provider reach, exact fail-closed binding, legitimate account paths, deterministic convergence, and effect-aware recovery. Failure of a hard gate disqualifies an option regardless of score.

| Option | Strongest case | Disqualifier/decision |
|---|---|---|
| A. Typed HWK + runtime adapters | One durable engine, visualizable/testable IR, provider-neutral, preserves Helix invariants | **Selected**; largest deliberate implementation, but all complexity belongs to current requirements |
| B. Fable HSE: arbitrary JS in `node:vm` on Pi | Closest authoring syntax to Claude; can port Quintin mechanisms | Rejected as canonical: unnecessary runtime/trust surface, weak static UX, effect replay still unsolved |
| C. Adopt Quintin package | Most complete existing mechanics and UI | Fail-open binding and external ownership; use only as referenced mechanisms |
| D. Claude Agent SDK primary | Highest Claude fidelity | Claude-only, runtime/distribution cost, cannot satisfy required provider families |
| E. Native Claude Workflow primary | Minimal Helix engine maintenance | Not host-controlled, Claude-only, plan/policy gated |
| F. Helix outer kernel + Claude SDK and other adapters | Preserves one engine while allowing best executor per provider | Architecturally compatible with A; defer SDK adapter until a required capability justifies it, not because multiple adapters are “dual engines” |
| G. CLIProxyAPI spine | Many translated account flows behind one endpoint | Hard fail on legitimacy, identity, fallback, protocol fidelity, and provider coverage |

Scores use 0–5 as an ordinal rubric, not measurement:

| Axis | Weight | A | B | C | D | E |
|---|---:|---:|---:|---:|---:|---:|
| Required provider reach | hard | 5 | 4 | 4 | 0 DQ | 0 DQ |
| Exactness/account attestation | hard | 5 | 4 | 2 DQ | 3 | 1 |
| Deterministic/effect recovery | hard | 5 | 2 | 4 | 3 | 2 |
| Claude mechanical expressiveness | 0.15 | 4 | 5 | 5 | 4 | 5 |
| UX/visualization/testability | 0.15 | 5 | 2 | 4 | 3 | 5 |
| Operational reliability | 0.15 | 5 | 3 | 4 | 4 | 3 |
| Migration difficulty, 5=easiest | 0.10 | 3 | 3 | 4 | 2 | 4 |
| Maintenance/version drift | 0.10 | 4 | 3 | 2 | 2 | 3 |

Sensitivity:

- If cosmetic/mechanical Claude parity dominates, B or C looks attractive, but neither closes effect-aware replay and exact-account requirements.
- If schedule dominates, C looks easier only by moving critical invariants into a foreign dependency; it still fails a hard gate.
- If Claude-only fidelity later becomes a product requirement, an SDK adapter can be added beneath A without changing the kernel.
- Under every weighting that keeps the owner's exactness, UX, and durability requirements hard, A remains the only eligible architecture.

## 14. Final target architecture

### 14.1 Component boundaries

```text
extensions/
  helix-command.ts                 guided builder, consent, run/watch/test UX
  lib/helix-workflows.mjs          catalog + atomic persistence
  lib/helix-visualization.mjs      planned/observed graph projections
        |
        v
dispatch/workflow/
  schema.mjs                       WorkflowDefinition v4 closed schema
  builder.mjs                      pure programmatic IR builder
  validate.mjs                     graph, bounds, reachability, capabilities
  migrate-v3.mjs                   lossless v3 -> v4 migration
  simulate.mjs                     deterministic no-provider simulation
        |
        v
dispatch/kernel/
  scheduler.mjs                    deterministic node/effect scheduling
  state.mjs                        closed run/node/effect state machines
  journal.mjs                      append-only effect/state commits
  budgets.mjs                      reservations, ceilings, reconciliation
  cancellation.mjs                run -> node -> effect propagation
  workspace.mjs                   canonical worktree transactions
  snapshots.mjs                   private bounded state snapshots
        |
        v
dispatch/runtime/
  contract.mjs                     AgentRuntime + CapabilityAttestation
  registry.mjs                     installed/configured/entitled/exact/certified
  pi-runtime.mjs                   only Pi import boundary
  anthropic-runtime.mjs            official Anthropic API/managed paths
  openai-runtime.mjs               official OpenAI Responses path
  codex-runtime.mjs                official supported automation path
  copilot-runtime.mjs              official SDK/ACP path
  openrouter-runtime.mjs           strict request/route adapter
  azure-claude-runtime.mjs         Foundry Claude deployment adapter
  azure-openai-runtime.mjs         Azure OpenAI served-model adapter
  policy-register.mjs              dated official/gray/prohibited facts
```

Stable policy modules never import UI, transport, or provider implementations. Runtimes never choose workflow transitions. UI never fabricates readiness. Provider errors are normalized once at the runtime boundary.

### 14.2 WorkflowDefinition v4

Required top-level fields:

- `schema_version: 4`
- `id`, `name`, `description`, `version`
- `inputs` closed JSON schema
- `start`
- `nodes` keyed object
- `limits`
- `provider_policy`
- `workspace_policy`
- `objective_gate`

Node kinds:

- `agent`: one attested agent effect with role, prompt template, output schema, tools, mutation mode, timeout, and retry policy.
- `parallel`: bounded named children with barrier semantics and explicit failure policy.
- `map`: bounded collection expression, stable item keys, maximum cardinality, and child node/subworkflow.
- `pipeline`: ordered per-item stages; each item has independent typed state.
- `reduce`: deterministic aggregation over ordered typed results; model reducers are explicit agent nodes, not hidden code.
- `decision`: closed conditions over typed state using JSON-path/value/comparison predicates.
- `gate`: deterministic command/file/schema/evidence gate.
- `checkpoint`: explicit attended pause with resume requirements.
- `subworkflow`: version-pinned named workflow, maximum depth one in v1.
- `terminal`: `succeeded`, `failed`, `refused`, or `cancelled`; only the objective gate may produce successful convergence.

Conditions cannot evaluate arbitrary code. Allowed expressions are typed field access, equality/order/membership, boolean composition, bounded counts, and explicit status predicates. Missing paths refuse validation unless the schema marks them optional and the condition handles absence.

Canonical v4 defaults and required fields:

| Concern | Default/requirement |
|---|---|
| Start/terminal | Exactly one `start`; at least one terminal; successful terminal reachable only through `objective_gate` |
| Failure | Abort the run; continuation requires an explicit closed `allowFailure` code list |
| Cycles/back edges | Allowed only with explicit per-node `max_visits`; default builder value 3; absent ceiling is invalid |
| Total agent effects | Hard default 32; required explicit value to exceed it; absolute product ceiling 1,000 |
| Concurrency | Default 4; maximum `min(16, max(1, availableProcessors-2))`; validated and consent-rendered |
| Map cardinality | Default/maximum-per-node 16/256; collection larger than the declared bound refuses before child dispatch |
| Pipeline stages | Maximum 16 in v1 |
| Subworkflow depth | Maximum 1; recursive workflow reference is invalid |
| Run/call time | Default 30 minutes per run and 10 minutes per agent effect; product maxima 8 hours/1 hour; all values consent-rendered |
| Provider retries | Default 0 hidden transport retries where controllable; workflow retry is explicit, visible, budgeted, and capped |
| Structured repair | Maximum 2 repair effects, counted in calls/tokens/cost |
| Mutation | Read-only roles have no mutation tools; mutating roles default to `shared-serialized`; isolation must be explicit |
| Transcript persistence | Off by default; enabling it requires a secrets warning and retention selection |
| Compaction | Inherit the selected Pi/runtime's native default; Helix adds no arbitrary context-percentage trigger |
| Provider identity | Explicit provider/model/effort and exact-mode attestation required for every executable agent node; no session default inheritance |
| Cost/token budgets | Optional only where the adapter cannot represent them; if declared, the adapter must support the required bound or preflight refuses |

The guided builder presents these defaults before saving. Imported/programmatic definitions are canonicalized to the same explicit values so a saved hash never depends on implicit runtime defaults.

### 14.3 Programmatic authoring

`dispatch/workflow/builder.mjs` exports pure constructors that return v4 JSON. A user may write a normal local Node program importing the builder and emit a definition, but Helix never executes that program as part of a run. Deployment validates the resulting closed IR, computes its hash, simulates it, and stores it atomically.

This gives advanced users programmatic composition without making arbitrary runtime code, module loading, filesystem access, or nondeterminism part of Helix recovery.

### 14.4 State and effect machines

Run:

```text
initializing -> preflighted -> awaiting-consent -> running
running -> paused | cancelling | failed | refused | converging
converging -> converged only after objective gate evidence
cancelling -> cancelled after all children/effects settle or are killed
```

Node instance:

```text
pending -> ready -> running -> succeeded
                    |       -> failed
                    |       -> refused
                    |       -> cancelled
                    -> waiting-retry -> ready
```

Effect:

```text
declared -> bound -> reserved -> started -> response-received
         -> refused              |       -> aborted/timeout/failed
response-received -> validated -> workspace-committed -> journal-committed
```

A mutating effect is not completed until its workspace commit and journal commit are durable. Resume may reuse only `journal-committed` effects whose input, runtime, attestation, workflow version, base state, and workspace commit all match.

### 14.5 Effect identity and replay

Effect identity hashes:

- Workflow ID/version/hash and node-instance path.
- Canonicalized inputs and upstream result references.
- Role/system/task prompt hashes and content-provenance classes.
- Requested runtime tuple, tools, permissions, schemas, budgets, timeout, retry policy.
- Runtime adapter/version and provider-policy version.
- Base repository HEAD, canonical workspace commit/snapshot, and mutation mode.
- User-consent binding and objective-gate binding.

Journal entry stores before-state, response envelope, attestation, usage, after-state, workspace transaction, and error taxonomy. A mismatch invalidates the cache suffix. Mutating effects without a durable workspace transaction always rerun from their last safe before-state.

### 14.6 Canonical workspace transaction model

Every run owns one canonical worktree. Mutation modes:

- `shared-serialized`: the effect runs under the run's writer mutex directly in the canonical worktree.
- `isolated-proposal`: the effect runs in a deterministic child worktree from the current canonical commit. On success, Helix creates a patch/commit artifact, verifies scope and cleanliness, and atomically applies it to the canonical worktree. Conflict, unexpected paths, or base drift refuses the effect. No automatic semantic conflict resolution occurs.

Downstream nodes start only after promotion. Completion displays canonical branch, path, HEAD, diffstat, retained proposals, and cleanup state. Unchanged proposals auto-remove. Changed/conflicted proposals remain owner-referenced until explicit cleanup.

### 14.7 Failure semantics

All parallel/pipeline results are typed:

```ts
type Settled<T> =
  | { status: "ok"; value: T; effect: string }
  | { status: "allowed-failure"; code: string; effect: string }
  | { status: "failed" | "refused" | "cancelled"; code: string; effect: string };
```

`allowed-failure` is possible only when declared in the node's closed policy. Binding, policy, identity, corruption, workspace, and objective-gate failures are never maskable. A run cannot converge with an unhandled non-`ok` result.

### 14.8 Budgets and cancellation

- Reserve calls/tokens/cost before dispatch using adapter capabilities.
- Enforce per-call max output, turns, tool calls, time, and provider retry count.
- Record a provider-specific bounded-overshoot contract where strict token/cost cutoff is impossible.
- Reject a call whose reservation exceeds remaining hard budget.
- Reconcile actual usage after response and release unused reservation.
- Propagate one run `AbortController` through scheduler, adapter, provider request, tool process group, workspace transaction, and objective gate.
- Escalate cancellation from graceful abort to bounded hard kill for child processes.

### 14.9 Content provenance

Prompt compiler handles four classes:

- `trusted_policy`: checked-in Helix/role policy only.
- `operator_task`: user-provided task, quoted and labeled but intentionally instructive.
- `repository_data`: never authoritative; cannot change policy, tools, tuple, budget, transitions, or gates.
- `agent_output`: schema-validated data where possible; otherwise fenced/quoted and never authoritative.

Structured handoffs are preferred. Fence markers and JSON serialization are applied as defense in depth, with collision removal and exhaustive boundary enumeration. Tool results are injected only through typed tool channels, never reconstructed from repository or agent text.

### 14.10 Visualization

Planned graph shows nodes, transitions, bounds, maximum calls/concurrency, provider casts, mutation modes, gates, and unreachable/cyclic warnings before consent.

Observed graph shows every node instance/effect, actual transition, retry/back edge, fan-out item key, duration, usage, attestation grade, workspace commit, and refusal. Secret-bearing values and raw provider bodies are never rendered. Static and observed graphs share stable node IDs so users can compare plan with execution.

## 15. Migration design

1. Add v4 schema, validator, simulator, kernel, and runtime contract without changing current execution.
2. Implement a lossless v3-to-v4 migration. Current workflow JSON remains readable; saving produces canonical v4 only after round-trip equality tests.
3. Execute current templates and chains through a compatibility projection into v4 nodes. This is an input adapter, not a second engine.
4. Add the kernel behind an internal feature flag used only by tests until behavioral parity is proven.
5. Migrate `/helix-run`, `/helix-workflows test`, and resume/watch surfaces together; remove the flag before delivery.
6. Keep historical v3 state/run readers isolated from deleted execution code. Never rewrite historical artifacts in place.
7. Build the symbol/consumer/public-surface ledger. Delete legacy modules only after each consumer points to HWK and parity tests pass.
8. Do not retain dual production engines at branch completion.

Persisted-shape rules:

- Workflow v4 is a new version with explicit migration.
- Run state gains additive kernel/node/effect fields under a new closed version.
- Events add versioned kinds; old kinds remain readable.
- Journals and workspace transactions are new private run artifacts.
- Public run projections remain backward-compatible or receive an explicit version and legacy reader test.
- Corrupt or unknown future shapes refuse; no best-effort repair.

## 16. One-branch implementation program

All work lands together on one fresh non-default branch from a re-verified current `origin/main`. Internal commits/workstreams are allowed; no partial release, PR, merge, tag, or default-branch mutation is allowed. Suggested branch: `helix-workflow-kernel-v1`, after collision verification.

Ordering: WS1 -> WS2 -> WS3 -> WS4 -> WS5; WS6 and WS7 may proceed after WS2; WS8/WS9/WS10 after WS3/WS4; WS11 after parity; WS12/WS13 after behavior stabilizes; WS14 last.

### WS1 — Substrate seam and reproducible runtime matrix

- **Objective/source:** isolate volatile Pi/provider APIs and test exact supported versions without changing global installations.
- **Inspect/change:** `package.json`; all `@earendil-works/*` imports; new `dispatch/runtime/pi-runtime.mjs`; new `tools/ci/run-node-matrix.sh`; package fixtures.
- **Old/target:** unbounded Pi peer dependency and distributed imports -> one version-asserted seam tested against an explicit range and packaged runtime.
- **Implementation:** pin `@earendil-works/pi-coding-agent` to `>=0.80.7 <0.81.0`; centralize imports; module-private runtime branding with `WeakSet`; expose normalized model/message/session capabilities; fail `pi-version-unsupported`; use isolated package fixtures for Pi versions.
- **Tests:** minimum/maximum supported Pi, one below/above range, missing/changed exports, model/effort map drift, runtime RPC load.
- **Docs:** architecture/runtime compatibility and manual diagnostics.
- **Dependencies/order:** first workstream; WS2 and every runtime adapter depend on its normalized contract.
- **Completion:** no Pi import outside the seam; both Node versions and each supported Pi fixture pass without global install/upgrade.
- **Rollback:** no persisted shape yet; revert seam commit.

### WS2 — Capability attestation, readiness, and exact binding

- **Objective/source:** R5/R6; F-2/F-5/F-16.
- **Inspect/change:** current preflight, settings/profile/preset resolution, `pi-agent-adapter.mjs`, role envelopes, run records; new `dispatch/runtime/{contract,registry,policy-register}.mjs`.
- **Old/target:** nullable inventory, requested tuple copies, and string branding -> expiring session-bound attestations, five-state readiness, and structurally branded runtimes.
- **Implementation:** closed `CapabilityAttestation`; expected-account opaque handles; five-state readiness; inventory failure refusal; response/deployment/session evidence grades; no requested-only exact mode; one shared validator for TUI/print/JSON/import/run.
- **Tests:** unknown/missing/mismatched provider/model/effort/route/account; stale attestation; forged runtime; configured-not-entitled; requested-only; policy drift; consent and execute binding mismatch.
- **Docs:** provider truth vocabulary and consent rendering.
- **Dependencies/order:** after WS1; blocks WS4 scheduling and WS7 provider implementations.
- **Completion:** every real call requires a current attestation and every negative case refuses before egress.
- **Rollback/removal:** additive envelope readers retained; disabling a runtime returns it to exact-disabled and never selects a fallback.

### WS3 — WorkflowDefinition v4, migration, builder, and simulation

- **Objective/source:** R1-R4/R11; preserve the existing easy workflow UX.
- **Inspect/change:** `dispatch/lib/workflows.mjs`, stage schedule/machine, workflow catalog/test modules, templates; new `dispatch/workflow/*`.
- **Old/target:** fixed v3 chain projection -> closed v4 graph IR with bounded dynamic nodes, lossless migration, pure programmatic construction, and deterministic simulation.
- **Implementation:** closed v4 schema and node types; typed conditions; graph/reachability/cycle/bounds validation; v3 migration; pure programmatic builder; canonical serialization/hash; deterministic simulator; template migration.
- **Tests:** empty/single-node, unreachable, illegal cycles, missing targets, backtracking ceilings, map cardinality, nested depth, schema boundaries, v3 round trip, canonical byte stability on Node 22/26.
- **Docs:** `docs/workflows.md` authoring reference and examples from simple to advanced.
- **Dependencies/order:** after WS1/WS2 vocabulary is stable; WS4 and WS8 consume the v4 contract.
- **Completion:** all stock workflows migrate losslessly; three authoring surfaces produce byte-identical IR; invalid definitions cannot be saved or run.
- **Rollback/removal:** v3 remains read-only compatible; never rewrite a user definition until validated v4 output is atomically committed.

### WS4 — Durable scheduler, budgets, and workspace transactions

- **Objective/source:** R4/R7; F-3/F-7/F-10.
- **Inspect/change:** runner, stage machine, worktree helpers, objective-gate process control; new `dispatch/kernel/{scheduler,state,journal,budgets,cancellation,workspace}.mjs`.
- **Old/target:** monolithic staged loop and post-call accounting -> deterministic node/effect scheduler with typed outcomes, reservations, cancellation, and canonical workspace transactions.
- **Implementation:** node/effect state machines; stable instance keys; bounded parallel/map/pipeline scheduling; typed settled results; writer mutex; isolated proposal promotion; budget reservation/reconciliation; cancellation propagation.
- **Tests:** ordering/cardinality, worker failure, allowed failure, binding failure non-maskability, concurrent writers, patch conflict, base drift, unexpected paths, cancellation at every state, reservation/overshoot boundaries.
- **Docs:** scheduler/workspace/failure architecture.
- **Dependencies/order:** after v4 IR and runtime contract; WS5 adds durability around these effect boundaries.
- **Completion:** representative multi-stage mock workflow reaches the objective gate through only HWK; downstream stages observe promoted writer changes.
- **Rollback/removal:** kernel remains test-only until WS11; no production command switches early.

### WS5 — Effect-aware journal, resume, leases, and private snapshots

- **Objective/source:** R7; F-1/F-3/F-12.
- **Inspect/change:** current persistence/leases/checkpoints/task-bound refusal; new `dispatch/kernel/snapshots.mjs`.
- **Old/target:** product resume refusal, full-tree memory copies, output-only replay proposal -> cross-process effect/state/workspace recovery with bounded private snapshots.
- **Implementation:** full effect identity; response + attestation + workspace transaction journal; prefix invalidation; private content-addressed snapshot storage outside Git object DB; streaming size/file limits; explicit tracked/untracked/ignored/index semantics; orphan reconciliation; consent/attestation refresh on resume.
- **Tests:** kill after every effect phase; cache reuse for read-only effect; mutating restore; changed input/runtime/base invalidates suffix; truncated journal/state/snapshot; lease contention/stale PID; large/binary/symlink/submodule/ignored/partially staged cases; GC and paused-run retention.
- **Docs:** resume guarantees, limits, privacy, and manual recovery.
- **Dependencies/order:** after WS4 effect/workspace states; required before WS11 product cutover.
- **Completion:** kill -9 and resume produces the same terminal state and canonical workspace as uninterrupted execution.
- **Rollback/removal:** new private artifact version and legacy readers remain; failed migration refuses without mutating old state.

### WS6 — Structured output and typed disagreement

- **Objective/source:** F-6.
- **Inspect/change:** Pi adapter, prompts, judge/synthesis/verifier, role schemas.
- **Old/target:** arbitrary trailing-JSON extraction and prose disagreement heuristics -> schema-forced typed results with bounded, metered repair.
- **Implementation:** terminating structured-output tool where supported; equivalent strict adapter mechanism elsewhere; at most two budgeted repair attempts; typed verdicts and disagreements; provider-limit classification before schema failure; no arbitrary JSON scanning.
- **Tests:** example-JSON trap, fenced JSON, malformed/partial output, repair success/exhaustion, quota, timeout, contradiction without keywords, Unicode and boundary sizes.
- **Docs:** output contracts and repair budgets.
- **Dependencies/order:** after WS2 runtime contract; may proceed in parallel with WS3/WS4 but integrates before WS11.
- **Completion:** no production transition is derived from unstructured verdict parsing.
- **Rollback/removal:** retain old parser only behind the unshipped legacy path until WS11; no fallback after cutover.

### WS7 — Provider adapters, policy, and certification

- **Objective/source:** R5/R6; provider truth table.
- **Inspect/change:** provider aliases/settings; new strict runtime modules from §14.1.
- **Old/target:** generic Pi availability plus provider aliases -> official, separately certified runtime paths with per-protocol request and identity enforcement.
- **Implementation:** explicit Anthropic and OpenAI API adapters; explicit OpenRouter body/route/data-policy adapter; Azure deployment/served-model adapters; official Codex B/E token path; Copilot SDK/ACP path; hard policy blocks; per-install certification registry. If an official path cannot attest a required field, mark it exact-disabled rather than degrade.
- **Tests:** golden bidirectional protocol cases for instruction ordering, content blocks, tool IDs/results, parallel tools, streaming, thinking, schema repair, abort, timeout, malformed output, context limit, error mapping; negative no-pin/no-attestation/no-account tests.
- **Live certification:** opt-in, minimal, provider-specific, with an authorized free OpenRouter proof required for end-to-end branch evidence when configured; other account-specific paths certify at installation/use and remain disabled until then.
- **Docs:** `docs/providers.md` with dated policy links and exactness limitations.
- **Dependencies/order:** after WS1/WS2; may implement adapters in parallel; WS12 owns common certification execution.
- **Completion:** every required provider family has an implemented official path or an explicit evidence-backed exact-disabled refusal; no path inherits permissive routing defaults.
- **Rollback/removal:** disable/remove one adapter and its certification entries atomically; never route its workflows elsewhere.

### WS8 — Guided authoring, visualization, deployment, and examples

- **Objective/source:** R2/R9; preserve and improve the current builder.
- **Inspect/change:** `extensions/helix-command.ts`, command core, workflow catalog/test modules; new visualization projection.
- **Old/target:** useful v3 builder and textual simulation -> v4 round-trip builder plus planned and observed graph views with expert import/programmatic parity.
- **Implementation:** guided creation of every node/transition/limit; good defaults; required/optional explanations; planned graph; consent preview; observed graph; import/export; atomic named deployment; programmatic builder examples; no raw JSON requirement.
- **Tests:** keyboard/TUI flows, cancellation at every prompt, defaults, invalid correction, round trip, terminal sizes, graph snapshots, secret redaction, planned-vs-observed stable IDs.
- **Docs:** simple linear, review loop, parallel panel, map/pipeline, remediation, and multi-provider examples.
- **Dependencies/order:** after WS3; observed graph consumes WS4/WS5 events; can develop planned graph in parallel.
- **Completion:** a first-time user can create and test a named review loop without documentation; an expert can generate the identical definition programmatically.
- **Rollback/removal:** catalog remains versioned; failed save/import leaves previous named workflow byte-identical.

### WS9 — Worktree lifecycle and run operations

- **Objective/source:** F-7.
- **Inspect/change:** runner worktrees, shell helper, completion rendering, `/helix-runs`.
- **Old/target:** created-but-hidden worktrees and duplicate tooling -> canonical/proposal ownership, promotion visibility, retained cleanup, and one operational surface.
- **Implementation:** canonical branch/path/HEAD/diffstat; deterministic proposal names; owner refs; unchanged cleanup; retained/conflicted listing; explicit cleanup; stop/resume; wrapper or removal of duplicate shell system.
- **Tests:** empty repo, detached HEAD, collision, corrupt metadata, unchanged/changed proposal, cleanup refusal for user-owned changes, interrupted promotion.
- **Docs:** ownership, merge expectations, cleanup and recovery.
- **Dependencies/order:** after WS4 workspace transaction API; UI integration may proceed with WS8.
- **Completion:** full suite leaves no unowned worktree; every retained worktree is discoverable and protected.
- **Rollback/removal:** preserve owner metadata and user changes; cleanup refuses ambiguous ownership rather than guessing.

### WS10 — Content provenance and instruction-boundary defense

- **Objective/source:** R10; F-9.
- **Inspect/change:** prompt compiler, handoffs, judge/synthesis/verifier interpolation, tool-result handling.
- **Old/target:** prose framing with implicit trust -> provenance-typed content and policy/control isolation, with fences as secondary framing.
- **Implementation:** provenance-tagged prompt sections; structured handoffs; policy/control data never derived from repository or agent content; fence helper as defense; exhaustive interpolation inventory.
- **Tests:** fake system/developer/user messages, delimiter collisions, tool-result impersonation, nested instructions, malicious filenames/content, schema-shaped attacks, Unicode controls, oversized data.
- **Docs:** exact trust model and limits; do not call local process separation an OS sandbox.
- **Dependencies/order:** after WS3 schemas and WS6 structured outputs; required before any live certification.
- **Completion:** adversarial repository corpus cannot change tools, permissions, tuple, budget, transition, or gate.
- **Rollback/removal:** unknown provenance always fails closed; never fall back to untyped prompt concatenation.

### WS11 — Cutover, regression, and surgical deletion

- **Objective/source:** R11; F-14.
- **Inspect/change:** every legacy module/export/command/test/package entry.
- **Old/target:** overlapping legacy and staged execution paths -> one HWK production path plus isolated historical readers.
- **Implementation:** consumer/public-surface ledger; route all product commands through HWK; historical readers extracted; current research behavior migrated; objective gate extracted; delete only proven-unreachable execution code; remove feature flag/dual engine.
- **Tests:** behavioral golden suite before/after; stock templates in empty and dirty repositories; historical fixtures; CLI/TUI/package surfaces; grep/governance checks for forbidden imports.
- **Docs:** architecture/README/manual/status/rejected findings updated with exact removals.
- **Dependencies/order:** after WS3-WS10 completion and parity evidence; deletion is the last behavior change before full test/document hardening.
- **Completion:** one production engine; no lost user-visible command; deletion ledger maps every removed export to replacement or documented removal.
- **Rollback/removal:** legacy deletion commits remain internally separable for diagnosis; no branch is pushed with both engines selectable.

### WS12 — Test architecture and provider certification harness

- **Objective/source:** §§17-18.
- **Inspect/change:** all `tests/*.test.mjs`, smoke/selftests, `tools/lockdown`, new `tests/fixtures/workflows-v4/`, new provider mock servers, new `tools/providers/helix-provider-certify.mjs`.
- **Old/target:** broad mock coverage without production-factory/provider certification -> layered deterministic proof plus explicit, minimal, per-install live certification.
- **Implementation:** independent conformance fixtures; property/corruption/concurrency/worktree/package/no-egress/provider suites; certification CLI storing no credentials; stable synthetic fixtures; no copied Michaelliv tests.
- **Focused tests/negative cases:** every §17 layer; certification wrong account/model/route, expired policy, stale runtime, provider substitution, fallback, timeout, cancellation, zero/duplicate events, and redaction.
- **Documentation:** testing manual, live-cost/authorization warning, provider certification troubleshooting, exact distinction between contract-verified and live-certified.
- **Dependencies/order:** test scaffolding begins with WS2/WS3; full certification waits for WS7/WS10; final regression follows WS11.
- **Completion:** all deterministic suites green; authorized OpenRouter-free production path certified; all other local provider paths truthfully classified.
- **Rollback/removal:** certification records are derived local state and invalidated by version/config changes; removing a test harness cannot leave a provider certified.

### WS13 — Documentation, packaging, governance, and CI

- **Objective/source:** global documentation discipline and F-15.
- **Inspect/change:** `README.md`, `docs/{manual,workflows,architecture}.md`, `SECURITY.md`, `AGENTS.md`, `package.json`, package whitelist, `.github/workflows/ci.yml`, CI tools including new `tools/ci/verify-remote-branch.mjs`, `NOTICE`, new `reviews/workflows/{SUMMARY,ASSUMPTIONS}.md`.
- **Old/target:** docs and package describe v3 behavior; branch pushes lack remote CI; static/dry-run package proof -> synchronized v4 documentation, extracted-artifact runtime proof, and exact-head branch CI.
- **Implementation:** package extraction/runtime smoke; branch-push CI matrix; exact-SHA remote-run waiter that derives expected workflows from checked-in CI and fails missing/skipped/cancelled/non-success runs; docs-truth assertions; provenance/NOTICE; exact counts generated or avoided; no postinstall/network behavior.
- **Focused tests/negative cases:** missing/extra tarball files, source/package drift, global-checkout imports, runtime RPC failure, unsupported Pi/Node, docs stale snippets, branch workflow skipped, NOTICE/provenance omission.
- **Documentation:** execute every §21 item in the same commits as its behavior; append review ledgers, never overwrite.
- **Dependencies/order:** continuous updates throughout; final counts/diagrams/gates only after WS11/WS12 stabilize.
- **Completion:** docs and package describe only proven behavior; CI runs on the exact pushed branch head.
- **Rollback/removal:** packaging/CI changes revert with their feature; docs never claim a reverted behavior; derived counts regenerate.

### WS14 — All-or-nothing verification and push

- **Objective/source:** prove the consolidated branch rather than merely producing it; repository/ruleset/CI constraints in the owner dispatch.
- **Inspect/change:** no new product behavior; only final scoped diff, commit history, local artifacts, live certification record, remote metadata, and exact-head check results.
- **Old/target:** local green surfaces and no branch CI -> identical locally verified and remotely checked SHA with auditable provider and package evidence.
- **Preconditions/implementation:** isolated worktree/clean clone; current base; correct public remote; rulesets and workflow triggers recorded; unique branch absent remotely; no user-owned changes touched; run §22; create traceable commits; one non-force push.
- **Focused verification/negative cases:** absent/changed branch, remote/base/visibility/ruleset/workflow drift, missing Node binary, unavailable Docker boundary, stale certification, dirty/scoped diff, SHA mismatch, skipped/cancelled/missing remote workflow.
- **Documentation:** final commit body and handoff report list workstream evidence, all check states, provider states, pushed SHA, and zero hidden deviations.
- **Dependencies/order:** strictly last, after WS1-WS13 and clean full rerun.
- **Completion:** all checks green on exact local and remote SHA; no PR, merge, tag, release, force-push, or default-branch write; otherwise stop and report.
- **Rollback/removal:** before push, discard only the isolated implementation worktree/clone if blocked; after push, do not rewrite history or delete/close remote state without explicit user authority—report the failed branch and evidence.

## 17. Test and evaluation architecture

- **Unit:** schemas, predicates, builders, state transitions, budgets, attestation, policy, errors.
- **Migration:** every v3 fixture, missing fields, old run/state/event shapes, future-version refusal.
- **Property:** graph reachability, bounded cycles, cardinality/order, schedule determinism, effect identity, prefix invalidation.
- **Kernel integration:** parallel/map/pipeline/reduce, allowed failure, cancellation, objective convergence.
- **Effect recovery:** crash at each effect/journal/workspace phase; mutating and read-only replay.
- **Workspace:** dirty/staged/untracked/ignored/binary/symlink/submodule/empty repo, collisions and cleanup ownership.
- **Corruption:** truncated/garbled state, events, journal, snapshot, attestation, run record; stable refusal, no repair.
- **Provider contracts:** request/response golden tests, account/effective tuple mismatch, routing/fallback negatives, abort/timeout/error taxonomy.
- **Trust/adversarial:** repository and agent-output prompt injection corpus.
- **UX:** builder flows, defaults, graphs, consent, watch, resume, test output, accessibility/terminal widths.
- **Packaging:** build tarball, extract to fresh temp root, install without network scripts, Pi runtime RPC load from artifact, file whitelist and NOTICE.
- **No-egress:** static lint plus active `--network none` harness and local mock provider.
- **SDK compatibility:** exact Pi range and adapter surface; optional Claude/Codex/Copilot contract probes without live egress.
- **Live certification:** explicit opt-in, smallest prompt, hard call/token/time cap, no fallback, returned attestation recorded without content/secrets.
- **Regression:** all current valid workflow behaviors, templates, commands, persistence and public-safety gates.

No test from a repository with unresolved licensing is copied. Behavioral expectations derived from public observations are independently authored and attributed as observations, not source copies.

## 18. Benchmark and scenario suite

| Scenario | Claude observable/reference | HWK required result |
|---|---|---|
| Parallel child fails | Often null slot | Typed failed result; abort unless explicitly allowed |
| Pipeline item fails | Item stops, peers continue | Same independence, typed failure, stable order |
| Dynamic map | Bounded runtime collection | Schema-typed collection, stable item keys, cardinality ceiling |
| Resume unchanged read-only workflow | Prefix cache reuse | Reuse journal-committed effects |
| Resume unchanged mutating workflow | Claude call cache does not define repo transaction | Restore/verify committed workspace effects before reuse |
| Edit node N | Prefix before N reusable | Invalidate N and every dependent effect, not unrelated branches |
| Unknown model/effort/account | May inherit/fallback | Pre-egress refusal |
| Requested-only response identity | Vendor-dependent | Exact-disabled/refused |
| Budget nearly exhausted | Further calls may stop | Reservation refuses any call exceeding remaining bound |
| Two writers touch same file | Conflict possible | Serialized or deterministic proposal conflict refusal |
| Kill during promotion | Vendor-specific | Resume rolls forward or back from transaction journal, never half-applied |
| Malformed structured output | Repair/error | At most two budgeted repairs, then named refusal |
| Repository contains fake policy | Prompt-dependent | Remains repository data; control state unchanged |
| Objective evidence missing | Model may still say done | Cannot converge |
| Provider configured but not entitled | Status-dependent | Not selectable; honest doctor state |
| Run completes | Transcript/task notification | Completion with canonical workspace, graph, usage, attestations and gate evidence |

Benchmark outputs are exact observable states/events/hashes, not subjective answer quality. Model-content quality may be sampled separately but never substitutes for lifecycle correctness.

## 19. Operational failure model

- **Validation failure:** no run directory, worktree, provider call, or consent side effect before closed validation passes.
- **Inventory/readiness failure:** named pre-egress refusal; configured credentials are not printed.
- **Policy failure:** prohibited path hard-blocked; gray path requires explicit disclosed consent and technical exactness.
- **Provider mismatch:** response/deployment/account evidence mismatch fails the effect and run; no fallback.
- **Quota/rate limit:** pause only when reset metadata is trustworthy and retry fits budgets; otherwise fail visibly.
- **Cancellation:** graceful provider abort followed by bounded child-process kill; workspace transaction reconciled.
- **Structured-output failure:** bounded repair; raw invalid content retained only in private leak-scanned diagnostics if policy permits.
- **Workspace conflict:** proposal retained, canonical workspace unchanged, operator receives exact paths/conflict evidence.
- **Journal/state corruption:** refuse with stable code; never truncate or repair source artifacts in place.
- **Snapshot limit:** preflight or effect refusal before unbounded reads; canonical workspace remains recoverable.
- **Instruction injection:** untrusted data cannot alter control state by construction; attack is recorded as data, not executed.
- **Package/runtime incompatibility:** load-time named refusal before commands become available.
- **CI unavailable:** local evidence remains distinct; branch is not called verified until exact-head remote checks complete or the roadmap is explicitly reauthorized.
- **Logs/transcripts:** public-safe projections by default; private transcripts opt-in, bounded, warned, and never included in package/git/public reports.

## 20. Uncertainty register

| # | Uncertainty | Probability | Impact | Detection/resolution | Stop condition |
|---|---|---:|---:|---|---|
| U1 | Pi supported-version hooks differ from inspected 0.80.3/0.80.7 | Medium | High | WS1 exact fixtures and adapter spike | Cannot centralize required session/attestation/cancellation behavior |
| U2 | OpenRouter request shaping cannot be guaranteed through Pi | Medium | High | Mock capture against pinned Pi | Use explicit adapter; if pin/return evidence still unavailable, exact-disable OpenRouter |
| U3 | Codex B/E token or app-server does not expose required account/model/effort evidence | Medium | High | Official docs/types plus no-egress contract spike | Exact-disable that path; do not substitute personal OAuth |
| U4 | Copilot does not attest served model/effort/account per session | Medium-high | High | SDK/ACP protocol spike | Exact-disable unsupported tuples/path |
| U5 | Azure deployment metadata cannot prove served identity for one protocol | Medium | High | Mock + official-header/deployment probe | Refuse that protocol; no Model Router |
| U6 | Provider policy changes | High over time | High | Dated links and implementation-time refresh | Never ship prohibited as executable |
| U7 | Private snapshot fidelity is impractical for ignored/large/special files | Medium | High | WS5 spike/corpus | Stop; do not fall back to repository Git objects or silent omissions |
| U8 | Dynamic requirements exceed the closed v4 predicates | Low-medium | Medium | Express representative scenarios before implementation cutover | Extend typed IR deliberately; do not introduce runtime eval ad hoc |
| U9 | Branch-push GitHub Actions behavior/rulesets drift | Medium | High | Pre-push `gh api`/workflow inspection | Stop before push |
| U10 | Authorized free OpenRouter path is not configured at implementation time | Medium | Medium | Non-mutating status check | Complete deterministic work but stop before claiming live-certified branch completion |

## 21. Documentation migration checklist

- [x] `README.md`: proven feature list, workflow creation, visualization, provider truth vocabulary, package/runtime support; no stale counts.
- [x] `docs/architecture.md`: HWK boundaries, IR, scheduler/effects, workspace transaction, attestation, trust model, persistence.
- [x] `docs/manual.md`: onboarding, builder, test/simulate/deploy/run/watch/resume/clean, failure recovery, certification.
- [x] `docs/workflows.md`: v4 schema and examples from linear to parallel/map/pipeline/remediation; programmatic builder.
- [x] New `docs/providers.md`: dated path/policy/capability/certification truth table and exact-disabled reasons.
- [x] `SECURITY.md`: repository/agent-output trust, private snapshots, transcripts, provider/account data, subprocess boundaries.
- [x] `AGENTS.md`: kernel invariants, runtime import seam, refusal/event conventions, effect-aware mutation/replay rule.
- [x] New `reviews/workflows/SUMMARY.md`: accepted findings, status, verification evidence, append-only sessions.
- [x] New `reviews/workflows/ASSUMPTIONS.md`: provider/policy/attestation assumptions and rejected findings.
- [x] Status/roadmap references: v3 inputs normalize into the shipped HWK v4 execution kernel; implementation completion follows §22.
- [x] `NOTICE`: exact MIT ports/provenance from Quintin if any; no Michaelliv code/fixture copy absent license resolution.
- [x] `tools/ci/docs-truth-check.mjs`: executable documentation assertions, generated facts where possible.
- [x] Implementation dispatch text: remote/base/branch/check commands match the shipped CI.

## 22. Final all-or-nothing verification gate

WS13 must add stable scripts so the final gate is concise and reproducible:

```bash
# Preconditions and exact scope
git status --short
git rev-parse HEAD
git merge-base --is-ancestor origin/main HEAD
git diff --check origin/main...HEAD

# Current-runtime full gate
npm test
npm run check:resources
npm run check:docs-truth
npm run check:no-live-egress
npm run check:public-safety-diff
npm run check:workflow-conformance
npm run check:provider-contracts
npm run check:package -- --pi-bin node_modules/.bin/pi
node tools/smoke/pi-e2e-load.mjs --runtime-rpc

# Active no-egress boundary; Docker/unshare prerequisite absence is a blocker,
# not a pass or skip.
bash tools/lockdown/no-egress-smoke.sh --active

# Local matrix. The script requires explicit preinstalled executables and
# performs no download/install/global mutation.
HELIX_NODE22_BIN="$HELIX_NODE22_BIN" \
HELIX_NODE26_BIN="$HELIX_NODE26_BIN" \
bash tools/ci/run-node-matrix.sh

# Authorized minimal live certification. Never substitute another provider,
# model, account, or paid route; absence of authorization/configuration blocks
# the live-certified completion claim.
HELIX_LIVE_TESTS=1 \
HELIX_LIVE_PROVIDER=openrouter \
HELIX_LIVE_MODEL="$HELIX_LIVE_MODEL" \
HELIX_LIVE_ROUTE="$HELIX_LIVE_ROUTE" \
HELIX_LIVE_EXPECTED_ACCOUNT="$HELIX_LIVE_EXPECTED_ACCOUNT" \
npm run test:live:provider-certification

# Package proof is inside check:package and must create a tarball, extract it to
# a disposable root, verify the whitelist/NOTICE, and load it through Pi RPC.

# Final repository safety
git diff --check origin/main...HEAD
git status --short
```

Before the one push:

```bash
gh repo view luisgui1757/helix --json nameWithOwner,visibility,defaultBranchRef,isFork
gh api repos/luisgui1757/helix/rulesets
git fetch --prune origin main
test "$(git rev-parse origin/main)" = "$(git merge-base origin/main HEAD)"
test -z "$(git ls-remote --heads origin helix-workflow-kernel-v1)"
```

Push without force. The updated CI must run on non-default branch pushes with Node 22.19 and current 26. Then verify:

```bash
test "$(git rev-parse HEAD)" = "$(git ls-remote origin refs/heads/helix-workflow-kernel-v1 | awk '{print $1}')"
gh run list --branch helix-workflow-kernel-v1 --commit "$(git rev-parse HEAD)" \
  --json databaseId,name,headSha,status,conclusion,url
node tools/ci/verify-remote-branch.mjs \
  --repo luisgui1757/helix \
  --branch helix-workflow-kernel-v1 \
  --sha "$(git rev-parse HEAD)" \
  --wait
```

Wait for every workflow associated with the exact SHA. Record pass/fail/cancel/skip separately. Any missing expected workflow, stale SHA, base drift, ruleset drift, provider substitution, or unavailable mandatory gate is a stop, not an implicit pass.

## 23. Definition of done and non-goals

Done means:

- Every WS1-WS14 implementation item and completion criterion is satisfied on one fresh branch.
- One production workflow engine remains.
- Every current valid workflow/template migrates and behaves equivalently.
- Builder, programmatic API, simulation, planned graph, observed graph, run, watch, resume, stop, and cleanup are usable and tested.
- Provider/account/model/effort/route exactness is attested or the path is visibly exact-disabled.
- Prohibited paths cannot be overridden.
- Mutating recovery restores and verifies repository effects.
- Canonical workspace promotion is deterministic and downstream-visible.
- Objective gate remains the only converged exit.
- Full deterministic, package, no-egress, Node matrix, and authorized OpenRouter certification gates pass.
- Local HEAD, pushed branch SHA, and remote check SHA are identical.
- Documentation, reviews ledgers, security model, package metadata, and NOTICE are synchronized.
- No PR, merge, tag, release, force-push, or default-branch write occurred.

Non-goals:

- Cosmetic cloning of Claude Code.
- General arbitrary runtime JavaScript/eval in v1.
- Model-driven recursive self-delegation outside the typed workflow graph.
- Silent requested-only provider mode.
- Supporting prohibited consumer-subscription reuse.
- CLIProxyAPI integration.
- Automatic semantic merge/conflict resolution.
- Replacing Helix CC or changing its repository.
- Marketplace/release publication.
- Claiming every configured account is entitled or live-certified.

## 24. Implementation dispatch prompt

```text
You are implementing ROADMAP_SOL.md in the public repository
https://github.com/luisgui1757/helix. MODE: WRITE. The complete target is one
consolidated, all-or-nothing branch delivery. Read ROADMAP_SOL.md, AGENTS.md,
the current README/manual/architecture/workflow docs, and the reviews ledgers
before changing anything.

ROADMAP_SOL.md is the controlling architecture. The archived
reviews/workflows/FABLE_ARCHITECTURE_ROADMAP_2026-07-16.md is historical input,
not an alternative specification. If they disagree, ROADMAP_SOL.md wins.

Preconditions — verify before editing and again before push:

1. Resolve the actual checkout and remote. The remote must be exactly
   luisgui1757/helix, public, not a fork, default branch main.
2. Fetch origin/main without switching or modifying a user-owned checkout.
   Record the exact origin/main SHA, visibility, applicable rulesets, workflow
   triggers, and whether owner bypass exists. If these drift from the roadmap,
   STOP and report.
3. Use an isolated worktree or clean disposable clone. Preserve every
   user-owned file and unrelated change.
4. Create one fresh non-default branch, suggested
   helix-workflow-kernel-v1, only after git ls-remote proves it absent.
5. Do not open a PR, merge, tag, release, force-push, or write to main.

Implement every workstream WS1-WS14. Internal commits and parallel workstreams
are allowed, but nothing ships until the full target, migrations, tests,
documentation, packaging, provider truthfulness, and gates exist together.
There must be one production workflow engine at completion.

Binding rules are absolute:

- No fallback of provider, model, effort, route, account, runtime, tools,
  permissions, workspace, or objective gate.
- Configured is not entitled; requested is not effective; mock-verified is not
  live-certified.
- A prohibited provider/account path is never executable and has no override.
- Any required attestation that is requested-only or unavailable refuses exact
  mode before egress.
- Never invoke an unapproved paid/live endpoint. The only required live proof is
  the explicitly authorized, configured, smallest-possible OpenRouter-free
  certification path. Require exact HELIX_LIVE_MODEL, HELIX_LIVE_ROUTE, and
  HELIX_LIVE_EXPECTED_ACCOUNT inputs; never substitute another model, route,
  provider, or account.

Durability rules are absolute:

- Never return a cached mutating result without restoring and verifying its
  committed workspace effect.
- Every mutating effect commits through the canonical workspace transaction
  model before downstream work starts.
- Corrupt state, journal, snapshot, attestation, or workspace metadata refuses;
  never silently repairs source artifacts.
- Only deterministic objective-gate evidence can mark convergence.

UX rules are absolute:

- Preserve the current guided builder, templates, simulation, and workflow test
  UX while migrating them to WorkflowDefinition v4.
- Provide planned and observed graph views with stable node IDs.
- Raw JSON and programmatic building are optional expert surfaces, never a
  prerequisite for ordinary workflow creation.

Testing and documentation:

- Write behavior-first regressions for every finding and migration.
- Do not copy Michaelliv source/tests/fixtures unless a compatible license is
  first proven; independently author behavioral cases.
- Attribute any exact MIT-licensed Quintin port in NOTICE and source comments.
- Do not weaken/delete/skip tests or suppress diagnostics.
- Update every named markdown file and append-only review ledger in the same
  commits as behavior.
- Run §22 exactly. A missing prerequisite or unavailable mandatory gate is a
  blocker, not a skip. Run the local Node matrix with preinstalled binaries and
  perform no installer/global mutation.

Before pushing, re-verify base, remote, visibility, rulesets, workflow triggers,
branch collision, scoped diff, package contents, no-egress, provider
certification, and every local check. Push the complete branch once without
force. Wait for branch CI on the exact SHA under Node 22.19 and current 26.
Verify remote branch SHA equals local HEAD and list every exact-head check.

If any uncompromised requirement cannot be met, STOP and report the blocker,
evidence, affected workstreams, and canonical resolution. Do not ship a partial
branch or degraded substitute.

Final report:

- exact base, local commit, pushed branch, and remote SHA;
- one row per workstream with implementation and test evidence;
- all local and remote gates with pass/fail/skip/unavailable stated separately;
- provider paths and their installed/configured/entitled/exact/certified states;
- documentation and migration evidence;
- residual risks, which must contain no unresolved P0/P1 and no hidden
  compromise.
```
