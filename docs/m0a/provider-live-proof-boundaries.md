# Provider Live-Proof Boundaries

Status: final non-Phase-4 hardening, 2026-07-08.

This document keeps four proof types separate:

| Proof type | What proves it | What does not prove it |
| --- | --- | --- |
| Package/resource loadability | Static package manifest, `.pi/settings.json`, and referenced files exist and parse. | Pi command inventory, model calls, provider smokes. |
| Pi discoverability | No-auth/no-live Pi inventory, currently RPC `get_commands` for extension commands. | Static manifest checks alone. |
| No-live behavior | Mock/static/RPC-only paths that send no prompt to a provider and read no credential material. | A live `:free` call. |
| Live-provider proof | A maintainer-approved, named provider proof with public-safe evidence. | CI, stale metadata, unaudited package runs, or a global live toggle. |

`tools/smoke/pi-e2e-load.mjs` reports these four gates separately. Default mode
is static and CI-safe. `--runtime-rpc` uses an isolated temporary home and Pi
agent dir, sets `PI_OFFLINE=1`, `PI_TELEMETRY=0`, and
`PI_SKIP_VERSION_CHECK=1`, then sends only RPC `get_commands`. It does not send a
prompt, invoke a provider, or inspect the user's Pi credential files.

## Approval Rules

- No live provider proof runs in CI.
- No paid or metered call runs without a later maintainer message approving that
  exact proof.
- No global paid-enable flag is allowed.
- `dispatch/config/run-configs.json` keeps `live.enabled` locked to `false`; a
  live proof is an external maintainer action, not a run-config switch.
- Public-safe evidence records only structural fields: provider id, model id,
  proof gate status, stable refusal/pass code, and timestamp. No prompts,
  responses, headers, credential material, transcripts, or private paths.

## Provider Status

| Provider | Boundary in this PR | Status |
| --- | --- | --- |
| Azure Foundry | Config template and blocked checklist only. | Blocked until a real deployment exists. |
| GitHub Copilot | Fresh pinned-model capture/proof workflow only. | No `no-spend-test` eligibility; personal profile requires a current matching pin. |
| OpenAI/Codex subscription | Maintainer-approved single-call proof boundary only. | No CI live call; subscription use is token-bounded, not converted to USD in dispatch policy. |
| Claude CLI / native Anthropic | Live-billing probe boundary only. | `claude-local` remains excluded from automated dispatch. |
| OpenRouter `:free` | Existing preflight-gated no-spend proof path. | Only metadata-verified `:free` models over synthetic/public fixtures; no stronger endpoint claim. |

## Azure Foundry Template

Use [`azure-foundry.models.template.json`](./azure-foundry.models.template.json)
as a shape reference only. It must be copied into the maintainer's local Pi model
configuration and filled with deployment-specific values outside the repo. A
passing proof requires:

1. Deployment exists and is reachable from the approved boundary.
2. Endpoint is on the lockdown allowlist when lockdown mode is claimed.
3. Fresh sourced price/cap metadata exists, or the gateway supplies an
   equivalent hard cap.
4. One maintainer-approved call records only structural pass/fail evidence.

## Copilot Pin Capture

Copilot proof requires a fresh profile pin with:

- exact Pi-visible model id,
- capture timestamp,
- source document or inventory source,
- overage policy statement,
- profile TTL no longer than `copilot_pin_ttl_seconds`.

`evaluateCopilotPin` and `projectProviderPolicy` refuse absent, stale,
malformed, or non-matching pins before any adapter call.

## Claude Live-Billing Probe

The only allowed Claude action in this track is a future maintainer-approved
live-billing probe. It must compare first-party CLI and native provider billing
outside CI and record only pass/fail/cost-class evidence. This PR does not wire
`claude-local` into automated dispatch.
