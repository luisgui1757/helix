# Helix Pi Resources

Status: Helix resource package plus Stage 3P whole-repo gap closure notes, 2026-07-09.

Helix now ships the project-owned Pi resource surface directly in this repo:

- One skill: `helix-ui`
- Three themes: `helix-rose-pine`, `helix-rose-pine-moon`,
  `helix-rose-pine-dawn`
- Three extensions: `helix-fence`, `helix-answer`, and `helix-command`

The package manifest intentionally exposes exactly:

- `./skills/helix-ui`
- `./themes`
- `./extensions/helix-fence.ts`
- `./extensions/helix-answer.ts`
- `./extensions/helix-command.ts`

`npm run check:resources` enforces that invariant and the matching
`.pi/settings.json` paths.

`helix-command` registers exactly one extension slash command, `/helix`. The
argument surface is `/helix`, `/helix help`, `/helix run [config-id]`, `/helix runs
list|status <run-id>|prune <run-id>`, `/helix models`, `/helix chains`, and
`/helix profiles`; it does not add `/helix-run`, `/helix-runs`,
`/helix-models`, `/helix-chains`, `/helix-profiles`, `/helix-worktrees`, or
`/helix-resources`.

## Skill Policy

`helix-ui` replaces the previous local fanout of many design-oriented skills for
Helix work. It is a single consolidated UI workflow covering shaping, building,
accessibility, responsive behavior, typography, layout, copy, color, motion,
polish, and optimization.

Important boundary: current Pi discovery still loads user-global skills from
`~/.pi/agent/skills` and `~/.agents/skills` independently of a project package.
A project package can make Helix contribute exactly one skill, but it cannot
hide skills owned by the user's global Pi or agent configuration. If Helix later
needs hard suppression of global skills without a launch flag, that must be a
source-verified Pi policy extension or upstream Pi capability, not a documentation
claim.

Headless discoverability limitation, verified against local Pi 0.80.3 on
2026-07-07 without provider prompts, credentials, sessions, or live calls:
`pi --offline --approve --mode rpc --no-session` plus the RPC `get_commands`
inventory listed user-global skill commands but did **not** expose
`skill:helix-ui` from this project package or from explicit `--skill` loads. Treat
the static manifest/settings check as the supported no-auth proof for now; do not
claim `helix-ui` model visibility in headless `-p`/RPC until Pi exposes a reliable
no-provider resource inventory or prompt-introspection path for package skills.

Command discoverability: local Pi 0.80.3 headless RPC was verified on
2026-07-08 without provider prompts, credentials, sessions, live calls, or model
traffic: `PI_OFFLINE=1 PI_TELEMETRY=0 pi --offline --approve --mode rpc
--no-session` plus RPC `get_commands` listed `helix`. This proves the extension
slash command is discoverable in the no-auth/no-provider command inventory; it
does not change the older package-skill caveat above for `skill:helix-ui`.

## Theme Policy

Pi detects light or dark terminal background mode, but it does not import the
terminal emulator's full color palette. Helix therefore ships explicit Rose Pine
theme files and selects `helix-rose-pine` in `.pi/settings.json`.

The theme files are vendored from the audited `pi-themes-rose-pine@0.1.0`
tarball with Helix-prefixed names to avoid colliding with the upstream package's
theme names. The upstream MIT license is preserved in
`LICENSES/pi-themes-rose-pine-MIT.txt`.

## Provider And Model Cost Policy

Provider defaults remain machine-local. `.pi/settings.json` must not commit a
`defaultProvider` or paid model choice.

For test-only provider coverage:

- Phase-3 `no-spend-test` uses only mock providers plus metadata-verified
  OpenRouter `:free` models over synthetic/public fixtures.
- GitHub Copilot is not eligible for `no-spend-test`. Personal/maintainer
  Copilot tests require a current pinned eligible model entry. On 2026-07-04,
  this machine's `pi --list-models github` exposed Copilot models; the cheapest
  Pi-visible candidate is currently `github-copilot/gpt-5-mini`. Re-check before
  use because GitHub's pricing docs list cheaper models that Pi may expose later.
- Azure Foundry remains postponed until the work deployment is available.

Current pricing/model sources for the Copilot rule:

- GitHub Copilot models and pricing:
  https://docs.github.com/copilot/reference/copilot-billing/models-and-pricing
- GitHub Copilot supported models:
  https://docs.github.com/copilot/reference/ai-models/supported-models

## Checks

Run:

```bash
npm run check:resources
npm run check:docs-truth
node tools/smoke/pi-e2e-load.mjs
node tools/smoke/pi-e2e-load.mjs --runtime-rpc
```

This validates the package manifest, project settings, skill surface, theme
surface, extension surface, docs truth locks, and common public-safety patterns.
The Pi load helper reports package/resource loadability, Pi discoverability,
no-live behavior, and live-provider proof as separate gates. Runtime RPC mode
uses a 60s default timeout for cold Pi startup and has re-confirmed `helix`
command discoverability without a provider call; project skill-command
discoverability remains a known Pi `0.80.3` headless limitation.
