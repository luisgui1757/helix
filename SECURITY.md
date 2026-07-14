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
panels execute serially in the shared worktree; read-only panels may use only
the configured bounded concurrency. Workflow output and file-gate paths reject
malformed segments and protected `.git` metadata before persistence. A command
objective check is displayed at consent, preflighted before save/run, executed
as a bounded argv vector in the run worktree with `shell: false`, and terminated
on timeout or whole-run cancellation. Personal workflow files cannot declare
other shell/filesystem effects. Prompt substitution never rescans injected text.

A Git worktree protects repository state; it is not an OS sandbox. Objective
commands and Pi tools retain the user's normal local authority, so personal
workflow definitions are trusted local configuration even though their shape,
size, paths, commands, and time bounds are validated. Runtime smoke tests use a
temporary detached worktree, make no provider calls, simulate objective results,
and remove only the worktree they created.

Supported security fixes target the latest release. Reports should include the
affected version, impact, and a minimal reproduction that contains no private
data.
