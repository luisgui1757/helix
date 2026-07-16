import test from "node:test";
import assert from "node:assert/strict";

import {
  brandRuntime,
  certificationKey,
  createMockAttestation,
  exactAttestationStatus,
  isBrandedRuntime,
  validateCapabilityAttestation,
} from "../dispatch/runtime/contract.mjs";
import { providerPathFor, providerPolicy } from "../dispatch/runtime/policy-register.mjs";
import { createRuntimeRegistry } from "../dispatch/runtime/registry.mjs";
import { isSupportedPiVersion } from "../dispatch/runtime/pi-runtime.mjs";

function runtime(attestation = createMockAttestation()) {
  return brandRuntime({
    provider_path: "mock",
    async preflight() { return { ok: true, attestation }; },
    async execute() { return { ok: true }; },
    async abort() {},
    async dispose() {},
  });
}

test("runtime branding cannot be forged with a kind string", () => {
  const forged = { provider_path: "mock", kind: "helix-agent-runtime", preflight() {}, execute() {}, abort() {}, dispose() {} };
  assert.equal(isBrandedRuntime(forged), false);
  assert.equal(isBrandedRuntime(runtime()), true);
});

test("exact attestation binds provider, model, effort, route, and account", () => {
  const good = createMockAttestation({ route: "provider-a" });
  assert.equal(validateCapabilityAttestation(good, { now: 1 }).valid, true);
  assert.equal(exactAttestationStatus(good, { now: 1, require_live: true }).ok, true);
  for (const field of ["provider", "model", "effort", "account"] ) {
    const bad = structuredClone(good);
    if (field === "account") bad.effective.account = "different-account";
    else bad.effective[field] = field === "provider" ? "different" : field === "model" ? "different-model" : "high";
    assert.equal(exactAttestationStatus(bad, { now: 1 }).ok, false, field);
  }
  const route = structuredClone(good);
  route.effective.route = "provider-b";
  assert.equal(exactAttestationStatus(route, { now: 1 }).code, "provider-route-identity-mismatch");
});

test("provider-issued account labels are opaque identifiers, not paths", () => {
  const dotted = createMockAttestation({ expected_account: "account..provider-label" });
  assert.equal(validateCapabilityAttestation(dotted, { now: 1 }).valid, true);
  const whitespace = createMockAttestation({ expected_account: "account label" });
  assert.equal(validateCapabilityAttestation(whitespace, { now: 1 }).code, "runtime-attestation-invalid");
});

test("requested-only, stale, uncertified, and prohibited paths refuse", () => {
  const requested = createMockAttestation();
  requested.evidence.model = "requested-only";
  assert.equal(exactAttestationStatus(requested, { now: 1 }).code, "provider-model-unverified");
  assert.equal(validateCapabilityAttestation(createMockAttestation({ now: 0 }), { now: 300_001 }).code, "runtime-attestation-stale");
  const uncertified = createMockAttestation();
  uncertified.certification = "contract-verified";
  assert.equal(exactAttestationStatus(uncertified, { now: 1, require_live: true }).code, "provider-live-certification-required");
  const blocked = createMockAttestation();
  blocked.policy = "prohibited";
  assert.equal(exactAttestationStatus(blocked, { now: 1 }).code, "provider-policy-blocked");
});

test("registry never falls back after exact preflight refusal", async () => {
  let calls = 0;
  const bad = createMockAttestation();
  bad.evidence.model = "requested-only";
  const first = runtime(bad);
  first.preflight = async () => { calls += 1; return { ok: true, attestation: bad }; };
  // Re-brand because replacing methods preserves object identity/brand.
  const registry = createRuntimeRegistry([first]);
  const result = await registry.resolve({ provider: "mock", model: "mock-model", effort: "medium" }, { now: 1 });
  assert.equal(result.ok, false);
  assert.equal(result.code, "provider-model-unverified");
  assert.equal(calls, 1);
});

test("policy separates official, gray, prohibited, and expired", () => {
  assert.equal(providerPathFor("openai-codex", { credential_class: "workspace-token" }), "codex-business-token");
  assert.equal(providerPathFor("openai-codex"), "codex-personal-oauth");
  assert.equal(providerPolicy("anthropic-consumer-oauth", { now: Date.parse("2026-07-16") }).code, "provider-policy-blocked");
  assert.equal(providerPolicy("openrouter", { now: Date.parse("2026-07-16") }).ok, true);
  assert.equal(providerPolicy("openrouter", { now: Date.parse("2026-09-01") }).code, "provider-policy-expired");
});

test("Pi range is exact and certification keys are deterministic", () => {
  assert.equal(isSupportedPiVersion("0.80.7"), true);
  assert.equal(isSupportedPiVersion("0.80.99"), true);
  assert.equal(isSupportedPiVersion("0.80.6"), false);
  assert.equal(isSupportedPiVersion("0.81.0"), false);
  assert.equal(certificationKey({ a: 1, b: 2 }), certificationKey({ b: 2, a: 1 }));
});
