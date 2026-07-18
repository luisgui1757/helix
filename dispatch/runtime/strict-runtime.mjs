// Shared fail-closed implementation for provider-specific AgentRuntime adapters.
// Provider modules own request/response semantics; this module owns attestation,
// cancellation, exact tuple comparison, and the no-fallback execution contract.

import {
  brandRuntime,
  certificationKey,
  exactAttestationStatus,
  sessionBinding,
  validateCapabilityAttestation,
} from "./contract.mjs";

const HASH = /^sha256:[0-9a-f]{64}$/;

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactTuple(left, right) {
  return left?.provider === right?.provider && left?.model === right?.model
    && left?.effort === right?.effort
    && (left?.route ?? null) === (right?.route ?? null)
    && left?.expected_account === right?.account;
}

function exactRequested(left, right) {
  return left?.provider === right?.provider && left?.model === right?.model
    && left?.effort === right?.effort
    && (left?.route ?? null) === (right?.route ?? null)
    && (left?.expected_account ?? null) === (right?.expected_account ?? null);
}

function capabilityAttestation(providerPath, tuple, capability, adapterVersion) {
  if (!plain(capability) || !plain(capability.effective) || !plain(capability.evidence)
    || Object.keys(capability).some((key) => ![
      "effective", "evidence", "credential_class", "policy", "certification",
      "certification_ref", "session_binding",
    ].includes(key))
    || !["effective", "evidence", "credential_class", "certification", "certification_ref", "session_binding"]
      .every((key) => Object.hasOwn(capability, key))
    || typeof capability.certification_ref !== "string" || capability.certification_ref.length < 1
    || capability.certification_ref.length > 256
    || !HASH.test(capability.session_binding ?? "")
    || !["contract-verified", "live-certified"].includes(capability.certification)) return null;
  const attestation = {
    schema_version: 1,
    provider_path: providerPath,
    requested: structuredClone(tuple),
    effective: structuredClone(capability.effective),
    evidence: structuredClone(capability.evidence),
    credential_class: capability.credential_class,
    policy: capability.policy ?? "official",
    certification: capability.certification,
    session_binding: capability.session_binding,
    certification_key: certificationKey({
      provider_path: providerPath,
      adapter_version: adapterVersion,
      certification_ref: capability.certification_ref,
    }),
  };
  return validateCapabilityAttestation(attestation).valid ? attestation : null;
}

export function certifiedSessionBinding({ provider_path, session_id, account }) {
  if (![provider_path, session_id, account].every((value) => typeof value === "string" && value.length > 0)) {
    throw new Error("runtime-session-binding-invalid");
  }
  return sessionBinding(`${provider_path}\0${session_id}\0${account}`);
}

export function createStrictRuntime({
  provider_path,
  adapter_version = 1,
  transport,
  buildRequest,
  inspectResponse,
} = {}) {
  if (typeof provider_path !== "string" || typeof transport !== "function"
    || typeof buildRequest !== "function" || typeof inspectResponse !== "function") {
    throw new Error("strict-runtime-config-invalid");
  }
  const controllers = new Set();
  let disposed = false;
  const runtime = {
    provider_path,
    adapter_version,
    async preflight(tuple, context = {}) {
      if (disposed) return { ok: false, code: "provider-runtime-disposed" };
      const attestation = capabilityAttestation(provider_path, tuple, context.capability, adapter_version);
      if (!attestation) return { ok: false, code: "provider-capability-uncertified" };
      const exact = exactAttestationStatus(attestation, {
        now: context.now ?? Date.now(),
        require_live: context.require_live === true,
      });
      return exact.ok ? { ok: true, attestation } : { ok: false, code: exact.code };
    },
    async execute(effect, context = {}) {
      if (disposed) return { ok: false, code: "provider-runtime-disposed" };
      const attestation = context.attestation;
      const exact = exactAttestationStatus(attestation, {
        now: context.now ?? Date.now(),
        require_live: context.require_live === true,
      });
      if (!exact.ok || attestation.provider_path !== provider_path) {
        return { ok: false, code: exact.code ?? "provider-attestation-path-mismatch" };
      }
      if (!plain(effect) || !exactRequested(attestation.requested, effect.tuple)) {
        return { ok: false, code: "provider-effect-binding-mismatch" };
      }
      let request;
      try { request = buildRequest(effect, attestation); }
      catch { return { ok: false, code: "provider-request-invalid" }; }
      if (!plain(request)) return { ok: false, code: "provider-request-invalid" };
      const controller = new AbortController();
      const abort = () => controller.abort(context.signal?.reason ?? "provider-request-cancelled");
      if (context.signal?.aborted) abort();
      else context.signal?.addEventListener?.("abort", abort, { once: true });
      controllers.add(controller);
      let response;
      try {
        response = await transport(structuredClone(request), {
          signal: controller.signal,
          session_binding: attestation.session_binding,
        });
      } catch {
        return { ok: false, code: controller.signal.aborted ? "provider-request-cancelled" : "provider-request-failed" };
      } finally {
        controllers.delete(controller);
        context.signal?.removeEventListener?.("abort", abort);
      }
      let inspected;
      try { inspected = inspectResponse(response, request, attestation); }
      catch { inspected = null; }
      if (!plain(inspected) || inspected.ok !== true || !plain(inspected.effective)
        || !exactTuple(attestation.requested, inspected.effective)) {
        return { ok: false, code: inspected?.code ?? "provider-response-identity-mismatch" };
      }
      return {
        ok: true,
        value: structuredClone(inspected.value),
        usage: structuredClone(inspected.usage ?? { tokens: 0, cost_micros: 0 }),
        effective: structuredClone(inspected.effective),
        attestation_ref: attestation.certification_key,
      };
    },
    abort(reason = "provider-runtime-aborted") {
      for (const controller of controllers) controller.abort(reason);
    },
    dispose() {
      runtime.abort("provider-runtime-disposed");
      disposed = true;
    },
  };
  return brandRuntime(runtime);
}

export function normalizeMessages(effect) {
  if (!Array.isArray(effect.messages) || effect.messages.length < 1
    || effect.messages.some((message) => !plain(message)
      || !["user", "assistant"].includes(message.role)
      || typeof message.content !== "string" || message.content.length > 2_000_000)) {
    throw new Error("provider-messages-invalid");
  }
  return effect.messages.map((message) => ({ role: message.role, content: message.content }));
}

export function boundedMaxOutput(effect, fallback = 4096) {
  const value = effect.max_output_tokens ?? fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > 131_072) throw new Error("provider-max-output-invalid");
  return value;
}
