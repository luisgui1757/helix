# M0a — OpenRouter free real-provider smoke evidence

**Date:** 2026-07-04 · **Pi:** `0.80.3` · **Provider:** `openrouter`
**Model:** `cohere/north-mini-code:free`

**Verdict: PASS.** A real native Pi OpenRouter call succeeded against a model id
ending in `:free`, returned the expected marker, and did not use tools, session
storage, context files, skills, themes, extensions, or prompt templates.

## Why this is public-safe

- No provider keys, OAuth tokens, `auth.json` contents, session URLs, or raw
  transcripts are recorded here.
- The command used `PI_TELEMETRY=0` and `PI_SKIP_VERSION_CHECK=1`.
- `PI_OFFLINE=1` was intentionally not set because this is the real-provider
  reachability smoke.
- The smoke disables tools, session writing, context files, skills, themes,
  prompt templates, and extensions.
- The model id must end in `:free`; the script refuses non-free model ids.

## Source facts

- Pi docs list OpenRouter as native provider id `openrouter` and use
  `OPENROUTER_API_KEY` for env-key auth (`docs/providers.md`).
- Pi's custom-model docs show OpenRouter's OpenAI-compatible base URL as
  `https://openrouter.ai/api/v1` (`docs/models.md`).
- Local `pi --list-models cohere/north-mini-code:free` showed:

```text
provider    model                        context  max-out  thinking  images
openrouter  cohere/north-mini-code:free  256K     64K      yes       no
```

## Reproduce

```sh
tools/smoke/openrouter-free-smoke.sh
```

The script defaults to `cohere/north-mini-code:free`. To use a different
OpenRouter free model:

```sh
tools/smoke/openrouter-free-smoke.sh 'google/gemma-4-26b-a4b-it:free'
```

## Actual run

```text
# Prime OpenRouter free smoke
  provider: openrouter
  model:    cohere/north-mini-code:free
  policy:   model id must end in :free; no tools/session/context/resources
  PASS inventory: model visible to Pi
  PASS live-call: marker returned
RESULT: PASS
```

## What this closes

- The M0a real-provider **live-call** proof for OpenRouter `:free` models: Pi can
  reach an approved real provider and complete a no-spend active session.

## What this does not claim

- It is not a privileged packet capture and does not claim packet-level endpoint
  exclusivity. The stronger "observe every socket" proof remains a future
  CI/boundary hardening option if needed.
- It does not test OpenAI, GitHub Copilot, Azure Foundry, or Claude.
- It does not test `/share`; a positive `/share` denial trace remains a future
  lockdown follow-up when that path is exercised.
