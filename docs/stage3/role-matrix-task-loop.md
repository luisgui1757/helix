# Stage 3L-M/N — role matrix, chains, and bounded task loop

> **Historical implementation record — not current operational documentation
> (superseded 2026-07-10).** This page preserves what the named stage shipped at
> the time. Some mechanisms may still exist, but cost/no-spend policy, token
> budgets, write allowlists, live enablement, and the referenced live smoke
> commands were later removed; no task-loop live transport ships. Use the
> [current design contracts](design-contracts.md) and [manual](../manual.md) for
> current behavior. Do not treat commands here as runnable unless they also
> appear in those current documents.


Stage 3L-M/N turns the Stage 3B-J primitives into a bounded, reviewable daily-use
loop entrypoint without a hosted adapter. Stage 3O/P adds `/helix` as the
Pi-native UX layer over these config/loop surfaces while keeping execution
preflight-only.

Source of truth: ROADMAP Phase 3 / Theme J and
[`docs/architecture/fusion-dispatch-research.md`](../architecture/fusion-dispatch-research.md).

## What shipped

| Piece | Responsibility |
| --- | --- |
| `dispatch/lib/role-matrix.mjs` | Validates `role -> [{ provider, model, effort, instances, price? }]`, expands entries deterministically, enforces profile and token caps, projects provider/cost policy before launch, and warns/enforces provider diversity per route/profile policy. |
| `dispatch/config/role-matrix-defaults.json` | No-live default matrix for Builder, Reviewer, RedTeam, Scout, Planner, Judge, Synthesizer, and Verifier roles. |
| `dispatch/lib/chains.mjs` / `dispatch/config/chains.json` | Named chain defaults: `implement-review-fix`, `scout-flow`, and `ship-pre-pr`. Unknown or malformed chains fail closed; chains are config, not commands. |
| `dispatch/lib/run-configs.mjs` / `dispatch/config/run-configs.json` | Named run configs with profile, chain, role matrix, hard caps, write allowlist, objective gate, refs, and `live.enabled:false` validation. |
| `dispatch/lib/task-loop.mjs` | Composes run config -> chain -> route -> role matrix -> `runDebate` with real git diff stability, real revision-effect write guards, deterministic objective gate, and no-live mock adapters by default. |
| `tools/loop/helix-task-loop.mjs` | CLI smoke/runbook entrypoint. Defaults to a cleaned synthetic temp git repo and structural records under `dispatch/runs/<run-id>/`. |
| `dispatch/lib/run-manager.mjs` / `tools/runs/helix-runs.mjs` | Structural run directory hygiene plus `list`, `status`, explicit `prune` over gitignored JSON records only, and non-prunable labels for flat smoke records. |
| `extensions/helix-command.ts` / `extensions/lib/helix-command-core.mjs` | One `/helix` slash command for resolved dashboard, `/helix help`, run preflight, view-only model/chain/profile browsers, structural run list/status, and TUI-confirmed prune. |
| `tools/worktree/helix-worktree.sh` | Worktree manager hardening: remove refuses the current worktree and dirty worktrees; merge refuses a dirty source worktree. |
| `tools/smoke/openrouter-free-multimodel-revision-smoke.mjs` | Live no-spend proof path for at least two distinct OpenRouter `:free` revision models after current metadata, preflight, and Pi inventory pass. |

## Loop contract

The task-loop entrypoint is deliberately fail-closed:

- `max_iterations`, `token_budget`, profile, chain, role matrix, write allowlist,
  and objective gate are required before the loop can run.
- Provider/cost policy is projected during matrix expansion and again by the
  Stage 3 launch/revision boundaries before an adapter can run.
- Matrix expansion is deterministic: route role order, entry order, then instance
  number.
- Singleton stages (`judge`, `synthesizer`, `verifier`) must expand to one spec.
- Candidate count is bounded by route and profile caps; candidate instances must
  fit the finite loop token budget.
- Run config `max_iterations` and finite `token_budget` cannot exceed the resolved
  profile caps; exceeding them fails closed before any adapter runs.
- The revision-backed task loop is executable only for builder-bearing chains.
  Non-builder defaults such as `scout-flow` and `ship-pre-pr` are registry data,
  but the task-loop entrypoint refuses them with
  `chain-not-loop-runnable:<id>` until a non-builder revision strategy exists.
- The no-spend default is no-live. Live calls require an explicit smoke/tool path
  that proves current zero price and inventory first.
- Objective gates are final authority. Model, judge, verifier, and synthesis
  approval never establish convergence.
- Objective gate file reads use the same final-path safety posture as revision
  writes: the configured path must be allowlisted, non-sensitive, a regular file
  rather than a symlink, and its final realpath must stay inside the real worktree
  root before any bytes are read. Unsafe gate paths record a deterministic gate
  failure with `unsafe-gate-path`; outside files cannot satisfy the gate.
- Inline profile objects are trusted local config in this slice after
  `assertProfileUsable` validates their shape. Their `id` selects the same
  profile policy posture as a built-in profile. Broader semantic policy fields
  are reserved for a future external profile loader, not inferred here.
- `/helix help` is view-only, public-safe, works before local registries are
  loaded, and reports the supported verbs, no-live/live/paid boundaries, and
  stable refusal-code guidance.
- `/helix run [config-id]` is a UX preflight over the same config, chain, route,
  profile, and role-matrix checks. It prints the exact existing CLI invocation
  but never launches the loop and never offers a live/no-live toggle; `live.enabled:false`
  remains schema-enforced.

Stable failure codes include `invalid-role-matrix`, `matrix-missing-role:<role>`,
`matrix-exceeds-profile-max-candidates`, `matrix-exceeds-token-budget`,
`matrix-provider-policy-refusal:<code>`, `invalid-chain-registry`,
`unknown-chain`, `invalid-run-config-registry`, `unknown-run-config`,
`chain-not-loop-runnable:<id>`, `unsafe-gate-path`, `unsafe-run-id`,
`helix-config-unreadable`, and `run-directory-exists`.

`/helix runs prune <run-id>` is the only Stage 3O/P mutation. It requires
`ctx.mode === "tui"` plus explicit confirmation; `rpc`, `json`, and `print`
return `helix-prune-requires-tui-confirm`, and false/absent confirmation returns
`helix-prune-cancelled` without pruning. Run ids that resolve to the runs root
itself, such as `.`, fail closed before any replace/prune path can remove
`dispatch/runs/`; safe dotted names such as `run.1` remain valid.
Malformed local registry/config JSON makes `/helix` execution fail closed as
`helix-config-unreadable` before any mutation path runs; the detail is limited to
a safe basename, not a raw parser message or full filesystem path. Other
user-facing `/helix` refusals include a stable code, human-readable reason, and
next safe action.

Flat root-level smoke records remain visible to `list`/`status` but are labelled
`non-prunable-flat-record`; `prune` only removes directory-backed structural run
records and still rejects traversal/root delete attempts.

## Running the no-live loop

```bash
node tools/loop/helix-task-loop.mjs --list-configs
node tools/loop/helix-task-loop.mjs --run-id loop-cli-smoke
node tools/runs/helix-runs.mjs status loop-cli-smoke
node tools/runs/helix-runs.mjs list
node tools/runs/helix-runs.mjs prune loop-cli-smoke
```

The default run config, `mock-core-loop`, uses a synthetic temp repo unless
`--worktree <path>` is supplied. It writes only structural public-safe run records
under `dispatch/runs/<run-id>/`, which remains gitignored. The default synthetic
repo is removed after the run. Reusing a run id intentionally replaces the prior
structural run directory and the CLI output reports `records_replaced:true`.

## Live no-spend proof

The multi-model smoke is a live provider proof, but only after all no-spend gates
pass:

```bash
```

On 2026-07-07 the default proof passed for two distinct current OpenRouter `:free`
models:

| Model | Metadata | Preflight/inventory | Proof |
| --- | --- | --- | --- |
| `openai/gpt-oss-20b:free` | prompt `0`, completion `0` | pass | temp-repo debate converged; 2 live revision calls |
| `cohere/north-mini-code:free` | prompt `0`, completion `0` | pass | temp-repo debate converged; 2 live revision calls |

The same run also confirmed current metadata/preflight/inventory for
`qwen/qwen3-coder:free` and `google/gemma-4-26b-a4b-it:free`, but those were not
needed once two models passed. A previous default-order attempt showed both models
failing the live revision proof (`revision-failed`), so they are treated as
available candidates, not guaranteed pass models.

## Out of scope

- Hosted `openrouter/fusion` adapter.
- Paid or metered live calls.
- Broad config editors, role-matrix/profile/chain editors, worktree commands,
  resource install/remove commands, broad UI, or live pipeline view.
- Remote control.
- Autonomous/unattended mode. It stays deferred until an aggregate session/daily
  ceiling, hard stop condition, and stop/resume/status runbook are ratified beyond
  the per-run rails shipped here.

## Verification

```bash
npm test
node tools/loop/helix-task-loop.mjs --run-id loop-cli-smoke
node tools/runs/helix-runs.mjs status loop-cli-smoke
bash tools/worktree/selftest.sh
```

The 2026-07-09 whole-repo gap-closure branch passes 422 node tests plus the
worktree self-test (12) and objective-gate-loop self-test (8); 413 top-level node
test declarations are locked by the docs-truth check. No live or paid provider
proof was added for this closure.
