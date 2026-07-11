# ROADMAP — `prime`: Pi CLI Extensions

> **This is a LIVE document.** It is the single source of truth for what this
> repo is, what's done, and what's next. Anyone (any human or any LLM) must be
> able to read this top-to-bottom and continue the work with zero extra context.
> **Rule: whenever you change code, behavior, or scope, update this file in the
> same change.** Mark items DONE, move partial items to In Progress, add newly
> discovered work, and add a timestamped line to §13 Changelog. Never let the
> roadmap fall behind the code.

Last updated: 2026-07-11

> **Current-contract precedence (2026-07-10):**
> [`docs/stage3/design-contracts.md`](docs/stage3/design-contracts.md) and the
> Prime v1/M10/M11 entries at the end of this file are the current product
> contract. Earlier phase/theme/changelog text is retained as dated decision
> history, not as a live requirement when it conflicts with that contract. The
> current harness rails are exactly `max_iterations` and `max_concurrency`;
> token counts are telemetry, backend billing owns spend, and `prime-fence` is
> untouched/deferred. The public candidate is `prime-reloaded`, built from a
> sanitized single root; the original `prime` network remains private forever.
> The Phase 0-3P rows and named Stage 3B-N pages below preserve dated build
> history. They are not current operational instructions when they mention the
> removed cost/no-spend policy, token budgets, write allowlists, live enablement,
> or deleted smoke commands.

---

## 1. Mission

`prime` develops, tests, and ships **extensions, skills, agents, and config for
the Pi CLI** (`@earendil-works/pi-coding-agent`, the `pi` command). The goal is
**not** a framework: it is a *thin, CGS-first layer* that turns Pi's already
strong natives (≈30 providers, ~30 lifecycle hooks, native auto-compaction,
AGENTS.md auto-loading, example plan-mode/subagent extensions) into an
opinionated, safety-fenced, verification-driven coding harness — **without
re-implementing what Pi already ships.**

CGS = **Canonical Gold Standard**: the ubiquitous, first-principles best practice
for a task. The suite's defining behavior is to find the CGS, ground every change
in an objective source of truth (tests/lint/typecheck), and challenge the user
when a request diverges from the CGS.

## 2. Design philosophy (load-bearing — read before adding anything)

0. **Security & data-sovereignty come FIRST — non-negotiable, overrides every other
   principle.** The bar is a **DESIGN TARGET** (clarified 2026-07-01): the suite must be
   *capable* of running in a locked-down, egress-restricted environment even though the
   maintainer runs it today with personal provider keys — **not** a claim that we're
   behind a corporate boundary right now. Two tiers: **(a) always-on defaults** (ship for
   everyone, no downside) — telemetry OFF, no phone-home, every adopted package audited
   for outbound calls, secrets local; **(b) a first-class LOCKDOWN MODE** (built + tested,
   opt-in) — an egress allowlist pinning model traffic to approved endpoints and blocking
   the rest. Nothing that can leak is on by default. See the callout below — a hard gate
   on §5 and Phase 0.
1. **Adopt before you build — native first, then catalog (MANDATORY gate).**
   Before building ANYTHING: (a) check §5 — if Pi or a shipped example extension
   does it, use that; (b) if not, search Pi's **Package Catalog** (§5 "Catalog-first
   gate") and adopt the **highest-quality measurable** match that clears the bar.
   Only build bespoke when nothing native and nothing in the catalog passes — and
   say so explicitly. Most of this suite is *configuration + a few small hooks*.
2. **Ground advanced behavior in an OBJECTIVE signal** (tests/lint/typecheck),
   never LLM-judging-LLM. Any LLM reviewer is strictly secondary to the gate.
3. **Multi-provider is the load-bearing edge** — it makes cross-*family* model
   diversity (the only thing the debate research says actually pays off) a config
   line, not a build.
4. **Pi-default YOLO stays inside loops.** There is no harness denylist,
   write allowlist, or confirmation ceremony in loop execution. Repository
   isolation and root-confined persistence are structural boundaries; an
   OS/network/container sandbox is the real containment boundary when needed.
5. **One shared dispatch substrate underlies all orchestration.** Parallel
   dispatch and agent-teams stay opt-in and are built last; **adversarial/multi-team
   debate is the exception — default-on for meaningful work (§9-Q2)**, bounded by
   `max_iterations` and `max_concurrency`. Explicit every-task or heavier 3+
   model runs remain user opt-in; provider spend belongs to backend billing
   controls. Still avoid reproducing vendor headline features
   wholesale (the cargo-cult trap) — compose Pi natives + the substrate.
6. **Minimal COMMAND surface — keep the `/` menu legible (not fewer features).**
   The core committed feature set stays broad; "minimal" means the user-facing slash-command list
   never sprawls into dozens of cryptic entries (the Claude Code / Codex anti-pattern
   the user explicitly dislikes). Prefer, in order: **native/automatic behavior →
   lifecycle hooks → status-bar toggles & keyboard shortcuts → tools (don't appear in
   `/`) → a small set of clearly-named slash commands** only where interactive
   invocation is genuinely needed. When adopting a package, **trim the commands we
   don't need** (Pi `pi config` / package resource filtering). Audit the `/` menu each
   phase. See the **Command-surface budget** in §6.

### Security & data-sovereignty — NON-NEGOTIABLE (applies to every section below)

The design target is a suite that **CAN** run in a **corporate, egress-restricted**
environment — the maintainer runs it with personal keys today (clarified 2026-07-01), so
the always-on defaults below ship for everyone while the endpoint-allowlist parts are
**lockdown mode**: first-class and tested, but opt-in rather than assumed-current. Treat
data exfiltration as the top risk; a feature that leaks is worse than a missing feature.

- **Zero telemetry / no phone-home.** Pi itself contacts `pi.dev` for
  `latest-version` + `report-install`. Phase 0 disables startup/update telemetry
  in defense-in-depth layers: `PI_OFFLINE=1` / `--offline`,
  `PI_SKIP_VERSION_CHECK=1`, `PI_TELEMETRY=0`, and
  `enableInstallTelemetry=false`. Provider attribution headers are metadata egress
  too; keep them controlled by the same telemetry posture. Verify with a network
  trace that an idle/active session makes **no** unapproved outbound connection.
- **Every adopted package gets a no-exfiltration audit** (hard gate added to §5):
  read the source for outbound network calls, analytics, "report"/"track"/"telemetry"
  endpoints, crash reporters; review source, license, install scripts,
  dependencies/peer dependencies, engines, Pi-version compatibility, package `pi`
  manifest/resources, command-surface impact, outbound network behavior, and an
  isolated smoke run when safe. Reject or sandbox anything that phones home. This
  **disqualifies observability/tracing packages** (e.g. `@raindrop-ai/pi-agent`,
  third-party crash/analytics) in corporate mode.
- **Model traffic is the biggest egress.** Sending code/prompts to an LLM IS data
  leaving. The maintainer's actual default set is **OpenAI (subscription), Claude
  (subscription), OpenRouter, Azure AI Foundry** (clarified 2026-07-01); the public
  default `google` provider is disabled either way. **Lockdown mode** additionally pins
  traffic to an approved-endpoint allowlist (Azure Foundry / internal gateway / local
  Ollama/vLLM) and blocks the rest — note OpenRouter itself routes to third-party
  frontier models, so it would typically be *off* the lockdown allowlist. Base URLs +
  keys come from config, never committed.
- **No SaaS side-channels.** Chat bridges (Telegram/Slack) = third-party transit →
  already rejected in favor of `remote-pi` (E2E). Web tools (`pi-web-access`, the
  **hosted `openrouter/fusion` adapter**) make outbound calls **by design** — allow only
  via approved proxy/allowlist, and treat the agent's own web fetches as reviewable egress.
  (The DIY Fusion-style dispatch itself uses only approved providers; the hosted adapter is
  off by default and blocked in lockdown.)
- **Secrets stay local** — keys via env/approved secret store, never committed/logged.
- **Lockdown is an OS/network/container boundary, not a Pi setting.** Pi settings,
  regex hooks, and package filtering reduce risk but are not containment. Lockdown
  mode must choose a named boundary such as Gondolin, Docker/container, OpenShell,
  VM/micro-VM, or host firewall/network-namespace adapters.
- **Posture is testable**, not aspirational: an egress check (network trace /
  deny-by-default firewall during a session) runs **inside the named boundary** and
  covers model traffic, web fetches, package socket attempts, and remote-control
  relay traffic for anything that touches the network.

---

## 3. Status dashboard

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked/needs-decision

| Phase | Title | Status |
| --- | --- | --- |
| Bootstrap | Repo + Operating Contract + this roadmap | `[x]` done |
| Requirements | Brainstorm → CGS assessment (§7) | `[x]` done — verdicts in §7 |
| — | Ratify open decisions (§9) | `[x]` Q1/Q2/Q4/Q7/Q8 ratified; Q3/Q5 defaults; Q6 = Phase-0 task. Q4 now requires a Phase-0 wrapper/policy spike before treating `claude` CLI dispatch as a cost path. |
| — | MVP selection (§8 MVP tier) | `[x]` done — core must-haves remain; **Neovim/Pi integration moved to Phase 4 deferred** (2026-07-03) because editor use and Pi runtime do not need to be coupled. "Minimal" = command surface, not scope. Build order M0→M3. |
| Current v1 | Publication hardening | `[~]` in progress — structural validation/persistence, ordered resume lifecycle, owned worktrees, objective gates, `max_iterations`/`max_concurrency`, and one `/prime` command ship. Backend billing owns spend; no cost/no-spend policy, token-budget rail, write allowlist, live flag, or task-loop live transport ships. Every non-mock cast refuses as `live-adapter-not-wired`. Historical stage records are bannered and the executable checks plus `docs/stage3/design-contracts.md` define current behavior. |
| Historical chronology | Phase 0-3P rows below | Dated implementation history retained for auditability; superseded cost/live commands and intermediate test counts are not current instructions or release claims. |
| 0 | Foundations: **security lockdown**, providers, entry point, principle loading | `[~]` in progress — **M0a evidence + security/provider baseline landed** (`tools/m0a/`, `docs/m0a/`); **trusted-project telemetry-off baseline shipped** (`.pi/settings.json`) and **Level-1 telemetry + offline-startup smoke passed** (`reviews/m0a/`). **Finalize slice (2026-07-03):** interactive `/` baseline **captured** + native tool/function-calling **verified** + compaction probe **resolved by code** (no drift, no `APPEND_SYSTEM.md`) — evidence `reviews/m0a/pi-internals-2026-07-03.md`; Claude-auth spike **partially run** (feasibility + economics settled, live-billing deferred). **Resource slice (2026-07-04):** Prime package surface shipped (`package.json`) with exactly one Prime-owned skill (`prime-ui`), Prime-prefixed Rose Pine themes, and the initial two pinned extensions; Stage 3O later adds the third pinned control extension (`prime-command`) while preserving one consolidated slash command. Rose Pine audit recorded; Fusion dispatch research gate added. **Lockdown + smoke slice (2026-07-04):** canonical boundary **chosen** (Plain Docker `--network none`, `docs/m0a/lockdown-boundary.md`) and a **Level-2 lockdown smoke PASSED 5/5** (`tools/lockdown/`, evidence `reviews/m0a/level2-lockdown-smoke-2026-07-04.md` — deny-by-default egress + offline startup + active session reaching only a local mock, no secrets/spend); the **first thin vertical smoke** path shipped (`docs/m0a/vertical-smoke/` + `tools/smoke/status.sh`); **OpenRouter `:free` real-provider smoke passed** (`tools/smoke/openrouter-free-smoke.sh`, evidence `reviews/m0a/openrouter-free-smoke-2026-07-04.md`). **Still open:** Claude-auth live-billing probe |
| 1 | Safety posture: the yolo-fence + scoped worktree manager | `[~]` in progress — **Stage 1+2 (2026-07-04): yolo-fence extension + worktree-manager basics shipped & tested** (`extensions/prime-fence.ts`, `tools/worktree/`); `remote-pi` eval still open |
| 2 | Verification core + planning hygiene | `[~]` in progress — **Stage 1+2 (2026-07-04): objective-gate loop + `\answer` resolver + PR-gate basics + plan/implement separation shipped & tested** (`tools/loop/`, `extensions/prime-answer.ts`, `tools/ship/`, `docs/stage1-2/`); statusbar, live-shell, plan-mode extend, Superpowers/annotate still open |
| 3 | Orchestration substrate (adversarial default-on for meaningful work; parallel/teams opt-in) | `[~]` in progress — **Stage 3A Fusion-style dispatch build spec drafted and review fixes applied** (`docs/architecture/fusion-dispatch-research.md`); **Stage 3B (2026-07-05): dispatch-policy-core substrate shipped & tested** (`dispatch/`, `tests/dispatch-*.test.mjs`, `docs/stage3/`) — runtime role-envelope validation + role/stage matrix, no-spend cost policy (mock + metadata-verified OpenRouter `:free` only), routes/profiles with N3 panel precedence + N4 finite price-TTL staleness, deterministic classifier + mandatory floors + non-TTY fail-closed escalation, judge-bias blinding, and a public-safe run-record writer; **Stage 3C (2026-07-05): thin one-cycle dispatch orchestrator shipped & tested** (`dispatch/lib/orchestrate.mjs`, `tools/smoke/dispatch-smoke.mjs`, `docs/stage3/dispatch-orchestrator.md`) — dependency-injected adapters/clock/seed/gate, pre-launch no-spend/eligibility gates with the metadata price-TTL clamped to profile policy, boundary envelope validation before the blinded advisory judge, objective gates from exit status/deterministic checkers only, structural public-safe run records, recursion depth exactly one; **Stage 3D (2026-07-06): synthesis stage + first preflight-gated no-spend OpenRouter `:free` adapter smoke shipped & tested** (`dispatch/lib/synthesis.mjs`, `tools/smoke/openrouter-free-dispatch-smoke.sh`, `docs/stage3/synthesis-nospend-adapter.md`) — the synthesizer runs after the panel + advisory judge and before the objective gate on `synthesizer` routes, consumes candidate/judge output as an identity/cost-stripped role-output projection (provider-bound, not a public-safe record), and mechanically preserves unresolved contradictions (fail-closed on drop); every dispatch (candidate/judge/synthesizer) projects cost pre-launch on **all** profiles — metered specs without fresh sourced price fail closed before any adapter call, and a `github-copilot` spec needs a fresh, matching profile pin (`evaluateCopilotPin`) whose freshness is bounded by the profile `copilot_pin_ttl_seconds` ceiling (an overlong pin TTL cannot extend it) or stops; the live `:free` smoke is preflight-gated and was **skipped (fail-closed) on the intentionally stale committed metadata — no live call made**; **Stage 3E (2026-07-07): verification stage shipped & tested** (`dispatch/lib/verification.mjs`, `docs/stage3/verification-stage.md`) — the `verifier` role runs after the objective/advisory gate result is captured (on `pr-preflight`), receives a structural public-safe proof summary (`projectForVerification`), and summarizes proof but **never** determines the gate result (a positive verifier can't rescue a failed gate; a negative verifier can't block a passed gate); its narrative is never persisted; **Stage 3F (2026-07-07): thin parallel / multi-team dispatch shipped & tested** (`dispatch/lib/parallel.mjs`, `docs/stage3/parallel-dispatch.md`) — opt-in `deps.parallel = {max_concurrency, token_budget}` gives bounded-parallel candidate launch (built on the Pi `subagent` concurrency-limiter pattern, no subprocesses); an invalid cap or unbounded budget fails closed, output stays candidate-index deterministic (same-config parallel runs byte-identical; `cap_status.token_cap` records the effective enforced budget), all existing gates preserved, a failed candidate is isolated and still counts against `min_successes`; plus a cross-family **advisory** (`cross-family-not-satisfied`, warn-only) on `requires_cross_family` routes; sequential is the default (existing callers unchanged); 205 tests pass; **Stage 3G (2026-07-07): iterating multi-team / adversarial debate loop shipped & tested** (`dispatch/lib/debate.mjs`, `docs/stage3/iterating-debate.md`) — a bounded iterating loop that **composes** `runDispatch` (one iteration = the full panel→judge→synthesis→gate→verifier cycle) and repeats only for adversarial routes until convergence, where **convergence is exactly diff-stability (an injected deterministic checker) + objective-gate-pass** so model/judge/verifier/synthesis approval is never final authority; mandatory `max_iterations` + an aggregate `token_budget` rail fail closed **before** iterating (and the aggregate budget wins over convergence); a hard fail-closed iteration is never retried; structural-only public-safe iteration summaries carry no model narrative and are deterministic under mock adapters; 233 tests pass; **Stage 3H (2026-07-07): real revision / diff surface shipped & tested** (`dispatch/lib/git-diff-surface.mjs`, `dispatch/lib/adversarial-policy.mjs`, revision boundary in `dispatch/lib/debate.mjs`, `docs/stage3/real-revision-diff-surface.md`) — a **real working-tree diff-stability** surface (`computeDiffFingerprint`/`makeGitDiffStability`: a structural `sha256` fingerprint of the git diff via deterministic plumbing — hashes/counts/refs only, never raw diff text; fails closed on non-git repo, missing baseline, ambiguous index, git failure, unsafe path, or non-determinism), an **optional injected `revise` boundary** that produces the next proposal in the worktree between non-converged iterations (the only thing allowed to mutate it; state threads as refs/hashes; a failed revision stops fail-closed and preserves prior iteration evidence; absent ⇒ Stage 3G behavior byte-for-byte), and a **default-on adversarial policy** (`resolveAdversarialPolicy`: meaningful work is default-on; `/adversarial off` rides `task.override.disable_adversarial` with no new slash command and records `adversarial-opt-out`; heavier 3+ model runs stay opt-in). The debate core stays pure (git/worktree effects are injected) and the objective gate is still final authority. 267 tests pass; **Stage 3I (2026-07-07): real model-backed revision effect shipped & tested** (`dispatch/lib/revision-effect.mjs`, shared `dispatch/lib/provider-policy.mjs`, `tests/dispatch-revision-effect.test.mjs`, `tools/smoke/revision-effect-smoke.mjs`, `docs/stage3/model-backed-revision.md`) — `makeModelRevision` builds the injected `revise` boundary effect (debate core unchanged): it validates config/caps, **projects provider/cost policy through the shared gate before any model call** (an ineligible/unknown/stale provider or price, or a missing Copilot pin, refuses before the adapter — call count 0), validates the model's structured edits, applies them to the worktree all-or-nothing under the Stage 3H write rules (allowlist-only; credential-shaped paths refused even if allowlisted; unsafe traversal/absolute/symlink/non-file/outside-tree paths fail closed; earlier writes roll back on disk write failure), and returns only a structural `sha256` `revision_ref` + stable code (no thrown/model free text in detail, warnings, summaries, or records); a real temp-repo debate converges only on diff-stability + objective-gate-pass. 282 tests pass; **Stage 3J (2026-07-07): live OpenRouter `:free` builder adapter shipped & proof-run** (`dispatch/lib/openrouter-revision-adapter.mjs`, `tools/smoke/openrouter-free-revision-smoke.mjs`, `tests/dispatch-openrouter-revision-adapter.test.mjs`, `docs/stage3/live-builder-adapter.md`) — the adapter refuses non-`:free` models and unsafe/sensitive fixture paths before Pi, bounds the full outbound prompt with `max_input_bytes` before runner invocation, disables tools/session/context/resources, parses structured edits into `makeModelRevision`, and throws stable codes only; the live smoke fetched public OpenRouter metadata for `openai/gpt-oss-20b:free` (prompt/completion `0`), passed `nospend-preflight.mjs` (`ok-free-verified`), verified Pi inventory, and converged a real temp-repo debate in 3 iterations with 2 live builder revision calls. 288 tests pass; **Stage 3K (2026-07-07): lean agent-team defaults shipped & tested** (`dispatch/lib/agent-team.mjs`, `dispatch/config/agent-team-defaults.json`, `docs/stage3/agent-team-defaults.md`, `docs/stage3/agents/`) — additive Builder + independent-provider Reviewer defaults, stable canonical agent IDs (`Scout`/`Planner`/`Builder`/`Reviewer`/`Documenter`/`RedTeam`) bridged to existing dispatch roles, and cosmetic aliases kept display-only so routing/log projections stay canonical. 296 tests pass; **Stage 3L/M/N (2026-07-07): role matrix, chains, bounded task-loop, run manager, worktree hardening, and two-model `:free` proof shipped & tested** (`dispatch/lib/role-matrix.mjs`, `dispatch/lib/chains.mjs`, `dispatch/lib/run-configs.mjs`, `dispatch/lib/task-loop.mjs`, `dispatch/lib/run-manager.mjs`, `tools/loop/prime-task-loop.mjs`, `tools/runs/prime-runs.mjs`, `tools/smoke/openrouter-free-multimodel-revision-smoke.mjs`, `docs/stage3/role-matrix-task-loop.md`) — per-role model/effort/instance matrices expand deterministically and project provider/cost policy before launch; named chains include `implement-review-fix`, `scout-flow`, and `ship-pre-pr`; `mock-core-loop` is no-live with finite caps, objective gate, write allowlist, and structural records; run status/list/prune read only structural JSON; worktree remove/merge refuses dirty/current unsafe states; task-loop objective gates now refuse symlink/non-file/sensitive/out-of-tree final paths before reading; non-builder chains return `chain-not-loop-runnable:<id>`; the CLI cleans default synthetic temp repos and reports replaced structural run directories; live no-spend proof passed for `openai/gpt-oss-20b:free` and `cohere/north-mini-code:free`; **Stage 3O PR1 (2026-07-08)** adds one `/prime` command for dashboard, no-live run preflight, view-only model/chain/profile browsers, structural run list/status, and TUI-confirmed prune, without launching loops or toggling live mode. 340 node tests pass after Stage 3O PR1 final review fixes. **Paid/metered runs, real subprocess fan-out, live pipeline UI, autonomous/unattended mode, remote control, hosted adapter, and broad config editors remain out of scope/deferred.** |
| 3P | Whole-repo gap closure (Codex/Fable accepted review gaps) | `[x]` DONE 2026-07-09 — **Stage 3P whole-repo gap closure**: mechanical safety hardening, CI/pr-gate public-safety parity, docs-truth locks, `/prime help`, direct manual coverage, runtime RPC timeout hardening, run-record prune/list clarity, and design contracts for autoresearch/cost modes/composites/config overlays/loop cues/live enablement/context engineering. The closure intentionally does not implement autoresearch behavior, live enablement, composite selection, config editing, remote/web/package adoption, or paid/live calls. `npm test` passes 362 node tests plus the worktree self-test (12) and objective-gate-loop self-test (8); 358 top-level node test declarations are locked by `npm run check:docs-truth`. |
| 3V | Prime v1 single-PR runner + independent hardening | `[x]` DONE 2026-07-10 on `prime-v1` — M1–M9 implementation plus M10 same-family review and independent cross-family/final repair passes. Safe/practical rails, unconditional no-live cast refusal, closed public records/renderers, atomic run reservation, exact resume event/state binding, post-gate idempotent outward handoff context, required artifacts/step effects, real profile member overlays, attended mutation confirmation, four-reason research, and effective CI no-live checks are implementation- and regression-backed. Live loop transport and the concrete ship-pre-pr effect remain explicit deferred boundaries, never optimistic fallbacks. |
| 4 | Deferred / experimental (gated on real signals) | `[ ]` todo |

**Immediate next action:** rerun PR #1's exact-head CI and independent review,
then let the maintainer use the sole PR-only ruleset bypass to squash-merge
without self-approval. Keep both repositories private through merge and the
post-merge object/ref, metadata, license-detection, and secret checks. Do not
reopen removed cost control, a live flag, or in-loop fences.
**Landed:** a repeatable evidence script (`tools/m0a/collect-evidence.sh`,
offline by default) and public-safe baseline docs (`docs/m0a/`); a **trusted-project
telemetry-off baseline** shipped as committed `.pi/settings.json`
(`enableInstallTelemetry:false`, `enableAnalytics:false`, Prime resource paths, and
`theme:prime-rose-pine`; applies once the project is trusted/`--approve`, with
env `PI_OFFLINE=1`/`PI_TELEMETRY=0` as the trust-independent controls); and the
**Level-1 telemetry + offline-startup smoke passed** (evidence
`reviews/m0a/level1-no-egress-2026-07-03.md` — env switches set, no Google credentials,
offline commands OK; non-`google` machine-local provider re-verified 2026-07-04).
**Finalize slice
(2026-07-03) closed** the interactive `/` baseline (captured from source), native
tool/function-calling (verified), and the §9-Q6 **compaction** probe (resolved by code —
no drift, no `APPEND_SYSTEM.md`), and partially ran the Claude-auth spike (feasibility +
economics settled; live-billing deferred) — evidence
`reviews/m0a/pi-internals-2026-07-03.md`. **Resource slice (2026-07-04) added** the
`prime-pi` package manifest, one consolidated `prime-ui` skill, vendored
Prime-prefixed Rose Pine themes, a resource invariant check, the Rose Pine package
audit, and the Fusion-style dispatch research gate. **Lockdown + smoke slice
(2026-07-04) chose** the canonical boundary (Plain Docker `--network none`,
`docs/m0a/lockdown-boundary.md`), **passed a Level-2 lockdown smoke 5/5** (harness
`tools/lockdown/`, evidence `reviews/m0a/level2-lockdown-smoke-2026-07-04.md`:
deny-by-default egress + offline startup + an active session reaching only a local mock —
no secrets, no spend), and **shipped the first thin vertical smoke** path
(`docs/m0a/vertical-smoke/` + `tools/smoke/status.sh`). **Still open in M0a:**
the Claude-auth **live-billing** probe (the one remaining §9-Q4 sub-item). A real
OpenRouter `:free` active-session smoke is now recorded in
`reviews/m0a/openrouter-free-smoke-2026-07-04.md`; stronger packet-level endpoint
exclusivity is not claimed. **Stage 1+2 (2026-07-04) shipped** yolo-fence,
worktree-manager basics, the objective-gate loop, the `\answer` resolver,
PR-gate basics, and plan/implement separation. The broader vertical slice now
waits on Phase-3 orchestration: thin adversarial review is still a manual
second-provider review pass until the shared dispatch substrate exists.

---

## 4. Environment & key facts (verified 2026-07-02)

| Fact | Value |
| --- | --- |
| Pi CLI version | `0.80.3` |
| Pi binary | `/opt/homebrew/bin/pi` |
| Pi package root | `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/` |
| Global npm root | `/opt/homebrew/lib/node_modules` |
| Installed package | `@earendil-works/pi-coding-agent@0.80.3` |
| Docs/examples checksum | `5aa4edd22108919537fe3f56b80afc3b8fa6d8a678163f3c2a4b8469b53c7a5e` for `cd "$(npm root -g)/@earendil-works/pi-coding-agent" && find docs examples README.md CHANGELOG.md -type f \| sort \| xargs shasum -a 256 \| shasum -a 256` |
| Global Pi config | `~/.pi/agent/settings.json` · custom providers/models: `~/.pi/agent/models.json` · credentials: `~/.pi/agent/auth.json` |
| Global Pi agent rules | `~/.pi/agent/AGENTS.md` (`$PI_CODING_AGENT_DIR` overrides) |
| Project-local Pi | `.pi/settings.json`, `.pi/extensions/*.ts`, `.pi/agents/*.md` |
| Repository root | checkout root · default branch `main` |

**Authoritative Pi docs (offline, version-pinned to 0.80.3 — re-verify after `pi update`):**
`…/pi-coding-agent/docs/{extensions,skills,packages,settings,usage,compaction,sessions,json,rpc,security,containerization,providers,models,tui}.md`,
`README.md`, `CHANGELOG.md`, and `examples/`. The 2026-07-02 combiner pin supersedes
older embedded snapshots; any Pi capability claim must be rechecked against this tree
after `pi update`.

**Re-verified 2026-07-03** with `tools/m0a/collect-evidence.sh` (offline by default):
Pi `0.80.3`, installed `@earendil-works/pi-coding-agent@0.80.3`, and the docs/examples
checksum (`5aa4edd2…`) are **unchanged** — 33 docs + 126 examples files. Named-candidate
npm metadata rechecked the same day (`--network`): `remote-pi@0.5.3` (`^0.78.0`) and
`pi-nvim@0.2.4` (`^0.74.0`) still do **not** cover Pi `0.80.3`; `pi-web-access@0.13.0`
declares range `*`; `pi-annotate@0.4.3` and `pi-messenger@0.14.1` declare no Pi range.
See `docs/m0a/evidence-snapshot.md`.

---

## 5. Pi NATIVE capability map (the most important reference)

Pi's design philosophy is *"aggressively extensible so it doesn't have to dictate
your workflow"* — the core is deliberately minimal. The README explicitly lists
**non-features**: *"No MCP. No sub-agents. No permission popups. No plan mode. No
built-in to-dos. No background bash."* Each is an extension you build or install.
**Do not rebuild a native; do not assume a "feature" is native — check here first,
then run the Catalog-first gate (end of this section) before building anything.**

### Built-in (use directly, zero build)

| Capability | Notes |
| --- | --- |
| **~30 model providers** | Anthropic, OpenAI, Azure OpenAI (`azure-openai-responses`), OpenRouter, GitHub Copilot, Bedrock, Google Gemini/Vertex, xAI, Groq, Cerebras, DeepSeek, Mistral, Together, Fireworks, NVIDIA NIM, etc. **Incl. 3 OAuth/subscription providers: Claude Pro/Max, ChatGPT (via Codex), GitHub Copilot.** ⚠️ **Billing asymmetry / policy uncertainty:** ChatGPT Codex OAuth uses the subscription (`docs/providers.md:26`). Pi docs warn that Claude Pro/Max native OAuth can bill third-party-harness usage as per-token *extra usage* (`docs/providers.md:31`), while current Anthropic support docs describe Claude Code/Agent-style usage as plan-limit governed and API Console usage as separate. Treat Claude cost/auth as unresolved until the Phase-0 wrapper+policy spike (§9-Q4); public/corporate-shareable builds must remain valid under API-key/gateway/per-token economics. |
| **Custom / OpenAI-compatible endpoints** | `~/.pi/agent/models.json` (baseUrl/api/apiKey/headers/compat) **or** `pi.registerProvider()`. Covers Azure AI Foundry non-OpenAI deployments, Ollama/vLLM/LM Studio, corporate proxies. |
| **Model/effort selection** | `--provider`, `--model` with `provider/id:thinking` syntax, `--api-key`; `--thinking off…xhigh`; `--models` + Ctrl+P cycling (glob+fuzzy). Credential order: `--api-key` > `auth.json` > env var > `models.json`. |
| **Extension API** | `pi.registerTool / registerCommand / registerShortcut / registerFlag / registerProvider / registerMessageRenderer`. |
| **~30 lifecycle events** | incl. `tool_call` (**can BLOCK** → fence), `tool_result` (can modify), `before_agent_start` (inject msg / mutate system prompt), `context`, `before/after_provider_request`, `tool_execution_start/update/end`, `user_bash`, compaction events, plus a cross-extension event bus. |
| **Skills** | full Agent-Skills standard implementation. |
| **Prompt templates & themes** | native; bundled in packages or conventional dirs. |
| **Context files** | auto-loads `AGENTS.md` / `CLAUDE.md` (global + project). `SYSTEM.md` / `APPEND_SYSTEM.md` + `--system-prompt` / `--append-system-prompt`. |
| **Auto-compaction** | **ON by default**, threshold-based (`reserveTokens` 16384, `keepRecentTokens` 20000, configurable); manual `/compact`; branch summarization on `/tree`. |
| **Sessions** | jsonl persistence; `-c/--continue`, `-r/--resume`, `--fork`, `--no-session`; `/tree` branch navigator; `/new` clears. |
| **Run/output modes** | `tui` (default), `print` (`-p`), `--mode json`, `--mode rpc`; `--export` to HTML. |
| **Static tool gating** | `--tools/-t`, `--exclude-tools/-xt`, `--no-builtin-tools/-nbt`, `--no-tools`; skill frontmatter `allowed-tools`. |
| **Packages** | npm:/git: bundles of extensions+skills+prompt-templates+themes, declared under the `pi` key in `package.json` (e.g. `"pi": {"extensions": ["./src/index.ts"]}`) or conventional dirs. Auto-discovery: `~/.pi/agent/extensions/*.ts` (global), `.pi/extensions/` (project). Loaded via `jiti` (no compile step). |

### Shipped as EXAMPLE extensions (fork/adapt, don't build from scratch)

| Capability | Where |
| --- | --- |
| **Sub-agents / parallel dispatch** | `examples/extensions/subagent/` — spawns isolated `pi` subprocesses; single/parallel (max 8, 4 concurrent)/chain modes; agents are markdown w/ frontmatter (name/description/tools/model) in `~/.pi/agent/agents/` or `.pi/agents/`. |
| **Plan mode** | `examples/extensions/plan-mode/` — registers `/plan` + `--plan` + Ctrl+Alt+P; restricts to read-only tools; tracks numbered steps + `[DONE:n]`. |
| **Permission/confirm gates** | `permission-gate.ts`, `confirm-destructive.ts`, `protected-paths.ts`, `timed-confirm.ts` — pattern for the yolo-fence. |
| **Git helpers** | `git-checkpoint.ts`, `git-merge-and-resolve.ts`, `dirty-repo-guard.ts`, `sandbox/`. |

### NOT present (build only if justified)

MCP · interactive permission popups (everything auto-runs — *effectively always-yolo*) ·
**git worktree creation/isolation** (Pi only *detects* it's inside a worktree for the status bar) ·
background bash · built-in to-dos · model-routing/tiering automation · adversarial/consensus loops.

### Catalog-first gate (MANDATORY — run before building anything new)

Pi has a real, searchable package catalog. Discovery + a measurable quality bar,
encoded so two runs on the same data pick the same package:

- **Where to search (machine-readable source of truth):**
  `GET https://registry.npmjs.org/-/v1/search?text=keywords:pi-package&size=250`
  (paginate via `&from=`). Human gallery: `https://pi.dev/packages` (ranks by
  downloads). Community index: `https://awesome-pi.site` (repo
  `github.com/shaftoe/awesome-pi-coding-agent`). There is **no `pi search`** command.
  `pi -e npm:<pkg>` is a **temporary install + run** (temp dir, one invocation), not
  a no-install inspection path; use it only after static package/source audit and,
  for risky packages, inside the named sandbox/egress boundary.
- **Measurable signals (all fetchable non-interactively, but volatile unless
  captured under `reviews/package-audits/<YYYY-MM-DD>-<slug>/`):**
  `D` = npm weekly downloads (`api.npmjs.org/downloads/point/last-week/<pkg>`),
  `S` = GitHub stars (`gh api repos/<o>/<r> --jq .stargazers_count`),
  `R` = days since last commit (`.pushed_at`), `L` = license SPDX (must be OSI),
  `A` = archived (`.archived` — true ⇒ REJECT). CI presence (optional bonus).
- **Hard quality bar (fail any ⇒ reject):** not archived · real OSI license ·
  `R ≤ 90` days · `D ≥ 100` weekly downloads · **source reviewed before install**
  (packages run with FULL system access — `docs/packages.md` security note) ·
  install scripts/dependencies/peer dependencies/engines reviewed · Pi-version
  compatibility checked (especially `0.x` ranges) · package `pi` resources and command
  surface reviewed (**extension commands, prompt-template commands, skill commands,
  shortcuts, tools, and built-ins/package subcommands it encourages**) ·
  **no-exfiltration audit PASSES** (§2 Security callout): grep the
  source for outbound HTTP/socket calls, analytics/telemetry/crash-report endpoints;
  any phone-home that isn't the package's explicit, approved purpose ⇒ **REJECT**
  (or sandbox + allowlist). Non-negotiable in corporate mode.
- **Rank survivors:** `score = 0.5·log10(D+1) + 0.3·log10(S+1) + recency_bonus`
  (`+0.2` if `R≤30`, `+0.1` if `R≤90`; `+0.05` if CI). Tie-break: D, then S, then newer.
- **Raw audit artifact:** for exact stars/downloads/recency or package adoption
  decisions, commit `reviews/package-audits/<YYYY-MM-DD>-<slug>/manifest.json` plus
  named raw npm/GitHub captures. Exact metrics in roadmap prose are dated prefilter
  notes unless backed by that artifact path.
- **`0.x` semver caution:** caret ranges do not imply cross-minor compatibility;
  for example `^0.78.0` does not satisfy Pi `0.80.3`. Block or keep candidate-only
  until compatibility is proved or upstream widens the range.
- **Decision:** promote the top survivor to **lead candidate pending audit**. If zero
  pass, do NOT lower the bar — build a local extension/skill and document why nothing
  qualified.

---

## 6. Pi extension authoring (confirmed essentials)

- **Language:** TypeScript modules, loaded via `jiti` — **no build/bundle step** for dev.
- **Dev loop:** `pi -e ./path/to/ext.ts` loads an extension ad-hoc (no install).
  `pi install -l ./local/path` installs project-locally into `.pi/settings.json`.
- **Distribution:** `pi install npm:@scope/name` | `git:github.com/user/repo` | `https://…` | `./local`. `-l` = project-local.
- **A tool** is registered with `pi.registerTool` (schema = **TypeBox**, `import { Type } from "typebox"`; JSON-Schema-based). Tools are model-callable and **do NOT appear in the `/` menu**.
- **A fence/gate** returns `{block:true, reason}` from a `tool_call` handler + `ctx.ui.confirm`.
- **System-prompt injection** via `before_agent_start` (`event.systemPromptOptions.appendSystemPrompt`) or `APPEND_SYSTEM.md`.
- **Surfaces an extension can use:** `registerCommand` (`/name` — shows in the `/` menu), `registerShortcut` (keybinding — invisible in `/`), `registerTool` (model-callable — invisible in `/`), status-bar widgets (`setStatus`/`setWidget`), lifecycle hooks (automatic — no UI), `before_agent_start` (behavior). **Command-surface accounting is broader than `registerCommand`: prompt templates and skill commands can also appear in `/`, and `enableSkillCommands` defaults matter.**

### Command-surface budget (principle 6 — keep `/` legible)

Map every feature to the LEAST-cluttering surface. Target a **small, clearly-named
prime-added slash-command set**; everything else is behavior/hook/shortcut/tool/status-bar.
The audit counts extension commands, prompt-template commands, skill commands, and
package-provided shortcuts/tools that effectively create user-facing surface, while
separately noting Pi's built-in `/` menu. When adopting a package, **disable its commands
we don't use** via `pi config` / package resource filtering and set the
`enableSkillCommands` posture deliberately. Audit `/` each phase; if it's growing
cryptic, consolidate.

**Current Prime-owned package surface (updated 2026-07-08):** exactly one skill
command, `/skill:prime-ui`, from `skills/prime-ui/SKILL.md`, plus exactly one
Prime extension slash command, `/prime`, from `extensions/prime-command.ts`.
Prime ships no prompt templates. Pi may still discover user-global skills from
`~/.pi/agent/skills` or `~/.agents/skills`; a project package cannot suppress
those global resources. Prime's invariant is that the **Prime package
contributes one skill command plus one consolidated control command**.

| Surface (preferred order) | Features that live here |
| --- | --- |
| **Automatic / native behavior** (no UI) | multi-provider, security/egress, CGS-challenge, stopping-criterion, recap table, doc-discipline, catalog-first, quality-bar, adversarial **default-on for meaningful work**, verification loop, **default chains (scout-flow)**, **per-role model/effort/instance matrix** (config), **neutral role IDs + optional local aliases** (display), **universal run caps** (token/iter/stop), **worktree-first for implementation/multi-agent work** (`--no-worktree` / in-place for read-only and tiny/simple edits) |
| **Lifecycle hooks** (no UI) | yolo-fence (`tool_call`), principle injection, doc-drift nudge |
| **Tools** (model-callable, not in `/`) | pi-web-access, `\answer` resolver, pi-messenger (`agent_send`/`agent_request`) |
| **Keyboard shortcuts / status-bar toggles** | live-shell verbose toggle, status-bar widgets, **live pipeline view** (renderer/widget), Neovim Ctrl+G, model/thinking cycle |
| **Slash commands** (keep this list SHORT) | target set ≈ `/plan`, `/worktree`, `/adversarial [off]`, `/statusbar`, `/remote-pi`, `/annotate`, `/ship` (pre-PR gate chain) (+ `/answer` only if a manual entry is wanted) plus the single Prime-owned skill command `/skill:prime-ui`. Everything else stays off `/`. **Watch the budget — this is now ~8-9; consolidate if it creeps.** |

---

## 7. Requirements brainstorm — CGS assessment

Source: 15-agent research+adversarial workflow (2026-06-27). Verdicts are the
**post-challenge** recommendation. `Native?` = does Pi already do it (§5).
Verdict legend: **CORE** = adopt as core · **OPT** = adopt optional/opt-in ·
**DEFER** = revisit on real signal · **SKIP** = don't.

### Theme A — Providers & model strategy
| Idea | Native? | Verdict | One-liner |
| --- | --- | --- | --- |
| Multi-provider — **OpenAI (sub), Claude (sub), OpenRouter, Azure Foundry, GitHub Copilot** | built-in | **CORE** | The maintainer's must-have provider set (clarified 2026-07-01; **Copilot corrected back to must-have 2026-07-03**): OpenAI/ChatGPT subscription, Claude subscription, OpenRouter, Azure AI Foundry, GitHub Copilot — all Pi-native. Config work = one `models.json` block for *non-OpenAI* Azure Foundry deployments. **GitHub Copilot is must-have** (native OAuth/subscription provider); as of 2026-07-04 `pi --list-models github` exposes Copilot models here, but no Copilot model call has been run. Copilot is **not** eligible for Phase-3 `no-spend-test`; any personal/maintainer Copilot test must use a current pinned eligible model, with `github-copilot/gpt-5-mini` the current cheapest Pi-visible candidate (GitHub's pricing page lists cheaper `GPT-5.4 nano`, but Pi does not expose it here yet). OpenRouter tests must use only `:free` model IDs; a native Pi OpenRouter `:free` call passed via `tools/smoke/openrouter-free-smoke.sh`. Public `google` default disabled; lockdown mode pins to an allowlist (§2 Security). **Cross-family adversarial (Theme B) is satisfiable — ≥3 model families reachable.** Claude-sub mechanism: see §9-Q4; subscription/policy behavior remains gated by the Phase-0 live-billing spike. |
| **Fusion-style multi-model deliberation** (DIY panel → judge → synthesis) | partial | **CORE (Phase 3) — spec-gated; hosted adapter OPT** | The **Fusion-style dispatch concept is CORE Phase-3 architecture**: a parallel model **panel** → structured **judge/comparison** → final **synthesis/action**, built on the shared dispatch substrate (= the per-role model/effort/instance matrix + adversarial debate, Theme B / Theme J), using **approved providers only**. Stage 3A expanded `docs/architecture/fusion-dispatch-research.md` from a research note into the build-spec gate: provider/cost profiles, role envelopes, task routing, judge-bias mitigations, failure behavior, public-safe logging, fixtures, and no-spend OpenRouter `:free` testing are specified. The judge is never final authority; objective gates decide. The **hosted `openrouter/fusion` model** is a separate, **optional adapter, disabled by default** (add to the `--models` cycle) — privacy/provider-policy gated because it is web-search-enabled and routes prompts to 3rd-party frontier models; **no unapproved OpenRouter fan-out in lockdown/corporate mode**. |
| Model tiering (max model for plan, cheaper for exec) | partial | **OPT** | Principle is gold-standard; an *automatic routing* extension is premature — mechanism (mid-session model swap) is unverified. Start with manual `provider/id:thinking` + `--models`. |
| Consortium: 2× models for plan/review | none | **CORE (folded into the Fusion-style Phase-3 dispatch)** | The consortium/Fusion-style **panel → judge → synthesis IS the CORE Phase-3 architecture** — custom-built on the per-role model/effort/instance matrix + adversarial substrate (Theme B/J), not a separate always-2×-every-task build. Bounded by the per-run token budget; cross-family encouraged. |

### Theme B — Multi-agent orchestration
| Idea | Native? | Verdict | One-liner |
| --- | --- | --- | --- |
| **implement → objective-gate → review → fix loop** | none | **CORE** | The true anchor: only item grounded in an OBJECTIVE signal (tests/lint/typecheck). Gate is PRIMARY termination; LLM reviewer secondary. Ship as a lightweight skill first. |
| Adversarial mode → **multi-team debate (opposing + collaborating models), first-class for meaningful work** | partial | **CORE (scoped default-on)** | **Reconciled 2026-07-02 from the 2026-07-01 planning ratification:** default-on for meaningful work — plans, reviews, risky changes, security, architecture, and PR preflight. Users can opt into every-task or heavier 3+ model runs. Opposing teams + collaborating models run on the shared dispatch substrate (Theme B). **Correctness/safety rails (NOT skips):** cross-*family* models required (diversity drives gains — arXiv 2511.07784), convergence = diff-stability + **objective-gate-pass** (never a cheap LLM judge), per-run **token budget cap** + max-iter to bound runaway, `/adversarial off` to disable per-task. **Concrete defaults (user-configurable, set 2026-07-01): max 5 iterations (primary); backstop $100 OR 10M tokens per run, whichever trips first.** Aggregate session/daily ceiling lives with unattended jobs (Theme J autonomous loop), where it is load-bearing. |
| Reproduce "Ultracode" / dynamic workflows | partial | **DEFER** | The novel part (auto-*writing* a bespoke JS orchestration per task) is the expensive cargo-cult trap. Build the de-risked components (loop, dispatch) first; revisit a templated `/workflow` later. |
| Multi-agent parallel dispatch | partial | **OPT** | Fork `examples/extensions/subagent/`; scope to *embarrassingly-parallel* jobs. Anthropic's own writeup: coding has few truly parallelizable subtasks. |
| Agent teams (Scout/Planner/Builder/Reviewer/Documenter/Red-team) | partial | **OPT** | Ship a LEAN default (Builder + independent-provider Reviewer) as markdown agent files; let users ADD roles. A 6-role org chart is structure-theater. |

### Theme C — Knowledge base & documentation
| Idea | Native? | Verdict | One-liner |
| --- | --- | --- | --- |
| Pi-Obsidian + Graphiti KG + Obsidian CLI knowledge base | partial | **SKIP** | Obsidian is human-GUI-centric, dead-on-arrival for an agentic CLI; Graphiti is heavy infra. Use committed curated markdown (architecture/assumptions/state) via AGENTS.md loading. |
| Always generate ROADMAP.md (store/link plans) | partial | **OPT** | Strike "always" — auto-scaffolding ceremony into throwaway repos is cargo-cult. A `roadmap` skill on demand. (This repo legitimately has one.) |
| ROADMAP milestones + `plan/` dir of per-plan md | partial | **OPT** | Slim plan template + linking index. Do **not** force plans into MADR/ADR append-only ledgers — plans are revised, not immutable decisions. See §9-Q5. |
| CHANGELOG.md (all changes, live, timestamped) | none | **OPT** | Per-change timestamps are redundant with `git log`. Keep-a-Changelog *only if* the project has releases + external audience. |
| Always update ALL markdown when touching code | partial | **CORE** | Already the user's standing order (discipline = core). But a "code-changed-but-no-md" *hook* is **rejected** — fires on legit refactors, trains alarm-fatigue, can't judge doc-relevance. Behavior, not gate. |
| Never ship a change undocumented in plan.md | partial | **DEFER** | Redundant with the contract's "trace to a source of truth", and as worded *narrows* it harmfully (forces plan.md even when a test/spec is the better SoT). |
| HTML output with navigable index | partial | **DEFER** | "Replacing markdown" = anti-pattern (**SKIP**). "Parallel generated HTML site" (MkDocs/Docusaurus from md) is fine later; `--export` already gives per-session HTML. |
| HTML theming — pluggable kit (Rose Pine default) | partial | **DEFER (rides on the row above)** | If/when HTML output lands: ship **one** good default (Rose Pine variant) + a single `htmlTheme` config path to point at a custom CSS/Bootstrap kit. **Resist building a theming *engine*** — one default + one override path is the whole feature. Dead until HTML output is decided. |
| Pi TUI theming — Rose Pine default | built-in | **CORE (M0a resource package)** | Pi has native themes, but only detects terminal light/dark mode; it does **not** import the terminal palette. Prime now vendors audited Rose Pine theme JSON as `prime-rose-pine`, `prime-rose-pine-moon`, and `prime-rose-pine-dawn`, selects `prime-rose-pine` in `.pi/settings.json`, and preserves the upstream MIT license. |

### Theme D — Process discipline & frameworks
| Idea | Native? | Verdict | One-liner |
| --- | --- | --- | --- |
| CGS challenge-back (find gold standard, challenge divergent asks) | partial | **CORE** | Discipline is core, already auto-loaded via AGENTS.md/CLAUDE.md. Optionally pin to `APPEND_SYSTEM.md`. ~zero build. |
| Clear stopping criterion; ask back if unclear; push back on test-less scripting | partial | **CORE** | Calibrate to "test OR UI OR explicit acceptance" (fixes the contract's TDD-default). Discipline, not a hook. |
| Dumbed-down recap (table) after changes | partial | **CORE** | Already verbatim in global CLAUDE.md — net no-op, nothing to build. |
| Operating Contract / gold-standard principles — auto-load vs pin? | built-in | **CORE** | Tiered: full `AGENTS.md`/`CLAUDE.md` contract auto-loaded; pin only true non-negotiables to `APPEND_SYSTEM.md` if runtime evidence ever shows the loaded contract can drift. Compaction was verified by code in §9-Q6 and does not summarize context files. |
| Plan-mode states CGS-first + alternatives | partial | **OPT** | Pure prompt-template work on the plan-mode extension; consolidate into ONE plan-template block (CGS + alternatives + "Done when:") to avoid 3 competing appended sections. |
| Superpowers / best-practice superset | partial | **OPT** | Curate only the disciplines NOT already in the contract (TDD gate, bite-size plan template). **Exclude** its worktree + delete-pre-test-code skills (conflict/anti-pattern). |
| Plan mode always max effort + top model | partial | **OPT** | De-escalate to "default-high thinking, override allowed"; no model-pinning up front. |
| Babysitter supervisor layer | partial | **DEFER** | Pi natively provides every primitive it needs (session resume, tool_call block, lifecycle events). Only if a concrete *unattended long-run* use case appears. |

### Theme E — Execution environment, safety & UX
| Idea | Native? | Verdict | One-liner |
| --- | --- | --- | --- |
| **Yolo-by-default + fence irreversible ops** | partial | **CORE** | Highest value/effort. `tool_call` + `ctx.ui.confirm`, tunable denylist (push/force/merge/branch -d, rm -rf, repo create, deploys, db drops, outbound sends). **Fail CLOSED in non-TTY.** Sell as defense-in-depth, not containment. |
| Git worktree default scope (worktree-native where it pays) | none | **CORE** | **Reconciled 2026-07-02 from the 2026-07-01 planning ratification:** worktrees are default for implementation and multi-agent work; in-place is allowed for read-only reviews and tiny/simple edits. Earlier 2026-06-30 "worktree-first by default" remains the implementation/multi-agent default, but it is no longer forced for every interaction. **Documented tradeoff:** forced isolation taxes the single-task path (`.env`/`node_modules` provisioning, abs-path breakage) — the manager MUST handle provisioning + prune-on-exit so the default doesn't rot. Catalog-first the manager (worktrunk/treehouse) — see Theme J. |
| Voice input (OpenWhispr) | none | **OPT — OUT of the Pi build** | ✅ Confirmed 2026-07-01: this is a **program install + OS-level shortcut mapping**, not a Pi extension — the CGS call is *don't rebuild OS dictation*. **Ship nothing in-build**; document the setup (install OpenWhispr, map a push-to-talk shortcut; it types into pi via stdin). **Constraint (Principle 0 / lockdown): local Parakeet/Whisper only; cloud-BYOK forbidden.** Reference doc only, no code, no `/` surface. |
| Live shell calls + output toggle | partial | **OPT** | Pi TUI already shows tool calls+output; marginal product is just *more/streamed*. Last; verify `tool_execution_update` stdout granularity first. |
| Lock in AGENTS.md as entry point | built-in | **CORE** | Native + canonical. **Precedence resolved by code (M0a):** Pi loads the first match of `AGENTS.md`/`AGENTS.MD`/`CLAUDE.md`/`CLAUDE.MD` per directory, so `AGENTS.md` shadows a same-dir `CLAUDE.md` (both carry the equivalent contract here, so it stays in context). Pi's global context dir is `~/.pi/agent`, not `~/.claude`. §9-Q6. |
| `\answer` command | partial | ✅ **RESOLVED → Theme I** | Intent recovered 2026-06-27: an **interactive multi-CGS resolver** (top rec + ranked alternatives, user picks, chained, returns to agent). See Theme I. |

### Theme F — Context & token economy
| Idea | Native? | Verdict | One-liner |
| --- | --- | --- | --- |
| Ponytail (token-saver) | partial | **SKIP** | Its content ("write minimal code, prefer stdlib") is already in the contract — a few SYSTEM.md lines, not a plugin. |
| Headroom (input compression) | partial | **DEFER** | Only behind a falsifiable, workload-specific token+quality measurement showing prime's loops are input-bound. |
| Auto-compact after 50% context | built-in | **SKIP** | Pi auto-compacts natively. "50%" is a cargo-culted Claude-Code UI convention, not a context-economy model. Tune `reserveTokens`/`keepRecentTokens` if needed. |
| Clear context between plan & implement | partial | **CORE** | Practice is gold-standard: persist distilled plan to `PLAN.md`, then `/new`. Compose natives; no bespoke handoff automation. |

### Theme G — Remote control & catalog discipline (added 2026-06-27)
| Idea | Native? | Verdict | One-liner |
| --- | --- | --- | --- |
| **Catalog-first: search Pi's Package Catalog before building; pick by measurable quality** | built-in (catalog exists) | **CORE** | `pi.dev/packages` over npm `keywords:pi-package` (~4,482 pkgs); deterministic search→rank→bar in §5. Now a mandatory gate (§2.1). |
| **Remote control: concentrate multi-device, multi-model sessions** | none (but catalog has it) | **CORE (blocked lead candidate: `remote-pi`)** | **RATIFIED 2026-06-27: E2E remote control over web reach.** `remote-pi` is the lead candidate because it advertises native mobile + desktop Cockpit, fleet/mesh multi-session, per-session model picker, E2E WebSocket relay (sees only metadata), and Ed25519 QR pairing. **Blocked until audit clears:** the current package (`remote-pi@0.5.3`, rechecked 2026-07-02) depends on `@earendil-works/pi-coding-agent` `^0.78.0`, which does **not** cover installed Pi `0.80.3`; block until compatibility is proved or upstream widens. The audit must also verify source/protocol docs, relay visibility, daemon/scheduler behavior, dependencies (`@modelcontextprotocol/sdk`, keyring, WebSocket, scheduler), and packet-trace/no-exfil evidence before any install. Substrate: `--mode rpc` (`set_model`/`get_state`/`prompt`/`steer`). |
| Web/browser remote surface | none | **DEFER** | User chose E2E (`remote-pi`) which has **no web client** — browser access consciously traded away for encryption. If a browser surface later becomes a hard need: either a web client on remote-pi's relay protocol (~1–2 wks) or a chat bridge (`@llblab/pi-telegram`/`pi-messenger-bridge`), accepting SaaS transit. |
| Remote-control security posture | — | **CORE constraint** | Remote control = **RCE** on the dev box. ⇒ yolo-fence is a hard prerequisite; tool-permission prompts route to the device, never auto-approve; pair/allow-list devices. `remote-pi`'s E2E relay (chosen) avoids any third-party SaaS seeing plaintext. |

### Theme H — Status bar & quality bar (added 2026-06-27)
| Idea | Native? | Verdict | One-liner |
| --- | --- | --- | --- |
| **Codex-style configurable status bar** (user picks which toggles/settings show; select → Enter → persisted) | partial | **CORE (catalog-first, then build)** | Pi has a native status bar + `ctx.ui.setStatus`/`setWidget` + `registerShortcut`. Need: a config picker (multi-select of available toggles — model/thinking/plan/fence/worktree/session/tokens — persisted to settings) + renderer. **Run the catalog gate first** (search `status`/`statusbar`/`statusline`); build only if nothing qualifies. |
| **Maximally well-tested, incl. edge cases** | n/a | **CORE (definition of done)** | Every shipped extension: unit tests for handlers + explicit edge/boundary/failure-mode tests + CI gate; add an e2e `pi` load smoke when Pi exposes a no-provider/no-auth proof path for that surface. Where Pi 0.80.3 cannot prove headless visibility, document the limitation instead of overclaiming. See §8 Quality Bar. |

### Theme I — Agent tooling & integrations (added 2026-06-27; metrics measured this date)
| Idea | Native? | Verdict | One-liner |
| --- | --- | --- | --- |
| **Tool / function calling** | built-in | **CORE (native — VERIFIED 2026-07-03)** | Pi is built on it: 7 built-in tools (`read`/`bash`/`edit`/`write`/`grep`/`find`/`ls`), `pi.registerTool` (TypeBox schema), **parallel exec default-on**, `--tools`/`--exclude-tools`/`--no-builtin-tools`/`--no-tools` gating. **Verified against installed Pi `0.80.3` docs** (`reviews/m0a/pi-internals-2026-07-03.md`); nothing to build. |
| **Web access for the agent (`pi-web-access`)** | none (catalog) | **CORE (lead candidate pending audit)** | **`pi-web-access`** is the lead candidate based on dated prefilter metrics from 2026-06-27 (**33,797 dl/wk, 706★, MIT, active**): web search + URL fetch + GitHub clone + PDF + YouTube. Do not install until source/license/install-script/dependency/no-exfil/command-surface/Pi-compat audit clears and raw metrics are captured under `reviews/package-audits/`. |
| **Neovim integration** | partial | **DEFER (not coupled to Pi)** | **Moved out of M1/Phase 1 on 2026-07-03.** Neovim and Pi do not need to ship together. Native **Ctrl+G** already opens `$EDITOR`/nvim for prompt editing, which is enough for now. **`pi-nvim`** remains candidate-only for later evaluation; current npm metadata (`pi-nvim@0.2.4`, rechecked 2026-07-02) peers on `@earendil-works/pi-coding-agent` `^0.74.0`, which does **not** cover installed Pi `0.80.3`. Do not install until compatibility and the full package audit clear. |
| **`\answer` — interactive multi-CGS resolver** | partial | **CORE (build thin)** | Resolves the earlier "forgotten intent" (Theme E). When >1 valid gold standard exists (circumstantial — e.g. Apple Containers vs Docker vs Podman), present a **TOP recommendation + ranked alternatives**; user picks (chained questions possible), returns to the agent. Built on native `ctx.ui.select`/`ask_question`. Extends CGS-challenge (Theme D). |
| pi-annotate — annotate UI/design mockups | none (catalog) | **OPT (lead candidate pending audit — §9-Q8 RESOLVED)** | ✅ 2026-07-01: user meant **annotating UI/design mockups** → **`pi-annotate`** is the lead candidate based on dated prefilter metrics (263★, MIT — inline note cards / design annotation). **Plannotator DEFERRED** (interactive *plan* review is a different job, not requested). Full package/no-exfiltration audit before adoption. |
| pi-messenger — inter-agent comms + file reservation | none (catalog) | **OPT (Phase 3)** | `pi-messenger` (618★, MIT) inter-agent messaging + **file reservation** — useful substrate for the default-on multi-team debate (coordination + parallel-edit safety); comms visualization is a bonus. |
| pi-file-widget | n/a | **FOLD → Theme H** | No `pi-file-widget` on npm; the concept (session-touched-files widget + inline diff) exists as `@xynogen/pix-diagnostics` (16★), `@agnishc/edb-diff-files`. Treat as a status-bar/widget option. |

### Theme J — Agent identity, orchestration UX & autonomous loops (added 2026-06-30)
| Idea | Native? | Verdict | One-liner |
| --- | --- | --- | --- |
| Neutral role IDs + optional user-local aliases | none | **CORE (cheap, display-only)** | Shipped defaults use stable neutral role IDs (`Scout`/`Planner`/`Builder`/`Reviewer`/`Documenter`/`RedTeam`) in logs, tests, pipeline state, docs, and config. User-local aliases/theme packs may display fun names (`Scout · Red Five`, etc.) only as cosmetic local config unless a legal/trademark rationale is added. Never let the alias be the only handle — it breaks grep/tests/determinism. |
| **Per-role model / effort / instance-count matrix** (e.g. RedTeam = Opus 4.8 Max + GPT-5.5 xhigh simultaneously; Review on 3 models) | none | **CORE (config, budget-bounded)** | Generalizes the consortium/Fusion-style panel→judge→synthesis idea (the CORE Phase-3 dispatch, Theme A) into a roles table `role → [{provider/model, effort, instances}]`, scalable to N instances per role. **Cross-family encouraged for RedTeam** (diversity is the whole point — same finding as Theme B). **The hard global per-run token budget is load-bearing** — N instances × M roles × debate rounds is exactly the runaway case; the cap (Theme F caps below) bounds it. Surface = config, **not** new slash commands. |
| **Default agent chains** (scout-flow: scout→scout→scout = explore/validate/verify) on top of the loops | none (subagent example has chain mode) | **CORE (thin, config)** | The implement→gate→review→fix loop is already a chain; add a small **chain registry** with a few named defaults built on `examples/extensions/subagent/` chain mode. Chains are **behavior/config, not commands** (protects the `/` budget). |
| **Live pipeline view** — tiles per stage (running/pending), elapsed, token [in,out], current named task, multi-instance | partial (TUI + renderer) | **OPT (feasibility-flagged)** | Strong orchestration observability for multi-agent/team runs: `Planner→RedTeam→Builder→…` tiles showing where the pipeline is. **Unverified:** whether `registerMessageRenderer` / `@earendil-works/pi-tui` supports a live-updating custom view, and whether **`pi-messenger` already renders this** (check before building). Surface = renderer/status-bar widget, not a command. |
| **Pre-PR gate chain + conservative local PR proxy prototype** (no-mistakes: Intent→Rebase→Review→Test→Document→Lint→Push→PR→CI + commit-reorg + risk assessment) | partial | **OPT (prototype proxy, defer unbypassable interceptor)** | The **gate *sequence* is canonical release hygiene** and largely *is* our review loop + doc discipline; adopt as a named "ship" chain (runs from clean context after changes; reorganizes commits; preps the PR). Build/evaluate a conservative fail-closed local PR proxy prototype because the 2026-07-01 planning ratification selected the local-proxy direction. Continue deferring a heavier unbypassable push interceptor unless later evidence shows hook/proxy bypass is a real problem. Catalog-first vs build native. |
| **Universal run caps** (gnhf: token cap, iteration cap, explicit stop condition) | partial | **CORE (guardrail — fold into Theme F/B budget)** | Not a separate feature — these caps are the **runaway rails our CGS-seeking loops need** (Pi will loop hard until the gate passes). Token budget + max-iter + a checkable stop condition are already required by Theme B/F; this just confirms them as universal and non-optional. **The session/daily AGGREGATE spend ceiling belongs HERE, not on interactive adversarial** (clarified 2026-07-01): it's load-bearing only for unattended jobs where no user is present to Ctrl-C. |
| **Autonomous experiment loop** (gnhf / Karpathy auto-research: hypothesis→test→measure→iterate on a metric, e.g. e2e coverage) | none | **OPT/DEFER (opt-in, hard-capped)** | Legitimate for test-coverage/perf optimization, but it's the canonical unattended-cost/runaway risk. **Opt-in mode only, never default**, governed by the universal caps above **plus a mandatory session/daily aggregate spend ceiling** (this is the workflow the ceiling exists for — clarified 2026-07-01). gnhf + Karpathy auto-research collapse into this one item. |
| **Worktree manager** (source-pinned candidates — create/list/prune) | none | **CORE (lead candidate pending audit or build minimal)** | Worktrees are default for implementation and multi-agent work (§9-Q1). **Source-first eval:** `worktrunk` is not an npm package and npm `treehouse` is an unrelated SPA framework (rechecked 2026-07-02), so pin exact source URLs before auditing; compare those tools vs a pi-native extension/minimal local build. **Just the basics** — create / list-in-use / prune-unused + provisioning + prune-on-exit. No fancy. |
| **firstmate-style "one front, many agents" orchestrator** | none | **DEFER (eval, likely compose)** | Pi ships **no sub-agents natively**, so orchestration is always a layer we add. No single package likely covers *named multi-instance teams + per-role model/effort + live pipeline tiles* — that combo is bespoke. Likely outcome: **compose** `pi-messenger` (transport/visualization) + a thin orchestration layer, not adopt firstmate whole. Catalog-eval before deciding. |

---

## 8. Decided commitments (user mandates, ratified or near-ratified)

### MVP tier — core feature set, with Neovim/Pi integration deferred

**Clarified:** "minimal" does **not** mean a narrow product. It means a
**minimal command surface** (principle 6, §6 Command-surface budget): the `/` menu
stays short and legible; most features land as native behavior / hooks / shortcuts /
tools, not slash commands. The non-negotiable floor (security/egress, testing,
catalog-first, multi-provider, AGENTS.md, core doc discipline) underlies all milestones.

Milestones are **build order only** (not a scope cut — everything is committed):

| Milestone | Features | Maps to |
| --- | --- | --- |
| **M0 — Thin usable vertical slice (staged)** | **M0a:** evidence refresh + command/context truth · security defaults + named lockdown boundary · providers · AGENTS.md entry · native tool-calling smoke. **M0b/M0c:** plan/answer path · thin manual adversarial review · status visibility · raw worktree flow · PR-gate checklist. | M0a = Phase 0; remaining M0 slices land as Phase 1–2 prerequisites become available |
| **M1 — Daily-driver core** | yolo-fence · **worktree manager** (default for implementation/multi-agent work, §9-Q1) · implement→gate→review→fix loop · plan-mode + CGS-first + plan/implement separation · `pi-web-access` lead candidate · `\answer` resolver · configurable status bar | Phase 1–2 |
| **M2 — Orchestration** | parallel dispatch · agent teams (Builder+Reviewer, neutral role IDs + optional aliases) · **per-role model/effort/instance matrix** · **default chains** (scout-flow) · adversarial/multi-team (default-on for meaningful work) · **live pipeline view** · `pi-messenger` (inter-agent + file reservation) | Phase 3 |
| **M3 — Remote & review UX** | `remote-pi` lead candidate after fence + compat audit · `pi-annotate` lead candidate (§9-Q8) · **pre-PR gate chain** (no-mistakes; conservative local proxy prototype) · live-shell verbose toggle · CHANGELOG + `plan/` traceability | Phase 1 (remote) + 2 |

> **New (2026-06-30) requirements beyond the original 16 — placed by CGS verdict (Theme J/E/C):**
> the orchestration cluster above is M2/M3; **OPT/DEFER** items live in Phase 4 — Neovim/Pi
> integration (`pi-nvim`), voice (OpenWhispr, local-only, no build), the autonomous experiment loop (gnhf/Karpathy,
> opt-in + hard-capped), firstmate-style orchestration (eval/compose), and HTML theming
> (rides on the deferred HTML-output decision). Universal run caps (token/iter/stop) are
> folded into the existing per-run budget, not a separate feature.

> **Recommended starting slice = M0a.** Start with evidence refresh + security/provider
> foundations, then grow into the thin vertical path. Thin adversarial review means a
> manual second-provider review pass until Phase 3's substrate exists; worktree flow
> means raw `git worktree` + checklist until Phase 1's manager exists; PR-gate entry
> means a checklist until Phase 2's `/ship` chain exists. Every milestone ships with
> its tests + egress check (Quality Bar), and an **`/`-menu audit** (principle 6),
> before the next starts.



- **Multi-provider is mandatory and mostly free** — the maintainer's must-have set
  (clarified 2026-07-01; **Copilot corrected back to must-have 2026-07-03**):
  **OpenAI (subscription), Claude (subscription), OpenRouter, Azure Foundry, GitHub Copilot**
  — all Pi-native; one `models.json` block for any non-OpenAI Azure Foundry deployment.
  **GitHub Copilot is must-have** too (native OAuth/subscription provider) — as of
  2026-07-04, `pi --list-models github` exposes Copilot models here, with no model calls
  made. Copilot is **not** eligible for Phase-3 `no-spend-test`; personal/maintainer
  Copilot tests require a current pinned eligible model (currently
  `github-copilot/gpt-5-mini`; re-check if `GPT-5.4 nano` becomes visible). Use only
  OpenRouter `:free` models in no-spend tests. Azure Foundry remains postponed until the work deployment is
  available. **Claude CLI dispatch is only a
  repo-owner-local candidate path pending
  a Phase-0 wrapper/policy spike (§9-Q4):** Pi docs warn that native Anthropic OAuth may
  incur third-party-harness extra usage, while current Anthropic support docs create a
  conflicting plan-limit/API-separation picture. Re-verify with live account/policy
  evidence before treating any Claude path as a cost foundation. Public/corporate builds
  must remain valid under API-key/gateway/per-token economics. **OpenAI stays native Codex OAuth**
  (that one uses the ChatGPT subscription path).
- **AGENTS.md is THE context entry point** — precedence is code-resolved (M0a):
  `AGENTS.md` shadows a same-dir `CLAUDE.md` (first-match, one per directory), and
  Pi's global context dir is `~/.pi/agent`, not `~/.claude` (§9-Q6).
- **Yolo-by-default preserved**, fenced by a small `tool_call` confirm for
  irreversible/high-blast-radius ops; documented as defense-in-depth with a path
  to OS sandboxing as the real boundary.
- **implement → objective-gate → review → fix** is the orchestration anchor; the
  objective gate (tests/lint/typecheck) is the PRIMARY termination signal.
- **Doc discipline** per the global contract: update related markdown in the same
  change, end with the File/What/Why recap table, state the CGS and challenge
  divergent requests, demand a checkable stopping criterion. Behavior, near-zero build.
- **Plan→implement context separation** via native primitives (plan-mode example +
  `PLAN.md` + `/new`); distilled plan carried forward, no bespoke automation.
- **Gold-standard principles load tiered**: full `AGENTS.md`/`CLAUDE.md` contract auto-loaded;
  only true non-negotiables pinned to `APPEND_SYSTEM.md`.
- **Security & data-sovereignty (NON-NEGOTIABLE, top priority).** Corporate-usable,
  egress-restricted: **nothing leaves the boundary unapproved.** Telemetry OFF
  (`PI_OFFLINE=1` / `--offline`, `PI_SKIP_VERSION_CHECK=1`, `PI_TELEMETRY=0`,
  `enableInstallTelemetry=false`; provider attribution headers treated as metadata
  egress); every package passes a no-exfiltration audit; model traffic only to
  approved/self-hosted endpoints (Azure Foundry / internal gateway / local), never
  the public default `google` provider; secrets local-only; egress is tested inside
  a named OS/network/container boundary. See §2 Security callout.
- **Prime package resource surface is intentionally narrow** — exactly one Prime-owned
  skill command (`/skill:prime-ui`), one consolidated control command (`/prime`),
  the Prime Rose Pine themes, and three pinned extension entrypoints
  (`prime-fence`, `prime-answer`, `prime-command`). User-global Pi skills remain
  a separate Pi discovery surface; Prime does not claim a project package can hide
  resources it does not own.
- **Tool / function calling is native** — confirm in Phase 0; nothing to build (§7-Theme I).
- **Web access via `pi-web-access`** (lead candidate pending audit) — its outbound
  fetches are reviewable egress: allow only via approved proxy/allowlist in corporate
  mode (§7-Theme I).
- **Neovim/Pi integration is deferred** — Neovim remains useful independently, and
  native Ctrl+G already opens `$EDITOR`/nvim for prompt editing. Do not couple M1/Phase 1
  to `pi-nvim`; revisit only as a Phase 4 candidate after compatibility and package audit clear (§7-Theme I).
- **`\answer` interactive multi-CGS resolver** — when >1 gold standard is valid
  (circumstantial), present top rec + ranked alternatives; user picks (chained),
  returns to agent. Thin build on native `ctx.ui.select` (§7-Theme I, extends Theme D).
- **Catalog-first is a mandatory gate** — before building anything, search Pi's
  Package Catalog and promote the highest-quality measurable match to lead candidate
  only after it clears source/license/install-script/dependency/Pi-compat/no-exfil/
  command-surface audit (§2.1, §5 "Catalog-first gate"). Build bespoke only when
  nothing qualifies.
- **Remote control via `remote-pi`** (lead candidate pending audit/compatibility) —
  **ratified for E2E encryption** over web reach: native mobile + desktop Cockpit,
  fleet/multi-session, per-session model picker (§7-Theme G, §9-Q7). No web client
  (consciously deferred). **Enabling it requires Pi `0.80.3` compatibility proof, the
  yolo-fence, and device-routed approvals** (remote = RCE).
- **Adversarial/multi-team debate is first-class and default-on for meaningful work**
  (plans, reviews, risky changes, security, architecture, PR preflight) — opposing +
  collaborating models, cross-family required, objective-gate convergence, with a
  per-run token-budget cap + max-iter as runaway rails and `/adversarial off` per-task
  (§7-Theme B, §9-Q2). Explicit every-task or heavier 3+ model runs remain user opt-in.
- **Configurable Codex-style status bar** — user selects which toggles/settings to
  show; built on Pi's native status bar + `setStatus`/`setWidget` after a catalog check (§7-Theme H).
- **Quality Bar (definition of done):** nothing ships without comprehensive tests —
  unit tests for handlers, **explicit edge/boundary/failure-mode cases**, and a CI
  gate; add a `pi` load smoke when Pi can prove that surface without provider/auth
  side effects, otherwise document the limitation. Test behavior not implementation;
  mock only at boundaries; a red test is a finding, never deleted.
- **Worktree default is scoped** — default for implementation and multi-agent work;
  in-place is allowed for read-only reviews and tiny/simple edits. This preserves the
  later 2026-07-01 planning ratification while retaining the 2026-06-30
  worktree-first implementation default (§9-Q1).
- **Claude native OAuth remains the fallback with explicit policy/cost warning**;
  `claude` CLI dispatch is a repo-owner-local candidate pending the Phase-0 wrapper/policy
  spike and must not be treated as the public/corporate cost foundation (§9-Q4).

## 9. Open decisions

| # | Decision | Resolution |
| --- | --- | --- |
| Q1 | **Worktree posture** — literal "always-default" vs opt-in? | ✅ **RECONCILED 2026-07-02: worktrees are default for implementation and multi-agent work; in-place is allowed for read-only reviews and tiny/simple edits.** This preserves the 2026-06-30 "worktree-FIRST" implementation default, but supersedes any every-interaction wording with the later 2026-07-01 planning ratification. The CGS caveat (forced isolation taxes the single-task path) is preserved as a **documented tradeoff**: the manager must own provisioning + prune-on-exit so the default doesn't rot. |
| Q2 | **Adversarial / multi-team debate** — opt-in vs first-class default-on? | ✅ **RECONCILED 2026-07-02: default-on for meaningful work** — plans, reviews, risky changes, security, architecture, and PR preflight. Explicit every-task or heavier 3+ model runs are user opt-in. This supersedes earlier every-task wording with the later 2026-07-01 planning ratification. Opposing + collaborating models; cross-family required; convergence = diff-stability + objective-gate-pass; per-run token-budget cap + max-iter as runaway rails (not skips); `/adversarial off` per-task. **Caps (user-configurable, 2026-07-01): 5 iterations primary; $100 / 10M-token per-run backstop.** Aggregate session/daily ceiling lives with unattended jobs, §7-Theme J. |
| Q3 | **Reviewer independence** — same model fresh context vs different provider? | **Default adopted: user-configurable**, default same-model-fresh-context for routine, different-provider for high-stakes. (Revisit in Phase 3.) |
| Q4 | **Claude-subscription auth** — native OAuth vs `claude` CLI dispatch? | ✅ **RECONCILED 2026-07-02: `claude` CLI dispatch is a repo-owner-local candidate path, not the durable public/corporate cost foundation.** Pi's native Anthropic OAuth path carries `warnings.anthropicExtraUsage` and Pi docs warn about third-party-harness extra usage (`docs/providers.md:31`), while current Anthropic support docs describe Claude Code/Agent-style subscription usage differently and keep API Console billing separate. Therefore both native OAuth economics and first-party `claude -p --output-format stream-json` wrapper economics are **UNVERIFIED** pending a Phase-0 wrapper+policy spike with live account evidence. Public/corporate-shareable builds must remain valid under API-key/gateway/per-token economics. **Asymmetry:** OpenAI Codex OAuth stays native subscription path (`providers.md:26`). **Spike update (2026-07-03, no secrets read):** local **feasibility CONFIRMED** — the first-party `claude` CLI is installed (`2.1.200`, "Claude Code") and `codex` too, and Pi supports a custom-provider extension wrapping `claude -p --output-format stream-json` (`docs/providers.md:266`). **Economics SETTLED from docs** — `providers.md:31` states native Anthropic OAuth third-party-harness usage draws from *extra usage, per token, not against plan limits*. **Deferred (precise blocker):** the live-account billing probe (whether first-party `claude -p` actually rides the plan) needs a real billed call + current Anthropic policy read — not doable in a no-secrets/no-billed-call slice. **Decision unchanged, now evidence-backed:** native OAuth = fallback (warning on); first-party `claude` CLI dispatch = repo-owner-local candidate, not wired until the live probe runs. Detail in `docs/m0a/provider-and-egress-posture.md`. |
| Q5 | **Plan storage** — MADR ledger vs slim md + index? | **Default adopted: slim plan template + ROADMAP index**; reserve ADR/MADR for real architectural decisions. (Revisit when `plan/` is first created.) |
| Q6 | **Verify Pi internals first?** (compaction summarizing context files? AGENTS.md shadowing same-dir CLAUDE.md?) | ✅ **RESOLVED by code (M0a, 2026-07-03).** **Shadowing:** installed Pi `0.80.3` `dist/core/resource-loader.js` `loadContextFileFromDir()` first-matches `AGENTS.md`/`AGENTS.MD`/`CLAUDE.md`/`CLAUDE.MD`, one per directory; global dir = `~/.pi/agent`, not `~/.claude`. **Compaction:** context files are appended into the **system prompt** (`agent-session.js:669-680` → `system-prompt.js:24-30,102-108`), sent as a field separate from `messages` (`agent-session.js:244`); `compaction/compaction.js` **never** references the system prompt/context files — it summarizes conversation message entries only. ⇒ auto-compaction does **not** weaken the loaded contract; **no drift, no `APPEND_SYSTEM.md`** (evidence `reviews/m0a/pi-internals-2026-07-03.md`). A runtime confirmation smoke is optional, not required. |
| Q7 | **Remote control surface?** | ✅ **RATIFIED 2026-06-27: E2E remote control over web reach; `remote-pi` is the lead candidate pending audit/compatibility.** Native mobile + desktop; **no browser client** (deferred — revisit only if web access becomes a hard need). `remote-pi@0.5.3` depends on `@earendil-works/pi-coding-agent` `^0.78.0`, which does not cover installed Pi `0.80.3`; keep blocked/candidate-only until compatibility is proved or upstream widens. Enable only behind the fence + device-routed approvals. |
| Q8 | **"Front-end interactive design" annotation tool** — which package / what scope? | ✅ **RESOLVED 2026-07-01: `pi-annotate`** (263★, MIT — annotate UI/design mockups) — the user confirmed they meant **annotating UI/design mockups**, not plan review. **Plannotator DEFERRED** (interactive *plan* review is a different, unrequested job — revisit only if that need appears). No-exfiltration audit before adoption. |

---

## 10. Phases (detailed)

> **Two gates on every "build" task.** (1) **Catalog-first (§5):** if a qualifying
> package exists, promote it to lead candidate only after the full package audit and
> durable raw metrics capture; build bespoke only when nothing passes. (2) **Definition of Done (§8 Quality Bar):**
> nothing is "done" without unit tests + **explicit edge/boundary/failure-mode
> tests** + a CI gate; add an e2e `pi`-load smoke where Pi can prove the surface
> without provider/auth side effects, otherwise document the limitation. A phase's
> "Verify" line is the minimum, not the whole test suite.

### Stage execution strategy (adopted 2026-07-03) — one larger prompt per stage

M0a was executed as many small, single-purpose prompts. From here the roadmap is worked
in **larger, self-contained stage missions** — **one Claude prompt per stage** instead of
one per sub-task — because the sub-tasks within a phase share context (the same Pi
internals, security posture, and package audits), so re-establishing that context per
micro-prompt was the main overhead. The strategy, applied to every stage below:

- **One stage = one mission prompt.** Each carries the full read-first list, the authority
  grant, the required work items, and an explicit **acceptance-gate checklist** the run must
  satisfy before it stops. (This M0a-finalize mission is the template.)
- **Higher iteration caps.** A stage mission may run **up to ~12 internal fix/review
  cycles** (not a tiny patch budget), stopping **early** when the acceptance gates are met
  **or** a real security/architecture blocker is hit. This is an *execution* cap on the
  Claude loop — it does **not** loosen the §7-Theme B/§9-Q2 **runtime** adversarial caps
  (5 iterations, $100 / 10M-token backstop), which still bound spend inside prime's own loops.
- **Explicit acceptance gates.** Every stage names its gates up front (focused checks pass,
  no secrets/transcripts committed, docs updated in the same change, honest done/deferred
  status). "Verified," not "looks done," per the Operating Contract.
- **Phases 1 and 2 may be bundled.** Safety posture (Phase 1) and the verification core
  (Phase 2) can be delivered in one or two larger stage missions rather than strictly
  serialized, **to reach the Phase 3 orchestration destination sooner** — orchestration is
  the load-bearing goal, and the yolo-fence + worktree manager + implement→gate→review→fix
  loop are its prerequisites, not independent products. Bundling is a *build-order*
  acceleration only: it changes **nothing** about scope, the two gates above, or the
  Quality Bar — every bundled feature still ships with its tests + `/`-menu audit.
- **Scope is unchanged.** No planned feature is dropped by this strategy. Deferred items stay
  deferred (e.g. **Neovim/Pi integration** remains a Phase-4 candidate, §7-Theme I); OPT/DEFER
  items keep their triggers.

### Phase 0 — M0a: evidence refresh, security defaults, providers, entry point, first no-egress smoke
- [x] **Refresh evidence before building** — DONE 2026-07-03 via
      `tools/m0a/collect-evidence.sh` (offline by default; `--network` for candidate
      npm metadata). Pi `0.80.3`, package `@earendil-works/pi-coding-agent@0.80.3`, and
      the §4 docs/examples checksum are unchanged; §4 re-verified. Snapshot +
      refresh instructions in `docs/m0a/evidence-snapshot.md`.
- [x] **Correct Pi loading truth** — resolved and documented in
      `docs/m0a/context-and-project-trust.md`. **Settled:** the search path
      (`~/.pi/agent/AGENTS.md`, parent dirs, cwd), that context files load *regardless
      of trust* (`docs/security.md:27`), and `defaultProjectTrust` semantics (default
      `"ask"`; non-interactive `-p`/json/rpc do not prompt and fall back to it;
      `--approve`/`--no-approve` override). **Same-dir precedence is resolved by code:**
      installed Pi `0.80.3` `dist/core/resource-loader.js` `loadContextFileFromDir()`
      returns the **first** match of `["AGENTS.md","AGENTS.MD","CLAUDE.md","CLAUDE.MD"]`
      per directory, so `AGENTS.md` **shadows** a same-dir `CLAUDE.md` (one file per
      directory); "concatenated" (`README.md:320`) is across dirs. The global context
      dir is `agentDir` = `~/.pi/agent`, **not** `~/.claude` (that file belongs to the
      Claude Code harness and Pi never loads it). CI smoke must use `--approve` (with
      rationale) or trusted temp `-e` paths. The **compaction** sub-question of §9-Q6 is
      now **resolved by code** too (context files live in the system prompt, untouched by
      compaction — see the startup-header item below), so §9-Q6 is fully closed.
- [x] **Command-surface inventory** — DONE 2026-07-03. `docs/m0a/command-surface-inventory.md`:
      **prime-added surface = 0** (no extensions/skills/templates yet); Pi's `pi`
      subcommands recorded (`install`/`remove`/`update`/`list`/`config`); `pi config` is
      the command-trim lever. **Interactive `/` baseline CAPTURED from source** —
      `dist/core/slash-commands.js` `BUILTIN_SLASH_COMMANDS` = **22** built-ins, and
      `enableSkillCommands` default = **`true`** (`docs/settings.md:242`,
      `settings-manager.js:739`), so skills would add `/skill:<name>` to the budget.
      Evidence `reviews/m0a/pi-internals-2026-07-03.md`. (`/plan` is NOT a built-in — it
      comes from the plan-mode example extension.)
- [x] **Ship the initial Prime resource package surface** — DONE 2026-07-04.
      `package.json` declares the `prime-pi` package with exactly one Prime-owned skill
      (`./skills/prime-ui`), the local theme directory (`./themes`), and pinned
      extensions. Current Stage 3O manifest pins `./extensions/prime-fence.ts`,
      `./extensions/prime-answer.ts`, and `./extensions/prime-command.ts`.
      `prime-ui` is the
      renamed, consolidated replacement for the local `beast-ui` skill fanout: it folds
      the UI shaping/audit/layout/typography/copy/color/motion/polish/optimization
      workflow into one `SKILL.md`, so Prime contributes only `/skill:prime-ui`.
      Project `.pi/settings.json` points only at `../skills/prime-ui`, `../themes`, and
      the two extension files. `npm run check:resources` enforces the manifest,
      settings, skill count, theme surface, extension surface, and public-safety
      invariants. Boundary recorded in
      `docs/resources/README.md`: Pi may still load user-global skills from
      `~/.pi/agent/skills` / `~/.agents/skills`; hiding those requires a future
      source-verified policy extension or upstream Pi capability, not a package claim.
      Post-merge hardening note: Pi 0.80.3 headless RPC command inventory did not expose
      `skill:prime-ui` from the package, so Prime does not claim headless `-p` model
      visibility for the skill yet.
- [x] **Ship Rose Pine for Pi TUI theming** — DONE 2026-07-04. Prime vendors audited
      `pi-themes-rose-pine@0.1.0` theme JSONs with Prime-prefixed names
      (`prime-rose-pine`, `prime-rose-pine-moon`, `prime-rose-pine-dawn`), preserves the
      upstream MIT license, and selects `prime-rose-pine` in `.pi/settings.json`.
      Audit: `reviews/package-audits/2026-07-04-pi-themes-rose-pine.md`. This is Pi TUI
      theming; deferred HTML theming remains separate.
- [~] **🔒 Security foundations FIRST (§2, design-target model):** two tiers.
      **(a) Always-on defaults (ship for everyone):** `PI_OFFLINE=1` / `--offline`,
      `PI_SKIP_VERSION_CHECK=1`, `PI_TELEMETRY=0`, `enableInstallTelemetry=false`;
      disable `pi.dev` `latest-version` + `report-install` calls and provider
      attribution headers; set `defaultProvider`/`defaultModel` to the approved set
      and do not provide Google credentials (the built-in `google` provider cannot be
      removed). Disable/block user-invoked egress such as `/share`, `pi install`,
      `pi update`, and package temporary installs in lockdown mode unless explicitly
      allowlisted. **Posture + controls documented** in
      `docs/m0a/provider-and-egress-posture.md`; **newly recorded:** the two `pi.dev`
      endpoints have **independent** controls (`enableInstallTelemetry` governs only
      `report-install`; `PI_SKIP_VERSION_CHECK` only `latest-version`; **only
      `--offline`/`PI_OFFLINE=1` closes both**), `enableInstallTelemetry` defaults
      `true`, and `pi --help`'s env list omits `PI_SKIP_VERSION_CHECK` (docs are
      authoritative, not `--help`). **Applied 2026-07-03:** a **trusted-project**
      telemetry-off baseline shipped as committed `.pi/settings.json`
      (`enableInstallTelemetry:false`, `enableAnalytics:false`) — it applies only once
      the project is trusted/`--approve` (`docs/settings.md:14-16`); env
      `PI_OFFLINE=1`/`PI_TELEMETRY=0` remain the trust-independent controls. The
      **Level-1 telemetry + offline-startup smoke passed** (evidence
      `reviews/m0a/level1-no-egress-2026-07-03.md`: env switches set; Google credentials
      absent — env unset, and at collection time `pi --list-models` showed no
      authenticated provider; `auth.json`
      not read; offline `pi` commands OK; project settings load without error). **Update
      2026-07-04:** the machine-local `defaultProvider` is now non-`google`
      (`openai-codex`, inspected via a non-secret whitelist; `auth.json` not read), so the
      provider-default sub-check is no longer the blocker. The shared repo still does not
      commit a `defaultProvider`.
      **(b) Lockdown mode (build + test, opt-in):** **Boundary CHOSEN 2026-07-04 —
      Plain Docker `docker run --network none`** (deny-by-default), rationale + rejected
      alternatives in `docs/m0a/lockdown-boundary.md` (matches Pi `docs/containerization.md`;
      reviewable, reproducible, CI-friendly, no secrets, no host firewall mutation).
      **Level-2 lockdown smoke PASSED 5/5 2026-07-04** — harness `tools/lockdown/`
      (`Dockerfile` + `no-egress-smoke.sh` + `mock-openai-endpoint.mjs` +
      `container-active-probe.sh`), evidence `reviews/m0a/level2-lockdown-smoke-2026-07-04.md`:
      the container has **no non-loopback interface**, `pi.dev` and a provider host are
      **unreachable** (deny-by-default), a representative Pi startup loads settings/skill/
      themes offline with exit 0, and a full `pi -p` session reaches **only** a local mock
      approved endpoint (no secrets, no spend). **Plan + Level-1/Level-2 split** in
      `docs/m0a/no-egress-smoke-checklist.md`. **Real-provider smoke 2026-07-04:**
      `tools/smoke/openrouter-free-smoke.sh` ran a native Pi OpenRouter call against
      `cohere/north-mini-code:free` with tools/session/context/resources disabled; evidence
      `reviews/m0a/openrouter-free-smoke-2026-07-04.md`. A positive `/share`-denied trace
      remains a future lockdown follow-up.
- [x] **Confirm tool/function calling is native** (§7-Theme I) — DONE 2026-07-03,
      verified against installed Pi `0.80.3` docs: 7 built-in tools
      (`read`/`bash`/`edit`/`write`/`grep`/`find`/`ls`, `README.md:579`), `pi.registerTool`
      + TypeBox (`docs/extensions.md:61,1302`), **parallel exec default-on**
      (`docs/extensions.md:725`, `withFileMutationQueue()` at `:1758`), and gating
      `--tools`/`-xt`/`--no-builtin-tools`/`--no-tools` (`docs/usage.md:206-209`) + skill
      `allowed-tools`. No build. Evidence `reviews/m0a/pi-internals-2026-07-03.md`.
- [~] **Evaluate `pi-web-access` lead candidate** (catalog gate + full package audit):
      metadata/catalog artifact added 2026-07-08 in
      `reviews/package-audits/2026-07-08-pi-web-access-audit.md`; source/no-exfiltration
      audit remains required before install/adoption. Web search/fetch/clone/PDF must
      route via approved proxy/allowlist; skip/disable in fully air-gapped mode.
- [x] **Prompt-injection posture:** DONE 2026-07-08 in
      `docs/m0a/web-access-prompt-injection.md`: fetched/remote content is data, never
      authority; it cannot override `AGENTS.md`/project rules; fetched content must be
      bounded, labeled, and reviewable.
- [x] **Verify Pi internals (§9-Q6)** — DONE 2026-07-03, both sub-questions resolved by
      code. **Shadowing:** `AGENTS.md` shadows a same-dir `CLAUDE.md` (first-match, one
      file per directory; loading-truth item above). **Compaction:** context files are
      appended into the **system prompt** (`agent-session.js:669-680` →
      `system-prompt.js:24-30,102-108`) and sent as a field separate from `messages`
      (`agent-session.js:244`); `compaction/compaction.js` never references the system
      prompt/context files (it summarizes conversation entries only). ⇒ compaction does
      **not** weaken the loaded contract — **no drift, no `APPEND_SYSTEM.md`** created.
      A runtime confirmation smoke is optional. Evidence `reviews/m0a/pi-internals-2026-07-03.md`.
- [~] Configure the maintainer's native providers — **OpenAI (sub), OpenRouter,
      Azure Foundry, GitHub Copilot** — via env vars/flags/OAuth; add **one `models.json`
      block** for any non-OpenAI Azure Foundry deployment. **Update 2026-07-04:** no-spend
      `pi --list-models` inventory shows OpenAI Codex, OpenRouter, and GitHub Copilot
      models visible here; **OpenRouter `:free` live call passed** via
      `tools/smoke/openrouter-free-smoke.sh`. Copilot is not eligible for
      Phase-3 `no-spend-test`; personal/maintainer Copilot tests require a current pinned
      eligible model (currently `github-copilot/gpt-5-mini`; GitHub's docs list
      `GPT-5.4 nano` as cheaper but Pi does not expose it here yet). OpenRouter tests
      must use only metadata-verified `:free` model IDs. **Update 2026-07-07:** the
      Stage 3N multi-model proof passed after current OpenRouter metadata, no-spend
      preflight, and Pi inventory for `openai/gpt-oss-20b:free` and
      `cohere/north-mini-code:free`; no paid call or private input. OpenAI/Codex remains
      native subscription-path only and was not live-called in this no-spend slice.
      Copilot remains policy-gated by fresh profile pins. Azure Foundry remains
      postponed until the work deployment is available.
- [~] Claude auth per §9-Q4 — **spike partially run 2026-07-03** (no secrets read).
      **Feasibility CONFIRMED locally:** first-party `claude` CLI installed (`2.1.200`)
      + `codex` installed; a custom provider around `claude -p --output-format stream-json`
      is buildable (`docs/providers.md:266`). **Economics SETTLED from docs:** native
      Anthropic OAuth third-party-harness usage = *extra usage, per token, not plan limits*
      (`docs/providers.md:31`); OpenAI Codex OAuth = subscription (`docs/providers.md:26`).
      **Deferred (precise blocker):** the live-account billing probe — whether first-party
      `claude -p` actually rides the plan — needs a real billed call + current Anthropic
      policy read, out of scope for a no-secrets slice. Keep native Claude OAuth as
      fallback with `warnings.anthropicExtraUsage` on; public/corporate builds stay valid
      under API-key/gateway/per-token economics. Detail in
      `docs/m0a/provider-and-egress-posture.md`.
- [x] Build the first usable vertical smoke — DONE 2026-07-04. Shipped as the smallest
      complete public-safe path in `docs/m0a/vertical-smoke/`: plan/answer capture
      template, manual second-provider review handoff, raw `git worktree` checklist, and
      a PR-gate checklist wired to this repo's real checks, plus status visibility via
      `tools/smoke/status.sh` (offline, no secrets). Each artifact names the future system
      it stands in for; the full orchestration substrate, worktree manager, and `/ship`
      chain remain **out of M0a** (`docs/m0a/out-of-scope.md`).
- [x] Lock in `AGENTS.md` as entry point (shadow check now code-resolved — `AGENTS.md`
      wins same-dir); documented in `CONTRIBUTING.md`.
- [x] Keep `AGENTS.md`/`CLAUDE.md` auto-loaded; `CONTRIBUTING.md` records the sync rule
      for `AGENTS.md`, `CLAUDE.md`, and `.github/copilot-instructions.md`, and keeps
      `APPEND_SYSTEM.md` unnecessary unless future context/compaction drift is proved.
- [x] Adopt behavior-level disciplines already in the contract (CGS-challenge,
      stopping-criterion, recap table, update-related-markdown) by reference in
      `CONTRIBUTING.md` and `docs/stage1-2/plan-mode-extension-guidance.md` — no slash UX.
- **Verify:** network trace shows **zero unapproved egress** inside the named boundary;
  `/share` and other user-invoked uploads are blocked in lockdown mode; `pi --provider <each>`
  reaches the *approved* endpoint; the Operating Contract is provably in context (ask
  the agent to quote its Modes section); no rule double-load; the M0a smoke path can
  execute one meaningful task handoff end to end. **Evidenced 2026-07-04
  (`reviews/m0a/level2-lockdown-smoke-2026-07-04.md`):** zero-unapproved-egress + offline
  startup + active-session-reaches-only-approved-endpoint proven inside the Docker
  `--network none` boundary using a local mock (no secrets/spend); a native Pi OpenRouter
  `:free` real-provider live call also passed (no packet-level endpoint exclusivity claim).
  A positive `/share`-denied trace remains a future lockdown follow-up.

### Phase 1 — Safety posture (the fence is the keystone)
- [x] Build the **yolo-fence** extension on `tool_call` + `ctx.ui.confirm` — DONE
      (Stage 1+2, 2026-07-04): `extensions/prime-fence.ts` fences the agent's
      `bash`/`write`/`edit` tool calls + user `!` (`user_bash`) against a tunable denylist
      (`extensions/lib/fence-rules.mjs`); **fails CLOSED unless `ctx.mode === "tui"`** — it
      blocks in `rpc`/`json`/`print`. (Gating on `ctx.mode`, not `ctx.hasUI`, is required:
      `ctx.hasUI` is **true in RPC** — docs/extensions.md:914, docs/rpc.md:1068.)
      Source-verified vs `examples/extensions/permission-gate.ts`/`protected-paths.ts`.
      Tests: `tests/fence-rules.test.mjs` (5), `tests/fence-extension.test.mjs` (10, incl. an
      RPC-with-`hasUI:true` regression + json/print block cases for `tool_call` and
      `user_bash`); loads in real Pi 0.80.3.
- [x] Document the fence as defense-in-depth (regex is evadable — heredocs, scripts,
      aliases, `find -delete`); OS-sandbox as the real boundary — DONE in
      `docs/stage1-2/yolo-fence.md` (evasion list, false-positive note, and the next-step
      Seatbelt/Landlock/Gondolin path in front of which the fence sits).
- [x] **Worktree manager** (§9-Q1, scoped default) — DONE (basics, minimal local build):
      `tools/worktree/prime-worktree.sh` create / list / enter / merge / remove / prune on
      canonical `git worktree`. **Safe provisioning:** copies NOTHING by default (no `.env`,
      auth, sessions, or `node_modules`); `enter` prints the path (a script can't `cd` the
      parent shell); remove refuses the current worktree and dirty worktrees; merge refuses
      a dirty source worktree; prune-on-remove. In-place stays available for reviews/tiny
      edits. Self-test `tools/worktree/selftest.sh` (12, incl. no-secret-copy and dirty/current
      remove refusals). Catalog
      candidates (`worktrunk`/treehouse) stay unaudited — nothing qualified, built minimal.
- [~] **Evaluate `remote-pi` lead candidate** (§7-Theme G, §9-Q7): metadata/catalog
      artifact added 2026-07-08 in
      `reviews/package-audits/2026-07-08-remote-pi-audit.md`; source/protocol audit,
      relay visibility proof, E2E evidence, and Pi `0.80.3` compatibility remain blocked
      before any install/adoption. Remote control is remote code execution. Current fence
      remains `ctx.mode === "tui"` fail-closed; future remote approval requires the
      separate fence-v2 design in `docs/stage1-2/fence-v2-remote-approval.md`.
- **Verify:** fence blocks a `git push --force` / `rm -rf` in TTY and auto-denies
  in `-p`; worktree manager creates+prunes cleanly; an allowed op is untouched;
  if `remote-pi` clears audit/compatibility, it drives a session from a second device
  (phone/desktop) with the fence still enforced (a remote destructive op prompts on
  the device, not auto-run).

### Phase 2 — Verification core + planning hygiene
- [x] Ship the **implement → objective-gate → review → fix loop** — DONE (Stage 1+2,
      thin): `tools/loop/objective-gate-loop.sh` makes the objective gate the PRIMARY
      termination signal, **fails loud on a missing gate** (exit 3 — "no gate = stop, not a
      pass"), only exits 0 when the gate actually passes, and treats model/LLM review as
      secondary (advisory, never overrides the gate). Self-test `tools/loop/selftest.sh`
      (8, incl. seeded red→green and missing-gate-fails-loud).
- [x] Adopt plan/implement context separation via `PLAN.md` + `/new` (no handoff
      automation) — DONE: documented flow in `docs/stage1-2/plan-implement-separation.md`;
      native `/new` + a `PLAN.md` file already cover it, so nothing speculative is built.
- [x] Build the **`\answer` interactive multi-CGS resolver** (§7-Theme I) — DONE:
      `extensions/prime-answer.ts` registers a model-callable `answer` tool
      (TypeBox-compatible JSON Schema params, not a `/` command) presenting a TOP
      recommendation + ranked alternatives via
      `ctx.ui.select`; returns the choice. **Deterministic non-interactive path** auto-selects
      the recommendation (`-p`/json). Pure core `extensions/lib/answer-core.mjs`; tests
      `tests/answer-core.test.mjs` (7) and `tests/answer-extension.test.mjs` (2 fake-Pi
      registration/execute tests).
- [ ] *(Optional)* evaluate `pi-annotate` as the UI/design mockup annotation lead
      candidate (§9-Q8) — after the full package/no-exfiltration audit. Plannotator
      stays deferred because interactive plan review is a different, unrequested job.
- [x] Extend plan-mode guidance: DONE 2026-07-08 in
      `docs/stage1-2/plan-mode-extension-guidance.md`; one consolidated stakes-gated
      block (`CGS`, `Alternatives considered`, `Done when`) and no slash UX.
- [ ] Audit Superpowers overlap vs the contract; curate only non-covered
      disciplines (TDD gate, bite-size plan template); **exclude** its worktree +
      delete-pre-test-code skills.
- [~] **Pre-PR gate chain** (Theme J, `no-mistakes`-style) — **basics DONE** (Stage 1+2):
      `tools/ship/pr-gate.sh` runs the conservative, **fail-closed** sequence
      Intent→Status/Rebase→Review→Tests→Resources→Lint→Public-safety→Push/PR checklist,
      mapped to this repo's real checks (`npm test`, `check:resources`, `git diff --check`,
      shellcheck, an embedded secret/provenance scan). **One shell command, no `/` clutter**
      (per principle 6). **Still deferred:** commit-reorg/risk-assessment, the heavier
      unbypassable push interceptor (defer until hook/proxy bypass is shown to be a real
      problem), and a `/ship` slash surface (kept off `/` for now). Final non-Phase-4
      disposition: conservative local proxy prototype is deferred because no bypass
      evidence justifies an unbypassable interceptor.
- [~] **Configurable status bar** (§7-Theme H): catalog-gate `status`/`statusline`
      snapshot added 2026-07-08 in
      `reviews/package-audits/2026-07-08-status-observability-candidates.md` and
      `docs/stage3/status-observability-feasibility.md`; no package adopted.
- [~] **Live-shell verbose toggle** (MVP-selected; lowest-value per §7-Theme E):
      a **keyboard shortcut + status-bar toggle** (NOT a slash command, per principle 6)
      + message renderer streaming full shell calls + output. Build last in M1/M2 and
      **only after verifying `tool_execution_update` stdout granularity**; 2026-07-08
      feasibility note says not to build until that granularity is proven.
- **Verify:** loop drives a seeded failing test to green and stops; refuses a
  task with no checkable stopping criterion; status bar persists the selected
  widgets across restart and reflects live toggle state.

### Phase 3 — Orchestration on one shared substrate (adversarial default-on for meaningful work; parallel/teams opt-in)
- [~] **Accept the Fusion-style dispatch build-spec gate before building** —
      Stage 3A drafted and review-fixed
      `docs/architecture/fusion-dispatch-research.md` as the controlling
      architecture spec: strict no-spend semantics, provider/cost profiles,
      runtime role validation, usage/cap metering, routing policy, evaluation
      fixtures, judge-bias mitigations, failure behavior, public-safe logging,
      and a no-spend OpenRouter `:free` test profile are now specified. **Spec
      accepted; first build slice landed on `stage3/dispatch-policy-core`.**
- [~] **Stage 3B — dispatch-policy-core substrate (2026-07-05):** shipped &
      tested the pure, fail-closed policy/config/schema/run-record layer
      (`dispatch/`, `tests/dispatch-*.test.mjs`, `docs/stage3/dispatch-policy-core.md`):
      runtime role-envelope validation + role/stage matrix, canonical provider
      mapping, no-spend cost policy (mock + metadata-verified OpenRouter `:free`
      only; real providers/non-free/unknown/stale price fail closed), the three
      profiles + Copilot-pin metadata, task-class routes with the reserved
      `role→[{provider,model,effort,instances}]` matrix, **N3** panel-precedence
      and **N4** price-TTL staleness pinned, a deterministic classifier with
      mandatory floors + non-TTY fail-closed escalation, judge-bias blinding, a
      public-safe run-record writer with a mechanical leak scan, the five spec
      fixtures, and a mechanical `nospend-preflight` gate. 107 tests pass. **No
      orchestrator, no live/paid calls; the optional live `:free` smoke was not
      run (deferred to avoid spend ambiguity).**
- [~] **Stage 3C — thin dispatch orchestrator (2026-07-05):** shipped & tested
      one dispatch cycle over the policy core (`dispatch/lib/orchestrate.mjs`,
      `tests/dispatch-orchestrate.test.mjs`, `tools/smoke/dispatch-smoke.mjs`,
      `docs/stage3/dispatch-orchestrator.md`): dependency-injected
      adapters/clock/seed/gate; pre-launch no-spend + eligibility enforcement
      with the metadata price-TTL **clamped to profile policy** (closes the
      deferred post-merge-audit follow-up); every role envelope validated at the
      boundary — and matched against the vetted spec — before the judge; blinded
      advisory judge with recorded seed/permutation and judge-in-panel
      degradation warnings; objective gates from exit status/deterministic
      checkers only; cap enforcement over recorded usage; structural public-safe
      run records for every post-panel outcome; recursion depth exactly one;
      deterministic mock smoke (byte-identical records). 138 tests pass. **Mock
      adapters only — synthesis, real provider adapters, live/paid calls, and
      the live `:free` smoke stay out of scope for this slice.**
- [~] **Stage 3D — synthesis stage + preflight-gated no-spend adapter (2026-07-06):**
      shipped & tested the synthesis stage (`dispatch/lib/synthesis.mjs`, synthesis
      stage in `dispatch/lib/orchestrate.mjs`, `tests/dispatch-synthesis.test.mjs`,
      `docs/stage3/synthesis-nospend-adapter.md`): runs after the panel + advisory
      judge and before the objective gate on `synthesizer` routes; the synthesizer
      is injected and consumes candidate/judge output as an identity/cost-stripped
      role-output projection (provider-bound, not a public-safe record); its
      envelope is validated + vetted-spec matched; unresolved candidate
      contradictions are **mechanically preserved** — a dropped marker fails closed
      (`synthesis-dropped-contradiction`), a preserved one records
      `contradiction-preserved`; judge stays advisory and the objective gate still
      decides success. Plus the first **preflight-gated** no-spend adapter smoke
      (`tools/smoke/openrouter-free-dispatch-smoke.sh` + candidate fixture +
      `tests/dispatch-nospend-preflight.test.mjs`): the mechanical preflight runs
      first and the live OpenRouter `:free` call runs only if proven spend-safe.
      Post-merge review fixes S1–S4 added the pre-launch cost projection on all
      profiles, the `github-copilot` pinned-model gate with a TTL ceiling, and the
      synthesis-projection relabel (179 tests). **Live `:free` smoke SKIPPED
      (fail-closed) on stale committed metadata — no live call made.**
- [~] **Stage 3E — verification stage (2026-07-07):** shipped & tested the
      `verifier` role (`dispatch/lib/verification.mjs`, verification stage in
      `dispatch/lib/orchestrate.mjs`, `tests/dispatch-verification.test.mjs`,
      `docs/stage3/verification-stage.md`): runs after the objective/advisory gate
      result is captured, only on `verifier` routes (`pr-preflight`); injected
      (`adapter.runVerifier`) and fed a structural public-safe proof summary
      (`projectForVerification`: gate outcome, exit status, cap status, warnings,
      refs — no model narrative); envelope validated as `stage:"verification"`/
      `role:"verifier"` + vetted-spec matched. **Advisory only — the verifier
      summarizes proof but never determines the gate result** (a positive verifier
      can't rescue a failed gate; a negative one can't block a passed gate); its
      narrative is never persisted (persisted record shape unchanged). 190 tests
      pass. **The `documenter` verification role, real non-mock adapters, paid
      calls, parallel dispatch, and the hosted adapter remain out of scope.**
- [~] **Stage 3F — thin parallel / multi-team dispatch (2026-07-07):** shipped &
      tested the **parallel-dispatch** layer thinly on the Pi
      `examples/extensions/subagent/` concurrency-limiter pattern
      (`dispatch/lib/parallel.mjs`, parallel launch + cross-family advisory in
      `dispatch/lib/orchestrate.mjs`, `tests/dispatch-parallel.test.mjs`,
      `docs/stage3/parallel-dispatch.md`): opt-in `deps.parallel = {max_concurrency,
      token_budget}` bounds in-flight candidate launches + the per-run token budget
      (invalid cap / unbounded budget / over-budget all fail closed); output stays
      candidate-index deterministic (same-config parallel runs byte-identical, smoke
      byte-identical across runs) and the record's `cap_status.token_cap` records the
      effective enforced budget (never null while a finite budget governed the run);
      all existing gates preserved; a failed parallel candidate is isolated and still
      counts against `min_successes`. Plus the lean multi-team piece: a **cross-family
      advisory** (`cross-family-not-satisfied`, warn-only, never a blocker) on
      `requires_cross_family` routes. 205 tests pass.
      **Sequential is the default (existing callers unchanged); the iterating
      multi-team/adversarial debate, real subprocess fan-out, and paid/live calls
      remain out of scope.**
- [~] **Stage 3G — iterating multi-team / adversarial debate loop (2026-07-07):**
      shipped & tested the **iterating debate** layer (`dispatch/lib/debate.mjs`,
      `tests/dispatch-debate.test.mjs`, `docs/stage3/iterating-debate.md`, plus a 5th
      deterministic scenario in `tools/smoke/dispatch-smoke.mjs`): a bounded loop that
      **composes** `runDispatch` (one iteration = the full
      panel→judge→synthesis→gate→verifier cycle) and repeats only for adversarial
      routes (a `redteam`/`judge`/`synthesizer` role, unless `disable_adversarial`)
      until convergence. **Convergence is exactly diff-stability + objective-gate-pass**
      — both deterministic checkers, so model consensus / judge / verifier / synthesis
      approval is never final authority (an advisory gate never converges; the verifier
      still can't rescue a failed gate or block a passed one). Mandatory
      `max_iterations` + an aggregate `token_budget` fail closed **before** iterating
      (`missing-`/`unbounded-` codes); the aggregate budget is a hard rail across
      iterations that wins over convergence; an unavailable/non-deterministic injected
      diff checker fails closed; a hard fail-closed iteration is never retried.
      Structural-only public-safe iteration summaries carry no model narrative and are
      byte-identical under a fixed seed/input. Dependencies flow inward: the dispatch
      core never imports the debate layer. 233 tests pass.
      **The real proposal-revision / real working-tree diff loop, the default-on
      `/adversarial off` surface, real subprocess fan-out, real non-mock adapters, and
      paid/live calls remain out of scope.**
- [~] **Stage 3H — real revision / diff surface (2026-07-07):** shipped & tested the
      real local diff/revision signals for the Stage 3G loop
      (`dispatch/lib/git-diff-surface.mjs`, `dispatch/lib/adversarial-policy.mjs`, the
      injected `revise` boundary in `dispatch/lib/debate.mjs`,
      `tests/dispatch-git-diff-surface.test.mjs`, `tests/dispatch-adversarial-policy.test.mjs`,
      `docs/stage3/real-revision-diff-surface.md`): (1) a **real working-tree
      diff-stability** surface — `computeDiffFingerprint`/`makeGitDiffStability` build a
      structural `sha256` fingerprint of the git diff via deterministic plumbing
      (hashes/counts/refs only, never raw diff text), double-read for determinism, and
      fail closed on non-git repo, missing baseline, ambiguous index, git failure, unsafe
      path, or non-determinism; (2) a **real proposal-revision boundary** — an optional
      injected `revise` effect produces the next proposal in the worktree between
      non-converged iterations (the only thing allowed to mutate it), threads state as
      refs/hashes, and stops fail-closed (`revision-failed`/`revision-invalid`) while
      preserving prior iteration evidence (absent ⇒ Stage 3G behavior byte-for-byte); and
      (3) **default-on adversarial policy** — `resolveAdversarialPolicy` makes meaningful
      work (plans, reviews, risky changes, security, architecture, roadmap reconciliation,
      PR preflight) default-on, with the `/adversarial off` opt-out riding
      `task.override.disable_adversarial` (no new slash command) and recorded as
      `adversarial-opt-out`; heavier 3+ model / every-task runs stay explicit opt-in. The
      debate core stays pure (git/worktree effects injected) and the objective gate is
      still final authority. 267 tests pass. **Real model-backed revision, real non-mock
      adapters, real subprocess fan-out, paid/live calls, the `documenter` role, the
      autonomous loop, and the hosted adapter remain out of scope.**
- [~] **Stage 3I — real model-backed revision effect (2026-07-07):** shipped & tested
      the model-backed `revise` boundary (`dispatch/lib/revision-effect.mjs`, shared
      `dispatch/lib/provider-policy.mjs`, `tests/dispatch-revision-effect.test.mjs`,
      `tools/smoke/revision-effect-smoke.mjs`, `docs/stage3/model-backed-revision.md`):
      `makeModelRevision(config, deps)` builds the injected `revise` effect (`debate.mjs`
      unchanged, still policy-pure) — a `builder` model produces the next proposal and
      the debate's critic panel + **objective gate** close the builder→critic loop. It
      validates config/caps (unbounded caps fail closed), **projects provider/cost policy
      through the shared gate BEFORE any model call** (an ineligible/unknown/stale
      provider or price, or a missing Copilot pin, refuses before the adapter — call
      count 0), validates the model's structured edits, and applies them to the worktree
      **all-or-nothing** under the Stage 3H write rules (allowlist-only; credential-shaped
      paths refused even if allowlisted; unsafe traversal/absolute/symlink/non-file/
      outside-tree paths fail closed). It returns only a structural `sha256`
      `revision_ref` + a stable code — no thrown message / model narrative / private path
      in `detail`, warnings, summaries, or run records. A real temp-repo debate converges
      only on diff-stability + objective-gate-pass; the pre-launch cost gate is extracted
      into one shared copy used by the orchestrator and the revision effect (no drift).
      282 tests pass. **Stage 3J now supplies the live OpenRouter `:free` adapter/proof
      for this boundary; paid/metered and non-OpenRouter live adapters remain out of scope.**
- [x] **Stage 3J — live builder adapter + preflight-gated `:free` proof (2026-07-07):**
      shipped the OpenRouter `:free` implementation of `modelAdapter.runRevision`
      (`dispatch/lib/openrouter-revision-adapter.mjs`,
      `tools/smoke/openrouter-free-revision-smoke.mjs`,
      `tests/dispatch-openrouter-revision-adapter.test.mjs`,
      `docs/stage3/live-builder-adapter.md`). The adapter refuses non-`:free` models
      and unsafe/sensitive fixture paths before Pi, disables tools/session/context/
      resources, bounds the full outbound prompt with `max_input_bytes` before Pi,
      parses JSON edits, and throws stable codes only (no raw prompt, response,
      stderr, diff, or private text in returned/persisted artifacts). The
      live proof uses only a synthetic temp repo and runs only after public OpenRouter
      metadata plus `nospend-preflight.mjs` prove zero price; on 2026-07-07
      `openai/gpt-oss-20b:free` passed metadata (`prompt=0`, `completion=0`),
      preflight (`ok-free-verified`), Pi inventory, and a real temp-repo debate
      converged in 3 iterations (`diff-baseline`, `diff-changing`, `diff-stable`) with
      2 live builder revision calls. Post-review H1 adds
      `openrouter-revision-input-too-large` before runner invocation for oversized
      fixture prompts. 288 tests pass.
- [x] **Stage 3K — lean agent-team defaults (2026-07-07):**
      shipped an additive default team artifact (`dispatch/config/agent-team-defaults.json`)
      plus markdown role files for `Builder` and `Reviewer`
      (`docs/stage3/agents/`) and a zero-dependency validator/projection helper
      (`dispatch/lib/agent-team.mjs`, `tests/dispatch-agent-team.test.mjs`,
      `docs/stage3/agent-team-defaults.md`). Canonical agent-team IDs are stable
      (`Scout`, `Planner`, `Builder`, `Reviewer`, `Documenter`, `RedTeam`) and
      explicitly bridge to existing lowercase dispatch role IDs. The Reviewer
      default declares provider independence from Builder; Stage 3L/M/N now enforces
      it against concrete provider/model specs. Cosmetic callsigns are display-only:
      tests prove they cannot affect routing/logging projections or replace the
      canonical handle. 296 tests pass.
- [x] **Stage 3L/M/N — role matrix, chains, bounded task-loop, run manager, and
      multi-model `:free` proof (2026-07-07):** shipped the per-role matrix
      (`dispatch/lib/role-matrix.mjs`, `dispatch/config/role-matrix-defaults.json`),
      named chain registry (`dispatch/lib/chains.mjs`, `dispatch/config/chains.json`),
      named run configs (`dispatch/lib/run-configs.mjs`,
      `dispatch/config/run-configs.json`), bounded loop entrypoint
      (`dispatch/lib/task-loop.mjs`, `tools/loop/prime-task-loop.mjs`), structural run
      hygiene/status/prune tooling (`dispatch/lib/run-manager.mjs`,
      `tools/runs/prime-runs.mjs`), worktree remove/merge hardening
      (`tools/worktree/prime-worktree.sh`), and a two-model live no-spend proof
      (`tools/smoke/openrouter-free-multimodel-revision-smoke.mjs`). The matrix accepts
      `role -> [{ provider, model, effort, instances, price? }]`, expands in route-role /
      entry / instance order, requires finite loop caps, bounds instances by route/profile
      caps and token budget, runs `projectProviderPolicy` before launch, warns on
      no-spend fixture provider-independence/cross-family gaps, and enforces those
      policies where the profile requires it. Chains are data only (not slash commands);
      `implement-review-fix`, `scout-flow`, and `ship-pre-pr` are the shipped defaults,
      and unknown/malformed chains fail closed; the current revision-backed task-loop
      entrypoint executes only builder-bearing chains and returns
      `chain-not-loop-runnable:<id>` for non-builder defaults. `mock-core-loop` is
      no-live by default, requires objective gate + write allowlist + finite caps, and
      writes only structural records under gitignored `dispatch/runs/`. Objective gate
      file reads now lstat the final path, refuse symlinks/non-files/sensitive names,
      verify final realpath containment under the real worktree root, and then read.
      The CLI cleans default synthetic temp repos and reports when reusing a run id
      replaced a prior structural run directory. The live proof fetched current
      OpenRouter metadata, passed `nospend-preflight.mjs` and Pi inventory, then
      converged synthetic temp-repo debates for two distinct `:free` models:
      `openai/gpt-oss-20b:free` and `cohere/north-mini-code:free` (4 total live
      revision calls, zero price, no private input). 322 node tests pass after post-merge hardening; worktree
      self-test now has 12 assertions. Paid/metered calls, hosted Fusion, broad UI,
      remote control, and autonomous/unattended mode remain out of scope.
- [x] **Stage 3O PR1 — Pi-native `/prime` control surface (2026-07-08):**
      shipped one extension slash command, `/prime`, with argument-completed verbs
      over the existing Stage 3 machinery (`extensions/prime-command.ts`,
      `extensions/lib/prime-command-core.mjs`, `tests/prime-command-core.test.mjs`,
      `tests/prime-command-extension.test.mjs`). PR1 renders the dashboard, no-live
      run preflight, view-only role-matrix/chain/profile browsers, structural run
      list/status, and guarded prune. `/prime run [config-id]` resolves the run
      config, profile/caps, chain, route, role matrix, objective gate, write
      allowlist, provider/cost policy warnings/refusals, and prints the exact
      existing `node tools/loop/prime-task-loop.mjs --config ... --run-id ...`
      invocation without launching it. `/prime runs prune <run-id>` is the only
      mutation and requires `ctx.mode === "tui"` plus explicit confirmation; `rpc`,
      `json`, and `print` fail closed as `prime-prune-requires-tui-confirm`, and
      absent/false confirmation cancels. The command-surface split was deliberately
      collapsed into one command; do not add `/prime-run`, `/prime-runs`,
      `/prime-models`, `/prime-chains`, `/prime-profiles`, `/prime-worktrees`, or
      `/prime-resources` as top-level commands. Post-review hardening rejects
      root-resolving run ids before replace/prune, keeps completions fail-closed,
      derives chain loop status from task routes, shares task-loop preflight
      policy, fixes the Pi message display contract, and makes malformed local
      registry/config JSON fail closed as `prime-config-unreadable`. 340 node tests pass
      after this slice. **Stage 3P whole-repo gap closure (2026-07-09)** hardens
      accepted Codex/Fable review gaps without speculative product implementation:
      own-property schema validation, nonnegative USD usage fields, git diff env
      scrubbing and expanded sensitive-path denials, stable diff/adapter failure
      codes, broader public-safety home-path scans, CI/pr-gate public-safety parity,
      docs-truth locks, `/prime help`, refusal guidance, runtime RPC 60s default,
      non-prunable flat run-record labels, a direct user manual, and design
      contracts for autoresearch/cost modes/composites/config overlays/loop cues/
      live enablement/context engineering. `npm test` passes 362 node tests plus
      the worktree self-test (12) and objective-gate-loop self-test (8); 358
      top-level node test declarations are locked by `npm run check:docs-truth`. Config editing, role-matrix/profile/chain editing, worktree/resource
      commands, live toggles, live provider calls, paid/metered calls, raw prompt/
      response/transcript/provider-payload rendering, autonomous mode, and Phase 4
      items remain out of scope.
- [x] Promote shipped per-run debate rails into user-facing defaults where needed:
      the `personal` profile carries the documented 5-iteration / $100 / 10M-token
      per-run backstop, and `mock-core-loop` carries explicit finite no-spend caps.
      Aggregate session/daily ceiling remains with the unattended autonomous loop,
      Theme J / Phase 4, and is not faked here.
- [x] Ship a **lean agent-team default** (Builder + independent-provider Reviewer)
      as markdown agent files; users ADD roles. Roles carry a **canonical name**
      (Scout/Planner/Builder/Reviewer/Documenter/RedTeam) + an optional **cosmetic
      callsign** (themed packs; display alias only — never the log/test identifier).
- [x] Implement the **per-role model/effort/instance matrix** (Theme J): config
      `role → [{provider/model, effort, instances}]`, scalable to N instances; cross-family
      encouraged for RedTeam; **every launch projects spend and is bounded by the per-run
      token budget** (warn before a wide matrix). Config-driven, no new slash command.
- [x] Register a small **chain registry** with named defaults (e.g. scout-flow
      explore→validate→verify) on `examples/extensions/subagent/` chain mode; chains are
      behavior/config, not commands.
- [x] Make the local **ship/pre-PR chain** a named chain (`ship-pre-pr`): intent,
      rebase/status, review, redteam, tests, docs, lint, public-safety, verifier, and PR
      handoff. It never merges automatically and exists to prepare evidence for external
      Fable/Codex review.
- [~] *(Optional, feasibility-flagged)* **live pipeline view** (Theme J): per-stage
      tiles (running/pending, elapsed, token in/out, current task, multi-instance) via
      `registerMessageRenderer`/`pi-tui` — **first verify the renderer supports a live
      custom view and that `pi-messenger` doesn't already cover it.** Renderer/widget, not a command.
      2026-07-08 feasibility note only; no renderer/package adopted.
- [~] *(Optional)* adopt **`pi-messenger`** (§7-Theme I) for inter-agent messaging +
      **file reservation** (parallel-edit safety for the multi-team substrate) — metadata
      audit artifact added 2026-07-08; source/no-exfiltration audit remains required, and
      firstmate/autonomous orchestration is out of scope.
- [x] Wire dispatch + adversarial as **callable local loop defaults** — not standalone
      pillars. `prime-task-loop.mjs` composes the existing dispatch/debate/revision
      surfaces through named run configs; no new `/` command was added.
- **Verify:** adversarial run on a known-flawed change converges to a gate-passing
  fix or stops at max-iter with the disagreement surfaced; same-family combo warns.

### Phase 4 — Deferred / experimental (gated on real signals)
- [ ] **Hosted `openrouter/fusion` adapter** (optional, **disabled by default**,
      privacy/provider-policy gated) — only after explicit privacy sign-off and confirming
      it doesn't duplicate the planning tier; **no unapproved OpenRouter fan-out in
      lockdown/corporate mode**. Note: the **DIY Fusion-style panel→judge→synthesis dispatch
      is CORE Phase-3** (Theme A/B/J), not deferred — this Phase-4 item is *only* the hosted
      third-party-model adapter.
- [ ] **Headroom** input-compression — only behind a falsifiable token+quality measurement.
- [ ] Unified **`/workflow`** (Ultracode-style) — revisit after Phase 2/3 prove
      token economics; templated pipeline, **NO auto-written-JS, NO auto-trigger**.
- [ ] **Babysitter** (`@a5c-ai/babysitter-pi`) — only if a concrete unattended long-run case appears.
- [ ] **Voice input (OpenWhispr)** — **OUT of the Pi extension build for now** (confirmed
      2026-07-01): a docs-only entry describing the OS install + push-to-talk shortcut;
      **local Parakeet/Whisper only** (no cloud STT default, Principle 0). No code, no
      extension, no `/` surface.
- [ ] **Neovim/Pi integration (`pi-nvim`)** — **deferred 2026-07-03**: Neovim and Pi do
      not need to be coupled for the MVP. Native Ctrl+G prompt editing is sufficient for
      now. Revisit only if a concrete bidirectional-editor workflow becomes necessary,
      and only after Pi `0.80.3` compatibility plus the full package/no-exfiltration
      audit clear.
- [ ] **Autonomous experiment loop** (gnhf/Karpathy auto-research) — opt-in mode,
      hard-capped (token/iter/stop-condition) **+ a mandatory session/daily aggregate
      spend ceiling** (the unattended-job guardrail relocated here from interactive
      adversarial, 2026-07-01); never default; not alongside remote without a ceiling.
      **Deferred 2026-07-07:** Stage 3N ships per-run caps, status/prune tooling, and
      structural records, but the aggregate session/daily ceiling is not designed or
      implemented. Do not enable unattended mode until that ceiling and a hard stop/resume
      contract are ratified.
- [ ] **firstmate-style orchestrator** — catalog-eval; likely **compose** `pi-messenger`
      + the thin orchestration layer rather than adopt whole. Decide after Phase 3 proves the substrate.
- [ ] **HTML theming** (Rose Pine default + single `htmlTheme` override path) — only if/after
      the parallel HTML-output decision lands; one default + one override, never a theming engine.
- [ ] Optional artifacts as complexity warrants: ROADMAP index + slim `plan/` dir;
      Keep-a-Changelog (only if releases + human audience exist); parallel HTML doc site.

### Cross-cutting: test harness & CI (starts in Phase 0, grows every phase)
- [ ] Stand up the test harness early: unit runner for tool/handler logic + an
      e2e helper that loads an extension via `pi -e <path> --mode json -p "…"` and
      asserts on the JSONL event stream. Account for project trust in non-interactive
      modes (`--approve` only with rationale, or trusted temp extension paths). Seed
      edge/boundary/failure fixtures.
- [ ] **Egress test in CI**: run a representative session under a deny-by-default
      network sandbox / trace with a mock/local provider by default; fail the build on
      any unapproved outbound connection and document any platform mismatch between
      Linux CI and the developer's chosen local boundary.
- [x] CI (GitHub Actions): minimal PR/main gate added in `.github/workflows/ci.yml`
      for `npm test`, `npm run check:resources`, and `git diff --check`. Remaining
      cross-cutting CI growth stays open for dependency install/typecheck/e2e provider
      load smoke and the deny-egress CI test above.

---

## 11. Risks (kept live — re-check each phase)

- **🔒 Data exfiltration / telemetry (TOP risk — the design-target reason to exist)** — Pi phones
  `pi.dev` for version/install reporting by default; provider attribution headers are
  metadata egress; adopted packages may embed analytics/crash/observability calls; the
  public `google` default provider sends prompts off-box; `/share`, `pi install`,
  `pi update`, and `pi -e npm:<pkg>` are user-invoked egress or temporary package
  execution paths. Mitigation: `PI_OFFLINE=1` / `--offline`, `PI_SKIP_VERSION_CHECK=1`,
  `PI_TELEMETRY=0`, `enableInstallTelemetry=false`, explicit approved provider defaults,
  lockdown blocks for user-invoked uploads/installs, the §5 no-exfiltration audit on
  every package, approved/self-hosted model endpoints only, and a CI egress test inside
  a named OS/network/container boundary. **A leak is worse than a missing feature.**
- **Public-repo publishing hygiene** — GitHub visibility is repo-wide, not branch-scoped.
  The original `prime` repository and its persistent PR refs remain a private
  archive. Public release uses only `prime-reloaded`: a fresh single-root history
  containing the sanitized tracked snapshot, a verified noreply identity, no
  inherited branches/tags/PR refs, and an independent audit of repository
  metadata before visibility changes.
- **Supply-chain (full-system-access packages)** — every adopted pi package runs
  arbitrary code with full access (`docs/packages.md`). In a security-critical corp
  env, pin versions/refs, review source/license/install scripts/dependencies/peer deps/
  engines/Pi-compat/command surface before install, prefer fewer well-vetted packages,
  capture raw audit artifacts, and re-audit on update (`pi update` reconciles refs).
- **Token-burn theater** — adversarial/parallel/consortium/Fusion all multiply
  cost. **Current posture:** meaningful-work defaults remain owner-selected;
  `max_iterations` and `max_concurrency` bound runtime fan-out, token counts are
  capacity telemetry only, and actual spend is bounded at the provider/backend
  billing boundary. Watch real spend and revisit the product default with the
  owner if evidence warrants it; do not add a pretend harness spend control.
- **Remote-control SaaS transit (mitigated by choice)** — chat bridges (Telegram/Slack)
  are NOT E2E. User chose **`remote-pi` (E2E)** specifically to avoid this; if a web
  client/chat bridge is added later, the SaaS-transit exposure returns and must be re-weighed.
- **False-assurance fences** — a bash-arg regex denylist is evadable; sell it as a
  speed-bump, OS sandboxing as the real guarantee.
- **LLM-judge rubber-stamping** — any convergence/review signal grounded in a
  cheap LLM "I agree" instead of the objective gate degrades into self-approval.
- **Context-file shadowing (precedence resolved; residual = trust/CI)** — `AGENTS.md`
  shadows a same-dir `CLAUDE.md` (code-confirmed, M0a: first-match, one file per
  directory), and both carry the equivalent contract here, so the binding contract
  stays in context — this is **no longer an open risk**. The residual concern is Pi's
  **project-trust** rules for local `.pi` resources: relying on project-local
  extensions in non-interactive CI still requires `--approve` (with rationale) or a
  trusted temp `-e` path, since `-p`/json/rpc never prompt and fall back to
  `defaultProjectTrust`.
- **Prompt injection through untrusted content** — web fetches, cloned repos, remote
  prompts, and design-review artifacts can contain hostile instructions. Pi cannot
  reliably prevent prompt injection by itself; label/bound untrusted content and keep
  Operating Contract precedence explicit before enabling web/remote surfaces.
- **Worktree mis-sold as safety** — filesystem isolation doesn't contain `git push`,
  network, or `rm` outside cwd; provisioning + prune lifecycle are where managers rot.
- **Claude auth cost/policy uncertainty** — Pi docs warn that native Anthropic OAuth
  may bill third-party-harness usage as extra usage, while current Anthropic support
  docs describe Claude Code/Agent-style subscription usage differently and keep API
  Console billing separate. A first-party `claude` CLI wrapper remains only a repo-owner-local
  candidate pending a Phase-0 wrapper/policy spike. Public/corporate builds must keep
  working under API-key/gateway/per-token economics.
- **Mandate vs evidence tension (resolved by scoped defaults)** — earlier worktree-always
  and adversarial-every-task wording contradicted canonical guidance. Reconciled defaults:
  **worktrees for implementation/multi-agent work** (§9-Q1) and **adversarial default-on
  for meaningful work** (§9-Q2). CGS objections are preserved as documented tradeoffs
  (provisioning/prune for worktree; backend billing plus iteration/concurrency
  rails for adversarial), not silently dropped.
- **Per-role N-instance cost blow-up** — the per-role model/effort/instance matrix
  (Theme J) multiplies cost combinatorially (instances × roles × debate rounds).
  `max_concurrency` and `max_iterations` bound fan-out/time; the provider billing
  ceiling bounds spend. Token telemetry must not be presented as enforcement.
- **Autonomous experiment loop (unattended runaway)** — the gnhf/Karpathy auto-research
  mode (Theme J) can run unbounded toward a metric. Keep it **opt-in + hard-capped**
  (token/iter/stop-condition); never default; never enable it together with remote
  control without an explicit ceiling.
- **Pipeline-view / worktree-manager feasibility unverified** — the live pipeline tiles
  depend on `registerMessageRenderer`/`pi-tui` supporting a live custom view (unconfirmed),
  and `pi-messenger` may already cover it; worktree-manager candidates must be source-pinned
  because `worktrunk` is not an npm package and npm `treehouse` is unrelated. Verify before
  estimating.
- **Cargo-culting vendor headlines** — building "reproduce Ultracode" wholesale,
  the full 6-role team, MADR-for-plans, or auto-written-JS orchestration before
  de-risked components prove out.
- **Drift-enforcement alarm fatigue** — a structural "code-changed-but-no-markdown"
  hook fires on legit refactors and can't judge doc-relevance. Keep doc discipline behavioral.
- **Unverified Pi internals** — mid-session thinking-level control,
  `tool_execution_update` stdout granularity, and compaction's treatment of
  context files are `research-needed` unknowns sitting under build estimates.
- **Remote control = remote code execution** — exposing the agent remotely
  (`remote-pi`) means a remote `prompt`/`bash` runs arbitrary code on the dev
  machine. Mitigations are non-negotiable: E2E encryption (relay sees only
  metadata), device allow-listing/pairing, routing tool-permission prompts to
  the device, and proving package compatibility with the installed Pi version. The
  yolo-fence must be live before remote control is enabled.

## 12. Conventions for working in this repo

- **Follow the Operating Contract** (`AGENTS.md`/`CLAUDE.md`) — the floor.
- **Keep this ROADMAP live**: update §3 dashboard + the relevant phase + §13
  changelog on every change. Add discovered work rather than leaving it implicit.
- **Keep `ROADMAP_SUMMARY.html` aligned** after major roadmap changes; it is the
  simple human-readable view of decisions and timing, while this file remains the
  source of truth.
- **Work one stage per larger prompt (§10 Stage execution strategy).** Each stage mission
  states its read-first list, authority, work items, and an explicit acceptance-gate
  checklist; it may run up to ~12 internal fix/review cycles and stops when the gates pass
  or a real blocker appears. Phases 1–2 may be bundled to reach Phase 3 sooner without
  cutting scope. This execution cap is separate from the runtime adversarial caps (§9-Q2).
- **Adopt before you build (§2.1).** Check Pi-native (§5), then run the Catalog-first
  gate (§5). Don't rebuild a native; don't build what a qualifying package already does.
- **Keep the `/` menu legible (§2 principle 6, §6 budget).** Default every feature to
  the least-cluttering surface (behavior > hook > shortcut/status-bar > tool > command).
  A new slash command needs a reason; trim adopted packages' commands via `pi config`.
- **Verify, don't guess.** Pi API specifics come from the offline docs (§4), not memory. Mark unverified as such.
- **Re-pin after Pi updates.** The latest combiner/run pin in §4 supersedes older
  embedded snapshots; run `tools/m0a/collect-evidence.sh` (which re-runs `pi --version`,
  `which pi`, `npm root -g`, package version, and the §4 docs checksum, and reports
  OK/DRIFT) after `pi update`, then reconcile any drift into §4, the script's
  `EXPECTED_*` pins, and `docs/m0a/evidence-snapshot.md` in the same change.
- **Package metrics need raw artifacts.** Exact downloads/stars/recency are dated
  prefilter notes unless backed by `reviews/package-audits/<YYYY-MM-DD>-<slug>/`.
- **Post-fold red-team follow-up.** After major roadmap reconciliation, run
  `reviews/codex-redteam-prompt.md` with `TARGET_PLAN=ROADMAP.md` before implementation.
- **Secrets** (provider keys) are env/config, never committed.
- **Public visibility hygiene.** Do not treat a branch as private if it lives on the
  remote that may become public; raw transcripts and private planning branches must be
  local-only or moved to a separate private repo before any visibility flip.

## 13. Changelog

Earlier entries preserve decision history, including superseded interim decisions.
The current sections above are authoritative when they conflict with older changelog
snapshots.

- **2026-07-11** — **Final publication-documentation audit remediation.** Marked
  every retained Stage 3B-N implementation page as a superseded historical
  record, added an authoritative current-v1 status row, refreshed the HTML
  summary and machine-locked declaration count, clarified content-addressed Git
  object overlap versus source-history reachability, and made the PR gate reject
  detached HEAD with a system-boundary regression. Both repositories remain
  private; merge and visibility still require exact-head review and the
  post-merge publication checklist.
- **2026-07-08** — **Final non-Phase-4 hardening push planned and implemented.**
  Added the required pre-behavior plan artifact
  (`reviews/runs/stage3-final-nonphase4-plan-2026-07-08.md`) and kept this as one
  cohesive PR separate from Stage 3O slash UX. Provider/live proof boundaries now
  live in `docs/m0a/provider-live-proof-boundaries.md`: Azure Foundry is template/
  blocked only (`docs/m0a/azure-foundry.models.template.json`), Copilot requires a
  fresh matching pin, OpenAI/Codex and Claude live proofs require per-proof
  maintainer approval, and `claude-local` remains non-automated. Added focused
  provider-boundary regressions, a no-auth/no-live Pi proof helper
  (`tools/smoke/pi-e2e-load.mjs`) that reports package loadability, Pi
  discoverability, no-live behavior, and live-provider proof separately, plus a
  static CI no-live egress guard (`tools/ci/no-live-egress-check.mjs`,
  `npm run check:no-live-egress`, GitHub Actions). Added web prompt-injection
  posture, remote/fence-v2 design boundary, `CONTRIBUTING.md` sync rules, plan-mode
  guidance, status/observability feasibility, and metadata audit artifacts for
  `pi-web-access`, `remote-pi`, `pi-messenger`, and status candidates. No packages
  were installed/adopted, no live provider calls were run, no paid calls were run,
  no remote approval was enabled, and Phase 4 items remain deferred.
- **2026-07-07** — **Stage 3L/M/N: role matrix, chain registry, bounded task-loop,
  run manager, worktree hardening, and two-model OpenRouter `:free` proof implemented.**
  On branch `stage3/lean-agent-team-defaults`
  (`dispatch/lib/role-matrix.mjs`, `dispatch/config/role-matrix-defaults.json`,
  `dispatch/lib/chains.mjs`, `dispatch/config/chains.json`,
  `dispatch/lib/run-configs.mjs`, `dispatch/config/run-configs.json`,
  `dispatch/lib/task-loop.mjs`, `tools/loop/prime-task-loop.mjs`,
  `dispatch/lib/run-manager.mjs`, `tools/runs/prime-runs.mjs`,
  `tools/smoke/openrouter-free-multimodel-revision-smoke.mjs`,
  `tests/dispatch-role-matrix.test.mjs`,
  `tests/dispatch-chains-run-configs.test.mjs`,
  `tests/dispatch-run-manager.test.mjs`, `docs/stage3/role-matrix-task-loop.md`,
  README/ROADMAP/summary/ledger, and worktree manager updates). This completes the
  no-live core loop path: role matrix expansion is deterministic and provider/cost-gated
  before launch; chains are named data defaults (`implement-review-fix`, `scout-flow`,
  `ship-pre-pr`) and fail closed when unknown/malformed; `mock-core-loop` requires finite
  caps, objective gate, and write allowlist; run records are structural-only under
  gitignored `dispatch/runs/`; run status/list/prune read only structural JSON; worktree
  remove/merge refuses dirty/current unsafe states. Post-review hardening refuses
  symlink/non-file/sensitive/out-of-tree objective gate files before reading, returns
  `chain-not-loop-runnable:<id>` for non-builder chains at the task-loop entrypoint,
  cleans default synthetic CLI temp repos, and reports `records_replaced` when a
  reused run id replaces a prior structural run directory. The live no-spend proof fetched
  current OpenRouter metadata, passed `nospend-preflight.mjs` and Pi inventory, then
  converged synthetic temp-repo revision debates for `openai/gpt-oss-20b:free` and
  `cohere/north-mini-code:free` (4 total live revision calls, zero price, no private
  input). 322 node tests pass after post-merge hardening; worktree self-test has 12 assertions; objective loop
  self-test has 8. No paid/metered call, hosted Fusion adapter, broad UI, remote control,
  autonomous/unattended mode, credential/private/transcript/provider-payload file read,
  or private input.
- **2026-07-09** — **Stage 3P whole-repo gap closure.** On branch
  `whole-repo-gap-closure-2026-07-09`, accepted Codex/Fable whole-repo review
  gaps were closed without implementing design-required product behavior early:
  schema validation now uses own-property checks; USD cost fields are nonnegative;
  git diff runners clear repo-targeting `GIT_*` env vars and deny expanded
  credential-shaped paths; diff-checker, adapter, gate, and run-record write
  failures surface stable safe details; public-safety scans cover macOS/Linux/
  Windows home-path forms; CI and `tools/ship/pr-gate.sh` share the public-safety
  diff scanner; docs truth locks cover test declarations, package resources,
  command count, and roadmap status; `/prime help` and refusal guidance are
  view-only/public-safe; runtime RPC defaults to 60s after a 20s candidate
  timed out in no-live verification; flat smoke records are
  labelled non-prunable; `docs/manual.md` is the direct user manual; and
  `docs/stage3/design-contracts.md` records the contracts for autoresearch, cost
  modes, composites, config overlays, loop visual cues, live enablement, and
  context engineering. `npm test` passes 362 node tests plus the worktree
  self-test (12) and objective-gate-loop self-test (8); 358 top-level node test
  declarations are locked by `npm run check:docs-truth`. Branch protection was enabled for `main` with one
  approving PR review and the `test` required check. No live provider call, paid/metered call, package
  adoption, remote approval, web access, composite selector, config editor, or
  autoresearch behavior was added.
- **2026-07-08** — **Stage 3O PR1: one `/prime` control surface implemented.**
  On branch `stage3o-prime-command` (`extensions/prime-command.ts`,
  `extensions/lib/prime-command-core.mjs`, `tests/prime-command-core.test.mjs`,
  `tests/prime-command-extension.test.mjs`, package/settings/resource pins, README,
  resources docs, command-surface inventory, Stage 3 loop docs, roadmap/summary,
  and ledger). This is the first Pi-native UX layer over the existing Stage 3
  machinery: `/prime` shows resolved dashboard state; `/prime run [config-id]`
  performs no-live preflight and prints the existing task-loop CLI invocation
  without launching it; `/prime runs list|status|prune` uses structural
  run-manager data only, with prune gated on TUI mode and explicit confirmation;
  `/prime models`, `/prime chains`, and `/prime profiles` are view-only. The
  accepted command-surface direction is one slash command with argument verbs,
  not the rejected eight-command split. Post-review hardening rejects
  root-resolving run ids, keeps completions fail-closed, derives chain loop
  status from task routes, shares task-loop preflight policy, and fixes the Pi
  message display contract. Final Info-level hardening makes malformed local
  registry/config JSON fail closed as `prime-config-unreadable`. 340 node tests pass for the node suite;
  no live provider calls were added or required.
- **2026-07-07** — **Stage 3K: lean agent-team defaults implemented.** On branch
  `stage3/lean-agent-team-defaults`
  (`dispatch/lib/agent-team.mjs`, `dispatch/config/agent-team-defaults.json`,
  `tests/dispatch-agent-team.test.mjs`, `docs/stage3/agent-team-defaults.md`,
  `docs/stage3/agents/builder.md`, `docs/stage3/agents/reviewer.md`, README/ROADMAP/
  summary/ledger). This ships the additive Builder + independent-provider Reviewer
  default without adding a slash command or provider/model matrix early. The helper
  validates stable canonical IDs (`Scout`, `Planner`, `Builder`, `Reviewer`,
  `Documenter`, `RedTeam`), bridges them to the existing lowercase dispatch roles,
  fails closed on missing/duplicate/unknown/mismatched role handles, and projects
  routing/log fields from canonical IDs only. Cosmetic aliases remain display-only
  labels and cannot affect routing, logging, config identity, or public records.
  296 node tests pass. No live/paid call, hosted adapter, subprocess fan-out,
  autonomous loop, or private payload.
- **2026-07-07** — **Stage 3J: live OpenRouter `:free` builder adapter implemented
  and proof-run.** On branch `stage3/live-builder-adapter`
  (`dispatch/lib/openrouter-revision-adapter.mjs`,
  `tests/dispatch-openrouter-revision-adapter.test.mjs`,
  `tools/smoke/openrouter-free-revision-smoke.mjs`,
  `docs/stage3/live-builder-adapter.md`, README/ROADMAP/summary/ledger + Stage 3I/3H
  doc updates). This ships the first live `modelAdapter.runRevision` implementation
  for the Stage 3I `makeModelRevision` boundary: a Pi/OpenRouter adapter restricted
  to `:free` model ids and caller-declared synthetic/public fixture paths. It refuses
  non-`:free` models and unsafe/sensitive paths before invoking Pi, disables tools,
  sessions, context files, skills, themes, prompt templates, and extensions on the
  live call, bounds the full outbound prompt with `max_input_bytes` before invoking
  Pi, parses only structured JSON whole-file edits, and throws stable codes only on
  runner/parser failures so raw prompt/response/stderr/diff/private text never
  reaches returned or persisted artifacts. The live proof fetched public OpenRouter
  `/api/v1/models` metadata for `openai/gpt-oss-20b:free` (prompt/completion price
  `0`), wrote temp candidate metadata, passed `nospend-preflight.mjs`
  (`ok-free-verified`), verified Pi inventory, then injected the adapter into
  `makeModelRevision` over a real temp git repo. The debate converged in 3 iterations
  (`diff-baseline`, `diff-changing`, `diff-stable`) with 2 live builder revision
  calls and the expected synthetic marker on disk. Post-review H1 added
  `openrouter-revision-input-too-large` and a 1 MiB oversized-fixture regression that
  refuses before runner invocation; H2 narrowed the credential wording to "no
  credential-file read/print/persist" because Pi may use existing authenticated
  provider state/environment. 288 node tests pass. No paid call, hosted adapter,
  credential/private/transcript file read, or private input.
- **2026-07-07** — **Stage 3I: real model-backed revision effect implemented.** On
  branch `stage3/model-backed-revision` (`dispatch/lib/revision-effect.mjs`, the shared
  `dispatch/lib/provider-policy.mjs` extracted from the orchestrator,
  `tests/dispatch-revision-effect.test.mjs`, `tools/smoke/revision-effect-smoke.mjs`,
  `docs/stage3/model-backed-revision.md`, README/ROADMAP/summary/ledger + the Stage 3H
  doc's out-of-scope note). Turns the Stage 3H injected `revise` boundary into a real,
  provider-policed, model-backed effect while keeping `debate.mjs` unchanged and pure.
  **`makeModelRevision(config, deps)`** builds a `revise(revisionState, ctx)` boundary
  effect (the same "build an injected effect from config" pattern as
  `makeGitDiffStability`): a `builder` model produces the next proposal, the effect
  validates it and mutates the worktree, and the debate's critic panel + **objective
  gate** close the builder→critic loop (a model producing a revision is never final
  authority, so there is no second convergence-gating critic call in the effect). Per
  call it (1) validates config + caps at the boundary — an unbounded/`Infinity`/missing
  cap fails closed (`unbounded-revision-caps`); (2) **projects provider/cost policy
  BEFORE any model call** through the shared `projectProviderPolicy` gate — an
  ineligible/non-automated provider, an unknown/stale/unsourced price, or a
  missing/stale Copilot pin refuses before the adapter is touched (call count 0); (3)
  validates the model's structured edits (`{ edits:[{path,content}] }`) and fails closed
  without surfacing model text on malformed output; (4) applies edits **all-or-nothing**
  under the Stage 3H write rules — allowlist-only, credential/private-shaped paths
  refused even if allowlisted (denylist wins), unsafe traversal/absolute/symlink/
  non-file/outside-tree paths refused, and earlier writes are rolled back on disk write
  failure; and (5) returns only a structural `sha256`
  `revision_ref` + a stable code — a thrown message / model narrative / private path
  never reaches `detail`, warnings, the summary, or a run record. The pre-launch cost
  gate is extracted into ONE shared copy used by both the orchestrator and the revision
  effect (no drift; the orchestrator re-exports `clampPriceToProfile` for its tests). A
  real temp-repo debate converges only on diff-stability + objective-gate-pass, with the
  real worktree actually holding the model's proposal; the effect is exercised with a
  deterministic in-process adapter — **no live/paid call** (the live builder adapter and
  the live `:free` proof, with the exact maintainer preflight, are documented, not run).
  282 node tests pass (+15). No credentials read; no network.
- **2026-07-07** — **Stage 3H: real revision / diff surface implemented.** On branch
  `stage3/real-revision-diff-surface` (`dispatch/lib/git-diff-surface.mjs`,
  `dispatch/lib/adversarial-policy.mjs`, the injected `revise` boundary +
  default-on policy wiring in `dispatch/lib/debate.mjs`,
  `tests/dispatch-git-diff-surface.test.mjs`,
  `tests/dispatch-adversarial-policy.test.mjs`, +7 in
  `tests/dispatch-debate.test.mjs`, `docs/stage3/real-revision-diff-surface.md`,
  README/ROADMAP/summary/ledger). Wires the Stage 3G loop to **real local signals**
  while keeping the debate core pure — all git/worktree side effects live in injected
  boundary effects. **(1) Real working-tree diff stability:**
  `computeDiffFingerprint`/`makeGitDiffStability` build a structural, public-safe
  `sha256` fingerprint of the current git diff via deterministic git plumbing (the
  tracked patch + untracked content hashes; the returned surface carries only
  hashes, counts, and a baseline commit ref — never raw diff/patch text), pin a
  clean config-independent git environment, take the snapshot twice to guard
  determinism, and fail closed on `not-a-git-repo`, `missing-baseline`,
  `index-ambiguous`, `git-command-failed`, `unsafe-path`/`unsafe-baseline-ref`,
  `diff-read-failed`, or `diff-nondeterministic`. Two observations are required to
  prove the proposal stopped changing, so the first iteration is always a baseline.
  **(2) Real proposal revision boundary:** `runDebate` gains an optional injected
  `revise(revisionState, ctx)` effect that runs between non-converged adversarial
  iterations to produce the next proposal in the worktree (the only thing allowed to
  mutate it; skipped on the final iteration). Revision state threads as **refs/hashes
  only** (`revision_ref`) — never free text; a failed revision (`ok !== true`, a
  thrown effect, or a non-ref result) stops fail-closed
  (`revision-failed`/`revision-invalid`) while **preserving the iteration evidence
  already produced**, and a present-but-non-function effect fails closed
  (`invalid-revision-effect`) before iterating. Absent ⇒ Stage 3G behavior,
  byte-for-byte (no `revisions` key is added to the summary). The boundary is
  exercised with a **local deterministic** revision effect, never a fake model
  adapter. **(3) Default-on adversarial policy:** `resolveAdversarialPolicy` makes
  meaningful work (plans, reviews, risky changes, security, architecture, roadmap
  reconciliation, PR preflight — exactly the routes carrying an adversarial role)
  **default-on**; the `/adversarial off` opt-out rides the existing
  `task.override.disable_adversarial` channel (no new slash command; the repo's
  extensions stay pinned to `prime-fence`/`prime-answer`) and is recorded as the
  stable `adversarial-opt-out` code; the policy never widens a panel, so heavier 3+
  model / every-task runs stay explicit opt-in. Convergence is still exactly
  diff-stability + objective-gate-pass, both deterministic checkers — making the diff
  real changes nothing about who decides, and the verifier stays advisory. Three PR #20
  review fixes folded in with reproducing regressions: (a) the diff surface never
  follows an untracked symlink (which could read outside the work tree) and refuses
  credential/private-shaped untracked files — untracked handling is **fail-closed by
  default** (`untracked-content-refused`), with content hashing opt-in only for an
  explicit `untracked_policy` allowlist of safe/public paths and a sensitive-name
  denylist (`unsafe-untracked-symlink`/`-nonfile`/`-path`/`-sensitive`); (b) allowlisted
  untracked files are **content-hashed**, so a same-size content edit is visible and
  cannot falsely converge the loop (an earlier metadata-only attempt could have — a
  false diff-stable is unacceptable because convergence needs both signals true); and
  (c) revision-failure `detail` carries only stable codes (a thrown message is dropped;
  a `rev.code` is surfaced only if it matches the stable-code marker, as
  `revision-subcode:<code>`), so a private path / raw diff / model text can never reach
  a returned or persisted field. 267 node tests pass (+34). No live provider call, no
  credential reads, no paid calls, no raw diff text in any tracked file/record. Real
  model-backed revision, real non-mock adapters, real subprocess fan-out, the
  `documenter` role, the autonomous loop, and the hosted adapter remain out of scope.
- **2026-07-07** — **Stage 3G: iterating multi-team / adversarial debate loop
  implemented.** On branch `stage3/iterating-adversarial-debate`
  (`dispatch/lib/debate.mjs`, `tests/dispatch-debate.test.mjs`,
  `docs/stage3/iterating-debate.md`, a 5th deterministic scenario in
  `tools/smoke/dispatch-smoke.mjs`, README/ROADMAP/summary/ledger). The smallest
  complete substrate for long-lived, gate-seeking work: one iteration is exactly the
  Stage 3B–3F dispatch cycle, and the loop **composes** `runDispatch` (adds no policy
  of its own) rather than duplicating it — dependencies flow inward, the dispatch core
  never imports the debate layer, and the per-cycle recursion fence is untouched. The
  loop repeats only for routes that call for adversarial iteration (a
  `redteam`/`judge`/`synthesizer` role, unless `task.override.disable_adversarial`);
  non-adversarial routes are single-pass. **Convergence is exactly diff-stability +
  objective-gate-pass** — the only signals are an objective gate result of `pass`
  (from exit status / a deterministic checker, captured in the run record) and an
  injected deterministic diff-stability checker; model consensus, judge approval,
  verifier approval, and synthesis confidence are never final authority (an advisory
  gate never converges, and the Stage 3E verifier still can't rescue a failed gate or
  block a passed one). Hard caps are mandatory and fail closed **before** any
  iteration: a missing/unbounded `max_iterations` or aggregate `token_budget` refuses
  the debate; the aggregate token budget is a hard rail across iterations that wins
  over convergence (`token-budget-exceeded`); an unavailable, invalid, or
  non-deterministic diff checker fails closed; a hard fail-closed iteration is never
  retried; and a gate that never passes before `max_iterations` fails closed
  (`not-converged-within-max-iterations`). Iteration summaries are structural-only
  (iteration number, gate result/source, diff result/code, cap status, warning codes,
  run refs) — no model narrative enters the public debate summary, which is re-scanned
  for public safety before it is persisted to the gitignored records dir. Deterministic
  under mock adapters: a fixed seed/input yields byte-identical per-iteration records
  and a byte-identical debate summary. A review of PR #19 folded in three fixes
  (regressions in the same PR): a hard fail-closed iteration now preserves its
  usage/cap evidence by appending the failed cycle's valid record (a fail-closed with
  no record returns `iteration-fail-closed-no-record`); the diff `code` is validated
  as a structural token so prose cannot enter the public summary; and a non-object
  `runDebate` request fails closed instead of throwing. 233 node tests pass (+28). No
  live provider call, no credential reads. Real proposal revision + a real
  working-tree diff, the `/adversarial off` default-on surface, real subprocess
  fan-out, and paid/live calls remain out of scope.
- **2026-07-07** — **Stage 3F: thin parallel / multi-team dispatch implemented.**
  On branch `stage3/parallel-multiteam-dispatch` (`dispatch/lib/parallel.mjs`,
  parallel launch + cross-family advisory in `dispatch/lib/orchestrate.mjs`,
  `dispatch/lib/providers.mjs` `providerFamily`, `tests/dispatch-parallel.test.mjs`,
  `tools/smoke/dispatch-smoke.mjs`, `docs/stage3/parallel-dispatch.md`). Built
  thinly on the Pi `examples/extensions/subagent` concurrency-limiter pattern
  (confirmed installed; `mapWithConcurrencyLimit`, input-order results, MAX 8 /
  concurrency 4) — Prime reproduces only the pure limiter, no subprocesses. Opt-in
  `deps.parallel = {max_concurrency, token_budget}` gives bounded-parallel candidate
  launch; sequential is the default and existing callers are byte-for-byte
  unchanged. An invalid concurrency cap (`invalid-concurrency-cap`) or an unbounded
  per-run token budget (`unbounded-parallel-budget`) fails closed pre-launch; total
  tokens over budget fail closed (`token-budget-exceeded`) post-launch. Parallel
  results are processed in candidate-index order, so completion order never changes
  outcomes/records/warnings (same-config parallel runs are byte-identical; the
  smoke's parallel record is byte-identical across runs and the three prior records
  are unchanged; parallel yields the same candidate outcomes as sequential). The run
  record's `cap_status.token_cap` records the effective enforced budget (the stricter
  of the deps budget and the profile cap) — never null while a finite budget governed
  the run, on ok and fail-closed records alike. All existing gates preserved; a
  failed parallel candidate is isolated at its index and still counts against
  `min_successes`. Lean multi-team: a cross-family advisory
  (`cross-family-not-satisfied`, warn-only) on `requires_cross_family` routes — the
  iterating adversarial debate is deferred, not stubbed. A review fix also carries
  the effective enforced token cap into the verifier proof input's `cap_status`
  (matching the run record). 205 node tests pass. No live provider call.
- **2026-07-07** — **Stage 3E: verification stage implemented.** On branch
  `stage3/verification-stage` (`dispatch/lib/verification.mjs`, verification stage
  in `dispatch/lib/orchestrate.mjs`, `tests/dispatch-verification.test.mjs`,
  `tools/smoke/dispatch-smoke.mjs`, `docs/stage3/verification-stage.md`): the
  `verifier` role runs after the objective/advisory gate result is captured, only
  on `verifier` routes (`pr-preflight`). It is injected (`adapter.runVerifier`) and
  receives a purely structural, public-safe proof summary (`projectForVerification`:
  exit status, gate command names/kind/result/source, cap status, warning codes,
  claims/evidence refs — no model narrative or provider payloads). Its envelope is
  validated as `stage:"verification"`/`role:"verifier"` and matched to the vetted
  spec; missing config/hook, malformed/mismatched envelope, and an ineligible
  verifier provider fail closed. **The verifier is advisory only: it summarizes
  proof but never determines the recorded gate result** — gate outcomes still come
  only from process exit status or a deterministic checker. A positive verifier
  cannot turn a failed gate into success; a negative verifier cannot turn a passed
  gate into failure. The gate control flow was refactored to capture the result
  (not early-return) so the verifier runs on both pass and fail. No verifier
  narrative is persisted (persisted record shape unchanged); only its stable status
  enum is returned in the result. The stale Stage 3D "public-safe structural
  summaries" ledger wording was corrected to the accepted identity/cost-stripped
  role-output projection wording. 190 node tests pass. No live provider call.
- **2026-07-06** — **Stage 3D: synthesis stage + preflight-gated no-spend adapter
  implemented.** On branch `stage3/synthesis-nospend-adapter`
  (`dispatch/lib/synthesis.mjs`, synthesis stage in `dispatch/lib/orchestrate.mjs`,
  `tests/dispatch-synthesis.test.mjs`, `tools/smoke/openrouter-free-dispatch-smoke.sh`,
  `tools/smoke/fixtures/openrouter-free-candidate.json`,
  `tests/dispatch-nospend-preflight.test.mjs`,
  `docs/stage3/synthesis-nospend-adapter.md`): the synthesizer runs after the
  candidate panel and the advisory judge, before the objective gate, only on
  `synthesizer` routes; it is injected (`adapter.runSynthesis`) and consumes
  candidate/judge output as an identity/cost-stripped role-output projection
  (provider-bound adapter input carrying substantive model text, not a public-safe
  record artifact); its envelope is validated and matched to the vetted spec, and
  passes the same pre-launch cost/provider-policy projection as a candidate;
  unresolved candidate contradictions are mechanically preserved — a dropped
  marker fails the run closed (`synthesis-dropped-contradiction`), a preserved one
  records `contradiction-preserved`; the judge stays advisory and the objective
  gate still decides success; no synthesis-envelope substance enters the public
  run record. The first preflight-gated no-spend adapter smoke runs the mechanical
  `nospend-preflight.mjs` before any provider call; the live OpenRouter `:free`
  smoke was **skipped (fail-closed)** on the intentionally stale committed
  metadata — no live call made, documented honestly. Pre-merge review fixes added
  a pre-launch cost/provider-policy projection for every dispatch on all profiles
  (metered specs without fresh sourced price fail closed before any adapter call),
  enforced the `github-copilot` pinned-model gate (`evaluateCopilotPin`) for
  candidate/judge/synthesizer with pin freshness bounded by the profile
  `copilot_pin_ttl_seconds` ceiling (an overlong pin TTL cannot extend it), and
  relabeled the synthesis projection as an identity/cost-stripped role-output
  projection (not a public-safe artifact). 179 node tests pass.
- **2026-07-05** — **Stage 3C: thin dispatch orchestrator implemented.** One
  dispatch cycle over the Stage 3B policy core on branch
  `stage3/thin-dispatch-orchestrator` (`dispatch/lib/orchestrate.mjs`,
  `tests/dispatch-orchestrate.test.mjs`, `tools/smoke/dispatch-smoke.mjs`,
  `docs/stage3/dispatch-orchestrator.md`): dependency-injected
  adapters/clock/seed/gate; classification with floors and fail-closed non-TTY
  escalation; N3 panel precedence with recorded truncation; pre-launch
  no-spend/eligibility gates (canonical provider allowlists, automated-dispatch
  exclusion, metadata price-TTL clamped to profile policy — the follow-up the
  post-merge audit deferred to the orchestrator); role envelopes validated at
  the boundary before judge/synthesis; blinded advisory judge
  (identity-stripped A/B/C projection, seed-derived permutation, judge-in-panel
  degradation warnings; the judge never sees seed or permutation and never
  decides the gate); cap enforcement over recorded usage; objective gates from
  exit status or deterministic checkers only; structural public-safe run
  records for every post-panel outcome; recursion depth exactly one. A
  deterministic mock smoke writes byte-identical records into gitignored
  `dispatch/runs/`. 138 tests pass. **Mock adapters only — no live/paid calls;
  synthesis and the live OpenRouter `:free` smoke remain out of scope.**
- **2026-07-05** — **Stage 3B: dispatch-policy-core substrate implemented.**
  Built the pure, fail-closed Stage-3 policy core on branch
  `stage3/dispatch-policy-core` (`dispatch/`, `tests/dispatch-*.test.mjs`,
  `docs/stage3/dispatch-policy-core.md`): runtime role-envelope validation with
  the role/stage matrix (malformed output fails closed before judge/synthesis),
  canonical provider mapping, no-spend cost policy (mock + metadata-verified
  OpenRouter `:free` only; real providers, non-free ids, and unknown/stale price
  fail closed), the three dispatch profiles + Copilot-pin metadata, task-class
  routes with the reserved per-role model/effort/instance matrix, review
  findings **N3** (profile-cap vs route `min_successes` precedence) and **N4**
  (price-verification TTL/source) pinned, a deterministic classifier with
  mandatory classification floors and non-TTY fail-closed escalation, judge-bias
  blinding, and a public-safe run-record writer with a mechanical leak scan.
  Added the five spec evaluation fixtures + oracles and a mechanical
  `nospend-preflight` gate; 107 tests pass. Recorded and resolved a real spec/repo
  contradiction: TypeBox cannot be an installed dependency (the resource package
  forbids runtime deps and `typebox` resolves only inside Pi), so the runtime
  validator is a zero-dependency structural checker authored in the exact
  JSON-Schema shape TypeBox emits — drop-in for TypeBox in a Pi extension. **No
  orchestrator, no live/paid model calls; the optional live OpenRouter `:free`
  smoke was intentionally not run.**
- **2026-07-05** — **Stage 3A review fixes: Fusion-style dispatch spec tightened.**
  Folded the Fable 5 ACCEPT-AFTER-FIXES review into
  `docs/architecture/fusion-dispatch-research.md` without starting implementation:
  removed real Copilot from `no-spend-test`; required metadata-verified
  OpenRouter `:free` zero price and synthetic/public fixtures; added canonical
  provider mapping and native-Claude dispatch exclusion pending ROADMAP Q4; made
  TypeBox/runtime validation mandatory; added usage/cost/cap fields, per-route
  `min_successes`, max-iteration/convergence rules, non-TTY fail-closed escalation,
  classification floors, role/stage validity, effort/instances reservation,
  judge-blinding details, structural-only public-safe logging, and exhaustive
  Stage-3B scope. **No implementation shipped.** The fixed spec still needs final
  review/acceptance before `stage3/dispatch-policy-core`.
- **2026-07-04** — **Stage 3A: Fusion-style dispatch build spec drafted.**
  Rechecked the controlling primary sources (OpenRouter Fusion announcement/plugin
  guide; RouterBench; RouteLLM; FrugalGPT; Mixture-of-Agents; LLM-Blender;
  multiagent debate; LLM-as-judge bias) and expanded
  `docs/architecture/fusion-dispatch-research.md` from a research-gate note into
  a concrete architecture spec. The spec defines provider/cost profiles
  (`no-spend-test`, `personal`, `lockdown`), role envelopes, task routing,
  panel/judge/synthesis semantics, judge-bias mitigations, fail-closed behavior,
  public-safe logging, deterministic fixtures, and the next allowed build
  boundary (`stage3/dispatch-policy-core`). **No implementation shipped.**
  Phase-3 implementation remains blocked until the spec is reviewed and accepted.
- **2026-07-04** — **Fix (PR #10 review): yolo-fence RPC fail-closed.** The fence gated its
  confirm/fail-closed decision on `!ctx.hasUI`, but `ctx.hasUI` is **`true` in RPC mode**
  (docs/extensions.md:914, docs/rpc.md:1068) — so a destructive op could proceed under
  `--mode rpc`, violating the "fail closed in `-p`/json/rpc" requirement. Fixed
  `extensions/prime-fence.ts` to prompt **only** when `ctx.mode === "tui"` and block in
  `rpc`/`json`/`print` (both `tool_call` and `user_bash`). Added regression tests
  (`tests/fence-extension.test.mjs` now 10, incl. an explicit `rpc`+`hasUI:true` case) and
  corrected the claim in `docs/stage1-2/yolo-fence.md`, `docs/stage1-2/README.md`, and this
  roadmap. (Root `README.md` was already accurate — "fails closed in `-p`/json/rpc" — so it
  was not changed.)
- **2026-07-04** — **Stage 1+2 substrate: safety posture + verification core (first Prime
  code).** Shipped, all source-verified against Pi 0.80.3 and tested with no paid model
  calls: **yolo-fence** (`extensions/prime-fence.ts` + `extensions/lib/fence-rules.mjs`) —
  fences agent `bash`/`write`/`edit` tool calls + user `!` (`user_bash`) on a tunable
  denylist, **fails closed** in non-TTY; **worktree-manager basics**
  (`tools/worktree/prime-worktree.sh`) create/list/enter/merge/remove/prune on `git
  worktree`, **no secret copy**; **objective-gate loop** (`tools/loop/objective-gate-loop.sh`)
  gate-primary, **fails loud on a missing gate**, review advisory; **`\answer` resolver**
  (`extensions/prime-answer.ts` + `answer-core.mjs`) model-callable tool, top rec + ranked
  alternatives via `ctx.ui.select`, deterministic non-interactive path; **PR-gate basics**
  (`tools/ship/pr-gate.sh`) conservative fail-closed chain, one command, no `/` clutter;
  **plan/implement separation** documented over native `/new` + `PLAN.md` (nothing built).
  Wired `extensions` into `package.json` (`pi.extensions`, `pi-extension` keyword, `test`
  script) and `.pi/settings.json`; extended `tools/check-prime-resources.mjs` to enforce
  the extension surface. Tests: `npm test` = 20 node unit tests + worktree self-test (9) +
  loop self-test (8); both extensions load in real Pi 0.80.3. Docs: `docs/stage1-2/*`,
  ROADMAP §3/§10 (Phase-1/2 checkboxes), `ROADMAP_SUMMARY.html`, `README.md`. **Deferred
  (out of scope, unchecked):** Phase-3 orchestration, Fusion dispatch, remote-pi,
  pi-web-access, statusbar, live-shell, unbypassable push interceptor.
- **2026-07-04** — **Lockdown boundary + Level-2 smoke + first thin vertical smoke.**
  Chose the canonical lockdown boundary — **Plain Docker `docker run --network none`**
  (deny-by-default), rationale + rejected alternatives (Gondolin/OpenShell/VM/host-firewall)
  in `docs/m0a/lockdown-boundary.md`, matching Pi `docs/containerization.md`. Shipped a
  public-safe **Level-2 lockdown smoke harness** (`tools/lockdown/`: `Dockerfile` pinned to
  Pi `0.80.3` `--ignore-scripts`, `no-egress-smoke.sh`, zero-dep `mock-openai-endpoint.mjs`,
  `container-active-probe.sh`) and **ran it: 5/5 PASS** (evidence
  `reviews/m0a/level2-lockdown-smoke-2026-07-04.md`) — the container has no non-loopback
  interface, `pi.dev` + a provider host are unreachable, a representative Pi startup loads
  the committed `.pi/settings.json` + `prime-ui` + Rose Pine themes + pinned extensions
  offline (exit 0), and a full `pi -p` session routes only to a local mock approved endpoint. No secrets, no spend,
  no host firewall changes; `auth.json` never read. Shipped the **first thin vertical smoke**
  path (`docs/m0a/vertical-smoke/`: plan/answer capture, second-provider review handoff, raw
  worktree checklist, PR-gate checklist) + `tools/smoke/status.sh` (offline status
  visibility). Updated §3, §10, `docs/m0a/*`, `reviews/m0a/*`, `README.md`,
  `ROADMAP_SUMMARY.html`. At the time of this slice, the real-provider live-call proof and
  Claude-auth live-billing probe were still open; the OpenRouter `:free` proof is
  superseded by the next changelog entry. No paid model call was made.
- **2026-07-04** — **M0a cleanup + OpenRouter free real-provider smoke.** Updated the
  stale immediate-next-action wording to point at the Stage 1+2 implementation bundle.
  Added `tools/smoke/openrouter-free-smoke.sh`, which refuses non-`:free` model ids and
  runs Pi with tools/session/context/resources disabled. Ran the smoke against
  `cohere/north-mini-code:free`: inventory visible, live call returned the expected marker,
  no spend, no secrets, no transcript committed. Evidence:
  `reviews/m0a/openrouter-free-smoke-2026-07-04.md`. This closes the real-provider
  live-call proof without claiming privileged packet-level endpoint exclusivity. Still open
  in Phase 0: Claude-auth live-billing probe; `/share` denial is a future lockdown follow-up.
- **2026-07-04** — **Prime resource package + Rose Pine + Fusion research gate.**
  Added `package.json` for the private `prime-pi` Pi package, exposing exactly one
  Prime-owned skill (`skills/prime-ui`), the local `themes/` directory, and the two
  pinned extension entrypoints. Renamed the
  former `beast-ui` concept to **Prime UI** (`/skill:prime-ui`) and consolidated the
  UI shaping/audit/layout/typography/copy/color/motion/polish/optimization guidance into
  one `SKILL.md`, keeping the Prime package slash surface to one skill command. Vendored
  audited Rose Pine theme JSON from `pi-themes-rose-pine@0.1.0` as
  `prime-rose-pine`, `prime-rose-pine-moon`, and `prime-rose-pine-dawn`, preserved the
  upstream MIT license, selected `prime-rose-pine` in `.pi/settings.json`, and
  recorded the package audit in
  `reviews/package-audits/2026-07-04-pi-themes-rose-pine.md`. Added
  `tools/check-prime-resources.mjs` / `npm run check:resources` to enforce the resource
  invariants. Added `docs/architecture/fusion-dispatch-research.md` as the Phase-3
  research gate for DIY Fusion-style panel/judge/synthesis dispatch: no implementation
  until provider/cost policy, role schema, fixtures, judge-bias mitigations, failure
  behavior, and public-safe logging are specified. No-spend provider inventory now shows
  OpenAI Codex, OpenRouter, and GitHub Copilot models visible here; OpenRouter tests are
  `:free` only, and the then-current Copilot test candidate was the cheapest Pi-visible
  model (`github-copilot/gpt-5-mini` as of this check; re-check if `GPT-5.4 nano` becomes
  visible). Azure Foundry remains postponed. *Superseded 2026-07-05 for Phase-3
  dispatch: `no-spend-test` excludes real Copilot calls; Copilot tests are
  personal/maintainer-profile only with a current pinned eligible model.*
- **2026-07-03** — **Review-fix: Copilot restored to must-have; Fusion intent clarified**
  (PR #6 review). (1) **GitHub Copilot is must-have provider coverage** (maintainer
  correction) — a native OAuth/subscription provider that is **TBD/unverified on this
  personal machine** (needs the work laptop or a provider login); it does **not** block M0a
  but is required future coverage. Removed the "dropped from must-have / not required / free
  if ever logged in" framing from §7-Theme A, §8, and the Phase-0 provider checklist, and
  from `docs/m0a/provider-and-egress-posture.md` + `ROADMAP_SUMMARY.html`; the 2026-07-01
  changelog entry is preserved as historical record with a *superseded* marker. (2) **Fusion
  intent corrected:** the **DIY Fusion-style panel → judge → synthesis dispatch is CORE
  Phase-3 architecture** (built on the per-role model/effort/instance matrix + adversarial
  substrate, using approved providers only) — dropped the "don't custom-build" framing; the
  **hosted `openrouter/fusion` model is only an optional adapter, disabled by default,
  privacy/provider-policy gated** (no unapproved OpenRouter fan-out in lockdown/corporate
  mode). Updated §2 Security, §7-Theme A, Phase 4, `ROADMAP_SUMMARY.html`, and
  `docs/m0a/out-of-scope.md`. No code or evidence changed.
- **2026-07-03** — **M0a finalize slice + larger-stage strategy.** Closed three Phase-0
  items against installed Pi `0.80.3` source/docs (evidence
  `reviews/m0a/pi-internals-2026-07-03.md`): the **interactive `/` baseline** (22
  `BUILTIN_SLASH_COMMANDS`; `enableSkillCommands` default `true`; prime-added = 0), **native
  tool/function calling** (7 built-in tools, `registerTool`/TypeBox, parallel-exec
  default-on, `--tools`/`-xt`/`-nbt`/`-nt` gating — nothing to build), and the §9-Q6
  **compaction** probe — **resolved by code**: context files are appended into the system
  prompt (`agent-session.js:669-680` → `system-prompt.js`) and sent separate from `messages`
  (`:244`), while `compaction/compaction.js` never touches the system prompt ⇒ no drift, so
  **`APPEND_SYSTEM.md` is not created**. §9-Q6 is now fully closed. Ran the **Claude-auth
  spike** partially: local feasibility confirmed (first-party `claude` `2.1.200` + `codex`
  present; wrapper buildable per `providers.md:266`) and economics settled from docs (native
  Anthropic OAuth = extra-usage per-token, `providers.md:31`; Codex = subscription, `:26`);
  the **live-account billing probe stays deferred** (needs a real billed call — no secrets
  read, `auth.json` untouched). Re-confirmed provider posture: `~/.pi/agent/settings.json`
  still has **no `defaultProvider`** and `pi --list-models` shows **no authenticated
  provider** (OpenAI/OpenRouter/Claude not logged in; Foundry/Copilot TBD), so the non-`google`
  provider-default sub-check and the active-session checks stay open. Adopted a **larger-stage
  execution strategy** (§10): one Claude prompt per stage, up to ~12 internal fix/review
  cycles, explicit acceptance gates, and **Phases 1–2 may be bundled to reach Phase 3 sooner
  without cutting scope** (Neovim/Pi stays Phase-4 deferred). Updated §3, §7-Theme I, §9-Q4/Q6,
  §10, §12, `docs/m0a/*`, `reviews/m0a/*`, and `ROADMAP_SUMMARY.html`. Still open: machine-local
  provider apply, boundary + Level-2 trace, Claude-auth live-billing, first vertical smoke.
- **2026-07-03** — **Moved Neovim/Pi integration to deferred.** Maintainer decision:
  Neovim and Pi do not need to ship together. Removed `pi-nvim` from M1/Phase 1 and
  kept only native Ctrl+G prompt editing as the current editor affordance. `pi-nvim`
  remains a Phase 4 candidate, blocked on Pi `0.80.3` compatibility and full
  package/no-exfiltration audit if revisited.
- **2026-07-03** — **M0a closeout slice: telemetry baseline + Level-1 offline/telemetry smoke.**
  Shipped a **trusted-project** telemetry-off baseline as a committed, shareable project
  `.pi/settings.json` (`enableInstallTelemetry:false`, `enableAnalytics:false`; project
  settings override global, where `enableInstallTelemetry` defaults `true`) — it applies
  only once the project is trusted/`--approve` (`docs/settings.md:14-16`), with env
  `PI_OFFLINE=1`/`PI_TELEMETRY=0` as the trust-independent controls. Ran the Level-1
  smoke, saved sanitized under `reviews/m0a/level1-no-egress-2026-07-03.md`: the
  **telemetry + offline-startup checks pass** (env switches set; **no Google
  credentials** — env vars unset and `pi --list-models` reports no authenticated
  provider, `auth.json` not read; offline `pi --version`/`--help` OK; `pi --approve
  --list-models` loads project settings without error), but Level-1 is **not fully
  green**: the required non-`google` `defaultProvider` sub-check is **open**.
  **Decision (maintainer):** `defaultProvider` is kept **machine-local**, not in the
  shared repo config — documented (template in
  `docs/m0a/provider-and-egress-posture.md`) but **not yet enforced**; Pi's CLI default
  stays `google` until set in `~/.pi/agent/settings.json`. Updated §3, §10, and
  `docs/m0a/*` + `ROADMAP_SUMMARY.html`. Still open: machine-local provider apply,
  Level-2 in-boundary trace, boundary choice, Claude-auth spike, compaction probe, `/`
  baseline.
- **2026-07-03** — **Started M0a (evidence + security/provider baseline).** Added a
  repeatable evidence script `tools/m0a/collect-evidence.sh` (offline by default —
  forces `PI_OFFLINE`/`PI_SKIP_VERSION_CHECK`/`PI_TELEMETRY` for every `pi` call, never
  reads `auth.json` or prints secrets; `--network` opt-in queries only public npm
  registry metadata for the named lead candidates) and public-safe docs under
  `docs/m0a/` (evidence snapshot + refresh, context/project-trust plan, command-surface
  inventory, provider/egress posture, no-egress smoke checklist, out-of-scope). Marked
  Phase 0 in progress in §3. Re-verified §4 (Pi `0.80.3`, package `0.80.3`, docs
  checksum `5aa4edd2…` — all unchanged; candidate metadata rechecked: `remote-pi@0.5.3`
  `^0.78.0` and `pi-nvim@0.2.4` `^0.74.0` still miss `0.80.3`). **Newly recorded facts:**
  the two `pi.dev` startup endpoints (`/api/latest-version`, `/api/report-install`) have
  **independent** controls and only `--offline` closes both; `enableInstallTelemetry`
  defaults `true`; `pi --help`'s env list is not exhaustive (omits
  `PI_SKIP_VERSION_CHECK`, which `docs/settings.md`/`usage.md` document); context files
  load regardless of project trust (`docs/security.md:27`); and — resolving the §9-Q6
  shadowing sub-question against installed code (`dist/core/resource-loader.js`
  `loadContextFileFromDir()`) rather than the ambiguous prose — `AGENTS.md` **shadows**
  a same-dir `CLAUDE.md` (first match of `AGENTS.md`/`AGENTS.MD`/`CLAUDE.md`/`CLAUDE.MD`,
  one file per directory; "concatenated" is across dirs), and Pi's global context dir
  is `~/.pi/agent`, not `~/.claude`. Still open in M0a: apply settings to config,
  choose the lockdown boundary + capture the network trace, the Claude-auth spike, the
  **compaction** runtime probe (the only remaining §9-Q6 item), and the `/`-baseline.
- **2026-07-03** — Added `ROADMAP_SUMMARY.html`, a simple public-safe HTML view of
  the requirements decisions, build order, blocked candidates, and M0a scope. Added
  a convention to keep it aligned after major roadmap changes.

- **2026-07-02** — Folded the post-fold red-team fixes from Codex + Claude into the
  public roadmap. Key results: re-recorded the Pi docs/examples checksum with a
  reproducible cwd-bound command; corrected Pi lifecycle count to ~30; changed
  `pi -e npm:<pkg>` from "try without installing" to temporary install/run after
  audit; expanded command-surface accounting to include prompt templates and skill
  commands; marked `remote-pi` and `pi-nvim` blocked on current Pi `0.80.3`
  compatibility evidence; made worktree-manager candidates source-pinned/non-npm-aware;
  split the first build into M0a evidence + security baseline; added `/share`,
  project trust, prompt injection, CI egress, and public-remote branch hygiene to the
  risk model; updated the reusable red-team prompt to current post-fold assumptions.

- **2026-07-02** — Folded the reconciled planning review into this canonical
  `ROADMAP.md`. Key results: Pi re-pinned to `0.80.3`; `docs/security.md` and
  `docs/containerization.md` added to the authoritative docs inventory; telemetry
  controls expanded to `PI_OFFLINE=1` / `--offline`, `PI_SKIP_VERSION_CHECK=1`,
  `PI_TELEMETRY=0`, and `enableInstallTelemetry=false`; lockdown mode now means a
  named OS/network/container boundary; `claude` CLI dispatch is only a repo-owner-local
  candidate pending a Phase-0 wrapper/policy spike, with public/corporate builds
  valid under API-key/gateway/per-token economics; adversarial defaults are scoped to
  meaningful work; worktree defaults are scoped to implementation/multi-agent work;
  named packages are lead candidates pending audit, with raw package metrics captured
  under `reviews/package-audits/`; `remote-pi` stays candidate-only until Pi `0.80.3`
  compatibility is proved or upstream widens `^0.78.0`; the first slice is a thin
  usable vertical slice. Private review transcripts remain off the public-ready branch;
  added `SECURITY.md` plus `.gitignore` guardrails for public-safety hygiene; upgraded
  the generated Polaris entrypoints (`AGENTS.md`, `CLAUDE.md`,
  `.github/copilot-instructions.md`) to Polaris `0.1.2`.

- **2026-06-27** — Repo bootstrapped; installed Polaris per-repo (generated
  `AGENTS.md`/`CLAUDE.md`/`.github/copilot-instructions.md`/`.claude/`). Confirmed
  Pi `0.78.1`; located offline docs. Ran a 15-agent research+adversarial workflow
  (~600k tokens) to assess all brainstorm ideas against the CGS. **Key finding:**
  all 5 "mandatory" providers are built-in Pi providers; Pi core is minimal
  (sub-agents/plan-mode/permissions/MCP/worktree are example-extensions or absent).
  Rewrote roadmap with the native capability map (§5), per-idea CGS verdicts (§7),
  decided commitments (§8), 6 open decisions (§9), 5-phase plan (§10), risks (§11).
- **2026-06-27** — Three more requirements + a resolved Q7. (1) **Remote control =
  chat bridge for web+mobile**: ran the catalog-first gate live (ranked 14 bridge
  packages by measured downloads/stars/recency) → **`@llblab/pi-telegram`** wins
  (Telegram = web+mobile+desktop); `pi-messenger-bridge` for Slack; `remote-pi` for
  E2E. Resolved §9-Q7. (2) **Adversarial → first-class, default-on multi-team debate**
  (opposing + collaborating models) — **supersedes the earlier opt-in ratification**;
  reconciled with a trivial fast-path + per-run token budget + objective-gate
  convergence (§7-Theme B, §9-Q2 reopened). (3) **Configurable Codex-style status bar**
  (§7-Theme H). (4) **Quality Bar / definition of done**: nothing ships without
  comprehensive edge-case tests + e2e `pi`-load smoke test + CI (§8, §10 gates,
  cross-cutting test-harness task). Updated risks (§11) for default-on token burn +
  chat-bridge SaaS transit.
- **2026-06-27** — Committed the bootstrap (initial commit on `main`: Polaris contract
  + ROADMAP + `.gitignore`). Added **`reviews/codex-redteam-prompt.md`** — a
  self-contained adversarial-review prompt to red-team this roadmap with Codex
  (10 attack surfaces, evidence-first finding format, verify-Pi-claims mandate).
  Triage its findings back here; record rejected findings in `reviews/` with rationale.
- **2026-06-27** — **Clarified principle 6: "minimal" = minimal COMMAND surface, not
  fewer features.** All **16 features are must-have** (Neovim restored to MVP/M1). The
  `/` menu stays short/legible — most features land as native behavior / hooks /
  shortcuts / tools, not slash commands; adopted-package commands get trimmed via
  `pi config`. Added the §6 **Command-surface budget** table (target `/` set ≈ 6–7
  commands) + a §12 convention + per-phase `/`-menu audit. Reframed the §8 MVP tier
  (all 16; milestones = build order, not scope cut). Also corrected the tool-schema
  note (TypeBox, not zod). Recommended starting slice = **M0 + M1**.
- **2026-06-27** — **Security & data-sovereignty made the #1 non-negotiable** (corporate,
  egress-restricted): added §2 principle 0 + a Security callout (telemetry OFF /
  `PI_OFFLINE=1`, approved/self-hosted model endpoints only, no SaaS side-channels,
  secrets local); added a **no-exfiltration hard gate** to the §5 catalog procedure;
  Phase 0 now leads with an **egress lockdown + network-trace** task; added a CI egress
  test; new §11 risks (exfiltration/telemetry #1 + supply-chain). Provider/web-access
  rows carry the egress caveat.
- **2026-06-27** — Researched 7 more ideas (catalog-first, measured this date) → new
  **Theme I**: **tool calling = native** (confirm only); **`pi-web-access`** adopt
  (33,797 dl/wk, 706★ — top of ecosystem); **Neovim first-class** via `pi-nvim`
  (64★) + native Ctrl+G; **`\answer` = interactive multi-CGS resolver** (recovered
  intent — resolves Theme E's deferred item) built on native `ctx.ui.select`;
  `pi-annotate`/Plannotator (§9-Q8) + `pi-messenger` (618★, inter-agent + file
  reservation) as opt-in; `pi-file-widget` doesn't exist → folds into Theme H.
  Threaded into §8 and Phases 0–3.
- **2026-06-27** — Ratified the two follow-ups (final): **remote control = `remote-pi`
  (E2E)** — user prioritized end-to-end encryption over web reach (no browser client;
  chat bridge deferred). **Adversarial = default-on for EVERY task** — user accepts the
  cost; no trivial-skip; bounded by a per-run token-budget cap + max-iter. Updated §2
  principle 5 (adversarial = the default-on exception), Themes B/G, §8, §9-Q2/Q7,
  Phases 1 & 3, §11; removed the now-stale "fully opt-in" commitment line.
- **2026-06-27** — Added two requirements + their research. (1) **Catalog-first
  gate** (§2.1, §5): Pi has an official catalog (`pi.dev/packages` over npm
  `keywords:pi-package`, ~4,482 pkgs) — encoded a deterministic search→rank→quality-bar
  procedure as a mandatory pre-build gate. (2) **Remote control** (Theme G, §8): the
  existing **`remote-pi`** package (80★, MIT, active, pinned `^0.78.0`) already
  delivers multi-device + multi-session + per-session model selection via `--mode rpc`
  + an E2E relay — **adopt, don't build**; web client deferred (§9-Q7). Noted the
  remote-RCE risk (§11) and made the yolo-fence a prerequisite for enabling it.
- **2026-06-27** — Ratified open decisions: worktree = **opt-in** (default in-place);
  adversarial mode = **fully opt-in** via `/adversarial` flag (more conservative
  than the stakes-gated rec — keeps token cost fully user-controlled); Claude
  auth = **native OAuth first**. Q3/Q5 adopt safe defaults; Q6 folded into Phase 0.
  Phase 0 is now the active next step.
- **2026-06-30** — Second brain-dump (11 items) folded in + **worktree posture
  reversed**. (1) **§9-Q1 RE-RATIFIED → worktree-FIRST by default** (skip = opt-out),
  reversing the 2026-06-27 opt-in answer per the user's repeated literal "worktree-native"
  ask; CGS objection kept as a documented tradeoff (manager owns provisioning + prune).
  Threaded through §3, §7-Theme E, §8 (worktree moved to **M1**), Phase 1, §11.
  (2) New **§7 Theme J** (agent identity, orchestration UX & autonomous loops):
  **nerd callsigns** (display-only, role stays canonical) · **per-role model/effort/
  instance matrix** (budget-bounded) · **default chains** (scout-flow) · **live pipeline
  view** (feasibility-flagged) · **pre-PR gate chain** (no-mistakes; adopt the gate
  sequence, **defer the push-proxy**) · **universal run caps** (fold into the budget) ·
  **autonomous experiment loop** (gnhf/Karpathy — opt-in, hard-capped) · **worktree
  manager** (catalog-eval worktrunk/treehouse) · **firstmate** (defer/compose).
  (3) **Voice (OpenWhispr)** → Theme E, OPT, **local-only, no build** (cloud-BYOK forbidden).
  (4) **HTML theming** (Rose Pine default + one override path) → Theme C, deferred behind
  the HTML-output decision. Wired into §6 command budget (added `/ship`; now ~7-8 — flagged),
  §8 MVP tier (M2/M3 cluster + a Phase-4 OPT/DEFER note), Phases 2–4, and §11 risks
  (per-role cost blow-up, autonomous-loop runaway, pipeline/worktree feasibility;
  resolved the stale mandate-vs-evidence tension).
- **2026-07-01** — Six clarifications folded in (no new build started — input capture only).
  (1) **Security = DESIGN TARGET, not current constraint**: reframed §2 principle 0 +
  callout into two tiers — *always-on defaults* (telemetry off, google-default disabled,
  secrets local; ship for everyone) and a *first-class but opt-in LOCKDOWN MODE* (egress
  allowlist). Phase 0 split accordingly. (2) **Actual provider set = OpenAI (sub), Claude
  (sub), OpenRouter, Azure Foundry** — **Copilot dropped** from must-have (still supported
  free) *[superseded 2026-07-03: **GitHub Copilot is must-have** — maintainer correction;
  see §7-Theme A / §8 / Phase 0]*; ≥3 families ⇒ cross-family adversarial is satisfiable;
  updated Theme A, §8, Phase 0.
  (3) **Adversarial caps set (user-configurable): 5 iterations (primary), $100 / 10M-token
  per-run backstop, + an optional session/daily ceiling (default off)** — I added the
  aggregate ceiling because per-run caps don't bound default-on-every-task spend; Theme B,
  §9-Q2, Phase 3. (4) **§9-Q8 RESOLVED → `pi-annotate`** (annotate UI/design mockups);
  **Plannotator deferred**. (5) **Voice (OpenWhispr) = OUT of the build** — docs-only OS
  install + shortcut, local-only; Theme E + Phase 4. (6) **§9-Q4 sub-point opened**: user
  described Claude as "CLI on the logged-in user"; flagged native-OAuth (CGS) vs `claude`
  subprocess dispatch to confirm before wiring. Also synced the codex red-team prompt +
  STARTING-POINT appendix in the prior turn's worktree reversal.
- **2026-07-01 (corrections)** — Two follow-ups from the user closed the two flags above.
  (A) **Aggregate spend ceiling RELOCATED** from interactive adversarial → the **unattended
  autonomous loop** (Theme J / Phase 4): interactive default-on has the user present, so
  per-run caps (5 iter + $100/10M backstop) suffice; the session/daily ceiling is only
  load-bearing for gnhf-style unattended jobs. Updated Theme B, §9-Q2, Phase 3, Theme J,
  Phase 4. (B) **§9-Q4 REVERSED → `claude` CLI dispatch, not native OAuth.** Verified against
  `docs/providers.md:31`: native Anthropic OAuth bills third-party-harness usage as per-token
  *extra usage*, NOT the Max plan allowance — so CLI dispatch (first-party `claude -p`) is the
  cost-correct path (wrap as a custom provider; catalog-first; small build). OpenAI stays
  native Codex OAuth (that one *does* use the subscription — `providers.md:26`). Threaded
  through §5 providers table, Theme A, §8, §9-Q4, Phase 0. **The user was right; my earlier
  "native OAuth is CGS" call was wrong on the economics.**

## Prime v1 single-PR build (2026-07-09)

One PR on branch `prime-v1`, built to the amended
`docs/stage3/design-contracts.md` (owner product interview, 2026-07-09).
Milestones M1–M9, all shipped; adversarial review (M10) follows the PR.

- `[x]` **M1** — cost control removed from the harness; presence = live; exactly two rails (`max_iterations`, `max_concurrency`); token counts survive as capacity telemetry only.
- `[x]` **M2** — feature-toggle settings substrate: six user-local toggles (all default ON), fail-closed load/save, toggle vector embedded in every run record, loops-OFF single-pass degeneration.
- `[x]` **M3** — staged chains + the five-loop catalog: reviewer verdicts route (stay/advance/jump back), only the objective gate concludes, budget-consuming passes guarantee termination.
- `[x]` **M4** — composite presets + per-stage casts: `overlord`/`daily` tracked skeletons with mock members, fail-closed degradation naming the unavailable member, multi-model-OFF solo collapse.
- `[x]` **M5** — the staged runner: worktree-per-run, append-only structural event stream, per-stage dispatch panels with strictest-wins verdicts, interrupt-safe resumable state, `--repo` for real repositories.
- `[x]` **M6** — context engine: tracked role briefs, prompt compiler (template id + hashes, never compiled text), fresh-context handoff packets, append-only disagreement log, pressure telemetry.
- `[x]` **M7** — autoresearch machinery: mandatory metric+stop shape, four stop reasons (`target-met`, `max-iterations`, `diminishing-returns`, `dead-end` as a valuable result), attended-only.
- `[x]` **M8** — the `/prime` surface: settings, profiles, setup, research preflight, runs watch/resume — all verbs under the single `/prime` command.
- `[x]` **M9** — verification: toggle combination matrix (all-on, all-off, six singletons, three owner scenarios) plus all five chains end-to-end, all green.

Deferred (design-gated, not scheduled): web access for loops behind the
container boundary contract (deny-by-default egress, domain allowlist, scoped
credentials, PR-line review) plus a no-live fixture proof; remote control;
hosted adapter; package adoptions (pin + audit bar); scheduled runs; unattended
research; routing self-optimization; Pi `/model` integration (the interactive
session driver stays Pi's own); migration tooling (only when a second schema
version exists); auto-compaction (only on pressure evidence); and prime-fence
decisions (the extension is untouched, deferred future work).

### M10 independent cross-family closure (2026-07-10)

- `[x]` Safe-integer and practical iteration/concurrency/panel bounds reject
  before allocation; per-stage counters remain cumulative across jumps/resume.
- `[x]` Legacy and staged runners unconditionally refuse real-provider casts;
  an injected test adapter cannot turn on deferred transport or create a
  mock-executed record carrying real provider/model ids.
- `[x]` Resume checkpoints bind execution/repository/worktree/toggles and
  reconcile pending boundary events without replay; raw handoffs are not
  persisted and are reconstructed from bound worktree sources.
- `[x]` Per-pass recovery uses private Git-common-dir snapshots (never Git
  objects/public records), deterministic run branches, lease/CAS ownership,
  full checkout fingerprints, and exact chain-aware machine validation.
- `[x]` Records/events/disagreements/research/run-manager and `/prime` disk
  readers use closed structural validation; duplicate IDs reserve atomically and
  never clean existing evidence.
- `[x]` Profiles carry inventory-validated per-role composite members; every
  `/prime` mutation is attended-confirmed; real staged casts truthfully refuse
  until the deferred transport exists.
- `[x]` Research keeps exactly four stop reasons; CI resolves the effective
  staged mock cast, rejects workflow secret references, and removal-lints all
  tracked `dispatch/**`.
- `[x]` Compiled prompts are memory-only (the former private debug dump is
  removed); converged event history is terminal-gate-bound and renderer failures
  cannot rewrite durable truth.
- `[x]` Resume event prefixes bind the exact committed stage/pass set, required
  attempt sequence, configured iteration rail, and resolved executor; outward
  handoff effects run only after the conclusion gate passes and receive a stable
  idempotency key for kill/resume retries.

### M11 neutral-combiner remediation and clean publication root (2026-07-10)

- `[x]` Toxic persisted/rendered structures now use field-specific model,
  provider, code, and ref grammars plus defense-in-depth URI/path refusal.
- `[x]` Runner and `/prime` share one ordered chain lifecycle reducer; impossible
  stage order and terminal state/gate/`run-end` disagreement refuse.
- `[x]` Worktree collisions preflight before state creation; initialization reuse
  requires the exact private owner claim and clean baseline. State schema v3
  deliberately refuses pre-ownership checkpoints.
- `[x]` Structural persistence and private checkpoint generation installation
  are centralized under canonical root containment, non-symlink checks,
  exclusive no-follow temporary creation, verified atomic installation, and
  safe append semantics.
- `[x]` `visual-cues:false` renders every event unless `--summary` is explicit;
  settings version mismatch now refuses identically at save and load.
- `[x]` The release tree is staged for `prime-reloaded` as a fresh single-root
  history with noreply attribution. The original repository remains a private
  archive and `prime-reloaded` remains private pending the final independent
  audit and confirmation that the two historical Claude Code web sessions are
  Private or deleted. The maintainer selected the MIT License on 2026-07-11;
  the root license and package metadata now record that choice.
- `[x]` Final publication-doc remediation marks every Stage 3B-N implementation
  page as a superseded historical record, rewrites the live roadmap/HTML status
  to v1 semantics, mechanically locks the HTML declaration count and historical
  boundaries, clarifies that safe content-address overlap is not source-history
  reachability, and makes the PR gate refuse detached HEAD.
