# Helix CC public-readiness review — 2026-07-20

This is an append-only review ledger. Current repository and live GitHub state
were checked at `e1dae33372552efdce0683d33785c19d747a909e` before the changes
described below.

## Verdict

**PUBLICATION VERDICT: HOLD**

Repository-backed controls and private-compatible GitHub settings can be made
ready now. Publication is blocked by reachable privacy disclosures that require
an explicitly authorized history rewrite, plus security features that GitHub
makes available only after a GitHub Pro user-owned repository becomes public.

## Leak and dependency evidence

- `gitleaks git --log-opts=--all --redact --no-banner --report-format json`
  scanned 33 reachable commits and found no secrets.
- `gitleaks dir . --redact --no-banner --report-format json` found no secrets in
  the working tree.
- Focused tracked-content scans found no private keys, GitHub tokens, AWS access
  keys, OpenAI-style keys, or bearer tokens.
- `npm audit --omit=dev --json` reported zero known vulnerabilities across 149
  installed packages.
- `npm audit signatures` verified registry signatures for all 149 installed
  packages and attestations for 12 packages.
- The current tree and reachable history contain the maintainer's absolute home
  path in an earlier append-only readiness review. Reachable commit metadata
  contains three distinct email identities, including a private-mailbox address
  and a non-noreply address, while the GitHub profile email is hidden.

## Repository-backed controls added

- CI runs the minimum and current Node.js lines, installs with lifecycle scripts
  disabled, audits vulnerabilities and registry signatures, runs the complete
  deterministic gate, and emits one stable required check named `test`.
- Every GitHub Action is pinned to a full commit digest; workflow permissions
  are read-only.
- Checked-in integrity and review rulesets prohibit deletion, force pushes, and
  merge commits; require an up-to-date `test`; require pull-request review,
  CODEOWNER review, last-push approval, and resolved conversations; and give the
  owner only a pull-request-scoped review bypass.
- CODEOWNERS, a pull-request template, `SECURITY.md`, and `CONTRIBUTING.md` define
  the public contribution and disclosure contract.
- Renovate owns weekly npm and GitHub Actions version updates, never automerges,
  keeps action digests pinned, delays new npm releases, maintains the lockfile,
  and gates majors through the Dependency Dashboard. GitHub Dependabot remains
  the single owner of advisory-led security fixes.
- A disabled CodeQL ruleset preserves the intended post-public thresholds:
  errors block correctness findings and high-or-higher security alerts block
  merges.

## Live GitHub baseline before cutover

- Repository visibility: private.
- Branch rulesets and classic branch protection: absent.
- Actions: enabled for all actions; SHA pinning not required; default token
  permission already read-only; pull-request approval disabled.
- Dependency graph and Dependabot alerts: disabled; automated security fixes
  endpoint available.
- Secret scanning, push protection, CodeQL, and private vulnerability reporting:
  unavailable or disabled for the private user-owned repository.
- Immutable releases: disabled.
- Merge policy: merge commits, squash, and rebase all allowed; automatic merge
  and delete-branch-on-merge disabled.

## Publication gate

Do not change visibility until every item below is verified:

1. Authorize and perform a repository-history rewrite that removes the absolute
   local path and replaces non-noreply commit email metadata, then force-push all
   retained branches and tags and delete obsolete remote refs.
2. Repeat whole-history `gitleaks`, private-path, commit-email, and unexpected-ref
   scans against the exact remote object graph.
3. Land the CI/configuration change through a pull request and confirm the exact
   head produces the stable `test` check.
4. Read back the active integrity and review rulesets, merge settings, Actions
   allowlist/SHA enforcement, immutable releases, vulnerability alerts, and
   automated security fixes.
5. Change visibility to public.
6. Enable secret scanning, push protection, CodeQL default setup for Actions and
   JavaScript/TypeScript, and private vulnerability reporting.
7. Wait for the first CodeQL analysis to succeed, activate the checked-in CodeQL
   ruleset, and verify its exact live thresholds.
8. Install or grant the Mend Renovate GitHub App access to this repository,
   confirm the `Renovate dashboard` issue, and verify that no duplicate
   Dependabot version-update configuration exists.
9. Confirm zero open code-scanning, secret-scanning, Dependabot, and repository
   advisory alerts before declaring the repository public-ready.

## Live private-compatible cutover applied

The following controls were applied and read back while the repository remained
private:

- Repository metadata now describes Helix CC and publishes the `claude-code`,
  `coding-agent`, `developer-tools`, `multi-agent`, and `workflows` topics; the
  unused wiki is disabled.
- Merge commits and rebase merges are disabled; squash is the sole merge method;
  automatic merge and delete-branch-on-merge are enabled.
- Actions allow only GitHub-owned actions, require full-SHA pinning, grant the
  workflow token read-only repository access, and cannot approve pull requests.
- Immutable releases are enabled.
- Vulnerability alerts and automated security fixes are enabled. The dependency
  graph reports 149 packages and zero open Dependabot alerts.
- Active rulesets `19186861` and `19186862` match the checked-in integrity and
  review definitions exactly. Classic branch protection remains absent, so no
  overlapping policy layer exists.
- Renovate's four configured labels now exist: `dependencies`,
  `github-actions`, `npm`, and `major`.

The repository remains private. CodeQL default setup still returns GitHub's
private-repository availability error; secret scanning and push protection
remain disabled; private vulnerability reporting is deferred until publication.

The first pushed CI head exposed duplicate private-repository compute: both the
all-branch push trigger and the pull-request trigger scheduled the same matrix.
The workflow was corrected to run pushes only on `main`; feature branches use
the pull-request event, preserving exact-head coverage without duplicate runs.

## Setup supply-chain correction

The audit found that `setup.sh` downloaded and executed Anthropic's mutable
`stable` installer without authenticating the installer bytes. Saving it before
execution avoided a curl-to-shell pipeline but did not establish integrity.
Anthropic documents signed manifests and checksums for versioned binaries, not
an immutable digest contract for the moving installer URL; native installs may
also auto-update. Helix CC therefore no longer downloads or executes that
installer. Setup now fails closed when Claude Code is missing or below the
minimum and points to Anthropic's official installation and integrity guide.

## Authorized privacy history rewrite

The maintainer explicitly authorized the destructive history rewrite on
2026-07-20 after PR #2 had been merged externally. A verified, mode-`0600`
recovery bundle was created outside the repository before any object changed.
`git-filter-repo` 2.47.0 then rewrote 34 of 38 locally fetched commits:

- every occurrence of the absolute maintainer repository path was replaced by
  `/path/to/helix-cc` in text blobs and commit messages;
- non-noreply author and committer addresses were replaced by the maintainer's
  GitHub noreply identity without changing author or committer names; and
- normal remote `main` was force-updated while obsolete remote branch
  `feat/helix-workflow-parity-20260719` was deleted.

The first changed commits reported by the rewrite were
`decba9d2517b7149ab2b608fdfa6f929e2ac4297` and
`e1dae33372552efdce0683d33785c19d747a909e`. All locally fetched refs now have
zero maintainer-home-path hits and zero non-noreply commit identities. The
functional gate, strict plugin validation, dependency audit, registry-signature
audit, object-integrity check, and whole-history and working-tree Gitleaks scans
passed on the rewritten tree.

Both fetched pull-request heads changed during the rewrite. GitHub makes
`refs/pull/1/head` and `refs/pull/2/head` read-only, so their old objects cannot
be force-updated by a repository push. Publication remains **HOLD** until GitHub
Support dereferences those two affected pull requests and removes cached views,
the exact remote object graph is rescanned, Renovate App access is confirmed,
and the visibility-gated security controls in the publication gate are enabled
and read back.

## Post-rewrite remote and dependency-automation revalidation

This append-only follow-up rechecked local and live GitHub state on 2026-07-20
against rewritten `main` at
`5c437a278a13ef65a25d3863b3a442c2f150a895`.

### Remote privacy closure

- Before the current documentation PR was opened, `git ls-remote origin
  refs/heads/main 'refs/pull/*'` advertised only rewritten `main`; no
  pull-request or tag refs remained.
- At that same pre-PR checkpoint, `gh pr list --state all` returned no pull
  requests. The pull-request, commit, file, diff, and patch API surfaces for the
  former pre-rewrite PRs #1 and #2 returned `404`.
- A fresh remote mirror contained one branch, three commits, zero tags, and zero
  pull-request refs; `git fsck --full --no-dangling` was clean.
- Gitleaks 8.30.1 reported zero findings across the complete advertised history
  and the exact tracked tree. Focused scans found zero absolute `/Users/...`
  paths, maintainer-home paths, private-key files or markers, credential-like
  tracked filenames, and non-GitHub commit identities.
- A focused common-token expression produced two apparent matches in
  `docs/history/helix-claude-code-delta.md`. Both were the `sk-` substring formed
  across the ordinary `task-...` URL slug and were rejected as false alarms;
  neither was credential material.

This conclusion covers every ref and pull-request surface GitHub advertises to
repository clients and administrators. GitHub does not expose unreachable
server-side garbage objects for independent enumeration.

After this documentation follow-up was first committed, GitHub assigned its new
clean pull request number #1, reusing the number removed with the former PR
record. The new `refs/pull/1/head` resolves to the post-rewrite documentation
commit and its synthetic merge ref combines only that commit with rewritten
`main`; both new refs are included in the final remote scan.

### CI, dependencies, and live governance

- Exact-head GitHub Actions run `29716148700` passed the Node.js 22.19 and 26
  matrix plus the stable aggregate `test`. A separate local run passed all 140
  tests and strict Claude plugin validation.
- `npm audit --omit=dev` reported zero vulnerabilities across 149 installed
  packages. Registry signatures verified for all 149 packages and attestations
  verified for 12 packages.
- The pinned `actions/checkout` `v7.0.0` and `actions/setup-node` `v6.4.0`
  digests resolved to their official release tags.
- Live rulesets `19189587` and `19189588` semantically match the checked-in
  integrity and review definitions. Classic branch protection remains absent.
- Actions allow only GitHub-owned actions, require full-SHA pinning, use a
  read-only default token, and cannot approve pull requests. Immutable releases
  remain enabled.
- The dependency graph exports 151 SBOM packages. Dependabot alerts and
  automated security fixes are enabled, with zero open alerts.
- Renovate 43.272.0 strictly validated `renovate.json`; all configured labels
  exist. The maintainer reports that the Mend Renovate App now has repository
  access, but a bot-authored `Renovate dashboard` has not yet been observed and
  remains the required operational proof.
- `@jeffreycao/copilot-api` `1.14.14` is newer than the repository's exact
  `1.14.9` pin. The current pin has no known vulnerability and is deliberately
  bound to source, integrity, and patch-target evidence, so its first Renovate
  update must remain non-automerged and coordinated with those bindings.

### Current publication boundary

The pre-rewrite pull-request-ref blocker is closed. Publication remains
**HOLD** until the Renovate Dashboard is observed and this documentation update
lands through the protected pull-request workflow. After visibility changes,
secret scanning, push protection, CodeQL default setup, private vulnerability
reporting, the active CodeQL ruleset, and zero open security alerts must all be
read back before declaring **PUBLICATION READY**.

## Renovate first-run failure and OSV feed correction

After the Mend Renovate App received repository access, the maintainer reported
that its first job failed without creating a GitHub issue, pull request, commit
status, or check. The private hosted error log was not available through GitHub.
Renovate 43.272.0 nevertheless reproduced the same failed-run condition in a
full dry run against exact remote `main` at
`5c437a278a13ef65a25d3863b3a442c2f150a895`:

- npm and GitHub Actions extraction and update lookup completed, including the
  pending Copilot adapter update and lockfile maintenance branch;
- Dashboard generation then terminated with `Repository has unknown error`
  because `dependencyDashboardOSVVulnerabilitySummary: "all"` requested
  `https://github.com/renovatebot/osv-offline/releases/latest/download/osv-offline.zip`,
  which returned `404`; and
- the upstream repository's releases API returned an empty list at the same
  checkpoint, so retrying the unchanged configuration could not remove the
  dependency on the missing asset.

The OSV summary is an optional Dashboard display feed and defaults to disabled.
It is not Helix CC's advisory-remediation owner: `vulnerabilityAlerts.enabled`
already prevents Renovate security PRs, while GitHub Dependabot alerts and
automated security fixes are enabled and have zero open alerts. The repository
therefore removed only `dependencyDashboardOSVVulnerabilitySummary`, matching
the existing dotfiles and Helix Renovate configurations while preserving the
Dashboard, weekly npm and Actions updates, action digest pinning, lockfile
maintenance, and manual review. The governance test now prevents that redundant
advisory feed from being restored accidentally.

The plausible transient-outage alternative was then checked explicitly. At
`2026-07-20T05:12:50Z`, the upstream project published release
`1-2026072005`; the formerly failing URL began redirecting to its
`osv-offline.zip` asset, and an unchanged-main dry run then completed. This
confirms that the 404 window was upstream release availability, not a schema or
dependency-extraction defect. Separately, a full dry run loaded the corrected
file as the effective configuration while ignoring stale `main` repository
configuration: it exited zero with repository result `done`, planned the
Dashboard and routine updates, and made no OSV database request. The durable
correction therefore removes a redundant external failure dependency rather
than masking a repository update error.

Publication remains **HOLD** until the corrected bot run succeeds and creates
the `Renovate dashboard`; the hosted operational result is not inferred from
local schema validation alone.

## Public cutover and gold-standard convergence — 2026-07-21

The remaining publication gates were revalidated and closed against remote
`main` at `07046119c8ee966892cb9039e934839a91bca0e0` before visibility changed.
The prior **HOLD** verdict is superseded: the live repository is
**PUBLICATION READY**, while the tracked convergence change remains subject to
its normal pull-request review and merge authority.

### Final pre-publication privacy gate

- A new remote mirror fetched every advertised branch, tag, and pull-request
  head. It contained eight reachable commits: rewritten `main` plus the clean
  post-rewrite PR #1 head, with no tags or unexpected branches.
- `git fsck --full --strict` passed and Gitleaks scanned all eight commits with
  zero findings.
- Exact `/Users/luisribeiro` and `/home/luisribeiro` history searches returned
  zero hits. The only author and committer identities were the maintainer's
  GitHub noreply identity and GitHub's own noreply identity.
- The repository was then changed from private to public. The immediate API
  readback returned `visibility: public` and `private: false`.

### Public-only controls and analyses

- Secret scanning and push protection are enabled; private vulnerability
  reporting returns `enabled: true`.
- CodeQL default setup is configured with the default query suite and weekly
  schedule. Run `29797378509` succeeded on exact `main`: `Analyze (actions)` and
  `Analyze (javascript-typescript)` both completed successfully.
- The two main-branch CodeQL analyses reported zero results and no errors. Only
  after that proof, active ruleset `19321579` was created from the checked-in
  definition. It has no bypass and blocks CodeQL correctness alerts at `errors`
  and security alerts at `high_or_higher`.
- Open code-scanning, secret-scanning, and Dependabot alert counts are zero;
  published repository security advisories are also zero.
- Secret-scanning validity checks and non-provider patterns remain disabled.
  They require GitHub Secret Protection or an eligible organization-owned Team
  repository and are not available to this user-owned GitHub Pro repository.

### Live governance and automation readback

- Active rulesets are integrity `19189587`, review `19189588`, and CodeQL
  `19321579`. Classic `main` branch protection returns `404`, so there is no
  duplicate policy layer.
- Actions allow only GitHub-owned actions, reject mutable action references,
  use read-only default tokens, and cannot approve pull-request reviews.
- Squash remains the only merge method; automatic merge and merged-branch
  deletion are enabled. Immutable releases remain enabled.
- The dependency graph exports 151 SBOM packages. Dependabot security updates
  are enabled and the open alert count is zero.
- Issue #2 is an open `Renovate dashboard` authored by `app/renovate`, closing
  the remaining bot-operational proof.

### First-principles policy shipped in the convergence change

- Dependency review rejects vulnerable packages introduced by a pull request
  and feeds the existing stable `test` gate alongside the complete Node.js
  matrix. Main pushes preserve the same aggregate identity without pretending
  to have a pull-request dependency delta.
- Every CI job has a bounded timeout and superseded branch/PR runs are cancelled.
  All actions remain GitHub-owned and pinned to full release-tag commit digests.
- The checked-in CodeQL ruleset is active and governance tests bind its live
  thresholds, action inventory, dependency-review wiring, concurrency, timeouts,
  and fail-closed aggregate results.
- `docs/security-governance.md` records the durable control ownership and change
  protocol. `package.json` deliberately remains `private: true`: GitHub source
  visibility does not grant or imply npm registry publication.

The comparison repositories informed the control selection but were not copied
blindly. Helix CC does not add dotfiles' overlapping classic branch protection
or broad `allowed_actions: all`; it does not add duplicate Dependabot routine
version updates beside Renovate; and it does not add Scorecard, a license
denylist, a custom CodeQL workflow, or another third-party security action
without a repository-specific policy or finding for that control to enforce.
