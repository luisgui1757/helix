# Helix workflow parity implementation — 2026-07-19

Append-only implementation ledger for Helix CC `0.4.0`.

## Source identity

- Helix CC starting revision: `e454b9a5be2d812df18ffc28e8675ce27063b99a`
- Implementation branch: `feat/helix-workflow-parity-20260719`
- Base Helix main: `bb1c37f62ee1808a5c24bac06d975023f73dcb3b`
- Base chain catalog: `dispatch/config/chains.json`
- Cross-check: the same catalog is present at Helix workflow-kernel revision
  `77421126a63efa3f97be92bdbd4208ce4919a2da`

## Decision record

The existing `helix-delivery.js` is already the stronger mapping of base
`full-cycle` and guided `plan-implement`; duplicating either name as another
script would create drift without new behavior. The missing behaviors were
implemented as five standalone workflows: implement-review, TDD fix, scout,
research, and ship-pre-PR.

The comparison also exposed one existing full-cycle delta: implementation
remediation could not return to planning. The delivery review schema now has a
distinct `replan` verdict that reruns the independent planners and plan judge,
then rebuilds before the complete post-write gate. The pre-PR mapping also
proves base synchronization, task-only scope, `git diff --check`, and
public-release readiness without automatically rebasing or merging.

Claude Code Workflow scripts cannot use Helix's arbitrary JSON chain compiler
or host-side objective gate. The canonical mapping keeps each loop auditable as
a static script, validates closed structured evidence deterministically, and
records live provider/workflow proof separately. Scout returns its brief rather
than writing `BRIEF.md`; ship-pre-PR stops at one open or reused pull request and
never merges.

## Verification record

The complete `npm run verify` gate passed: plugin validation reported eight
workflows, eleven agents, and seven skills; all 103 tests passed; and Claude Code
2.1.214 strict validation passed. Focused regressions cover stage order, bounds,
model-routing, red-before-fix, exact command identity, read-only scout roles,
measured research iteration, explicit PR confirmation, failed-gate refusal, and
shipping receipt validation.

Two bounded native headless smoke attempts resolved and started the installed
`helix-scout` workflow but did not return a terminal Workflow result. The first
was interrupted after its bounded wait; the narrowed Haiku retry returned only
“Workflow started. Waiting for completion.” No permission denial or checkout
mutation occurred, and no child remained afterward. These attempts are launch
evidence only and are deliberately not recorded as a live workflow pass.

## Independent audit round 1 and canonical remediation

GPT-5.6 Sol at `xhigh` reviewed the complete clean branch revision
`4a6ec01feb5341b5b14c6e0cb36c18f3f1b88acf` in read-only mode and returned
`NOT READY`. Its two blocking findings were accepted:

1. Delivery, implement-review, TDD, research, and ship loops treated a role's
   structured command/file/metric report as objective evidence. That allowed a
   command-start failure to masquerade as TDD red and allowed a measured target
   miss to be paired with a claimed pass.
2. Ship-pre-PR allowed a general Bash-capable shipper to claim a foreign or
   stale pull request as the terminal result.

The remediation replaces those report seams with one bundled, always-loaded
MCP evidence service. It creates an ephemeral RSA session, executes exact argv
without a shell, observes Git state and typed measurement JSON itself, and
signs bounded receipts. `helix-evidence-verify.js` verifies the RSA signature
and exact workflow expectation before approval. TDD binds red to a signed
baseline and service-observed test-only delta; research computes the target
comparison from the signed numeric value; normal write loops require signed
zero-exit non-mutating verification. Ship-pre-PR gives the shipper only one
narrow tool that can stage the verified task paths, create one normal commit,
perform one non-force push, and create or reuse the exact open pull request. It
has no general Bash tool.

The formerly open integration gap is also covered at the effect boundary. The
test suite starts the packaged MCP process, executes real subprocess and Git
operations in disposable repositories, verifies the produced signatures
through the actual child workflow, and asserts exact repository/branch/base/PR
binding and the absence of force/merge operations. All agent-facing output
schemas in the full delivery loop are closed. The complete pre-review local
gate reports nine workflows, thirteen agents, seven skills, and 107 passing
tests. The next exact-head independent audit remains the authority for the
0.4.0 readiness verdict.

## Live composition correction before audit round 2

A disposable clean-clone Workflow smoke then exercised the platform seam the
source harness cannot simulate. The first probe failed closed and exposed two
Claude Code naming contracts:

- plugin subagents receive plugin MCP tools under the installed
  `mcp__plugin_helix-cc_helix-cc-evidence__<tool>` names, not the shorter parent
  prompt alias; and
- a plugin workflow must call another plugin workflow by its scoped
  `helix-cc:helix-evidence-verify` name.

The agent definitions now allowlist only the exact installed MCP operations,
and every writer loop calls the scoped child verifier. The local workflow
harness strips the known plugin prefix only while resolving the same source
file, so the tests and runtime exercise one explicit production contract. A
second disposable headless probe completed through the real Workflow engine:
the evidence agent called the packaged MCP tool, the service executed
`node -e process.exit(0)`, the child workflow verified the RSA signature and
unchanged repository receipt, and the terminal result was
`{completed:true, verified:true, operation:"command", exitCode:0}`. No
permission denial occurred. The earlier non-terminal full implement-review
smoke remains launch/stage evidence only and is not promoted to a completed
loop receipt.

## Independent audit round 2 interruption and retained finding

The second exact-head GPT-5.6 Sol `xhigh` process inspected revision
`a2c0740797e0129a6237814402c43499a2dff633` read-only but terminated before it
could emit a verdict. It is therefore not counted as an independent review
round. One source-backed candidate from that incomplete run was retained and
reproduced locally: `helix-research` signed its metric and test receipts before
the documenter wrote the research ledger, so the workflow could approve even
when that final write invalidated the measured target.

A failure-first regression now runs the real evidence service and receipt
verifier against a disposable Git repository, has the documenter invalidate a
previously met file-size target, and requires terminal refusal. The research
loop now takes a preliminary signed measurement for the ledger, serializes the
documentation writer, and reruns both exact argv gates afterward. Only those
final-checkout receipts reach review and approval. A fresh exact-head audit is
required; the interrupted process did not satisfy the `READY` stop criterion.

## Independent audit round 3 and canonical remediation

GPT-5.6 Sol at `xhigh` reviewed clean branch revision
`3c7c11db56ce631a7edcde4e9f7ec424da4ede7a` and returned `NOT READY`. The
reviewer confirmed the signed-receipt substitution matrix and final-checkout
research order, then identified six remaining composition gaps. All were
accepted:

1. Snapshot fingerprints did not include the executable bit of every tracked
   path. The service now binds bounded tracked content, type, and mode and
   refuses over-limit files instead of substituting size-only evidence.
2. TDD treated test-like directory or filename patterns as scope. The user now
   confirms exact `testPaths`; the baseline signs that set, the service refuses
   any path outside it before issuing red evidence, and the child verifier
   checks the same set.
3. GitHub CLI PR lookup used an unsupported owner-qualified head filter. The
   service uses the supported branch-only filter and independently matches head
   owner, repository, branch, full SHA, and base.
4. Rename source/destination representations diverged after staging and a
   refusal could retain index mutations. Staged name-status parsing now expands
   both paths consistently, and any pre-commit refusal restores the prior index
   tree.
5. The main loop skill omitted the selected provider set from its proof command.
   It now gives separate exact single-route and mixed-route forms.
6. The base pre-PR chain's separate release-boundary check was prose-only.
   `releaseCheckArgv` is now a required signed command distinct from the general
   verification argv.

Failure-first coverage includes the reviewer's already-dirty mode mutation,
a production export at `src/test/runtime.mjs`, wrong-owner/base/SHA PR
candidates, pure rename, rename plus edit, and exact index restoration after a
forced refusal. GitHub CLI `2.96.0` help and a live read-only list call confirmed
the chosen fields and branch filter. The local gate reports nine workflows,
thirteen agents, seven skills, 113 passing tests, and strict plugin validation.

The installed-plugin acceptance campaign also moved forward: a current
headless Claude Code `2.1.214` session loaded this plugin with `--plugin-dir`,
resolved `helix-scout`, completed both installed read-only agents, and wrote an
actual terminal Workflow object with `completed: true`. No checkout mutation
occurred. The other five public loops still require equivalent current terminal
records before dispatching the next readiness audit.

## Installed full-cycle acceptance finding

The first current installed `helix-delivery` acceptance reached every writer,
documentation, signed-command, and review stage in a disposable repository but
correctly returned no approval after one pass. Its adversarial reviewer and
verifier misinterpreted the signed command receipt: identical snapshots around
the final silent verification command were treated as proof that the earlier
builder made no working-tree changes, and they demanded a commit even though
commit ownership belongs only to `ship-pre-pr`. The actual checkout contained
the exact three requested modifications and the signed argv exited zero.

This was accepted as a workflow-composition defect rather than dismissed as a
model fluctuation. Every review and verifier prompt in the five evidence-backed
public loops now states that command snapshots bracket only that exact argv,
that `changedPaths: []` proves command non-mutation rather than absence of prior
writer changes, that an empty-output digest is valid for a silent success, and
that non-shipping loops do not require a commit. A source contract test requires
the semantics in every such workflow. Installed acceptance must be rerun on the
corrected exact head before it is counted.

The corrected receipt-semantics rerun then exposed a second authority leak:
both candidate plans asked for a commit and the full-cycle builder created one,
even though the delivery loop is supposed to return verified working-checkout
changes and leave shipping to the separately confirmed `ship-pre-pr` loop.
This too was accepted as a product defect. Planner prompts now exclude Git and
GitHub handoff steps; builder, tester, and documenter definitions and every
non-shipping writer prompt explicitly prohibit staging, committing, pushing,
opening a pull request, tagging, releasing, or rewriting history. Source
contract coverage pins the distinction. The rerun is retained as reproduction
evidence, not counted as canonical acceptance.

The next installed rerun preserved the initial commit and left the requested
three-file delta unstaged, but both review roles still interpreted the final
verification command's empty top-level `changedPaths` as proof that no writer
changes existed. The actual checkout directly contradicted that conclusion.
Prompt wording alone was therefore rejected as insufficient. Evidence receipt
version 2 now signs two distinct facts: top-level `changedPaths` is the exact
command's mutation set, while `checkout.changedPaths` is the final working-tree
delta relative to HEAD. The child verifier rejects command receipts that omit
this final-checkout evidence. The interrupted run remains reproduction evidence
and cannot count as canonical acceptance.

The first v2 installed run proved the final checkout delta and preserved HEAD,
but its evidence courier returned only 276 of the RSA signature's required 342
base64url characters. The child verifier rejected the receipt before review,
which is the correct fail-closed outcome, but the courier transport was not
reliable enough for the product path. V2 receipts now carry the same RSA
signature as six fixed bounded chunks. Every evidence-agent result schema
requires all six, and the child verifier checks their exact lengths before
rejoining and verifying the signature. This run is transport-failure evidence,
not canonical acceptance.

Installed acceptance then passed across the complete public-loop catalog at
production revision `9279094d793746becb6d27d5b93cd49b924b2813`:

- `helix-delivery` completed in one pass with `approved: true`, both reviews
  passing, v2 evidence verified, the initial fixture HEAD `a7a584e` unchanged,
  and exactly three requested unstaged files.
- `helix-implement-review` completed in one pass with `approved: true`, its
  existing behavioral test updated and passing, v2 evidence verified, initial
  HEAD `0189325` unchanged, and four requested unstaged files.
- `helix-tdd-fix` completed one reproduction and one fix pass. The signed
  baseline and exit-1 receipt bound the red change exclusively to
  `tests/sum.test.mjs`; the production edit occurred afterward, the signed
  green passed, and initial HEAD `c30fe13` remained unchanged.
- `helix-research` completed one experiment with signed preliminary and final
  `payload_bytes` measurements equal to the typed `4 bytes` target, a signed
  exact-content test, `approved: true`, and unchanged initial HEAD `77a047f`.
- `helix-scout` completed both installed read-only roles and returned structured
  reconnaissance and a brief while HEAD `ced1eb9` and the working tree remained
  unchanged.
- `helix-ship-pre-pr` was exercised only through the no-confirmation terminal
  path because this delivery explicitly forbids opening a PR. With a complete
  evidence-session object and `confirmOpenPullRequest: false`, it refused on the
  exact confirmation gate before starting an agent or changing the clean
  `ced1eb9` fixture.

An earlier implement-review attempt exceeded Claude Code's 600-second headless
background ceiling after entering remediation and was not counted. The accepted
rerun used an existing behavioral test and an unambiguous production-plus-test
task. All accepted runs loaded the plugin through `--plugin-dir`; independent
post-run Git and command checks confirmed their reported terminal states.

## Fourth exact-head audit and remediation

The fourth GPT-5.6 Sol xhigh whole-repository review targeted clean pushed HEAD
`93617c3c54520aceb168ce435aaaa497ff3350cf` and returned `NOT READY` with two
accepted findings:

1. TDD scope checking detected an out-of-scope reproduction mutation only
   after the checkout had changed, then refused the receipt without restoring
   the pre-red state.
2. The five evidence-backed workflows accepted argv/path spellings that the
   trusted service later rejected or normalized, so model stages could begin
   for an operation that could never produce a matching receipt.

The TDD boundary is now preventive. The reproducer lost direct `Write`, `Edit`,
and shell capabilities. It supplies complete UTF-8 contents for signed test
paths to the new capability-limited `reproduce_red` tool; that service applies
only those paths and retains them only for a normal exit `1..125` with no
out-of-scope delta. Green, command-start, and out-of-scope attempts restore the
captured content, type, mode, untracked state, and exact index tree. Real Git
regressions cover a tracked edit, new file, deletion, rename, and mode-plus-index
mutation, plus green-then-revised-red behavior.

All five public evidence-backed workflows now apply the service's argv grammar
before their first agent: the executable is PATH-resolved, contains no slash or
leading dash, and repository scripts are interpreter arguments. TDD and ship
normalize one leading `./`, reject reserved `.git` paths, and use the canonical
path through the workflow, trusted service, receipt, and child verifier.
Zero-agent regressions cover every workflow family and the packaged MCP process
exercises the new operation.

An installed headless acceptance loaded the plugin from production revision
`d52d276` and invoked both affected workflows through Claude Code's real
`Workflow` tool. TDD rejected `./unreachable-reproducer.sh` on the PATH-resolved
executable grammar; ship rejected `.git/config` on the reserved-path grammar.
Both installed Workflow results reported zero nested agents and zero nested tool
uses. No fixture or Helix CC checkout file changed.

## Fifth exact-head audit and remediation

The fifth GPT-5.6 Sol xhigh whole-repository review targeted clean pushed HEAD
`5a11db566d02b0224b26f24a704a9fed2dcf8ff5` and returned `NOT READY`. It
accepted two functional blockers and three supporting gaps:

1. research exposed only target success and pass exhaustion rather than base
   Helix's target, valuable dead-end, diminishing-return, and max-iteration
   terminal reasons;
2. the red subprocess still ran in the user checkout, so ignored,
   Git-internal, HOME, and sibling effects were outside its Git-derived rollback;
3. `.//` paths, normalized duplicates, and multiline shipment metadata could
   reach agents before the trusted service rejected them;
4. the positive installed TDD receipt predated the new `reproduce_red`
   composition; and
5. two architecture summaries still said five evidence tools after the sixth
   was added.

Research now implements the complete four-stop state machine. Signed final
measurements drive comparator-aware progress; equality improves only by moving
closer to the target. A reviewed refutation without a successor is the valuable
`dead-end` success, a successor continues the loop, the optional
`plateauAfter` rail produces `diminishing-returns`, and ordinary rail exhaustion
produces `max-iterations`. Target and dead-end return `approved: true`; plateau
and max return structured `approved: false` results. Component regressions cover
all terminal reasons, successor continuation, and equality distance.

TDD red execution no longer occurs in the user checkout. The service copies the
checkout without its Git metadata into a disposable repository, creates
isolated Git metadata, redirects project, Git, HOME, and temporary process
state, writes the proposed signed test contents there, and runs the exact
reproduction argv there. Command-time repository mutations invalidate the
attempt; ignored, Git-internal, HOME, and sibling effects are discarded with
the copy. Ignored test paths and empty proposed test deltas are refused. Only
exact signed test contents from a normal scoped exit `1..125` are atomically
applied back after rechecking the original baseline and index. Red and green
real-process regressions prove that every formerly invisible effect class and
inherited process redirect leaves the user workspace unchanged.

The workflow and service path grammars now accept at most one leading `./` and
then reject absolute, empty-segment, dot-segment, backslash, `.git`, and
post-normalization duplicate forms. Shipment commit messages and titles reject
both LF and CR before any agent. Zero-agent regressions cover every reported
counterexample. A single exported catalog defines all six evidence operations;
the MCP entrypoint refuses catalog drift and both architecture references name
all six under a documentation contract test.

Final-revision installed acceptance still must compose one successful TDD run
through `reproduce_red` and research terminal runs for dead-end and plateau.
Those receipts are recorded below only after they execute; component evidence
is not substituted for installed proof.

Installed acceptance at production revision `24d403d` then produced two valid
terminal receipts. TDD completed one red/fix pass with `approved: true`: the
signed exit-1 red changed only `tests/sum.test.mjs`, the signed final `npm test`
exited zero without mutation, fixture HEAD `8af16b9` remained unchanged, and
independent verification passed all three confirmed arithmetic cases. Research
completed one pass with `approved: true` and `stopReason: dead-end`: the signed
metric remained 5 against target `<5`, signed tests passed, fixture HEAD
`d70d7ad` remained unchanged, and the exact planned three-file delta documented
the refutation and its 5-byte floor.

The installed plateau campaign first hit Claude Code's 600-second print-mode
background ceiling; that wrapper acknowledgment was not counted. A fresh run
with the documented wait ceiling disabled exposed a workflow-composition gap
before measurement: the experiment agent put an expected metric miss into
`openBlockers`, and the deterministic workflow correctly refused the non-empty
array. The production experiment prompt now defines an expected miss,
refutation, or remaining successor as research evidence rather than an
execution blocker, requires `openBlockers: []` after a completed experiment,
and is pinned by a focused contract regression. Plateau installed acceptance
must be rerun on this corrected revision before the sixth audit.

That rerun reached two signed passes and the intended structured
`diminishing-returns` result, but exposed a second composition mismatch before
the receipt could be counted cleanly. The terminal reviewer truthfully returned
`refuted: false` with a non-empty future successor; the workflow treated any
successor on a non-refuted miss as inconsistent even though base Helix consults
the successor only to distinguish a refuted dead-end from a refuted continuation.
The over-strict condition is removed. A non-refuted miss may carry a concrete
successor, while only `refuted: true` plus an empty successor produces
`dead-end`; the expected-miss regression now also requires an empty deterministic
problem set for that state.

Exact-head installed acceptance at production revision `9ac08b9` closed both
research terminal branches before the sixth audit. The dead-end fixture returned
`approved: true`, `stopReason: dead-end`, and one pass. Its signed metric remained
5 bytes against target `<5`, its signed and independent suites passed 3/3, the
fixed payload hash matched HEAD exactly, fixture HEAD `d70d7ad` did not move, and
the only changes were RESEARCH.md, STATUS.md, and the new payload-floor test.

The plateau fixture returned `approved: false`,
`stopReason: diminishing-returns`, two passes, and `problems: []`. Both signed
measurements remained 10 against target `>100`; the signed final suite and the
independent suite passed 6/6. Fixture HEAD `bbab6bf` did not move, nothing was
staged, all five fixed inputs had no diff, and the only changes were RESEARCH.md,
STATUS.md, and the new ledger test. These are intentionally distinct terminal
outcomes: an evidenced refutation without a successor is valuable approval,
whereas a plateau with a concrete future successor is a truthful structured
non-approval rather than a fabricated success.

## Sixth exact-head audit and remediation

The sixth GPT-5.6 Sol xhigh whole-repository review targeted clean pushed HEAD
`8b5b4606a6ff3eb317a44e36e55d702f117225b0`. It accepted semantic parity for
all five base chains and all three guided templates, accepted the workflow and
evidence fixes from rounds one through five, and returned `NOT READY` for one
remaining important lifecycle defect. Provider children could start while the
launcher still used the platform's default SIGINT/SIGTERM behavior; the
foreground-only lifecycle handler was attached only after readiness. A
provider-free reproduction confirmed that a child survived an owner SIGTERM.

Lifecycle ownership now begins before the first asynchronous child spawn. One
owner registers every backend, attestation proxy, gateway, login, foreground
Claude, and proof child immediately through the same `spawnOwned` primitive.
Readiness loops observe interruption and refuse later spawns. SIGINT/SIGTERM
preserve the foreground signal, stop provider children with SIGTERM, escalate
unresponsive processes to SIGKILL after the common bound, await cleanup, and
produce exit 130/143.

Six provider-free subprocess cases exercise Copilot-backend readiness,
Copilot-attestation readiness with both children active, Azure-attestation
readiness, four-child gateway catalog convergence, four-child active Claude,
and four-child active proof. Both SIGINT and SIGTERM are covered. Every case
asserts the launcher exit status, every child PID's death, and every real
loopback port's release. The post-change deterministic gate passes 132/132;
strict plugin validation, structure validation, and diff checks also pass.
Exact route and mixed-route startup/shutdown receipts remain required after
the lifecycle code change before the seventh audit.

The first exact Codex proof attempt after that lifecycle checkpoint exposed a
second composition seam while gathering those receipts. Claude completed the
Workflow, and the marker-bearing subagent transcript with the exact resolved
model was present shortly afterward, but the proof command's immediate scan
observed zero transcripts and correctly refused the receipt. Transcript
persistence is not synchronous with the controller result envelope in Claude
Code 2.1.214.

Proof attestation now polls the isolated transcript tree for at most five
seconds, remains interruption-aware, and returns early only when at least the
expected transcript count is present. The existing exact-count and resolved-
model checks remain unchanged, so convergence does not weaken the evidence
contract. A delayed-write regression test reproduces the observed ordering and
brings the deterministic suite to 133 tests.

Exact production-revision acceptance then completed on pushed SHA
`c5016f62da26aeca8459aa5cbc2b1dd5103b7a24`. A real Copilot `serve` process
received SIGTERM after its first provider child spawned and before gateway
readiness. It exited 143; the observed child was dead; all three allocated
loopback ports were released; and the subsequent status was `unreachable`.

The same revision passed all promoted proof commands without reusing an
existing sidecar. The Codex proof matched its marker in exactly one
`gpt-5.6-luna` Workflow transcript. The freshly pinned Copilot proof mapped
`copilot/gpt-5.4` to served identity `gpt-5.4-2026-03-05` and matched exactly
one `gpt-5.4` transcript. The OpenAI-plus-Copilot matrix matched both markers
and resolved models across exactly two transcripts. After every command, idle
status returned `unreachable`, no matching provider process remained, and the
default provider ports had no listener.

## Seventh exact-head audit and remediation

The seventh GPT-5.6 Sol xhigh whole-repository review targeted clean pushed
HEAD `34cd816fc4099094a60137334b5958bdd021008b`. It accepted semantic parity
for all five base chains and all three guided templates and reported no
Blocking finding. It returned `NOT READY` for two Important proof-fidelity
defects:

1. transcript polling returned as soon as the expected number of marker-bearing
   files existed, before every incrementally written file necessarily exposed
   its model record, and the caller checked inclusion rather than exact set
   equality; and
2. the six named lifecycle tests used stage labels to select counts of generic
   loopback children instead of entering the production provider controller.

Transcript attestation now receives the expected sorted model set. It continues
polling when marker-bearing files exist but their model records are incomplete,
returns early on excessive transcript count, and can pass only when both the
transcript count and unique resolved-model set are exact. Regressions cover a
marker-first append, a partially written assistant JSONL record, staggered
two-model persistence, unexpected and duplicate models, timeout, and
interruption.

The provider command handler is now safely importable while the executable
retains the same direct-entry behavior. Its production readiness and foreground
composition accepts narrow external-boundary dependencies. The six lifecycle
subprocess cases import that real command handler and replace only provider
state plus external executables with generated authenticated loopback servers.
They enter Copilot backend readiness, Copilot attestation readiness, Azure
attestation readiness, gateway catalog convergence, active Claude, and active
proof through the production sequence. Each case interrupts at the named
milestone and asserts exit 130/143, no subsequent spawn, every observed PID
dead, and every allocated port released.

The unrestricted local gate passes 137/137 with no failure, skip, or TODO;
structure validation, strict Claude plugin validation, and `git diff --check`
also pass. Exact promoted receipts were then refreshed on pushed production
revision `9b6b35f7d35d2161bb1f516d5a5210ce982603e1`. Codex returned one
marker-bearing `gpt-5.6-luna` transcript and the exact one-model set. Copilot
repinned `gpt-5.4` to `gpt-5.4-2026-03-05`, then returned one marker-bearing
`gpt-5.4` transcript and the exact one-model set. The OpenAI-plus-Copilot
matrix returned exactly two marker-bearing transcripts and the exact sorted
set `gpt-5.4`, `gpt-5.6-luna`. All three receipts reported
`sidecarReused: false`.
