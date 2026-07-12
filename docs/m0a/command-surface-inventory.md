# Slash-command surface inventory plan

Principle 6 (`ROADMAP.md` §2, §6) keeps the `/` menu legible: map every feature to
the **least-cluttering surface** (native behavior > hook > shortcut/status-bar >
tool > slash command). Before helix adds *any* command, M0a records the baseline so
future growth is measured against it.

## Baseline captured in M0a

### Helix-added baseline: **zero** (2026-07-03)

At the original M0a inventory point, `helix` shipped **no** extensions, skills, prompt
templates, or themes — so it added **0** slash commands, **0** shortcuts, **0** tools.
That remains the historical baseline every later phase's `/`-menu audit is compared
against.

### Current Helix-owned package surface: **one skill + one slash command** (2026-07-08)

Helix now ships a resource package with exactly one Helix-owned skill:
`skills/helix-ui/SKILL.md`, registered as `/skill:helix-ui` when skill commands are
enabled. Stage 3O PR1 adds exactly one extension slash command, `/helix`, as the
single Pi-native control surface over dashboard, no-live run preflight,
model/chain/profile views, and structural run list/status/prune. Helix ships no
prompt templates. Themes do not add slash commands.

Important boundary: Pi can still discover user-global skills from `~/.pi/agent/skills`
and `~/.agents/skills` independently of the Helix package. A project package can keep
Helix's own surface to one skill; it cannot hide user-global skills that are loaded by
Pi's global discovery rules.

### Pi built-in `pi <subcommand>` surface (from `pi --help`, offline)

These are CLI subcommands, not `/` menu entries, but they are part of the
command-surface accounting:

| Subcommand | Purpose |
| --- | --- |
| `pi install <source> [-l]` | Install extension source; add to settings |
| `pi remove` / `pi uninstall <source> [-l]` | Remove extension source from settings |
| `pi update [source\|self\|pi]` | Update pi (`--all` for pi + extensions) |
| `pi list` | List installed extensions from settings |
| `pi config` | **TUI to enable/disable package resources** — the lever for trimming an adopted package's commands (principle 6) |

`pi config` is the mechanism the roadmap relies on to **disable an adopted package's
commands we don't use**, and to set the `enableSkillCommands` posture deliberately.

### Interactive built-in `/` baseline — CAPTURED (from source, 2026-07-03)

`pi --help` does **not** emit the interactive `/` menu, but the built-in set is a single
authoritative constant — `BUILTIN_SLASH_COMMANDS` in the installed Pi `0.80.3` source
`dist/core/slash-commands.js` — which is more reliable and public-safe than a TUI
transcript. Full evidence (all 22 commands + citations) in
[`reviews/m0a/pi-internals-2026-07-03.md`](../../reviews/m0a/pi-internals-2026-07-03.md).
The **22** built-in `/` commands in Pi `0.80.3`:

`/settings` · `/model` · `/scoped-models` · `/export` · `/import` · `/share` · `/copy` ·
`/name` · `/session` · `/changelog` · `/hotkeys` · `/fork` · `/clone` · `/tree` ·
`/trust` · `/login` · `/logout` · `/new` · `/compact` · `/resume` · `/reload` · `/quit`.

- **`/plan` is NOT a built-in** — it comes from the `plan-mode` **example extension**,
  so it appears in `/` only when that extension is loaded.
- **`/share` uploads the session as a secret GitHub gist** — a user-invoked egress path;
  block/allowlist in lockdown mode (`provider-and-egress-posture.md`).
- **`enableSkillCommands` default = `true`** (`docs/settings.md:242`;
  `dist/core/settings-manager.js:739` returns `… ?? true`), so skills register as
  `/skill:<name>` and **count against the `/` budget** the moment helix ships one. The
  maintainer's `~/.pi/agent/settings.json` does not set `enableSkillCommands`, so the
  default applies. Skill and prompt-template commands are counted by the audit, not just
  `registerCommand` extensions (§6).

## Native tool / function calling — VERIFIED (nothing to build)

Tools are model-callable and **do not appear in `/`**, but they are part of the
command-surface accounting (least-cluttering surface). Confirmed against the installed
Pi `0.80.3` docs (evidence:
[`reviews/m0a/pi-internals-2026-07-03.md`](../../reviews/m0a/pi-internals-2026-07-03.md)):

- **7 built-in tools:** `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`
  (`README.md:579`).
- **`pi.registerTool({...})`** with **TypeBox** schema (`docs/extensions.md:61,1302`);
  registration works during load and after startup (`:1306`).
- **Parallel execution is default-on** (`docs/extensions.md:725`); file-mutating custom
  tools should use `withFileMutationQueue()` (`:1758`).
- **Static gating:** `--tools/-t`, `--exclude-tools/-xt`, `--no-builtin-tools/-nbt`,
  `--no-tools/-nt` (`docs/usage.md:206-209`); skill `allowed-tools` frontmatter
  (experimental, `docs/skills.md:148`). Helix's plan-mode read-only restriction and the
  yolo-fence lean on these, not on disabling tools wholesale.

## The command-surface budget (target, from §6)

The roadmap's earlier target helix-added `/` set was **~8–9** clearly-named commands,
already flagged as near the ceiling:

> `/plan`, `/worktree`, `/adversarial [off]`, `/statusbar`, `/remote-pi`,
> `/annotate`, `/ship` (+ `/answer` only if a manual entry is wanted) plus the single
> Helix-owned skill command `/skill:helix-ui`.

Stage 3O supersedes the split control-surface plan with one command: `/helix`
and argument-completed verbs. Do not add `/helix-run`, `/helix-runs`,
`/helix-models`, `/helix-chains`, `/helix-profiles`, `/helix-worktrees`, or
`/helix-resources` as top-level slash commands. Everything else lands as behavior
/ hook / shortcut / status-bar / tool. Each phase re-audits `/`; if it trends
cryptic, consolidate. The 2026-07-03 baseline established the original
Helix-added count as **0**; the current Helix-owned package count is **1 skill
command + 1 extension slash command**.

## Rule for adding the first command

A new slash command needs a stated reason that it *must* be interactively invoked
and cannot be a hook, shortcut, status-bar toggle, or model-callable tool. Record
that justification in the same change that adds the command, and update the §6
budget table.

`/helix` is justified as the first Pi-native UX layer over existing Stage 3
machinery: it gives a human operator a resolved dashboard, preflight, structural
run inspection, and TUI-confirmed prune without asking the model to infer config
state or run-manager paths. PR1 keeps the surface conservative and avoids slash
sprawl by putting all verbs under one command.
