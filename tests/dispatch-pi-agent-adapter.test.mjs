import test from "node:test";
import assert from "node:assert/strict";

import { createPiAgentAdapter, parseSemanticOutput, piProviderId } from "../dispatch/lib/pi-agent-adapter.mjs";
import { PI_EFFORT_CODES } from "../dispatch/lib/pi-effort.mjs";
import { validateRoleEnvelope } from "../dispatch/lib/role-envelope.mjs";

function harness(output) {
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
        content: [{ type: "text", text: output }],
        usage: { input: 42, output: 7 },
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
    { run_id: "run-1", cwd: "/tmp/worktree", prompt: "Review it", verdict_role: "reviewer", pass: 2, attempt: 1 },
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
  const fetchImpl = async (url) => {
    calls.push({ kind: "fetch", url });
    if (url.endsWith("/auth/key")) return jsonResponse({ data: { label: "account..label" } });
    if (url.endsWith("/endpoints/zdr")) return jsonResponse({ data: [{
      model_id: model.id, provider_name: "ExactRoute", status: 0,
      supported_parameters: ["max_tokens", "tools", "reasoning_effort"],
    }] });
    if (url.includes("/generation?id=")) return jsonResponse({
      data: { model: "provider-native-canonical-alias", provider_name: "ExactRoute" },
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
  const spec = { role: "reviewer", provider: "openrouter", model: model.id, effort: "high" };
  const preflight = await adapter.preflightExact([spec]);
  assert.equal(preflight.ok, true, JSON.stringify(preflight));
  assert.deepEqual(preflight.bindings.map(({ provider, model: id, effort, route }) => ({ provider, model: id, effort, route })), [{
    provider: "openrouter", model: model.id, effort: "high", route: "ExactRoute",
  }]);
  const envelope = await adapter.runCandidate(spec, { run_id: "exact-run", cwd: "/tmp", prompt: "review" });
  assert.equal(adapter.attests(spec, envelope.attestation_ref), true);
  assert.deepEqual(envelope.effective.evidence, {
    provider: "verified-response",
    model: "verified-response",
    effort: "verified-session",
  });
  assert.equal(sessionOptions.apiKey, "test-credential");
  assert.deepEqual(sessionOptions.model.compat.openRouterRouting, {
    only: ["ExactRoute"], order: ["ExactRoute"], allow_fallbacks: false,
    require_parameters: true, data_collection: "deny", zdr: true,
  });
  assert.equal(sessionOptions.model.compat.supportsStore, false);
  assert.equal(sessionOptions.model.compat.maxTokensField, "max_tokens");
  assert.equal(calls.filter((call) => call.kind === "fetch").length, 3);
});

test("exact Pi execution refuses unsupported and ambiguous routes before a session", async () => {
  const model = { provider: "openrouter", id: "vendor/ambiguous:free", reasoning: false };
  let sessions = 0;
  const registry = {
    authStorage: { async getApiKey() { return "test-credential"; } },
    find: () => model,
    hasConfiguredAuth: () => true,
  };
  const fetchImpl = async (url) => url.endsWith("/auth/key")
    ? jsonResponse({ data: { label: "account" } })
    : jsonResponse({ data: ["A", "B"].map((provider_name) => ({
      model_id: model.id, provider_name, status: 0, supported_parameters: ["max_tokens", "tools"],
    })) });
  const adapter = createPiAgentAdapter({
    modelRegistry: registry, exactMode: true, fetchImpl,
    now: () => Date.parse("2026-07-16T00:00:00Z"),
    sessionFactory: async () => { sessions += 1; throw new Error("must not run"); },
  });
  const ambiguous = await adapter.preflightExact([{
    role: "builder", provider: "openrouter", model: model.id, effort: "default",
  }]);
  assert.equal(ambiguous.code, "openrouter-exact-route-ambiguous-or-unavailable");
  const unsupported = await adapter.preflightExact([{
    role: "builder", provider: "openai-api", model: "gpt-test", effort: "default",
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
    { run_id: "r", cwd: "/tmp", prompt: "build" },
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
    { run_id: "r", cwd: "/tmp", prompt: "build" },
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
      { run_id: "r", cwd: "/tmp", prompt: "build" },
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
      { run_id: "r", cwd: "/tmp", prompt: "review" },
    ),
    new RegExp(PI_EFFORT_CODES.UNSUPPORTED),
  );
});

test("malformed assistant semantics reject without trusting fabricated envelope fields", async () => {
  const { adapter, model } = harness('{"provider":"evil","recommendation":"approve"}');
  await assert.rejects(
    adapter.runCandidate(
      { role: "reviewer", provider: "openrouter", model: model.id },
      { run_id: "run-1", cwd: "/tmp/worktree", prompt: "Review it", verdict_role: "reviewer" },
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
});

test("Pi adapter exposes stable unavailable, session, and provider failure codes", async () => {
  const unavailable = createPiAgentAdapter({
    modelRegistry: { find: () => undefined, hasConfiguredAuth: () => false },
    sessionFactory: async () => { throw new Error("must not run"); },
  });
  await assert.rejects(
    unavailable.runCandidate({ role: "builder", provider: "CustomProvider", model: "m" }, { run_id: "r", cwd: "/tmp" }),
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
    sessionFailure.runCandidate({ role: "builder", provider: model.provider, model: model.id }, { run_id: "r", cwd: "/tmp" }),
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
    providerFailure.runCandidate({ role: "builder", provider: model.provider, model: model.id }, { run_id: "r", cwd: "/tmp" }),
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
      { run_id: "run", cwd: "/tmp", prompt: "work", pass: 1 },
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
      { run_id: "run", cwd: "/tmp", prompt: "work", pass: 1 },
    ),
    /pi-agent-call-timeout/,
  );
  assert.equal(adapter.lastFailureCode(), "pi-agent-call-timeout");
});
