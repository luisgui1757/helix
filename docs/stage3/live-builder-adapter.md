# Stage 3J — live OpenRouter `:free` builder adapter

> **Historical implementation record — not current operational documentation
> (superseded 2026-07-10).** This page preserves what the named stage shipped at
> the time. Some mechanisms may still exist, but cost/no-spend policy, token
> budgets, write allowlists, live enablement, and the referenced live smoke
> commands were later removed; no task-loop live transport ships. Use the
> [current design contracts](design-contracts.md) and [manual](../manual.md) for
> current behavior. Do not treat commands here as runnable unless they also
> appear in those current documents.


Implements the first live `modelAdapter.runRevision` adapter for the Stage 3I
revision effect. The adapter uses Pi's native OpenRouter provider, restricted to
model ids ending in `:free`, and returns only structured whole-file edits to
`makeModelRevision`.

Source of truth:
[`docs/stage3/model-backed-revision.md`](model-backed-revision.md) §"Real adapter
boundary" and ROADMAP Phase-3 checklist ("Ship the live builder adapter").

## What shipped

| Piece | Responsibility |
| --- | --- |
| `dispatch/lib/openrouter-revision-adapter.mjs` | `createOpenRouterRevisionAdapter(config, deps)` — reads only caller-declared synthetic/public fixture paths, bounds the full outbound prompt with `max_input_bytes` before runner invocation, prompts Pi/OpenRouter with all tools/session/context/resources disabled, parses JSON edits, and throws stable codes on every runner/parser refusal. |
| `tests/dispatch-openrouter-revision-adapter.test.mjs` | No-live parser and fail-closed tests: strict/fenced JSON, malformed/non-JSON output, unallowlisted/sensitive paths, non-`:free` model refusal before runner invocation, oversized prompt refusal before runner invocation, runner failure with no raw output leak. |
| `tools/smoke/openrouter-free-revision-smoke.mjs` | Explicit live proof: fetches public OpenRouter metadata, writes a temp candidate, runs `nospend-preflight.mjs`, verifies Pi inventory, then injects the live adapter into `makeModelRevision` over a real temp git repo. |
| `tools/smoke/openrouter-free-multimodel-revision-smoke.mjs` | Stage 3N update: repeats the same no-spend proof path until two distinct current OpenRouter `:free` models complete the revision proof, or fails closed. |

## Live safety path

The live smoke is fail-closed in this order:

1. Fetch public OpenRouter `/api/v1/models` metadata for the candidate model
   (default: `openai/gpt-oss-20b:free`).
2. Require prompt and completion prices to parse as zero.
3. Write temp candidate metadata and run `node tools/smoke/nospend-preflight.mjs`.
4. Only after `ok-free-verified`, check Pi inventory.
5. Build the live builder prompt from synthetic/public fixture paths and fail closed
   with `openrouter-revision-input-too-large` if the complete outbound prompt would
   exceed `max_input_bytes` (default `32768`) before the adapter call count increments
   or Pi is invoked.
6. Run a real temp-repo debate where only the injected revision effect can mutate
   `proposal.txt`; convergence remains exactly diff-stability + objective-gate-pass.

The adapter/smoke do not read credential files (`auth.json`, `.env`, key files),
print credentials, or persist credentials; Pi may use existing authenticated provider
state/environment when it makes the OpenRouter call. The prompt contains only bounded
synthetic temp-repo fixture content, and returned/persisted artifacts remain
structural: refs, stable codes, counts, and pass/fail markers.

## Live proof

Run on 2026-07-07:

```bash
node tools/smoke/openrouter-free-revision-smoke.mjs
```

Result:

- OpenRouter public metadata for `openai/gpt-oss-20b:free`: prompt `0`,
  completion `0`.
- `nospend-preflight.mjs`: `SPEND-SAFE`, code `ok-free-verified`.
- Pi inventory: model visible as `openrouter openai/gpt-oss-20b:free`.
- Real temp repo debate: `ok`, converged in 3 iterations (`diff-baseline`,
  `diff-changing`, `diff-stable`), 2 revision calls, marker pass.

Stage 3N multi-model proof, also run on 2026-07-07:

```bash
node tools/smoke/openrouter-free-multimodel-revision-smoke.mjs
```

Result: current metadata, `nospend-preflight.mjs`, and Pi inventory passed for
`openai/gpt-oss-20b:free` and `cohere/north-mini-code:free`; both synthetic temp
repo debates converged with 2 live revision calls each. No paid call was made.

## Running

```bash
npm test
node tools/smoke/revision-effect-smoke.mjs
node tools/smoke/openrouter-free-revision-smoke.mjs
node tools/smoke/openrouter-free-multimodel-revision-smoke.mjs
```

The last command is a live call only after the no-spend preflight passes.
