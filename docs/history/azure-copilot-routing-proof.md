# Azure and GitHub Copilot routing evidence

Evidence dates: 2026-07-16; canonical-main revalidation on 2026-07-18.

## Verdict

- **GitHub Copilot:** production boundary implemented, deterministic tests
  passed, and `copilot/gpt-5.4` is the current promoted controller route after
  an exact native Workflow receipt and served-snapshot pin. The older
  `copilot/gpt-5-mini` receipt remains historical; its latest controller
  revalidation was correctly rejected as premature.
- **Azure Foundry GPT:** production boundary implemented and deterministic tests
  passed. Live proof was unavailable because this machine had no Azure CLI and
  no configured endpoint, deployment, or API key.
- **OpenRouter:** explicitly deferred; no route exists in this release.

## Shared routing contract

CLIProxyAPI `7.2.80` remains the only endpoint seen by Claude Code. For any
provider set other than the legacy Codex-only route, `force-model-prefix` is
enabled:

| Namespace | Upstream |
|---|---|
| `openai/<id>` | one dedicated Codex OAuth record |
| `copilot/<id>` | one dedicated GitHub Copilot record through the pinned gateway |
| `azure/<deployment>` | one configured Azure Foundry `/openai/v1` endpoint |

The gateway has zero request retries, one credential per provider, no credential
rotation, no quota switching, no cooldown fallback, and no unprefixed route in
mixed mode. Every non-Codex upstream is itself reachable only through an
authenticated `127.0.0.1` attestation proxy.

## GitHub Copilot boundary

The implementation pins `@jeffreycao/copilot-api` `1.14.9`:

| Field | Value |
|---|---|
| Git tag | `v1.14.9` |
| Git commit | `2b6b113a3aa137a3529e552aed4e30923b751f64` |
| npm integrity | `sha512-N3pft4pIm1KCXATisLBwoEH2uaTZPy/U31pm7a5e0rUQ+ehBLDL3KCw7yd+pULfE3Ejnfs3H79en9GkaSvOpqg==` |
| Published start-module SHA-256 | `b5138e87435aed6f0ba4bb1e375d0cd8014f0e9bcc72cf58e48c398ca3961570` |

The published server omits `srvx.hostname`, which binds all interfaces. The
Helix CC launcher verifies the exact module digest and applies an in-memory
loader transformation adding `hostname: "127.0.0.1"`. Drift or an ambiguous
patch target is fatal. The backend has a random local API key and an independent
admin key. Its owner-only state rejects configured third-party providers and
nonempty Codex credentials.

The outer proxy accepts model traffic only as authenticated
`POST /v1/responses` calls for IDs obtained from the authenticated Copilot
catalog; its only other route is the authenticated fixed-shape readiness
receipt. It buffers at most 1 MiB while
waiting for the first `response.model`, requires an exact request match or an
owner-only dated snapshot pin, and then streams the already-validated response.
Mismatch or missing identity returns a stable 502 error rather than model output.

### Live attempt ledger

1. Importing the active GitHub CLI token was tested in disposable state and the
   gateway's Copilot-token exchange returned HTTP 404. That token source was
   rejected as non-equivalent and the `--from-gh` product path was removed.
2. The gateway's own GitHub device authorization flow completed in disposable
   owner-only state. No token, account identifier, credential path, or response
   body was printed or committed.
3. The authenticated upstream catalog was reduced to seven picker-enabled,
   tool-capable Responses chat models with low reasoning-effort support. Models
   without the required agent capabilities, embedding entries, picker-disabled
   entries, non-Responses transports, and CLIProxyAPI's two built-in image IDs
   were not exposed as usable `copilot/` routes.
4. `copilot/gpt-5-mini` passed a bounded native proof. The account-free receipt
   was:

```json
{
  "status": "passed",
  "cliProxyVersion": "7.2.80",
  "providerChain": ["copilot"],
  "upstreamCredentialClasses": ["github-copilot-only"],
  "upstreamCredentialCount": 1,
  "mainRequestedModel": "copilot/gpt-5-mini",
  "workflowRequestedModels": ["copilot/gpt-5-mini"],
  "workflowExpectedResolvedModels": ["gpt-5-mini"],
  "workflowResolvedModels": ["gpt-5-mini"],
  "workflowAgentTranscripts": 1,
  "globalSubagentModelOverride": false,
  "markerMatched": true,
  "sidecarReused": false
}
```

The prefix is the route selector and is stripped before upstream execution;
therefore the native transcript's `gpt-5-mini` is the correct resolved identity,
not a loss of provider proof. Provider proof comes from the selected Copilot-only
chain plus successful response attestation and the requested namespaced ID.

5. A direct `gpt-5.4` discovery call returned the dated served identity
   `gpt-5.4-2026-03-05`. `copilot-pin --model gpt-5.4` accepted that constrained
   relationship and stored only the mapping in owner-only disposable state.
   Arbitrary model substitution remained rejected.
6. A later final-code rerun found that `gpt-5-mini` had begun returning
   `gpt-5-mini-2025-08-07`. Exact attestation rejected it until
   `copilot-pin --model gpt-5-mini` discovered and pinned that permitted dated
   snapshot. This is expected fail-closed behavior under provider alias drift,
   not silent fallback.
7. In the final mixed runtime, the gateway, Copilot backend, and attestation
   proxy listened only on `127.0.0.1:18317`, `127.0.0.1:18318`, and
   `127.0.0.1:18319`; all three listeners were gone after the owned runtime was
   stopped.

## Heterogeneous native Workflow proof

One matrix proof used the same CLIProxyAPI process, one Codex OAuth credential,
one Copilot credential, and two parallel no-tools Workflow subagents. The
account-free receipt was:

```json
{
  "status": "passed",
  "cliProxyVersion": "7.2.80",
  "providerChain": ["codex", "copilot"],
  "upstreamCredentialClasses": ["codex-oauth-only", "github-copilot-only"],
  "upstreamCredentialCount": 2,
  "mainRequestedModel": "openai/gpt-5.6-luna",
  "workflowRequestedModels": [
    "openai/gpt-5.6-luna",
    "copilot/gpt-5-mini"
  ],
  "workflowExpectedResolvedModels": ["gpt-5-mini", "gpt-5.6-luna"],
  "workflowResolvedModels": ["gpt-5-mini", "gpt-5.6-luna"],
  "workflowAgentTranscripts": 2,
  "globalSubagentModelOverride": false,
  "markerMatched": true,
  "sidecarReused": false
}
```

This proves heterogeneous inference routes inside one native Workflow scheduler.
The separate delivery proof below exercises repository tools and the full role
graph.

## Heterogeneous full delivery proof

A disposable repository contained one exported `add` function, one test, a
README, and repository instructions. One `helix-delivery` run requested:

- independent planners on `openai/gpt-5.6-luna` and `copilot/gpt-5.4`;
- the Copilot model again for correctness review; and
- the OpenAI-subscription model for judge, builder, tester, documenter, red
  team, and verifier.

The workflow added an exported `multiply` function, added a focused test,
updated the README, ran the two-test suite, and returned `approved` with no open
blockers or permission denials. Nine native agent transcripts were retained:
two resolved to `gpt-5.4` and seven to `gpt-5.6-luna`. `git diff --check` and an
independent rerun of the fixture tests passed after the workflow returned.

The first headless attempt was correctly denied because top-level
`--tools Workflow,Monitor` also bounded every workflow agent. The passing run
kept `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`, used `--tools default`, and explicitly
allowed `Workflow,Monitor,Read,Glob,Grep,Write,Edit,Bash`. Agent-definition
allowlists still restricted read-only roles and serialized all writers. This is
the required unattended execution contract; disabling credential scrub or
permission checks is not.

## 2026-07-18 canonical-main revalidation

The canonical checkout and remote `main` both resolved to
`bdc21cbd0a7306433a95f09c3e37369e001817b1` before the documentation follow-up.
One dedicated GitHub device login was stored in Helix CC's local state without
printing or committing its value.

`copilot-pin --model gpt-5.4` discovered the constrained dated relationship
`gpt-5.4` -> `gpt-5.4-2026-03-05`. The current account-free receipt was:

```json
{
  "status": "passed",
  "cliProxyVersion": "7.2.80",
  "providerChain": ["copilot"],
  "upstreamCredentialClasses": ["github-copilot-only"],
  "upstreamCredentialCount": 1,
  "mainRequestedModel": "copilot/gpt-5.4",
  "workflowRequestedModels": ["copilot/gpt-5.4"],
  "workflowExpectedResolvedModels": ["gpt-5.4"],
  "workflowResolvedModels": ["gpt-5.4"],
  "workflowAgentTranscripts": 1,
  "globalSubagentModelOverride": false,
  "markerMatched": true,
  "sidecarReused": false
}
```

The mixed proof then passed with `openai/gpt-5.6-luna` as the main route and
two parallel native Workflow subagents:

```json
{
  "status": "passed",
  "providerChain": ["codex", "copilot"],
  "upstreamCredentialClasses": ["codex-oauth-only", "github-copilot-only"],
  "upstreamCredentialCount": 2,
  "mainRequestedModel": "openai/gpt-5.6-luna",
  "workflowRequestedModels": ["openai/gpt-5.6-luna", "copilot/gpt-5.4"],
  "workflowExpectedResolvedModels": ["gpt-5.4", "gpt-5.6-luna"],
  "workflowResolvedModels": ["gpt-5.4", "gpt-5.6-luna"],
  "workflowAgentTranscripts": 2,
  "globalSubagentModelOverride": false,
  "markerMatched": true,
  "sidecarReused": false
}
```

A separate `gpt-5-mini` attempt launched Workflow but submitted its structured
success before the background subagent completed. Because the final result was
not the required structured envelope, Helix CC returned a failure and emitted
no promoted receipt. This is the intended fail-closed outcome. It shows that a
cataloged or historically proven model is not automatically a reliable current
top-level controller.

Azure was checked again and remained unavailable: Azure CLI was not installed,
and no endpoint, deployment map, or API key was configured. No Azure request was
sent.

## Azure Foundry GPT boundary

The endpoint validator accepts credential-free HTTPS URLs on documented
`*.openai.azure.com` or `*.services.ai.azure.com` resource hosts whose path ends
in `/openai/v1`, including project paths. It rejects other schemes, hosts,
ports, credentials, query strings, fragments, and legacy paths.

`HELIX_CC_AZURE_MODELS` is not a catalog hint. It is a mandatory mapping from
each allowed deployment ID to its exact expected served-model identity. The
proxy accepts only those deployment IDs. On a successful response it validates
`x-ms-served-model` when present; otherwise it requires the top-level JSON/SSE
`model`. The body is not forwarded before a match.

API-key mode uses the documented `api-key` header without writing the key into
the generated config. Azure CLI mode obtains an Entra token for
`https://cognitiveservices.azure.com`, caches it in memory only, and refreshes
when less than five minutes remain. The Claude Code child environment removes
all Helix Azure endpoint/model/key variables.

### Unavailable live evidence

The test machine did not have `az` installed and no Azure endpoint, deployment
map, or API key was configured. Therefore no Azure request was sent and no
Azure model is called live-proven. This is an environment gap, not a passing
receipt.

## Deterministic evidence

The automated suite covers:

- exact package version, integrity lock, start-module digest, and loopback patch;
- Copilot admission restricted to tool-capable low-effort Responses chat models
  and suppression of CLIProxyAPI's unrelated image-model built-ins;
- provider-list closure and explicit rejection of OpenRouter;
- owner-only isolated state and mixed-provider refusal;
- current Azure resource/project endpoint validation;
- unauthenticated caller, unknown route, and unknown model rejection before
  upstream egress;
- authenticated fixed-shape proxy readiness, preventing an unrelated loopback
  service from satisfying startup detection;
- streamed SSE and non-streamed model attestation;
- `x-ms-served-model` attestation;
- missing and mismatched identity failure;
- exact-or-dated-snapshot Copilot discovery and owner-only pin persistence;
- Azure CLI token validation and pre-expiry caching;
- provider credential removal from the Claude Code child environment; and
- read-only status inspection that neither creates nor rewrites runtime config.

Run the final gate with `npm run verify`. Exact test counts and live provider
receipts belong in `STATUS.md`; do not copy a count here because it will drift.
