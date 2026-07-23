# Workflow catalog

This is the canonical catalog for Helix CC `0.5.x`. The source comparison used
base Helix `dispatch/config/chains.json` at `bb1c37f62ee1808a5c24bac06d975023f73dcb3b`;
the same chain catalog was present on Helix workflow-kernel revision
`77421126a63efa3f97be92bdbd4208ce4919a2da` when parity was implemented.

## Mode and parity map

Every public skill supports `original` and `graph`. Original is the default and
uses the existing audited script. Graph mode uses the generated script under
`workflows/graph/`; it accepts the same arguments and preserves observable
result and failure semantics. Mode is selected by exact script path before
launch, never by a mutable workflow argument. An omitted selection means
`original`; an explicit value other than exact `original` or exact `graph`
stops before preflight or execution.

| Base Helix chain or template | Helix CC skill | Workflow script | Mapping |
|---|---|---|---|
| `full-cycle` | `/helix-cc:helix-loop` | `helix-delivery.js` | Independent plans, plan judge, serialized implementation, testing, documentation, parallel review, evidence gate, bounded remediation |
| Guided `plan-implement` | `/helix-cc:helix-loop` | `helix-delivery.js` | The delivery loop is the stronger audited form of this guided template |
| Guided `implement-review` | `/helix-cc:helix-implement-review` | `helix-implement-review.js` | Starts with the settled implementation and retains the complete post-write evidence loop |
| `tdd-fix` and guided `tdd-fix` | `/helix-cc:helix-tdd-fix` | `helix-tdd-fix.js` | Test-only reproduction must exit non-zero before any production edit; exact final command gates green |
| `scout` | `/helix-cc:helix-scout` | `helix-scout.js` | Read-only reconnaissance followed by a decision-ready structured brief |
| `research` | `/helix-cc:helix-research` | `helix-research.js` | One falsifiable hypothesis and bounded experiment per pass; the signed typed measurement and test argv rerun after the documentation writer |
| `ship-pre-pr` | `/helix-cc:helix-ship-pre-pr` | `helix-ship-pre-pr.js` | Documentation, exact gate, dual review, verifier, then one commit/push/open-or-reuse-PR handoff; never merge |

Each row has a generated secondary script at
`workflows/graph/<workflow-script>`. The graph definitions, diagrams, and safe
construction rules are documented in [`graph-mode.md`](graph-mode.md) and
[`workflow-graphs.md`](workflow-graphs.md).

`helix-evidence-verify.js` is an internal child workflow, not another user
loop. It verifies the RSA signature and exact operation contract on receipts
created by the bundled `helix-cc-evidence` MCP server.

No base loop is represented by a documentation-only alias. Each distinct
behavior has an executable workflow and skill; the two guided templates that
are strict subsets share their stronger standalone implementation.

## Shared contracts

- Every skill is explicitly invoked and performs a doctor/catalog/model-proof
  preflight before a real provider-backed use.
- Workflow inputs reject unknown keys, invalid pass bounds, control characters,
  and unknown role bindings before the first agent starts.
- Model outputs cross structured, closed schemas and are fenced as untrusted
  data before later agents see them.
- Builders and documenters are serialized. Parallelism is reserved for
  independent read-only review stages.
- Delivery, implement-review, TDD, and research leave their verified changes in
  the working checkout. Their planners and write-capable roles must not stage,
  commit, push, open a pull request, tag, release, or rewrite history. Only the
  separately confirmed `ship-pre-pr` loop owns a Git/GitHub handoff.
- Every write loop receives the exact result of one fresh
  `mcp__plugin_helix-cc_helix-cc-evidence__start_session` call.
- Exact argv is executed without a shell by the bundled evidence service. The
  first argv element must be a PATH-resolved executable name with no slash or
  leading dash; repository-local scripts are arguments to an interpreter such
  as `node` or `bash`, never the executable element itself. Every public
  workflow applies this same grammar before its first agent starts. The
  service observes process outcome plus complete bounded tracked-file
  content/type/mode and Git state, signs the receipt, and never returns raw
  stdout or stderr. A file beyond the evidence size bound is refused rather
  than represented by a size-only surrogate.
- Approval requires a valid signed command receipt from the checkout after the
  pass's final writer, in addition to document/review evidence and the
  verifier's model-mediated decision.
- A v2 command receipt's before/after fingerprints and top-level
  `changedPaths` bracket only that exact argv. The separately signed
  `checkout.changedPaths` lists the final working-tree delta relative to HEAD,
  so reviewers can distinguish a non-mutating verification command from an
  absent implementation. Neither field implies that a non-shipping loop should
  commit. The RSA signature is transported as six fixed bounded chunks so a
  model courier cannot silently return a truncated proof that still satisfies
  the receipt schema. The empty-output digest is valid for a successful silent
  command. Every reviewer and verifier receives this semantic contract
  explicitly.
- A pass-bound exhaustion throws; it is never returned as successful work.
- Graph mode additionally validates reachability, exhaustive transition
  outcomes, registered operation identity, context availability, fork safety,
  entry-crossing bounded cycles, fresh evidence/gate requirements on every
  approval path, and an absolute execution-step ceiling before generation.
- Generated graph scripts embed their definition digest and cannot import a
  runtime module. `npm run graph:check` fails when scripts or diagrams drift.
- Original and graph write modes must not be compared in the same checkout.
  Deterministic parity fixtures use independent boundary state; a live
  comparison needs separate equivalent disposable repositories and fresh
  evidence sessions. Shipping is never compared through two live runs.

## Loop-specific inputs and invariants

### Full cycle / plan-implement

Inputs: `task`, exact `verificationArgv`, exact `evidenceSession`, `maxPasses`
(`1..5`), two to four optional planner models, and
optional models for the judge, writer, test, documentation, review, and verify
roles. Competing plans precede the only implementation writer. Each rejected
pass receives one remediation writer and repeats the entire post-write gate. A
correctness `replan` verdict reruns the independent planning panel and judge,
then rebuilds from the corrected plan before repeating that gate.

### Implement-review

Inputs: `task`, exact `verificationArgv`, exact `evidenceSession`, `maxPasses`
(`1..5`), and optional stage models. This is for an
already-decided direction: it deliberately omits competing plans but still
requires tests, synchronized Markdown, correctness and adversarial review, and
verification on every pass.

### TDD fix

Inputs: `task`, exact user-confirmed `testPaths`, exact `reproductionArgv`, exact `verificationArgv`, exact
`evidenceSession`, `reproductionPasses` (`1..2`), `maxPasses` (`1..5`), and
optional stage models. Before reproduction, the evidence service signs the
repository baseline, exact index tree, restorable signed test-file state, and
allowed Git-visible path set; ignored test paths are refused. The reproducer
has read/search tools but no direct write, edit, or shell capability; it
supplies complete test-file contents to the
trusted `reproduce_red` operation. That operation copies the checkout except
its Git metadata into a disposable repository, creates isolated Git metadata,
and redirects project, Git, HOME, and temporary process state into that copy.
It then applies the proposed signed test contents and runs the exact argv there.
Ignored-file, Git-internal, HOME, sibling,
infrastructure, green, and out-of-scope effects are discarded with the copy.
Only a non-empty exact proposed test delta is atomically applied back after a
normal exit `1..125` that changes no repository file while executing. Apply-back is
bound to the unchanged signed baseline and index, with signed-path rollback on
an apply failure. Directory names and test-like filename suffixes do not grant
scope. Exit `127` and command-start failures are infrastructure failures, never
red. The final gate requires a signed zero-exit receipt for the exact confirmed
verification argv with no repository mutation.

### Scout

Inputs: `task` plus optional scout/planner models. The scout agent has only
read/search tools; the planner has the same read-only boundary. Unlike base
Helix's host-persisted `BRIEF.md`, Claude Code returns the reconnaissance and
brief in the Workflow result so the loop remains provably non-mutating.

### Research

Inputs: `task`, named `metric`, typed `target` (`comparator`, finite numeric
`value`, and `unit`), exact `measurementArgv`, exact `testArgv`, exact
`evidenceSession`, `maxPasses` (`1..5`), optional `plateauAfter`
(`1..maxPasses`), and optional stage models. Each
pass forms a fresh hypothesis from prior evidence, runs one bounded experiment,
treats an expected target miss or remaining successor as evidence rather than
an execution blocker,
takes a preliminary signed measurement for the research ledger, serializes that
documentation write, then reruns the exact measurement and test argv against
the resulting final checkout before review and verification. The measurement
command must emit exactly one JSON object containing `metric`, finite numeric
`value`, and `unit`; the evidence service parses and signs it. The workflow
computes the comparator itself, so a role cannot convert a miss into
`targetMet: true`, and documentation cannot invalidate a previously met target
without the final measurement refusing approval. Approval also requires the
post-documentation signed zero-exit, non-mutating test receipt. The four
base-Helix terminal reasons are deterministic: `target-met`; `dead-end` when a
reviewed refutation has no successor; `diminishing-returns` after the optional
number of consecutive non-improvements; and `max-iterations` at the pass rail.
An unmet, non-refuted hypothesis may still carry a concrete successor; only a
refutation without one becomes a dead-end.
For `eq`, improvement means decreasing distance from the target. Target and
dead-end return `approved: true`; plateau and rail exhaustion return structured
`approved: false` results instead of throwing or pretending the target passed.

### Ship pre-PR

Inputs: completed `task`, exact GitHub `repository` slug, safe non-default
`headBranch`, safe `baseBranch`, exact `taskPaths`, exact
`verificationArgv`, separate exact repository-specific `releaseCheckArgv`,
exact `evidenceSession`, exact single-line commit message and single-line
pull-request title, exact pull-request body, `confirmOpenPullRequest: true`, and
optional stage models.
Confirmation is validated before any agent starts. The evidence service—not a
general Bash-capable shipper—must prove the exact requested GitHub origin and
head branch, freshly fetch the remote base, verify that base as an ancestor,
and prove an exact task-only working tree plus unchanged zero-exit general and
release-boundary checks, and `git diff --check`. After documentation, dual reviews, and
verification pass, its sole shipping capability stages only those paths,
creates one normal commit, performs one non-force push, and creates or reuses
the exact open pull request. Rename sources and destinations share one canonical
path representation through preflight and staged inspection; any pre-commit
refusal restores the exact prior index tree. Task paths accept at most one
leading `./`; absolute, empty-segment, dot-segment, backslash, and reserved
`.git` forms are rejected after normalization, and that
canonical representation is used by intent, preflight, receipt verification,
and shipment. PR reuse uses the installed GitHub
CLI's supported branch-only filter, then independently checks head owner,
repository, branch/SHA, and base. The signed terminal receipt binds origin/repository,
head branch/SHA, base, exact commit/PR text, draft/open/unmerged state, and the
remote SHA. It has no merge, close, approve, retarget, auto-merge, tag, release,
force-push, reset, or checkout operation.

## Runtime boundary

These scripts run inside Claude Code's Workflow harness and cannot execute a
host shell directly. The plugin therefore bundles an always-loaded stdio MCP
server with six narrow tools: `start_session`, `capture_baseline`,
`reproduce_red` inside a disposable repository copy, `run_command`,
`verify_pre_pr`, and `ship_pre_pr`. Its ephemeral
RSA private key never enters an agent or workflow argument. Agents transport
receipts, but cannot edit one without invalidating its signature; the internal
child workflow verifies the signature and exact expectation before approval.
Claude Code qualifies plugin MCP tools as
`mcp__plugin_helix-cc_helix-cc-evidence__<tool>`, so the evidence, reproducer,
and shipper definitions allowlist those installed names exactly. Internal child
workflow calls likewise use the installed `helix-cc:helix-evidence-verify`
name; unqualified names do not resolve from another plugin workflow.
Sessions live only for the owning MCP process and are bounded to 64 concurrent
session records and 256 signed receipts per session; restart Claude Code after
either explicit limit is reached.

The deterministic suite starts the packaged MCP process, runs real subprocess
and Git effects in disposable repositories, verifies signed receipts through
the actual workflow verifier, and separately exercises every user workflow.
Provider proof commands and live Claude Workflow receipts remain distinct and
are recorded in [`STATUS.md`](../STATUS.md).

The same workflow behavioral suites run once against original scripts and once
against graph scripts. A separate parity suite compares normalized inputs,
complete agent calls and responses, parallel grouping, child-workflow names and
arguments/results, terminal results, ordinary logs, and exact errors across
modes. Only an exact generated graph dispatcher trace for the compared workflow
is removed from the graph observation; ordinary logs beginning with `[graph:`
remain comparison inputs.
