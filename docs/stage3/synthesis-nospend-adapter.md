# Stage 3D — synthesis stage + preflight-gated no-spend adapter

> **Historical implementation record — not current operational documentation
> (superseded 2026-07-10).** This page preserves what the named stage shipped at
> the time. Some mechanisms may still exist, but cost/no-spend policy, token
> budgets, write allowlists, live enablement, and the referenced live smoke
> commands were later removed; no task-loop live transport ships. Use the
> [current design contracts](design-contracts.md) and [manual](../manual.md) for
> current behavior. Do not treat commands here as runnable unless they also
> appear in those current documents.


Two additions to the dispatch cycle built in Stage 3C: a real **synthesis** stage
and the first **preflight-gated** no-spend OpenRouter `:free` adapter smoke. Same
build boundary as before — no hosted adapter, no autonomous loop, and no live
provider call is made in this slice.

Source of truth:
[`docs/architecture/fusion-dispatch-research.md`](../architecture/fusion-dispatch-research.md)
(§"Roles" — the `synthesizer` produces the final recommendation from the judge
analysis and preserved disagreements; §"Judge-Bias Mitigations" — "the
synthesizer must quote unresolved contradictions into the final output instead of
averaging them away"; §"Provider And Cost Policy" — OpenRouter `:free` two-part
eligibility).

## Synthesis stage

| Piece | Responsibility |
| --- | --- |
| `dispatch/lib/synthesis.mjs` | `detectContradictions`, `contradictionsDropped`, `projectForSynthesis` — pure helpers (identity/cost-stripped role-output projection). |
| `dispatch/lib/orchestrate.mjs` | Sequences the synthesis stage after the judge, before the objective gate. |
| `tests/dispatch-synthesis.test.mjs` | Success, malformed/mismatched/missing-hook fail-closed, contradiction preserve/drop, judge-advisory-gate-final, no-synthesizer-route, public-safe record, and the substrate units. |

Where it runs (only when the route has a `synthesizer` role — `architecture`,
`security`, `roadmap-reconciliation`):

```
candidate panel → blinded advisory judge → SYNTHESIS → objective gate → record
```

Contract:

- **Injected, no ambient effects.** `deps.adapter.runSynthesis({ rubric_id,
  candidate_summaries, judge_summary, contradictions }, ctx)` is the only way the
  synthesizer is "called". Missing hook on a synthesizer route ⇒
  `adapter-missing-run-synthesis`; missing `request.synthesis` ⇒
  `missing-synthesis-config`.
- **Identity/cost-stripped role-output projection (not a public-safe artifact).**
  `projectForSynthesis` strips provider/model/cost identity and raw payloads, but
  it deliberately forwards the candidates' and judge's substantive role output
  (recommendation, risks, uncertainty, open questions) so the synthesizer can
  actually synthesize. That text is model output governed by the run's
  profile/input/provider policy and is passed only between injected in-process
  adapters — it is **not** a public-safe record artifact. The public-safe
  guarantee is on the run record (below), which persists none of this text.
- **Vetted output, projected before launch.** The returned envelope must validate
  (`stage: "synthesis"`, `role: "synthesizer"`) and match the vetted
  provider/model/run_id, or the run fails closed (`synthesis-envelope-invalid`).
  The synthesis provider/model passes the same pre-launch cost/provider-policy
  projection as a candidate, validated **before any adapter call** — a metered
  synthesizer with missing/unknown/stale price, or a `github-copilot` synthesizer
  without a fresh matching profile pin, fails closed (`synthesis-not-eligible`)
  before the panel launches.
- **Contradictions preserved, not averaged away.** `detectContradictions` collects
  the contradiction markers the candidates themselves flagged (risk / open-question
  / uncertainty entries matching a contradiction sentinel). The synthesis envelope
  must carry **every** marker forward; a dropped marker fails the run closed
  (`synthesis-dropped-contradiction`). When contradictions exist and are preserved,
  the record carries the stable `contradiction-preserved` warning.
- **Advisory, like the judge.** Synthesis never decides success — the objective
  gate does. A failed gate still `blocked`s the run regardless of the synthesis
  output. Nothing from the synthesis envelope's substance (recommendation, risks,
  open questions) enters the public run record; only structural rollups, refs, and
  warning codes do.

## No-spend OpenRouter `:free` adapter smoke

| Piece | Responsibility |
| --- | --- |
| `tools/smoke/nospend-preflight.mjs` | Mechanical no-spend gate (Stage 3B) — pure `evaluateNoSpend`, no network, no credentials. |
| `tools/smoke/openrouter-free-dispatch-smoke.sh` | Preflight-gated wrapper: runs the preflight **first**, only then the live `:free` call. |
| `tools/smoke/openrouter-free-smoke.sh` | The live Pi OpenRouter `:free` call (Stage 0), unchanged. |
| `tools/smoke/fixtures/openrouter-free-candidate.json` | Public-safe candidate metadata (intentionally stale). |

Order of operations (spec-required): the mechanical gate decides whether a
candidate is spend-safe **before** any provider call. A candidate must be
`provider: openrouter`, a model id ending in `:free`, with fresh
(`verified_at` within a finite non-negative TTL, clamped by profile policy),
verified, zero `unit_price_usd`, and a non-empty `source`. Anything else — a
non-`:free` id, a real provider, unknown/stale/no-source/nonzero price, or a
non-finite TTL — fails closed and **no live call is made**.

Reading credentials is never required: Pi auth flows through the user's existing
login/session exactly as the Stage 0 smoke already does. Output is structural
only — provider, model id, preflight decision, pass/fail — never prompts or
responses.

### Live smoke status in this slice: SKIPPED (fail closed)

The committed candidate metadata carries a deliberately stale `verified_at`
(`2026-01-01`), so the mechanical preflight refuses it (`refused-price-stale`)
and the wrapper stops **before** any provider call. This is the honest, safe
default: the live smoke could only run if current OpenRouter metadata proved the
model is still `:free` / zero-price with a current source, and obtaining that
without reading credentials or making a paid call is out of scope for this slice.

To run the live smoke, a maintainer refreshes `verified_at` (and re-confirms the
model is still `:free` / zero price) in the candidate fixture from current
provider metadata, then:

```bash
tools/smoke/openrouter-free-dispatch-smoke.sh            # default candidate fixture
tools/smoke/openrouter-free-dispatch-smoke.sh my.json    # or a maintainer-supplied candidate
```

## Running

```bash
npm test                                       # node tests (incl. synthesis + preflight) + shell self-tests
node tools/smoke/dispatch-smoke.mjs            # two deterministic mock cycles (routine + synthesis)
tools/smoke/openrouter-free-dispatch-smoke.sh  # preflight-gated; fails closed on the stale default
```

## Out of scope (unchanged boundary)

Real non-mock candidate/judge/synthesis adapters, any paid/live model call beyond
the single preflight-gated OpenRouter `:free` smoke, the hosted `openrouter/fusion`
adapter, TUI spend-confirmation flows, parallel launch, multi-iteration /
autonomous loops, and the verification stage.
