# Contributing

Helix requires Node.js 22.19 or newer. Load a checkout in Pi with `pi -e .`.

Before changing behavior, identify the source of truth and add a focused
regression test. Keep policy in `dispatch/lib/`, Pi-specific UI in `extensions/`,
and mutable state outside the package root. A new user-facing capability needs a
dedicated namespaced command, completion where arguments are enumerable, help and
manual coverage, and a narrow-terminal rendering test.

Run the full local gate before opening a pull request:

```sh
npm run check:repository-policy
npm run check:resources
npm run check:docs-truth
npm run check:no-live-egress
npm test
```

GitHub protects `main` with three separate checked-in
[`integrity`](.github/rulesets/main-integrity.json) and
[`review`](.github/rulesets/main-review.json) rulesets plus an
[`owner updates`](.github/rulesets/main-owner-updates.json) restriction. The
Node/Pi matrix and dependency review feed one stable required check named
`test`; do not require the component job names directly or add overlapping
classic branch protection. Integrity rules have no bypass actors. Normal
merges require one fresh code-owner approval and resolved conversations, while
the repository owner is the sole pull-request-only bypass actor for review and
updates. An owner merge therefore still requires a pull request, successful
exact-head `test` and CodeQL evidence, but does not require self-approval.

Routine dependency updates have one owner: Renovate. GitHub-native Dependabot
remains enabled for vulnerability alerts and security updates. Repository
policy and the safe live apply/recovery process are documented in
[`docs/GOVERNANCE.md`](docs/GOVERNANCE.md).

Code, behavior, and architecture changes must update the relevant Markdown in
the same change. Do not weaken checks, hide unsupported behavior behind a mock,
or commit credentials, transcripts, provider payloads, or private paths.
