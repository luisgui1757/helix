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

Start with `/helix` for the dashboard or `/helix-help` for the command guide.

| Command | Purpose |
|---|---|
| `/helix-settings` | Open the interactive feature list |
| `/helix-run` | Preflight and start the no-live mock workflow |
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

Settings, profiles, and run records live under `~/.pi/agent/helix`. Set
`PI_CODING_AGENT_DIR` to move Pi's full agent directory or `HELIX_STATE_DIR` to
move Helix state only. Helix does not require a project `.pi` directory.

In Pi's TUI, `/helix-run` shows the complete preflight and starts only after you
confirm it. Helix currently executes deterministic mock casts only. A cast that names a real
provider fails closed with `live-adapter-not-wired`; it never silently falls back
to a mock or makes an unapproved paid call.

See the [command manual](docs/manual.md) for every command and refusal contract.

## Develop

```sh
npm run check:resources
npm run check:docs-truth
npm test
```

Requires Node.js 22.19 or newer. Licensed under [MIT](LICENSE).
