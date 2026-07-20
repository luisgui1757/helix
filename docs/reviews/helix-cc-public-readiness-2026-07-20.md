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
