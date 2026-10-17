---
name: file-pr
description: Create or update a pull request for an authorized change, or when a delivery workflow calls for filing the PR.
---

# File PR

## Procedure

File the change that exists, with enough evidence for someone else to review it. The active task
authorizes the repository, branch and publication; this helper does not expand that authority or
merge anything.

1. Confirm the destination repository, intended base and head branch, including forks or stacks.
   Read the PR template and repository contribution rules. Inspect the full diff and status; do not
   include unrelated files, credentials or generated debris.
2. Confirm the change has been verified against its current base. Let an active delivery workflow
   perform any required rebase and re-review. Do not quietly rebase a reviewed patch inside this
   helper. For a standalone filing request with a stale base, report the needed update; do not
   expand filing into an unrequested branch rewrite.
3. Commit only authorized task files and push the task branch when the task permits it. Preserve
   contributor authors and trailers. If pushing fails or the remote head differs, resolve that state
   before filing.
4. Look for an existing PR for this exact source repository/branch and intended target. Update it
   rather than creating a duplicate. If an original contributor PR is being replaced, leave it
   intact and link it. Retain original authors/co-authors and credit their contribution; model
   disclosure does not replace that credit.
5. Write a concise title and body describing the problem and resulting behavior. Follow the
   repository template. Include observed verification, relevant limitations, contributor credit, and
   source PR links. Put a current approved Sol receipt immediately above the model-attribution
   footer, or at the end of the body when no footer is used; never manufacture one.
6. Follow the user's and repository's attribution requirements. Unless they direct otherwise,
   disclose the actual agent/model in a short footer. Never present agent-written text as the
   human's own. Use confirmed names; if the model cannot be verified, say so. Preserve existing
   human content when updating a body.
7. Create or update using a structured API or an exact body file, such as the documented
   `--body-file` option. Set base/head explicitly where ambiguity exists. Preserve an existing draft
   unless readiness and task authority permit promotion. For a new verified change, default to
   ready-for-review unless the user/repository asks for a draft. An incomplete or blocked change
   must not be described as ready.
8. Read back the PR. Confirm URL, base, head SHA, draft status, body and any requested attachments.
   An error after partial creation is not proof nothing was created: inspect before retrying, and
   add only missing attachments.
9. Return those facts to the caller. Full-send/full-stop/takeover continue into
   [babysit-pr](../babysit-pr/SKILL.md). A standalone filing request ends after the verified PR is
   filed; it does not automatically authorize additional development or merging.

Use [file-upload](../file-upload/SKILL.md) when visual evidence helps. Use
[leaving-pr-comments](../leaving-pr-comments/SKILL.md) for any authorized comment. Creating a PR is
not permission to send unrelated messages, assign reviewers arbitrarily, close another PR or change
repository protection.
