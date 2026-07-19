import { boundedMaxOutput, checkedProviderUsagePair, createStrictRuntime, normalizeMessages } from "./strict-runtime.mjs";

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
      const usage = checkedProviderUsagePair(body.usage?.input_tokens, body.usage?.output_tokens);
      if (usage == null) return { ok: false, code: "provider-response-usage-invalid" };
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
        usage,
      };
    },
  });
}
