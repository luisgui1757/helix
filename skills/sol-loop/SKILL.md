---
name: sol-loop
description: Use when the user asks for a sol loop, or an active workflow calls for one.
---

# Sol loop

**Provenance:** “Theo — observed” sections paraphrase the video, including the two live edits. “Written” sections are this bundle's additions. This is not Theo's original file. Source: [stream, 1:13:10–1:19:45](https://www.youtube.com/watch?v=SY_woOjzlW4&t=4390s). Later formatting/deployment contents were not recovered.

## Theo — observed: purpose and budget

Have Sol review the change, usually before a PR and sometimes afterwards. Make the smallest changes that address valid findings and satisfy the intended behavior. Avoid scope growth and push back on findings you believe are wrong.

- Three rounds by default. First round: the whole change. Later rounds: new code and unresolved findings.
- Extend to five only when the user asks, or an evidence-backed blocker/should remains in security, permissions, auth, data loss, or state/concurrency.
- Stop early when only nits remain. Declined nits or comments/docs/formatting edits do not buy another round.
- One reviewer. The reviewer may not delegate.
- Keep stable finding IDs, severity, disposition and evidence. Record usage only when reported.

## Theo — observed: establish the review

1. Inspect `git status --short`. Preserve unrelated work. Isolate the task's paths, including untracked files; ask if the scope cannot be separated.
2. Fetch the remote. For a PR, inspect its base and head; switch branches only with a clean worktree. HEAD must equal the PR head or be ahead only by this task's changes. Use the merge-base with the PR's target branch. For local work, use the merge-base with the remote default branch. Without a remote, use a user-specified base; HEAD is suitable only for wholly uncommitted work.
3. Freeze that base and one diff definition: base to working tree, restricted to the task's paths, including new files. State intent and exclusions briefly.
4. Run the relevant checks first. Fix failures caused by this change; disclose pre-existing failures and checks you cannot run.
5. Discover the available Sol models; use the latest unless the user specifies one. Record actual provider/model/effort when the tools expose them. Do not substitute a different model.

In T3 Code, the observed route was `orchestrator_capabilities`, then `delegate_task` with review role and asynchronous mode. Each round gets a new client request ID and task ID; a child thread ID is not a continuation destination. The source requires one direct capability probe when T3 tools are not listed, and forbids `t3_thread_send`, `create_threads` and `t3_thread_launch` for reviews. Outside T3, use a native Sol subagent and retain its ID. A Claude `sol` agent is suitable only if its configuration actually targets the requested model.

While review runs, freeze the scoped files. Wait for completion; do not poll for progress or start a second reviewer. Silence, an error and a timeout are not approval. On failure, cancel, confirm it stopped, then restart with the ledger.

## Theo — observed: reviewer brief

Send a self-contained brief with repository, fixed base, scoped paths, intent, exclusions, check results and the exact diff inspection command. Tell the reviewer:

- Review only. No edits, commits, pushes, PR comments or subagents.
- Read surrounding code and callers. Find bugs and failures against the intended behavior. Flag unnecessary code, tests and guards. Skip style unless it hides a bug.
- Blocker: the intended scenario is wrong. Should: a real defect that callers encounter within scope. Nit: everything else. Theo's source treats other paths, unusual cases, minor performance and extra compatibility as nits.
- Return APPROVE or CHANGES, followed by stable ID, severity, file:line, problem and proposed fix for each finding.

## Theo — observed: respond and repeat

Judge each claim and severity yourself. Another path, a rare case or a small cost is a nit regardless of the reviewer's label, subject to the supported-behavior qualification below. Make the smallest sufficient fix. Prefer narrowing or removing code to adding machinery. Add one focused regression test that fails without the fix where warranted. Reject wrong findings with evidence; decline out-of-scope work and nits with a short reason and record them as follow-up.

Update the ledger, rerun checks and inspect diff size. If review inflated the change, look for a smaller solution before continuing. Do not concede a wrong finding to get approval.

Another round requires budget remaining and an open blocker/should, changed behavior, or an approval that no longer covers the behavior diff. Send the original brief, the finding ledger with evidence, the same-base full diff and the delta since the prior round. Ask the reviewer to resolve or retain each prior ID with a reason. Use a fresh T3 review task, or continue the saved native reviewer.

Agreement means approval of the current behavior diff, no open blocker/should, and no unresolved concern of your own. A dispute that survives two exchanges, or exhausted rounds, goes to the user with both positions. Neither is approval.

Hold pushes until agreement. Push afterwards only if the task authorizes it. When updating a PR, place the review receipt immediately above its model attribution. The source's approved receipt includes round count, actual model and the literal approved verdict; effort appears only when verified.

Report rounds and actual model, what the review changed, diff size before/after, fixed and declined findings with reasons, reported usage or “not exposed,” and whether anything was pushed.

## Written: portable operation and exact receipts

- The active user and repository rules control authority. Reviewing a PR does not itself authorize edits, pushes or comments. In review-only mode, return findings and suggested changes without applying them.
- Use the actual remote and intended target branch. For local or stacked work without a PR, use the merge-base with the caller's intended target; use the remote default only when no other target was specified. This extends the observed local-work rule.
- Use current tool schemas. On T3, perform the source's one capability probe through the host's supported direct/discovery route, even if delegation tools are not yet listed. If the host exposes no permitted route to that probe, or it finds no suitable Sol route, report the blocker. Historical names never authorize inventing a callable tool or bypassing host restrictions.
- Waiting on the host's documented completion/wait primitive is allowed. Repeated status queries are not. Use its supported cancellation route; do not overlap an unconfirmed failed task with a replacement.
- A supported input or documented invariant is within scope even when uncommon. Never downgrade an auth, data-loss or other real intended-behavior failure just because it is rare. Include this qualification in the reviewer brief. Repository severity and test requirements take precedence over Theo's simplified labels and single-test preference.
- Reduce unnecessary diff growth, not a necessary correction. Keep fixes that the task or repository requires.
- Preserve the base SHA and reviewed diff identity in the receipt. New behavior invalidates earlier approval. A later PR rebase needs a fresh comparison; rerun review if the behavior changed or equivalence cannot be established.
- An approved PR receipt may say `Reviewed with sol-loop: N rounds with MODEL. Sol verdict: approved`. Replace N and MODEL with observed values. For an unfinished loop, report the actual outcome to the user; never attach an approval receipt.
- In review-only mode, inspect an existing suitable checkout or the PR's committed diff without changing the user's checkout. Do not switch branches or run mutating checks when the user forbids file changes. One round normally suffices; use another only to resolve a specific open finding within the budget.
- A failed launch is not a completed review round, but repeated identical execution failure is a blocker. Retry once after confirmed cancellation and a concrete recovery step; do not restart indefinitely. A user cancellation stops the loop; cancel an active reviewer through the supported route and report any unconfirmed termination.

No supporting skill is required. This procedure requires Git, the task's checks, and a working Sol delegation route.
