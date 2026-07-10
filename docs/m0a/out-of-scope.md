# Out of scope until Phase 1+

M0a is an **evidence + baseline documentation** slice. It builds **no** Pi extension.
This file states plainly what M0a does **not** deliver, so nothing here is mistaken
for done. Mapping is to `ROADMAP.md` §8 (milestones) and §10 (phases).

## Not built in M0a

| Deferred item | Where it lands |
| --- | --- |
| **Yolo-fence** extension (`tool_call` + `ctx.ui.confirm` denylist, fail-closed non-TTY) | Phase 1 / M1 |
| **Worktree manager** (create / list / prune + provisioning + prune-on-exit) | Phase 1 / M1 |
| **`remote-pi`** adoption (blocked: `remote-pi@0.5.3` peers `^0.78.0`, not 0.80.3; needs fence first) | Phase 1 / M3 |
| **`pi-web-access`** adoption (needs full §5 audit before install) | M1 |
| **implement → objective-gate → review → fix loop** | Phase 2 / M2 |
| **`\answer`** interactive multi-CGS resolver | Phase 2 / M2 |
| **Configurable status bar** (`/statusbar` picker) | Phase 2 |
| **Pre-PR gate chain / `/ship`** + conservative local PR proxy prototype | Phase 2 / M3 |
| **Orchestration substrate**: parallel dispatch, agent teams, per-role model/effort/instance matrix, default chains, live pipeline view, `pi-messenger` | Phase 3 / M2 |
| **Adversarial / multi-team debate** (default-on for meaningful work) | Phase 3 |
| **Fusion-style dispatch implementation** (panel / judge / synthesis) | Phase 3, after `docs/architecture/fusion-dispatch-research.md` is accepted |
| **Deferred/experimental**: `pi-nvim`, hosted `openrouter/fusion` adapter (the DIY Fusion-style panel→judge→synthesis dispatch is CORE Phase 3, not deferred), Headroom, `/workflow`, babysitter, voice (OpenWhispr, docs-only), autonomous experiment loop, firstmate-style orchestration, HTML theming | Phase 4 |

## M0a's own remaining open items (still Phase 0, not M0a-complete)

**Closed in the finalize slice (2026-07-03)** — evidence in
[`reviews/m0a/pi-internals-2026-07-03.md`](../../reviews/m0a/pi-internals-2026-07-03.md):

- ✅ **Interactive `/` baseline captured** from source (22 built-ins; `enableSkillCommands`
  default `true`; prime-added = 0) — [`command-surface-inventory.md`](./command-surface-inventory.md).
- ✅ **Native tool/function calling verified** (7 built-in tools, `registerTool`/TypeBox,
  parallel-exec default-on, `--tools`/`-xt`/`-nbt`/`-nt` gating) — nothing to build.
- ✅ **Compaction probe resolved by code** (§9-Q6): context files live in the system
  prompt, which compaction never touches ⇒ no drift, no `APPEND_SYSTEM.md` —
  [`context-and-project-trust.md`](./context-and-project-trust.md).

**Closed in the lockdown + smoke slice (2026-07-04):**

- ✅ **Lockdown boundary chosen + Level-2 smoke passed** (no-network + local-mock class):
  Plain Docker `--network none` ([`lockdown-boundary.md`](./lockdown-boundary.md)); harness
  [`tools/lockdown/`](../../tools/lockdown/); evidence
  [`reviews/m0a/level2-lockdown-smoke-2026-07-04.md`](../../reviews/m0a/level2-lockdown-smoke-2026-07-04.md)
  (5/5: deny-by-default egress, offline startup, active session reaching only a local mock —
  no secrets/spend).
- ✅ **First thin vertical smoke shipped** ([`vertical-smoke/`](./vertical-smoke/) +
  `tools/smoke/status.sh`): plan/answer capture, second-provider review handoff, raw
  worktree checklist, PR-gate checklist, status visibility — checklists/scripts only, not
  the full systems.
- ✅ **Real approved-provider no-spend smoke passed**:
  [`tools/smoke/openrouter-free-smoke.sh`](../../tools/smoke/openrouter-free-smoke.sh)
  ran native Pi OpenRouter against `cohere/north-mini-code:free`; evidence
  [`reviews/m0a/openrouter-free-smoke-2026-07-04.md`](../../reviews/m0a/openrouter-free-smoke-2026-07-04.md).
  This closes the real-provider live-call proof without claiming privileged packet-level
  endpoint exclusivity.

These remain Phase-0 tasks that this slice **plans and grounds** but does not finish;
tracked as open in `ROADMAP.md` §10:

- **Claude-auth spike — live-billing sub-item only** (§9-Q4): local feasibility (first-party
  `claude` CLI present) and documented economics (`providers.md:31`) are settled; the
  live-account billing probe (needs a real billed call) stays deferred
  ([`provider-and-egress-posture.md`](./provider-and-egress-posture.md)).
- **Positive `/share` denied trace.** The Level-2 no-network boundary structurally blocks
  `/share`, but a positive attempted-upload denial against the real relay remains a future
  lockdown follow-up when that path is exercised.

## Standing constraints (apply to every later slice)

- **Adopt before build** (§2.1, §5): Pi-native first, then the catalog gate; build
  bespoke only when nothing qualifies.
- **No package install before its full audit** (source / license / install-scripts /
  dependencies / peer-deps / engines / Pi-compat / command-surface / no-exfiltration)
  and durable raw metrics under `reviews/package-audits/`.
- **Definition of done** (§8 Quality Bar): nothing ships without unit tests + an
  e2e `pi`-load smoke + edge/failure tests + a CI gate. M0a ships docs + a shell
  evidence script, so its "test" is the script running clean and the checksum
  matching; extension test harness starts when the first extension does.
