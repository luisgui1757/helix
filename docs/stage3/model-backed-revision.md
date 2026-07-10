# Stage 3I — real model-backed revision effect

Turns the Stage 3H injected `revise` boundary from a hand-rolled deterministic
effect into a **real, provider-policed, model-backed** one: a `builder` model
produces the next proposal, the effect validates it and mutates the worktree, and
the debate's critic panel + **objective gate** close the loop. Same build boundary
as Stage 3B–3H: no subprocess fan-out, no hosted adapter, and **no live provider
call** in this slice (see [Real adapter boundary](#5-real-adapter-boundary--no-live-proof)).

Source of truth:
[`docs/architecture/fusion-dispatch-research.md`](../architecture/fusion-dispatch-research.md)
§"Multi-agent orchestration" (`builder`: implement the selected plan) and ROADMAP
§7-Theme B / Phase-3 checklist ("Wire a real model-backed revision effect — a
builder→critic loop that actually revises the proposal — into the Stage 3H `revise`
boundary").

## What shipped

| Piece | Responsibility |
| --- | --- |
| `dispatch/lib/revision-effect.mjs` | `makeModelRevision(config, deps)` — builds a real `revise(revisionState, ctx)` boundary effect: validates config/caps, **projects provider/cost policy before any model call**, calls an injected model adapter, validates + path-guards the returned edits, mutates the worktree all-or-nothing with rollback on disk write failure, and returns only a structural `revision_ref` + stable code. |
| `dispatch/lib/provider-policy.mjs` | `projectProviderPolicy(spec, {profile, now})` + `clampPriceToProfile` — the **single** pre-launch provider/cost gate, extracted from the orchestrator so the dispatcher and the revision effect refuse ineligible providers through one vetted copy (no drift). |
| `tests/dispatch-revision-effect.test.mjs` | Unit refusals (cost/provider before the model call, caps, config, malformed output, path safety) + real temp-repo debate integration (convergence, cost refusal, thrown-adapter leak, determinism). |
| `tools/smoke/revision-effect-smoke.mjs` | Deterministic smoke: a real temp git repo, a mock model adapter, a real revision effect + real diff surface converging a debate — structural output only. |
| `dispatch/lib/openrouter-revision-adapter.mjs` | **Stage 3J update:** the first live adapter for this boundary, restricted to OpenRouter `:free` models and synthetic/public fixture paths. |
| `tools/smoke/openrouter-free-revision-smoke.mjs` | **Stage 3J update:** preflight-gated live proof over `makeModelRevision` and a real temp git repo. |

`debate.mjs` is **unchanged** by this slice: the effect is injected exactly like
`makeGitDiffStability`, so all worktree/model side effects stay in the boundary
effect and dependencies still flow inward (the dispatch core imports nothing new).

## 1. The revision effect

```js
const revise = makeModelRevision(
  { cwd, profile, input_class, builder: { provider, model, effort?, price? }, allow, caps: { max_edits, max_bytes } },
  { modelAdapter, now },
);
// revise(revisionState | null, ctx) → { ok, revision_ref, code }   // async; the deps.revise shape
```

Per call, in order (each step fails closed with a stable code before the next):

1. **Config + caps boundary.** `REVISION_CONFIG_SCHEMA` structural check; `max_edits`
   / `max_bytes` must be finite positive integers (an unbounded/`Infinity`/missing
   cap ⇒ `unbounded-revision-caps`); the profile resolves + is usable and accepts
   `input_class`; `deps.now` is a finite clock; `deps.modelAdapter.runRevision` is a
   function.
2. **Worktree root.** `cwd` must be a real directory; its realpath is the canonical
   root for containment checks.
3. **Pre-launch provider + cost projection** (before **any** model call) via the
   shared `projectProviderPolicy` gate: an ineligible/non-automated provider, an
   unknown/stale/unsourced price, or a missing/stale Copilot pin refuses here — the
   model adapter is **never** touched (call count stays 0).
4. **Model call** through the injected adapter (the real adapter boundary). A thrown
   adapter fails closed `revision-adapter-failed`; **its message is never surfaced**.
5. **Output validation** against `REVISION_OUTPUT_SCHEMA` (`{ edits: [{path, content}] }`);
   malformed output ⇒ `revision-malformed`, and **no model text is surfaced**. Then
   the edit count ≤ `max_edits` and total content bytes ≤ `max_bytes`.
6. **Path safety** for every edit (see §2), collected before any mutation.
7. **Apply** each edit to the worktree all-or-nothing (the only mutation this effect
   performs): original target contents are snapshotted before writing and restored if a
   later disk write fails. Then return `{ ok:true, revision_ref: "sha256:…",
   code:"revision-applied" }`. The ref is a content hash over the sorted edits —
   structural, deterministic, and different for different content (never canned).

The revision input handed to the adapter is structural and provider-bound:
`{ role:"builder", run_id, iteration, previous_revision_ref }`. A live adapter enriches
this with the worktree + prior critique and parses the model's edits; nothing of it is
persisted.

## 2. Worktree write safety (Stage 3H diff-surface rules applied to writes)

The revision is the only thing allowed to mutate the tree, so its writes carry the
same rules the Stage 3H diff surface applies to reads:

- **Tracked changes** (the primary proposal medium, e.g. an edited `proposal.txt`)
  are content-hashed by the diff surface via `git diff` — no allowlist needed there.
- **A path must be explicitly allowlisted** to be written (`config.allow`, repo-relative).
  The default (empty) allowlist makes every write fail closed (`revision-path-not-allowed`).
  For a **new** file a revision creates, keep this in sync with the diff surface's
  `untracked_policy.allow`.
- **Credential/private-shaped paths are refused even if allowlisted** (`.env*`,
  `auth.json`, `*.pem`/`*.key`, `id_rsa*`, `*secret*`/`*token*`/`*credential*`, …) —
  `revision-unsafe-sensitive`, the denylist wins (shared `isSensitiveUntrackedPath`).
- **Unsafe paths** fail closed (`revision-unsafe-path`): a traversal (`..`), an
  absolute path, a null byte, a symlink target (never followed/overwritten), a
  non-regular existing target, or a parent that resolves outside the work tree.

### Fail-closed matrix (revision effect)

| Condition | Code |
| --- | --- |
| config shape invalid / builder missing | `invalid-revision-config` |
| `max_edits`/`max_bytes` missing, non-integer, ≤ 0, or `Infinity` | `unbounded-revision-caps` |
| string profile id unknown | `unknown-revision-profile` |
| profile not usable (e.g. lockdown without caps) | `revision-profile-not-usable` |
| profile does not accept `input_class` | `revision-input-class-not-allowed` |
| `deps.now` is not a finite clock | `revision-missing-clock` |
| `deps.modelAdapter.runRevision` missing | `revision-missing-adapter` |
| provider/cost refused pre-launch | the shared gate code (`provider-not-eligible:…`, `no-spend-refusal:…`, `cost-projection-refusal:…`) |
| model adapter threw | `revision-adapter-failed` |
| model output malformed | `revision-malformed` |
| edits exceed `max_edits` / total bytes exceed `max_bytes` | `revision-too-many-edits` / `revision-too-large` |
| unsafe write path (traversal/absolute/null/symlink/non-file/outside-tree) | `revision-unsafe-path` |
| credential/private-shaped write path (even if allowlisted) | `revision-unsafe-sensitive` |
| write path not allowlisted | `revision-path-not-allowed` |
| a write failed on disk | `revision-write-failed` after restoring earlier targets |

`runDebate` surfaces a returned `code` only when it is a stable-code marker
(`^[a-z0-9][a-z0-9._:-]*$`), as `revision-subcode:<code>`; every code above matches.
So a private path / raw provider error / model narrative can never reach
`result.detail`, `warnings`, the summary, or a run record.

## 3. Builder→critic composition

The effect is the **builder** half of the loop. The **critic** half is the debate
itself: each iteration's reviewer/redteam panel and, decisively, the **objective
gate**. The composed loop is: revise (builder produces the next proposal) → next
iteration's panel critiques it → objective gate. Because a model producing a revision
is never final authority (hard boundary), there is deliberately **no** second,
convergence-gating "critic" model call inside the effect — that authority belongs to
the objective gate, and the debate panel already critiques every iteration.

## 4. Objective gate remains final authority

Convergence is still **exactly** diff-stability + objective-gate-pass, both
deterministic checkers. A real model-backed revision does not change who decides: a
model can propose any edit, but the debate converges only when the real git diff
surface reports the proposal stopped changing **and** the objective gate passes. A
revision that keeps changing the tree, or one the gate rejects, never converges.

## 5. Real adapter boundary / Stage 3J live proof

`deps.modelAdapter.runRevision(input, ctx) → { edits }` **is** the real adapter
boundary. A live builder adapter (OpenRouter/OpenAI/etc.) implements it by prompting a
model and parsing its structured edits; the module's pre-launch `projectProviderPolicy`
re-checks provider/cost policy before that call regardless of who wrote the adapter.

Stage 3I itself made no live call: it exercised the effect with a deterministic
in-process adapter. **Stage 3J now ships the first live adapter**:
[`dispatch/lib/openrouter-revision-adapter.mjs`](../../dispatch/lib/openrouter-revision-adapter.mjs)
and the explicitly scoped proof
[`tools/smoke/openrouter-free-revision-smoke.mjs`](../../tools/smoke/openrouter-free-revision-smoke.mjs).

The live proof still follows the same fail-closed maintainer preflight: it fetches
current public OpenRouter metadata, requires prompt/completion price `0`, writes temp
candidate metadata, runs `nospend-preflight.mjs`, verifies Pi inventory, and only then
injects the live adapter into `makeModelRevision` over a synthetic temp repo. On
2026-07-07, `openai/gpt-oss-20b:free` passed with `ok-free-verified`; the temp-repo
debate converged in 3 iterations (`diff-baseline`, `diff-changing`, `diff-stable`)
after 2 live builder revision calls.

A live proof on a **private** repo needs a metered/subscription profile (`personal`) —
that is real spend and is out of scope for a no-spend proof.

## Out of scope (next slices)

- Any **paid** call, any `personal`/`lockdown` metered run, or any non-OpenRouter live
  revision adapter.
- Real subprocess / subagent fan-out, parallel judge/synthesis/verifier stages,
  and the hosted `openrouter/fusion` adapter. The lean agent-team defaults shipped
  in Stage 3K ([`agent-team-defaults.md`](agent-team-defaults.md)); the chain
  registry, per-role matrix, bounded task-loop, and run manager shipped in Stage
  3L/M/N ([`role-matrix-task-loop.md`](role-matrix-task-loop.md)).
- The unattended **autonomous loop** and its aggregate session/daily ceiling (Theme J /
  Phase 4), and any UI beyond this policy surface.

## Running

```bash
npm test                                   # includes tests/dispatch-revision-effect.test.mjs
node tools/smoke/revision-effect-smoke.mjs # real temp repo + mock model adapter; converges via a real revision
node tools/smoke/openrouter-free-revision-smoke.mjs # live; preflight-gated OpenRouter :free proof
node tools/smoke/openrouter-free-multimodel-revision-smoke.mjs # live; two-model :free proof
```
