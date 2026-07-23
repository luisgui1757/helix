# Repository governance

Helix treats checked-in policy, live GitHub enforcement, and exact-head proof as
three distinct requirements. A green source-tree test does not prove that live
settings match, and a successful API request does not prove the resulting
state.

## Canonical sources

- `.github/rulesets/main-integrity.json` owns unbypassable merge integrity.
- `.github/rulesets/main-review.json` owns review semantics.
- `.github/rulesets/main-owner-updates.json` restricts default-branch updates.
- `.github/settings.yml` declares non-branch repository settings only.
- `.github/workflows/ci.yml` emits the single required `test` objective after
  the Node/Pi matrix and dependency review both succeed. Its ephemeral Ubuntu
  24.04 jobs explicitly enable Canonical's documented one-boot unprivileged
  user-namespace boundary and prove `unshare` before exercising the real Linux
  objective-gate sandbox; sandbox unavailability is a failed matrix, not a
  skip.
- `renovate.json` owns routine version updates. GitHub-native Dependabot owns
  vulnerability alerts and security updates.
- `.gitleaks.toml` extends the current built-in detector set and records only
  exact, documented false-positive exceptions.
- `tools/repository-policy-check.mjs` validates the checked-in sources.
- `scripts/apply-repo-safeguards.mjs` is the sole live policy apply and recovery
  path.

Classic branch protection must be absent. Rulesets are the only branch-policy
source; overlapping mechanisms can create stale contexts and an effective
policy described by neither checked-in source.

## Required live state

| Boundary | Required state |
| --- | --- |
| Integrity | Pull request, strict GitHub Actions `test`, CodeQL errors and high-or-higher security alerts, linear history, no deletion, no non-fast-forward; no bypass actors |
| Review | One fresh code-owner approval, last-push approval, resolved threads, squash only; owner bypass only in `pull_request` mode |
| Updates | Only the repository owner may bypass the update restriction, and only through a pull request |
| Actions | Selected GitHub-owned Actions only, full commit SHA required, default token read-only, Actions cannot approve reviews |
| Security | Secret scanning, push protection, vulnerability alerts, automated security fixes, private vulnerability reporting, and weekly CodeQL default setup for Actions and JavaScript/TypeScript |
| Releases | Future releases immutable |
| Merge methods | Squash only, auto-merge disabled, merged branches deleted |

CodeQL default setup is GitHub-managed and therefore has no checked-in workflow.
The effective proof is a configured default-setup API response plus a successful
CodeQL analysis for the exact default-branch commit. The code-scanning ruleset
gate is applied only after that proof exists.

## Dependency policy

One automation owns each responsibility:

- Renovate opens routine version-update pull requests, keeps GitHub Actions
  digest-pinned, maintains lock files, and tracks the newest Pi release inside
  Helix's declared `>=0.80.7 <0.81.0` compatibility line.
- GitHub-native Dependabot provides the advisory feed and security updates.
- Major or compatibility-boundary changes remain human-reviewed; automerge is
  disabled.

The compatibility floor in CI is deliberate. Renovate updates only the newest
supported Pi matrix entry, never the floor or the package's support contract.

## Verification and live apply

Repository-source checks are part of the normal gate:

```sh
npm run check:repository-policy
npm test
```

Live changes occur only from a clean `main` checkout whose `HEAD` exactly equals
GitHub's current `main`. CodeQL and the required `test` objective must both have
successful evidence for that exact commit:

```sh
npm run safeguards:preflight
npm run safeguards
```

Immediately before the first write, the safeguard tool re-reads live state and
refuses concurrent drift. It then applies every declared control and reads the
effective API state back.

## Recovery

Before mutation, the safeguard tool writes a mode-`0400` JSON snapshot and
SHA-256 sidecar below the repository's private Git metadata. A failed apply
automatically restores and verifies that in-memory snapshot. Retain the printed
path until postflight succeeds. Explicit recovery is:

```sh
npm run safeguards -- --restore /absolute/path/to/snapshot.json
```

Manual recovery validates the snapshot location, file type, permissions,
digest, closed schema, repository identity, and exact live-main binding before
the first restore write. If recovery fails, stop all other policy mutations and
use the retained snapshot; do not improvise partial settings in the GitHub UI.
