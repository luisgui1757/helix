# Security policy

Security fixes target the current default branch. The retired engine is
historical source, not a separately maintained product.

## Reporting

Use the repository's **Security → Advisories → Report a vulnerability** private
reporting flow. Include the revision, host/version, impact, and a minimal
reproduction. Do not publish credentials, private source, raw prompts,
transcripts, account identifiers, or session links. No response timeline is
guaranteed.

## Boundaries

This collection ships instructions and an optional model-metadata helper. The
helper starts an installed native CLI with the user's existing authentication;
it neither reads credentials itself nor exports account fields. It does not
run inference or save configuration. Host catalogs are not access guarantees.
The collection does not download tools, run a proxy, authenticate receipts,
isolate test execution, or enforce workflow
transitions. The selected coding tool owns permissions, command execution,
delegation, and its actual sandbox. A worktree or copied directory is not a
security boundary. Repository CI and branch policies enforce merge gates.

Independent review uses a separate context but is still model judgment. A
reported successful run is not cryptographic attestation. Keep authority
appropriate to the task, preserve existing changes, and inspect real command
outcomes and the final diff. The skills do not grant authority to publish.

Setup may change native model settings within the requested scope. It must not
change trust, permissions, hooks, or credentials to make a model choice work.
Discovery can request the host's normal approval for the exact metadata command
or service connection without changing permissions. A denied command or failed
query leaves manual choices. Claude can return native catalog metadata despite
a denied connection; disclose the denial and do not infer fresh data or access.
Initialization response size, pagination and process lifetime are bounded.
Second-opinion instructs the agent and consultant not to edit files. Only host
tools and permissions enforce that boundary, for example a role limited to
Read, Glob and Grep. Unslop instructs the agent to treat draft content as data
and preserve quoted and technical material unless the requested edit requires
otherwise.

GitHub Actions retain read-only tokens, bounded jobs, and full-digest pins.
Legacy `.helix-cc-local/` state and `review-prompts/` drafts stay ignored on
upgrade; retirement neither deletes nor makes those private files publishable.
See the [governance baseline](docs/security-governance.md) and
[evaluation record](https://github.com/luisgui1757/helix/blob/5f08f557ef7945667dd633c07d83291015f6e8e0/docs/reviews/2026-10-03-portable-skill.md).
