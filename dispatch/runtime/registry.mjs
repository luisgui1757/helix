// Runtime registry keeps installed/configured/entitled/exact/certified truths
// separate. It never selects a different provider path after a refusal.

import { exactAttestationStatus, isBrandedRuntime } from "./contract.mjs";
import { providerPathFor, providerPolicy } from "./policy-register.mjs";

export function createRuntimeRegistry(runtimes = []) {
  const byPath = new Map();
  for (const runtime of runtimes) {
    if (!isBrandedRuntime(runtime) || typeof runtime.provider_path !== "string" || byPath.has(runtime.provider_path)) {
      throw new Error("runtime-registry-invalid");
    }
    byPath.set(runtime.provider_path, runtime);
  }
  return Object.freeze({
    paths() { return [...byPath.keys()].sort(); },
    get(path) { return byPath.get(path) ?? null; },
    async resolve(tuple, context = {}) {
      const path = context.provider_path ?? providerPathFor(tuple.provider, { credential_class: context.credential_class });
      if (!path) return { ok: false, code: "provider-path-unknown" };
      const policy = providerPolicy(path, { now: context.now ?? Date.now() });
      if (!policy.ok) return { ok: false, code: policy.code, provider_path: path };
      const runtime = byPath.get(path);
      if (!runtime) return { ok: false, code: "provider-runtime-not-installed", provider_path: path };
      let preflight;
      try { preflight = await runtime.preflight(tuple, context); } catch { preflight = null; }
      if (!preflight?.ok || !preflight.attestation) {
        return { ok: false, code: preflight?.code ?? "provider-runtime-preflight-failed", provider_path: path };
      }
      const exact = exactAttestationStatus(preflight.attestation, {
        now: context.now ?? Date.now(), require_live: context.require_live === true,
      });
      return exact.ok
        ? { ok: true, runtime, attestation: preflight.attestation, provider_path: path }
        : { ok: false, code: exact.code, provider_path: path };
    },
  });
}
