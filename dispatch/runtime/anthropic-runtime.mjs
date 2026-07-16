import { boundedMaxOutput, createStrictRuntime, normalizeMessages } from "./strict-runtime.mjs";

export function createAnthropicRuntime({ transport } = {}) {
  return createStrictRuntime({
    provider_path: "anthropic-api",
    transport,
    buildRequest(effect) {
      return {
        protocol: "anthropic-messages",
        model: effect.tuple.model,
        max_tokens: boundedMaxOutput(effect),
        ...(typeof effect.system === "string" ? { system: [{ type: "text", text: effect.system }] } : {}),
        messages: normalizeMessages(effect),
        ...(Array.isArray(effect.tools) ? { tools: structuredClone(effect.tools) } : {}),
      };
    },
    inspectResponse(response, _request, attestation) {
      const body = response?.body ?? response;
      if (!body || body.model !== attestation.requested.model || !Array.isArray(body.content)) {
        return { ok: false, code: "provider-response-identity-mismatch" };
      }
      return {
        ok: true,
        value: body.content,
        effective: {
          provider: attestation.requested.provider,
          model: body.model,
          effort: attestation.effective.effort,
          account: attestation.effective.account,
        },
        usage: {
          tokens: (body.usage?.input_tokens ?? 0) + (body.usage?.output_tokens ?? 0),
          cost_micros: 0,
        },
      };
    },
  });
}
