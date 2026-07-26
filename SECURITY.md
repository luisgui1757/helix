# Security policy

## Supported versions

Security fixes target the current default branch and the latest published
release. Older revisions are not maintained separately.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting form:

1. Open the repository's **Security** tab.
2. Select **Advisories**.
3. Choose **Report a vulnerability**.

Do not open a public issue for a suspected vulnerability. Do not include
credentials, private source, prompts, responses, account identifiers, session
links, or provider payloads in an issue or discussion.

Include the affected revision and platform, impact, reproduction steps, and any
suggested remediation. Reports involving provider credential handling,
loopback boundaries, downloaded artifacts, repository mutation, GitHub Actions,
or pull-request effects are especially useful.

The maintainer will triage the report privately and coordinate disclosure after
a fix is available. No response or remediation timeline is guaranteed.

## Security boundaries

Helix CC treats provider credentials and account identity as private local
state. Public receipts contain bounded status, model, command, Git, and digest
facts rather than raw credentials, prompts, responses, or provider payloads.
Downloaded CLIProxyAPI archives and the optional Copilot adapter are version and
integrity pinned. GitHub Actions run without repository secrets, use read-only
permissions, install npm dependencies with lifecycle scripts disabled, and pin
every action to a full commit digest.

`setup.sh` never downloads or executes the mutable Claude Code installer. It
requires a supported preinstalled Claude CLI and directs users to Anthropic's
official installation and signed-manifest integrity-verification guidance.

These controls do not turn provider processes, repository commands, or Claude
Code tools into an operating-system sandbox. They retain the invoking user's
local authority, as documented in the provider and workflow references.
