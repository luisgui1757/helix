# Evidence and limitations

Snapshot: 2026-10-15. Results apply only to the versions, models and source digests
in the linked records. These are bounded samples, not guarantees or a reliability
rate. The frontend-design import adds one pinned third-party skill and its
collection scenario. The T3 orchestration change edits Helix, setup-helix and
second-opinion; the T3 rows below give its evidence.

| Area | Observed result and remaining limits | Evidence |
|---|---|---|
| Discovery and decision notes | Implemented. Revised cases passed 40 narrow code/preservation assertions; manual inspection found the format choice in existing docs and file checks found no new documents. One Claude case required continuation after an evaluator timeout. Review compliance and an additional input-boundary failure remain separate below; these are not full workflow passes. | [Decision-note evaluation][evidence-2026-10-08-concise-decisions-revised-native-cases] |
| Historical Helix core cases | Rerun on both hosts at digest `71c00d73`: delivery, regression/preservation, failed gate and unavailable review. Functional checks passed where work proceeded; failed gates returned BLOCKED and unavailable reviewers returned READY FOR INDEPENDENT REVIEW. Procedure failures are separate below. | [October 6 runs][evidence-2026-10-06-guided-setup-continued-correction-and-full-review], [earlier runs][evidence-2026-10-04-four-skills] |
| Procedure adherence | OPEN, Medium. October 9 trials still include incomplete handoffs, omitted evidence checks in writer briefs, and reviewer downgrading of available proof. One intermediate Claude delivery falsely reported COMPLETE; the final gate trial stopped with available corrections unreviewed; two final-candidate Claude trials temporarily stashed task code, and one omitted that action from its final report. Later role-based delivery inspected captured proof before closing, but the samples do not establish a reliability rate. Early comparisons used the runner's role; later cases used the shipped role. All delivered Claude cases in both October 8 selections summarized gate evidence; one per selection supplied prose instead of a diff. Three COMPLETE claims followed unreviewed edits: one initial, two revised. The October 8 blocked Claude reports and resumed report, both October 9 blocked unknown-contract Claude writers, and one Second-opinion caller incorrectly denied using requested writer settings; native records confirm them. Codex reviewer records show diff/file reads and gate runs. Failure frequency and the role body's effect are unknown. | [October 9 audit corrections][evidence-2026-10-09-audit-corrections], [October 8 runs][evidence-2026-10-08-concise-decisions-revised-native-cases], [October 6 runs][evidence-2026-10-06-guided-setup-continued-correction-and-full-review], [earlier finding][evidence-2026-10-04-four-skills-correction-round-2-procedure-evidence-and-reporting] |
| Requested input range | OPEN, Medium. Initial and revised Claude count-helper samples reject `2 ** 53`, narrowing the requested non-negative integer domain. Both Codex samples accept it. Revised Claude also recorded a ledger decision that it called reversible. Review did not restore the requested range. This extra boundary was absent from the 40 assertions; no old-skill control establishes a cause. | [Boundary finding][evidence-2026-10-08-concise-decisions-revised-native-cases] |
| Saved reviewer settings | Luna/high from Sol/medium and Opus/xhigh from Sonnet/low were observed without dispatch overrides. Codex named-role selection remains unverified. Claude telemetry's `agent:custom` label alone does not identify the role. | [Roles][evidence-2026-10-03-native-role-verification], [collection][evidence-2026-10-04-four-skills] |
| Setup | Unrelated configuration preserved; repeat setup changed nothing; unsupported effort rejected. Codex project defaults needed a trusted project; a `-c` trust override did not load that layer. Protected edits needed host approval. | [Collection][evidence-2026-10-04-four-skills] |
| Guided setup and discovery | October 6: stable native catalogs (7 Codex, 11 Claude IDs), saves/cancels and unavailable-input/discovery paths. Question controls and effort-question order were not consistently followed. A denied Claude connection can still return host metadata; listings do not prove fresh data or account access. | [Guided setup][evidence-2026-10-06-guided-setup] |
| Unslop | Facts, literals, uncertainty and hostile-draft checks passed on both hosts. | [Collection][evidence-2026-10-04-four-skills] |
| Second opinion | Both hosts found the seeded contradiction without file edits; disabled delegation returned NOT RUN. This does not certify a repository audit. | [Collection][evidence-2026-10-04-four-skills] |
| Frontend design | Anthropic's unmodified, Apache-licensed skill with a pinned source and bundled license; upstream was unchanged when rechecked on 2026-10-15. One Claude Opus 5.5 trial, given the checkout file directly, produced a self-contained library page that passed 12 structural/content checks and initial-viewport Firefox desktop/mobile rendering; it disclosed invented details in its response, not in the page. Native invocation later discovered the installed skill in both CLIs; Codex recorded a complete skill-file read, while Claude's export does not expose the injected text. A first Claude native trial ran in safe mode, which disables custom skills, and failed discovery. On 2026-10-15 the installed skill ran the collection scenario on both hosts: both pages passed 22 external checks, including in-page demo labeling, and rendered at desktop and 390px widths; Claude's page showed one typographic defect, and complete skill loading was observed only for Codex. Observed keyboard focus, screen-reader use, the combined Helix/design workflow and aesthetic reliability remain unverified. | [Import record](docs/reviews/2026-10-13-frontend-design.md) |
| T3 orchestration | Optional path in Helix, setup-helix and second-opinion, used only when T3's orchestration tools are present: the 0.0.46 line has them, stable 0.0.45 does not. Source-checked on 2026-10-15 against nightly `5a4e998` and adapted for deferred tools, shared isolation, inherited runtime modes and catalog filters. One live Codex writer → Claude reviewer task passed on nightly `6524a8d` before these adaptations; no live V2 run covers the adapted text. Effective effort, enforced read-only review, supervised-mode disclosure and T3 correction rounds remain unverified. | [October 13](docs/reviews/2026-10-13-t3-orchestration.md), [V2 adaptation](docs/reviews/2026-10-15-t3-orchestrator-v2.md) |
| Direct-host regression after T3 changes | On 2026-10-15 the final Helix, second-opinion and setup-helix bytes ran outside T3 on both hosts. Delivery passed 5/5 held-out assertions and completed after independent review on each host. The Codex writer, however, wrote a temporary review brief to `/tmp` and later deleted it, failing the write-scope rule; see Evidence write scope for the correction. Second opinions found the seeded contradiction without edits; bare setup made no edits and asked for every missing choice. Claude checked for T3 tools before native delegation. The Codex reviewer inherited `workspace-write` and its report omitted that enforcement gap. One sample per case. | [V2 adaptation](docs/reviews/2026-10-15-t3-orchestrator-v2.md#direct-host-regression) |
| Evidence write scope | Correction passed bounded reruns; recurrence remains possible. Two Claude core trials once wrote temporary evidence outside the fixture, and on 2026-10-15 a Codex delivery writer wrote a review brief to `/tmp`. After the rule was extended to review briefs and unstated scopes, all four Helix scenarios passed on both hosts with no agent-directed write outside the fixture. The October 13 correction also passed reruns before the Codex failure, and the failing case has one passing sample. Scope is now scored in every Helix scenario; earlier results were scored only for the gate and unavailable-review cases. One sample per case, no causal control; host task-output storage is separate. | [October 13 follow-up](docs/reviews/2026-10-13-t3-orchestration.md#follow-up-keep-temporary-evidence-within-task-scope), [review-brief fix](docs/reviews/2026-10-15-review-brief-scope.md) |
| Enforcement reporting | One trial inferred active sandboxing from configuration. After a narrow correction, a fresh rerun reported enforcement as unverified. | [October 13](docs/reviews/2026-10-13-t3-orchestration.md) |
| Installation | On October 4, all four then-current skill folders were linked into both hosts and native discovery exercised. | [Collection][evidence-2026-10-04-four-skills] |
| Historical comparison | In a 16-run pilot, Helix took 1.86x the time of plain Codex and 6.47x plain Claude Code. No confirmed functional defect was caught. Earlier skill digest `fe376679`, four pairs per host; no new cache or performance claim for the 2026-10-09 cleanup. | [Comparison][evidence-2026-10-03-comparison] |
| Reviewer finds a defect | Ran on both hosts at `71c00d73`: an independent candidate review found the clamp bug, then the installed skill fixed and reviewed it. Claude used the shipped role and also corrected a README error found by its first child reviewer. All 6 external checks passed on each host; Claude's missing gate output remains a procedure gap above. | [Correction cycle][evidence-2026-10-06-guided-setup-reviewer-finding-cycle], [scenario](evals/scenarios.md) |
| Continued correction | DONE: removed the fixed round cap. Old-source runs stopped solely at the seeded count; revised runs on both hosts fixed the remaining bug and dispatched reviewers. Seeded prior rounds and failed attempts are synthetic, not proof those earlier rounds ran. Review compliance remains separate above. | [October 6 runs][evidence-2026-10-06-guided-setup-continued-correction-and-full-review] |
| Other coverage | Coverage is limited to the models, efforts and assignments in the dated records. Setup dialogue was exercised through native protocols; visual terminal widgets and interactive delivery remain untested. Other combinations and host versions, interrupted-session recovery, Windows/WSL and OpenRouter are untested. Azure remains excluded. | [Guided setup][evidence-2026-10-06-guided-setup], [roles][evidence-2026-10-03-native-role-verification], [collection][evidence-2026-10-04-four-skills] |

## Verification blockers and current coverage

Unavailable external checks block their dependent verification or completion
claims, not other authorized work or independent source review. The original
incident, where unavailable desktop automation stopped a source review, was not
rerun. Three early Codex-only fixtures completed fixes and independent source reviews
while the unavailable hardware gate stayed failing. The renewed October 9 core,
combined-unavailable and unknown-contract cases ran on both hosts; gate cases
returned BLOCKED with the required probe still failing. These are forward
observations, not a controlled old/new comparison; the historical core cases do
not certify the newer source.
See the [scoped-blocker record][evidence-2026-10-08-scoped-blockers]
and [audit corrections][evidence-2026-10-09-audit-corrections].

The shared Claude role now requires captured delivery evidence while preserving
Second-opinion consultation scope. Existing saved roles require an explicit
update. Some unavailable-check/review Claude cases did not expose a full skill
read, even when prompted; a catalog listing is not loading proof. Extra falsy-input
diagnostics found behavior changes beyond the original assertions, but the fixture
contract is ambiguous. Both remain coverage limits, not newly scored failures.

Installer regressions and historical protocol provenance were corrected in
[merged PR #19](https://github.com/luisgui1757/helix/pull/19), which superseded #18.
Its source-review and exact-commit check receipts remain there; source approval
does not resolve the procedure failures above. The maintenance suite has 53 tests.

[Documentation compression](docs/reviews/2026-10-09-content-compression.md) records
the 2026-10-09 documentation cleanup. The [archive index](docs/history/README.md)
preserves all previous review rounds, including failures, corrections and
rejected findings. It also
links the earlier overview and explains offline retrieval. Repository review
and merge gates remain unchanged.

[evidence-2026-10-08-concise-decisions-revised-native-cases]: https://github.com/luisgui1757/helix/blob/5f08f557ef7945667dd633c07d83291015f6e8e0/docs/reviews/2026-10-08-concise-decisions.md#revised-native-cases
[evidence-2026-10-06-guided-setup-continued-correction-and-full-review]: https://github.com/luisgui1757/helix/blob/5f08f557ef7945667dd633c07d83291015f6e8e0/docs/reviews/2026-10-06-guided-setup.md#continued-correction-and-full-review
[evidence-2026-10-04-four-skills]: https://github.com/luisgui1757/helix/blob/5f08f557ef7945667dd633c07d83291015f6e8e0/docs/reviews/2026-10-04-four-skills.md
[evidence-2026-10-09-audit-corrections]: https://github.com/luisgui1757/helix/blob/5f08f557ef7945667dd633c07d83291015f6e8e0/docs/reviews/2026-10-09-audit-corrections.md
[evidence-2026-10-04-four-skills-correction-round-2-procedure-evidence-and-reporting]: https://github.com/luisgui1757/helix/blob/5f08f557ef7945667dd633c07d83291015f6e8e0/docs/reviews/2026-10-04-four-skills.md#correction-round-2-procedure-evidence-and-reporting
[evidence-2026-10-03-native-role-verification]: https://github.com/luisgui1757/helix/blob/5f08f557ef7945667dd633c07d83291015f6e8e0/docs/reviews/2026-10-03-native-role-verification.md
[evidence-2026-10-06-guided-setup]: https://github.com/luisgui1757/helix/blob/5f08f557ef7945667dd633c07d83291015f6e8e0/docs/reviews/2026-10-06-guided-setup.md
[evidence-2026-10-03-comparison]: https://github.com/luisgui1757/helix/blob/5f08f557ef7945667dd633c07d83291015f6e8e0/docs/reviews/2026-10-03-comparison.md
[evidence-2026-10-06-guided-setup-reviewer-finding-cycle]: https://github.com/luisgui1757/helix/blob/5f08f557ef7945667dd633c07d83291015f6e8e0/docs/reviews/2026-10-06-guided-setup.md#reviewer-finding-cycle
[evidence-2026-10-08-scoped-blockers]: https://github.com/luisgui1757/helix/blob/5f08f557ef7945667dd633c07d83291015f6e8e0/docs/reviews/2026-10-08-scoped-blockers.md
