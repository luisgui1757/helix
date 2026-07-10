import { test } from "node:test";
import assert from "node:assert/strict";
import { projectCandidatesForJudge, evaluateJudgeSelection } from "../dispatch/lib/judge.mjs";
import { makeEnvelope } from "../dispatch/fixtures/sample.mjs";

const candidates = [
  makeEnvelope({ provider: "openai-api", model: "gpt-x", recommendation: "approach-1", risks: ["r1"] }),
  makeEnvelope({ provider: "openrouter", model: "vendor/y:free", recommendation: "approach-2", risks: ["r2"] }),
];

test("projection strips identity/cost fields and re-keys A/B", () => {
  const p = projectCandidatesForJudge(candidates, { seed: 3 });
  assert.deepEqual(p.projections.map((x) => x.key), ["A", "B"]);
  for (const proj of p.projections) {
    for (const field of ["provider", "model", "cost_class", "usage", "run_id", "attempt", "iteration", "input_ref"]) {
      assert.ok(!(field in proj), `${field} must be stripped`);
    }
    assert.ok("recommendation" in proj && "risks" in proj);
  }
});

test("permutation reorders candidates and is recorded for reproducibility", () => {
  const p = projectCandidatesForJudge(candidates, { seed: 9, permutation: [1, 0] });
  assert.deepEqual(p.permutation, [1, 0]);
  // position A now holds candidate index 1 (approach-2).
  assert.equal(p.projections[0].recommendation, "approach-2");
  assert.equal(p.projections[1].recommendation, "approach-1");
  assert.equal(p.blinding, true);
});

test("label reveals are recorded and turn off the blinding flag", () => {
  const p = projectCandidatesForJudge(candidates, {
    seed: 1,
    reveals: [{ index: 0, field: "provider", reason: "provider-specific capability matters" }],
  });
  assert.equal(p.blinding, false);
  assert.equal(p.label_reveal_events.length, 1);
  assert.equal(p.label_reveal_events[0].field, "provider");
  assert.ok(p.projections.some((x) => x.revealed_provider === "openai-api"));
});

test("a malformed permutation fails closed", () => {
  assert.throws(() => projectCandidatesForJudge(candidates, { seed: 0, permutation: [0, 0] }), /duplicates/);
  assert.throws(() => projectCandidatesForJudge(candidates, { seed: 0, permutation: [0] }), /length/);
  assert.throws(() => projectCandidatesForJudge([], { seed: 0 }), /at least one/);
});

test("judge-in-panel is surfaced as a warning; an out-of-panel judge is clean", () => {
  assert.deepEqual(evaluateJudgeSelection("j", ["a", "b"], ["j"]), { judge_in_panel: false, warning: null });
  assert.equal(evaluateJudgeSelection("a", ["a", "b"], ["c"]).warning, "judge_in_panel_avoidable");
  assert.equal(evaluateJudgeSelection("a", ["a", "b"], ["a", "b"]).warning, "judge_in_panel");
});
