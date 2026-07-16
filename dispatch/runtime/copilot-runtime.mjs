import { boundedMaxOutput, createStrictRuntime, normalizeMessages } from "./strict-runtime.mjs";

export function createCopilotRuntime({ transport } = {}) {
  return createStrictRuntime({
    provider_path: "github-copilot",
    transport,
    buildRequest(effect) {
      return {
        protocol: "github-copilot-sdk",
        model: effect.tuple.model,
        reasoning_effort: effect.tuple.effort,
        max_output_tokens: boundedMaxOutput(effect),
        system_message: effect.system ?? "",
        messages: normalizeMessages(effect),
        fallback: false,
      };
    },
    inspectResponse(response, _request, attestation) {
      if (!response || response.model !== attestation.requested.model
        || response.effort !== attestation.requested.effort
        || response.account !== attestation.effective.account) {
        return { ok: false, code: "copilot-effective-session-unverified" };
      }
      return {
        ok: true,
        value: response.output,
        effective: {
          provider: attestation.requested.provider,
          model: response.model,
          effort: response.effort,
          ...(attestation.requested.route ? { route: response.route } : {}),
          account: response.account,
        },
        usage: { tokens: response.usage?.total_tokens ?? 0, cost_micros: 0 },
      };
    },
  });
}
