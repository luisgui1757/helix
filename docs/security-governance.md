# Repository governance

| Control | Requirement |
|---|---|
| Required `test` | Linux/macOS package tests and dependency review feed a fail-closed aggregate. |
| Integrity ruleset | Up-to-date checks, linear history, no deletion or force-push, no bypass. |
| Review ruleset | Independent approval, CODEOWNER review, last-push approval and resolved conversations. Owner bypass is PR-only. |
| CodeQL ruleset | Code-scanning gate with configured severity thresholds. |
| GitHub Actions | Read-only tokens, full-commit action pins, bounded jobs and cancellation of superseded runs. |
| Dependency maintenance | Renovate updates actions without automerge. Dependency review checks additions. |

Policies live in `.github/workflows/ci.yml`, `.github/rulesets/`,
`.github/CODEOWNERS` and `renovate.json`. Check live repository settings before
claiming those policies are enforced. A checked-in policy is not runtime proof.

Update documentation and tests with behavior changes. Run the
[maintenance checks](../CONTRIBUTING.md#checks) and affected
[behavioral scenarios](../evals/scenarios.md). Keep live model use out of CI.
The exact PR head needs passing checks and required approvals before merge.
Do not weaken policies or use bypasses to finish a skill change.

The collection has no package dependencies. Node is needed only for maintenance
checks and the optional model-discovery helper.
