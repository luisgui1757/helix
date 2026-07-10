# Stage 3G — iterating multi-team / adversarial debate loop

Adds a thin, bounded **iterating / adversarial debate** loop over the existing
Stage 3B–3F dispatch cycle. One iteration is exactly the one-cycle pipeline
(candidate panel → optional judge → optional synthesis → objective/advisory gate →
optional verifier); the loop repeats that cycle only when the route calls for
adversarial iteration and the gate has **not** converged. Same build boundary: no
subprocesses, no network, no hosted adapter, no real non-mock adapter, no live
provider call, no credential reads.

Source of truth:
[`docs/architecture/fusion-dispatch-research.md`](../architecture/fusion-dispatch-research.md)
§"Adversarial mode" and §9-Q2 — *"convergence = diff-stability + objective-gate-pass;
per-run token-budget cap + max-iter as runaway rails (not skips)."*

## What shipped

| Piece | Responsibility |
| --- | --- |
| `dispatch/lib/debate.mjs` | `runDebate(request, deps)` — the bounded iterating loop; `DEBATE_REQUEST_SCHEMA`; `routeCallsForAdversarialIteration`; `writeDebateSummary` (structural, public-safe summary writer). |
| `dispatch/lib/orchestrate.mjs` | Unchanged — the debate layer **composes** `runDispatch`; the dispatch core adds no debate knowledge and does not import the debate layer. |
| `tests/dispatch-debate.test.mjs` | Convergence, unstable→stable, gate-never-passes, budget-across-iterations, verifier-advisory, no-narrative-leak, cap/checker fail-closed matrix, single-pass, determinism, persistence, hard-fail evidence, structural diff-code, thrown diff-code fallback, and real diff/revision boundary coverage (39 test declarations). |
| `tools/smoke/dispatch-smoke.mjs` | A 5th deterministic mock scenario: a risky-change debate that converges on iteration 2 (unstable→stable + passing gate). |

## Dependencies flow inward

The debate layer calls the dispatch substrate; the dispatch core never calls the
debate layer. `debate.mjs` imports `runDispatch` (orchestrate) and the public-safe
record helpers (`validateRunRecord` / `assertPublicSafe` / `stableStringify`) — it
adds **no policy of its own**. `orchestrate.mjs` imports nothing from `debate.mjs`,
so a dispatch can never start a debate and the per-cycle recursion fence
(`depth === 1`) is untouched.

## Request / deps shape

```js
runDebate(
  {
    run_id: "my-debate",           // loop id; per-iteration ids are `${run_id}-iterN`
    base_request: { /* a DISPATCH_REQUEST_SCHEMA request; its run_id is overridden */ },
    max_iterations: 5,             // MANDATORY finite integer >= 1 (runaway rail)
    token_budget: 10_000_000,      // MANDATORY finite number >= 0 (aggregate rail)
  },
  {
    adapter, runGate, now, seed, mode, record_dir, parallel,  // passed straight to runDispatch
    diffStability: (prevRecord, currRecord, ctx) => ({ stable, code }),  // injected, deterministic
  },
)
```

- **`base_request`** is the dispatch request run through each iteration. The loop
  overrides its `run_id` with a deterministic per-iteration id
  (`${run_id}-iter1`, `-iter2`, …) so each iteration persists a distinct run record.
- **`diffStability`** is a boundary effect, exactly like `runGate`: an injected
  deterministic checker that decides whether the proposed change has stopped
  changing across iterations. It receives `(prevRecord | null, currRecord, ctx)`
  where `ctx = { iteration, run_id, previous_run_id }` and returns
  `{ stable: boolean, code: string }`. Its `code` must be a **stable structural
  token** matching `^[a-z0-9][a-z0-9._:-]*$` (a marker like a gate command name),
  never prose — a free-form / human-readable code fails closed as
  `diff-checker-invalid` **before** it can reach the public debate summary,
  independent of any leak-pattern scan. A checker that throws a free-form string
  or prose error is normalized to the same safe fallback instead of persisting the
  thrown text.

Reference cap defaults from the spec (§9-Q2): 5 iterations primary, a
$100 / 10M-token per-run backstop. The loop does **not** hard-code them — it
requires the caller to pass concrete finite caps and fails closed otherwise.

## Convergence is EXACTLY diff-stability + objective-gate-pass

```
converged  ⇔  diff-stability (deterministic checker)  AND  objective-gate-pass
```

- **objective-gate-pass** means the iteration's run record shows
  `gate.kind === "objective"`, `gate.result === "pass"`, and
  `gate.source ∈ {exit-status, deterministic-checker}`. An *advisory* gate never
  counts — a gateless/advisory route can never converge (fail-closed direction).
- **diff-stability** comes only from the injected deterministic checker.

Both signals are **deterministic checkers, not models**. Model consensus, judge
approval, verifier approval, and synthesis confidence are **never** final
authority — none of them is consulted for convergence. The verifier stays advisory
(Stage 3E): because `runDispatch` never lets the verifier change `gate` or
`exit_status`, a positive verifier cannot rescue a debate whose gate never passes,
and a negative verifier cannot block a debate whose gate passes (both are tested).

## Mandatory hard caps (fail closed before iterating)

An iterating, gate-seeking loop must never run unbounded. Before **any** iteration:

- **`max_iterations`** — a finite integer `>= 1`, else fail closed
  (`missing-max-iterations` / `unbounded-max-iterations`).
- **`token_budget`** — a finite number `>= 0`, else fail closed
  (`missing-token-budget` / `unbounded-token-budget`). This is the **aggregate**
  token ceiling across iterations, distinct from (and stricter than) each cycle's
  own per-run cap. It is checked after each iteration; crossing it fails closed
  (`token-budget-exceeded`) — and the cap wins over convergence (an iteration that
  would converge but pushes the aggregate over budget still fails closed).
- **`diffStability`** — must be a function, else fail closed
  (`diff-checker-unavailable`).

## Fail-closed posture

| Condition | Code |
| --- | --- |
| Malformed debate request | `invalid-debate-request` |
| Missing / unbounded `max_iterations` | `missing-max-iterations` / `unbounded-max-iterations` |
| Missing / unbounded `token_budget` | `missing-token-budget` / `unbounded-token-budget` |
| Diff-stability checker missing | `diff-checker-unavailable` |
| Diff-stability output not `{stable, code}`, or `code` is not a structural token (`^[a-z0-9][a-z0-9._:-]*$`) | `diff-checker-invalid` |
| Diff-stability checker not deterministic (probed by a double call) | `non-deterministic-diff-checker` |
| An `ok`/`blocked` iteration returned no / an invalid run record | `invalid-iteration-output` |
| An iteration hard-failed **with** a valid run record (adapter/cap/envelope/config/public-safety …) — its usage/cap evidence is appended, never retried | `iteration-fail-closed` |
| An iteration hard-failed **without** a valid run record (a pre-panel stop: malformed request, unusable/unknown profile, classification stop, missing clock/adapter) | `iteration-fail-closed-no-record` |
| A TUI escalation surfaced inside an iteration (no UI to resolve it) | `iteration-escalation-unresolved` |
| Aggregate token budget exceeded across iterations | `token-budget-exceeded` |
| Single-pass (non-adversarial) route did not converge on its one pass | `single-pass-not-converged` |
| Ran the full `max_iterations` without converging (gate never passed and/or the diff never stabilized) | `not-converged-within-max-iterations` |
| The assembled debate summary tripped the public-safety scan | `public-safety-violation` |

Every fail-closed provider/cost/public-safety behavior of the underlying cycle is
preserved: a hard fail-closed inside an iteration **stops** the debate (it is a
refusal, not a "needs another round"), never a silent retry. Its usage/cap evidence
is **not discarded** — when the failed cycle still returned a valid run record (e.g.
a per-cycle token cap tripped *after* candidates launched), that record is appended
as a structural iteration summary (tokens counted into `total_tokens`, `cap_status`
and `warning_codes` preserved, `diff_result: "not-run"` / `diff_code:
"iteration-fail-closed"`) before the debate stops. Only a fail-closed with **no**
valid record (a pre-panel stop) has nothing to append and returns
`iteration-fail-closed-no-record`.

## Adversarial vs single-pass routes

A route "calls for adversarial iteration" iff it has a critic/arbiter role
(`redteam`, `judge`, or `synthesizer`) **and** the request did not set
`task.override.disable_adversarial`. Adversarial routes (`architecture`,
`security`, `risky-change`, `roadmap-reconciliation`, `pr-preflight`) may repeat up
to `max_iterations`. Non-adversarial routes (`trivial`, `routine-code`,
`ui-quality`) are **single-pass**: the loop runs them exactly once (recording the
`single-pass-route` warning) and never repeats — if that one pass does not
converge, it fails closed.

## Structural-only iteration summaries

The debate records a public-safe summary (built for every outcome that ran at least
one iteration; written to `${record_dir}/${run_id}.debate.json` when `record_dir`
is set). Per iteration it captures **only** structural fields: iteration number,
per-iteration `run_id`, `task_class` / `route_id`, `exit_status`, the gate
(`kind` / `result` / `source` / `gate_pass`), the diff (`diff_result` — `stable` /
`unstable`, or `not-run` for a hard-failed iteration — and `diff_code`),
`converged`, token counts, the structural `cap_status`, and the run record's stable
`warning_codes`. **No model narrative** (candidate / judge / synthesis / verifier
recommendation, risks, or open questions) ever enters the summary — the summary is
re-scanned with the same public-safety mechanism as run records and fails closed on
any leak.

## Deterministic under mock adapters

A fixed seed/input yields byte-identical per-iteration run records **and** a
byte-identical debate summary (asserted in tests, and the smoke's debate summary is
byte-identical across runs). Determinism holds because: per-iteration run_ids are
derived deterministically, the underlying cycle is deterministic (Stage 3C–3F), the
diff checker is deterministic (enforced by the double-call probe), and the summary
timestamp is the injected `now`.

## Running

```bash
npm test                              # includes tests/dispatch-debate.test.mjs
node tools/smoke/dispatch-smoke.mjs   # five deterministic mock cycles incl. the iterating debate
```

## Out of scope (next slices)

- **Real proposal revision + real diff computation** — **DONE in Stage 3H**
  ([`real-revision-diff-surface.md`](real-revision-diff-surface.md)). The real
  working-tree diff surface (`makeGitDiffStability`) and the injected `revise`
  boundary are now wired; a real **model-backed** builder→critic revision effect
  still needs live provider calls and remains out of scope.
- The **default-on `/adversarial off` surface** — **DONE in Stage 3H** as the pure
  `adversarial-policy.mjs` surface (opt-out via `task.override.disable_adversarial`,
  recorded as `adversarial-opt-out`; no new slash command).
- Real subprocess/subagent fan-out, parallel judge/synthesis/verifier stages, a
  chain registry, hosted `openrouter/fusion`, the aggregate ceiling attached to an
  unattended autonomous loop (Theme J / Phase 4), and any UI (live pipeline view).
- Any live/paid model call. The live OpenRouter `:free` smoke stays preflight-gated
  and was not run.
