---
name: helix
description: Deliver a scoped repository change through implementation, real verification, independent review, and correction. Use for feature work or bug fixes that should finish reviewed; not for questions, planning-only work, or review-only requests.
---

# Helix

Make the smallest correct change, prove the requested behavior, and resolve
independent review findings. The user and repository set scope and authority.
The host enforces permissions; these instructions do not.

## Choose the route

Use the current coding tool. Search for `orchestrator_capabilities`, including
deferred or prefixed tools. Make one bounded probe if needed. Inside T3 with
orchestration available, read [T3 orchestration](references/t3.md). Otherwise
use native Codex or Claude Code delegation. Do not install a runtime, configure
adapters, change providers or build a workflow framework.

Honor requested writer/reviewer models and effort through supported settings.
Per-task choices override saved preferences; unspecified choices keep defaults.
Use a configured native reviewer role when available. Do not override its settings
unless requested, silently edit it, or substitute a model to resolve a conflict.
Report unavailable settings and continue only work independent of them. A writer
setting you cannot apply blocks implementation with a substitute writer.
Check native execution records for actual settings; mark unexposed values unverified.

## Establish and implement

Read repository instructions, relevant code, existing changes and prior task
findings. Revalidate open findings; preserve earlier evidence and unrelated work.
State the outcome, allowed changes, short plan and observable acceptance criteria.
Inspect or try a small in-scope experiment to answer discoverable questions. Ask
only about consequential unknowns needed next, not authority already granted.
Clarify unknown scope, contracts or authority before committing to them.

Keep one writer. Normally implement, test and document yourself. For a different
writer requested through T3, use the reference and coordinate without concurrent
edits. For a bug, reproduce the failure, then add a behavioral regression test
that fails before the fix and passes after it. Follow repository requirements.

Record consequential choices in the repository's decision convention or relevant
existing docs. State the problem, real alternatives, choice and reason briefly;
add a cost or reason to revisit when useful. Label provisional choices and inferred
rationale. Skip obvious reversible choices and unchanged requirements. Create one
small decision file only when no existing location fits; link evidence, don't copy it.
Keep blockers in reports, not decision entries.

## Verify

Run relevant checks and the repository's required gate. If none exists, choose
meaningful checks and report that absence. Exercise the installed command or user
journey where practical; unit tests alone do not establish it. Capture exact
commands, output, failures and gaps. Never weaken a check or invent a pass.

Keep evidence, review briefs, logs and baseline copies inside the task's allowed
write scope, normally its working tree. Sandbox permission does not enlarge that
scope; `/tmp` and `$TMPDIR` are not implicit exceptions, even for deleted files.
Give delegates the same boundary and readable evidence paths. With no write
authority, pass evidence inline. Name scratch files in the report and review brief;
remove your scratch before finishing after preserving required evidence.

Inspect the full final delta, including staged, unstaged and new files. If a check
changes files, inspect and verify the resulting state. A copy or worktree does not
provide isolation; use the host's actual controls.

Scope each blocker to the work or claim that needs it. An unavailable device,
credential, service or GUI check does not stop other authorized work or source
review. Continue available work and disclose missing proof without asking the user
to waive a workflow rule. After repeated failed
fixes, re-examine the cause; retry only when new evidence supports the approach.
An attempt count alone is not a blocker.

## Independent review

Run available verification, then start one fresh reviewer without the writer's
conversation or private reasoning. Do not ask it to agree. Use T3 when available, otherwise native
delegation with the role/settings above. Apply available read-only restrictions;
a role name, setting or copied directory is not proof of isolation. Report the
reviewer's observed write access, such as shell access or an inherited sandbox.
Mark access unverified only when the host does not expose it; distinguish observed
capability from proven enforcement. Freeze edits during review.

Give the reviewer the task, acceptance criteria, repository rules, baseline,
status and full task delta. Supply a readable diff when its tools cannot get one.
Include captured check output, failures and gaps, not just pass/fail counts.
Ask the reviewer to inspect the files and output rather than accept your summary.
For bug fixes, include actual failing-before and passing-after results. If missing,
reconstruct pre-fix proof in a separate copy within scope, never by reverting the
user's working tree. A file-reading-only reviewer remains usable with this evidence.

Include these requirements in the actual reviewer request:

> Review the full change against the task and repository rules. Inspect surrounding
> code, correctness, regressions, scope, tests and docs. Do not edit or delegate.
> For each finding give severity, location, wrong behavior, evidence and a concrete
> fix. Check an alternative explanation and other occurrences; separate defects
> from uncertainty. Flag unnecessary additions, but retain required behavior.
> Check the full delta, required gate output and actual before/after bug-fix proof.
> Missing evidence the writer can supply is an unresolved finding; request it while
> continuing useful review. Separate this from unavailable checks and their effect
> on confidence. Do not refuse source review because a check cannot run, waive a
> failure or treat an admission of missing proof as proof. Return findings and
> verification gaps separately, or say none were found.

Supply missing evidence you can capture or reconstruct and obtain its review.
Only evidence genuinely unavailable remains a gap. Neither a timeout, a failed
launch nor self-review fulfills independent review.

## Correct and finish

Judge findings against evidence. Fix accepted defects; record rejected findings
with reasons and evidence in the required ledger and final report. After fixes,
rerun affected checks and required gates, then obtain review of the revised state.
T3 needs a new task each round; do not message a completed child to resume it.
Elsewhere resume the reviewer when supported or start fresh with the original
brief, prior findings, revised diff and evidence. Keep one reviewer active.

Continue until findings are resolved or a concrete blocker prevents progress.
No fixed round limit applies. Needing another available review is work to do,
not a reason to hand off. Earlier evidence and approval do not cover later edits.

Use the repository's reporting format. Lead with the outcome, then changes,
verification, review, rejected findings and limitations. Keep the handoff short;
link detailed evidence. Separate local tests, remote CI and unverified behavior.
Include requested and observed role settings when specified, and always report
reviewer write access.

- **COMPLETE:** acceptance criteria met, required checks passed on the final state,
  before/after bug-fix proof exists, and full-delta review has no unresolved findings.
- **READY FOR INDEPENDENT REVIEW:** all required verification passed, but no separate
  reviewer returned a result. Provide a usable brief, evidence and requested settings.
- **BLOCKED:** no useful authorized work remains and required verification is missing
  or failing. Name the affected claim and missing prerequisite or authority. If review
  is also unavailable, include its brief. Missing checks never become passes.

COMPLETE leaves reviewed work in the checkout. Commit, push, PR, merge, release
and deployment need separate authority. Carry them out when the task grants it;
invoking Helix alone does not.
