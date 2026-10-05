# Evidence and limitations

Snapshot: 2026-10-05. The installed skills are unchanged from `bb4be27`.
Behavioral results below were observed on October 3-4 with Codex CLI 0.160.0
and Claude Code 2.1.286/2.1.289 on macOS. They are samples, not guarantees.

| Area | Observed result and remaining limits | Evidence |
|---|---|---|
| Helix core cases | Delivery, regression/preservation, failed gate and unavailable review ran on both hosts at Helix digest `1a9523d2`. Functional checks and expected stop labels passed; procedure failures are separate below. | [Collection](docs/reviews/2026-10-04-four-skills.md) |
| Procedure adherence | OPEN. Sonnet/low writers supplied incomplete review deltas to Opus/xhigh reviewers. Both reviewers noted missing baseline evidence but reported no material defects; one had the explicit missing-evidence instruction. Writers then reported COMPLETE. Sampled Codex reviewers inspected full diffs. Failure frequency is unknown; host, writer and reviewer tools differed. | [Collection](docs/reviews/2026-10-04-four-skills.md#correction-round-2-procedure-evidence-and-reporting) |
| Saved reviewer settings | Luna/high from Sol/medium and Opus/xhigh from Sonnet/low were observed without dispatch overrides. Codex named-role selection remains unverified. Claude telemetry's `agent:custom` label alone does not identify the role. | [Roles](docs/reviews/2026-10-03-native-role-verification.md), [collection](docs/reviews/2026-10-04-four-skills.md) |
| Setup | Unrelated configuration preserved; repeat setup changed nothing; unsupported effort rejected. Codex project defaults needed a trusted project; a `-c` trust override did not load that layer. Protected edits needed host approval. | [Collection](docs/reviews/2026-10-04-four-skills.md) |
| Unslop | Facts, literals, uncertainty and hostile-draft checks passed on both hosts. | [Collection](docs/reviews/2026-10-04-four-skills.md) |
| Second opinion | Both hosts found the seeded contradiction without file edits; disabled delegation returned NOT RUN. This does not certify a repository audit. | [Collection](docs/reviews/2026-10-04-four-skills.md) |
| Installation | All four skill folders were linked into both hosts and native discovery exercised. | [Collection](docs/reviews/2026-10-04-four-skills.md) |
| Historical comparison | In a 16-run pilot, Helix took 1.86x the time of plain Codex and 6.47x plain Claude Code. No confirmed functional defect was caught. Earlier skill digest `fe376679`, four pairs per host; no new cache or performance claim for this cleanup. | [Comparison](docs/reviews/2026-10-03-comparison.md) |
| Reviewer finds a defect | Dedicated seeded fixture not run. Reviewer-driven corrections occurred in other runs, which do not substitute for it. | [Coverage limits](docs/reviews/2026-10-03-native-role-verification.md), [scenario](evals/scenarios.md) |
| Correction exhaustion | Seeded stop-decision checks passed on earlier digest `fe376679`; a complete exhaustion loop remains untested. | [Roles](docs/reviews/2026-10-03-native-role-verification.md) |
| Other coverage | Coverage is limited to the models, efforts and assignments in the dated records. Other combinations and host versions, interactive sessions, interrupted-session recovery, Windows/WSL and OpenRouter are untested. Azure remains excluded. | [Roles](docs/reviews/2026-10-03-native-role-verification.md), [migration](docs/reviews/2026-10-03-portable-skill.md), [collection](docs/reviews/2026-10-04-four-skills.md) |

The [documentation cleanup record](docs/reviews/2026-10-05-doc-cleanup.md) records
reporting corrections and archive verification. [PR #16](https://github.com/luisgui1757/helix-cc/pull/16)
tracks independent source review, exact-commit CI and the owner's merge decision.
The [archive index](docs/history/README.md) preserves retired-engine evidence.
