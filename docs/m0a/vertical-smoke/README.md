# First thin vertical smoke (M0b/M0c staging)

The **smallest complete** usable path through Prime's intended workflow, shipped as
checklists + one status script — **before** the full systems exist. It lets a human or a
future agent run one meaningful task end-to-end using only Pi natives + `git` + these
docs, and it is the manual stand-in that each later phase will replace with real tooling.

This is deliberately **not** an implementation of the yolo-fence, worktree manager,
orchestration substrate, `\answer` resolver, or `/ship` — those stay out of M0a
(`../out-of-scope.md`). Each artifact below names the future system it substitutes for.

## The path (run in order)

| Step | Artifact | Stands in for (future) |
| --- | --- | --- |
| 0. See where you are | [`tools/smoke/status.sh`](../../../tools/smoke/status.sh) | configurable status bar (Phase 2) |
| 1. Isolate the work | [`worktree-checklist.md`](./worktree-checklist.md) | worktree manager (Phase 1) |
| 2. Plan, then capture the plan/answer | [`plan-answer-capture.md`](./plan-answer-capture.md) | plan-mode + `\answer` resolver (Phase 2) |
| 3. Get an independent review | [`second-provider-review-handoff.md`](./second-provider-review-handoff.md) | adversarial/multi-team substrate (Phase 3) |
| 4. Gate before the PR | [`pr-gate-checklist.md`](./pr-gate-checklist.md) | `/ship` pre-PR gate chain (Phase 2/M3) |

## Standing rules for the smoke path

- **Security first.** Keep the offline env for any `pi` call that must not egress
  (`PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0`). Never commit secrets, tokens,
  `auth.json`, session URLs, or payloads. See `../provider-and-egress-posture.md`.
- **No-spend by default.** If a step needs a real model, obey the cost policy:
  Phase-3 `no-spend-test` uses only mocks plus metadata-verified OpenRouter `:free`
  models over synthetic/public fixtures. GitHub Copilot is personal/maintainer-profile
  only with a current pinned eligible model; Azure Foundry postponed; no Claude
  live-billing probe (`../provider-and-egress-posture.md`).
- **Objective gate is primary.** A plan/answer/review is advisory; the checkable gate
  (tests / lint / typecheck / `npm run check:resources` / the lockdown smoke) is the
  source of truth.
- **Doc discipline.** Update the relevant markdown in the same change (global contract).

## Quickstart

```sh
tools/smoke/status.sh                 # step 0: context
# step 1: create/enter a worktree per worktree-checklist.md
# step 2: plan; save the distilled plan/answer per plan-answer-capture.md
# step 3: hand off for an independent review per second-provider-review-handoff.md
# step 4: run pr-gate-checklist.md before opening the PR
```
