// Provider-neutral AgentRuntime contract and exact capability attestation.
// Secrets never enter these structures; account handles must be provider-issued
// opaque identifiers, not token hashes.

import { createHash } from "node:crypto";
import { isPublicCode, isModelId } from "../lib/public-values.mjs";

export const EVIDENCE_GRADES = Object.freeze([
  "verified-response", "verified-deployment", "verified-session", "requested-only", "unavailable",
]);
export const POLICY_STATES = Object.freeze(["official", "gray-unstable", "prohibited"]);
export const CERTIFICATION_STATES = Object.freeze([
  "uncertified-disabled", "contract-verified", "live-certified", "policy-blocked",
]);
export const CREDENTIAL_CLASSES = Object.freeze([
  "api-key", "workspace-token", "oauth", "managed-identity", "unknown", "mock",
]);

const ACCOUNT = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
const brand = new WeakSet();

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, required, optional = []) {
  if (!plain(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function validAccount(value) {
  return typeof value === "string" && ACCOUNT.test(value);
}

function validTuple(tuple, { effective = false } = {}) {
  const required = effective ? [] : ["provider", "model", "effort"];
  const optional = effective ? ["provider", "model", "effort", "route", "account"] : ["route", "expected_account"];
  if (!exactKeys(tuple, required, optional)) return false;
  if ((!effective || tuple.provider != null) && !isPublicCode(tuple.provider)) return false;
  if ((!effective || tuple.model != null) && !isModelId(tuple.model)) return false;
  if ((!effective || tuple.effort != null) && !["default", "provider-managed", "low", "medium", "high", "xhigh", "max"].includes(tuple.effort)) return false;
  if (tuple.route != null && !isPublicCode(tuple.route)) return false;
  if (tuple.expected_account != null && !validAccount(tuple.expected_account)) return false;
  if (tuple.account != null && !validAccount(tuple.account)) return false;
  return true;
}

function validEvidence(evidence) {
  const fields = ["provider", "model", "effort", "route", "account"];
  return exactKeys(evidence, [...fields, "source", "observed_at", "expires_at"])
    && fields.every((field) => EVIDENCE_GRADES.includes(evidence[field]))
    && isPublicCode(evidence.source)
    && Number.isSafeInteger(evidence.observed_at) && evidence.observed_at >= 0
    && Number.isSafeInteger(evidence.expires_at) && evidence.expires_at >= evidence.observed_at
    && evidence.expires_at - evidence.observed_at <= 5 * 60 * 1000;
}

export function validateCapabilityAttestation(attestation, { now = null } = {}) {
  if (!exactKeys(attestation, [
    "schema_version", "provider_path", "requested", "effective", "evidence", "credential_class",
    "policy", "certification", "session_binding", "certification_key",
  ]) || attestation.schema_version !== 1 || !isPublicCode(attestation.provider_path)
    || !validTuple(attestation.requested) || !validTuple(attestation.effective, { effective: true })
    || !validEvidence(attestation.evidence)
    || !CREDENTIAL_CLASSES.includes(attestation.credential_class)
    || !POLICY_STATES.includes(attestation.policy)
    || !CERTIFICATION_STATES.includes(attestation.certification)
    || !HASH.test(attestation.session_binding) || !HASH.test(attestation.certification_key)) {
    return { valid: false, code: "runtime-attestation-invalid" };
  }
  if (now != null && (!Number.isSafeInteger(now) || now < 0 || now > attestation.evidence.expires_at)) {
    return { valid: false, code: "runtime-attestation-stale" };
  }
  return { valid: true };
}

export function exactAttestationStatus(attestation, { now = Date.now(), require_live = false } = {}) {
  const valid = validateCapabilityAttestation(attestation, { now });
  if (!valid.valid) return { ok: false, code: valid.code };
  if (attestation.policy === "prohibited" || attestation.certification === "policy-blocked") {
    return { ok: false, code: "provider-policy-blocked" };
  }
  if (require_live && attestation.certification !== "live-certified") {
    return { ok: false, code: "provider-live-certification-required" };
  }
  for (const field of ["provider", "model", "effort", "account"]) {
    if (["requested-only", "unavailable"].includes(attestation.evidence[field])) {
      return { ok: false, code: `provider-${field}-unverified` };
    }
  }
  for (const field of ["provider", "model", "effort"] ) {
    if (attestation.effective[field] !== attestation.requested[field]) {
      return { ok: false, code: `provider-${field}-identity-mismatch` };
    }
  }
  if (attestation.requested.expected_account != null
    && attestation.effective.account !== attestation.requested.expected_account) {
    return { ok: false, code: "provider-account-identity-mismatch" };
  }
  if (attestation.requested.route != null) {
    if (["requested-only", "unavailable"].includes(attestation.evidence.route)) {
      return { ok: false, code: "provider-route-unverified" };
    }
    if (attestation.effective.route !== attestation.requested.route) {
      return { ok: false, code: "provider-route-identity-mismatch" };
    }
  }
  return { ok: true };
}

export function certificationKey(value) {
  const canonical = JSON.stringify(value, Object.keys(value).sort());
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

export function sessionBinding(value) {
  return `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;
}

export function brandRuntime(runtime) {
  if (!plain(runtime) || typeof runtime.preflight !== "function" || typeof runtime.execute !== "function"
    || typeof runtime.abort !== "function" || typeof runtime.dispose !== "function") {
    throw new Error("agent-runtime-contract-invalid");
  }
  brand.add(runtime);
  return runtime;
}

export function isBrandedRuntime(runtime) {
  return plain(runtime) && brand.has(runtime);
}

export function createMockAttestation({
  provider = "mock", model = "mock-model", effort = "medium", route = null,
  expected_account = "mock-account", now = 0, session = "mock-session",
} = {}) {
  const requested = { provider, model, effort, ...(route ? { route } : {}), expected_account };
  const effective = { provider, model, effort, ...(route ? { route } : {}), account: expected_account };
  return {
    schema_version: 1,
    provider_path: "mock",
    requested,
    effective,
    evidence: {
      provider: "verified-session", model: "verified-session", effort: "verified-session",
      route: route ? "verified-session" : "verified-session", account: "verified-session",
      source: "mock-runtime", observed_at: now, expires_at: now + 5 * 60 * 1000,
    },
    credential_class: "mock",
    policy: "official",
    certification: "live-certified",
    session_binding: sessionBinding(session),
    certification_key: certificationKey({ provider_path: "mock", version: 1 }),
  };
}
