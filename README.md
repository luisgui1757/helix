# Helix

Portable skills for Codex and Claude Code, directly or inside T3 Code.
Use your existing agent, account and permissions. No extra runtime or packages.

[Install](docs/install.md) · [Usage](docs/how-to.md) · [Limitations](STATUS.md)

## Delivery

| Skill | Use it to |
|---|---|
| [helix](skills/helix/SKILL.md) | Implement, test and independently review a change. |
| [full-stop](skills/full-stop/SKILL.md) | Prepare a reviewed PR and leave merging to you. |
| [full-send](skills/full-send/SKILL.md) | Deliver through merge after all required gates pass. |
| [sol-loop](skills/sol-loop/SKILL.md) | Review with Sol and resolve findings within a round budget. |
| [takeover](skills/takeover/SKILL.md) | Continue existing work and preserve contributor credit. |

## Documents and design

| Skill | Use it to |
|---|---|
| [doc-view](skills/doc-view/SKILL.md) | Turn Markdown into a styled HTML view with a short summary. |
| [tldr](skills/tldr/SKILL.md) | Get the essentials in plain language, usually under 80 words. |
| [unslop](skills/unslop/SKILL.md) | Remove filler and awkward prose without changing meaning. |
| [frontend-design](skills/frontend-design/SKILL.md) | Design and build a user interface. |

## Setup and focused tasks

| Skill | Use it to |
|---|---|
| [setup-helix](skills/setup-helix/SKILL.md) | Choose writer and reviewer models and reasoning levels. |
| [second-opinion](skills/second-opinion/SKILL.md) | Get independent advice on a plan or decision. |
| [modernize](skills/modernize/SKILL.md) | Update an existing change and check it is still needed. |
| [file-pr](skills/file-pr/SKILL.md) | File or update an authorized PR. |
| [babysit-pr](skills/babysit-pr/SKILL.md) | Address CI failures and review feedback. |

## Internal helpers

Delivery workflows call these as needed. Keep them installed with the bundle.
They remain callable directly; this grouping does not hide them from the host.

| Skill | Purpose |
|---|---|
| [file-upload](skills/file-upload/SKILL.md) | Attach authorized screenshots or recordings. |
| [leaving-pr-comments](skills/leaving-pr-comments/SKILL.md) | Post authorized, evidence-backed review replies. |

## Start here

Install the skills, then start a new session in your project:

```text
Codex:       $helix Fix the CSV export so quoted fields round-trip correctly.
Claude Code: /helix Fix the CSV export so quoted fields round-trip correctly.
```

Use `setup-helix` for model choices. Keep the delivery skills together as
listed in the [install guide](docs/install.md#workflow-dependencies).
Doc-view needs [Impeccable, Unslop, TLDR and Frontend-design](docs/install.md#document-view-dependencies).
It asks which style to follow and keeps Markdown as the source.

Skills guide the agent; the host enforces permissions. Helix alone does not
authorize publication. Full-stop leaves the PR open. An explicit full-send
request authorizes merge only after the required gates pass.

MIT licensed, with [third-party exceptions](THIRD_PARTY.md).
See [contributing](CONTRIBUTING.md), [security](SECURITY.md) and the
[documentation index](docs/README.md).
