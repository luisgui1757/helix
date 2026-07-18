# Provider paths and truth states

Provider configuration belongs to Pi or the official provider client. Helix
distinguishes five states: installed, configured, entitled, exact-capable, and
live-certified. Only the last two can execute a workflow that requires exact
identity. “Configured” never means entitled or certified.

Policy evidence was reviewed on 2026-07-16 and expires on 2026-08-15. Expiry
exact-disables new sessions until the register is reviewed; it does not silently
extend a claim.

| Path | Mechanism | Exact requirement | Default state |
|---|---|---|---|
| Anthropic API | Official Messages API / managed backend | response model, effort capability, opaque account | uncertified-disabled |
| OpenAI API | Official Responses API | response model, effort, project/account | uncertified-disabled |
| Codex Business/Enterprise | Official workspace access token and app-server/SDK | workspace token class, model, effort, account | uncertified-disabled |
| Codex personal OAuth | Personal Codex session | all fields plus policy acceptance | gray/unstable, exact-disabled |
| GitHub Copilot | Official SDK/CLI/ACP session | returned model, effort, account/session | uncertified-disabled |
| Foundry Claude | Explicit Claude deployment | deployment, model, region/account, effort | uncertified-disabled |
| Azure OpenAI | Explicit GPT deployment, never Model Router | deployment, served model, tenant/account, effort | uncertified-disabled |
| OpenRouter | Pi-synced API key plus audited Chat Completions | returned model/provider route/account, strict privacy/fallback pins | attended per-run certification; otherwise exact-disabled |
| Anthropic consumer OAuth | Consumer subscription reuse in a third-party host | unsupported by current policy | policy-blocked |
| CLIProxyAPI | translated/pool/rotation gateway | cannot satisfy account/route/protocol invariants | rejected |

The installed runtime is not a live certification. Preflight consumes a
short-lived capability record from official status/probe evidence. Requested
values copied into a record are `requested-only` and fail exact mode. Exact
status always requires an opaque account binding; providers that cannot expose
one remain exact-disabled. Both requested and effective account fields must be
present, non-empty opaque values and must match. Evidence is graded per field:
a response may verify provider/model while the configured runtime session
verifies effort, and the weaker field is never mislabeled as response evidence.

## OpenRouter strict request

Every exact request contains one model and one endpoint provider route:

```json
{
  "provider": {
    "only": ["<route>"],
    "order": ["<route>"],
    "allow_fallbacks": false,
    "require_parameters": true,
    "data_collection": "deny",
    "zdr": true
  }
}
```

No `models` fallback list, permissive preset, sorting shortcut, or inherited
provider default is accepted. The response must return the exact requested
model and provider route. A different or unrequested effective route is a
failed call, not success with a warning.

For the product path, attended preflight reads the configured credential only
through Pi's AuthStorage, proves its provider-issued account label, and queries
OpenRouter's current ZDR endpoint registry. Execution is allowed only when
exactly one active route supports the model's tools, token parameter, and any
requested reasoning control. The displayed consent binds the route and a hash
of the account label; raw labels and credentials remain memory-only.

Pi's streaming message omits the OpenRouter route. Helix therefore uses a
session-local HTTP proxy bound only to `127.0.0.1`. It rejects any outbound
model/routing drift, forwards the original request bytes with the certified
credential, observes model and route on every streamed response, and closes
with the session. It is an audit/transport boundary, not an OS sandbox. It
stores no prompt, response, credential, or account value.

## Certification

Deterministic provider-contract tests use injected transports and make no
network calls. They prove request ordering, strict routing, response identity,
unattested zero-egress refusal, account mismatch, and cancellation.

The optional live tool supports only an explicitly authorized OpenRouter free
model. It first proves the expected opaque account handle, then sends one tiny
strict request. Missing model, route, account, credential, `:free` suffix, or
returned identity refuses. The tool never chooses a substitute or prints the
credential/account. See the command in [manual.md](manual.md).

The standalone tool proves the provider-specific runtime. Release verification
also exercises the production Pi AgentSession path through its localhost audit
proxy in a disposable supported-Pi installation.

`provider_policy.require_live_certification: true` is fail-closed product
policy, not documentation metadata. Before any provider preflight or run
artifact, Helix requires an adapter that explicitly supplies current
`live-certified` evidence; the shipped Pi adapter intentionally advertises no
such reusable proof, so that policy currently refuses with
`provider-live-certification-required`. The default remains `false`; exact
OpenRouter execution still performs attended control-plane checks and verifies
the effective model/route on every generation. A standalone certification run
does not silently authorize later product runs.

Official sources:

- [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages)
- [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [GitHub Copilot SDK](https://docs.github.com/en/copilot/how-tos/copilot-sdk/getting-started)
- [Azure OpenAI reference](https://learn.microsoft.com/en-us/azure/foundry/openai/reference)
- [Foundry Claude configuration](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/configure-claude-code)
- [OpenRouter provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)
