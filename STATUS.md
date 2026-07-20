# Status

Snapshot: 2026-07-20. Version: 0.4.0 on `main`.

## Public repository readiness

Repository-backed public-release safeguards are prepared: least-privilege CI
with a stable aggregate `test` check, SHA-pinned GitHub Actions, checked-in
integrity/review/CodeQL ruleset definitions, CODEOWNERS, a pull-request
template, security and contribution policies, and conservative Renovate
coverage for npm and GitHub Actions. Live private-repository settings are
tracked in the dated
[public-readiness review](docs/reviews/helix-cc-public-readiness-2026-07-20.md).

Publication remains **HOLD** pending the controlled visibility cutover. The
authorized privacy rewrite replaced the absolute maintainer home path throughout
retained branch history, normalized non-noreply commit metadata, and removed the
obsolete remote feature branch. GitHub Support has now dereferenced PRs #1 and
#2: the remote advertises only rewritten `main`, both pull-request APIs return
`404`, and fresh whole-history and tracked-tree Gitleaks scans report zero
findings. The maintainer reports that Renovate repository access is granted;
operational activation still requires a bot-authored `Renovate dashboard`
readback.

After the repository becomes public, GitHub CodeQL, secret scanning, push
protection, and private vulnerability reporting must be enabled immediately.
Their first analyses and zero-open-alert state, plus the active post-public
CodeQL ruleset, must be read back before the final **PUBLICATION READY** verdict.

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
| TDD reproduction could mutate ignored, Git-internal, HOME, or sibling paths | Fixed: `reproduce_red` executes inside a disposable repository copy with redirected project, Git, HOME, and temporary process state; ignored test paths and empty test deltas are refused; only verified signed test contents are applied back to an unchanged checkout/index |
| Research omitted base Helix dead-end and diminishing-return stops | Fixed: deterministic target/dead-end/plateau/max decisions, comparator-aware progress, equality-distance handling, successor continuation, and structured terminal results are component-tested |
| Workflow input grammar was weaker than the trusted service | Fixed: all five evidence-backed workflows reject non-PATH executable argv before agents; TDD/ship accept at most one `./`, revalidate the normalized path, reject duplicates/reserved forms, and ship rejects LF/CR commit messages and titles before agents |
| Evidence tool count drifted after `reproduce_red` | Fixed: one exported six-tool catalog binds the service and MCP declarations; documentation names all six and is contract-tested |
| Positive installed TDD/research evidence predates round-five behavior | Fixed: production revision `24d403d` completed the isolated `reproduce_red` TDD path; exact research revision `9ac08b9` completed both `dead-end` and `diminishing-returns` through the installed Workflow tool with independently verified fixture state |
| Research experiment reported an expected metric miss as an `openBlocker` | Fixed after installed reproduction: the experiment contract distinguishes research evidence from conditions that prevented execution and requires `openBlockers: []` after a completed experiment |
| Research rejected a non-refuted miss that named a successor | Fixed after installed plateau reproduction: successor hypotheses may accompany any unmet result; only a refutation without a successor becomes a dead-end, matching base Helix |
| Startup signals could orphan provider processes before foreground ownership | Fixed after round-six reproduction and round-seven proof correction: one process-level owner is installed before the first async spawn; every backend, attestation proxy, gateway, login, Claude, and proof child registers immediately; six subprocess cases import the production controller, substitute only generated loopback executables/state at external boundaries, and prove bounded SIGINT/SIGTERM cleanup, no post-interrupt spawn, dead PIDs, released ports, and exit 130/143 across readiness and active execution |
| Proof result could be checked before its Workflow transcript finished persisting | Fixed after exact-route reproduction and round-seven incremental-write trace: proof attestation waits up to five seconds for the exact marker-bearing transcript count and exact sorted resolved-model set to converge, remains interruptible, and refuses excessive transcripts, missing models, or unexpected models |

## Current route states

| Route | State | Evidence |
|---|---|---|
| Native Claude | Supported | Local executable/configuration checks plus historical installed Workflow execution |
| OpenAI subscription `gpt-5.6-luna` | Route verified | Production revision `9b6b35f`; marker matched; exact resolved-model set contained one `gpt-5.6-luna` Workflow transcript |
| GitHub Copilot `copilot/gpt-5.4` | Route verified | Production revision `9b6b35f`; pin `gpt-5.4-2026-03-05`; marker matched; exact resolved-model set contained one `gpt-5.4` Workflow transcript |
| OpenAI + Copilot | Workflow verified | Production revision `9b6b35f` passed the exact two-model matrix; the current approved nine-role delivery receipt remains recorded below |
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
| `npm run check` | Passed | `validated helix-cc: 9 workflows, 13 agents, 7 skills` |
| `npm test` | Passed | 140 passed; 0 failed, skipped, or TODO; includes marker-first, partial-line, staggered-matrix, timeout, interruption, and exact-set Workflow-transcript convergence; the packaged six-tool MCP process; production-controller ownership across four provider-readiness and two active-execution stages; isolated red/green ignored/Git/HOME/sibling effects; inherited-process redirect isolation; ignored/no-delta test-path refusal; five-class TDD command-mutation discard; normalized input grammar; four-stop research convergence/equality distance; expected-miss blocker semantics; complete tracked mode/type coverage; rename/index rollback; post-writer remeasurement; v2 final-checkout evidence; fixed RSA signature chunks; and every loop source |
| `claude plugin validate --strict .` | Passed | Claude Code 2.1.214 strict validation |
| Documentation link/command contract | Passed | Current links resolve locally; every provider launch example supplies an explicit model |
| Interrupted provider startup acceptance | Passed | Production revision `c5016f6`: SIGTERM after the first Copilot child spawn and before gateway readiness produced exit 143; every observed PID died, all allocated ports were released, and idle status returned `unreachable` |
| Installed signed-evidence seam | Passed | Production revision `9279094`: v2 receipt signed the exact command delta and final checkout paths; all six RSA chunks survived the agent courier and the child verifier accepted the signature |
| Installed `helix-delivery` headless smoke | Passed | One pass; `approved: true`; evidence verified; both reviews passed; initial HEAD `a7a584e` remained unchanged with exactly three requested unstaged files |
| Installed `helix-implement-review` headless smoke | Passed | One pass; `approved: true`; evidence verified; existing behavioral test changed and passed; initial HEAD `0189325` remained unchanged with four requested unstaged files |
| Installed `helix-tdd-fix` headless smoke | Passed | One reproduction and one fix pass; signed test-only exit-1 red preceded the production change; signed green and final approval passed; initial HEAD `c30fe13` remained unchanged |
| Installed negative input boundary | Passed | Production revision `d52d276`: installed TDD rejected a non-PATH reproduction executable and installed ship rejected `.git/config`; both Workflow results reported zero nested agents and zero nested tool uses |
| Installed `helix-research` headless smoke | Passed | One experiment; typed `payload_bytes` target equaled exactly `4 bytes`; final measurement and exact test receipts verified; `approved: true`; initial HEAD `77a047f` remained unchanged |
| Installed research dead-end acceptance | Passed | Production revision `9ac08b9`; one pass; `approved: true`; `stopReason: dead-end`; signed metric remained 5 bytes against target `<5`; signed and independent tests passed 3/3; fixture HEAD `d70d7ad` and exact fixed payload bytes remained unchanged; delta was exactly RESEARCH, STATUS, and one floor test |
| Installed research plateau acceptance | Passed | Production revision `9ac08b9`; two passes; `approved: false`; `stopReason: diminishing-returns`; deterministic `problems: []`; signed metric remained 10 against target `>100`; signed and independent tests passed 6/6; fixture HEAD `bbab6bf` and all five fixed inputs remained unchanged; delta was exactly RESEARCH, STATUS, and one ledger test |
| Installed `helix-scout` headless smoke | Passed | Both read-only agents completed through the current plugin and returned structured reconnaissance and brief; initial HEAD `ced1eb9` and the working tree remained unchanged |
| Installed `helix-ship-pre-pr` refusal smoke | Passed | With the complete evidence session but `confirmOpenPullRequest: false`, the installed workflow refused on the exact confirmation gate; zero agents started and initial HEAD `ced1eb9` remained clean; no PR was opened |
| OpenAI exact route proof | Passed | Production revision `9b6b35f`; `gpt-5.6-luna`; marker matched; exact resolved-model set contained one transcript; sidecar not reused |
| Copilot exact route proof | Passed | Production revision `9b6b35f`; `copilot/gpt-5.4`; served pin `gpt-5.4-2026-03-05`; marker matched; exact resolved-model set contained one transcript; sidecar not reused |
| OpenAI + Copilot matrix proof | Passed | Production revision `9b6b35f`; requested and exact resolved-model sets matched `gpt-5.4` plus `gpt-5.6-luna` across exactly two transcripts; sidecar not reused |
| Full heterogeneous nine-role workflow | Passed | One pass; `approved: true`; seven `gpt-5.6-luna` and two `gpt-5.4` transcripts; fixture tests and diff check passed |
| Azure exact route proof | Unavailable | Azure CLI and deployment configuration are absent on this machine |

## Deliberate product boundaries

| Boundary | State |
|---|---|
| Deterministic command/file/metric gate | Implemented through an always-loaded capability-limited MCP service plus an internal RSA receipt-verifier workflow; agents only transport signed receipts |
| Pre-PR Git/GitHub effects | Limited to exact task-file staging, one normal commit, one non-force branch push, and one exact open/reused PR; signed live state is re-verified before success |
| Durable cross-process Workflow recovery | Not implemented; Claude `resumeFromRunId` is same-session continuation |
| Deterministic task/configuration consent | Not implemented; skill confirmation is advisory |
| Exact effective per-agent Claude model | Requested and observed where possible; active policy can supersede it |
| Arbitrary Helix workflow compiler | Intentionally not implemented; the plugin ships six audited standalone user loops instead |
| Writer worktree merge choreography | Intentionally omitted; writers are serialized in the selected checkout |
| OpenRouter execution | Deferred and rejected |

Historical analysis, branch cleanup records, and dated provider receipts are
indexed in [`docs/history/`](docs/history/README.md). Current procedures live
only in [`docs/quickstart.md`](docs/quickstart.md).
