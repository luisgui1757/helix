import test from "node:test";
import assert from "node:assert/strict";

import { createPiAgentAdapter, parseSemanticOutput, piProviderId } from "../dispatch/lib/pi-agent-adapter.mjs";
import { PI_EFFORT_CODES } from "../dispatch/lib/pi-effort.mjs";
import { validateRoleEnvelope } from "../dispatch/lib/role-envelope.mjs";

const candidateContext = (value = {}) => ({
  tools: [], mutation: "read-only", output_schema: { id: "verdict-v1" }, ...value,
});

function harness(output, usage = { input: 42, output: 7 }) {
  const calls = [];
  const model = {
    provider: "openrouter",
    id: "openai/gpt-oss-20b:free",
    reasoning: true,
    thinkingLevelMap: { xhigh: "xhigh" },
  };
  const modelRegistry = {
    authStorage: {},
    find(provider, id) {
      calls.push({ kind: "find", provider, id });
      return provider === model.provider && id === model.id ? model : undefined;
    },
    hasConfiguredAuth(candidate) {
      calls.push({ kind: "auth", candidate });
      return candidate === model;
    },
  };
  const sessionFactory = async (options) => {
    calls.push({ kind: "session", ...options });
    let prompt = null;
    return {
      messages: [{
        role: "assistant",
        content: [{ type: "text", text: typeof output === "function" ? output() : output }],
        usage,
      }],
      async prompt(value) { prompt = value; calls.push({ kind: "prompt", value }); },
      async dispose() { calls.push({ kind: "dispose", prompt }); },
    };
  };
  return { adapter: createPiAgentAdapter({ modelRegistry, sessionFactory }), calls, model };
}

function jsonResponse(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, async text() { return JSON.stringify(value); } };
}

test("Pi adapter uses an exact configured OpenRouter free model and constructs trusted envelope identity", async () => {
  const { adapter, calls, model } = harness(JSON.stringify({
    status: "ok", uncertainty: [], risks: [], recommendation: "approve", proposed_actions: [], open_questions: [],
  }));
  const envelope = await adapter.runCandidate(
    { role: "reviewer", provider: "openrouter", model: model.id },
    candidateContext({ run_id: "run-1", cwd: "/tmp/worktree", prompt: "Review it", verdict_role: "reviewer", pass: 2, attempt: 1 }),
  );
  assert.equal(validateRoleEnvelope(envelope).valid, true);
  assert.equal(envelope.provider, "openrouter");
  assert.equal(envelope.model, model.id);
  assert.equal(envelope.recommendation, "approve");
  assert.deepEqual(envelope.usage, { input_tokens: 42, output_tokens: 7 });
  assert.match(envelope.input_ref.value, /^[0-9a-f]{64}$/);
  assert.equal(calls.some((call) => call.kind === "prompt" && call.value.includes("approve, revise, or revise-jump")), true);
  assert.equal(calls.at(-1).kind, "dispose");
});

test("Pi adapter supports exact custom ModelRegistry provider ids and preserves the openai-api alias", () => {
  const { adapter } = harness("{}");
  assert.equal(adapter.supportsProvider("my-company"), true);
  assert.equal(piProviderId("openai-api"), "openai");
  assert.equal(piProviderId("anthropic"), "anthropic");
  assert.equal(adapter.supportsProvider("claude-local"), false);
});

test("exact Pi execution pins one active ZDR route and verifies the generation before attesting", async () => {
  const output = JSON.stringify({
    status: "ok", uncertainty: [], risks: [], recommendation: "approve", proposed_actions: [], open_questions: [],
  });
  const model = {
    provider: "openrouter", id: "vendor/exact:free", name: "Exact", api: "openai-completions",
    baseUrl: "https://openrouter.ai/api/v1", reasoning: true, thinkingLevelMap: { high: "high" },
    input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 4096, maxTokens: 1024,
  };
  const calls = [];
  const registry = {
    authStorage: { async getApiKey() { return "test-credential"; } },
    find: (_provider, id) => id === model.id ? model : undefined,
    hasConfiguredAuth: () => true,
  };
  const fetchImpl = async (url, options) => {
    calls.push({ kind: "fetch", url, options });
    if (url.endsWith("/key")) return jsonResponse({ data: { creator_user_id: "account..id", label: "not-the-account-id" } });
    if (url.endsWith("/endpoints/zdr")) return jsonResponse({ data: [{
      model_id: model.id, provider_name: "ExactRoute", tag: "exact-route/variant-a", quantization: "fp8", status: 0,
      supported_parameters: ["max_tokens", "tools", "reasoning_effort"],
    }] });
    if (url.includes("/generation?id=")) return jsonResponse({
      data: { model: model.id, provider_name: "ExactRoute" },
    });
    throw new Error("unexpected URL");
  };
  let sessionOptions;
  const adapter = createPiAgentAdapter({
    modelRegistry: registry,
    exactMode: true,
    fetchImpl,
    now: () => Date.parse("2026-07-16T00:00:00Z"),
    sessionFactory: async (options) => {
      sessionOptions = options;
      return {
        messages: [{
          role: "assistant", provider: "openrouter", model: model.id, responseModel: model.id,
          responseId: "gen-exact", content: [{ type: "text", text: output }], usage: { input: 1, output: 1 },
        }],
        async prompt() {}, async dispose() {},
      };
    },
  });
  const spec = {
    role: "reviewer", provider: "openrouter", model: model.id, effort: "high", tools: [], mutation: "read-only",
  };
  const preflight = await adapter.preflightExact([spec]);
  assert.equal(preflight.ok, true, JSON.stringify(preflight));
  assert.deepEqual(preflight.bindings.map(({ provider, model: id, effort, route, quantization }) => ({ provider, model: id, effort, route, quantization })), [{
    provider: "openrouter", model: model.id, effort: "high", route: "exact-route/variant-a", quantization: "fp8",
  }]);
  const envelope = await adapter.runCandidate(spec, candidateContext({ run_id: "exact-run", cwd: "/tmp", prompt: "review" }));
  assert.equal(adapter.attests(spec, envelope.attestation_ref), true);
  assert.deepEqual(envelope.effective.evidence, {
    provider: "verified-response",
    model: "verified-response",
    effort: "verified-session",
  });
  assert.equal(sessionOptions.apiKey, "test-credential");
  assert.deepEqual(sessionOptions.model.compat.openRouterRouting, {
    only: ["exact-route/variant-a"], order: ["exact-route/variant-a"], allow_fallbacks: false,
    quantizations: ["fp8"], require_parameters: true, data_collection: "deny", zdr: true,
  });
  assert.deepEqual(sessionOptions.tools, []);
  assert.equal(sessionOptions.mutation, "read-only");
  assert.equal(sessionOptions.model.compat.supportsStore, false);
  assert.equal(sessionOptions.model.compat.maxTokensField, "max_tokens");
  assert.equal(calls.filter((call) => call.kind === "fetch").length, 3);
  assert.equal(calls.find((call) => call.url.endsWith("/endpoints/zdr")).options.headers.Authorization,
    "Bearer test-credential");

  const mismatch = createPiAgentAdapter({
    modelRegistry: registry, exactMode: true,
    fetchImpl: async (url) => {
      if (url.endsWith("/key")) return jsonResponse({ data: { creator_user_id: "account..id" } });
      if (url.endsWith("/endpoints/zdr")) return jsonResponse({ data: [{
        model_id: model.id, provider_name: "ExactRoute", tag: "exact-route/variant-a", quantization: "fp8", status: 0,
        supported_parameters: ["max_tokens", "tools", "reasoning_effort"],
      }] });
      return jsonResponse({ data: { model: "vendor/substituted:free", provider_name: "ExactRoute" } });
    },
    sessionFactory: async () => ({
      messages: [{
        role: "assistant", provider: "openrouter", model: model.id, responseModel: model.id,
        responseId: "gen-substituted", content: [{ type: "text", text: output }], usage: { input: 1, output: 1 },
      }],
      async prompt() {}, async dispose() {},
    }),
  });
  assert.equal((await mismatch.preflightExact([spec])).ok, true);
  await assert.rejects(mismatch.runCandidate(spec, candidateContext({
    run_id: "exact-mismatch", cwd: "/tmp", prompt: "review",
  })), /openrouter-effective-route-unverified/);
});

test("exact Pi execution refuses unsupported and ambiguous routes before a session", async () => {
  const model = { provider: "openrouter", id: "vendor/ambiguous:free", reasoning: false };
  let sessions = 0;
  const registry = {
    authStorage: { async getApiKey() { return "test-credential"; } },
    find: () => model,
    hasConfiguredAuth: () => true,
  };
  const fetchImpl = async (url) => url.endsWith("/key")
    ? jsonResponse({ data: { creator_user_id: "account-id" } })
    : jsonResponse({ data: ["variant-a", "variant-b"].map((tag) => ({
      model_id: model.id, provider_name: "SameProvider", tag, quantization: "fp8", status: 0,
      supported_parameters: ["max_tokens", "tools"],
    })) });
  const adapter = createPiAgentAdapter({
    modelRegistry: registry, exactMode: true, fetchImpl,
    now: () => Date.parse("2026-07-16T00:00:00Z"),
    sessionFactory: async () => { sessions += 1; throw new Error("must not run"); },
  });
  const ambiguous = await adapter.preflightExact([{
    role: "builder", provider: "openrouter", model: model.id, effort: "default", tools: [], mutation: "read-only",
  }]);
  assert.equal(ambiguous.code, "openrouter-exact-route-ambiguous-or-unavailable");
  const unsupported = await adapter.preflightExact([{
    role: "builder", provider: "openai-api", model: "gpt-test", effort: "default", tools: [], mutation: "read-only",
  }]);
  assert.equal(unsupported.code, "provider-exact-path-disabled");
  assert.equal(sessions, 0);
});

test("judge, synthesis, and verifier prompts receive the exact workflow task", async () => {
  const { adapter, calls, model } = harness(JSON.stringify({
    status: "ok", uncertainty: [], risks: [], recommendation: "approve", proposed_actions: [], open_questions: [],
  }));
  const task = "Implement the exact private task";
  const assignment = { provider: model.provider, model: model.id };
  await adapter.runJudge({}, { run_id: "r", cwd: "/tmp", task_instruction: task, judge: assignment });
  await adapter.runSynthesis({}, { run_id: "r", cwd: "/tmp", task_instruction: task, synthesis: assignment });
  await adapter.runVerifier({}, { run_id: "r", cwd: "/tmp", task_instruction: task, verification: assignment });
  const prompts = calls.filter((call) => call.kind === "prompt").map((call) => call.value);
  assert.equal(prompts.length, 3);
  assert.equal(prompts.every((prompt) => prompt.includes(`Exact workflow task:\n${task}`)), true);
});

test("candidate, judge, synthesis, and verifier bind requested effort at session creation", async () => {
  const { adapter, calls, model } = harness(JSON.stringify({
    status: "ok", uncertainty: [], risks: [], recommendation: "approve", proposed_actions: [], open_questions: [],
  }));
  await adapter.runCandidate(
    { role: "builder", provider: model.provider, model: model.id, effort: "low" },
    candidateContext({ run_id: "r", cwd: "/tmp", prompt: "build" }),
  );
  await adapter.runJudge({}, {
    run_id: "r", cwd: "/tmp", task_instruction: "task",
    judge: { provider: model.provider, model: model.id, effort: "medium" },
  });
  await adapter.runSynthesis({}, {
    run_id: "r", cwd: "/tmp", task_instruction: "task",
    synthesis: { provider: model.provider, model: model.id, effort: "high" },
  });
  await adapter.runVerifier({}, {
    run_id: "r", cwd: "/tmp", task_instruction: "task",
    verification: { provider: model.provider, model: model.id, effort: "max" },
  });
  const sessions = calls.filter((call) => call.kind === "session");
  assert.deepEqual(sessions.map((call) => call.effort), ["low", "medium", "high", "max"]);
  assert.deepEqual(sessions.map((call) => call.thinkingLevel), ["low", "medium", "high", "xhigh"]);
});

test("runtime-managed effort is intentionally omitted and unsupported explicit effort fails before a session", async () => {
  const output = JSON.stringify({
    status: "ok", uncertainty: [], risks: [], recommendation: "approve", proposed_actions: [], open_questions: [],
  });
  const managed = harness(output);
  await managed.adapter.runCandidate(
    { role: "builder", provider: managed.model.provider, model: managed.model.id, effort: "provider-managed" },
    candidateContext({ run_id: "r", cwd: "/tmp", prompt: "build" }),
  );
  const managedSession = managed.calls.find((call) => call.kind === "session");
  assert.equal(managedSession.thinkingLevel, undefined);

  let sessions = 0;
  const unsupportedModel = { provider: "openrouter", id: "non-reasoning", reasoning: false };
  const unsupported = createPiAgentAdapter({
    modelRegistry: {
      authStorage: {},
      find: () => unsupportedModel,
      hasConfiguredAuth: () => true,
    },
    sessionFactory: async () => { sessions += 1; throw new Error("must not run"); },
  });
  await assert.rejects(
    unsupported.runCandidate(
      { role: "builder", provider: unsupportedModel.provider, model: unsupportedModel.id, effort: "high" },
      candidateContext({ run_id: "r", cwd: "/tmp", prompt: "build" }),
    ),
    new RegExp(PI_EFFORT_CODES.UNSUPPORTED),
  );
  assert.equal(sessions, 0);
});

test("a Pi level explicitly disabled by model metadata fails instead of being clamped", async () => {
  const model = {
    provider: "openrouter",
    id: "limited",
    reasoning: true,
    thinkingLevelMap: { medium: null, xhigh: undefined },
  };
  const adapter = createPiAgentAdapter({
    modelRegistry: { authStorage: {}, find: () => model, hasConfiguredAuth: () => true },
    sessionFactory: async () => { throw new Error("must not run"); },
  });
  await assert.rejects(
    adapter.runCandidate(
      { role: "reviewer", provider: model.provider, model: model.id, effort: "medium" },
      candidateContext({ run_id: "r", cwd: "/tmp", prompt: "review" }),
    ),
    new RegExp(PI_EFFORT_CODES.UNSUPPORTED),
  );
});

test("malformed assistant semantics reject without trusting fabricated envelope fields", async () => {
  const { adapter, model } = harness('{"provider":"evil","recommendation":"approve"}');
  await assert.rejects(
    adapter.runCandidate(
      { role: "reviewer", provider: "openrouter", model: model.id },
      candidateContext({ run_id: "run-1", cwd: "/tmp/worktree", prompt: "Review it", verdict_role: "reviewer" }),
    ),
    /pi-agent-semantic-output-invalid/,
  );
  assert.equal(adapter.lastFailureCode(), "pi-agent-semantic-output-invalid");
});

test("semantic output accepts only one closed JSON object, never prose, fences, or a trailing-object scan", () => {
  const valid = JSON.stringify({
    status: "ok", uncertainty: [], risks: [], recommendation: "approve", proposed_actions: [], open_questions: [],
  });
  assert.equal(parseSemanticOutput(valid).recommendation, "approve");
  for (const value of [`Here is the result: ${valid}`, `\`\`\`json\n${valid}\n\`\`\``, `{"example":true}\n${valid}`]) {
    assert.throws(() => parseSemanticOutput(value), /pi-agent-semantic-output-invalid/);
  }
  const nonVerdict = JSON.stringify({
    status: "ok", uncertainty: [], risks: [], recommendation: "built", proposed_actions: [], open_questions: [],
  });
  assert.equal(parseSemanticOutput(nonVerdict, "semantic-v2").recommendation, "built");
  assert.throws(() => parseSemanticOutput(nonVerdict, "verdict-v1"), /pi-agent-semantic-output-invalid/);
});

test("Pi adapter refuses undeclared tools, mutation mismatch, and unknown output contracts before a session", async () => {
  const output = JSON.stringify({
    status: "ok", uncertainty: [], risks: [], recommendation: "approve", proposed_actions: [], open_questions: [],
  });
  const cases = [
    { mutation: "read-only", output_schema: { id: "verdict-v1" } },
    { tools: ["read", "write"], mutation: "read-only", output_schema: { id: "verdict-v1" } },
    { tools: ["read"], mutation: "read-only", output_schema: { id: "freeform-v1" } },
  ];
  for (const context of cases) {
    const { adapter, calls, model } = harness(output);
    await assert.rejects(adapter.runCandidate(
      { role: "reviewer", provider: model.provider, model: model.id },
      { run_id: "contract-run", cwd: "/tmp", prompt: "review", ...context },
    ), /pi-agent-(tools|output-schema)-invalid/);
    assert.equal(calls.some((call) => call.kind === "session"), false);
  }
});

test("real Pi effects refuse tool-bearing or mutating sessions before provider preflight", async () => {
  const { adapter, model } = harness("{}");
  const exact = createPiAgentAdapter({
    modelRegistry: {
      authStorage: { async getApiKey() { throw new Error("must not run"); } },
      find: () => model,
      hasConfiguredAuth: () => true,
    },
    exactMode: true,
  });
  const refused = await exact.preflightExact([{
    role: "reviewer", provider: "openrouter", model: model.id, effort: "default",
    tools: ["read"], mutation: "read-only",
  }]);
  assert.deepEqual(refused, { ok: false, code: "provider-exact-multi-turn-disabled" });
});

test("Pi adapter refuses a session containing more than one assistant provider turn", async () => {
  const output = JSON.stringify({
    status: "ok", uncertainty: [], risks: [], recommendation: "approve", proposed_actions: [], open_questions: [],
  });
  const model = { provider: "openrouter", id: "free" };
  const adapter = createPiAgentAdapter({
    modelRegistry: { find: () => model, hasConfiguredAuth: () => true },
    sessionFactory: async () => ({
      messages: [
        { role: "assistant", content: [{ type: "toolCall", name: "read" }], usage: { input: 100, output: 12 } },
        { role: "assistant", content: [{ type: "text", text: output }], usage: { input: 5, output: 7 } },
      ],
      async prompt() {},
      async dispose() {},
    }),
  });
  await assert.rejects(adapter.runCandidate(
    { role: "reviewer", provider: model.provider, model: model.id },
    candidateContext({ run_id: "multi-turn", cwd: "/tmp", prompt: "review" }),
  ), (error) => {
    assert.match(error.message, /pi-agent-provider-turn-count-invalid/);
    assert.deepEqual(error.usage, { input_tokens: 105, output_tokens: 19 });
    return true;
  });
  assert.equal(adapter.lastFailureCode(), "pi-agent-provider-turn-count-invalid");
});

test("a structured repair call starts with independent failure state", async () => {
  const valid = JSON.stringify({
    status: "ok", uncertainty: [], risks: [], recommendation: "approve", proposed_actions: [], open_questions: [],
  });
  let calls = 0;
  const harnessed = harness(() => (++calls === 1 ? "{}" : valid));
  const spec = { role: "reviewer", provider: harnessed.model.provider, model: harnessed.model.id };
  const context = candidateContext({ run_id: "repair-state", cwd: "/tmp", prompt: "review" });
  let firstError;
  try { await harnessed.adapter.runCandidate(spec, context); }
  catch (error) { firstError = error; }
  assert.match(firstError?.message ?? "", /pi-agent-semantic-output-invalid/);
  assert.deepEqual(firstError?.usage, { input_tokens: 42, output_tokens: 7 });
  assert.equal(harnessed.adapter.lastFailureCode(), "pi-agent-semantic-output-invalid");
  const repaired = await harnessed.adapter.runCandidate(spec, context);
  assert.equal(repaired.recommendation, "approve");
  assert.equal(harnessed.adapter.lastFailureCode(), null);
});

test("Pi adapter rejects missing, partial, and malformed provider usage without zero substitution", async () => {
  const output = JSON.stringify({
    status: "ok", uncertainty: [], risks: [], recommendation: "approve", proposed_actions: [], open_questions: [],
  });
  for (const usage of [null, {}, { input: 1 }, { output: 1 }, { input: -1, output: 1 }, { input: "1", output: 1 }]) {
    const { adapter, model } = harness(output, usage);
    await assert.rejects(adapter.runCandidate(
      { role: "reviewer", provider: model.provider, model: model.id },
      candidateContext({ run_id: "usage-run", cwd: "/tmp", prompt: "review" }),
    ), /pi-agent-usage-invalid/);
    assert.equal(adapter.lastFailureCode(), "pi-agent-usage-invalid");
  }
});

test("Pi adapter exposes stable unavailable, session, and provider failure codes", async () => {
  const unavailable = createPiAgentAdapter({
    modelRegistry: { find: () => undefined, hasConfiguredAuth: () => false },
    sessionFactory: async () => { throw new Error("must not run"); },
  });
  await assert.rejects(
    unavailable.runCandidate({ role: "builder", provider: "CustomProvider", model: "m" }, candidateContext({ run_id: "r", cwd: "/tmp" })),
    /pi-model-unavailable-or-unauthenticated/,
  );
  assert.equal(unavailable.lastFailureCode(), "pi-model-unavailable-or-unauthenticated");

  const model = { provider: "CustomProvider", id: "m" };
  const registry = { find: () => model, hasConfiguredAuth: () => true };
  const sessionFailure = createPiAgentAdapter({
    modelRegistry: registry,
    sessionFactory: async () => { throw new Error("raw session detail"); },
  });
  await assert.rejects(
    sessionFailure.runCandidate({ role: "builder", provider: model.provider, model: model.id }, candidateContext({ run_id: "r", cwd: "/tmp" })),
    /pi-agent-session-failed/,
  );
  assert.equal(sessionFailure.lastFailureCode(), "pi-agent-session-failed");

  const providerFailure = createPiAgentAdapter({
    modelRegistry: registry,
    sessionFactory: async () => ({
      messages: [],
      async prompt() { throw new Error("raw provider detail"); },
      async dispose() {},
    }),
  });
  await assert.rejects(
    providerFailure.runCandidate({ role: "builder", provider: model.provider, model: model.id }, candidateContext({ run_id: "r", cwd: "/tmp" })),
    /pi-agent-provider-failed/,
  );
  assert.equal(providerFailure.lastFailureCode(), "pi-agent-provider-failed");
});

test("Pi adapter bounds hung calls, aborts the session, and exposes only a stable timeout code", async () => {
  let aborted = 0;
  let disposed = 0;
  const model = { provider: "openrouter", id: "free" };
  const adapter = createPiAgentAdapter({
    modelRegistry: {
      authStorage: {},
      find: () => model,
      hasConfiguredAuth: () => true,
    },
    callTimeoutMs: 5,
    sessionFactory: async () => ({
      messages: [],
      prompt: () => new Promise(() => {}),
      async abort() { aborted += 1; },
      async dispose() { disposed += 1; },
    }),
  });
  await assert.rejects(
    adapter.runCandidate(
      { role: "builder", provider: "openrouter", model: "free" },
      candidateContext({ run_id: "run", cwd: "/tmp", prompt: "work", pass: 1 }),
    ),
    /pi-agent-call-timeout/,
  );
  assert.equal(adapter.lastFailureCode(), "pi-agent-call-timeout");
  assert.equal(aborted, 1);
  assert.equal(disposed, 1);
});

test("the per-call deadline starts before session and resource loading", async () => {
  const model = { provider: "openrouter", id: "free" };
  const adapter = createPiAgentAdapter({
    modelRegistry: {
      authStorage: {},
      find: () => model,
      hasConfiguredAuth: () => true,
    },
    callTimeoutMs: 5,
    sessionFactory: () => new Promise(() => {}),
  });
  await assert.rejects(
    adapter.runCandidate(
      { role: "builder", provider: "openrouter", model: "free" },
      candidateContext({ run_id: "run", cwd: "/tmp", prompt: "work", pass: 1 }),
    ),
    /pi-agent-call-timeout/,
  );
  assert.equal(adapter.lastFailureCode(), "pi-agent-call-timeout");
});
