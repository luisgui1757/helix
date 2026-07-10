# Context loading & project-trust verification plan

M0a settles the load-order and project-trust facts here. Both §9-Q6 sub-questions are
now **resolved against installed Pi code**, not left to prose: same-directory precedence
(below) and — as of 2026-07-03 — the compaction-drift question (context files live in the
system prompt, which compaction never touches). Below separates what is settled and gives
the (now optional) runtime method.

References are to the offline Pi `0.80.3` docs tree and the installed source
(`$(npm root -g)/@earendil-works/pi-coding-agent/`).

## What the docs already settle (verified against Pi 0.80.3 docs)

- **Context files loaded at startup** from three places (`docs/usage.md:98`,
  `README.md:316`):
  - `~/.pi/agent/AGENTS.md` (global),
  - parent directories walking up from cwd,
  - the current directory.
- **One file per directory, first match wins; concatenation is across directories.**
  Confirmed against the installed Pi `0.80.3` **source** (`dist/core/resource-loader.js`),
  which is authoritative over the prose docs: `loadContextFileFromDir()` tries the
  candidates `["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"]` and **returns on the
  first existing file** — so a directory that has both yields exactly one. The
  "all matching files are concatenated" doc line (`README.md:320`) refers to combining
  those per-directory winners **across** the global dir + ancestors + cwd, deduped by
  path in `loadProjectContextFiles()`.
- **Disable** context loading with `--no-context-files` / `-nc`
  (`docs/usage.md:225`).
- **Context files load regardless of project trust** unless loading is disabled
  (`docs/security.md:27`). Before a trust decision is resolved, Pi loads *only*
  context files, user/global extensions, and CLI `-e` extensions; project-local
  `.pi` extensions, project package extensions, and project settings load **only
  after** the project is trusted (`docs/usage.md` Project Trust, `docs/security.md:27`).
- **Project Trust mechanics** (`docs/settings.md:12-22`):
  - Interactive startup prompts before trusting a folder that has project-local
    settings/resources/`.agents/skills` and no saved decision in
    `~/.pi/agent/trust.json`.
  - **Non-interactive modes (`-p`, `--mode json`, `--mode rpc`) do NOT prompt.**
    Without a saved decision they fall back to `defaultProjectTrust`:
    `ask` (default) and `never` **ignore** project resources; `always` trusts them.
  - `--approve`/`-a` and `--no-approve`/`-na` override trust for one run.
  - `pi config` and package commands use the same flow; `pi update` never prompts.
  - `defaultProjectTrust` is a **global-only** setting in
    `~/.pi/agent/settings.json`, default `"ask"` (`docs/settings.md:56`).

## Same-directory precedence — RESOLVED by code

The `docs`/`README` prose ("`AGENTS.md` **or** `CLAUDE.md`" + "all matching files are
concatenated") reads ambiguously, but the installed **source** settles it:

- **`AGENTS.md` shadows a same-directory `CLAUDE.md`.** `loadContextFileFromDir()`
  returns the first hit in order `AGENTS.md` → `AGENTS.MD` → `CLAUDE.md` → `CLAUDE.MD`,
  so both never load from the same directory.
- **This repo's root has both** `AGENTS.md` and `CLAUDE.md`, whose Operating Contract
  content is equivalent — so when Pi loads the root, it takes `AGENTS.md` and the
  contract is present regardless. No blocker.
- **`~/.claude/CLAUDE.md` is NOT part of Pi context loading.** Pi's global context
  file is `<agentDir>/AGENTS.md` where `agentDir` defaults to `~/.pi/agent`
  (`PI_CODING_AGENT_DIR`, `pi --help`). `~/.claude/CLAUDE.md` is the *Claude Code*
  harness's global instructions — a different tool — and Pi never reads it.

Treat the earlier "does AGENTS.md shadow CLAUDE.md?" framing as answered: **yes, by
code.** The startup-header check below is now only an optional runtime smoke, not the
source of truth.

## Compaction treatment of context files — RESOLVED by code (2026-07-03)

**Question:** does native auto-compaction summarize (and thereby weaken) already-loaded
context-file content over a long session?

**Answer: No — and it is settled by code, not left to a runtime guess.** Context files are
part of the **system prompt**, which compaction never touches. Full trace with citations in
[`reviews/m0a/pi-internals-2026-07-03.md`](../../reviews/m0a/pi-internals-2026-07-03.md);
in short:

- `dist/core/agent-session.js:669-680` loads the context files
  (`getAgentsFiles().agentsFiles`) into `buildSystemPrompt(...)`, and
  `dist/core/system-prompt.js:24-30,102-108` appends each file's `content` **verbatim**
  into the system-prompt string.
- The provider request carries `systemPrompt` as a field **separate from** `messages`
  (`agent-session.js:244`).
- `dist/core/compaction/compaction.js` **never references** the system prompt or context
  files; it summarizes only conversation message entries
  (`user`/`assistant`/`custom`/`bashExecution`) and reloads. The only other consumer of
  `getAgentsFiles()` is the TUI startup header — context-file content is never injected as
  a message entry, so nothing compaction touches can reach it.

**Consequence:** the Operating Contract is re-applied verbatim in the system prompt on
every provider request regardless of how many compactions occur. **No drift, so
`APPEND_SYSTEM.md` is not needed** for this reason and is not created (drift disproven, not
merely unobserved).

## Runtime smoke (all optional — the mechanism is settled by code)

None of these are required; they only *confirm* the code behavior at runtime.

1. *(Optional)* **Loaded-files smoke.** Pi's startup header lists loaded `AGENTS.md`
   files (`README.md:150`); confirm the root loads `AGENTS.md` (not `CLAUDE.md`):
   ```sh
   PI_OFFLINE=1 pi --mode json -p "List every context file you loaded, verbatim paths only."
   ```
   Cross-check the `context` event / `.contextFiles` exposed to extensions
   (`docs/extensions.md:528`) if desired. This should match the loader code, not
   override it.
2. *(Optional)* **Contract-in-context proof.** Ask the agent to quote its Operating
   Contract *Modes* section back; a correct quote proves the contract is in context
   (this is the `ROADMAP.md` Phase-0 "Verify" line).
3. *(Optional, belt-and-suspenders)* **Compaction-drift confirmation.** In a session
   long enough to trigger auto-compaction, re-ask for the Modes section afterward and diff.
   The code above predicts **no divergence**; this only double-checks it. Capture pass/fail
   only, never the transcript. Skipped in this slice to avoid a token-heavy long session.

## M0a decisions this feeds

- **Set `defaultProjectTrust` deliberately** rather than leaving it implicit. For
  non-interactive smoke/CI, do **not** rely on the interactive prompt: use explicit
  `--approve` **with a written rationale**, or point `-e` at a trusted temp
  extension path, so project resources load deterministically.
- **Renaming/removing `CLAUDE.md` is safe re: precedence** — `AGENTS.md` already wins
  in the same directory, and it carries the equivalent contract, so dropping the
  root `CLAUDE.md` would not remove the contract from Pi's context. (Keep both for the
  benefit of other tools if wanted; that is a separate, non-Pi concern.)
- **Do not pin to `APPEND_SYSTEM.md`** — the compaction probe is resolved by code and
  found **no drift** (system prompt, incl. context files, is untouched by compaction), so
  pinning would be redundant with the auto-loaded context file. Revisit only if a future
  Pi version changes where context files are assembled (re-check after `pi update`).
