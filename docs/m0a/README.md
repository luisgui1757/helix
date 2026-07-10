# M0a — evidence refresh + security/provider baseline

This directory holds the **public-safe** artifacts for **M0a**, the first slice of
Phase 0 in [`ROADMAP.md`](../../ROADMAP.md). M0a is a *documentation + evidence*
milestone: it re-pins the environment facts, records the security/provider posture,
and writes the verification **plans** the later build slices execute. It deliberately
**does not** build any Pi extension yet (see [`out-of-scope.md`](./out-of-scope.md)).

Everything here is written to be safe to publish: no secrets, no auth-file contents,
no provider key values, no raw reviewer transcripts.

## Contents

| File | What it is |
| --- | --- |
| [`evidence-snapshot.md`](./evidence-snapshot.md) | The last verified environment snapshot and how to refresh it with the evidence script. |
| [`context-and-project-trust.md`](./context-and-project-trust.md) | Plan to verify Pi context-file loading (AGENTS.md / CLAUDE.md) and project-trust behavior. |
| [`command-surface-inventory.md`](./command-surface-inventory.md) | Plan to inventory the `/` slash-command and `pi` sub-command surface before adding anything. |
| [`provider-and-egress-posture.md`](./provider-and-egress-posture.md) | Provider defaults and the always-on / lockdown egress posture, grounded in Pi docs. |
| [`provider-live-proof-boundaries.md`](./provider-live-proof-boundaries.md) | Final non-Phase-4 provider approval gates and proof-type separation. |
| [`web-access-prompt-injection.md`](./web-access-prompt-injection.md) | Web-access audit posture and prompt-injection boundary. |
| [`azure-foundry.models.template.json`](./azure-foundry.models.template.json) | Public-safe Azure Foundry local config shape; blocked until deployment exists. |
| [`no-egress-smoke-checklist.md`](./no-egress-smoke-checklist.md) | The runnable no-egress smoke checklist (Level-1 always-on defaults + Level-2 lockdown). |
| [`lockdown-boundary.md`](./lockdown-boundary.md) | The chosen lockdown boundary (Plain Docker `--network none`) + why the alternatives are not the default. |
| [`vertical-smoke/`](./vertical-smoke/) | The first thin usable vertical smoke path (plan/answer, review handoff, worktree, PR-gate, status). |
| [`out-of-scope.md`](./out-of-scope.md) | What M0a explicitly leaves for Phase 1+. |

## The evidence script

[`tools/m0a/collect-evidence.sh`](../../tools/m0a/collect-evidence.sh) is the
repeatable source behind the snapshot. It is **offline by default** and never reads
or prints secrets.

```sh
# default: no network at all (Pi forced offline)
tools/m0a/collect-evidence.sh

# opt-in: additionally query the public npm registry for named-candidate metadata
tools/m0a/collect-evidence.sh --network
```

## Status

M0a is **in progress**. What is landed vs. still open is tracked in `ROADMAP.md`
§3 (dashboard) and §10 (Phase 0 checkboxes); this directory is the detail behind
those items.

**Landed in the closeout slice (2026-07-03):** a **trusted-project** telemetry-off
baseline shipped as committed [`.pi/settings.json`](../../.pi/settings.json)
(`enableInstallTelemetry:false`, `enableAnalytics:false`; applies once the project is
trusted/`--approve`, with the env switches as the trust-independent controls), and the
**Level-1 telemetry + offline-startup checks passed** — evidence in
[`reviews/m0a/level1-no-egress-2026-07-03.md`](../../reviews/m0a/level1-no-egress-2026-07-03.md).
Same-dir context precedence was already code-resolved in the prior slice. Update
2026-07-04: the machine-local non-`google` `defaultProvider` is now present, verified by
a non-secret-key whitelist; the shared repo still does not commit a provider default.

**Landed in the finalize slice (2026-07-03)** — all from installed Pi `0.80.3` source,
evidence in [`reviews/m0a/pi-internals-2026-07-03.md`](../../reviews/m0a/pi-internals-2026-07-03.md):
the **interactive `/` baseline is captured** (22 built-ins; `enableSkillCommands` default
`true`; prime-added = 0), **native tool/function calling is verified** (nothing to build),
and the **compaction probe is resolved by code** (context files live in the system prompt,
which compaction never touches → no drift, no `APPEND_SYSTEM.md`). The **Claude-auth spike**
is partially run: local feasibility + documented economics settled; only the live-account
billing probe stays deferred.

**Landed in the resource slice (2026-07-04):** the Prime resource package surface:
`package.json`, one consolidated `prime-ui` skill, Prime-prefixed Rose Pine themes,
the two pinned extension entrypoints, a resource invariant check, the Rose Pine
package audit, and the Fusion-style dispatch
research gate. Details: [`docs/resources/README.md`](../resources/README.md),
[`reviews/package-audits/2026-07-04-pi-themes-rose-pine.md`](../../reviews/package-audits/2026-07-04-pi-themes-rose-pine.md),
and [`docs/architecture/fusion-dispatch-research.md`](../architecture/fusion-dispatch-research.md).

**Landed in the lockdown + smoke slice (2026-07-04):** the canonical lockdown boundary is
**chosen** — Plain Docker `docker run --network none` ([`lockdown-boundary.md`](./lockdown-boundary.md)) —
and a **Level-2 lockdown smoke passed 5/5** (harness [`tools/lockdown/`](../../tools/lockdown/),
evidence [`reviews/m0a/level2-lockdown-smoke-2026-07-04.md`](../../reviews/m0a/level2-lockdown-smoke-2026-07-04.md):
deny-by-default egress, offline startup, and an active session reaching only a local mock —
no secrets, no spend). The **first thin vertical smoke** path shipped
([`vertical-smoke/`](./vertical-smoke/) + `tools/smoke/status.sh`).

**Landed in the real-provider smoke cleanup (2026-07-04):** a native Pi OpenRouter call
against `cohere/north-mini-code:free` passed via
[`tools/smoke/openrouter-free-smoke.sh`](../../tools/smoke/openrouter-free-smoke.sh),
with public-safe evidence in
[`reviews/m0a/openrouter-free-smoke-2026-07-04.md`](../../reviews/m0a/openrouter-free-smoke-2026-07-04.md).
This proves a no-spend active session against a real approved provider, but does not
claim privileged packet-level endpoint exclusivity.

**Still open Phase-0:** the Claude-auth **live-billing** probe (the one remaining
§9-Q4 sub-item). A positive `/share`-denied trace remains a future lockdown follow-up
when that user-invoked path is exercised.

**Final non-Phase-4 hardening (2026-07-08):** `tools/smoke/pi-e2e-load.mjs`
separates package/resource loadability, Pi discoverability, no-live behavior,
and live-provider proof instead of collapsing them into a single "works in Pi"
claim. Runtime mode uses only RPC `get_commands` with isolated config dirs and no
model prompt. Package audit artifacts were added for `pi-web-access`,
`remote-pi`, `pi-messenger`, and status/observability candidates; none are
installed or adopted.
