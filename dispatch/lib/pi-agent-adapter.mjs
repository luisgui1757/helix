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
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1]);
  const candidates = [...fenced.reverse(), text];
  for (const candidate of candidates) {
    const starts = [];
    for (let index = 0; index < candidate.length; index += 1) if (candidate[index] === "{") starts.push(index);
    for (const start of starts.reverse()) {
      try {
        const parsed = JSON.parse(candidate.slice(start));
        if (validate(SEMANTIC_SCHEMA, parsed, "$").valid) return parsed;
      } catch {
        // Try an earlier opening brace.
      }
    }
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

async function defaultSessionFactory({ cwd, model, modelRegistry, role, thinkingLevel }) {
  const sdk = await import("@earendil-works/pi-coding-agent");
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
  const created = await sdk.createAgentSession({
    cwd,
    model,
    authStorage: modelRegistry.authStorage,
    modelRegistry,
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
} = {}) {
  if (!modelRegistry || typeof modelRegistry.find !== "function" || typeof modelRegistry.hasConfiguredAuth !== "function") {
    throw new Error("pi-model-registry-unavailable");
  }

  let failureCode = null;
  const run = async ({ role, provider, model: modelId, effort = "default", stage, prompt, ctx, verdictRole = null }) => {
    let model;
    let configured = false;
    try {
      model = modelRegistry.find(piProviderId(provider), modelId);
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
        const creating = Promise.resolve(sessionFactory({
          cwd: ctx.cwd,
          model,
          modelRegistry,
          role,
          effort,
          thinkingLevel,
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
      if (timer) clearTimeout(timer);
      for (const activeSignal of activeSignals) activeSignal.removeEventListener?.("abort", cancelHandler);
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
    return {
      schema_version: 2,
      run_id: ctx.run_id,
      stage,
      role,
      provider,
      model: modelId,
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
