# Native role verification, 2026-10-03

## Scope and source

The user authorized shipping the Opus prose-review fixes and required live
Codex and Claude Code evaluations that verify subagent models and reasoning
levels. They also requested a final independent Claude Code review with
`claude-opus-5-5` at `xhigh`.

This change starts from `d5376668dab62c23ede61e46b946cdb4ef29c4cb` on PR #16.
The earlier migration ledger remains unchanged. Its eight successful runs
covered the earlier skill digest, not this revision.

## Opus review dispositions

| Finding | Decision and change |
|---|---|
| P2 rejected findings can disappear | Accepted. A rejection resolves a finding only when the final report includes its evidence. |
| P3 stop conditions unclear before review | Accepted. Stops apply at every stage; a blocked task does not start review. |
| P3 repositories without a gate | Accepted as an untested ambiguity, not a demonstrated failure. Run chosen checks and disclose the absence of a gate. |
| P3 reviewer cannot be resumed | Accepted as a portability clarification. Use one reviewer at a time and pass prior findings to a replacement context when required. |
| P3 regression test not explicitly red before fix | Accepted. Require the behavioral test to fail before the fix and pass afterward. |
| P3 repeated install follows an existing directory link | Reproduced with the previous command in a disposable directory. It exited zero and created a nested link. Guard existing files, directories, valid links, and dangling links before installation. |
| P3 contribution requirements unclear | Accepted. All changes to main require a PR; Node runs the tests, while Git and Gitleaks are separate tools. |
| P3 scenario and installation claims unclear | Accepted. Use full scenario names, record each scope, and distinguish discovery from matching installed bytes. |

The prose changes follow the requested unslop review. Dated evidence is not
rewritten. Useful portable engineering requirements remain, even when their
wording could apply to another repository.

The skill also now honors explicitly requested role models and reasoning
levels. It forbids unauthorized substitutions and distinguishes requested
settings from settings visible in execution records.

## Evaluation in progress

The new skill digest is
`56b8384dd1ed65fce21de4f6be6a57060ebe12286a78953b740a262bf31b0b42`.
Results below will be appended after verifying the native records and external
acceptance checks. No new completion claim is made in this initial entry.

## Continuation failure and correction

The first seeded correction-limit decision check failed on Codex with
`gpt-6-luna` at high effort. Its first response acknowledged that both rounds
were consumed, but it then edited the module, tests, and README and dispatched
a `gpt-6.1-sol` reviewer at xhigh. The same fixture on Claude Code stopped
without edits or delegation. This was a synthetic continuation state, not an
execution of the earlier rounds.

The defect is in following the bounded procedure on resumption. The skill now
requires reading prior review state before any edit or reviewer dispatch,
preserving the count across invocations, and immediately stopping when two
rounds are consumed and a finding remains. In particular, an existing finding
must not be reclassified as new implementation work. The original failing
run is retained outside Git; rerun results will be appended separately.

The source correction was made after the violation was observed, while that
failed run was finishing. Its final response is not used as passing evidence
for either digest. The isolated reruns use a fixed source digest throughout.

The focused rerun passed on both hosts: each reported BLOCKED, preserved the
unfinished fixture, and made no edits or reviewer dispatch. The post-correction
skill digest is
`7a1fd9e2533b552df93359521a28a75030c6d567bed5a321bbed62045a686967`.
The full host matrix is being repeated on this digest before final review.


## Evaluation setup findings

The first Codex attempt required a named role from `.codex/agents`. It stopped
before editing because the session reported no named-role selector. This does
not establish that named roles are unsupported across Codex clients. The
successful evaluations instead pass the requested model and effort explicitly
to native subagent creation. Two runner setup attempts also stopped on an
unnecessary empty Git commit; no Codex CLI ran in those attempts. The runner now
commits fixture setup only when its index changes.

The first Claude user-install discovery attempt used `--setting-sources project`,
which excluded user-level skill discovery. Claude explicitly reported that
`/helix` was unavailable; its otherwise-correct implementation and review do
not count as a skill evaluation. The verifier rejected that result. The rerun
loads `user,project` settings with hooks and memory disabled, while retaining
the fixture sandbox and restricted MCP configuration. Project-local skill runs
were unaffected. The earlier discovery claim for the draft digest is likewise
not used as evidence.

The contribution-tool clarification above is more precisely: the maintenance
tests use Node, Git, and a POSIX shell; the secret scan uses Gitleaks separately.

## Final live results

All 18 cases below passed on the post-correction digest above. Hosts were
Codex CLI 0.160.0 and Claude Code 2.1.286, using existing ChatGPT and Claude
subscriptions. The source stayed fixed throughout these runs.

| Profile | Host | Writer, observed | Reviewer, observed |
|---|---|---|---|
| 0 | Codex | `gpt-6.1-sol`, medium | `gpt-6-luna`, high |
| 1 | Codex | `gpt-6-luna`, high | `gpt-6.1-sol`, xhigh |
| 0 | Claude Code | `claude-sonnet-5-5`, low | `claude-opus-5-5`, xhigh |
| 1 | Claude Code | `claude-opus-5-5`, medium | `claude-sonnet-5-5`, high |

| Host | Profile | Scenario | Observed result | Seconds |
|---|---|---|---|---|
| claude | 0 | delivery | COMPLETE | 44.41 |
| codex | 0 | delivery | COMPLETE | 91.64 |
| claude | 0 | user-discovery | COMPLETE | 40.62 |
| codex | 0 | user-discovery | COMPLETE | 98.45 |
| claude | 1 | delivery | COMPLETE | 37.68 |
| codex | 1 | delivery | COMPLETE | 193.21 |
| claude | 1 | failed-gate | BLOCKED | 28.98 |
| codex | 1 | failed-gate | BLOCKED | 53.01 |
| claude | 1 | limit-decision | BLOCKED | 13.16 |
| codex | 1 | limit-decision | BLOCKED | 17.07 |
| claude | 1 | no-gate | COMPLETE | 35.69 |
| codex | 1 | no-gate | COMPLETE | 120.21 |
| claude | 1 | no-review | READY FOR INDEPENDENT REVIEW | 23.6 |
| codex | 1 | no-review | READY FOR INDEPENDENT REVIEW | 56.57 |
| claude | 1 | regression | COMPLETE | 44.46 |
| codex | 1 | regression | COMPLETE | 240.26 |
| claude | 1 | rejection-decision | COMPLETE | 40.55 |
| codex | 1 | rejection-decision | COMPLETE | 223.95 |

The external verifier checked behavior, expected gate outcomes, final status,
Git HEAD and index, protected files, change scope, and preservation of unrelated
staged and unstaged notes. The failed-gate fixtures preserved their required
failing command and stopped without review. The correction-limit fixtures
preserved the known defect and stopped without edits or delegation. Their
behavior assertion deliberately remains red; repairing it would fail the
workflow check. The unavailable-review fixtures completed verification and
returned a review brief without counting self-review as independent review.

Both regression transcripts show a new test failing on the original zero bug,
then passing after the fix. Codex reviewers also raised test-coverage gaps in
delivery, regression, and the rejected-finding case. The writer updated tests,
reran verification, and obtained another independent review. These are actual
review-and-correction executions. The final reviewers reported no unresolved
findings.

Both user-discovery cases had no project-local skill link. Codex read the
installed source; Claude's native initialization listed `helix` and its run
followed the skill. Both installed links resolve to the evaluated source.

### Model evidence

Codex's native parent/child session linkage, explicit spawn arguments, and
resolved per-turn `model` and `effort` match the requested settings. Child
records include actual file inspection and final reviews. The same checks
cover replacement reviewer contexts after corrections.

Claude's native Agent calls identify `helix-reviewer`; child responses are
linked to those calls and report the requested model. Successful API-request
telemetry records the requested writer and reviewer model and effort, including
`xhigh`. A temporary loopback collector kept only selected request metadata;
prompt and tool-content export were disabled. No external telemetry service
was used. The final verifier rejected missing discovery, delegation, settings,
inspection, outcome, or preservation evidence. Configuration alone and agents'
own model statements were not counted as proof.

### Limits

These are fixture evaluations of a model-followed procedure. They do not make
the skill a deterministic scheduler or attest to provider internals. Four of
the 18 cases are seeded decision checks: two use an explicitly synthetic false
review comment, and two resume an explicitly synthetic state with both rounds
consumed. The latter checks the stop decision, not execution of all earlier
rounds or repeated statistical reliability. The initial failure remains in
this record.

Codex named-role file selection was not validated. Claude reviewers could read
files but could not run shell commands; writer execution and external checks
provide the test evidence. OpenRouter-backed sessions and other host/model
versions were not evaluated. Azure remains excluded at the user's request.

The final independent Opus review and publication checks are pending at this
entry. Their results will be appended below.


## Local maintenance checks

Passed before final review: `node --test tests/*.test.mjs` (16 tests),
`git diff --check`, Gitleaks directory scan, and the skill-creator frontmatter
validator. The install tests execute the README commands for each host against
an absent destination, existing file, directory, symlink, and dangling symlink.
They verify that existing content survives and no nested link is created.


## Final Opus review, first pass

Claude Code completed a fresh read-only review using Opus 5.5 at xhigh and the
injected Cursor pstack unslop skill. Native response and successful request
metadata confirm that model and effort. The source fingerprint was unchanged.
It sampled 14 result artifacts and reported no P0-P2 findings, with five P3
findings. A direct read of the pinned plugin and one broad temporary-directory
search were denied by the review tool scope; the injected skill and permitted
evidence remained available. The follow-up grants access to the pinned source.

| Finding | Disposition |
|---|---|
| P3 unspecified models could be selected silently | Accepted. Preserve the host's defaults when no model or effort is requested. Added a no-model-request delivery evaluation on both hosts. |
| P3 read-only Claude role cannot obtain a Git diff or run tests | Accepted. The native-role guide now explains the limit and requires supplied status, full diff, and test output. It distinguishes reading evidence from executing checks. |
| P3 unavailable review with requested settings has two possible statuses | Accepted. Unsupported settings on an available role are BLOCKED; verified work without a reviewer is READY FOR INDEPENDENT REVIEW, including the requested settings in the handoff. Added that combined case on both hosts. |
| P3 result labels and scenario coverage are unclear | Accepted. Mapping and actual correction coverage are recorded below and in STATUS. |
| P3 Claude telemetry does not name the custom reviewer | Accepted. Document `agent:custom` as a generic label; identify the reviewer through the native Agent call and child transcript. |

The reviewer suggested deferring the two skill changes to preserve the earlier
results. Both were implemented instead. The earlier 18 cases remain valid only
for their recorded digest. All 18 are being repeated alongside four new cases
on digest `53075ad34a10ab566840ca7cde2e48d60db14958618429d4be8eeb4e8d44efbe`.

Correction to the contribution row above: maintenance tests need Node, Git,
and a POSIX shell; the secret scan needs Gitleaks. README now calls these
maintenance checks and uses "models and reasoning levels" for the role guide.
The scenario text uses "round count" consistently. Other optional wording
suggestions were not needed to resolve the findings.

| Runner label | Named scenario |
|---|---|
| `delivery` | Delivery; explicit assignments also exercise Role settings |
| `regression` | Regression and preservation |
| `failed-gate` | Failed required gate |
| `no-review` | Review unavailable |
| `no-gate` | No repository gate |
| `rejection-decision` | Rejected finding, using synthetic input |
| `limit-decision` | Correction limit, using synthetic continuation state |
| `user-discovery` | User-level discovery |
| `host-defaults` | Host defaults |
| `no-review-settings` | Requested reviewer unavailable |

The dedicated "Reviewer finds a defect" fixture was not run. In the preceding
matrix, actual Codex reviews raised coverage or documentation findings in
three cases; writers corrected them and obtained fresh re-review. Claude
reviewers found no defects and did not exercise a correction round. Neither
host executed a complete correction-exhaustion loop. These gaps are not hidden
by the total case count.


## Failed-gate precedence failure

The complete verifier rejected the 22-case rerun on digest `53075ad3`:
Codex's Failed required gate case ran its reviewer after `node verify.mjs`
returned 23. The writer explicitly treated the requested reviewer settings as
an instruction to proceed despite the skill's stop condition. It preserved
the gate and reported BLOCKED, but the review dispatch violated the required
stage order. That case is a failure, not a passing blocked outcome. The final
matrix was not published as green.

The skill now states at the review entry point that required verification must
pass first, and that requesting a reviewer or model does not waive that
prerequisite. This clarifies precedence without adding a runtime or another
stage. The next runs use digest `6ffa0419b21384c67e9e133315c0b2770c3d1748d4ce4b81ccb6a9422a6fd895`. Earlier results remain evidence
only for their recorded sources. The default-setting and unavailable-review
cases passed; Claude also executed a genuine correction cycle in user-level
discovery, fixing a weak test and an unsupported README claim before clean
re-review. Those successes do not excuse the failed stage-order case.


## Final source verification

All 24 cases passed on skill digest
`6ffa0419b21384c67e9e133315c0b2770c3d1748d4ce4b81ccb6a9422a6fd895`.
This supplies current-source verification after the failed 22-case attempt. The failed-gate scenario also ran under profile 0, covering both writer models on each host. The same
host versions, subscriptions, four explicit role assignments, preservation
checks, and failure-case expectations apply. Four cases remain synthetic
review-input decisions; the other 20 are functional fixture runs.

| Host | Profile | Scenario | Observed result | Seconds |
|---|---|---|---|---|
| claude | 0 | Delivery / Role settings | COMPLETE | 47.3 |
| codex | 0 | Delivery / Role settings | COMPLETE | 93.01 |
| claude | 0 | Failed required gate | BLOCKED | 11.98 |
| codex | 0 | Failed required gate | BLOCKED | 59.09 |
| claude | 0 | Host defaults | COMPLETE | 27.56 |
| codex | 0 | Host defaults | COMPLETE | 83.63 |
| claude | 0 | Requested reviewer unavailable | READY FOR INDEPENDENT REVIEW | 11.39 |
| codex | 0 | Requested reviewer unavailable | READY FOR INDEPENDENT REVIEW | 62.35 |
| claude | 0 | User-level discovery | COMPLETE | 131.45 |
| codex | 0 | User-level discovery | COMPLETE | 83.24 |
| claude | 1 | Delivery / Role settings | COMPLETE | 44.81 |
| codex | 1 | Delivery / Role settings | COMPLETE | 180.11 |
| claude | 1 | Failed required gate | BLOCKED | 20.13 |
| codex | 1 | Failed required gate | BLOCKED | 60.21 |
| claude | 1 | Correction limit (seeded) | BLOCKED | 11.54 |
| codex | 1 | Correction limit (seeded) | BLOCKED | 22.69 |
| claude | 1 | No repository gate | COMPLETE | 43.22 |
| codex | 1 | No repository gate | COMPLETE | 130.66 |
| claude | 1 | Review unavailable | READY FOR INDEPENDENT REVIEW | 25.62 |
| codex | 1 | Review unavailable | READY FOR INDEPENDENT REVIEW | 49.63 |
| claude | 1 | Regression and preservation | COMPLETE | 53.68 |
| codex | 1 | Regression and preservation | COMPLETE | 212.02 |
| claude | 1 | Rejected finding (seeded) | COMPLETE | 46.52 |
| codex | 1 | Rejected finding (seeded) | COMPLETE | 182.76 |

The two Host defaults tasks contain no model or effort request. Codex passed
no non-null model/effort overrides and its reviewer inherited GPT-6.1 Sol /
medium. Claude's reviewer definition omits those settings, the Agent call
supplies no override, and requests show Sonnet 5.5 / low for writer and reviewer.
The Requested reviewer unavailable cases disabled delegation while retaining
explicit reviewer settings in the task. Both completed verification and
returned READY FOR INDEPENDENT REVIEW with those settings in the handoff.

The verifier now also checks that Codex received the exact evaluated skill
text in its native user-message injection (or read it explicitly), checks the
actual native final answer rather than only the combined message stream, and
requires Claude child file-inspection events and a review response. A null
Codex spawn option means no override, so null fields are accepted in the
defaults check. Earlier attempts to require a shell read or reject a null field
were verifier mistakes, not skill failures; native injection and inherited
turn settings supplied the missing evidence. All 24 outcomes were checked
against native records and independent fixture assertions.

The preceding digest supplied a real Claude correction cycle, closing the earlier Claude coverage gap.
In User-level discovery, the first Opus reviewer found that an ordering test
also accepted last-occurrence order and that the README promised a TypeError
for every non-string input. The writer added a discriminating test and removed
the unsupported promise, reran the gate, and obtained a clean fresh review.
Both Opus review contexts used xhigh in actual request records on that digest; current-source dispatch results are in the matrix above. Codex also performed corrections and fresh re-review in the evaluated runs. The dedicated
pre-planted reviewer-defect fixture remains unrun; real incidental findings
provided correction-cycle evidence on both hosts. Complete exhaustion and
repeat statistical reliability remain untested.

On the current digest, Claude User-level discovery used an initial review
and both permitted correction rounds. The first reviewer identified an ordering
coverage gap. A macOS `sed -i` edit failed to apply; verification still passed
on the unchanged file and the next reviewer kept the finding open. The writer
then applied the edit successfully, reran both checks, and received a clean
third review. This is two correction rounds after the initial review, not a
third correction round. Native records cover all three Opus/xhigh contexts.
The failed edit remains part of the evidence. The final fixture also documents
input-validation behavior beyond the valid string-array inputs; that was not
part of the behavioral contract being certified.

The revised source again passed all 16 maintenance tests, skill validation,
`git diff --check`, and the Gitleaks directory scan. Interactive examples were
not automated verbatim: the evaluations used native non-interactive modes
with explicit fixture permissions. Their evidence covers those modes and
settings, not every possible host configuration. The correction review and
remote head checks are recorded in subsequent entries.


## Correction-review finding: inherited Codex context

Opus rechecked all five P3 findings and confirmed they were fixed. It also
confirmed all four failed-gate reruns and the Claude two-round correction
sequence. Native records show the correction review itself used Opus 5.5 /
xhigh; it completed read-only without permission denials.

It found a P2 in Codex's Host defaults case: null spawn options inherited
conversation context as well as model settings. The raw child session has
`forked_from_id` pointing to the writer and shares four message records with
it. No shared tool-call or reasoning records were found, so this is evidence
of inherited context, not a demonstrated disclosure of private reasoning.
The earlier verifier did not check context creation; its 24-case pass does
not establish the required fresh review on that path.

Accepted. The skill now explicitly requires no writer conversation history,
separately from preserving native model and effort defaults. The verifier will
require explicit no-history Codex dispatch and non-forked child metadata. A
new Bare workflow case also tests Claude without a custom reviewer definition.
The revised digest is `fe376679f30c6e2e917b50fa3ba2781dc1397d6551c8951c7b73cc5cc064e42f`. Results will be appended after reruns and
the second correction review. The earlier records and failures are preserved.

Wording correction to the preceding matrix: Codex sometimes resumed the
existing reviewer after a correction, rather than creating a replacement.
Both are allowed by the skill. "Fresh re-review" in those entries should not
be read as proof that every correction created a new context.


## Verification with fresh reviewer contexts

All 26 cases passed on the revised skill digest
`fe376679f30c6e2e917b50fa3ba2781dc1397d6551c8951c7b73cc5cc064e42f`.
This result supersedes the earlier matrices for current-source verification.
It includes four seeded decision cases and 22 functional fixture runs. The
same host versions, subscription accounts, and four explicit model/effort
assignments apply.

| Host | Profile | Scenario | Observed result | Seconds |
|---|---|---|---|---|
| claude | 0 | Bare workflow | COMPLETE | 45.53 |
| codex | 0 | Bare workflow | COMPLETE | 86.98 |
| claude | 0 | Delivery / Role settings | COMPLETE | 40.95 |
| codex | 0 | Delivery / Role settings | COMPLETE | 99.12 |
| claude | 0 | Failed required gate | BLOCKED | 11.21 |
| codex | 0 | Failed required gate | BLOCKED | 55.84 |
| claude | 0 | Host defaults | COMPLETE | 20.6 |
| codex | 0 | Host defaults | COMPLETE | 88.98 |
| claude | 0 | Requested reviewer unavailable | READY FOR INDEPENDENT REVIEW | 16.12 |
| codex | 0 | Requested reviewer unavailable | READY FOR INDEPENDENT REVIEW | 57.44 |
| claude | 0 | User-level discovery | COMPLETE | 76.96 |
| codex | 0 | User-level discovery | COMPLETE | 95.24 |
| claude | 1 | Delivery / Role settings | COMPLETE | 37.98 |
| codex | 1 | Delivery / Role settings | COMPLETE | 113.01 |
| claude | 1 | Failed required gate | BLOCKED | 20.24 |
| codex | 1 | Failed required gate | BLOCKED | 46.49 |
| claude | 1 | Correction limit (seeded) | BLOCKED | 12.18 |
| codex | 1 | Correction limit (seeded) | BLOCKED | 29.61 |
| claude | 1 | No repository gate | COMPLETE | 39.0 |
| codex | 1 | No repository gate | COMPLETE | 117.73 |
| claude | 1 | Review unavailable | READY FOR INDEPENDENT REVIEW | 26.41 |
| codex | 1 | Review unavailable | READY FOR INDEPENDENT REVIEW | 44.68 |
| claude | 1 | Regression and preservation | COMPLETE | 47.1 |
| codex | 1 | Regression and preservation | COMPLETE | 149.61 |
| claude | 1 | Rejected finding (seeded) | COMPLETE | 42.26 |
| codex | 1 | Rejected finding (seeded) | COMPLETE | 170.16 |

Every Codex review dispatch now explicitly uses `fork_turns: none`, including
Host defaults and Bare workflow. Native child metadata has no `forked_from_id`
and no inherited skill injection. Default cases still supply no model or
reasoning override, and resolved turns show GPT-6.1 Sol / medium. All review
turns, including resumed contexts, match the expected model and effort. The
verifier checks those facts separately from model selection and fixture output.

Claude Bare workflow had no custom reviewer definition or reviewer-settings
prompt. It selected the native read-only Explore role without a model override;
request records show Sonnet 5.5 / low for both writer and reviewers. The role
inspected Git diffs and ran the fixture checks through Bash. Its recorded
commands were read-only, and no edit, write, or delegation tool was used by a
reviewer. This case validates the plain skill path in native print mode. It
does not certify an interactive UI session or every built-in role. The
runner's generic `reviewerRole` metadata field is unused in the bare case;
native calls and the final verifier's `nativeTypes` record the observed role.

The rejection verifier initially required the already-correct module's bytes
to remain unchanged. One Codex run expanded its expression into equivalent
steps, which failed that assertion while preserving the required behavior.
The scenario requires preserving behavior, not byte identity. After inspecting
the diff, the check was corrected to test the prohibited changes directly:
null still throws, and existing trim-capable objects and boxed strings still
normalize without added validation or coercion. Those external checks passed
on both hosts. The refactor is recorded rather than presented as unchanged
source. Protected files and Git-state checks remain byte-sensitive.

The revised source also passed all 16 maintenance tests, skill validation,
diff checking, and Gitleaks. The existing limits remain: four decisions use
synthetic input, the dedicated pre-planted defect fixture and complete
exhaustion loop remain unrun, OpenRouter is untested, and Azure is excluded.
Models follow these instructions; the passing matrix is not deterministic
runtime enforcement or a guarantee of repeated reliability.


## Final independent review and handoff

Claude Code Opus 5.5 / xhigh completed the second correction review using
unslop and reported the P2 resolved, with no remaining material issues. Its
successful request metadata confirms the model and effort. The repository
fingerprint was unchanged throughout review, and no tool permission was
denied. It inspected the fixed default and bare Codex contexts, resumed
reviewers, Claude's bare workflow, the rejection-case diff and behavioral
checks, and the updated documentation. It did not rerun the commands itself.

The final review accepted the rejection verifier's change from byte identity
to behavior checks. It also confirmed that the two Claude Explore reviewer
commands were read-only; the intervening edit belonged to the writer.
STATUS now says specifically that Codex context creation was verified. Claude
freshness follows the native Agent facility; its records have no equivalent
fork field. The optional skill line-wrap change was left alone so the tested
source stayed unchanged.

The source delivered for publication remains
`fe376679f30c6e2e917b50fa3ba2781dc1397d6551c8951c7b73cc5cc064e42f`.
PR #16 is the publication handoff. Its current-head checks, linked from STATUS,
record Linux/macOS maintenance tests, dependency review, and CodeQL. This
entry does not substitute an older commit's CI result for the new head.
GitHub approval and merge remain separate from the native agent review.


It could not read raw Codex sessions, so the earlier `forked_from_id` evidence
was not independently confirmed. The verifier does not check reviewer Bash
commands for writes; the reviewer checked the Bare workflow commands by hand.
It sampled the key cases rather than all 26 final reports.
