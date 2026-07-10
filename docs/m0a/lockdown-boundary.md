# Lockdown boundary decision (M0a)

**Decision (2026-07-04):** the canonical lockdown boundary for this public-repo stage is
**Plain Docker, run with `docker run --network none`** (deny-by-default egress), using a
**local/mock approved endpoint or no-network mode** for repeatable, secret-free proof.

This closes the M0a "choose the named boundary" item and backs it with a runnable,
evidenced Level-2 smoke — see [`reviews/m0a/level2-lockdown-smoke-2026-07-04.md`](../../reviews/m0a/level2-lockdown-smoke-2026-07-04.md)
and the harness under [`tools/lockdown/`](../../tools/lockdown/).

## Why Plain Docker `--network none`

Requirements a public-repo boundary must meet: **reviewable, reproducible, CI-friendly,
no secrets, no host firewall mutation, no privileged networking, no sudo.**

- **Pi documents it as a first-class pattern.** `docs/containerization.md` lists "Plain
  Docker — whole `pi` process in a local container" and ships an example Dockerfile
  (`node:24-bookworm-slim` + `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`).
  Our harness pins that to Pi `0.80.3` (ROADMAP §4).
- **Deny-by-default is structural, not configured.** `--network none` gives the container
  **no non-loopback interface** (verified: `interfaces: lo` / `non-loopback: NONE`), so
  egress to `pi.dev` or any provider is impossible by construction. A missed telemetry
  switch cannot re-open a path that has no route.
- **Loopback survives**, so a local **mock approved endpoint** on `127.0.0.1` proves the
  "active session reaches only the approved endpoint" property with **no credentials and
  no spend**.
- **Reproducible + CI-friendly.** One `Dockerfile` + one shell runner; identical semantics
  on Linux CI and local Docker Desktop. No `sudo`, no `pfctl`/`iptables`, no netns setup.
- **Secrets stay out.** We do **not** pass real provider keys into the container (Pi's own
  example passes `-e ANTHROPIC_API_KEY` and mounts `~/.pi/agent`; we deliberately do
  neither). `auth.json` is never read or mounted.

## Why the alternatives are not the default now

| Option (from ROADMAP §2 / Pi `docs/containerization.md`) | Why not the default for this stage |
| --- | --- |
| **Gondolin micro-VM extension** | Requires **QEMU** (a package-manager install) and **Node ≥ 23.6.0** for `@earendil-works/gondolin`; isolates built-in tools while keeping auth on the host. Heavier setup, less CI-portable, and aimed at tool-execution isolation rather than a simple whole-process no-egress proof. Keep as a future option when tool-routing isolation (not just egress) is the goal. |
| **OpenShell** | Requires an external **OpenShell gateway** (Docker/Podman/VM or remote Kubernetes) and gateway registration. Strong for policy-controlled inference routing with credentials kept outside the sandbox, but it adds infrastructure not present in this repo and is not needed to prove no-egress. Revisit when a credentialed, policy-routed inference boundary is required. |
| **VM / micro-VM** | Strongest isolation but heaviest to provision and least CI-friendly; redundant with Docker for an egress proof. |
| **Host firewall / network namespace** (`pf`/`iptables`/netns) | Needs **privileged/host-level network mutation** (and `sudo` on macOS/Linux) — explicitly out of bounds for this slice ("no destructive firewall changes, no host-level network rules"). Also host-specific and hard to review. |

## Scope and limits (kept honest)

- The runnable proof uses **no-network mode + a local mock approved endpoint**. It proves
  containment and routing, not the behaviour of a **real** provider endpoint.
- A real-provider **live-call** proof now exists for OpenRouter `:free`
  (`tools/smoke/openrouter-free-smoke.sh`). A privileged packet-level endpoint-only trace
  remains a future CI/boundary hardening option if needed; it is not claimed by the
  OpenRouter smoke.
- The Claude-auth **live-billing** probe (§9-Q4) remains separately deferred.

## The lockdown allowlist (design intent, unchanged)

In real lockdown mode, model traffic is pinned to an approved-endpoint allowlist (Azure
Foundry / internal gateway / local Ollama/vLLM). Note OpenRouter routes to third-party
  frontier models, so it is typically **off** the lockdown allowlist even though it is in
  the maintainer's day-to-day set. Test-only provider calls obey the cost policy in
  [`provider-and-egress-posture.md`](./provider-and-egress-posture.md): Phase-3
  `no-spend-test` uses only mocks plus metadata-verified OpenRouter `:free` models over
  synthetic/public fixtures; GitHub Copilot is personal/maintainer-profile only with a
  current pinned eligible model; Azure Foundry postponed.
