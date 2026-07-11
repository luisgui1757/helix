# Stage 3C — thin dispatch orchestrator

> **Historical implementation record — not current operational documentation
> (superseded 2026-07-10).** This page preserves what the named stage shipped at
> the time. Some mechanisms may still exist, but cost/no-spend policy, token
> budgets, write allowlists, live enablement, and the referenced live smoke
> commands were later removed; no task-loop live transport ships. Use the
> [current design contracts](design-contracts.md) and [manual](../manual.md) for
> current behavior. Do not treat commands here as runnable unless they also
> appear in those current documents.


One dispatch cycle over the Stage 3B policy core: classify → resolve
route/profile/panel → pre-launch spend/eligibility gates → launch candidates
through an **injected adapter** → validate every role envelope at the boundary →
blinded judge projection (advisory) → objective gate from exit status or a
deterministic checker → structural public-safe run record.

Source of truth:
[`docs/architecture/fusion-dispatch-research.md`](../architecture/fusion-dispatch-research.md)
(accepted Stage 3A spec) consumed through
[`docs/stage3/dispatch-policy-core.md`](dispatch-policy-core.md) (Stage 3B).
The orchestrator adds **no policy of its own** — it sequences the substrate's
checks and fails closed between stages.

## What shipped

| Piece | Responsibility |
| --- | --- |
| `dispatch/lib/orchestrate.mjs` | `runDispatch(request, deps)` — the one-cycle orchestrator; `DISPATCH_REQUEST_SCHEMA`; `seededPermutation` (deterministic judge order); `clampPriceToProfile` (profile-level TTL clamp). |
| `tests/dispatch-orchestrate.test.mjs` | Success, determinism, and the fail-closed matrix incl. pre-launch downstream singleton validation, cost projection, Copilot pin gate, nonnegative USD aggregation, and safe adapter failure details (42 test declarations). |
| `tools/smoke/dispatch-smoke.mjs` | Deterministic mock smoke: one dispatch cycle, no network, no credentials, byte-identical run record in gitignored `dispatch/runs/`. |

Everything is dependency injection — no ambient effects inside the module:

- `adapter.runCandidate(spec, ctx)` / `adapter.runJudge({rubric_id, projections}, ctx)` /
  `adapter.runSynthesis({rubric_id, candidate_summaries, judge_summary, contradictions}, ctx)`
  (Stage 3D) / `adapter.runVerifier({exit_status, gate, cap_status, warning_codes, claims_ref, evidence_ref}, ctx)`
  (Stage 3E) — the only way models are "called". Mock/canned adapters only; the
  sole live path is the preflight-gated OpenRouter `:free` smoke
  ([`synthesis-nospend-adapter.md`](synthesis-nospend-adapter.md)).
- `runGate(route, ctx)` — objective gate outcome; must report
  `source: "exit-status" | "deterministic-checker"`. A model narrative is not a
  legal gate source and fails closed.
- `now` (epoch seconds) and `seed` (integer) — injected clock and randomness;
  same seed + same input ⇒ same permutation, same projection, same record bytes.
- `mode` — `"tui"` is the only interactive mode; anything else treats required
  escalation as a fail-closed stop (mirrors the yolo-fence rule).
- `record_dir` — where the structural record is persisted (tests use temp dirs;
  the smoke uses gitignored `dispatch/runs/`). Omit to skip writing.
- `parallel?` — `{ max_concurrency, token_budget }` opts into bounded-parallel
  candidate launch (Stage 3F, [`parallel-dispatch.md`](parallel-dispatch.md)).
  Absent ⇒ sequential (unchanged). Output stays candidate-index deterministic.

## Cycle contract

1. **Recursion fence first**: depth is exactly one. Adapters receive
   `ctx.depth = 1`; a nested `runDispatch` refuses (`refused-recursion-depth`).
2. **Request boundary**: `DISPATCH_REQUEST_SCHEMA` validates shape; providers
   are enum-bound to the canonical set; `claims_ref`/`evidence_ref` must match
   the ref/hash pattern — free text never gets past the boundary.
3. **Profile**: built-in id or supplied config; `assertProfileUsable` decides
   (`lockdown` stays unusable until config supplies caps + allowlist); the
   request `input_class` must be allowed by the profile.
4. **Classification**: existing classifier with floors and raise-only
   overrides. Uncertain + non-TTY ⇒ fail-closed stop; uncertain + TUI ⇒
   `status: "escalate"` for the caller to resolve (the orchestrator has no UI).
5. **Panel (N3)**: `resolvePanel` precedence; requests beyond the launched
   panel are truncated **with a recorded warning** (`requested-candidates-truncated`);
   a panel below the route minimum or unmeetable successes fails closed.
6. **Pre-launch cost/provider-policy projection, every dispatch** (spec: "Every
   dispatch projects cost and token exposure before launch. Unknown price,
   unknown provider policy, ... or stale price verification fails closed"): role
   must belong to the route and the candidate stage; provider must be
   automated-dispatch-eligible and in the profile's `eligible_providers`. Then the
   cost is projected with the metadata TTL **clamped to the profile's
   `price_ttl_seconds`** (`clampPriceToProfile`, tightening only):
   - under `requires_free_verified` (`no-spend-test`) → `evaluateNoSpend` (mock or
     verified `:free` zero price);
   - under spend-allowed profiles (`personal`/`lockdown`) → `evaluateCostProjection`
     — `mock` is free, `openai-codex` subscription is token-bounded (no per-call
     USD), and **metered providers require fresh, sourced, verified price** or fail
     closed (`cost-projection-refusal:<code>`); **`github-copilot` requires a fresh,
     structurally-valid profile pin whose model matches exactly** (`evaluateCopilotPin`
     over `profile.copilot_pins`), with pin freshness **bounded by the profile's
     `copilot_pin_ttl_seconds` ceiling** — the effective TTL is the stricter finite
     value of the pin's own TTL and the policy (an overlong pin TTL cannot loosen
     it), and a missing/non-finite policy fails closed. A missing/stale/malformed/
     non-matching pin fails closed (`cost-projection-refusal:refused-copilot-pin`).
     This gate runs for **candidates, the judge, the synthesizer, and the
     verifier**. Route-required singleton configs and adapter hooks for
     judge/synthesis/verification are validated up front too, so a missing config,
     missing hook, metered singleton without fresh sourced price, or unpinned-Copilot
     singleton stops the run **before any candidate adapter call**. Judge routes
     also require the blinding seed before launch. If eligible candidates already
     can't meet `required_successes`, the run also stops before any adapter call.
7. **Launch**: sequential by default; **opt-in bounded-parallel** when
   `deps.parallel = { max_concurrency, token_budget }` is present (Stage 3F, built
   on the Pi `subagent` concurrency-limiter pattern). Parallel validates the cap
   (`invalid-concurrency-cap`) and a bounded per-run token budget
   (`unbounded-parallel-budget`) before any launch, then runs at most
   `max_concurrency` candidate calls in flight. Either way, results are **processed
   in candidate-index order**, so completion order never changes outcomes / records
   / warnings (same-config parallel runs are byte-identical, and parallel yields the
   same candidate outcomes as sequential; `cap_status.token_cap` records the
   effective enforced budget). Every returned envelope is validated
   (`validateRoleEnvelope`) and must match the
   vetted spec (stage/role/provider/model/run_id) — an adapter cannot smuggle in a
   provider policy never approved. Failures drop the candidate with a recorded
   warning; below `min_successes` the run fails closed before judge/synthesis. On
   `requires_cross_family` routes, a single-family panel records the advisory
   `cross-family-not-satisfied` warning (never a blocker).
8. **Judge (advisory)**: only when the route includes the `judge` role. Rubric
   is required up front (rubric-first); the judge provider/model was already
   cost-projected pre-launch (step 6); the projection is identity-stripped
   and A/B/C re-keyed with a seed-derived (or explicitly supplied) permutation;
   the judge sees **only the rubric and projections** — never seed or
   permutation. `evaluateJudgeSelection` records `judge_in_panel` /
   `judge_in_panel_avoidable` degradations. The judge envelope is validated like
   any other; its content stays advisory — no record field carries a judge
   verdict, and it never influences the gate or exit status.
9. **Synthesis** (advisory; Stage 3D): only when the route includes the
   `synthesizer` role. Requires `request.synthesis` and `adapter.runSynthesis`
   (else fail closed); the synthesis provider/model was already cost-projected
   pre-launch (step 6). The synthesizer receives an identity/cost-stripped
   role-output projection of the candidates and the judge — provider/model/cost
   are stripped, but it carries substantive model text (a provider-bound adapter
   input, **not** a public-safe record artifact; the record persists none of it).
   Its envelope is validated and matched to the vetted spec.
   It **must quote every unresolved candidate contradiction**: a dropped marker
   fails closed (`synthesis-dropped-contradiction`), a preserved one records
   `contradiction-preserved`. Synthesis stays advisory — the gate decides success.
   See [`synthesis-nospend-adapter.md`](synthesis-nospend-adapter.md).
10. **Caps** (spec §"Provider And Cost Policy"): recorded usage is checked against
   profile caps. Any envelope whose cost is unknowable — `cost_class`,
   `price_status`, or `cost_basis` of `unknown` — fails closed
   (`unknown-cost-policy`), because unknown cost/policy can never be shown to
   respect a cap. The **token cap always binds** over all envelopes. The **USD
   cap counts only metered spend**: subscription and free consumption are not
   converted to dollars, so a subscription call reporting a `null` actual is
   expected, not a violation; only a *metered* call whose actual cost is unknown
   fails closed (`usd-spend-unverifiable`), and only metered spend counts toward
   `usd-cap-exceeded`. Negative `cost_estimate_usd` and `cost_actual_usd` are
   invalid role-envelope/run-record inputs, so a negative cost cannot offset
   metered spend in cap aggregation.
11. **Gate**: objective routes require an injected `runGate`; outcome comes from
    exit status or a deterministic checker only. The gate result is **captured**
    (not early-returned): gate fail ⇒ `blocked`. Advisory routes record a gate
    when one is injected and never let it decide success — the human stays final
    authority.
12. **Verification** (advisory; Stage 3E): only when the route includes the
    `verifier` role. Requires `request.verification` and `adapter.runVerifier`
    (else fail closed); the verifier provider/model was cost-projected pre-launch
    (step 6). The verifier receives a **structural, public-safe proof summary**
    (`projectForVerification`: gate outcome, exit status, cap status, warning
    codes, refs — no model narrative). Its envelope is validated and matched to
    the vetted spec. Its content is **advisory only** — it summarizes proof but
    **never** changes the recorded gate result or exit status (a positive verifier
    can't rescue a failed gate; a negative verifier can't block a passed gate).
    Its usage is cap-re-checked; its narrative is never persisted. See
    [`verification-stage.md`](verification-stage.md).
13. **Record**: `buildRunRecord`/`writeRunRecord` produce the structural
    public-safe record for **every outcome from panel resolution onward**
    (`ok`/`blocked`/`fail-closed`), with warnings, judge metadata, usage/cap
    rollups, and refs only. Earlier stops (malformed request, unusable profile,
    classification stops) return `record: null`. If the leak scan trips, the
    record is **not** persisted and the run fails closed
    (`public-safety-violation`).

## Failure posture (fail closed)

Malformed requests, unknown providers/models, ineligible providers,
non-`:free`/unknown/stale/over-TTL price metadata (a non-finite metadata TTL is
**not** sanitized into freshness — it fails closed), a metered candidate/judge/
synthesizer/verifier with missing/unknown/stale/unsourced price under **any** profile
(`cost-projection-refusal:<code>`, pre-launch), a `github-copilot`
candidate/judge/synthesizer/verifier without a fresh matching profile pin
(`cost-projection-refusal:refused-copilot-pin`, pre-launch), private input under
`no-spend-test`, unusable profiles, non-TTY escalation, adapter failures,
malformed or mismatched envelopes, missing judge config/hook/seed, malformed judge
output, missing synthesis config/hook or ineligible/malformed synthesis, synthesis
that drops an unresolved contradiction, missing verifier config/hook or
ineligible/malformed verification, an invalid
parallel concurrency cap or an unbounded parallel token budget
(`invalid-concurrency-cap` / `unbounded-parallel-budget`, pre-launch), unknown
cost/policy, cap / token-budget violations, missing/failed/invalid objective
gates, and public-safety violations all stop the cycle with a stable code;
nothing is silently shrunk, skipped, or guessed. Warning codes persisted to the
record are stable identifiers only — user-controlled request text (signals,
class hints, override classes) never enters them.
Adapter/judge/synthesis/verifier/gate runner failures surface stable details
such as `adapter failed`, `judge adapter failed`, `synthesis adapter failed`,
`verifier adapter failed`, or `gate runner failed`; raw thrown messages are not
returned to CLI/user-visible surfaces or persisted as stop reasons.

Stable pre-launch singleton failure codes: `missing-judge-config`,
`adapter-missing-run-judge`, `missing-judge-seed`, `judge-not-eligible`,
`missing-synthesis-config`, `adapter-missing-run-synthesis`,
`synthesis-not-eligible`, `missing-verification-config`,
`adapter-missing-run-verifier`, and `verifier-not-eligible`.

## Rollup semantics (recorded, documented here once)

- `cost_class`: worst over launched envelopes (+judge) — `paid` > `unknown` >
  `subscription` > `free`.
- `price_status`: worst — `unknown` > `stale` > `not_applicable` > `verified`.
- `usage_rollup` sums tokens; cost sums are `null` when any envelope's cost is
  unknown. `cap_status.usd_spent` is the **metered** spend only (subscription/free
  contribute nothing); `cap_status.within_caps` mirrors the cap check above.
- A gate that never ran records `result: "not-run"`, `source: "advisory"`.

## Running

```bash
npm test                              # includes tests/dispatch-orchestrate.test.mjs
node tools/smoke/dispatch-smoke.mjs   # deterministic mock dispatch; no network, no spend
```

## Out of scope

The synthesis stage landed in **Stage 3D**
([`synthesis-nospend-adapter.md`](synthesis-nospend-adapter.md)), the verification
stage in **Stage 3E** ([`verification-stage.md`](verification-stage.md)), opt-in
bounded-parallel candidate launch in **Stage 3F**
([`parallel-dispatch.md`](parallel-dispatch.md)), and the bounded iterating /
adversarial debate loop in **Stage 3G**
([`iterating-debate.md`](iterating-debate.md)) — all documented in the cycle
contract above or in their own docs. The Stage 3G debate layer **composes** this
one-cycle orchestrator (one iteration = exactly one cycle) and lives *above* it, so
the orchestrator itself still runs a single cycle with **no retries or iterations of
its own** (the recursion fence keeps `depth === 1`). Still out of scope for the
orchestrator: real non-mock provider adapters, any live/paid model call beyond the
single preflight-gated OpenRouter `:free` smoke
(`tools/smoke/openrouter-free-dispatch-smoke.sh`, fail-closed on stale metadata),
TUI spend-confirmation flows (`confirm_threshold_usd` / `warn_before_wide` are
surfaced by profiles but need an interactive caller), real subprocess fan-out,
autonomous loops, hosted `openrouter/fusion`, live pipeline UI, and
`pi-messenger`. Divergence from the Stage 3B fixture shape, recorded: fixture 4
shows a refused candidate alongside a launched one; the orchestrator stops
**before any launch** when pre-launch refusals already make `required_successes`
unmeetable — stricter and spend-safer than launching a doomed panel.
