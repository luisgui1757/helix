import { boundedMaxOutput, checkedProviderUsagePair, createStrictRuntime, normalizeMessages } from "./strict-runtime.mjs";

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
      const usage = checkedProviderUsagePair(body.usage?.input_tokens, body.usage?.output_tokens);
      if (usage == null) return { ok: false, code: "provider-response-usage-invalid" };
      return {
        ok: true,
        value: body.content,
        effective: {
          provider: attestation.requested.provider,
          model: body.model,
          effort: attestation.effective.effort,
          account: attestation.effective.account,
        },
        usage,
      };
    },
  });
}
