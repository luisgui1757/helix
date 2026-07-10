import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXTURES } from "../dispatch/fixtures/index.mjs";
import { classify } from "../dispatch/lib/classify.mjs";
import { routeForClass, resolvePanel } from "../dispatch/lib/routes.mjs";
import { isAutomatedDispatchProvider } from "../dispatch/lib/providers.mjs";
import { validateRoleEnvelope } from "../dispatch/lib/role-envelope.mjs";
import { projectCandidatesForJudge } from "../dispatch/lib/judge.mjs";
import { buildRunRecord, validateRunRecord } from "../dispatch/lib/run-record.mjs";

// One end-to-end policy pass per fixture, asserting every oracle field. This is
// the contract that the pure policy layer routes, bounds, validates, gates, and
// logs deterministically — before any live model call exists.
for (const fx of FIXTURES) {
  test(`fixture: ${fx.id}`, () => {
    const { expect } = fx;

    // --- classification + route ---
    const decision = classify(fx.task, { mode: fx.task.mode });
    assert.equal(decision.task_class, expect.task_class, "task_class");
    assert.equal(decision.route_id, expect.route_id, "route_id");
    assert.equal(decision.fail_closed, false, "classification should not fail closed");
    for (const w of expect.classify_warnings_include) {
      assert.ok(decision.warnings.includes(w), `missing classify warning ${w}`);
    }

    // --- panel resolution (route-owned bounds; requested = fixture candidates) ---
    const route = routeForClass(decision.task_class);
    assert.ok(route, "route resolves");
    assert.equal(route.gate_kind, "objective", "fixtures use objective-gate routes");
    const panel = resolvePanel(route, fx.candidates.length);
    assert.equal(panel.launched, expect.panel.launched, "launched");
    assert.equal(panel.required_successes, expect.panel.required_successes, "required_successes");
    assert.equal(panel.fail_closed, expect.panel.fail_closed, "panel fail_closed");
    for (const w of expect.panel.warnings_include) {
      assert.ok(panel.warnings.includes(w), `missing panel warning ${w}`);
    }

    // --- per-candidate envelope validity + automated-dispatch provider gate ---
    for (const cand of fx.candidates) {
      if (cand.envelope !== null && cand.envelope !== undefined) {
        assert.equal(validateRoleEnvelope(cand.envelope).valid, cand.expect_valid, `envelope validity (${fx.id})`);
      } else {
        assert.equal(cand.expect_valid, null, "unlaunched candidate has null expect_valid");
        assert.ok(cand.provider_gate, "unlaunched candidate carries a provider-gate refusal");
        assert.equal(
          isAutomatedDispatchProvider(cand.provider_gate.provider),
          false,
          `refused provider must not be automated (${fx.id})`,
        );
        // The stable refusal code the orchestrator emits for this provider.
        assert.equal(cand.expect_refusal, `provider-not-automated:${cand.provider_gate.provider}`, `refusal code (${fx.id})`);
      }
    }

    // --- judge blinding (when the route deliberates) ---
    if (fx.judge) {
      const launched = fx.candidates.filter((c) => c.envelope).map((c) => c.envelope);
      const proj = projectCandidatesForJudge(launched, { seed: fx.judge.seed, permutation: fx.judge.permutation });
      assert.deepEqual(proj.projections.map((p) => p.key), expect.judge.keys, "judge keys");
      assert.equal(proj.blinding, expect.judge.blinding, "blinding flag");
      for (const p of proj.projections) {
        assert.ok(!("provider" in p) && !("model" in p), "judge projection hides provider/model");
      }
    }

    // --- public-safe run record ---
    const record = buildRunRecord(fx.run_record);
    assert.equal(validateRunRecord(record).valid, true, "record schema-valid");
    assert.equal(record.exit_status, expect.run_record.exit_status, "exit_status");
    assert.equal(record.gate.source, expect.run_record.gate_source, "gate source is objective, not model narrative");
    for (const w of expect.run_record.warning_codes_include) {
      assert.ok(record.warning_codes.includes(w), `missing run-record warning ${w}`);
    }
    // Tokens-only rollup: capacity telemetry, never cost accounting.
    assert.deepEqual(Object.keys(record.usage_rollup).sort(), ["input_tokens", "output_tokens"], "usage_rollup is tokens-only");
    for (const removed of ["cost_class", "price_status", "cap_status"]) {
      assert.equal(removed in record, false, `record must not carry removed field ${removed}`);
    }
    // Structural public-safe guarantee: no free text leaked into refs.
    assert.match(record.claims_ref, /^(sha256:|local-ref:|redacted-id:)/);
    assert.equal(record.run_target.repo === "self" ? typeof record.branch : "string", "string");
  });
}

test("fixtures cover the five spec scenarios", () => {
  assert.deepEqual(
    FIXTURES.map((f) => f.id).sort(),
    ["code-review", "extension-implementation-plan", "roadmap-reconciliation", "security-posture", "ui-quality"],
  );
});
