# Iterative discovery and concise decisions — 2026-10-08

## Scope and requirements

The owner requested implementation of the October 7 consultation: resolve the
next uncertainty through inspection or a small experiment, record consequential
choices briefly, and keep the four-skill collection. No exhaustive interview,
mandatory ADR template or new handoff skill. Existing verification, independent
review and publishing boundaries remain in force.

Decision notes belong in existing documentation where possible. If no location
fits, a small new decision file is within this change's documentation scope.
Inferred historical rationale must not be presented as established fact.

## Evaluation plan

Planned coverage: discovery, existing and absent decision locations, an ordinary
reversible choice, and a consequential missing contract. Completed results and
source evidence follow below.

## Initial fixture correction

The first export fixture's reader guessed array versus newline-separated JSON
from the payload. A single array-valued event is ambiguous under that interface.
The early held-out checks covered objects but missed that boundary. These trials
are retained as diagnostic evidence, not counted as final coverage of the
corrected contract.

The corrected fixture gives the reader an explicit format parameter and states
that events can be objects, arrays or primitives. Both supported formats were
checked independently for empty input, ordinary objects, array-valued events,
primitives and embedded newlines. The held-out assertions were strengthened,
and the affected cases will be repeated. No skill instruction changed in
response to the fixture defect.

The standard skill validator initially failed because system Python lacks
PyYAML. It passed using the existing offline `uv --with pyyaml` cache. No
dependency or environment change was added to this repository.

## Completed native runs

The final selection contains eight fresh disposable repositories, four per
host, with no remote. The fixtures contained synthetic event data and unrelated
staged and unstaged notes. Requests supplied the feature and constraints, not a
decision-note template or the expected answer. Export tasks explicitly asked
the agent to inspect the examples; this is not an A/B measurement of how many
questions the new instructions prevent. The source stayed fixed throughout.

| Case | Codex | Claude Code |
|---|---|---|
| Existing decision document | 7/7 external checks; inspected inputs and appended the format choice with evidence links. | 7/7; appended a short format choice and preserved the existing entry. |
| No decision document | 7/7; created a short entry in `docs/decisions.md`. | 7/7; created a short `DECISIONS.md`. |
| Reversible display helper | 4/4; tests and README updated, no decision file. | 4/4; tests and README updated, no decision file. |
| Missing partner contract | 2/2 preservation assertions; BLOCKED, no encoder or reviewer. Also recorded an explicit deferral, not a selected format. | 2/2; BLOCKED without edits or reviewer. |

The 40 external assertions cover output, append behavior, empty batches,
array-valued events, primitives, escaping and preservation as applicable.
All eight external gates passed on the resulting states; the blocked cases'
gates verify only the unchanged baseline. Native records contain the exact
installed skill body in all eight cases. No unrequested commit, staging,
configuration edit, installation or remote action occurred in these fixtures.

Both hosts left the legacy function unchanged and documented its behavior
without inventing a historical reason for its 12-character limit. Decision
entries were short paragraphs, not a generated template collection. Some
Codex notes additionally preserved the unresolved historical rationale; the
blocked Codex run wrote a deferral note. These samples do not establish that
every run produces only the minimum documentation.

Three superseded trials remain in the local evidence: the original two Codex
export cases passed their five narrower assertions, and the initial Claude
case was stopped after the ambiguous reader was confirmed. Its interrupted
usage counters did not reconcile. None of those three counts toward the eight
selected cases above. The corrected cases passed the stronger seven assertions.

## Roles, source and limits

- macOS; Codex CLI 0.160.0 and Claude Code 2.1.293; Node 24.16.0.
- Codex: Sol 6.1/medium writer, Luna/high reviewer, fresh context. Native turn
  records and dispatch arguments confirmed the requested settings.
- Claude: Sonnet 5.5/low writer, Opus 5.5/xhigh reviewer. Native request metadata
  confirmed the settings, and Agent calls selected `helix-reviewer` without a
  model override. Both blocked cases correctly omitted review.
- The Claude reviewer was the shipped template with literal model/effort values,
  restricted to Read, Glob and Grep. Role SHA-256:
  `1f4ca51d0fd269bd308510d0563535e3809b2dac92eb8b863494357ed968d409`.
- Helix SHA-256:
  `56a1e50e2e3bbccdcd3acf4c5ec72f9945ce3faf89d5f8a03fd8e6aa68706414`.
- Corrected fixture definitions SHA-256:
  `b54e4b3cda84524bec19ce434e9b40f668698e36253c2d8ebda61302337b4cda`.

**OPEN, Medium — review compliance:** the Claude writer again provided
abbreviated gate results rather than captured output. The reversible case also
used a prose delta summary. In the absent-decision-location case, it explicitly
claimed COMPLETE after a final README edit that had not been re-reviewed.
These are continuations of the documented procedure failure, not clean workflow
passes. The final responses were inspected directly; the runner's strict
start-of-response COMPLETE parser misses the variant `Status: COMPLETE`.
No change here claims to fix host adherence through instructions alone.

The affected behavior was exercised through installed skills and native
reviewers. This does not repeat every core scenario on Claude Code 2.1.293,
establish performance or cache effects, or cover Windows, OpenRouter or Azure.
No new planning stage, provider support or handoff skill is claimed.

## Source verification and review

The 41 maintenance tests, standard skill validation, diff check and Gitleaks
passed during implementation. Final source checks and the independent
Opus 5.5/xhigh review receipt are recorded in [PR #18](https://github.com/luisgui1757/helix/pull/18).

## Source-review corrections

The first Opus 5.5/xhigh review inspected commit `947dc95`; native metadata
confirmed both settings on all 26 successful requests. It found two Medium
issues and reporting gaps. The initial DONE assessment above is withdrawn.

**Accepted, Medium — redundant decision entries.** Codex recorded required,
unchanged legacy behavior and a blocked task as decisions. Both absent-location
cases created files even though README could hold the choice. The revised rule
limits entries to consequential choices actually made, excludes unchanged
behavior and blockers, and creates a file only when existing documentation and
the repository convention do not fit. The scenarios now check those boundaries.

**Accepted, Medium — evidence overstatement.** The 40 automated assertions
check code and preservation; documentation content and concision were inspected
manually. Initial fixture rules named possible decision-file paths, and the
task explicitly requested historical rationale. Those cues prevent attributing
the observed behavior to the skill alone. There was no old-skill A/B control.
Fresh runs remove the suggested paths and test whether README suffices.

The first review packet also omitted the actual Claude Agent arguments and
Codex child tool records. Role telemetry alone cannot identify the selected
Claude role, and a writer's report cannot prove a reviewer read the diff.
The follow-up packet will include those task-scoped native records.

Reporting corrections: all three delivered Claude cases above supplied
abbreviated gate evidence. None of the four core scenarios (delivery,
regression/preservation, failed gate, unavailable review) was repeated at
digest `56a1e50e` on either host. Earlier comparison-runner roles and the shipped
role remain distinct. The how-to now points to dated version evidence through
STATUS; publishing and final-report wording no longer overloads “handoff.”

Rejected candidates: the six deliveries did not need further questions; the
two unavailable partner contracts correctly blocked implementation. The export
alternatives were actual format choices rather than padding. Standard validators
passed and the Claude role matched the shipped template with literal settings.

Another task changed the shared checkout during the first source review.
The reviewer had read-only tools; its before/after repository fingerprint
therefore cannot establish an unchanged checkout. Follow-up work and review use
an isolated worktree, leaving the concurrent changes untouched.

## Revised native cases

Eight fresh fixtures used the revised skill and removed the suggested document
paths. Hosts, model assignments and the shipped Claude role remained as above.
The export tasks still explicitly requested historical-rationale documentation;
this is not a controlled measurement of the skill's effect.

| Case | Automated checks, per host | Inspected documentation and outcome |
|---|---|---|
| Existing decision document | 7/7 on each | Both reused the document for the format choice, without a separate unchanged-legacy decision. Claude also put a short review log there rather than in the existing review ledger. |
| No decision document | 7/7 on each | Both put the choice and reason in README. No new document. |
| Reversible display helper | 4/4 on each | No new document. The extra input-boundary check below fails on Claude. |
| Missing partner contract | 2/2 on each | Both returned BLOCKED without edits or review. |

The 40 assertions remain narrow code/preservation checks. Separate file checks
found no new Markdown in any revised case. Manual inspection established the
decision locations, actual alternatives and absence of invented historical
rationale. All resulting gates passed, including unchanged blocked baselines.

The original runner flagged preservation failures in three Codex deliveries
and the Claude absent-document and routine cases because they appended to
`REVIEW.md`. The unhinted fixture allows relevant project documentation; this
existing ledger was not protected by its instructions. The false flags remain
in the raw results. Separate checks confirmed append-only ledger changes,
unchanged protected files, original legacy bytes, HEAD, index and unrelated
staged/unstaged notes. No check or result was silently replaced.

Claude's existing-document case hit the evaluator's 600-second ceiling while
waiting for its fourth reviewer. It passed its seven code checks but did not
complete. The same native session was resumed with the original settings and
a longer evaluator ceiling; a fresh reviewer returned, and all seven checks
passed again on the resulting state. This continuation adds no fresh-case count.
The interrupted state and continuation evidence are retained separately.

**OPEN, Medium — procedure adherence persists.** Revised Claude deliveries
again supplied summarized gate results. The absent-document case supplied
prose descriptions instead of a full diff. The resumed existing-document case
claimed COMPLETE after unreviewed README edits; the routine case did so after
an unreviewed test-title and ledger edit. The existing-document final also
incorrectly said the requested models were not applied: native Agent arguments
and request/response metadata confirm Sonnet 5.5/low and Opus 5.5/xhigh.
Neither that self-report nor a claimed COMPLETE is reliable execution proof.

**OPEN, Medium — requested input range narrowed.** A supplementary check found
that `formatCount(2 ** 53)` throws RangeError in both initial and revised Claude
samples. The task requests non-negative integers, and that value is exactly
representable; the expected label is `9007199254740992 events`. Both Codex samples
return it. A safe-integer guard is a plausible defensive choice but narrows the
stated contract without authorization. The four supplementary executions thus
pass on Codex and fail on Claude. This boundary was missing from the original
40 assertions and is now explicit in the scenario. The remedy for the generated
helper is to preserve the requested range and test this input. No old-skill
control attributes the failure to the new instructions, and no fix is claimed.

Native records contain the exact installed skill body in all eight revised
cases. Codex reviewer tool records show actual diff/file reads and gate runs;
Claude Agent arguments select `helix-reviewer` without model or resume overrides.
Native metadata confirms the same requested model/effort assignments, including
the continuation. Both blocked cases omit reviewers. The follow-up source-review
packet includes those records for both selections; the role-evidence gap in the
first packet is closed.

Revised Helix SHA-256:
`911c845da660ae2008d7057005721fecf6f88100e3014a8cfc540310acef191e`.
The fixture definitions retain digest `b54e4b3c` above; the revised runner,
which supplies the unhinted instructions, has SHA-256
`f5e1ae3054241fbf19799540f45e9baa82b3eb41ac0f0a23eb830184bacfa2ee`.
None of the four core host scenarios was repeated at this digest either.
No general host-certification, cache or performance claim follows from these runs.
Final source checks and Opus review remain linked through PR #18 above.

## Final reporting corrections

Opus reviewed `c08f19e` with 35 verified Opus 5.5/xhigh requests. It found no
correctness defect in the new skill text, but two Low–Medium reporting gaps.
STATUS and README now cover the revised procedure failures as well as the first
selection, including the false claim about model settings.

The revised Claude routine case also appended a `Decision:` line to `REVIEW.md`
choosing `Number.isSafeInteger` over `Number.isInteger` and explicitly calling
the choice reversible. No new file was created, but this still fails the
scenario's instruction to skip reversible decision entries. It also implements
the unauthorized range restriction above. Review noticed the safe-integer
limit in both selections; the corrections reinforced it in docs and tests
rather than restoring the requested range. A ledger entry about a rejected
error-type finding is legitimate; this separate choice was not that entry.
The initial Claude routine case explicitly skipped a decision record.

The final packet now includes actual Claude reviewer returns and the resumed
writer's task-scoped tool records. The continuation's changed fingerprint is
explained by its two README edits after review, not a model-setting change.
Its CLI also added access to the evidence directory and disabled permission
prompts; those evaluation-control changes are separate from the unchanged
model/effort assignment. The source-review follow-up checks these documentation
corrections without changing or rerunning the skill.

The follow-up resolved those findings and identified one further reporting
omission: the revised blocked Claude case also denied using its requested
writer settings. Checking every Claude final report found the same claim in
the initial blocked case ("never exercised"). Native requests confirm
Sonnet 5.5/low writers in both blocked cases; neither ran a reviewer. STATUS
now includes those two false writer-setting claims and the resumed case.
Other reports' statements that settings were unobservable are not equivalent
to denying their use. For precision, the reversible label above is the writer's
own classification, and the skip instruction is in the Helix skill itself.
