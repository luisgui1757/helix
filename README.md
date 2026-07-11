# Prime

Prime is a project-local Pi resource package that turns Pi into a
**multi-model team runner**. You keep working in Pi as usual; when a task
deserves a team, Prime gives you:

- **Staged loops** — plan → review → implement → review, where reviewer
  verdicts route control (revise this stage, advance, or jump back to a named
  earlier stage) and **only the objective gate can conclude a run**. Every
  stage pass and back-jump consumes a finite `max_iterations` budget, so
  termination is guaranteed. Configured iteration rails are safe integers
  capped at 10,000; a resolved stage panel is capped at 64 members before
  expansion.
- **Composite casts** — named role-matrix presets assigned per stage:
  `overlord` (max multi-provider panel for hard/risky work) and `daily` (light
  crew). The tracked presets are skeletons with mock members; your real
  lineups live in untracked user-local profiles created with `/prime profiles
  create` and assembled via `/prime setup` from Pi's available-model inventory.
  Profiles can replace each preset role's provider/model/effort/instance lineup
  and pass the canonical toxic-data scan before persistence; a missing or unsafe
  member fails closed — never a silent substitution or session/secret-shaped
  local file.
- **Six feature toggles** (`/prime settings`): `multi-model`, `loops`,
  `autoresearch`, `context-engine`, `worktree`, `visual-cues` — all default
  ON. OFF never errors, it **degenerates** (solo model, single pass, polite
  refusal, transcript pass-through, direct working tree, plain event lines).
  Event filtering happens only when the CLI caller explicitly requests
  `--summary`.
  The only hard refusals are explicit conflicts, with stable codes naming the
  toggle.
- **Fresh-context handoffs** — each stage starts clean from a structural
  handoff packet (claims, counterclaims, evidence refs, open disagreement
  ids); compiled prompts remain memory-only adapter input, while records
  persist template ids and hashes only.
- **Attended autoresearch** (`/prime research`) — hypothesis → experiment →
  measure → compare → iterate. A run refuses to start without a declared
  metric `{name, comparator, target}` and stop condition; the four stop
  reasons include `dead-end`, reported as a valuable result.
- **Per-run worktrees** — runs execute in their own git worktree by default
  on a deterministic `prime/run-<hash>` branch; your checkout stays clean.
  Initialization is collision-preflighted before resumable state exists, and
  reuse requires an exact private ownership claim plus the bound clean baseline.
- **Structural events + live watch** — an append-only public-safe event
  stream per run, rendered by `/prime runs watch` (stage, pass, cast, gate,
  verdict, pressure, blocked code + next action, elapsed). A converged terminal
  event is valid only immediately after a passing conclusion gate. Resume binds
  mandatory attempt numbers and the exact checkpointed pass/cast/rail history.
  Runner and `/prime` share one ordered, chain-aware lifecycle reducer; terminal
  state, conclusion gate, and `run-end` must agree.
- **Root-confined persistence** — every structural writer and private crash-
  checkpoint generation uses the same
  canonical-containment and atomic-write boundary. URI/path-shaped values are
  rejected from model/provider/code/ref fields, and symlinked parents, targets,
  pending files, or temporary files cannot redirect a write outside its root.
- **Interrupt-safe resume** — a zero-pass checkpoint exists before the first
  adapter call; later checkpoints bind the exact config, cast, toggles,
  repository, checkout/worktree, events, disagreements, and durable handoff
  source. Each in-flight pass has a repository-private crash snapshot and the
  run ID is lease/CAS-serialized. Pending boundary events reconcile exactly
  once after a kill;
  `/prime runs resume <run-id>` prints the bound resume CLI, and resuming a
  completed run is a recorded no-op. Runner state schema v3 carries the private
  worktree-owner binding; earlier state versions refuse instead of being adopted.

Package resources:

- One UI quality skill: `prime-ui`
- Three Prime-prefixed Rose Pine themes:
  - `prime-rose-pine`
  - `prime-rose-pine-moon`
  - `prime-rose-pine-dawn`
- Three extensions:
  - `prime-fence` — yolo-fence (untouched, deferred future work per the
    2026-07-09 pivot)
  - `prime-answer` — `\answer` multi-CGS resolver (top recommendation + ranked alternatives)
  - `prime-command` — the `/prime` control surface (all verbs below)

This tree is the private `prime-reloaded` release candidate. It is published
from a sanitized single-root history; the original `prime` repository remains a
private archive and must never be made public. Keep `prime-reloaded` private
until the final independent content/history/metadata audit passes and the two
historical Claude Code web sessions are confirmed Private or deleted. Prime is
licensed under the MIT License. Changing visibility is an explicit maintainer
operation, never part of an ordinary code or documentation change.

Direct user manual: [`docs/manual.md`](docs/manual.md).

## The `/prime` command

One slash command; every capability is a verb:

| Verb | What it does |
|---|---|
| `/prime` | Dashboard: default config, resolved chain, toggle vector, active profile, last structural run |
| `/prime help` | Public-safe cheat sheet |
| `/prime run [config-id]` | Preflight a run config with the active profile's cast overlaid; prints the exact CLI, never launches |
| `/prime runs list` | List structural run records |
| `/prime runs status <run-id>` | Inspect one structural run record |
| `/prime runs watch <run-id>` | Render the loop widget from a run's event stream |
| `/prime runs resume <run-id>` | Print the resume CLI for an interrupted run (completed = no-op) |
| `/prime runs prune <run-id>` | Delete one structural run directory; attended TUI confirmation required |
| `/prime models` | View both composite preset lineups and the default role matrix |
| `/prime chains` | View the staged chain catalog |
| `/prime settings [set <toggle> on\|off]` | View or flip the six Prime feature switches; mutation requires attended TUI confirmation |
| `/prime profiles [show <id> \| switch <id> \| create <id>]` | List/inspect saved casts; create/switch require attended TUI confirmation |
| `/prime setup [<existing-profile-id> <stage>=<executor> ... <preset>.<role>=<member>[,<member>...]]` | Guided stage/cast assembly from Pi's available-model inventory; setup activates transactionally and requires attended TUI confirmation |
| `/prime research <question> --metric <name> <cmp> <target> --max <n> [--plateau <n>]` | Validate a research spec (metric + stop) and print its CLI |

The slash command is preflight/view/state only: loops execute through the
printed CLI commands. **Presence declares live intent**—there is no live flag—
but this build deliberately ships no staged live transport. A resolved cast
naming any real provider therefore refuses as `live-adapter-not-wired`; it can
never execute an injected mock/fake adapter while recording a real provider;
the adapter dependency seam does not enable the deferred transport. The tracked
mock presets are no-live by construction. Spend remains bounded by your
backend billing ceiling, not by the harness.

<!-- PRIME-DOCS-TRUTH:BEGIN -->
```json
{
  "node_test_declarations": 500,
  "package_resources": {
    "skill_entries": 1,
    "theme_entries": 1,
    "theme_files": 3,
    "extension_entries": 3
  },
  "extension_slash_commands": 1,
  "prime_command_surface": "one /prime command with verbs",
  "roadmap_status_snippet": "Stage 3P whole-repo gap closure"
}
```
<!-- PRIME-DOCS-TRUTH:END -->

> **2026-07-09 pivot:** cost control was removed from the harness by owner
> decision — spend is bounded by the backend billing ceiling, presence = live,
> and Pi-default YOLO applies inside loops (see
> [`docs/stage3/design-contracts.md`](docs/stage3/design-contracts.md) and the
> ledger entry in `reviews/stage3/SUMMARY.md`). Stage sections below are
> HISTORICAL: no-spend gates, `:free` verification, profiles, token budgets,
> and write allowlists they describe no longer exist, and their smoke commands
> were deleted. Current checks are the ones in the block below.

## Checks

```bash
npm test
npm run check:resources
npm run check:docs-truth
npm run check:no-live-egress
npm run check:public-safety-diff
node tools/smoke/dispatch-smoke.mjs
node tools/smoke/revision-effect-smoke.mjs
node tools/smoke/pi-e2e-load.mjs
node tools/loop/prime-task-loop.mjs --run-id readme-check   # no-live staged loop over a synthetic repo
node tools/research/prime-research.mjs --question "shape check" \
  --metric ok ">=" 1 --max 1 --measure-cmd "echo 1" --attended
```

This verifies that Prime exposes exactly one package skill, that the project Pi
settings point at the Prime skill, themes, and three pinned extensions, and that
the vendored theme files cover Pi's required color surface.
The no-live egress check verifies CI references no secrets/provider
credentials, that both the legacy matrix and the effective staged
assignment/preset cast exercised by CI stay all-mock, and that removed
cost-control identifiers never reappear anywhere in tracked `dispatch/**`.
The docs-truth check locks the high-drift README claims above to tracked package,
test, command-surface, and roadmap facts.
The public-safety scanner requires an explicit `--mode diff|text`: CI/npm and
`tools/ship/pr-gate.sh` use `--mode diff` for git diffs; PR bodies, generated
records, and other non-diff text must use `--mode text`.

GitHub Actions now runs the minimal PR gate on every PR and push to `main`:
`npm test`, `npm run check:resources`, `npm run check:docs-truth`,
`npm run check:no-live-egress`, `npm run check:public-safety-diff`, deterministic
no-live dispatch/revision/Pi-load smokes, and `git diff --check`.

```bash
tools/m0a/collect-evidence.sh          # offline: re-pin Pi version + docs checksum
```

## Lockdown smoke (Level-2, deny-by-default)

Proves a representative Pi startup/session runs with **no unapproved egress** inside a
`docker run --network none` boundary, using a local mock approved endpoint (no secrets,
no spend). Requires Docker; skips cleanly (exit 3) if Docker is absent.

```bash
tools/lockdown/no-egress-smoke.sh            # deny-egress + offline-startup checks
tools/lockdown/no-egress-smoke.sh --active   # also run a mock Pi session
```

Boundary rationale: [`docs/m0a/lockdown-boundary.md`](docs/m0a/lockdown-boundary.md).
Evidence: [`reviews/m0a/level2-lockdown-smoke-2026-07-04.md`](reviews/m0a/level2-lockdown-smoke-2026-07-04.md).

## Real-provider smokes (historical)

The `:free`-verification smokes were deleted in the 2026-07-09 pivot (spend is
the backend billing ceiling's job). Historical evidence:
[`reviews/m0a/openrouter-free-smoke-2026-07-04.md`](reviews/m0a/openrouter-free-smoke-2026-07-04.md).
Live proofs are now manual, attended, and approval-gated — never CI.

## Thin vertical smoke path

The smallest complete usable workflow (checklists + one status script), standing in for
the not-yet-built systems. See [`docs/m0a/vertical-smoke/`](docs/m0a/vertical-smoke/).

```bash
tools/smoke/status.sh                  # offline safety/provider/worktree status (no secrets)
node tools/smoke/pi-e2e-load.mjs       # static proof split: loadability/discoverability/no-live/live
node tools/smoke/pi-e2e-load.mjs --runtime-rpc # no-auth/no-live RPC get_commands inventory
```

The Pi load helper reports four gates separately: package/resource loadability,
Pi command/skill discoverability, no-live behavior, and live-provider proof. The
runtime RPC mode uses isolated temporary config dirs, sends only `get_commands`,
and defaults to a 60s timeout for cold Pi startup; it does not send a prompt or
call a provider.

## Stage 1+2 — safety posture + verification core

The first Prime code substrate (source-verified against Pi 0.80.3, no paid model calls).
Overview: [`docs/stage1-2/`](docs/stage1-2/).

```bash
npm test                                 # node unit tests + worktree + loop self-tests

tools/worktree/prime-worktree.sh create <name>   # git-worktree basics (no secret copy)
tools/loop/objective-gate-loop.sh --gate '<cmd>' # gate-primary loop (fails loud if no gate)
tools/ship/pr-gate.sh --dry-run                  # conservative, fail-closed pre-PR gate
```

- **yolo-fence** (`extensions/prime-fence.ts`) — fences risky `bash`/`write`/`edit` tool
  calls + user `!` commands; confirms in TTY, **fails closed** in `-p`/json/rpc. Limits +
  OS-sandbox path: [`docs/stage1-2/yolo-fence.md`](docs/stage1-2/yolo-fence.md).
- **`\answer`** (`extensions/prime-answer.ts`) — model-callable resolver for multi-CGS
  decisions; deterministic recommendation in non-interactive mode; fake-Pi extension
  registration plus core choice behavior are unit-tested.
- **Plan/implement separation** — native `/new` + `PLAN.md`
  ([`docs/stage1-2/plan-implement-separation.md`](docs/stage1-2/plan-implement-separation.md)).

## Stage 3A — Fusion-style dispatch spec

The active Phase-3 gate is the architecture spec at
[`docs/architecture/fusion-dispatch-research.md`](docs/architecture/fusion-dispatch-research.md).
It defines provider/cost profiles, role envelopes, routing policy, judge-bias
mitigations, fail-closed behavior, structural-only public-safe logging, fixtures,
usage/cap metering, and the no-spend OpenRouter `:free` test profile. The
no-spend profile excludes real Copilot/OpenAI/Claude/Azure calls and allows only
mock providers plus metadata-verified OpenRouter `:free` models over synthetic
or already-public fixture input.

The Stage 3B-N implementation below follows that accepted spec. Hosted Fusion,
paid/metered calls, private live inputs, and autonomous/unattended loops remain
outside the no-spend core path unless their safety gates are explicitly satisfied.
Final non-Phase-4 provider boundaries are documented in
[`docs/m0a/provider-live-proof-boundaries.md`](docs/m0a/provider-live-proof-boundaries.md):
Azure Foundry is template/blocked only, Copilot needs a fresh matching pin,
OpenAI/Codex and Claude live proofs require per-proof maintainer approval, and
`claude-local` stays excluded from automated dispatch.

## Stage 3B — dispatch-policy-core

The first Stage-3 code substrate: a pure, fail-closed policy/config/schema/
run-record layer for the Fusion-style dispatch architecture (built to the
accepted Stage 3A spec). It is **not** the orchestrator — it launches no models,
opens no sockets, and reads no credentials.

Overview: [`docs/stage3/dispatch-policy-core.md`](docs/stage3/dispatch-policy-core.md).

Under `dispatch/lib/` (dependency-free `.mjs`, tested by `node --test`):

- **role envelope** — runtime schema validation with a role/stage matrix; malformed
  provider/model output fails closed before it can reach judge/synthesis.
- **cost policy** — the `no-spend-test` profile allows only mock providers and
  metadata-verified OpenRouter `:free` models; real providers, non-free ids, and
  unknown/stale price metadata are refused.
- **routes + profiles** — task-class routes with a reserved per-role
  model/effort/instance matrix; profile caps as maxima with fail-closed panel
  precedence.
- **classifier** — deterministic classification with mandatory risk floors and a
  fail-closed non-TTY escalation stop.
- **judge blinding** — identity-stripped, A/B/C-re-keyed judge projection with a
  recorded seed/permutation.
- **run record** — structural, public-safe records only (ids, hashes/refs,
  rollups); a mechanical scan rejects home paths, session URLs, provider keys, and
  provenance.

```bash
npm test                                            # includes tests/dispatch-*.test.mjs
```

No live or paid model call ships in this slice; the optional OpenRouter `:free`
smoke is gated behind the mechanical preflight and was not executed here.

## Stage 3C — thin dispatch orchestrator

One dispatch cycle over the Stage 3B policy core (`dispatch/lib/orchestrate.mjs`):
classify → route/profile/panel → pre-launch no-spend/eligibility gates (metadata
price-TTL clamped to profile policy) → mock adapter launch → role-envelope
validation at the boundary → blinded advisory judge with a recorded
seed/permutation → objective gate from exit status or a deterministic checker
only → structural public-safe run record. Adapter, gate runner, clock, and seed
are all dependency-injected; recursion depth is exactly one; every stage fails
closed with a stable code.

Overview: [`docs/stage3/dispatch-orchestrator.md`](docs/stage3/dispatch-orchestrator.md).

```bash
npm test                              # includes tests/dispatch-orchestrate.test.mjs
node tools/smoke/dispatch-smoke.mjs   # deterministic mock dispatch (no network, no spend)
```

Still no live or paid model calls: adapters are mock/canned, and the live
OpenRouter `:free` smoke remains gated behind
`tools/smoke/nospend-preflight.mjs` and was not run in this slice.

## Stage 3D — synthesis stage + preflight-gated no-spend adapter

Adds the **synthesis** stage to the dispatch cycle and the first
**preflight-gated** OpenRouter `:free` adapter smoke.

- **Synthesis** (`dispatch/lib/synthesis.mjs`) runs after the candidate panel and
  the advisory judge, before the objective gate — only on routes with a
  `synthesizer` role. The synthesizer consumes candidates and the judge output as
  an identity/cost-stripped role-output projection (provider/model/cost stripped,
  but carrying substantive model text — a provider-bound adapter input, not a
  public-safe record artifact; the run record persists none of it), returns a
  validated `stage: "synthesis"` / `role: "synthesizer"` envelope, and **must
  quote every unresolved candidate contradiction**: a dropped contradiction fails
  the run closed (`synthesis-dropped-contradiction`), a preserved one is recorded
  as `contradiction-preserved`. The judge stays advisory; the objective gate still
  decides success.
- **No-spend adapter smoke** — `tools/smoke/openrouter-free-dispatch-smoke.sh`
  runs the mechanical no-spend preflight (`nospend-preflight.mjs`) **first** and
  only calls the live Pi OpenRouter `:free` model if the candidate is proven
  spend-safe. The committed candidate metadata
  (`tools/smoke/fixtures/openrouter-free-candidate.json`) is intentionally stale,
  so the smoke **fails closed and makes no live call** until a maintainer
  refreshes `verified_at` from current provider metadata.

Overview: [`docs/stage3/synthesis-nospend-adapter.md`](docs/stage3/synthesis-nospend-adapter.md).

```bash
npm test                                            # includes dispatch synthesis + preflight tests
node tools/smoke/dispatch-smoke.mjs                 # deterministic mock cycles incl. synthesis (no network)
```

No live or paid model call was made in this slice: the live OpenRouter `:free`
smoke was **skipped** because the committed metadata cannot prove a current zero
price, so the mechanical gate fails closed.

## Stage 3E — verification stage

Adds the **verifier** role. After the objective/advisory gate result is captured,
the verifier (`dispatch/lib/verification.mjs`) summarizes proof — but it **never**
determines the recorded gate result. Gate outcomes still come only from process
exit status or a deterministic checker.

- It runs only on routes with a `verifier` role (`pr-preflight`), is injected
  (`adapter.runVerifier`), and receives a **structural, public-safe proof summary**
  (gate outcome, exit status, cap status, warning codes, refs — no model narrative
  or provider payloads).
- Its envelope is validated as `stage: "verification"` / `role: "verifier"` and
  matched to the vetted spec; missing config/hook, malformed/mismatched envelope,
  and an ineligible verifier provider fail closed.
- Its content is **advisory only**: a positive verifier cannot turn a failed gate
  into success, and a negative verifier cannot turn a passed gate into failure. Its
  narrative is never persisted (only its stable status enum is returned in the
  result); the persisted record shape is unchanged.

Overview: [`docs/stage3/verification-stage.md`](docs/stage3/verification-stage.md).

```bash
npm test                              # includes tests/dispatch-verification.test.mjs
node tools/smoke/dispatch-smoke.mjs   # deterministic mock cycles incl. pr-preflight verification
```

## Stage 3F — thin parallel / multi-team dispatch

Adds an **opt-in** bounded-parallel candidate launch (`dispatch/lib/parallel.mjs`),
built thinly on Pi's `examples/extensions/subagent` concurrency-limiter pattern (no
subprocesses — a pure repo-local substrate over injected adapters). Sequential
launch stays the default; **no existing caller changes behavior.**

- **Opt-in**: pass `deps.parallel = { max_concurrency, token_budget }`. Candidates
  launch with at most `max_concurrency` in flight; an invalid cap
  (`invalid-concurrency-cap`) or an unbounded per-run token budget
  (`unbounded-parallel-budget`) fails closed before any launch. Post-launch, tokens
  over budget fail closed (`token-budget-exceeded`).
- **Deterministic output**: parallel results are processed in candidate-index order,
  so completion order never changes outcomes, records, judge projections, warnings,
  or smoke hashes. Two parallel runs of the same config are byte-identical, and
  parallel yields the same candidate outcomes as sequential; the record's
  `cap_status.token_cap` records the **effective enforced budget** (the stricter of
  the deps budget and the profile cap), so it is never null while a finite budget
  was enforced.
- **All existing gates preserved** (cost projection, envelope validation,
  `min_successes`, caps, judge/verifier advisory, synthesis contradiction
  preservation, objective gate final). A failed parallel candidate is isolated and
  still counts against `min_successes`.
- **Lean multi-team**: a cross-family **advisory** — routes with
  `requires_cross_family` (`architecture`, `security`) record
  `cross-family-not-satisfied` when the panel spans one model family (an all-`mock`
  panel warns but still succeeds). The iterating multi-team debate is the next slice,
  not stubbed here.

Overview: [`docs/stage3/parallel-dispatch.md`](docs/stage3/parallel-dispatch.md).

```bash
npm test                              # includes tests/dispatch-parallel.test.mjs
node tools/smoke/dispatch-smoke.mjs   # four deterministic mock cycles incl. bounded-parallel risky-change
```

## Stage 3G — iterating multi-team / adversarial debate loop

Adds a thin, bounded **iterating / adversarial debate** loop
(`dispatch/lib/debate.mjs`) over the Stage 3B–3F cycle. One iteration is the whole
dispatch cycle (panel → judge → synthesis → gate → verifier); the loop repeats it
only when the route calls for adversarial iteration and the gate has not converged.
It **composes** `runDispatch` — the dispatch core is unchanged and never imports the
debate layer (dependencies flow inward).

- **Convergence is exactly diff-stability + objective-gate-pass.** Both are
  deterministic checkers, not models — model consensus, judge/verifier approval, and
  synthesis confidence are **never** final authority. An advisory gate never counts;
  the verifier stays advisory and can neither rescue a failed gate nor block a passed
  one.
- **Mandatory hard caps fail closed before iterating**: a missing/unbounded
  `max_iterations` or aggregate `token_budget` refuses the debate
  (`missing-`/`unbounded-max-iterations`, `missing-`/`unbounded-token-budget`); the
  aggregate token budget across iterations is a hard rail
  (`token-budget-exceeded`) that wins over convergence.
- **Injected deterministic diff-stability checker** (`deps.diffStability`, a boundary
  effect like `runGate`); an unavailable, invalid, or non-deterministic checker fails
  closed. A gate that never passes before `max_iterations` fails closed
  (`not-converged-within-max-iterations`).
- **Structural-only iteration summaries** (iteration number, gate result/source, diff
  result/code, cap status, warning codes, run refs) — no model narrative enters the
  public debate summary, which is re-scanned for public safety before it is
  persisted to the gitignored records dir. Deterministic: a fixed seed/input yields
  byte-identical per-iteration records and a byte-identical debate summary.

Overview: [`docs/stage3/iterating-debate.md`](docs/stage3/iterating-debate.md).

```bash
npm test                              # includes tests/dispatch-debate.test.mjs
node tools/smoke/dispatch-smoke.mjs   # five deterministic mock cycles incl. the iterating debate
```

## Stage 3H — real revision / diff surface

Wires the Stage 3G debate loop to **real local signals**, keeping the debate core
pure (all git/worktree side effects stay in injected boundary effects).

- **Real working-tree diff stability** (`dispatch/lib/git-diff-surface.mjs`):
  `computeDiffFingerprint` builds a **structural, public-safe** fingerprint of the
  current git diff (a `sha256` over the tracked patch + untracked content hashes) —
  hashes, counts, and a baseline ref only, **never** raw diff text.
  `makeGitDiffStability` is a drop-in `diffStability` boundary effect backed by it.
  It uses deterministic git plumbing (config-independent), double-reads to guard
  determinism, and fails closed on a non-git repo, missing baseline, ambiguous
  index, git failure, unsafe path, or non-determinism. Untracked entries are
  **fail-closed by default** — it never follows a symlink (which could read outside
  the work tree), never reads a credential/private-shaped file (`.env`, `auth`,
  key/token files), and refuses any other untracked file unless the caller opts it in
  via an explicit `untracked_policy` allowlist of safe/public paths. Allowlisted
  untracked files ARE content-hashed, so a same-size content edit is not invisible
  (no false convergence).
- **Real proposal revision boundary** (`dispatch/lib/debate.mjs`): an **optional**
  injected `revise` effect produces the next proposal in the worktree between
  non-converged iterations — the only thing allowed to mutate it. Revision state
  threads as **refs/hashes only**; a failed revision stops fail-closed
  (`revision-failed` / `revision-invalid`) while **preserving** the iteration
  evidence already produced. Absent ⇒ Stage 3G behavior, byte-for-byte.
- **Default-on adversarial policy** (`dispatch/lib/adversarial-policy.mjs`):
  adversarial / multi-team debate is default-on for meaningful work (plans,
  reviews, risky changes, security, architecture, roadmap reconciliation, PR
  preflight). The `/adversarial off` opt-out rides the existing
  `task.override.disable_adversarial` channel (no new slash command) and is
  recorded structurally as `adversarial-opt-out`. Heavier 3+ model / every-task
  runs stay explicit opt-in.
- **Objective gate stays final authority**: convergence is still exactly
  diff-stability + objective-gate-pass; making the diff real changes nothing about
  who decides. No live/paid calls, no credential reads.

Overview: [`docs/stage3/real-revision-diff-surface.md`](docs/stage3/real-revision-diff-surface.md).

```bash
npm test                              # includes the git-diff-surface, adversarial-policy, and debate tests
node tools/smoke/dispatch-smoke.mjs   # deterministic mock cycles incl. the iterating debate (unchanged)
```

## Stage 3I — real model-backed revision effect

Turns the Stage 3H injected `revise` boundary into a real, provider-policed,
model-backed effect (`dispatch/lib/revision-effect.mjs`): a `builder` model produces
the next proposal, the effect validates it and mutates the worktree, and the debate's
critic panel + **objective gate** close the builder→critic loop.

- **`makeModelRevision(config, deps)`** builds a `revise(revisionState, ctx)` boundary
  effect (the same "build an injected effect from config" pattern as
  `makeGitDiffStability`), so `debate.mjs` is unchanged and stays policy-pure.
- **Provider/cost policy is projected before any model call** through a shared,
  extracted gate (`dispatch/lib/provider-policy.mjs`) — the *same* vetted projection
  the orchestrator uses. An ineligible/unknown/stale provider or price, or a missing
  Copilot pin, refuses **before** the model adapter is touched (call count stays 0).
- **Worktree writes keep the Stage 3H diff-surface rules**: only explicitly
  allowlisted paths are writable, credential/private-shaped paths are refused even if
  allowlisted (denylist wins), and unsafe paths (traversal/absolute/symlink/non-file/
  outside-tree) fail closed. Edits apply all-or-nothing with rollback on disk write
  failure.
- **Structural returns only.** The effect returns a `sha256` `revision_ref` + a stable
  code; a thrown message, model narrative, or private path never reaches
  `result.detail`, warnings, the summary, or a run record.
- **Objective gate stays final authority** — a model can propose any edit, but the
  debate converges only on diff-stability + objective-gate-pass. Stage 3I used a
  deterministic in-process adapter; Stage 3J adds the preflight-gated live
  OpenRouter `:free` adapter for this same boundary.

Overview: [`docs/stage3/model-backed-revision.md`](docs/stage3/model-backed-revision.md).

```bash
npm test                                   # includes tests/dispatch-revision-effect.test.mjs
node tools/smoke/revision-effect-smoke.mjs # real temp repo + mock model adapter; converges via a real revision
```

## Stage 3J — live OpenRouter `:free` builder adapter

Adds the first live `modelAdapter.runRevision` implementation for the Stage 3I
effect: `dispatch/lib/openrouter-revision-adapter.mjs` calls Pi's native OpenRouter
provider for a `:free` model, parses structured JSON edits, and returns only
`{ edits:[{path,content}] }` to `makeModelRevision`.

- The adapter refuses non-`:free` model ids and unsafe/sensitive fixture paths before
  invoking Pi.
- The adapter bounds the complete outbound prompt with `max_input_bytes` (default
  `32768`) and fails closed before `runPi` when the synthetic fixture payload is too
  large.
- It disables tools, sessions, context files, skills, themes, prompt templates, and
  extensions on the Pi call.
- It reads only caller-declared synthetic/public fixture files. It does not read
  credential files, print credentials, or persist credentials; Pi may use existing
  authenticated provider state/environment for the OpenRouter call.
- Failures throw stable codes only. Raw prompt/model/runner output is not returned or
  persisted; the debate summary remains structural refs/counts/codes.
- The live smoke fetches public OpenRouter metadata, requires prompt/completion price
  `0`, runs `nospend-preflight.mjs`, verifies Pi inventory, then injects the adapter
  into `makeModelRevision` over a real temp git repo.

Overview: [`docs/stage3/live-builder-adapter.md`](docs/stage3/live-builder-adapter.md).

```bash
npm test
```

## Stage 3K — lean agent-team defaults

Adds the first default agent-team artifact for the long-lived loop: a minimal
`Builder` plus independent-provider `Reviewer` team. This is config/markdown, not a
new slash command and not the per-role provider/model matrix.

- `dispatch/config/agent-team-defaults.json` defines the additive default team.
- `dispatch/lib/agent-team.mjs` validates canonical role IDs and projects
  routing/log fields from those IDs only.
- `docs/stage3/agents/builder.md` and `docs/stage3/agents/reviewer.md` are the role
  artifacts; Reviewer declares provider independence from Builder for the Stage 3L
  matrix to enforce against concrete specs.
- Cosmetic aliases are display-only: they can change labels, but never routing,
  logs, config identity, or public records.

Overview: [`docs/stage3/agent-team-defaults.md`](docs/stage3/agent-team-defaults.md).

```bash
npm test                              # includes tests/dispatch-agent-team.test.mjs
```

## Stage 3L-M/N — role matrix, chain registry, and bounded task loop

Adds the core daily-use loop surface without a new slash command: per-role
model/effort/instance matrix expansion, named chains, named run configs, a
bounded task-loop CLI, structural run status/prune tooling, worktree remove/merge
hardening, and a two-model OpenRouter `:free` live proof path.

- `dispatch/lib/role-matrix.mjs` expands
  `role -> [{ provider, model, effort, instances, price? }]` deterministically and
  projects provider/cost policy before launch. Instance counts are bounded by the
  route/profile caps and finite token budget.
- `dispatch/config/chains.json` defines the five-loop catalog: `full-cycle`
  (staged plan/implement with PLAN.md and back-jumps), `tdd-fix` (red-first),
  `scout`, `research`, and `ship-pre-pr`. Unknown or malformed chains fail
  closed; chains are data, not commands. The current revision-backed task loop runs only builder-bearing
  chains; non-builder defaults fail closed as `chain-not-loop-runnable:<id>`.
- `dispatch/config/run-configs.json` defines `mock-core-loop`, a no-live run config
  with an objective gate, write allowlist, hard caps, and structural refs.
- `tools/loop/prime-task-loop.mjs` runs the bounded loop over a synthetic temp repo
  by default; `tools/runs/prime-runs.mjs` lists, statuses, and prunes structural
  run records under gitignored `dispatch/runs/`. Default synthetic repos are
  cleaned after the run, and rerunning a run id reports whether the prior
  structural record directory was replaced. Run ids that resolve to the runs root
  itself, such as `.`, fail closed; safe dotted names such as `run.1` remain valid.
- Objective gate file reads are final-path checked before reading: allowlisted
  regular file only, no symlinks/non-files, no credential-shaped paths, and final
  realpath must remain inside the real worktree root.
- `tools/smoke/openrouter-free-multimodel-revision-smoke.mjs` proves two distinct
  current OpenRouter `:free` revision models only after metadata, no-spend
  preflight, and Pi inventory pass. On 2026-07-07 it passed for
  `openai/gpt-oss-20b:free` and `cohere/north-mini-code:free`.

Overview: [`docs/stage3/role-matrix-task-loop.md`](docs/stage3/role-matrix-task-loop.md).

```bash
npm test
node tools/loop/prime-task-loop.mjs --run-id loop-cli-smoke
node tools/runs/prime-runs.mjs status loop-cli-smoke
```

## Stage 3O PR1 — `/prime` control surface

Adds one Pi extension slash command, `/prime`, over the existing Stage 3
configuration and structural run surfaces. All verbs are argument-completed under
that single command:

- `/prime` renders the conservative dashboard: default run config, resolved
  profile/caps, chain, role matrix summary, no-live status, last structural run,
  dry-run warnings/refusal codes, and high-level package/resource status.
- `/prime run [config-id]` is preflight-only. It resolves the run config, expands
  the role matrix through existing provider/cost policy, shows the objective gate,
  write allowlist, caps, and prints the exact `node tools/loop/prime-task-loop.mjs
  --config ... --run-id ...` invocation. It never launches the loop.
- `/prime runs list|status <run-id>|prune <run-id>` uses the structural
  run-manager paths. `prune` is the only PR1 mutation and requires
  `ctx.mode === "tui"` plus explicit confirmation; `rpc`/`json`/`print` fail
  closed. Run ids that resolve to the runs root itself fail closed before pruning.
  Flat smoke records are listed/statused as non-prunable instead of being
  silently passed to the directory prune path.
- `/prime help` is view-only and public-safe; it works without loading local
  run/config registries and reports supported commands, no-live/live/paid
  boundaries, and refusal-code guidance.
- `/prime models`, `/prime chains`, and `/prime profiles` are view-only browsers.
- If a local Prime registry/config JSON file is unreadable or malformed, `/prime`
  execution fails closed as `prime-config-unreadable` with a stable reason and
  next safe action; it does not surface raw parser errors or full filesystem
  paths.

PR1 deliberately excludes config editing, role-matrix/profile/chain editing,
worktree/resource install or remove commands, live toggles, provider calls, paid
or metered calls, raw prompt/model/transcript/provider payload rendering, and
autonomous/Phase 4 behavior.

```bash
npm test                              # includes tests/prime-command-*.test.mjs
npm run check:resources
```

## Stage 3P whole-repo gap closure

This closure hardens accepted whole-repo review gaps without building the
design-required product areas early:

- schema validation uses own-property checks and rejects negative USD cost
  fields before aggregation;
- git diff runners scrub repo-targeting `GIT_*` env vars and deny more
  credential-shaped untracked paths;
- diff-checker and adapter failures surface stable codes instead of raw text;
- public-safety scans cover macOS, Linux, and Windows home-path forms;
- CI and `tools/ship/pr-gate.sh` use the shared public-safety diff signatures;
- GitHub Actions also runs docs truth, deterministic no-live dispatch/revision
  smokes, and static Pi load proof;
- `npm test` passes 509 Node tests plus the worktree self-test (12) and
  objective-gate-loop self-test (8); the README truth block locks 500 top-level
  node test declarations to disk;
- `docs/manual.md` is the direct user manual;
- `docs/stage3/design-contracts.md` records the required contracts for
  autoresearch, cost modes, composites, config overlays, loop visual cues, live
  enablement, and context engineering before implementation.

Main branch protection was enabled on 2026-07-09: `main` requires a pull request,
at least one approving review, and the `test` CI status check before merge; force
pushes and deletions are disabled.

## Final non-Phase-4 hardening

This track adds no new `/prime` UX. It hardens the non-Phase-4 boundary with:

- provider/live-proof approval docs and Azure Foundry config template,
- web-access prompt-injection posture and package audit artifact,
- remote-control/fence-v2 design boundary,
- `CONTRIBUTING.md` instruction sync rules,
- status/observability catalog disposition,
- no-auth/no-live Pi load helper,
- static CI no-live egress guard.

Package audit and package adoption remain separate. `pi-web-access`, `remote-pi`,
`pi-messenger`, and status packages are not installed or adopted.

## License

Prime is available under the [MIT License](LICENSE).
