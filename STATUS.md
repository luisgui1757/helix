# Evidence and limitations

Snapshot: 2026-10-09. Helix retains iterative discovery and concise decision notes.
Verification-blocker source corrections are implemented. Renewed evaluations
include successes and retained procedure failures; they do not establish universal
compliance. Final source-review and publication receipts are linked below.
The Claude reviewer template now checks delivery evidence explicitly; second-opinion
consultations retain their existing scope. Second-opinion and Unslop are unchanged. Host versions and source
digests belong to the linked evaluation records; older results do not certify
later versions. These observations are samples, not guarantees.

| Area | Observed result and remaining limits | Evidence |
|---|---|---|
| Discovery and decision notes | Implemented. Revised cases passed 40 narrow code/preservation assertions; manual inspection found the format choice in existing docs and file checks found no new documents. One Claude case required continuation after an evaluator timeout. Review compliance and an additional input-boundary failure remain separate below; these are not full workflow passes. | [Decision-note evaluation](docs/reviews/2026-10-08-concise-decisions.md#revised-native-cases) |
| Historical Helix core cases | Rerun on both hosts at digest `71c00d73`: delivery, regression/preservation, failed gate and unavailable review. Functional checks passed where work proceeded; failed gates returned BLOCKED and unavailable reviewers returned READY FOR INDEPENDENT REVIEW. Procedure failures are separate below. | [October 6 runs](docs/reviews/2026-10-06-guided-setup.md#continued-correction-and-full-review), [earlier runs](docs/reviews/2026-10-04-four-skills.md) |
| Procedure adherence | OPEN, Medium. October 9 trials still include incomplete handoffs, omitted evidence checks in writer briefs, and reviewer downgrading of available proof. One intermediate Claude delivery falsely reported COMPLETE; the final gate trial stopped with available corrections unreviewed; two final-candidate Claude trials temporarily stashed task code, and one omitted that action from its final report. Later role-based delivery inspected captured proof before closing, but the samples do not establish a reliability rate. Early comparisons used the runner's role; later cases used the shipped role. All delivered Claude cases in both October 8 selections summarized gate evidence; one per selection supplied prose instead of a diff. Three COMPLETE claims followed unreviewed edits: one initial, two revised. Both blocked Claude reports and the resumed report incorrectly denied use of requested writer settings; native records confirm them. Codex reviewer records show diff/file reads and gate runs. Failure frequency and the role body's effect are unknown. | [October 9 audit corrections](docs/reviews/2026-10-09-audit-corrections.md), [October 8 runs](docs/reviews/2026-10-08-concise-decisions.md#revised-native-cases), [October 6 runs](docs/reviews/2026-10-06-guided-setup.md#continued-correction-and-full-review), [earlier finding](docs/reviews/2026-10-04-four-skills.md#correction-round-2-procedure-evidence-and-reporting) |
| Requested input range | OPEN, Medium. Initial and revised Claude count-helper samples reject `2 ** 53`, narrowing the requested non-negative integer domain. Both Codex samples accept it. Revised Claude also recorded a ledger decision that it called reversible. Review did not restore the requested range. This extra boundary was absent from the 40 assertions; no old-skill control establishes a cause. | [Boundary finding](docs/reviews/2026-10-08-concise-decisions.md#revised-native-cases) |
| Saved reviewer settings | Luna/high from Sol/medium and Opus/xhigh from Sonnet/low were observed without dispatch overrides. Codex named-role selection remains unverified. Claude telemetry's `agent:custom` label alone does not identify the role. | [Roles](docs/reviews/2026-10-03-native-role-verification.md), [collection](docs/reviews/2026-10-04-four-skills.md) |
| Setup | Unrelated configuration preserved; repeat setup changed nothing; unsupported effort rejected. Codex project defaults needed a trusted project; a `-c` trust override did not load that layer. Protected edits needed host approval. | [Collection](docs/reviews/2026-10-04-four-skills.md) |
| Guided setup and discovery | October 6: stable native catalogs (7 Codex, 11 Claude IDs), saves/cancels and unavailable-input/discovery paths. Question controls and effort-question order were not consistently followed. A denied Claude connection can still return host metadata; listings do not prove fresh data or account access. | [Guided setup](docs/reviews/2026-10-06-guided-setup.md) |
| Unslop | Facts, literals, uncertainty and hostile-draft checks passed on both hosts. | [Collection](docs/reviews/2026-10-04-four-skills.md) |
| Second opinion | Both hosts found the seeded contradiction without file edits; disabled delegation returned NOT RUN. This does not certify a repository audit. | [Collection](docs/reviews/2026-10-04-four-skills.md) |
| Installation | All four skill folders were linked into both hosts and native discovery exercised. | [Collection](docs/reviews/2026-10-04-four-skills.md) |
| Historical comparison | In a 16-run pilot, Helix took 1.86x the time of plain Codex and 6.47x plain Claude Code. No confirmed functional defect was caught. Earlier skill digest `fe376679`, four pairs per host; no new cache or performance claim for this cleanup. | [Comparison](docs/reviews/2026-10-03-comparison.md) |
| Reviewer finds a defect | Ran on both hosts at `71c00d73`: an independent candidate review found the clamp bug, then the installed skill fixed and reviewed it. Claude used the shipped role and also corrected a README error found by its first child reviewer. All 6 external checks passed on each host; Claude's missing gate output remains a procedure gap above. | [Correction cycle](docs/reviews/2026-10-06-guided-setup.md#reviewer-finding-cycle), [scenario](evals/scenarios.md) |
| Continued correction | DONE: removed the fixed round cap. Old-source runs stopped solely at the seeded count; revised runs on both hosts fixed the remaining bug and dispatched reviewers. Seeded prior rounds and failed attempts are synthetic, not proof those earlier rounds ran. Review compliance remains separate above. | [October 6 runs](docs/reviews/2026-10-06-guided-setup.md#continued-correction-and-full-review) |
| Other coverage | Coverage is limited to the models, efforts and assignments in the dated records. Setup dialogue was exercised through native protocols; visual terminal widgets and interactive delivery remain untested. Other combinations and host versions, interrupted-session recovery, Windows/WSL and OpenRouter are untested. Azure remains excluded. | [Guided setup](docs/reviews/2026-10-06-guided-setup.md), [roles](docs/reviews/2026-10-03-native-role-verification.md), [collection](docs/reviews/2026-10-04-four-skills.md) |

The [documentation cleanup record](docs/reviews/2026-10-05-doc-cleanup.md) records
reporting corrections and archive verification. [PR #16](https://github.com/luisgui1757/helix/pull/16)
tracks independent source review, exact-commit CI and the owner's merge decision.
The [archive index](docs/history/README.md) preserves retired-engine evidence.

## Scoped verification blockers — corrected source, bounded evidence

The review sequencing rule now permits independent source review and other
useful work while an external check is unavailable. Missing proof still limits
verification/completion claims; repository and release gates are unchanged.
This targets the reported behavior where unavailable desktop automation stopped
a source review. The original desktop journey was not rerun; fixture trials are
forward observations, not a controlled old/new comparison. Evaluation and review are tracked in
[the correction record](docs/reviews/2026-10-08-scoped-blockers.md).

Three fresh Codex fixtures completed their fixes and independent reviews while
preserving the unavailable hardware gate. The third loaded the final installed
skill after rebasing on the updated parent. Two source-review inconsistencies
were corrected; final independent review and the rebase recheck returned no
material findings at that time. The October 9 Opus audit found evidence and
status ambiguities plus documentation gaps in that committed result. Its
[consolidated corrections and renewed cross-host evaluations](docs/reviews/2026-10-09-audit-corrections.md)
record the current source, native trials and retained failures. The new shared
Claude role requires captured delivery evidence while preserving Second-opinion
consultation scope; existing saved roles require an explicit update. The three
earlier fixtures remain Codex-only evidence; the historical core-case row above
does not certify this newer source.

Installer regressions and protocol provenance are corrected. The current
maintenance suite has 46 tests. Final source-review receipt and published commit
checks are recorded on [PR #19](https://github.com/luisgui1757/helix/pull/19).
PR #19 now combines the decision-note and verification-blocker changes in one
commit targeting main; PR #18 is superseded. Owner review and main-branch
governance gates remain required. The original desktop failure, Windows/WSL and other untested
host/model combinations remain outside this evidence.
