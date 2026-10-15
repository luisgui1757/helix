# T3 orchestration adaptation — 2026-10-13

Scope: add a thin T3 path to Helix, setup-helix and second-opinion. Keep the
four independently installable skills and direct Codex/Claude usage. No runtime,
provider adapter, service or shared role-configuration format was added.

Source of truth: owner request and T3 source at
`6524a8d43795dc543f7cfb572388cdea3662ad48`, released as
`v0.0.46-nightly.20261013.3053`. Stable v0.0.45 predates Orchestrator V2.
The packaged [reference](../../skills/helix/references/t3.md) links the immutable
schema, dispatcher and task-semantics documentation. Current source confirms
live model-specific target options, active-parent/session requirements, prompt-only
review roles, and fresh delegated tasks for subsequent review rounds. Historical
issue reports were not used as current failure evidence.

## Verification and boundaries

- PASS: 46 Node maintenance tests, including installation of each new reference
  through the existing Codex and Claude paths, documentation links and governance.
- PASS: `git diff --check`, Gitleaks 8.30.1 directory scan and the skill-creator
  validator for all three changed skills. Host validator first failed because
  PyYAML was absent; the same validator passed in the disposable Ubuntu guest
  with its existing PyYAML. No host dependency was installed.
- PASS: source-contract inspection against the exact upstream revision above.
  This verifies the documented API, not an agent's adherence to the skill.
- BLOCKED: live T3 different-provider writer/reviewer, effective model/effort,
  correction rounds and guided-role execution. The disposable desktop guest has
  no authenticated providers. Host credentials were not copied or configured.
  No T3 orchestration tools are exposed to the current editing session.
- NOT RUN: new direct Codex/Claude inference evaluations. Direct-host paths remain
  in place; historical samples retain their original limitations in STATUS.md.
  Packaging tests do not establish behavioral compatibility or workflow success.

The companion dotfiles smoke exercises real T3 startup and its installer lifecycle
in the existing Ubuntu 26.04.1 amd64 desktop guest. It is separate from Helix's
credential-dependent behavioral scenarios, which are documented in
[the evaluation suite](../../evals/scenarios.md#t3-orchestration).

## Source digests

- `skills/helix/SKILL.md`: `ce090903980e3651a7e236cece73cfa25e6a423742b3fe62d347b7037aaa9479`
- `skills/helix/references/t3.md`: `027938ca469da69c5e9a07c88fb9d80ee88a52641607890e6ab41aa1cdadfff5`
- `skills/setup-helix/SKILL.md`: `04c9c4f5dbc86f91d9fbbe979c0038b30437ee3ad978b833cadc4343472eedba`
- `skills/setup-helix/references/t3.md`: `3d79551bd5fe24efdeef3724b8557a24684cfc457fc1d51dd6c09e6391882578`
- `skills/second-opinion/SKILL.md`: `50ee4d49cf81498dda25b07c4fd1a070d0dde6241adb59bf2b30f922f4e4a2a3`

## Findings and review receipt

No product defect has been established by the checks above. Live execution and
host enforcement remain unverified as specified above. Independent source review
is pending; this entry does not claim workflow completion or merge approval.


## Independent review and corrections

A fresh Claude Code 2.1.287 read-only source review used only Read/Glob/Grep,
requested `claude-opus-5-5` / `xhigh`, and returned model metadata identifying
`claude-opus-5-5`. Effective effort was not independently exposed. The reviewer
received both complete repository deltas, captured checks, exact upstream source
and the full Helix review brief; no writer conversation was inherited. Its role
body requested correctness/regression/scope/tests/docs findings with evidence,
source of truth, an alternative explanation and concrete fixes, and explicitly
separated unavailable checks from defects. This was a direct CLI evaluation role,
not a shipped T3 role or a cross-provider task.

Accepted corrections H1–H7: distinguish native saved reviewer roles/tool limits
from T3 task targets; keep no-substitution/defaults/NOT RUN rules on every host;
restore direct-host provider preservation; lint the new Helix reference; clarify
setup's task-scoped choices and the tested release. T3's current code contradicts
part of its task-semantics prose: thread-send can create a follow-up task in the
old child conversation. It does not reopen the previous task and cannot substitute
for a fresh independent review. Capability catalogs also filter hidden models,
while dispatch validates against the broader internal list. The skills now retain
explicit literal models for T3 validation, never invent effort descriptors, and
report returned defaults rather than predicting them from the visible catalog.
The alternative of native same-provider routing inside T3 was not adopted: the
owner explicitly assigned orchestration to T3. Saved preferences and enforcement
limits must instead be honored or disclosed as unavailable.

## Direct-host trials after correction

Preliminary source-invocation Claude trials delivered a nullish greeting fix with
captured failing-before/passing-after evidence and independent review, and rejected
a deliberately incompatible CSV proposal without edits. These read the packaged
skills by path under safe mode; they do not prove installed skill discovery.

Installed Claude trials then used fresh disposable repositories with complete
skill folders and their references under `.claude/skills`. Delivery changed only
the greeting module, its tests and README; an independent native reviewer received
the complete delta and captured outputs. External `node --test` passed (four
tests). A second-opinion trial rejected the CSV proposal without changing any
fixture file, but incorrectly implied the configured sandbox was active. The CLI
had reported sandbox disabled because host `socat` was absent. This was an
observed enforcement-reporting defect, not proof of an active sandbox.

The shared second-opinion instruction now forbids inferring active enforcement
from configuration. A fresh installed-skill rerun passed the same consultation
and explicitly labeled sandboxing unverified. External before/after file hashes
were identical. No dependency was installed to change the host. Native Plan
reviewer tools exclude file-editing tools but can expose shell access, so these
trials do not establish enforced read-only execution. Parent model metadata was
Opus 5.5; reviewer model/effort remained unverified and were reported that way.
Raw prompts, events, role bodies and failed trials remain outside Git.

Corrected source digests:
- `skills/helix/SKILL.md`: `33eeb80cf4652d8ac89e45ded762d1065c557a963540ee5629e29d15efc1f0be`
- `skills/helix/references/t3.md`: `99f1840f3925b2a3c2141da6d77676c4328975f8f4616312895fadda549a3a7b`
- `skills/setup-helix/SKILL.md`: `078be04ce46b9412674c09d68d544d303a26b994b5ccc4571939a05408b1cc4f`
- `skills/setup-helix/references/t3.md`: `2d44423c22644b62f2156d6a8b241b28192292385a5503f70f41d5a0f0502c87`
- `skills/second-opinion/SKILL.md`: `2d22207f8b90ae7a3619296cd2fefdaeb62c83fddd6d56bf77a552fddebb6d52`


Installed Codex CLI 0.162.1 trials also passed: the greeting change had three
failing-before cases, 13 preservation cases and 16 passing final tests. Its fresh
native reviewer inspected the complete final delta and captured output with no
findings; an external rerun passed all 16 tests. Second-opinion rejected the
incompatible CSV proposal, distinguished logical traces from executed tests,
and preserved the complete fixture inventory/content hashes. Both retained native
defaults and labeled unobserved provider/model/effort and reviewer enforcement
unverified. The installed copies included the shipped T3 references; no T3 tools,
provider changes or external runtime were used. These bounded direct-host samples
do not prove T3 behavior or establish a reliability rate.

Current verification: all 46 maintenance tests pass, along with directory secret
scan, three skill validators and diff checks. Source-bound command logs record
host, command, baseline commit, full source-file digest, tracked diff digest and
unchanged source after execution. Live T3 writer/reviewer/model/effort/correction
scenarios remain BLOCKED by missing guest authentication; the new scenario rows
are future acceptance requirements, not claimed automated behavioral passes.
The independent source review correction receipt is pending below.


## Final direct-host regression and correction trials

The four required core scenarios have now run on both installed hosts: earlier
Delivery, plus Regression and preservation, Failed required gate, and Review
unavailable. The regression fixture also exercised reviewer-driven correction:
a real independent candidate review found the zero-boundary defect before the
writer received its findings. The writer corrected it, captured failing-before
and passing-after checks, and requested a new review. No synthetic prior rounds
were represented as executed history. Complete skill folders were installed into
fresh repositories; no T3 tools or provider credentials were supplied.

| Host / scenario | Observed result |
|---|---|
| Claude regression / correction | PASS: five final tests and ten external clamp assertions; fresh review after correction; personal file bytes, staged/unstaged state, installed skills and HEAD preserved. |
| Codex regression / correction | Functional/preservation PASS: nine final cases and ten external clamp assertions; fresh review reported with no findings. Child-dispatch export limit below applies. |
| Claude failed required gate | FAIL on scope: six final tests and fourteen external assertions pass; the immutable missing-hardware gate remains exit 3 and final status is BLOCKED. A real review finding caused added preservation tests and a second fresh review. The writer nevertheless put evidence outside the authorized fixture directory. |
| Codex failed required gate | Functional/status PASS: eleven final cases and fourteen external assertions; gate unchanged at exit 3; available work and reported source review completed, ending BLOCKED. |
| Claude unavailable reviewer | FAIL on scope: five final tests and fourteen external assertions pass; no reviewer launched, final status READY FOR INDEPENDENT REVIEW. One temporary output file was written outside the fixture, then removed. |
| Codex unavailable reviewer | PASS: eighteen final cases and fourteen external assertions; protected files/index/HEAD unchanged, no delegation, final status READY FOR INDEPENDENT REVIEW with a readable evidence/delta handoff. |

The Claude scope failures are not silently waived because the code and final
statuses were correct. The skill already requires honoring repository scope;
these are observed adherence failures, with no old-source control establishing
that the T3 adaptation caused them. No runtime enforcement mechanism is added to
Helix. Outside-fixture evidence was exported, checked byte-for-byte and cleaned
up; no host dependency or permission workaround was installed. The native
sandbox had reported its missing `socat` prerequisite. Configuration alone is
not treated as active enforcement.

Claude's captured native Agent requests include the full review brief, complete
readable deltas and actual before/after/gate output, with no inherited writer
conversation. These trials used built-in Plan/Explore roles, not the shipped
Read/Glob/Grep-only template; shell access remained possible and was disclosed.
The per-call instruction was read-only review against the task and repository
rules, correctness/regressions/scope/tests/docs, concrete evidenced findings,
full-delta and actual verification checks, with unavailable gates kept separate.
Exact task packets and failed trials remain outside Git.

Codex's JSON export records collaboration wait events and the parent's returned
review report, but does not expose the complete child dispatch/brief. Thus the
earlier claims about fresh child context and complete evidence transfer are
limited to the requested/reported behavior, not independently correlated child
telemetry. This qualification also applies to the earlier Codex Delivery and
second-opinion trial descriptions. Functional results and protected-file hashes
were independently checked. Neither host's child model/effort or enforced
read-only execution was established in this round. No reliability rate follows.

## Final source-review corrections

The independent Opus correction review accepted H1–H7/D1–D5 and found three low
clarity issues: optional models on another provider, native role restrictions
versus explicit isolation requirements, and Use/Cancel for task-scoped choices.
Those were corrected across the independent skill packages. Subsequent narrow
reviews clarified optional fields and effort-with-default handling in setup,
provider/driver affinity of saved preferences, driver-versus-account identity,
and guided provider/default/missing-choice handling. A 41-turn review attempt
hit its turn limit without returning an opinion; it is retained and is not
approval. Later bounded reviews returned actual results. No source review claims
live T3 behavior, native enforcement, effective effort or merge authorization.

Final skill source digests:
- `skills/helix/SKILL.md`: `33eeb80cf4652d8ac89e45ded762d1065c557a963540ee5629e29d15efc1f0be`
- `skills/helix/references/t3.md`: `593f80f272024445bf6fdfb52413d28d79a478e53c6f8664d9b64b7750d42cfa`
- `skills/setup-helix/SKILL.md`: `1fbd8e53240d12411d80ef39683e1cfd2034cbed9de2441a0d5ad2e19a954145`
- `skills/setup-helix/references/t3.md`: `5f5e5700479b20c4e066331ae247dd9d3e739048ca9eb504a7a0ed38233e0c6d`
- `skills/second-opinion/SKILL.md`: `d16966440ee5f419f38880c3dd25dba022aa2c8147fbed04aafeac5e523956f1`


Final review receipt: the bounded Opus 5.5 source reviews resolved the concrete
comments, and the last closure check accepted the exact missing-choice clause
with no concrete regression. All used fresh CLI contexts; requested model/effort
was `claude-opus-5-5` / `xhigh`, with returned model metadata identifying Opus 5.5
and effective effort unverified. This receipt covers source corrections only.
The live-T3 authentication boundary and direct-host scope/observability failures
above remain open and are not converted into approval by that receipt.

## Follow-up: keep temporary evidence within task scope

The owner requested deeper fixes for the reported Claude failures. Helix now
chooses an evidence/baseline-copy location within the allowed write scope before
capturing it, uses inline output when writes are unavailable, and passes that
boundary to delegates. This is an instruction correction, with no runtime or
host-configuration changes. The earlier failing trials above remain evidence.

Two fresh native Claude 2.1.287 trials used the same failed-gate and unavailable-
review fixture requirements and host defaults. The installed `helix/SKILL.md`
SHA-256 was `a76c69d805a9a9b7bb201c8b6345276f99175eb16c8b62262a5e902536c2a47e`.
Both passed five final tests plus 14 separately executed behavior assertions.
Agent-directed file-tool and shell operations, including the child reviewer,
used inline evidence without outside writes; protected fixture/skill files, index
and HEAD matched before/after. The first made one fresh review dispatch with full
diff and captured before/after/gate results, then reported BLOCKED for the unchanged
exit-3 hardware gate. The second made no delegation and returned READY FOR
INDEPENDENT REVIEW. Neither substituted success for a missing capability.

These are two bounded passing reruns of the observed failure pattern, not proof
of general model compliance or active sandbox enforcement. Effective effort and
isolation remain unverified. Raw transcripts and the operation assessment remain
outside Git. The unchanged T3 path was not run with credentials in this follow-up.

Independent Opus 5.5 review (`--effort xhigh`; effective effort unverified)
confirmed the narrow skill change and inspected original/rerun tool operations,
but identified evidence qualifications, now recorded explicitly. Claude itself
wrote its native child-task output outside the fixture; that is host storage,
not an agent-directed Write/Bash action. The evaluation scores those separately
and makes no whole-process confinement claim. The installed T3 reference also
changed from the original trials (`98c40448…` to `593f80f2…`); T3 tools were absent,
and these exports do not expose full skill-body loading. No old-skill control
was run, so run-to-run variation remains an alternative to instructional causation.
The first follow-up assertion snippet was not retained as a script; a subsequent
recorded rerun on each final fixture uses a saved script, per-case output, command,
fixture/source hashes and exit status. An additional recorded rerun uses exactly
the 14 cases in the original assessment, including custom `trim()`, Symbol,
array and padded-name preservation. Both pass; these later checks do not rewrite
the earlier count-only logs. Scope compliance is addressed for these two reruns; general
adherence and host/dispatch observability remain open. The historical open-status
entry above retains its original point-in-time meaning.

Verification of this follow-up: 46 maintenance tests, all three relevant skill
validators, Gitleaks and diff checks pass. Opus accepted the instruction change
and the first evidence corrections; its final low record comments are addressed
by the explicit rerun provenance and noncausal status wording above.

## Live T3 cross-provider smoke on an authenticated host

Later on October 13, the owner authorized installing T3 on the development host.
The same official standalone nightly and upstream revision above used the
already configured Codex 0.162.1 and Claude Code 2.1.287 accounts in place. No
host credentials were transferred to a guest. The product skill bytes remained
at revision `88181bd81cab353473973df87dfb48291777ba64` during this trial.

A fresh disposable three-file repository required `mean([])` to return `null`,
with README and tests immutable. The Codex writer read Helix and the T3 reference,
captured the failing baseline, added one empty-array guard, and captured five
passing tests. It queried T3's live catalog and dispatched `delegate_task` to a
new Claude provider thread, with the task, full final diff, complete immutable
contract, evidence paths and a read-only review brief. The reviewer independently
read the evidence, reproduced the original failure in memory and ran all five
final tests. It returned approval with no material defects and explicitly
separated pre-existing arithmetic overflow from this empty-input change.

T3 records correlate the writer's Codex/gpt-6.1-sol selection and requested
`reasoningEffort=medium` with the reviewer's claudeAgent/claude-opus-5-5 selection
and requested `effort=xhigh`. Both provider sessions identify those models, and
both runs completed. This proves recorded routing and requested options, not
provider-effective reasoning effort. The child used approval-required authority
and plan interaction mode; its shell calls required no visible operator prompt.
Neither the role nor these settings proves enforced read-only isolation. No
agent-directed review writes were observed. T3's own checkpoint storage is
separate from agent edits.

The parent fetched task status and the child's final response before reporting
completion. An external operator rerun passed all five tests and diff checks,
and compared README/test bytes with HEAD. The actual completed task alone was
not used as verification proof. The bounded trial exercised one review round;
T3 correction rounds, interruption recovery, guided setup and other provider
combinations remain untested. No general reliability claim follows.

Sanitized task/run/model records, exact delegation brief, returned review and
captured command outputs are retained in the operator's exported evidence.
The short-lived verification access session was revoked after export. A small
task-local RPC probe was used for setup/inspection and approval delivery; it is
not shipped in Helix and introduces no product adapter or runtime.
