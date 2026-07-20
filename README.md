# Helix CC

Helix CC is a Claude Code plugin that maps Helix's built-in repository loops
onto bounded Claude Code dynamic workflows. It ships full-cycle delivery,
implement/review, red-first TDD fixes, read-only reconnaissance, measured
research, and evidence-gated pre-PR handoff.

Write-capable loops do not trust a role's prose as command, metric, file-scope,
or shipment proof. A bundled MCP service executes exact argument vectors
without a shell, observes tracked content/type/mode and Git state itself, and
signs bounded receipts. Every argv begins with a PATH-resolved executable name;
run repository scripts through an interpreter such as `node scripts/check.mjs`
rather than `./scripts/check.mjs`. An
internal deterministic workflow verifies each signature and requested
operation before a loop can approve or ship.

```text
planners → plan judge → builder → tester → documenter
                              ↘ reviewers → verifier → approve or remediate
```

| Skill | Use it for |
|---|---|
| `/helix-cc:helix-loop` | Helix `full-cycle` and guided `plan-implement`, including plan-level backtracking |
| `/helix-cc:helix-implement-review` | Guided `implement-review` without a separate planning stage |
| `/helix-cc:helix-tdd-fix` | `tdd-fix`, with red execution in a disposable repository copy and only verified signed test contents applied back |
| `/helix-cc:helix-scout` | Read-only `scout` reconnaissance and an implementation brief |
| `/helix-cc:helix-research` | `research` convergence with target, dead-end, plateau, and iteration-rail terminal reasons |
| `/helix-cc:helix-ship-pre-pr` | `ship-pre-pr`, with separate verification/release gates, ending at one open or reused PR and never merging |

The [workflow catalog](docs/workflows.md) defines every input, stage,
deterministic gate, and deliberate Claude Code mapping difference.

Claude Code always owns the Workflow scheduler, agent contexts, tools,
journals, and structured outputs. Optional local provider adapters translate
inference for exact OpenAI-subscription, GitHub Copilot, or Azure Foundry GPT
models without replacing that harness.

## Current routes

| Route | Current state |
|---|---|
| Native Claude | Supported |
| OpenAI subscription, `gpt-5.6-luna` | Live-proven |
| GitHub Copilot, `copilot/gpt-5.4` | Live-proven after an exact pin |
| OpenAI + Copilot | Live-proven in one mixed nine-role workflow |
| Azure Foundry GPT | Implemented and locally tested; live proof pending |
| Azure-containing mixed routes | Implemented; each exact combination needs its own proof |
| OpenRouter | Deferred and rejected by this release |

Provider-backed launches never choose a model implicitly. Pass `--model` or
set `CLAUDEX_MODEL`; mixed routes use the `openai/`, `copilot/`, and `azure/`
namespaces.

## Install and run

You need macOS or Linux/WSL, Git, Node.js `22.19.0` or newer, and a supported
Claude Code installation. Install and verify Claude Code separately using
Anthropic's official guidance; Helix CC setup never downloads or executes a
mutable remote installer.

```bash
git clone https://github.com/luisgui1757/helix-cc.git
cd helix-cc
./setup.sh
```

If `~/.local/bin` is not already on your shell `PATH`, setup prints the exact
one-line export and startup-file location required. It does not edit shell
profiles.

Start the native route from the repository you want to change:

```bash
cd /path/to/your/project
claudex
```

Then choose a loop, for example:

```text
/helix-cc:helix-loop <describe the repository change>
```

Each skill checks the local route, shows the exact task, role models, pass
limit, writer scope, and verification argv, then asks for confirmation. It
starts a fresh trusted-evidence session and passes that exact public receipt key
to the workflow. A
successful workflow returns `approved: true`; an exhausted workflow terminates
without approval and reports the remaining reasons.

The [Claudex HOW-TO](docs/quickstart.md) is the single step-by-step guide for
native Claude, OpenAI subscription, GitHub Copilot, Azure Foundry GPT, mixed
roles, proof receipts, first workflow completion, troubleshooting, shutdown,
and updates.

## Verification

```bash
npm run verify
```

That runs plugin structure validation, all deterministic tests, and Claude
Code's strict plugin validator. Provider proof commands and full live Workflow
runs are separate because they contact the selected provider.

Pull requests run the structure validator, dependency audit and registry
signature verification, and the deterministic test suite on the minimum and
current Node.js lines. The matrix feeds one stable required check named `test`.
GitHub Actions are digest-pinned and run with read-only repository permissions.

Current automated results, dated live receipts, and deliberate gaps are kept in
[STATUS.md](STATUS.md).

## Security and contributions

Report suspected vulnerabilities through GitHub's private vulnerability
reporting flow; do not open a public issue or include credentials, prompts,
responses, or account identifiers. See [SECURITY.md](SECURITY.md).

Contribution requirements, local gates, and the protected-branch contract are
in [CONTRIBUTING.md](CONTRIBUTING.md). Automated npm and GitHub Actions updates
are managed by Renovate without automerge; GitHub Dependabot owns advisory-led
security fixes so the two systems do not create duplicate security PRs.

## Documentation

- [Claudex HOW-TO](docs/quickstart.md) — installation through first completed
  workflow for every current route.
- [Provider reference](docs/providers.md) — route grammar, states, configuration,
  diagnostics, and lifecycle.
- [Workflow catalog](docs/workflows.md) — complete Helix parity map, loop inputs,
  stage contracts, and terminal results.
- [Status ledger](STATUS.md) — current claims and exact evidence.
- [Documentation index](docs/README.md) — architecture, historical decisions,
  and dated proof records.

## Repository map

- `workflows/` — six user loops, two bounded route-proof workflows, and one
  internal signed-receipt verifier.
- `agents/` — thirteen role definitions, including capability-limited evidence,
  reproduction, and shipping roles.
- `skills/` — six loop launchers and the provider doctor.
- `bin/` — `claudex`, provider lifecycle, diagnostics, adapters, and the
  trusted-evidence MCP entrypoint.
- `lib/` — provider configuration, readiness, model checks, process policy,
  and signed evidence effects.
- `tests/` — unit, component, subprocess, lifecycle, and workflow tests.
- `review-prompts/` — canonical external-review dispatch prompts.

Helix CC intentionally uses audited standalone workflows instead of Helix's
arbitrary chain compiler. Its remaining runtime boundaries are explicit in
[STATUS.md](STATUS.md), not hidden behind the green local gate.
