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

const MUTATING_ROLES = new Set(["planner", "builder", "documenter"]);
const VERDICT_ROLES = new Set(["reviewer"]);
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

function parseSemanticOutput(text) {
  try {
    const trimmed = text.trim();
    const parsed = JSON.parse(trimmed);
    if (trimmed.startsWith("{") && trimmed.endsWith("}") && validate(SEMANTIC_SCHEMA, parsed, "$").valid) return parsed;
  } catch {
    // Stable refusal below. Fences, prose, and trailing JSON are not trusted.
  }
  throw new Error("pi-agent-semantic-output-invalid");
}

function usageOf(message) {
  const usage = message?.usage ?? {};
  const input = usage.input_tokens ?? usage.input ?? 0;
  const output = usage.output_tokens ?? usage.output ?? 0;
  return {
    input_tokens: Number.isSafeInteger(input) && input >= 0 ? input : 0,
    output_tokens: Number.isSafeInteger(output) && output >= 0 ? output : 0,
  };
}

function outputContract(role, verdictRole) {
  const verdict = role === verdictRole || VERDICT_ROLES.has(role)
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

function exactOpenRouterModel(model, route) {
  return {
    ...model,
    compat: {
      ...(model.compat ?? {}),
      supportsStore: false,
      maxTokensField: "max_tokens",
      openRouterRouting: {
        only: [route],
        order: [route],
        allow_fallbacks: false,
        require_parameters: true,
        data_collection: "deny",
        zdr: true,
      },
    },
  };
}

async function defaultSessionFactory({ cwd, model, modelRegistry, role, thinkingLevel, apiKey = null }) {
  const { sdk } = await loadPiSdk();
  const agentDir = sdk.getAgentDir();
  const loader = new sdk.DefaultResourceLoader({
    cwd,
    agentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
  });
  await loader.reload();
  const tools = MUTATING_ROLES.has(role)
    ? ["read", "bash", "edit", "write", "grep", "find", "ls"]
    : ["read", "grep", "find", "ls"];
  let activeRegistry = modelRegistry;
  let activeModel = model;
  let activeAuth = modelRegistry.authStorage;
  if (typeof apiKey === "string" && apiKey.length > 0) {
    activeAuth = sdk.AuthStorage.inMemory({ [model.provider]: { type: "api_key", key: apiKey } });
    activeRegistry = sdk.ModelRegistry.inMemory(activeAuth);
    activeRegistry.registerProvider(model.provider, {
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
    activeModel = activeRegistry.find(model.provider, model.id);
    if (!activeModel) throw new Error("pi-agent-exact-model-unavailable");
  }
  const created = await sdk.createAgentSession({
    cwd,
    model: activeModel,
    authStorage: activeAuth,
    modelRegistry: activeRegistry,
    resourceLoader: loader,
    tools,
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

  let failureCode = null;
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
        boundedJson(fetchImpl, `${OPENROUTER_BASE}/auth/key`, { headers, signal: controller.signal }, 64 * 1024),
        boundedJson(fetchImpl, `${OPENROUTER_BASE}/endpoints/zdr`, { signal: controller.signal }),
      ]);
      const account = accountResult.value?.data?.label;
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
        const routes = [...new Set(endpoints.filter((endpoint) => endpoint?.model_id === spec.model
          && endpoint.status === 0 && boundedOpaque(endpoint.provider_name)
          && Array.isArray(endpoint.supported_parameters)
          && endpoint.supported_parameters.includes("max_tokens")
          && endpoint.supported_parameters.includes("tools")
          && (!model.reasoning || spec.effort === "default" || spec.effort === "provider-managed"
            || endpoint.supported_parameters.includes("reasoning")
            || endpoint.supported_parameters.includes("reasoning_effort")))
          .map((endpoint) => endpoint.provider_name))];
        if (routes.length !== 1) return { ok: false, code: "openrouter-exact-route-ambiguous-or-unavailable" };
        const route = routes[0];
        pending.set(key, {
          apiKey,
          account,
          route,
          model: exactOpenRouterModel(model, route),
          attestation_ref: `sha256:${sha256(`${spec.provider}\0${spec.model}\0${spec.effort}\0${route}\0${account}`)}`,
        });
      }
      certifications.clear();
      for (const [key, value] of pending) certifications.set(key, value);
      const bindings = [...unique.entries()].map(([key, spec]) => ({
        provider: spec.provider,
        model: spec.model,
        effort: spec.effort,
        route: pending.get(key).route,
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
          const matched = result.value?.data?.provider_name === certificate.route;
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

  const run = async ({ role, provider, model: modelId, effort = "default", stage, prompt, ctx, verdictRole = null }) => {
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
    const fullPrompt = `${prompt ?? "Perform the assigned workflow role."}${outputContract(role, verdictRole)}`;
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
          role,
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
      assistant = [...session.messages].reverse().find((message) => message?.role === "assistant");
    } finally {
      finished = true;
      if (session) {
        try {
          await bounded(Promise.resolve(session.dispose()));
        } catch (error) {
          if (!["pi-agent-call-timeout", "pi-agent-call-cancelled"].includes(error?.message)) {
            failureCode ??= "pi-agent-session-failed";
          }
          throw new Error(failureCode ?? "pi-agent-session-failed");
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
              : !auditStatus.route_observed ? "openrouter-audit-route-unobserved"
                : "openrouter-audit-identity-mismatch";
        try { await bounded(auditProxy.close()); }
        catch { auditVerified = false; failureCode ??= "openrouter-audit-proxy-failed"; }
      }
      if (timer) clearTimeout(timer);
      for (const activeSignal of activeSignals) activeSignal.removeEventListener?.("abort", cancelHandler);
    }
    const identityVerified = !certificate || (auditProxy
      ? auditVerified
      : await verifyOpenRouterGeneration(certificate, assistant, ctx.signal ?? signal));
    if (!identityVerified) {
      failureCode ??= "openrouter-effective-route-unverified";
      throw new Error(failureCode);
    }
    let semantic;
    try {
      semantic = parseSemanticOutput(textOfAssistant(assistant));
    } catch {
      failureCode ??= "pi-agent-semantic-output-invalid";
      throw new Error(failureCode);
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
      evidence: assistant?.responseModel ? "verified-response" : "requested-only",
    };
    const attestationRef = certificate?.attestation_ref
      ?? `sha256:${sha256(JSON.stringify({ requested, effective }))}`;
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
      usage: usageOf(assistant),
      attempt: Number.isSafeInteger(ctx.attempt) && ctx.attempt > 0 ? ctx.attempt : 1,
      iteration: Number.isSafeInteger(ctx.pass) && ctx.pass > 0 ? ctx.pass : 1,
      input_ref: { kind: "sha256", value: inputHash, algorithm: "sha256" },
      claims_ref: `sha256:${semanticHash}`,
      evidence_ref: `sha256:${sha256(`${semanticHash}:evidence`)}`,
      ...semantic,
    };
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
    lastFailureCode() { return failureCode; },
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
        prompt: metaPrompt(ctx.task_instruction, `Rank these structural candidate projections:\n${JSON.stringify(input)}`), ctx,
      });
    },
    runSynthesis(input, ctx) {
      return run({
        role: "synthesizer", provider: ctx.synthesis.provider, model: ctx.synthesis.model, effort: ctx.synthesis.effort, stage: "synthesis",
        prompt: metaPrompt(ctx.task_instruction, `Synthesize these candidate projections without dropping contradictions:\n${JSON.stringify(input)}`), ctx,
      });
    },
    runVerifier(input, ctx) {
      return run({
        role: "verifier", provider: ctx.verification.provider, model: ctx.verification.model, effort: ctx.verification.effort, stage: "verification",
        prompt: metaPrompt(ctx.task_instruction, `Verify this structural workflow evidence:\n${JSON.stringify(input)}`), ctx,
      });
    },
  };
}

export { parseSemanticOutput };
