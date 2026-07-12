# Contributing

Helix uses `AGENTS.md` as the repository entrypoint and Operating Contract. Read
it before changing code, behavior, architecture, or review artifacts.

## Instruction Sync

`AGENTS.md`, `CLAUDE.md`, and `.github/copilot-instructions.md` are generated
entrypoints carrying the same contract. When the contract changes:

1. Update the source contract through the approved generator/process.
2. Regenerate all three entrypoints together.
3. Do not hand-edit inside the generated contract block.
4. Document any repo-specific convention outside the generated block.

Pi `0.80.3` loads `AGENTS.md` before same-directory `CLAUDE.md`, so
`AGENTS.md` is the active project entrypoint. Keeping the files synced preserves
the contract for other tools.

## APPEND_SYSTEM.md

Do not add `APPEND_SYSTEM.md` for routine discipline. The current Pi evidence
shows context files live in the system prompt and are not compacted away.

Add `APPEND_SYSTEM.md` only if a future Pi update proves context or compaction
drift and the maintainer approves pinning a minimal non-negotiable subset.

## Change Discipline

- Update relevant markdown in the same change as code, behavior, or architecture.
- Keep package audit and package adoption separate.
- Do not run live provider proofs without explicit maintainer approval for the
  named proof.
- Do not merge PRs without maintainer approval.
- Keep Helix's command surface consolidated under one `/helix` slash command
  with verbs unless a future design explicitly justifies a top-level command.

## Publication Discipline

- Treat the legacy repository as a permanently private archive. Do
  not change its visibility or use it as the publishing remote.
- Publish `helix` only from a fresh single-root history containing the
  reviewed tracked snapshot. Never mirror or fetch the old object database,
  refs, tags, pull-request refs, commits, or repository-network relationship
  into it. Independently regenerated, byte-identical audited-safe blobs and
  subtrees may have the same content-addressed Git object ids; that expected
  overlap does not make old history reachable.
- Use the maintainer's verified GitHub noreply identity for every public
  candidate commit. Commit messages and repository metadata must not carry
  session links, provenance footers, personal email, or private paths.
- Keep `helix` private until the final independent audit, fresh secret
  scan, and confirmation that prior Claude Code web sessions are Private or
  deleted. Keep the root MIT `LICENSE` and package metadata aligned. Visibility
  changes remain maintainer-owned.

## Branch Protection And CI

The publishing repository's `main` branch must keep requiring:

- pull request before merge
- at least one approving review before merge by default
- required status check: `test`
- enforcement for administrators on the required check and branch-integrity
  controls, with force pushes and deletion disabled

The repository owner `luisgui1757` is the sole ruleset bypass actor and may
override the review requirement **through an existing pull request only** after
the exact head has passed its required audit and `test` check. The bypass must
not permit a direct push: classic protection continues to enforce the required
check, linear history, conversation resolution, and the force-push/deletion
blocks for administrators.

If this setting is removed or the GitHub API cannot update it safely during a
future gap-closure branch, record that in the PR body and have a maintainer apply
the setting in the repository UI before merging.

Repository policy allows GitHub-owned Actions only and requires every action to
be pinned by full SHA. Dependabot checks those pins weekly and groups routine
version updates separately from security updates. The `test` workflow runs
no-live checks only: unit/self-tests, resource checks, docs-truth checks,
no-live egress checks, public-safety diff scan, deterministic
dispatch/revision smokes, static Pi load proof, and `git diff --check`.

## Local Checks

```bash
npm test
npm run check:resources
npm run check:docs-truth
npm run check:no-live-egress
npm run check:public-safety-diff
node tools/smoke/dispatch-smoke.mjs
node tools/smoke/revision-effect-smoke.mjs
node tools/smoke/pi-e2e-load.mjs
node tools/smoke/pi-e2e-load.mjs --runtime-rpc
git diff --check
tools/ship/pr-gate.sh --dry-run
```
