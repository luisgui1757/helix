# Helix command manual

Helix is a Pi extension package. Its commands inspect or mutate Helix state; they
do not ask the active model to interpret a pseudo-command.

## Install and open

```sh
npm install -g @earendil-works/pi-coding-agent
pi install git:github.com/luisgui1757/helix
pi
```

Run `/helix-help` after installation. Run `/helix` at any time to return to the
dashboard.

## Commands

### `/helix`

Shows the active config, cast, feature toggles, live-transport status, and latest
structural runs. The older `/helix <verb>` form remains compatible, but dedicated
commands are the primary interface.

### `/helix-help`

Shows install guidance, the native command map, the live-transport boundary, and
the next safe action for refusals. It is view-only and does not load mutable
state.

### `/helix-run [config-id]`

Preflights a tracked workflow config. It resolves the chain, active profile,
cast, feature toggles, concurrency rail, and objective gate. In Pi's TUI, Helix
then asks for confirmation and runs the packaged deterministic mock workflow in
an isolated synthetic repository. Non-interactive modes stop after preflight.
Real-provider casts refuse with `live-adapter-not-wired` before execution.

### `/helix-runs`

Lists structural run records. Prompts, responses, provider payloads, private code,
and credentials are never rendered or persisted by this surface.

### `/helix-run-status <run-id>`

Shows one run's structural state and gate outcome.

### `/helix-run-watch <run-id>`

Renders the run's event stream as a compact progress view.

### `/helix-run-resume <run-id>`

Validates whether an interrupted run is resumable and prints the bound resume
invocation. Completed, malformed, mismatched, and unsafe records refuse.

### `/helix-run-prune <run-id>`

Deletes one structural run directory after an attended confirmation. RPC and
print modes cannot authorize deletion.

### `/helix-models`

Shows Pi's currently available models alongside Helix's composite cast presets.
Provider/model entries are validated against Pi's inventory before they can be
saved.

### `/helix-chains`

Shows tracked workflow chains, stages, handoff artifacts, and whether each chain
is runnable by the loop engine.

### `/helix-settings [<feature> on|off]`

With no arguments, opens the native checkbox interface:

```text
[x] Multi-model
[x] Loops
[x] Autoresearch
[x] Context engine
[x] Worktrees
[x] Visual cues
```

Use ↑/↓ to move, Enter or Space to toggle, and Esc to close. Changes save
immediately because each toggle is local and reversible. An explicit command is
also available, for example `/helix-settings loops off`.

### `/helix-profiles [show <id> | switch <id> | create <id>]`

Lists, inspects, activates, or creates saved casts. Create and switch operations
require attended confirmation.

### `/helix-setup [profile assignments…]`

With no arguments, shows profiles, stages, presets, and Pi's available model
inventory. Assign a preset or model to a stage:

```text
/helix-setup deep-work plan=overlord implement=openai-codex/gpt-5:high
```

Composite members use `<preset>.<role>=<provider>/<model>[:effort][*instances]`.
Helix validates the complete change before atomically saving and activating the
profile.

### `/helix-research <question> --metric <name> <cmp> <target> --max <n> [--plateau <n>]`

Validates an attended research specification and prints the deterministic runner
invocation. A metric, comparison target, and iteration cap are mandatory. The
command refuses when Autoresearch is disabled or the session is unattended.

## State and safety

Helix writes `settings.json`, `profiles/`, and `runs/` under
`~/.pi/agent/helix`. `PI_CODING_AGENT_DIR` changes Pi's agent directory;
`HELIX_STATE_DIR` overrides only the Helix state root.

Run launch plus mutating profile, setup, and prune commands require an attended
Pi confirmation. Settings toggles save directly from the checkbox interface. All malformed,
unsafe, unavailable, or unsupported inputs fail closed with a stable code,
reason, and next safe action.

The fence and answer-capture extensions remain independent of command state.
Helix ships no skill, theme, project settings file, provider credentials, or
telemetry override.
