# Contributing

Helix requires Node.js 22.19 or newer. Load a checkout in Pi with `pi -e .`.

Before changing behavior, identify the source of truth and add a focused
regression test. Keep policy in `dispatch/lib/`, Pi-specific UI in `extensions/`,
and mutable state outside the package root. A new user-facing capability needs a
dedicated namespaced command, completion where arguments are enumerable, help and
manual coverage, and a narrow-terminal rendering test.

Run the full local gate before opening a pull request:

```sh
npm run check:resources
npm run check:docs-truth
npm run check:no-live-egress
npm test
```

Code, behavior, and architecture changes must update the relevant Markdown in
the same change. Do not weaken checks, hide unsupported behavior behind a mock,
or commit credentials, transcripts, provider payloads, or private paths.
