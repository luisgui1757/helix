import { boundedMaxOutput, createStrictRuntime, normalizeMessages } from "./strict-runtime.mjs";

export function createAzureOpenAIRuntime({ transport } = {}) {
  return createStrictRuntime({
    provider_path: "azure-openai",
    transport,
    buildRequest(effect) {
      if (typeof effect.tuple.route !== "string" || effect.tuple.route.length === 0) throw new Error("azure-deployment-required");
      return {
        protocol: "azure-openai-responses",
        deployment: effect.tuple.route,
        model: effect.tuple.model,
        input: [
          ...(typeof effect.system === "string" ? [{ role: "developer", content: effect.system }] : []),
          ...normalizeMessages(effect),
        ],
        max_output_tokens: boundedMaxOutput(effect),
        ...(effect.tuple.effort === "default" || effect.tuple.effort === "provider-managed"
          ? {} : { reasoning: { effort: effect.tuple.effort } }),
      };
    },
    inspectResponse(response, request, attestation) {
      const body = response?.body ?? response;
      const deployment = response?.deployment ?? response?.headers?.["x-ms-model-deployment"];
      if (!body || body.model !== attestation.requested.model || deployment !== request.deployment || !Array.isArray(body.output)) {
        return { ok: false, code: "azure-served-model-unverified" };
      }
      return {
        ok: true,
        value: body.output,
        effective: {
          provider: attestation.requested.provider,
          model: body.model,
          effort: attestation.effective.effort,
          route: deployment,
          account: attestation.effective.account,
        },
        usage: { tokens: (body.usage?.input_tokens ?? 0) + (body.usage?.output_tokens ?? 0), cost_micros: 0 },
      };
    },
  });
}
