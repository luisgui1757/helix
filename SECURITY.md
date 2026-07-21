# Security policy

Report vulnerabilities through GitHub's private security-advisory flow. Never
place credentials, private source, prompts, responses, account handles, or
session links in a public issue.

Helix validates closed WorkflowDefinition v4 data before persistence or
execution. Graph targets, conditions, paths, commands, tools, roles, attempts,
visits, cardinality, concurrency, time, effects, and bytes are bounded. Unknown
fields and future state versions refuse. Objective commands use a displayed
argv vector with `shell: false`; file paths are contained and exclude `.git`.

Attended preflight shows the task, workflow, repository, objective gate,
deadlines, exact cast, and any certified route/account reference. Execution
rechecks a hash over the workflow,
version-pinned subworkflows, profile, toggles, presets, and provider policy
before creating a run or calling a provider. No real path silently falls back
to mock, another provider/model/route/account, or a session default.

Every runtime requires a short-lived exact CapabilityAttestation. Installed,
configured, entitled, exact-capable, and live-certified are distinct states.
Requested-only evidence, stale policy, unverifiable effort/account, response
model substitution, deployment mismatch, and OpenRouter route substitution
refuse. CLIProxyAPI and Anthropic consumer OAuth are policy-blocked. Provider
credentials remain in Pi or the official client and never enter run records.

OpenRouter exact execution uses a per-session HTTP audit proxy bound only to
`127.0.0.1`. The proxy rejects outbound model/routing drift, forwards the
original request bytes with the certified credential, verifies model/route on
every streamed response, retains no content, and closes with the session. This
is a transport/audit control, not an OS sandbox or a general-purpose gateway.

Role output accepts one complete closed JSON object. Prose, fenced JSON,
trailing-object scans, and untyped verdict heuristics are refused. Repository
and agent content is provenance-framed data and cannot change tools, casts,
budgets, transitions, permissions, or gates.

Each run owns a Git worktree. Shared mutations serialize under private bounded
checkpoints. Isolated proposals use disposable Git worktrees, reject special or
oversized files, verify unchanged base state, and roll back failed promotion.
Worktrees protect Git state; they are not an OS sandbox, and Pi tools/objective
commands retain the user's local authority.

Effect completion requires response validation, workspace commit, budget
reconciliation, journal append, scheduler checkpoint, and workspace snapshot.
Resume requires the original task and fresh binding/attestation, restores the
exact private snapshot, and removes only uncommitted event/journal suffixes.
Corruption, wrong repository, missing snapshots, owner mismatch, task drift,
definition drift, runtime drift, and account drift refuse.

Public views contain structural events and hashes only. Raw tasks remain in
memory. Private scheduler snapshots are root-confined outside Git objects and
bounded by file count, individual size, total size, and closed state shape.
Transcript persistence is off by default.

CI uses deterministic injected provider transports and no credentials. The
active no-egress smoke runs with Docker `--network none`. Live certification is
separate, opt-in, pinned to one exact free OpenRouter model/route/account, and
never substituted.

Repository supply-chain policy requires full-SHA GitHub Actions, read-only
workflow tokens, dependency review, secret scanning with push protection,
GitHub-managed CodeQL, and immutable future releases. Routine version updates
have one owner in Renovate; GitHub-native Dependabot remains responsible for
advisories and security updates. The exact checked-in and live enforcement
contract is documented in [`docs/GOVERNANCE.md`](docs/GOVERNANCE.md).

The full-tree Gitleaks policy has one reviewed false-positive exception: the
40-hex value beside `router-for-me/CLIProxyAPI` in `ROADMAP_SOL.md` is a public
upstream Git commit, not an API credential. `.gitleaks.toml` limits that
exception to the exact value, path, and `generic-api-key` rule; no path-wide or
rule-wide suppression is permitted.

CodeQL alert #1 (`js/incomplete-url-substring-sanitization`) was a test-only
false positive: the assertion checked that a caller-supplied URL could not
appear in structural event fields; it was not URL sanitization. The regression
now asserts exact event-field values, matching the stable-code boundary without
using a substring-sanitization shape.

Supported security fixes target the latest release.
