# Whole-repository audit remediation — 2026-07-26

This is the append-only closure ledger for the independent Claude Opus
whole-repository review of public `main` at
`34f1d51fa47edaf75212834c13f5ec5483afda3b`. The review returned **HOLD** with
0 P0, 1 P1, 3 P2, and 4 P3 findings. This document records the accepted fixes;
it does not replace the original review transcript or promote historical
provider evidence.

## Accepted findings and closure

| Finding | Closure |
|---|---|
| P1: bare `claudex` failed on stock macOS Bash 3.2 | Empty-array forwarding now uses a Bash-3.2-safe expansion. Bare native, explicit native, and provider/model fallback paths have subprocess coverage that explicitly invokes `/bin/bash` on macOS; CI includes `macos-latest` at the Node.js floor. |
| P2: model-selected argv could execute before verifier rejection | `start_session` now requires one closed authorization for command, TDD, or pre-PR effects. `capture_baseline`, `reproduce_red`, `run_command`, `verify_pre_pr`, and `ship_pre_pr` compare their complete normalized effect contract before repository inspection, command execution, fetch, commit, push, or PR creation. Hostile-sentinel and zero-invocation tests prove preventive refusal. |
| P2: route/status evidence cited objects removed by the privacy rewrite | Current route tables now classify those receipts as `Historical evidence`; `STATUS.md` explains why pre-publication labels no longer resolve and requires fresh proof at a resolvable revision for current health. No route was promoted by this change. |
| P2: troubleshooting falsely said setup installs Claude Code | The HOW-TO now directs users to Anthropic's separate official installer and states that setup refuses missing/outdated Claude Code without executing a remote installer. |
| P3: branch, merge, and publication text was stale | `STATUS.md`, `graph-migration.md`, and `SECURITY.md` now record the completed PR/publication state. |
| P3: TDD copied the working tree without a size ceiling | The disposable copy has a 1 GiB cumulative regular-file limit and a typed refusal naming the first path over the bound. |
| P3: a post-commit shipping failure leaves a local commit | The behavior remains deliberately non-rollback because a push may already have taken effect; workflow/skill/agent documentation and a real-Git push-failure regression now state and prove it. |

## Review corrections and preserved boundaries

- Test adequacy at the reviewed revision was `HOLD`, not `READY with a gap`:
  the documented front door failed on a supported platform and no test reached
  that path.
- Preventive authorization was applied to every effect-bearing service method,
  not only `reproduce_red` and `run_command`; preflight fetch and shipment
  effects are covered by the same session contract.
- TDD isolation remains cwd/environment redirection, not an operating-system
  sandbox. Absolute-path writes outside the repository and redirected process
  directories are not contained, and current documentation says so.
- No architecture rewrite was warranted. The signed receipt, capability-limited
  roles, deterministic gates, provider attestation, and original/graph parity
  design remain intact.

## Pre-commit verification

| Check | Result |
|---|---|
| `npm run verify` | Passed: graph artifacts current, plugin structure valid, 188/188 default tests passed, 45/45 graph-mode regressions passed, and strict Claude plugin validation passed. |
| `npm audit --omit=dev` | Passed: zero known vulnerabilities. |
| `npm audit signatures` | Passed: 155 registry signatures and 14 attestations verified. |
| `gitleaks detect --no-git` | Passed: no tracked/working-tree leak found. |
| `gitleaks detect` | Passed: no leak found across seven reachable commits. |
| `git diff --check` | Passed. |

Live provider receipts, a provider-backed graph-mode run, and WSL execution
remain separate evidence gaps. The route tables intentionally keep the affected
provider states historical until fresh receipts exist.

## Post-push review

The first pushed candidate was `b5df5883e6f95ee2d1fa73990a93dfb56b5fb89c`.
The post-push source, contract, and documentation review found one truth-label
issue: historical installed/provider rows still used plain `Passed` inside the
current verification ledger even though the surrounding disclaimer was
correct. Those rows now say `Historical pass` and use `pre-rewrite production
label` or `historical fixture HEAD`. No code or authorization-boundary defect
was found. The single feature-branch commit was amended and re-verified before
the pull request was opened.

One post-review full-suite run under exceptional concurrent subprocess load
missed the existing three-second `active-proof children were not reported`
test boundary. The unchanged production-lifecycle suite then passed 8/8 in
isolation, including `active-proof` in 724 ms, and the complete `npm run verify`
rerun passed 188/188 plus 45/45. Because this change does not touch lifecycle
code and the focused plus full reproductions were green, the isolated timing
miss is recorded as a rejected regression candidate rather than hidden or used
as acceptance evidence.
