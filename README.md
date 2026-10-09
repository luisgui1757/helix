# Helix skills

Four portable skills for Codex and Claude Code, using the account, model,
permissions and sandbox already configured in your coding tool.

| Skill | Use it for |
|---|---|
| [helix](skills/helix/SKILL.md) | Implement a scoped change, verify it and resolve independent review findings. |
| [setup-helix](skills/setup-helix/SKILL.md) | Choose native writer and reviewer models and reasoning levels. |
| [unslop](skills/unslop/SKILL.md) | Edit prose while preserving facts, uncertainty and citations. |
| [second-opinion](skills/second-opinion/SKILL.md) | Get fresh, read-only advice on a plan or decision before acting. |

Helix resolves details through inspection or small experiments and records
consequential decisions briefly alongside the work. For trivial changes that
do not need independent review, ask your coding tool directly.

## Install

[Clone and install the skills](docs/install.md), then start a new session in
your project. Install any skill on its own or all four. The guide covers
macOS/Linux/WSL links, Windows copies, safe repeat installation and updates.

```text
Codex:       $helix Fix the CSV export so quoted fields round-trip correctly.
Claude Code: /helix Fix the CSV export so quoted fields round-trip correctly.
```

Enter `$setup-helix` or `/setup-helix` for guided model choices. The
[how-to](docs/how-to.md) covers usage, reviewer settings and completion labels.

The product is the four folders under `skills/`. There is no orchestration
runtime, package dependency, provider proxy, MCP server or workflow compiler.
The optional model-discovery helper uses an existing Node.js 22.19+ installation
and native CLI. Other Agent Skills-compatible hosts need their own install path
and behavioral evaluation.

## Limits and evidence

Skills give instructions; the host enforces access and isolation. Helix does
not authorize commits, pushes or releases, and Second-opinion is not a formal
audit. Missing required verification prevents completion, but does not stop
other authorized work or independent source review. See [Security](SECURITY.md).

Recorded Claude runs using Sonnet 5.5/low writers and Opus 5.5/xhigh reviewers
claimed COMPLETE with missing evidence or unreviewed final edits, including
with the shipped role. Check [current results and open limitations](STATUS.md).

The [documentation index](docs/README.md) links usage, native roles, evaluation
scenarios, the comparison protocol, contribution rules, governance and attribution.

The earlier `helix-cc` engine is retired and remains at its
[final revision](https://github.com/luisgui1757/helix/tree/d28d81aa481b9363862ab6aefb8732c2f190bd17).
Existing `claudex` installations are not migrated automatically; launch your coding
tool directly. The [archive index](docs/history/README.md) preserves engine and
skill-review history. The repository is now `helix`; `$helix` remains the entry point.
