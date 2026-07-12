# Stage 3H — real revision / diff surface

> **Historical implementation record — not current operational documentation
> (superseded 2026-07-10).** This page preserves what the named stage shipped at
> the time. Some mechanisms may still exist, but cost/no-spend policy, token
> budgets, write allowlists, live enablement, and the referenced live smoke
> commands were later removed; no task-loop live transport ships. Use the
> [current design contracts](design-contracts.md) and [manual](../manual.md) for
> current behavior. Do not treat commands here as runnable unless they also
> appear in those current documents.


Wires the Stage 3G iterating / adversarial debate loop to **real local signals**:
a real working-tree **diff-stability** surface and a real proposal **revision**
boundary, plus a first-class **default-on adversarial policy** with a structural
`/adversarial off` opt-out. Same build boundary as Stage 3B–3G: no subprocesses,
no network, no hosted adapter, no real non-mock model adapter, no live provider
call, no credential reads.

Source of truth:
[`docs/architecture/fusion-dispatch-research.md`](../architecture/fusion-dispatch-research.md)
§"Routing Policy" (*"Convergence means diff stability plus objective-gate pass"*)
and §"Public-Safe Logging", and ROADMAP §7-Theme B / §9-Q2 (adversarial /
multi-team debate is **default-on for meaningful work**; `/adversarial off`
per-task).

## What shipped

| Piece | Responsibility |
| --- | --- |
| `dispatch/lib/git-diff-surface.mjs` | `computeDiffFingerprint(opts)` — a structural, public-safe fingerprint of the real working-tree diff via git plumbing; `makeGitDiffStability(opts)` — a `diffStability` boundary effect backed by it. |
| `dispatch/lib/adversarial-policy.mjs` | `resolveAdversarialPolicy(route, request)` — default-on for meaningful work; records the `/adversarial off` opt-out as a stable code. `MEANINGFUL_WORK_CLASSES`, `ADVERSARIAL_ROLES`. |
| `dispatch/lib/debate.mjs` | Adds the optional injected `revise` boundary between non-converged iterations; records the opt-out code; unchanged Stage 3G behavior when neither is supplied. |
| `tests/dispatch-git-diff-surface.test.mjs` | Real temp-repo diff surface: deterministic hash, changed/untracked diffs, raw-diff non-persistence, git env scrubbing, expanded sensitive-path denials, and the fail-closed matrix (18 test declarations). |
| `tests/dispatch-adversarial-policy.test.mjs` | Default-on classification, explicit opt-out, class/role consistency, no panel widening (7 tests). |
| `tests/dispatch-debate.test.mjs` | +7: real diff + local revision converging across iterations, failed-revision fail-closed with preserved evidence, revision-ref/threading, opt-out recording, Stage-3G-identical no-revise path. |

Dependencies still flow inward. `git-diff-surface.mjs` and the `revise` effect are
**injected** by the caller (exactly like `runGate`), so `debate.mjs` imports neither
git nor the filesystem-mutating revision — it only imports the pure
`adversarial-policy.mjs`. The dispatch core (`orchestrate.mjs`) imports nothing new.

## 1. Real working-tree diff stability

`computeDiffFingerprint({ cwd, baseline = "HEAD", run })` computes a **structural**
fingerprint of the current working-tree change against a baseline commit, using
deterministic git plumbing/CLI, and returns metadata only:

```js
{ ok: true, fingerprint: "sha256:…", baseline_ref: "<commit-hash>",
  changed_files: N, insertions: N, deletions: N, untracked_files: N }
```

- The fingerprint is `sha256` over the tracked patch **plus** the content hash of
  each allowlisted untracked file. The raw patch and file bytes are hashed here and
  **never** returned or persisted; public records carry only hashes, counts, refs,
  and stable codes (spec §"Public-Safe Logging").
- **Untracked-entry safety + real untracked diff stability** (review Findings 1 & 2b).
  Untracked proposal files are part of the diff, so their **content** must be
  reflected in the fingerprint — a metadata-only (`path/size/mode`) signal would miss
  a same-size content edit and falsely report `diff-stable` (false convergence on a
  moving proposal; convergence requires **both** diff-stability and objective-gate-pass
  to be true, so an incorrect diff signal is not acceptable). But blindly reading
  untracked content is unsafe: an untracked symlink could point outside the work tree
  (following it reads bytes outside the repo — a credential/exfiltration vector), and
  reading a sensitive untracked file (`.env`, `auth.json`, key/token files) is itself
  a private-data read. So the policy is **fail-closed by default with an explicit
  opt-in**:
  - symlinks are refused (never followed); non-regular entries (dir/fifo/socket/
    device) are refused; a regular file whose realpath escapes the tree is refused;
  - by default **any** remaining untracked regular file fails the surface closed
    (`untracked-content-refused`) — no content is read;
  - the caller may pass `untracked_policy: { allow: [repo-relative paths] }` to opt
    specific **safe/public/synthetic** files into content hashing; only those exact
    paths are content-read and content-hashed (restoring real diff stability, incl.
    same-size edits);
  - a credential/private-shaped path (`.env*`, `auth.json`, `*.pem`/`*.key`,
    `id_rsa*`, `*secret*`/`*token*`/`*credential*`, …) is **always** refused
    (`unsafe-untracked-sensitive`), even if allowlisted — the denylist wins.
    The denylist includes common OpenSSH private/security-key names such as
    `id_rsa`, `id_ed25519_sk`, and `id_rsa_sk`, plus `.kube/config`,
    `.docker/config.json`, `.pypirc`, and `service-account.json`.

  Tracked changes (the primary proposal medium) stay content-hashed via `git diff`.
- The default git runner pins a clean, config-independent environment (no
  global/system gitconfig bleed), and clears repo-targeting git environment
  variables such as `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`,
  `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_COMMON_DIR`,
  `GIT_NAMESPACE`, and `GIT_CEILING_DIRECTORIES`, so the fingerprint depends on
  the requested tree, not on machine-local diff settings or an injected alternate
  repo surface.
- **Determinism is enforced at the boundary**: the structural snapshot is taken
  twice and any mismatch fails closed, so the debate's determinism guarantee does
  not rest on the caller.

`makeGitDiffStability(opts)` returns a `diffStability(prevRecord, currRecord, ctx)`
checker (the shape `runDebate` injects). It memoizes the fingerprint per
`ctx.run_id` (so the loop's determinism double-probe is idempotent) and compares
the current iteration's fingerprint to the one recorded for `ctx.previous_run_id`:

```
no comparable predecessor  ⇒ { stable:false, code:"diff-baseline" }
fingerprints equal         ⇒ { stable:true,  code:"diff-stable"   }
fingerprints differ        ⇒ { stable:false, code:"diff-changing" }
```

Two observations are required to prove the proposal stopped changing, so the first
iteration is always a baseline (never "stable") — the fail-closed direction.

> **Footgun.** Keep the debate's `record_dir` **outside** the baseline's scope (or
> gitignored). With the default `HEAD` baseline, per-iteration run records written
> into the diffed worktree appear as untracked files, so the fingerprint changes
> every iteration and the debate can never reach `diff-stable`. That is the
> fail-closed direction (never a false convergence), but it is non-obvious — the
> repo's own `dispatch/runs/` is already gitignored, which avoids it.

### Fail-closed posture (diff surface)

| Condition | Code |
| --- | --- |
| cwd missing / not a directory / contains a null byte | `unsafe-path` |
| baseline ref is not a safe token (arg-injection guard) | `unsafe-baseline-ref` |
| cwd is not inside a git work tree | `not-a-git-repo` |
| baseline does not resolve to a commit (e.g. unborn HEAD) | `missing-baseline` |
| unmerged / conflict paths cannot be classified | `index-ambiguous` |
| a git invocation exits non-zero / cannot spawn | `git-command-failed` |
| an untracked entry cannot be `lstat`'d / resolved / read | `diff-read-failed` |
| an untracked entry is a symlink (never followed) | `unsafe-untracked-symlink` |
| an untracked entry is a dir/fifo/socket/device | `unsafe-untracked-nonfile` |
| an untracked regular file resolves outside the tree | `unsafe-untracked-path` |
| an untracked entry is credential/private-shaped | `unsafe-untracked-sensitive` |
| an untracked regular file is not allowlisted (default) | `untracked-content-refused` |
| `untracked_policy` is present but malformed | `invalid-untracked-policy` |
| two back-to-back reads disagree | `diff-nondeterministic` |

A fail-closed fingerprint makes the checker throw its stable code, which `runDebate`
propagates as the debate's fail-closed code.

## 2. Real proposal revision boundary

`runDebate` accepts an **optional** injected `revise` effect:

```js
revise(revisionState | null, ctx) → { ok, revision_ref, code? }   // may be async
// ctx = { iteration, run_id, previous_run_id }
```

- It runs **between non-converged adversarial iterations** (skipped on the final
  iteration — nothing would observe it), producing the next proposal in the
  worktree. It is the **only** thing allowed to mutate the tree; the debate core
  stays pure and dependency direction stays inward.
- Revision state threads between iterations as **refs/hashes only**
  (`revision_ref`), never free text — a non-ref result fails closed
  (`revision-invalid`). Structural revision evidence
  (`{ after_iteration, run_id, revision_ref }`) is surfaced in the result and,
  when a revision ran, in the public-safe debate summary.
- A **failed revision stops fail-closed** (`revision-failed` for `ok !== true` or
  a thrown effect; `revision-invalid` for a non-ref result) and **preserves any
  valid iteration evidence already produced** (the iterations run so far stay in
  the summary). A present-but-non-function effect fails closed
  (`invalid-revision-effect`) before iterating.
- **No free-form failure text is surfaced** (review Finding 2). A thrown revision
  effect's message is never interpolated into the returned `result.detail`,
  `warnings`, or the summary; a returned `rev.code` is surfaced **only** if it is a
  stable-code marker (`^[a-z0-9][a-z0-9._:-]*$`), as `revision-subcode:<code>` —
  otherwise it is dropped. So a private path / raw diff / model text in a revision
  failure can never reach a returned or persisted field.
- Absent ⇒ Stage 3G behavior, byte-for-byte (no `revisions` key is added to the
  summary), so all Stage 3B–3G behavior stays green.

This ships the revision **boundary and its fail-closed threading**. A real,
model-backed builder→critic revision effect needs live provider calls and is out of
scope (see below); the boundary is exercised here with a **local deterministic**
revision effect, never a fake model adapter.

## 3. Default-on adversarial policy

`resolveAdversarialPolicy(route, request)` makes adversarial / multi-team debate
**default-on for meaningful work** — `architecture`, `security`, `risky-change`,
`roadmap-reconciliation`, and `pr-preflight` (`MEANINGFUL_WORK_CLASSES`, which is
exactly the set of routes carrying an adversarial role: `redteam` / `judge` /
`synthesizer`). It returns `{ default_on, opted_out, effective_on, warnings }`.

- **Opt-out** is exposed through the existing structural channel
  `task.override.disable_adversarial` (already validated by the classifier and the
  request schema) — equivalent to `/adversarial off`, with **no new slash command**
  (the `/` command budget stays legible; the repo pins its extensions to
  `helix-fence` + `helix-answer`, so no extension was added).
- A user opt-out on a default-on route is recorded as the stable code
  **`adversarial-opt-out`** (plus `single-pass-route`); a naturally non-adversarial
  route records only `single-pass-route`.
- The policy **never widens a panel**: it only decides whether the default route
  iterates. Every-task or heavier 3+ model runs stay explicit opt-in via request
  candidates + profile caps.

## Objective gate remains final authority

Convergence is still **exactly** diff-stability + objective-gate-pass, both
deterministic checkers. Making the diff signal real does not change that: a real
diff-stable with a failing objective gate never converges, and no model / judge /
verifier / synthesis narrative decides convergence. The verifier stays advisory
(Stage 3E). The aggregate token-budget rail still wins over convergence.

## Out of scope (next slices)

- **Real model-backed revision** — a builder→critic loop that actually revises the
  proposal — **shipped in Stage 3I**
  ([`docs/stage3/model-backed-revision.md`](model-backed-revision.md)): `makeModelRevision`
  builds this `revise` effect. The first live OpenRouter `:free` adapter/proof
  **shipped in Stage 3J**
  ([`docs/stage3/live-builder-adapter.md`](live-builder-adapter.md)).
- Real subprocess / subagent fan-out, parallel judge/synthesis/verifier stages,
  and the hosted `openrouter/fusion` adapter. The chain registry and bounded
  task-loop shipped later in Stage 3L/M/N
  ([`role-matrix-task-loop.md`](role-matrix-task-loop.md)).
- The unattended **autonomous loop** and any aggregate session/daily ceiling
  (Theme J / Phase 4).
- Any UI beyond this minimal policy surface (a live pipeline view, an interactive
  `/adversarial` command).
- Any paid/metered model call. The live OpenRouter `:free` revision proof is
  preflight-gated and limited to synthetic/public fixture input.

## Running

```bash
npm test                              # includes the git-diff-surface, adversarial-policy, and debate tests
node tools/smoke/dispatch-smoke.mjs   # deterministic mock cycles incl. the iterating debate (unchanged)
```
