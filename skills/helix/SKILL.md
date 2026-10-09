---
name: helix
description: Deliver a scoped repository change through implementation, real verification, independent review, and correction. Use for feature work or bug fixes that should finish reviewed; not for questions, planning-only work, or review-only requests.
---

# Helix

Make the smallest correct change, verify the requested behavior, get an
independent review, and resolve its findings. If you cannot finish, report
what remains blocked.

Before reporting **COMPLETE**, check the evidence, not just the output: bug-fix
tests failed against the original code and passed against the final code; the
reviewer inspected the full delta; and no required verification is missing.
An admission that a required check was skipped does not satisfy that check.

Use the current coding tool and its native delegation. Do not install a runtime,
change providers, or create a workflow framework. Apply models and reasoning
levels requested for the writer or reviewer through the host's supported
settings. Otherwise keep the host's defaults; do not choose a model or effort
yourself. Do not substitute settings without authorization. Where the host
exposes execution records, check the settings actually used. Label settings
you cannot observe as unverified.
If requested writer settings cannot be applied, report that limitation instead
of implementing with a substitute writer.
This skill gives instructions. The host controls execution and permissions.
Repository rules and the user's scope and authorization still apply.

## Establish the task

Read the repository instructions and inspect the relevant code and existing
changes. Identify the requested outcome, allowed changes, and the repository's
verification commands. State a short plan and observable acceptance criteria.
Ask only for information needed to proceed correctly; do not ask again for
authority already granted. Preserve unrelated work.

Inspect existing behavior or run a small experiment within scope when that
answers better than more questions. Resolve what the next useful step needs;
do not require an exhaustive design first. Clarify consequential unknowns about
scope, contracts or authority before committing to them.

When continuing a task, read its prior findings and verification evidence.
Revalidate open findings against the current state and continue authorized work.
Preserve earlier results and decisions; do not restart the task's history.

## Implement and verify

Be the single writer. Implement, test, and document the change yourself; these
responsibilities do not require separate agents. For a bug fix, reproduce the
failure and add a behavioral regression test that fails before the fix and
passes after it. Follow repository requirements for other tests and documentation.

Record consequential choices made in this task between real alternatives. Keep
each brief: the problem, up to three alternatives, the choice and why. Mention
a cost or reason to revisit when useful. Skip obvious, easily reversible choices.
Report blockers and required or unchanged behavior where requested, not as
decision entries. Mark provisional choices and inferred rationale as such;
link evidence rather than copying it. Use the repository's decision convention
or relevant existing documentation. Create one small decision file only when
neither fits; do not leave a consequential choice only in chat.

Run the relevant checks and any repository-required gate. If the repository
defines no gate, run the checks you identified and report that it has none.
Exercise the requested behavior as a user would, as closely as practical. Unit
tests alone do not show that an installed command or user journey works.
Record exact commands, observed outcomes, and meaningful verification gaps.
Do not weaken checks to obtain a pass or invent a successful result.

Inspect every changed file, including staged changes and new files. Checks
must cover the final content after the last edit, including generated changes.
If a check changes relevant files, inspect those changes and verify that final
state before reporting success. A copied checkout provides no isolation.
Use the host's permissions and sandbox for execution.

## Keep work moving

Scope a blocker to the action or evidence that needs it. An unavailable device,
GUI automation surface, credential, or external service
does not prevent other authorized implementation, checks, or source review.
Run the available checks, fix failures within scope, and give the reviewer exact
results plus the remaining gaps. Review can help diagnose a failing check; it
must not relabel that failure as a pass.

Stop only the dependent action when it needs unavailable input, additional
authority, or a capability the host lacks. Continue useful independent work
without asking the user to waive a workflow rule. Report the concrete limitation
and its effect in ordinary language. Use **BLOCKED** for the whole task only when
no useful authorized work remains. Never weaken a repository or release gate,
fabricate evidence, substitute a requested model, or claim full verification
while a required check is outstanding.

If a fix fails repeatedly, re-examine the diagnosis and use the new evidence to
choose the next step. Do not repeat the same unsuccessful approach without a
reason to expect a different result. An attempt count alone is not a blocker.

## Get an independent review

Run the available verification before review. Missing or failing checks must be
visible in the brief, but do not by themselves prevent a reviewer from examining
the code and existing evidence. Code-review approval and runtime verification
are separate claims; either can remain incomplete without stopping the other.

Start one fresh reviewer through the host's delegation facility, with no
conversation history inherited from the writer. Preserving host defaults for
model and effort does not mean inheriting context. Use a native reviewer role
the user configured for this purpose when available. Per-task settings take
precedence over saved preferences. If the host cannot apply them without
retaining conflicting role settings, report that reviewer as unavailable and
continue work that does not require it. Do not silently edit the saved role to
make a request work. Preserve defaults for unspecified settings.
When using a configured role, omit per-call model and effort overrides unless
the task requests different settings.
Give it the task, acceptance criteria, repository rules, baseline revision,
status, and the full task delta, including staged, unstaged, and new files.
Provide the diff as text or a readable artifact when its tools cannot obtain
one. Include exact verification commands and results, including the failing
test before a bug fix and its passing result afterward. Supply captured command
output as text or readable files; pass/fail counts or a claim that tests passed
are not that evidence. Reconstruct missing pre-fix proof against the original code in a separate
temporary copy when the needed tools and inputs are available. If reconstruction
is unavailable, source review may proceed with that limitation; the evidence
still must exist before claiming the bug fully verified. Do not revert the
user's working tree to obtain it.
Ask the reviewer to inspect the files and supplied evidence rather than accept
your summary as proof. Keep it read-only and make no
edits while it reviews. Do not pass your private reasoning or ask it to agree.

Use this review brief:

Include its evidence checks in the actual reviewer request.

> Review this change against the requested behavior and repository rules.
> Inspect correctness, regressions, scope, tests, and documentation. For each
> finding give severity, location, wrong behavior, evidence, and a concrete fix.
> Check a plausible alternative explanation and other occurrences before
> reporting it. Distinguish verified defects from uncertainty. Do not edit
> files. Check that you have the full task delta, required gate results, and,
> for a bug fix, actual failing-before and passing-after regression results.
> Missing evidence the writer can supply is an unresolved finding; request it
> while continuing the useful review. Distinguish this from checks that cannot
> currently run because their prerequisites are unavailable.
> Separate verified code defects from unavailable checks and their effect on
> confidence. Do not refuse useful source review merely because a check cannot
> run. Missing evidence still limits verification and completion claims. Return
> findings and verification gaps separately, or state that none were found.

If the reviewer lacks the full delta or evidence you can supply, including output
you can capture or reconstruct, provide it and obtain its review before finishing.
Only genuinely unavailable evidence is a verification gap; keep it explicit and
continue the reviewable work. A reviewer
limited to file-reading tools is still available: supply a readable full diff
and captured check output, then continue the review. Missing evidence is work
for the writer to supply, not a reason to hand the task back.

If all required verification passed but a separate reviewer cannot run or return a
result, hand off that brief with the task, evidence, and any requested reviewer
settings. End with **READY FOR INDEPENDENT REVIEW**, including when settings
were requested but no separate reviewer can run. Self-review does not fulfill
this step. A reviewer timeout or failed invocation is not approval.

## Resolve and finish

Assess findings against evidence. Fix accepted findings. A rejected finding
counts as resolved only when the final report gives the evidence for rejecting
it. Record findings and decisions in the repository's review ledger when required.
After a fix, rerun affected checks and required gates, then ask the independent
reviewer to inspect the revised state. If the host cannot resume that reviewer,
start a fresh one with the brief, earlier findings, and revised diff. Use one
reviewer at a time. Evidence and review of an earlier state do not approve later
edits.

Continue correction, verification, and independent review until findings are
resolved or a concrete blocker prevents progress. There is no fixed round limit.
If corrections need another review and it can run, launch it; needing another
round is not a reason to hand off unreviewed edits.
Once no useful authorized work remains, end with **BLOCKED** if required
verification is still missing or failing. State what implementation and review
finished, the affected verification or release claim, and the prerequisite or
authority needed next. If review is also unavailable, include the usable review
brief; **READY FOR INDEPENDENT REVIEW** applies only when all required
verification passed. Neither status turns a missing check into a pass.

Report **COMPLETE** only when acceptance criteria are met, required checks passed
on the final state, bug fixes have failing-before and passing-after evidence,
and independent review of the full delta has no unresolved findings. Separate
local verification, remote CI, and unverified behavior. Summarize changes,
commands and results, reviewer outcome, rejected findings with reasons, and
limitations. Include requested and observed role settings when the task specifies
them. Use the repository's reporting format if it has one.

**COMPLETE** leaves a reviewed change in the working tree. Commit, push, PR creation, merge,
release, and deployment are separate actions and are not authorized by invoking
this skill. Carry out separately authorized Git and publishing actions under
the repository's rules; do not infer authority from **COMPLETE**.
