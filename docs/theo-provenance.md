# Provenance and deliberate adaptations

Prepared 2026-10-16. Primary source: [Theo's stream](https://www.youtube.com/watch?v=SY_woOjzlW4). This is an independently worded adaptation, not an original source repository. The earlier extraction, source frames and raw review receipts remain in the separately delivered evidence bundle; they are not shipped as executable skills or claimed to be in this checkout.

## Labels

- **Theo — observed:** independently worded paraphrase of visible file content. This is not a verbatim copy.
- **Theo — spoken:** workflow purpose or requirements from narration. This does not establish the unseen file's wording.
- **Written:** new instructions authored for this bundle by Codex, subsequently reviewed as recorded in the review ledger. These may be inspired by Theo, adapted from another visible skill, or needed to make the bundle coherent. They must not be attributed to Theo or Julius.
- Frontmatter descriptions are locally written invocation text. Helix removes the redundant provenance metadata field to match its two-key frontmatter convention; the body labels are retained. A later Helix review clarified babysit-pr's pre-push review order; this is a new addition, not attributed to Theo. “User” replaces Theo's name. Automatic discovery is not disabled; operative authority gates still require the appropriate user request.

## Per-skill evidence

| Skill | Recovered source | Newly authored portions |
| --- | --- | --- |
| sol-loop | All visible procedural sections, including final report and routing guards; live opening/footer edits, about 1:13:10–1:19:45 | Condensation; host schema/cancellation/retry handling; active-user permission boundary; severity/invariant clarification passed into the brief; necessary diff growth; stacked targets and review identity/rebase rules |
| full-send | Visible 108-line procedure, about 1:37:09–1:41:18 | Cross-skill endpoint passing, target-base preservation, guarded head check, queue/auto-merge suspension for this PR, merge-commit contributor credit, explicit comment routing, cancellation/reuse and host capability limits |
| full-stop | Only original lines 1–21; final trigger edit; narration about autonomous preparation without merge | Entire numbered workflow, default Sol review, review-before-publication rule, detailed readiness gate, approval-pending handoff, auto-merge/queue exclusion, inherited queue handling, handoff mechanics and all remaining body |
| takeover | Essentially all visible 48 lines; introduction at 1:48:34, file inspection about 1:49:56–1:51:30 | Caller authority/endpoint, branch isolation, destination/source separation and handling concurrent source updates |
| modernize | Narrated purpose at 1:50:10–1:51:02; referenced by takeover | Entire operating procedure and explicit closure permission rule |
| file-pr | References in full-send/takeover: filing, verification sentence, contributor credit | Entire procedure, including exact-target lookup, body handling, model footer and readback |
| babysit-pr | References/narration: monitor CI/reviews; verify fixes; T3 watch/unwatch lifecycle | Entire procedure, including review surfaces, bot completeness, retry boundaries, read-only behavior and portable waiting |
| file-upload | Proof cross-reference and narration at 3:54:10–3:54:24 | Entire procedure; supported `--attach` path, capability check and partial-success handling from official GitHub CLI documentation |
| leaving-pr-comments | Original lines 12–32 at about 1:13:05: NOTE callout and model disclosure | Current-user template, actual model verification, posting authority, evidence, thread handling and readback |

The later “fix formatting” and deployment result for sol-loop was not recovered. Full-stop's unseen body remains unseen; this task **completes a new usable adaptation**, not that historical recovery. No originals were recovered from the public GitHub search. We do not treat absence from inspected locations as proof a private or undiscovered copy does not exist.

## Perspective and departures

Theo's visible edits cut abstract agent prose down to direct instructions: make the change correct, keep it small, and do not accept bad review claims just to finish. The new helpers follow those decisions and avoid a universal planning/reporting bureaucracy. They preserve the distinction between doing the work and proving that it finished.

These deliberate additions are not presented as Theo's rules:

1. **Authority follows the current user.** The video describes Theo's personal grants. Those cannot override another user's explicit restrictions or repository rules.
2. **Rare does not mean irrelevant.** The source's nit rule is preserved in the observed section, then qualified for actual supported inputs and documented invariants. This prevents an uncommon but in-scope failure being dismissed just because it is uncommon.
3. **Necessary fixes may enlarge a diff.** Reducing review-induced bloat is preserved; deleting a necessary correction just to reduce the line count is not required.
4. **Full-stop cannot merge indirectly.** Auto-merge and queue admission are excluded as well as a direct merge. Automatic merge state is inspected initially and before pushes/handoff. An active path is surfaced before publishing; independent local verification may continue. Full-send also prevents publishing unfinished work into an already-active automatic merge path; its new authority clause permits suspending automation for this task's PR to restore the gate, without a new question when existing user/repository limits allow it.
5. **Modernize closure is explicit.** Narration says to close obsolete PRs, while visible full-send/takeover authority rules require authorization. The helper reports obsolescence and requires separate authority to close. It does not inherit closure from full-send/full-stop.
6. **Sol is not substituted.** Full-stop's new default uses the recovered Sol procedure; an expressly requested reviewer supersedes that default. Missing access is a real blocker. The completion deliberately honors sol-loop's publication gate: finish independent local work, but do not push/file an unreviewed change. This can mean handing off before a first PR exists. It is a declared choice, not recovered full-stop text.
7. **Non-T3 waiting is explicit.** Source T3 watcher names are historical. The new helper uses available schemas and permits a supported check-wait plus restrained review refresh outside T3. It never treats check completion as review completion.
8. **No stale codename mapping.** The partial original comments file showed historical model aliases. The completed skill requires an actually confirmed public model name instead.
9. **No unnecessary helper recursion.** `file-pr` owns PR creation; upload preparation returns to that caller for one publication. Babysitting returns readiness to the parent; only full-send owns merging. Under full-stop, takeover returns after local inheritance/modernization/verification, before publishing; full-stop then performs the required review and filing. This sequencing override is new, not an alteration attributed to Theo's takeover source.
10. **Evidence is current.** Rebase/head changes require re-evaluation; partial API success requires readback before retry. These are new implementation rules supporting the source's proof requirement.
11. **Human approvals are a handoff, not an unattended wait.** After agent-side work finishes, a missing required approval is reported as ready for human review, approval pending. It is never called ready to merge. Full-send retains its merge gate and asks for the blocker to be cleared.
12. **Review-only and failed launches are explicit.** The new portability section avoids checkout/file mutation in a no-edit task. Failed launches do not count as completed review rounds, but a repeated identical failure stops after one recovery retry. These operational details were not in the source.
13. **Standalone filing remains narrow.** A stale-base standalone request gets an update-needed handoff rather than an implicit branch rewrite. Verified new work defaults to ready for review; requested artifacts are checked on readback and remain outstanding if upload is unavailable.
14. **Routine PR replies are explicit.** The new full-stop procedure includes authority to answer reviews on this task's PR, subject to the user's/repository's limits and agent disclosure. It does not authorize unrelated messages.

15. **Review also precedes later pushes.** The Helix PR review made babysit-pr explicitly honor caller-required independent review agreement before publishing behavior-changing fixes on an existing PR, whether using sol-loop or an explicitly named reviewer. This clarifies the new helper; it is not an additional recovered source rule.

## Technical sources for new material

- [GitHub CLI PR create](https://cli.github.com/manual/gh_pr_create): explicit base/head and body-file support, attachment behavior.
- [GitHub CLI PR edit](https://cli.github.com/manual/gh_pr_edit): media attachment, body preservation and partial success.
- [GitHub CLI PR merge](https://cli.github.com/manual/gh_pr_merge): expected-head guard and merge queue behavior; local help also verified.
- [GitHub CLI PR checks](https://cli.github.com/manual/gh_pr_checks): check-watching interface; it is not a review watcher.
- [Claude Code headless](https://code.claude.com/docs/en/headless) and [model configuration](https://code.claude.com/docs/en/model-config): review invocation. Actual model/effort evidence is recorded separately.

No instruction here claims the files were written, approved or published by Theo or Julius.

## Helix packaging

The nine folders are one cooperating bundle. Keep them as siblings when installing
full-send, full-stop or takeover. Sol-loop itself needs no other skill. Other
helpers load their linked siblings only when that operation is needed. The default
install guide includes every folder. No other Helix skill or saved model setting
is required by this bundle. Loading a file for review is not invoking it.

The repository MIT license covers the locally authored adaptation. No license
for Theo's unrecovered original files, or endorsement from Theo or Julius, is
claimed. The [search record](theo-source-search.md) explains where originals
were sought. The [integration record](reviews/2026-10-16-theo-bundle.md) separates
source review, packaging checks and runtime coverage.
