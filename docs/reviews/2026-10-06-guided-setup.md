# Guided setup and native model discovery

Baseline: `4318e34` on `helix/main`. This change adds a guided bare invocation
to setup-helix. Helix, Second-opinion and Unslop are unchanged. The deprecated
repository was not used. Raw transcripts and disposable fixtures remain outside Git.

## Result

Setup lists native model choices, asks for scope and model-specific effort,
previews the edit, and waits for Save or Cancel. Complete requests skip the
interview. Native question controls and numbered text were both observed.
The tests exercised native CLI protocols with scripted user answers, not a
visual inspection of terminal widgets.

The optional helper uses Node's standard library to query the installed
CLI. It starts no inference turn, installs nothing and writes no configuration.
A helper was justified because neither tested CLI exposes a single catalog
command: Codex needs an initialized, paginated protocol exchange; Claude needs
control initialization and removal of account fields from the response.
Keeping this transport in one tested file avoids generating it on every setup.
It is not an orchestration runtime or provider adapter.

## Verification

Hosts: Codex CLI 0.160.0, Claude Code 2.1.289, macOS, Node.js 24.16.0.
Setup sessions requested Sol/medium and Sonnet/low respectively. This evaluation
checks dialogue and saved files; it does not certify those sessions' internal
reasoning or rerun the saved-child dispatch evaluation.

| Case | Observed result |
|---|---|
| Fresh discovery, three runs per host | Identical results within each host: 7 Codex models and 11 distinct Claude model IDs, with model-specific effort lists. Checked user configuration files remained unchanged. |
| Complete menus | Claude printed all 11 IDs. Codex offered 5 models after applying its session's delegation restrictions. Both included keeping existing/inherited settings. |
| Guided save, both hosts | The selected model and effort were saved only after the preview and affirmative answer. Codex saved Luna/high; Claude saved Opus 5.5/xhigh. Only the intended native config and required fixture README changed. Comments, thread limit, role instructions, tools and sentinel files were preserved. |
| Cancel, both hosts | No fixture files changed. |
| No answer channel, both hosts | Missing choices were returned without configuration edits. Codex reported unavailable sandboxed discovery; Claude returned choices. |
| Complete repeated request, both hosts | No redundant choice questions and byte-identical configuration. The final Claude repeat also rejected a misleading Codex-specific scope statement. |
| Helper boundary tests | Pagination, hidden entries, alias resolution, missing effort metadata, account-field removal, visibility settings, empty/invalid/oversized responses, protocol errors, missing CLI, timeout and unsupported host. |
| Maintenance | 38 tests pass; skill validation, diff checks and Gitleaks pass. Validation used an isolated `uv --with pyyaml` environment because system Python lacked PyYAML; no project dependency was added. |

The final entrypoint and helper were exercised through the guided save path.
The subsequent Claude scope wording was exercised with the same complete
repeat request that had produced the wrong scope description. Earlier cancel
and no-answer cases tested the unchanged cancellation and missing-input rules;
they do not establish every path on every source digest.

Source SHA-256 prefixes:

| File under `skills/setup-helix/` | Digest |
|---|---|
| `SKILL.md` | `1ce501e18325c8aa` |
| `references/codex.md` | `3c23b28fa2646066` |
| `references/claude-code.md` | `e223bf6faaaa8520` |
| `scripts/discover-models.mjs` | `938ba293f029f593` |

## Corrections and retained failures

- **Startup access:** direct discovery succeeded, but a nested Codex CLI failed
  under its sandbox. The skill now requests the normal approval for the exact
  metadata command. The tested approval added no persistent permission rule.
  With no approval channel, it leaves discovery unverified and makes no edits.
- **Catalog visibility:** an initial attempt to suppress all nonessential
  traffic, and a separate `DISABLE_TELEMETRY` trial, reduced Claude's catalog
  from 11 models to 4. The helper preserves those user settings. Independent
  error-reporting and updater controls retained all 11. The visibility
  regression test fails with the earlier helper and passes with the correction.
- **Missing menu choices:** Claude initially shortened the catalog to fit a
  question widget. The skill now prints the complete list before requesting a
  selection. The corrected run exposed all returned IDs, including Haiku and
  older models, with no invented effort list for Haiku.
- **Scope reporting:** a repeat request included a Codex all-subagent statement.
  Claude initially repeated it despite saving only a named role. The reference
  now explicitly distinguishes the hosts. The same request then produced the
  correct named-role scope, with no edits in either run.
- **Symlink installation:** the initial helper returned no output when invoked
  through an installed skill symlink. Resolving the entry-point path fixes it.
  The symlink regression fails before the fix and passes afterward; both real
  user-level installations now return their host catalogs.
- **Evaluation client failures:** an early client answered a save question with
  an earlier choice; Claude refused to save. A separate client confused server
  request IDs with response IDs and aborted. Those runs were retained and not
  counted as completed setup. The corrected client exercised normal question
  and protected-file approval responses.

## Limits and review

Discovery means host-listed metadata, not guaranteed account access. Parent
command-line provider/profile overrides do not propagate to the helper, so
those sessions must use exposed host metadata or manual choices. Unsupported
protocol versions, missing Node or denied permissions also use manual choices;
they must not produce a claimed live catalog.

No new delivery workflow, saved-child dispatch, cache benchmark, Windows/WSL,
OpenRouter or Azure evaluation was run. Azure remains excluded. The earlier
Claude incomplete-review/false-COMPLETE limitation remains open.

Independent source review and exact-commit CI are recorded in the pull request.
These local results do not grant merge or release approval.


## Correction round 1

Initial independent review used Claude Code Opus 5.5/xhigh. Native request
records confirmed both values; 59 successful requests returned a review with
2 Medium and 9 Low items, no High findings, and no repository edits.
The earlier table overstates completeness: Codex showed only 5 of 7 models,
its fixture prescribed project scope, and its cancellation happened before
the preview. Those claims are superseded by the observations below.

The skill now shows every catalog entry. A delegation parameter's allowlist
is not evidence that saved defaults reject other entries. The new fixtures
leave scope open. They contain no model preferences and preserve the same
configuration sentinels. Version A is entrypoint `39097e916c19535a`; version B is
`0bfc1e1eea7ee8f0`. B additionally requires a capability check for complete requests
and distinguishes the running writer from saved defaults. Both use the final
host references and helper; the guided-choice and cancellation rules are identical.

| Case, both hosts | Version and observed result |
|---|---|
| Scope and full menu | A: both asked for scope. Codex printed all 7 catalog IDs; Claude all 11. Neither replaced the list with a shortlist. |
| Guided save | A: model-specific effort followed model selection. Both waited for an affirmative answer after the preview, then saved Luna/high or Opus 5.5/xhigh. Only native config and the required README changed; unrelated fields and files were preserved. |
| Cancel at preview | A: both received Cancel after model, effort and the proposed edit. No files changed. Codex used its native Save/Cancel question control. |
| First complete request | B: both started without reviewer overrides, checked the native catalog, and saved the requested values without choice or Save/Cancel questions. Normal protected-file approvals remained. An A trial on Claude skipped the capability check; B corrected that behavior under the same request. |
| Explicit discovery denial | B: Codex's metadata-command approval was denied; Claude's model-service connection was denied and discovery timed out. Both offered unverified manual choices without retrying or editing files. |
| Missing Node | B: an empty command PATH simulated an absent Node executable. Both observed command-not-found, offered manual choices and made no edits or installations. The actual system installation was untouched. |
| No answer channel | B: both left files unchanged and listed missing choices. Codex discovery failed in its sandbox. Claude returned all 11 native entries despite denied service connections, which it disclosed; a native catalog is not proof of a fresh network response. |
| Complete repeat | B: both left already matching files unchanged and asked no choice questions. Codex reported failed catalog discovery; Claude reported the native catalog and denied service connections. |

The original no-answer Claude trial used the reduced 4-model helper, and its
original cancellation used a shortened widget. Neither proves a complete menu.
The original Codex no-answer trial asked for model choices, not yet effort.
The three-query preservation check covered `~/.codex/config.toml` and
`~/.claude/settings.json`. Installed-symlink queries were rerun with
`--preserve-symlinks-main`: 7 Codex and 11 Claude entries. Native session records
contain the actual loaded skill body; the review packet includes those excerpts.

The helper now resolves both entrypoint paths, excludes server requests when
matching Codex replies, and bounds cleanup of resistant hosts and inherited
pipes. All three regression tests failed against the previous helper and pass
with the correction. The visibility test covers both telemetry and nonessential
traffic flags. Copy instructions include scripts, active repository links use
`helix`, and metadata sources are defined as native account-context catalogs.

The final local gate has 40 passing tests, valid skill frontmatter, clean diff
checks and a passing Gitleaks scan. These checks do not certify other host
versions, account entitlements or model execution. User-scope writes, graphical
widgets, and the optional post-save execution probe were not exercised here.

Final source SHA-256 prefixes under `skills/setup-helix/`:

| File | Digest |
|---|---|
| `SKILL.md` | `0bfc1e1eea7ee8f0` |
| `references/codex.md` | `d77c44b84019ff36` |
| `references/claude-code.md` | `12cecaf615bc357b` |
| `scripts/discover-models.mjs` | `ede4172c36321127` |

Independent correction-review receipts and exact-commit CI are recorded in
[PR #17](https://github.com/luisgui1757/helix/pull/17). The PR is the handoff;
owner approval and merge remain separate.


## Correction round 2

The first correction review confirmed the helper fixes and complete menus,
but found two Medium and four Low items. Its native requests again confirmed
Opus 5.5/xhigh; it made 44 successful API requests for one review and left the
repository unchanged. The following corrections supersede the affected claims
above. Final review and CI receipts remain in PR #17.

- **Archive link:** the README rename had accidentally removed three characters
  from the retired-engine revision. The restored 40-character hash resolves in
  the canonical GitHub repository. A new test checks active retirement links
  against the archive index; it failed before this fix and passes afterward.
- **Claude denial evidence:** the earlier interactive run proves a timeout,
  not a denial. Its client kept one pending request and did not record outgoing
  answers. That run is not counted as a denied-approval test. The corrected
  client records requests and responses by ID and denies each request directly.
  A denied command returned no catalog and led to manual choices. Separately,
  nine denied native connection requests still returned all 11 catalog IDs.
  The agent disclosed the denials and made no claim of fresh network data or
  account access. Neither case edited files or reran the helper. Multiple
  connection attempts came from one native query, not an agent retry.
- **Writer reporting:** version A incorrectly called saved Astra/xhigh defaults
  the running Codex writer, although the test launched Sol/medium. Version B
  added the distinction; final guided runs now identify saved defaults and
  leave the unexposed running settings unverified. Earlier guided A results
  do not prove this correction.
- **Preview:** earlier runs used effort placeholders or summarized the README
  edit. Final instructions require every choice first, then exact edits to
  every affected file. Both final guided saves showed configuration and README
  diffs, waited for Save, and wrote additions identical to their previews.
  Both final cancellations followed complete previews and left no changes.
- **No-answer report:** the earlier Codex response omitted effort and manual
  choices. The final run lists scope, model and effort, offers inherited/manual
  choices and leaves files unchanged. Claude also leaves files unchanged and
  discloses denied connections when it shows returned native metadata.
- **Evidence:** final interactive runs record the client's approval decisions;
  assertions reject persistent permission grants. The packet contains actual
  loaded skill bodies from all six final Claude cases and the earlier
  headless/repeat cases that previously had only inferred loading.

Final native runs use the source versions below: guided save, preview cancel,
first complete request and no-answer on both hosts, plus separately denied
Claude commands and connections. First complete requests checked metadata and
saved without redundant choice or Save/Cancel questions. Native values and
unrelated-file preservation were checked directly. Earlier repeat, simulated
missing-Node and Codex denial evidence retains its stated version; no new
runtime-dispatch claim is made.

The local gate now has 41 passing tests. The helper itself is unchanged from
correction round 1. The 20-second discovery timeout includes approval waits;
human-speed approval remains a limitation, and a timeout is not a denial.
Freshness and account access require separate evidence even when discovery
returns a native catalog.

| Final file under `skills/setup-helix/` | SHA-256 prefix |
|---|---|
| `SKILL.md` | `2a7f24272cce5187` |
| `references/codex.md` | `d77c44b84019ff36` |
| `references/claude-code.md` | `d6eb1740fec299a3` |
| `scripts/discover-models.mjs` | `ede4172c36321127` |

## Continued correction and full review

The owner removed the correction-round limit on October 6. This extends the
original setup scope: Helix now revalidates prior findings and continues while
it has an authorized way forward. Repeated failures require a fresh diagnosis.
An unavailable prerequisite, scope boundary or outside decision can still block
work. Required verification, independent review and publishing authority are
unchanged. Historical round-limit results above and in earlier records remain
history, not current requirements.

The two Low findings from the previous source review are addressed here:

- R2-1 is recorded as an observed limitation. Final guided saves used complete
  numbered model menus, but both hosts asked smaller questions in plain text
  despite available question controls. Claude also asked for effort before a
  model was chosen. Valid model/effort pairs and explicit save consent were
  observed; consistent controls and question order were not. The how-to and
  STATUS now disclose this. No new setup-behavior pass is claimed.
- R2-2 corrects the timeout claim above: only Claude connection approval waits
  after helper launch count toward its 20-second query timeout. Command approval
  precedes launch on both hosts. A timeout still does not establish denial.
- The final Codex cancel client twice answered a model question with a scope
  answer. The agent asked again instead of selecting a model. That client error
  is retained and is not evidence of a model-choice failure.

### Native workflow checks

Each run used a fresh disposable repository, installed skill bytes, protected
instructions and gate, unrelated staged/unstaged work, and external acceptance
checks. No remote, dependencies or credentials were added. The roles were
Sol/medium to Luna/high and Sonnet/low to Opus 5.5/xhigh. Native child records
and Claude request telemetry confirmed those assignments where reviewers ran;
settings were not inferred from configuration or model self-reports.

| Source and scenario | Codex | Claude Code |
|---|---|---|
| Old `1a9523d2`, seeded two-round continuation | BLOCKED solely because two rounds were used; no edit or reviewer; zero bug remains. | Same stop and untouched bug. |
| Revised `d2f6e04a`, same continuation | Fixed zero, 6/6 external checks, fresh review and COMPLETE. | Fixed zero, 6/6 checks and fresh review; returned READY FOR INDEPENDENT REVIEW instead of supplying its available reviewer with the missing diff. |
| Final `71c00d73`, continuation plus two failed bound-change attempts | Changed the diagnosis to the falsy fallback, fixed it, 6/6 checks. Three regressions failed before; 12 tests passed after. Reviewer read the full diff. | Fixed the cause, 6/6 checks. Two regressions failed before; 6 tests passed after. Reviewer received a summary; writer nevertheless reported COMPLETE. Procedure failure remains open. |
| Final, new label-normalization delivery | 5/5 external checks, 6 passing gate tests and a reviewer that read the full diff. | 5/5 checks and 6 passing tests. A second fresh review received more baseline and gate detail, but no complete diff; COMPLETE does not establish compliance. |
| Final, unavailable protected prerequisite | Required gate stayed exit 23; BLOCKED before edits or review. | Gate stayed exit 23; BLOCKED after implementing and testing, without review. Neither bypassed the gate. |
| Final, delegation disabled | Verified fix; READY FOR INDEPENDENT REVIEW with a brief; no reviewer. | Same result, with native Agent omitted. |

All runs preserved unrelated bytes, staged state, protected files and the
baseline commit. Both hosts loaded the installed skill. The continuation
history and earlier failed attempts were supplied at the input boundary; only
the current correction actually ran. These tests do not prove three real review
rounds or a reviewer-discovered seeded defect. The failed-gate case checks a
real stop condition despite the supplied prior count.

The final Helix text adds an explicit instruction to supply missing evidence to
a file-reading reviewer instead of handing the task back. The Claude result
shows that clarification is not an enforcement mechanism. We retain the
**Medium, high-confidence OPEN** procedure finding at
`skills/helix/SKILL.md:109-114,135-137`. The actual Agent requests contain
summaries labeled as full deltas;
Read/Glob/Grep could not recover Git baselines. This is not explained by an
unavailable reviewer or a functional test failure. Earlier collection runs
show the same problem. Check the diff and evidence yourself before accepting
COMPLETE; changing default models or adding a workflow runtime was not part of
this correction.

The writer's full source review covered all four skills, both host references,
the discovery helper, evaluation runner and fixtures, maintenance tests, active
documentation and checked-in governance. It found no further source defect.
A fixed count was rejected as a progress criterion: the before/after runs show
it stopped a fix that was within scope. No required test or review gate was
removed with that count.

Local maintenance: 41 tests pass, skill validation passes, diff checks and
Gitleaks are clean. The helper remains `ede4172c36321127`; setup's entrypoint
remains `2a7f24272cce5187`. Independent Opus 5.5/xhigh full-review findings,
source identity and exact-commit CI are recorded in
[PR #17](https://github.com/luisgui1757/helix/pull/17). These results do not close
the procedure finding or authorize merge. No cache/performance claim, new
provider coverage, Windows/WSL or Azure test is made.

### Full-review corrections

The full Opus 5.5/xhigh review at `6828c1b` confirmed the cap removal and found
no new High or Medium source defects. It reproduced the known procedure
failure and returned five Low reporting or coverage findings. All 53 successful
native requests used the requested model and effort. The reviewer made no
repository changes. Its receipt is in PR #17.

- L1: the Claude reference digest in the preceding setup table describes the
  earlier setup runs. At `6828c1b` it was `2a7ebd7471c6cb7b`, after the timeout
  wording correction. The current reference is `9408a857bde02349`
  after splitting that sentence. No native setup run used either revised
  reference; neither edit changes the discovery helper or setup procedure.
- L2: both Claude guided interviews, save and cancel, asked effort before model
  selection. The earlier how-to's "one run" undercounted them. User guidance
  now tells readers to check their model and effort in the preview and links
  to STATUS instead of repeating evaluation counts.
- L3: the final continuation fixture stated the falsy-fallback cause. The agents
  fixed that stated cause instead of repeating the seeded bound changes; the
  run does not establish independent re-diagnosis. The failed-gate note also
  told the agent to report the missing prerequisite. The command did fail with
  exit 23, but the stop was prompted. A future diagnosis test should seed an
  incorrect cause, and a gate test should omit that hint.
- L4: the earlier workflow runs used the comparison runner's reviewer body,
  which says to inspect files/diff and keep the review concise. It differs from
  setup-helix's shipped role body. Both use Read, Glob and Grep, but the textual
  role may affect behavior. Those failures establish results for that evaluation
  configuration, not every Claude reviewer. The role bodies are captured in
  the private evidence; CONTRIBUTING now requires this distinction.
- L5: the scenarios now link STATUS for current evidence. The additional
  reviewer-finding cycle below addresses the missing coverage separately from
  the seeded round-count test.

The packet also now includes the actual final Codex child-review messages,
which its first trace export omitted. They report no unresolved findings and
refer to their full-diff reads and checks. Claude had the full diff available
in its own command output before sending a summary; its clamp prompt omitted
the brief's mandatory-evidence sentences. An unavailable diff is therefore not
the explanation for those runs. The instruction clarification is retained as a
requirement, without claiming it solved adherence.

### Reviewer-finding cycle

Two additional runs used unchanged Helix digest `71c00d73`. A separate native
read-only CLI review first inspected each candidate implementation against the
requirements, without a supplied diagnosis. Luna/high and Opus 5.5/xhigh both
found the zero bug, missing regression coverage and stale README. Their actual
reports became the continuation input to the installed skill. These are real
findings, not a seeded report or a claim that earlier rounds ran. The initial
review was launched by the evaluator; the writers dispatched their own final
reviewers through native subagent tools.

Codex fixed the bug, added tests and documentation, and obtained a fresh review
of the full delta. Two tests failed before the fix; all 9 passed afterward,
and all 6 external acceptance checks passed. The child returned no unresolved
findings. Unrelated work and the index were preserved.

Claude used the exact shipped reviewer-template body with Opus 5.5/xhigh,
instead of the comparison runner's body. Four tests failed before the fix;
all 10 passed afterward, and all 6 external checks passed. Its first child
reviewer found a signed-zero overstatement in README and missing verification
evidence. The writer corrected the prose, reran the gate, and started a fresh
reviewer because SendMessage was unavailable. This time it supplied a full diff
artifact, which the second child read. That reviewer confirmed the correction
and reported no material defects.

The cycle still failed part of the evidence procedure: both Claude reviews
received gate counts rather than captured output. The second reviewer labeled
the gate result unverified, and the writer reported COMPLETE without supplying
the requested output. This extends the OPEN finding to a run using the shipped
role; it does not show that role wording caused the earlier failures. The stale
REVIEW.md concern was correctly rejected because the fixture explicitly allowed
changes only to the module, its tests and README. Native records confirmed the
requested writer/reviewer assignments; source loading, protected files and
unrelated staged/unstaged work were checked. The cycle proves actual review,
correction and re-review, not reliable compliance with every instruction.
