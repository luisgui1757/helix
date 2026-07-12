# Helix User Manual

Status: current surface after the Helix v1 cross-family hardening (2026-07-10). Helix
turns Pi into a multi-model team runner: staged loops with reviewer verdicts,
composite casts, and attended research — all under one `/helix` command.

## Daily Flow

1. **Log into your providers in Pi** as you normally would. Helix never
   manages credentials and never re-implements a platform control.
2. **Assemble your cast once.** Run `/helix setup` bare to see the presets,
   chain stages, and Pi's available-model inventory. Mutating setup is
   TUI-only and asks for confirmation. Create the named profile first, then
   assign stage executors and, when needed, replace a composite's role members:

   ```text
   /helix profiles create my-crew
   /helix setup my-crew plan=overlord implement=daily
   /helix setup my-crew implement=openai-codex/gpt-5:high
   /helix setup my-crew daily.builder=openai-codex/gpt-5:high daily.reviewer=openai-codex/gpt-5:medium*2
   ```

   A member token is `provider/model[:effort][*instances]`; multiple members
   for one role are comma-separated. Real members must exactly match Pi's
   current available inventory. Setup replaces an existing profile and
   activates it as one command-level transaction; if activation fails, the
   prior profile is restored. Profiles stay untracked and user-local, and
   corrupt profiles/pointers are never silently overwritten. The public-safety
   scanner runs before profile persistence, so secret/session/path-shaped model
   data cannot be saved even to this gitignored state.
3. **Preflight.** `/helix run [config-id]` overlays the active profile's stage
   assignments and composite members, then shows the chain, gate, and cast
   source. A mock-only cast prints the exact CLI. A real-provider cast declares
   live intent but refuses as `live-adapter-not-wired`, because the staged live
   transport is not shipped yet; injecting an adapter does not bypass that
   build-level refusal. The slash command never launches anything.
4. **Run the printed CLI**, for example:

   ```bash
   node tools/loop/helix-task-loop.mjs --config <id> --run-id <run-id> --repo <path>
   ```

   Without `--repo` it runs over a synthetic temp repo with the mock adapter
   (no-live by construction). With `--repo` it works in a per-run git worktree
   on your repository and results stay on a deterministic
   `helix/run-<hash>` branch.
5. **Watch.** `/helix runs watch <run-id>` renders the loop widget from the
   run's event stream: stage position, pass N/max, cast, gate result, verdict,
   context pressure, blocked code + next action, elapsed time. The same ordered
   lifecycle reducer used by resume rejects impossible stage order or terminal
   disagreement before rendering.
6. **Interrupted?** Ctrl-C or a crash leaves a zero-pass or post-pass structural
   checkpoint. `/helix runs resume <run-id>` validates the state, event stream,
   disagreement generation, recorded config/chain machine state, repository
   binding, private worktree ownership, and clean baseline, then prints a CLI
   containing `--config` and the required
   `--repo '<original-repository>'` placeholder. Replace the placeholder with
   the original repo. An in-flight pass is restored from its private crash
   snapshot before replay; completed work is not replayed, pending boundary
   events reconcile exactly once, and completed resume is a recorded no-op only
   when state, conclusion gate, and `run-end` agree. Runner state schema v3 is
   required; older checkpoints fail closed instead of being adopted.

`/helix help` prints the public-safe cheat sheet with every verb, any time.

## The Six Toggles

`/helix settings` shows six checkboxes; `/helix settings set <toggle> on|off`
flips one after attended TUI confirmation. Profile create/switch, setup, and
run prune use the same mutation gate; RPC/JSON/print cannot mutate. All toggles
default ON (an absent settings file means all on; a corrupt one fails closed).
**OFF never errors — it degenerates:**

| Toggle | OFF means |
|---|---|
| `multi-model` | One solo model fills every role: panels of one, self-review, blinding and cross-family advisories suppressed. A config naming a composite is the explicit conflict: `toggle-disabled:multi-model`. |
| `loops` | Every stage runs at most once; the finite global rail still binds and gates still run/report. Research becomes one-shot, returning `max-iterations` with `ok:false` if that one measurement misses the target. |
| `autoresearch` | `/helix research` refuses politely: `toggle-disabled:autoresearch`. |
| `context-engine` | Transcript-style pass-through between steps instead of compiled fresh-context handoffs. |
| `worktree` | Runs mutate your working tree directly (recorded in the run record). |
| `visual-cues` | Plain line-per-event output instead of the loop widget. Every persisted event is still rendered; only an explicit CLI `--summary` request filters lines. |

Every run record embeds the toggle vector it ran under. Not toggleable:
public-safe records, CI-never-live, the single `/helix` command,
`max_iterations`, and structural fail-closed validation.

## The Five Loops

`/helix chains` shows the catalog. Each loop is a distinct convergence shape;
casts and sizes are configuration, not new chains.

| Chain | Use when | How it converges |
|---|---|---|
| `full-cycle` | Real feature or risky change | PLAN stage writes a real `PLAN.md` in the worktree, reviewed as a file; the implement stage's code review may flag the plan itself and jump back. Only the objective gate concludes. |
| `tdd-fix` | A bug with a reproducible check | Red-first: the reproduce stage must make the gate FAIL (a failing test proves the bug), then the fix stage iterates until green and review approves. |
| `scout` | You need recon before committing to a plan | Single bounded pass; a brief artifact out, no convergence loop. Feeds `full-cycle`. |
| `research` | A question with a measurable answer | The autoresearch shape (see below); converges on the declared metric. |
| `ship-pre-pr` | Work is done, you want the gauntlet | Declares review, red-team, tests, docs, lint, public-safety, verifier, and PR-handoff steps. The generic runner refuses if required local-check/handoff effects are not injected; an outward handoff runs only after the conclusion gate passes and receives a stable idempotency key for kill/resume deduplication. The shipped CLI does not silently skip effects and does not currently open a PR. |

Reviewer verdicts route control — stay (revise), advance, or jump back to a
named earlier stage — but a verdict can never produce success. Every pass and
back-jump spends the global `max_iterations` budget, so runs always terminate.

## Research

`/helix research` is attended-only and explicit — it never auto-triggers. What
is mandatory is the shape: no run starts without a declared metric and stop
condition. Preflight in Pi, then run the printed CLI:

The rendered preflight shows only a `sha256` question ref and prints
`<private-question>` as a placeholder; replace it locally so question text never
enters a rendered `/helix` message.

```bash
node tools/research/helix-research.mjs \
  --question "does the cache help" \
  --metric latency-ms "<=" 100 --max 5 --plateau 2 \
  --measure-cmd "node bench.mjs"
```

Each iteration runs YOUR `--measure-cmd` and reads the last numeric token on
its stdout as the measurement — the objective source, never a model opinion.
Exactly four stop reasons: `target-met`, `max-iterations`,
`diminishing-returns` (the `--plateau` count of consecutive non-improvements),
and `dead-end` — a refuted hypothesis with no successor, reported as a
**valuable result**, not a failure.

## Presence = Live Intent; Transport Deferred

There is no live flag, no enablement ledger, no per-provider approval file. A
cast naming real providers is live intent as-is. This build has no approved
staged live transport, so `/helix run` and the CLI refuse that cast as
`live-adapter-not-wired`; neither may fall back to mock while recording real
providers, even through an injected adapter seam. This is honest and fail-closed:

- The tracked presets ship with mock members only, so nothing in git is live.
- Your real casts live in your untracked profile, built from providers you
  personally logged into.
- Spend is your backend billing ceiling's job (prepaid account or spend limit
  at your provider or router) — the harness never pretends to be a spend
  control. Its only rail is `max_iterations`, a runaway/time bound.
- CI never makes live or paid calls: no credentials are wired in CI, CI
  exercises only effective mock-provider casts, and a static guard rejects
  workflow secret references plus real providers in either the legacy matrix
  or staged preset resolution.

## Refusal Codes

When Helix refuses, it gives you three things: a **stable code** (grep-able,
never reworded), a **reason**, and a **next safe action**. Common codes:

| Code | Next action |
|---|---|
| `helix-config-unreadable` | Run `npm run check:resources`; fix or restore the named JSON file. |
| `unknown-run-config` | `/helix run` with no argument shows the default; `/helix chains` lists loops. |
| `unknown-preset` | Check `/helix models` for valid preset ids; fix the `/helix setup` assignment. |
| `toggle-disabled:multi-model` | `/helix settings set multi-model on`, or assign a plain provider/model. |
| `toggle-disabled:autoresearch` | `/helix settings set autoresearch on`, then retry. |
| `research-requires-attended` | Run research from an interactive TUI session and stay at the terminal. |
| `helix-settings-unreadable` | Fix or delete the user-local settings file (absent = all toggles on). |
| `helix-mutation-requires-tui-confirm` / `helix-mutation-cancelled` | Settings, profile create/switch, setup, and prune mutate only after attended TUI confirmation. |
| `live-adapter-not-wired` | Use `mock-core-loop` for no-live proof; the separately approved staged live transport is not shipped. |
| `preset-member-unavailable` / `helix-model-inventory-unavailable` | Choose an exact member shown by `/helix setup`, or retry from Pi after provider login. |
| `invalid-resume-state` / `resume-events-invalid` / `resume-disagreements-invalid` | Resume only from the original schema-v3, structurally complete run bundle. Older state, impossible lifecycle order, terminal disagreement, or a missing ownership binding refuses. |
| `worktree-run-id-collision` / `resume-worktree-missing` / `resume-repository-mismatch` | Do not reuse or modify the colliding directory. Resume only the privately owned, clean worktree at its bound repository baseline. |
| `missing-run-id` / `unsafe-run-id` / `run-not-found` | Use an exact id from `/helix runs list`. |

Fail closed on structure, YOLO on behavior: malformed configs, schemas,
registries, missing composite members, and dropped contradictions refuse with
codes like these. What models do inside their worktree is unrestricted.

## The Public-Safe Records Promise

Everything Helix persists or renders outside a worktree is structural: ids,
hashes, refs, stable codes, counts, and measurements. Run records, event
streams, research records, and the watch widget never contain raw prompts,
model responses, provider payloads, transcripts, private paths, secrets, or
auth data. Token counts appear only as context-pressure telemetry, never as
spend accounting. Substantive text lives in exactly two places: your worktree
(where the work happens) and adapter inputs in flight between steps. Resume
handoffs are reconstructed from a bound, contained worktree artifact/objective-
gate file; state persists only its stage/kind/content hash, never handoff text.
Checkpoint resume also requires the event prefix to name the exact committed
stage/pass set, configured iteration rail, and resolved executor. Compiled
prompts are memory-only and have no debug-dump option.

Field-specific grammars reject URI/path-shaped model, provider, effect-code,
and reference values before they enter those structures. Structural files and
streams use one root-confined persistence boundary: symlinked parents, final
paths, predictable pending paths, and temporary-path collisions refuse; an
atomic write cannot be redirected outside its selected root.

The one operational exception is crash recovery: while a pass is in flight,
Helix stores a mode-`0700` private copy of the worktree plus Git HEAD/index
state under the target repository's Git common directory at
`.git/helix-checkpoints/`. It is never placed in Git objects, run records,
events, or `/helix` output. Its generation directory is root-confined and
symlink-refusing, and it is removed after the pass commits or rolls back. A hard
kill can leave an abandoned private generation; after confirming
the run will not be resumed, remove that run's directory there manually.

## Troubleshooting

- `/helix` missing: run `node tools/smoke/pi-e2e-load.mjs --runtime-rpc` for a
  no-auth command inventory, then check `.pi/settings.json` still points at
  the Helix extensions.
- A run looks stuck: `/helix runs watch <run-id>` shows the current stage and
  pass; hung provider calls are bounded only by Pi/provider timeouts.
- Settings weirdness: `/helix settings` reads the user-local file; if it is
  corrupt the verb fails closed and tells you — deleting it restores all-on.
- Keep the proof gates separate: package loadability, command discoverability,
  no-live behavior, and live-provider proof are four different facts. Passing
  one does not prove the others.
