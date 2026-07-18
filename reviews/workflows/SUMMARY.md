# Workflow architecture review ledger

Append-only implementation and verification record.

## 2026-07-16 — HWK v4 consolidated implementation

Status: implementation-complete on `helix-workflow-kernel-v1`; the complete
local all-or-nothing gate passed. Exact remote-head and branch-CI proof are
post-commit delivery gates and must still pass before the branch is called
shipped.

Accepted findings and resolution:

- P0 product resume refusal: replaced with task-aware, effect-aware private
  checkpoint restore and attended resume. Orphan journal/event suffixes are
  reconciled to the durable scheduler/workspace prefix.
- P0 output-only mutation replay: mutating reuse requires exact workspace state;
  shared and isolated writers commit checkpoint-backed transactions before
  journal completion.
- P0 exact provider/account gap: added closed CapabilityAttestation, structural
  runtime branding, policy expiry, exact registry resolution, protocol-specific
  adapters, and zero-egress negative tests. Unobservable paths are
  exact-disabled.
- P1 dual product engines: all named v1/v4 and built-in workflows normalize to
  v4 and run through HWK. Historical runner readers and research remain isolated.
- P1 unstructured verdict parsing: the Pi adapter accepts only one complete
  closed JSON object. Explicit retry attempts are scheduler effects and consume
  the shared budget.
- P1 mutation isolation: isolated proposals now use disposable Git worktrees,
  bounded regular-file copying, unchanged-base promotion, rollback, and cleanup.
- P1 UX/observability: planned and observed graphs share stable ids; v4 import,
  pure programmatic construction, run/watch/checkpoint/resume, and structural
  nested progress are exposed.

Verification evidence is recorded only after commands run; see the final
section appended to this file before push.

### Live adversarial findings closed during implementation

- OpenRouter's provider-issued account label contained repeated dots. The
  account contract had incorrectly applied path-traversal semantics to a
  non-path opaque identifier. Validation now allows the provider shape while
  still rejecting whitespace/control characters; raw labels remain memory-only.
- The first live tool proof showed that provider-specific contracts alone did
  not make the product Pi path exact. Product execution now requires a
  consent-bound exact adapter before run-directory creation.
- Pi's OpenRouter stream omits route identity from AgentSession. A
  session-local `127.0.0.1` audit proxy now rejects outbound routing drift,
  forwards request bytes without prompt transformation, observes every streamed
  model/route, and closes with the session.
- Pi's generic OpenAI defaults used `store:false` and
  `max_completion_tokens`; the sole certified ZDR endpoint requires
  `max_tokens` under strict parameter filtering. The exact OpenRouter model
  boundary now sets the supported compatibility fields without weakening
  `require_parameters`.

### Final local verification evidence

- `npm test`: 638/638 Node tests passed; worktree self-test 12/12; objective
  loop self-test 8/8.
- `npm run check:workflow-conformance`: 32/32 passed.
- `npm run check:provider-contracts`: 27/27 passed.
- Docs truth, resources, static no-live-egress, public-safety diff, and
  `git diff --check`: passed.
- Extracted-package proof: passed; 98 files; required NOTICE/security/kernel/
  runtime/docs resources loaded from the tarball.
- Supported Pi `0.80.7` runtime RPC: package load, all 20 Helix commands, and
  isolated no-live behavior passed.
- Active Docker `--network none`: 5/5 passed, including blocked external DNS,
  offline package startup, and localhost-only mock inference.
- Explicit Node matrix: Node `22.19.0` 638/638; Node `26.5.0` 638/638; resource,
  docs-truth, and no-live checks passed on both.
- Authorized free OpenRouter certification: exact model
  `tencent/hy3:free`, route `Novita`, configured account match, strict ZDR/no
  fallback request, and returned identity passed. No credential/account value
  was printed or persisted.
- Production-path live proof in a disposable Pi `0.80.7` installation: fresh
  Pi AgentSession, exact consent binding, localhost audit proxy, streamed
  model/route verification, and attestation ownership passed. No prompt,
  response, credential, or account value was retained.

### 2026-07-16 — First exact-head branch CI attempt

- Exact remote SHA `d9b57ffe7696c8e6de52509741c941172d74374e`
  ran both Node matrix jobs. All 638 tests and every gate through package,
  dispatch, and revision smoke passed on both Node versions.
- Both jobs then failed before Pi startup with `rpc-spawn-failed:ENOENT` because
  CI supplied `node_modules/.bin/pi` and the helper treated a relative path with
  a slash as a PATH lookup from its isolated temporary working directory.
- Canonical local correction: resolve slash-containing relative `--pi-bin`
  values against the verified package root; bare command names still use PATH
  and absolute paths remain unchanged. A focused regression covers all three
  shapes. The failed remote commit remains unchanged; no force-push or hidden
  rerun was attempted.

## 2026-07-18 — Exact-head adversarial audit remediation

Status: local implementation and all-or-nothing verification complete. The
remediation is shipped only as one normal commit whose exact-head GitHub CI
check passes.

Accepted findings and canonical resolution:

- P0 single-gated success: validation previously required a final gate but did
  not forbid another node from targeting the succeeded terminal. Every
  target-bearing node field is now checked; only the unique final gate's
  `on_pass` may enter success. The scheduler independently refuses terminal
  success unless that exact final node has recorded pass evidence.
- P0 split objective authority: a final node could carry a different `gate`
  from the top-level objective displayed, hashed, and consent-bound. Final nodes
  can no longer contain a local objective and the scheduler always executes the
  top-level `objective_gate`. The pure builder exposes `objectiveGate()` for
  this closed shape; non-final `gate()` remains local evidence routing.
- P2 malformed external input: node traversal, v1 migration, normalization,
  and import are total. Malformed `nodes`, transitions, tools, stop, deployment,
  and stage shapes return stable invalid/migration refusals without writes or
  provider calls.
- P2 false-positive v4 testing: structural edges and ceilings are labeled
  validated, never executed. Optional smoke normalizes every accepted workflow
  to v4, runs one deterministic path through HWK in a detached worktree, and
  reports only observed nodes, effects, transitions, and final-gate routing.
- P3 inert live-certification policy: `require_live_certification: true` now
  requires an adapter that can provide current live-certified evidence and
  refuses before provider preflight otherwise. The shipped Pi adapter
  truthfully advertises no reusable live certification; standalone live proof
  never silently authorizes later product execution.

Regression and adversarial coverage added:

- all target fields across agent, pipeline, parallel, map, reduce, decision,
  gate, checkpoint, and subworkflow nodes, including final-gate fail/loops-off;
- duplicate final gates, node-local final objectives, direct terminal resume
  without pass evidence, and top-level objective execution;
- malformed v1/v4 corpora and no-write import refusal;
- native v4 kernel smoke with an observed decision path and truthful coverage;
- live-certification refusal before adapter preflight; stock templates,
  execution, resume, providers, and historical compatibility remain green.

Local verification:

- First full `npm test`: functional result was correct, but one unchanged
  legacy deadline test exceeded its `<2s` wall-clock assertion under parallel
  load (646/647). The exact test passed alone in 1.23s; no threshold or test was
  changed. A fresh complete rerun passed 647/647, worktree 12/12, and objective
  loop 8/8.
- `check:workflow-conformance`: 40/40 passed.
- `check:provider-contracts`: 27/27 passed.
- `check:docs-truth`, `check:resources`, static `check:no-live-egress`,
  `check:public-safety-diff`, `check:package` (98 files), and
  `git diff --check`: passed.
- Active Docker `--network none` initially passed 4/5 but the synchronized
  checkout bind mount twice returned host `Resource deadlock avoided` before
  the active probe opened. An exact disposable copy under the local cache,
  using the unchanged built image and read-only mount, passed 5/5: both external
  destinations blocked, Pi 0.80.7 loaded Helix offline, and the session reached
  only the localhost mock. No product/harness code was changed.
- The local host has Node 26.5.0 but no Node 22 executable or installed Pi RPC
  binary. The supported Node 22/26, packaged Pi-RPC, and exact-head checks remain
  mandatory remote CI gates. Live OpenRouter variables were absent, so no new
  live-provider call was claimed or attempted.
