# M0a — Level-1 no-egress smoke evidence

**Date:** 2026-07-03 · **Host:** Darwin 25.5.0 arm64 · **Pi:** `0.80.3`
**Scope:** Level-1 of `docs/m0a/no-egress-smoke-checklist.md` (always-on defaults).
Level-2 (in-boundary packet trace) is **not** covered here — see "Deferred" below.

**Verdict at collection time: PARTIAL.** The telemetry and offline-startup checks
**PASSED** on 2026-07-03; the **provider-default sub-check was OPEN** at collection
time (Pi's CLI default stayed `google` until a machine-local `defaultProvider` was
applied). **2026-07-04 addendum:** the maintainer's machine-local `defaultProvider`
is now non-`google`; see the addendum below. Also note the `.pi/settings.json`
controls apply only to a **trusted** project (or `--approve`); the
trust-independent guarantees are the env switches below.

**Public-safe:** this file records setting keys, provider/domain names, commands,
versions, and pass/fail only. No provider key values, no `auth.json` contents, no
packet payloads, no session URLs.

## Environment posture (session)

| Switch | Value | Layer |
| --- | --- | --- |
| `PI_OFFLINE` | `1` | env (session) |
| `PI_SKIP_VERSION_CHECK` | `1` | env (session) |
| `PI_TELEMETRY` | `0` | env (session) |
| `enableInstallTelemetry` | `false` | committed `.pi/settings.json` (this repo) |
| `enableAnalytics` | `false` | committed `.pi/settings.json` (this repo) |

The env switches are defense-in-depth and trust-independent; the settings-file
controls apply when this project is trusted (or run with `--approve`).

## Results

| Level-1 check | Result | Basis |
| --- | --- | --- |
| `PI_OFFLINE=1` / `--offline` available and set | **PASS** | `pi --help` lists `--offline`; `PI_OFFLINE` documented (`docs/settings.md:80`) |
| `PI_SKIP_VERSION_CHECK=1` set | **PASS** | documented (`docs/settings.md:80`, `docs/usage.md:297`) |
| `PI_TELEMETRY=0` set | **PASS** | documented env override of install telemetry (`pi --help`) |
| `enableInstallTelemetry=false` shipped | **PASS (trusted-project)** | shipped in committed `.pi/settings.json`; global default is `true` (`docs/settings.md:58`). Applies only when the project is **trusted** / `--approve` (`docs/settings.md:14-16`); the trust-independent guarantee is env `PI_TELEMETRY=0` + `PI_OFFLINE=1` |
| Approved default provider is **not** `google` | **OPEN (documented)** | committed config intentionally does not pin a provider (maintainer choice); Pi's CLI default remains `google` until the maintainer sets `defaultProvider` machine-local. See `docs/m0a/provider-and-egress-posture.md` |
| No Google credentials configured | **PASS (env + auth-state at collection time)** | `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_GENAI_API_KEY`, `VERTEX_PROJECT` all **unset**; on 2026-07-03, `pi --list-models` reported **no authenticated providers** ("Use /login…"), i.e. Pi's own credential resolution found zero usable providers incl. google. 2026-07-04 provider visibility is recorded in the addendum below. `auth.json` not read (policy) |
| `tools/m0a/collect-evidence.sh` runs offline | **PASS** | exit 0; version pin **OK**, docs checksum **OK** |
| `pi --version` / `pi --help` succeed offline | **PASS** | both exit 0 with the offline env set (no hard network dependency at startup) |
| `pi --approve --list-models` loads project settings without error | **PASS** | exit 0; no parse/settings error (confirms committed `.pi/settings.json` is accepted) |
| Startup avoids `pi.dev/api/latest-version` and `pi.dev/api/report-install` | **PASS (config + docs)** | with `PI_OFFLINE=1`, all startup network ops are disabled by documented behavior (`docs/settings.md:80`); offline non-model commands complete normally. Packet-level confirmation is Level-2 |

## The two `pi.dev` startup egress paths (both now closed)

| Endpoint | Purpose | Control(s) applied |
| --- | --- | --- |
| `https://pi.dev/api/latest-version` | version/update check | `PI_SKIP_VERSION_CHECK=1` + `PI_OFFLINE=1` |
| `https://pi.dev/api/report-install` | install/update telemetry ping | `enableInstallTelemetry=false` + `PI_TELEMETRY=0` + `PI_OFFLINE=1` |

## Method notes

- No real model call was made (Level-1 preference). Provider-destination observation
  of an active session therefore was not exercised here.
- Commands run: `pi --version`, `pi --help`, `pi --approve --list-models`,
  `tools/m0a/collect-evidence.sh` — all with `PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1
  PI_TELEMETRY=0`. Google-credential presence checked via `printenv` with output
  suppressed (names only).

## Deferred to Level-2 (still open Phase-0)

- A **deny-by-default packet/destination trace** of an idle + active session inside a
  **named boundary** (Gondolin / Docker / OpenShell / VM / host firewall), covering
  model traffic, web fetches, package socket attempts, remote-relay traffic, and
  `/share`. Requires choosing the boundary first.
- Applying a machine-local `defaultProvider` (approved, non-google) and re-running an
  **active-session** destination check against that approved endpoint only.

## Finalize-slice re-confirmation (2026-07-03)

Re-checked during the M0a finalize slice; the results above are **unchanged**:

- `~/.pi/agent/settings.json` still sets **no** `defaultProvider` (top-level keys:
  `lastChangelogVersion`, `theme` — inspected via a non-secret-key whitelist; `auth.json`
  not read). The non-`google` `defaultProvider` sub-check therefore **stays OPEN**; Pi's
  CLI default remains `google`.
- `pi --list-models` (offline) still reports *"No models available. Use /login…"* — at
  that time, **no** provider was authenticated (OpenAI, OpenRouter, Claude, Foundry,
  Copilot all not logged in), which re-confirmed the "no Google credentials" pass.
  Active-session destination checks remained deferred until a provider was logged in.
  2026-07-04 provider visibility is recorded in the addendum below.

## Resource/provider addendum (2026-07-04)

No model call was made; this is metadata inventory only.

| Check | Result | Basis |
| --- | --- | --- |
| Machine-local default provider is non-`google` | **PASS for this machine** | Non-secret whitelist of `~/.pi/agent/settings.json` shows `defaultProvider:"openai-codex"` and `defaultModel:"gpt-5.5"`; `auth.json` not read. The shared repo still does not commit a provider default. |
| Project settings load Prime resources | **PASS by config** | Committed `.pi/settings.json` now points at `../skills/prime-ui`, `../themes`, and `theme:"prime-rose-pine"` in addition to telemetry booleans. |
| OpenAI Codex models visible | **PASS inventory** | `PI_TELEMETRY=0 PI_SKIP_VERSION_CHECK=1 pi --list-models --no-approve` lists OpenAI Codex models. No prompt was sent. |
| OpenRouter `:free` models visible | **PASS inventory** | `pi --list-models openrouter --no-approve` lists multiple `:free` models. Future OpenRouter tests must use only `:free` model IDs. |
| GitHub Copilot models visible | **PASS inventory** | `pi --list-models github --no-approve` lists Copilot models. Superseded 2026-07-05 for Phase-3 dispatch: `no-spend-test` excludes real Copilot calls; Copilot tests are personal/maintainer-profile only with a current pinned eligible model. `github-copilot/gpt-5-mini` was the cheapest Pi-visible candidate as of this inventory; re-check if `GPT-5.4 nano` becomes visible. |
| Azure Foundry | **DEFERRED** | Requires the work deployment / `models.json` block; postponed. |

Still deferred: active-session destination checks, Level-2 packet/destination trace
inside a named boundary, and the Claude-auth live-billing probe.
