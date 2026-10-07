# Evidence and limitations

Snapshot: 2026-10-06. Setup-helix includes guided choices and native model
discovery. Helix now continues corrections without a fixed round limit.
Second-opinion and Unslop are unchanged. The observations use Codex CLI 0.160.0
and Claude Code 2.1.286/2.1.289 on macOS. They are samples, not guarantees.

| Area | Observed result and remaining limits | Evidence |
|---|---|---|
| Helix core cases | Rerun on both hosts at digest `71c00d73`: delivery, regression/preservation, failed gate and unavailable review. Functional checks passed where work proceeded; failed gates returned BLOCKED and unavailable reviewers returned READY FOR INDEPENDENT REVIEW. Procedure failures are separate below. | [Current runs](docs/reviews/2026-10-06-guided-setup.md#continued-correction-and-full-review), [earlier runs](docs/reviews/2026-10-04-four-skills.md) |
| Procedure adherence | OPEN, Medium. With the comparison runner's role, Sonnet/low supplied an incomplete delta to Opus/xhigh and reported COMPLETE. A later shipped-role run supplied a full diff on re-review but omitted captured gate output and still reported COMPLETE. Codex reviewers read full diffs. The clarification did not establish reliable compliance; failure frequency and the role body's effect are unknown. | [Current runs](docs/reviews/2026-10-06-guided-setup.md#continued-correction-and-full-review), [earlier finding](docs/reviews/2026-10-04-four-skills.md#correction-round-2-procedure-evidence-and-reporting) |
| Saved reviewer settings | Luna/high from Sol/medium and Opus/xhigh from Sonnet/low were observed without dispatch overrides. Codex named-role selection remains unverified. Claude telemetry's `agent:custom` label alone does not identify the role. | [Roles](docs/reviews/2026-10-03-native-role-verification.md), [collection](docs/reviews/2026-10-04-four-skills.md) |
| Setup | Unrelated configuration preserved; repeat setup changed nothing; unsupported effort rejected. Codex project defaults needed a trusted project; a `-c` trust override did not load that layer. Protected edits needed host approval. | [Collection](docs/reviews/2026-10-04-four-skills.md) |
| Guided setup and discovery | October 6: stable native catalogs (7 Codex, 11 Claude IDs), saves/cancels and unavailable-input/discovery paths. Question controls and effort-question order were not consistently followed. A denied Claude connection can still return host metadata; listings do not prove fresh data or account access. | [Guided setup](docs/reviews/2026-10-06-guided-setup.md) |
| Unslop | Facts, literals, uncertainty and hostile-draft checks passed on both hosts. | [Collection](docs/reviews/2026-10-04-four-skills.md) |
| Second opinion | Both hosts found the seeded contradiction without file edits; disabled delegation returned NOT RUN. This does not certify a repository audit. | [Collection](docs/reviews/2026-10-04-four-skills.md) |
| Installation | All four skill folders were linked into both hosts and native discovery exercised. | [Collection](docs/reviews/2026-10-04-four-skills.md) |
| Historical comparison | In a 16-run pilot, Helix took 1.86x the time of plain Codex and 6.47x plain Claude Code. No confirmed functional defect was caught. Earlier skill digest `fe376679`, four pairs per host; no new cache or performance claim for this cleanup. | [Comparison](docs/reviews/2026-10-03-comparison.md) |
| Reviewer finds a defect | Ran on both hosts at `71c00d73`: an independent candidate review found the clamp bug, then the installed skill fixed and reviewed it. Claude used the shipped role and also corrected a README error found by its first child reviewer. All 6 external checks passed on each host; Claude's missing gate output remains a procedure gap above. | [Correction cycle](docs/reviews/2026-10-06-guided-setup.md#reviewer-finding-cycle), [scenario](evals/scenarios.md) |
| Continued correction | DONE: removed the fixed round cap. Old-source runs stopped solely at the seeded count; revised runs on both hosts fixed the remaining bug and dispatched reviewers. Seeded prior rounds and failed attempts are synthetic, not proof those earlier rounds ran. Review compliance remains separate above. | [Current runs](docs/reviews/2026-10-06-guided-setup.md#continued-correction-and-full-review) |
| Other coverage | Coverage is limited to the models, efforts and assignments in the dated records. Setup dialogue was exercised through native protocols; visual terminal widgets and interactive delivery remain untested. Other combinations and host versions, interrupted-session recovery, Windows/WSL and OpenRouter are untested. Azure remains excluded. | [Guided setup](docs/reviews/2026-10-06-guided-setup.md), [roles](docs/reviews/2026-10-03-native-role-verification.md), [collection](docs/reviews/2026-10-04-four-skills.md) |

The [documentation cleanup record](docs/reviews/2026-10-05-doc-cleanup.md) records
reporting corrections and archive verification. [PR #16](https://github.com/luisgui1757/helix/pull/16)
tracks independent source review, exact-commit CI and the owner's merge decision.
The [archive index](docs/history/README.md) preserves retired-engine evidence.
