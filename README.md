# Agent skills

Four portable skills for scoped delivery, native model setup, prose editing,
and independent advice. Use them in Codex or Claude Code with the account and
permissions already configured in that tool.

| Skill | Use it for |
|---|---|
| [helix](skills/helix/SKILL.md) | Implement a change, verify it, and resolve independent review findings. |
| [setup-helix](skills/setup-helix/SKILL.md) | Choose native writer and reviewer models and reasoning levels. |
| [unslop](skills/unslop/SKILL.md) | Remove AI prose patterns while preserving facts, uncertainty, and citations. |
| [second-opinion](skills/second-opinion/SKILL.md) | Get a fresh read-only challenge to a plan or decision before acting. |

Helix uses the current session to implement, test and document a change, then
asks a fresh reviewer to check it. Use a direct request for trivial work that
does not need this review process. See the [how-to](docs/how-to.md) for examples,
model choices and what the completion labels mean.

The product is the four folders under `skills/`. It has no runtime,
dependencies, provider proxy, MCP server, or workflow compiler. Each skill can
be installed on its own. The repository URL and `$helix` entry point are unchanged.

## Install

Use a configured coding agent that can edit files, run commands, and start a
separate subagent. Helix uses that tool's existing account, model,
permissions, and sandbox. It does not configure or certify provider endpoints.

Clone this repository, then run the applicable commands from its root. These
macOS/Linux/WSL examples link all four skills into either or both tools. They
skip links to this checkout and stop before installation if another destination
already exists. Inspect a conflict before changing it.

```sh
# Codex
(
  destination="$HOME/.agents/skills"
  for skill in helix setup-helix unslop second-opinion; do
    target="$destination/$skill"
    source="$PWD/skills/$skill"
    if [ -L "$target" ] && [ "$target" -ef "$source" ]; then
      continue
    fi
    if [ -e "$target" ] || [ -L "$target" ]; then
      printf '%s\n' "$skill already exists; inspect it before changing it." >&2
      exit 1
    fi
  done
  mkdir -p "$destination" || exit 1
  for skill in helix setup-helix unslop second-opinion; do
    [ -L "$destination/$skill" ] ||
      ln -s "$PWD/skills/$skill" "$destination/$skill" || exit 1
  done
)

# Claude Code
(
  destination="$HOME/.claude/skills"
  for skill in helix setup-helix unslop second-opinion; do
    target="$destination/$skill"
    source="$PWD/skills/$skill"
    if [ -L "$target" ] && [ "$target" -ef "$source" ]; then
      continue
    fi
    if [ -e "$target" ] || [ -L "$target" ]; then
      printf '%s\n' "$skill already exists; inspect it before changing it." >&2
      exit 1
    fi
  done
  mkdir -p "$destination" || exit 1
  for skill in helix setup-helix unslop second-opinion; do
    [ -L "$destination/$skill" ] ||
      ln -s "$PWD/skills/$skill" "$destination/$skill" || exit 1
  done
)
```

Start a new session in the repository you want to change:

```text
Codex:       $helix Fix the CSV export so quoted fields round-trip correctly.
Claude Code: /helix Fix the CSV export so quoted fields round-trip correctly.
```

Use the [how-to](docs/how-to.md) to configure a reviewer, edit prose or request
a second opinion. Claude Code uses `/` where the Codex examples use `$`.

You can also copy any skill folder into the tool's skill directory. Include its
references and license when present. Updating this checkout updates a linked
skill; a copy must be updated explicitly. Windows users can copy the folders
to the same home-relative directories.

Both tools support the [Agent Skills format](https://agentskills.io/specification)
and symlinked skill folders: [Codex instructions](https://learn.chatgpt.com/docs/build-skills),
[Claude Code instructions](https://code.claude.com/docs/en/skills).
Other compatible tools can load the same instructions, but need their own
installation path and a separate behavioral evaluation.

## Limits

These skills give instructions. The host enforces permissions and isolation;
the repository supplies tests and merge gates. Helix alone does not authorize
commits, pushes or releases. Second-opinion does not replace a formal audit.
See [Security](SECURITY.md) for the trust boundaries.

Observed limitation: with a Sonnet 5.5/low writer and Opus 5.5/xhigh reviewer,
reviewers received summaries instead of the full delta, noted missing baseline
evidence and still reported no material defects. One received the explicit instruction
to treat missing evidence as an unresolved finding. Both writers then reported
COMPLETE. This remains open; check the [evidence and limitations](STATUS.md).

## Evaluate and contribute

- [How to use the skills](docs/how-to.md) includes model and effort examples.
- [Native role details](docs/native-roles.md) explain how to verify dispatch.
- [Behavioral scenarios](evals/scenarios.md) and [collection evaluations](evals/collection.md)
  define what real runs must prove.
- [Plain CLI comparison](docs/reviews/2026-10-03-comparison.md) reports the 16-run
  pilot; the [protocol](evals/comparison.md) explains how to reproduce it.
- [Status](STATUS.md) separates observed results from untested combinations.
- [Contributing](CONTRIBUTING.md) describes the maintenance checks.
- [Security](SECURITY.md) describes the trust boundaries.
- [Third-party attribution](THIRD_PARTY.md) records the pinned unslop source and license.

The earlier `helix-cc` engine is retired. Its standalone workflows, graph mode,
provider adapters, signed receipts, launcher, and shipping automation remain
recoverable at [the final engine revision](https://github.com/luisgui1757/helix-cc/tree/d28d81aa481b9363862ab6aefb8732c2f190bd17).
Existing `claudex` installations are not migrated automatically; launch your
chosen coding tool directly. The [migration record](docs/reviews/2026-10-03-portable-skill.md)
and [archive index](docs/history/README.md) preserve the earlier evidence.
