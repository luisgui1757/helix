// Staged chain state machine: verdict routing, back-jumps, red-first gate
// expectations, ceilings, budgets, loops-off degeneration, and the rule that
// only the objective gate concludes a run.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decideStageTransition,
  runStagedChain,
  STAGE_MACHINE_CODES,
} from "../dispatch/lib/stage-machine.mjs";
import { resolveChain, validateChainRegistry, chainRoles } from "../dispatch/lib/chains.mjs";

const registry = JSON.parse(readFileSync(new URL("../dispatch/config/chains.json", import.meta.url), "utf8"));
const fullCycle = resolveChain(registry, "full-cycle").chain;
const tddFix = resolveChain(registry, "tdd-fix").chain;

// Scripted deps: verdicts consumed per stage in order; gate results consumed in order.
function scripted({ verdicts = {}, gates = [] }) {
  const remaining = Object.fromEntries(Object.entries(verdicts).map(([k, v]) => [k, [...v]]));
  const gateQueue = [...gates];
  const stageCalls = [];
  const gateCalls = [];
  return {
    stageCalls,
    gateCalls,
    runStage(stage, ctx) {
      stageCalls.push(`${stage.id}#${ctx.pass}`);
      const queue = remaining[stage.id];
      const verdict = queue && queue.length ? queue.shift() : "approve";
      return stage.advance ? { verdict } : {};
    },
    runGate(ctx) {
      gateCalls.push(`${ctx.stage_id}:${ctx.phase}`);
      return { result: gateQueue.length ? gateQueue.shift() : "pass" };
    },
  };
}

// ---------------------------------------------------------------------------
// decideStageTransition — pure routing table
// ---------------------------------------------------------------------------

test("plain stages auto-advance; verdicts route approve/revise/jump; ceilings refuse", () => {
  const plain = { id: "recon", steps: [] };
  assert.equal(decideStageTransition(plain, 1, {}).action, "advance");

  const verdictStage = { id: "plan", steps: [], advance: { verdict_role: "reviewer", max_passes: 3 } };
  assert.equal(decideStageTransition(verdictStage, 1, { verdict: "approve" }).action, "advance");
  assert.equal(decideStageTransition(verdictStage, 1, { verdict: "revise" }).action, "stay");
  assert.equal(decideStageTransition(verdictStage, 3, { verdict: "revise" }).action, "refuse");
  assert.equal(decideStageTransition(verdictStage, 3, { verdict: "revise" }).code, "stage-max-passes-exhausted:plan");
  assert.equal(decideStageTransition(verdictStage, 1, { verdict: "revise-jump" }).action, "refuse");
  assert.equal(decideStageTransition(verdictStage, 1, {}).code, STAGE_MACHINE_CODES.VERDICT_MISSING);
  assert.equal(decideStageTransition(verdictStage, 1, { verdict: "ship-it" }).code, STAGE_MACHINE_CODES.VERDICT_INVALID);

  const jumpStage = { id: "implement", steps: [], advance: { verdict_role: "reviewer", max_passes: 3, allow_jump_to: "plan" } };
  const jump = decideStageTransition(jumpStage, 1, { verdict: "revise-jump" });
  assert.deepEqual({ action: jump.action, target: jump.target }, { action: "jump", target: "plan" });
});

test("gate-expectation stages advance only on the expected gate result", () => {
  const red = { id: "reproduce", steps: [], gate_expectation: "fail" };
  assert.equal(decideStageTransition(red, 1, { gate_result: "fail" }).action, "advance");
  assert.equal(decideStageTransition(red, 1, { gate_result: "pass" }).action, "stay");
  const off = decideStageTransition(red, 1, { gate_result: "pass" }, false);
  assert.equal(off.action, "advance");
  assert.match(off.warning, /loops-off-gate-expectation-unmet/);
});

test("loops OFF turns non-approve verdicts into recorded warnings, never loops", () => {
  const stage = { id: "plan", steps: [], advance: { verdict_role: "reviewer", max_passes: 3 } };
  const revise = decideStageTransition(stage, 1, { verdict: "revise" }, false);
  assert.equal(revise.action, "advance");
  assert.match(revise.warning, /loops-off-verdict-ignored:plan:revise/);
});

// ---------------------------------------------------------------------------
// runStagedChain — the owner's scenario and its edges
// ---------------------------------------------------------------------------

test("the flagship scenario: plan rejected twice, implementation rejected once, then converges", async () => {
  const deps = scripted({
    verdicts: {
      plan: ["revise", "revise", "approve"],
      implement: ["revise", "approve"],
    },
    gates: ["pass"],
  });
  const result = await runStagedChain({ chain: fullCycle, max_iterations: 10 }, deps);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.converged, true);
  assert.equal(result.stop_reason, "converged");
  assert.deepEqual(deps.stageCalls, ["plan#1", "plan#2", "plan#3", "implement#1", "implement#2"]);
  assert.equal(result.total_passes, 5);
  assert.deepEqual(result.flow.map((f) => f.action), ["stay", "stay", "advance", "stay", "advance"]);
  assert.equal(result.final_gate.result, "pass");
});

test("code review can send the work BACK to the plan stage (revise-jump)", async () => {
  const deps = scripted({
    verdicts: {
      plan: ["approve", "approve"],
      implement: ["revise-jump", "approve"],
    },
    gates: ["pass"],
  });
  const result = await runStagedChain({ chain: fullCycle, max_iterations: 10 }, deps);
  assert.equal(result.ok, true, JSON.stringify(result));
  // plan → implement (flags plan-flawed) → plan again → implement → gate.
  assert.deepEqual(deps.stageCalls, ["plan#1", "implement#1", "plan#2", "implement#2"]);
  const jumpEntry = result.flow.find((f) => f.action === "jump");
  assert.equal(jumpEntry.stage_id, "implement");
  assert.equal(jumpEntry.code, "stage-jump:implement:plan");
});

test("a failing final gate re-enters the last stage (the fix loop) until green", async () => {
  const deps = scripted({
    verdicts: { plan: ["approve"], implement: ["approve", "approve"] },
    gates: ["fail", "pass"],
  });
  const result = await runStagedChain({ chain: fullCycle, max_iterations: 10 }, deps);
  assert.equal(result.converged, true);
  assert.deepEqual(deps.stageCalls, ["plan#1", "implement#1", "implement#2"]);
  assert.ok(result.warnings.includes("final-gate-failed-reentering-last-stage"));
  assert.deepEqual(deps.gateCalls, ["implement:conclusion", "implement:conclusion"]);
});

test("a stage that never satisfies its reviewer exhausts its ceiling and refuses", async () => {
  const deps = scripted({ verdicts: { plan: ["revise", "revise", "revise"] } });
  const result = await runStagedChain({ chain: fullCycle, max_iterations: 10 }, deps);
  assert.equal(result.ok, false);
  assert.equal(result.code, "stage-max-passes-exhausted:plan");
  assert.equal(result.total_passes, 3);
});

test("jump passes are never reset: a plan/implement ping-pong hits the plan ceiling", async () => {
  const deps = scripted({
    verdicts: {
      plan: ["approve", "approve", "approve", "revise"],
      implement: ["revise-jump", "revise-jump", "revise-jump"],
    },
  });
  const result = await runStagedChain({ chain: fullCycle, max_iterations: 20 }, deps);
  // plan#1 ok, impl#1 jump, plan#2 ok, impl#2 jump, plan#3 ok, impl#3 jump,
  // plan#4 revise at max_passes 3 → already past ceiling → refuse.
  assert.equal(result.ok, false);
  assert.equal(result.code, "stage-max-passes-exhausted:plan");
});

test("the global max_iterations budget wins over everything", async () => {
  const deps = scripted({ verdicts: { plan: ["revise", "revise"] } });
  const result = await runStagedChain({ chain: fullCycle, max_iterations: 2 }, deps);
  assert.equal(result.ok, false);
  assert.equal(result.code, STAGE_MACHINE_CODES.NOT_CONVERGED);
  assert.equal(result.total_passes, 2);
});

test("tdd-fix is red-first: reproduce advances only once the gate FAILS", async () => {
  const deps = scripted({
    verdicts: { fix: ["approve"] },
    // reproduce expectation checks: pass (bug not reproduced → stay), fail (red! → advance),
    // then reproduce#2's expectation gate? No — order: repro#1 expectation=pass(stay),
    // repro#2 expectation=fail(advance), fix#1, conclusion=pass.
    gates: ["pass", "fail", "pass"],
  });
  const result = await runStagedChain({ chain: tddFix, max_iterations: 10 }, deps);
  assert.equal(result.converged, true, JSON.stringify(result));
  assert.deepEqual(deps.stageCalls, ["reproduce#1", "reproduce#2", "fix#1"]);
  assert.deepEqual(deps.gateCalls, [
    "reproduce:stage-expectation",
    "reproduce:stage-expectation",
    "fix:conclusion",
  ]);
});

test("loops OFF walks every stage once and lets the gate report without looping", async () => {
  const offToggles = { loops: false };
  const failing = scripted({ verdicts: { plan: ["revise"], implement: ["revise"] }, gates: ["fail"] });
  const blocked = await runStagedChain({ chain: fullCycle, max_iterations: 10, toggles: offToggles }, failing);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.stop_reason, "gate-failed-single-pass");
  assert.equal(blocked.total_passes, 2);
  assert.ok(blocked.warnings.some((w) => w.startsWith("loops-off-verdict-ignored:plan")));

  const passing = scripted({ verdicts: {}, gates: ["pass"] });
  const green = await runStagedChain({ chain: fullCycle, max_iterations: 10, toggles: offToggles }, passing);
  assert.equal(green.converged, true);
  assert.equal(green.total_passes, 2);
});

test("missing effects or rails refuse with stable codes; thrown effects never leak text", async () => {
  const noStage = await runStagedChain({ chain: fullCycle, max_iterations: 3 }, { runGate: () => ({ result: "pass" }) });
  assert.equal(noStage.code, STAGE_MACHINE_CODES.MISSING_RUN_STAGE);
  const noGate = await runStagedChain({ chain: fullCycle, max_iterations: 3 }, { runStage: () => ({}) });
  assert.equal(noGate.code, STAGE_MACHINE_CODES.MISSING_RUN_GATE);
  const noRail = await runStagedChain({ chain: fullCycle }, scripted({}));
  assert.equal(noRail.code, STAGE_MACHINE_CODES.MISSING_MAX_ITERATIONS);
  const badRail = await runStagedChain({ chain: fullCycle, max_iterations: 0 }, scripted({}));
  assert.equal(badRail.code, STAGE_MACHINE_CODES.UNBOUNDED_MAX_ITERATIONS);

  const thrower = {
    runStage() { throw new Error("SECRET " + "/Us" + "ers/nobody/private model text"); }, // split so repo scanners don't self-match
    runGate: () => ({ result: "pass" }),
  };
  const failed = await runStagedChain({ chain: fullCycle, max_iterations: 3 }, thrower);
  assert.equal(failed.code, STAGE_MACHINE_CODES.STAGE_FAILED);
  assert.ok(!JSON.stringify(failed).includes("SECRET"), "thrown effect text never surfaces");
});

// ---------------------------------------------------------------------------
// Chain registry v2 — the shipped catalog and its semantic guards
// ---------------------------------------------------------------------------

test("the shipped five-chain catalog is valid and carries the owner's shapes", () => {
  const valid = validateChainRegistry(registry);
  assert.deepEqual(valid.errors, []);
  assert.deepEqual(registry.chains.map((c) => c.id), ["full-cycle", "tdd-fix", "scout", "research", "ship-pre-pr"]);
  assert.equal(fullCycle.stages[0].artifact.path, "PLAN.md");
  assert.equal(fullCycle.stages[1].advance.allow_jump_to, "plan");
  assert.equal(tddFix.stages[0].gate_expectation, "fail");
  assert.deepEqual(chainRoles(fullCycle), ["planner", "reviewer", "builder", "redteam"]);
  const shipStages = resolveChain(registry, "ship-pre-pr").chain.stages;
  assert.equal(shipStages.length, 1);
  assert.equal(shipStages[0].advance, undefined);
});

test("semantic guards: verdict role must be in the stage; jumps only to earlier stages; verdict XOR gate expectation", () => {
  const base = (stages) => ({
    schema_version: 2,
    chains: [{
      id: "bad", description: "x", task_class: "routine-code",
      stages, requires_objective_gate: true, default_max_iterations: 3,
    }],
  });
  const verdictNotInStage = validateChainRegistry(base([{
    id: "one", steps: [{ id: "build", kind: "role", role: "builder" }],
    advance: { verdict_role: "reviewer", max_passes: 2 },
  }]));
  assert.equal(verdictNotInStage.valid, false);

  const forwardJump = validateChainRegistry(base([
    {
      id: "one", steps: [{ id: "review", kind: "role", role: "reviewer" }],
      advance: { verdict_role: "reviewer", max_passes: 2, allow_jump_to: "two" },
    },
    { id: "two", steps: [{ id: "build", kind: "role", role: "builder" }] },
  ]));
  assert.equal(forwardJump.valid, false, "a forward jump target must be refused");

  const both = validateChainRegistry(base([{
    id: "one", steps: [{ id: "review", kind: "role", role: "reviewer" }],
    advance: { verdict_role: "reviewer", max_passes: 2 },
    gate_expectation: "fail",
  }]));
  assert.equal(both.valid, false);

  const unsafeCeiling = base([{
    id: "one",
    steps: [{ id: "review", kind: "role", role: "reviewer" }],
    advance: { verdict_role: "reviewer", max_passes: Number.MAX_SAFE_INTEGER + 1 },
  }]);
  assert.equal(validateChainRegistry(unsafeCeiling).valid, false);

  const escapingArtifact = base([{
    id: "one",
    steps: [{ id: "build", kind: "role", role: "builder" }],
    artifact: { path: "../PLAN.md", kind: "plan" },
  }]);
  assert.equal(validateChainRegistry(escapingArtifact).valid, false);
});

test("schema v3 transitions use one verdict role and public stop codes", () => {
  const base = (transitions) => ({
    schema_version: 3,
    chains: [{
      id: "bad", description: "x", task_class: "routine-code",
      stages: [{
        id: "one", max_passes: 2,
        steps: [
          { id: "review", kind: "role", role: "reviewer" },
          { id: "redteam", kind: "role", role: "redteam" },
        ],
        transitions,
      }],
      requires_objective_gate: true, default_max_iterations: 3,
    }],
  });

  const mixedRoles = validateChainRegistry(base([
    { when: { type: "verdict", role: "reviewer", is: "approve" }, action: "advance" },
    { when: { type: "verdict", role: "redteam", is: "revise" }, action: "retry" },
  ]));
  assert.equal(mixedRoles.valid, false);

  const privateReason = validateChainRegistry(base([
    { when: { type: "always" }, action: "stop", reason: "../../private/task.txt" },
  ]));
  assert.equal(privateReason.valid, false);
});

// Resume validation regressions that previously had zero coverage.

test("resume continues from a valid persisted state without replaying the completed pass", async () => {
  // Plan already done (stage_index 1 = implement), 1 pass consumed.
  const deps = scripted({ verdicts: { implement: ["approve"] }, gates: ["pass"] });
  const result = await runStagedChain({
    chain: fullCycle,
    max_iterations: 10,
    resume: { phase: "stage", stage_index: 1, pass_counts: { plan: 1, implement: 0 }, total_passes: 1 },
  }, deps);
  assert.equal(result.converged, true, JSON.stringify(result));
  // The plan stage is NOT re-run; only implement executes.
  assert.deepEqual(deps.stageCalls, ["implement#1"]);
  assert.ok(result.warnings.some((w) => w === "resumed-at-pass:1"));
});

test("malformed resume states fail closed with invalid-resume-state", async () => {
  const bad = [
    { stage_index: 9, pass_counts: {}, total_passes: 0 },       // out-of-range index
    { stage_index: 0, pass_counts: {}, total_passes: 99 },      // total_passes >= max
    { stage_index: 0, pass_counts: { ghost: 1 }, total_passes: 0 }, // unknown stage id
    { stage_index: 0, pass_counts: { plan: -1 }, total_passes: 0 }, // negative count
    { stage_index: 0, total_passes: 0 },                        // missing pass_counts
  ];
  for (const resume of bad) {
    const result = await runStagedChain({ chain: fullCycle, max_iterations: 10, resume }, scripted({}));
    assert.equal(result.ok, false, JSON.stringify(resume));
    assert.equal(result.code, "invalid-resume-state", JSON.stringify(resume));
  }
});

test("resume checkpoints require exact safe counters, sums, ceilings, and coherent phases", async () => {
  const unsafe = Number.MAX_SAFE_INTEGER + 1;
  const bad = [
    { phase: "stage", stage_index: 1, pass_counts: { plan: 1 }, total_passes: 1 },
    { phase: "stage", stage_index: 1, pass_counts: { plan: 1, implement: 0, ghost: 0 }, total_passes: 1 },
    { phase: "stage", stage_index: 1, pass_counts: { plan: 1, implement: 0 }, total_passes: 2 },
    { phase: "stage", stage_index: 0, pass_counts: { plan: unsafe, implement: 0 }, total_passes: unsafe },
    { phase: "stage", stage_index: 0, pass_counts: { plan: 4, implement: 0 }, total_passes: 4 },
    { phase: "conclusion", stage_index: 0, pass_counts: { plan: 1, implement: 0 }, total_passes: 1 },
    { phase: "stage", stage_index: 1, pass_counts: { plan: 0, implement: 1 }, total_passes: 1 },
    { phase: "stage", stage_index: 0, pass_counts: { plan: 0, implement: 1 }, total_passes: 1 },
  ];
  for (const resume of bad) {
    const result = await runStagedChain({ chain: fullCycle, max_iterations: 10, resume }, scripted({}));
    assert.equal(result.code, "invalid-resume-state", JSON.stringify(resume));
  }
});

test("unsafe or impractical global rails fail closed before a stage effect", async () => {
  for (const max_iterations of [Number.MAX_SAFE_INTEGER + 1, 10_001]) {
    const deps = scripted({});
    const result = await runStagedChain({ chain: fullCycle, max_iterations }, deps);
    assert.equal(result.code, STAGE_MACHINE_CODES.UNBOUNDED_MAX_ITERATIONS);
    assert.deepEqual(deps.stageCalls, []);
  }
});

test("checkpoint hook failure stops the machine instead of warning and continuing", async () => {
  const deps = scripted({ verdicts: { plan: ["approve"] } });
  deps.onPass = () => { throw new Error("disk full"); };
  const result = await runStagedChain({ chain: fullCycle, max_iterations: 5 }, deps);
  assert.equal(result.code, STAGE_MACHINE_CODES.CHECKPOINT_FAILED);
  assert.deepEqual(deps.stageCalls, ["plan#1"]);
});

test("a conclusion-phase resume runs only the objective gate, never the completed stage", async () => {
  const deps = scripted({ gates: ["pass"] });
  const result = await runStagedChain({
    chain: fullCycle,
    max_iterations: 2,
    resume: {
      phase: "conclusion",
      stage_index: 1,
      pass_counts: { plan: 1, implement: 1 },
      total_passes: 2,
    },
  }, deps);
  assert.equal(result.converged, true);
  assert.deepEqual(deps.stageCalls, []);
  assert.deepEqual(deps.gateCalls, ["implement:conclusion"]);
});

test("malformed and typed gate integrity failures never enter authored fail transitions", async () => {
  const gateStage = {
    id: "gate-stage",
    max_passes: 1,
    steps: [],
    transitions: [{ when: { type: "gate", is: "fail" }, action: "stop", code: "accepted-fail" }],
  };
  const accessor = {};
  Object.defineProperty(accessor, "result", { get() { throw new Error("hostile-gate-accessor"); } });
  for (const gate of [
    null,
    {},
    { result: "error" },
    { result: "pass", code: "unexpected-code" },
    { result: "fail", unexpected: "not-closed" },
    { result: "error", code: "objective-gate-timeout", unexpected: "not-closed" },
    { result: "unknown" },
    accessor,
  ]) {
    const result = await runStagedChain({ chain: { stages: [gateStage] }, max_iterations: 1 }, {
      runStage: async () => ({}),
      runGate: async () => gate,
    });
    assert.equal(result.ok, false, JSON.stringify(gate));
    assert.equal(result.code, STAGE_MACHINE_CODES.GATE_FAILED_EFFECT, JSON.stringify(gate));
    assert.equal(result.flow.at(-1)?.action, "refuse", JSON.stringify(gate));
  }

  const typed = await runStagedChain({ chain: { stages: [gateStage] }, max_iterations: 1 }, {
    runStage: async () => ({}),
    runGate: async () => ({ result: "error", code: "objective-gate-timeout" }),
  });
  assert.equal(typed.ok, false);
  assert.equal(typed.code, "objective-gate-timeout");
  assert.equal(typed.flow.at(-1)?.action, "refuse");
});
