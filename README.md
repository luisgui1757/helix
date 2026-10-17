# Helix

A directory of portable agent skills for Codex and Claude Code, directly or
inside T3 Code. Skills live in folders under `skills/` and use the
providers, permissions and sandbox already configured in your
coding tool. There is no orchestration runtime, package dependency, provider
proxy, MCP server or workflow compiler.

| Skill | Use it for | Origin |
|---|---|---|
| [helix](skills/helix/SKILL.md) | Implement a scoped change, verify it and resolve independent review findings. | Helix (MIT) |
| [setup-helix](skills/setup-helix/SKILL.md) | Choose writer and reviewer models and reasoning levels for helix and second-opinion. | Helix (MIT) |
| [second-opinion](skills/second-opinion/SKILL.md) | Get fresh, read-only advice on a plan or decision before acting. | Helix (MIT) |
| [doc-view](skills/doc-view/SKILL.md) | Generate a styled HTML reading view from Markdown, with a short summary. | Helix (MIT) |
| [tldr](skills/tldr/SKILL.md) | Summarize in everyday words, usually under 80 words. | Helix (MIT) |
| [unslop](skills/unslop/SKILL.md) | Edit prose while preserving facts, uncertainty and citations. | Adapted from pstack (MIT) |
| [frontend-design](skills/frontend-design/SKILL.md) | Design and build distinctive user interfaces. | Anthropic, unmodified (Apache 2.0) |
| [sol-loop](skills/sol-loop/SKILL.md) | Review a change with Sol, judge findings and iterate within a round budget. | Theo-inspired adaptation (MIT) |
| [full-send](skills/full-send/SKILL.md) | Explicitly delegate delivery through verification, PR feedback and merge. | Theo-inspired adaptation (MIT) |
| [full-stop](skills/full-stop/SKILL.md) | Prepare and review a PR, then hand it back without merging. | Theo opening; new completion (MIT) |
| [takeover](skills/takeover/SKILL.md) | Continue inherited work while preserving its intent and contributor credit. | Theo-inspired adaptation (MIT) |
| [modernize](skills/modernize/SKILL.md) | Update an existing change to its target and check it is still needed. | New helper from Theo's narrated purpose (MIT) |
| [file-pr](skills/file-pr/SKILL.md) | File or update an authorized PR with verification and attribution. | Newly written helper (MIT) |
| [babysit-pr](skills/babysit-pr/SKILL.md) | Handle CI and review feedback until the requested readiness boundary. | Newly written helper (MIT) |
| [file-upload](skills/file-upload/SKILL.md) | Attach authorized visual evidence using a supported GitHub CLI. | Newly written helper (MIT) |
| [leaving-pr-comments](skills/leaving-pr-comments/SKILL.md) | Post authorized replies with model disclosure and evidence. | Theo disclosure rule; new procedure (MIT) |

The nine Theo-inspired skills form a cooperating bundle; install them together
for the delivery workflows. They are paraphrases and clearly labeled new text,
not Theo's official files. See [provenance and dependencies](docs/theo-provenance.md).

Doc-view needs Impeccable, Unslop, TLDR and Frontend-design;
see [dependencies](docs/install.md#document-view-dependencies).

Third-party skills keep their own licenses; see [attribution](THIRD_PARTY.md).
To add a skill, follow [contributing](CONTRIBUTING.md#adding-a-skill).

## Install

[Clone and install the skills](docs/install.md), then start a new session in
your project. The guide links every folder under `skills/`, or the ones you
choose, and covers macOS/Linux/WSL links, Windows copies, safe repeat
installation and updates.

```text
Codex:       $helix Fix the CSV export so quoted fields round-trip correctly.
Claude Code: /helix Fix the CSV export so quoted fields round-trip correctly.
```

The [how-to](docs/how-to.md) covers each skill, reviewer settings and
completion labels. Enter `$setup-helix` or `/setup-helix` for guided model
choices.

## The Helix workflow

Helix resolves details through inspection or small experiments, verifies the
change and gets an independent review, and records consequential decisions
briefly alongside the work. For trivial changes that do not need independent
review, ask your coding tool directly.

The optional model-discovery helper uses an existing Node.js 22.19+ installation
and native CLI outside T3. Inside T3, use its live orchestration catalog and
delegation tools; Helix adds no provider adapters. See [T3 usage](docs/how-to.md#inside-t3-code).
Other Agent Skills-compatible hosts need their own install path
and behavioral evaluation.

## Limits and evidence

Skills give instructions; the host enforces access and isolation. The `helix`
skill does not authorize commits, pushes or releases, and Second-opinion is not
a formal audit. Missing required verification prevents completion, but does not stop
other authorized work or independent source review. See [Security](SECURITY.md).
An explicit full-send request includes gated merge authority; full-stop leaves
the PR open. Active user limits and repository policies still apply.

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
