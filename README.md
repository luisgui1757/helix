# Helix

Helix adds typed, multi-model workflows to [Pi](https://pi.dev). A single
provider-neutral kernel runs guided, imported, and programmatically generated
workflows with bounded loops, deterministic objective gates, exact casts,
isolated Git worktrees, crash-safe checkpoints, and planned/observed graphs.

## Install

Install a supported Pi release, configure or sync your providers in Pi, then
install Helix:

```sh
npm install -g @earendil-works/pi-coding-agent@">=0.80.7 <0.81.0"
pi install git:github.com/luisgui1757/helix
pi
```

Helix never logs in to, chooses, or silently substitutes a provider. The first
cold Pi startup offers a four-step onboarding tour; `/helix-onboarding` reopens
it at any time. For checkout development, use `pi -e .`.

## Use

| Command | Purpose |
|---|---|
| `/helix-help` | First steps and refusal guidance |
| `/helix-onboarding` | Rerun the getting-started tour |
| `/helix-run [workflow] -- <task>` | Confirm and start an exact workflow |
| `/helix-workflows` | List, show, graph, and test workflows |
| `/helix-workflows import <file.json>` | Validate and atomically deploy v4 JSON |
| `/helix-workflow-create` | Guided template-based workflow builder |
| `/helix-workflow-edit`, `-clone`, `-delete` | Manage personal workflows |
| `/helix-runs`, `/helix-run-watch <id>` | Inspect structural run progress |
| `/helix-run-resume <id>` | Revalidate and resume a private checkpoint |
| `/helix-settings`, `/helix-profiles`, `/helix-setup` | Configure features and casts |

Before execution, Helix displays the task, workflow graph, objective gate,
repository, deadlines, and every resolved role/provider/model/effort/instance
tuple. Declared typed inputs are collected and validated before run creation;
consent shows their names without exposing values. Named workflows require the
canonical per-run worktree policy and refuse before consent when worktrees are
disabled. The binding is rechecked before run-directory, worktree, or provider
effects. A real path whose model, effort, route, account, or certification
cannot be proven is exact-disabled; it never degrades to a session default,
mock, alternate provider, or fallback route.

The executable exact real-provider path is currently OpenRouter: attended
preflight must find one active ZDR, tool-capable route for the configured model,
bind Pi's configured account, and verify every streamed response through a
session-local audit proxy. Other provider families remain visibly
exact-disabled until their official surfaces satisfy the same proof contract.

The guided builder covers the common implement/review, plan/implement, and TDD
loops. Advanced users create the same closed WorkflowDefinition v4 with the
pure helpers in `dispatch/workflow/builder.mjs`, write the resulting JSON, and
deploy it with `/helix-workflows import`. Helix executes data, never the builder
program or arbitrary workflow JavaScript.

The kernel supports agent, pipeline, bounded parallel/map, reduce, decision,
gate, checkpoint, version-pinned subworkflow, and terminal nodes. Successful
completion is reachable only through one final deterministic objective gate;
its `on_pass` is the successful terminal's only incoming edge, and it executes
the single top-level objective definition.
Read-only effects may overlap; shared writers serialize; isolated proposals run
in disposable Git worktrees and promote only from an unchanged base. Every
actual model invocation—including each panel member and retry—consumes one
journaled effect. Recovery snapshots remain retained until the workspace,
journal, scheduler checkpoint, and post-commit cleanup are durably complete.

Run records contain structural events and hashes. Raw tasks remain in memory;
private scheduler checkpoints and bounded workspace snapshots live below
`~/.pi/agent/helix/private`. Resume requires the original task plus fresh
workflow, cast, policy, account, and runtime validation. A Git worktree protects
Git state, but it is not an OS sandbox.

Helix adds no percentage-based compaction trigger. Each runtime keeps its native
default compaction behavior.

See [the manual](docs/manual.md), [workflow guide](docs/workflows.md),
[provider truth table](docs/providers.md), and
[architecture](docs/architecture.md).

## Verify

```sh
npm test
npm run check:resources
npm run check:docs-truth
npm run check:no-live-egress
npm run check:workflow-conformance
npm run check:provider-contracts
npm run check:package
```

Active no-egress and opt-in live-provider certification are documented in the
manual. Requires Node.js 22.19 or newer. Licensed under [MIT](LICENSE).
