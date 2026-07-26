# Status

Snapshot: 2026-07-26. Version: 0.5.1 remediation candidate for `main`.

## Public repository readiness

The controlled visibility cutover is complete and the live repository is
**PUBLICATION READY**. Immediately before publication, a fresh mirror of every
advertised branch, tag, and pull-request head passed strict object integrity and
Gitleaks across eight reachable commits; it contained zero exact maintainer-home
paths and only GitHub noreply identities. The repository was then changed from
private to public and that state was read back from GitHub.

Public-only controls are live: secret scanning, push protection, private
vulnerability reporting, and CodeQL default setup for Actions and
JavaScript/TypeScript. CodeQL run `29797378509` succeeded on exact `main` at
`07046119c8ee966892cb9039e934839a91bca0e0`; both analyses reported zero results
and the active no-bypass CodeQL ruleset `19321579` enforces the checked-in
correctness and security thresholds. Code-scanning, secret-scanning, Dependabot,
and published repository-advisory alert counts are all zero.

The live repository also retains separate active integrity and review rulesets,
no overlapping classic branch protection, squash-only merges, immutable
releases, GitHub-owned Actions only, full-SHA enforcement, read-only workflow
tokens, the dependency graph, Dependabot security updates, and the bot-authored
open [Renovate dashboard](https://github.com/luisgui1757/helix-cc/issues/2).
The gold-standard policy change adds dependency review to the stable aggregate
`test`, bounded CI runtimes, cancellation of superseded runs, an active
checked-in CodeQL definition, and a durable
[security and governance baseline](docs/security-governance.md).
The policy landed through protected pull request #3; the live controls and
checked-in rulesets were re-read as matching during the 2026-07-23 audit.

The authorized privacy rewrite, former pull-request dereference, Renovate first
run, cutover evidence, and deliberate policy exclusions remain append-only in
the dated
[public-readiness review](docs/reviews/helix-cc-public-readiness-2026-07-20.md).

Throughout the append-only 0.3.2/0.4.0 ledgers, abbreviated `Production
revision` values attached to pre-publication Workflow receipts are historical
labels. The authorized privacy rewrite replaced those Git objects, so they
intentionally do not resolve in the public repository and are not current-route
evidence. Fresh receipts must cite a resolvable current revision.

The public setup path is fail-closed against mutable remote installer execution:
Claude Code must already be installed at the supported minimum, while the
CLIProxyAPI archive and optional Copilot adapter retain their existing exact
version and integrity checks.

## User-test readiness

Version 0.3.2 is **READY FOR STRUCTURED USER TESTING** on the native, OpenAI-subscription,
GitHub Copilot, and exact OpenAI + Copilot routes described in the HOW-TO.
Version 0.3.2 closed the repository-wide review blockers, passed the complete
local gate, repeated every promoted provider proof, and completed one current
heterogeneous nine-role workflow. Azure remains deliberately unpromoted until
an exact configured deployment produces its own live receipt.

Version 0.4.0 adds executable parity for every built-in base Helix loop and
guided template. Six exact-head whole-repository audit rounds have returned
`NOT READY`. The first drove signed tool-generated evidence; later rounds drove
post-documentation research attestation, complete tracked mode/type snapshots,
exact signed TDD path scope, shipment composition fixes, preventive TDD
restoration, isolated red execution, four-stop research convergence, and one
pre-agent input grammar. A new exact-head audit remains
required; no 0.4.0 `READY` claim is made before that independent result.

Version 0.5.0 retains all six audited standalone workflows as the default
`original` mode and adds a secondary `graph` mode. The graph implementation is
compiled from closed, versioned definitions with reachability, transition,
context read/write capability, independent checkout-mutation capability,
bounded-cycle, approval-path, compiler-generated registry, catalog, digest,
drift, and absolute-step-ceiling checks. It does not accept uploaded graphs or
arbitrary workflow JavaScript.

Version 0.5.1 is the audit-remediation candidate. It binds all effect-bearing
evidence calls to one closed authorization recorded at session creation and
refuses command, TDD, preflight, commit, push, or PR substitutions before their
effects. It also restores zero-argument launcher portability on stock macOS
Bash, adds a macOS CI leg, bounds the disposable TDD copy to 1 GiB, documents
post-commit shipment failure state, and corrects current/historical evidence
and setup language. It is not a current-main claim until its protected pull
request merges.

All existing public workflow behavioral tests run against both modes. A
separate parity campaign compares complete prompts, schemas, labels, model
options and responses, parallel groups, child-workflow calls, ordinary logs,
terminal values, and exact errors against independent equivalent simulated
boundaries. The current campaign covers 22 workflow scenarios across success,
remediation, exhaustion, forgery, research terminals, and shipping refusal,
plus 4 comparison-harness contract tests. Graph mode has
deterministic evidence only; no live provider-backed graph-mode
receipt is claimed.

The 0.5.0 lockfile also resolves `fast-uri` to `3.1.4` and overrides the MCP
SDK's vulnerable Hono Node adapter range with `@hono/node-server` `2.0.11`.
The packaged stdio MCP smoke test and complete local gate cover the resolved
tree; the production audit reports zero known vulnerabilities.

## 0.5.0 graph mode

| Surface | State |
|---|---|
| Original workflows | Preserved as default mode |
| Graph workflows | Six generated import-free secondary scripts |
| Construction | Closed JSON definitions plus exact same-ID machine-readable operation catalogs and reviewed templates |
| Static analysis | Reachability, exhaustive outcomes, JavaScript-safe context keys, parsed lexical/dataflow isolation for graph-state sources including nested aggregate/call/constructor aliases and the enclosing Workflow `arguments` binding; identifier/property/object-method/class/built-in/call/apply/bind/construct outer-write analysis; conservative rejection of mutation-bearing helper parameters, operation-local destructuring/classes, sequence callables, dynamic calls/evaluation/source constructors, and constructor-derived callables; accessor-free plain structured copies without custom-prototype reads or functions/symbols and with initial cross-key aliases preserved; non-copyable state capabilities; protected prototypes and inherited methods; revocable per-operation context and alias-preserving boundary snapshots; recursive immutability including descriptors; enforced reads/writes; independent checkout-mutation capability; fork safety; entry-crossing bounded SCCs; fresh approval requirements; exact generated registry; catalog identity; and step ceiling |
| Visualization | Mermaid generated from the same definitions with SHA-256 digests |
| Drift control | In-memory regeneration of all scripts and diagrams in the local/CI gate |
| Cross-mode parity | 22 exact workflow scenarios plus 4 comparison-harness tests and 45 original workflow regressions rerun in graph mode |
| Independent review | Round 1 fixed 4 medium/2 low; round 2 fixed 4 medium/1 low; round 4 fixed 2 medium; round 7 fixed 2 medium; round 8 fixed 4 medium/1 low; pre-verdict observations from classifier-aborted rounds 3, 5, 6, 9, 10, 11, and 12 were fixed; round 13 returned no concrete candidate before aborting; round 14 exact-scope result: 0 critical/high/medium/low, `READY` |
| Live graph proof | Not run; remains a separate provider-backed evidence layer |

The controlling implementation, test, and review ledger is
[`graph-migration.md`](graph-migration.md). The user contract and generated
diagrams are in [`docs/graph-mode.md`](docs/graph-mode.md) and
[`docs/workflow-graphs.md`](docs/workflow-graphs.md).

## 0.4.0 Helix loop parity

| Base behavior | Helix CC state |
|---|---|
| `full-cycle` / guided `plan-implement` | Delivery workflow with competing plans, signed exact-argv evidence, remediation, and correctness-triggered replanning |
| Guided `implement-review` | Added standalone bounded implement/review workflow with signed exact-argv evidence |
| `tdd-fix` | Added signed repository baseline plus exact user-confirmed test paths, tool-observed in-scope red, and exact-argv green gate |
| `scout` | Added read-only reconnaissance and structured brief |
| `research` | Added bounded hypothesis/experiment convergence with signed typed measurement/test gates and the four base terminal reasons: target, valuable dead-end, plateau, and iteration rail |
| `ship-pre-pr` | Added capability-limited signed general/release gates and commit/push/open-or-reuse-PR handoff; never merge |

The canonical inputs, stage invariants, and deliberate Claude mapping
differences are in [`docs/workflows.md`](docs/workflows.md).

### Current audit-remediation ledger

| Finding | Resolution state |
|---|---|
| Tracked executable-mode changes could escape a dirty-file fingerprint | Fixed: every bounded tracked path contributes content, type, and mode to the snapshot; packaged-service and child-verifier regressions pass |
| TDD scope relied on test-like path names | Fixed: exact user-confirmed `testPaths` are signed at baseline, enforced before a red receipt is issued, and verified by the child workflow |
| PR lookup used an unsupported owner-qualified `--head` form | Fixed: branch-only lookup plus exact head owner/repository/branch/SHA/base filtering; checked against GitHub CLI 2.96.0 |
| Rename paths diverged between preflight and staging; refusal could leave index changes | Fixed: source/destination path accounting is consistent for pure and edited renames, and pre-commit refusal restores the prior index tree |
| Provider proof command omitted the provider set | Fixed: the primary skill specifies exact single-route and mixed-route commands |
| Pre-PR flow lacked a separate repository-specific release check | Fixed: `releaseCheckArgv` is a distinct required signed gate from `verificationArgv` |
| Review roles misread a non-mutating final command as proof of no earlier writer changes | Fixed after installed reproduction: every review/gate prompt defines the receipt's exact time window, silent-output meaning, and non-shipping commit boundary |
| Full-cycle writer committed inside a non-shipping loop | Fixed after installed reproduction: planner, builder, tester, and documenter contracts prohibit Git/GitHub handoff; only the separately confirmed shipper owns it |
| Review roles conflated verification-command delta with the final working-tree delta | Fixed after a second installed reproduction: signed v2 command receipts carry both top-level command mutations and `checkout.changedPaths` relative to HEAD |
| Evidence courier truncated a long single-token RSA signature | Fixed after installed reproduction: v2 schemas require six fixed signature chunks and the child verifier rejects any missing or malformed chunk |
| Current installed terminal evidence for every public loop | Fixed at production revision `9279094`: delivery, implement-review, TDD, research, and scout reached their terminal installed states; ship-pre-pr reached its required no-confirmation refusal without starting an agent or changing Git state |
| TDD reproduction could mutate ignored, Git-internal, redirected HOME, or relative sibling paths in the user checkout | Fixed: `reproduce_red` executes inside a disposable repository copy with redirected project, Git, HOME, and temporary process state; ignored test paths and empty test deltas are refused; only verified signed test contents are applied back to an unchanged checkout/index. This is not an OS sandbox and does not contain absolute-path writes elsewhere. |
| Research omitted base Helix dead-end and diminishing-return stops | Fixed: deterministic target/dead-end/plateau/max decisions, comparator-aware progress, equality-distance handling, successor continuation, and structured terminal results are component-tested |
| Workflow input grammar was weaker than the trusted service | Fixed: all five evidence-backed workflows reject non-PATH executable argv before agents; TDD/ship accept at most one `./`, revalidate the normalized path, reject duplicates/reserved forms, and ship rejects LF/CR commit messages and titles before agents |
| Evidence tool count drifted after `reproduce_red` | Fixed: one exported six-tool catalog binds the service and MCP declarations; documentation names all six and is contract-tested |
| Positive installed TDD/research evidence predates round-five behavior | Fixed: production revision `24d403d` completed the isolated `reproduce_red` TDD path; exact research revision `9ac08b9` completed both `dead-end` and `diminishing-returns` through the installed Workflow tool with independently verified fixture state |
| Research experiment reported an expected metric miss as an `openBlocker` | Fixed after installed reproduction: the experiment contract distinguishes research evidence from conditions that prevented execution and requires `openBlockers: []` after a completed experiment |
| Research rejected a non-refuted miss that named a successor | Fixed after installed plateau reproduction: successor hypotheses may accompany any unmet result; only a refutation without a successor becomes a dead-end, matching base Helix |
| Startup signals could orphan provider processes before foreground ownership | Fixed after round-six reproduction and round-seven proof correction: one process-level owner is installed before the first async spawn; every backend, attestation proxy, gateway, login, Claude, and proof child registers immediately; six subprocess cases import the production controller, substitute only generated loopback executables/state at external boundaries, and prove bounded SIGINT/SIGTERM cleanup, no post-interrupt spawn, dead PIDs, released ports, and exit 130/143 across readiness and active execution |
| Proof result could be checked before its Workflow transcript finished persisting | Fixed after exact-route reproduction and round-seven incremental-write trace: proof attestation waits up to five seconds for the exact marker-bearing transcript count and exact sorted resolved-model set to converge, remains interruptible, and refuses excessive transcripts, missing models, or unexpected models |
| Bare `claudex` failed on stock macOS Bash 3.2 when no arguments were forwarded | Fixed: Bash-3.2-safe empty-array expansion covers native and provider model injection; zero-argument subprocess coverage runs on a real `macos-latest` CI leg |
| Evidence operations could execute model-supplied effects before the workflow verifier rejected an argv mismatch | Fixed: `start_session` stores a closed normalized authorization and every command, TDD, pre-PR, commit, push, and PR operation matches it before effects; hostile sentinel and no-invocation regressions cover refusals |
| TDD reproduction copied an unbounded working tree | Fixed: cumulative regular-file copying is limited to 1 GiB with a typed refusal naming the first path over the bound |
| Shipment failure after commit creation left an undocumented local commit | Fixed as a disclosure contract: the commit deliberately remains because a push may already have taken effect; the behavior is documented and regression-tested |
| Current docs treated pre-privacy-rewrite evidence as current and cited non-resolving object names | Fixed: route tables use `Historical evidence`, this ledger disclaims the retained pre-rewrite names, and fresh proof is required for current health |
| Setup troubleshooting claimed setup installs Claude Code | Fixed: the HOW-TO now directs users to Anthropic's separate official installation guide and preserves setup's fail-closed no-remote-installer boundary |
| Graph/publication documents still described pre-merge or pre-publication state | Fixed: graph delivery records protected PR #4, the public policy records protected PR #3, and the vulnerability-reporting conditional was removed |

## Current route states

The historical route rows below retain pre-rewrite evidence labels under the
disclaimer above; fresh proof is required for current route health.

| Route | State | Evidence |
|---|---|---|
| Native Claude | Supported | Local executable/configuration checks plus historical installed Workflow execution |
| OpenAI subscription `gpt-5.6-luna` | Historical evidence | Pre-rewrite production label `9b6b35f`; 2026-07-19 marker and resolved-model record retained; fresh proof required |
| GitHub Copilot `copilot/gpt-5.4` | Historical evidence | Pre-rewrite production label `9b6b35f`; dated pin `gpt-5.4-2026-03-05` retained; fresh pin and proof required |
| OpenAI + Copilot | Historical evidence | Pre-rewrite production label `9b6b35f`; 2026-07-19 exact two-model matrix and nine-role delivery record retained; fresh proof required |
| Azure Foundry GPT | Implemented; live proof pending | Deterministic endpoint, configuration, response-model, and lifecycle tests only |
| Azure-containing mixtures | Implemented; exact matrix proof required | No promoted combination |
| OpenRouter | Deferred | Rejected by provider selection |

## 0.3.2 review closure

| Finding | Resolution state |
|---|---|
| Provider-session doctor preflight loses direct gateway values | Fixed with a bounded, live-process wrapper receipt; subprocess composition test passes |
| Plugin doctor invocation depends on ambient PATH | Fixed with explicit `${CLAUDE_PLUGIN_ROOT}` invocation in both skills |
| Copilot launcher silently selects an unpromoted controller | Fixed by requiring an explicit model for every provider-backed launch |
| Setup can finish without a usable launcher handoff | Fixed with exact PATH detection/instructions and disposable-home coverage |
| Launcher options stop parsing at the first Claude argument | Fixed; arguments are fully parsed and ordering is regression-tested |
| Primary provider entrypoint has no process-level tests | Fixed with help, invalid-command, status, launch, and proof boundary tests |
| Foreground interruption cleanup is unproven | Fixed with async signal forwarding, bounded escalation, and child-liveness assertions |
| Provider route policy accepts a controller outside the selected set | Fixed with pre-start launch/proof namespace validation and full matrix coverage |
| Copilot path resolution reads ambient environment directly | Fixed with explicit environment injection |
| Copilot dependency recovery names the wrong install command | Fixed to the repository's locked install command |
| Doctor exposes maintainer jargon in its JSON surface | Fixed as `dynamicWorkflowsPeerCompatible` and documented |
| README/provider guide duplicate the HOW-TO | Fixed; quickstart is the sole procedure and command/link contracts pass |
| Historical analysis dominates onboarding | Fixed; evidence and analysis are indexed under `docs/history/` |
| Review artifact and dispatch prompt were local-only | Fixed; both are included and the review has an append-only resolution |
| Research measured and tested before its final documentation write | Fixed; each pass now remeasures and retests after the documenter, with a real signed-receipt regression against a disposable Git checkout |

## Verification ledger

Update only from final-code evidence.

| Check | Status | Evidence |
|---|---|---|
| Focused 0.3.2 regressions | Passed | Launcher, setup handoff, entrypoint, route/model, scrubbed preflight, lifecycle, and docs contracts included in the full suite |
| `npm run check` | Passed | `validated helix-cc: 9 original/internal workflows, 6 graph workflows, 13 agents, 7 skills` |
| `npm test` | Passed | 188 passed; 0 failed, skipped, or TODO; includes preventive evidence authorization, Bash-3.2 launcher, bounded-copy, post-commit residual, provider, lifecycle, workflow, packaging, and documentation contracts plus 16 graph IR/compiler/runtime tests and 26 parity tests (22 workflow scenarios and 4 comparison-harness contracts) |
| `npm run test:graph` | Passed | 45 original workflow regressions passed in graph mode |
| `claude plugin validate --strict .` | Passed | Claude Code 2.1.220 strict validation |
| Dependency and registry integrity | Passed | Zero production vulnerabilities; 155 registry signatures and 14 attestations verified |
| Current secret scan | Passed | Gitleaks found no leak in the candidate working tree or seven reachable commits |
| Documentation link/command contract | Passed | Current links resolve locally; every provider launch example supplies an explicit model |
| Interrupted provider startup acceptance | Historical pass | Pre-rewrite production label `c5016f6`: SIGTERM after the first Copilot child spawn and before gateway readiness produced exit 143; every observed PID died, all allocated ports were released, and idle status returned `unreachable` |
| Installed signed-evidence seam | Historical pass | Pre-rewrite production label `9279094`: v2 receipt signed the exact command delta and final checkout paths; all six RSA chunks survived the agent courier and the child verifier accepted the signature |
| Installed `helix-delivery` headless smoke | Historical pass | One pass; `approved: true`; evidence verified; both reviews passed; historical fixture HEAD `a7a584e` remained unchanged with exactly three requested unstaged files |
| Installed `helix-implement-review` headless smoke | Historical pass | One pass; `approved: true`; evidence verified; existing behavioral test changed and passed; historical fixture HEAD `0189325` remained unchanged with four requested unstaged files |
| Installed `helix-tdd-fix` headless smoke | Historical pass | One reproduction and one fix pass; signed test-only exit-1 red preceded the production change; signed green and final approval passed; historical fixture HEAD `c30fe13` remained unchanged |
| Installed negative input boundary | Historical pass | Pre-rewrite production label `d52d276`: installed TDD rejected a non-PATH reproduction executable and installed ship rejected `.git/config`; both Workflow results reported zero nested agents and zero nested tool uses |
| Installed `helix-research` headless smoke | Historical pass | One experiment; typed `payload_bytes` target equaled exactly `4 bytes`; final measurement and exact test receipts verified; `approved: true`; historical fixture HEAD `77a047f` remained unchanged |
| Installed research dead-end acceptance | Historical pass | Pre-rewrite production label `9ac08b9`; one pass; `approved: true`; `stopReason: dead-end`; signed metric remained 5 bytes against target `<5`; signed and independent tests passed 3/3; historical fixture HEAD `d70d7ad` and exact fixed payload bytes remained unchanged; delta was exactly RESEARCH, STATUS, and one floor test |
| Installed research plateau acceptance | Historical pass | Pre-rewrite production label `9ac08b9`; two passes; `approved: false`; `stopReason: diminishing-returns`; deterministic `problems: []`; signed metric remained 10 against target `>100`; signed and independent tests passed 6/6; historical fixture HEAD `bbab6bf` and all five fixed inputs remained unchanged; delta was exactly RESEARCH, STATUS, and one ledger test |
| Installed `helix-scout` headless smoke | Historical pass | Both read-only agents completed through the installed plugin and returned structured reconnaissance and brief; historical fixture HEAD `ced1eb9` and the working tree remained unchanged |
| Installed `helix-ship-pre-pr` refusal smoke | Historical pass | With the complete evidence session but `confirmOpenPullRequest: false`, the installed workflow refused on the exact confirmation gate; zero agents started and historical fixture HEAD `ced1eb9` remained clean; no PR was opened |
| OpenAI exact route proof | Historical pass | Pre-rewrite production label `9b6b35f`; `gpt-5.6-luna`; marker matched; exact resolved-model set contained one transcript; sidecar not reused |
| Copilot exact route proof | Historical pass | Pre-rewrite production label `9b6b35f`; `copilot/gpt-5.4`; served pin `gpt-5.4-2026-03-05`; marker matched; exact resolved-model set contained one transcript; sidecar not reused |
| OpenAI + Copilot matrix proof | Historical pass | Pre-rewrite production label `9b6b35f`; requested and exact resolved-model sets matched `gpt-5.4` plus `gpt-5.6-luna` across exactly two transcripts; sidecar not reused |
| Full heterogeneous nine-role workflow | Historical pass | One pass; `approved: true`; seven `gpt-5.6-luna` and two `gpt-5.4` transcripts; historical fixture tests and diff check passed |
| Azure exact route proof | Unavailable | Azure CLI and deployment configuration are absent on this machine |

## Deliberate product boundaries

| Boundary | State |
|---|---|
| Deterministic command/file/metric gate | Implemented through an always-loaded capability-limited MCP service plus an internal RSA receipt-verifier workflow; agents only transport signed receipts |
| Pre-PR Git/GitHub effects | Limited to exact task-file staging, one normal commit, one non-force branch push, and one exact open/reused PR; signed live state is re-verified before success |
| Durable cross-process Workflow recovery | Not implemented; Claude `resumeFromRunId` is same-session continuation |
| Deterministic task/configuration consent | Not implemented; skill confirmation is advisory |
| Exact effective per-agent Claude model | Requested and observed where possible; active policy can supersede it |
| Arbitrary workflow compiler | Intentionally not implemented; original mode ships six audited scripts and graph mode compiles six reviewed closed definitions without accepting user code or uploaded graphs |
| Writer worktree merge choreography | Intentionally omitted; writers are serialized in the selected checkout |
| OpenRouter execution | Deferred and rejected |

Historical analysis, branch cleanup records, and dated provider receipts are
indexed in [`docs/history/`](docs/history/README.md). Current procedures live
only in [`docs/quickstart.md`](docs/quickstart.md).
