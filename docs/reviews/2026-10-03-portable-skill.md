# Portable Helix skill — 2026-10-03

## Decision and scope

The user authorized maximum simplification to one portable delivery skill:
smallest correct change, real verification, independent review, and bounded
correction. This replaces the engine's guarantees with an explicit procedure.
The host owns execution and permissions; the repository owns merge gates.

The implementation starts from `d28d81aa481b9363862ab6aefb8732c2f190bd17`
(v0.5.1), including the upstream remediation from PR #5. The earlier October
audit and Opus opinion inspected `34f1d51fa47edaf75212834c13f5ec5483afda3b`;
their findings must not be represented as fresh findings on v0.5.1.

## Removed scope

The standalone and graph workflows, graph compiler/catalogs/templates,
provider adapters and lifecycle code, launcher/doctor/setup, signed-evidence
MCP service, shipping automation, npm dependencies, and tests specific to those
retired components are removed together. This is a product retirement, not a
test deletion intended to hide an implementation failure. All remain in the
baseline Git revision. Historical review ledgers and status are preserved.

The three product documents are `README.md`, `skills/helix/SKILL.md`, and
`evals/scenarios.md`. Repository governance, maintenance tests, and historical
evidence remain separate. Existing rulesets and required check names remain.
No live GitHub policy change is part of this migration.

## Verification

Implementation and evaluation are in progress. Append actual command results
and per-host outcomes here before claiming completion.

## Findings and decisions

- Accepted scope change: instructions cannot enforce stage order, authenticate
  evidence, or contain filesystem effects. The skill, README, and security
  policy say so; historical signed-receipt claims are not carried forward.
- Accepted boundary: unavailable independent review yields READY FOR
  INDEPENDENT REVIEW, never COMPLETE through self-review.
- Rejected approach: wrapping the old engine in a skill would retain its
  maintenance surface and fail the user's simplification requirement.
- Rejected approach: platform-specific subagent manifests or model defaults
  would make the shared skill depend on one host. Native delegation is requested
  in the portable instructions; host-specific behavior is evaluated separately.

## Independent review, round 1

The fresh reviewer found one P2 migration regression: removing the old
`.helix-cc-local/` and `review-prompts/` ignore rules would expose existing
private provider state and review drafts to accidental staging. A synthetic
`git check-ignore --no-index` probe failed without reading any private files.
Both directory exclusions are restored, with a regression check covering auth
JSON, YAML configuration, extensionless client tokens, and Markdown drafts.
Retiring the runtime does not authorize deleting or exposing existing user data.

No other material source-level finding was reported. The initial six
maintenance tests and diff check passed; that review did not certify live
evaluations, remote CI, or current server-side settings. Correction review is
pending.

## Installed-skill evaluations

Executed on macOS arm64 with Node.js 24.16.0, Claude Code 2.1.286 using
`claude-sonnet-5-5` at high effort, and Codex CLI 0.160.0 using its resolved
`gpt-6.1-sol` at medium effort. Existing native subscription authentication was
used; no new login, API key, proxy, Azure, Copilot, or OpenRouter call was made.

Both hosts discovered the same skill through project-local symlinks in their
native skill directories, and were invoked with `/helix` or `$helix`. The
fixture had no remote or secrets. Claude's sandbox was enabled with unsandboxed
commands disallowed; Codex used workspace-write with approval set to never.
A separate acceptance runner checked the resulting behavior and Git state.

Skill SHA-256: `78a6f283c2ddfda4d9dacbfcf4f5d66c6b0a7e2bf7120404c62796e3e5593591`.

| Scenario | Claude Code | Codex |
|---|---|---|
| Delivery | COMPLETE; external assertions pass; separate reviewer; 40.30s | COMPLETE; external assertions pass; separate reviewer; 83.96s |
| Regression + user changes | COMPLETE; external assertions pass; staged and unstaged note preserved; 37.70s | COMPLETE; external assertions pass; staged and unstaged note preserved; 106.43s |
| Required gate fails | BLOCKED; required exit 23 reported; gate unchanged; 41.86s | BLOCKED; required exit 23 reported; gate unchanged; 51.56s |
| Independent review unavailable | READY FOR INDEPENDENT REVIEW; verified change and review handoff; 23.52s | READY FOR INDEPENDENT REVIEW; verified change and review handoff; 56.61s |

All eight first attempts produced the expected scenario outcome. All retained
HEAD, the original index tree, and the gate's exact contents. Only the requested
module, its tests, and README changed. Independent assertion cases covered
empty/whitespace labels, normalized duplicates and order, zero, inclusive
bounds, and equal bounds. Native transcripts show skill loading, commands, and
fresh review delegation; Codex child-session metadata confirms separate reviewer
contexts. CLI exit zero was not used as a substitute for these checks.

Review was inspection-only where the host reviewer did not rerun tests; its
own report distinguishes parent-provided execution evidence. Claude performed
an extra review even after the failing gate, then correctly reported BLOCKED;
Codex stopped before review. Both respect the terminal requirement, although
Claude used an unnecessary extra review call in that refusal scenario.

These are small fixture evaluations, not a comparative model benchmark or a
certificate for all repositories. User-level installation links use the same
mechanism but were not the fixture discovery path. Reviewer-driven correction
was exercised on this repository by the independent migration review above.
The two-round exhaustion scenario has not been executed end-to-end. Other
hosts, Windows/WSL, alternative models, provider endpoints, and interrupted
session recovery are untested. Raw fixture/session logs stay outside Git.

## Local package verification

- `node --test tests/*.test.mjs`: 7 passed, no skipped or failed tests.
- Skill-creator `quick_validate.py`: passed, using temporary PyYAML tooling
  outside this repository; no product dependency was added.
- `git diff --check`: passed.
- `gitleaks dir --redact --no-banner .`: passed; no detected leak.
- The live evaluations above test behavior; the seven maintenance tests check
  package shape, installation links, documentation links, legacy ignore
  protection, and governance. Neither test layer replaces the other.

Remote checks and the correction review remain pending at this point in the
append-only record.

## Correction review and local installation

The independent reviewer confirmed the P2 closure with real ignore probes,
reran all seven maintenance tests and the diff check, and found no remaining
material findings. It also matched the recorded digest to the current skill.
It did not rerun the live model evaluations or certify server-side settings.

The same skill was linked into the user's native Claude Code and Codex skill
directories. Both destinations were previously absent; neither configuration
nor existing skill was overwritten. The linked source bytes were read back
and matched. Start a new host session to use `/helix` or `$helix`.

The eight evaluation fixtures were also checked for out-of-scope changed or
new files. Their deltas contained only the three authorized files and, for the
regression case, the preserved pre-existing note.

## Published branch and remote verification

[PR #16](https://github.com/luisgui1757/helix-cc/pull/16) contains the replacement
on `feature/portable-helix-skill`. Implementation revision
`af9fa90f8244a45db626800cc6de7106f3411409` passed the
[CI run](https://github.com/luisgui1757/helix-cc/actions/runs/37099363093)
(Linux Node 22.19/26, macOS Node 22.19, dependency review, and aggregate `test`)
and [CodeQL analysis](https://github.com/luisgui1757/helix-cc/actions/runs/37099361284)
for Actions and JavaScript/TypeScript. The PR's check list is the source for
later head revisions; this entry records the specific revision observed.

GitHub approval is still required. No merge, release, branch-policy change, or
closure of existing dependency PRs was performed. Default-branch vulnerability
alerts are not claimed resolved by this unmerged replacement.

The eight temporary fixture repositories were archived outside Git with their
transcripts, acceptance results, and final patches, then removed. The obsolete
local dependency installation was also removed; package checks require no
repository dependency installation.
