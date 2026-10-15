# T3 Orchestrator V2 adaptation — 2026-10-15

Scope: ship the [October 13 T3 orchestration work](2026-10-13-t3-orchestration.md),
adapted to T3's Orchestrator V2 contract in the 0.0.46 line. The original commits
`2dcd8ac`, `88181bd` and `5a6dd8d` stay unchanged in the pull request history, so
the evidence that cites them resolves. Their record is unchanged; this file
appends the adaptation. No runtime, adapter, service or shared configuration
format was added.

Source of truth: the owner's request to assume convergence on T3 0.0.46 with
Orchestrator V2, judge what to adapt, keep or drop, and ship canonically.
Upstream source is `pingdotgg/t3code` `5a4e9980533705774dc3f45b35cacf76c3d78dbc`
(nightly `v0.0.46-nightly.20261014.3132`), 131 commits after the October 13
check at `6524a8d`. Stable v0.0.45 has no orchestrator toolkit. No stable 0.0.46
existed when checked, so the release's final contents are unverified.

## Judgement

Kept: the optional T3 path in Helix, setup-helix and second-opinion, used only
when T3's orchestration tools are present. It covers the live catalog with
model-specific options; a fresh `delegate_task` and request ID per review round;
`role: review` as a label, not enforcement; completed tasks as no proof of checks
or approval; and reporting the model T3 returns. Also kept: the two
host-independent October 13 fixes, evidence within the task's write scope and
reporting only observed enforcement. Both came from failed trials and were
rerun then.

Adapted to the 0.0.46 contract:
- Tools can be deferred, attached lazily or prefixed. The skills search for
  `orchestrator_capabilities`, or make one bounded call, before falling back to
  the direct-host workflow. A null `parentThreadId` means the session is not
  inside a T3 thread.
- `delegate_task` gained `isolation`. Reviewers keep the default `shared`,
  because a `worktree` child starts from the parent's commit without
  uncommitted edits.
- An inherited runtime mode is the parent's mode, stepped down to what the
  target provider offers, and can fall back to `approval-required`. Supervised
  children usually pause for approvals the parent cannot give. The skills
  compare the parent and target modes and disclose that case.
- Reading a terminal result consumes its notification. Options inherit only from
  the same provider instance and model when none are passed. T3 skips option
  validation for models without descriptors, so an accepted option is not proof
  it applied. Catalog filters such as favorites (open upstream #19756) are
  requested broadly and disclosed when the live schema reports them.
- Second-opinion's inline T3 paragraph moves into `references/t3.md`, matching
  the other two skills, so it loads only inside T3. Sources are repinned.

Dropped: wording pinned to the October 13 nightly. The adaptation commit first
dropped the note about T3's design document; review showed the document is
unchanged and still omits thread-send follow-ups, so an accurate version was
restored.

## Upstream check

A read-only research pass fetched the orchestrator contract, tool descriptions,
service implementation, design document and injected instructions at both
revisions. It gave each Helix claim a verdict with upstream line references.
All but one were still accurate; the exception was the design-document remark
above. `delegate_task` gained `isolation`, and the `runtimeMode` description now
warns that a narrower mode is not a read-only switch and that supervised modes
pause children. The writer independently confirmed the isolation and
runtime-mode descriptions in the contract, the lazy and prefixed tool guidance
in T3's injected instructions, and the `t3_thread_configuration` result shape.

Unmerged upstream changes that could land in 0.0.46: #19756 (capabilities
default to favorites, `models: "all"`, `omittedModels`), handled conditionally;
#19758 (smaller thread-read pages and previews), covered by the existing
truncation rule; #19019, #19665, #15201 and #17338 change no Helix claim.

## Independent source review

A fresh read-only reviewer (a subagent of the writing Claude Code session on
Opus 5.5; effort not observed) reviewed the complete candidate against
`feat/frontend-design`, with upstream source at `5a4e998`.

Material findings, both accepted:
1. High: STATUS had lost the T3 entry in the first merge and still said the
   other skills were unchanged, and no dated record existed yet. Fixed by the
   STATUS rows and this record.
2. Medium: "inherited runtime mode, so no stall" was overstated; inheritance can
   resolve to a supervised mode (`OrchestratorMcpService.ts:554-581`). Fixed in
   `512c6d1`, which also updated the how-to and the review-enforcement scenario.

Low findings: three accepted, one partly accepted.
- Accepted: the detection wording now allows one bounded call for lazily
  attached tools.
- Accepted: a null `parentThreadId` signals a session outside T3.
- Accepted: the design-document note was restored accurately.
- Partly accepted: the reviewer said thread configuration does not expose
  options. `t3_thread_configuration` returns `modelSelection`
  (`apps/server/src/mcp/toolkits/thread/tools.ts:178-189`), so the claim stands.
  It is hedged to "where exposed" for hosts that do not offer that tool.

Native same-provider routing was not reopened; the owner rejected it on
October 13.

## Verification

- PASS: 47 maintenance tests and `git diff --check`. The tests cover the new
  reference in both installation paths and the portability checks.
- PASS: the October 13 record is byte-identical to its commit.
- BLOCKED: live T3 V2 execution. The installed host runs stable 0.0.45, which
  exposes no orchestrator tools, and replacing it would replace the T3 instance
  running this work. The October 13 live Codex writer to Claude reviewer smoke
  on nightly `6524a8d` remains the only live T3 evidence, and it predates these
  adaptations.
- PASS: direct-host regression on both hosts with the final skill bytes below,
  described in the next section.

## Direct-host regression

All three changed skills ran outside T3 on Claude Code 2.1.287 and Codex
0.162.1. Each run used a fresh disposable Git fixture with the candidate skills
installed project-locally, so the operator's user-level skills were untouched.
The operator's global instructions and the host defaults applied: the Claude
results identify `claude-opus-5-5`, and Codex's configured default is
`gpt-6-astra` / `xhigh`. Claude delivery ran with `acceptEdits` and Bash.
Claude's second opinion and setup ran with read tools only, plus `node` for
setup's discovery helper. Codex delivery used `workspace-write`; the other Codex
runs used `read-only`. No run made a T3 or other MCP call.

- Delivery (labels normalization, held-out acceptance outside the fixture):
  both hosts changed only `labels.mjs`, its tests and the README, made no
  commit, passed 5/5 held-out assertions and their own suites (9/9), and
  reported COMPLETE after independent review.
  - Claude (887 s) wrote failing tests first and ran three review rounds with
    fresh `Plan` subagents, which still had Bash. It fixed each round's
    findings, re-reviewed them, and reported one optional suggestion it
    declined, with a reason.
    Pre-fix and mutation checks ran in memory; no agent command wrote outside
    the fixture.
  - Codex (148 s) recorded six failing regressions before the fix. Its session
    store shows a depth-1 reviewer (`gpt-6-astra` / `xhigh`) that read
    `git diff HEAD` itself and received the captured test output. The reviewer
    inherited `workspace-write`, not a read-only sandbox, and the final report
    did not mention that enforcement gap. No reviewer write was observed.
- Second opinion (a plan that drops v1 records despite a requirement to keep
  them readable): both hosts started a fresh consultant, found the
  contradiction with file and line citations, recommended revising the plan
  and left the fixture unchanged. Claude (121 s) used a `Plan` subagent. Its two
  Bash attempts were denied by the run's permissions. Codex (81 s) used a
  depth-1 consultant under a read-only sandbox and marked the consultant's
  model, effort and enforcement unverified.
- Setup (bare invocation without a response channel): neither host edited
  anything. Each reported current settings, then asked for every missing
  choice. Claude (70 s) listed the full catalog from the discovery helper.
  Codex (97 s) reported that discovery failed under its read-only sandbox,
  offered manual choices and invented no list.

Tool detection worked as written. In all three runs, Claude searched its
deferred tools for `orchestrator_capabilities`, found nothing and continued with
native delegation; setup said so explicitly. Codex read each skill's
`references/t3.md` alongside `SKILL.md` even outside T3. These were reads only,
with no T3 calls, but they cost context.

Host side effect: each Codex `workspace-write` run added a trusted-project entry
for its fixture to the operator's Codex configuration. The writer removed the
entries from this run and the earlier frontend-design trial after the trials;
read-only Codex runs added none. Raw transcripts, session records, fixtures and
the held-out checks stay outside Git in the operator's evidence.

## Source digests

- `skills/helix/SKILL.md`: `6df27c53bdbc3fcd94343702db71f0194508977d2c701f6facadd266f80ec7c3`
- `skills/helix/references/t3.md`: `7c334e123568097ebc433bf946eeab3cf630ccc81ee42da0fb8c2ad500248ba2`
- `skills/second-opinion/SKILL.md`: `6152304043d61121c74de7088c334b3228d544c510a32e8525e0c2fba9cd4f4d`
- `skills/second-opinion/references/t3.md`: `75e78bc77766d8f5bd59d4b9827a08e15f7cb66aec32d1d86f0030c0860950ec`
- `skills/setup-helix/SKILL.md`: `c857cd0a2a5849d092471e72b2f370e49e4dce067f72a8c5eee1c95cde12c60e`
- `skills/setup-helix/references/t3.md`: `5385667dc2138ecc373914095e81936c3be84c02042e335cd021ae3631885cc5`

## Re-review and corrections

The same reviewer re-reviewed `512c6d1` and `af5006e`, read-only, and
fact-checked the regression section against the raw evidence. It confirmed the
runtime-mode, detection and design-document corrections against upstream source.
It withdrew its thread-configuration finding: the tool is registered and returns
`modelSelection` with optional options. It reran the held-out checks (5/5 on
both delivery fixtures) and confirmed durations, fixture states, the single
`orchestrator_capabilities` search per Claude run, the absence of MCP calls, and
that all installed skill bytes matched the source digests.

Material finding, accepted: the Codex delivery result above omitted a
write-scope failure. Codex's own session record shows the writer created
`/tmp/helix-labels-review-XXXXXX.md` with `mktemp`, wrote a review brief there,
had the reviewer read it and later deleted it. Helix's write-scope rule
forbids temporary files outside the task's write scope, even when they are
later deleted. The task did not restate a scope, and the host sandbox
permitted `/tmp`; neither excuses the write. Codex delivery is therefore a
**FAIL on scope**, despite correct code, review and status. This repeats the
October 13 Claude failure pattern on the other host, with the corrective
instruction already present. Scope adherence stays OPEN; this change makes no
further instruction change and claims no fix.

Corrections to the regression section:
- Claude's second-opinion and setup runs had no edit permission, but Claude
  Code auto-approved read-only Bash commands. The two denied Bash calls in the
  second-opinion run were the parent's; its `Plan` consultant ran two read
  commands successfully. Setup also listed files through Bash.
- Codex's discovery helper printed "Host exited before discovery completed."
  The sandbox as the cause is an inference, not an established fact.
- Codex setup made two web searches, which are network calls but not MCP or T3
  calls.

Accepted nit: only the Helix reference treated a null `parentThreadId` as a
session outside T3. The second-opinion and setup references now say the same.
That one sentence in each file changed after the direct-host runs. Codex read
both files during those runs, but the sentence only applies after a
capabilities call, which no direct-host run made, so the runs were not
repeated. Updated digests:

- `skills/second-opinion/references/t3.md`: `0f38b94bd278f8514416f4c67879292ad774b71a2c0fdc136354635b81cd9edf`
- `skills/setup-helix/references/t3.md`: `188c6657162545e5c85d6577282e99b3b4f2973e4f8cea4ce9a978fe6a4be113`

Final review receipt: a narrow closure check of `99f5424` found no unresolved
material findings. It confirmed the two updated digests, the honest rerun
disclosure, 47 passing tests and the unchanged October 13 record. Its one
remaining nit, which grounds the scope verdict in the skill rule rather than
the scenarios, is applied above. This receipt covers source and record
accuracy. It does not approve a merge or establish live T3 behavior, effective
effort, enforced isolation or general adherence.

## Squash — 2026-10-15

At the owner's request, this pull request was squashed to one commit. The
original commits `2dcd8ac`, `88181bd` and `5a6dd8d`, and the intermediate
commits `512c6d1`, `af5006e` and `99f5424` cited above, are no longer in the
branch history. GitHub may keep them reachable by SHA, but that is not
guaranteed. The SHA-256 source digests in this record and the October 13 record
remain the durable provenance.
