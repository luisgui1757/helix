# Contributing

Helix CC requires Node.js 22.19.0 or newer and a supported Claude Code
installation.

Install the exact dependency graph without lifecycle scripts:

```sh
npm ci --ignore-scripts --include=optional
```

Before changing behavior, identify its source of truth and add a focused
regression test. Keep provider policy and lifecycle logic in `lib/`, executable
entrypoints in `bin/`, audited workflows in `workflows/`, and machine-local
state outside the repository. Update the relevant Markdown whenever code,
behavior, architecture, configuration, or a readiness claim changes.

Run the full local gate before opening a pull request:

```sh
npm run verify
npm audit --omit=dev
npm audit signatures
git diff --check
```

Provider proof commands and live Workflow runs are separate because they use
the selected external provider and local account state.

GitHub protects `main` with separate checked-in
[`integrity`](.github/rulesets/main-integrity.json) and
[`review`](.github/rulesets/main-review.json) rulesets. The Node.js matrix feeds
one stable required check named `test`; do not require matrix job names or add
overlapping classic branch protection. Integrity rules have no bypass. Normal
merges require an independent approval, CODEOWNER review, last-push approval,
and resolved conversations. The repository owner is the sole
pull-request-only bypass actor for the review ruleset, so owner updates still
require a pull request and a successful exact-head `test` check.

The disabled
[`CodeQL ruleset`](.github/rulesets/main-codeql-public.json) is activated only
after publication, CodeQL default setup succeeds, and its live check identity is
confirmed. Do not enable it while the repository is private and CodeQL is
unavailable.

Do not weaken checks, add unpinned GitHub Actions, enable workflow write
permissions, hide unsupported behavior behind a mock, or commit credentials,
transcripts, provider payloads, private paths, or machine-local state.
