# Install the skills

Use a configured coding agent that can edit files, run commands, and start a
separate subagent. Helix uses that tool's existing account, model,
permissions, and sandbox. It does not configure or certify provider endpoints.

Clone this repository, then run the applicable commands from its root. These
macOS/Linux/WSL examples link all four skills into either or both tools. They
skip links to this checkout and stop before installation if a source skill is
missing or another destination already exists. Inspect a conflict before changing it.

```sh
# Codex
(
  destination="$HOME/.agents/skills"
  for skill in helix setup-helix unslop second-opinion; do
    target="$destination/$skill"
    source="$PWD/skills/$skill"
    if [ ! -f "$source/SKILL.md" ]; then
      printf '%s\n' "$skill is missing SKILL.md; run from a complete repository root." >&2
      exit 1
    fi
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
    if [ ! -f "$source/SKILL.md" ]; then
      printf '%s\n' "$skill is missing SKILL.md; run from a complete repository root." >&2
      exit 1
    fi
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

Use the [how-to](how-to.md) to configure a reviewer, edit prose or request
a second opinion. Claude Code uses `/` where the Codex examples use `$`.
Enter `$setup-helix` (Claude: `/setup-helix`) for guided model and effort choices.

You can also copy any skill folder into the tool's skill directory. Include its
references, scripts and license when present. Updating this checkout updates a linked
skill; a copy must be updated explicitly. Windows users can copy the folders
to the same home-relative directories.

Both tools support the [Agent Skills format](https://agentskills.io/specification)
and symlinked skill folders: [Codex instructions](https://learn.chatgpt.com/docs/build-skills),
[Claude Code instructions](https://code.claude.com/docs/en/skills).
Other compatible tools can load the same instructions, but need their own
installation path and a separate behavioral evaluation.
