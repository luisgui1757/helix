# Prime lockdown smoke harness

Public-safe **Level-2 lockdown** proof for M0a. Boundary decision and rationale:
[`docs/m0a/lockdown-boundary.md`](../../docs/m0a/lockdown-boundary.md). Evidence:
[`reviews/m0a/level2-lockdown-smoke-2026-07-04.md`](../../reviews/m0a/level2-lockdown-smoke-2026-07-04.md).

Boundary: **Plain Docker with `docker run --network none`** (deny-by-default egress),
per Pi's `docs/containerization.md`.

## Files

| File | Role |
| --- | --- |
| `Dockerfile` | Pins Pi `0.80.3` into `node:24-bookworm-slim` (`--ignore-scripts`). Build-time network only; the smoke runs `--network none`. |
| `no-egress-smoke.sh` | Runner. Builds the image, then runs deny-egress + offline-startup checks (and, with `--active`, the mock-session check). Reports pass/fail; records destinations + exit status only. |
| `mock-openai-endpoint.mjs` | Zero-dependency OpenAI-Chat-Completions mock "approved provider" on `127.0.0.1`. Logs method/path only; canned reply; no outbound network. |
| `container-active-probe.sh` | Runs **inside** the container for `--active`: starts the mock, points Pi at it via an isolated agent dir + dummy key, runs a `pi -p` session, asserts it reached only the mock. |

## Run

```sh
# Required checks: deny-by-default egress + offline startup path
tools/lockdown/no-egress-smoke.sh

# Also run the active session against the local mock approved endpoint
tools/lockdown/no-egress-smoke.sh --active

# Reuse an already-built image
tools/lockdown/no-egress-smoke.sh --no-build --active
```

Exit status: `0` all required checks passed · `1` a required check failed · `2` bad
usage · `3` Docker unavailable (harness ready, not run — safe to wire into CI).

## Guarantees

- **No secrets:** real provider keys are never passed in; `auth.json` is never read or
  mounted. The mock uses a runtime-generated **dummy** key.
- **No spend:** no real model call; the mock returns a fixed canned message.
- **No host mutation:** no `sudo`, no firewall/netns changes. Deny-by-default comes from
  `--network none` (the container has no non-loopback interface).
- **Public-safe logging:** boundary, destinations (host + method/path), and exit status
  only — never prompts, payloads, headers, or keys.

## Not covered here (maintainer/CI follow-up)

A destination trace against a **real** approved provider endpoint (OpenAI / OpenRouter
`:free` / personal-profile Copilot with a current pinned eligible model) needs
credentials and/or spend; run it under CI-with-secrets or by the maintainer.
The mock proves containment and routing without that.

GitHub Actions runs `npm run check:no-live-egress`, a static guard that rejects CI
or npm wiring for live provider smokes and keeps run configs live-disabled. It is
not a packet-level proof; this Docker harness remains the enforcing local proof.
