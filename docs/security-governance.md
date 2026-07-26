# Security and governance baseline

Helix CC applies the smallest complete set of controls that protects source,
dependencies, releases, disclosure, and the default branch without creating
overlapping policy layers. This document is the source of truth for why each
control exists and which system owns it.

## First-principles controls

| Principle | Implemented control | Reason |
|---|---|---|
| Minimize authority | Workflow token permissions are read-only; Actions are limited to GitHub-owned actions and pinned to full commit digests. | A compromised job or mutable tag must not silently gain repository write access. |
| Make one stable merge decision | Linux at the minimum/current Node.js lines, macOS at the minimum line, and dependency review feed the required aggregate `test`; CodeQL is a separate code-scanning rule. | Platform/matrix names and language jobs may change, while the protected-branch contract remains stable and fail-closed. |
| Keep policy layers non-overlapping | Integrity, review, and CodeQL are separate rulesets; classic branch protection is absent. | Each rule has one owner, one bypass model, and one auditable live representation. |
| Require independent evidence | Pull requests require an up-to-date exact-head check, one approval, CODEOWNER review, last-push approval, and resolved conversations. | A green branch or owner assertion is not independent merge evidence. |
| Bound automation | CI jobs have timeouts, superseded runs are cancelled, Renovate never automerges, and major updates require Dashboard approval. | Automation should fail visibly and consume finite resources. |
| Split dependency ownership | Renovate owns routine npm and Actions updates; Dependabot owns advisories and automated security fixes; dependency review rejects vulnerable additions. | One owner per update class prevents duplicate or contradictory remediation. |
| Scan both source and history | CodeQL analyzes Actions and JavaScript/TypeScript; secret scanning and push protection are enabled; public-cutover history was scanned independently. | Prevention, current-state analysis, and retained-history review cover different leak paths. |
| Preserve a private disclosure path | Private vulnerability reporting is enabled and `SECURITY.md` directs reporters to it. | Security reports must not require public disclosure or private credentials in issues. |
| Protect release provenance | Releases are immutable and the repository uses squash-only linear history with deletion and force-push protection. | Published artifacts and review history must remain attributable and resistant to rewriting. |

## Implemented ownership

Tracked policy lives in `.github/workflows/ci.yml`, `.github/rulesets/`,
`.github/CODEOWNERS`, `renovate.json`, `SECURITY.md`, and `CONTRIBUTING.md`.
Repository settings enforce GitHub-owned Actions only, full-SHA pinning,
read-only workflow tokens, immutable releases, the dependency graph, Dependabot
alerts and security updates, secret scanning, push protection, CodeQL default
setup, and private vulnerability reporting.

GitHub Secret Protection features for non-provider patterns and continuous
validity checks are not included in the user-owned GitHub Pro/public-repository
entitlement. Their disabled API fields are an eligibility boundary, not an
unapplied repository control.

The npm manifest intentionally retains `"private": true`. Public GitHub source
does not imply an npm publication contract; the flag prevents accidental
registry publication while installation remains repository-based.

## Change protocol

1. Change the checked-in workflow or ruleset and its governance test together.
2. Validate action ownership and resolve release tags to immutable commit
   digests before updating a workflow reference.
3. Run the complete local gate, dependency audit, registry-signature audit,
   diff check, and secret scan.
4. Open a pull request and require the exact head to pass `test`, dependency
   review, and CodeQL before merge.
5. Apply a live setting only when its prerequisite analysis is successful, then
   read the API state back and compare it with the checked-in policy.

## Deliberate non-controls

- Do not add classic branch protection beside rulesets; it creates a second,
  drifting enforcement layer.
- Do not expand Actions to `all`; add a non-GitHub action only after an explicit
  threat review and allowlist decision.
- Do not add Dependabot version-update configuration while Renovate owns routine
  updates, and do not enable Renovate advisory PRs while Dependabot owns them.
- Do not add a custom CodeQL workflow while default setup supplies the required
  languages and maintenance path.
- Do not add a license denylist, OpenSSF Scorecard workflow, or additional
  third-party security action without a repository-specific policy or finding
  that the control can enforce.
