# How to use the four skills

[Install the skills](install.md), then start a new session in your
project. These examples use Codex's `$` syntax. In Claude Code, replace `$`
with `/`. Use only the skill the task needs.

## Choose a task

Use Helix for a change you want implemented, tested and independently reviewed.
For trivial work that does not need that process, ask the CLI directly.

```text
$helix Fix the CSV export so quoted fields round-trip correctly.
```

An overall outcome is enough to start; Helix inspects existing behavior or uses
a small experiment to resolve the next uncertainty. Questions about consequential
scope, contract or authority choices still need answers. Experiments do not waive
the checks and independent review required for the delivered change.

Helix records consequential choices made during the task. It follows the repo's
decision convention or uses relevant existing documentation, creating a small
file only when neither fits. A short paragraph with the problem, real alternatives
and reason for the choice is enough. Blockers and required or unchanged behavior
stay in reports or requested documentation. It skips obvious, reversible choices
and labels provisional decisions or inferred historical rationale.

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

For guided setup, enter just:

```text
$setup-helix
```

In Claude Code, use `/setup-helix`. This configures model preferences; install
the skills using the README first. Setup shows current settings and asks for
project or user scope, reviewer model, then its reasoning level. It uses native
question controls or text choices, and previews the edit before you choose
Save or Cancel. The writer stays as your current session.

Model choices come from the current host's catalog. The optional helper needs
an existing Node.js 22.19+ installation and calls your installed CLI without
running a model turn. It installs no dependencies.

Discovery may need normal host approval. A denied command or failed query
leaves manual choices: keep settings or supply an exact ID from the native
model picker. A denied Claude service connection can still return native model
metadata; setup discloses the denial. Listed models prove neither fresh network
data nor account access. On Claude, the helper's 20-second timeout includes
connection approval waits after launch. Command approval happens before launch.
Setup does not change sandbox settings or retry a denial on its own.

Question format and order can vary. Check that the preview shows your chosen
model and effort before you answer Save. See the [observed limits](../STATUS.md).

After saving, you can opt into a small execution check that uses model allowance.
Clients without a way to answer questions receive all missing choices without
configuration changes. Complete requests like those below skip the interview,
while still checking whether the requested settings are supported.

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
For Helix delivery reviews, the new role template requires the full delta and
captured check output, and treats missing available evidence as an unresolved
finding. Second-opinion consultations do not need delivery evidence. Updating the
skill does not rewrite already saved roles; review an existing role's instructions
before explicitly updating it through setup.
Start a new session, then name the role:

```text
/helix Fix the CSV export. Use helix-reviewer for independent review. Preserve its configured model and effort.
```

For a one-off Codex reviewer, specify both values in the task:

```text
$helix Fix the CSV export. Use a fresh native reviewer with model gpt-6-luna and reasoning effort high, without inherited conversation history.
```

Per-task settings take precedence over saved preferences when the host can
apply them. In Helix, an unresolvable conflict leaves that reviewer unavailable while
other useful work continues; Second-opinion
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
- **BLOCKED:** no useful authorized work remains without an unavailable
  prerequisite, authority or outside decision. This is the final status when
  required verification remains missing or failing, even if source review
  finished. A missing check blocks its dependent claim
  or action, not unrelated implementation or source review. The report gives
  the concrete limitation and next step.
- **READY FOR INDEPENDENT REVIEW:** all required verification passed, but no
  independent result returned. The report includes a reviewer brief. If required
  verification is also unavailable after independent work is exhausted, use
  BLOCKED and include that brief.
- **NOT RUN:** Second-opinion could not complete the requested consultation,
  including when the requested model or effort could not be applied.

Check the actual test output and reviewer evidence before accepting COMPLETE.
Helix continues corrections and review while it can make progress; there is no
fixed round limit. Run available checks and let the reviewer inspect the code
and their results while an external check remains unavailable. Report code
findings separately from verification gaps; an unrun or failed check never
becomes a pass. Repeated failed fixes call for a fresh diagnosis.
Evidence the writer can still supply is an unresolved finding, not an
unavailable prerequisite. Supply it and obtain review before finishing.
Inspect staged, unstaged and new files. For a bug fix, require a failing test
before the fix and a passing result afterward. A reviewer may read the full
diff itself or receive it from the writer; the Claude template cannot run Git,
so the writer must supply it, together with captured check output rather than
pass/fail summaries. Re-review corrections before finishing; another available
review round is work to perform, not a reason to hand off.

Recorded Claude runs reported COMPLETE despite missing review evidence. The
[current limitations](../STATUS.md) explain that failure and link to the dated
host-version evidence.
The host's tools and permissions enforce access; skill instructions do not.

When moving unfinished work between tools, ask for a short handoff with the
current branch, unresolved work, verification gaps and next action. Reference
existing docs and evidence instead of copying them. A separate handoff file is
optional; completed work already covered by repository docs needs no extra one.
