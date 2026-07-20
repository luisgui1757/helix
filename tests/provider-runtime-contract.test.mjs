import test from "node:test";
import assert from "node:assert/strict";

import { createAnthropicRuntime } from "../dispatch/runtime/anthropic-runtime.mjs";
import { createAzureClaudeRuntime } from "../dispatch/runtime/azure-claude-runtime.mjs";
import { createAzureOpenAIRuntime } from "../dispatch/runtime/azure-openai-runtime.mjs";
import { createCodexRuntime } from "../dispatch/runtime/codex-runtime.mjs";
import { createCopilotRuntime } from "../dispatch/runtime/copilot-runtime.mjs";
import { createOpenAIRuntime } from "../dispatch/runtime/openai-runtime.mjs";
import { createOpenRouterRuntime } from "../dispatch/runtime/openrouter-runtime.mjs";
import { certifiedSessionBinding } from "../dispatch/runtime/strict-runtime.mjs";

const now = 1_800_000_000_000;

function capability(tuple, providerPath, overrides = {}) {
  return {
    effective: {
      provider: tuple.provider,
      model: tuple.model,
      effort: tuple.effort,
      ...(tuple.route ? { route: tuple.route } : {}),
      account: tuple.expected_account,
    },
    evidence: {
      provider: "verified-session",
      model: "verified-response",
      effort: "verified-deployment",
      route: tuple.route ? "verified-response" : "verified-session",
      account: "verified-session",
      source: "contract-fixture",
      observed_at: now,
      expires_at: now + 60_000,
    },
    credential_class: "api-key",
    policy: "official",
    certification: "contract-verified",
    certification_ref: "fixture-v1",
    session_binding: certifiedSessionBinding({ provider_path: providerPath, session_id: "fixture", account: tuple.expected_account }),
    ...overrides,
  };
}

const messages = [{ role: "user", content: "task" }];

test("OpenRouter pins one route and refuses permissive fallback defaults", async () => {
  const tuple = { provider: "openrouter", model: "openai/gpt-test:free", effort: "low", route: "openai", expected_account: "acct-openrouter" };
  let captured;
  const runtime = createOpenRouterRuntime({ transport: async (request) => {
    captured = request;
    return { model: tuple.model, provider: tuple.route, choices: [{ message: { content: "ok" } }], usage: { total_tokens: 3 } };
  } });
  const preflight = await runtime.preflight(tuple, { now, capability: capability(tuple, "openrouter") });
  assert.equal(preflight.ok, true, JSON.stringify(preflight));
  const result = await runtime.execute({ tuple, system: "policy", messages }, { now, attestation: preflight.attestation });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(captured.provider, {
    only: ["openai"], order: ["openai"], allow_fallbacks: false,
    require_parameters: true, data_collection: "deny", zdr: true,
  });
  assert.equal(Object.hasOwn(captured, "models"), false);
  runtime.dispose();
});

test("OpenRouter rejects a substituted route after egress and an absent route before egress", async () => {
  const tuple = { provider: "openrouter", model: "openai/gpt-test:free", effort: "low", route: "openai", expected_account: "acct-openrouter" };
  let calls = 0;
  const runtime = createOpenRouterRuntime({ transport: async () => {
    calls += 1;
    return { model: tuple.model, provider: "azure", choices: [] };
  } });
  const preflight = await runtime.preflight(tuple, { now, capability: capability(tuple, "openrouter") });
  const mismatch = await runtime.execute({ tuple, messages }, { now, attestation: preflight.attestation });
  assert.equal(mismatch.code, "openrouter-effective-route-unverified");
  const noRoute = { provider: "openrouter", model: tuple.model, effort: "low", expected_account: "acct-openrouter" };
  const noRoutePreflight = await runtime.preflight(noRoute, { now, capability: capability(noRoute, "openrouter") });
  const refused = await runtime.execute({ tuple: noRoute, messages }, { now, attestation: noRoutePreflight.attestation });
  assert.equal(refused.code, "provider-request-invalid");
  assert.equal(calls, 1);
});

test("OpenAI Responses preserves developer before user content and verifies response model", async () => {
  const tuple = { provider: "openai-api", model: "gpt-test", effort: "high", expected_account: "project-1" };
  let captured;
  const runtime = createOpenAIRuntime({ transport: async (request) => {
    captured = request;
    return { model: tuple.model, output: [], usage: { input_tokens: 2, output_tokens: 1 } };
  } });
  const preflight = await runtime.preflight(tuple, { now, capability: capability(tuple, "openai-api") });
  const result = await runtime.execute({ tuple, system: "trusted", messages }, { now, attestation: preflight.attestation });
  assert.equal(result.ok, true);
  assert.deepEqual(captured.input.map((entry) => entry.role), ["developer", "user"]);
  assert.deepEqual(captured.reasoning, { effort: "high" });
});

test("every required provider adapter is installed fail-closed without certified capability", async () => {
  const constructors = [
    ["anthropic-api", createAnthropicRuntime],
    ["openai-api", createOpenAIRuntime],
    ["codex-business-token", createCodexRuntime],
    ["github-copilot", createCopilotRuntime],
    ["openrouter", createOpenRouterRuntime],
    ["azure-foundry-claude", createAzureClaudeRuntime],
    ["azure-openai", createAzureOpenAIRuntime],
  ];
  for (const [path, create] of constructors) {
    let calls = 0;
    const runtime = create({ transport: async () => { calls += 1; return {}; } });
    assert.equal(runtime.provider_path, path);
    const refused = await runtime.preflight({ provider: "mock", model: "mock-model", effort: "medium" }, { now });
    assert.equal(refused.code, "provider-capability-uncertified");
    assert.equal(calls, 0);
    runtime.dispose();
  }
});

test("runtime cancellation reaches the provider transport", async () => {
  const tuple = { provider: "openai-api", model: "gpt-test", effort: "high", expected_account: "project-1" };
  const runtime = createOpenAIRuntime({ transport: async (_request, context) =>
    new Promise((_resolve, reject) => context.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })) });
  const preflight = await runtime.preflight(tuple, { now, capability: capability(tuple, "openai-api") });
  const controller = new AbortController();
  const pending = runtime.execute({ tuple, messages }, { now, attestation: preflight.attestation, signal: controller.signal });
  controller.abort("operator-cancelled");
  const result = await pending;
  assert.equal(result.code, "provider-request-cancelled");
});

test("every provider runtime rejects incomplete, malformed, and aggregate-unsafe usage", async () => {
  const fixtures = [
    ["anthropic-api", createAnthropicRuntime, {}, (tuple, usage) => ({ model: tuple.model, content: [], usage })],
    ["openai-api", createOpenAIRuntime, {}, (tuple, usage) => ({ model: tuple.model, output: [], usage })],
    ["azure-foundry-claude", createAzureClaudeRuntime, { route: "deployment-a" },
      (tuple, usage) => ({ deployment: tuple.route, body: { model: tuple.model, content: [], usage } })],
    ["azure-openai", createAzureOpenAIRuntime, { route: "deployment-a" },
      (tuple, usage) => ({ deployment: tuple.route, body: { model: tuple.model, output: [], usage } })],
    ["openrouter", createOpenRouterRuntime, { route: "endpoint/tag" },
      (tuple, usage) => ({ model: tuple.model, provider: tuple.route, choices: [], usage })],
    ["codex-business-token", createCodexRuntime, {},
      (tuple, usage) => ({ model: tuple.model, effort: tuple.effort, account: tuple.expected_account, output: [], usage })],
    ["github-copilot", createCopilotRuntime, {},
      (tuple, usage) => ({ model: tuple.model, effort: tuple.effort, account: tuple.expected_account, output: [], usage })],
  ];
  for (const [providerPath, create, extra, response] of fixtures) {
    const tuple = {
      provider: providerPath, model: "model-test", effort: "high", expected_account: "account-test", ...extra,
    };
    const malformed = providerPath === "openrouter" || providerPath.includes("codex") || providerPath === "github-copilot"
      ? [{}, { total_tokens: -1 }, { total_tokens: "1" }]
      : [{}, { input_tokens: 1 }, { output_tokens: 1 }, { input_tokens: -1, output_tokens: 1 },
        { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 1 }];
    for (const usage of malformed) {
      const runtime = create({ transport: async () => response(tuple, usage) });
      const preflight = await runtime.preflight(tuple, { now, capability: capability(tuple, providerPath) });
      assert.equal(preflight.ok, true, `${providerPath}: ${JSON.stringify(preflight)}`);
      const result = await runtime.execute({ tuple, messages }, { now, attestation: preflight.attestation });
      assert.equal(result.code, "provider-response-usage-invalid", `${providerPath}: ${JSON.stringify(usage)}`);
      runtime.dispose();
    }
  }
});
