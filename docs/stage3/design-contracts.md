# Helix Design Contracts

Status: 2026-07-10 — amended by the owner's product interview and independent
cross-family hardening (single-PR build).
These contracts supersede the 2026-07-09 gap-closure versions. The decision log
for the amendments is in `reviews/stage3/SUMMARY.md`.

Named Stage 3B-N implementation pages are dated historical records, not current
operational guides. Each carries a prominent superseded banner. This file,
`docs/manual.md`, and the executable checks define current behavior.

## Governing Principles (owner decisions, 2026-07-09)

1. **Controls live at the platform of record, not in the harness.** Spend is
   bounded by the backend control instance (billing ceiling / prepaid account at
   OpenRouter, OpenAI, Foundry, Bedrock, …). Merge integrity is bounded by
   GitHub branch protection. Helix never re-implements a platform's control.
2. **One rail: `max_iterations`** (a time/runaway control). Everything else
   about *agent behavior* is Pi-default YOLO: no fences, no write allowlists,
   no command allowlists, no confirmation ceremonies inside loops.
3. **Presence = live intent.** A config/profile naming real providers needs no
   live flag, enablement ledger, or per-provider approval document. The current
   staged runner deliberately has no live transport, so that intent refuses as
   `live-adapter-not-wired`; it must never fall back to mock while recording
   real provider/model ids.
4. **Fail closed on structure, YOLO on behavior.** Malformed configs, schemas,
   registries, envelopes, missing composite members, and dropped contradictions
   refuse with stable codes. What models do inside their worktree is
   unrestricted.
5. **Public records are structural, forever.** Records, events, and rendered
   output carry ids, hashes, refs, codes, counts, and measurements — never raw
   prompts, model responses, provider payloads, private paths, transcripts,
   secrets, or auth/env data. Token counts are capacity telemetry (context
   pressure), never spend accounting.
6. **CI never makes live or paid provider calls.** Enforced by: no provider
   credentials wired in CI, CI exercising only mock-provider configs, and the
   static no-live guard (which also lints that removed cost-control identifiers
   never reappear).
7. **`/helix` is the only slash command.** New capability = new verb.
8. **Evidence before machinery.** No migration tooling before a second schema
   version exists; no auto-compaction before pressure evidence; no web/remote
   behavior before its boundary contract and fixture proof.

## Removed: Cost Policy (superseded)

The former cost-modes contract (hard-stop/warn/confirm/yolo modes, scopes,
units, approval ledger, price-TTL freshness, `:free` verification, no-spend
preflight) is **removed, not deferred**. Spend enforcement belongs to the
backend billing boundary. The harness keeps only `max_iterations` and
`max_concurrency` (resource bounds), plus token counts as pressure telemetry.

## Feature Toggle Contract (`/helix settings`)

Six user-local toggles, all default ON:
`multi-model`, `loops`, `autoresearch`, `context-engine`, `worktree`,
`visual-cues`.

- OFF never errors — it **degenerates**: multi-model off ⇒ one solo model fills
  every role (panels of one, blinding/cross-family advisories suppressed);
  loops off ⇒ every stage runs at most once (the finite global rail still
  binds, and gates still run/report); autoresearch off ⇒ the verb refuses politely;
  context-engine off ⇒ transcript-style pass-through between steps;
  worktree off ⇒ runs mutate the working tree directly (recorded);
  visual-cues off ⇒ plain line-per-event output. It does not imply summary
  filtering; only an explicit CLI `--summary` request may omit event lines.
- The only hard refusals are **explicit conflicts**: a config that names a
  composite while multi-model is off, or `/helix research` while autoresearch
  is off — stable codes naming the toggle.
- Settings are untracked user-local state with exact `schema_version: 1` and
  refuse-on-mismatch on both load and save. Every run record embeds the toggle
  vector it ran under.
- All `/helix` state mutations—settings set, profile create/switch, setup, and
  prune—require attended TUI confirmation. This surface gate is separate from
  loop behavior; there are still no confirmation ceremonies inside loops.
- Not toggleable: public-safe records, CI-never-live, the single `/helix`
  command, `max_iterations`, structural fail-closed validation.

## Staged Chain Contract (loops)

A chain is an ordered list of **stages**; each stage is a mini-loop:

- `{ id, steps (roles), advance: { verdict_role, max_passes }, on_revise_target }`
- A reviewer **verdict may route** control: stay (revise this stage), advance,
  or jump back to a named earlier stage. **Only the objective gate can conclude
  the run.** A gateless verdict can never produce success.
- Every stage pass and backward jump consumes the global `max_iterations`
  budget; per-stage `max_passes` must be finite and never reset. Integers must
  be JavaScript-safe; the practical global ceiling is 10,000. Termination is
  guaranteed.
- Linear chains load as single-stage chains (backward compatible).
- Stage transitions (stage-start, verdict, jump-back) are structural events.

The default catalog (five loops, each a distinct convergence shape):

| Chain | Converges on | Notes |
|---|---|---|
| `full-cycle` | approved plan, then approved implementation | PLAN stage writes a real `PLAN.md` in the worktree (reviewed as a file, hash in the record); code review may flag "plan-flawed" and jump back |
| `tdd-fix` | making a failing check pass | REPRODUCE stage must produce a failing gate first (recorded), then FIX until green; replaces `implement-review-fix` |
| `scout` | nothing — bounded recon | single pass, brief artifact out |
| `research` | knowledge, via a declared metric | see Autoresearch |
| `ship-pre-pr` | nothing — a gauntlet | every declared local-check/handoff effect is required; the generic runner refuses when an effect is absent. An outward handoff runs only after the independent conclusion gate passes and receives a stable per-run idempotency key so a kill/resume retry can be deduplicated. The shipped CLI has no PR-opening effect yet and never claims success by skipping it. Any future effect may open a PR, never merge. |

Loop sprawl rule: a new chain must embody a new convergence shape; casts and
sizes are configuration, not new chains.

## Composite Model Contract (casts)

- A composite (e.g. `overlord`, `daily`) is a **named role-matrix preset** with
  a thin metadata wrapper (display name, description, degradation policy,
  per-provider effort vocabulary). `overlord` = max multi-provider panel;
  `daily` = light crew. No "free" product tier.
- Composites are **step-level executors**: run configs (and profiles) map each
  chain step to a composite id or a plain `{provider, model, effort}`.
- The interactive session driver (Pi's own `/model` selection) is never managed
  by Helix. No Pi `/model` integration; `/helix models` and the TUI are the
  selection surface.
- Tracked presets ship as skeletons with mock members; **real member lineups
  live in untracked user-local profiles** (they depend on personal logins) and
  are assembled interactively via `/helix setup` from Pi's live model inventory.
- Setup stores complete per-role member overlays using
  `provider/model[:effort][*instances]`; resolved stage panels are bounded at 64
  members before allocation.
- A missing/unavailable member **fails closed naming the member**. No silent
  substitution.

## Config Overlay Contract (profiles)

- Tracked `dispatch/config/**` is project truth. **Named untracked profiles**
  (saved casts: assignments, active preset choices, view prefs) layer above it,
  with an active-profile pointer. Profiles may NOT override run semantics
  (chain, gate, run_target) — that is tracked-config territory.
- Profiles pass the canonical public-safety scanner before save and again on
  load; gitignored state is not an exception to the no-secret/session/path
  invariant.
- Interactive TUI setup is the mutation surface; show/list/models provide the
  effective read-only view. Profile create/switch and setup all share the same
  confirmation gate. Setup replaces an explicitly-created profile and activates
  it transactionally; an activation refusal restores the prior profile. General
  import/export and rollback/history remain later work.
- `schema_version` from day one; unknown versions refuse with a stable code and
  next-action hint; migration tooling only when a v2 schema exists.

## Loop Visual Cues Contract

- The runner emits an append-only **structural event stream**: run/stage/step/
  iteration/gate/verdict/jump-back/blocked/warning events with public-safe
  fields only (ids, codes, counts, relative timings, executor refs).
- Each event kind has a closed field/type schema at emit and read time; every
  pass-start carries a mandatory contiguous attempt number. Resume validates
  sequence numbers plus the exact checkpointed stage/pass set, configured
  iteration rail, and resolved executor, then reconciles a checkpointed pending
  stage/jump/run boundary event exactly once. A converged `run-end` is valid
  only when it immediately follows a passing `phase:conclusion` objective gate;
  a prior or advisory/model verdict can never stand in for that terminal gate.
- Renderers consume the same stream: the TUI widget first (stage position,
  cast, iteration N/max, gate + convergence, blocked code + next action,
  timing + history strip), plain line-per-event everywhere else. Disabling
  visual cues never filters events; filtering requires explicit `--summary`.
- No renderer may show raw prompts, model responses, provider payloads,
  private paths, or transcripts. A live-renderer callback failure is a stable
  warning and cannot rewrite an already-durable run outcome.

## Persistence Boundary Contract

- Public model/provider/effect-code/reference fields use field-specific closed
  grammars. URI, absolute/drive/backslash path, domain-path, repeated-separator,
  and dot-segment shapes refuse before persistence or rendering; effect codes
  are enumerated by the effect boundary rather than accepted from a caller.
- Every structural writer uses the shared root-confined persistence module.
  It canonicalizes the selected root, verifies every descendant parent and
  existing target is not a symlink, creates temporary files exclusively with
  no-follow semantics, fsyncs, atomically installs, and verifies the installed
  inode. Predictable pending paths are refused if any entry already occupies
  them. Append-only streams use the same containment and no-follow checks.
- Persistence code may not fall back to direct `writeFile`, append, or rename
  calls. A new persisted surface must add both a toxic-value regression and an
  out-of-root symlink regression when it accepts a caller-selected path.

## Runner Contract

- Attended kickoff, walk-away execution. No scheduled/self-starting runs.
- Worktree-per-run on this repo by default (results come back as a branch);
  the branch is the deterministic public-safe `helix/run-<hash>`. The
  `worktree` toggle can select direct working-tree mutation.
- Before the first adapter call the runner persists a zero-pass checkpoint.
  Every later checkpoint binds the exact effective config/cast/toggles,
  repository, checkout/worktree, events, disagreement log, and durable handoff
  source. State is written atomically before its pending boundary event; resume
  binds the event stream to that exact state/config/cast, reconciles the event
  exactly once, and never replays a completed pass.
  One ordered, chain-aware lifecycle reducer is shared by the runner and
  `/helix`: stage order, attempts, verdict routing, conclusion gate, terminal
  state, and `run-end` must agree. `/helix runs resume` validates the
  state/events/disagreements bundle and requires the original repository.
  Completed resume is a recorded no-op only when that terminal cross-binding
  is valid.
- Fresh and resumed execution for one repository/run ID is serialized by a
  repository-private lease plus state compare-and-swap. Worktree collision
  preflight happens before resumable state is written. A reusable initialization
  worktree must carry the exact private run owner claim and clean bound baseline;
  an unowned, dirty, wrong-branch, or wrong-baseline directory refuses. Before
  every pass,
  Helix snapshots the exact worktree bytes and Git HEAD/index into a mode-0700
  generation below the target Git common directory (`helix-checkpoints/`),
  never into Git objects or public records. Generation parents, reservations,
  reads, and atomic installation use the same non-symlink root-confined
  persistence boundary as structural records. Resume restores an interrupted
  pass from that generation; successful/failed pass completion removes it. The
  public state carries hashes/generation tokens only and the post-pass checkout
  fingerprint must match before resume. Abandoned generations after a hard kill
  are private operational residue and may be removed once the run is abandoned.
- Resume restores the recorded cast/toggles/config and validates the machine
  counters against that exact chain. Initialization checkpoints tolerate only
  the documented zero-event/empty-disagreement crash windows; all other missing,
  malformed, cross-repo, or stale companions refuse with stable codes.
- Runner state schema v3 adds the worktree-owner binding. Earlier state schemas
  deliberately fail closed; there is no implicit adoption or migration of a
  pre-ownership checkpoint.
- Hung provider calls are bounded only by Pi/provider timeouts (owner-accepted
  risk; no wall-time rail).

## Autoresearch Contract

- Explicit verb only (`/helix research`); never auto-triggered. What is
  mandatory is the SHAPE: a run refuses to start without a declared metric
  `{name, comparator, target}` and stop condition.
- Loop: hypothesis → experiment → measure → compare → iterate.
- Four stop reasons: `target-met`, `max-iterations`, `diminishing-returns`
  (N no-improvement iterations, N declared), `dead-end` (hypothesis refuted,
  no successor declared — reported as a valuable result).
- Attended only. Task-level research first; routing self-optimization is a
  future track mined from accumulated structural records.
- Research records are structural: hypothesis/experiment hashes, metric,
  per-iteration measurements, stop reason, worktree ref. Text stays
  worktree-local.
- Loops toggle off ⇒ one-shot research. A target hit or dead-end remains a
  result; a missed target stops as `max-iterations` with `ok:false` and the
  structural one-shot warning—never a fifth stop reason or false success.

## Context Engineering Contract

- One tracked markdown brief per role (`docs/stage3/agents/`); presets
  reference briefs by role.
- Prompt compiler: step prompts compile from tracked templates + role brief +
  task envelope + handoff packet. Records persist template id + input hashes,
  never compiled text. Compiled prompts remain memory-only adapter input; no
  debug flag or untracked directory may persist them.
- Handoff packets (claims, counterclaims, evidence refs, unresolved
  disagreement ids) are **adapter inputs**: they may carry substantive text
  between steps but are never persisted into records (Stage 3D precedent).
  Each stage starts with fresh context from its packet.
- Uninterrupted and resumed staged execution derive that text from the same
  contained durable worktree source (the declared stage artifact, otherwise
  the objective-gate file). State persists only the source stage/kind/content
  hash; a missing or changed source refuses instead of persisting raw envelopes
  or silently diverging on resume.
- Disagreement log: persisted, structural, extends contradiction preservation;
  a dropped contradiction still fails the run closed.
- Context pressure is displayed where Pi exposes it, honestly `unavailable`
  otherwise. No automatic compaction.

## Live Proof Contract

- Live-provider proof and paid proof are **manual, attended, approval-gated,
  never CI**. The paid proof's spend bound is the operator's backend control
  instance, confirmed by the operator before the run — an operational
  precondition, not harness code.
- This build ships no staged or legacy task-loop live adapter. Every non-mock
  loop cast therefore fails closed as `live-adapter-not-wired`, even if a caller
  supplies the adapter test seam; dependency injection is not authority to
  activate the deferred transport. The absence is never replaced by a mock or
  an optimistic preflight claim.

## Future Tracks (design-gated, not scheduled)

Web access for loops requires the container boundary contract first
(deny-by-default egress, domain allowlist, scoped credentials, PR-line review —
the Codex-style pattern) plus a no-live fixture proof. Remote control, hosted
adapter, package adoptions (pin + audit bar), scheduled runs, unattended
research, routing self-optimization, migrations, and compaction all remain
behind their own gates. The helix-fence extension is untouched, deferred future
work.
