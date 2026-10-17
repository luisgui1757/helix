---
name: file-upload
description: Attach relevant screenshots or recordings to an authorized GitHub PR, issue or comment.
---

# File upload

## Use the supported attachment path

1. Confirm the intended artifact and destination. Publication must be within the active task's
   authority. Inspect the image/video before publishing; keep credentials, unrelated personal data
   and private application content out of the evidence. Do not upload a whole working directory.
2. Check the installed command's help for `--attach` and the target host's support. The current
   documented route supports GitHub.com and GitHub Enterprise Cloud. Do not assume an older CLI or a
   different host supports it. Do not upgrade software without task authority.
3. For an existing authorized PR, the documented operation is:

   ```sh
   gh pr edit "$pr_url" --attach "$artifact_path"
   ```

   Here `pr_url` and `artifact_path` must already contain the exact verified destination and file. Omitting a body replacement preserves the existing body and appends the media. To control placement, pass a body file containing the local image reference together with `--attach`; preserve the rest of the PR body. Use descriptive alt text for images.
4. For a new PR or authorized comment, return the validated file and attachment arguments to the
   caller's creation operation. Do not invoke the caller again or create a throwaway issue/comment
   just to host a file. The caller performs the single publication and readback, then reports its
   result.
5. Read back the target. Confirm the attachment exists and the body was preserved; inspect rendering
   when a supported viewer is available. A local path is not a usable public attachment URL.
6. Upload operations can partially succeed while returning an error. Inspect the resulting
   PR/comment and retry only missing artifacts. Never create duplicate PRs or comments just because
   the exit code was nonzero.
7. Return the destination and observed upload/rendering result. If uploading is unsupported, report
   that requirement precisely. Keep the artifact available locally; never claim it is attached.
   User-requested attachments and visual proof required by the task remain outstanding until
   delivered through an authorized supported route. An optional illustration chosen by the agent can
   be omitted with that limitation disclosed.

Command reference: [GitHub CLI PR editing](https://cli.github.com/manual/gh_pr_edit), [PR creation](https://cli.github.com/manual/gh_pr_create), and [CLI release notes](https://github.com/cli/cli/releases). Check installed help at use time; capabilities change.
