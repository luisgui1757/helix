# How to use the skills

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

## Read a plan quickly

Use TLDR for short, plain-language summaries. It normally stays under 80 words
and preserves blockers, important conditions and decisions you need to make.
It does not edit the source unless you ask.

```text
$tldr Give me the short version of PLAN.md.
```

Use Doc-view to generate or refresh an HTML view of Markdown. It asks which
style to follow, recommends an existing project template when available, and
uses the recorded choice on refresh. The view leads with a short summary and
keeps the full content available below it. Markdown remains authoritative.

```text
$doc-view Turn ROADMAP.md into a readable HTML page. Ask which style to follow.
```

Doc-view requires installed Impeccable, Unslop, TLDR and Anthropic's
Frontend-design. The requested Claude Code design step is `frontend-design`,
not a command named `/design`. It resolves installed names before generating.
See [dependencies](install.md#document-view-dependencies).
It follows the project's document build when one exists; otherwise it produces
a local self-contained HTML file. Regeneration happens when the skill or build
is run, not automatically in the background. Edit Markdown, then refresh the
view. Generating a local file does not publish or install anything.

## Design a user interface

Use Frontend-design for a new interface or a requested visual redesign. It is
Anthropic's pinned, unmodified skill, packaged with its license.

```text
$frontend-design Build a clear, accessible dashboard for a community library.
```

Existing brand requirements and the user's brief take precedence. Frontend-design
does not replace Helix's tests, independent review or correction loop. A backend
fix or a small UI behavior correction does not require a visual redesign.

To implement an approved design through Helix, invoke Helix and ask it to follow
the frontend-design skill by name. In Claude Code only a leading `/` command
invokes a skill; Codex can also load a `$` skill mentioned later in the prompt.
Either way, confirm the design guidance actually loaded. This combination has
not been evaluated; see [status](../STATUS.md).

## Theo-inspired delivery workflows

These nine skills are a separately reviewed adaptation of Theo's stream, with
new supporting procedures. [Provenance](theo-provenance.md) distinguishes the
sources and gaps; full-stop's unseen body was newly written. Install the bundle
together as described in the [install guide](install.md).

```text
$sol-loop Review this change before I publish it.
$full-stop Fix the export bug and leave a reviewed PR for me to merge.
$full-send Fix the export bug, verify it and merge after all required gates pass.
$takeover Continue this PR and preserve the contributor's work and credit.
```

Full-send requires an explicit request and includes gated merge authority.
Full-stop leaves the PR open: no merge, auto-merge or queue entry. A normal
instruction to stop working is cancellation, not a full-stop workflow request.
Both obey active user restrictions and repository policy. They are alternatives
to the `helix` delivery entry point; installing them does not change Helix's
authority or its review policy.

Sol-loop requires an available Sol model/delegation route, and has its own
three-round default budget. It does not use setup-helix's saved reviewer role
as a substitute for Sol. Full-stop uses Sol by default for meaningful changes,
unless a reviewer is explicitly requested. If required review cannot run,
local work can finish but publication stays blocked. Human approval pending
after agent-side work is a handoff, not a merge-ready claim.
Direct Claude Code needs a configured route that actually targets Sol; ordinary
Claude-only delegation cannot supply it. Use T3 with an available Sol provider,
or explicitly request an available reviewer for full-stop.

| Helper | When it is used |
|---|---|
| modernize | Bring inherited work onto its intended target and recheck that it remains necessary. |
| file-pr | Create/update the exact authorized PR; preserve evidence and contributor credit. |
| babysit-pr | Follow CI and review findings; return to the caller without merging. |
| file-upload | Attach authorized evidence when the installed CLI supports it; report missing support. |
| leaving-pr-comments | Reply in the right thread with actual model disclosure and verified claims. |

Loading a helper does not grant new permissions. Host delegation and watcher
support, account access and installed CLI capabilities still need checking at
use time. Packaging checks and document review do not certify a live PR workflow;
see the [integration evidence](reviews/2026-10-16-theo-bundle.md).

## Inside T3 Code

Install the skills for the provider CLI T3 runs, following the existing
[installation guide](install.md). Skill loading remains provider-owned; confirm
it in the running session. With V2 orchestration tools available, Helix uses
T3's live provider/model/options catalog and delegated tasks. Outside T3, the
existing direct Codex and Claude workflows still apply.

You can request a writer and independent reviewer on different providers with
literal model IDs and reasoning effort. Helix resolves those choices against
T3's current catalog; it does not maintain model lists or authenticate providers.
A missing requested provider or unsupported effort stays unresolved. Setup uses
supported T3 settings where available, otherwise reports explicit task-scoped
choices; it does not claim to save a Helix role configuration in T3.

Helix supplies the complete final delta, repository rules and captured
verification evidence to a fresh T3 review task. Each correction round creates another task.
Messaging an old child thread does not reopen its completed task; a follow-up
may get a new task ID while retaining the old reviewer conversation.
`role: review` is an instruction, not enforced read-only access: the workflow
uses available host restrictions and reports any enforcement gap. Reviewers keep
shared isolation so they can read the uncommitted delta. They inherit the
parent's runtime mode; when that resolves to a supervised mode, Helix warns
that the reviewer may wait for approvals in its own thread. Task completion
alone proves neither passing tests nor review approval. Effective effort needs
correlated execution evidence; requested options alone are insufficient.

The [packaged T3 reference](../skills/helix/references/t3.md) records the inspected
source and lifecycle details. It was last source-checked on 2026-10-15 against
`v0.0.46-nightly.20261014.3132`. V2 orchestration ships in the 0.0.46 line;
stable v0.0.45 has no orchestrator tools, so Helix uses direct host delegation
there. Recheck the actual tools and catalog on the installed release. Live
cross-provider behavior remains a separate credential-dependent evaluation; see
[status](../STATUS.md).

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
No saved setting makes a Codex reviewer read-only: subagents inherit the
sandbox of the turn that starts them. For enforced read-only review, run the
handed-off brief in a separate `codex --sandbox read-only` session. Helix is
asked to report the reviewer's observed write access.
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
