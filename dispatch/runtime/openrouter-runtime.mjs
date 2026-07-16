import { boundedMaxOutput, createStrictRuntime, normalizeMessages } from "./strict-runtime.mjs";

export function createOpenRouterRuntime({ transport } = {}) {
  return createStrictRuntime({
    provider_path: "openrouter",
    transport,
    buildRequest(effect) {
      if (typeof effect.tuple.route !== "string" || effect.tuple.route.length === 0) {
        throw new Error("openrouter-route-required");
      }
      return {
        protocol: "openrouter-chat-completions",
        model: effect.tuple.model,
        messages: [
          ...(typeof effect.system === "string" ? [{ role: "system", content: effect.system }] : []),
          ...normalizeMessages(effect),
        ],
        max_tokens: boundedMaxOutput(effect),
        stream: false,
        provider: {
          only: [effect.tuple.route],
          order: [effect.tuple.route],
          allow_fallbacks: false,
          require_parameters: true,
          data_collection: "deny",
          zdr: true,
        },
        ...(Array.isArray(effect.tools) ? { tools: structuredClone(effect.tools) } : {}),
        ...(effect.output_schema ? { response_format: { type: "json_schema", json_schema: structuredClone(effect.output_schema) } } : {}),
      };
    },
    inspectResponse(response, _request, attestation) {
      const body = response?.body ?? response;
      if (!body || body.model !== attestation.requested.model || body.provider !== attestation.requested.route
        || !Array.isArray(body.choices)) return { ok: false, code: "openrouter-effective-route-unverified" };
      return {
        ok: true,
        value: body.choices,
        effective: {
          provider: attestation.requested.provider,
          model: body.model,
          effort: attestation.effective.effort,
          route: body.provider,
          account: attestation.effective.account,
        },
        usage: {
          tokens: body.usage?.total_tokens ?? 0,
          cost_micros: Number.isSafeInteger(body.usage?.cost_micros) ? body.usage.cost_micros : 0,
        },
      };
    },
  });
}
