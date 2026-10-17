---
name: takeover
description: Continue an existing PR, branch or agent task when the user asks you to take it over.
---

# Takeover

## Continue the intent, preserve the credit

Understand what the previous work was trying to achieve. Read the PR, branch or thread, its reviews
and later corrections from the user. Compare the handoff with the actual current code, commits and
uncommitted changes. The handoff is a lead, not proof.

Do not keep an approach merely because the previous agent chose it. Finish the same intended
behavior with the smallest sensible change.

For a replacement PR, carry the existing commits onto a fresh branch and add your corrections as
distinct commits. Continue in place or use a stack instead when the user asks. Preserve unrelated
work and do not modify the original PR without authorization.

Keep original commit authors and existing co-author trailers. Credit contributors in the PR
description and link the original PR. If squashing, preserve human author/co-author credit in the
squash/merge commit too, using verified identities; never guess an email. Naming the model is not
crediting the people who did the work.

Use [modernize](../modernize/SKILL.md) to align the change with its target base and current
architecture. Keep all intended behavior and surfaces while simplifying; do not add features.
Recheck the source PR before finishing in case it improved while you worked.

Verify the original bug and realistic usage yourself, within repository rules and permissions.
Mocked tests alone do not prove the user experience. Name anything unverified.

When the job includes a PR, use [file-pr](../file-pr/SKILL.md), then
[babysit-pr](../babysit-pr/SKILL.md). Use [leaving-pr-comments](../leaving-pr-comments/SKILL.md) for
replies. Merging or closing the original PR requires authorization.

Report the inherited state, your changes, verification, attribution and remaining decisions.

## Composition and branch safety

- Inherit the caller's endpoint and permissions. With full stop, finish ready and unmerged. With
  full send, return to that skill for its merge gate. Takeover alone grants no merge or closure
  authority.
- When called from full-stop, finish inheritance, modernization and independent local verification,
  then return to full-stop **before** the PR-filing/babysitting step above. Full-stop performs its
  required review before publication; sol-loop publication waits for agreement. Do not publish from
  inside takeover to bypass that ordering.
- Before switching/rebasing, use a clean task worktree or another existing suitable checkout. Never
  stash, discard or absorb unrelated work to make room.
- On a replacement branch, rebase or cherry-pick only the original change's commits onto the
  intended target, retaining authors. Do not import unrelated history or duplicate the same patch
  twice.
- Pass `modernize` the source PR and the actual destination branch. It must not rewrite the source
  contributor's branch while you are building a replacement.
- If the source changed, compare the new delta before incorporating it. Preserve improvements and
  attribution, rerun affected checks, and refresh review for changed behavior.
- A comment, body edit, push or branch rewrite needs the authority of the active task; finding a
  useful action does not expand it.
