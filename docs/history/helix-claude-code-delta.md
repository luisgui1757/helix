# Helix versus Claude Code: requirements, internals, and delta

Analysis date: 2026-07-15; OpenAI-subscription proof and Azure/Copilot routing
implementation added 2026-07-16.

## Executive conclusion

Claude Code can reproduce the **shape** of a Helix loop extremely well:
independent clean-context roles, per-role Claude model and effort requests,
parallel panels, serialized writers, structured output, bounded JavaScript
control flow, adversarial judges, worktree isolation, progress, and same-session
workflow continuation.

The restricted workflow script's `agent()` global always starts a Claude Code
harness agent, but that does **not** require Claude inference. A compatible
gateway can translate the harness's Anthropic protocol to another provider.
This repository now proves one such path end to end: CLIProxyAPI with a single
Codex OAuth subscription record ran `gpt-5.6-luna` as both the main model and a
native Workflow subagent, and Claude Code's subagent transcript recorded that
resolved model. GitHub Copilot and Azure Foundry GPT now have explicit,
provider-prefixed, model-attesting gateway implementations; their exact live
proof state is tracked independently. One complete mixed-provider delivery cast
now passed with `openai/gpt-5.6-luna` and `copilot/gpt-5.4`; Azure remains
boundary-tested but not live-proven, and OpenRouter is deferred. There is
also no top-level deterministic process/filesystem gate in workflow JavaScript,
so Helix's objective command/file gates remain stronger.

The right architecture is therefore two complementary surfaces:

1. Helix remains the strict, provider-neutral policy and execution engine.
2. Helix CC supplies the native Claude Code workflow experience for Claude
   backends and separately proven compatible-gateway models, using Claude
   Code's scheduler, context isolation, transcripts, same-session continuation,
   structured output repair, and UI.
3. Unproven non-Claude stages use explicit peer adapters or Helix itself. They
   must never silently fall back to another model.

## Evidence and scope

This analysis used fresh clones or local installed artifacts rather than the stale local Helix checkout:

| Surface | Exact evidence |
|---|---|
| Helix | audited base `ba2453ac4c3cad126f390b622348ec4e69495775`; repaired main `bb1c37f62ee1808a5c24bac06d975023f73dcb3b` via [PR #8](https://github.com/luisgui1757/helix/pull/8) |
| Claude Code | native `2.1.211`; strict plugin validation and headless Workflow proof |
| Claude production workflow examples | installed official `code-modernization` plugin workflows and agents |
| Claude public docs | current docs index and pages for workflows, subagents, agents, teams, worktrees, plugins, hooks, and providers |
| OpenAI integration | official local `openai-codex` Claude plugin `1.0.4`; Codex CLI `0.144.4`; current OpenAI manual |
| CLIProxyAPI proof transport | release `7.2.80`, commit `09da52ad509e2c18e7b9540db3b98c2214c280aa`; platform hashes pinned; one Codex-OAuth-only `gpt-5.6-luna` Workflow proof |
| Copilot translation | `@jeffreycao/copilot-api` `1.14.9`, commit `2b6b113a3aa137a3529e552aed4e30923b751f64`; npm integrity and start-module SHA-256 pinned; loopback patch plus exact-model attestation |
| Azure GPT translation | current `/openai/v1` resource/project endpoint contract; API-key and refreshing Azure CLI/Entra auth; deployment-to-served-model attestation; no live Azure configuration available |
| Pi | `0.80.3` |
| Quintin package | `@quintinshaw/pi-dynamic-workflows` `2.13.1`, SHA `b587566e30bc3befe15a6539584ec3d79c0c5caf` |
| Michaelliv package | `pi-dynamic-workflows` `1.0.1` source head `31b2aca0f1cb195aafbfc5e3ee2b8c83ad3f21a2` |

The installed Claude binary exposes some implementation facts that are not yet a stable public API contract. Those are labeled “observed” below and must be revalidated after upgrades.

## Helix's actual loop requirements

The following are not a generic description; they are the invariants encoded across `dispatch/lib/workflows.mjs`, `runner.mjs`, `stage-machine.mjs`, provider policy, resume/events, tests, README, and architecture/manual/workflow docs.

### Definition and lifecycle

- A workflow is closed declarative JSON, not arbitrary executable JavaScript.
- It has named stages, role panels, explicit steps, and complete transition coverage.
- Roles include scout, planner, builder, reviewer, red-team, verifier, judge, and synthesizer semantics.
- Transitions are explicit: approve, revise, revise-jump, objective gate pass/fail, advance, retry, back, and stop.
- `back` may target only an earlier stage.
- Definitions, stages, steps, transitions, runtime, calls, and iterations are bounded.
- User workflow definitions require stage artifacts in safe repository-relative locations outside `.git`.
- Save-time validation produces a lifecycle snapshot. A run binds an immutable definition digest rather than re-reading a mutable workflow mid-run.

### Consent and binding

- Before a real call, the operator sees and approves the exact workflow, profile, toggles, presets, and task.
- Consent is rechecked before creating the run directory or calling a provider.
- The exact task stays in memory; persistent metadata records only a task hash.
- Provider/model and supported explicit-thinking resolution is exact through
  Pi's `ModelRegistry`; `default` and `provider-managed` intentionally defer
  thinking-level selection.
- Real and mock casts may mix, but a failed real binding never degrades to mock.
- `claude-local` is reserved/non-automated; `mock` is deterministic.

### Execution and safety

- Each panel receives a fresh in-memory Pi session.
- Extensions, skills, templates, and themes are disabled for child sessions to prevent recursive harness activation; repository context remains available.
- Writer panels serialize. Read-only panels may run in bounded parallel.
- Tool availability is role-gated.
- Git worktrees are an edit-conflict boundary, explicitly not an operating-system sandbox.
- Every workflow has exactly one objective gate: argv-only `command-exit-zero` or contained `file-contains`.
- The command gate is preferred because it is independent of model prose.
- Stage artifacts and handoffs are durable.

### Recovery and observability

- The internal runner has checkpoints, leases, event-sequence validation, and
  crash-recovery machinery. Current task-bound named workflow commands
  intentionally refuse operator resume and require a fresh attended run.
- Records are structural and designed for public-safe sharing: no provider payload, raw prompt, task, or private source text.
- Workflow validation, deployment preflight, optional isolated mock smoke, and a real-task proof are distinct verification layers.
- Helix's “context engine” is a structural fresh handoff, not automatic compaction; Pi's normal compaction behavior is otherwise unchanged.

## Claude Code dynamic workflow internals

Anthropic made dynamic workflows generally available in May 2026 for eligible Claude Code surfaces. A workflow executes restricted JavaScript and coordinates separate Claude agents. Anthropic describes fan-out/synthesis, adversarial verification, generate/filter, loop-until-done, per-agent model selection, worktree selection, saved progress, and resume. See [the launch post](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code) and [the harness patterns article](https://claude.com/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code).

### Script contract

Current production plugin examples establish this shape:

```js
export const meta = {
  name: 'workflow-name',
  description: 'what it does',
  whenToUse: 'launch contract',
  phases: [{ title: 'Plan', detail: '...' }],
}

const result = await agent('self-contained task', {
  agentType: 'plugin:role',
  label: 'planner-1',
  phase: 'Plan',
  model: 'opus',
  schema: { type: 'object', /* JSON Schema */ },
})

return result
```

Observed globals in the inspected Claude builds are `agent`, `parallel`, `pipeline`, nested `workflow`, `args`, `budget`, and logging/progress facilities. Workflow scripts cannot import modules or directly access the filesystem/network. Standard deterministic JavaScript data functions remain available. Observed script size limit is 524,288 bytes.

`parallel` takes thunks, not already-started promises, and preserves input ordering. `pipeline` runs each item through sequential stages while items fan out. Agent schemas use JSON Schema and Claude Code retries/nudges a subagent that fails to call its structured-output tool; exhausting the repair limit fails rather than inventing a value.

The top-level runtime owns concurrency, progress, phases, token accounting,
abort, workflow backgrounding, and a run journal. `Workflow({scriptPath, args})`
runs a checked-in script. In the inspected runtime, `resumeFromRunId` continues
an interrupted run only while the owning Claude session and its workflow state
remain available. It is not evidence of cross-process crash recovery, a
repository lease, or Helix-style durable task resume. Observed Claude Code
behavior pins approved script content by SHA-256 and requires reapproval if the
script changed before that continuation.

The public Workflow input contract uses structured object/array values. This
backport treats an object as canonical and also accepts a JSON string as a
defensive compatibility shape before applying the same closed validation. The
string path is not described as the public or required invocation contract and
must be rechecked after Claude Code upgrades.

The runtime commonly prompts before a workflow first runs, and managed policy
can disable workflows. Prompting is not universal: headless/SDK use and
permissive approval modes can remove the interactive checkpoint. Script
approval is also not equivalent to Helix's deterministic exact-task/profile/model
binding. This plugin's launch skill adds a configuration confirmation step, but
direct Workflow calls can bypass it; it is instruction-enforced guidance, not a
separate trusted state machine.

### Workflow agent semantics

Each non-fork subagent starts with a fresh context. It receives its own prompt, the delegation task, repository `CLAUDE.md`/memory hierarchy, a git snapshot, preloaded skills, and—when configured—a sibling roster. Explore and Plan built-ins deliberately omit `CLAUDE.md` and git state; custom agents do not. See [subagent context details](https://code.claude.com/docs/en/sub-agents).

Agent definitions can set tools, disallowed tools, model, effort, max turns,
skills, memory, background behavior, and isolation. Plugin agents cannot apply
plugin-scoped hooks, MCP servers, or permission modes; Claude ignores those
fields. The workflow call can request a model for one agent, while role effort
comes from this backport's agent definition. A global
`CLAUDE_CODE_SUBAGENT_MODEL` value or managed model policy can supersede or
reject a request. Through CLIProxyAPI, the per-invocation value is also the
gateway model ID. The shipped helper removes the global override, requires
authenticated catalog membership, and checks the native subagent transcript;
that proves the bounded tested path, not a universal exact-binding guarantee.

Current Claude Code supports nested subagents through depth five. At depth five, the Agent tool is removed. Fork agents cannot fork again. This is newer than older documentation and summaries that said subagents could never spawn subagents; the current versioned docs are authoritative for `2.1.210`.

Subagent transcripts persist separately from the main conversation and survive main-context compaction. Named agents can be resumed with their full context and messaged using stable IDs/names. Cleanup defaults to the configured retention period. That is operationally stronger than returning a single opaque panel result, but it also means more raw task/code content persists than Helix's public-safe structural log.

### Worktrees

Claude subagents can request `isolation: worktree` or inherit it from agent frontmatter. Current Claude uses `.claude/worktrees`, locks active worktrees against cleanup, preserves changed/unpushed worktrees, removes unchanged worktrees automatically, and supports `.worktreeinclude` for explicitly copied gitignored files. See [worktree behavior](https://code.claude.com/docs/en/worktrees).

The important semantic difference is that changed worktree output is not silently merged into the parent. The caller must review and integrate it. The shipped Helix CC workflow therefore serializes its writers in the shared checkout. Parallel agents are read/review roles only.

### Agent teams and other parallel surfaces

Claude Code now has several different parallelism mechanisms:

| Mechanism | Context | Coordination | Isolation | Best use |
|---|---|---|---|---|
| Workflow agents | Fresh per call; structured return | Deterministic JavaScript harness | Optional per agent | High fan-out, bounded pipelines, judges, loops |
| Named subagents | Fresh or resumable per agent | Parent delegation and messages | Optional worktree | Focused specialists and large-output isolation |
| Agent teams | Independent long-lived teammate contexts | Shared task list and direct messages | Not automatic | Collaborative exploration/implementation with cross-talk |
| Agent view / background sessions | Independent sessions | Human dispatch/monitor | Session choice | Several unrelated long tasks |
| `/batch` | Multiple worktree sessions | Batch planner | Per worktree | Many independent code changes/PRs |

Agent teams remain experimental. Current documented limits include one team per session, no nested teams, fixed lead, permissions inherited at spawn, task-state lag, slow shutdown, and incomplete teammate restoration on resume. They are not a drop-in deterministic stage machine.

## Capability mapping

| Helix invariant or feature | Claude Code native mapping | Fidelity | Backport choice |
|---|---|---:|---|
| Closed declarative workflow | Restricted but arbitrary JavaScript | Different trade-off | One audited checked-in script; no user-authored raw JS surface in this plugin |
| Named stages and panels | `meta.phases`, per-agent phase labels, JS control flow | High | Six phases and explicit labels |
| Competing planners + judge | Parallel agents + structured synthesizer | High | Two to four planners, then independent plan judge |
| Exact role tool policy | Agent `tools`/`disallowedTools` | High for listed tools | Planner/judge/reviewer/red-team/verifier omit Bash and mutation tools; serialized writers retain only their required authority |
| Per-role model/thinking | Per-agent backend/gateway model request + agent effort | Medium-high for a proven route | Optional requested models; `high`/`xhigh` in delivery roles; authenticated catalog preflight; global/policy overrides disclosed |
| Mixed providers in one run | Per-agent IDs through one compatible gateway, or peer processes | High for the exact Codex/Copilot cast; unproven for Azure | A full nine-agent delivery passed with OpenAI-subscription `gpt-5.6-luna` and Copilot `gpt-5.4`; require a new receipt for every additional provider/model combination |
| Exact provider/model binding | Model allowlist/selection; gateway catalog; runtime transcript; policy arbitration | Medium for the proof, lower generally | Dedicated Codex-only auth plus exact catalog and transcript checks; no silent translation or universal upstream-identity claim |
| Bounded parallel readers | `parallel` plus runtime concurrency | High | Planning and review panels only |
| Serialized writers | Sequential `agent` calls | High | Builder, tester, and documenter never placed in `parallel` |
| Explicit approve/revise/back graph | JavaScript conditionals and bounded loops | Medium | One bounded remediation loop, not an arbitrary imported graph |
| Objective command/file gate | No top-level process/filesystem global | Low | Serialized tester evidence + read-only verifier + deterministic contradiction checks; still model-mediated |
| Stage artifacts | Repository files and structured returns | Medium | Actual repo edits plus structured reports; no enforced artifact path schema |
| Immutable definition digest | Runtime script SHA pin on approval/resume | High in observed build | Checked-in script + Claude runtime approval |
| Exact task/config consent | Workflow approval plus model-mediated launch confirmation | Low | Skill shows task/requests before launch, but direct/headless calls can bypass it |
| Fresh contexts | Fresh subagents; resumable named contexts available | High | Fresh agent per role/pass |
| Structural handoff | Self-contained prompts + schema objects | High | Every downstream report fenced as untrusted data |
| Worktree boundary | First-class locked worktrees | High | Not used for serialized shared-checkout writers |
| Durable resume | Same-session workflow journal plus separately retained subagent transcripts | Low-medium | `resumeFromRunId` is continuation, not Helix crash recovery; task-bound named Helix runs still start fresh |
| Leases/crash recovery | No equivalent repository-bound contract established | Low | Do not claim mapping; Helix retains its internal checkpoint/lease machinery |
| Public-safe structural logs | Full runtime/task/subagent transcripts | Low | Explicit privacy delta; no false equivalence |
| Deployment preflight/mock/real proof layers | Plugin validation, deterministic harness tests, live workflow test | High | All three are separate verification steps |

## What Claude Code has that Helix should consider backporting

These are candidate improvements, not claims that every item is absent everywhere in Helix. Each should be checked against the current Helix head before implementation.

1. **Structured-output repair as a runtime primitive.** Claude detects an agent that ended without the schema tool, nudges it in-context, and fails after a bounded repair count. Helix should make schema completion/repair a first-class panel policy rather than relying only on role prose.
2. **Resumable named subagent contexts.** Claude keeps each transcript separately, supports stable IDs/names, and can resume or steer one agent. Helix has internal checkpoint recovery, but task-bound named workflow invocation intentionally starts fresh; a selective “resume this reviewer with its prior tool history” surface could reduce repeated discovery.
3. **Bounded nested delegation.** Claude supports child agents to depth five with a hard tool removal at the limit. A Helix equivalent should be opt-in per role, share the global call/iteration/token limits, and never let a child escape provider/tool/worktree policy.
4. **Worktree lifecycle hardening.** Lock active worktrees, fail if requested isolation cannot be created, preserve any changed/unpushed branch, and distinguish unchanged cleanup from destructive cleanup. Add a controlled equivalent of `.worktreeinclude` only for explicitly allowlisted gitignored inputs.
5. **Per-agent progress history.** Claude surfaces last tool/action, structured-output repair, stalls, retries, phase tokens, tool counts, and agent duration. Helix's public record should remain redacted, but its private attended UI can expose safe operational summaries.
6. **Stable plugin distribution.** Claude plugins package skills, agents,
   commands, binaries, hooks, and MCP configuration. This plugin carries
   workflow JavaScript as an asset referenced by a skill; Helix CC's own tests
   validate its semantics. Marketplace installs use version-keyed copied
   caches, not a separately proven immutable-workflow component contract.
7. **Prompt-injection fencing in workflow composition.** Anthropic's production examples repeatedly frame source and upstream agent output as untrusted data and strip fence markers. Helix prompts should do this mechanically at every agent-to-agent boundary.
8. **Versioned runtime feature detection.** Claude distinguishes build capabilities such as workflows, nested agents, remote isolation, and provider models. Helix should prefer an explicit capability preflight over assuming that the installed Pi/provider supports a field.

## What Helix must retain

- declarative strict loops for auditable, statically bounded delivery;
- exact provider/model/thinking binding with no silent provider or mock fallback;
- an objective non-model gate;
- exact task/config consent before any side effect or provider call;
- structural, public-safe run records and task-hash-only persistence;
- provider-neutral execution through Pi's real registry;
- explicit artifacts and stage-machine transitions;
- separation of definition simulation, deployment preflight, mock smoke, and real proof.

Those properties are not incidental implementation details. They are precisely the controls lost if Helix is replaced wholesale by a raw JavaScript workflow package.

## Shipped backport architecture

The plugin in this repository implements the highest-fidelity native subset:

```text
/helix-cc:helix-loop
  -> verify observable local preconditions; disclose unverified policy; show exact task + requested models + bounds; ask advisory confirmation
  -> Workflow(scriptPath = workflows/helix-delivery.js)
       Plan:       planner[2..4] in parallel -> plan-judge
       Implement:  one shared-checkout builder
       Pass 1..N:  tester -> documenter -> reviewer + redteam -> verifier
       Revise:      one builder, then repeat the entire evidence pass
       Complete:    only if test report, docs report, both reviews, and gate pass

Optional OpenAI-subscription transport:

helix-cc-cliproxy
  -> checksum-verified CLIProxyAPI 7.2.80 on loopback
  -> dedicated Codex OAuth state; no Claude subscription required
  -> Claude Code native Workflow runtime
  -> per-role agent({ model: <authenticated catalog ID> })
  -> provider-proof marker + native subagent transcript before first use

Optional mixed transport:

helix-cc-cliproxy --providers codex,copilot,azure
  -> forced openai/, copilot/, and azure/ namespaces
  -> isolated Copilot credential and Azure endpoint/deployment configuration
  -> authenticated loopback attestation proxy per non-Codex provider
  -> exact upstream response-model match before successful output is forwarded
  -> the same provider-proof requirement for every exact namespaced model
```

Null agent results, invalid configuration, reported blockers, empty or whitespace-only command
evidence, failed command exit codes, reported failures or coverage gaps, missing
or blank documentation/review truth checks, open documentation drift, material review findings,
reviewer revision, contradictory verifier approval, and exhausted passes all
stop or revise. Agent outputs are fenced before being embedded downstream. The
tests execute the workflow under deterministic mock agents to prove ordering,
model-request forwarding, contradiction rejection, remediation, and boundary
behavior.

## Sources

- [Anthropic: dynamic workflow announcement](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code)
- [Anthropic: workflow patterns and limits](https://claude.com/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code)
- [Claude Code subagents](https://code.claude.com/docs/en/sub-agents)
- [Claude Code parallel agent surfaces](https://code.claude.com/docs/en/agents)
- [Claude Code agent teams](https://code.claude.com/docs/en/agent-teams)
- [Claude Code worktrees](https://code.claude.com/docs/en/worktrees)
- [Claude Code plugin reference](https://code.claude.com/docs/en/plugins-reference)
- [OpenAI Codex authentication](https://learn.chatgpt.com/docs/auth)
- [OpenAI Codex app-server](https://learn.chatgpt.com/docs/app-server)
- [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)
- [Helix CC OpenAI-subscription live proof](openai-subscription-proof.md)
- [OpenRouter Claude Code integration](https://openrouter.ai/docs/guides/coding-agents/claude-code-integration)
- [Microsoft Foundry Claude Code integration](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/configure-claude-code)
- [GitHub Copilot CLI programmatic reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference)
