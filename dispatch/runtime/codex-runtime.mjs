import { boundedMaxOutput, createStrictRuntime, normalizeMessages } from "./strict-runtime.mjs";

export function createCodexRuntime({ transport, provider_path = "codex-business-token" } = {}) {
  if (!new Set(["codex-business-token", "codex-personal-oauth"]).has(provider_path)) {
    throw new Error("codex-provider-path-invalid");
  }
  return createStrictRuntime({
    provider_path,
    transport,
    buildRequest(effect) {
      return {
        protocol: "codex-app-server",
        model: effect.tuple.model,
        reasoning_effort: effect.tuple.effort,
        max_output_tokens: boundedMaxOutput(effect),
        instructions: effect.system ?? "",
        input: normalizeMessages(effect),
        fallback: false,
      };
    },
    inspectResponse(response, _request, attestation) {
      if (!response || response.model !== attestation.requested.model
        || response.effort !== attestation.requested.effort
        || response.account !== attestation.effective.account) {
        return { ok: false, code: "codex-effective-session-unverified" };
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
