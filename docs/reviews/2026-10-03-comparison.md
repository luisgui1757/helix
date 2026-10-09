# Plain CLI versus Helix: 2026-10-03

## Decision

Use the plain CLI for small changes with clear requirements when a separate
review is not required. Use Helix when the task warrants independent review.
This pilot found no confirmed functional defect caught by review and a clear
increase in work. It does not establish how review performs on larger changes.
There is no evidence here to justify adding cache machinery to Helix.

All 16 final outputs passed the predeclared acceptance checks. That is a test
result, not proof that all outputs have identical semantics. The preferences
fixture has an ambiguity described below. Two Claude CSV runs also missed a
required Helix step, so this is not an all-green workflow certification.

## Design and evidence

The runner copied the [protocol](../../evals/comparison.md), fixtures, runner and
skill, and recorded their hashes, before the first invocation. Two synthetic tasks, two repetitions, two hosts,
and two workflows produced 16 runs. Order reversed within each host/task pair.
Every trial is retained; none timed out, needed a rerun, or had a usage-accounting
error. No held-out result was returned to an agent, and no output was repaired
by the evaluator. See the [numeric results](../../evals/results/2026-10-03-comparison.json).

- Codex CLI 0.160.0: writer `gpt-6.1-sol / medium`; reviewer `gpt-6-luna / high`.
- Claude Code 2.1.286: writer `claude-sonnet-5-5 / low`; reviewer `claude-opus-5-5 / xhigh`.
- Skill SHA256: `fe376679f30c6e2e917b50fa3ba2781dc1397d6551c8951c7b73cc5cc064e42f`.
- Plain sessions did not load the skill or delegate. All eight Helix sessions
  loaded the installed skill. Four Codex and eight Claude reviewer invocations
  ran at the requested settings. Codex dispatches used `fork_turns="none"` and
  their child records had no forked history. Claude made fresh native Agent
  calls; both migration trials used three fresh reviewers rather than resuming.
- All outputs passed the external gate and the 10 CSV or 14 migration check
  groups. Tests and README changed in every run. Protected files, the original
  commit, staged state and unrelated note contents were preserved.

Parent Codex counters reconcile with CLI output; each linked child's final
cumulative usage is added once. Claude's last session-wide `modelUsage` reconciles
with deduplicated forwarded input counters. Cache writes count within noncached
input. Thinking counts within output. These are token measurements, not API
charges, subscription-quota measurements, or equivalent costs across models.

## Results

Each row below aggregates four runs: both tasks, repeated twice. Cache percentages
are weighted by input tokens. Time includes the writer, reviews and waits, through
CLI exit; external scoring and the review of this report are excluded.

| Host / workflow | Mean seconds | Total input | Noncached input | Output | Cache read share | Acceptance |
|---|---:|---:|---:|---:|---:|---:|
| Codex plain | 89.3 | 419,547 | 93,659 | 8,946 | 77.7% | 4/4 |
| Codex Helix | 166.1 | 1,365,035 | 186,667 | 18,722 | 86.3% | 4/4 |
| Claude plain | 22.6 | 295,889 | 39,871 | 9,910 | 86.5% | 4/4 |
| Claude Helix | 146.5 | 887,295 | 153,567 | 63,902 | 82.7% | 4/4 |

Within Codex, Helix took 1.86x the time, 3.25x the input, 1.99x the noncached
input and 2.09x the output. Within Claude, the same ratios were 6.47x, 3.00x,
3.85x and 6.45x. The token ratios include
the configured reviewer model; they are not price multipliers.

Helix was slower in all eight matched pairs. Its elapsed-time ratios were
2.01x/2.00x for Codex CSV, 1.61x/1.90x for Codex migration, 3.84x/3.63x for Claude
CSV, and 8.39x/7.15x for Claude migration. The last pair of ratios includes two
correction rounds in each Helix trial. The complete per-run record follows.

| Host | Task | Repetition | Workflow | Seconds | Input | Noncached input | Output | Fresh reviews |
|---|---|---:|---|---:|---:|---:|---:|---:|
| codex | csv | 1 | plain | 70.94 | 131,704 | 23,160 | 1,683 | 0 |
| codex | csv | 1 | helix | 142.57 | 341,234 | 53,234 | 3,964 | 1 |
| claude | csv | 1 | helix | 54.16 | 137,547 | 29,653 | 5,429 | 1 |
| claude | csv | 1 | plain | 14.12 | 44,632 | 8,114 | 1,184 | 0 |
| codex | preferences | 1 | helix | 164.64 | 354,864 | 49,456 | 4,687 | 1 |
| codex | preferences | 1 | plain | 102.07 | 88,007 | 23,495 | 2,744 | 0 |
| claude | preferences | 1 | plain | 28.58 | 101,690 | 10,896 | 3,365 | 0 |
| claude | preferences | 1 | helix | 239.73 | 301,033 | 52,357 | 26,845 | 3 |
| codex | csv | 2 | helix | 130.00 | 310,502 | 34,150 | 3,480 | 1 |
| codex | csv | 2 | plain | 65.04 | 89,426 | 24,914 | 1,482 | 0 |
| claude | csv | 2 | plain | 14.13 | 46,109 | 9,242 | 1,856 | 0 |
| claude | csv | 2 | helix | 51.29 | 115,777 | 17,672 | 4,804 | 1 |
| codex | preferences | 2 | plain | 119.23 | 110,410 | 22,090 | 3,037 | 0 |
| codex | preferences | 2 | helix | 226.99 | 358,435 | 49,827 | 6,591 | 1 |
| claude | preferences | 2 | helix | 240.92 | 332,938 | 53,885 | 26,824 | 3 |
| claude | preferences | 2 | plain | 33.71 | 103,458 | 11,619 | 3,505 | 0 |

## What review contributed

**Confirmed functional defects caught: zero in this sample.** The sampled writer
candidate immediately before each of the 12 review dispatches already passed all
held-out checks. Actual reviewer reports were inspected as well; test/doc gaps
and disputed interpretations are not counted as confirmed functional defects.
The runner sampled editable files every 100 ms, so snapshots are not
transactional. The private audit took the last sample at or before each native
dispatch and re-scored its module with `acceptance()`. Every selected snapshot
was stable for at least 1.1 seconds before dispatch; the next observed change,
if any, was at least 71 seconds later.

The Codex reviewers returned no findings. Claude's CSV reviewers suggested extra
edge-case tests, which the writers treated as optional. Claude's migration
reviewers prompted additional tests and clearer error documentation. One migration
run also changed behavior on a disputed input after review; the other preserved
its original interpretation. That change is described below rather than scored
as a proven correction.

### Fixture ambiguity: version 2 records with legacy root keys

Location: [preferences request in fixtures.mjs](../../evals/fixtures.mjs).
The request says to remove legacy root `theme`/`compact` and preserve unknown
root fields, but does not settle how those keys are classified in a version 2
input. The held-out checks do not cover that combination.

After the batch, the evaluator executed `{"version":2,"theme":"dark"}` against
all eight final migration outputs. This diagnostic was not added to the
predeclared acceptance score and was never returned to an agent.

| Outputs | Policy | Count |
|---|---|---:|
| Codex plain and Helix, both repetitions | Delete the root key | 4 |
| Claude plain, both repetitions; Claude Helix repetition 1 | Keep it as unknown data | 3 |
| Claude Helix repetition 2 | Throw `TypeError` | 1 |

The Codex reviewers did not flag deletion. Claude reviewers argued that silent
removal conflicts with the requirement not to reset invalid data, while also
acknowledging the alternate interpretation of the field's ownership. Under that
reading, Codex review may have missed a defect; under the removal reading, it
accepted correct behavior. Keep all three policies uncounted because the
protocol does not settle the rule. The offline reference solution deletes the
key too, but the acceptance checks never asserted that choice.

Both Claude Helix trials used two correction rounds. Repetition 1 changed tests
and README after review while retaining its initial policy. Repetition 2 also
changed the implementation's policy. The ambiguous requirement was discussed in
both runs, but it does not explain all their review work. A follow-up study
should settle this rule before execution and retain this original pilot.
CSV has no such disputed field rule and still showed overhead in both repetitions.

Four pairs per host,
shared provider caches, different workspace paths, service latency and the fixed
reviewer assignments limit generalization. No significance claim or provider
ranking is made.

## Workflow findings

### P2: Claude CSV runs skipped the required pre-fix regression proof

Locations: cases `claude-csv-1-helix` and `claude-csv-2-helix`, native writer
records at events 25 and 26 (zero-based). In both, one Bash command overwrites
`module.mjs`, adds tests and then runs the gate. Its result reports seven passes;
there is no failing pre-fix execution. The first final report explicitly admits
this omission. Both nevertheless declare COMPLETE.

Source of truth: [Helix's bug-fix requirement](../../skills/helix/SKILL.md).
The evaluator searched the complete writer tool trace for another command that
ran a test against the old code and found none. Final correctness
and an externally passing gate do not establish that the writer followed this
step. This is a procedure failure with high confidence, not a claim that the
final CSV implementation is broken. The same issue occurs in both repetitions.

The [earlier review ledger](2026-10-03-native-role-verification.md) already
accepted the explicit red-before-green requirement. Its final regression cases
used the second role assignment, not this Sonnet/low writer. The skill's COMPLETE
paragraph does not repeat the pre-fix requirement. Repetition 1 admits the gap;
repetition 2 reports only that its reviewer could not confirm the pre-fix proof.

For future Helix verification, require the actual failing and passing commands
and results in the review evidence and completion decision. Do not infer them from a final test suite or
COMPLETE. The benchmark does not change the skill or claim this issue fixed.

### P3: Claude reviewers lacked the baseline diff

The initial reviewers in all four Claude Helix cases reported that they could
read final files but could not see the original code/diff. Their configured tools
were Read/Glob/Grep. The skill asks the reviewer to inspect the files and diff
itself, but does not explain how the writer should supply the diff when that
role cannot run Git. The benchmark prompt and reviewer definition also omitted
that instruction. The evaluator had [native-role guidance](../native-roles.md)
to supply the full diff and gate evidence but did not carry it into this setup;
the writer was not given that guide.

This repeats the documentation-only P3 recorded in the
[earlier native-role review](2026-10-03-native-role-verification.md). A separate
review ran, but the setup did not give it complete change evidence. The evaluator
verified repository state separately. That does not fill the reviewer's evidence
gap. Confidence: high from the actual briefs, definitions and review reports.

The fix is to supply the baseline diff in the review brief, or use a host role
with suitable read-only inspection access. Check that it arrived before counting
that review as complete. No product fix is claimed in this comparison.

## Accounting correction and reproducibility

After the batch, the Codex skill-evidence flag was corrected. The original runner
recorded `skillLoaded: false` for all four Codex Helix writers because it
recognized only injected text, and each writer had read SKILL.md with a shell
command. The updated extractor recognizes both, with a regression test.
Replaying it on all eight captured Codex writer sessions separates every Helix
run from every plain run. There are 12 Codex session files including reviewers. Claude's native injected body was checked separately. This changes only an
evidence flag; prompts, fixtures, model calls, measured times and token totals
are unchanged. The JSON records the executed-source hashes and names the exact file covered by
the corrected extractor hash (`post-run-source/evals/compare.mjs` in the private
archive). It also records the private `audit-replay.py` hash. That script derives
Claude's skill flag, fresh-review counts and sampled pre-review acceptance.
The evaluator checked model/effort records, terminal completion claims and
reviewer findings separately; the zero-defect count is an assessed finding count,
not an inference from the acceptance score alone. Original source snapshots and raw results remain in private
artifacts, so the first observation is not overwritten.

The live runner is [compare.mjs](../../evals/compare.mjs); the hashed private audit
and manual evidence assessment produced the additional published fields. Raw logs,
source snapshots, fixture repositories, native records, candidate snapshots and
per-case checks are retained outside Git. Only sanitized metrics and this report
are published. OpenRouter and Azure were not exercised.

## Delivery checks

Local checks passed before independent review: 22 tests, `git diff --check` and
Gitleaks. Native Claude Code Opus 5.5/xhigh applied the injected Cursor unslop
skill, reviewed the frozen change and evidence, and confirmed all published
arithmetic. It found one P2 and three P3 issues. Correction review is pending.
Remote CI and approval remain visible on [PR #16](https://github.com/luisgui1757/helix-cc/pull/16).

## Independent review corrections

| Finding | Resolution |
|---|---|
| P2 ambiguity section omitted six policies | Accepted. Executed the disputed input against all eight outputs after the batch and reported 4 delete / 3 keep / 1 reject; all remain unscored. |
| P3 missing-diff cause assigned only to writer | Accepted. Recorded the incomplete benchmark setup and skill wording, and linked the earlier documentation-only finding. |
| P3 derived-field audit lacked provenance | Accepted. Named and hashed both the extractor and private audit; explained sampled-candidate scoring and manual assessments. |
| P3 private reviewer reports sorted by random ID | Accepted. Ordered them by their first native timestamp; retained the original script and ordering. Published metrics did not change. |

The review also found three runner error paths worth fixing: a failed CLI launch
could leave telemetry open, malformed output could prevent external scoring,
and a search for the word COMPLETE could accept a negative statement. The runner
now closes telemetry after launch failure, preserves gate/acceptance results
when event parsing fails, and checks a positive status at the start of the last
final report. Deterministic process-boundary tests cover startup failure and
truncated output; a separate test covers positive and negative status claims.
These post-run changes did not launch or replace benchmark trials.

The first startup-failure test exposed an OS PATH-search behavior: after a stub's
missing interpreter, process launch fell through to the installed Claude CLI.
That unintended call ran for 24.61 seconds; the test timed out. Its native trace
is retained separately and is excluded from the predeclared 16-run matrix.
The test PATH now contains only the stub and Git. Both failure tests pass without
an agent invocation. This failed test and its correction are retained here.

The evaluator's scoring processes run generated fixture code with its own local
permissions, outside the native agents' sandbox. The output tree also contains
other trials and the oracle source above each workspace. This is not an
adversarial isolation test. Sampled traces show no oracle or cross-trial read;
that audit was not exhaustive. These limits remain explicit, and no isolation
or absence-of-contamination guarantee is claimed.


Correction-round validation: all 25 maintenance tests, `git diff --check` and
Gitleaks pass. The startup and truncated-output regressions were also reproduced
against the original frozen runner in isolated process tests: startup left an
open telemetry server and was killed after two seconds; truncated output threw
before producing acceptance results. Both tests pass on the corrected runner.
The private script changes only the original function's export for observation,
uses a stub-only PATH plus Git, and launches no native agent. Replaying the final
status detector over all 16 saved outputs preserves every published status flag.
The JSON names and hashes this post-review runner separately from the code that
executed the trial matrix.


## Final correction review and handoff

Native Claude Code Opus 5.5/xhigh resumed the same review session and applied
unslop again. It marked all four findings resolved and found no material
regression or publication blocker. Native request records confirm the model
and effort; both review passes had no permission denials and left the repository
fingerprint unchanged. The reviewer checked every model's input/output totals
against the raw result records during the correction pass. It did not execute
tests or hashes. The evaluator ran the checks and verified the artifact digests.

The two observed Helix procedure gaps remain open. Optional follow-up work
includes isolating Git configuration in error-path tests, preserving scores on
telemetry collector failures, and accepting additional terminal-status formats.
The current tests passed with the evaluated local configuration; custom global
Git hooks or commit signing can affect the isolated-PATH failure tests. Replaying
the private audit also requires the recorded repository inputs: its own hash
does not enforce the acceptance-function or skill hashes.

Final local validation: 25 maintenance tests, `git diff --check`, and Gitleaks
passed. Raw evidence is archived privately before the disposable fixture Git
repositories are removed. The comparison is delivered through PR #16; current
remote checks and owner approval remain the PR's source of truth. No merge or
release is claimed.

## October 9 protocol provenance correction

The full-repository audit identified that the current protocol guide's hash no
longer matched the execution hash. The original archive was recovered and its
protocol bytes match the recorded SHA-256 exactly. The only post-run difference
was the final product-description sentence; no experimental rule changed.
The [execution artifact](../../evals/results/2026-10-03-protocol.txt) now preserves
those exact bytes, and the [result receipt](../../evals/results/2026-10-03-comparison.json)
records the later wording change separately. All execution hashes and numeric
results are preserved. A maintenance test checks the artifact against the
execution hash. See the [audit corrections](2026-10-09-audit-corrections.md).
