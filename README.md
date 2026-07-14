# Helix

Helix adds native multi-model workflow controls to [Pi](https://pi.dev). It gives
each capability its own slash command, keeps risky changes attended, and stores
only structural run metadata.

## Install

Install Pi first:

```sh
npm install -g @earendil-works/pi-coding-agent
```

Then install Helix through Pi's package manager:

```sh
pi install git:github.com/luisgui1757/helix
```

Before using Helix, configure or sync the providers you want in Pi. Helix uses
Pi's already available models; it does not log in, choose, or configure
providers.

This is the same package mechanism used by the [Pi package
catalog](https://pi.dev/packages). Start Pi and open Helix:

```sh
pi
```

```text
/helix-help
```

For local development, load the checkout without installing it:

```sh
pi -e .
```

## Use

On the first cold Pi startup, Helix offers a compact four-step tour. Choose
**Later** to see it again at the next startup, or **Don't show again** to hide
it. Run `/helix-onboarding` whenever you want to reopen it.

Start with `/helix` for the dashboard or `/helix-help` for the command guide.

| Command | Purpose |
|---|---|
| `/helix-onboarding` | Rerun the getting-started tour |
| `/helix-settings` | Open the interactive feature list |
| `/helix-run [workflow] -- <task>` | Preflight and start a named workflow |
| `/helix-workflows` | List, inspect, and test named workflows |
| `/helix-workflow-create` | Build a workflow from stages and transitions |
| `/helix-runs` | List structural run records |
| `/helix-run-watch <id>` | Follow run progress |
| `/helix-models` | See Pi models and Helix casts |
| `/helix-chains` | See workflow chains |
| `/helix-profiles` | Manage saved casts |
| `/helix-setup` | Configure a cast |
| `/helix-research …` | Validate an attended research run |

`/helix-settings` is keyboard-native: use ↑/↓ to move, Enter or Space to
toggle, and Esc to close.

```text
[x] Multi-model
[x] Loops
[x] Autoresearch
[x] Context engine
[x] Worktrees
[x] Visual cues
```

The onboarding marker, settings, profiles, workflows, and run records live under
`~/.pi/agent/helix`. Set `PI_CODING_AGENT_DIR` to move Pi's full agent directory
or `HELIX_STATE_DIR` to move Helix state only. Helix needs no project `.pi` directory.

Before using a real cast, configure or sign in to the provider in Pi. Provider
selection and credentials are Pi's concern: Helix consumes only exact
provider/model entries that Pi reports as configured and available. OpenRouter
free models and any other configured Pi provider follow the same path.

In Pi's TUI, `/helix-run` shows the workflow, stage panel, exact cast, pass and
time rails, task, repository, and worktree setting before it starts. Mock casts
remain deterministic. Real casts create fresh in-process Pi agent sessions; no
real cast silently falls back to mock, while partially configured casts route
their remaining mock members to the deterministic adapter. The confirmed
workflow/profile/toggle/preset binding is rechecked before any run directory or
provider call. A Git worktree protects repository state, but it is not an OS
sandbox and Pi tools keep their normal trust boundary.

`/helix-workflow-create` starts with a safe template, then lets you add, remove,
or reorder stages; edit durable outputs and candidate-role panels; choose verdict, gate, or always
conditions; route to advance, retry, an earlier stage, or stop; and configure
casts, concurrency, objective gate, pass ceilings, and time
ceilings. `/helix-workflows test <id>` exercises every transition and retry
ceiling without provider calls, validates the deployment projection and every
stage output, then proves the success path. Named workflows currently run only
in the confirmed current repository. Every stage retains a planner or builder
and a safe declared durable output outside `.git`; at least one output is the
objective-gate file.

The exact task stays in memory and only its hash is bound into structural run
state. Task-bound Pi workflow resume is explicitly unsupported for now; start a
fresh attended run instead of using a config-only legacy resume command.

See the [command manual](docs/manual.md) for every command and refusal contract.

## Develop

```sh
npm run check:resources
npm run check:docs-truth
npm test
```

Requires Node.js 22.19 or newer. Licensed under [MIT](LICENSE).
