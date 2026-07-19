import { boundedMaxOutput, checkedProviderUsagePair, createStrictRuntime, normalizeMessages } from "./strict-runtime.mjs";

export function createOpenAIRuntime({ transport } = {}) {
  return createStrictRuntime({
    provider_path: "openai-api",
    transport,
    buildRequest(effect) {
      return {
        protocol: "openai-responses",
        model: effect.tuple.model,
        input: [
          ...(typeof effect.system === "string" ? [{ role: "developer", content: effect.system }] : []),
          ...normalizeMessages(effect),
        ],
        max_output_tokens: boundedMaxOutput(effect),
        ...(effect.tuple.effort === "default" || effect.tuple.effort === "provider-managed"
          ? {} : { reasoning: { effort: effect.tuple.effort } }),
        ...(Array.isArray(effect.tools) ? { tools: structuredClone(effect.tools) } : {}),
        ...(effect.output_schema ? { text: { format: { type: "json_schema", ...structuredClone(effect.output_schema) } } } : {}),
      };
    },
    inspectResponse(response, _request, attestation) {
      const body = response?.body ?? response;
      if (!body || body.model !== attestation.requested.model || !Array.isArray(body.output)) {
        return { ok: false, code: "provider-response-identity-mismatch" };
      }
      const usage = checkedProviderUsagePair(body.usage?.input_tokens, body.usage?.output_tokens);
      if (usage == null) return { ok: false, code: "provider-response-usage-invalid" };
      return {
        ok: true,
        value: body.output,
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
