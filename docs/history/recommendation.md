# Recommendation: keep and repair Helix's strict engine

Decision date: 2026-07-15.

## Decision

**Keep and repair Helix's own workflow engine. Do not adapt Helix to use either
`@quintinshaw/pi-dynamic-workflows` or `Michaelliv/pi-dynamic-workflows` as its
canonical executor.**

This means preserving the current declarative stage machine, provider policy,
objective gates, consent binding, structural persistence, artifact contract,
and internal checkpoint model. Current task-bound named workflow invocations
still start fresh after interruption. Keeping the engine does not mean freezing
Helix. Helix should selectively
backport useful mechanisms from Claude Code and, where their behavior can be
proved compatible, from Quintin Shaw's package. Those mechanisms should be
implemented behind Helix's existing policy boundaries rather than replacing
those boundaries.

This is explicitly not a “keep as-is” recommendation. The audit found that
resolved role effort was retained in Helix configuration but dropped before Pi
session creation on candidate, judge, synthesis, verifier, and staged revision
paths. The accompanying Helix change binds that value, maps `max` to Pi
`xhigh`, and refuses unsupported explicit levels during whole-cast preflight.
`default` and `provider-managed` remain intentional requests for Pi/provider
policy rather than exact thinking levels. The verified repair landed on Helix
main as `bb1c37f62ee1808a5c24bac06d975023f73dcb3b` via
[PR #8](https://github.com/luisgui1757/helix/pull/8).

The native Claude Code plugin in this repository should remain a complementary
execution surface for Claude backends and individually proven compatible
gateway routes. It is not a new provider-neutral Helix core. The 2026-07-16
CLIProxyAPI proof establishes one genuine exception to the earlier Claude-only
wording: a Claude Code Workflow subagent ran `gpt-5.6-luna` through a dedicated
Codex OAuth subscription route. Helix CC `0.3.0` additionally ships exact,
namespaced Copilot and Azure GPT translation boundaries with served-model
attestation, but implementation or catalog presence is not a live Workflow
proof. One complete mixed-provider delivery cast passed with
`openai/gpt-5.6-luna` and `copilot/gpt-5.4`; Azure remains live-unproven and
OpenRouter is deferred. None of these routes reproduces Helix's stronger policy/gate
semantics.

## Why this is the correct choice

Helix's differentiator is not merely fan-out, a progress display, or JavaScript
workflow syntax. Its differentiator is a closed, inspectable policy graph with
properties that can be checked before any model runs:

- finite stages, transitions, calls, passes, wall time, and artifact paths;
- exact provider/model and supported explicit-thinking resolution through Pi's
  `ModelRegistry`; managed-effort modes intentionally defer the level;
- no real-to-mock or requested-model-to-session-default fallback;
- task/configuration consent before run-directory creation or provider egress;
- a real non-model command or contained-file objective gate;
- provider-neutral panels with explicit minimum-success and transition rules;
- public-safe structural records that retain a task hash rather than prompts,
  model output, private source, or transcripts;
- repository-bound worktrees, checkpoints, event sequencing, and internal
  crash recovery, while current task-bound named workflow resume remains an
  explicit unsupported user-facing path;
  and
- separate definition simulation, deployment preflight, mock smoke, and real
  provider proof.

Replacing this engine with a general JavaScript harness would not be an
implementation refactor. It would change Helix's security, privacy, billing,
provider, and correctness contract.

## Options considered

### 1. Keep and repair Helix's engine — recommended

This option has the lowest semantic risk and is the only option that retains all
of Helix's deliberate invariants. It also keeps the real product advantage:
Helix can coordinate models from different providers with exact provider policy
while Claude Code's native workflow scheduler launches harness sessions whose
inference backend may be Claude or a separately proven compatible gateway.

The maintenance cost is owning a workflow engine. That cost is real, but the
current repository already contains the policy, lifecycle, persistence, provider,
gate, worktree, and test machinery that either alternative would need to regain.
The appropriate response is to simplify and harden that machinery incrementally,
not to discard it for a runtime with incompatible defaults.

### 2. Adapt to Quintin Shaw's package — not as the canonical engine

Quintin's `2.13.1` is the only serious reuse candidate. It provides genuine Pi
model routing, provider-reported usage, saved workflows, leases, journals,
resume, progress UI, quality helpers, shared state, nested workflows, agents,
worktrees, retries, timeouts, and a large test suite.

It nevertheless conflicts with Helix at policy-critical points:

1. Workflow JavaScript is trusted executable code; the package explicitly says
   its Node `vm` is not a security sandbox.
2. Requested worktree isolation can fail open into the shared checkout.
3. Workflow cleanup force-removes worktrees and branches even when a writer may
   have produced uncommitted work.
4. An unresolved requested model can fall back to the session default.
5. Per-agent timeout races do not abort the underlying agent attempt.
6. Exhausted recoverable failures become `null`, so completeness depends on
   each script author remembering to validate every result.
7. Persisted run state contains scripts, arguments, prompts, results, errors,
   history, logs, and journal values rather than Helix's structural projection.
8. A headless checkpoint approves by default unless its author explicitly asks
   it to abort.
9. Important budgets and timeouts default to unbounded, and concurrent work can
   overshoot a soft token budget.

Those are not cosmetic defaults. An adapter would have to interpose on model
resolution, isolation, cleanup, cancellation, result cardinality, persistence,
consent, and budgeting. At that point Helix would still own the hard parts while
also carrying a third-party runtime dependency.

Quintin's package remains worth using **separately** for trusted, exploratory,
ad hoc workflows where partial results and raw persisted history are acceptable.
It can be reconsidered for an explicitly experimental Helix mode only after the
readiness gates below pass.

### 3. Adapt to Michaelliv's package — no

Michaelliv's original is a clear, useful prototype. It proves that a small Pi
extension can expose `agent`, `parallel`, `pipeline`, phases, and schema-shaped
results. It is not an operational Helix base.

The parsed `model`, `isolation`, and `agentType` fields become prose instructions
rather than real model binding, worktree creation, or agent-registry selection.
There is no durable resume, leases, provider policy, objective gate, safe
persistence, worktree lifecycle, operational manager, or comparable lifecycle
test surface. Adopting it would require Helix to reimplement almost every feature
it already owns.

## What Helix should adopt natively

The following ideas are valuable without changing the executor:

1. **Mechanical untrusted-output framing.** Every upstream agent result inserted
   into a later prompt should be wrapped as untrusted data with collision-safe
   delimiters. Fence tokens originating in agent output must be neutralized.
2. **Bounded structured-output repair.** If Pi's installed public API supports a
   terminating schema tool or an in-session repair turn, Helix should give an
   agent a small, explicit repair allowance and then fail with a stable code.
   It must never infer or manufacture missing fields outside the agent session.
3. **Private attended progress details.** Safe last-action, duration, retry,
   timeout, and usage summaries can improve operations without entering the
   public structural record.
4. **Runtime capability preflight.** Detect required Pi/provider features and
   versions before consent and egress instead of discovering incompatibility in
   the middle of a run.
5. **Worktree lifecycle invariants.** Requested isolation must fail closed;
   changed work must be retained; unchanged worktrees may be cleaned; ownership
   and branch/path identity must remain explicit.
6. **Optional bounded nested delegation.** Consider it only if child calls share
   the same global provider, tool, concurrency, token, time, depth, record, and
   worktree policy. It should be off by default.

These are candidates, not assertions that every mechanism is wholly absent at
the current Helix head. The implementation agent must trace the existing path
and avoid duplicating behavior already present.

## Conditions for ever reconsidering Quintin as an adapter

All of these must be proven at a pinned package version before Helix imports it:

- arbitrary workflow scripts are a separately consented trusted-code class, or
  Helix compiles a validated declarative graph without accepting raw scripts;
- exact requested provider/model/thinking resolution fails before any call;
- required worktree creation fails closed and never uses the shared checkout;
- changed or unpushed worktrees are preserved and surfaced, never force-deleted;
- timeout cancellation reaches the underlying Pi session and waits for disposal;
- strict calls return typed success/failure values and enforce panel cardinality;
- the persistence layer has a tested structural-only mode with no prompt, task,
  result, script, transcript, private path, or source-content retention;
- headless authorization checkpoints always abort;
- calls, attempts, parallelism, tokens, cost, nesting, iterations, and time have
  hard run-level bounds with a documented concurrent-overshoot formula;
- Helix's objective command/file gate remains external and authoritative; and
- the complete Helix lifecycle, privacy, consent, provider, gate, worktree,
  recovery, and public-safety suites pass against the adapter.

Until every item is true, an adapter may be an isolated research prototype but
must not be selectable by normal Helix workflows.

## Dispatch prompt for a coding agent

The following prompt implements this recommendation in the Helix repository. It
deliberately asks for a narrow native uplift rather than an executor migration.
It is written to remain safe if the repository changes after the evidence
snapshot used for this report.

```text
You are implementing a strict-core retention and safe selective-uplift change in
the Helix repository: https://github.com/luisgui1757/helix.

MODE: WRITE / FIX.

DELIVERY: implement the complete accepted scope on one branch, push that branch
directly, and open no pull request. Do not split the work into partial branches,
piecewise PRs, or separately shipped work packages.

GOAL

Keep Helix's current declarative, provider-neutral workflow engine as the
canonical executor. Do NOT add, vendor, wrap, or depend on either
@quintinshaw/pi-dynamic-workflows or Michaelliv/pi-dynamic-workflows. Implement
mechanical prompt-injection framing for agent-to-agent handoffs, then investigate
and—only if the installed Pi public API supports it without weakening current
semantics—add bounded same-session structured-output repair. Update every
relevant Markdown truth surface and add meaningful regression tests.

The outcome is verified only when all existing Helix gates and the new focused
tests pass. Do not substitute skips, fallbacks, suppressions, deleted tests,
weakened validators, or prose-only promises for implementation.

PRECONDITIONS AND ISOLATION

1. Work from a new isolated git worktree or disposable clone. Do not overwrite
   another actor's changes and do not work directly in a dirty primary checkout.
2. Fetch the current remote default branch. Record the exact starting SHA. The
   2026-07-15 analysis used ba2453ac4c3cad126f390b622348ec4e69495775,
   but that SHA is evidence, not a demand to reset newer work.
3. Read AGENTS.md completely, followed by README.md, docs/architecture.md,
   docs/manual.md, docs/workflows.md, and package.json. Search for additional
   repository-level instructions before editing.
4. Inspect the current paths before accepting any claim in this prompt. At the
   evidence SHA, the principal paths were dispatch/lib/pi-agent-adapter.mjs,
   dispatch/lib/orchestrate.mjs, dispatch/lib/synthesis.mjs,
   dispatch/lib/handoff.mjs, dispatch/lib/revision-effect.mjs,
   dispatch/lib/openrouter-revision-adapter.mjs, dispatch/lib/events.mjs,
   dispatch/lib/run-record.mjs, dispatch/lib/runner.mjs, and tests/*.test.mjs.
5. If current code already implements one requested behavior, do not build a
   parallel abstraction. Prove the existing behavior, close only its actual
   gaps, and document the evidence.

NON-NEGOTIABLE INVARIANTS

- Workflow definitions remain closed declarative data. Do not introduce a raw
  user-authored JavaScript executor.
- Pi ModelRegistry remains the provider/model authority. A requested exact
  provider/model/thinking tuple must fail before egress if unavailable. Never
  fall back to another real model, the session default, or mock.
- Consent remains bound to the task, workflow digest, profiles, toggles,
  presets, repository, and worktree choice before run-directory creation,
  mutation, or provider calls.
- Public persistence remains structural and task-hash-only. Do not write raw
  task text, prompts, model results, source excerpts, transcripts, fence payloads,
  private paths, credentials, or provider payloads to run records, events,
  checkpoints, diagnostics, test snapshots, or error strings.
- The objective command/file gate remains non-model and authoritative.
- Worktree isolation remains a Git boundary, fails closed when requested, and
  does not silently become an operating-system sandbox claim.
- Existing role tool policies, writer serialization, reader concurrency bounds,
  stage transitions, artifact rules, resume identity, event sequencing, and
  runtime/call/iteration/time limits remain intact.
- Real-provider tests stay opt-in. Unit and integration tests added by this task
  must use injected/mock boundaries and cause no live network or model egress.

WORK PACKAGE A — TRACE THE CURRENT HANDOFF GRAPH

1. Build a written data-flow inventory covering every place model-controlled or
   repository-controlled free text enters another model prompt. Include normal
   role results, panel candidates, judge/synthesizer inputs, revision prompts,
   verifier inputs, stage handoffs, disagreement packets, research paths, and
   provider-specific revision adapters.
2. For each boundary, record:
   - producer and consumer;
   - whether the value is raw text, parsed structured data, a hash/ref, or a
     structural projection;
   - whether it is persisted;
   - the current escaping/framing behavior; and
   - whether it needs a code change.
3. Put durable architecture conclusions in docs/architecture.md or the
   repository's established review/assumption ledger. Do not add a throwaway
   report that future maintainers will not find.
4. Explicitly identify boundaries that are already structurally safe. Do not
   wrap hash-only or closed-enum data in unnecessary prompt machinery.

WORK PACKAGE B — MECHANICAL UNTRUSTED-DATA FRAMING

1. Add the smallest shared helper consistent with existing architecture for
   embedding untrusted text in a model prompt. Stable policy must not depend on
   UI, persistence, or a provider-specific adapter.
2. The helper must:
   - coerce only explicitly supported input types and reject invalid values;
   - impose an existing or newly documented byte/character bound before prompt
     construction, failing with a stable error rather than truncating silently;
   - generate or select collision-safe begin/end delimiters;
   - neutralize any delimiter/control tokens found in the untrusted payload;
   - state in the generated prompt that the enclosed content is data, may contain
     malicious instructions, and must not override the role/system/task;
   - preserve the payload's semantic content well enough for review/synthesis;
   - return only in-memory prompt material and never log or persist the payload;
   - avoid secrets/path/content in thrown errors; and
   - be deterministic under injected test inputs if randomness is used.
3. Apply the helper at every confirmed raw-text agent-to-agent boundary. Avoid
   double-framing. Provider-specific adapters may call the stable helper, but
   they must not implement divergent escaping policies.
4. Keep prompts concise. Framing is a trust-boundary control, not an excuse to
   duplicate system instructions into every message.
5. Add focused tests for at least:
   - empty, one-character, maximum-size, and over-limit payloads;
   - payloads containing the exact begin/end tokens;
   - Markdown fences, XML-like closing tags, role/system prompt phrases, JSON,
     NUL/control characters, Unicode, and multiline content;
   - deterministic collision handling;
   - absence of raw payloads from public events/run records/checkpoints/errors;
   - normal judge/synthesis/revision behavior after framing; and
   - a multi-location test proving every inventoried raw boundary uses the
     canonical helper.

WORK PACKAGE C — BOUNDED STRUCTURED-OUTPUT REPAIR

Treat this as an investigation with a hard implementation gate; do not guess an
SDK API.

1. Inspect the exact installed/declared @earendil-works/pi-coding-agent public
   API and Helix's current pi-agent-adapter parsing path. Determine whether a
   fresh AgentSession can expose a terminating structured-output tool or accept
   a bounded follow-up in the SAME session after malformed/missing semantic JSON.
2. Prefer an official schema/terminating-tool mechanism if it exists and
   preserves normal Pi tool policy. Otherwise, a same-session repair prompt is
   acceptable only if the session remains cancellable and the repair counts
   against the existing per-call token, time, turn, and attempt budgets.
3. If neither mechanism can be established from the actual public API, do not
   implement a speculative shim and do not add a dependency. Record the verified
   limitation and a decision-complete future design in docs/architecture.md and
   stop this work package without weakening the current fail-closed parser.
4. If implementation is supported:
   - make the repair allowance explicit and bounded (default at most 2);
   - use the same session so the agent can correct its own output;
   - describe validation errors structurally without echoing private payloads;
   - disallow any new mutation/tool authority during a repair turn;
   - connect timeout/abort to the underlying session and wait for termination;
   - charge repair turns to all existing global and per-call budgets;
   - return only a schema-valid value;
   - after exhaustion, fail with a stable code and no manufactured/default data;
   - never turn an unavailable provider/model into a repair attempt; and
   - keep raw attempts out of public persistence and diagnostics.
5. Add focused tests for first-attempt success, malformed JSON then repair,
   semantically invalid JSON then repair, no structured tool/result, repeated
   invalid repair, timeout during repair, external abort, budget exhaustion,
   forbidden tool use, exact provider/model retention, and public-safety scans.

WORK PACKAGE D — DOCUMENTATION AND DECISION RECORD

In the same change:

1. Update README.md only where user-visible behavior or test commands/counts
   actually change.
2. Update docs/architecture.md with the trust-boundary diagram/data flow,
   framing invariant, repair lifecycle if implemented, stable failure behavior,
   and why neither dynamic-workflows package is the executor.
3. Update docs/manual.md and docs/workflows.md for any operator-visible behavior.
4. Update roadmap/TODO/STATUS/review ledgers that mention prompt handoff,
   structured results, or executor reuse. Mark partial work partial; do not call
   an investigation implemented.
5. If a candidate change is rejected, record the rationale in the established
   rejected-finding/assumption location so it is not rediscovered later.
6. Keep documentation statements tied to tests or source. Do not claim an OS
   sandbox, deterministic model correctness, secret detection, or full prompt-
   injection prevention. The claim is narrower: mechanical trust framing makes
   the control/data boundary explicit and resists delimiter breakout.

VERIFICATION

Run the focused tests during development, then the repository's full required
gate from a clean state. At the evidence SHA that included at least:

  npm test
  npm run check:resources
  npm run check:docs-truth
  npm run check:public-safety-diff
  npm run check:no-live-egress

Also:

- inspect git diff --check;
- search the final diff for accidental raw prompts/results, credentials, private
  paths, debug logging, package references, TODO stubs, skipped tests, and new
  suppressions;
- prove tests made zero live provider calls;
- report exact test counts and commands from actual output, not README badges;
- report anything not run, unavailable, or timing out as unverified; and
- preserve any changed worktree for review—do not force-delete it.

STOP CONDITIONS

Stop and report evidence instead of improvising if:

- repository instructions conflict with this prompt;
- safe implementation requires changing public persisted shape, consent,
  objective-gate authority, provider fallback, or workflow semantics;
- the needed Pi operation is private/undocumented or requires a global upgrade;
- a repair attempt cannot be connected to real cancellation and existing
  budgets;
- public-safety guarantees would require storing or logging raw model content;
- two attempts at the same fix fail, indicating the diagnosis is wrong; or
  unrelated user changes overlap the required files.

HANDOFF FORMAT

Lead with the result: whether framing shipped and whether structured-output
repair was implemented or rejected after API inspection. Then provide:

1. exact starting and ending SHAs/branch/worktree;
2. invariant-by-invariant behavior changes;
3. tests added and bugs they reproduce;
4. exact verification commands and pass/fail/skip counts;
5. residual risks and deliberately unimplemented items;
6. documentation/ledger updates; and
7. a final table with one row per changed file: File | What changed | Why.

Do not merge to the default branch, publish, upgrade global Pi, or run
real-provider proof without separate explicit authorization. Open no pull
request.
```

## Bottom line

Keep repairing and use Helix for strict, auditable, mixed-provider delivery loops. Use the Helix CC
plugin for a high-quality native Claude Code harness experience with Claude
backends and individually proven gateway routes; the shipped OpenAI-subscription
proof covers `gpt-5.6-luna`. Use Quintin's package
separately for trusted exploratory Pi workflows if its persistence and isolation
trade-offs are acceptable. Treat Michaelliv's repository as a compact reference
implementation, not a migration target.
