# Provider & default-egress posture

Security and data-sovereignty come first (`ROADMAP.md` §2, principle 0). The posture
is a **two-tier design target**: **always-on defaults** that ship for everyone with
no downside, and a **first-class lockdown mode** that is built + tested but opt-in.
M0a documents the always-on tier and the precise Pi controls behind it, and scopes
(but does not yet build) lockdown mode.

All control names/endpoints below are verified against the offline Pi `0.80.3` docs
tree (`$(npm root -g)/@earendil-works/pi-coding-agent/`).

## Providers

- **Maintainer's must-have provider set** (ROADMAP §7 Theme A; **Copilot corrected back
  to must-have 2026-07-03**): **OpenAI (subscription), Claude (subscription), OpenRouter,
  Azure AI Foundry, GitHub Copilot** — all Pi-native providers. Config work is **one
  `models.json` block** for a non-OpenAI Azure Foundry deployment (`~/.pi/agent/models.json`:
  baseUrl / api / apiKey / headers / compat). **Update 2026-07-04:** no-spend
  `pi --list-models` inventory now shows OpenAI Codex, OpenRouter, and GitHub Copilot
  models visible here; a native Pi OpenRouter `:free` model call has now passed via
  `tools/smoke/openrouter-free-smoke.sh` (evidence:
  `reviews/m0a/openrouter-free-smoke-2026-07-04.md`). Azure Foundry remains postponed
  until the work deployment is available. ≥3 model *families* are reachable, so the
  cross-family adversarial requirement (Theme B) is satisfiable once the orchestration
  substrate exists.
- **Test cost policy:** OpenRouter tests must use only model IDs ending in `:free`.
  The Phase-3 `no-spend-test` profile excludes real Copilot calls; it allows only
  mocks plus metadata-verified OpenRouter `:free` models over synthetic/public
  fixtures. GitHub Copilot tests belong only to an explicit personal/maintainer
  profile with a current pinned eligible model. As of 2026-07-04, Pi exposes
  `github-copilot/gpt-5-mini`, `github-copilot/gpt-5.4-mini`, and other higher-cost
  Copilot models, but not GitHub's cheaper listed `GPT-5.4 nano`; therefore
  `github-copilot/gpt-5-mini` is the current cheapest Pi-visible Copilot candidate.
  Source for Copilot pricing/model availability:
  `docs.github.com/copilot/reference/copilot-billing/models-and-pricing` and
  `docs.github.com/copilot/reference/ai-models/supported-models`.
- **The default provider is `google`** (`pi --help`: `--provider … (default: google)`).
  This is off-box egress of prompts. The posture is to **set an approved
  `defaultProvider`/`defaultModel`** and **not provide Google credentials**. Note the
  built-in `google` provider cannot be removed — it is neutralized by not configuring
  credentials and by pointing the default elsewhere, not by deletion.
- **Secrets stay local** — provider keys come from env vars / an approved secret
  store, never committed or logged. This repo commits **no** keys; the evidence
  script never reads `auth.json` or prints key values.
- **Claude auth — spike partially run** (§9-Q4): native Anthropic OAuth in Pi bills
  third-party-harness usage as extra usage, per-token, **not** against plan limits
  (`docs/providers.md:31`, verbatim); OpenAI Codex OAuth **does** use the subscription
  path (`docs/providers.md:26`). The local **technical feasibility** and the
  **documented economics** are now settled; the **live-account billing** confirmation
  stays deferred. See "Claude-auth policy spike (§9-Q4)" below.

## Always-on egress defaults (ship for everyone)

Pi contacts `pi.dev` at startup via **two independent paths** — they are controlled
separately, so both must be closed:

| Egress | Endpoint | Control(s) | Doc source |
| --- | --- | --- | --- |
| Version/update check | `https://pi.dev/api/latest-version` | `PI_SKIP_VERSION_CHECK=1` **or** `--offline`/`PI_OFFLINE=1` | `README.md:307`, `docs/settings.md:80`, `docs/usage.md:297` |
| Install/update telemetry ping | `https://pi.dev/api/report-install` | `enableInstallTelemetry=false` **or** `PI_TELEMETRY=0` **or** `--offline`/`PI_OFFLINE=1` | `docs/settings.md:58,78` |

Key nuance (from `docs/settings.md:78`): **`enableInstallTelemetry` does not control
the update check, and `PI_SKIP_VERSION_CHECK` does not control telemetry.** Only
`--offline` / `PI_OFFLINE=1` is the single switch that disables **all** startup
network operations (update checks, package update checks, install/update telemetry).

**Defense-in-depth default:** set **all** of `PI_OFFLINE=1` / `--offline`,
`PI_SKIP_VERSION_CHECK=1`, `PI_TELEMETRY=0`, and `enableInstallTelemetry=false`, so
no single missing switch re-opens a path. This is exactly what the evidence script
exports for every `pi` call.

- **Provider attribution headers are metadata egress too** — keep them governed by
  the same telemetry posture (ROADMAP §2).
- **`enableInstallTelemetry` default is `true`** (`docs/settings.md:58`), so the
  telemetry-off posture must be set explicitly; it is not the shipped default.

### Shipped in this repo (M0a closeout, 2026-07-03)

The telemetry-off half ships as a committed, shareable **trusted-project** baseline —
`.pi/settings.json` at the repo root (project settings override global,
`docs/settings.md`; this repo's `.gitignore` keeps `.pi/settings.json` tracked while
ignoring `.pi/npm/` and `.pi/git/`). It is **not** unconditional: project settings load
only after the project is trusted or run with `--approve` (`docs/settings.md:14-16`) —
the trust-independent controls are the env switches (`PI_OFFLINE=1` / `PI_TELEMETRY=0` /
`PI_SKIP_VERSION_CHECK=1`):

```json
{
  "enableInstallTelemetry": false,
  "enableAnalytics": false,
  "theme": "prime-rose-pine",
  "skills": [
    "../skills/prime-ui"
  ],
  "themes": [
    "../themes"
  ]
}
```

- Applies when this project is **trusted** (or run with `--approve`); the session env
  switches above are the trust-independent belt-and-suspenders.
- `enableAnalytics: false` is already the Pi default — it is pinned here so the
  telemetry posture is explicit and auditable in one place.
- `theme`, `skills`, `themes`, and `extensions` load the Prime resource package
  surface: one Prime-owned skill (`prime-ui`), the Prime Rose Pine themes, and the two
  pinned extensions. They do not set a provider default or read credentials.

**`defaultProvider` is deliberately NOT committed here** (maintainer's choice, so the
shared repo config stays credential-agnostic and doesn't break clones without that
provider). **Re-confirmed 2026-07-04 via a non-secret-key whitelist:** the maintainer's
machine-local global settings now have `defaultProvider:"openai-codex"` and
`defaultModel:"gpt-5.5"`; `auth.json` was not read. This closes the Level-1
non-`google` default-provider sub-check for this machine. The shared repo still commits
no provider default. Avoid `anthropic` as a default until §9-Q4 resolves. In lockdown
mode, prefer an approved/self-hosted endpoint and note OpenRouter routes to third-party
models.

### Env-var vs `pi --help` caveat (newly recorded)

`pi --help`'s "Environment Variables" block lists `PI_OFFLINE` and `PI_TELEMETRY`
but **omits `PI_SKIP_VERSION_CHECK`**. The `--help` list is **not exhaustive** — the
authoritative env/settings references are `docs/settings.md` and `docs/usage.md`.
`PI_SKIP_VERSION_CHECK` is real and documented there; do not conclude it was removed
just because `--help` omits it.

## User-invoked egress paths (block/allowlist in lockdown)

These are not startup calls but user- or agent-triggered network actions:

- **`/share`** uploads a session; base URL `PI_SHARE_VIEWER_URL`, default
  `https://pi.dev/session/` (`pi --help`). Block in lockdown mode.
- **`pi install` / `pi update` / `pi -e npm:<pkg>`** fetch and/or run package code.
  `pi -e npm:<pkg>` is a **temporary install + run**, not a no-install inspection —
  gate behind the §5 source audit and the boundary.
- **The agent's own web fetches** (e.g. a future `pi-web-access`) are reviewable
  egress — allow only via an approved proxy/allowlist.

2026-07-08 hardening: provider live proofs are now gated per proof in
[`provider-live-proof-boundaries.md`](./provider-live-proof-boundaries.md). CI
may run only no-secret/no-live checks. The local packet-level enforcing proof
remains `tools/lockdown/no-egress-smoke.sh`; GitHub Actions runs the static
`npm run check:no-live-egress` guard because hosted CI is not itself the
lockdown boundary.

## Lockdown mode (scoped in M0a, built later)

Pi has **no built-in sandbox** — built-in tools and extensions run with the pi
process's full permissions; "real isolation needs to come from the operating system
or a virtualization/container boundary" (`docs/security.md:31`). Project trust is
only an input-loading guard, **not** containment (`docs/security.md:27`). Therefore
lockdown is an **OS/network/container boundary**, and Pi ships concrete patterns
(`docs/containerization.md`):

| Boundary | Isolates | Note |
| --- | --- | --- |
| **Gondolin** extension | built-in tools + `!` commands in a local micro-VM | keeps auth on host |
| **Plain Docker** | whole `pi` process | provider keys enter the container |
| **OpenShell** | whole `pi` process, policy-controlled | needs an OpenShell gateway |

Choosing the named boundary and capturing the enforcing **network trace** are open
Phase-0 tasks (see [`no-egress-smoke-checklist.md`](./no-egress-smoke-checklist.md)).
In lockdown, model traffic is pinned to an approved-endpoint allowlist (Azure
Foundry / internal gateway / local Ollama/vLLM); note **OpenRouter routes to
third-party frontier models**, so it is typically *off* the lockdown allowlist even
though it is in the maintainer's day-to-day set.

## Claude-auth policy spike (§9-Q4) — partially run 2026-07-03

The §9-Q4 question is whether first-party `claude` CLI dispatch is the right
repo-owner-local cost path, or whether native Anthropic OAuth remains the fallback. What
this slice could settle **without** reading `auth.json`, logging in, or making a billed
call:

- **Local technical feasibility — CONFIRMED.** The first-party `claude` CLI is installed
  (`claude` on PATH, version `2.1.200` "Claude Code"), and `codex` is installed too. So a
  custom Pi provider wrapping `claude -p --output-format stream-json` is **buildable on
  this machine** — Pi explicitly supports custom provider/OAuth flows via an extension
  (`docs/providers.md:266`, `examples/extensions/custom-provider-gitlab-duo/`). *(Presence
  of the binary only; no auth inspected.)*
- **Documented economics — SETTLED (from docs).** Pi's **native Anthropic OAuth** path
  bills third-party-harness usage from **extra usage, per token, not against plan limits**
  (`docs/providers.md:31`, verbatim). By contrast **OpenAI Codex OAuth** uses the ChatGPT
  subscription (`docs/providers.md:26`). So native OAuth in Pi does **not** ride the Claude
  Pro/Max plan, which is the whole reason §9-Q4 leans toward first-party `claude` CLI
  dispatch (a first-party harness that rides the plan) as the repo-owner-local candidate.
- **Live-account billing — DEFERRED (precise blocker).** Whether first-party `claude -p`
  dispatch actually bills against the maintainer's Claude plan (vs extra usage), and
  whether Anthropic policy permits programmatic wrapping, **cannot** be verified from static
  evidence: it needs a real (billed) probe against the live account and/or a current
  Anthropic policy read. That is out of scope for a no-secrets, no-billed-call slice, and
  must not rely on any work-laptop/Foundry-only input.

**Decision (unchanged, now evidence-backed):** keep **native Claude OAuth as the fallback**
with the `warnings.anthropicExtraUsage` warning on; treat **first-party `claude` CLI
dispatch as the repo-owner-local candidate** — technically feasible here, economically
motivated by `providers.md:31`, but **not** wired until the live-billing probe runs.
**Public/corporate-shareable builds must remain valid under API-key/gateway/per-token
economics regardless.** Next-step probe: with the maintainer's explicit go-ahead, run one
minimal `claude -p` call and one native-OAuth call, compare the usage dashboards, and
record pass/fail only (no keys, no transcript).

## Provider activation status (2026-07-04)

Active (logged-in) verification of each provider, kept truthful — none are wired on this
machine yet, so none are claimed done:

| Provider | Native to Pi? | Status here | Note |
| --- | --- | --- | --- |
| **OpenAI** | yes (Codex OAuth = subscription) | **Models visible; no model call run** | `pi --list-models` shows OpenAI Codex models. Machine-local default provider is `openai-codex`; shared repo still commits no provider default. |
| **OpenRouter** | yes | **`:free` live call passed** | `tools/smoke/openrouter-free-smoke.sh` ran `cohere/north-mini-code:free` with tools/session/context/resources disabled. Test-only OpenRouter use remains restricted to `:free` model IDs. Routes to third-party frontier models, so typically *off* the lockdown allowlist. |
| **Azure AI Foundry** | yes (custom `models.json`) | **TBD** | Needs one `models.json` block + the work deployment; not on this personal machine. Does **not** block M0a. |
| **GitHub Copilot** | yes (OAuth/subscription) | **Models visible; no model call run** | Must-have provider coverage. Not eligible for Phase-3 `no-spend-test`; personal/maintainer test calls require a current pinned eligible model (`github-copilot/gpt-5-mini` is the cheapest Pi-visible candidate as of 2026-07-04); re-check if `GPT-5.4 nano` becomes visible. |
| **Claude** | yes (native OAuth) + first-party `claude` CLI | **Not logged in (Pi)**; CLI present | See the Claude-auth spike above. |

## What M0a settles vs leaves open

- **Settled:** the exact controls, endpoints, and their independence; the default
  provider hazard (`google`); that lockdown must be an OS/container boundary; the
  candidate boundaries.
- **Done in the closeout slice (2026-07-03):** a **trusted-project** telemetry-off
  baseline shipped as committed `.pi/settings.json` (applies once the project is
  trusted/`--approve`; env switches are the trust-independent controls); the
  **Level-1 telemetry + offline-startup checks passed** (evidence:
  `reviews/m0a/level1-no-egress-2026-07-03.md`) with Google credentials confirmed absent
  (env unset + `pi --list-models` shows no authenticated provider; `auth.json` not read).
  **Update 2026-07-04:** the machine-local non-`google` `defaultProvider` is now present,
  so the provider-default sub-check is no longer open for this machine.
- **Done in the finalize slice (2026-07-03):** the **Claude-auth spike** is partially
  run — local feasibility (first-party `claude` CLI present) + documented economics
  (`providers.md:31`) settled; only the live-account billing probe is deferred. Provider
  activation status recorded (none authenticated on this machine).
- **Done in the lockdown + provider-smoke slices (2026-07-04):** the named boundary is
  chosen, the Level-2 no-network + local-mock smoke passed, and a real OpenRouter `:free`
  live call passed. Stronger packet-level endpoint exclusivity is not claimed by the
  provider smoke.
- **Open Phase-0 task:** run the Claude-auth **live-billing** probe (the one remaining
  §9-Q4 sub-item). A positive `/share` denied trace is a future lockdown follow-up when
  that path is exercised.
- **Final non-Phase-4 dispositions (2026-07-08):** `/share` denied tracing remains a
  local lockdown follow-up because no share path is exercised in no-live CI;
  packet-level endpoint exclusivity remains limited to the Docker no-network/local
  mock proof; the pre-PR local proxy prototype is deferred because no bypass
  evidence justifies an unbypassable interceptor.
