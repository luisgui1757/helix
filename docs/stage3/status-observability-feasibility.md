# Status And Observability Feasibility

Status: catalog/disposition only, 2026-07-08. No status package is adopted and no
new slash command is added.

## Catalog Snapshot

Fresh npm search on 2026-07-08 found these relevant candidates:

| Candidate | Version | Disposition |
| --- | ---: | --- |
| `@narumitw/pi-statusline` | 0.11.0 | Audit candidate; replaces footer, needs source/no-exfil review. |
| `@odinlayer/pi-statusbar` | 0.3.3 | Audit candidate; cost/context display requires careful provider-payload review. |
| `@pi-vault/pi-status` | 0.3.0 | Audit candidate; "Codex-like" status but source review required. |
| `@npm-ken/pi-bar` | 1.3.2 | Audit candidate; configurable statusbar, no adoption before audit. |
| `@sentixx/pi-info` | 0.8.0 | Audit candidate; pluggable statusline, source review required. |

Package audit and adoption remain separate. This PR does not install any of
these packages.

## Local Minimal Surface

The existing `tools/smoke/status.sh` remains the minimal local surface: a
read-only shell status report for safety/provider/worktree posture. It is not a
Pi statusbar and does not add command surface.

`tools/smoke/pi-e2e-load.mjs` adds a second local status-style helper for proof
classification. It distinguishes package loadability, Pi discoverability,
no-live behavior, and live-provider proof. It does not render UI and does not add
commands.

## Live Shell Toggle

Feasibility remains unproven. Before building a live-shell verbose toggle,
verify whether Pi's `tool_execution_update` event exposes stdout granularity
that is better than the native tool display. Until that is proven, do not build a
toggle.

## Live Pipeline View

Feasibility remains unproven. Before building a live pipeline renderer, verify:

- `registerMessageRenderer` supports the needed live-updating shape,
- `@earendil-works/pi-tui` can render it without private provider payloads,
- `pi-messenger` does not already cover messaging/file reservation/pipeline
  overlap after audit.

Pipeline view stays renderer/widget territory, not a command.
