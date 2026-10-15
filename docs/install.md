# Install the skills

Use a configured coding agent that can edit files, run commands, and start a
separate subagent. Helix uses that tool's existing account, model,
permissions, and sandbox. It does not configure or certify provider endpoints.

Clone this repository, then run the applicable commands from its root. These
macOS/Linux/WSL examples link every folder under `skills/` into either or both
tools, so a newly added skill needs no change here. They skip links to this
checkout and stop before installation outside the Helix repository root, if a
skill folder lacks `SKILL.md`, or if another destination already exists.
Inspect a conflict before changing it.

To install only some skills, replace `"$PWD"/skills/*/` on the `set --` line of
the chosen host's block with their folders, for example
`set -- "$PWD"/skills/helix/ "$PWD"/skills/unslop/`. Do this to keep an
existing copy of a skill, such as Anthropic's frontend-design plugin or a copy
in another skills directory: the preflight only detects a conflict at its own
link path, and a second copy appears as another skill. Running the unedited
block later also links the skills you left out.

```sh
# Codex
(
  destination="$HOME/.agents/skills"
  if [ ! -f "$PWD/skills/helix/SKILL.md" ]; then
    printf '%s\n' "skills/helix is missing SKILL.md; run from the Helix repository root." >&2
    exit 1
  fi
  set -- "$PWD"/skills/*/
  for source do
    source=${source%/}
    skill=${source##*/}
    target="$destination/$skill"
    if [ ! -f "$source/SKILL.md" ]; then
      printf '%s\n' "skills/$skill is missing SKILL.md; run from a complete repository root." >&2
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
  for source do
    source=${source%/}
    skill=${source##*/}
    [ -L "$destination/$skill" ] ||
      ln -s "$source" "$destination/$skill" || exit 1
  done
)

# Claude Code
(
  destination="$HOME/.claude/skills"
  if [ ! -f "$PWD/skills/helix/SKILL.md" ]; then
    printf '%s\n' "skills/helix is missing SKILL.md; run from the Helix repository root." >&2
    exit 1
  fi
  set -- "$PWD"/skills/*/
  for source do
    source=${source%/}
    skill=${source##*/}
    target="$destination/$skill"
    if [ ! -f "$source/SKILL.md" ]; then
      printf '%s\n' "skills/$skill is missing SKILL.md; run from a complete repository root." >&2
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
  for source do
    source=${source%/}
    skill=${source##*/}
    [ -L "$destination/$skill" ] ||
      ln -s "$source" "$destination/$skill" || exit 1
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


## T3 Code

Install each skill for the provider CLI used by T3 using the paths above, then
confirm native skill discovery in a new T3 session. T3 does not need a separate
Helix engine or server. V2 orchestration tools, from the 0.0.46 line, enable the optional
[T3 workflow](how-to.md#inside-t3-code); their absence leaves direct host delegation
available, but cannot satisfy a request specifically requiring T3 cross-provider
execution. Installing skill files does not prove orchestration or account access.
