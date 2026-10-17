---
name: leaving-pr-comments
description: Write an authorized PR comment or review reply with clear agent/model attribution and evidence.
---

# Leaving PR comments

## Attribution for the current user

Begin each comment with a short disclosure such as:

```markdown
> [!NOTE]
> Written by an AI coding agent using MODEL, on behalf of the repository contributor.
```

Use the user's verified name when appropriate. Replace MODEL with the confirmed public name. If it
is unavailable, say the model identity is unverified. Do not infer it from tone, task labels or a
stale codename table. Never present the comment as the human's own words or approval.

## Comment procedure

1. Confirm posting authority, repository, PR and exact thread. Read its latest state and nearby
   discussion before replying. A request to draft or review a comment does not authorize posting it.
2. State the finding's disposition: fixed, disagreed, or deferred. Give concise code, commit or
   verification evidence. Challenge incorrect findings directly; avoid empty agreement and generic
   status updates.
3. A "fixed" reply needs a verified remote commit containing the fix. If it is still local, say so
   and do not claim completion. Never invent test results, reviewer approval or model identity.
4. Reply in the existing thread where supported. Use the current API schema or a body file so line
   breaks and literal text survive correctly. Check for an existing equivalent reply before retrying
   an uncertain post.
5. Resolve a thread only with task/repository authority and a supported disposition. A human request
   for changes remains outstanding until the human or the repository's review process clears it; a
   reply alone is not approval.
6. Read back the published comment and return its URL. Verify any requested thread resolution
   separately. Preserve others' comments; do not edit or delete them without explicit authority.

Use [file-upload](../file-upload/SKILL.md) for authorized visual attachments. This skill does not
authorize merging, closing a PR, requesting arbitrary reviewers or sending unrelated messages.
