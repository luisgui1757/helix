---
name: helix
description: Deliver a scoped repository change through implementation, real verification, independent review, and bounded correction. Use for feature work or bug fixes that should finish reviewed; not for questions, planning-only work, or review-only requests.
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
This skill gives instructions. The host controls execution and permissions.
Repository rules and the user's scope and authorization still apply.

## Establish the task

Read the repository instructions and inspect the relevant code and existing
changes. Identify the requested outcome, allowed changes, and the repository's
verification commands. State a short plan and observable acceptance criteria.
Ask only for information needed to proceed correctly; do not ask again for
authority already granted. Preserve unrelated work.

When continuing a task, read its prior review and correction state before any
edit or reviewer dispatch. A new invocation does not reset its round count.
If two correction rounds are already used and a finding remains, report
**BLOCKED** immediately. Do not treat that finding as new implementation work.

## Implement and verify

Be the single writer. Implement, test, and document the change yourself; these
responsibilities do not require separate agents. For a bug fix, reproduce the
failure and add a behavioral regression test that fails before the fix and
passes after it. Follow repository requirements for other tests and documentation.

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

## Stop when blocked

At any stage, report **BLOCKED** if a required check is unavailable or cannot
pass within the task's scope, two attempts to fix the same problem fail, or
progress needs an outside decision. If the writer or an available reviewer
cannot use the requested settings, report **BLOCKED**.
Give the remaining failure and the next step. Do not start a review after
stopping or silently omit a required check.

## Get an independent review

Start review only after required verification has passed. A requested reviewer
or model does not waive this prerequisite.

Start one fresh reviewer through the host's delegation facility, with no
conversation history inherited from the writer. Preserving host defaults for
model and effort does not mean inheriting context. Use a native reviewer role
the user configured for this purpose when available. Per-task settings take
precedence over saved preferences. If the host cannot apply them without
retaining conflicting role settings, report **BLOCKED**. Do not silently edit
the saved role to make a request work. Preserve defaults for unspecified settings.
Give it the task, acceptance criteria, repository rules, baseline revision,
status, and the full task delta, including staged, unstaged, and new files.
Provide the diff as text or a readable artifact when its tools cannot obtain
one. Include exact verification commands and results, including the failing
test before a bug fix and its passing result afterward. Missing pre-fix proof
is a verification gap; reconstruct it against the original code in a separate
temporary copy outside the working tree before proceeding. Do not revert the
user's working tree to obtain it.
Ask the reviewer to inspect the files and supplied evidence rather than accept
your summary as proof. Keep it read-only and make no
edits while it reviews. Do not pass your private reasoning or ask it to agree.

Use this review brief:

> Review this change against the requested behavior and repository rules.
> Inspect correctness, regressions, scope, tests, and documentation. For each
> finding give severity, location, wrong behavior, evidence, and a concrete fix.
> Check a plausible alternative explanation and other occurrences before
> reporting it. Distinguish verified defects from uncertainty. Do not edit
> files. Check that you have the full task delta, required gate results, and,
> for a bug fix, actual failing-before and passing-after regression results.
> Missing required evidence is an unresolved finding even when the current
> code looks correct. Return findings and verification gaps, or state that
> none were found.

If the reviewer cannot inspect the full delta or required verification evidence,
provide what is missing and obtain its review before finishing.

If the change is verified but a separate reviewer cannot run or return a
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

Allow at most two correction rounds after the initial review. If findings
remain after the second round, report **BLOCKED** with them and the next step.
Do not start a third round or reset the round count.

Report **COMPLETE** only when acceptance criteria are met, required checks passed
on the final state, bug fixes have failing-before and passing-after evidence,
and independent review of the full delta has no unresolved findings. Separate
local verification, remote CI, and unverified behavior. Summarize changes,
commands and results, reviewer outcome, rejected findings with reasons, and
limitations. Include requested and observed role settings when the task specifies
them. Use the repository's handoff format if it has one.

**COMPLETE** leaves a reviewed change in the working tree. Commit, push, PR creation, merge,
release, and deployment are separate actions and are not authorized by invoking
this skill. Carry out a separately authorized handoff under the repository's
rules; do not infer it from **COMPLETE**.
