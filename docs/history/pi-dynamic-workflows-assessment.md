# Pi dynamic workflows assessment

## Decision

Do **not** replace Helix with either Pi dynamic-workflows repository.

Michaelliv's repository is a useful prototype and historical design reference, not an operational base. Quintin Shaw's package is a much more substantial workflow product and is worth using for ad hoc dynamic fan-out, research, and review. Its current trust, provider fallback, worktree, timeout, persistence, and headless-consent semantics conflict with Helix's strict-loop invariants.

If Helix later adds a clearly labeled **experimental dynamic mode**, Quintin's package is the only plausible reuse candidate. It must sit beside the strict Helix engine, behind a policy adapter and pinned version. It must not become the canonical executor until the blockers below are fixed and regression-tested.

## Exact versions and test evidence

| Repository | Source inspected | Size | Test result | Dependency audit after clean install |
|---|---|---:|---:|---:|
| [Michaelliv/pi-dynamic-workflows](https://github.com/Michaelliv/pi-dynamic-workflows) | `31b2aca0f1cb195aafbfc5e3ee2b8c83ad3f21a2`, package `1.0.1` | 1,803 relevant lines | 24/24 pass | 5 advisories: 1 low, 4 high |
| [QuintinShaw/pi-dynamic-workflows](https://github.com/QuintinShaw/pi-dynamic-workflows) | `b587566e30bc3befe15a6539584ec3d79c0c5caf`, package `2.13.1` | 23,719 source/test lines | 827/827 pass | 2 advisories: 1 low, 1 moderate |

The Quintin README badge says “679 passing,” while the exact checked-out suite reports 827. This is documentation drift, not a test failure. The two repositories have no git merge-base in their current histories; Quintin credits the original concept and contributor in metadata, but it is not a linearly maintained fork that can be updated by ordinary upstream merges.

The installed Pi is `0.80.3`. Quintin `2.13.1` declares `@earendil-works/pi-coding-agent` and `pi-tui` peers `>=0.80.6`. Source and unit tests could be verified in a disposable clone, but the package could not be honestly integration-tested in the user's installed Pi runtime without a global Pi upgrade. No such upgrade was performed.

## Michaelliv's original

### What it gets right

- Small, understandable core: literal `meta`, restricted JavaScript, `agent`, `parallel`, `pipeline`, phases, logs, args, and a token estimate.
- Fresh in-memory Pi sessions.
- JSON-schema output through a terminating `structured_output` tool.
- Concurrency capped at 16.
- Abort is connected to `session.abort()`.
- The source openly calls itself a prototype and says persisted/resumable runs and `/workflows` are absent.

### Why it is not a Helix base

Several options look more complete than their implementation:

- `model`, `isolation`, and `agentType` are parsed, but they are converted only into prose instructions. The runtime call passes label, schema, abort signal, and instructions; it does not bind a different model, create a worktree, or resolve an agent registry. See [`src/workflow.ts` agent execution](https://github.com/Michaelliv/pi-dynamic-workflows/blob/31b2aca0f1cb195aafbfc5e3ee2b8c83ad3f21a2/src/workflow.ts#L101-L129) and [`buildAgentInstructions`](https://github.com/Michaelliv/pi-dynamic-workflows/blob/31b2aca0f1cb195aafbfc5e3ee2b8c83ad3f21a2/src/workflow.ts#L442-L451).
- Every non-abort agent exception becomes `null`; `parallel` and `pipeline` also swallow branch exceptions into `null`. A workflow author must remember to prove cardinality/completeness.
- The token budget uses an output-size estimate, not provider-reported usage.
- There is no provider registry routing, cost accounting, durable run state, resume journal, leases, background manager, saved workflow library, quality-helper standard library, real worktree implementation, per-agent timeout/retry policy, or operational navigator.
- The test suite is good for the compact prototype but too small to establish Helix's lifecycle, privacy, provider, worktree, gate, crash, and consent invariants.

Adapting Helix to Michaelliv would mean re-implementing almost everything Helix already has. It creates migration risk without reducing maintenance.

## Quintin Shaw's expansion

### Material strengths

This package is not “just the prototype with more examples.” It adds:

- real Pi `ModelRegistry` routing with `provider/model:thinking`, named tiers, per-phase defaults, and agent definitions;
- provider-reported token and cost accounting;
- background-by-default runs, progress panel, detailed per-agent history, pause/stop/restart, provider-limit classification, and result delivery;
- persisted run state, atomic saves/backups, leases, deterministic call hashing, longest-unchanged-prefix resume, and saved workflows;
- shared store tools and one-level nested workflows under global concurrency/agent caps;
- schema repair, retries, per-agent timeouts, phase budgets, and a quality standard library (`verify`, `judgePanel`, `loopUntilDry`, `completenessCheck`, `retry`, `gate`, `checkpoint`);
- project/user agent registries and tool allow/deny policies;
- optional subagent transcript persistence;
- real worktree creation; and
- 827 passing tests covering a much broader operational surface.

For dynamic research, multi-perspective review, exploratory audits, and model-routed fan-out inside Pi, this is useful software.

### Blocking semantic mismatches with Helix

#### P0 — raw workflow JavaScript is trusted code, not a security boundary

The runtime explicitly states that Node `vm` is **not** a security sandbox: an injected bridge function's `.constructor` can reach the host `Function`, and determinism hardening is only best-effort for trusted/guided scripts. See [`src/workflow.ts` lines 229–240](https://github.com/QuintinShaw/pi-dynamic-workflows/blob/b587566e30bc3befe15a6539584ec3d79c0c5caf/src/workflow.ts#L229-L240).

That is acceptable when a trusted user asks a model to author a local script and approves the risk. It is not equivalent to Helix's closed JSON graph with statically bounded nodes, transitions, paths, gates, and artifact locations. A raw script can encode surprising computation and use powerful host bridge functions even when imports are absent.

Required before a strict integration: treat scripts as trusted executable policy, require an explicit separate consent class, or compile a Helix declarative graph into a closed internal representation rather than accepting model-written JavaScript.

#### P0 — requested worktree isolation fails open into the shared checkout

`createWorktree()` returns `{isolated:false, cwd:baseCwd}` for a non-git directory or any `git worktree add` failure. The workflow logs “isolation ignored” and runs the agent without an isolated `cwd`. See [`src/worktree.ts` lines 36–58](https://github.com/QuintinShaw/pi-dynamic-workflows/blob/b587566e30bc3befe15a6539584ec3d79c0c5caf/src/worktree.ts#L36-L58) and [`src/workflow.ts` lines 458–469](https://github.com/QuintinShaw/pi-dynamic-workflows/blob/b587566e30bc3befe15a6539584ec3d79c0c5caf/src/workflow.ts#L458-L469).

For a read-only agent this may be tolerable. For parallel writers it defeats the requested conflict boundary and can corrupt the parent checkout. Helix cannot accept this as a warning-only downgrade.

Required: an `isolationRequired`/strict policy that fails before the agent starts, plus tests for non-git, branch collision, hook failure, missing git, and cleanup failure.

#### P0 — changed worktree output is forcibly deleted

The package says results are not auto-merged and the path is surfaced, but the workflow always calls `removeWorktree()` in `finally`. That function uses `git worktree remove --force` and `git branch -D`, swallowing cleanup errors. See [`src/workflow.ts` lines 593–596](https://github.com/QuintinShaw/pi-dynamic-workflows/blob/b587566e30bc3befe15a6539584ec3d79c0c5caf/src/workflow.ts#L593-L596) and [`src/worktree.ts` lines 61–75](https://github.com/QuintinShaw/pi-dynamic-workflows/blob/b587566e30bc3befe15a6539584ec3d79c0c5caf/src/worktree.ts#L61-L75).

For a writer that edits but does not independently commit/export a patch before returning, successful work disappears immediately. Surfacing the path in an `onAgentEnd` event does not help after `finally` deletes it.

Required: inspect git state at completion. Auto-remove only unchanged worktrees. Preserve changed/unpushed worktrees and report their path/branch, or perform an explicit reviewed integration step. Never force-delete changed work as normal cleanup.

#### P0 — model selection can fall back to the session default

If a requested model cannot resolve, `WorkflowAgent` warns and continues without a resolved model, causing the Pi session default to run. The workflow logs the fallback. See [`src/agent.ts` lines 440–462](https://github.com/QuintinShaw/pi-dynamic-workflows/blob/b587566e30bc3befe15a6539584ec3d79c0c5caf/src/agent.ts#L440-L462).

Visible fallback is better than silent fallback, but Helix's requirement is exact binding. A run configured “review with provider X/model Y” must stop if X/Y is unavailable. Running a different default changes capability, billing, data routing, and subscription semantics.

Required: a run-level `requireExactModels` defaulting true in a Helix adapter. Resolution errors must occur before any provider call. The persisted run must record requested and resolved provider/model/thinking and prove equality under strict mode.

#### P1 — a per-agent timeout does not abort the underlying agent

`withTimeout()` races the agent promise against a timer. The `agentRunner.run()` receives only the run-wide `options.signal`; no timeout-derived abort signal is created. When the timer wins, the wrapper returns a recoverable timeout and enters cleanup while the original agent promise can continue executing. See [`src/workflow.ts` lines 495–530](https://github.com/QuintinShaw/pi-dynamic-workflows/blob/b587566e30bc3befe15a6539584ec3d79c0c5caf/src/workflow.ts#L495-L530) and [`withTimeout`](https://github.com/QuintinShaw/pi-dynamic-workflows/blob/b587566e30bc3befe15a6539584ec3d79c0c5caf/src/workflow.ts#L1156-L1180).

This is especially risky with a worktree: cleanup can remove the directory while the timed-out session still holds it or attempts tools. Retrying can also overlap the original attempt.

Required: a per-attempt `AbortController` linked to the run signal; abort on timeout; wait for session disposal with a bounded grace period; then classify cleanup state. Add a test proving the underlying runner observes abort and that no retry starts before the previous attempt settles.

#### P1 — recoverable failures become `null` by default

After retries, a recoverable agent error returns `null`; parallel/pipeline recoverable branch errors do likewise. The package documents that workflow authors must check nulls. See [`src/workflow.ts` lines 557–618](https://github.com/QuintinShaw/pi-dynamic-workflows/blob/b587566e30bc3befe15a6539584ec3d79c0c5caf/src/workflow.ts#L557-L618).

This supports graceful partial research, but a forgotten filter/cardinality check can turn a failed panel into apparent consensus. Helix has explicit panel success thresholds and should not delegate this invariant to arbitrary script authors.

Required: adapter-generated assertions for required roles and minimum successes; typed settled results (`ok/value` or `ok:false/error`) rather than raw null for strict mode.

#### P1 — persisted run state contains task and agent content

The run shape stores the entire script, args, every agent prompt, results, errors, compact history, logs, model, and journaled results. See [`src/run-persistence.ts` lines 13–61](https://github.com/QuintinShaw/pi-dynamic-workflows/blob/b587566e30bc3befe15a6539584ec3d79c0c5caf/src/run-persistence.ts#L13-L61) and [`workflow-manager.ts` persistence](https://github.com/QuintinShaw/pi-dynamic-workflows/blob/b587566e30bc3befe15a6539584ec3d79c0c5caf/src/workflow-manager.ts#L476-L506).

Optional full session persistence expands this further; the README correctly warns that anything read into context, including secrets, can land on disk. Helix deliberately keeps only structural public-safe metadata and a task hash.

Required: a Helix-compatible persistence mode with redacted structural records, task hash, model/cost metadata, artifact digests, error codes, and journal identifiers—never raw prompts/results/source excerpts. Private debug transcripts must be separately consented, access-controlled, and retention-bounded.

#### P1 — headless checkpoints approve by default unless the author opts out

Without a UI callback, `checkpoint()` returns its declared default or `true`; only `{headless:'abort'}` fails. See [`src/workflow.ts` lines 840–879](https://github.com/QuintinShaw/pi-dynamic-workflows/blob/b587566e30bc3befe15a6539584ec3d79c0c5caf/src/workflow.ts#L840-L879).

This keeps background workflows moving, but it can turn an intended human approval into automatic approval. Helix requires real consent before side effects/provider calls.

Required: strict adapter always supplies `headless:'abort'` for authorization checkpoints. A default may be used only for non-authoritative branching and must be labeled as an automated default, not human consent.

#### P2 — unbounded defaults and soft token overshoot

The default agent timeout and token budget are `null`; limits are opt-in. Concurrency is at most 16 and agents at most 1000. The token gate is based on accumulated completed usage, so already-running parallel agents can overshoot a nominal budget. See [`src/config.ts`](https://github.com/QuintinShaw/pi-dynamic-workflows/blob/b587566e30bc3befe15a6539584ec3d79c0c5caf/src/config.ts#L5-L18).

These defaults optimize exploratory workflows. Helix requires bounded runtime/calls/iterations and should carry reserved budget per wave or document a bounded overshoot formula.

### Non-blocking but important operational notes

- Saved run JSON and optional agent transcripts are stored under the user's home, not the repository. This avoids repo clutter but does not make the records public-safe.
- Session-persistence failure silently falls back to in-memory. For optional debugging this is reasonable; for a required audit trail it must fail closed.
- Model tier auto-ranking uses name substrings. Convenient defaults are not authoritative capability policy; exact Helix profiles should bypass it.
- The package's `loopUntilDry` returns partial results on budget/agent-limit exhaustion. Strict workflows must expose that incompleteness rather than treating it as a dry fixed point.
- The package offers a real exported library surface, making an adapter technically feasible. The policy differences, not import mechanics, are the blocker.

## Which approach is closest to Claude Code?

There is no honest single-axis “closest” winner.

- **Quintin is closest in runtime mechanics and user experience.** Its trusted
  JavaScript, `agent`/`parallel`/`pipeline` composition, progress, nested calls,
  structured-output tool, saved runs, and resumable journals resemble Claude
  Code dynamic workflows more directly than Helix's declarative stage machine.
- **Helix is closest to the strict delivery contract this project wants from a
  gold-standard harness.** It owns exact provider policy, bounded declarative
  transitions, objective non-model gates, public-safe structural persistence,
  consent binding, and repository-bound recovery. Those are deliberately
  stronger or different controls, not proof that its subagent mechanics match
  Claude's more closely.
- **Michaelliv is closest only as the small original API sketch.** It resembles
  Claude's surface vocabulary but lacks the operational machinery needed for
  either Helix's strict contract or Claude's production runtime.

Therefore the answer to “is Helix's subagent/workflow approach closer to Claude
Code than either package?” is **no for orchestration mechanics, yes for the
strict policy outcome Helix is designed to preserve**. The recommendation is
based on contract fit, not superficial API similarity.

## Comparative fit

| Requirement | Helix today | Michaelliv | Quintin 2.13.1 |
|---|---:|---:|---:|
| Closed declarative graph | Yes | No | No |
| Real per-agent provider/model routing | Yes | No; prose hint only | Yes, but fallback permitted |
| Objective non-model gate | Yes | No | No built-in equivalent |
| Exact consent binding | Yes | No | Checkpoint exists; headless defaults can auto-approve |
| Bounded stage/iteration/runtime policy | Yes | Partial | Configurable; defaults largely unbounded |
| Parallel/pipeline code mode | Fixed panels/stages | Yes | Yes + quality stdlib |
| Durable resume/leases | Internal runner yes; task-bound named workflow resume unsupported | No | Yes |
| Public-safe structural persistence | Yes | No persistence | No; raw content persisted |
| Worktree isolation | Helix boundary | Parsed only, not implemented | Real but fail-open and force-cleaned |
| Cost/progress UI | Structural Helix status | Minimal | Strong |
| Tests at inspected head | Helix full suite | 24 | 827 |

## Safe reuse boundary

If experimentation is authorized later, the safe boundary is:

```text
Helix strict policy + consent + exact profile + structural recorder
  -> pinned adapter
      -> Quintin agent/session/model/progress primitives
          -> Pi providers
```

Do not pass arbitrary model-written JavaScript from Helix strict mode. Generate or call a reviewed adapter program from a validated Helix definition. The adapter must enforce exact models, required isolation, aborting deadlines, panel cardinality, structural persistence, and headless checkpoint failure.

Until those controls exist, run Quintin's package separately for exploratory workflows and keep Helix for delivery workflows where provider identity, gates, artifacts, consent, and auditability matter.
