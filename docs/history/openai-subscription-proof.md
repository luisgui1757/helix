# OpenAI subscription inside Claude Code Workflow: live proof

Proof dates: 2026-07-16; revalidated from canonical `main` on 2026-07-18.

## Verdict

**Proven for the bounded tested path.** Claude Code can run its native dynamic
Workflow scheduler and subagent harness with GPT inference backed by an OpenAI
subscription. The working path is Claude Code -> Anthropic Messages/tool
protocol -> loopback CLIProxyAPI translation -> Codex OAuth subscription.

This corrects the earlier claim that OpenAI-subscription work could participate
only as a peer process. Peer Codex remains an option, but it is not the only
option.

## Exact proof configuration

| Component | Effective value |
|---|---|
| Claude Code | `2.1.211` |
| CLIProxyAPI | `7.2.80`, commit `09da52ad509e2c18e7b9540db3b98c2214c280aa` |
| Upstream auth class | Exactly one Codex OAuth subscription record in a dedicated local directory |
| Claude subscription in proof config | None |
| Main model | `gpt-5.6-luna` |
| Workflow subagent request | `gpt-5.6-luna`, per-invocation `model` field |
| Workflow subagent resolved model | `gpt-5.6-luna` in native subagent JSONL |
| Effort | `low` for main turn and provider probe |
| Main tools | `Workflow`, `Monitor`, and the structured-output return tool only |
| Subagent tools | Empty allowlist |
| Global subagent override | Absent |
| Workflow agents | Exactly one |

The proof command was:

```bash
HELIX_CC_CLIPROXY_DIR=<dedicated-local-state> \
  node bin/helix-cc-cliproxy proof --model gpt-5.6-luna
```

It returned the following account-free receipt:

```json
{
  "status": "passed",
  "cliProxyVersion": "7.2.80",
  "providerChain": ["codex"],
  "upstreamCredentialClasses": ["codex-oauth-only"],
  "upstreamCredentialCount": 1,
  "mainRequestedModel": "gpt-5.6-luna",
  "workflowRequestedModels": ["gpt-5.6-luna"],
  "workflowExpectedResolvedModels": ["gpt-5.6-luna"],
  "workflowResolvedModels": ["gpt-5.6-luna"],
  "workflowAgentTranscripts": 1,
  "globalSubagentModelOverride": false,
  "markerMatched": true,
  "sidecarReused": false
}
```

No OAuth token, inbound proxy token, account identifier, OAuth filename,
authorization URL, prompt transcript, or machine-specific state path is part of
that receipt or this repository.

## What the proof checks

The command does not trust a model to identify itself. It enforces all of these
conditions:

1. On supported macOS/Linux architectures, the downloaded CLIProxyAPI archive
   matches the platform-specific pinned SHA-256 and the executable reports
   `7.2.80`.
2. The dedicated auth directory contains one or more JSON records and every
   record has CLIProxyAPI's `codex-` filename class. A mixed-provider directory
   is rejected.
3. The sidecar is reachable only through its configured loopback origin and the
   generated inbound token successfully authenticates `/v1/models`.
4. The requested model appears exactly in that authenticated catalog.
5. The child Claude Code environment removes Bedrock, Vertex, Foundry, and
   `CLAUDE_CODE_SUBAGENT_MODEL` overrides and enables Claude Code's subprocess
   credential scrub for Bash, hooks, and stdio MCP servers.
6. The main turn must invoke the checked-in `provider-proof.js` through the
   native `Workflow` tool and return the random marker produced by that run.
7. Exactly one marker-bearing `agent-*.jsonl` must exist under Claude Code's
   native Workflow transcript tree.
8. That subagent transcript must record the requested model in
   `message.model`.

The main turn cannot manufacture the transcript condition. A structured output
without a Workflow launch, a denied launch, an empty catalog, a wrong model,
or a marker-only response all fail.

## Failed preconditions found while building the proof

These failures are now regression-protected behavior or documented operator
constraints:

- CLIProxyAPI can serve `/v1/models` before its auth watcher finishes loading;
  readiness therefore waits for a non-empty authenticated catalog instead of
  treating the first HTTP 200 as ready.
- CLIProxyAPI refreshes remote model metadata by default; Helix CC launches it
  with `-local-model` so the pinned binary's embedded registry is used.
- Claude Code `--bare` removes the Workflow tool from this headless surface;
  the proof uses normal mode with an isolated `CLAUDE_CONFIG_DIR` instead.
- Headless `dontAsk` denies first-run Workflow approval unless `Workflow` and
  `Monitor` are explicitly allowed. The proof allows only those orchestration
  tools; it does not enable general permission bypass.
- CLIProxyAPI's default login output includes an account-derived credential
  filename. The shipped login wrapper removes that filename and suppresses the
  one-time browser authorization URL before writing terminal output.

## What remains unproven

This one-agent proof is intentionally not a production delivery benchmark. It
does not prove:

- every GPT model or effort level;
- a mixed-model Workflow where two stages use different GPT IDs;
- full builder/tester tool compatibility under translated GPT inference;
- exact provider identity beyond the dedicated Codex-only auth directory,
  authenticated catalog, requested model, and returned transcript model;
- GitHub Copilot, OpenRouter non-Claude routes, or Azure Foundry GPT endpoints
  (Copilot/Azure implementations shipped later, but are not evidence from this
  Codex-only proof; OpenRouter is deferred);
- Helix's deterministic external command/file gate, public structural event
  record, or cross-process recovery semantics.

Before promoting another provider/model combination, run the same bounded proof
with a dedicated provider state, require exact catalog membership, and retain an
account-free receipt. Before assigning GPT to all delivery roles, run a
disposable-repository smoke that exercises the intended tool set and full
verification gate.

## 2026-07-18 canonical-main revalidation

The installed launcher checkout and remote `main` both resolved to
`bdc21cbd0a7306433a95f09c3e37369e001817b1` before the documentation follow-up.
Claude Code `2.1.214` and CLIProxyAPI `7.2.80` repeated the dedicated
Codex-subscription proof successfully:

```json
{
  "status": "passed",
  "providerChain": ["codex"],
  "upstreamCredentialClasses": ["codex-oauth-only"],
  "upstreamCredentialCount": 1,
  "mainRequestedModel": "gpt-5.6-luna",
  "workflowRequestedModels": ["gpt-5.6-luna"],
  "workflowExpectedResolvedModels": ["gpt-5.6-luna"],
  "workflowResolvedModels": ["gpt-5.6-luna"],
  "workflowAgentTranscripts": 1,
  "globalSubagentModelOverride": false,
  "markerMatched": true,
  "sidecarReused": false
}
```

A second proof in the same session used the Codex and Copilot credential
classes together and produced two exact native Workflow transcripts for
`gpt-5.6-luna` and `gpt-5.4`. The gateway stopped after each owned proof; an
idle `status: "unreachable"` is expected lifecycle evidence, not a lost login.
