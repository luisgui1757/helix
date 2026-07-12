# Stage 3B — dispatch-policy-core

> **Historical implementation record — not current operational documentation
> (superseded 2026-07-10).** This page preserves what the named stage shipped at
> the time. Some mechanisms may still exist, but cost/no-spend policy, token
> budgets, write allowlists, live enablement, and the referenced live smoke
> commands were later removed; no task-loop live transport ships. Use the
> [current design contracts](design-contracts.md) and [manual](../manual.md) for
> current behavior. Do not treat commands here as runnable unless they also
> appear in those current documents.


The first Stage-3 code substrate: a **pure, fail-closed policy/config/schema/
run-record layer** for the Fusion-style dispatch architecture. It is **not** the
orchestrator — it launches no models, opens no sockets, and reads no credentials.
It is the deterministic policy core consumed by the Stage 3C thin orchestrator
([`dispatch-orchestrator.md`](dispatch-orchestrator.md)).

Source of truth: [`docs/architecture/fusion-dispatch-research.md`](../architecture/fusion-dispatch-research.md)
(the accepted Stage 3A spec).

## What shipped

All code is dependency-free `.mjs` under `dispatch/`, tested by `node --test`.

| Module | Responsibility |
| --- | --- |
| `dispatch/lib/schema.mjs` | Minimal runtime structural validator (JSON-Schema-shaped; fail-closed `assertValid`). |
| `dispatch/lib/role-envelope.mjs` | Role envelope schema + role/stage matrix + `validateRoleEnvelope` / `assertRoleEnvelope`. |
| `dispatch/lib/providers.mjs` | Canonical Helix provider set + canonical→Pi source mapping. |
| `dispatch/lib/cost-policy.mjs` | No-spend eligibility + price-staleness (`evaluateNoSpend`, `isPriceFresh`). |
| `dispatch/lib/profiles.mjs` | Profile config schema + built-in `no-spend-test` / `personal` / `lockdown` + Copilot-pin metadata. |
| `dispatch/lib/routes.mjs` | Task-class routes + reserved `role→[{provider,model,effort,instances}]` matrix + `resolvePanel` (N3). |
| `dispatch/lib/classify.mjs` | Deterministic classifier + classification floors + fail-closed non-TTY escalation. |
| `dispatch/lib/judge.mjs` | Judge-bias projection (blinding, A/B/C re-key, seed/permutation, reveals) + judge-in-panel check. |
| `dispatch/lib/run-record.mjs` | Public-safe run-record builder/serializer/writer + mechanical leak scan. |
| `dispatch/fixtures/` | Deterministic sample builder + the five spec evaluation fixtures with oracles. |
| `tools/smoke/nospend-preflight.mjs` | Mechanical no-spend gate (no network, no credentials) fronting any live `:free` smoke. |

Tests live in `tests/dispatch-*.test.mjs` and run under the existing `npm test`.

## Why the validator is not literal TypeBox (recorded contradiction)

The spec mandates TypeBox as the runtime validator. Implementation exposed a real
contradiction with an enforced repository invariant:

- `tools/check-helix-resources.mjs` **fails the build** if `package.json` declares
  any runtime dependency (`dependencies` / `optionalDependencies` /
  `peerDependencies` must be empty). It also **pins `extensions/` to exactly the
  two existing `.ts` files**, so a TypeBox schema cannot be smuggled in as a new
  Pi-loaded extension.
- The bare `typebox` specifier resolves **only inside Pi's runtime**; under
  `node --test` it is `MODULE_NOT_FOUND`. There is no `node_modules`, no
  lockfile, and no TypeScript toolchain in this repo.

So a literal-TypeBox, *tested*, runtime validator is not achievable without adding
an installed dependency, which the zero-dependency/offline posture forbids.

**Resolution (per the spec's own escalation clause — fix the spec in the same
PR):** the runtime validator (`schema.mjs`) is a pure, zero-dependency
structural checker whose schema descriptors are authored in the **same
JSON-Schema shape `Type.Object(...)` emits**. They are drop-in portable to real
TypeBox the moment the dispatcher is wired into a Pi extension (where `typebox`
is available at runtime). This preserves the spec's actual requirement —
*runtime, not TypeScript-only, fail-closed validation* — while keeping every gate
green. The spec's Role Schema section records this reconciliation.

## Deferred review items now pinned

- **N3 (profile-cap vs route min_successes precedence)** —
  `resolvePanel(route, profile)` in `routes.mjs`: profile caps are **maxima**; a
  route's `min_successes` applies to the **launched** candidates; any reduction is
  recorded as a `panel-capped-by-profile` warning; a cap that pushes the panel
  below the route minimum, or required successes above the launched count, **fails
  closed**. No silent panel shrink.
- **N4 (price-verification TTL / source)** — `price_ttl_seconds` /
  `copilot_pin_ttl_seconds` on profiles, `verified_at` + `source` +
  `ttl_seconds` on price and Copilot-pin metadata. `isPriceFresh` requires an
  explicit `verified` status, a non-future `verified_at`, a finite
  non-negative TTL, and freshness within TTL; anything else is stale and fails
  closed.

## Failure posture (fail closed)

- Malformed role output is rejected by `assertRoleEnvelope` before it can reach
  judge/synthesis.
- Unknown/stale/missing price metadata, real providers, and non-`:free`
  OpenRouter ids are refused by `evaluateNoSpend`.
- Uncertain classification routes upward; when nothing anchors it, non-TTY modes
  are a recorded fail-closed stop (mirrors the yolo-fence `ctx.mode === "tui"`
  rule).
- The run-record builder rejects free-text claims/evidence refs, hashes
  other-repo branch/paths, validates usage USD fields as nonnegative or `null`,
  and runs a mechanical public-safety scan (macOS/Linux/Windows home paths,
  session URLs, provider keys, auth tokens, provenance) — throwing rather than
  persisting a leak.
- The judge is never final authority: `gate.source` is constrained to
  `exit-status` / `deterministic-checker` (a model narrative is not a legal gate
  source). Where no objective gate exists, output is advisory and the human is
  final.

## Running

```bash
npm test                 # includes tests/dispatch-*.test.mjs
node tools/smoke/nospend-preflight.mjs <synthetic-candidate.json>   # mechanical gate; no network
```

## Out of scope (unchanged from the spec build boundary)

Hosted `openrouter/fusion` adapter, any paid/live model call, real
Copilot/OpenAI/Claude/Azure calls, Azure Foundry live tests, autonomous loops
beyond one dispatch depth, live pipeline UI, `pi-messenger`, and replacing
objective gates with a model judge. A **live** OpenRouter `:free` smoke was
intentionally **not run** in this slice (see the PR notes): the mechanical
preflight and pure tests land first; live execution is deferred to avoid any
spend ambiguity.
