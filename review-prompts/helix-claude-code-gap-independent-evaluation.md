# Dispatch prompt: independent Helix-to-Claude workflow gap evaluation

Copy the entire prompt below into a fresh, high-capability coding agent with
filesystem, shell, GitHub, and web access. The reviewer may write only the
requested `ROADMAP.md`; it must not implement, commit, push, merge, install, or
reconfigure anything.

```text
You are the independent principal architect and technical reviewer for a
ground-up evaluation of Helix's workflow/subagent architecture.

MODE: REVIEW, WITH ONE PERMITTED ARTIFACT.

You may inspect repositories, installed tools, public documentation, package
source, tests, Git history, and local status surfaces. You may run
non-mutating tests and disposable no-egress/mock experiments. Your only
permitted repository write is one final file:

  <HELIX_REPOSITORY_ROOT>/ROADMAP.md

You may create one dedicated disposable temporary root outside every user-owned
checkout for read-only clones, package extraction, synthetic fixtures, build
caches, sockets, and no-egress processes needed by the evaluation. Use generated
fixtures only and remove the temporary root when the evaluation ends.
`ROADMAP.md` remains the only permitted write
inside the target repository.

Do not modify code, configuration, lockfiles, existing documentation, settings,
provider account state, branches, remotes, issues, pull requests, or
releases. Do not commit or push `ROADMAP.md`. Do not install or upgrade global
tools. Do not invoke a paid/live model or provider endpoint without separate,
explicit permission. Limit account checks to non-mutating status commands
that return capability classifications.

Produce an auditable evidence trail, explicit decision criteria, falsifiable
technical rationale, and concise evidence-based explanations.

MISSION

Independently determine the current technical distance between Helix's loops
and Claude Code's workflows/subagents, determine which gaps are worth closing,
and design the best architecture for closing them without assuming the answer.

The final `ROADMAP.md` must be decision-complete and implementation-complete:
another capable coding agent, using only that file and the cited sources, must be
able to implement the recommended end state without this conversation.

The eventual implementation will be delivered as ONE consolidated change on
ONE fresh non-default branch based on a verified current default-branch head,
pushed directly to the verified, user-approved Helix remote with NO pull
request, merge, force-push, tag, or release. The uniquely named remote branch
must not already exist. If the base, remote identity/visibility, applicable
rulesets, or branch-collision state drifts, the implementation agent must stop
and report it. Internal workstreams and checkpoints are allowed, but the roadmap
must not propose a sequence of small
feature PRs, partial releases, or "land this now, finish later" compromises. A
compatibility or transition mechanism is allowed only when the evaluation proves it
necessary and specifies its final-state ownership or bounded removal gate.
Nothing is shipped until the complete target architecture, migrations, tests,
documentation, and verification gate are present together on that branch.

USER REQUIREMENTS — INPUTS, NOT CONCLUSIONS

Treat the following as the product owner's requirements. Do not treat any prior
reviewer's recommendation as controlling:

1. Helix loops are intended to provide the workflow and subagent power of
   Claude Code while remaining genuinely multi-provider and multi-model.
2. A representative desired run may plan with two different high-reasoning
   models, implement with another model, test with another, and document with
   another. The owner's illustrative names include Opus 4.8 xhigh and GPT 5.6
   Sol/Luna/Terra at high or xhigh. These names may be aliases, future/unpublished
   names, or unavailable. Verify every effective provider/model/effort at review
   time; do not silently normalize an unknown name to a different model.
3. Required provider families include, at minimum:
   - Anthropic/Claude;
   - OpenAI models using a ChatGPT/Codex subscription where legitimately and
     technically supported;
   - GitHub Copilot;
   - Microsoft Azure AI Foundry, distinguishing Claude deployments from
     Azure OpenAI/GPT deployments;
   - OpenRouter.
4. Provider/model/effort selection must be exact and observable. An unavailable
   tuple must fail before provider egress. No fallback to another provider,
   model, effort, account, mock, or session default may be silent.
5. The goal is not to imitate Claude Code cosmetically. The goal is to close the
   meaningful technical delta in orchestration quality, context isolation,
   lifecycle, recovery, observability, and developer experience.
6. Helix already contains substantial custom workflow, stage-machine, provider,
   worktree, objective-gate, persistence, and testing machinery. Determine what
   is genuinely good, what is duplicated badly, what is missing, and what should
   be replaced. Do not preserve it merely because it exists.
7. Evaluate all serious architectural outcomes without favoring one in advance:
   - continue and harden Helix's hand-written Pi-backed protocols;
   - rebuild orchestration directly on the Claude Agent SDK (formerly called
     the Claude Code SDK), if its public contract is sufficient;
   - drive Claude Code's native Workflow JavaScript surface;
   - adopt or adapt Quintin Shaw's dynamic-workflows package;
   - adopt or adapt Michaelliv's dynamic-workflows package;
   - use CLIProxyAPI or another compatible gateway/sidecar;
   - build a hybrid with explicit provider adapters;
   - or replace the current architecture with another evidence-backed design.
8. The recommendation must optimize for canonical correctness and durability,
   not minimal diff size, familiarity, sunk cost, or the previous review's view.
9. Directly answer whether Helix's current workflow/subagent approach is closer
   to Claude Code than either dynamic-workflows repository. Do not force one
   global yes/no where the evidence differs: compare lifecycle mechanics,
   context isolation, orchestration semantics, provider breadth, reliability,
   recovery, observability, and operator UX separately before the final answer.

PRIMARY TARGETS

Resolve the local checkout paths rather than assuming them. At minimum inspect:

- Helix: https://github.com/luisgui1757/helix
- Helix CC: https://github.com/luisgui1757/helix-cc
- Quintin Shaw fork/package:
  https://github.com/QuintinShaw/pi-dynamic-workflows
- Michaelliv original:
  https://github.com/Michaelliv/pi-dynamic-workflows
- CLIProxyAPI: https://github.com/router-for-me/CLIProxyAPI

Evidence seeds observed when this dispatch prompt was created on 2026-07-16:

- Helix main: `bb1c37f62ee1808a5c24bac06d975023f73dcb3b`
- Helix CC main: `842fa87f5e1dd34c9de2d01ec7ece93e64b1b6b6`
- Quintin main: `75e0adff57188e5bed3ab7586742e5144a7c755c`
- Michaelliv main: `31b2aca0f1cb195aafbfc5e3ee2b8c83ad3f21a2`
- router-for-me source commit: `09da52ad509e2c18e7b9540db3b98c2214c280aa`
- installed Claude Code: `2.1.210`
- installed Pi: `0.80.3`
- installed Codex CLI: `0.144.4`
- published `@anthropic-ai/claude-agent-sdk`: `0.3.211`

These are drift detectors, not checkout instructions. Use `git ls-remote`,
official APIs, or read-only clones under the dedicated temporary root to record
current default-branch SHAs, installed versions, release tags, and relevant
package versions before drawing conclusions. Never fetch into, reset, switch, or
otherwise mutate a user-owned checkout. If a target moved, evaluate the new state
and record the difference.

SOURCE HIERARCHY

For every material claim, prefer sources in this order:

1. Current executable behavior demonstrated by a reproducible test.
2. Current source and tests at an exact commit.
3. Current official vendor documentation or public SDK types/reference.
4. Current release notes and package metadata.
5. Repository documentation checked against implementation.
6. Clearly labeled inference.

Marketing copy, README feature lists, previous ROADMAPs, prior recommendation
documents, issue comments, and model memory are leads, not proof.

Use current primary sources, including at least:

- https://code.claude.com/docs/en/workflows
- https://code.claude.com/docs/en/sub-agents
- https://code.claude.com/docs/en/agent-sdk/claude-code-features
- https://code.claude.com/docs/en/agent-sdk/subagents
- https://code.claude.com/docs/en/agent-sdk/agent-loop
- https://code.claude.com/docs/en/agent-sdk/sessions
- https://code.claude.com/docs/en/agent-sdk/hooks
- https://code.claude.com/docs/en/agent-sdk/permissions
- https://code.claude.com/docs/en/agent-sdk/structured-outputs
- https://code.claude.com/docs/en/agent-sdk/plugins
- https://platform.claude.com/docs/en/agent-sdk/typescript
- https://platform.claude.com/docs/en/agent-sdk/python
- https://code.claude.com/docs/en/agent-sdk/overview
- https://learn.chatgpt.com/docs/app-server
- https://developers.openai.com/codex/sdk
- https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference
- https://docs.github.com/en/copilot/how-tos/copilot-sdk/getting-started
- https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server
- https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/configure-claude-code
- official Azure AI Foundry/Azure OpenAI inference and model docs;
- https://openrouter.ai/docs/guides/coding-agents/claude-code-integration
- https://openrouter.ai/docs/guides/routing/provider-selection
- https://help.router-for.me/
- the installed Pi package's public API, ModelRegistry, AgentSession, provider,
  thinking-level, tool, extension, and persistence documentation/source; and
- CLIProxyAPI source, tests, configuration, subscription connection flows,
  protocol translators, retry/routing logic, SDK docs, and operational defaults.

BIAS-CONTROL PROTOCOL

The Helix CC repository contains prior analysis and recommendations. Prevent it
from anchoring the result:

1. First inspect Helix, Claude Code/Agent SDK, Pi, the two dynamic-workflows
   repositories, CLIProxyAPI, and official provider documentation.
2. Before reading any prior Helix CC recommendation/delta/roadmap prose, write a
   temporary in-memory preliminary requirements ledger, option set, scores, and
   likely recommendation. Do not persist raw scratch data.
3. Then inspect Helix CC's executable implementation, tests, and documentation.
   Treat its claims as hypotheses. Record in the final roadmap which preliminary
   conclusions changed, and exactly which evidence changed them.
4. For each favored architecture, construct the strongest plausible case for at
   least two alternatives and attempt to falsify the favored option.
5. Separate "closest to Claude mechanics," "closest to the owner's required
   outcome," "most reliable," "most provider-neutral," and "lowest maintenance." Do
   not collapse those axes into one subjective ranking.
6. Do not award points for names, similar syntax, README claims, or test count
   alone. Score demonstrated semantics.

MANDATORY INVESTIGATION

## A. Reconstruct Helix from code

Trace the complete current lifecycle from command input to terminal result:

- onboarding, settings, profiles, workflow definitions, templates, and builder;
- validation, registry loading, route/matrix/preset resolution, and exact cast;
- consent, configuration binding, task hashing, run-directory timing, and
  pre-egress checks;
- candidates, panels, concurrency, writer serialization, judge, synthesis,
  verifier, revision, and objective gate;
- role prompts, context construction, upstream output, artifacts, and
  tool restrictions;
- Pi ModelRegistry resolution, account-status checks, provider aliases, model identity,
  effort/thinking capability, session creation, cancellation, and disposal;
- worktree creation, ownership, collision behavior, retained changes, merge
  expectations, and cleanup;
- checkpoints, leases, event ordering, resume, task-bound named workflow resume,
  crash states, terminal reconciliation, and corruption handling;
- observability, logs, task/prompt/result persistence, usage, progress, and
  diagnostics;
- objective command/file gates and the boundary between model judgment and
  deterministic evidence;
- mock/no-egress, static load, runtime discovery, real-provider proof, package,
  governance, and repository-scope test layers.

Produce source-linked state diagrams and call graphs in `ROADMAP.md`. Identify
dead paths, duplicated abstractions, test-only production-looking adapters,
implicit contracts, mismatch between docs and execution, and behavior that is
correct only by convention rather than enforcement.

## B. Reconstruct Claude Code workflows and subagents at implementation depth

Do not return a generic feature summary. Establish, with versioned evidence:

- Workflow script sandbox/module contract and allowed imports/effects;
- exact installed/public Workflow tool wire contract and boundary validation,
  including `args`, `scriptPath`, `resumeFromRunId`, malformed/unknown fields,
  output, `runId`, `transcriptDir`, null/error shapes, and public versus internal
  fields;
- the restricted-script `agent()` global, separately from the top-level
  `Workflow` tool; structured outputs, retry/repair semantics, null/error
  behavior, cancellation, timeouts, token/cost limits, and progress events;
- `parallel`, `pipeline`, ordering, concurrency, fan-out/fan-in, and failure
  propagation;
- model and effort request semantics versus effective model selection;
- subagent context inheritance and omissions, system prompts, CLAUDE.md/rules,
  skills, memory, MCP, tool restrictions, permissions, hooks, and nesting;
- worktree isolation, changed-branch retention, merge behavior, and cleanup;
- workflow journal/session/subagent transcript persistence, resume, fork,
  same-process versus cross-process behavior, and crash recovery;
- agent teams versus subagents versus Workflow agents versus independent
  background sessions;
- attended approvals, headless behavior, managed settings, policy, plan
  eligibility, account-selection precedence, and every path where confirmation or
  policy enforcement differs;
- observability, last action, tool history, usage/cost, duration, stalling,
  steering, and transcript access;
- stable public API, experimental behavior, installed-only behavior, and
  undocumented observations. Label each distinctly.

Use small disposable experiments where documentation is ambiguous. Do not
reverse-engineer proprietary code beyond what the license and public installed
artifacts allow.

## C. Evaluate the Claude Agent SDK as a direct Helix substrate

This is a first-class architectural question, not a documentation footnote.
Determine what the current TypeScript and Python SDKs actually expose and what
they do not:

- programmatic `AgentDefinition` fields and dynamic agent creation;
- per-agent model, effort, tools, disallowed tools, permission mode, MCP,
  skills, memory, max turns, background operation, and working directory;
- parent/subagent context isolation; versioned nesting depth; Agent-tool
  availability, context/tool/permission inheritance, and recursion controls at
  each level;
- explicit invocation versus model-selected delegation;
- concurrent queries/subagents, pipeline construction, deterministic scheduling,
  cancellation, backpressure, and error propagation;
- structured output and bounded repair;
- hooks, permission callbacks, defer/resume, approvals, and user input;
- session persistence, external storage, resume/fork, file checkpointing, and
  cross-process recovery;
- budgets, usage/cost telemetry, rate limits, progress, and transcript access;
- plugin/skill/agent loading and whether native Workflow JavaScript is callable,
  reusable, or meaningfully composable from SDK applications;
- account connection and provider backends, including Claude subscription, API,
  Bedrock, Vertex, Microsoft Foundry, and configurable gateway environment;
- the current Agent SDK account policy for third-party products:
  distinguish first-party Claude Code execution from a distributed Helix SDK
  host, and treat `claude.ai` subscription login/rate-limit reuse as unsupported
  absent documented Anthropic approval if the current policy still requires it;
- whether separate SDK processes/sessions can independently use distinct gateways or
  provider environments per stage;
- licensing, distribution, bundled Claude Code runtime, version pinning,
  upgrade compatibility, and production sandbox requirements.

Answer explicitly:

1. Can the SDK reproduce the Claude workflow/subagent lifecycle more faithfully
   than Helix's current Pi protocols?
2. Can it preserve Helix's exact multi-provider requirement, or does it only
   provide Claude-backed agents unless combined with proxies/peers?
3. Is native Workflow JavaScript, SDK orchestration, or a hybrid the better
   reference architecture?
4. Which Helix invariants would be gained, lost, or moved into custom code?
5. What executable spike would disambiguate every uncertain SDK claim?

## D. Evaluate both pi-dynamic-workflows implementations

For each exact current commit, inspect implementation and tests rather than
README prose. Compare:

- workflow language and validation;
- exact provider/model/effort binding;
- agent lifecycle and context isolation;
- panels, pipelines, concurrency, cardinality, and failure semantics;
- structured output and retries;
- budgets, timeout/cancellation, and overshoot behavior;
- worktrees and mutation conflicts;
- persistence, resume, leases, journaling, and crash states;
- consent/headless execution behavior;
- provider/tool policy and nested delegation;
- event-recording and retention modes;
- Pi version/peer dependency compatibility;
- extension/UI quality and operational manager;
- license/notice compatibility, published package/tarball contents, registry and
  source parity, dependency compatibility, release consistency, and update policy;
- maintainability, release health, bus factor, and migration cost.

Do not limit the options to "adopt" or "reject." Evaluate use as canonical
engine, internal library, adapter, source of selectively ported mechanisms,
test oracle, or no dependency. Unresolved license incompatibility or unverifiable
published-artifact/source parity is a hard adoption disqualifier.

## E. Evaluate provider architecture, including CLIProxyAPI

Build a provider-by-provider truth table for Anthropic, OpenAI subscription,
OpenAI API, GitHub Copilot, Azure Foundry Claude, Azure Foundry/OpenAI GPT, and
OpenRouter. For each path record:

- exact account-connection mechanism and whether subscription reuse is official,
  third-party, inferred, or unsupported;
- effective provider/model/effort discoverability and proof;
- wire protocol and translation layers;
- tools, streaming, structured output, thinking/reasoning, images, context,
  caching, rate-limit, cancellation, and error fidelity;
- per-stage routing versus process-wide routing;
- retry, account rotation, aliasing, and fallback behavior;
- allowed account sources, an opaque expected-account handle,
  effective-account match/mismatch, and whether account rotation can be disabled
  and revalidated before egress and per session;
- terms/account-policy uncertainty and operational supportability;
- no-egress health/readiness proof.

Treat these as distinct candidate mechanisms:

- Pi ModelRegistry and in-process AgentSession;
- Codex CLI `exec`;
- Codex SDK;
- Codex app-server using a saved ChatGPT session;
- GitHub Copilot CLI;
- GitHub Copilot SDK, Copilot CLI ACP server, and SDK BYOK as separate
  subscription-versus-customer-key paths;
- native Claude Code cloud/provider backends;
- Anthropic/OpenAI-compatible gateway environment variables;
- CLIProxyAPI as a localhost sidecar;
- CLIProxyAPI embedded through its Go SDK;
- explicit HTTP/provider adapters;
- model-facing MCP tools that invoke peer agents.

For OpenRouter, include the requested model plus underlying provider/endpoint
variant in the exact tuple. Verify current `only`/`order`-style controls,
`allow_fallbacks: false`, `require_parameters: true`, quantization,
retention/data-collection/ZDR policy, and returned effective route. Add negative
tests proving exact assignments never inherit permissive routing defaults.

For CLIProxyAPI specifically, evaluate its current source and tests for Codex and
Claude subscription connection flows, upstream OpenAI-compatible providers, protocol translators,
model aliases, account pools, session affinity, retries, cooldowns, automatic
failover, management behavior, logging, control-panel behavior, plugins, and Go
SDK. Determine
whether GitHub Copilot and both meanings of Azure Foundry are actually supported
upstream, require a plugin/custom executor, or are absent. Do not infer support
from a downstream fork's README.

Do not assume that converting a GPT/Codex response into an Anthropic-compatible
response makes it behaviorally equivalent to a Claude Code subagent. Test or
design bidirectional golden tests for system/developer/user instruction ordering,
multiple system blocks, content boundaries, tool-call/result identity, zero
undeclared prompt transformation, tool calls, parallel calls, partial streaming,
thinking blocks, signatures, structured-output repair, abort, timeout, malformed
output, context limits, and stable error classification.

## F. Evaluate the existing Helix CC backport

Treat Helix CC as executable evidence, not merely prior prose. Trace and test:

- plugin manifest, packaging, discovery, cache/install/update behavior, and
  minimum Claude Code version;
- the exact Workflow JavaScript input/output contract and every boundary where
  repository or upstream-agent text enters a downstream prompt;
- all role-agent definitions, skills, model/effort/tool/turn declarations,
  writer serialization, structured schemas, remediation ceiling, and final
  deterministic gate;
- launcher and doctor behavior, account/readiness classifications,
  managed-policy uncertainty, and false-ready/false-negative paths;
- deterministic tests, strict plugin validation, installed boundary probes,
  historical claims, retained transcripts, and every gap between mock/static
  evidence and current live installed behavior; and
- which backported mechanisms should be retained, moved into Helix, rebuilt on
  Workflow or Agent SDK APIs, or removed to prevent false parity claims.

Record exact locations and tests. The final recommendation must say whether
Helix CC is a reference implementation, complementary Claude-only surface,
future primary host, replaceable experiment, or source of selective mechanisms.

## G. Compare semantics, not labels

Create a delta matrix with at least these rows:

- declarative closed workflow definition;
- arbitrary code workflows;
- isolated fresh contexts;
- explicit per-role prompt/system context;
- exact provider/model/effort binding;
- multi-provider stage mixing;
- structured output and bounded repair;
- deterministic objective gate;
- fan-out/fan-in and ordered pipelines;
- writer serialization and edit-conflict policy;
- tool, permission, hook, MCP, skill, and nested-agent policy;
- context compaction and handoff framing;
- instruction-boundary behavior for external content;
- cancellation, deadlines, turns, calls, tokens, cost, depth, and concurrency;
- attended consent and headless fail-closed behavior;
- worktree creation, retention, merge, and cleanup;
- persistence scope, retention, and data shape;
- checkpoint, lease, journal, resume, fork, and crash recovery;
- per-agent progress, steering, transcripts, usage, and diagnostics;
- provider health/readiness and account-state accuracy;
- package/distribution/update model;
- test fidelity and real-provider proof;
- repository packaging and scope discipline.

For every row include: Claude reference behavior, Helix behavior, SDK/package/
proxy alternatives, exact gap, severity, source locations, test evidence,
recommended target, and confidence.

## H. Quantitative scoring without fake precision

Define explicit weights derived from the owner's requirements. Score each
architecture option on separate axes:

- Claude workflow mechanical fidelity;
- required multi-provider fidelity;
- exactness/fail-closed correctness;
- operational reliability;
- deterministic lifecycle/recovery;
- operator UX/observability;
- implementation and migration difficulty;
- long-term maintenance/version drift;
- testability and reproducibility.

Show the scoring rubric and evidence behind each score. Include sensitivity
analysis: explain whether a reasonable change in weights changes the winner.
Do not use a weighted total to hide a hard requirement failure. Mark any option
that cannot satisfy a non-negotiable requirement as disqualified regardless of
score.

VERIFICATION

Run the repositories' existing deterministic tests and structural gates where
practical. Record exact commands, counts, versions, duration, failures, skips,
timeouts, and unavailable checks. Tests from different commits are not directly
comparable by count alone.

Build minimal disposable probes for uncertain claims. They must:

- use mock/injected boundaries unless separately permitted for live egress;
- leave primary worktrees unchanged;
- avoid installers and global upgrades;
- inspect only account-status classifications;
- bind to localhost when starting a local service;
- use generated synthetic fixtures;
- clean up only artifacts the evaluation created; and
- produce stable, reproducible evidence suitable for `ROADMAP.md`.

Attempt to refute every P0/P1 finding and every major recommendation. A plausible
theory without a trace, source-linked validation, or clearly labeled unknown is
not an accepted finding.

REQUIRED `ROADMAP.md` CONTRACT

Write a new `<HELIX_REPOSITORY_ROOT>/ROADMAP.md`. If one already exists, preserve
its useful factual history but replace stale conclusions; do not append a second
competing roadmap. The file must contain, in this order:

1. Title, evaluation date, reviewer, repository, exact target SHA, and evidence SHAs.
2. Executive verdict in plain language.
3. Direct answers to:
   - How close is Helix to Claude Code workflows mechanically?
   - How close is Helix to the owner's required multi-provider outcome?
   - Is Helix closer to Claude Code than either dynamic-workflows repository,
     on which axes, and with what material exceptions?
   - What is the single recommended target architecture?
   - Should Helix use Claude Agent SDK, Workflow JavaScript, current protocols,
     either dynamic-workflows package, CLIProxyAPI, or a hybrid?
   - What must be removed, retained, rewritten, or added?
4. Scope, permissions, constraints, and verification limitations.
5. Evidence ledger with exact versions, commits, links, commands, and results.
6. Owner requirements and non-negotiable invariants, each with acceptance tests.
7. Current Helix architecture and end-to-end call/state diagrams.
8. Claude Code workflow/subagent/Agent SDK reference architecture, plus a
   separate current Helix CC backport map and retain/replace decision.
9. Provider/account-connection/protocol architecture and truth table.
10. Complete capability delta matrix.
11. Material findings, P0 through P3. Every finding must include exact location,
    wrong behavior, evidence/validation, source of truth, multi-location check,
    consequence, recommended fix, confidence, and attempted refutation.
12. Rejected findings and false alarms with rationale.
13. Architecture options, strongest case for each, disqualifiers, scorecard, and
    sensitivity analysis.
14. Final target architecture with component and runtime boundaries,
    dependency direction, data flow, state machines, adapter contracts, failure
    taxonomy, persistence classes, and cancellation/budget propagation.
15. Migration design from current state, including compatibility and data-shape
    decisions. Avoid dual engines unless a bounded transition genuinely needs
    one and has a removal gate.
16. ONE-BRANCH IMPLEMENTATION PROGRAM. It may contain ordered workstreams and
    internal checkpoints, but all work lands together on one fresh non-default
    branch with no PR, merge, force-push, tag, release, or partial release.
    Require verified repository/remote identity, visibility, rulesets, absent
    remote-branch collision, clean preservation of user-owned work, a scoped
    diff, and current default-branch base before editing and again
    before push. Require an isolated worktree or clean disposable clone and
    post-push proof that the remote branch SHA equals the verified local commit
    and applicable checks ran.
    For every workstream provide:
    - objective and source of truth;
    - exact current files/modules to inspect or change;
    - APIs, schemas, types, state transitions, and invariants;
    - old behavior and target behavior;
    - implementation steps;
    - focused tests, negative cases, and counterexamples;
    - documentation updates;
    - dependencies and ordering;
    - completion criteria;
    - rollback/removal strategy.
17. Test and evaluation architecture covering unit, integration, property,
    corruption, cancellation, concurrency, worktree, packaging, no-egress,
    provider-contract, SDK-compatibility, proxy-protocol, and opt-in live tests.
18. Exact benchmark/scenario suite comparing the target with Claude behavior,
    including expected observable outcomes rather than subjective impressions.
19. Operational failure model, including instruction-boundary behavior,
    repository input, localhost service lifecycle, logs, transcripts,
    dependencies, plugins, updates, and packaging.
20. Uncertainty register with probability, impact, detection, resolution, owner,
    and stop condition.
21. Documentation migration checklist for README, architecture, manual,
    workflows, provider docs, AGENTS/rules, status, and rejected findings.
22. Final all-or-nothing verification gate and exact commands.
23. Definition of done and explicit non-goals.
24. A final copy/paste `IMPLEMENTATION DISPATCH PROMPT` that instructs a new
    coding agent to execute the entire roadmap on one fresh non-default branch,
    verify the exact remote/base/visibility/rulesets and absent branch collision,
    push without force, open no PR, never merge/tag/release the default branch,
    work in an isolated worktree or clean clone, preserve user-owned work,
    verify the exact remote branch SHA and checks after push,
    and stop rather than ship a compromise.

The roadmap must use checkboxes only for real implementation work, not for
completed evaluation steps. Each checkbox must be testable. Identify which items can
run in parallel internally, but never convert them into separately shipped PRs.

QUALITY BAR

- Be skeptical without being performatively negative.
- State facts, judgments, assumptions, and unknowns separately.
- Tie confidence to evidence.
- Prefer canonical removal/rewrite over compatibility debt when justified.
- Do not recommend an abstraction without identifying the real duplication or
  contract it replaces.
- Do not call a local process an OS sandbox.
- Do not call configured accounts connected or entitled.
- Do not call requested model/effort values effective without runtime proof.
- Do not call mock/static/plugin validation a live-provider proof.
- Do not claim subscription use is supported solely because a sign-in flow works.
- Do not hide protocol translation loss behind "compatible API" wording.
- Do not weaken tests, skip gates, suppress diagnostics, or hardcode results.
- Do not include machine-specific or account-specific values in `ROADMAP.md`.
- If a conclusion depends on unavailable evidence, specify the exact spike or
  permission required to resolve it.

Stop only when `ROADMAP.md` is internally consistent, source-linked,
decision-complete, and detailed enough for a fresh coding agent to execute the
complete one-branch implementation without rediscovering the architecture.
```
