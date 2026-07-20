import { pathToFileURL } from "node:url";
import { join } from "node:path";

const MODEL_ID = "vendor/exact:free";
const ROUTE_TAG = "exact-route/variant-a";
const PROVIDER_NAME = "ExactProvider";
const QUANTIZATION = "fp8";
const OUTPUT = JSON.stringify({
  status: "ok",
  uncertainty: [],
  risks: [],
  recommendation: "approve",
  proposed_actions: [],
  open_questions: [],
});

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function streamResponse() {
  const base = {
    id: "generation-default-factory",
    object: "chat.completion.chunk",
    created: 0,
    model: MODEL_ID,
    provider: PROVIDER_NAME,
  };
  const chunks = [
    { ...base, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: { content: OUTPUT }, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    { ...base, choices: [], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } },
  ];
  return new Response(`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

export async function runOpenRouterDefaultFactoryCheck({ packageRoot }) {
  if (typeof packageRoot !== "string" || packageRoot.length < 1) {
    throw new Error("openrouter-default-factory-package-root-invalid");
  }
  const { createPiAgentAdapter } = await import(pathToFileURL(join(packageRoot, "dispatch/lib/pi-agent-adapter.mjs")));
  const model = {
    provider: "openrouter",
    id: MODEL_ID,
    name: "Exact fixture",
    api: "openai-completions",
    baseUrl: "https://openrouter.ai/api/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 4096,
    maxTokens: 512,
  };
  const registry = {
    authStorage: { async getApiKey() { return "fixture-credential"; } },
    find: (provider, id) => provider === "openrouter" && id === MODEL_ID ? model : undefined,
    hasConfiguredAuth: (candidate) => candidate?.provider === "openrouter" && candidate?.id === MODEL_ID,
  };
  let upstreamCalls = 0;
  let retryFailureCalls = 0;
  let failNextProviderTurn = false;
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/key")) {
      return jsonResponse({ data: { creator_user_id: "fixture-account" } });
    }
    if (target.endsWith("/endpoints/zdr")) {
      return jsonResponse({ data: [{
        model_id: MODEL_ID,
        provider_name: PROVIDER_NAME,
        tag: ROUTE_TAG,
        quantization: QUANTIZATION,
        status: 0,
        supported_parameters: ["max_tokens"],
      }] });
    }
    if (target.includes("/generation?id=")) {
      return jsonResponse({ data: { model: MODEL_ID, provider_name: PROVIDER_NAME } });
    }
    if (target.endsWith("/chat/completions")) {
      const body = JSON.parse(Buffer.from(options.body).toString("utf8"));
      const expected = {
        only: [ROUTE_TAG],
        order: [ROUTE_TAG],
        quantizations: [QUANTIZATION],
        allow_fallbacks: false,
        require_parameters: true,
        data_collection: "deny",
        zdr: true,
      };
      if (JSON.stringify(body.provider) !== JSON.stringify(expected) || body.model !== MODEL_ID || body.stream !== true
        || body.tools != null) {
        throw new Error("openrouter-default-factory-request-invalid");
      }
      if (failNextProviderTurn) {
        retryFailureCalls += 1;
        return new Response("retry fixture", { status: 500 });
      }
      upstreamCalls += 1;
      return streamResponse();
    }
    throw new Error("openrouter-default-factory-unexpected-request");
  };
  const adapter = createPiAgentAdapter({
    modelRegistry: registry,
    exactMode: true,
    fetchImpl,
    now: () => Date.parse("2026-07-19T00:00:00Z"),
  });
  const spec = {
    role: "reviewer",
    provider: "openrouter",
    model: MODEL_ID,
    effort: "default",
    tools: [],
    mutation: "read-only",
  };
  const preflight = await adapter.preflightExact([spec]);
  if (!preflight.ok) throw new Error(`openrouter-default-factory-preflight:${preflight.code}`);
  const envelope = await adapter.runCandidate(spec, {
    run_id: "default-factory-proof",
    cwd: packageRoot,
    prompt: "Return the required closed verdict object.",
    verdict_role: "reviewer",
    pass: 1,
    attempt: 1,
    tools: [],
    mutation: "read-only",
    output_schema: { id: "verdict-v1" },
  });
  if (upstreamCalls !== 1 || envelope.status !== "ok" || envelope.recommendation !== "approve"
    || envelope.usage.input_tokens !== 3 || envelope.usage.output_tokens !== 2
    || adapter.attests(spec, envelope.attestation_ref) !== true) {
    throw new Error("openrouter-default-factory-result-invalid");
  }
  failNextProviderTurn = true;
  let retryFailure = null;
  try {
    await adapter.runCandidate(spec, {
      run_id: "default-factory-retry-proof",
      cwd: packageRoot,
      prompt: "Return the required closed verdict object.",
      verdict_role: "reviewer",
      pass: 1,
      attempt: 1,
      tools: [],
      mutation: "read-only",
      output_schema: { id: "verdict-v1" },
    });
  } catch (error) {
    retryFailure = error;
  }
  if (!(retryFailure instanceof Error) || retryFailureCalls !== 1) {
    throw new Error("openrouter-default-factory-retry-invalid");
  }
  return {
    ok: true,
    provider_turns: upstreamCalls,
    retry_failure_attempts: retryFailureCalls,
    usage: envelope.usage,
  };
}
