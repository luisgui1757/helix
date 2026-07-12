# M0a — Pi internals evidence (`/` baseline · native tools · compaction)

**Date:** 2026-07-03 · **Host:** Darwin 25.5.0 arm64 · **Pi:** `0.80.3`
**Method:** static inspection of the **installed** Pi `0.80.3` package
(`/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/`) — offline docs
tree + compiled `dist/` source. No model calls, no network, no session transcript.

**Why source over a TUI transcript:** the installed `dist/` is authoritative over prose
and over a one-session smoke — it settles these questions deterministically and is
**public-safe** (command/tool names, setting defaults, and `file:line` citations only;
no session data, no secrets, no `auth.json`).

**Public-safe:** contains only Pi's own built-in names, setting defaults, and code
citations. No provider keys, no `auth.json`, no session URLs, no transcripts.

---

## 1. Interactive `/` slash-command baseline — CAPTURED (from source)

`pi --help` does not emit the interactive `/` menu, but the built-in set is a single
authoritative constant, `BUILTIN_SLASH_COMMANDS`, in
`dist/core/slash-commands.js` (type `dist/core/slash-commands.d.ts`). The **22**
built-in `/` commands in Pi `0.80.3`:

| Command | Description (verbatim) |
| --- | --- |
| `/settings` | Open settings menu |
| `/model` | Select model (opens selector UI) |
| `/scoped-models` | Enable/disable models for Ctrl+P cycling |
| `/export` | Export session (HTML default, or specify path: .html/.jsonl) |
| `/import` | Import and resume a session from a JSONL file |
| `/share` | Share session as a secret GitHub gist |
| `/copy` | Copy last agent message to clipboard |
| `/name` | Set session display name |
| `/session` | Show session info and stats |
| `/changelog` | Show changelog entries |
| `/hotkeys` | Show all keyboard shortcuts |
| `/fork` | Create a new fork from a previous user message |
| `/clone` | Duplicate the current session at the current position |
| `/tree` | Navigate session tree (switch branches) |
| `/trust` | Save project trust decision for future sessions |
| `/login` | Configure provider authentication |
| `/logout` | Remove provider authentication |
| `/new` | Start a new session |
| `/compact` | Manually compact the session context |
| `/resume` | Resume a different session |
| `/reload` | Reload keybindings, extensions, skills, prompts, and themes |
| `/quit` | Quit pi |

Notes:
- **`/plan` is NOT built-in.** It is contributed by the `plan-mode` **example
  extension** (`examples/extensions/plan-mode/`), not core — so it only appears in `/`
  when that extension is loaded. The earlier command-surface-inventory prose that listed
  `/plan` among built-ins was describing the *example-extension* surface, not core.
- **`/share` uploads a session as a secret GitHub gist** (not `pi.dev`) — an
  additional user-invoked egress path beyond the `PI_SHARE_VIEWER_URL` default recorded
  in `provider-and-egress-posture.md`; still block/allowlist in lockdown mode.

### `enableSkillCommands` — default `true`

Skills register as `/skill:<name>` commands when `enableSkillCommands` is on.
Verified both ways:
- `docs/settings.md:242` — `enableSkillCommands` · boolean · default **`true`** ·
  "Register skills as `/skill:name` commands".
- `dist/core/settings-manager.js:739` — `getEnableSkillCommands()` returns
  `this.settings.enableSkillCommands ?? true` (default-on in code).

The maintainer's `~/.pi/agent/settings.json` does **not** set `enableSkillCommands`
(top-level keys present: `lastChangelogVersion`, `theme`), so the default `true` applies.

### helix-added `/` surface = 0

`helix` still ships no extensions/skills/prompt-templates/themes → **0** slash
commands, **0** shortcuts, **0** tools added. Baseline for the per-phase `/`-menu audit:
Pi built-ins = 22; skill commands would be **on** by default the moment helix ships a
skill (budget consequence noted in `command-surface-inventory.md`).

---

## 2. Native tool / function calling — VERIFIED (nothing to build)

Confirms ROADMAP §7-Theme I and §5. All from installed docs:

| Fact | Value | Source |
| --- | --- | --- |
| Built-in tools (7) | `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls` | `README.md:579`, `docs/extensions.md:1912` |
| Custom-tool API | `pi.registerTool({...})` — **TypeBox** schema (`import { Type } from "typebox"`) | `docs/extensions.md:61,1302`; §5 note ("TypeBox, not zod") |
| Dynamic registration | `registerTool` works during load **and** after startup; tools refresh in-session, callable without `/reload` | `docs/extensions.md:1306` |
| Parallel execution | **Default-on.** Sibling tool calls from one assistant message are preflighted sequentially, then **executed concurrently** | `docs/extensions.md:725` |
| Parallel-safety | `withFileMutationQueue()` shares the per-file queue with built-in `edit`/`write` "because tool calls run in parallel by default" | `docs/extensions.md:1758` |
| Static gating | `--tools/-t` (allowlist), `--exclude-tools/-xt`, `--no-builtin-tools/-nbt`, `--no-tools/-nt` | `docs/usage.md:206-209` |
| Skill-level gating | `allowed-tools` frontmatter (marked experimental) | `docs/skills.md:148` |
| Override built-ins | An extension tool with the same name (`read`/…) replaces the built-in; interactive mode warns | `docs/extensions.md:1910-1919` |
| Introspection | `pi.getActiveTools()` → active names; `pi.getAllTools()` → metadata; tool sources `builtin`/extension/custom | `docs/extensions.md:1570,1591` |

**Verified vs inferred:** every row above is quoted from the installed docs tree
(checksum-pinned, §4). The wider "~30 providers / ~30 lifecycle events" counts in §5 are
carried from prior slices and are **not** re-verified here (out of this evidence file's
scope). **Gating posture:** default is all built-ins on + parallel; helix will lean on
`--tools`/`-xt`/skill `allowed-tools` for the plan-mode read-only restriction and the
yolo-fence, not on disabling tools wholesale.

---

## 3. Compaction & context files — RESOLVED BY CODE (no drift; no `APPEND_SYSTEM.md`)

**Question (§9-Q6, the last open sub-item):** does native auto-compaction summarize —
and thereby weaken — already-loaded context-file content (the AGENTS.md Operating
Contract) over a long session?

**Answer: No.** Context files are part of the **system prompt**, which compaction never
touches. Traced through installed `dist/`:

1. **Context files → system prompt, verbatim.**
   - `dist/core/agent-session.js:669` — `loadedContextFiles =
     this._resourceLoader.getAgentsFiles().agentsFiles`.
   - `:673` — passed as `contextFiles` into `_baseSystemPromptOptions`, then
     `buildSystemPrompt(...)` (`:680`).
   - `dist/core/system-prompt.js:24-30` and `:102-108` — `buildSystemPrompt` **appends
     each context file's `content` into the system-prompt string** (`for (const { path,
     content } of contextFiles)`), i.e. verbatim, not summarized.
2. **The request sends `systemPrompt` as a field separate from `messages`.**
   - `dist/core/agent-session.js:244` — `systemPrompt: this._systemPromptOverride ??
     this._baseSystemPrompt` is set on the turn context alongside (not inside) messages.
3. **Compaction operates only on conversation message entries.**
   - `dist/core/compaction/compaction.js` **never references** `systemPrompt`,
     `contextFiles`, `agentsFiles`, or `buildSystemPrompt`. Its only `systemPrompt` use
     is the fixed `SUMMARIZATION_SYSTEM_PROMPT` for the summarizer sub-call
     (`compaction.js:468,616`).
   - It summarizes `user`/`assistant`/`custom`/`bashExecution` entries between the prior
     kept boundary and the cut point (`compaction.js:220-222`, `docs/compaction.md`
     "How It Works"), then "the session is reloaded" (`compaction.js:5`).
4. **System prompt is rebuilt independently of history.** `_rebuildSystemPrompt()`
   re-reads context files from the resource loader every rebuild
   (`agent-session.js:651-680`); the only other consumer of `getAgentsFiles()` is the
   TUI startup-header display (`dist/modes/interactive/interactive-mode.js:1047`).
   Context-file content is **never** injected as a message entry, so nothing in the
   compaction path can reach it.

**Alternative checked & ruled out:** that context files might *also* be inserted as an
initial user message (which *would* be summarized). Grep of `getAgentsFiles`/
`agentsFiles`/`contextFiles` across `dist/` shows the only consumers are the system-prompt
builder and the TUI header — no message-entry injection.

**Conclusion:** auto-compaction does **not** weaken the loaded Operating Contract; it is
re-applied verbatim in the system prompt on every provider request regardless of how many
compactions occur. Compaction replaces old *conversation messages*, never the system
prompt. **`APPEND_SYSTEM.md` is therefore unnecessary for drift protection** and is not
created (drift disproven, not merely unobserved). `APPEND_SYSTEM.md` would land in the
same system prompt via `appendSystemPrompt` (`system-prompt.js:16,99-100`), so it would be
equally preserved — but redundant with the already-preserved AGENTS.md content.

**Residual (optional, not required):** a one-session runtime smoke (force compaction, then
re-ask for the Modes section and diff) would *confirm* the code behavior at runtime. It is
belt-and-suspenders only — the mechanism is settled by code — and is deliberately skipped
here to avoid a token-heavy long session. If ever run, capture only pass/fail, never the
transcript.

---

## Bottom line

- Interactive `/` baseline: **captured** (22 built-ins; `enableSkillCommands` default
  `true`; helix-added = 0). Closes the open command-surface sub-item.
- Native tool/function calling: **verified**; nothing to build; gating posture recorded.
- Compaction vs context files: **resolved by code** — no drift, no `APPEND_SYSTEM.md`.
  Closes the last §9-Q6 runtime sub-question.
