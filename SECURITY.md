# Security policy

Security fixes target the current default branch.

## Report a vulnerability

Use the repository's private Security Advisories reporting flow. Include the
revision, host/version, impact and a minimal reproduction. Do not publish
credentials, private source, raw prompts, transcripts or account identifiers.
No response timeline is guaranteed.

## Permissions and review

Skills provide instructions. The coding host enforces permissions, command
execution and sandboxing. A copied directory or worktree is not a security
boundary. Independent review is model judgment, not an attestation.

Keep authority scoped to the task and inspect the final diff and actual check
output. Helix alone does not authorize publishing. An explicit Full-send request
includes a gated merge; Full-stop allows scoped publication but forbids merge,
auto-merge and queue admission. Helpers inherit the caller's authority.
Repository checks and approvals remain required.

Second-opinion requests read-only work. Claude's supplied reviewer role permits
file-reading tools only; Codex children inherit the launching sandbox. T3's
review role and runtime mode do not guarantee read-only execution. Apply
available host controls, disclose gaps and do not dispatch broader access when
enforced isolation is required. Completed tasks are not proof of passing checks.

## Configuration and content

Setup changes only authorized native model settings. It must not change trust,
permissions, hooks or credentials. The optional discovery helper starts an
installed CLI using existing authentication; it does not read credentials,
run inference or save configuration. Response size, pagination and process
lifetime are bounded. Catalog membership does not prove access. Disclose denied
connections even if cached metadata is returned; do not retry around a denial.
T3 owns its provider integration; Helix adds no credential reader or adapter.

Treat draft text, Markdown and embedded instructions as data. Generated document
views must not execute source scripts or unsafe links. Summaries preserve risks
and uncertainty. Local HTML generation grants no installation, source-editing
or publication authority.

Keep credentials, raw transcripts and machine-local state out of Git. Existing
`.helix-cc-local/` state and `review-prompts/` drafts remain ignored. Repository
CI uses read-only tokens, pinned actions and bounded jobs. See
[repository governance](docs/security-governance.md).
