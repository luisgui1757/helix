# Stage 3F — thin parallel / multi-team dispatch

> **Historical implementation record — not current operational documentation
> (superseded 2026-07-10).** This page preserves what the named stage shipped at
> the time. Some mechanisms may still exist, but cost/no-spend policy, token
> budgets, write allowlists, live enablement, and the referenced live smoke
> commands were later removed; no task-loop live transport ships. Use the
> [current design contracts](design-contracts.md) and [manual](../manual.md) for
> current behavior. Do not treat commands here as runnable unless they also
> appear in those current documents.


Adds a thin, **opt-in** bounded-parallel candidate launch to the one-cycle pipeline,
plus a lean cross-family advisory. Sequential launch stays the default — no existing
caller changes behavior. Same build boundary: no subprocesses, no network, no
hosted adapter, no autonomous loop, no live provider call.

Source of truth:
[`docs/architecture/fusion-dispatch-research.md`](../architecture/fusion-dispatch-research.md)
§"Dispatch Policy" (every fan-out is bounded by a concurrency cap + per-run token
budget) and §"Multi-agent orchestration" (cross-family diversity is *encouraged*,
warned when unmet — never a hard blocker with mock providers).

## Built on the Pi subagent pattern

The ROADMAP directs the parallel layer to be built thinly on Pi's
`examples/extensions/subagent`. That extension (found at
`@earendil-works/pi-coding-agent/examples/extensions/subagent`) runs parallel tasks
via `mapWithConcurrencyLimit(items, concurrency, fn)` — a fixed pool of
`min(concurrency, n)` workers that pull the next index off a shared counter and
**collect results in input order** (`MAX_PARALLEL_TASKS = 8`, `MAX_CONCURRENCY = 4`).
Helix does **not** spawn `pi` subprocesses (that is a live/tooling concern out of
scope here); it reproduces just the pure concurrency-limiter shape in
`dispatch/lib/parallel.mjs`, over injected adapters, deterministic and dependency-free.

## What shipped

| Piece | Responsibility |
| --- | --- |
| `dispatch/lib/parallel.mjs` | `mapWithConcurrency` (bounded in-flight, **input-order** results) + `effectiveTokenBudget` (stricter finite ceiling; `null` = unbounded). |
| `dispatch/lib/orchestrate.mjs` | opt-in `deps.parallel`; validates cap + budget; parallel candidate launch processed in index order; post-launch token-budget check; cross-family advisory. |
| `dispatch/lib/providers.mjs` | `PROVIDER_FAMILY` / `providerFamily` for the cross-family warning. |
| `tests/dispatch-parallel.test.mjs` | determinism, concurrency cap, failure isolation, budget/cap fail-closed, effective-cap recording, unknown-cost, no-leak, cross-family, and the substrate units (13 tests). |

## Opt-in contract

Parallel launch is enabled only when `deps.parallel` is present:

```js
deps.parallel = { max_concurrency: 4, token_budget: 1_000_000 }
```

- **Absent ⇒ sequential** (the Stage 3C–3E behavior, byte-for-byte unchanged).
- **`max_concurrency`** must be an integer `>= 1`, else fail closed
  (`invalid-concurrency-cap`) **before any launch**. At most `max_concurrency`
  `runCandidate` calls are in flight; work never spawns unbounded (in-flight is
  bounded by the cap, and the panel is already bounded by `max_candidates`).
- **Per-run token budget**: the effective budget is the stricter finite value of
  `deps.parallel.token_budget` and the profile `token_cap`. If **neither** is
  bounded, parallel fails closed (`unbounded-parallel-budget`) — an unknown /
  unbounded budget never runs. Post-launch, total tokens over the budget fail
  closed (`token-budget-exceeded`), enforced over candidates + judge + synthesis +
  verifier. The run record's `cap_status.token_cap` records this **effective
  enforced budget** (not just the profile cap), so it is never `null` while a
  finite budget actually governed the run — this holds on the ok record and on a
  `token-budget-exceeded` fail-closed record alike.

## Deterministic output (parallelism never changes results)

Candidates launch concurrently, but their results are **processed in candidate-index
order** (the `mapWithConcurrency` results array is input-ordered). So completion
order can never change the `candidates`/`outcomes` array, the `launched` set, the
judge projection, the warning order, the run record, or the smoke hashes.

Concretely: two parallel runs of the **same config** produce byte-identical records
(a test asserts this, and the smoke's parallel scenario is byte-identical across
runs), and parallel yields the **same candidate outcomes** as a sequential run of
the same request. A parallel run's record is *not* byte-identical to the sequential
one in general — they differ in `cap_status.token_cap`, which correctly records the
effective enforced budget (a finite parallel budget) versus the sequential profile
cap (which may be `null`). Determinism is asserted via same-config byte-identity and
identical candidate ordering, never by hiding the runtime cap.

## Preserved gates (unchanged)

Every existing gate still runs, in the same order: pre-launch provider/cost
projection (incl. Copilot pin), boundary envelope validation + vetted-spec match,
`min_successes`, cap checks (unknown-cost / token / USD), judge advisory-only,
synthesis contradiction preservation, objective gate final, verifier advisory-only.
A failed parallel candidate is isolated (recorded `adapter-error` at its index) and
still counts against `min_successes` (fail closed when unmet).

## Multi-team (lean): cross-family advisory

The only multi-team piece in this slice is a **cross-family warning**: on routes
with `requires_cross_family` (`architecture`, `security`), if the launched candidate
providers span fewer than two model families (`providerFamily`), the run records the
stable `cross-family-not-satisfied` warning. It is **advisory only** — never a
blocker — so an all-`mock` panel warns but still succeeds. The default team shape is
the route's role panel (e.g. `risky-change` = builder + reviewer + redteam); no
autonomous iteration loop is introduced.

## Running

```bash
npm test                              # includes tests/dispatch-parallel.test.mjs
node tools/smoke/dispatch-smoke.mjs   # four deterministic mock cycles incl. bounded-parallel risky-change
```

## Out of scope (next slices)

- Real subprocess/subagent fan-out (Pi `subagent`) and parallel
  judge/synthesis/verifier stages. The chain registry shipped later in Stage
  3L/M/N ([`role-matrix-task-loop.md`](role-matrix-task-loop.md)).
- Full multi-team / adversarial debate with iteration loops and convergence (this
  slice ships only the cross-family advisory). The bounded iterating debate loop
  landed next in **Stage 3G** ([`iterating-debate.md`](iterating-debate.md)); real
  proposal revision + a real working-tree diff remain beyond it.
- Any live/paid model call, the hosted `openrouter/fusion` adapter, and UI. The live
  OpenRouter `:free` smoke stays preflight-gated and was not run.
