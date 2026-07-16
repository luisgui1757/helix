import { boundedMaxOutput, createStrictRuntime, normalizeMessages } from "./strict-runtime.mjs";

export function createAzureClaudeRuntime({ transport } = {}) {
  return createStrictRuntime({
    provider_path: "azure-foundry-claude",
    transport,
    buildRequest(effect) {
      if (typeof effect.tuple.route !== "string" || effect.tuple.route.length === 0) throw new Error("azure-deployment-required");
      return {
        protocol: "azure-foundry-anthropic-messages",
        deployment: effect.tuple.route,
        model: effect.tuple.model,
        max_tokens: boundedMaxOutput(effect),
        ...(typeof effect.system === "string" ? { system: [{ type: "text", text: effect.system }] } : {}),
        messages: normalizeMessages(effect),
      };
    },
    inspectResponse(response, request, attestation) {
      const body = response?.body ?? response;
      const deployment = response?.deployment ?? response?.headers?.["x-ms-model-deployment"];
      if (!body || body.model !== attestation.requested.model || deployment !== request.deployment || !Array.isArray(body.content)) {
        return { ok: false, code: "azure-served-model-unverified" };
      }
      return {
        ok: true,
        value: body.content,
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
