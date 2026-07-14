import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HELIX_PROVIDERS,
  NON_AUTOMATED_PROVIDERS,
  PROVIDER_FAMILY,
  isHelixProvider,
  isAutomatedDispatchProvider,
  providerFamily,
  piSourceFor,
} from "../dispatch/lib/providers.mjs";
import { runDispatch } from "../dispatch/lib/orchestrate.mjs";
import { makeEnvelope } from "../dispatch/fixtures/sample.mjs";

const NOW = 1_751_731_200;

test("canonical provider set is stable and every provider has a Pi source", () => {
  assert.deepEqual([...HELIX_PROVIDERS], [
    "openai-codex",
    "openai-api",
    "openrouter",
    "github-copilot",
    "azure-foundry",
    "claude-local",
    "mock",
  ]);
  for (const provider of HELIX_PROVIDERS) {
    assert.equal(isHelixProvider(provider), true, provider);
    assert.equal(typeof piSourceFor(provider), "string", provider);
  }
  assert.equal(isHelixProvider("custom-provider"), true);
  assert.equal(piSourceFor("custom-provider"), "Pi configured provider from ModelRegistry");
  assert.equal(isHelixProvider("provider/with-path"), false);
});

test("claude-local is the only canonical provider excluded from automated dispatch", () => {
  assert.deepEqual([...NON_AUTOMATED_PROVIDERS], ["claude-local"]);
  assert.equal(isAutomatedDispatchProvider("claude-local"), false);
  for (const provider of HELIX_PROVIDERS.filter((p) => p !== "claude-local")) {
    assert.equal(isAutomatedDispatchProvider(provider), true, provider);
  }
  // Exact public-safe Pi provider ids are dispatchable; malformed ids are not.
  assert.equal(isAutomatedDispatchProvider("custom-provider"), true);
  assert.equal(isAutomatedDispatchProvider("provider/with-path"), false);
  assert.equal(isAutomatedDispatchProvider(null), false);
});

test("provider family mapping covers every canonical provider", () => {
  for (const provider of HELIX_PROVIDERS) {
    assert.equal(providerFamily(provider), PROVIDER_FAMILY[provider], provider);
    assert.equal(typeof providerFamily(provider), "string", provider);
  }
  // The two OpenAI surfaces share a family; mock is its own single family.
  assert.equal(providerFamily("openai-codex"), providerFamily("openai-api"));
  assert.equal(providerFamily("mock"), "mock");
  assert.equal(providerFamily("custom-provider"), "custom-provider");
});

test("a non-automated provider stops dispatch before any adapter call", async () => {
  const calls = { candidates: 0 };
  const result = await runDispatch({
    run_id: "provider-boundary",
    task: { class_hint: "routine-code", confident: true },
    candidates: [
      { role: "builder", provider: "claude-local", model: "claude-cli" },
      { role: "reviewer", provider: "openai-codex", model: "gpt-review" },
    ],
    run_target: { repo: "self" },
    input_refs: [{ kind: "local-ref", value: "local-ref:input/provider-boundary", algorithm: null }],
    claims_ref: "local-ref:claims/provider-boundary",
    evidence_ref: "local-ref:evidence/provider-boundary",
  }, {
    now: NOW,
    seed: 7,
    mode: "tui",
    adapter: {
      runCandidate(spec, ctx) {
        calls.candidates += 1;
        return makeEnvelope({ run_id: ctx.run_id, role: spec.role, provider: spec.provider, model: spec.model });
      },
    },
    runGate: () => ({ command_names: ["mock-gate"], result: "pass", source: "deterministic-checker" }),
  });
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "insufficient-eligible-candidates");
  assert.equal(calls.candidates, 0);
  assert.ok(result.warnings.includes("provider-not-automated:claude-local"));
  // The refusal is recorded in the public-safe run record, never silent.
  assert.equal(result.record.exit_status, "fail-closed");
  assert.ok(result.record.warning_codes.includes("provider-not-automated:claude-local"));
});
