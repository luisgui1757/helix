# How to use the four skills

[Install the skills](../README.md#install), then start a new session in your
project. These examples use Codex's `$` syntax. In Claude Code, replace `$`
with `/`. Use only the skill the task needs.

## Choose a task

Use Helix for a change you want implemented, tested and independently reviewed.
For trivial work that does not need that process, ask the CLI directly.

```text
$helix Fix the CSV export so quoted fields round-trip correctly.
```

Use Second-opinion before acting on a plan or disputed decision. It asks a
fresh agent to challenge the proposal and leaves implementation to another task.

```text
$second-opinion Challenge the migration plan in docs/plan.md. Do not edit it.
```

Use Unslop to edit prose while preserving its facts and qualifications.

```text
$unslop Edit README.md for plain prose. Preserve its claims and caveats.
```

## Choose models and effort

The writer is your current session. Helix keeps its model and effort. To choose
a different writer, start the host with it. These are tested example assignments,
not defaults chosen by the skills:

```sh
codex --model gpt-6.1-sol -c 'model_reasoning_effort="medium"'
claude --model claude-sonnet-5-5 --effort low
```

Without a reviewer choice, the host's defaults apply. Setup-helix can save a
choice for a project or your user account. For Codex:

```text
$setup-helix Keep the current writer. Save project reviewer defaults: model gpt-6-luna, reasoning effort high. I accept that this applies to every subagent in this project.
```

Codex saves native `[agents]` defaults in `.codex/config.toml`, or
`~/.codex/config.toml` for user scope. Project settings require a trusted project.
The defaults affect every subagent in that scope, including Second-opinion.
Start a fresh Codex session and invoke Helix without reviewer overrides to use
the saved defaults.

For Claude Code:

```text
/setup-helix Keep the current writer. Create a project helix-reviewer role with model claude-opus-5-5 and effort xhigh.
```

Claude saves `.claude/agents/helix-reviewer.md`, or the same role under
`~/.claude/agents/` for user scope. A project role takes precedence. The new role
has Read, Glob and Grep tools; Helix and Second-opinion can both use it.
Start a new session, then name the role:

```text
/helix Fix the CSV export. Use helix-reviewer for independent review. Preserve its configured model and effort.
```

For a one-off Codex reviewer, specify both values in the task:

```text
$helix Fix the CSV export. Use a fresh native reviewer with model gpt-6-luna and reasoning effort high, without inherited conversation history.
```

Per-task settings take precedence over saved preferences when the host can
apply them. In Helix, an unresolvable conflict ends in BLOCKED; Second-opinion
reports NOT RUN. Neither silently edits the saved role or substitutes a setting.

Setup asks for missing choices and preserves unrelated configuration. It does
not switch the running writer or choose models for you. It stops on an
unsupported model or effort instead of substituting one. Denied edits stay
unsaved. A saved setting is not proof of dispatch. See
[native execution evidence](native-roles.md).

## Read the result

These labels report what the agent concluded; they are not guarantees:

- **COMPLETE:** the final change passed its checks and review left no unresolved
  findings. Helix alone does not authorize a commit, push or release.
- **BLOCKED:** a check, setting, outside decision or unresolved finding stopped
  progress. Helix allows at most two correction rounds after the initial review.
- **READY FOR INDEPENDENT REVIEW:** verification passed, but no independent
  result returned. The report includes a reviewer brief.
- **NOT RUN:** Second-opinion could not complete the requested consultation,
  including when the requested model or effort could not be applied.

Check the actual test output and reviewer evidence before accepting COMPLETE.
Inspect staged, unstaged and new files. For a bug fix, require a failing test
before the fix and a passing result afterward. A reviewer may read the full
diff itself or receive it from the writer; the Claude template cannot run Git,
so the writer must supply it.

Recorded Claude runs reported COMPLETE despite missing review evidence. The
[current limitations](../STATUS.md) explain that failure and the tested versions.
The host's tools and permissions enforce access; skill instructions do not.
