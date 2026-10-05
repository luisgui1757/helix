---
name: setup-helix
description: Configure native writer and reviewer model settings for Helix or second-opinion in Codex or Claude Code. Use when setting up or changing role preferences, not for delivering a code change.
---

# Set up Helix

Use the current host's settings. Do not install a router, change providers,
store credentials, or edit the shared skills to hold personal preferences.

Read the repository instructions and the relevant host reference:

- [Codex](references/codex.md)
- [Claude Code](references/claude-code.md)

Identify the host, configuration scope, desired writer and reviewer models,
and reasoning levels from the request and existing configuration. Ask only
for missing choices. Keep defaults when the user wants defaults; do not select
models or efforts on their behalf. Show any broader effect of a setting
before writing it. For another host, inspect its current native documentation;
do not invent configuration keys or claim compatibility from file syntax alone.

Inspect only relevant, non-secret configuration fields. Preserve unrelated
settings, instructions, comments, permissions, and hooks. Make the smallest
authorized edit, report its path and diff, and update repository documentation
when required. Repeating the same setup should leave the files unchanged.
Do not overwrite an existing role or resolve a conflicting preference by guess.
If the host requires approval for a protected configuration file, present the
exact pending edit through its approval flow. A denied edit remains pending;
do not switch tools or weaken permissions to get around it. Update documentation
only to describe what was actually saved.

The writer is the current session. Give the exact launch command for a requested
writer change; saving configuration does not switch the running session. Keep
model IDs literal when a version matters. Check supported settings against the
installed host and available model information. If a requested setting is
unsupported, stop without substituting another model or effort.

Distinguish **configured**, **verified**, and **unverified**. When execution
verification is authorized, launch a fresh session and a small read-only child
task without restating the saved reviewer settings in the prompt or spawn call.
Check native execution records for the resolved model and effort. Configuration
files, self-reports, and response timing are not proof. A runtime rejection
leaves verification blocked; do not silently change the saved choice to pass.

Report what was saved, its scope, what a new session must do, and which settings
were observed. Do not claim a full delivery workflow was tested by a dispatch
probe. Setup does not implement the user's feature or certify an audit.
