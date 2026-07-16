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
