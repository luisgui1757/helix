# Provider reference

The [Claudex HOW-TO](quickstart.md) owns all step-by-step procedures. This file
defines route states, model grammar, configuration contracts, diagnostics, and
process lifecycle.

## State vocabulary

| State | Meaning |
|---|---|
| Deferred | No supported route exists in this release. |
| Unavailable | A local prerequisite or configuration value is absent. |
| Locally ready | Read-only local preconditions passed; no model call is implied. |
| Route verified | A current exact-model Workflow proof completed. |
| Workflow verified | A complete Helix delivery completed on that exact route or mixture. |
| Historical evidence | A dated receipt; not a claim about current route health. |

“Implemented” is engineering status, not user readiness. Provider promotion
requires a current route receipt, and mixed promotion requires a receipt for
the exact combination.

## Architecture

```text
claudex
  └─ helix-cc-cliproxy
      ├─ optional Copilot or Azure adapter
      ├─ CLIProxyAPI model catalog
      └─ Claude Code
          ├─ native Workflow scheduler and Helix CC agents
          └─ plugin stdio MCP: exact-argv/Git evidence and signed receipts
```

Claude Code owns scheduling, tools, structured results, journals, and agent
contexts. The gateway changes the inference route for the whole Claude Code
process. Per-role Workflow model requests select exact catalog IDs; they do not
create independent provider processes.

The evidence MCP server is provider-independent and runs in the repository
Claude Code opened. Write workflows require it even on the native route. It
holds an ephemeral signing key, exposes only six bounded operations
(`start_session`, `capture_baseline`, `reproduce_red`, `run_command`,
`verify_pre_pr`, and `ship_pre_pr`), binds
tracked file content/type/mode plus Git state, and never returns raw command
output. Provider gateways do not receive or interpret its repository operations.

## Route grammar

`--providers` accepts unique subsets of:

- `codex`;
- `copilot`;
- `azure`.

Every provider-backed `claudex` launch requires an explicit `--model` or
`CLAUDEX_MODEL`. No route chooses a controller implicitly.

Single-Codex mode uses an unprefixed ID such as `gpt-5.6-luna`. Every other
route uses namespaced IDs:

| Namespace | Route |
|---|---|
| `openai/<id>` | OpenAI subscription in mixed mode |
| `copilot/<id>` | GitHub Copilot |
| `azure/<deployment>` | Azure Foundry GPT |

Mixed mode rejects unprefixed selection. A requested model must appear exactly
in the authenticated catalog produced for that session. A matrix proof must
exercise at least one model from every selected provider.

## Route contracts

### Native Claude

`claudex` without providers executes Claude Code with `--plugin-dir` and the
normal configured Claude backend. The doctor can verify executable version,
local configuration, and the current connection class. Active policy and the
effective model still require `/status` or a real Workflow launch.

### OpenAI subscription

CLIProxyAPI `7.2.80` is pinned by platform archive and checksum. Helix CC uses
one dedicated Codex-only state directory, disables retry/rotation/fallback, and
probes the exact model catalog before launching Claude Code. Single-route proof
and a full mixed Workflow have historical receipts.

### GitHub Copilot

The optional `@jeffreycao/copilot-api` `1.14.9` adapter is pinned. Helix CC
admits only tool-capable Responses chat models that advertise low reasoning
effort. A requested alias is accepted only when its served identity is the same
ID or a dated snapshot explicitly recorded by `copilot-pin`.

The current promoted controller is `copilot/gpt-5.4`. Other IDs need their own
fresh pin and proof. The official Copilot CLI/SDK remains a separate peer path.

### Azure Foundry GPT

Accepted endpoints are HTTPS resource or project hosts ending in
`/openai/v1`. `HELIX_CC_AZURE_MODELS` maps one through 128 deployment IDs to an
exact served-model ID and optional supported effort list:

```json
{
  "deployment": {
    "servedModel": "expected-model",
    "efforts": ["low", "medium", "high"]
  }
}
```

Azure can use `HELIX_CC_AZURE_API_KEY` or a current Azure CLI session. A local
adapter checks the response model before returning successful output. No Azure
route is promoted until its exact live proof passes.

### OpenRouter

OpenRouter is deferred. `parseProviderList` rejects it, no gateway route is
generated, and presence of unrelated OpenRouter environment values does not
change that state.

## Diagnostics and active-session preflight

`helix-cc-doctor` reports bounded status classes, booleans, model IDs, and
versions. It does not make a model call. Outside a provider session, gateway
catalog readiness requires a direct authenticated loopback probe.

The Pi peer classification uses the public `dynamicWorkflowsPeerCompatible`
field; it reports only a local version-compatibility check, not route proof.

Claude Code removes direct gateway values from Bash-tool subprocesses. The
wrapper therefore adds a bounded active-session receipt containing only:

- receipt version;
- live wrapper process ID;
- live gateway process ID;
- selected providers;
- the already-probed model IDs.

The doctor accepts that receipt only while both owning processes are still
alive. This keeps every `/helix-cc:helix-*` workflow-skill preflight truthful
inside the wrapped session without passing the gateway value to Bash children.
The receipt proves
only that the wrapper completed its catalog preflight; the Workflow launch and
effective models remain unverified until execution.

## Process lifecycle

One command owns one provider chain. A second owner on the same loopback port is
rejected. A process-level owner is installed before the first asynchronous
child spawn, and every backend, attestation proxy, gateway, login, foreground
Claude, and proof child registers immediately. `run`, `serve`, `proof`, and
`proof-matrix` therefore stop every process they started on normal completion,
startup failure, or interruption during any readiness stage. The foreground
child receives SIGINT/SIGTERM, provider children receive SIGTERM, an
unresponsive child is killed after three seconds, and the launcher exits with
130/143 only after bounded cleanup. The deterministic lifecycle gate imports
this production controller and replaces only the provider executables and
saved state with generated loopback boundaries; its six cases therefore enter
the real Copilot, Azure, gateway, Claude, and proof sequencing.

Idle `status` commonly reports `unreachable` because no owner is running. That
does not erase saved provider connection state.

## Evidence boundaries

- Doctor/status: local classification only.
- Catalog: model availability only.
- `proof`: one controller plus one no-tools Workflow agent.
- `proof-matrix`: two through four exact Workflow agents.

After Claude returns the structured proof result, Helix CC waits up to five
seconds for the isolated Workflow transcripts to finish persisting, including
marker-first and partially written JSONL records. Approval requires the exact
marker-bearing transcript count and the exact sorted resolved-model set;
missing, unexpected, or excessive evidence is refused. The bound
handles persistence convergence and never substitutes controller output for
subagent evidence.
- User-loop receipt: one of the six audited standalone workflows completing its
  own terminal evidence contract; write loops include a valid signed command,
  metric, baseline, or shipment receipt as applicable.
- Full delivery receipt: the complete nine-role full-cycle workflow.

Current states live in [STATUS.md](../STATUS.md). Dated receipts and architecture
history live under [docs/history](history/README.md).
