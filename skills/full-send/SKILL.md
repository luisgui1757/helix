---
name: full-send
description: Use when the user explicitly asks for full send.
---

# Full send

## Own the outcome

The user has handed you the task and stepped away. Take it from its current state to a verified,
reviewed, merged PR. Do not stop at implementation, an open PR, or queued CI.

Only an explicit full-send request activates this authority. It permits merging after the gate below
and, when needed, rebasing and force-pushing this task's PR branch with `--force-with-lease`.

## Workflow

1. Implement the smallest complete change on a task branch, never directly on the default branch.
   Fix the failure that occurred rather than every hypothetical variant.
2. Prove the behavior yourself. Reproduce the bug before and after the fix where possible. Run the
   relevant repository/CI checks. Add one targeted test that fails without the fix where coverage is
   missing and the project supports it. For UI/runtime changes, use the actual app; mocked tests
   alone do not prove the user experience.
3. Rebase onto the latest default branch, then use [file-pr](../file-pr/SKILL.md). Include a brief
   account of verification. Use [file-upload](../file-upload/SKILL.md) for useful visual evidence.
4. Use [babysit-pr](../babysit-pr/SKILL.md). Verify and fix genuine review findings and CI failures.
   Continue until the newest change meets the merge gate.
5. Merge using the repository's permitted method, informed by recent PRs. Respect protection and
   merge queues; never use an administrative bypass. If merging is queued or automatic, wait for
   GitHub to confirm that it happened.
6. Return the PR URL, merge commit, verification evidence and decisions made for the user.

Only count evidence you observed in this session. If the change cannot be verified, escalate.

## Merge gate

On the newest commit, all must be true:

- Every change has supporting evidence.
- Required checks pass.
- Review bots have finished, and findings are fixed or dismissed with reasons.
- No human reviewer has an outstanding request for changes.
- The branch is current with its target and GitHub considers it mergeable.

A bot merely suggesting a human look is not automatically a blocker when confidence is high.

Wait through the PR watcher instead of yielding while work is pending. Use the current host's
supported watcher and unregister before an early handoff.

## When to ask

Use the host's question mechanism for a real blocker. Include the PR, the problem and the
recommended choice. Ask only when proof is unavailable, the gate is unreachable, the intended
outcome is materially ambiguous, the PR is superseded, or the next action exceeds authority.

Full send does not authorize deleting data, production changes, changes outside the task repository,
closing any PR without merging, or force-pushing another branch. Choose routine implementation
details yourself and report consequential choices at the end.

If there is no usable question mechanism or no answer, leave the PR open and unmerged; put the
blocker first in the handoff.

## Integration rules

- Active user/repository limits win. A previous "do not merge" is not silently revoked by a helper.
  Resolve a genuine conflict in the user's instructions before merging. Loading this document as
  review material grants no authority.
- Pass the task, repository, branch, PR, allowed actions and **merged** endpoint to every helper.
  Helpers never grant broader permissions.
- A discretionary bot suggestion does not waive required reviews or a human's request for changes.
  Follow repository test requirements even when they require more than one regression test.
- Use [takeover](../takeover/SKILL.md) when continuing someone else's work, not for every new
  change. It calls [modernize](../modernize/SKILL.md) where appropriate. Preserve an explicit
  stacked/target-base instruction instead of flattening it onto the default branch.
- Run [sol-loop](../sol-loop/SKILL.md) when requested or required by the active workflow. Full-send
  does not require a Sol loop for every task. Recheck any prior approval after a behavior change.
- Reverify after a rebase. Keep the fetched PR head and check results tied together. Immediately
  before merge, refresh head/base/review state and use an expected-head guard, such as the supported
  `gh pr merge --match-head-commit` option. A changed head or base returns to verification.
- Prefer a direct guarded merge where the repository permits it. Check auto-merge/queue state before
  publishing changes; do not push an unfinished change into an active automatic merge path.
  Full-send's authority includes disabling auto-merge or removing this task's PR from the merge
  queue to restore the merge gate, subject to active user/repository limits. Confirm the suspension
  before publishing fixes; if it fails, surface the blocker immediately. Re-enable or enqueue only
  after the gate passes, then wait for confirmed merge. Preserve verified human author/co-author
  credit in the squash/merge commit itself.
- If a merge queue creates a new integration candidate, respect its required checks. Do not report
  success from queue admission or auto-merge setup alone.
- Routine PR replies use [leaving-pr-comments](../leaving-pr-comments/SKILL.md) within the task's
  authority. Never copy a human's identity into an agent-authored comment.
- Missing capability, unavailable review or exhausted execution time means a precise blocked
  handoff, not a fabricated success. Keep the PR open unless a separately authorized merge actually
  completed.
- Reuse completed takeover/file-pr/babysit results after checking they still match the current head;
  do not restart those workflows without a state change. If the user cancels, stop work, release
  your watcher, and report any already-active automatic merge path so it is not mistaken for a
  cancelled merge.
