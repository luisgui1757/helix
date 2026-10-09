# Evidence and limitations

Snapshot: 2026-10-09. Results apply only to the versions, models and source digests
in the linked records. These are bounded samples, not guarantees or a reliability
rate. This documentation cleanup changes no installed skill or evaluation bytes.

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
| Installation | All four skill folders were linked into both hosts and native discovery exercised. | [Collection][evidence-2026-10-04-four-skills] |
| Historical comparison | In a 16-run pilot, Helix took 1.86x the time of plain Codex and 6.47x plain Claude Code. No confirmed functional defect was caught. Earlier skill digest `fe376679`, four pairs per host; no new cache or performance claim for this cleanup. | [Comparison][evidence-2026-10-03-comparison] |
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
does not resolve the procedure failures above. The maintenance suite has 46 tests.

[Documentation compression](docs/reviews/2026-10-09-content-compression.md) records
this cleanup. The [archive index](docs/history/README.md) preserves all previous
review rounds, including failures, corrections and rejected findings. It also
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
