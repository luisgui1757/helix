# Raw git worktree checklist

Stands in for the future worktree manager (Phase 1). Worktrees are the default for
implementation and multi-agent work; in-place is fine for read-only reviews and
tiny/simple edits (ROADMAP §9-Q1). Until the manager exists, use `git worktree` directly
and own provisioning + prune-on-exit yourself (that lifecycle is where managers rot).

## Create + enter

```sh
# from the primary checkout, on an up-to-date main
git fetch origin
git worktree add ../helix-<short-task> -b <branch-name> origin/main
cd ../helix-<short-task>
```

- [ ] Branch name is clear (e.g. `m0a/<slug>`).
- [ ] Based on up-to-date `origin/main`.

## Provision (manual stand-in for the manager)

- [ ] This repo is **zero-dependency** — no `npm install` needed. If a future change adds
      deps, provision them here.
- [ ] `.env` / local config: **do not** copy secrets between trees; keep provider keys
      machine-local (`../provider-and-egress-posture.md`).
- [ ] `tools/smoke/status.sh` shows the expected branch + worktree.

## Work

- [ ] Keep edits scoped to the task (surgical changes).
- [ ] Update related markdown in the same change (doc discipline).

## Finish + prune-on-exit

```sh
# after the PR is opened/merged from the branch
cd ../helix                      # back to the primary checkout
git worktree remove ../helix-<short-task>
git worktree prune
git worktree list                # verify it is gone
```

- [ ] Worktree removed and pruned (no orphaned trees rot).
- [ ] Temporary branches cleaned up if abandoned.

## Notes

- A worktree isolates the **filesystem**, not the network or `git push` — it is not a
  safety boundary (that is the lockdown boundary, `../lockdown-boundary.md`).
- `--no-worktree` / in-place stays available for read-only reviews and tiny edits.
