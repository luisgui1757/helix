# Security and governance baseline

The product is four portable skills. Repository governance is maintained
separately.

| Control | Owner and purpose |
|---|---|
| Stable required `test` | Package/governance tests on Linux and macOS plus dependency review feed one fail-closed aggregate. |
| Integrity ruleset | Requires an up-to-date check, linear history, and protection from deletion and force-push; no bypass. |
| Review ruleset | Requires independent approval, CODEOWNER review, last-push approval, and resolved conversations. Owner bypass is pull-request-only. |
| CodeQL ruleset | Keeps the separate code-scanning gate and thresholds. |
| GitHub Actions | Read-only tokens, full-digest GitHub-owned action pins, bounded jobs, cancellation of superseded runs. |
| Dependency maintenance | Renovate owns GitHub Actions updates without automerge. Dependency review remains to reject vulnerable additions; there are no npm dependencies. |
| Disclosure and provenance | Private reporting, secret scanning/push protection, and immutable releases remain repository settings. |

Tracked policy lives in `.github/workflows/ci.yml`, `.github/rulesets/`,
`.github/CODEOWNERS`, and `renovate.json`. The settings documented in the
[public-readiness ledger](https://github.com/luisgui1757/helix-cc/blob/d28d81aa481b9363862ab6aefb8732c2f190bd17/docs/reviews/helix-cc-public-readiness-2026-07-20.md) are
historical live evidence, not a fresh settings certification.

## Change protocol

1. Update relevant documentation and maintenance checks with the behavior.
2. Preserve action ownership and full commit pins when changing CI.
3. Run `node --test tests/*.test.mjs`, `git diff --check`, and a secret scan.
4. Run affected [behavioral scenarios](../evals/scenarios.md) before promoting
   a skill behavior. Keep live model use out of unattended CI.
5. Open a pull request and require the exact head's checks and reviews before
   merge. Do not change live policies or bypass gates to finish a migration.

The migration removed both npm manifests and all npm dependencies, so CI no
longer runs npm install, audit, or signature checks. The existing
Node matrix remains for repository maintenance tests; users need no Node
runtime to install the skills. This is not evidence that the retired engine's
advisories were fixed. Its source and historical results remain in Git.

No new package publication, hosted service, automatic release, additional
security service, or duplicate branch protection is introduced.
