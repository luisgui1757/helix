# Stage 3 Review Summary

Append-only public-safe review ledger for Stage 3 architecture and implementation
work.

## 2026-07-05 — Fusion dispatch Stage 3A spec review

Scope: `docs/architecture/fusion-dispatch-research.md`, PR #11 and follow-up
PR #12.

### Fable 5 first pass

Verdict: ACCEPT AFTER FIXES / NOT READY.

Material findings:

| ID | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| H1 | High | `no-spend-test` did not actually guarantee no spend because Copilot could be eligible without a zero-cost proof. | Fixed in PR #12: `no-spend-test` now allows only mocks plus metadata-verified OpenRouter `:free` over synthetic/public fixtures. |
| H2 | High | Token/spend caps were mandated but unmeasurable in the envelope/run record. | Fixed in PR #12: usage, cost, price, cap, attempt, and iteration fields were added. |
| H3 | High | Public-safe claims/evidence logging depended on judgment rather than mechanics. | Fixed in PR #12: Stage 3B records structural metadata and hashes/refs only until a mechanical export/redaction step exists. |
| M1-M11 | Medium | Provider identity, `:free` verification, min-success/iteration/convergence, non-TTY escalation, runtime validation, judge-bias mitigations, classification floors, Stage-3B scope, and final authority were under-specified. | Fixed or reserved in PR #12: canonical provider mapping, metadata checks, `min_successes`, TypeBox validation, judge projection/degradation records, classification floors, exhaustive Stage-3B scope, and human authority for gateless cases were specified. |

### Fable 5 follow-up pass

Verdict: ACCEPT AFTER FIXES / READY once final textual fixes land.

Follow-up findings:

| ID | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| N1 | Medium | Superseded Copilot/no-spend policy survived in four live docs and two dated references. | Fixed in PR #12 follow-up: live docs now state Copilot is outside `no-spend-test`; dated references are rewritten or marked superseded. |
| N2 | Low | Public-safe run record allowed branch names unconditionally, unlike file paths. | Fixed in PR #12 follow-up: branch names are plain only for this repository; other targets are omitted or hashed. |
| N3 | Low | Profile-cap vs route `min_successes` precedence needs schema/oracle detail. | Deferred to Stage 3B route/profile schema and fixtures. |
| N4 | Low | Price-verification TTL and `price_verified_at` field need concrete schema detail. | Deferred to Stage 3B config schema and run-record writer. |
| N5 | Low | Roadmap and summary date stamps were stale. | Fixed in PR #12 follow-up: dates bumped to 2026-07-05. |
| N6 | Info | TypeBox wording and related nits could be tightened. | Partly fixed in PR #12 follow-up: TypeBox is now mandatory. Remaining nits can ride Stage 3B. |

Stage 3B remains blocked until the fixed Stage 3A spec is accepted after review.

## 2026-07-05 — Stage 3B dispatch-policy-core implementation

Scope: `dispatch/**`, `tests/dispatch-*.test.mjs`, `tools/smoke/nospend-preflight.mjs`,
docs. Public-safe summary; no raw transcripts or provider payloads.

Delivered the pure, fail-closed policy/config/schema/run-record substrate (no
orchestrator, no live/paid calls): runtime role-envelope validation with the
role/stage matrix; canonical provider mapping; no-spend cost policy (mock +
metadata-verified OpenRouter `:free` only, everything else fails closed); the
three dispatch profiles + Copilot-pin metadata; the task-class routes with the
reserved `role→[{provider,model,effort,instances}]` matrix; a deterministic
classifier with mandatory classification floors and non-TTY fail-closed
escalation; judge-bias blinding projection; and a public-safe run-record writer
with a mechanical leak scan. Initial implementation test count was superseded by
the review fixes below; the current Stage 3B count is 107 node tests. This
includes the five
spec evaluation-fixture oracles.

Deferred-item disposition:

| ID | Prior status | Now |
| --- | --- | --- |
| N3 | Deferred to Stage 3B | Implemented in `resolvePanel`: profile caps are maxima, route `min_successes` governs launched candidates, capped panels are recorded (never silently shrunk), sub-minimum caps fail closed. |
| N4 | Deferred to Stage 3B | Implemented as `verified_at`/`source`/`ttl_seconds` + profile `price_ttl_seconds`/`copilot_pin_ttl_seconds`; stale/unknown/future price fails closed. |

Recorded contradiction (resolved in this PR): the spec mandates TypeBox, but the
resource-package invariant forbids installed runtime dependencies and `typebox`
resolves only inside Pi's runtime. Resolution: a zero-dependency runtime
validator whose descriptors are authored in the exact JSON-Schema shape TypeBox
emits (drop-in for real TypeBox in a Pi extension). Runtime, not
TypeScript-only, fail-closed validation is met and tested. Spec updated in the
Role Schema section; detail in `docs/stage3/dispatch-policy-core.md`.

Not run this slice: any live model call, including the optional OpenRouter
`:free` smoke — the mechanical `nospend-preflight` gate and pure tests land
first; live execution is deferred to avoid spend ambiguity.

### Second-provider review fixes (fail-closed hardening)

A second-provider review of the Stage 3B safety core found four real
fail-closed holes; all four were reproduced and fixed with regressions in the
same PR.

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| R1 | High | `run-record` accepted raw text in `input_refs[].value` (only `claims_ref`/`evidence_ref` were ref-validated), so raw prompt text could enter a tracked record. SoT: spec §"Public-Safe Logging". | `buildRunRecord` now validates every `input_ref` value against its declared kind (`sha256`/`local-ref`/`redacted-id`); raw text is rejected. |
| R2 | High | Provider-key leak scanner missed hyphen-prefixed keys (`sk-proj-…`, `sk-live-…`, `sk-ant-api03-…`); the same weak pattern lived in `tools/ship/pr-gate.sh`. | Both scanners broadened to `sk-[a-z0-9-]{20,}`; split-literal regressions cover `sk-proj-`/`sk-live-`/`sk-ant-api03-`. |
| R3 | Medium | `evaluateNoSpend` accepted OpenRouter `:free` metadata with a verified zero price but no `source`. SoT: spec §"Provider And Cost Policy" (verification time AND source recorded). | Verified `:free` now requires a non-empty `price.source`; missing/blank source fails closed (`refused-price-no-source`). |
| R4 | Medium | `schema.mjs` only enforced `pattern` when it was a `RegExp`; JSON-Schema/TypeBox emit string patterns, so a string `pattern` was silently ignored (fail-open). | String patterns are now compiled and enforced; `RegExp` retained as an internal convenience. Both are tested. |

Test count after fixes: 104 node tests pass. Public-safety scans
(`pr-gate.sh`, `check:resources`) pass with the hardened provider-key pattern;
the two synthetic leak samples and the new pattern literals are split so the
scanners do not self-match.

Follow-up (non-blocking review note): a `sha256` input ref could still record
`algorithm: null` while its value carried the `sha256:` prefix, leaving the
hash algorithm unrecorded. `buildRunRecord` now enforces algorithm↔kind
consistency (`sha256` ⇒ `"sha256"`, non-hash refs ⇒ `null`). 105 node tests
passed at that point; the current count is recorded in the post-merge
fix-forward below.

### Post-merge Fable audit fix-forward

Fable's post-merge audit returned `POST-MERGE CLEAN / ACCEPTED WITH FOLLOW-UP`
and found two low-severity follow-ups. This fix-forward closes both current
items: roadmap/summary test counts now report 107 node tests, and
`isPriceFresh` rejects non-finite clocks/TTLs so JSON-parsed `1e309` cannot make
metadata fresh forever. The remaining profile-level TTL clamp belongs with the
future orchestrator that combines provider metadata with profile policy.

## 2026-07-05 — Stage 3C thin-dispatch-orchestrator implementation

Scope: `dispatch/lib/orchestrate.mjs`, `tests/dispatch-orchestrate.test.mjs`,
`tools/smoke/dispatch-smoke.mjs`, docs. Public-safe summary; no raw transcripts
or provider payloads.

Delivered one dispatch cycle over the Stage 3B policy core with every effect
injected (adapter, gate runner, clock, seed): a strict request boundary schema
(canonical providers only; claims/evidence must be refs/hashes), profile
usability + input-class checks, classification with floors and fail-closed
non-TTY escalation (TUI escalation is surfaced, not resolved), N3 panel
precedence with recorded truncation, pre-launch spend/eligibility enforcement
(no adapter call once required successes are already unmeetable), boundary
validation of every role envelope — including a vetted-spec identity match so
an adapter cannot substitute an unapproved provider/model — before the judge,
a blinded advisory judge (identity-stripped A/B/C projection; seed-derived
permutation; the judge never sees seed/permutation and never decides the gate;
judge-in-panel degradations recorded), cap enforcement over recorded usage
(unknown actual cost under a numeric metered cap fails closed), objective gates
restricted to exit-status/deterministic-checker sources, structural public-safe
run records for every post-panel outcome, and a recursion fence (depth exactly
one). Deterministic: same seed/input ⇒ identical permutation and byte-identical
records (the mock smoke proves it). 138 node tests pass (31 orchestrator tests,
including the four review fixes below).

Deferred-item disposition:

| Item | Prior status | Now |
| --- | --- | --- |
| Profile-level price-TTL clamp | Deferred by the post-merge fix-forward above to "the future orchestrator" | Implemented as `clampPriceToProfile` in `orchestrate.mjs`: effective TTL = min(metadata `ttl_seconds`, profile `price_ttl_seconds`); only ever tightens; regression-tested against an over-long metadata TTL. |

Not in this slice (recorded, not silent): the synthesis stage, real provider
adapters, any live/paid model call, the live OpenRouter `:free` smoke (still
behind `tools/smoke/nospend-preflight.mjs`), TUI spend-confirmation flows,
parallel candidate launch, and multi-iteration loops. One recorded divergence
from the Stage 3B fixture shape (detail in
`docs/stage3/dispatch-orchestrator.md`): the orchestrator stops before any
launch when pre-launch refusals already make `required_successes` unmeetable —
stricter and spend-safer than fixture 4's refused-plus-launched panel.

### Second-provider review fixes (cost-policy + public-safety hardening)

A second-provider review of the Stage 3C orchestrator found four real defects
against the accepted spec; all four were reproduced and fixed with regressions
in the same change. Test count after fixes: 138 node tests.

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| F1 | High | Cap enforcement (`evaluateCaps`) was cost-class-blind, so under a spend-allowed profile an envelope reporting `cost_class`/`price_status` `unknown` with a zero actual returned `ok`. SoT: spec §"Provider And Cost Policy" ("records `price_status: unknown` and refuses") and success metric "unknown cost/policy fails closed". | `evaluateCaps` now fails closed (`unknown-cost-policy`) when any launched/judge envelope reports `unknown` `cost_class`, `price_status`, or `cost_basis`, before token/USD checks. |
| F2 | High | The classifier interpolated user-controlled request text (`signals`, `class_hint`, override class) into `warning_codes`, which the orchestrator persisted verbatim into the public-safe record; the leak scan does not catch arbitrary text. SoT: spec §"Public-Safe Logging" (structural codes only). | `classify.mjs` emits bare stable codes (`unknown-floor-signal`, `unknown-class-hint`, `unknown-override-class`, `override-rejected-not-raising`); no request text reaches a persisted record. |
| F3 | Medium | The USD metered cap treated every `cost_actual_usd: null` as `usd-spend-unverifiable`, so subscription providers (Codex/Copilot) whose null actual is correct failed closed under `personal`. SoT: spec §"Provider And Cost Policy" ("USD cap counts only metered spend; subscription consumption is not converted to dollars"). | The USD cap now counts only metered spend (`cost_basis: "metered"`/`cost_class: "paid"`); subscription/free envelopes are excluded from the null→unverifiable rule and the USD sum. The token cap still binds over all envelopes. |
| F4 | Medium | `clampPriceToProfile` ran `Math.min(Infinity, price_ttl_seconds)`, sanitizing a non-finite metadata TTL (e.g. JSON `1e309` → `Infinity`) into a fresh finite value and defeating the PR #14 `isPriceFresh` finite-TTL guard. SoT: Stage 3B cost policy (`isPriceFresh` requires a finite non-negative TTL). | The clamp now only tightens a **finite** metadata TTL; a non-finite TTL passes through unchanged so `isPriceFresh` fails it closed. |

## 2026-07-06 — Stage 3D synthesis stage + preflight-gated no-spend adapter

Scope: `dispatch/lib/synthesis.mjs`, synthesis stage in
`dispatch/lib/orchestrate.mjs`, `tools/smoke/openrouter-free-dispatch-smoke.sh`,
`tools/smoke/fixtures/openrouter-free-candidate.json`, `tools/smoke/dispatch-smoke.mjs`,
`tests/dispatch-synthesis.test.mjs`, `tests/dispatch-nospend-preflight.test.mjs`,
docs. Public-safe summary; no raw transcripts or provider payloads.

Delivered the synthesis stage (spec §"Roles"/§"Judge-Bias Mitigations"): it runs
after the candidate panel and the advisory judge and before the objective gate,
only on `synthesizer` routes (`architecture`, `security`,
`roadmap-reconciliation`). The synthesizer is injected (`adapter.runSynthesis`),
consumes candidates and the judge output as an identity/cost-stripped role-output
projection — provider-bound, carrying substantive model text, NOT a public-safe
record artifact (see S2 below) — returns a validated
`stage: "synthesis"`/`role: "synthesizer"` envelope matched to the vetted spec,
and passes the same no-spend/eligibility policy as a candidate. Contradiction
preservation is mechanical: `detectContradictions` collects the markers the
candidates flagged and `contradictionsDropped` fails the run closed
(`synthesis-dropped-contradiction`) if the synthesis output averages any away; a
preserved contradiction records `contradiction-preserved`. The judge stays
advisory and the objective gate still decides success. No synthesis-envelope
substance enters the public run record (structural rollups/refs/warning codes
only). 158 node tests pass (+20 over Stage 3C: 14 synthesis, 6 preflight/wrapper).

First real no-spend adapter smoke: `tools/smoke/openrouter-free-dispatch-smoke.sh`
runs the mechanical preflight (`nospend-preflight.mjs`) **first** and only reaches
the live Pi OpenRouter `:free` call if the candidate is proven spend-safe. It
reads no credentials (Pi auth via existing login/session) and prints structural
output only.

Live smoke disposition: **SKIPPED (fail closed), not run.** The committed
candidate metadata carries a deliberately stale `verified_at` (`2026-01-01`), so
the preflight refuses it (`refused-price-stale`) and the wrapper stops before any
provider call. Proving a current zero price with a current source would require
reading credentials or making a paid/live call, both out of scope; obtaining it
is a maintainer step (refresh `verified_at` from current provider metadata). The
preflight/wrapper are fully implemented and tested against mock/synthetic
fixtures (positive + negative exit codes, and the wrapper refusing before any
provider call).

Design decision recorded: dropping an unresolved contradiction is treated as a
fail-closed synthesis-contract violation (`synthesis-dropped-contradiction`)
rather than a warning, because the spec requires the synthesizer to quote
contradictions rather than average them away, and the orchestrator has no
mechanical resolution signal before the objective gate. Contradiction markers are
detected from candidate `risks`/`open_questions`/`uncertainty` entries matching a
contradiction sentinel (matches the Stage 3B fixture-1 `contradicts-candidate-A`
shape).

### Second-provider review fixes (pre-launch cost projection + projection labeling)

A review of PR #16 found two real defects; both were reproduced and fixed with
regressions in the same PR. Test count after fixes: 168 node tests.

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| S1 | High | `providerPolicyRefusal` only projected price when `profile.requires_free_verified` was true, so under `personal`/`lockdown` a metered candidate/judge/synthesizer with no price metadata could reach the adapter and return `ok`. SoT: spec §"Dispatch Policy" ("Every dispatch projects cost and token exposure before launch. Unknown price, unknown provider policy, ... or stale price verification fails closed"). | New `evaluateCostProjection` (cost-policy.mjs) runs the pre-launch projection for spend-allowed profiles: `mock` is free, subscription providers are token-bounded (no per-call USD), metered providers require fresh, sourced, verified price or fail closed (`cost-projection-refusal:<code>`). Applied to candidates AND the judge/synthesizer specs **before any candidate adapter call**, so a doomed downstream spec launches nothing. |
| S2 | Medium | `projectForSynthesis` was documented/named as a "public-safe structural summary", but it forwards free-form role-output fields (recommendation/risks/etc.). | Relabeled everywhere (module/docstring/orchestrator comment/docs/README/PR body) as an **identity/cost-stripped, provider-bound role-output projection** — it may contain substantive model text governed by profile/input/provider policy, and is **not** a public-safe record artifact. The public-safe guarantee remains on the run record, which persists none of that text (unchanged, still tested). |

Design note (S1): `openai-codex` is projectable pre-launch without per-call price
— the spec says subscription consumption is token-bounded and "not converted to
dollars". **Correction (superseded by S3 below):** an earlier version of this note
said Copilot model-pin verification was a separate follow-up. That was wrong — the
spec requires it, so S3 folds the Copilot pin gate into the pre-launch provider
policy in this same PR.

### Third-provider review fix (S3): github-copilot pinned-model gate

A further review found that `evaluateCostProjection` accepted `github-copilot` as
a generic subscription provider, bypassing the required pinned-model gate.

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| S3 | High | Under `personal`, a `github-copilot` candidate/judge/synthesizer with no Copilot pin returned `ok` and called the adapter. SoT: spec §"Provider And Cost Policy" ("Personal-profile Copilot tests require a pinned config entry ... If the pin is stale or absent, Copilot dispatch stops"). | `evaluateCostProjection` no longer treats `github-copilot` as generic `ok-subscription` — it defers to the dispatcher (`refused-copilot-pin`). New `profiles.mjs` `evaluateCopilotPin(profile, model, now)` requires a structurally-valid, fresh pin (via `isCopilotPinUsable` + `copilot_pin_ttl_seconds`) whose `model` matches exactly; the orchestrator's `providerPolicyRefusal` runs it for **candidate, judge, and synthesizer before any adapter call**. Missing/stale/malformed/non-matching pin fails closed (`cost-projection-refusal:refused-copilot-pin`); `openai-codex` stays token-bounded without a pin. |

Test count after S1–S3 fixes: 176 node tests. Regressions prove adapter calls
stay 0 for a Copilot candidate/judge/synthesizer with absent/stale/non-matching
pins, plus positive tests for a fresh matching pin, plus `evaluateCopilotPin`
units (fresh/absent/stale/malformed/non-matching).

### Fourth-provider review fix (S4): Copilot pin TTL must respect the profile ceiling

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| S4 | High | `isCopilotPinUsable` used the pin's own `ttl_seconds` when present, so a stale pin with a huge `ttl_seconds` (e.g. `1_000_000_000`, verified long ago) was accepted even though the profile `copilot_pin_ttl_seconds` (604800) had lapsed. SoT: spec §"Provider And Cost Policy" — the profile-carried `copilot_pin_ttl_seconds` is the freshness policy; stale pins fail closed. | `isCopilotPinUsable` now treats the profile `copilot_pin_ttl_seconds` as a mandatory ceiling: the effective TTL is the stricter finite value of the pin's own TTL and the policy (the pin may tighten, never loosen), and a missing/non-finite policy fails closed rather than silently extending freshness. Same tightening-only shape as the F4 price-TTL clamp. |

Test count after S1–S4 fixes: 179 node tests. Added: a `profiles` unit proving an
overlong pin TTL cannot extend beyond `copilot_pin_ttl_seconds` (and one proving a
missing/non-finite policy fails closed), and orchestrator regressions proving an
overlong stale Copilot pin fails closed before any adapter call for candidate,
judge, and synthesizer.

## 2026-07-07 — Stage 3E verification stage

Scope: `dispatch/lib/verification.mjs`, verification stage in
`dispatch/lib/orchestrate.mjs`, `tests/dispatch-verification.test.mjs`,
`tools/smoke/dispatch-smoke.mjs`, docs. Public-safe summary; no raw transcripts or
provider payloads.

Delivered the verifier role (spec §"Roles"/§"Failure Behavior"): it runs after the
objective/advisory gate result is captured, only on `verifier` routes
(`pr-preflight`), and summarizes proof but NEVER determines the recorded gate
result — gate outcomes still come only from process exit status or a deterministic
checker. The verifier is injected (`adapter.runVerifier`) and receives a purely
structural, public-safe proof summary (`projectForVerification`: exit status, gate
command names / kind / result / source, cap status, warning codes, and
claims/evidence refs — no model narrative or provider payloads). Its envelope is
validated as `stage: "verification"` / `role: "verifier"` and matched to the vetted
spec; missing config/hook, malformed/mismatched envelope, and an ineligible
verifier provider fail closed. The verifier's content is advisory only: a positive
verifier cannot turn a failed gate into success, and a negative verifier (status
`blocked`, recommendation "reject") cannot turn a passed gate into failure — the
recorded `gate` and `exit_status` come from the gate alone. The verifier's usage is
folded into the caps/rollups (with a post-gate cap re-check for its own usage), but
none of its narrative is persisted — only its stable status enum is returned in the
result, never written to the record. The gate control flow was refactored so the
gate result is captured (not early-returned) and the verifier runs on both pass and
fail gates. 190 node tests pass (+11).

Design decisions recorded:

- **No new run-record field.** Following the synthesis precedent, the verifier is
  recorded structurally via `role_ids`/`provider_ids`/`model_ids`/usage rollups; no
  free-form verifier metadata is persisted (the persisted shape is unchanged). The
  verifier's advisory status is returned in the result object only.
- **Verifier runs even on a blocked gate** (it summarizes the failed proof), which
  is why the gate no longer early-returns on fail. A structural verifier failure
  (missing/malformed) fails the run closed regardless of the gate result (spec
  Failure Behavior: "a role output does not validate against the envelope").

Not in this slice (recorded, not silent): the `documenter` verification role, real
non-mock verifier adapters, any paid/live call, parallel dispatch, and
multi-iteration/autonomous loops. The live OpenRouter `:free` smoke remains
preflight-gated and was not run (unchanged from Stage 3D).

## 2026-07-07 — Stage 3F thin parallel / multi-team dispatch

Scope: `dispatch/lib/parallel.mjs`, parallel launch + cross-family advisory in
`dispatch/lib/orchestrate.mjs`, `dispatch/lib/providers.mjs` (`providerFamily`),
`tests/dispatch-parallel.test.mjs`, `tools/smoke/dispatch-smoke.mjs`, docs.
Public-safe summary; no raw transcripts or provider payloads.

Subagent-pattern finding (recorded): the Pi `examples/extensions/subagent` extension
IS installed at `@earendil-works/pi-coding-agent/examples/extensions/subagent`. It
runs parallel tasks via `mapWithConcurrencyLimit(items, concurrency, fn)` — a fixed
pool of `min(concurrency, n)` workers that pull the next index off a shared counter
and collect results in INPUT order (`MAX_PARALLEL_TASKS = 8`, `MAX_CONCURRENCY = 4`),
spawning isolated `pi` subprocesses. Prime does NOT spawn subprocesses (a live /
tooling concern out of scope); it reproduces only the pure concurrency-limiter shape
in `dispatch/lib/parallel.mjs`, over injected adapters, dependency-free.

Delivered opt-in bounded-parallel candidate launch: `deps.parallel = {
max_concurrency, token_budget }` enables it; absent means sequential (the Stage
3C–3E behavior, byte-for-byte unchanged — proven by the existing suite). The
concurrency cap bounds in-flight `runCandidate` calls; an invalid cap fails closed
(`invalid-concurrency-cap`). The per-run token budget is the stricter finite value
of `deps.parallel.token_budget` and the profile `token_cap`; an unbounded budget
fails closed (`unbounded-parallel-budget`) pre-launch, and total tokens over budget
fail closed (`token-budget-exceeded`) post-launch. Parallel results are processed in
candidate-index order, so completion order never changes outcomes/records/warnings
(same-config parallel runs are byte-identical — the smoke's parallel record is
byte-identical across runs, the three prior smoke records are unchanged; parallel
yields the same candidate outcomes as sequential). All existing gates are preserved
(cost projection, envelope validation, `min_successes`, caps, judge/verifier
advisory, synthesis contradiction preservation, objective gate final); a failed
parallel candidate is isolated at its index and still counts against
`min_successes`. 203 node tests pass (+13).

Lean multi-team piece: a cross-family **advisory** only. `providerFamily` maps
canonical providers to model families; on `requires_cross_family` routes
(`architecture`, `security`) a single-family launched panel records the stable
`cross-family-not-satisfied` warning — never a blocker, so an all-`mock` panel warns
but still succeeds. The default team shape is the route's role panel (no cosmetic
aliases in logs/tests). The **iterating multi-team / adversarial debate** (with
convergence + iteration budget) is deliberately deferred to the next slice, not
stubbed as done. Parallelism is confined to candidate launch; judge/synthesis/
verifier remain single sequential calls.

Design decision recorded: parallelism is a runtime effect, so it is opt-in via
`deps.parallel` (not a request-schema field) — this keeps the persisted request
shape stable and existing callers unchanged. The token budget lives at the dispatch
layer (`deps`) rather than only the profile, so a no-spend-test parallel run can be
bounded even though `no-spend-test.token_cap` is null.

Not in this slice (recorded, not silent): real subprocess/subagent fan-out, parallel
judge/synthesis/verifier stages, a chain registry, the iterating adversarial loop,
any paid/live call, the hosted `openrouter/fusion` adapter, and UI. The live
OpenRouter `:free` smoke remains preflight-gated and was not run.

### Second-provider review fix (record the effective token cap)

A review of PR #18 found one real defect; fixed with regressions in the same PR.
Test count after fix: 203 node tests.

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| P1 | Medium | The parallel per-run token budget was enforced but not recorded: `finish().cap_status.token_cap` reported only `profile.caps.token_cap`, so a no-spend-test parallel run (profile `token_cap` null, finite `deps.parallel.token_budget`) recorded `cap_status.token_cap: null` even though a finite budget governed and was enforced. | `cap_status.token_cap` now records the EFFECTIVE cap that governed the run: `parallelBudget ?? profile.caps.token_cap ?? null` — the parallel budget (already the stricter of the deps budget and the profile cap) when parallel is enabled, else the profile cap (sequential unchanged). `evaluateCaps` fail-closed behavior is untouched. Regressions: profile-cap-null + finite deps budget → record shows the deps budget; over-budget fail-closed → record shows the effective finite cap (not null); profile cap stricter than deps budget → record shows the stricter profile cap; sequential records the profile cap unchanged. |

Test-integrity note (P1): the earlier "parallel record byte-identical to sequential"
assertion was corrected rather than preserved — it was only ever true because the
runtime cap was hidden. Determinism is now proven by same-config parallel-vs-parallel
byte-identity plus identical candidate ordering versus sequential; the smoke's
parallel record hash changed (it now carries the effective `token_cap`), and the
three prior smoke records are unchanged.

### Third-provider review fix (verifier proof input carries the effective cap)

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| P2 | Medium | P1 corrected the run record, but the **verifier proof input** (`projectForVerification`'s `cap_status`) still passed `profile.caps.token_cap`. On a `pr-preflight` parallel run (profile `token_cap` null, finite `deps.parallel.token_budget`), `runVerifier` saw `token_cap: null` even though a finite budget was enforced — the final record was correct, the verifier input stale. | The verifier input's `cap_status.token_cap` now uses the same effective semantics as the record: `parallelBudget ?? profile.caps.token_cap ?? null`. Verifier advisory behavior is unchanged (it still cannot alter the gate). Regressions (in `tests/dispatch-verification.test.mjs`): a `pr-preflight` parallel run with profile cap null + `token_budget:100` → both the captured verifier input and the final record show `token_cap:100`; a stricter profile cap (500 < deps budget 1000) → both show `500`. |

Test count after P2: 205 node tests (+2). The smoke is unchanged (its parallel
scenario is a `risky-change` route with no verifier).

## 2026-07-07 — Stage 3G iterating multi-team / adversarial debate loop

Scope: `dispatch/lib/debate.mjs`, `tests/dispatch-debate.test.mjs`, a 5th
deterministic scenario in `tools/smoke/dispatch-smoke.mjs`,
`docs/stage3/iterating-debate.md`, and the README/ROADMAP/summary/orchestrator/
parallel doc updates. Public-safe summary; no raw transcripts or provider payloads.

Delivered the smallest complete substrate for long-lived, gate-seeking work: a
bounded iterating / adversarial debate loop (`runDebate`) where **one iteration is
exactly the Stage 3B–3F dispatch cycle** and the loop **composes** `runDispatch`
rather than duplicating any policy. Dependencies flow inward — `debate.mjs` imports
`runDispatch` and the public-safe record helpers; `orchestrate.mjs` imports nothing
from the debate layer, so a dispatch can never start a debate and the per-cycle
recursion fence (`depth === 1`) is untouched. The loop repeats only for routes that
call for adversarial iteration (a `redteam`/`judge`/`synthesizer` role, unless
`task.override.disable_adversarial`); non-adversarial routes are single-pass.

**Convergence is exactly diff-stability + objective-gate-pass.** The only signals
are (a) an objective gate result of `pass` from exit status / a deterministic
checker, captured in the run record, and (b) an injected deterministic
diff-stability checker (a boundary effect, like `runGate`). Model consensus, judge
approval, verifier approval, and synthesis confidence are never final authority — an
advisory gate never converges, and the Stage 3E verifier still cannot rescue a
failed gate or block a passed one (both tested). Hard caps are mandatory and fail
closed **before** any iteration: a missing/unbounded `max_iterations` or aggregate
`token_budget` refuses the debate; the aggregate token budget is a hard rail across
iterations that wins over convergence (`token-budget-exceeded`); an unavailable,
invalid, or non-deterministic diff checker fails closed; a hard fail-closed
iteration is a refusal that is never retried; and a gate that never passes before
`max_iterations` fails closed (`not-converged-within-max-iterations`). Iteration
summaries are structural-only (iteration number, gate result/source, diff
result/code, cap status, warning codes, run refs); no model narrative enters the
public debate summary, which is re-scanned with the run-record public-safety
mechanism before it is persisted to the gitignored records dir. Deterministic under
mock adapters: a fixed seed/input yields byte-identical per-iteration records and a
byte-identical debate summary. 233 node tests pass (+28).

Design decisions recorded:

- **Convergence delegates diff-stability to an injected deterministic checker**, the
  same boundary-effect pattern as `runGate` (objective gates) — never a model. The
  checker's determinism is actively probed (called twice per iteration; a differing
  result fails closed `non-deterministic-diff-checker`), because the loop's
  determinism guarantee depends on it. Its `code` is a stable structural marker (like
  a gate command name) and is leak-scanned in the summary, not a model narrative.
- **The aggregate token budget is a distinct, stricter rail than each cycle's own
  per-run cap.** It is checked after each iteration and, when crossed, fails closed
  even if that iteration would otherwise have converged — the cap wins over
  convergence (regression-tested). This preserves the fail-closed cost posture end to
  end.
- **Mock-slice honesty.** In this slice the proposal-evolution and diff signals are
  injected deterministic effects (like `runGate`), which is the honest way to test
  the loop mechanics (caps, convergence, fail-closed, determinism) with no live
  model calls. Real proposal revision + a real working-tree diff are explicitly
  deferred to a future slice with real adapters, not stubbed as done.

Not in this slice (recorded, not silent): real proposal revision + a real
working-tree diff, the `/adversarial off` default-on surface, real subprocess /
subagent fan-out, parallel judge/synthesis/verifier stages, a chain registry, the
hosted `openrouter/fusion` adapter, any paid/live model call, and UI. No live
provider call was made and no credentials were read. The live OpenRouter `:free`
smoke remains preflight-gated and was not run (unchanged from Stage 3D–3F).

### Review fixes (PR #19)

A review of the Stage 3G debate loop found three real defects; all three were
reproduced and fixed with regressions in the same PR. Test count after fixes: 233
node tests (+5 over the initial 228).

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| G1 | High | A hard fail-closed iteration discarded real usage/cap evidence: the `result.status === "fail-closed"` branch returned **before** appending the cycle's run record, so a cycle that launched candidates and then tripped a per-cycle token cap (valid record, `tokens_used > 0`) reported `iterations_run:0`, `total_tokens:0`, `summary:null` despite the adapter calls. | The fail-closed branch now appends a structural iteration summary when the cycle returned a **valid** run record (`diff_result:"not-run"`, `diff_code:"iteration-fail-closed"`), counts its tokens into `total_tokens`, and preserves `cap_status`/`warning_codes` — before stopping, still never retried. A fail-closed with **no** valid record (a pre-panel stop) returns the documented `iteration-fail-closed-no-record`. Regressions cover a token-cap tripped after launch (tokens preserved) and an adapter/min-success failure with a valid record. A shared `buildIterationSummary` helper backs both the normal and fail-closed paths. |
| G2 | Medium | `evaluateDiffStability` accepted any non-empty string as the diff `code`, so free-form prose (e.g. a client narrative) persisted into `summary.iterations[].diff_code`. | The diff `code` is now validated as a structural token (`DIFF_CODE_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/`); a prose/free-text code fails closed as `diff-checker-invalid` **before** summary persistence, independent of the leak scan. Regressions: a prose code is rejected even though it matches no public-safety regex; a structurally-valid-but-secret-shaped code still trips the summary public-safety scan (`public-safety-violation`); and a direct `writeDebateSummary` attribution-leak test retains a split fixture phrase so broad scanners do not self-match. |
| G3 | Low | `runDebate(null)` / `runDebate(undefined)` threw a `TypeError` (the terminal-result builder dereferenced `request.run_id` on a non-object). | A top-of-function guard returns a well-formed `invalid-debate-request` fail-closed result for any non-object request without dereferencing it. Regressions cover `null` and `undefined`. |

## 2026-07-07 — Stage 3H real revision / diff surface

Scope: `dispatch/lib/git-diff-surface.mjs`, `dispatch/lib/adversarial-policy.mjs`,
the injected `revise` boundary + default-on policy wiring in
`dispatch/lib/debate.mjs`, `tests/dispatch-git-diff-surface.test.mjs`,
`tests/dispatch-adversarial-policy.test.mjs`, +7 in
`tests/dispatch-debate.test.mjs`, `docs/stage3/real-revision-diff-surface.md`, and
the README/ROADMAP/summary/iterating-debate doc updates. Public-safe summary; no raw
transcripts, provider payloads, or raw diff text.

Wired the Stage 3G iterating debate loop to **real local signals** while keeping the
debate core pure — all git/worktree side effects live in injected boundary effects
(the dispatch core imports nothing new; `debate.mjs` imports neither git nor the
filesystem-mutating revision, only the pure `adversarial-policy.mjs`).

- **Real working-tree diff stability** (`git-diff-surface.mjs`).
  `computeDiffFingerprint` builds a structural `sha256` fingerprint of the current
  git diff vs a baseline commit via deterministic plumbing (`status --porcelain=v1
  -z -uall` + `diff --numstat` + a hashed `diff` patch + per-untracked-file content
  hashes). The returned surface carries **only** hashes, integer counts, and a
  resolved baseline commit ref — never raw diff/patch text (regression: a sentinel
  in a modified file never appears in the serialized surface, and `assertPublicSafe`
  passes). The default runner pins a clean, config-independent git environment (no
  global/system gitconfig bleed, no home-config read). Determinism is enforced at
  the boundary (the snapshot is taken twice; a mismatch fails
  `diff-nondeterministic`). Fail-closed matrix, all regression-tested over temp git
  repos or a process-boundary mock: `not-a-git-repo`, `missing-baseline`,
  `index-ambiguous` (unmerged), `git-command-failed`, `unsafe-path` /
  `unsafe-baseline-ref` (arg-injection guard), `diff-read-failed`,
  `diff-nondeterministic`. `makeGitDiffStability` is a drop-in `diffStability`
  boundary effect that memoizes per `run_id` (so the loop's determinism double-probe
  is idempotent) and reports `diff-baseline` / `diff-changing` / `diff-stable`.

- **Real proposal-revision boundary** (`debate.mjs`). `runDebate` gains an optional
  injected `revise(revisionState, ctx)` effect that runs between non-converged
  adversarial iterations to produce the next proposal in the worktree — the only
  thing allowed to mutate it — and is skipped on the final iteration. Revision state
  threads as refs/hashes only (`revision_ref`, validated against `REF_PATTERN`),
  never free text. A failed revision (`ok !== true`, a thrown effect) fails closed
  `revision-failed`, a non-ref result fails `revision-invalid`, and a
  present-but-non-function effect fails `invalid-revision-effect` before iterating —
  all while **preserving the iteration evidence already produced** (regression: a
  revision that refuses on the 2nd call keeps `iterations_run:2` and the first
  revision's ref). Absent ⇒ Stage 3G behavior byte-for-byte (no `revisions` key is
  added to the summary; regression-tested). The boundary is exercised with a **local
  deterministic** revision effect over a real temp git repo (baseline → changing →
  stable convergence), never a fake model adapter.

- **Default-on adversarial policy** (`adversarial-policy.mjs`).
  `resolveAdversarialPolicy` makes meaningful work default-on (exactly the routes
  carrying an adversarial role: `architecture`, `security`, `risky-change`,
  `roadmap-reconciliation`, `pr-preflight`; a unit asserts `MEANINGFUL_WORK_CLASSES`
  tracks the role-based definition). The `/adversarial off` opt-out rides the
  existing `task.override.disable_adversarial` channel — **no new slash command**
  (the repo's extensions stay pinned to `prime-fence`/`prime-answer`, so
  `check:resources` still passes) — and is recorded as the stable `adversarial-opt-out`
  code (plus `single-pass-route`). The policy never widens a panel, so heavier 3+
  model / every-task runs stay explicit opt-in.

Objective gate remains final authority: convergence is still exactly diff-stability
+ objective-gate-pass, both deterministic checkers; the verifier stays advisory and
the aggregate token-budget rail still wins over convergence. 267 node tests pass
(+34: 17 git-diff-surface, 7 adversarial-policy, 10 debate). The dispatch smoke is
unchanged (still mock, deterministic, byte-identical).

Not in this slice (recorded, not silent): a **real model-backed revision effect** (a
builder→critic loop that actually revises the proposal — needs real non-mock
adapters), real provider fan-out, real subprocess/subagent fan-out, the hosted
`openrouter/fusion` adapter, the `documenter` role, the unattended autonomous loop
and its aggregate ceiling, and any UI beyond the policy surface. No live/paid call
was made and no credentials were read; the live OpenRouter `:free` smoke remains
preflight-gated and was not run.

### Review fixes (PR #20)

A review of the Stage 3H slice found two real defects; both were reproduced with
failing regressions (which fail on the pre-fix `a91720d` source and pass on the fix)
and fixed in the same follow-up. Test count after fixes: 265 node tests (+5 over the
initial 260).

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| H1 | High | `computeDiffFingerprint` hashed untracked files via `readFileSync(join(cwd, rel))`, which **follows symlinks** — an untracked symlink pointing outside the work tree made the surface read bytes outside the repo (a credential/exfiltration vector), contradicting "no credential reads / working-tree diff only". A temp repo with an untracked symlink to `../credential.txt` returned `ok:true`, and changing only the external target changed the fingerprint (proving the target was read). SoT: Stage 3H prompt + docs (structural/public-safe, working-tree diff only). | Untracked entries are now folded in by `lstat` **metadata only** (path + size + mode): a symlink fails closed (`unsafe-untracked-symlink`, never followed), a non-regular entry fails closed (`unsafe-untracked-nonfile`), a regular file whose realpath escapes the tree fails closed (`unsafe-untracked-path`), and **content is never read** — so a sensitive untracked `.env`/`auth.json` is never read either. The metadata fingerprint is a pure function of `(path, size, mode)` (proven by a same-size/same-mode content-swap regression that leaves the fingerprint unchanged); tracked changes stay content-hashed via `git diff`, and the objective gate remains the final authority so a metadata-only signal can never falsely converge. Regressions: untracked symlink refused + target never read + changing the target can't change the outcome; untracked directory refused; `.env`/`auth.json` content-independence. **[SUPERSEDED by H2 (round 2) below — the metadata-only approach was itself wrong: it made a same-size untracked content edit invisible, a FALSE `diff-stable`. Untracked handling is now fail-closed-by-default with opt-in content hashing; the false claim "a metadata-only signal can never falsely converge" is retracted.]** |

### Review fixes (PR #20, round 2)

A second review found that the H1 metadata-only untracked handling introduced a
**High false-convergence** defect. Reproduced with a failing regression (fails on the
round-1 `1ac2669` source, passes on this fix) and fixed in this follow-up. Test count
after fixes: 267 node tests (+2 over round 1's 265).

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| H2 | High | The H1 fix fingerprinted untracked regular files by `path + size + mode` only, so a **same-size content change was invisible** — `makeGitDiffStability` reported `diff-stable` on a still-changing proposal. Repro: an untracked `proposal.txt` changed `"AAAA"` → `"BBBB"` (same size) kept the same fingerprint, and `runDebate` returned `converged:true` with `diff_codes:["diff-baseline","diff-stable"]`. Convergence is exactly diff-stability + objective-gate-pass, both of which must be TRUE; a metadata-only untracked signal is not diff stability for untracked content, and the objective gate does not make an incorrect diff signal acceptable. SoT: Stage 3H (real working-tree diff-stability). | Untracked handling is now **fail-closed by default with opt-in content hashing**: symlink/non-regular/outside-tree refusals are kept (no symlink following reintroduced); by default any untracked regular file fails closed (`untracked-content-refused`, no content read); a caller may pass `untracked_policy: { allow: [repo-relative paths] }` to opt **safe/public/synthetic** files into **content hashing** (restoring real diff stability incl. same-size edits); and a credential/private-shaped path (`.env*`, `auth.json`, `*.pem`/`*.key`, `id_rsa*`, `*secret*`/`*token*`/`*credential*`, …) is refused even if allowlisted (`unsafe-untracked-sensitive`, denylist wins — never content-read). Regressions: `computeDiffFingerprint` produces different fingerprints for a same-size content change in an allowlisted untracked file; `runDebate` with a same-size untracked content churn does not converge as `diff-stable` (iterates until content actually stabilizes); untracked files fail closed by default; credential-shaped names (`.env`, `auth.json`, `id_rsa`, `*.pem`, `*secret*`) fail closed and are never content-read; the round-1 symlink/outside-read and revision-detail-leak regressions remain green. The earlier `.env`/`auth.json` "content-independence" regression (which asserted the bug as desired) was corrected to assert fail-closed. |
| M1 | Medium | Revision failures leaked free-form text through the returned `result.detail`: a thrown effect's message and an arbitrary `rev.code` were interpolated into `detail`. A `revise` throwing an `Error` whose message is an absolute home-directory-style path returned that path in `detail`; a `{ ok:false, code:"<free-form failure reason>" }` returned that free text — likely to be logged or copied into a PR. SoT: Stage 3H docs (revision state/evidence is refs/hashes only; Stage 3E fixed a similar returned-narrative leak). | The thrown message is never surfaced (`detail = "iteration N: revision effect failed"`); a `rev.code` is surfaced **only** if it matches the stable-code marker (`DIFF_CODE_PATTERN`), as `revision-subcode:<code>`, else dropped. `revision_ref` validation (refs/hashes only) is unchanged. Regressions prove a private path / free-form code appears in none of `result.detail`, `result.summary`, the persisted summary, or `result.warnings`; a well-formed stable subcode still surfaces. |

## 2026-07-07 — Stage 3I real model-backed revision effect

Scope: `dispatch/lib/revision-effect.mjs`, the shared `dispatch/lib/provider-policy.mjs`
extracted from `dispatch/lib/orchestrate.mjs`, `tests/dispatch-revision-effect.test.mjs`,
`tools/smoke/revision-effect-smoke.mjs`, `docs/stage3/model-backed-revision.md`, and the
README/ROADMAP/summary + Stage 3H doc updates. Public-safe summary; no raw transcripts,
provider payloads, raw diff text, or private paths.

Turned the Stage 3H injected `revise` boundary into a real, provider-policed,
model-backed effect while keeping `debate.mjs` **unchanged** and policy-pure — the
worktree/model side effects live only inside the injected boundary effect, so
dependencies still flow inward and the dispatch core imports nothing new.

- **`makeModelRevision(config, deps)`** (`revision-effect.mjs`) builds a
  `revise(revisionState, ctx)` boundary effect — the same "build an injected effect
  from config" pattern as `makeGitDiffStability`. It is the **builder** half of the
  builder→critic loop; the **critic** half is the debate's reviewer/redteam panel and,
  decisively, the objective gate. A model producing a revision is never final authority,
  so there is deliberately no second convergence-gating critic call in the effect. Per
  call it: validates config + caps at the boundary (an unbounded/`Infinity`/missing cap
  fails closed `unbounded-revision-caps`); **projects provider/cost policy BEFORE any
  model call** through the shared gate (an ineligible/non-automated provider, an
  unknown/stale/unsourced price, or a missing/stale Copilot pin refuses before the
  adapter — call count 0); validates the model's structured edits and fails closed on
  malformed output without surfacing model text; applies edits **all-or-nothing** under
  the Stage 3H write rules (allowlist-only; credential/private-shaped paths refused even
  if allowlisted, denylist wins via the shared `isSensitiveUntrackedPath`; unsafe
  traversal/absolute/symlink/non-file/outside-tree paths refused; original target
  contents are restored if a later disk write fails); and returns only a
  structural `sha256` `revision_ref` + a stable code. A thrown adapter message, model
  narrative, or private path reaches none of `result.detail`, warnings, the summary, or a
  run record.
- **Shared pre-launch cost gate** (`provider-policy.mjs`). `clampPriceToProfile` and a new
  `projectProviderPolicy(spec, {profile, now})` were extracted verbatim from the
  orchestrator's inline `providerPolicyRefusal`, so the dispatcher and the revision effect
  refuse ineligible providers through ONE vetted copy (no drift; the "single mechanical
  gate" convention). The orchestrator re-exports `clampPriceToProfile` for its existing
  test import; behavior is unchanged (the full pre-existing suite stays green).
- **Real adapter boundary / no-live proof.** `deps.modelAdapter.runRevision(input, ctx)`
  is the real adapter boundary; a live OpenRouter `:free`/etc. adapter implements it and
  the module's pre-launch gate re-checks it regardless. This slice makes **no live/paid
  call** — the committed OpenRouter `:free` metadata is intentionally stale, so a live
  proof stays fail-closed. The effect is exercised end-to-end with a **deterministic
  in-process adapter over a real temp git repo** (a boundary test, not presented as a live
  proof); the exact maintainer preflight to run a live proof later is documented in
  `docs/stage3/model-backed-revision.md`.

Convergence is still **exactly** diff-stability + objective-gate-pass, both deterministic
checkers: a real temp-repo debate converges only after the real git diff surface reports
the model's proposal stopped changing AND the objective gate passes, with the worktree
actually holding the model's edits. 282 node tests pass (+15). Regressions cover:
cost/provider refusal before any model call (adapter call count 0) for an ineligible
provider, stale price, and a Copilot spec with no pin; unbounded caps; malformed
config/output (no model-text leak); too-many/too-large edits; unsafe/sensitive/
non-allowlisted write paths (nothing mutated); a refused symlinked target (external file
untouched); a disk write failure after an earlier write rolls back that earlier edit; a
valid revision that really writes the worktree and returns a non-canned
`sha256` ref; a thrown adapter that leaks no message; a full temp-repo debate converging
via a real revision; a cost-refused builder inside a debate (adapter untouched, worktree
unchanged, prior evidence preserved); a thrown-adapter debate that preserves prior
iteration evidence and leaks nothing; and byte-identical debate summaries across two runs
(determinism, independent of the temp commit hash). No credentials read; no network.

### PR #21 review fix — write-failure rollback

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| R1 | High | `revision-effect.mjs` validated the full write set before mutation, but applied writes sequentially with `writeFileSync`; if a later disk write failed, earlier writes remained on disk while the effect returned `revision-write-failed`, contradicting the all-or-nothing contract. | `applyWritesAllOrNothing` now snapshots original target contents before mutation and restores every touched target if any write fails. Regression: two allowlisted writes where the second target is read-only now return `revision-write-failed` while the first file is restored to its original contents and the failed target is preserved. |

Design decisions recorded:

- **`debate.mjs` untouched.** Stage 3H already shipped the `revise` boundary and its
  fail-closed threading; Stage 3I only supplies a real effect to inject, so the debate
  core stays pure and the existing debate suite is unchanged.
- **Extraction over duplication.** The pre-launch provider/cost projection is a
  load-bearing safety gate; replicating it inline in the revision effect would create a
  second, drift-prone source of truth. It was extracted into one shared function used by
  both launchers, matching the cost-policy module's "single mechanical gate" convention.
- **No in-effect critic call.** Because the objective gate is final authority and the
  debate panel already critiques every iteration, adding a second convergence-gating
  "critic" model call inside the revision effect would be redundant spend with no
  authority; the builder→critic loop is the composition (revise → panel critique → gate),
  not two calls inside the effect.

## 2026-07-07 — Stage 3J live OpenRouter `:free` builder adapter

Scope: `dispatch/lib/openrouter-revision-adapter.mjs`,
`tests/dispatch-openrouter-revision-adapter.test.mjs`,
`tools/smoke/openrouter-free-revision-smoke.mjs`,
`docs/stage3/live-builder-adapter.md`, and README/ROADMAP/summary + Stage 3I/3H
doc updates. Public-safe summary; no raw transcripts, provider payloads, raw
prompts/responses, raw diff text, credential-file contents, or private paths.

Delivered the first live `modelAdapter.runRevision` implementation for the Stage
3I `makeModelRevision` boundary. The adapter calls Pi's native OpenRouter provider
only for model ids ending in `:free`, with tools, sessions, context files, skills,
themes, prompt templates, and extensions disabled. It reads only caller-declared
synthetic/public fixture paths, refuses non-`:free` models and unsafe/sensitive
fixture paths before invoking Pi, bounds the full outbound prompt with
`max_input_bytes`, parses only JSON whole-file edits, and throws stable codes on
runner/parser failures so raw prompt/response/stderr text never reaches returned
or persisted artifacts. The Stage 3I effect remains the authoritative
provider/cost/write gate.

No-live tests cover strict and fenced JSON parsing; empty, non-JSON, malformed,
unallowlisted, traversal, and sensitive-path refusals; non-`:free` model refusal
before runner invocation; unsafe fixture-path refusal before runner invocation; an
injected runner happy path; and runner/parser failures exposing only stable codes.
The post-review oversized-prompt regression adds a 1 MiB allowlisted fixture and
proves `openrouter-revision-input-too-large` with adapter calls `0` and runner calls
`0`. 288 node tests pass (+6).

Live proof run on 2026-07-07:

| Gate | Result |
| --- | --- |
| Public OpenRouter metadata | `openai/gpt-oss-20b:free` prompt `0`, completion `0` |
| No-spend preflight | `SPEND-SAFE`, code `ok-free-verified` |
| Pi inventory | `openrouter openai/gpt-oss-20b:free` visible |
| Temp-repo debate | `ok`, converged in 3 iterations (`diff-baseline`, `diff-changing`, `diff-stable`) |
| Live builder calls | 2 revision calls through `makeModelRevision` |
| Worktree proof | Expected synthetic marker present on disk |

Not in this slice: paid/metered runs, private input, non-OpenRouter live revision
adapters, hosted `openrouter/fusion`, multi-model role matrix, agent-team defaults,
chain registry, subprocess fan-out, live pipeline UI, and autonomous loop.

### PR #22 review fixes — outbound prompt cap and credential wording

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| H1 | High | The live adapter read allowlisted fixture files wholesale into the outbound Pi/OpenRouter prompt before any prompt/input/token-exposure bound fired; `max_output_bytes` only bounded model output, and Stage 3I edit caps only bound returned edits. | Added adapter-side `max_input_bytes` (default `32768`) and stable refusal `openrouter-revision-input-too-large`. Prompt assembly now counts instruction, metadata, wrappers, and fixture bytes before `calls += 1` / `runPi`; oversized fixtures fail closed before runner invocation. Regression: a 1 MiB allowlisted `proposal.txt` with `max_input_bytes:1024` refuses with adapter calls `0` and runner calls `0`. |
| L1 | Low | Docs overclaimed credentials were not "used" even though the Pi process inherits the environment and may use existing authenticated provider state. | Narrowed wording: the adapter/smoke do not read credential files, print credentials, or persist credentials; Pi may use existing authenticated provider state/environment. |

## 2026-07-07 — Stage 3K lean agent-team defaults

Scope: `dispatch/lib/agent-team.mjs`, `dispatch/config/agent-team-defaults.json`,
`tests/dispatch-agent-team.test.mjs`, `docs/stage3/agent-team-defaults.md`,
`docs/stage3/agents/builder.md`, `docs/stage3/agents/reviewer.md`, and README/
ROADMAP/summary updates. Public-safe summary; no raw prompts, model responses,
provider payloads, private paths, credentials, or session links.

Delivered the first default agent-team artifact for the long-lived loop without
introducing a slash command, live call, subprocess fan-out, hosted adapter, or
per-role model matrix. The shipped default is intentionally lean and additive:
`Builder` plus `Reviewer`, with Reviewer declaring provider independence from
Builder; Stage 3L/M/N later enforces it against concrete provider/model specs.

`agent-team.mjs` validates stable canonical agent-team IDs (`Scout`, `Planner`,
`Builder`, `Reviewer`, `Documenter`, `RedTeam`) and explicitly bridges them to the
existing lowercase dispatch role IDs (`builder`, `reviewer`, `redteam`, etc.).
The validator fails closed on missing/unknown/duplicate canonical IDs, mismatched
canonical-to-dispatch mappings, dangling provider-independence references, and
non-additive defaults. The routing/log projection ignores display aliases entirely:
tests prove cosmetic callsigns can change display labels but cannot affect
`role_ids`, `dispatch_roles`, `log_roles`, provider-independence records, config
identity, routing, or public records.

296 node tests pass (+8). No live smoke was run for this slice because Stage 3K is
config/markdown validation only and makes no provider call.

## 2026-07-07 — Stage 3L/M/N role matrix, chain registry, bounded loop, and run manager

Scope: `dispatch/lib/role-matrix.mjs`, `dispatch/config/role-matrix-defaults.json`,
`dispatch/lib/chains.mjs`, `dispatch/config/chains.json`,
`dispatch/lib/run-configs.mjs`, `dispatch/config/run-configs.json`,
`dispatch/lib/task-loop.mjs`, `tools/loop/prime-task-loop.mjs`,
`dispatch/lib/run-manager.mjs`, `tools/runs/prime-runs.mjs`,
`tools/smoke/openrouter-free-multimodel-revision-smoke.mjs`,
`tools/worktree/prime-worktree.sh`, `tools/worktree/selftest.sh`,
`tests/dispatch-role-matrix.test.mjs`,
`tests/dispatch-chains-run-configs.test.mjs`,
`tests/dispatch-run-manager.test.mjs`, `docs/stage3/role-matrix-task-loop.md`,
README/ROADMAP/summary updates, and this ledger. Public-safe summary; no raw prompts,
model responses, provider payload logs, private run payloads, credentials, session
links, private paths, or provenance trailers.

Delivered the remaining no-live core loop surface without a new slash command or
hosted adapter:

- per-role `role -> [{ provider, model, effort, instances, price? }]` matrix
  validation/expansion, deterministic in route-role / entry / instance order;
- provider/cost projection during matrix expansion before launch, with call-count-0
  refusal coverage in the task-loop tests;
- named chains `implement-review-fix`, `scout-flow`, and `ship-pre-pr`, with
  malformed/unknown chain fail-closed behavior and no recursion field;
- named run config `mock-core-loop`, requiring no-live mode, finite caps, objective
  gate, write allowlist, and structural refs;
- profile cap enforcement for run configs: `max_iterations` and finite token caps
  fail closed before dispatch/revision adapters run when a config exceeds the
  resolved profile;
- bounded task-loop CLI over a synthetic temp repo by default, composing run config
  -> chain -> route -> role matrix -> `runDebate`;
- structural run list/status/prune tooling over gitignored JSON records only;
- worktree remove/merge hardening for dirty/current worktrees.

Live no-spend proof run on 2026-07-07:

| Gate | Result |
| --- | --- |
| Public OpenRouter metadata | prompt `0`, completion `0` for `openai/gpt-oss-20b:free` and `cohere/north-mini-code:free` |
| No-spend preflight | both candidates spend-safe via `nospend-preflight.mjs` |
| Pi inventory | both models visible under `openrouter` |
| Temp-repo debates | both converged through `makeModelRevision` + `makeGitDiffStability` |
| Live revision calls | 4 total (`2` per model) |
| Inputs | synthetic temp repos only |

The default candidate pool also showed current metadata/preflight/inventory for
`qwen/qwen3-coder:free` and `google/gemma-4-26b-a4b-it:free`; an earlier proof attempt
failed closed at `revision-failed` for those model behaviors, so they are available
candidates but not recorded as passing proof models.

Verification run in this slice:

- `npm test` — 317 node tests, worktree self-test 12, objective-gate-loop self-test 8.
- Focused no-live loop smoke:
  `node tools/loop/prime-task-loop.mjs --run-id loop-cli-smoke-focused` converged in 3
  iterations, total tokens 135, with the expected no-spend provider-independence warning.
- Structural run status:
  `node tools/runs/prime-runs.mjs status loop-cli-smoke-focused` listed 3 dispatch
  iteration records plus the debate summary.
- Live proof:
  `node tools/smoke/openrouter-free-multimodel-revision-smoke.mjs` passed for
  `openai/gpt-oss-20b:free` and `cohere/north-mini-code:free`.

Explicit deferrals: paid/metered live provider calls, hosted `openrouter/fusion`, broad
UI/live pipeline view, remote control, and autonomous/unattended mode. The autonomous
loop remains blocked on an aggregate session/daily ceiling plus a ratified hard
stop/resume contract; Stage 3N ships per-run caps and status/prune only.

Post-review fix on 2026-07-07:

- H1 objective-gate symlink follow is fixed in `dispatch/lib/task-loop.mjs`: gate file
  reads now lstat the final path, refuse symlinks/non-files/sensitive names, realpath
  the final file, prove it remains under the real worktree root, and only then read.
  Regression: an allowlisted `proposal.txt` symlink to an outside file containing the
  pass marker records `unsafe-gate-path`, the first objective gate stays failed, and
  the loop stops fail-closed at `revision-failed` / `revision-unsafe-path` before the
  outside target can count as objective evidence.
- Non-builder chains passed to the revision-backed task loop now fail closed as
  `chain-not-loop-runnable:<id>` instead of the misleading
  `matrix-missing-role:builder`.
- Inline profile objects remain trusted local config after `assertProfileUsable`;
  this is documented as the Stage 3L/M/N contract until a future external profile
  loader introduces semantic policy fields.
- `tools/loop/prime-task-loop.mjs` cleans default synthetic temp repos after the run
  and reports `records_replaced` when a reused run id replaces a prior structural run
  directory.

## 2026-07-07 — Post-merge PR #23 hardening

Scope: post-merge hardening after Fable's whole-repo audit of PR #23. Public-safe
summary; no credentials, transcripts, provider payloads, private run payloads, or
paid/metered provider calls.

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| P1 | High | Downstream stage validation happened after candidate launch: missing judge/synthesis/verifier config or adapter hooks failed closed only after candidate adapter calls had already run. | `runDispatch` now prevalidates all route-required singleton configs, adapter hooks, judge seed, and provider/cost eligibility before candidate launch. Existing stable codes are preserved (`missing-judge-config`, `adapter-missing-run-judge`, `missing-synthesis-config`, `adapter-missing-run-synthesis`, `missing-verification-config`, `adapter-missing-run-verifier`, `judge-not-eligible`, `synthesis-not-eligible`, `verifier-not-eligible`, `missing-judge-seed`). Regressions prove candidate calls stay `0` for the six reported missing downstream config/hook cases, and valid judge/synthesis/verifier routes still launch normally. |
| R1 | Low | `docs/resources/README.md` claimed the manifest exposed only `./skills/prime-ui` and `./themes`, omitting `./extensions/prime-fence.ts` and `./extensions/prime-answer.ts`. | Resource docs now list the exact skill, theme, and extension surface enforced by `npm run check:resources`. |
| R2 | Low | `extensions/prime-answer.ts` had no fake-Pi extension-level unit test, and its runtime `typebox` import made standalone unit loading impossible in this dependency-free resource package. | The extension now uses TypeBox-compatible JSON Schema descriptors with no runtime dependency. `tests/answer-extension.test.mjs` proves it registers tool `{ name: "answer" }` and its non-interactive execute path returns the deterministic top recommendation. |
| R3 | Low | Fable requested a no-paid/no-auth skill discoverability proof for `prime-ui`. | Pi 0.80.3 headless RPC `get_commands` was tested with a temporary Pi config, `PI_OFFLINE=1`, `PI_TELEMETRY=0`, `--offline`, `--approve`, and `--no-session`; it listed user-global skills but did not expose `skill:prime-ui` from the package or explicit `--skill` variants. Docs now state this limitation and do not claim headless `-p`/RPC model visibility for `prime-ui`. |
| R4 | Low | The roadmap/DoD described a CI gate, but no GitHub Actions workflow existed. | Added `.github/workflows/ci.yml` with the minimal gate requested for PRs and pushes to `main`: `npm test`, `npm run check:resources`, and `git diff --check`. Broader e2e/deny-egress CI remains tracked as future growth. |
| R5 | Low | Root-commit provenance trailer issue needed disposition. | Recorded as historical/pre-policy: do not rewrite repository history in this hardening PR. Current policy remains no unsolicited provenance trailers in new commits/PR bodies; local gates scan for them. |

Verification snapshot for this hardening branch: 322 node tests pass in the direct
node suite before shell self-tests; the full ship bundle is recorded in the PR
handoff. No live OpenRouter proof was rerun because the requested fixes are pure
policy/docs/tests/CI and live proof was unnecessary under the no-spend constraint.

## 2026-07-08 — Stage 3O PR1 `/prime` control surface

Scope: `extensions/prime-command.ts`, `extensions/lib/prime-command-core.mjs`,
package/settings/resource pins, `tests/prime-command-core.test.mjs`,
`tests/prime-command-extension.test.mjs`, README/resources/command-surface/
Stage 3 loop docs, roadmap/summary updates, and this ledger. Public-safe summary;
no raw prompts, model responses, provider payloads, auth files, transcripts,
private paths, live provider calls, or paid/metered calls.

Delivered the first Pi-native UX layer over the existing Stage 3 machinery:

- one extension slash command, `/prime`, with argument-completed verbs;
- `/prime` dashboard for default config, resolved profile/caps, chain, role
  matrix summary, no-live schema status, last structural run, dry-run warnings/
  refusals, and high-level package/resource status;
- `/prime run [config-id]` preflight that resolves config/profile/chain/route/
  matrix, expands through existing provider/cost policy, shows objective gate,
  write allowlist and caps, and prints the exact existing task-loop CLI command
  without launching it;
- `/prime runs list|status <run-id>|prune <run-id>` over existing run-manager
  structural paths, with prune as the only mutation;
- `/prime models`, `/prime chains`, and `/prime profiles` as view-only browsers.

Guardrails: prune requires `ctx.mode === "tui"` plus explicit confirmation;
`rpc`, `json`, and `print` fail closed as `prime-prune-requires-tui-confirm`, and
false/absent confirmation returns `prime-prune-cancelled`. Unknown verbs return
usage with non-mutating details. Unsafe run ids are refused by the existing
run-manager validation. The command never reads credentials, auth files,
transcripts, private run payloads, raw prompts, raw model responses, or provider
payloads.

The accepted command-surface direction is one slash command, not the rejected
split. Do not add `/prime-run`, `/prime-runs`, `/prime-models`, `/prime-chains`,
`/prime-profiles`, `/prime-worktrees`, or `/prime-resources` as top-level commands
for this UX surface.

Verification added in this slice: 11 focused node tests for fake-Pi registration,
argument completions, unknown-verb usage, dashboard/preflight, stable unknown
config failure, view-only browsers, structural run list/status, and prune gating.
Headless Pi 0.80.3 RPC `get_commands` was also run offline with `--approve` and
`--no-session`; it listed `prime` without provider prompts, credentials, sessions,
live calls, or model traffic. No live provider smoke was run because PR1 is
no-live UX/preflight only.

## 2026-07-08 — PR #25 Fable review fixes F1-F5

Scope: `dispatch/lib/run-manager.mjs`, `dispatch/lib/task-loop.mjs`,
`tools/loop/prime-task-loop.mjs`, `extensions/lib/prime-command-core.mjs`,
`extensions/prime-command.ts`, focused tests, README, Stage 3 loop docs, roadmap/
summary updates, and this ledger. Public-safe summary; no credentials, auth/env
files, transcripts, private run payloads, provider payloads, live provider calls,
or paid/metered calls.

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| F1 | Medium | `prune "."` resolved to the runs root, so the shared safe-path guard allowed root replacement/deletion. | `validateRunId` now rejects `.`/`..`, `safeRunDir` also refuses resolved paths equal to the runs root, `statusRun` uses the same guard, and `prime-task-loop --run-id .`, `prime-runs prune .`, and `/prime runs prune .` all fail closed as `unsafe-run-id`. Regressions prove the root sentinel survives and safe dotted ids such as `run.1` still work. |
| F2 | Low | Argument completions could eagerly parse local registry JSON and throw raw syntax errors if config input was corrupt. | Top-level completions are static and do not parse registries; run-config completions are wrapped fail-closed and return `null` on malformed input while `runs` static completions remain available. |
| F3 | Low | `/prime chains` derived loop-runnability from chain steps instead of the same route rule used by the task loop. | Chain view now uses `routeForClass(chain.task_class).roles.includes("builder")`; a regression covers a builder-step chain whose architecture route remains non-loop-runnable. |
| F4 | Low | `/prime run` copied task-loop profile/matrix/cap preflight semantics. | `dispatch/lib/task-loop.mjs` now exports `preflightTaskLoopConfig`; both `runTaskLoop` and `/prime run` use it, and a regression proves `/prime` returns the same cap-refusal code as task-loop preflight. |
| F5 | Low | `extensions/prime-command.ts` sent `display` as a string title, but Pi expects a boolean. | The extension now sends `display: true` and preserves the title in `details.title`; the fake-Pi test locks this shape. |

Focused verification before the full gate: 27 impacted node tests passed across
run-manager, chain/run-config, `/prime` core, and fake-Pi extension tests. Direct
CLI checks for `node tools/loop/prime-task-loop.mjs --run-id .` and
`node tools/runs/prime-runs.mjs prune .` both returned `unsafe-run-id` without
touching structural records.

## 2026-07-08 — PR #25 final Info review fix

Scope: `extensions/lib/prime-command-core.mjs`,
`tests/prime-command-core.test.mjs`, README, Stage 3 loop docs, roadmap/summary
updates, and this ledger. Public-safe summary; no credentials, auth/env files,
transcripts, private run payloads, provider payloads, live provider calls, or
paid/metered calls.

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| I1 | Info | `/prime` execution still surfaced raw parser exceptions if a local registry/config JSON file was malformed. | The `/prime` dependency load path now catches JSON read/parse failures and returns `prime-config-unreadable` with only a safe basename such as `run-configs.json`; it never includes raw exception messages or full filesystem paths. Because dependency loading happens before verb dispatch, dashboard, structural run list, and confirmed prune all fail closed before mutation. Regressions cover dashboard/list/prune malformed-config execution and prove prune leaves the run directory intact. |

Focused verification before the full gate: `node --test
tests/prime-command-core.test.mjs` passed 14 tests.

## 2026-07-08 — Final non-Phase-4 hardening push

Scope: provider/live-proof boundaries, web/remote/status audit posture, planning
discipline docs, no-auth/no-live Pi loadability/discoverability helper, static
CI no-live egress guard, and lockdown follow-up dispositions. Public-safe
summary; no raw prompts, responses, transcripts, provider payloads, credentials,
or private paths.

Delivered:

- Pre-behavior plan artifact:
  `reviews/runs/stage3-final-nonphase4-plan-2026-07-08.md`.
- Provider boundary docs:
  `docs/m0a/provider-live-proof-boundaries.md` and Azure Foundry config template.
  Azure Foundry is blocked until a deployment exists; OpenAI/Codex and Claude
  live proofs require per-proof maintainer approval; `claude-local` remains
  excluded from automated dispatch.
- Package audit posture artifacts for `pi-web-access`, `remote-pi`,
  `pi-messenger`, and status/observability candidates. These are metadata/catalog
  artifacts only; no package is installed, adopted, or run.
- Web prompt-injection posture: fetched content is data, never authority, and
  cannot override `AGENTS.md` or project rules.
- Remote-control/fence-v2 boundary: current fence remains `ctx.mode === "tui"`;
  remote approval needs a future authenticated paired-device design.
- Planning discipline docs: `CONTRIBUTING.md` sync rules for `AGENTS.md`,
  `CLAUDE.md`, and `.github/copilot-instructions.md`; `APPEND_SYSTEM.md` remains
  unnecessary unless future drift is proved; plan-mode guidance uses one
  consolidated `CGS` / alternatives / done-when block.
- `tools/smoke/pi-e2e-load.mjs`, separating package/resource loadability, Pi
  command/skill discoverability, no-live behavior, and live-provider proof.
- `tools/ci/no-live-egress-check.mjs`, wired as `npm run check:no-live-egress`
  and into GitHub Actions. This is a static no-live CI guard; the Docker
  lockdown smoke remains the packet-level local proof.

Regression coverage added:

| Area | Tests |
| --- | --- |
| Provider boundaries | `tests/dispatch-provider-boundaries.test.mjs`: `claude-local` non-automated; Copilot absent/stale/mismatched pin refusal; metered stale/unknown/missing price refusal before adapter launch. |
| Pi proof helper | `tests/pi-e2e-load-helper.test.mjs`: static loadability passes, discoverability is not overclaimed, drift fails closed. |
| No-live egress guard | `tests/no-live-egress-check.test.mjs`: CI-safe wiring passes; workflow/provider/live-smoke/run-config violations fail closed. |

Runtime no-live proof run this slice: `node tools/smoke/pi-e2e-load.mjs
--runtime-rpc` passed package/resource loadability, found the Prime `prime`
extension command via RPC `get_commands`, preserved the known headless
`skill:prime-ui` limitation, and skipped live-provider proof.

Not run / not included: any live provider call, paid/metered call, package
install/adoption, remote approval, `/prime` slash UX changes, `pi-annotate`,
hosted adapter, autonomous loop, Neovim/Pi integration, firstmate-style
orchestration, HTML theming, optional roadmap/plan/changelog artifact engines,
or stronger endpoint-exclusivity claims than the existing Docker no-network/local
mock evidence.

## 2026-07-09 — Stage 3P whole-repo gap closure

Scope: accepted Codex/Fable whole-repo review gaps, mechanical safety hardening,
CI/docs proof, user manual/help, runtime RPC timeout, run-record list/prune UX,
and design contracts. Public-safe summary; no credentials, auth/env files,
transcripts, private run payloads, provider payloads, raw prompts/responses, live
provider calls, paid/metered calls, package installs/adoptions, remote approvals,
or web access.

Delivered:

- Schema validation now uses own-property checks for required and known-property
  validation, including prototype-named extra-key regressions.
- `cost_estimate_usd` and `cost_actual_usd` are nonnegative or `null`; cap
  aggregation cannot be offset by negative spend.
- Git diff runners scrub repo-targeting `GIT_*` env vars and deny expanded
  credential-shaped untracked paths including OpenSSH security-key names,
  `.kube/config`, `.docker/config.json`, `.pypirc`, and `service-account.json`.
- Diff-checker, adapter, gate, and run-record write failures surface stable safe
  details instead of raw thrown messages.
- Public-safety scans cover macOS, Linux, and Windows home-path forms.
- CI and `tools/ship/pr-gate.sh` share `tools/ci/public-safety-diff-scan.mjs`;
  CI also runs docs truth, deterministic no-live dispatch/revision smokes, and
  static Pi load proof. The diff scanner uses a diff-aware path for staged/PR
  diffs so removed signature literals do not self-match, while PR bodies and
  generated records are scanned as full text.
- `docs/manual.md` adds the direct user manual; `/prime help` is view-only,
  public-safe, non-TUI compatible, and does not require local registry JSON.
- `/prime` refusals report a stable code, human-readable reason, and next safe
  action; flat smoke records are labelled non-prunable in list/status.
- Runtime RPC Pi load proof defaults to a 60s timeout after the 20s candidate
  default timed out in local no-live verification.
- GitHub branch protection was enabled for `main`: one approving PR review and
  the `test` required status check before merge; force pushes/deletions disabled.
- `docs/stage3/design-contracts.md` records design-first contracts for
  autoresearch, cost policy modes, composite models, config overlays, loop visual
  cues, live enablement, and context engineering.

Regression coverage added or expanded:

| Area | Tests |
| --- | --- |
| Schema/property safety | Own-property required/additional validation and `toString` extra-key bypass regression. |
| Cost safety | Negative USD envelope/record rejection and cap-sum offset prevention. |
| Git diff surface | Repo-targeting env var scrub and expanded sensitive-path denylist. |
| Stable failure details | Diff-checker thrown prose fallback plus adapter/judge/synthesis/verifier/gate/write-failure safe details. |
| Public safety | Diff scanner stable-code output and macOS/Linux/Windows home-path scans. |
| `/prime` UX | `/prime help`, help completions, refusal guidance, prunable/non-prunable list/status labels. |
| Runtime RPC | 60s default timeout helper lock. |
| Docs truth | README truth block locked to package surface, command count, test declarations, and roadmap status snippet. |

Verification count for this branch: `npm test` passes 362 node tests plus the
worktree self-test (12) and objective-gate-loop self-test (8). The docs-truth
lock tracks 358 top-level node test declarations. Full command status belongs to
the PR handoff; this ledger records the intended closure scope.

Not implemented by design: autoresearch behavior, live enablement, composite
selection, config editor/import/export UI, remote approval, web access, external
package adoption, paid/live calls, new top-level slash commands, hosted adapter,
or autonomous/unattended behavior. Those areas are contract-only until their
specific policy and no-live tests exist.

## 2026-07-09 — Stage 3P post-merge review correction

Scope: post-merge review fixes for PR #27. Public-safe summary only; no
credentials, auth/env files, transcripts, private payloads, raw prompts/responses,
live provider calls, paid/metered calls, package installs/adoptions, remote
approvals, or web access.

Corrections and accepted fixes:

- P3 record correction: the PR #27 body metadata was stale when reviewed; it said
  CI was queued and the PR was not merged, while the actual PR state was merged
  on 2026-07-09T14:10:10Z with the `test` check passed.
- P1 accepted and fixed: `tools/ci/public-safety-diff-scan.mjs` selected its scan
  algorithm from the input source, so non-diff stdin text could be scanned as a
  diff and dash-prefixed leak lines could be skipped; resolution is explicit
  `--mode diff|text` plus caller and regression coverage.
- P1 accepted and fixed: `/prime` run/status/prune refusals could render raw
  user-supplied run/config details through refusal text and structured details;
  resolution is stable detail categories plus public-safety regressions for
  macOS, Linux, and Windows home-path-shaped inputs.

## 2026-07-09 — Owner product pivot: cost control removed, presence = live, YOLO posture

Scope: recorded from the owner's full product/architecture interview (planning
session, 2026-07-09). This entry is the decision log the amended
`docs/stage3/design-contracts.md` refers to. Public-safe summary only.

Accepted owner decisions (each explicitly chosen, several against reviewer
recommendation — recorded, not implied):

- Cost control REMOVED from the harness entirely: cost policy modes, scopes,
  units, approval ledger, USD/token caps, price-TTL freshness, `:free`
  verification, and the no-spend preflight. Spend is bounded by the backend
  control instance (billing ceiling at the provider). Rejected alternatives:
  harness hard-stop default, mixed modes, report-only spend telemetry.
- The harness keeps exactly one rail: `max_iterations` (a time/runaway
  control), plus `max_concurrency` as a resource bound. Token counts survive
  only as capacity telemetry for context-pressure cues.
- Protection follows Pi defaults (YOLO): no fences, no write allowlists, no
  command allowlists, no confirmation ceremonies in loops. Worktree-per-run
  isolation survives as workflow infrastructure (protects the user's checkout),
  not as a fence. The prime-fence extension is untouched, deferred future work.
- Presence = live: a run config naming real providers is live as-is. The
  `live.enabled` flag, per-provider enablement docs, and approval expiries are
  removed. Rejected alternatives: standing-enablement docs, time-boxed
  approvals, env-based toggles.
- CI stays no-live forever: no provider credentials in CI, CI exercises only
  the all-mock config, and the static guard now (a) asserts the CI-exercised
  role matrix is all-mock and (b) lints that removed cost-control identifiers
  never reappear in the dispatch layer.
- Public-safe structural records remain non-negotiable and are NOT part of the
  YOLO relaxation: they govern what is persisted/rendered, not what the agent
  may do. The diff surface now content-hashes all untracked regular files but
  still never follows symlinks and never content-reads credential-shaped paths
  (they become structural markers instead of loop-killing refusals).

False-alarm note for future reviewers: the removal of `refused-*` price/pin
codes, profile caps, token budgets, and write allowlists is not a regression —
it is this deliberate, owner-directed product pivot. Do not re-open those as
missing safety features; the design contracts document the new posture.

## 2026-07-09 — Prime v1 single-PR build

Scope: the eight implementation milestones (M1–M8) on branch `prime-v1`,
built to the amended design contracts from the same-day owner interview, plus
the M9 verification pass. Public-safe summary from the milestone commit
messages; adversarial review (M10) follows this entry.

**M1 — cost control removed; presence = live.** Deleted the cost-policy,
provider-policy, and profiles modules, the no-spend preflight, and all
openrouter-free smokes/fixtures/tests; removed USD/token caps, price-TTL
freshness, `:free` verification, write allowlists, `live.enabled` flags, and
input classes end to end. Kept exactly two rails: `max_iterations` (mandatory,
fail-closed) and `max_concurrency`; token counts survive as capacity telemetry
(envelope/record schema_version 2). `/prime` now derives live status from the
resolved panel providers and the old profiles verb was retired. The diff
surface content-hashes all untracked regular files; symlinks, non-files, and
credential-shaped paths become structural markers instead of loop-killing
refusals. Revision effect is worktree-containment only. The no-live CI guard
was re-scoped: no creds in CI, CI-exercised matrix must be all-mock, and a
removal lint keeps deleted identifiers from reappearing.

**M2 — feature-toggle settings substrate.** Six user-local toggles
(multi-model, loops, autoresearch, context-engine, worktree, visual-cues), all
default ON, in a schema-versioned untracked settings file with fail-closed
load/save and `requireToggle` for explicit conflicts only. Run records gain a
validated toggles vector so every record is reproducible against the settings
it ran under. First degeneration hook: loops OFF forces a single pass —
degeneration, never an error.

**M3 — staged chains + the five-loop catalog.** Chains became staged state
machines: each stage is a mini-loop routed by a reviewer verdict
(approve/revise/revise-jump) or a gate expectation; only the objective gate
concludes a run; every stage pass and back-jump consumes the global
`max_iterations` budget and per-stage ceilings are never reset, so termination
is guaranteed. Chain schema v2 (stages, advance blocks, earlier-stages-only
jumps, gate-expectation XOR verdict, declared worktree artifacts like
PLAN.md), a pure transition-routing table plus executor, and the five-loop
catalog: full-cycle, tdd-fix (red-first; replaces implement-review-fix),
scout, research (shape), ship-pre-pr.

**M4 — composite presets + per-stage casts.** Composites are step-level
executors: a run config maps each chain stage to a composite id or a plain
provider/model/effort. Preset registry with fail-closed loading and
degradation that names the unavailable member; per-provider effort
vocabularies; `overlord` and `daily` ship as tracked skeletons with mock
members (real lineups are user-local profile material). Multi-model OFF makes
composites the explicit conflict while a plain model collapses to the solo
path. The CI mock config carries the flagship cast (plan → overlord,
implement → daily).

**M5 — the staged runner.** Wired the M3 stage machine to real per-stage
dispatch cycles with M4 casts: append-only structural event log (public-safety
scanned and stable-code enforced at emit time), per-run git worktrees under a
gitignored local directory, strictest-wins verdict extraction across multiple
reviewers, builder revisions from pass 2, stage artifacts hashed into
stage-end events, machine state persisted after every pass, and resume from
state with completed-run no-op. The task-loop CLI now drives the staged
runner with user-local toggles, `--repo` for real repositories, `--resume`,
and live event lines.

**M6 — context engine.** All nine dispatch roles received tracked briefs
rewritten to the post-pivot contracts. Step prompts compile from tracked
template + role brief + task envelope + handoff packet; records and events
carry template id + sha256 hashes, never compiled text, with an opt-in debug
dump to an untracked directory. Fresh-context handoff packets carry claims as
adapter inputs with a leak-scanned structural projection as the only
persistable form; transcript degeneration covers context-engine OFF; the
append-only disagreement log preserves or resolves open entries but never
drops them. Pressure is measured from usage rollups and honestly unavailable
otherwise.

**M7 — autoresearch machinery.** The research engine enforces the mandatory
shape — no run starts without a declared metric (name, comparator, target) and
stop condition — over hypothesis → experiment → measure → compare → iterate.
Exactly four stop reasons: target-met, max-iterations, diminishing-returns
(N declared consecutive non-improvements), and dead-end — a refutation with no
successor hypothesis reported as a valuable result, while a refutation with a
successor keeps iterating. Attended-only; autoresearch OFF is the explicit
conflict; loops OFF degenerates to one-shot research. Research records are
structural (sha256 refs, metric, per-iteration measurements, stop reason);
experiment text never enters the record.

**M8 — the `/prime` surface.** All new capability landed as verbs under the
single `/prime` command: settings (six-checkbox view + set), profiles
(list/show/switch/create untracked overlay profiles, schema-limited to cast
material — chain, gate, and run_target stay tracked-config territory), setup
(guided cast assembly validated against the preset registry; typo'd executors
refuse as unknown-preset by name), run preflight with active-profile cast
overlay and cast source, research preflight (attended-only, enforcing the
metric+stop shape, printing the real executor CLI whose measurement comes from
the user's own command), runs watch (the loop widget over a run's event
stream) and runs resume (state-aware, completed = no-op). The dashboard shows
the toggle vector and active profile; help and completions were refreshed.
Full suite 387 node tests green at merge-readiness; docs-truth relocked.

**M9 — verification.** Toggle combination matrix exercised end to end: all-on,
all-off, each of the six toggles off alone (singletons), and the three owner
scenarios, plus all five chains run end-to-end — all green. Suite, resources,
docs-truth, no-live-egress, and public-safety-diff checks green throughout.

Adversarial review (M10) follows this entry.

## 2026-07-10 — M10 adversarial review: confirmed findings

Four max-effort lenses (correctness, public-safety, termination, test-hollowness)
over the prime-v1 diff; each finding handed to a max-effort skeptic to refute
against the real code. 15 confirmed real, 1 refuted, 9 verify agents cut off by a
shared session limit and self-adjudicated against the code. The confirmed cluster
is resume, the loop CLI's live/profile wiring, and the watch/resume renderers —
not the engine core. Accepted findings and their fixes (this section is the
open→fixed ledger for M10):

Correctness / resume:
- [P1] Persisted machine state is PRE-transition: onPass fired before the stage
  transition applied, so a SIGKILL left a state pointing at the just-completed
  stage → resume replayed it and could diverge. FIX: persist post-transition
  state.
- [P1] Fresh run silently reused an existing per-run worktree (create() returned
  reused:true for any existing path) → a colliding run id ran against a stale
  dirty tree = false convergence. FIX: fresh runs refuse a colliding worktree;
  only resume reuses.
- [P1] Resume lost the run's config/repo binding: the printed CLI was
  `--resume <id>` only, and the runner did not validate the state's config_id
  against the config being resumed → resume silently ran mock-core-loop in a
  synthetic temp repo. FIX: state carries config_id + run_target; resume
  validates both; the CLI resolves the config from the state and requires the
  original repo.
- [P1] A refused resume (invalid-resume-state) still ran the unconditional final
  writeState(completed:true), bricking a valid interrupt state. FIX: refusals
  before the machine runs never overwrite the state file.
- [P2] Event seq restarted at 1 on resume, corrupting the append-only per-run
  log. FIX: resume continues the seq from the persisted event count.
- [P2] Open disagreements from before an interrupt were dropped; a mid-run kill
  left no disagreements.json. FIX: persist the disagreement log after every pass
  (not only at run end) and rehydrate it on resume.

Public-safety:
- [P2] /prime runs watch and resume rendered on-disk events/state JSON verbatim
  with no assertPublicSafe, while sibling readers (listRuns/statusRun) re-scan on
  read — a doctored or worktree-OFF-written file defeated the renderer contract.
  FIX: scan parsed events/state and validate rendered fields before display;
  refuse fail-closed like listRuns.
- [P2] The /prime handler had no throw fence: an uncaught fs error could surface
  a raw absolute path. FIX: the extension handler catches and returns a stable
  public-safe refusal.

Surface accuracy:
- [P1] The loop CLI always ran the mock adapter, so a cast naming real providers
  executed mock while records carried the real provider ids (silently-wrong
  record). FIX: the CLI refuses a non-mock cast with live-adapter-not-wired (the
  staged live transport is the deferred live-proof track); presence=live still
  holds — the config is ready, the CLI just will not fake it.
- [P1] The active profile shown/confirmed at /prime run preflight was not applied
  by the printed CLI. FIX: the CLI applies the active profile exactly as
  preflight does.
- [P2] /prime run's Live: signal derived from the legacy role matrix, not the
  cast that executes. FIX: derive it from the resolved cast providers.
- [P2] /prime runs status could not find staged runs (matcher expected legacy
  -iter names). FIX: match the staged -p<N> per-pass record names.

Refuted (recorded so it is not re-opened):
- [P2] "revise-jump bypasses per-stage max_passes": mechanically true that a
  jump does not consume the target stage's max_passes, but the global
  max_iterations rail still terminates every such loop — contract-conformant by
  design (design-contracts.md "one rail: max_iterations"), test-pinned. Not a bug.

Test hollowness (addressed by regression tests accompanying the fixes above):
invalid-resume-state coverage, onPass interrupt-safety, disagreement-log
non-empty pipeline, profile fail-closed paths, watch/resume malformed+leak
refusals, the vacuous revision-effect escape assertion, event-log prose
admission, staged refusal codes, and the loop-CLI path all gain real assertions.

## 2026-07-10 — M10 round 2: verify fixes hold + regressions

A second adversarial round re-examined the round-1 diff (two high-effort agents,
every finding probe-confirmed against the real code). Five more confirmed, all
still in the resume/CLI corner — including one incompleteness of a round-1 fix.
All fixed:

- [P0] The live-adapter guard scanned a cast's `roles` but not `panel_roles`, so
  a composite with a real judge/synthesizer (which land only in panel_roles on
  multi-member stages) ran the mock adapter while records claimed the real
  provider. FIX: a shared allCastProviders() scans roles AND panel_roles; the
  runner guard and /prime's Live signal both use it.
- [P1] Resume was presence-only on the repo: `--resume` with a different --repo
  silently ran against the wrong repository in a fresh worktree. FIX:
  create(reuse:true) refuses when the per-run worktree is ABSENT
  (resume-worktree-missing) — the worktree lives under the original repo, so a
  wrong-repo resume has none here. The CLI also fails closed on an explicit
  --config that disagrees with the state.
- [P1] A refused FRESH run bricked an interrupted run: the CLI cleaned the run
  directory (clean:true) BEFORE the runner's collision refusal, destroying the
  resumable state and history. FIX: the CLI refuses (fresh-run-would-clobber-
  resumable) BEFORE any deletion when a non-completed state file is present.
- [P2] event_count was persisted only at pass boundaries, so a mid-pass kill
  left orphan events past it and resume re-issued (duplicated) their seqs. FIX:
  resume derives start_seq from the actual last seq in the on-disk JSONL, not
  event_count — strictly monotonic across any kill window.
- [P2] A resume at total_passes == max_iterations (interrupted right after the
  final budgeted pass advanced, before its conclusion gate) was mislabeled
  invalid-resume-state. FIX: validation accepts total_passes <= max_iterations;
  with the budget exhausted the loop reports honestly (conservative — never a
  wrong success). Accepted limitation: such an exact-budget interrupt resumes to
  a conservative not-converged rather than re-running only the pending gate;
  representing "gate-pending" precisely is out of scope for the local dev loop.

Coverage: the loop CLI (previously untested) gains a child-process suite (fresh
run, resume-requires-repo, clobber guard, config-mismatch); plus runner
regressions for the panel_roles guard, wrong-repo resume, file-derived seq
continuation, and the budget-edge resume. Suite 422 node tests + selftests green;
all static gates + pr-gate dry-run PASS. Round 3 (a lighter re-verify) follows to
confirm dryness.

## 2026-07-10 — M10 round 3: clean

A third adversarial round (two high-effort agents: round-2-holds + a holistic
resume/CLI/watch-resume sweep, each probe-driven) returned ZERO confirmed
findings. Convergence across the three rounds was 15 -> 5 -> 0. The review is
dry; M10 is complete. Residual accepted limitation (documented in round 2): an
interrupt at the exact final-budget conclusion gate resumes to a conservative
not-converged rather than re-running only the pending gate.

## 2026-07-10 — independent cross-family review and repair pass

Scope: independent re-derivation against `docs/stage3/design-contracts.md`, the
README/manual claims, the three same-family M10 rounds, and the owner-supplied
invariants. The pass explicitly did **not** re-open the 2026-07-09 pivot: no
harness cost control, live flag, loop fence/allowlist, prime-fence work, staged
live transport, web/remote/hosted behavior, scheduling, migrations, or
compaction was added. Each accepted item below was challenged against another
code path and backed by a focused regression or a read-only failure probe before
repair.

### Confirmed and fixed

| Severity | Confirmed behavior | Resolution / multi-location closure |
|---|---|---|
| P0 | Safe-looking schema integers could exceed JavaScript's safe range or expand impractically through iteration, concurrency, preset, matrix, and panel counts. | The shared validator now requires safe integers; practical global iteration (10,000) and stage-panel (64) ceilings are enforced before allocation across configs, chains, presets, matrices, debate, research, stage-machine, and both runners. |
| P1 | A non-mock legacy/staged cast with no transport could fall through toward mock execution, including composite-only judge/synthesizer members, producing a silently wrong provider/model record. | Both runners and `/prime` inspect every effective cast member (roles plus panel roles) and refuse as `live-adapter-not-wired`; the executed route ID, not a requested-but-overridden ID, is recorded. CI resolves the effective mock presets too. |
| P1 | Resume identity was not strong enough for every kill window: initialization could precede durable companions, in-flight pass bytes/HEAD/index were not recoverable exactly, settings/profile drift could change execution, and concurrent fresh/resume callers could share one run ID. | State schema v2 binds config semantics, exact cast/toggles, prompt resources, repository/worktree, baseline/full-checkout fingerprint, immutable disagreement generation, durable handoff source, run generation, and in-flight pass identity. A repository-private lease + state CAS serializes fresh/resume. Private mode-0700 Git-common-dir snapshots restore worktree bytes and HEAD/index without Git-object/ref-wide snapshots; deterministic generations heal pre-state kills and preserve unrelated refs. |
| P1 | Terminal recovery validated an individual pending `run-end` but not the full lifecycle, allowing forged convergence without the final objective gate; a prior passing gate could also be followed by unrelated events and still satisfy the history. | Closed event-history validation now requires one start, contiguous seq/time/attempts, one terminal end, converged/stop agreement, and a converged end immediately after a passing conclusion gate. Pending recovery validates the hypothetical complete history before append. Only the objective gate can conclude. |
| P1 | Public readers/renderers trusted open-shaped on-disk JSON and schema-valid registry prose; raw descriptions/notes/gate text or doctored state/events could reach `/prime`. The prompt compiler also retained an opt-in raw compiled-prompt dump. | Run records, debate summaries, events, runner state, disagreements, handoffs, research, run-manager reads, and `/prime` projections are closed and read-time scanned. Registry prose is omitted or hashed. Compiled prompts are now memory-only; the former debug dump is removed. A multi-surface canary proves ordinary and leak-shaped registry text does not render. |
| P1 | `/prime setup` could save a replacement profile and then fail activation, leaving a partial mutation. Other `/prime` mutations were not uniformly attended-confirmed. | Setup now operates only on an explicitly created profile and save+activate restores the prior profile on activation refusal. Settings, profile create/switch, setup, and prune all require TUI mode plus explicit confirmation. |
| P1 | The documented worktree result was a branch, but the implementation used detached worktrees. | Worktrees now use a deterministic public-safe `prime/run-<hash>` branch; resume verifies that exact registered branch and can recover an initialization window where the branch was created first. The CLI reports the safe branch name. |
| P2 | Valid staged companion files appeared as corrupt run records, and status prefix matching included unrelated run IDs. | Run-manager skips only exact state/research/latest/immutable-disagreement companion names and matches only exact parent IDs plus numeric `-iterN`/`-pN` children. Atomic non-recursive directory reservation replaces clean/reuse behavior. |
| P2 | Research used coercive numeric parsing, incomplete stop reporting, and treated every change under `==` as improvement; loops-off reporting could claim the configured loop behavior. | Full-token finite decimal/scientific parsing, exactly four stop reasons, honest one-shot degeneration, and target-distance equality improvement are shared by `/prime`, CLI, and engine. |
| P2 | Ordered ship checks were not structurally proven to the verifier, missing injected revision effects could throw, and required artifacts could be satisfied by stale files. | Chain steps execute in declared phases; tests/docs/lint/public-safety produce structural pass proofs before verifier input and handoff remains last. Missing effects refuse stably, the legacy revision boundary no longer dereferences a missing fallback, and first-pass artifacts must be freshly produced. |
| P2 | `/prime runs resume` performed only generic state validation, rejected the documented pre-event initialization window, and could label an impossible chain machine state resumable. The loop CLI read an unsafe resume ID before validating it. | `/prime` now handles only the exact initialization exception, validates immutable disagreements and event lifecycle, and checks machine counters against the recorded config/chain. The CLI validates the run ID before path construction and never renders an unsafe argument. |
| P2 | A live renderer exception at terminal delivery rewrote a durably converged run into `runner-unexpected-failure`; lease cleanup failure similarly risked changing truth. | Renderer failures are sanitized as `event-renderer-failed` and recorded as a returned warning after the already-appended terminal event; non-renderer append failures still propagate. Lease cleanup adds a warning without changing the durable outcome. |
| P2 | Persisted cast validation averaged members across stages and used a narrower model-ID grammar than the public config/profile schemas. | State validation applies the 64-member ceiling per stage and uses the canonical model/executor grammar, while runner preflight independently rechecks the same per-stage cap. |

### Superseded historical notes

- The M6 historical entry above accurately records what originally shipped,
  but its opt-in raw prompt debug dump is now removed: compiled prompts are
  memory-only adapter input under the stronger public-safety invariant.
- The round-2 exact-budget limitation is no longer accepted. A checkpoint in
  `phase:conclusion` resumes only the pending objective gate and never replays
  the final model pass, including at `total_passes == max_iterations`.
- Private pass snapshots are operational recovery state, not public records:
  raw worktree bytes stay below the target Git common directory, never enter
  Git objects/run records/events/renderers, are mode-0700, and are removed on
  pass commit/rollback. Hard-kill residue is documented for manual cleanup only
  after the run is abandoned.

### Verification ledger

Focused regressions cover live/mock identity, route truth, bounds, all resume
kill windows, lease/CAS contention, unrelated-ref preservation, initialization
recovery, immutable disagreement/event integrity, terminal-gate binding,
renderer failure, required artifacts/step ordering, closed public renderers,
profile transaction rollback, strict research parsing/stops, run-manager
collisions, and CLI path validation. Final suite/gate counts are recorded in the
shipping proof: 493 Node tests, 12 worktree self-tests, and 8 objective-loop
self-tests passed with zero skips/failures. Resource, docs-truth (484 static
test declarations), no-live-egress, public-safety-diff, dispatch/revision/Pi-load
smokes, `git diff --check`, and `tools/ship/pr-gate.sh --dry-run` all passed. No
live or paid provider call is part of this verification.

## 2026-07-10 — final all-encompassing cross-family closure

Scope: one final independent review of PR #29 at the post-repair head, covering
all owner invariants, persistence/rendering writers, resume kill windows,
objective-gate authority, loop rails, CI egress, toggle degeneration, and the
single-command surface. The 2026-07-09 pivot remained fixed: this pass added no
cost control, live flag, loop fence/allowlist, prime-fence work, or deferred
transport/remote/web/scheduled behavior. Each accepted item was reproduced
against the pre-fix code and re-probed after repair.

### Confirmed and fixed

| Severity | Confirmed behavior / proof | Resolution / multi-location closure |
|---|---|---|
| P1 | A staged real-provider cast completed successfully through an injected mock adapter while the returned cast claimed `openai-api/gpt-probe`; the legacy task loop had the same `!deps.adapter` bypass. | Both loop runners now reject every non-mock cast as `live-adapter-not-wired` before any injected adapter, revision, worktree, or chain-step effect. Role and panel-role coverage asserts zero calls. Dependency injection remains a mock-test seam, not authority to activate the deferred transport. |
| P1 | `ship-pre-pr` invoked its outward handoff five times while five conclusion gates failed, because handoff ran at the end of each stage pass before the gate. | Handoff steps are removed from stage execution and run only after a passing `phase:conclusion` objective gate. The effect receives a stable `run:chain:stage:step` idempotency key for kill/resume deduplication; a failed gate produces zero handoff calls, while successful ordering is verifier -> gate -> handoff. |
| P1 | A checkpoint with `pass_counts={plan:1,implement:0}` resumed and converged after its sole committed `pass-start` was relabeled `implement:1`; cardinality-only comparison accepted the wrong pass. | One shared event/checkpoint binder now serves the runner and `/prime runs resume`: pass attempts are mandatory/contiguous, the run-start config/chain/rail must match, every stage/pass executor and rail must match the recorded cast/config, and the checkpoint prefix must equal the exact committed pass set (multiple interrupted attempts of one logical pass remain valid). The doctored bundle now refuses as `resume-events-invalid`. |
| P1 | A schema-valid profile persisted a session-URL-shaped model identifier before `/prime`'s final response scanner refused rendering; gitignored profile state was incorrectly treated as outside the persisted-data invariant. | Profile validation now applies the canonical public-safety scanner before save and on every list/load path. The same toxic fixture returns `invalid-profile` and no file is created; settings remain inherently closed booleans. |

### Multi-location/refutation result

The follow-up sweep found no further material violations. Public writers now
scan run records, debate summaries, events, runner state, disagreements,
research, and profiles; `/prime` re-scans disk reads. Every execution loop is
finite (`max_iterations`, finite per-stage counts, or finite input length), CI
has one workflow with no credential wiring and resolves only mock casts, the
staged/legacy no-live guards are unconditional, toggle combinations still
degenerate, and `extensions/prime-command.ts` remains the sole registration of
the single `/prime` command. No live or paid provider call was made.

### Verification ledger

The final post-fix proof passed 493 Node tests, 12 worktree self-tests, and 8
objective-loop self-tests with zero skips/failures. Focused runner/legacy/
toggle/surface/profile suites, all four before/after probes, resource and
docs-truth checks (484 static test declarations; one slash command), static
no-live egress, public-safety diff scan, dispatch/revision/Pi-load smokes,
`git diff --check`, and `tools/ship/pr-gate.sh --dry-run` also passed. The
packet-level lockdown smoke and any live-provider proof remain intentionally
outside this no-live PR verification.

## 2026-07-10 — neutral-combiner remediation for `prime-reloaded`

Scope: fix the six independently confirmed runtime findings at source commit
`77ffcc1497adbb1990c2a018a91efddd50f61c36`, document their durable invariants,
and prepare a sanitized single-root private release candidate. This operation
does not change either repository's visibility and does not open any previously
recorded session/share link.

### Confirmed and fixed

| Severity | Confirmed behavior | Resolution / regression proof |
|---|---|---|
| P1 | Root-shaped refs, arbitrary web URLs in model fields, and caller-supplied URL-shaped effect codes could enter persisted or rendered structures. | One canonical field-grammar module now governs model, provider, code, executor, and ref boundaries; URI/path/domain-path/dot-segment shapes refuse. Chain effects map failures to enumerated codes. Exact regressions cover root-shaped refs, arbitrary non-session URLs, and a hostile effect code that never reaches the event stream. |
| P1 | An impossible implement → plan → implement event order could bind to a checkpoint, while completed state could report convergence despite terminal objective failure. | One ordered, chain-aware lifecycle reducer is shared by runner checkpoint binding and `/prime` watch/resume. It binds attempts, stage routing, gates, machine state, terminal state, and `run-end`; both impossible order and terminal disagreement now refuse. |
| P1 | A fresh worktree collision left resumable initialization state, and resume could adopt a pre-existing dirty worktree. | Collision preflight now occurs before state creation. Worktree creation installs a repository-private owner claim, and initialization reuse requires the exact run generation/repository/branch/baseline owner plus a clean checkout. Runner state schema v3 records the owner ref and deliberately refuses v2 checkpoints. |
| P1 | Settings and profile pending/final symlinks could redirect atomic-looking writes outside their selected root. Equivalent direct writers existed elsewhere. | All structural persistence now uses one root-confined module with canonical containment, non-symlink parent/final checks, exclusive no-follow temporary creation, fsync, verified atomic install, and safe append/reservation. Private crash-checkpoint generations use its confined directory reservation/resolution/installation path too. Exact final-target, predictable-pending, descendant-parent, and checkpoint-parent symlink regressions prove outside victims remain unchanged. |
| P2 | With only `visual-cues:false`, the CLI silently selected summary filtering and omitted most persisted events. | Visual-cues-off now selects plain line rendering only. Every persisted event renders unless the caller explicitly supplies `--summary`; the regression compares rendered and persisted counts. |
| P2 | `saveSettings` accepted schema version 2, but the immediate load path refused it. | Settings schema version is exact on both sides; save returns the same stable mismatch before creating or changing a file. A future-version save/load regression covers the boundary. |

### Publication boundary

- The original `prime` repository is a permanently private archive. Branch
  deletion or history rewriting is not accepted as sanitization because its
  repository network retains historical and pull-request refs.
- `prime-reloaded` must receive only a fresh root commit containing the reviewed
  tracked snapshot, authored and committed with the maintainer's verified
  GitHub noreply identity. No old ref, tag, PR ref, or Git object is copied.
- `prime-reloaded` remains private until a separate final audit checks the live
  object/ref graph, tracked content, commit and repository metadata, protection
  settings, and a fresh secret scan. The maintainer must also confirm prior
  session revocation and choose the project license before visibility changes.

### Verification ledger

Focused runtime/surface proof passed 64/64. The full gate passed 509 Node tests,
12 worktree self-tests, and 8 objective-loop self-tests with zero skips or
failures. Resource and docs-truth checks passed (500 static declarations; one
slash command), as did static no-live egress, the indexed public-safety diff and
whitespace checks, deterministic dispatch/revision/Pi-load smokes, and
`tools/ship/pr-gate.sh --dry-run` from a generated clean-root trial. The
whole-snapshot public-safety scan also covers filenames and commit metadata;
signature/test fixtures are assembled without embedding a matching toxic
literal. A fresh Gitleaks 8.30.1 directory scan of the exported tracked snapshot
reported no leaks. Live/paid provider calls, opening session URLs, runtime Pi
RPC, and the packet-level Docker lockdown smoke remain intentionally outside
this no-live remediation.

## 2026-07-11 — MIT license selection and publication-audit handoff

Scope: record the maintainer's explicit MIT license choice and remove license
selection from the publication blockers without changing repository visibility.
The public GitHub identity `luisgui1757` is the copyright holder recorded in the
root license so this release tree does not introduce a private name or email.

### Publication state

- The root `LICENSE` contains the standard MIT terms, `package.json` declares
  `MIT`, and the packaged-file allowlist includes the license.
- `prime-reloaded` remains private. The final independent publication audit and
  maintainer confirmation that both historical Claude Code web sessions are
  Private or deleted remain required before any visibility change.
- The original `prime` repository remains a permanently private archive. No
  historical session/share link was opened during this change.

### Verification ledger

Fifteen focused docs-truth, no-live-egress, and public-safety tests passed.
Resource, docs-truth (500 static declarations; one slash command), static
no-live-egress, public-safety diff, and `git diff --check` passed. Gitleaks 8.30.1
scanned the 1.87 MB working tree in no-Git mode and reported no leaks; its Git
mode then scanned both sanitized commits and also reported no leaks. The npm
package dry run included the root `LICENSE` and declared package metadata.

The complete local `npm test` run was attempted but is not claimed as passing:
after 15 minutes, spawned `loop-cli` child processes were still progressing but
lingered for minutes per case, so the run was terminated without a reported test
failure. The protected pull request's required `test` check remains the clean-
environment full-suite authority and must pass before merge. No live/paid call,
session-link open, runtime Pi RPC, or packet-level Docker lockdown smoke was run.

## 2026-07-11 — final publication-documentation audit remediation

Scope: reconcile the two independent pre-publication reports at PR #1 head
`44f849a2d422f6f8a08eb2ecc8fc78850158ccc8`, fix every accepted finding, and
retain both repositories as private. No historical Claude Code session URL was
opened, and no visibility, merge, approval, or live-provider operation occurred.

### Neutral disposition and resolution

| Reported severity | Candidate | Neutral disposition | Resolution |
|---|---|---|---|
| P1 | Direct Stage 3 pages and the dated HTML summary presented removed cost/no-spend, token-budget, write-allowlist, live-enablement, and smoke-command behavior as current. | **Accepted.** A README-only disclaimer did not protect a direct reader, and the live roadmap/HTML status retained stale claims and counts. | Every retained Stage 3B-N implementation page now carries the same prominent superseded/non-runnable banner. The live roadmap gains an authoritative current-v1 row; the HTML summary states current semantics, marks build chronology historical, removes stale counts, and machine-locks the current declaration count. `check:docs-truth` requires every banner, both HTML historical boundaries, the exact count marker, current `live-adapter-not-wired` truth, and absence of the known stale counts. |
| P1 | Target/source overlap of content-addressed tree/blob ids violated a zero-source-object invariant. | **Rejected as an exposure; accepted as imprecise P2 wording.** The independently reproduced snapshot overlap was 27 trees and 144 blobs (145 blobs when prior sanitized target history is included), with zero source commits. Identical audited-safe bytes and tree entries necessarily hash to the same ids and carry no source-repository provenance or reverse commit link. Rebuilding identical content would reproduce the same ids. | The operational contract now forbids mirroring/fetching the old object database and forbids source refs, tags, PR refs, commits, network relationships, unsafe metadata, and unsafe-only content. It explicitly permits expected id overlap for independently regenerated, byte-identical audited-safe blobs/subtrees. The older ledger wording above is superseded by this correction. |
| P3 | `pr-gate.sh` passed detached HEAD as an empty feature branch. | **Accepted.** `git branch --show-current` prints nothing but exits successfully when detached. | The gate now fails on an empty branch name. A system-boundary regression simulates detached and named-feature states, proving detached fails and a real feature branch still passes. |
| P2 candidate | Secret scanning was explicitly disabled. | **Not proven.** The authenticated repository response omits `security_and_analysis`; private vulnerability reporting returns 404. | Continue to report these surfaces as unavailable/plan-gated while private, not explicitly disabled. Fresh Gitleaks remains the pre-publication compensating check. |

### Durable publication invariants

- Current behavior is defined by `docs/stage3/design-contracts.md`,
  `docs/manual.md`, and executable checks. Named Stage 3B-N pages are historical
  implementation records even where compatible code still exists.
- Current v1 has exactly the `max_iterations` and `max_concurrency` harness
  rails. Backend billing owns spend; no cost/no-spend policy, token-budget rail,
  write allowlist, live flag, or task-loop live transport ships. Every non-mock
  cast refuses as `live-adapter-not-wired`.
- Sanitization is about reachable history, metadata, refs/network identity, and
  unsafe content—not impossible uniqueness of hashes for identical clean bytes.
- Shipping from detached HEAD is a hard gate failure, never an empty feature
  branch pass.

### Verification ledger

The full local suite passed 510 Node tests, 12 worktree self-tests, and 8
objective-loop self-tests with zero failures or skips. Focused docs-truth and
detached-HEAD regressions passed. Resource, docs-truth (501 static declarations;
one slash command), static no-live-egress, public-safety diff, shellcheck, and
`git diff --check` passed. Deterministic dispatch, revision-effect, and static
Pi-load smokes passed without network/provider use. Every Stage 3 implementation
record was checked for the historical banner; the stale HTML count signatures
are absent. Gitleaks 8.30.1 scanned the 1.90 MB working tree and reported no
leaks. `tools/ship/pr-gate.sh --dry-run` passed every hard gate from the named
feature branch.

Live/paid provider calls, runtime Pi RPC inventory, opening historical session
URLs, and the packet-level Docker lockdown smoke remain intentionally skipped.
Any new commit changes the audited head, so required CI and independent
exact-head publication review must rerun before the separate-account approval
and merge. Both repositories remain private through the post-merge checklist.
