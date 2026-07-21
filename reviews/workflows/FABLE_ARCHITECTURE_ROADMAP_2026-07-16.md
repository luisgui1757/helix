# Helix Workflow/Subagent Architecture Roadmap

- **Evaluation date:** 2026-07-16
- **Reviewer:** Independent principal-architect review (Claude Code / Claude Fable 5 session; multi-agent evidence collection with per-source reports)
- **Repository:** `luisgui1757/helix` (public, default branch `main`, not a fork)
- **Exact target SHA:** `bb1c37f62ee1808a5c24bac06d975023f73dcb3b` (local checkout clean, equal to `origin/main` at evaluation time)
- **Evidence SHAs (verified via `git ls-remote` this session):**
  - Helix CC `luisgui1757/helix-cc` — `842fa87f5e1dd34c9de2d01ec7ece93e64b1b6b6` (matches dispatch seed)
  - QuintinShaw/pi-dynamic-workflows — `2f28a74799ca83cd2dc35afc068091ba52167e04` (**drifted** from seed `75e0adff…`; delta = one commit, PR #77: README wording + one-time `console.warn` on `persistAgentSessions`; behaviorally trivial)
  - Michaelliv/pi-dynamic-workflows — `31b2aca0f1cb195aafbfc5e3ee2b8c83ad3f21a2` (matches seed)
  - router-for-me/CLIProxyAPI — `09da52ad509e2c18e7b9540db3b98c2214c280aa` (matches seed; tags to v7.2.80)
  - Installed Claude Code **2.1.211** (seed said 2.1.210 — patch drift; evaluated at 2.1.211)
  - Installed Pi `@earendil-works/pi-coding-agent` **0.80.3** (registry latest at evaluation: **0.80.7**)
  - Installed Codex CLI **0.144.4**; GitHub Copilot CLI **not installed** on the evaluation machine
  - Published `@anthropic-ai/claude-agent-sdk` **0.3.211** (npm-packed and type-declarations read in full)
  - Published `@quintinshaw/pi-dynamic-workflows` **2.13.2** (tarball/source/dist parity verified — built from its release commit `625cd03`, 4 commits behind repo HEAD)
  - Published `pi-dynamic-workflows` **1.0.1** (source parity, but **published `dist/` missing entirely** — broken as a library import)

---

## 2. Executive verdict

Helix should **remain on the Pi substrate and keep its own engine**, but the engine must change shape. Helix today is a *declarative, closed, chain-based* orchestrator with excellent fail-closed binding, consent, and persistence discipline — and it is missing the single mechanism that gives Claude Code workflows their power: a **deterministic, arbitrary-code workflow script surface** (`agent()/parallel()/pipeline()` with journaled, prefix-cached resume). No off-the-shelf option can be adopted wholesale: the Claude Agent SDK and native Workflow JS are constitutionally Claude-only; Michaelliv's package is a façade (per-agent model selection is prompt text, not binding); Quintin's fork is a real, heavily tested engine but is **fail-open on model binding** (silent fallback to session default, fabricated Model objects for unknown ids), pinned to a newer Pi than installed, and has bus-factor 1; CLIProxyAPI lacks two required provider families outright and its core mechanics are unofficial-subscription impersonation.

The recommended end state is a **native Helix Script Engine**: Claude-Workflow-compatible script semantics implemented inside Helix on Pi, with Helix's strict cast/consent/gate/persistence invariants underneath, the hard parts (journal hashing, prefix-replay resume, structured-output repair ladder, provider-limit-pauses, deterministic worktrees) **ported from Quintin's MIT-licensed fork rather than re-derived**, both dynamic-workflows test suites adopted as conformance oracles, and a strict per-provider identity/effort assertion layer added on top of Pi's registry. The dead legacy engine is deleted. Everything lands as one consolidated branch.

## 3. Direct answers

**How close is Helix to Claude Code workflows mechanically?**
Far, on the axis that matters most. Claude Code workflows are arbitrary deterministic JS programs over subagents with background execution, live observability, journaled same-session resume, structured-output repair, and opt-in worktree isolation. Helix has none of that surface: workflows are fixed chain templates (`dispatch/lib/workflows.mjs`), there is no script language, no fan-out beyond per-stage candidate panels, no resume for product runs (`task_bound: true` runs hard-refuse resume, `extensions/lib/helix-command-core.mjs:1660-1676`), no structured-output repair, and no run-progress UI comparable to `/workflows`. Where Helix is *ahead* of Claude Code mechanically: consent-to-execution binding (sha256 drift refusal), a deterministic objective gate as the only success exit (`dispatch/lib/events.mjs:189-199`), envelope identity cross-checks, and public-safety scanning of all persisted artifacts. Claude Code itself **silently falls back** to the inherited model when an org allowlist excludes a requested subagent model (documented) — the owner's exactness requirement is stricter than Claude's own reference behavior.

**How close is Helix to the owner's required multi-provider outcome?**
Closest of every option evaluated, and the only one with a credible path to 100%. Pi 0.80.x natively registers all five required families (anthropic, openai + openai-codex, github-copilot, azure-openai-responses, openrouter, plus ~25 more) with per-model thinking-level capability maps, and Helix's cast resolution refuses unknown tuples before egress at three layers (preflight inventory, runner live-guard, adapter session creation `dispatch/lib/pi-agent-adapter.mjs:127-144`). Gaps: no per-response effective-model/effort echo (Azure and OpenRouter can serve a different tuple than requested and Helix cannot detect it), an inventory-unavailable preflight hole, and no policy register distinguishing officially supported subscription paths (Copilot) from prohibited ones (Anthropic consumer OAuth in third-party tools).

**Is Helix closer to Claude Code than either dynamic-workflows repository?** Per axis, as required — one global yes/no would be wrong:

| Axis | Closest to Claude Code | Notes |
|---|---|---|
| Lifecycle mechanics (script, agent(), parallel/pipeline, background) | **Quintin** by a wide margin | Same script dialect, same primitives; Helix has no equivalent surface |
| Context isolation | **Tie (Quintin/Helix)** | Both create fresh sessions per agent; Helix's role envelopes are stricter, Quintin matches Claude's fresh-conversation model more literally |
| Orchestration semantics (fan-out/fan-in, failure propagation) | **Quintin** | null-propagation, caps, budget mirror Claude; Helix panels are a narrower fixed shape |
| Provider breadth | **Helix** (Claude Code is single-provider; so "closer to Claude" is the wrong prize here) | Michaelliv/Quintin inherit Pi's breadth but Quintin binds fail-open |
| Reliability / exactness | **Helix** | Fail-closed refusal codes everywhere; Quintin silently falls back on unresolvable specs (`src/agent.ts:543-544`) |
| Recovery (journal/resume/leases/crash) | **Quintin** (closest to Claude's journal+prefix-cache, and *exceeds* Claude with cross-process PID leases and paused-run reconciliation) | Helix's two-phase commit + checkpoints are excellent but unreachable from product runs |
| Observability / operator UX | **Quintin** (`/workflows`-equivalent TUI navigator, task panel, per-agent usage) | Helix renders event streams; no live drill-down |
| Michaelliv (all axes) | Far from both | Model/isolation/agentType options are prompt-text placebos (`src/workflow.ts:444-451`); zero persistence; abandoned |

**Single recommended target architecture:** the **Helix Script Engine on Pi** (§14): keep Helix's binding/consent/gate/persistence core, add a Claude-compatible deterministic script surface, port Quintin's recovery/repair mechanisms, add strict provider identity assertions, delete the legacy engine.

**Should Helix use Agent SDK / Workflow JS / current protocols / either dynamic-workflows package / CLIProxyAPI / a hybrid?**
- **Claude Agent SDK:** not as substrate — Claude-only by construction (every backend enum value is an Anthropic channel; no host-side workflow invocation; distributing claude.ai login is policy-prohibited). Optionally revisit later as an *additional* Claude-stage executor; not required by this roadmap.
- **Native Workflow JS:** no — model-invoked only, plan-gated, Claude-only. It is the *semantic reference*, not a substrate.
- **Current protocols:** keep the invariant core; replace the declarative-only execution surface.
- **Quintin's package:** do not adopt as canonical engine (fail-open binding, peer floor > installed Pi, bus-factor 1); **port mechanisms + adopt tests as oracle** (license-clean, MIT, verified artifact parity).
- **Michaelliv's package:** no dependency; adopt its determinism-validator conformance tests (the prompt-mention-safe AST check Quintin regressed on).
- **CLIProxyAPI:** no. Missing Copilot and Azure upstream entirely, serving account not client-observable, core mechanics are ToS-hostile subscription impersonation. Not needed: Pi already fronts the required families natively.
- **Hybrid:** yes in the narrow sense of *explicit per-provider strictness adapters* over Pi (OpenRouter request-pinning injection, Azure served-model assertion, subscription-policy register) — not in the sense of dual engines.

**Remove / retain / rewrite / add** — summary (full program in §16):
- **Remove:** legacy loop engine (`task-loop` legacy path, `debate.mjs`, `role-matrix.mjs`, `agent-team.mjs`, `adversarial-policy.mjs` legacy route table), `openrouter-revision-adapter.mjs`, dead chains (`scout`, `research`, `ship-pre-pr`), duplicate mock adapter, duplicate shell worktree system, `loop_runnable` labels derived from the dead engine.
- **Retain:** consent binding ref; deterministic-gate-only convergence; envelope identity cross-check; two-phase event/state commit; post-transition machine checkpointing; judge blinding; writer serialization; public-safety scan both directions; persistence/containment module; refusal-code discipline.
- **Rewrite:** effort/availability preflight (close inventory hole, add effective-tuple echo); adapter capability guard (replace duck-typed `kind` string); verdict extraction (schema-forced structured output with bounded repair, replacing scan-any-JSON); contradiction detection (structured disagreement records, not `/contradict/i` grep); checkpoints (bounded, git-object-based instead of full worktree copy); worktree lifecycle (surface, retain, clean).
- **Add:** deterministic script engine + globals; journaled prefix-cached resume incl. TUI runs; structured-output repair ladder; provider strictness adapters + policy register; live run observability; instruction-boundary `fence()` (ported from Helix CC) ; opt-in live-provider proof suite; Pi ≥0.80.7 pin behind a runtime-adapter seam.

## 4. Scope, permissions, constraints, verification limitations

- REVIEW mode with one permitted write (this file). No code, config, settings, branches, remotes, issues, PRs, or releases were modified; nothing was committed or pushed. No paid/live model or provider endpoint was invoked. Account checks were limited to non-mutating status classifications.
- All external repos were evaluated in read-only clones under a dedicated disposable temp root (removed at evaluation end). Helix's tests were executed in a *clone*, never in the user checkout. `npm install --ignore-scripts` was performed only inside the two dynamic-workflows clones to run their suites.
- **Verification limits:** (a) no live-provider behavior was proven this session — all "live" claims are labeled and carried into the uncertainty register; (b) Claude Code internals were evidenced by public docs + bounded string extraction from the installed binary (no deep reverse engineering); (c) Quintin's suite ran against Pi 0.80.6 (its dev resolution), not installed 0.80.3 — runtime compat on 0.80.3 is unverified and moot given the required Pi upgrade; (d) the Go toolchain was absent, so CLIProxyAPI was static-analysis only; (e) `learn.chatgpt.com` now hosts Codex docs (developers.openai.com 308-redirects there).

## 5. Evidence ledger

Versions/commits: see header block. Key commands executed and results:

| Command (context) | Result |
|---|---|
| `git ls-remote` on all five targets | SHAs recorded above; Quintin drift identified (one trivial commit) |
| Helix clone `npm test` (node --test + worktree/loop selftests) | **598/598 pass**, 0 skip, ~31.3 s; worktree selftest 12/12; loop selftest 8/8 |
| Helix clone `check:resources`, `check:docs-truth`, `check:no-live-egress`, `check:public-safety-diff` | all PASS |
| Quintin clone `npm test` (biome + tsc + tsx --test) | **861 tests / 63 suites, all pass** (~8.7 s; resolved Pi 0.80.6) |
| Michaelliv clone `npm test` | **24/24 pass** (~1.7 s; pinned Pi 0.78.0) |
| `npm pack` both dynamic-workflows packages + byte-diff vs source | Quintin: full parity, dist reproducibly built from release commit. Michaelliv: `dist/` **absent** from published artifact |
| `npm pack @anthropic-ai/claude-agent-sdk@0.3.211`; `sdk.d.ts` (6,999 lines) read in full | Contract facts in §8/§9 |
| Bounded string extraction over installed Claude Code 2.1.211 binary | Workflow tool wire contract, script globals, caps, resume semantics (§8) |
| No-egress probe: `clampThinkingLevel` (pi-ai 0.80.3) vs Helix `resolvePiThinkingLevel` on a synthetic model (`thinkingLevelMap {low,medium,xhigh:null}`, `high` absent) | pi-ai: low→low, medium→medium, high→high, **xhigh→high (clamp)**; Helix: low/medium/high pass, **xhigh → refusal `pi-effort-unsupported`**; `ModelRegistry.find(unknown)` → `undefined` |
| Helix CC clone: `node scripts/validate-plugin.mjs`; `node --test tests/*.test.mjs`; `claude plugin validate --strict .` | 1 workflow/8 agents/2 skills validated; **19/19 pass**; strict validation passes on 2.1.211 |

Primary sources consulted (current fetches this session): code.claude.com docs (workflows, sub-agents, agent-teams, agent-sdk/{subagents,sessions,hooks,permissions,structured-outputs,overview,agent-loop}, checkpointing, third-party-integrations), platform.claude.com agent-sdk TS/Python, Claude Code CHANGELOG, learn.chatgpt.com (codex-sdk, cli, config-reference, app-server, auth), docs.github.com (Copilot CLI programmatic, SDK getting-started, ACP server, supported models), learn.microsoft.com (Claude in Foundry configure-claude-code, Azure OpenAI reasoning), openrouter.ai docs (provider-selection, Claude Code integration, api-reference), help.router-for.me, support.claude.com (Agent SDK usage-policy articles), installed Pi `dist/*.d.ts` + `docs/` (sdk.md, models.md, providers.md, extensions.md, compaction.md, session-format.md, rpc.md) and npm registry metadata.

## 6. Owner requirements and non-negotiable invariants (with acceptance tests)

| # | Requirement | Acceptance test (deterministic unless marked live) |
|---|---|---|
| R1 | Claude-Code-class workflow/subagent power, genuinely multi-provider | Conformance suite (§17) passes: script dialect, null-propagation, pipeline/parallel semantics, resume prefix-cache — with casts spanning ≥2 providers in one run (mock adapters) |
| R2 | Representative run: plan with two high-reasoning models, implement/test/document with others (e.g. `anthropic/claude-opus-4-8:xhigh`, `openai/gpt-5.6-sol:xhigh`, `openai/gpt-5.6-terra:high`, `openai/gpt-5.6-luna:high`) — names verified at review time: all four are real, currently documented tuples (Anthropic Models API capability flags; OpenAI Responses `reasoning.effort` up to `max` on gpt-5.6 family) | Preflight test: this exact cast resolves (mock inventory mirroring real capability maps) and each role envelope records the requested and effective tuple; unknown-name variant (`gpt-5.6-nova`) refuses pre-egress with a named code |
| R3 | Provider families: Anthropic; OpenAI via ChatGPT/Codex subscription *where legitimately supported*; GitHub Copilot; Azure Foundry distinguishing Claude vs Azure OpenAI; OpenRouter | Policy-register test: each path carries a status ∈ {official, gray-unstable, prohibited} with a citation; prohibited paths refuse with `provider-policy-blocked`; Azure paths are two distinct provider ids |
| R4 | Exact, observable tuple binding; unavailable tuple fails before egress; no silent fallback of provider/model/effort/account | (a) unknown model → refusal pre-session (exists today, keep test); (b) response-echo mismatch (mock returns different `model`) → run fails `provider-identity-mismatch`; (c) OpenRouter adapter unit test proves every request body contains `provider:{only,allow_fallbacks:false,require_parameters:true}`; (d) Azure adapter asserts served-model signal or refuses |
| R5 | Close the real delta: orchestration quality, context isolation, lifecycle, recovery, observability, DX | Delta matrix rows (§10) each reach their "target" state with a named test |
| R6 | Keep what is good, delete duplication, no preservation by inertia | Deletion workstream (WS8) completes; `check:docs-truth` updated; no orphan references |
| R7/R8 | All options evaluated without pre-commitment; optimize for canonical correctness/durability | §13 scorecard + sensitivity; this document |
| R9 | Per-axis comparison answered | §3 table |

Non-negotiable invariants carried into the target: consent binding; deterministic-gate-only convergence; refusal-code (never-throw-strings-into-prompts) discipline; public-safety persistence scanning; argv-only shell-free gate execution; no secrets in artifacts.

## 7. Current Helix architecture (from code, commit bb1c37f)

Package: `pi-helix`, a Pi extension package (three TS extensions + `dispatch/lib` core, ~40 modules; 49 test files; peer dep `@earendil-works/pi-coding-agent: "*"`).

Lifecycle (condensed; full trace was verified against source this session):

```
/helix-run <id> -- <task>                       extensions/helix-command.ts:1162
 ├─ inventory: modelRegistry.getAvailable() + supportedPiEfforts()   (throw ⇒ null! §11 F-3)
 ├─ PREFLIGHT buildPreflight()                  extensions/lib/helix-command-core.mjs:631
 │   workflow→execution projection (workflows.mjs:781) → profile/presets/settings
 │   → resolveChainCast (presets.mjs:326; refusals: unknown-preset, toggle-disabled,
 │     member-unavailable, assignment-unknown-stage)
 │   → preflightCastEfforts (explicit efforts vs per-model supported set, pi-effort.mjs:36)
 │   → objective-gate executable preflight (task-loop.mjs:117)
 │   → binding ref = sha256(workflow+profile+toggles+presets)  (workflows.mjs:421)
 ├─ CONSENT ui.confirm — exact per-role provider/model:effort×instances rendered
 ├─ EXECUTE executeNamedWorkflow()              extensions/lib/helix-execution.mjs:26
 │   re-resolve from disk, recompute binding ref; mismatch ⇒ workflow-preflight-drift
 │   → run dir (O_EXCL) → lifecycle snapshot (hash bound into run-start)
 │   → runStagedTaskLoop (runner.mjs:2389): resume lease (pid, O_EXCL, stale-break)
 │     → live guard: non-mock cast ⇒ adapter.kind === "helix-pi-agent" (duck-typed! §11 F-4)
 │     → worktree effect: branch helix/run-<sha24>, path dispatch/local/worktrees/<runId>
 │     → per-pass: checkpoint (FULL worktree copy, §11 F-9) → prompt compile →
 │       runDispatch (orchestrate.mjs:252): candidate panel (writer stages forced
 │       max_concurrency=1) → envelope validation → blinded judge → synthesis
 │       (contradiction grep /contradict/i, §11 F-6) → structural verifier → run record
 │     → objective gate (file-contains | command-exit-zero; argv, no shell, pgid kill)
 │     → two-phase event/state commit (pending_event; events.jsonl fsync append-only)
 └─ stage machine (stage-machine.mjs:202): advance/stay/back/stop; pass ceilings;
    conclusion gate is the ONLY converged exit (events.mjs:189-199)
```

State machine: `{phase: stage|conclusion, stage_index, pass_counts, total_passes}`; transitions advance / retry-stay / jump-back / stop; `max_passes` per stage and `max_iterations` global, both terminal refusals; loops OFF rewrites retry/back → advance with warning. Persisted machine state is post-transition (resume never replays a completed pass).

Persistence per run: `state.json` (closed 27-key schema v3, atomic, leak-scanned), `events.jsonl` (append-only, fsync, closed per-kind grammar, seq/monotony validated), lifecycle snapshot, disagreement generations, per-pass public-safe run records, full-tree checkpoints + git HEAD/index backup, pid leases. Crash recovery reconciles the event high-water mark and the pending-event two-phase commit; corruption ⇒ stable refusal codes, never repair-in-place. **But `task_bound: true` (every TUI run) refuses resume** — the machinery only pays off for the legacy CLI's mock configs.

Verified-good mechanisms (retain, per §3); verified weaknesses become findings (§11). Dead code inventory: legacy loop engine reachable only from smoke scripts/tests (`task-loop.mjs:8-10` says so itself); `openrouter-revision-adapter.mjs` (405 lines, no product consumer); chains `scout`/`research`/`ship-pre-pr` can never run; two disjoint worktree systems; two near-identical mock adapters.

Test reality: 598 green tests + 4 CI gates prove the **mock universe**; the production Pi session factory (`pi-agent-adapter.mjs:84-110`, dynamic import of Pi) is never executed by any test; no real-provider proof exists anywhere in CI (the packet-level no-egress harness in `tools/lockdown/` is manual).

Docs-vs-code mismatches found: (1) manual's effort-clamp claim is *correct* per probe, but only because Helix's refusal set happens to exactly mirror pi-ai's clamp set — undocumented coupling; (2) "verifies executable exists before save" is TUI-builder-only (print-mode `workflows create` and direct-JSON deployment skip it; run preflight re-checks); (3) "uses only exact entries Pi reports available" fails when inventory is null (F-3); (4) architecture.md "extension-only package" vs two shipped standalone CLIs; (5) `/helix-chains` `loop_runnable` labels derive from the dead legacy route table.

## 8. Reference architectures

### 8.1 Claude Code 2.1.211 workflows/subagents (evidence: docs + installed binary; labels preserved in the underlying reports)

- **Script contract:** plain JS module, `export const meta` first statement (pure literal), acorn-parsed; deterministic-by-construction (AST ban on `Date.now`/`Math.random`/argless `new Date()`); no FS/Node APIs; globals `agent, parallel, pipeline, phase, log, args, budget, workflow` (sub-workflow, one nesting level).
- **Caps:** concurrency `min(16, cores−2)`; 1,000 agents/run lifetime; 4,096 items/call (installed-artifact-only).
- **`agent()`:** returns final text verbatim, or schema-validated object via a forced StructuredOutput tool with model-driven repair; returns `null` on user-skip or terminal API error; opts `label/phase/schema/model/effort(low..max)/isolation:'worktree'/agentType`.
- **`parallel` = barrier, thunk errors → `null` slots, never rejects; `pipeline` = no barrier, per-item stage chains, a throwing stage nulls that item.**
- **Wire contract:** `script|name|scriptPath`, `args` (verbatim), `resumeFromRunId` (`^wf_…`, same-session only); output `runId`, `transcriptDir`, `scriptPath`; background task + notification; journal.jsonl + agent-<id>.jsonl transcripts; resume = longest-unchanged-prefix cache.
- **Subagents:** fresh conversation; inherit CLAUDE.md hierarchy, MCP, tool defs, extended-thinking config; not parent history/system prompt; nesting to depth 5; background by default; workflow subagents always `acceptEdits` + session allowlist; **org-allowlist-excluded model requests silently fall back to inherited model** (documented).
- **Worktrees:** `isolation:'worktree'` branches from default branch under `.claude/worktrees/`, auto-removed if unchanged; WorktreeCreate/Remove hooks; 2.1.211 fixed worktree subagents mutating the main checkout.
- **Observability:** `/workflows` live tree (drill-down, pause/stop/retry per agent), per-agent tokens, large-workflow advisory, task registry with totals.
- **Distinct mechanisms:** subagents / skills / agent teams (experimental, mailbox+task-list) / workflows / background sessions — a five-way spectrum Helix should *not* replicate wholesale; the workflow surface is the one worth matching.

### 8.2 Claude Agent SDK 0.3.211 (substrate assessment)

Typed, rich per-agent `AgentDefinition` (model alias/full-id, effort low..max or number, tools, MCP, memory, permissionMode, background, maxTurns); fresh-context subagents; structured outputs with bounded repair (`error_max_structured_output_retries`); sessions with resume/fork + alpha SessionStore; 30 hook events; per-model usage/cost telemetry; `maxBudgetUsd`. Spawns a bundled ~250 MB native Claude binary per `query()`; `Options.env` **replaces** the subprocess env per spawn (clean per-stage gateway isolation). **Constitutionally Claude-only** (`apiProvider ∈ firstParty|bedrock|vertex|foundry|anthropicAws|mantle|gateway`); Workflow tool reachable only by model invocation (no host `runWorkflow()`), possibly plan-gated; license proprietary (Commercial ToS); current policy text: *"Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK."* Verdict: excellent Claude-stage executor, ineligible as the multi-provider engine; not required by the target architecture.

### 8.3 Helix CC backport (842fa87) — map and retain/replace decisions

26-file Claude Code plugin: 1 workflow (`workflows/helix-delivery.js`, 446 lines; 6 phases; 2-4 parallel planners → judge → serialized builder/tester/documenter → parallel reviewer+redteam → verifier + deterministic `evidenceProblems()` gate → bounded remediation ≤5), 8 role agents (`model: inherit` + per-call requests; effort high/xhigh frontmatter; read-only allowlists for non-writers), doctor (`lib/doctor.mjs`) with six path classifications and a hard-coded `ready:false` for the native path, 19/19 deterministic tests (reproduced this session), strict plugin validation passing on 2.1.211.

Decisions:

| Helix CC mechanism | Decision |
|---|---|
| `fence()` untrusted-output framing + exhaustive fence-count tests (`workflows/helix-delivery.js:83-93`; `tests/workflow.test.mjs:133-168`) | **Port into Helix** (WS10) — Helix currently has no mechanical instruction boundary for upstream-agent output in downstream prompts |
| Deterministic evidence-contradiction gate over model claims (`:199-248`) | Keep in Helix CC; in Helix the authoritative gate remains the objective command/file gate — do not import as parity |
| Doctor honesty pattern (hard-coded `ready:false`, `locallyReady` vs entitled distinction) | Adopt the *pattern* in Helix's provider-policy register (WS6) |
| Foundry `ready:true` from env+az-session (`lib/doctor.mjs:249-254`) | Defect in Helix CC (configured-as-entitled); do not replicate |
| Model/effort per-role *requests* without effective verification | Structurally unfixable on CC's surface; Helix must do better (effective-tuple echo, WS2) |
| Repo role overall | **Complementary Claude-only surface + source of selective mechanisms.** Not a reference implementation for Helix, not a future primary host, not deleted. Out of scope for the one-branch program except the fence port. |

Bias-control note: the preliminary ledger (option set, likely recommendation) was written before reading any Helix CC prose. After inspection, **no preliminary conclusion changed**; Helix CC's own recommendation happens to agree, but its checkable facts were independently re-verified and its judgments were not adopted. New information gained from it: the fence mechanism, the doctor-classification pattern, and three concrete Helix CC defects (Foundry ready-true, doctor PATH invocation, "one serialized writer" phrasing) recorded upstream for its own maintainers.

## 9. Provider / account / protocol architecture — truth table

(Compiled from current official docs this session; full per-claim labels in the evidence trail. "3P-sub" = subscription reuse inside a third-party orchestrator.)

| Path | Account mechanism | 3P-sub status | Model+effort exactness | Effective model observable | Fail-closed verdict |
|---|---|---|---|---|---|
| Anthropic API (key) | API key | n/a | Exact ids + `output_config.effort` low→max GA; Models API capability preflight | ✅ `response.model` | ✅ first tier |
| Anthropic consumer OAuth (claude.ai plans) | OAuth | **Prohibited** (Feb-2026 consumer-terms text); SDK-credit program announced May-2026, **paused** Jun-15 | — | — | ❌ policy-unstable; Helix must gate this path off by default with a named refusal |
| OpenAI API (key) | API key | n/a | Exact ids (`gpt-5.6-sol/-terra/-luna`) + `reasoning.effort` none→max; strict json_schema | ✅ `model` echoed | ✅ first tier |
| Codex CLI/SDK/app-server (ChatGPT plan) | ChatGPT OAuth / device code / auth.json | **Gray** — docs steer programmatic use to API keys; no explicit 3P blessing; app-server logs `clientInfo.name` for compliance | Exact per exec/thread (`-m`, `model_reasoning_effort` minimal→xhigh) | Not documented in `--json` events | ⚠️ technically strong, policy-fragile |
| GitHub Copilot (CLI/SDK GA/ACP) | GitHub token / Copilot OAuth; BYOK | ✅ **Officially supported** (SDK GA for all subscribers) | Model exact (avoid `auto`); **effort server-scoped** (`--acp --effort`), not per-request | ❌ no served-model attestation | ⚠️ legit but coarse; one ACP process per effort level |
| Azure Foundry — Claude | Entra ID / Foundry key | n/a | Deployment-name binding; effort/thinking **beta**; regions East US 2 + Sweden Central | Messages responses; verify deployment→model at deploy time | ✅ if Model Router avoided |
| Azure Foundry — Azure OpenAI | Entra / key, `/openai/v1` | n/a | `reasoning_effort` low/med/high (lags 1P) | Chat Completions: real snapshot in `model`; **Responses: deployment name in `model`, real model only in `x-ms-served-model` header** | ⚠️ workable **iff adapter asserts served-model per call** |
| OpenRouter | OR API key | n/a | Slug + `require_parameters:true` | ✅ `model` = actually-used; `/api/v1/generation` stats; opt-in `openrouter_metadata` on the official Anthropic-format endpoint | ✅ **iff every request injects `provider:{only, allow_fallbacks:false, require_parameters:true}`** — defaults are fail-open |
| CLIProxyAPI sidecar | Impersonated first-party OAuth clients (spoofed headers, uTLS, prompt cloak, replicated signing) | Unofficial, ToS-violating, undisclosed by project | Pinning by config convention (unique `prefix`, retries 0, cooling off) | ❌ account only in server logs | ❌ rejected: no Copilot/Azure upstream at all; account unobservable; legal exposure |
| Pi ModelRegistry (substrate) | Per-provider: API keys (env/auth.json/models.json) + OAuth logins for Claude Pro/Max, ChatGPT (Codex), Copilot | Inherits the per-provider statuses above — Pi *having* a login flow does not make the path permitted | Model: `find()` → undefined on unknown (caller must refuse — Helix does); effort: `thinkingLevelMap` tristate; **clamping exists in pi-ai but Helix's refusal set exactly covers the clamp set (probe-verified on 0.80.3)** | Not echoed today (Helix gap F-5) | ✅ substrate of choice, with the strictness adapters of WS6 on top |

Candidate mechanisms evaluated and set aside: Codex CLI `exec`/SDK/app-server and Copilot ACP as *peer executors* (viable future adapters for subscription-legitimate paths — Copilot today, Codex if policy clarifies — behind the same envelope contract; not in the one-branch scope); model-facing MCP peer-agent tools (adds an uncontrolled instruction boundary; rejected); CLIProxyAPI embedded Go SDK (rejected with the sidecar).

## 10. Capability delta matrix

Columns: Claude Code reference → Helix today → best alternative evaluated → target (all targets are Helix Script Engine states; severity of current gap High/Med/Low).

| Row | Claude Code | Helix bb1c37f | Best alternative | Gap sev. | Target |
|---|---|---|---|---|---|
| Declarative closed workflow definition | Saved named workflows (`.claude/workflows/`) | ✅ strong (validated JSON, closed schemas) | Quintin saved workflows | Low | Retain; definitions compile to scripts |
| Arbitrary code workflows | ✅ core capability | ❌ absent | Quintin (same dialect) | **High** | WS3 script engine |
| Isolated fresh contexts | ✅ per subagent | ✅ per candidate (session-per-call) | tie | Low | Retain |
| Explicit per-role prompt/system context | Frontmatter agents | ✅ role prompts + envelopes (stricter) | tie | Low | Retain |
| Exact provider/model/effort binding | ❌ silent allowlist fallback | ✅ 3-layer pre-egress refusal (see F-3/F-4 gaps) | Helix | Low* | WS2 hardening (*gaps are P1s) |
| Multi-provider stage mixing | ❌ Claude-only | ✅ mixed casts (mock+real routing exists) | Helix/Pi | Low | Retain; extend to script `agent()` |
| Structured output + bounded repair | ✅ forced tool + model repair | ❌ scan-any-JSON heuristic, no repair | Quintin (repair ladder + strict extraction) | **High** | WS5 port |
| Deterministic objective gate | ❌ (advisory only) | ✅ argv command/file gate = only success exit | Helix | — | Retain (Helix ahead) |
| Fan-out/fan-in + ordered pipelines | ✅ parallel/pipeline | ❌ fixed per-stage panels only | Quintin | **High** | WS3 |
| Writer serialization / edit-conflict policy | Worktree isolation opt-in | ✅ forced max_concurrency=1 for mutating roles | Helix | Low | Retain; add worktree option per agent |
| Tool/permission/hook/MCP/nested-agent policy | ✅ rich | Partial (role-based tool gating; no nesting) | Claude Code | Med | Role tool gating retained; script-level `workflow()` nesting (1 level); no model-driven nesting (deliberate non-goal) |
| Context compaction / handoff framing | ✅ auto-compaction | Durable handoff docs between stages | tie (different models) | Low | Retain handoff; expose Pi compaction settings |
| Instruction-boundary behavior for external content | Prompt discipline only | Prompt discipline only | **Helix CC `fence()`** | Med | WS10 port |
| Cancellation/deadlines/turns/tokens/cost/depth/concurrency | ✅ budget global, maxBudgetUsd, caps | Partial (max_runtime_ms, per-call timeout; no token budget) | Quintin (real usage accounting, soft budget, hard caps) | Med | WS3/WS4: budget global from `getSessionStats()`, hard agent caps, per-phase sub-budgets |
| Attended consent + headless fail-closed | Permission modes; workflow subagents forced acceptEdits | ✅ consent binding ref + drift refusal (stronger) | Helix | Low | Retain; scripts covered by same binding ref |
| Worktree creation/retention/merge/cleanup | ✅ auto-clean if unchanged; confirmation UX | Created, never surfaced or cleaned (F-8) | Claude Code / Quintin (deterministic naming, always-clean) | Med | WS7 |
| Persistence scope/retention/shape | Session JSONL + journal; 30-day cleanup | ✅ closed schemas, leak-scanned, append-only events | Helix (shape); CC (retention) | Low | Retain shape; add retention policy |
| Checkpoint/lease/journal/resume/fork/crash | Same-session prefix-cache resume | Two-phase commit + leases exist; **product runs refuse resume** | Quintin (cross-process leases + paused reconciliation > CC) | **High** | WS4 |
| Per-agent progress/steering/transcripts/usage | ✅ /workflows drill-down | Event stream + watch render only | Quintin TUI | Med | WS9 |
| Provider health/readiness accuracy | /status; account info API | Inventory snapshot (nullable! F-3) | Helix CC doctor pattern | Med | WS2/WS6 |
| Package/distribution/update model | Plugin marketplace / native binary | Pi package (npm), peer `*` (unpinned! F-13) | — | Med | WS1 pin + engines discipline |
| Test fidelity / real-provider proof | Vendor-internal | 598 mock tests; **zero live proof** | — | Med | WS11 opt-in live suite |
| Repository packaging/scope discipline | — | Good (files whitelist, CI gates) minus dead code | — | Low | WS8 deletions |

## 11. Material findings (P0–P3)

Severity: P0 = defeats a core owner requirement today; P1 = correctness/exactness risk or spend-loss; P2 = durability/maintenance; P3 = polish. Every finding was re-checked against source this session; refutation attempts noted.

**F-1 (P0) — Product runs are not resumable.**
Location: `extensions/lib/helix-command-core.mjs:1660-1676` (`workflow-resume-unsupported` for `task_bound: true`); machinery at `dispatch/lib/runner.mjs:225-793`. Wrong behavior: every TUI `/helix-run` writes `task_bound: true`; a crash mid-run loses the run and orphans its worktree, despite ~1,000 lines of lease/checkpoint/pending-event code that would support resume. Proof: code path + manual.md:99-102 documents the refusal. Source of truth: owner R5 (lifecycle/recovery). Multi-location: legacy CLI (`tools/loop/helix-task-loop.mjs --resume`) can resume only config runs. Consequence: the recovery story exists only for a surface nobody ships. Fix: WS4. Confidence: high. Refutation attempt: looked for an undocumented TUI resume path — none exists; the refusal is unconditional on `task_bound`.

**F-2 (P0) — No deterministic script workflow surface.**
Location: `dispatch/lib/workflows.mjs` (chain templates are the only workflow language). Wrong behavior vs goal: the owner's target (Claude-Workflow-class orchestration: dynamic fan-out, loops-until-dry, budget-scaled panels, per-item pipelines) cannot be expressed; only fixed chains with per-stage candidate counts. Proof: `workflowToExecution()` is the sole projection (workflows.mjs:781); no script parser/VM exists in the repo. Source of truth: R1/R5. Consequence: the central capability delta. Fix: WS3. Confidence: high. Refutation attempt: checked whether chains + presets can emulate pipelines — they cannot (no data-dependent cardinality, no inter-item independence).

**F-3 (P1) — Inventory-unavailable preflight hole.**
Location: `extensions/helix-command.ts:202-204` (catch-all → null inventory); `extensions/lib/helix-command-core.mjs:579-585,617` (availability + effort checks skipped when inventory null / efforts default). Wrong behavior: if `modelRegistry.getAvailable()` throws, an all-default-effort real cast passes preflight and **consent displays a never-validated cast**; enforcement silently moves to session creation. Proof: code path; adapter still refuses at `pi-agent-adapter.mjs:127-135` (so not egress — but consent integrity is violated). Source of truth: R4 + manual/README claims. Multi-location: `/helix-setup` has the same dependency but refuses on unavailable inventory. Fix: WS2 — inventory failure must be a preflight refusal (`inventory-unavailable`), never null. Confidence: high. Refutation attempt: traced all `availableModelInventory` callers; the null path is reachable from every run entry.

**F-4 (P1) — Live-adapter guard is a duck-typed string.**
Location: `dispatch/lib/runner.mjs:1379` (`adapter.kind === "helix-pi-agent"`). Wrong behavior: the "no mock masquerade" guarantee rests on a naming convention; any in-process object claiming the string passes. Proof: tests themselves construct such objects (`tests/helix-workflow-execution.test.mjs:200-233`). Source of truth: R4. Fix: WS2 — capability token: adapter must carry a non-forgeable marker created only by `createPiAgentAdapter` (module-private symbol/closure), and the guard must verify provider support via a live probe method, not a string. Confidence: high. Refutation attempt: no other authentication of the adapter object exists on the path.

**F-5 (P1) — Effective tuple never echoed; identity drift undetectable.**
Location: `dispatch/lib/pi-agent-adapter.mjs:226-240` (envelope provider/model copied from the *spec*, not the response); no effort field in envelopes (`dispatch/lib/role-envelope.mjs`). Wrong behavior: a provider serving a different model (Azure deployment remap, OpenRouter fallback, future Pi changes) is invisible; the envelope identity check (orchestrate.mjs:778-785) validates spec-vs-spec. Proof: code; provider truth table shows real drift vectors (§9). Source of truth: R4 "observable". Fix: WS2/WS6 — record requested + effective (response-echoed) model, thinkingLevel, and provider metadata per call; mismatch ⇒ `provider-identity-mismatch` refusal. Confidence: high. Refutation attempt: checked `session.getSessionStats()` and Pi message shapes — response model IS available to the adapter; it is simply not captured.

**F-6 (P1) — Contradiction preservation is a keyword grep.**
Location: `dispatch/lib/synthesis.mjs:31` (`/contradict/i`). Wrong behavior: the "never drop a disagreement" guarantee (fail-closed drop marker, orchestrate.mjs:647-652) triggers only when candidates use the literal word; real disagreements phrased otherwise are averaged away silently. Source of truth: docs/architecture.md disagreement invariant. Fix: WS5 — structured disagreement field in candidate/judge schemas (forced structured output), grep retained only as a backstop. Confidence: high. Refutation attempt: searched for any second detection path — none.

**F-7 (P1) — Verdict/semantic-output brittleness with spend loss.**
Location: `dispatch/lib/pi-agent-adapter.mjs:44-60` (`parseSemanticOutput` scans for the *last* valid JSON object anywhere in text); `runner.mjs:1269` (verdict token must be exactly `approve|revise|revise-jump`). Wrong behavior: one malformed reviewer response kills the run (`workflow-no-transition`) after real spend; a model quoting an example JSON mid-answer can be parsed instead of its conclusion. Fix: WS5 — Pi `defineTool` terminating `structured_output` tool + bounded repair ladder (port of Quintin `src/agent.ts:122-164`), per-call retry budget, refusal only after repair exhaustion. Confidence: high. Refutation attempt: prompt discipline reduces but cannot eliminate; no retry exists on the path.

**F-8 (P1) — Worktree lifecycle dead-ends.**
Location: `dispatch/lib/runner.mjs:975-1094` (creation, owner refs, collision refusal — good) but no `remove` call anywhere; completion render (`helix-command-core.mjs:805-843`) surfaces neither branch nor path. Wrong behavior: converged output is hard to find; worktrees/branches/git-config owner entries accumulate forever; no merge story. Fix: WS7. Confidence: high.

**F-9 (P2) — Checkpoints copy the entire worktree per pass.**
Location: `runner.mjs:299-474` (`scanCheckout`: per-file `readFileSync` into memory, no size bound). Consequence: O(repo) time/space per pass; unbounded memory on large files; orphaned checkpoint residue on some failure paths (`:565-573`, deliberate). Fix: WS4 — git-object-based snapshots (`git stash create`-style plumbing or `git worktree` + index tricks) with explicit size ceilings and GC. Confidence: high.

**F-10 (P2) — Dead legacy engine and adapters shipped.**
Location: `dispatch/lib/task-loop.mjs:332` legacy path, `debate.mjs` (673 lines), `role-matrix.mjs:185`, `agent-team.mjs`, `adversarial-policy.mjs`, `routes.mjs:70-127` ROUTES, `openrouter-revision-adapter.mjs` (405 lines, no consumer), chains `scout/research/ship-pre-pr`, duplicate mock adapter (`task-loop.mjs:224` vs `runner.mjs:1168`). Consequence: second divergent semantics to rule out on every change; misleads `/helix-chains` labels (F-15). Fix: WS8 delete. Confidence: high. Refutation attempt: searched all product surfaces for consumers — only smoke scripts/tests reference them; `task-loop.mjs:8-10` itself declares the path legacy.

**F-11 (P2) — Duplicated worktree systems.**
`runner.mjs` worktrees (`dispatch/local/worktrees/<runId>`, owner-ref'd branches) vs `tools/worktree/helix-worktree.sh` (sibling `<repo>-<name>` dirs). Disjoint naming/cleanup. Fix: WS7 unify on the runner system; the shell tool becomes a thin wrapper or is deleted with docs update.

**F-12 (P2) — Zero real-provider proof.**
No test executes `defaultSessionFactory` (`pi-agent-adapter.mjs:84-110`); live-session semantics (dispose/abort, thinkingLevel acceptance, message shapes, `getAvailable()` shape assumed at `helix-command.ts:185-205`) are unproven. Fix: WS11 opt-in live suite (explicitly excluded from CI gate; run-manual with cost ceilings). Confidence: high.

**F-13 (P2) — Pi substrate pin risk.**
`peerDependencies: { "@earendil-works/pi-coding-agent": "*" }` (package.json) against a substrate whose model/auth registry seam is actively breaking (0.80.7 models.json change; unreleased `modelRuntime` replacing `authStorage`/`modelRegistry`; `AuthStorage` un-exported). Fix: WS1 — pin a tested range (≥0.80.7 <0.81), isolate every Pi import behind `dispatch/lib/pi-runtime-adapter.mjs`, add a load-time version assertion with a named refusal.

**F-14 (P2) — No subscription-policy register.**
Helix (via Pi) can bind provider paths whose subscription reuse is prohibited (Anthropic consumer OAuth) or gray (ChatGPT-plan Codex) without distinguishing them from official paths (API keys, Copilot). Source of truth: §9. Fix: WS6 — per-provider-path policy status; prohibited ⇒ `provider-policy-blocked` refusal unless explicitly overridden in settings with a persisted, consent-displayed acknowledgment. Confidence: high on policy facts (current official texts quoted in evidence trail); their future state is uncertainty U-2.

**F-15 (P3) — `/helix-chains` `loop_runnable` labels derive from the dead engine.**
`helix-command-core.mjs:425-433` via `routes.mjs:135`. Fix: WS8 (recompute from staged-runner reality or drop the label).

**F-16 (P3) — Save-time executable check missing on two of three workflow-creation paths.**
TUI builder checks (`helix-command.ts:635-644,734-742`); print-mode `workflows create` (`helix-command-core.mjs:1098-1126`) and direct-JSON deployment do not; run preflight re-checks so the gap is save-time UX only. Fix: WS2 (share one validator).

## 12. Rejected findings and false alarms (ledger)

| Candidate finding | Rejection rationale |
|---|---|
| **"Silent effort clamp window"** (explicit `low/medium/high` with absent `thinkingLevelMap` entry passes to Pi, which may clamp) — raised by this session's code reconstruction and seemingly contradicting manual.md:238-240 | **Refuted by no-egress probe** against installed pi-ai 0.80.3: an *absent* map entry means provider-default-supported (`clampThinkingLevel` is identity for low/medium/high on such models); pi-ai clamps only genuinely unsupported levels (absent `xhigh` → `high`), and Helix refuses exactly that set (`resolvePiThinkingLevel` throws `pi-effort-unsupported`; `supportedPiEfforts` excludes absent `xhigh` while including absent `high` — mirroring clamp semantics precisely). The manual's claim holds on 0.80.3. Residual truths tracked separately: no effective-level echo (F-5) and undocumented coupling to pi-ai clamp internals (WS1 adds a conformance test pinning this equivalence so a Pi upgrade that changes clamp semantics fails loudly). New Pi levels (`max`, added 0.80.6) are outside Helix's vocab and refuse as invalid — fail-closed, acceptable until WS1 extends the vocab. |
| "Helix should adopt CLIProxyAPI to reach OpenAI/Copilot/Azure subscriptions" (plausible from its README) | Source inspection at 09da52a: **no Copilot or Azure upstream exists** (grep-verified; Copilot appears only as client-quirk comments); serving account is never client-observable; subscription flows impersonate first-party clients (spoofed headers, uTLS fingerprints, prompt cloaking, replicated request signing) with zero ToS disclosure. Fails R3 (two families missing), R4 (observability), and the durability bar. |
| "Michaelliv's package provides per-agent model routing" (README implies) | `src/workflow.ts:444-451`: the `model` option is injected into prompt text ("Requested model: X"); every agent runs on the parent session model. Also: published tarball missing `dist/` entirely; no LICENSE text file; repo dormant since 2026-05-31. |
| "Claude Code's Workflow tool can be driven programmatically from the Agent SDK as Helix's engine" | `sdk.d.ts` exports no host-side workflow invocation; the tool is model-invoked (prompt-triggered) and `enableWorkflows` is "default by plan". Not a deterministic outer spine. |
| "Helix's prior ROADMAP/recommendation should anchor the outcome" | No ROADMAP.md existed at bb1c37f; Helix CC's recommendation docs were read last, treated as hypotheses, and independently re-derived (§8.3). |
| "Helix docs materially lie about behavior" | Mostly refuted: `check:docs-truth` mechanically pins docs; only the five bounded mismatches in §7 were found, two of which are phrasing-strength issues. |

## 13. Architecture options — strongest cases, disqualifiers, scorecard, sensitivity

**Options.** A: Helix Script Engine on Pi (recommended). B: Rebuild on Claude Agent SDK. C: Drive native Workflow JS. D: Adopt Quintin's package as canonical engine. E: Adopt Michaelliv's. F: CLIProxyAPI-centric gateway architecture. G: Hybrid — Helix host DAG + Agent SDK for Claude stages + Pi/native adapters for the rest.

**Strongest case for each (steelman), then disqualifiers:**
- **B (SDK):** maximum Claude fidelity — it *is* the Claude lifecycle (same binary), typed subagents, structured repair, hooks, per-stage env isolation; version-pinned manifests. *Disqualified as sole engine:* R3 unmet (Claude-only; Azure-OpenAI/GPT, OpenAI, Copilot, OpenRouter native stages impossible without unsupported translation proxies); Workflow surface not host-drivable; proprietary license + distribution policy constraints.
- **C (Workflow JS):** zero engine maintenance; free resume/observability; the owner's UX target verbatim. *Disqualified:* model-invoked only (non-deterministic launch), plan/policy-gated, Claude-only, no host contract, consent/binding invariants unreachable (Helix CC proves the ceiling empirically).
- **D (Quintin canonical):** the only existing engine with Claude-dialect scripts *plus* cross-process leases, paused-run reconciliation, structured repair, worktrees, and a real TUI — 861 green tests, verified artifact parity, MIT. Adopting it buys 12+ months of debugged recovery machinery. *Disqualifiers as canonical:* fail-open binding (silent session-default fallback `src/agent.ts:543-544`; fabricated Model objects in `buildFallbackModel`) violates R4 at the core and upstream may not accept a strict mode; peer floor ≥0.80.6 (behavioral compat with Helix's stack unverified); bus-factor 1 with high churn; no consent binding, no objective gate, no public-safety persistence — Helix's four load-bearing invariants would all be bolt-ons to foreign code. *Retained role:* mechanism source + conformance oracle (license-clean).
- **E (Michaelliv):** simplest codebase; correct determinism validator. *Disqualified:* placebo bindings, no persistence, broken artifact, abandoned (§12).
- **F (CLIProxyAPI):** one gateway normalizing every account type, embeddable Go SDK, exact pinning knobs. *Disqualified:* §12 row 2.
- **G (Hybrid SDK+Pi):** best-of-both — Claude stages on the true Claude harness, others on Pi. *Not disqualified, but rejected:* two runtimes to pin/version/observe; per-subagent provider mixing inside SDK sessions impossible; duplicate persistence/observability planes; the SDK adds fidelity Helix doesn't need once the script engine exists (Helix stages are single-shot role calls, not open-ended agentic sessions); revisitable later behind the adapter seam (non-goal for this branch).

**Scorecard.** Weights derive from the owner's requirements (R3/R4 are hard gates — a failing option is disqualified regardless of total). Scores 0–5, evidence-based (per-cell rationale traceable to §§7–10). D scored as-published (not hypothetically patched).

| Axis (weight) | A | D | G | B | C |
|---|---|---|---|---|---|
| Multi-provider fidelity (0.20, hard) | 5 | 4 | 4 | **0 — DQ** | **0 — DQ** |
| Exactness / fail-closed (0.20, hard) | 5 | **2 — DQ as canonical** | 4 | 3 | 1 |
| Claude workflow mechanical fidelity (0.15) | 4 | 5 | 5 | 4 | 5 |
| Operational reliability (0.10) | 4 | 4 | 3 | 4 | 3 |
| Deterministic lifecycle/recovery (0.10) | 5 | 5 | 3 | 3 | 2 |
| Operator UX/observability (0.08) | 4 | 5 | 3 | 3 | 5 |
| Implementation/migration difficulty (0.07; 5 = easiest) | 3 | 4 | 2 | 2 | 4 |
| Long-term maintenance/version drift (0.05) | 4 | 2 | 2 | 3 | 3 |
| Testability/reproducibility (0.05) | 5 | 4 | 3 | 3 | 2 |
| **Weighted total** | **4.47** | 3.83 | 3.55 | — | — |

E and F are disqualified before scoring (E: R1/R4 + broken artifact; F: R3/R4). B and C fail hard gates. D's exactness failure disqualifies it *as canonical* but not as a mechanism source, which is how it is used.

**Sensitivity.** (1) If Claude-mechanical-fidelity weight doubles at exactness's expense, D overtakes A only if its fail-open binding is scored as-patched — i.e., the winner flips only under an assumption that requires forking or upstreaming into a bus-factor-1 repo; A dominates under every weighting that keeps R4 a hard gate. (2) If implementation difficulty triples in weight (schedule pressure), D-as-pinned-library becomes the rational bridge — this is why WS3/WS4 port Quintin's mechanisms rather than re-deriving them: it converts the schedule risk into A's plan. (3) No plausible weighting revives B/C/E/F while R3/R4 remain non-negotiable.

## 14. Final target architecture — Helix Script Engine (HSE)

**Component boundaries and dependency direction** (outer → inner; inner never imports outer):

```
extensions/ (Pi TUI adapters: helix-command, helix-answer, helix-fence)
  └→ dispatch/engine/        script runtime (NEW)
        script-parser.mjs    acorn AST validation: meta-literal, determinism bans
                             (AST-node check, prompt-mention-safe — Michaelliv #23 semantics),
                             banned-API neutering prelude in the realm
        script-runtime.mjs   node:vm realm; globals agent/parallel/pipeline/phase/log/
                             args/budget/checkpoint/workflow; caps (concurrency min(16,cores−2),
                             maxAgents 1000 sync-reserved, 4096 items/call); null-propagation
                             failure semantics (Claude-compatible); AbortSignal plumb-through
        journal.mjs          call-identity hash (prompt+tuple+phase+schema+agentType),
                             longest-unchanged-prefix replay, shared-store delta journaling
  └→ dispatch/lib/ (invariant core, RETAINED)
        workflows/presets/settings/routes(pruned)/prompt-compiler/role-envelope(+effective tuple)
        stage-machine (kept for declarative workflows, which compile onto the engine)
        orchestrate (panel/judge/synthesis/verification, now schema-forced)
        runner (leases, two-phase events, checkpoints→git-object based, worktrees unified)
        persistence/events/run-record (unchanged shapes + additive fields, see migrations)
  └→ dispatch/providers/     strictness layer (NEW)
        pi-runtime-adapter.mjs   the ONLY module importing @earendil-works/* ; version assert
        binding.mjs              cast→session resolution; refusal codes; effective-tuple capture
        policy-register.mjs      per-path status official|gray-unstable|prohibited (+citation)
        openrouter-strict.mjs    injects provider:{only,allow_fallbacks:false,require_parameters:true}
                                 on every request; verifies response model slug
        azure-strict.mjs         two provider ids (foundry-claude, azure-openai); served-model
                                 assertion (x-ms-served-model / response model) or refusal
  └→ @earendil-works/pi-coding-agent (pinned range; sessions, ModelRegistry, tools, TUI)
```

**Data flow (script run):** consent-bound cast + script hash → engine run record → per-`agent()` call: binding.mjs resolves tuple (refuse-before-egress) → fresh Pi AgentSession (role tools; writer mutex or worktree) → structured_output tool + repair ladder → envelope {requested tuple, effective tuple, usage, artifacts} → journal append (two-phase with state) → script variable. Gates: `checkpoint()` (consented pause) and the run-level objective gate remain the only success exit.

**State machines.** Run: `initializing → running → (paused | failed:<code> | converged)` — `paused` reachable from provider-quota classification (ported), lease-orphan reconciliation at startup, and `checkpoint()`. Agent call: `pending → running → (ok | null:<skip|terminal-api> | refused:<code>)`; `refused` at binding level aborts the run (never null-masked) — this is deliberately **stricter than Claude Code**, which nulls terminal API errors; binding refusals are configuration errors, not runtime luck. Declarative chains compile to generated scripts (one code path; stage-machine semantics preserved as a library the generated script calls).

**Adapter contract (every executor, current and future — Codex/Copilot peers would implement the same):** `resolve(tupleSpec) → {ok, session} | {ok:false, code}` pre-egress; `execute(session, prompt, schema, signal, timeout) → envelope` where envelope MUST carry `requested` and `effective` tuples + usage; `dispose(session)`; capability marker is a module-private token (F-4 fix), not a string.

**Failure taxonomy (closed set, no-space codes, extends events.mjs grammar):** `binding-*` (unknown-model, effort-unsupported, inventory-unavailable, provider-policy-blocked, provider-identity-mismatch), `engine-*` (script-invalid, determinism-violation, caps-exceeded, budget-exhausted), `agent-*` (schema-noncompliance-after-repair, timeout, aborted, provider-quota→paused), `run-*` (preflight-drift, lease-held, resume-invalid, gate-failed). Provider-quota errors pause with the provider's reset hint instead of failing (Quintin port).

**Persistence classes:** (1) run ledger (state.json v4 additive, events.jsonl unchanged grammar + new kinds `agent-call-start/end`, `script-checkpoint`); (2) engine journal (new file `<id>.journal.jsonl`: call-identity hash → envelope ref); (3) shared-store deltas; (4) checkpoints (git-object refs + bounded blobs); (5) transcripts (opt-in persisted Pi session files, secrets-warned); (6) public-safe run records (unchanged). All classes leak-scanned at write AND render, per existing discipline.

**Cancellation/budget propagation:** one AbortController per run → engine → every in-flight session (`session.abort()` + dispose) → gate process-group kill. Budget: real token accounting from `session.getSessionStats()` accrued per call; soft gate pre-call, hard ceiling refusal (`engine-budget-exhausted`); per-phase sub-budgets with 80% warning (Quintin port). Timeouts per agent call (existing) + per run (existing).

## 15. Migration design

- **No dual engine.** The legacy loop engine is deleted in the same branch (WS8); declarative chains survive by compiling onto the script engine, so existing workflow JSON keeps working — one execution path.
- **Persisted-shape decisions:** state.json bumps `RUNNER_STATE_SCHEMA_VERSION` 3→4 **additively** (new optional keys: `engine_kind`, `journal_ref`, `budget`, `effective_cast`). Old v3 states remain readable (resume of v3 runs: refuse with `resume-schema-superseded` and a clear message — v3 product runs were never resumable anyway, F-1, so nothing real is lost; add a legacy-shape read test). events.jsonl grammar is append-extended (new kinds), never redefined; run records gain `effective` tuple fields. Workflow JSON schema unchanged; user workflows under the state dir revalidate identically.
- **Compatibility mechanisms:** exactly one, bounded — the chain→script compiler is permanent product surface (not transition debt); no other shims. The `role_matrix: "mock-core-loop"` frozen knob (workflows.mjs:387-389) is removed with a schema-migration note.
- **Pi upgrade:** peer range `>=0.80.7 <0.81` + engines note; all Pi imports move behind `pi-runtime-adapter.mjs` in the same change (F-13), with a version assertion and a conformance test pinning the clamp-equivalence contract (§12 row 1).

## 16. ONE-BRANCH IMPLEMENTATION PROGRAM

**Branch discipline (binding):** all work lands together on ONE fresh non-default branch based on a verified current `main` head, pushed once (no force) to the verified remote `luisgui1757/helix`; NO pull request, merge, tag, or release. Before editing AND again before push, verify: remote identity and PUBLIC visibility (`gh repo view --json visibility,defaultBranchRef,isFork`), rulesets state (at evaluation: rulesets protect `~DEFAULT_BRANCH` only — PR+review+linear-history+required `test` check on main; a non-default branch push is permitted), the branch name does not exist on the remote (`git ls-remote --heads origin <name>` empty), and base equals current `origin/main`. **CI note:** `.github/workflows/ci.yml` triggers only on `pull_request` and `push: main` — the pushed branch gets NO automatic remote checks; the verification gate (§22) is therefore local and mandatory pre-push. Work in an isolated worktree or clean disposable clone; preserve all user-owned files; the final diff must contain only files this program names. Post-push: `git ls-remote origin <branch>` SHA must equal the local commit; record that no remote checks are configured for branch pushes (do not claim checks ran). If base, remote identity/visibility, rulesets, or collision state drifts at any checkpoint: **stop and report**.

Suggested branch name: `helix-script-engine-v1` (verify absence first).

Workstreams (WS1–WS12). Internal order: WS1 → WS2 → (WS3 ∥ WS5 ∥ WS6 ∥ WS7 after WS2) → WS4 (needs WS3) → WS8 → (WS9 ∥ WS10 ∥ WS11) → WS12. Parallel-safe workstreams are marked ∥ but all land in the one branch; checkboxes are implementation work only.

### WS1 — Pi substrate pin + runtime-adapter seam
- Objective/source of truth: F-13; Pi 0.80.7 changelog (models.json `sessionAffinityFormat` change, `max` thinking level, native Fable 5 levels); probe-pinned clamp equivalence.
- Inspect/change: `package.json` (peerDependencies, engines), NEW `dispatch/providers/pi-runtime-adapter.mjs`, all files importing `@earendil-works/*` (`dispatch/lib/pi-agent-adapter.mjs`, `extensions/*`), `dispatch/lib/pi-effort.mjs` (extend `EFFORTS` vocab with `max`).
- Behavior: old = unpinned peer `*`, direct imports; target = pinned `>=0.80.7 <0.81`, single import site, load-time version assertion refusing with `pi-version-unsupported`.
- [ ] Pin peer range and engines; add version assertion with named refusal
- [ ] Introduce `pi-runtime-adapter.mjs`; migrate every Pi import; forbid direct imports via a governance test (grep-based)
- [ ] Extend effort vocab with `max`; regenerate supported-efforts logic; conformance test pinning Helix-refusal-set == pi-ai clamp-set on synthetic models (fails loudly if Pi changes clamp semantics)
- Tests: unit (version assert, vocab), governance grep, clamp-equivalence conformance. Docs: manual effort section, architecture substrate section. Rollback: revert commit range; no persisted-shape impact. Done when: all tests green under installed Pi in range.

### WS2 — Strict binding hardening (fail-closed + observable)
- Objective/source of truth: F-3, F-4, F-5, F-16; R4.
- Inspect/change: `extensions/helix-command.ts:185-205`, `extensions/lib/helix-command-core.mjs:579-629,1098-1126`, `dispatch/lib/pi-agent-adapter.mjs`, `dispatch/lib/role-envelope.mjs`, `dispatch/lib/orchestrate.mjs:778-785`, `dispatch/lib/runner.mjs:1378-1382`, NEW `dispatch/providers/binding.mjs`.
- Behavior: old = nullable inventory skips validation; duck-typed adapter kind; spec-copied envelopes. Target = inventory failure ⇒ preflight refusal `inventory-unavailable`; adapter carries module-private capability token; envelopes carry `requested:{provider,model,effort}` AND `effective:{model,thinkingLevel,providerMeta}` captured from the live response; mismatch ⇒ `provider-identity-mismatch`; one shared save-time validator for all three workflow-creation paths.
- [ ] Replace nullable inventory with refusal; update consent renderer to show validated-against-inventory status
- [ ] Capability-token adapter guard replacing `kind` string; negative test proving a forged object is refused
- [ ] Effective-tuple capture in adapter + envelope schema (additive); identity-mismatch refusal + tests (mock returns wrong model)
- [ ] Unify save-time executable validation across TUI/print/JSON paths
- Tests: each refusal code; legacy envelope shape reads. Docs: manual §exactness, README claims re-verified against code (`check:docs-truth` update). Rollback: additive schema — revert safe. Done when: R4 acceptance tests (§6) pass.

### WS3 — Deterministic script engine
- Objective/source of truth: F-2; Claude Workflow contract (§8.1) as semantic reference; Michaelliv AST-validator semantics; Quintin runtime patterns (MIT, attribution in NOTICE).
- Inspect/change: NEW `dispatch/engine/{script-parser,script-runtime,journal}.mjs`; `extensions/lib/helix-workflows.mjs` (script workflow type), `extensions/lib/helix-execution.mjs` (engine dispatch), `dispatch/lib/schema.mjs`.
- APIs/invariants: globals `agent(prompt, {role?|tuple?, label?, phase?, schema?, isolation?, timeout?})`, `parallel`, `pipeline`, `phase`, `log`, `args`, `budget`, `checkpoint`, `workflow` (1 nesting level); meta-first pure literal; AST determinism bans (node-level, prompt-mention-safe) + realm prelude neutering; caps as §14; null-propagation semantics identical to Claude (errors→null slots; binding refusals abort — documented divergence); **every `agent()` tuple resolves through binding.mjs against the consent-bound cast**: scripts reference cast roles or explicit tuples that must be subsets of the consented cast, else `engine-cast-violation` (this is the Helix-specific strictness Claude lacks).
- [ ] Parser: meta literal validation + determinism AST checks (port Michaelliv semantics; adopt its parser tests as fixtures)
- [ ] Runtime: vm realm, globals, caps with synchronous slot reservation, abort plumbing, null-propagation
- [ ] Script workflows as a first-class workflow type: consent screen shows script hash + full cast; binding ref covers script content
- [ ] Chain→script compiler: existing chain workflows compile to generated scripts; byte-stable output; existing workflow JSON runs unchanged
- [ ] `budget` from real usage accounting; per-phase sub-budgets; hard ceiling refusal
- Tests: conformance suite (§17) incl. adopted Michaelliv/Quintin fixtures; property tests on caps/ordering; negative determinism cases. Docs: docs/workflows.md rewrite (script dialect), manual. Rollback: engine is additive until WS8 deletes legacy; chains keep working via compiler. Done when: conformance green + a representative multi-provider mock cast runs a 3-phase script end-to-end.

### WS4 — Journal, resume, leases, checkpoints (recovery for product runs)
- Objective/source of truth: F-1, F-9; Quintin `src/workflow.ts:411-450,1101-1120`, `src/run-persistence.ts:177-299`, `src/shared-store.ts` as ported references; Helix two-phase commit retained.
- Inspect/change: `dispatch/engine/journal.mjs`, `dispatch/lib/runner.mjs` (checkpoints, task_bound), `extensions/lib/helix-command-core.mjs:1660-1676` (remove refusal), `dispatch/lib/persistence.mjs`.
- Behavior: old = TUI runs unresumable; full-tree checkpoints. Target = journaled prefix-cached resume for script AND compiled-chain runs from the TUI (`/helix-runs resume <id>`), cross-process PID leases (merge with existing lease module), git-object-based bounded checkpoints with GC, startup reconciliation of orphaned running→paused runs.
- [ ] Call-identity hashing + longest-unchanged-prefix replay; unchanged-script+args ⇒ 100% cache-hit test
- [ ] Remove `task_bound` resume refusal; TUI resume flow with consent re-display and binding-ref revalidation
- [ ] Replace full-tree copy checkpoints with git-object snapshots + explicit blob-size ceiling + GC on convergence; orphan-residue cleanup
- [ ] Startup reconciliation: orphaned `running` → `paused` preserving journal; provider-quota pause classification (Quintin port)
- Tests: crash-kill mid-pass + resume (corruption suite §17), lease contention, journal replay determinism, checkpoint restore fidelity, legacy v3 state read refusal. Docs: manual resume section (replaces "resume unsupported"). Rollback: state v4 additive. Done when: kill -9 mid-run resumes to identical terminal state on mock casts.

### WS5 — Structured output repair + verdict/disagreement robustness
- Objective/source of truth: F-6, F-7; Quintin `src/agent.ts:36-164` (repair ladder, strict extraction, provider-limit classification) as ported reference.
- Inspect/change: `dispatch/lib/pi-agent-adapter.mjs:44-78`, `dispatch/lib/orchestrate.mjs`, `dispatch/lib/judge.mjs`, `dispatch/lib/synthesis.mjs:31`, role prompt templates in `dispatch/config/agents/`.
- Behavior: old = scan-any-JSON + exact verdict tokens + `/contradict/i` grep. Target = terminating `structured_output` tool (Pi `defineTool`) with schema-forced verdicts; ≤2 repair re-prompts (tools restricted to the output tool); strict validated prose extraction that never fabricates; then `agent-schema-noncompliance` refusal; disagreements become a structured candidate/judge schema field; grep retained as backstop with warning event.
- [ ] Structured-output tool + repair ladder in the adapter; provider-limit errors classified before schema errors
- [ ] Verdict schemas for reviewer/judge/synthesis/verifier roles; prompt template updates
- [ ] Structured disagreement records end-to-end (candidate → judge → synthesis → disagreement ledger)
- Tests: repair-success, repair-exhaustion, quoted-example-JSON trap case, disagreement-without-keyword preserved. Docs: architecture invariants section. Done when: the F-7 trap corpus passes and no run concludes via unstructured verdict parsing.

### WS6 — Provider strictness adapters + policy register
- Objective/source of truth: §9 truth table; F-14; R3/R4.
- Inspect/change: NEW `dispatch/providers/{policy-register,openrouter-strict,azure-strict}.mjs`; `dispatch/lib/providers.mjs` (provider ids: split `azure` into `azure-foundry-claude` and `azure-openai`), `dispatch/lib/pi-agent-adapter.mjs`, settings schema (policy-override acknowledgment key).
- Behavior: old = provider paths undifferentiated by policy; OpenRouter/Azure requests carry no exactness controls. Target = every provider path has status official|gray-unstable|prohibited with a doc citation; prohibited (Anthropic consumer OAuth reuse) refuses `provider-policy-blocked` unless a persisted settings acknowledgment exists AND the consent screen displays it; OpenRouter requests structurally carry `provider:{only,allow_fallbacks:false,require_parameters:true}` (via Pi models.json headers/params or a request-shaping hook through the runtime adapter — decide at implementation against Pi 0.80.7's request-shaping surface; if Pi cannot shape per-request bodies, route OpenRouter through an explicit HTTP adapter implementing the same envelope contract); Azure adapters assert served-model identity per call.
- [ ] Policy register with statuses + citations; refusal + override flow; consent-screen disclosure
- [ ] OpenRouter strict request shaping + response `model` verification; negative test proving no request leaves without the pin block
- [ ] Azure split provider ids; served-model assertion (header on Responses-style, `model` field on chat-style); refusal on absence
- [ ] Copilot path: document effort coarseness (server-scoped) in the register; effort requests beyond Copilot's per-request capability refuse rather than degrade
- Tests: per-path policy fixtures; OpenRouter negative routing tests; Azure identity mock tests. Docs: NEW docs/providers.md (truth table distilled, statuses, citations). Done when: R3/R4 acceptance tests pass and every provider path in docs names its policy status.

### WS7 — Worktree unification + lifecycle
- Objective/source of truth: F-8, F-11.
- Inspect/change: `dispatch/lib/runner.mjs:975-1094`, `extensions/lib/helix-command-core.mjs:805-843`, `tools/worktree/helix-worktree.sh`, NEW cleanup command in `/helix-runs`.
- Behavior: old = worktrees created, never surfaced/cleaned; two disjoint systems. Target = one system (runner's); completion render surfaces branch + path + diffstat; `isolation:'worktree'` available per script `agent()` with deterministic resume-stable naming (runId+callIndex); auto-remove unchanged worktrees; retained worktrees listed and cleanable via `/helix-runs`; merge remains an explicit operator action (documented; never automatic); shell tool deleted or reduced to a documented wrapper.
- [ ] Surface branch/path/diffstat in completion + run records
- [ ] Deterministic per-agent worktrees; unchanged-auto-clean; retained listing + clean command; owner-ref GC
- [ ] Unify/delete `tools/worktree/helix-worktree.sh` (update selftest accordingly)
- Tests: worktree suite (collision, unchanged-clean, retained listing, corrupted-metadata teardown — adopt Quintin's cases). Docs: manual worktree section. Done when: no orphaned worktrees after the full test suite + a converged mock run shows its branch in the completion output.

### WS8 — Deletions and truth restoration
- Objective/source of truth: F-10, F-15; R6.
- Inspect/change (delete): legacy engine path in `dispatch/lib/task-loop.mjs` (keep the objective-gate module — extract `makeObjectiveGate` first), `debate.mjs`, `role-matrix.mjs`, `agent-team.mjs`, `adversarial-policy.mjs`, legacy `ROUTES` in `routes.mjs`, `openrouter-revision-adapter.mjs`, `revision-effect.mjs` mock-only revision path (verify no engine consumer first), chains `scout/research/ship-pre-pr` + their configs, duplicate mock adapter in task-loop, `loop_runnable` computation, `role_matrix` frozen knob; matching tests and smoke scripts (`dispatch-smoke`, `revision-effect-smoke`) removed or rewritten against the engine.
- [ ] Extract objective gate into `dispatch/lib/objective-gate.mjs`; rewire runner + loop CLI
- [ ] Delete the modules/chains/adapters above; remove their tests; rewrite smoke scripts against the engine
- [ ] Recompute or drop `loop_runnable`; update `/helix-chains` output
- Tests: full suite green post-deletion; governance test asserting deleted modules stay gone (no re-import). Docs: architecture.md rewrite (remove legacy engine narrative), README counts. Rollback: git revert (pure deletion commits kept separate within the branch for reviewability). Done when: `grep -r "debate\|role-matrix\|adversarial-policy"` in dispatch/ returns only historical docs.

### WS9 — Observability
- Objective/source of truth: delta rows (progress/steering/usage); Quintin UI as reference (not a port — Helix renders from its own event stream).
- Inspect/change: `extensions/lib/helix-command-core.mjs` watch/render paths; `tools/runs/helix-runs.mjs`; events grammar (additive kinds `agent-call-start/end` with usage).
- [ ] Live run view: per-phase agent counts, per-call status/tokens/cost, drill-down to envelope summaries (public-safe projections only)
- [ ] `/helix-runs`: list, watch, resume, stop, clean; per-run usage rollup incl. cache splits
- Tests: renderer fixtures from synthetic event streams; leak-scan on all projections. Docs: manual observability section. Done when: a fan-out mock run is watchable live with per-agent usage.

### WS10 — Instruction-boundary fencing (Helix CC port)
- Objective/source of truth: delta row; Helix CC `workflows/helix-delivery.js:83-93` + `tests/workflow.test.mjs:133-168` (fence-count pattern).
- Inspect/change: `dispatch/lib/prompt-compiler.mjs`, `dispatch/lib/handoff.mjs`, judge/synthesis candidate interpolation in `orchestrate.mjs`/`judge.mjs`.
- [ ] `fence()` helper (marker + JSON serialization + exact-marker stripping) applied at every upstream-output→downstream-prompt boundary (handoff docs, candidate projections, judge inputs, synthesis inputs, verifier inputs)
- [ ] Exhaustive per-boundary fence-count test (port the pattern); marker-collision neutralization test
- Tests: as above + prompt-compiler golden files updated. Docs: architecture instruction-boundary section (state plainly: task text and repo content read by tools remain operator-trusted). Done when: fence-count test enumerates and covers every interpolation site.

### WS11 — Test and evaluation architecture (see §17)
- [ ] Conformance oracle import: Michaelliv parser/determinism fixtures; Quintin behavior fixtures (resume, abort, budget, schema, quota) rewritten against HSE APIs with NOTICE attribution
- [ ] Property tests (caps, ordering, journal determinism); corruption suite (truncated events/state/journal); concurrency suite (lease contention, parallel writers refused); packaging test (`npm pack` contents vs files whitelist)
- [ ] Opt-in live-provider suite: `HELIX_LIVE_TESTS=1` + per-provider opt-in envs; smallest-viable prompts; asserts effective-tuple echo per provider; NEVER in CI gate; documented cost expectations
- Done when: §22 gate passes and the live suite runs green against at least one provider when explicitly invoked by the operator (not required for the branch).

### WS12 — Documentation migration + final gate (see §21, §22)
- [ ] Execute the §21 checklist; update `check:docs-truth` pins; append this evaluation's rejected findings (§12) to `reviews/` ledger
- [ ] Run the full §22 gate; record outputs in the PR-less push notes (commit message body)

## 17. Test and evaluation architecture

Layers (all deterministic unless marked): **unit** (parser, binding, refusal codes, policy register); **conformance** (script dialect vs Claude semantics: null-propagation, pipeline independence, barrier behavior, cap enforcement, budget ceiling, prefix-cache resume — fixtures adopted from both dynamic-workflows suites plus new Helix-strictness cases: cast-violation, identity-mismatch, policy-blocked); **property** (journal replay idempotence; ordering stability; cap invariants under random schedules); **corruption** (truncated/garbled state, events, journal, disagreements → named refusals, never repair); **cancellation** (abort at every lifecycle point; gate pgid kill); **concurrency** (lease contention, writer-mutex, parallel read panels); **worktree** (collision, unchanged-clean, retained, corrupted teardown); **packaging** (pack contents, extension load via `tools/smoke/pi-e2e-load.mjs` pattern); **no-egress** (existing lint + existing Docker packet-level harness, still manual); **provider-contract** (mock servers asserting OpenRouter pin-block presence, Azure served-model handling, error-classification mapping); **SDK-compatibility** (pi-runtime-adapter conformance: version assert, clamp-equivalence, export-surface smoke against the pinned Pi); **opt-in live** (WS11; explicitly out of the gate).

## 18. Benchmark/scenario suite vs Claude behavior (expected observable outcomes)

| Scenario | Claude Code 2.1.211 observable | HSE expected observable |
|---|---|---|
| `parallel` thunk throws | null slot; call resolves | identical |
| `pipeline` stage throws for one item | item nulled, later stages skipped; others unaffected | identical |
| Resume with unchanged script+args | 100% cache hit, instant | identical (journal test) |
| Resume after editing call N | calls <N cached, ≥N re-run | identical |
| Unknown model requested | **silent fallback to inherited model** (org-allowlist case) | **refusal `binding-unknown-model` pre-egress** — deliberate, documented divergence |
| Unsupported effort | inherit/clamp behavior | refusal `binding-effort-unsupported` — divergence |
| Budget exhausted mid-run | further agent() throws | identical (hard ceiling) |
| Two agents mutate same file without isolation | conflict possible; worktree opt-in | writer roles serialized by default; worktree opt-in — stricter |
| Kill process mid-run | same-session resume only; next session fresh | cross-process resume from journal + leases — stronger |
| Structured output invalid after retries | error result subtype | refusal `agent-schema-noncompliance` after repair ladder — comparable |
| Workflow completion | task notification + journal | run-end event + completion render with branch/diffstat |

## 19. Operational failure model

- **Instruction boundaries:** all inter-agent content mechanically fenced (WS10); task text and tool-read repository content remain operator-trusted (documented, matching Claude Code's own posture); event/persistence grammar (no-space codes) remains the leak barrier for run artifacts.
- **Repository input:** scripts and workflow JSON validated closed at load; script content consent-bound by hash; caps bound execution; vm realm is a determinism device, **not a security boundary** (stated plainly — same posture Quintin's README takes).
- **Localhost services:** none required by the target (no sidecar). The optional live-test mock servers bind localhost only.
- **Logs/transcripts:** run artifacts public-safe by construction; optional persisted Pi transcripts carry a secrets warning and are off by default; retention policy added for runs (age-based prune command, never automatic deletion of paused runs).
- **Dependencies:** runtime deps unchanged (acorn added for the parser — the only new runtime dependency); Pi pinned; no network at install (no postinstall scripts).
- **Updates/packaging:** Pi upgrades gated by the WS1 conformance tests; `npm pack` contents tested; extension load smoke retained.
- **Failure visibility:** every terminal state is a named refusal code in events + render; paused runs are first-class and listed; no failure path prints raw provider payloads.

## 20. Uncertainty register

| # | Uncertainty | P | Impact | Detection | Resolution | Owner | Stop condition |
|---|---|---|---|---|---|---|---|
| U-1 | Pi 0.80.7+ request-shaping surface may not allow per-request OpenRouter body injection | Med | WS6 OpenRouter path | Implementation spike against pinned Pi | Fall back to explicit HTTP adapter behind the same envelope contract (already designed) | Implementer | If neither Pi shaping nor HTTP adapter can guarantee the pin block, OpenRouter path ships `gray-unstable` and refuses exact-mode casts |
| U-2 | Anthropic/OpenAI subscription policies change again (credit un-pause, new prohibitions) | High | Policy register contents | Register citations dated; re-verify at implementation | Update statuses; register is data, not code | Implementer | Never ship a prohibited path as official |
| U-3 | Pi unreleased `modelRuntime` API lands within the pin window | Med | pi-runtime-adapter | WS1 version assertion fails loudly | Adapter absorbs; pin excludes 0.81 | Implementer | Do not chase unreleased APIs |
| U-4 | Effective-model echo unavailable for some Pi providers (message shape lacks model id) | Low-Med | F-5 fix completeness | WS2 implementation against pinned Pi; live suite | Envelope marks `effective: unverified` and consent-mode setting decides refuse-vs-warn | Implementer | Exact-mode casts refuse on unverifiable identity |
| U-5 | Quintin fixtures encode 0.80.6+ behaviors that differ under the pinned Pi | Low | Oracle fidelity | Fixture port failures | Adjust fixtures with documented rationale (never silently) | Implementer | — |
| U-6 | Chain→script compiler byte-stability across Node versions | Low | Reproducibility gate | CI matrix (22.19, 26) | Canonical serialization | Implementer | — |

## 21. Documentation migration checklist

- [ ] README.md: feature list (script workflows, resume, providers policy), test counts, remove legacy-engine implications; keep ≤120 lines (docs-truth pin)
- [ ] docs/architecture.md: rewrite around HSE components (§14 diagrams), delete legacy engine narrative, add instruction-boundary + identity-assertion sections
- [ ] docs/manual.md: script dialect reference, resume flows, worktree lifecycle, effort vocab incl. `max`, provider policy statuses
- [ ] docs/workflows.md: script authoring + chain-compilation semantics, saved workflows
- [ ] NEW docs/providers.md: distilled truth table with citations and statuses
- [ ] AGENTS.md / CLAUDE.md: engine conventions, refusal-code style, pi-runtime-adapter rule (no direct Pi imports)
- [ ] reviews/: append this evaluation's rejected findings (§12) and accepted-findings dispositions; preserve history (append-only)
- [ ] tools/ci/docs-truth-check.mjs: update pinned snippets/counts in the same commits as the docs they pin
- [ ] SECURITY.md: vm-realm non-boundary statement, transcript persistence warning

## 22. Final all-or-nothing verification gate (exact commands)

All must pass locally on the branch head, on Node 22.19.0 AND current Node 26.x (mirror of CI matrix), before the single push:

```
npm test                                   # node --test tests/*.test.mjs + worktree + loop selftests
npm run check:resources
npm run check:docs-truth
npm run check:no-live-egress
npm run check:public-safety-diff
node tools/smoke/dispatch-smoke.mjs        # rewritten against HSE in WS8
node tools/smoke/revision-effect-smoke.mjs # or its WS8 replacement
node tools/smoke/pi-e2e-load.mjs           # extension load against pinned Pi
npm pack --dry-run                         # files whitelist intact
git diff --check                           # no whitespace damage
git log --oneline origin/main..HEAD        # every commit traceable to a WS
```

Plus one-time branch checks (§16): remote identity/visibility/rulesets/collision before edit and before push; post-push `git ls-remote origin <branch>` SHA equality; explicit note that branch pushes trigger no remote CI by repository configuration.

## 23. Definition of done and non-goals

**Done when:** every §16 checkbox is complete on the single branch; §22 gate passes on both Node versions; every §6 acceptance test exists and passes; every P0/P1 finding is closed by a named workstream with a regression test; docs checklist complete; the pushed branch SHA verified; nothing merged, tagged, released, or PR'd.

**Non-goals (explicit):** model-driven agent self-delegation (nested Agent-tool-style spawning) — scripts are the only orchestration authority; Claude Agent SDK integration (revisitable behind the adapter contract); Codex/Copilot peer executors (future adapters; contract already defined in §14); CLIProxyAPI in any role; Helix CC changes (separate repo; three defects reported in §8.3 for its maintainers); automatic worktree merges; marketplace/distribution work; imitating Claude Code UX cosmetically.

## 24. IMPLEMENTATION DISPATCH PROMPT (copy/paste for the implementing agent)

```
You are implementing the Helix Script Engine program defined in ROADMAP.md at the
root of luisgui1757/helix. ROADMAP.md is the sole specification; read it fully
before any change. MODE: WRITE, single-deliverable.

Hard constraints:
1. Verify before editing AND again before pushing: remote is exactly
   https://github.com/luisgui1757/helix (public, default branch main, not a fork);
   rulesets protect only the default branch; your base equals current origin/main;
   your branch name (suggested: helix-script-engine-v1) does NOT exist on the
   remote (git ls-remote --heads origin <name> must be empty). If any of these
   drifts from ROADMAP.md §16's recorded state, STOP and report.
2. Work in an isolated git worktree or a clean disposable clone. Never modify,
   revert, or reformat user-owned files outside the program's named scope.
   Preserve all unrelated worktree state.
3. Implement ALL workstreams WS1-WS12 (ROADMAP.md §16) as ONE consolidated
   change on that ONE fresh non-default branch. Internal commits per workstream
   are encouraged (deletions separated for reviewability), but there is exactly
   one final push: no force-push, no PR, no merge, no tag, no release, and never
   any write to main.
4. Run the full verification gate (ROADMAP.md §22) on Node 22.19.0 and current
   Node 26.x locally before the push. A check you did not run is not evidence;
   record which ran. Note: repository CI does not run on branch pushes — your
   local gate is the only gate; say so in the final report, do not claim remote
   checks ran.
5. After pushing, verify git ls-remote origin <branch> equals your local HEAD
   SHA and report it.
6. No compromises: no test weakening/skipping, no checker suppression, no
   hardcoded results, no partial workstreams, no "land now, finish later". If an
   uncompromised implementation is blocked (e.g. uncertainty U-1..U-6 resolves
   badly), STOP, document the blocker with evidence, and report instead of
   shipping a degraded substitute.
7. Fail-closed provider rules are binding: unknown tuples refuse pre-egress;
   no silent fallback of provider/model/effort/account anywhere; prohibited
   subscription paths refuse by default. Do not invoke live provider endpoints
   except via the explicitly opt-in live test suite, and only if the operator
   has authorized it.
8. Update every named doc and the docs-truth pins in the same change as the
   behavior they describe. Append (never overwrite) the reviews/ ledgers.
9. Cite ROADMAP.md section numbers in commit messages. Clean up any temporary
   worktrees/clones you create.

Deliverable: the pushed branch, plus a final report listing per-workstream
completion evidence, gate outputs, the pushed SHA, and any deviations (which
must be zero or explicitly justified stop-reports).
```
