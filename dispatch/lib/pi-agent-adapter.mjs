// Pi-native configured-provider adapter for staged workflows.
//
// Helix never stores provider credentials or chooses a provider. It resolves an
// exact provider/model from Pi's ModelRegistry, reuses Pi's auth storage, and
// creates a fresh in-memory AgentSession in the per-run worktree. Extensions,
// skills, prompt templates, and themes are disabled to avoid recursive Helix
// loading; AGENTS.md/CLAUDE.md context discovery remains enabled.

import { createHash } from "node:crypto";
import { PI_EFFORT_CODES, resolvePiThinkingLevel } from "./pi-effort.mjs";
import { validate } from "./schema.mjs";
import { loadPiSdk } from "../runtime/pi-runtime.mjs";
import { createOpenRouterAuditProxy } from "../runtime/openrouter-audit-proxy.mjs";
import { providerPolicy } from "../runtime/policy-register.mjs";

const SEMANTIC_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["status", "uncertainty", "risks", "recommendation", "proposed_actions", "open_questions"],
  properties: {
    status: { type: "string", enum: ["ok", "blocked", "failed", "refused", "timeout"] },
    uncertainty: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    recommendation: { type: "string" },
    proposed_actions: { type: "array", items: { type: "string" } },
    open_questions: { type: "array", items: { type: "string" } },
  },
});

const PI_TOOLS = new Set(["read", "grep", "find", "ls", "bash", "edit", "write"]);
const MUTATION_TOOLS = new Set(["bash", "edit", "write"]);
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const CONTROL_MAX_BYTES = 8 * 1024 * 1024;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function piProviderId(provider) {
  return provider === "openai-api" ? "openai" : provider;
}

function textOfAssistant(message) {
  if (!message || message.role !== "assistant" || !Array.isArray(message.content)) return "";
  return message.content.filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text).join("\n");
}

function parseSemanticOutput(text, outputSchema = "semantic-v2") {
  try {
    const trimmed = text.trim();
    const parsed = JSON.parse(trimmed);
    const validVerdict = outputSchema !== "verdict-v1"
      || ["approve", "revise", "revise-jump"].includes(parsed?.recommendation);
    if (["semantic-v2", "verdict-v1"].includes(outputSchema)
      && trimmed.startsWith("{") && trimmed.endsWith("}")
      && validate(SEMANTIC_SCHEMA, parsed, "$").valid && validVerdict) return parsed;
  } catch {
    // Stable refusal below. Fences, prose, and trailing JSON are not trusted.
  }
  throw new Error("pi-agent-semantic-output-invalid");
}

function usageOf(message) {
  const usage = message?.usage;
  if (usage == null || typeof usage !== "object" || Array.isArray(usage)) return null;
  const input = Object.hasOwn(usage, "input_tokens") ? usage.input_tokens : usage.input;
  const output = Object.hasOwn(usage, "output_tokens") ? usage.output_tokens : usage.output;
  return Number.isSafeInteger(input) && input >= 0 && Number.isSafeInteger(output) && output >= 0
    ? { input_tokens: input, output_tokens: output }
    : null;
}

function usageOfMessages(messages) {
  let input_tokens = 0;
  let output_tokens = 0;
  for (const message of messages) {
    const usage = usageOf(message);
    if (usage == null) return null;
    input_tokens += usage.input_tokens;
    output_tokens += usage.output_tokens;
    if (!Number.isSafeInteger(input_tokens) || !Number.isSafeInteger(output_tokens)) return null;
  }
  return { input_tokens, output_tokens };
}

function failureWithUsage(code, usage) {
  const error = new Error(code);
  if (usage != null) error.usage = { ...usage };
  return error;
}

function outputContract(outputSchema) {
  const verdict = outputSchema === "verdict-v1"
    ? " For reviewer routing, recommendation MUST be exactly approve, revise, or revise-jump."
    : "";
  return `\n\nFinish with exactly one JSON object and no text after it:\n` +
    `{"status":"ok","uncertainty":[],"risks":[],"recommendation":"...","proposed_actions":[],"open_questions":[]}.` + verdict;
}

function metaPrompt(task, instruction) {
  return `Exact workflow task:\n${task}\n\n${instruction}`;
}

function assignmentKey(spec) {
  return `${spec.provider}\0${spec.model}\0${spec.effort}`;
}

function boundedOpaque(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 256
    && !/[\u0000-\u001f\u007f]/.test(value);
}

async function boundedJson(fetchImpl, url, options, maxBytes = CONTROL_MAX_BYTES) {
  let response;
  try { response = await fetchImpl(url, options); }
  catch { return { ok: false, code: "provider-control-request-failed" }; }
  if (!response || response.ok !== true) {
    return { ok: false, code: "provider-control-request-failed", status: response?.status ?? null };
  }
  let text;
  try { text = await response.text(); }
  catch { return { ok: false, code: "provider-control-response-invalid" }; }
  if (typeof text !== "string" || text.length < 1 || Buffer.byteLength(text) > maxBytes) {
    return { ok: false, code: "provider-control-response-invalid" };
  }
  try { return { ok: true, value: JSON.parse(text) }; }
  catch { return { ok: false, code: "provider-control-response-invalid" }; }
}

function exactOpenRouterModel(model, route, quantization) {
  return {
    ...model,
    compat: {
      ...(model.compat ?? {}),
      supportsStore: false,
      maxTokensField: "max_tokens",
      openRouterRouting: {
        only: [route],
        order: [route],
        quantizations: [quantization],
        allow_fallbacks: false,
        require_parameters: true,
        data_collection: "deny",
        zdr: true,
      },
    },
  };
}

async function defaultSessionFactory({ cwd, model, modelRegistry, tools, thinkingLevel, apiKey = null }) {
  const { sdk } = await loadPiSdk();
  if (typeof apiKey !== "string" || apiKey.length < 1) throw new Error("pi-agent-exact-key-unavailable");
  const agentDir = sdk.getAgentDir();
  const settingsManager = sdk.SettingsManager.inMemory({
    retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } },
  });
  const loader = new sdk.DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
  });
  await loader.reload();
  const activeRuntime = await sdk.ModelRuntime.create({ modelsPath: null, allowModelNetwork: false });
  await activeRuntime.setRuntimeApiKey(model.provider, apiKey);
  activeRuntime.registerProvider(model.provider, {
    name: model.provider,
    baseUrl: model.baseUrl,
    api: model.api,
    apiKey,
    models: [{
      id: model.id,
      name: model.name,
      api: model.api,
      baseUrl: model.baseUrl,
      reasoning: model.reasoning,
      ...(model.thinkingLevelMap ? { thinkingLevelMap: structuredClone(model.thinkingLevelMap) } : {}),
      input: structuredClone(model.input),
      cost: structuredClone(model.cost),
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      ...(model.headers ? { headers: structuredClone(model.headers) } : {}),
      ...(model.compat ? { compat: structuredClone(model.compat) } : {}),
    }],
  });
  const activeModel = activeRuntime.getModel(model.provider, model.id);
  if (!activeModel) throw new Error("pi-agent-exact-model-unavailable");
  const created = await sdk.createAgentSession({
    cwd,
    model: activeModel,
    modelRuntime: activeRuntime,
    resourceLoader: loader,
    tools,
    settingsManager,
    sessionManager: sdk.SessionManager.inMemory(cwd),
    ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
  });
  return created.session;
}

export function createPiAgentAdapter({
  modelRegistry,
  sessionFactory = defaultSessionFactory,
  signal = null,
  callTimeoutMs = 10 * 60 * 1000,
  exactMode = false,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
} = {}) {
  if (!modelRegistry || typeof modelRegistry.find !== "function" || typeof modelRegistry.hasConfiguredAuth !== "function") {
    throw new Error("pi-model-registry-unavailable");
  }

  let lastFailureCode = null;
  let identityCode = null;
  let identityState = null;
  const certifications = new Map();

  const preflightExact = async (specs, { signal: preflightSignal = signal } = {}) => {
    if (!exactMode) return { ok: true, bindings: [] };
    if (!Array.isArray(specs) || specs.length < 1 || typeof fetchImpl !== "function") {
      return { ok: false, code: "provider-exact-preflight-invalid" };
    }
    const unique = new Map();
    for (const spec of specs) {
      if (!spec || spec.provider === "mock") continue;
      if (![spec.provider, spec.model, spec.effort].every((value) => typeof value === "string" && value.length > 0)) {
        return { ok: false, code: "provider-exact-preflight-invalid" };
      }
      if (!Array.isArray(spec.tools) || spec.tools.length !== 0 || spec.mutation !== "read-only") {
        return { ok: false, code: "provider-exact-multi-turn-disabled" };
      }
      if (spec.provider !== "openrouter") return { ok: false, code: "provider-exact-path-disabled" };
      unique.set(assignmentKey(spec), spec);
    }
    if (unique.size < 1) return { ok: false, code: "provider-exact-preflight-invalid" };
    const policy = providerPolicy("openrouter", { now: now() });
    if (!policy.ok) return { ok: false, code: policy.code };
    const controller = new AbortController();
    const abort = () => controller.abort(preflightSignal?.reason ?? "provider-control-cancelled");
    if (preflightSignal?.aborted) abort();
    else preflightSignal?.addEventListener?.("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort("provider-control-timeout"), Math.min(callTimeoutMs, 30_000));
    try {
      const apiKey = await modelRegistry.authStorage?.getApiKey?.("openrouter", { includeFallback: false });
      if (typeof apiKey !== "string" || apiKey.length < 1) return { ok: false, code: "provider-account-unavailable" };
      const headers = { Authorization: `Bearer ${apiKey}` };
      const [accountResult, endpointResult] = await Promise.all([
        boundedJson(fetchImpl, `${OPENROUTER_BASE}/key`, { headers, signal: controller.signal }, 64 * 1024),
        boundedJson(fetchImpl, `${OPENROUTER_BASE}/endpoints/zdr`, { headers, signal: controller.signal }),
      ]);
      const account = accountResult.value?.data?.creator_user_id;
      const endpoints = endpointResult.value?.data;
      if (!accountResult.ok || !boundedOpaque(account)) return { ok: false, code: "provider-account-unverified" };
      if (!endpointResult.ok || !Array.isArray(endpoints)) return { ok: false, code: "provider-route-unverified" };
      const pending = new Map();
      for (const [key, spec] of unique) {
        let model;
        try { model = modelRegistry.find(piProviderId(spec.provider), spec.model); }
        catch { model = null; }
        if (!model || !modelRegistry.hasConfiguredAuth(model)) {
          return { ok: false, code: "pi-model-unavailable-or-unauthenticated" };
        }
        const routes = endpoints.filter((endpoint) => endpoint?.model_id === spec.model
          && endpoint.status === 0 && boundedOpaque(endpoint.provider_name)
          && boundedOpaque(endpoint.tag) && boundedOpaque(endpoint.quantization)
          && Array.isArray(endpoint.supported_parameters)
          && endpoint.supported_parameters.includes("max_tokens")
          && (!model.reasoning || spec.effort === "default" || spec.effort === "provider-managed"
            || endpoint.supported_parameters.includes("reasoning")
            || endpoint.supported_parameters.includes("reasoning_effort")));
        if (routes.length !== 1) return { ok: false, code: "openrouter-exact-route-ambiguous-or-unavailable" };
        const endpoint = routes[0];
        const route = endpoint.tag;
        pending.set(key, {
          apiKey,
          account,
          route,
          provider_name: endpoint.provider_name,
          quantization: endpoint.quantization,
          model: exactOpenRouterModel(model, route, endpoint.quantization),
          attestation_ref: `sha256:${sha256(`${spec.provider}\0${spec.model}\0${spec.effort}\0${route}\0${endpoint.quantization}\0${account}`)}`,
        });
      }
      certifications.clear();
      for (const [key, value] of pending) certifications.set(key, value);
      const bindings = [...unique.entries()].map(([key, spec]) => ({
        provider: spec.provider,
        model: spec.model,
        effort: spec.effort,
        route: pending.get(key).route,
        quantization: pending.get(key).quantization,
        account_ref: `sha256:${sha256(pending.get(key).account)}`,
      }));
      return {
        ok: true,
        bindings,
        binding_ref: `sha256:${sha256(JSON.stringify(bindings))}`,
      };
    } catch {
      return { ok: false, code: controller.signal.aborted ? "provider-control-cancelled" : "provider-exact-preflight-failed" };
    } finally {
      clearTimeout(timer);
      preflightSignal?.removeEventListener?.("abort", abort);
    }
  };

  const verifyOpenRouterGeneration = async (certificate, assistant, activeSignal) => {
    const responseModel = assistant?.responseModel ?? assistant?.model;
    if (responseModel !== certificate.model.id) {
      identityCode = "openrouter-response-model-mismatch";
      return false;
    }
    if (typeof assistant?.responseId !== "string") {
      identityCode = "openrouter-response-id-unavailable";
      return false;
    }
    const headers = { Authorization: `Bearer ${certificate.apiKey}` };
    const controller = new AbortController();
    const abort = () => controller.abort(activeSignal?.reason ?? "provider-control-cancelled");
    if (activeSignal?.aborted) abort();
    else activeSignal?.addEventListener?.("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort("provider-control-timeout"), Math.min(callTimeoutMs, 5_000));
    try {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const result = await boundedJson(fetchImpl,
          `${OPENROUTER_BASE}/generation?id=${encodeURIComponent(assistant.responseId)}`,
          { headers, signal: controller.signal }, 256 * 1024);
        if (result.ok) {
          const matched = result.value?.data?.provider_name === certificate.provider_name
            && result.value?.data?.model === certificate.model.id;
          identityCode = matched ? "openrouter-route-verified" : "openrouter-route-mismatch";
          return matched;
        }
        if (result.status !== 404 || attempt === 19 || controller.signal.aborted) {
          identityCode = result.status === 404
            ? "openrouter-generation-unavailable"
            : controller.signal.aborted ? "openrouter-generation-cancelled" : "openrouter-generation-failed";
          return false;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return false;
    } finally {
      clearTimeout(timer);
      activeSignal?.removeEventListener?.("abort", abort);
    }
  };

  const runEffect = async ({ role, provider, model: modelId, effort = "default", stage, prompt, ctx, verdictRole = null }) => {
    let failureCode = null;
    let model;
    const certificate = exactMode ? certifications.get(assignmentKey({ provider, model: modelId, effort })) : null;
    if (exactMode && !certificate) {
      failureCode ??= "provider-exact-attestation-missing";
      throw new Error(failureCode);
    }
    let configured = false;
    try {
      model = certificate?.model ?? modelRegistry.find(piProviderId(provider), modelId);
      configured = Boolean(model && modelRegistry.hasConfiguredAuth(model));
    } catch {
      failureCode ??= "pi-model-registry-failed";
      throw new Error(failureCode);
    }
    if (!model || !configured) {
      failureCode ??= "pi-model-unavailable-or-unauthenticated";
      throw new Error(failureCode);
    }
    let thinkingLevel;
    try {
      thinkingLevel = resolvePiThinkingLevel(model, effort);
    } catch (error) {
      failureCode ??= Object.values(PI_EFFORT_CODES).includes(error?.message)
        ? error.message
        : PI_EFFORT_CODES.INVALID;
      throw new Error(failureCode);
    }
    const outputSchema = ctx.output_schema?.id ?? (role === verdictRole ? "verdict-v1" : "semantic-v2");
    if (!["semantic-v2", "verdict-v1"].includes(outputSchema)) {
      failureCode ??= "pi-agent-output-schema-invalid";
      throw new Error(failureCode);
    }
    const fullPrompt = `${prompt ?? "Perform the assigned workflow role."}${outputContract(outputSchema)}`;
    const tools = ctx.tools;
    const mutation = ctx.mutation;
    if (!Array.isArray(tools) || tools.length > 16 || new Set(tools).size !== tools.length
      || tools.some((tool) => !PI_TOOLS.has(tool))
      || !["read-only", "shared-serialized", "isolated-proposal"].includes(mutation)
      || (mutation === "read-only" && tools.some((tool) => MUTATION_TOOLS.has(tool)))) {
      failureCode ??= "pi-agent-tools-invalid";
      throw new Error(failureCode);
    }
    if (tools.length !== 0 || mutation !== "read-only") {
      failureCode ??= "provider-exact-multi-turn-disabled";
      throw new Error(failureCode);
    }
    const activeSignals = [...new Set([signal, ctx.signal].filter(Boolean))];
    let session = null;
    let auditProxy = null;
    let auditVerified = false;
    let assistant;
    let timer = null;
    let finished = false;
    const abortSession = () => { void session?.abort?.(); };
    let rejectBoundary;
    const boundary = new Promise((_, reject) => { rejectBoundary = reject; });
    const cancelHandler = () => {
      failureCode ??= "pi-agent-call-cancelled";
      abortSession();
      rejectBoundary(new Error(failureCode));
    };
    for (const activeSignal of activeSignals) {
      if (activeSignal.aborted) cancelHandler();
      else activeSignal.addEventListener?.("abort", cancelHandler, { once: true });
    }
    timer = setTimeout(() => {
      failureCode ??= "pi-agent-call-timeout";
      abortSession();
      rejectBoundary(new Error(failureCode));
    }, callTimeoutMs);
    const bounded = (promise) => Promise.race([promise, boundary]);
    try {
      try {
        let sessionModel = model;
        if (certificate && sessionFactory === defaultSessionFactory) {
          auditProxy = await bounded(createOpenRouterAuditProxy({
            model: certificate.model.id,
            route: certificate.route,
            providerName: certificate.provider_name,
            quantization: certificate.quantization,
            apiKey: certificate.apiKey,
            signal: ctx.signal ?? signal,
            fetchImpl,
          }));
          sessionModel = { ...model, baseUrl: auditProxy.base_url };
        }
        const creating = Promise.resolve(sessionFactory({
          cwd: ctx.cwd,
          model: sessionModel,
          modelRegistry,
          tools: structuredClone(tools),
          mutation,
          effort,
          thinkingLevel,
          ...(certificate ? { apiKey: certificate.apiKey } : {}),
        }));
        creating.then((lateSession) => {
          if (finished && lateSession) {
            void lateSession.abort?.();
            void lateSession.dispose?.();
          }
        }, () => {});
        session = await bounded(creating);
      } catch (error) {
        if (!["pi-agent-call-timeout", "pi-agent-call-cancelled"].includes(error?.message)) {
          failureCode ??= "pi-agent-session-failed";
        }
        throw new Error(failureCode ?? "pi-agent-session-failed");
      }
      try {
        await bounded(Promise.resolve(session.prompt(fullPrompt)));
      } catch (error) {
        if (!["pi-agent-call-timeout", "pi-agent-call-cancelled"].includes(error?.message)) {
          failureCode ??= "pi-agent-provider-failed";
        }
        throw new Error(failureCode ?? "pi-agent-provider-failed");
      }
      const assistantMessages = session.messages.filter((message) => message?.role === "assistant");
      if (assistantMessages.length !== 1) {
        failureCode ??= "pi-agent-provider-turn-count-invalid";
        assistant = assistantMessages.at(-1);
        throw failureWithUsage(failureCode, usageOfMessages(assistantMessages));
      }
      [assistant] = assistantMessages;
    } finally {
      finished = true;
      if (session) {
        try {
          await bounded(Promise.resolve(session.dispose()));
        } catch (error) {
          if (!["pi-agent-call-timeout", "pi-agent-call-cancelled"].includes(error?.message)) {
            failureCode ??= "pi-agent-session-failed";
          }
          throw failureWithUsage(failureCode ?? "pi-agent-session-failed", usageOf(assistant));
        }
      }
      if (auditProxy) {
        const auditSettled = await bounded(auditProxy.settle(Math.min(callTimeoutMs, 5_000)));
        auditVerified = auditProxy.verify();
        const auditStatus = auditProxy.status();
        identityState = { ...auditStatus, settled: auditSettled };
        identityCode = auditVerified
          ? "openrouter-route-verified"
          : !auditSettled ? "openrouter-audit-response-incomplete"
            : auditStatus.calls === 0 ? "openrouter-audit-request-unobserved"
            : auditStatus.completed !== auditStatus.calls ? "openrouter-audit-response-incomplete"
              : "openrouter-audit-identity-mismatch";
        try { await bounded(auditProxy.close()); }
        catch { auditVerified = false; failureCode ??= "openrouter-audit-proxy-failed"; }
      }
      if (timer) clearTimeout(timer);
      for (const activeSignal of activeSignals) activeSignal.removeEventListener?.("abort", cancelHandler);
    }
    const observedUsage = usageOf(assistant);
    const identityVerified = !certificate || ((!auditProxy || auditVerified)
      && await verifyOpenRouterGeneration(certificate, assistant, ctx.signal ?? signal));
    if (!identityVerified) {
      failureCode ??= "openrouter-effective-route-unverified";
      throw failureWithUsage(failureCode, observedUsage);
    }
    let semantic;
    try {
      semantic = parseSemanticOutput(textOfAssistant(assistant), outputSchema);
    } catch {
      failureCode ??= "pi-agent-semantic-output-invalid";
      throw failureWithUsage(failureCode, observedUsage);
    }
    const inputHash = sha256(fullPrompt);
    const semanticHash = sha256(JSON.stringify(semantic));
    const responseModel = typeof assistant?.responseModel === "string" && assistant.responseModel.length > 0
      ? assistant.responseModel
      : assistant?.model;
    const responseProvider = typeof assistant?.provider === "string" && assistant.provider.length > 0
      ? assistant.provider
      : piProviderId(provider);
    const requested = { provider, model: modelId, effort };
    const effective = {
      provider: responseProvider === piProviderId(provider) ? provider : responseProvider,
      model: responseModel ?? modelId,
      effort,
      evidence: {
        provider: typeof assistant?.provider === "string" && assistant.provider.length > 0 ? "verified-response" : "verified-session",
        model: typeof assistant?.responseModel === "string" && assistant.responseModel.length > 0
          ? "verified-response"
          : typeof assistant?.model === "string" && assistant.model.length > 0 ? "verified-session" : "requested-only",
        effort: "verified-session",
      },
    };
    const attestationRef = certificate?.attestation_ref
      ?? `sha256:${sha256(JSON.stringify({ requested, effective }))}`;
    if (observedUsage == null) {
      failureCode ??= "pi-agent-usage-invalid";
      throw new Error(failureCode);
    }
    return {
      schema_version: 2,
      run_id: ctx.run_id,
      stage,
      role,
      provider,
      model: modelId,
      requested,
      effective,
      attestation_ref: attestationRef,
      usage: observedUsage,
      attempt: Number.isSafeInteger(ctx.attempt) && ctx.attempt > 0 ? ctx.attempt : 1,
      iteration: Number.isSafeInteger(ctx.pass) && ctx.pass > 0 ? ctx.pass : 1,
      input_ref: { kind: "sha256", value: inputHash, algorithm: "sha256" },
      claims_ref: `sha256:${semanticHash}`,
      evidence_ref: `sha256:${sha256(`${semanticHash}:evidence`)}`,
      ...semantic,
    };
  };

  const run = async (args) => {
    try {
      const result = await runEffect(args);
      lastFailureCode = null;
      return result;
    } catch (error) {
      lastFailureCode = typeof error?.message === "string" ? error.message : "pi-agent-effect-failed";
      throw error;
    }
  };

  return {
    kind: "helix-pi-agent",
    exactMode,
    liveCertification: false,
    preflightExact,
    lastIdentityCode() { return identityCode; },
    lastIdentityState() { return identityState ? { ...identityState } : null; },
    attests(spec, ref) {
      return certifications.get(assignmentKey(spec))?.attestation_ref === ref;
    },
    lastFailureCode() { return lastFailureCode; },
    supportsProvider(provider) {
      return provider !== "mock" && provider !== "claude-local";
    },
    runCandidate(spec, ctx) {
      return run({
        role: spec.role, provider: spec.provider, model: spec.model, effort: spec.effort, stage: "candidate",
        prompt: ctx.prompt, ctx, verdictRole: ctx.verdict_role,
      });
    },
    runJudge(input, ctx) {
      return run({
        role: "judge", provider: ctx.judge.provider, model: ctx.judge.model, effort: ctx.judge.effort, stage: "judge",
        prompt: metaPrompt(ctx.task_instruction, `Rank these structural candidate projections:\n${JSON.stringify(input)}`),
        ctx: { ...ctx, tools: ctx.tools ?? [], mutation: ctx.mutation ?? "read-only" },
      });
    },
    runSynthesis(input, ctx) {
      return run({
        role: "synthesizer", provider: ctx.synthesis.provider, model: ctx.synthesis.model, effort: ctx.synthesis.effort, stage: "synthesis",
        prompt: metaPrompt(ctx.task_instruction, `Synthesize these candidate projections without dropping contradictions:\n${JSON.stringify(input)}`),
        ctx: { ...ctx, tools: ctx.tools ?? [], mutation: ctx.mutation ?? "read-only" },
      });
    },
    runVerifier(input, ctx) {
      return run({
        role: "verifier", provider: ctx.verification.provider, model: ctx.verification.model, effort: ctx.verification.effort, stage: "verification",
        prompt: metaPrompt(ctx.task_instruction, `Verify this structural workflow evidence:\n${JSON.stringify(input)}`),
        ctx: { ...ctx, tools: ctx.tools ?? [], mutation: ctx.mutation ?? "read-only" },
      });
    },
  };
}

export { parseSemanticOutput };
