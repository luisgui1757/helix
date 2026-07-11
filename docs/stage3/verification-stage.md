# Stage 3E — verification stage

> **Historical implementation record — not current operational documentation
> (superseded 2026-07-10).** This page preserves what the named stage shipped at
> the time. Some mechanisms may still exist, but cost/no-spend policy, token
> budgets, write allowlists, live enablement, and the referenced live smoke
> commands were later removed; no task-loop live transport ships. Use the
> [current design contracts](design-contracts.md) and [manual](../manual.md) for
> current behavior. Do not treat commands here as runnable unless they also
> appear in those current documents.


Adds the **verifier** role to the dispatch cycle: after the objective/advisory gate
result is captured, the verifier summarizes proof. It **never** determines the
recorded gate result — gate outcomes still come only from process exit status or a
deterministic checker. Same build boundary — no hosted adapter, no autonomous loop,
and no live provider call is made in this slice.

Source of truth:
[`docs/architecture/fusion-dispatch-research.md`](../architecture/fusion-dispatch-research.md)
§"Roles" (`verifier`: run objective/deterministic proof checks and summarize proof)
and §"Failure Behavior" ("the verifier summarizes proof but never determines the
recorded gate result. Gate outcomes enter the run record from process exit status
or a deterministic checker result").

## What shipped

| Piece | Responsibility |
| --- | --- |
| `dispatch/lib/verification.mjs` | `projectForVerification` — a pure, structural, public-safe proof summary (gate outcome, exit status, cap status, warning codes, refs). |
| `dispatch/lib/orchestrate.mjs` | Sequences the verification stage after gate capture; the gate result is captured (not early-returned) so the verifier runs on pass and fail. |
| `tests/dispatch-verification.test.mjs` | Runs-after-gate, can't-flip-fail→ok, can't-flip-ok→fail, missing config/hook, malformed/mismatched, narrative-not-persisted, gate-source-unchanged, no-verifier-route, and the substrate unit (13 tests). |

Where it runs (only when the route has a `verifier` role — `pr-preflight`):

```
candidate panel → [judge] → [synthesis] → caps → objective/advisory gate → VERIFICATION → record
```

## Contract

- **Injected, no ambient effects.** `deps.adapter.runVerifier({ exit_status, gate,
  cap_status, warning_codes, claims_ref, evidence_ref }, ctx)` is the only way the
  verifier is "called". A `verifier` route with no `request.verification` ⇒
  `missing-verification-config`; no `runVerifier` hook ⇒
  `adapter-missing-run-verifier`. The verifier provider/model passes the same
  pre-launch cost/provider-policy projection as a candidate (`verifier-not-eligible`).
- **Structural, public-safe input.** Unlike the synthesis projection (which
  forwards substantive role text to a downstream model), the verifier input is
  already record-safe: the gate's `command_names`/`kind`/`result`/`source`, the
  run's `exit_status` so far, the `cap_status`, the stable `warning_codes`, and the
  claims/evidence refs. No model narrative or provider payloads reach the verifier.
  The `cap_status.token_cap` here is the **effective enforced cap** — the parallel
  per-run budget when parallel is enabled, else the profile cap — the same value
  the run record carries, so the proof summary never understates the cap that
  actually governed the run.
- **Vetted output.** The returned envelope must validate (`stage: "verification"`,
  `role: "verifier"`) and match the vetted provider/model/run_id, or the run fails
  closed (`verification-envelope-invalid`).
- **Advisory only — never the gate.** The verifier summarizes proof but can never
  change the recorded gate result or the run's exit status:
  - a positive verifier (status `ok`, "approve") **cannot** turn a failed gate into
    success — the run stays `blocked`;
  - a negative verifier (status `blocked`, "reject") **cannot** turn a passed gate
    into failure — the run stays `ok`.
  Only the verifier's stable `status` enum is surfaced (in the returned result), and
  none of its narrative is persisted.
- **Cap-bound.** The verifier runs after the pre-gate cap check, so its own usage is
  re-checked against the profile caps (fail closed on a breach).

## Run record

No new record field is added (persisted shape unchanged, following the synthesis
precedent). The verifier is recorded structurally: `role_ids` lists `verifier`, its
provider/model appear in `provider_ids`/`model_ids`, and its usage counts in the
rollups. The recorded `gate` and `exit_status` come from the gate alone. The
verifier's advisory `status` is returned in the result object, never written to the
record; its recommendation/risks/narrative are never persisted.

## Running

```bash
npm test                              # includes tests/dispatch-verification.test.mjs
node tools/smoke/dispatch-smoke.mjs   # three deterministic mock cycles incl. pr-preflight verification
```

## Out of scope

The `documenter` verification role, real non-mock verifier adapters, any paid/live
model call, parallel dispatch, and multi-iteration / autonomous loops. The live
OpenRouter `:free` smoke stays preflight-gated
([`synthesis-nospend-adapter.md`](synthesis-nospend-adapter.md)) and is not run here.
