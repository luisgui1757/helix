# Dispatch prompt: independent Helix CC multi-provider architecture evaluation

Copy the entire prompt below into a fresh, high-capability coding agent with
filesystem, shell, GitHub, and web access. The reviewer may write only the
requested `ROADMAP.md`; it must not implement, commit, push, merge, install, or
reconfigure anything.

```text
You are the independent principal engineer, provider-integration architect, and
reliability reviewer for Helix CC.

MODE: REVIEW, WITH ONE PERMITTED ARTIFACT.

You may inspect repositories, installed tools, public documentation, package
source, tests, Git history, and local status surfaces. You may run non-mutating
tests and disposable no-egress/mock experiments. Your only permitted repository
write is:

  <HELIX_CC_REPOSITORY_ROOT>/ROADMAP.md

You may create one dedicated disposable temporary root outside every user-owned
checkout for read-only clones, package extraction, synthetic fixtures, build
caches, sockets, and no-egress processes needed by the evaluation. Use generated
fixtures only and remove the temporary root when the evaluation ends.
`ROADMAP.md` remains the only permitted write
inside the target repository.

Do not edit implementation, configuration, lockfiles, existing documentation,
settings, provider account state, branches, remotes, issues, pull requests, or
releases. Do not commit or push `ROADMAP.md`. Do not install or upgrade global
software. Do not make paid/live provider calls without separate explicit
permission. Limit account checks to non-mutating status commands that return
capability classifications.

Provide an evidence ledger, explicit decision criteria, reproducible traces, and
concise evidence-based technical rationale.

MISSION

Perform a fresh, all-encompassing, independent technical evaluation of Helix CC
and produce a decision-complete technical roadmap for turning it into the best
achievable Claude-Code-native workflow surface while genuinely supporting, at
minimum:

- OpenAI models using an OpenAI/ChatGPT/Codex subscription where technically
  and account-policy valid;
- GitHub Copilot;
- Microsoft Azure AI Foundry;
- OpenRouter.

Also preserve first-class native Claude support. For Microsoft Foundry, keep two
different products separate throughout the evaluation:

1. Claude Code's native Microsoft Foundry backend for Claude deployments.
2. Azure AI Foundry/Azure OpenAI endpoints serving GPT or other non-Claude
   models.

"Support" must mean that the named provider really performs the assigned stage.
It is not enough to expose a model-shaped string, document a manual workaround,
detect an executable, or route the work silently back to Claude.

The final `ROADMAP.md` must be detailed enough for a new coding agent to
implement the complete recommendation without rediscovering architecture.
The eventual implementation must be ONE consolidated change on ONE fresh
non-default branch based on a verified current default-branch head, pushed
directly to the verified, user-approved Helix CC remote with NO pull request,
merge, force-push, tag, release, or partial release. The uniquely named remote
branch must not already exist. If the base, remote identity/visibility,
applicable rulesets, or branch-collision state drifts, the implementation agent
must stop and report it. The roadmap may define
internal workstreams/checkpoints, but it must not propose small sequential PRs
or knowingly incomplete intermediate deliveries.

OWNER REQUIREMENTS — DO NOT DILUTE

1. Helix CC should provide workflow/subagent behavior as close as technically
   possible to Claude Code's native quality: isolated contexts, controlled tools,
   explicit roles, parallel analysis, serialized writers, structured results,
   bounded remediation, resume/recovery, worktree correctness, progress, and
   independent cross-checking.
2. It must support at least OpenAI subscription, GitHub Copilot, Azure Foundry,
   and OpenRouter. Determine the right integration type for each; do not pretend
   every provider can use the native Workflow script's `agent()` global if it
   cannot.
3. Exact provider/model/effort selection is required. Any unavailable or
   unsupported assignment must fail before provider egress. No silent provider,
   model, effort, account, protocol, or mock fallback.
4. The system must be operable without committing machine-specific values, user
   paths, account-specific values, or prompt/result contents.
5. CLIProxyAPI is a serious candidate and must receive a source-level evaluation:
   https://github.com/router-for-me/CLIProxyAPI
6. The Claude Agent SDK (formerly Claude Code SDK) is a serious candidate and
   must be evaluated directly, including whether it exposes more appropriate
   programmatic subagent control than Workflow JavaScript.
7. Helix itself is the reference for strict multi-provider policy and objective
   gates, but Helix CC is not required to preserve a weak or duplicated design
   merely for similarity.
8. Evaluate native Workflow JavaScript, Claude Agent SDK, explicit peer agents,
   CLIProxyAPI sidecar/SDK, Codex CLI/SDK/app-server, Copilot CLI, Pi, and hybrids
   without pre-selecting a winner.
9. The complete implementation must ultimately be delivered together on one
   branch, without a PR. No "provider A now, provider B later" final state.

TARGETS AND EVIDENCE SEEDS

Inspect at least:

- Helix CC: https://github.com/luisgui1757/helix-cc
- Helix: https://github.com/luisgui1757/helix
- CLIProxyAPI: https://github.com/router-for-me/CLIProxyAPI
- Quintin Shaw dynamic workflows:
  https://github.com/QuintinShaw/pi-dynamic-workflows
- Michaelliv dynamic workflows:
  https://github.com/Michaelliv/pi-dynamic-workflows

Evidence seeds observed when this prompt was created on 2026-07-16:

- Helix CC main: `842fa87f5e1dd34c9de2d01ec7ece93e64b1b6b6`
- Helix main: `bb1c37f62ee1808a5c24bac06d975023f73dcb3b`
- router-for-me source commit: `09da52ad509e2c18e7b9540db3b98c2214c280aa`
- Quintin main: `75e0adff57188e5bed3ab7586742e5144a7c755c`
- Michaelliv main: `31b2aca0f1cb195aafbfc5e3ee2b8c83ad3f21a2`
- installed Claude Code: `2.1.210`
- installed Pi: `0.80.3`
- installed Codex CLI: `0.144.4`
- published `@anthropic-ai/claude-agent-sdk`: `0.3.211`

These are drift detectors only. Use `git ls-remote`, official APIs, or read-only
clones under the dedicated temporary root to record current heads, tags, package
versions, installed versions, and relevant policy/configuration status. Never
fetch into, reset, switch, or otherwise mutate a user-owned checkout. Evaluate the
current state if anything moved.

CURRENT HELIX CC CLAIMS ARE INPUT, NOT CONCLUSIONS

The repository currently contains a plugin manifest, one Workflow JavaScript
asset, role-agent Markdown, launch/doctor skills, a diagnostic binary, tests,
provider documentation, a prior delta analysis, and a prior recommendation.
Do not inherit their conclusions.

Use this anti-anchoring sequence:

1. Inspect current official Claude Workflow, subagent, Agent SDK, account connection,
   OpenAI, Copilot, Azure, OpenRouter, CLIProxyAPI, and Pi sources first.
2. Form an in-memory preliminary architecture and provider truth table before
   reading Helix CC's prior `docs/history/recommendation.md`,
   `docs/history/helix-claude-code-delta.md`, or `docs/providers.md`.
3. Inspect Helix CC code and tests, then test every prior claim against source or
   executable evidence.
4. State which preliminary conclusions changed after inspecting the repository.
5. Build the strongest case for at least two alternatives to the final choice
   and attempt to falsify the choice.

SOURCE HIERARCHY

For material claims, prefer:

1. Reproducible behavior from the exact installed/current version.
2. Source and tests at an exact commit.
3. Official vendor documentation and public SDK types/reference.
4. Release notes and package metadata.
5. Repository docs verified against code.
6. Clearly labeled inference or unresolved unknown.

Use current primary sources, including:

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
- official Azure AI Foundry/Azure OpenAI inference and model-catalog docs;
- https://openrouter.ai/docs/guides/coding-agents/claude-code-integration
- https://openrouter.ai/docs/guides/routing/provider-selection
- https://help.router-for.me/
- CLIProxyAPI current source, tests, config, help site, SDK docs, releases, and
  issues only where verified against code; and
- installed Pi ModelRegistry/AgentSession/provider documentation and source.

MANDATORY DEFINITIONS

Before scoring support, define and enforce these support tiers:

- NATIVE: the runtime officially supports the provider/model with its complete
  agent/tool protocol and no compatibility translation.
- GATEWAY: the runtime uses its normal agent loop through a documented compatible
  endpoint; protocol translation and process scope are explicit.
- PEER: a separate provider-native agent process/session performs the stage and
  returns a typed result to the orchestrator.
- ADAPTER: Helix CC owns a provider-specific protocol client and lifecycle.
- PROXY-TRANSLATED: a third-party proxy translates wire protocols or reuses CLI
  subscription sessions.
- CONFIGURED-ONLY: executable/environment/account connection presence is known, but
  entitlement, model availability, or call fidelity is unproven.
- UNSUPPORTED: no faithful path has been established.

For every provider, distinguish requested, resolved, effective, connected,
entitled, and live-proven states. Never collapse them into `ready: true`.

MINIMUM PER-STAGE PROVIDER CONTRACT

An integration does not count as working until the proposed architecture can
enforce and test:

1. Exact provider and model identity before egress.
2. Exact supported effort/reasoning semantics or an explicit managed mode.
3. Fresh role context with a known system prompt and repository context policy.
4. Role-specific tool allow/deny behavior.
5. Structured success and typed/stable failure with bounded repair.
6. Streaming or bounded output without deadlock/unbounded buffering.
7. Cancellation and timeout reaching the real provider/session/process.
8. Turn, call, concurrency, token, time, and where possible cost limits.
9. No silent account rotation, alias remap, retry to a different provider/model,
   reasoning clamp, or fallback.
10. Explicit working directory, sandbox/permission model, and writer conflict
    behavior.
11. Structural telemetry with no source, prompt, or result content.
12. Health/account/model proof separated from paid live-call proof.
13. Deterministic tests at the transport boundary and an opt-in bounded live
    contract test.
14. Terms/account-policy status documented from official sources, including
    unknowns; technical success alone is insufficient for production approval.

MANDATORY INVESTIGATION

## A. Evaluate Helix CC end to end

Trace:

- plugin discovery, manifest, asset packaging, skill invocation, and Workflow
  call construction;
- task/configuration confirmation, headless behavior, and every path where
  confirmation may be skipped;
- role definitions, prompts, models, effort, tools, turn limits, permissions,
  inheritance, skills, MCP, and working-directory behavior;
- competing planners, plan judge, builder, tester, documenter, reviewer,
  independent challenge reviewer, verifier, remediation, and final deterministic
  evidence check;
- `parallel` scheduling, writer serialization, structured schema, null/error,
  contradictory evidence, fence neutralization, and pass ceilings;
- workflow persistence, session/subagent transcripts, resume, process restart,
  worktrees, changed branches, and crash behavior;
- doctor probes, version checks, environment/settings inspection, account
  classification, and every overclaim/false-negative possibility;
- test harness fidelity versus actual Claude Workflow execution;
- packaging, plugin cache behavior, CI/release absence, install/upgrade path, and
  version compatibility;
- differences between current docs and executable behavior.

Run current deterministic tests and strict plugin validation if available.
Record exact results. A historical or unretained run is not current proof.

## B. Establish the native Claude boundaries

Determine from official docs, public SDK types, and disposable probes:

- whether Workflow JavaScript can choose a non-Claude provider per restricted
  script `agent()` call, separately from the top-level `Workflow` tool;
- whether model/effort are requests or enforceable effective bindings;
- whether workflow agents inherit process-wide gateway/provider environment;
- whether multiple Workflow agents in one script can target different gateway
  processes or only one process-wide backend;
- what top-level Workflow JavaScript can do directly: filesystem, process,
  network, deterministic gates, imports, state, and external peers;
- exact structured-output retry/repair semantics;
- approval, managed policy, headless, plan eligibility, and disablement behavior;
- journal/resume/crash semantics;
- subagent versus Workflow-agent versus agent-team behavior.

Do not equate a model alias accepted by Claude Code with proof that the named
provider executed the call.

## C. Evaluate Claude Agent SDK as the primary orchestrator

Inspect the current TypeScript and Python public APIs and build disposable probes for:

- dynamic `AgentDefinition` creation;
- per-agent model, effort, tools, permission mode, max turns, skills, memory,
  MCP, background, and working directory;
- concurrency, deterministic pipelines, explicit versus model-selected agent
  invocation, failure propagation, and subagent nesting limits;
- hooks, permission callbacks, deferral, approval, tool-output transformation,
  subagent lifecycle hooks, and cancellation;
- structured output, validation, and bounded repair;
- sessions, persistence, external storage, resume/fork, transcripts, and file
  checkpointing;
- budget/cost/usage/rate-limit/progress events;
- plugin loading and whether Helix CC's Workflow asset is callable or should be
  replaced by an SDK-native scheduler;
- per-query environment and whether separate concurrent SDK sessions/processes
  can independently use different gateways/provider account configurations;
- account connection through Claude subscription, API, Bedrock, Vertex, Microsoft
  Foundry, and custom proxies;
- the current Agent SDK account policy for third-party products:
  distinguish first-party Claude Code/Workflow execution from a distributed
  Helix CC SDK host, and treat `claude.ai` subscription login/rate-limit reuse as
  unsupported absent documented Anthropic approval if the current policy still
  requires it;
- bundled runtime/version pinning, licensing, upgrade surface, sandboxing, and
  production deployment.

Compare at least three SDK designs:

1. One parent Claude SDK agent spawning Claude subagents and peer-provider tools.
2. A deterministic host scheduler running independent SDK queries per role.
3. A hybrid where native Claude roles use SDK sessions and non-Claude roles use
   provider-native peers behind one typed stage interface.

Answer whether using the SDK closes more of the Claude gap than the current
Workflow asset, and identify every invariant that would still require Helix CC
code.

## D. Evaluate OpenAI subscription paths

Evaluate separately:

1. Official Codex CLI connected through ChatGPT.
2. Official Codex SDK, including what runtime/account session it uses.
3. Codex `exec` as a subprocess boundary.
4. Codex app-server over stdio, local Unix socket, or localhost
   WebSocket, including its experimental/stable boundaries.
5. Official non-interactive account setup where available.
6. CLIProxyAPI's Codex subscription flow and compatible API translation.

For each, inspect session lifecycle, structured events, model/effort selection,
tools/sandbox/approval, cancellation, output schema, account selection, process
isolation, concurrency, backpressure, rate limits, subscription governance, and
support policy. Do not inspect account data files.

Do not assume CLIProxyAPI is necessary merely because it is popular. Do not
dismiss it merely because an official CLI exists. Compare source-backed
capabilities and tradeoffs. State exactly what the earlier official Codex-peer path
can do that CLIProxyAPI cannot, and vice versa.

## E. Perform a source-level CLIProxyAPI evaluation

Pin the exact current commit and inspect implementation/tests for:

- Codex and Claude subscription connection, renewal, import/export, account
  selection, and system-instruction transformation;
- OpenAI Responses, Chat Completions, Codex, Anthropic Messages, streaming,
  WebSocket, images, tools, parallel tool calls, thinking/reasoning, signatures,
  caches, and error translators;
- model discovery, aliases, prefixes, display names, excluded models, and stale
  catalog handling;
- retry classification, cross-account attempts, round-robin/fill-first,
  session affinity, cooldowns, quota switching, preview switching, automatic
  failover, and whether all can be disabled for exact Helix semantics;
- configuration shape, request/error logs, management API, control-panel
  behavior, in-process plugins, and update behavior;
- local sidecar lifecycle, health checks, readiness, graceful cancellation,
  crash/restart, configuration hot reload, and version pinning;
- embeddable Go SDK contracts, custom executors/translators/account providers,
  process ownership, and maintenance surface;
- concurrency, backpressure, maximum request/response size, timeouts, memory
  bounds, and resource-exhaustion resilience;
- license, maintenance velocity, release consistency, binary/source package
  parity, issue handling, and dependency compatibility;
- official account/subscription terms and any unknown/unsupported behavior.

Verify current configuration behavior from source, including logging,
management/control-panel features, plugins, retries, multi-account routing,
fallback controls, and version pinning.

Build a protocol-fidelity test plan with golden requests/responses for:

- bidirectional Anthropic Messages, OpenAI Responses, Chat Completions, and
  Codex fixtures proving system/developer/user role ordering, multiple system
  blocks, content-block boundaries, tool-call/result identity, cache controls,
  and zero proxy-added, replaced, or reordered instructions;
- Claude tool use translated to Codex/GPT and back;
- multiple/parallel tool calls;
- streaming deltas and early cancellation;
- extended thinking/reasoning and signatures;
- structured-output success, malformed output, and repair;
- context-window and max-output termination;
- rate-limit, account-session expiry, entitlement, quota, timeout, and upstream 5xx;
- images or other multimodal content if Helix CC exposes it;
- unknown models, aliases, model drift, and effort clamping;
- account exhaustion with fallback disabled;
- client disconnect and proxy shutdown.

## F. Evaluate GitHub Copilot support

Establish current official Copilot subscription connection and compare:

- Copilot CLI programmatic/non-interactive execution;
- the official GitHub Copilot SDK, including bundled-versus-local CLI ownership,
  typed sessions, streaming, persistence, model selection, permissions,
  cancellation, account-selection precedence, and version compatibility;
- the Copilot CLI ACP server's JSON-RPC/stdio lifecycle, multi-agent boundary,
  tool and effort scope, persistence, cancellation, and public-preview status;
- Copilot SDK BYOK as a distinct customer-key path for Azure AI Foundry and
  other supported compatible providers, never mislabeled Copilot-subscription
  execution;
- Pi's `github-copilot` provider;
- CLIProxyAPI upstream, plugin, or absence;
- community forks only as secondary leads;
- an explicit adapter using a supported official API, if one exists.

Prove model enumeration, exact model and effort, tools, permission controls,
structured output, working directory, cancellation, account status, and stable
errors. If official non-interactive account status is unavailable, specify a
bounded readiness/live proof. Do not call executable presence a connected account.
State which official surface, if any, is the canonical peer boundary and why.

## G. Evaluate Azure Foundry support

Produce two separate architectures:

- Native Claude Code/Agent SDK using Microsoft Foundry Claude deployments.
- Azure AI Foundry/Azure OpenAI GPT or other model deployments through a peer,
  compatible endpoint, Pi custom provider, CLIProxyAPI custom upstream/plugin,
  or explicit adapter.

For each, establish Entra/Azure CLI/API-key/managed-identity options, endpoint
and deployment identity, model catalog, reasoning/tool/streaming behavior,
account-session renewal, resource scoping, network configuration, timeouts, rate
limits, and readiness classification.

## H. Evaluate OpenRouter support

Compare:

- Claude Code process-wide Anthropic-compatible gateway mode;
- Claude Agent SDK sessions with isolated environment/gateway configuration;
- Helix/Pi ModelRegistry;
- CLIProxyAPI as upstream OpenAI-compatible provider;
- direct OpenRouter adapter.

Determine which OpenRouter models faithfully support Claude Code's Anthropic
Messages/tool/thinking behavior, which merely accept a compatible request, and
whether non-Claude models can satisfy the full workflow agent contract. Require
exact model identity and no provider failover when Helix CC requests exactness.
Evaluate OpenRouter's current underlying-provider routing defaults and controls,
including `only`/`order` or their current equivalents, `allow_fallbacks: false`,
`require_parameters: true`, quantization, retention/data-collection/ZDR policy,
and effective upstream provider/endpoint evidence. The requested tuple must
include both OpenRouter's model and the allowed upstream provider/endpoint
variant; reject mismatches and add negative tests proving exact runs never use
OpenRouter's permissive defaults.

## I. Design the common provider/session interface

Regardless of recommendation, specify a candidate typed boundary capable of
representing:

- provider, model, effort, account/readiness class, and transport;
- allowed account-source set, requested account slot, an opaque expected-account
  handle, effective-account match/mismatch,
  and an explicit `allowAccountRotation: false` policy with pre-egress and
  per-session revalidation; diagnostics may expose only structural classes;
- role/system/task prompt and mechanically fenced upstream data;
- working directory/worktree, tools, permission/sandbox policy, and writer flag;
- structured output schema and bounded repair policy;
- max turns, calls, input/output tokens, wall time, idle time, concurrency, and
  optional cost budget;
- cancellation signal and disposal acknowledgment;
- progress/tool events and structural usage;
- success, blocked, refused, unavailable, timeout, cancelled, malformed,
  provider error, and policy error;
- transcript/persistence class and retention policy;
- exact effective assignment evidence.

Show TypeScript interfaces or precise pseudocode in the roadmap. Explain how
each provider adapter implements the boundary and how the orchestrator prevents
one adapter's fallback/retry behavior from violating the contract.

## J. Reconcile workflow semantics

Compare the current Helix CC workflow, native Claude Workflow behavior, Claude
Agent SDK, and Helix strict loops across:

- deterministic scheduler versus model-selected delegation;
- parallel candidates and ordered synthesis;
- writer serialization and isolated worktrees;
- objective non-model gates;
- structured outputs and repairs;
- evidence contradiction checks;
- instruction-boundary framing for external content;
- task/config consent;
- headless behavior;
- cancellation/deadlines/budgets;
- session resume, process restart, leases, and crash recovery;
- structural events versus vendor transcripts;
- per-agent progress and steering;
- nested delegation;
- model/provider exactness.

Identify what can be mapped directly, what needs a host-level mechanism, what
must remain a documented gap, and what should be removed because it creates a
false sense of equivalence.

ARCHITECTURE OPTIONS TO SCORE

At minimum compare:

A. Keep current Workflow JavaScript and add peer tools/adapters.
B. Replace Workflow JavaScript with a Claude Agent SDK deterministic host.
C. Use Agent SDK for Claude roles and Pi for all non-Claude roles.
D. Use Agent SDK plus provider-native Codex, Copilot SDK/ACP,
   Azure, and OpenRouter adapters.
E. Use CLIProxyAPI as a localhost sidecar for some or all non-native providers.
F. Embed CLIProxyAPI's Go SDK behind a narrow local service or Node binding.
G. Delegate all mixed-provider work to Helix and keep Helix CC Claude-only.
H. Another architecture established by evidence.

For each option provide:

- exact requirement coverage and hard disqualifiers;
- runtime boundaries and account-session ownership;
- provider/protocol fidelity;
- Claude-mechanics fidelity;
- failure/cancellation/recovery semantics;
- portability and deployment;
- migration complexity;
- maintenance and version-drift surface;
- test strategy;
- strongest case for adoption;
- strongest case against;
- what evidence could change the decision.

Use weighted scoring only after hard requirements. Show sensitivity analysis and
do not let totals conceal a mandatory provider failure.

VERIFICATION

Run current deterministic tests and plugin validation. Use disposable generated
fixtures for probes. No paid/live egress is permitted. Account checks are
limited to status classifications.

Any local proxy probe must use a temporary configuration with generated test
values, make no upstream call, and be terminated and cleaned up afterward.

Record every check as passed, failed, skipped, timed out, unavailable, or not
permitted. A check not run is not evidence. Attempt to refute every material
finding before accepting it.

REQUIRED `ROADMAP.md` CONTRACT

Write `<HELIX_CC_REPOSITORY_ROOT>/ROADMAP.md`. If one exists, preserve useful
factual history but produce one canonical roadmap rather than competing files.
It must contain, in order:

1. Title, date, reviewer, target repository/SHA, and all evidence SHAs/versions.
2. Executive verdict and one-sentence target architecture.
3. Direct answers:
   - Can Helix CC meet the minimum four-provider requirement?
   - Which provider is native, gateway, peer, adapter, proxy-translated, or
     unsupported?
   - Should the orchestrator be Workflow JavaScript, Claude Agent SDK, Helix,
     custom host code, or a hybrid?
   - Should CLIProxyAPI be adopted, embedded, sidecarred, selectively used,
     rejected, or held behind a spike?
   - What does the current implementation incorrectly claim or omit?
4. Scope, constraints, permissions, and unverified/live-proof gaps.
5. Evidence ledger with exact sources, links, commands, tests, and results.
6. Required support definitions and per-provider acceptance criteria.
7. Current Helix CC end-to-end architecture/call/state diagrams.
8. Native Claude Workflow/subagent/Agent SDK reference behavior.
9. OpenAI, Copilot, Azure, OpenRouter, Claude, Pi, and CLIProxyAPI truth tables.
10. CLIProxyAPI source/protocol/runtime evaluation with exact locations and
    recommendation.
11. Complete workflow and provider capability delta matrix.
12. Material findings P0-P3, each with exact location, wrong behavior, evidence,
    source of truth, consequence, multi-location check, recommended fix,
    confidence, and attempted refutation.
13. Rejected findings/false alarms and why.
14. Architecture options, disqualifiers, scorecard, sensitivity analysis, and
    strongest alternative cases.
15. Final target architecture: components, dependency direction, runtime zones,
    provider interface, scheduler, state machines, persistence classes, error
    taxonomy, budget/cancellation propagation, and diagrams.
16. Provider-by-provider implementation specifications for Claude, OpenAI
    subscription, GitHub Copilot, Azure Foundry Claude, Azure Foundry/OpenAI GPT,
    and OpenRouter. Include account-session ownership, readiness, exactness, transport,
    lifecycle, tests, and live-proof gate.
17. CLIProxyAPI integration specification if recommended, including pinned
    version, runtime configuration, process manager, logging, updates, plugin
    policy, fallback disablement, health, shutdown, translation tests, and
    upgrade procedure.
18. Migration/data compatibility plan. Avoid an indefinite dual engine.
19. ONE-BRANCH IMPLEMENTATION PROGRAM. Internal workstreams are allowed, but
    the complete solution must ship together on one fresh non-default branch
    with no PR, merge, force-push, tag, release, or partial release. Require
    verified repository/remote identity, visibility, rulesets, absent
    remote-branch collision, preservation of user-owned work, a scoped
    diff, and current default-branch base before editing and again before push.
    Require an isolated worktree or clean disposable clone and post-push proof
    that the remote branch SHA equals the verified local commit and applicable
    checks ran. For every workstream include:
    - objective/source of truth;
    - exact files/modules to inspect, create, change, or delete;
    - interfaces, schemas, state transitions, and invariants;
    - implementation steps;
    - dependencies/order and parallelizable internal work;
    - focused tests, negative cases, and counterexamples;
    - documentation updates;
    - completion and rollback/removal criteria.
20. Test architecture: unit, contract, golden protocol, integration, corruption,
    cancellation, timeout, concurrency, worktree, crash/restart, no-egress,
    packaging, proxy protocol, provider readiness, and opt-in live matrices.
21. Exact cross-provider scenario matrix and expected outcomes. Include a
    representative plan/build/test/document/review loop using different provider
    families without hardcoding unverified model aliases.
22. Operational failure and data-flow model.
23. Account-policy/legal uncertainty register and production approval gates.
24. Observability/diagnostics design that returns structural classes only.
25. CI, packaging, internal marketplace/install, version pinning, upgrade,
    release, and rollback design.
26. Documentation checklist for README, STATUS, architecture, provider docs,
    skills, agents, workflow docs, AGENTS/rules, and rejected findings.
27. Uncertainty register with probability, impact, detection, resolution, owner,
    and stop condition.
28. Exact all-or-nothing verification commands and final definition of done.
29. Explicit non-goals and deferred items, each with justification—not vague
    "future work."
30. A final copy/paste `IMPLEMENTATION DISPATCH PROMPT` for a fresh coding agent
    to implement the entire roadmap on one fresh non-default branch, verify the
    exact remote/base/visibility/rulesets and absent branch collision, push
    without force, open no PR, never merge/tag/release the default branch,
    work in an isolated worktree or clean clone, preserve user-owned work, run
    all tests, verify the exact remote branch SHA and
    checks after push, and stop rather than ship an incomplete provider or
    compatibility compromise.

The roadmap must not call a provider supported until its acceptance criteria
are backed by source and tests. If live proof is not permitted, mark that final
gate pending; still make the implementation roadmap complete.

QUALITY BAR

- Prefer exact, fail-closed semantics over convenient fallbacks.
- Separate native, gateway, peer, adapter, and proxy-translated truth.
- Never confuse Claude-on-Foundry with GPT-on-Azure AI Foundry.
- Never confuse ChatGPT subscription connection with OpenAI API-key billing.
- Never confuse a compatible wire endpoint with complete agent-loop parity.
- Never call executable presence a connected account or model entitlement.
- Never include machine-specific or account-specific values in the roadmap.
- Never claim an OS sandbox from worktree or tool-policy behavior.
- Do not recommend overly permissive execution modes outside a real isolation
  boundary.
- Do not recommend account pooling, retry, aliasing, or fallback without showing
  how exact provider/model semantics survive.
- Do not use README popularity or stars as protocol proof.
- Do not weaken tests, suppress findings, hardcode outputs, or ship stubs.
- If two implementation paths remain genuinely tied, specify the smallest
  bounded source-level spike that decides between them and incorporate it as the
  first internal gate of the single implementation branch.

Stop only when `ROADMAP.md` is source-linked, internally consistent,
decision-complete, provider-complete, reliability-complete, and executable by a
fresh coding agent without access to this conversation.
```
