# Status And Observability Candidate Catalog

Status: catalog artifact only, 2026-07-08. No package installed, adopted, or run.

Fresh npm search for `keywords:pi-package statusbar statusline status` returned a
large candidate set. Shortlist for future source audits:

| Candidate | Version | Reason to inspect | Current disposition |
| --- | ---: | --- | --- |
| `@narumitw/pi-statusline` | 0.11.0 | Footer/statusline replacement. | Audit candidate. |
| `@odinlayer/pi-statusbar` | 0.3.3 | Model, context, token-rate, and cost display. | Audit candidate; provider-payload risk must be checked. |
| `@pi-vault/pi-status` | 0.3.0 | Codex-like status. | Audit candidate. |
| `@npm-ken/pi-bar` | 1.3.2 | Configurable status bar. | Audit candidate. |
| `@sentixx/pi-info` | 0.8.0 | Pluggable statusline segments. | Audit candidate. |

Rejected for this PR:

- Any package that fetches quota/usage from provider services before source and
  egress audit.
- Any package adding slash-command sprawl for status display.
- Any package that persists raw provider payloads or private paths.

Disposition: defer adoption; keep `tools/smoke/status.sh` and
`tools/smoke/pi-e2e-load.mjs` as minimal local surfaces.
