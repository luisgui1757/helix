# Usage

[Install](install.md), then start a new session in your project. Examples use
Codex's `$` syntax. In Claude Code, use `/` instead.

## Implement or review a change

```text
$helix Fix the CSV export so quoted fields round-trip correctly.
$second-opinion Challenge the migration plan in docs/plan.md. Do not edit it.
```

Helix implements, tests and independently reviews a scoped change. It inspects
the project before asking about consequential unknowns and records useful
choices in existing documentation. For a trivial edit, ask the agent directly.
Second-opinion gives read-only advice; it does not implement the proposal.

## Read or edit a document

```text
$tldr Give me the short version of PLAN.md.
$unslop Edit README.md for plain prose. Preserve its claims and caveats.
$doc-view Turn ROADMAP.md into a readable HTML page. Ask which style to follow.
```

TLDR usually stays under 80 words and preserves blockers, risks and uncertainty.
It does not edit the source unless asked. Unslop removes filler while keeping
facts, quotations and technical content intact.

Doc-view asks which style to follow, recommending existing project styling when
available. It uses [Impeccable, Unslop, TLDR and Frontend-design](install.md#document-view-dependencies),
leads with a short summary and keeps the full source content accessible.
Markdown remains authoritative. Edit it, then invoke Doc-view again to refresh
HTML with the recorded style. There is no background sync.

The skill uses an existing document build when suitable; otherwise it creates
a local, self-contained HTML file. Generation does not authorize publication,
dependency installation or changes to Markdown.

## Design an interface

```text
$frontend-design Build an accessible dashboard for a community library.
```

The user's brief and existing brand guide the design. For implementation with
independent review, invoke Helix and ask it to follow Frontend-design. Confirm
the design skill loaded; mentioning its name is not loading proof. Design does
not replace functional checks or review. This combination has not been evaluated.

## Delivery workflows

Install the [workflow bundle](install.md#workflow-dependencies) together.

```text
$full-stop Fix the export bug and leave a reviewed PR for me to merge.
$full-send Fix the export bug, verify it and merge after all required gates pass.
$sol-loop Review this change before I publish it.
$takeover Continue this PR and preserve the contributor's work and credit.
```

Full-stop prepares the PR without merging, enabling auto-merge or entering a
merge queue. A normal instruction to stop working cancels work; it does not
start this workflow. Full-send requires an explicit request and includes merge
authority only after all gates pass. Active user limits and repository rules
still apply. Neither changes Helix's own authority.

Sol-loop uses a real Sol model with a three-round default budget. Full-stop uses
it for meaningful changes unless another reviewer is explicitly requested.
A Claude-only delegation route cannot supply Sol. Use a supported Sol route,
or explicitly choose an available reviewer for Full-stop. Required review must
finish before publication. Missing human approval is a visible handoff, not a
merge-ready result.

## Public commands and internal helpers

Modernize updates an existing change to its target base and checks it is still
needed. File-pr files an authorized change. Babysit-pr addresses CI and review
feedback. These can be useful standalone tasks.

File-upload and Leaving-pr-comments support the delivery workflows. They handle
attachments and review replies. All helpers inherit the caller's permissions;
loading one grants no extra authority. Internal grouping does not hide them from
either host. Keep the sibling layout and normal skill discovery so callers can
load their dependencies.

## Choose models and effort

```text
$setup-helix
```

Setup shows current settings, asks for project or user scope and reviewer
choices, then previews the exact edit before Save or Cancel. Complete,
authorized requests skip redundant questions. The writer remains the current
session. The optional discovery helper needs an existing Node.js 22.19+ and
native CLI; it installs nothing and starts no inference turn.

Model choices come from the host's catalog. Discovery may need normal approval.
A failed or denied query leaves manual choices; a returned catalog does not
prove account access or fresh network data. Unsupported settings are reported
without substitution. Setup preserves unrelated configuration and permissions.
An optional execution check after saving uses model allowance.

For Codex:

```text
$setup-helix Keep the current writer. Save project reviewer defaults: model gpt-6-luna, reasoning effort high. I accept that this applies to every subagent in this project.
```

These native `[agents]` defaults live in `.codex/config.toml` or the user
configuration. They affect all subagents in scope, including Second-opinion.
Project settings require trust. Start a fresh session to use saved defaults.
They do not make a reviewer read-only; children inherit the launching sandbox.
For enforced read-only review, use a separate `codex --sandbox read-only` session.

For Claude Code:

```text
/setup-helix Keep the current writer. Create a project helix-reviewer role with model claude-opus-5-5 and effort xhigh.
/helix Fix the CSV export. Use helix-reviewer for independent review. Preserve its configured model and effort.
```

Start a new session after saving the role. Project roles override user roles.
The supplied reviewer permits Read, Glob and Grep, so the writer must supply
its diff and check output. Updating skills does not rewrite saved roles.

Per-task model and effort choices override saved preferences when supported.
Otherwise the requested reviewer stays unavailable; no model is silently
substituted. See [native roles](native-roles.md) and the
[Codex](../skills/setup-helix/references/codex.md) and
[Claude](../skills/setup-helix/references/claude-code.md) references for launch commands and settings.

## Inside T3 Code

Install skills for the provider CLI used by T3 and confirm they load. With
orchestration tools available, Helix uses T3's live catalog and task targets,
including requested writers and reviewers on different configured providers.
It does not authenticate providers or add adapters. Without orchestration,
use direct-host delegation; that does not satisfy a T3-specific request.

Each correction review needs a fresh delegated task with the full revised diff
and verification output. A completed task or a review-role label proves neither
approval nor read-only access. Reviewer tasks inherit runtime mode and may need
approvals in their own thread. See the [T3 reference](../skills/helix/references/t3.md)
for target selection, waiting and verification. Live cross-provider workflow
coverage remains limited.

## Read the result

| Result | Meaning |
|---|---|
| COMPLETE | Required checks passed and independent review has no unresolved findings on the final change. Helix alone does not authorize publishing. |
| READY FOR INDEPENDENT REVIEW | Required verification passed, but no independent result returned. A brief and evidence are provided. |
| BLOCKED | No useful authorized work remains. Required verification is missing or failing, or a prerequisite, decision or authority is unavailable. |
| NOT RUN | Second-opinion could not complete the requested consultation. |

Check the evidence, not just the label. Agents can overstate completion; see
[known limitations](../STATUS.md). Unavailable checks block dependent claims,
not unrelated work or source review. Available evidence still needs to be
supplied and reviewed. Corrections need fresh checks and review.

For unfinished work, hand off the branch, unresolved items, verification gaps
and next action. Link existing documentation rather than duplicating it.
