# yolo-fence

Keeps Pi's yolo-by-default speed while fencing irreversible / high-blast-radius operations
behind an explicit confirm. Phase-1 keystone (ROADMAP §7-Theme E).

- Extension: `extensions/prime-fence.ts`
- Pure rules: `extensions/lib/fence-rules.mjs`
- Tests: `tests/fence-rules.test.mjs`, `tests/fence-extension.test.mjs`

## What it does (source-verified Pi 0.80.3)

- **`tool_call` handler** (`examples/extensions/permission-gate.ts`, `protected-paths.ts`):
  intercepts the agent's `bash` commands and `write`/`edit` targets. Returns
  `{ block: true, reason }` to block or `undefined` to allow.
- **`user_bash` handler** (`docs/extensions.md`): intercepts the user's `!`/`!!` commands;
  a denied command is replaced with a cancelled, non-zero result.
- **TTY confirm** via `ctx.ui.select` / `ctx.ui.confirm`.
- **Fail closed on `ctx.mode`, not `ctx.hasUI`**: the fence prompts **only** when
  `ctx.mode === "tui"` (a real terminal) and **blocks** in `rpc` / `json` / `print`. This
  is the non-negotiable safety property. Critically, `ctx.hasUI` is **`true` in RPC mode**
  (docs/extensions.md:914, docs/rpc.md:1068), so gating on `!ctx.hasUI` would wrongly allow
  a risky op under `--mode rpc`, where an interactive human is not guaranteed (the client
  can auto-approve and dialogs auto-resolve to `undefined` on timeout).

### Denylist (tunable, `DANGEROUS_COMMAND_RULES`)

`rm -rf`/recursive · `git push --force` (allows `--force-with-lease`) · `git reset --hard`
· `git clean -f` · `git branch -D` · `sudo` · `chmod/chown 777` or recursive · `mkfs` ·
`dd of=/dev/…` · redirects to `/dev/sd|nvme|disk` · fork bomb · `drop database/table/schema`
· `kubectl delete` · `terraform destroy` · `docker system prune`.

Protected write/edit paths (`PROTECTED_PATH_RULES`): `.env*` · `auth.json` · `.ssh/` ·
private keys (`id_rsa`/`id_ed25519`/…) · `.git/` internals · `credentials`/`secrets*` ·
`.netrc`.

## Limits — this is a SPEED BUMP, not containment

A regex denylist over command strings is **evadable** and must be sold as defense-in-depth,
never as a security boundary:

- **Evasion**: heredocs, shell aliases/functions, `$(...)`/backticks, base64/`eval`,
  environment-variable indirection, a wrapper script, `find … -delete`, `xargs rm`,
  `python -c "shutil.rmtree(...)"`, moving files to `/dev/null`, etc. The fence sees a
  string; it cannot understand intent.
- **False positives**: a benign command that merely contains a pattern (e.g. a commit
  message `"fix rm -rf handling"`, or grepping for `sudo`) will prompt. That is the
  intended trade-off — the fence errs toward asking. Tune `fence-rules.mjs` if a specific
  false positive is noisy.
- **Coverage gaps**: only `bash`/`write`/`edit` tool calls and `!` user commands are
  fenced. A custom tool that mutates the filesystem outside these is not covered unless it
  routes through the built-in tools.

## The real boundary (future OS-sandbox path)

Containment must come from the OS / a virtualization boundary, not this regex:

- **Now (proven):** the Level-2 lockdown boundary — Plain Docker `--network none`
  (`docs/m0a/lockdown-boundary.md`, `reviews/m0a/level2-lockdown-smoke-2026-07-04.md`) —
  contains egress structurally.
- **Next (Phase 1+):** route built-in tools into an OS sandbox — macOS Seatbelt
  (`sandbox-exec`) / Linux Landlock/seccomp, or Pi's **Gondolin** micro-VM extension
  (`docs/containerization.md`) — so even an evaded command runs inside a jail. The fence
  then becomes a fast first line in front of a real boundary, which is exactly how it
  should be sold.

## Test proof (no model calls)

- `fence-rules.test.mjs` — the pure classifier: 15 risky commands flagged with the right
  rule id, safe commands allowed (incl. `--force-with-lease`), protected vs normal paths.
- `fence-extension.test.mjs` — the real extension driven by a fake Pi API: destructive bash
  blocked in **every non-tui mode** (`rpc` with `hasUI:true`, `json`, `print`), incl. an
  explicit RPC regression case; safe allowed; protected write blocked; TTY confirm
  allow/deny honored; risky `user_bash` refused off-terminal. 10/10.
- Loads into real Pi 0.80.3 offline (`pi -e ./extensions/prime-fence.ts … --list-models`,
  exit 0). A full model-driven block is additionally exercisable via the lockdown mock, but
  the deterministic proof is the harness above.
