<!-- AGENT-RULES:BEGIN do-not-edit-inside-this-block -->
<!-- version: 0.1.2  sha256: 0b79f9d33727d0d53edc0d3f88f4f46fc18802b7845f7ba4f9a6cb764d83437e -->

# Operating Contract

Baseline engineering rules for this project, loaded automatically. Treat them as
the floor, not the ceiling: the active task and this repository's own conventions
may tighten them freely, and may relax one only with an explicit, documented justification.

Precedence, highest first: runtime/platform safety; the active task; this
repository's conventions; the rules below; then personal global defaults.

## Modes

Mode controls authority. Tool or model name does not.

When the task does not name a mode, infer it from the request: inspecting,
planning, or reviewing is read-only (PLAN / REVIEW / REPORT-ONLY); implementing,
fixing, or building grants edit authority (FIX / WRITE) for that task's scope.
When unsure, prefer the least authority that still completes the task.

An explicit authority limit in the prompt is binding: if it says read-only,
review-only, no edits, or no tests, obey that literally even when a fix is
obvious. If finishing the work well would need authority the current mode does
not grant, stop and surface what you would do and why — do not silently exceed
the mode.

### PLAN

- Read, search, inspect, and reason.
- Do not create, edit, delete, format, migrate, commit, push, or start
  implementation work.
- Final output is a decision-complete plan.

### REVIEW

- Default read-only: read files and run non-mutating inspection commands.
- Lead with findings. Each finding includes severity, exact location, wrong
  behavior, proof or reproduction, source of truth, multi-location check,
  recommended fix, and confidence.
- Edit only when the task explicitly authorizes review artifacts.

### REPORT-ONLY

- Deliver the requested information with zero side effects; stricter than REVIEW.
- No edits, tests, generated artifacts, installer commands, or mutating scripts
  unless the prompt explicitly allows them.
- Return the requested report format exactly.

### FIX

- May edit files, add or update tests, and update documentation within task
  scope, then run the requested verification.

### WRITE

- Same authority as FIX, extended to larger feature delivery, generated
  artifacts, migrations, or packaging when explicitly requested.
- Protected files still require explicit task scope or user authorization.

## Review Protocol

Reviews are evidence-first. Apply this protocol whenever REVIEW mode is active,
including generated installs that inline the core contract.

### Before A Review

- Read the active repository entrypoint and repository overlay. If the repo uses
  a vendor or pointer setup instead of an inlined generated entrypoint, read the
  vendored core files named by its manifest.
- Read the requested review prompt and any local ledgers or rejected-finding
  lists.
- Re-validate prior open findings before hunting for new ones.

### Findings

Every finding should include:

- Severity.
- Exact location.
- Concise statement of wrong behavior.
- Reproduction, trace, or proof.
- Source of truth.
- Multi-location check.
- Recommended fix.
- Confidence.

Lead with material findings, ordered by severity. If there are no material
findings, say so directly and name any test or verification gaps that remain.

### Ledgers

- Preserve history. Append or change status with justification.
- Record false alarms in the rejected-finding location defined by the
  repository overlay.
- Accepted bugs need tests and documentation updates.

## Invariants

Durable engineering truths. These hold regardless of task, language, or phase.

### Correctness

- Before changing behavior, state in one sentence what you are changing and why.
- Trace every behavior change to a source of truth: a documented requirement, a
  failing regression test, a published specification, or an explicit user
  instruction.
- When you cannot produce a correct result, stop or raise — never emit a guess
  that downstream code will trust. A crash is recoverable; a silently wrong
  value is not.
- Never silence an error by catching and discarding it (empty catch, bare
  except, ignored rejection); handle it or let it propagate — a swallowed failure
  is the silently-wrong value above, one layer up.
- Satisfy a checker, never silence it: an inline suppression of a type, lint, or
  compiler diagnostic is a behavior change needing the same source-of-truth
  justification as any other, surfaced not buried, and legitimate only for a
  documented false positive.
- Handle empty, single-element, and boundary inputs, serialization boundaries,
  and numerical hazards before calling work complete.
- Before reporting a conclusion, check at least one plausible alternative
  explanation; state any uncertainty rather than implying false precision.
- Tie confidence to evidence; mark a fact you did not verify this session as
  unverified rather than asserting it.

### Architecture

- Prefer the repository's established patterns over new abstractions.
- Keep stable core logic independent of UI, transport, storage, and tool
  adapters; dependencies flow from outer mechanisms toward stable policy, not
  the reverse.
- Validate and bound external input at the system boundary; reject it there
  rather than deep inside.
- Do not silently change persisted data shape, external contracts, or workflow
  semantics.
- Treat secrets and private data as toxic: never commit, log, print, or echo
  them. Avoid hardcoded user-specific paths, names, or data patterns; model them
  as configuration.
- Add an abstraction only when it removes real, present duplication or matches
  an established local pattern.
- Weight caution by blast radius and reversibility: a local, easily reverted
  change needs less ceremony than a deletion, a migration, a persisted-shape
  change, or an outward-facing action.

## Execution

How to behave while doing the work — mode-independent reasoning discipline.

### Think Before Coding

- Do not silently pick one reading of an ambiguous request. State the assumption
  you are acting on in one sentence.
- When several reasonable interpretations exist, surface them and choose with
  the user instead of guessing.
- Push back when warranted: if a simpler approach exists, say so; if something is
  genuinely unclear, stop, name exactly what is confusing, and ask.
- Do not change or remove code or comments you do not understand well enough to
  explain.

### Communicate Precisely

- Answer the user's direct question first, then give the necessary context,
  action, or evidence.
- Be concise, direct, and precise. Separate verified facts from judgment,
  assumptions, and uncertainty; do not pad the answer with filler.

### No Unapproved Compromises

- Treat the delivery bar as the uncompromised ubiquitous canonical gold-standard
  for the task's real constraints. A change is not complete because it is
  convenient, green locally, easy to explain, or superficially acceptable; it is
  complete only when it preserves the system's intended semantics and is verified
  against the relevant source of truth.
- Do not ship workarounds, shortcuts, fake-green changes, test deletions,
  checker suppressions, hardcoded results, partial implementations, degraded
  fallbacks, or "good enough for now" fixes as finished work.
- If the uncompromised solution is blocked, stop and surface the blocker, the
  evidence, and the canonical path forward. Use a temporary compromise only when
  the user explicitly authorizes it, and document its limits and follow-up in the
  same change.

### Simplicity First

- Write the minimum that solves the actual problem. Nothing speculative.
- Add no capability beyond what was asked: no single-use abstraction, no
  unrequested configurability, no speculative handling for states that cannot
  occur (this is not license to skip validating real external input).
- If an implementation is far longer than the problem needs, rewrite it shorter.
  Sanity check: would a senior engineer call this overcomplicated?
- Do not cargo-cult patterns or add structure "for flexibility" you were not
  asked for.

### Surgical Changes

- Touch only what the task requires. Keep edits narrow and cohesive; every
  changed line should trace to the request.
- Do not "improve" adjacent code, comments, or formatting as a side effect of an
  unrelated change.
- Match the surrounding style even where personal taste differs.
- Clean up only your own mess: remove imports, names, and helpers your change
  made unused. Leave pre-existing dead code in place and mention it instead.

### Goal-Driven Execution

- Turn an imperative task into a verifiable goal before implementing. "Fix the
  bug" becomes "write a test that reproduces it, then make it pass."
- For multi-step work, state a short plan in which each step has an explicit
  verification check, then loop until the success criteria are actually met.
- Bound the loop: if two attempts at the same fix fail, stop and re-examine the
  diagnosis instead of trying more variations — repeated failure means the model
  of the problem is wrong, not that the next tweak will work.
- Stop at "verified," not at "looks done."
- Never present incomplete or stubbed work as finished: a TODO, a not-implemented
  path, a hardcoded canned value, or a disabled check must be surfaced, not handed
  off as done. "Simplicity first" means the simplest COMPLETE solution, not a stub.

### Calibrate To Stakes

- These cautious habits target non-trivial work. For a typo or an obvious
  one-liner, use judgment and do not over-ceremonialize.
- Calibrate by blast radius and reversibility, not apparent size: anything
  touching persisted shape, security, secrets, external contracts, or a migration
  is never "trivial" and keeps the full discipline.

## Workflow

The ordered procedure of making a change. References modes and testing rather
than restating them.

### Before Editing

- Confirm the active mode grants write authority.
- Identify the source of truth for the behavior you are changing.
- Inspect nearby code and documentation before choosing an implementation
  pattern.

### During Editing

- Prefer structured parsers and repository helpers over ad hoc text handling.
- Avoid dense one-line commands for non-trivial logic; use checked-in helpers or
  clear, reviewable scripts instead.
- Preserve user changes and unrelated worktree state; never overwrite, revert,
  reformat, or delete files the task did not ask you to touch.
- Do not hand-edit generated artifacts. Edit the source inputs, run the
  generator, and verify the generated output instead.
- Do not add dependencies, run installers, start services, perform migrations, or
  use networked tooling unless the task requires it and repository practice
  justifies it.

### Documentation

- Update the relevant Markdown in the same change whenever code, behavior, or
  architecture changes — roadmaps, status files, READMEs, and ledgers included.
- When a finding is rejected as a false alarm, record the reason where future
  reviewers will find it.

### Verification

- Run the repository's relevant focused checks after a narrow change; run the
  full gate when the repository requires it for non-trivial work.
- A check you did not run is not evidence. Report which checks ran and which were
  intentionally skipped.

### Git

- Use branches, pull requests, and required checks for non-trivial work when the
  repository defines that workflow; do not bypass hooks, checks, or review gates
  without explicit permission.
- Keep generated artifacts reproducible and fail loudly when they drift.
- Follow the repository's commit attribution and provenance policy; do not invent
  trailers without an explicit project or user requirement.
- Clean up temporary worktrees, branches, caches, and scratch files when done.

### Handoff

- Summarize what changed, why, and what verification proves.
- Call out residual risk plainly.

## Testing

The single source for test rules.

- Test behavior, not implementation details. One behavior per test, arranged as
  arrange / act / assert.
- For bug fixes, reproduce the failure through the highest-fidelity practical
  path first. Prefer the end-user or E2E workflow when available; when a narrower
  reproduction is the right proof, state why.
- Add a focused regression test for every fix, and a legacy-shape test for every
  persisted-data change.
- Mock only at system boundaries (network, filesystem, time, process); never mock
  internal functions to force a desired result.
- Never weaken, skip, comment out, or delete a test to make a suite pass; a red
  test is a finding, not an obstacle. Quarantine a genuinely flaky test only with
  explicit authorization and a tracked follow-up.
- Prefer deterministic, minimal fixtures.
- For numerical behavior, test shape, monotonic relationships, boundary cases,
  and tolerance-appropriate values.
- For persistence, test old shapes and missing new fields.
- For generated artifacts, test both the source metadata and the rendered output.
- If a bug pattern appears in one place, search for other instances before
  closing it.

## Memory

- Write durable memory only when authorized by the user or an active memory
  policy — not by default.
- Store stable decisions, invariants, and repeated failure modes, each with
  enough source and date context to later judge whether it has drifted.
- Do not store private data, secrets, raw transcripts, or local-only paths in a
  reusable rules repository.
- Keep updates append-only unless the user explicitly approves a correction.
- A recalled memory reflects what was true when written; before acting on one
  that names a file, flag, or value, confirm it still holds.
<!-- AGENT-RULES:END -->

## Helix workflow-kernel invariants

- Every named workflow executes only after normalization to WorkflowDefinition
  v4 through `dispatch/kernel/scheduler.mjs`. Legacy stage documents are input
  adapters and historical readers, never a selectable product engine.
- A workflow succeeds only through its unique final deterministic objective
  gate. Its `on_pass` is the successful terminal's only incoming edge, the
  final node cannot redefine the top-level objective, and resume requires its
  recorded pass evidence. Model verdicts may route work but cannot declare
  convergence.
- Every invocation consumes its effect and checkpoints an in-flight intent
  before the provider call. A result is reusable only after its identity and
  journal evidence reconcile; an unknown outcome refuses rather than replaying.
  A mutating effect is incomplete until workspace apply, journal append,
  scheduler checkpoint, and bounded private workspace snapshot are durable.
  Recovery/proposal material remains until idempotent finalization; a failed
  restore preserves it. Resume restores and verifies that exact prefix before
  reusing completed effects, and a missing expected journal refuses. A newer
  journal suffix is preserved and reconciled only against durable scheduler
  state; it is never destructively truncated. A
  workspace/journal/checkpoint failure is advertised as resumable only when a
  durable private checkpoint actually exists.
- Read-only effects may overlap. Shared mutations serialize. Isolated proposals
  promote only from an unchanged canonical fingerprint; conflicts refuse.
- A shared writer computes its effect identity and takes its before-state
  snapshot while holding the writer mutex. A reused private snapshot must
  match that locked fingerprint; stale crash residue is removed and retaken,
  never accepted as the rollback target.
- Every actual model invocation, including panel members and retries, is one
  independently budgeted and journaled effect. Panel reservations are atomic,
  token/cost arithmetic uses checked safe-integer addition, and malformed
  usage fails closed. Usage from a completed failed call is still lifetime
  usage and must be durably accounted. Workflow ceilings are immutable across
  continuation; neither injected budget state nor a checkpoint may raise them.
  A subworkflow retains its own declared effect ceiling while consuming from
  the shared parent lifetime ledger; neither ceiling may raise the other.
  Abort-policy fan-out stops dequeuing after the first decisive failure and
  releases reservations for work that never started.
- Agent, pipeline, parallel, map, and child effect identities include the
  current node visit. A resumed completion is reusable only when its exact
  journal identity exists in the reconciled parent/child journal; visit counts,
  active state, nested child state, and budget totals are recursively validated.
- Agent execution binds the validated `tracked-step-v1` prompt contract,
  output schema, exact tool allowlist, mutation mode, artifact contract, visit,
  attempt, and run namespace through the product and runtime boundaries.
  Runtime status or identity drift cannot be converted into a model success.
  Structured-output repair is a separately budgeted, journaled invocation and
  is capped by the definition's `structured_repair_attempts`.
- Result, output, journal, and checkpoint admission preserve enough headroom
  for a compact durable failure. Aggregate growth may stop a workflow with a
  stable capacity result, but may never create an oversized checkpoint or a
  journal that its own reader rejects.
- Authored allowlists may settle only explicitly typed agent failures. Kernel
  integrity, identity, budget, cancellation, workspace, and gate failures are
  structurally non-maskable.
- Declared typed inputs validate before run creation and are bound to resume.
  Named workflows require the canonical per-run worktree and refuse before
  consent when that feature is disabled.
- `dispatch/runtime/pi-runtime.mjs` is the only Pi SDK import seam and supports
  `>=0.80.7 <0.81.0`. Provider runtimes require structural branding and a
  short-lived exact CapabilityAttestation; requested-only values never count as
  effective identity.
- Provider/model/effort/route/account fallback is forbidden unless modeled as
  an explicit workflow transition. OpenRouter exact mode always disables
  fallback and binds the provider-issued creator account, the unique endpoint
  tag and quantization, the streamed response model and any optional route
  metadata, and the generation
  model/provider observation.
- Exact real Pi sessions are one read-only, tool-free provider turn with Pi
  transport retries disabled. A tool-bearing or mutating real definition is
  exact-disabled before provider preflight until Helix owns and journals every
  internal provider-turn boundary; deterministic mock execution retains the
  complete workflow tool/mutation contract.
- The extracted-package Pi gate must exercise both command discovery and the
  shipped adapter's real default session factory through its localhost audit
  proxy. An injected session factory or raw Pi-only mock is not production-path
  evidence.
- Deterministic mock workflows may mutate only inside their counted candidate
  adapter effect. Host verifiers and gates observe artifacts and objective
  evidence; they never manufacture convergence or unjournaled workspace state.
- Kernel public events contain structural ids, hashes, counts, status, and
  stable codes only. Tasks, prompts, responses, provider bodies, account
  handles, credentials, and workspace content stay out of public projections.
- Role transitions consume one complete closed JSON object. Do not reintroduce
  prose, fenced-JSON, or trailing-object scans.
- Helix adds no threshold-based compaction policy; the selected runtime keeps
  its native default.
