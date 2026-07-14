# Security policy

Report vulnerabilities privately through GitHub's security-advisory flow for
this repository. Do not include credentials, private source, prompts, responses,
or session links in a public issue.

Helix keeps package resources immutable, stores mutable state under Pi's agent
directory, validates external input at command boundaries, and persists only
structural public-safe run metadata. Mutating operations require an attended
confirmation except for reversible feature toggles. Real-provider casts use
only exact provider/model entries already configured and available in Pi; they
never silently fall back to mock execution. The attended preflight exposes the
cast, task, repository, worktree setting, and bounded runtime before launch.
Execution rechecks a binding over the confirmed workflow/profile/toggles/presets
before effects. Whole-run cancellation reaches the runner and every provider
call deadline includes session/resource creation. Writer-bearing workflow
panels execute serially in the shared worktree.
Workflow output and gate paths reject malformed segments and protected `.git`
metadata before persistence; prompt substitution never rescans injected text.

Supported security fixes target the latest release. Reports should include the
affected version, impact, and a minimal reproduction that contains no private
data.
