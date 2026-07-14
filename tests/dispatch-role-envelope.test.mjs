import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateRoleEnvelope,
  assertRoleEnvelope,
  isRoleValidForStage,
  ROLES,
  STAGES,
} from "../dispatch/lib/role-envelope.mjs";
import { SchemaError } from "../dispatch/lib/schema.mjs";
import { makeEnvelope } from "../dispatch/fixtures/sample.mjs";

test("a well-formed candidate envelope validates", () => {
  const { valid, errors } = validateRoleEnvelope(makeEnvelope());
  assert.equal(valid, true, JSON.stringify(errors));
});

test("judge/synthesis stage envelopes validate for their roles", () => {
  assert.equal(validateRoleEnvelope(makeEnvelope({ stage: "judge", role: "judge" })).valid, true);
  assert.equal(validateRoleEnvelope(makeEnvelope({ stage: "synthesis", role: "synthesizer" })).valid, true);
  assert.equal(validateRoleEnvelope(makeEnvelope({ stage: "verification", role: "verifier" })).valid, true);
});

test("role/stage mismatch fails closed", () => {
  // judge is only valid in the judge stage, never as a candidate.
  const { valid, errors } = validateRoleEnvelope(makeEnvelope({ stage: "candidate", role: "judge" }));
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.path === "$.role" && /not allowed in stage/.test(e.message)));
});

test("isRoleValidForStage matrix", () => {
  assert.equal(isRoleValidForStage("candidate", "builder"), true);
  assert.equal(isRoleValidForStage("candidate", "synthesizer"), false);
  assert.equal(isRoleValidForStage("judge", "judge"), true);
  assert.equal(isRoleValidForStage("verification", "documenter"), true);
});

test("malformed provider is rejected before judge/synthesis", () => {
  const { valid, errors } = validateRoleEnvelope(makeEnvelope({ provider: "provider/with/path" }));
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.path === "$.provider"));
});

test("missing required field is rejected", () => {
  const bad = makeEnvelope();
  delete bad.status;
  assert.equal(validateRoleEnvelope(bad).valid, false);
});

test("unexpected extra field is rejected (fail closed on malformed payload)", () => {
  const { valid } = validateRoleEnvelope(makeEnvelope({ injected: "surprise" }));
  assert.equal(valid, false);
});

test("malformed nested usage is rejected", () => {
  const { valid, errors } = validateRoleEnvelope(makeEnvelope({ usage: { input_tokens: "ten" } }));
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.path === "$.usage.input_tokens"));
});

test("negative token counts are rejected", () => {
  for (const field of ["input_tokens", "output_tokens"]) {
    const { valid, errors } = validateRoleEnvelope(makeEnvelope({ usage: { [field]: -1 } }));
    assert.equal(valid, false, field);
    assert.ok(errors.some((e) => e.path === `$.usage.${field}`), field);
  }
});

test("removed cost-accounting fields fail closed (usage is tokens-only, no cost_class)", () => {
  // schema_version 2 removed cost_class and all cost/price usage fields;
  // additionalProperties:false means a legacy payload is rejected, not ignored.
  const legacyUsage = validateRoleEnvelope(makeEnvelope({ usage: { cost_estimate_usd: 0 } }));
  assert.equal(legacyUsage.valid, false);
  assert.ok(legacyUsage.errors.some((e) => e.path === "$.usage.cost_estimate_usd"));

  const legacyCostClass = validateRoleEnvelope(makeEnvelope({ cost_class: "free" }));
  assert.equal(legacyCostClass.valid, false);
  assert.ok(legacyCostClass.errors.some((e) => e.path === "$.cost_class"));
});

test("schema_version is pinned to 2 (a v1 envelope is rejected)", () => {
  const { valid, errors } = validateRoleEnvelope(makeEnvelope({ schema_version: 1 }));
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.path === "$.schema_version"));
});

test("assertRoleEnvelope throws on malformed output (gate before judge)", () => {
  assert.throws(() => assertRoleEnvelope({ nope: true }), (e) => e instanceof SchemaError);
  assert.equal(assertRoleEnvelope(makeEnvelope()).status, "ok");
});

test("roles and stages sets match the spec counts", () => {
  assert.equal(ROLES.length, 9);
  assert.deepEqual([...STAGES], ["candidate", "judge", "synthesis", "verification"]);
});
