# Content compression, 2026-10-09

The owner requested a shorter repository without losing information or maturity,
including reassessment of README, evaluation results, history and reviews.
Baseline: merged main `5f08f557ef7945667dd633c07d83291015f6e8e0`.

## Decisions and independent assessment

Keep current instructions and limitations in the checkout; archive the nine
completed review rounds together at the baseline revision. Every record is
indexed and byte-identical in Git, including failed trials, exact briefs and
rejected findings. Their relative cross-links resolve within that old tree.
This reduces checkout content, not historical Git storage. Offline archive
access requires the revision locally; source ZIPs do not include it.

Opus 5.5/xhigh independently inspected the baseline through Claude Code 2.1.293.
Native metadata confirmed 21 successful requests at those settings, exit 0 and
no permission denials. It recommended prose cuts while retaining reviews in
place. We accept its requirements to preserve limitations, exact evidence,
installation behavior, evaluation fixtures and skill bytes. We reject its
inference that the owner's request forbids changing the retention policy:
this PR makes that choice explicit without relaxing review or merge gates.
Archiving the whole interlinked set avoids rewriting historical records.

Keep the 29,083-byte numeric result and exact protocol. They contain distinct
data and are inputs to offline accounting/provenance tests. Removing them would
require network or history dependencies, or weaker checks. Keep evaluation
tooling, skills, licenses and governance unchanged. In particular, shorten no
evaluated skill instruction without a separate behavior change and live trials.

Move the installation section to `docs/install.md`, preserving the executable
shell block exactly. The same 16 installer cases read its new location; no test
or assertion is removed. This is a documentation move, not a new installer.
Keep one full documentation index in `docs/README.md` and link it from README.

## Information retained

| Content moved or shortened | Current location |
|---|---|
| Installation, conflicts, repeat runs, copies, updates, host support and official references | [Installation](../install.md) |
| Task choice, discovery, decisions, models, completion labels and authority boundaries | [README](../../README.md), [how-to](../how-to.md) and unchanged skill files |
| Historical trials, exact briefs, source hashes, failures and rejected interpretations | [Archive index and recovery](../history/README.md) |
| Procedure failures, settings misreports, stashes, input-range finding and coverage limits | [STATUS](../../STATUS.md) with direct pinned evidence links |
| Earlier overview, rollout narrative and full surrounding context | Baseline STATUS and source tree linked from the archive index |
| Comparison data and its exact execution protocol | Unchanged `evals/results/` artifacts and tests |

STATUS keeps the historical core cases distinct from the newer scoped-blocker
trials, and preserves the original desktop, Codex-only, saved-role migration,
synthetic-round and host/platform limitations. It adds pointers to the existing
skill-loading and ambiguous falsy-input coverage limits. No failure is closed
or behavioral reliability improvement claimed by this cleanup.

## Verification

Baseline and candidate each passed all 46 tests with `node --test tests/*.test.mjs`.
The staged whitespace check and `gitleaks dir --redact .` passed. Independent
preservation checks verified all nine archived Git blobs against the published
tree, HTTP 200 for every new archive permalink, and exact recovery through
`git archive`. They checked 126 local or pinned links and heading anchors,
including archived cross-links. The install shell block is byte-identical and
all installer assertions are unchanged. Twenty-nine product, evaluation,
governance, license and other test files remain byte-identical to the baseline.

No live behavioral evaluation was rerun: installed skills and evaluation inputs
did not change. Documentation navigation, archive recovery and the documented
installer were exercised instead. Final independent review and exact-commit
hosted checks remain separate from these local results and are recorded on
[PR #20](https://github.com/luisgui1757/helix/pull/20) before handoff. No merge,
release or deployment is part of this task.

## Review corrections

The first full-diff Opus 5.5/xhigh review found three Low reporting gaps and no
blocking or Medium defects. Restored the exact Claude writer/reviewer pairing
in README, the desktop incident and observed gate results in STATUS, and the
October 9 settings misreports alongside the October 8 observations. Also adopted
its suggestions to index future corrections and document Git search of archives.
The engine index now uses the canonical `helix` URL instead of the rename redirect.
These edits change no skill, installer or evaluation behavior.

That review could not read the initial assessment outside its restricted folder.
Its recheck receives that assessment and native receipt, the full baseline,
captured whitespace output, exact-head preservation checks and hosted results
inside its own readable packet. It also receives HTTP checks for the canonical
engine links and an audit of earlier PR evidence links. The final disposition
and execution receipt are published on PR #20 without changing reviewed bytes.

The recheck resolved all three findings but caught two qualifiers dropped by its
suggested desktop wording. STATUS now explicitly retains the early Codex-only
scope and renewed cross-host coverage beyond gate cases. No optional cleanup was
added in this correction.
