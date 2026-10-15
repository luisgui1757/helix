# Agent instructions

Follow [CONTRIBUTING.md](CONTRIBUTING.md) for this repository's rules and checks.

## Never leave work unpushed

Local-only work is invisible to reviewers and lost with the machine. End every
task with the work published:

- Commit to a topic branch and push it before ending the session or handing
  off. Uncommitted edits, local-only commits and stashes are not handoffs.
- Open or update the branch's pull request; use a draft for unfinished work.
  `main` changes only through pull requests and their required checks.
- Discard abandoned work deliberately and say so; do not leave it local.
- If a push or pull request fails, report the branch, the exact error and the
  next step.

Publish only what the repository allows: never credentials, raw agent
transcripts, provider payloads or machine-local state. Pushing does not
authorize merging, releasing or bypassing review gates.
