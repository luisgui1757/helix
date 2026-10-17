---
name: full-stop
description: Use when the user explicitly asks for full stop as a delivery workflow; not when they tell you to stop working.
---

# Full stop

## Endpoint and authority

Assume the user is not watching the thread. Own the task until the PR is in a state they can merge.
Keep fixing, verifying and reviewing. **Do not merge it yourself.**

On this task's branch, you may commit, push, rebase, resolve conflicts and use `--force-with-lease`.
You may create or update the PR, mark a draft ready for review and keep its description accurate.
Preserve unrelated work and the task's scope.

## How to work

Use the autonomous full-send approach for work the user wants to inspect before merging. Verify
thoroughly, including independent agents or other models where useful. Open the PR, handle CI and
bot/human feedback, and contact the user when genuinely blocked or confident the PR is ready. Never
perform the merge.

## Procedure

The active user and repository rules govern all permissions. A cancellation means stop; it is never
a trigger to keep delivering. Carry a **ready, unmerged** endpoint into every helper.

1. Read the task and current state. Work on a task branch; preserve unrelated edits. For inherited
   work, use [takeover](../takeover/SKILL.md), which calls [modernize](../modernize/SKILL.md). Keep
   the intended target base, including an explicitly stacked branch.
2. Make the smallest complete change. Check the actual behavior, not just whether code compiles. For
   a bug, reproduce it and rerun the same path after the fix where practical. Run the relevant
   repository checks and required regression tests; inspect UI/runtime changes in the real app. Keep
   documentation in sync.
3. Independently review meaningful behavior changes. Use [sol-loop](../sol-loop/SKILL.md) by
   default; honor an explicitly requested reviewer instead. If that reviewer cannot run, do not
   substitute one or claim review passed. Complete permitted independent local work and
   verification, then report the missing review as the blocker. Preserve sol-loop's
   no-push-before-agreement rule: a first-time task may deliberately stop before any PR exists;
   prepare its body locally rather than bypassing required review to publish. Do not add review
   rounds for trivial wording changes. Additional reviewers need a concrete unresolved question and
   must fit the task's delegation authority.
4. Update onto the current target branch using the repository's allowed workflow, resolve conflicts
   and reverify. A behavior change, or uncertainty about equivalence, invalidates the earlier review
   and goes back through it.
5. Use [file-pr](../file-pr/SKILL.md) to create or update the PR with accurate evidence and
   contributor/model attribution. Use [file-upload](../file-upload/SKILL.md) when screenshots or
   recordings materially demonstrate the result. Promote a draft when the work is ready for review,
   unless the user or repository requires it to stay a draft.
6. Use [babysit-pr](../babysit-pr/SKILL.md) until CI and expected bot reviews finish, real findings
   are handled, and the gate below holds. Verify each fix before pushing. The full-stop request
   authorizes routine replies on this PR as part of handling review feedback, subject to active
   user/repository limits; use [leaving-pr-comments](../leaving-pr-comments/SKILL.md). If behavior
   changes, refresh the independent review too.
7. Refresh PR state at handoff. Leave it open and unmerged. Give the user the PR link, exact head,
   verification, review result, remaining judgment calls and the manual merge action. Reach them
   through the host's visible handoff/question mechanism when available.

## Ready-for-user gate

On the current PR head:

- Every behavior change has observed verification; required checks pass.
- The required independent review covers the current behavior diff.
- Expected bots have completed. Their findings have evidence-backed dispositions.
- No human request for changes remains. Repository-required approvals are satisfied for a
  merge-ready claim. Once agent-side work is done, hand off a missing required human approval as
  **ready for human review; approval pending**, instead of waiting indefinitely or claiming merge
  readiness.
- The branch is current with its target, has no conflicts, and the hosting service reports a
  mergeable state. Unknown state is pending, not ready.
- The PR body describes the delivered change and its evidence, without claiming checks that did not
  run.

If repository policy requires a merge queue, report **ready for the user to enqueue** when
pre-enqueue requirements pass. Queue-only integration checks remain unrun and must be named; do not
claim they passed.

## Preserve the no-merge endpoint

- Do not merge, enable auto-merge, enqueue for merging, or call a helper that can do those on your
  behalf. A helper must return control at readiness.
- Check auto-merge/queue state initially and before every push or readiness handoff. If either is
  active, pause publishing branch mutations and surface the conflict; local verification can
  continue. Do not race an automatic merge or change a queue you do not own. Ask for authority to
  disable it, or act on authority already given.
- Closing a PR without merging also requires separate authorization. An obsolete change is a
  decision for the user, not an excuse to close it silently.
- Ask only for an actual blocker or material ambiguity. Routine choices are yours. If required
  evidence, access, review or runtime is unavailable, return a blocked handoff with the exact
  missing action. Silence or no answer never grants permission.
- Keep the host's required progress updates.
