# Architecture

Helix is an extension-only Pi package with three entrypoints:

- `helix-command.ts` registers the native slash commands and terminal UI.
- `helix-fence.ts` guards attended shell and write operations.
- `helix-answer.ts` captures structured answers without adding another command.

The command extension is an outer adapter. It projects Pi context and model
inventory into the Pi-independent policy in `extensions/lib/helix-command-core.mjs`.
Stable workflow, validation, persistence, and public-safety policy live under
`dispatch/lib/`; tracked configs and role briefs live under `dispatch/config/`.

Package resources are immutable after installation. Mutable state is rooted at
`~/.pi/agent/helix` (or `HELIX_STATE_DIR`) and contains only settings, profiles,
and structural run data. No command writes into the installed package directory.

Every command output crosses the public-safety renderer before Pi displays it.
Mutations validate first, write atomically, and require attended confirmation
unless they are reversible settings toggles in the checkbox UI. Real-provider
casts fail closed until a verified live transport exists; mock execution is never
used as an implicit fallback. The TUI run command invokes the packaged runner by
its resolved extension-relative path, so installed packages never depend on the
caller's current directory for runtime files.
