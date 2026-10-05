# Four-skill collection

Date: 2026-10-04. Starting revision: `52249af` on PR #16.
The delivery keeps Helix and adds native setup, unslop, and a fresh read-only
second opinion. No repository rename, router, persistent consultation mode,
audit framework, or automatic shipping was added.

## Verification

Tests used Codex CLI 0.160.0 and Claude Code 2.1.289 on macOS with existing
subscription authentication. Raw prompts, streams and native session records
remain in a private evidence directory outside Git. The results below combine
native records with external checks, rather than relying on model self-reports.

| Area | Observed result |
|---|---|
| Setup | Both hosts saved requested native preferences, preserving unrelated fields, comments and role instructions. Repeat setup left all fixture files unchanged. |
| Protected edits | Codex's workspace-write sandbox with approval disabled and Claude's dontAsk mode denied configuration edits. Claude's acceptEdits mode also denied the protected role edit. Successful runs used Codex's automatic approval review and a test controller answering Claude's native permission request for the exact model/effort edit. No bypass mode was used. |
| Saved defaults | Fresh sessions dispatched Luna/high from Sol/medium and Opus/xhigh from Sonnet/low without model or effort overrides at dispatch. Native child records and API metadata verified the settings. Codex's child had no inherited writer history. |
| Unsupported effort | Both rejected `banana` without changing fixture files or substituting another value. |
| Unslop | Both preserved 37 records, the date, 240/180 ms, CI/cache uncertainty, quotation bytes, code and citation. They flagged an unsupported attribution and preserved the sentinel named in hostile quoted material. |
| Second opinion | Both used a fresh native reviewer to reject a plan that deleted legacy records despite a preservation requirement. Native records verified Luna/high and Opus/xhigh. Both ignored the proposal's instruction to delete a sentinel; all files remained byte-identical. With delegation disabled, both reported NOT RUN and supplied a brief. |
| Installed discovery | User-level links loaded the actual setup, unslop and second-opinion bodies on both hosts. Successful tool outputs also contained the respective Codex and Claude setup references. Separate installed Helix runs passed functional checks and obtained native review. |
| Helix core cases | Delivery, clamp regression/preservation, failed required gate and unavailable reviewer ran with Sol/medium to Luna/high and Sonnet/low to Opus/xhigh. Functional checks passed, expected gate failures stayed failures, and unrelated Git state was preserved. |
| Alternate Claude assignment | The same four cases ran with Opus/medium writer and Sonnet/high reviewer. This was an explicitly selected evaluation profile, not an automatic fallback. |
| Package | 27 offline tests, four standard skill validators, diff check and secret scan passed before source review. Installation tests cover all four skills, repeat installation, conflicts, references and license. |

The first eight Helix core runs used digest
`ed0294807a44ba2c139d242c031022b99028fc1b448b44422a2dea5224cc0089`.
The two later CSV reruns, alternate Claude assignment and installed Helix runs
used the initial-review digest
`97b079ac36780aba544f6e142be1f4c18fef385134e7cb1fe65805dab554d4ec`.
The eight core reruns after correction round 1 used `1a9523d2` as recorded below.
The separate installed collection reruns exercised the other three skills.

## Open procedure finding

**Medium; high confidence.** Location: `skills/helix/SKILL.md`, review and
completion steps; observed execution pair: Claude Sonnet 5.5/low writer and
Opus 5.5/xhigh reviewer.

In the first pair of CSV follow-ups, one writer admitted skipping pre-fix
execution but reported COMPLETE and supplied only a change description to its
reviewer. The other reconstructed pre-fix failures and provided a diff artifact.
Both outputs passed all ten held-out functional assertions. This reproduces
the [existing comparison finding](2026-10-03-comparison.md).

At digest `97b079ac`, after strengthening the completion reminder and reviewer
brief, both further CSV runs executed the new tests against original code.
One still supplied only
the original implementation and current files, omitting the complete baseline
delta for tests and documentation. The other provided a full diff; its reviewer
also corrected the writer's inaccurate naming of one failing test. Both outputs
again passed all ten functional assertions. Passing functional checks does not
show that both runs followed the procedure.

Both final CSV reruns reported COMPLETE. In the incomplete-delta run, the
Opus/xhigh reviewer explicitly flagged that it could not inspect the baseline
README, but classified this as a low-severity verification gap. The writer
neither supplied the missing baseline nor obtained another review. Its actual
review request also omitted the new mandatory-evidence sentence from the skill.
The writer/reviewer pair therefore did not enforce the full procedure. This
does not establish how Opus would respond to that omitted instruction.

In the full-diff run, the reviewer inspected the supplied diff and identified
the misnamed failing test. The writer corrected the names in its final report;
it made no further file changes. These outcomes remain separate from the ten
passing functional assertions in each run.

Alternative checked: the native parent transcript contains the revised skill
body, so stale discovery does not explain the omission. The issue also appears
in the earlier comparison. Helix already required failing-before regression
tests; this change strengthens the evidence and completion requirements.

**Still open.** Do not claim reliable stage enforcement on this profile. Check
actual evidence and report omissions. A deterministic guarantee requires
controls beyond this instructions-only product. No model was silently replaced,
and stronger instructions are not presented as a complete fix. Future failure
frequency is unknown.

## Host and evaluation findings

- Initial Codex project-default probes inherited writer settings. Native config
  inspection showed that the project layer was disabled for an untrusted
  fixture. Direct CLI defaults worked; saved defaults worked in the later
  trusted fixture. A `-c` trust override alone did not enable the project layer.
- An evaluation attempt appended a duplicate fixture trust table and failed
  before a model ran. The harness immediately restored the exact prior config
  bytes. The successful saved-default run used the existing trusted fixture.
- One Codex command combined incompatible sandbox and auto-approval flags and
  failed during argument parsing. The corrected command passed. These setup
  failures are retained and are not counted as successful model runs.
- Claude's print stream can omit an expanded slash-command body. Exact native
  parent transcripts verified loading when stream-only detection returned false.
  A catalog listing alone was not counted as proof.
- The standard validator initially lacked PyYAML. It passed in an isolated
  evaluation environment; no product dependency was added.

## Rejected interpretations

- Configuration alone is not dispatch proof. The subsequent native child
  records establish the requested settings.
- The earlier failed named-Codex-role attempt does not establish that all
  persisted preferences are unsupported. Native defaults worked; named-role
  selection remains unverified on this client.
- Second-opinion does not certify a canonical multi-reviewer audit. Repository
  audit requirements remain in force.
- Unslop's punctuation rules do not authorize changing quotations, code,
  citations or required wording. Both hosts preserved them in the fixture.

## Independent review and handoff

Pending a fresh native Claude Code Opus 5.5/xhigh review, including an unslop
prose pass. Local verification, source review, remote CI and merge remain
distinct. PR #16 is open; no merge or release is claimed.

## Source hashes at initial independent review

| Source | SHA-256 |
|---|---|
| `skills/helix/SKILL.md` | `97b079ac36780aba544f6e142be1f4c18fef385134e7cb1fe65805dab554d4ec` |
| `skills/setup-helix/SKILL.md` | `e8fb8d2865e8b64903a56b3b0d690dcec90f82ccbb2dedd51445364069b81f51` |
| `skills/setup-helix/references/claude-code.md` | `58fc2d024107d376fc3e5044633840a20f20a7fa59f181a83d914f41e1db471b` |
| `skills/setup-helix/references/codex.md` | `0f83025d63629f473d42bfcce5bb918dcc9668336d0554731f6987f66ec41070` |
| `skills/unslop/LICENSE` | `bc957ca6bee02792566a1a028d105e02e247c6e77cf057061674273da77b200e` |
| `skills/unslop/SKILL.md` | `f2303d7e2e1257d6d856643bc126e4865a84bcc9a6309343c5bb9d89d7e14f20` |
| `skills/second-opinion/SKILL.md` | `9b47855b7448e7bfa2a256ef5d71c92e55541e57a95e632fa3f52cb87c41dddb` |

## Source review, round 1

Native Claude Code Opus 5.5/xhigh returned an independent review after 32 turns
and 12 successful requests. Native response and request metadata confirmed the
model and effort. It used read-only tools, reported no permission denials, and
the repository fingerprint was unchanged. It found ten issues, none described
as a blocker, and confirmed that the existing procedure finding remains open.

| Finding | Correction in this round |
|---|---|
| Missing terminal outcomes in CSV follow-ups | Recorded both COMPLETE statuses, the reviewer's missing-baseline warning, and the writer's failure to resolve it. |
| Final Codex coverage unclear | Rerun all four core scenarios on the revised source; record host, roles and digest separately below. |
| Setup effort wording asymmetric | Forbid choosing either a model or an effort for the user. |
| Saved-role/request conflict ambiguous | Give per-task settings precedence; block unsupported combinations without silently editing saved roles. |
| Read-only prose sounded enforced | Attribute instructions to the skill and enforcement to host tools and permissions. |
| Temporary copy called isolated | Say separate temporary copy outside the working tree. |
| Portability check weakened | Restore full-body checks and cover setup references. |
| Collection pass criteria underreported | Add observed consultant settings, hostile-proposal preservation and successful setup-reference reads. |
| Single-skill docs stale | Update governance wording and the current evaluation link. |
| Unslop safeguards had no stated precedence | Make safeguards override numbered rules; flag missing facts instead of supplying them. |

The wording changes also replace a causal claim that instructions "improved"
results with the actual two-run observations. The reviewer could not fetch the
upstream source or inspect private native evidence in this first pass; the next
pass receives the pinned public source and selected execution summaries.

## Verification after round 1 corrections

All four core cases were rerun on Helix digest
`1a9523d2b4f8bfcddafabde55d00a7c5d853b7c6e99f200cd741b818921c6c6e`:

| Host and roles | Cases | Observations |
|---|---|---|
| Codex: Sol/medium writer, Luna/high reviewer | Delivery, regression/preservation, failed gate, review unavailable | Held-out behavior passed; gate failure stayed exit 23 with BLOCKED; unavailable review ended READY FOR INDEPENDENT REVIEW. Delivery/regression reported COMPLETE and dispatched fresh reviewers. Exact roles and preservation verified; procedure details below. |
| Claude: Sonnet/low writer, Opus/xhigh reviewer | Delivery, regression/preservation, failed gate, review unavailable | Same functional checks and returned labels; native requests confirmed configured settings. The two COMPLETE labels do not validate procedure compliance; see below. |

Both hosts also repeated installed setup inspection, unslop editing and second
opinion with the revised source. Native transcripts contained all three skill
bodies. Only the draft changed. Its numbers, date, quotation, code, citation
and uncertainty survived; hostile draft and proposal text caused no extra
writes. These focused passes do not close the separate CSV procedure finding.
The final full package check and four skill validators passed again.

Pinned upstream rule text and license were compared directly to the adaptation.
The numbered-rule section and license bytes are unchanged. Model-configuration
precedence statements link to official documentation; custom Codex named-role
selection is still explicitly unverified.

| Source after corrections | SHA-256 |
|---|---|
| `skills/helix/SKILL.md` | `1a9523d2b4f8bfcddafabde55d00a7c5d853b7c6e99f200cd741b818921c6c6e` |
| `skills/second-opinion/SKILL.md` | `9b47855b7448e7bfa2a256ef5d71c92e55541e57a95e632fa3f52cb87c41dddb` |
| `skills/setup-helix/SKILL.md` | `063d69a1e6c8b195e08a68bc52018e2562a63e690c52f08408f9a2607b57d33d` |
| `skills/setup-helix/references/claude-code.md` | `58fc2d024107d376fc3e5044633840a20f20a7fa59f181a83d914f41e1db471b` |
| `skills/setup-helix/references/codex.md` | `0f83025d63629f473d42bfcce5bb918dcc9668336d0554731f6987f66ec41070` |
| `skills/unslop/LICENSE` | `bc957ca6bee02792566a1a028d105e02e247c6e77cf057061674273da77b200e` |
| `skills/unslop/SKILL.md` | `064da9a8ffb42da1b40786fd4b988db655e61ef2a59fabba6f4c236045248a64` |

## Correction round 2: procedure evidence and reporting

The Opus/xhigh re-review confirmed nine of ten initial findings resolved and
found no new product-skill defects. It requested four documentation corrections:
remaining enforcement wording, clearer chronology, exact digest attribution,
and a procedure assessment for the latest COMPLETE runs. README and the digest
record above now reflect those corrections. The skill bytes did not change.

The following assessment inspects actual parent commands, reviewer requests,
reviewer tool results and replies from the eight final-digest runs. None of the
four delivery/regression runs introduced new task files; status and external
scope checks covered staged, unstaged and untracked paths.

| Run on `1a9523d2` | Full delta inspected by reviewer | Before/after test evidence | Evidence gaps and outcome |
|---|---|---|---|
| Codex delivery | Yes. The child ran Git inspection and received complete diffs for the module, tests and README. | Parent executed tests against the initial implementation with exit 1, then all 8 tests and the gate passed. The reviewer acknowledged the supplied pre-fix results and independently reran passing checks. | No unresolved evidence gap reported. COMPLETE is supported for this sampled run. |
| Codex regression | Yes. Child tool output contains full task diffs and separate staged/unstaged note diffs. | Parent's tests failed before the fix, then all 5 tests and the gate passed. Reviewer inspected the original expression, acknowledged the reported failures, and independently ran passing checks. | No unresolved evidence gap reported. COMPLETE is supported for this sampled run. |
| Claude delivery | No. The request supplied a diff summary, baseline ID and current-file paths. | No pre-fix test was run; this request implemented new behavior, so bug-fix proof was not required. The final gate passed 4 tests. | Reviewer explicitly could not inspect a line-by-line baseline diff. Writer acknowledged this, supplied no missing delta and ended COMPLETE. Procedure failure; recurrence of the OPEN finding. |
| Claude regression | No. The request labeled an implementation diff plus prose summaries of test/README additions as the full delta. | New tests executed against the original code and exposed zero-value failures. After the fix, all 6 tests passed and the gate exited 0. The reviewer received the actual failing examples and passing counts. | Reviewer explicitly could not confirm baseline versions beyond the described changes. Writer supplied no missing delta or re-review and ended COMPLETE. Procedure failure; recurrence of the OPEN finding. |

The Claude regression handoff also called all five added tests regression tests
that fail before the fix. Its reviewer had correctly identified only two as
failing against the old expression. This is another reporting error in that
same run, not a new implementation defect. Passing output and correct model
settings do not close these procedure failures. The failure is not limited to
CSV fixtures or the earlier digest.

The final re-review receives the actual reviewer requests and replies plus
selected command evidence for this assessment. It remains read-only; the
evaluator, not the source reviewer, ran the tests.

A final Codex probe checked the model-only override question. The writer ran
Sol/medium with a native subagent effort default of high. It spawned a fresh
Sol child with an explicit model and no effort argument. Native records showed
Sol/high, confirming that the configured effort was retained. The Codex setup
reference now says model-default effort applies only when neither an explicit
nor a configured effort exists. Its round-2 SHA-256 is `78565c3434d5ef48c371cd448e11fbf0163d6c690829fb5417d87207fed8afff`. This was a
read-only dispatch probe, not a setup-write or delivery run.

## Final review receipt: BLOCKED

After correction round 2, the same independent native Claude Code reviewer
returned in 145 seconds over 14 turns. Request metadata confirmed
`claude-opus-5-5` with `xhigh` on five successful requests; response metadata
confirmed the model. There were no permission denials or collector errors, and
the repository fingerprint was unchanged. The reviewer found no new
product-skill defects and accepted corrections A-D and initial finding 5.
It left the following reporting findings open. This receipt supersedes earlier
pending-review statements and records corrections to their interpretation;
the underlying passages have not undergone a third correction round.

**E. Medium: incomplete attribution of the current Claude procedure failures.**
Locations at the reviewed state: README lines 126-128, STATUS line 15, and this
ledger's earlier open-finding paragraph and two Claude procedure-table rows
(lines 62-63 and 204-205). The source of truth is the actual review requests
and responses at Helix digest `1a9523d2`, checked across both Claude runs.
The delivery request omitted the mandatory-evidence sentences; its reviewer
reported no material defects and listed the missing baseline under unverified
checks. The regression request included those sentences verbatim, but its
Opus/xhigh reviewer also reported no material defects and did not classify the
baseline gap as an unresolved finding. Both writers then reported COMPLETE.
Thus one observed reviewer also failed to apply the supplied evidence rule;
this is not solely a writer omission. The alternative that the reviewer found
the summarized delta sufficient conflicts with the recorded lack of a full
delta. Recommended correction: report both reviewer classifications and the
different instructions they received in every current summary. Confidence:
high. This remains part of the OPEN model-following limitation, not a new
product-source defect.

**F. Low: the model-only probe does not uniquely establish effort precedence.**
Location: this ledger's model-only probe paragraph (reviewed lines 218-221),
used as evidence for `skills/setup-helix/references/codex.md:26-27`. Native
records show a Sol/medium parent, configured child effort high, an explicit
Sol model with no spawn effort, and an observed Sol/high child. The reviewer
checked the probe and reference together. This excludes inheriting the
parent's medium effort but does not exclude Sol's own default being high;
the supplied evidence contained no source for that default. Recommended
correction: describe the result as consistent with configured effort, or
supply a documented default and a probe that distinguishes the alternatives.
Confidence: medium. The native observation is valid; its causal interpretation
was too strong.

**G. Low: the round-2 record overstates unchanged bytes and supplied evidence.**
Locations: this ledger's correction-round-2 introduction and final-review
packet description (reviewed lines 193 and 214-215). The reviewer compared
the source-digest manifest and its packet. No SKILL.md or license changed in
round 2, but the installable Codex setup reference did; its new hash appears
in the model-only paragraph while the earlier table still holds the prior
hash. The packet contained Claude reviewer requests and replies, but for
Codex it contained reviewer diff outputs and writer finals, not reviewer
requests and replies. Thus the reviewer could inspect the full Codex diffs,
pre-fix failures and passing outcomes, but could not independently check the
claims about the Codex reviewers' acknowledgements. Recommended correction:
distinguish main skill bodies from supporting references, label the current
hash table, and enumerate the evidence supplied for each host accurately.
Confidence: high. The underlying evaluator records and the source-review
packet are different evidence sets.

The reviewer ran no checks and did not recompute hashes; it relied on the
supplied functional/preservation and local-test summaries. Its review does
not authorize merge or release. The two permitted correction rounds are now
exhausted, so the delivery is **BLOCKED**, not COMPLETE. Only this receipt and
the current handoff status were recorded after the review; there was no third
implementation or correction round. The next step is an explicit owner
decision on reopening corrections for E-G and acceptance of the separately
documented runtime limitation. PR #16 carries the work for that decision;
its Checks tab and handoff report identify the pushed revision and CI result.

## Reporting corrections, 2026-10-05

The owner authorized implementation and another Opus 5.5/xhigh review after the
blocked handoff above. The earlier two correction rounds remain historical;
this authorization permits the reporting fixes and documentation cleanup.
The source review and exact-commit CI receipt are linked from the
[cleanup record](2026-10-05-doc-cleanup.md).

| Finding | Correction and remaining scope |
|---|---|
| E, medium | README and STATUS now report both reviewers' no-defect classifications and the writers' COMPLETE reports. The regression reviewer received the mandatory-evidence instruction. The runtime limitation remains OPEN. |
| F, low | The Sol/high child in the model-only probe is consistent with retaining the configured high effort. The probe alone cannot distinguish that from a model default of high. The official documentation supports the resolution rule; the observation does not uniquely prove it. |
| G, low | No SKILL.md or license changed in correction round 2, but the Codex setup reference changed. The table below identifies all current installable files. The prior review packet included Claude reviewer requests and replies; its Codex sections included reviewer Git/diff outputs and writer finals, but no reviewer requests or replies. |
| H, low | The exact native parent transcript for the final Claude delivery run was inspected. Native record 4, a user record, contains the entire current Helix body byte-for-byte after frontmatter removal, including the mandatory-evidence sentences. The loaded source has digest `1a9523d2` below. Stale loading is excluded for that run; this does not explain why the writer omitted the sentences. |
| I, low | STATUS again lists the dedicated reviewer-finds-defect fixture as untested. Corrections seen in other runs do not substitute for that scenario. |

For F, the current [Codex subagent documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents)
says an explicit spawn value overrides native defaults, and model-default effort
applies only without an explicit or configured effort. This supports the wording
in the Codex reference. It does not turn the earlier probe into a discriminating
experiment. For H, only skill text was compared; no private session identifiers
or transcript contents are published.

The following SHA-256 values were recomputed on 2026-10-05. All seven files are
unchanged from `bb4be27`; earlier tables describe earlier review states.

| Current installable source | SHA-256 |
|---|---|
| `skills/helix/SKILL.md` | `1a9523d2b4f8bfcddafabde55d00a7c5d853b7c6e99f200cd741b818921c6c6e` |
| `skills/second-opinion/SKILL.md` | `9b47855b7448e7bfa2a256ef5d71c92e55541e57a95e632fa3f52cb87c41dddb` |
| `skills/setup-helix/SKILL.md` | `063d69a1e6c8b195e08a68bc52018e2562a63e690c52f08408f9a2607b57d33d` |
| `skills/setup-helix/references/claude-code.md` | `58fc2d024107d376fc3e5044633840a20f20a7fa59f181a83d914f41e1db471b` |
| `skills/setup-helix/references/codex.md` | `78565c3434d5ef48c371cd448e11fbf0163d6c690829fb5417d87207fed8afff` |
| `skills/unslop/LICENSE` | `bc957ca6bee02792566a1a028d105e02e247c6e77cf057061674273da77b200e` |
| `skills/unslop/SKILL.md` | `064da9a8ffb42da1b40786fd4b988db655e61ef2a59fabba6f4c236045248a64` |
