import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { simulateWorkflow, testWorkflow, workflowFromExecution } from "../dispatch/lib/workflows.mjs";
import {
  evaluateCondition,
  migrateWorkflowV1,
  normalizeWorkflowDefinition,
  stableWorkflowStringify,
  validateWorkflowDefinition,
  workflowDefinitionHash,
} from "../dispatch/workflow/schema.mjs";
import { agent, checkpoint, decision, objectiveGate, pipeline, terminal, workflow } from "../dispatch/workflow/builder.mjs";
import { observedWorkflowGraph, plannedWorkflowGraph } from "../dispatch/workflow/visualize.mjs";

function currentWorkflow() {
  const chains = JSON.parse(readFileSync(new URL("../dispatch/config/chains.json", import.meta.url), "utf8"));
  const configs = JSON.parse(readFileSync(new URL("../dispatch/config/run-configs.json", import.meta.url), "utf8"));
  return workflowFromExecution(chains.chains[0], configs.configs[0], { source: "built-in" });
}

test("every kernel-compatible shipped chain normalizes losslessly and host-effect chains refuse migration", () => {
  const chains = JSON.parse(readFileSync(new URL("../dispatch/config/chains.json", import.meta.url), "utf8"));
  const base = JSON.parse(readFileSync(new URL("../dispatch/config/run-configs.json", import.meta.url), "utf8")).configs[0];
  for (const chain of chains.chains) {
    const config = { ...base, id: chain.id, chain: chain.id, max_iterations: chain.default_max_iterations };
    const migrated = migrateWorkflowV1(workflowFromExecution(chain, config, { source: "built-in" }));
    const hasHostEffects = chain.stages.some((stage) => stage.steps.some((step) => step.kind !== "role"));
    if (hasHostEffects) {
      assert.equal(migrated.code, "workflow-migration-host-effects-unsupported", chain.id);
      continue;
    }
    assert.equal(migrated.ok, true, `${chain.id}: ${JSON.stringify(migrated.errors)}`);
    assert.equal(validateWorkflowDefinition(migrated.definition).valid, true);
    assert.match(workflowDefinitionHash(migrated.definition), /^sha256:[0-9a-f]{64}$/);
  }
});

test("normalization is byte-stable and never mutates its source", () => {
  const source = currentWorkflow();
  const before = JSON.stringify(source);
  const first = normalizeWorkflowDefinition(source);
  const second = normalizeWorkflowDefinition(source);
  assert.equal(first.ok, true);
  assert.deepEqual(first.definition, second.definition);
  assert.equal(JSON.stringify(source), before);
  const normalizedAgain = normalizeWorkflowDefinition(first.definition);
  assert.equal(normalizedAgain.migrated, false);
  assert.deepEqual(normalizedAgain.definition, first.definition);
});

test("v4 definition checks report validation without claiming runtime branch coverage", () => {
  const definition = normalizeWorkflowDefinition(currentWorkflow()).definition;
  const checked = testWorkflow(definition);
  assert.equal(checked.ok, true);
  assert.equal(checked.transitions_validated, checked.transitions_total);
  assert.equal(Object.hasOwn(checked, "transitions_tested"), false);
  assert.equal(checked.runtime_tested, false);
  assert.equal(checked.simulation.converged, false);
  assert.equal(checked.simulation.stop_reason, "structural-v4-validation");
  assert.deepEqual(checked.simulation.trace, []);

  const simulated = simulateWorkflow(definition, [{ recommendation: "approve" }], { final_gate: "pass" });
  assert.equal(simulated.converged, false);
  assert.equal(simulated.signals_consumed, 0);
  assert.equal(simulated.final_gate, null);
});

test("v4 rejects unknown fields, unreachable nodes, unbounded cycles, and success without a final gate", () => {
  const base = normalizeWorkflowDefinition(currentWorkflow()).definition;
  const cases = [
    { ...base, extra: true },
    { ...base, nodes: { ...base.nodes, orphan: { kind: "terminal", status: "failed", code: "orphan" } } },
    { ...base, nodes: { ...base.nodes, plan: { ...base.nodes.plan, max_visits: undefined } } },
    { ...base, nodes: { ...base.nodes, "objective-gate": { ...base.nodes["objective-gate"], final: false } } },
  ];
  for (const candidate of cases) assert.equal(validateWorkflowDefinition(candidate).valid, false);
});

test("every target-bearing node field is forbidden from bypassing the final objective gate", () => {
  const base = normalizeWorkflowDefinition(currentWorkflow()).definition;
  const success = Object.keys(base.nodes).find((id) => base.nodes[id].kind === "terminal" && base.nodes[id].status === "succeeded");
  const finalGate = Object.keys(base.nodes).find((id) => base.nodes[id].kind === "gate" && base.nodes[id].final === true);
  const readOnly = agent({ role: "reviewer", stage_id: "probe", mutation: "read-only", timeout_ms: 1_000 });
  const candidates = [
    ["agent.next", { ...readOnly, next: success }],
    ["pipeline.next", pipeline([readOnly], success, { max_visits: 1 })],
    ["parallel.next", { kind: "parallel", branches: [readOnly], max_concurrency: 1, failure: "abort", next: success }],
    ["map.next", { kind: "map", items_path: "/inputs/items", max_items: 1, body: readOnly, failure: "abort", next: success }],
    ["reduce.next", { kind: "reduce", items_path: "/inputs/items", strategy: "collect", next: success }],
    ["decision.transitions[0].target", decision([{ when: { op: "always" }, target: success }], finalGate)],
    ["decision.default", decision([], success)],
    ["decision.loops_off", decision([], finalGate, { loops_off: success })],
    ["gate.on_pass", { kind: "gate", gate: base.objective_gate, on_pass: success, on_fail: finalGate }],
    ["gate.on_fail", { kind: "gate", gate: base.objective_gate, on_pass: finalGate, on_fail: success }],
    ["gate.loops_off", { kind: "gate", gate: base.objective_gate, on_pass: finalGate, on_fail: finalGate, loops_off: success }],
    ["checkpoint.next", { kind: "checkpoint", reason: "operator-approval", next: success }],
    ["subworkflow.next", { kind: "subworkflow", workflow_id: "child", version: 1, next: success }],
  ];
  for (const [label, probe] of candidates) {
    const candidate = structuredClone(base);
    candidate.nodes.probe = probe;
    candidate.start = "probe";
    const checked = validateWorkflowDefinition(candidate);
    assert.equal(checked.valid, false, label);
    assert.equal(checked.errors.some((entry) => entry.message.includes("succeeded terminal is reachable only")), true, label);
  }
  for (const field of ["on_fail", "loops_off"]) {
    const candidate = structuredClone(base);
    candidate.nodes[finalGate][field] = success;
    const checked = validateWorkflowDefinition(candidate);
    assert.equal(checked.valid, false, `final gate ${field}`);
    assert.equal(checked.errors.some((entry) => entry.path === `$.nodes.${finalGate}.${field}`
      && entry.message.includes("succeeded terminal is reachable only")), true, field);
  }
});

test("one top-level objective is the only final-gate authority", () => {
  const base = normalizeWorkflowDefinition(currentWorkflow()).definition;
  const finalGate = Object.keys(base.nodes).find((id) => base.nodes[id].kind === "gate" && base.nodes[id].final === true);
  const withLocalObjective = structuredClone(base);
  withLocalObjective.nodes[finalGate].gate = { type: "file-contains", path: "other.txt", contains: "OTHER" };
  assert.equal(validateWorkflowDefinition(withLocalObjective).valid, false);

  const withSecondFinal = structuredClone(base);
  withSecondFinal.nodes[finalGate].on_fail = "second-final";
  withSecondFinal.nodes["second-final"] = { kind: "gate", on_pass: "failed", on_fail: "failed", final: true };
  const checked = validateWorkflowDefinition(withSecondFinal);
  assert.equal(checked.valid, false);
  assert.equal(checked.errors.some((entry) => entry.message === "must contain exactly one final objective gate"), true);
});

test("v4 validation and v1 migration are total on malformed external input", () => {
  const base = normalizeWorkflowDefinition(currentWorkflow()).definition;
  const malformedV4 = [
    { ...base, nodes: null },
    { ...base, nodes: { route: { kind: "decision", default: "route" } }, start: "route" },
    { ...base, nodes: { route: { kind: "decision", transitions: "bad", default: "route" } }, start: "route" },
    { ...base, nodes: { work: { ...base.nodes[base.start], tools: null } }, start: "work" },
  ];
  for (const candidate of malformedV4) {
    let checked;
    assert.doesNotThrow(() => { checked = validateWorkflowDefinition(candidate); });
    assert.equal(checked.valid, false);
    assert.doesNotThrow(() => normalizeWorkflowDefinition(candidate));
    assert.equal(normalizeWorkflowDefinition(candidate).ok, false);
  }

  const current = currentWorkflow();
  const malformedV1 = [
    { ...current, stop: null },
    { ...current, deployment: null },
    { ...current, stages: [{ ...current.stages[0], transitions: null }] },
    { ...current, stages: [{ ...current.stages[0], steps: null }] },
  ];
  for (const candidate of malformedV1) {
    let migrated;
    assert.doesNotThrow(() => { migrated = migrateWorkflowV1(candidate); });
    assert.equal(migrated.ok, false);
    assert.equal(migrated.code, "workflow-migration-input-invalid");
  }

  const deep = structuredClone(base);
  const decisionId = Object.keys(deep.nodes).find((id) => deep.nodes[id].kind === "decision");
  let condition = { op: "always" };
  for (let index = 0; index < 40; index += 1) condition = { op: "not", condition };
  deep.nodes[decisionId].transitions[0].when = condition;
  let deepResult;
  assert.doesNotThrow(() => { deepResult = validateWorkflowDefinition(deep); });
  assert.equal(deepResult.valid, false);
  assert.equal(deepResult.errors.some((entry) => entry.message.includes("maximum condition depth 32")), true);
  assert.doesNotThrow(() => workflowDefinitionHash(deep));
  assert.equal(workflowDefinitionHash(deep), null);
});

test("pure builder creates the same closed definition contract", () => {
  const build = agent({ role: "builder", stage_id: "build", mutation: "shared-serialized" });
  const review = agent({ role: "reviewer", stage_id: "build", output_schema: "verdict-v1", mutation: "read-only" });
  const objective = { type: "file-contains", path: "proposal.txt", contains: "PASS" };
  const built = workflow({
    id: "builder-example",
    name: "Builder example",
    description: "A bounded build and review workflow.",
    start: "build",
    nodes: {
      build: pipeline([build, review], "route", { max_visits: 3, artifact: { path: "proposal.txt", kind: "notes" } }),
      route: decision([
        { when: { op: "eq", path: "/outputs/build/by_role/reviewer/recommendation", value: "approve" }, target: "objective", loop: true },
        { when: { op: "eq", path: "/outputs/build/by_role/reviewer/recommendation", value: "revise" }, target: "build", loop: true },
      ], "failed", { label: "Review decision", loops_off: "objective" }),
      objective: { ...objectiveGate("success", "build"), loops_off: "failed" },
      success: terminal("succeeded"),
      failed: terminal("failed", "review-verdict-invalid"),
    },
    objective_gate: objective,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
});

test("every cyclic decision edge is explicitly marked and has a loops-off escape", () => {
  const base = normalizeWorkflowDefinition(currentWorkflow()).definition;
  const routeId = Object.keys(base.nodes).find((id) => base.nodes[id].kind === "decision"
    && base.nodes[id].transitions.some((entry) => entry.loop === true));
  assert.ok(routeId);
  const unmarked = structuredClone(base);
  delete unmarked.nodes[routeId].transitions.find((entry) => entry.loop === true).loop;
  assert.equal(validateWorkflowDefinition(unmarked).errors.some((entry) => entry.message.includes("cyclic decision edge")), true);
  const noEscape = structuredClone(base);
  delete noEscape.nodes[routeId].loops_off;
  assert.equal(validateWorkflowDefinition(noEscape).errors.some((entry) => entry.message.includes("loops_off")), true);
  const acyclicMarked = structuredClone(base);
  acyclicMarked.nodes[routeId].default.loop = true;
  assert.equal(validateWorkflowDefinition(acyclicMarked).errors.some((entry) => entry.message.includes("only on a cyclic")), true);

  const forward = workflow({
    id: "forward-cycle", name: "Forward cycle", description: "A forward edge closes a cycle.", start: "route",
    nodes: {
      route: decision([{ when: { op: "always" }, target: "probe" }], "failed", { loops_off: "objective" }),
      probe: checkpoint("probe", "route"), objective: objectiveGate("success", "failed"),
      success: terminal("succeeded"), failed: terminal("failed", "failed"),
    },
    objective_gate: { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 },
  });
  assert.equal(forward.ok, false);
  assert.equal(forward.errors.some((entry) => entry.message.includes("cyclic decision edge")), true);
});

test("an inert acyclic decision loops_off cannot make its target structurally reachable", () => {
  const candidate = workflow({
    id: "inert-acyclic-escape", name: "Inert acyclic escape",
    description: "An acyclic decision cannot activate a loops-off-only branch.", start: "route",
    nodes: {
      route: decision([{ when: { op: "always" }, target: "objective" }], "failed", { loops_off: "escape" }),
      escape: checkpoint("inert-escape", "objective"),
      objective: objectiveGate("success", "failed"),
      success: terminal("succeeded"), failed: terminal("failed", "condition-unmatched"),
    },
    objective_gate: { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 },
  });
  assert.equal(candidate.ok, false);
  assert.equal(candidate.errors.some((entry) => entry.path === "$.nodes.route.loops_off"
    && entry.message.includes("cyclic decision edge marked loop:true")), true);
  assert.equal(candidate.errors.some((entry) => entry.path === "$.nodes.escape"
    && entry.message === "is unreachable from start"), true);
});

test("a valid cyclic decision loops_off escape supplies reachability and liveness", () => {
  const candidate = workflow({
    id: "cyclic-live-escape", name: "Cyclic live escape",
    description: "A marked decision loop escapes to the final objective when loops are disabled.", start: "route",
    nodes: {
      route: decision([{ when: { op: "always" }, target: "work", loop: true }], "failed", { loops_off: "objective" }),
      work: checkpoint("bounded-loop", "route"),
      objective: objectiveGate("success", "failed"),
      success: terminal("succeeded"), failed: terminal("failed", "condition-unmatched"),
    },
    objective_gate: { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 },
  });
  assert.equal(candidate.ok, true, JSON.stringify(candidate.errors));
});

test("accepted input schemas always have an object root and a safe integer witness", () => {
  const base = normalizeWorkflowDefinition(currentWorkflow()).definition;
  const noInteger = structuredClone(base);
  noInteger.inputs.properties.count = { type: "integer", minimum: 0.1, maximum: 0.9 };
  assert.equal(validateWorkflowDefinition(noInteger).errors.some((entry) => entry.message.includes("bounded numeric schema")), true);
  const scalarRoot = structuredClone(base);
  scalarRoot.inputs = { type: "string", minLength: 1 };
  assert.equal(validateWorkflowDefinition(scalarRoot).errors.some((entry) => entry.message.includes("root input schema")), true);
});

test("conditions use safe JSON pointers and missing values are false", () => {
  const context = { outputs: { review: { recommendation: "approve", risks: ["r1"] } } };
  assert.equal(evaluateCondition({ op: "eq", path: "/outputs/review/recommendation", value: "approve" }, context), true);
  assert.equal(evaluateCondition({ op: "contains", path: "/outputs/review/risks", value: "r1" }, context), true);
  assert.equal(evaluateCondition({ op: "eq", path: "/outputs/missing", value: "approve" }, context), false);
});

test("public workflow helpers are total on malformed and deeply nested JSON values", () => {
  let deep = "leaf";
  for (let index = 0; index < 20_000; index += 1) deep = [deep];
  let serialized;
  assert.doesNotThrow(() => { serialized = stableWorkflowStringify(deep); });
  assert.equal(serialized, null);
  let invalidAgent;
  assert.doesNotThrow(() => { invalidAgent = agent(null); });
  assert.equal(invalidAgent.kind, "agent");
  const definition = normalizeWorkflowDefinition(currentWorkflow()).definition;
  assert.deepEqual(observedWorkflowGraph(definition, {}), { ok: false, code: "workflow-events-invalid" });
});

test("direct v1 migration refuses host-effect steps instead of silently dropping them", () => {
  const legacy = currentWorkflow();
  legacy.stages[0].steps.push({ id: "host-check", kind: "local-check" });
  assert.equal(migrateWorkflowV1(legacy).code, "workflow-migration-host-effects-unsupported");
});

test("planned and observed graphs share stable ids without prompt content", () => {
  const definition = normalizeWorkflowDefinition(currentWorkflow()).definition;
  const planned = plannedWorkflowGraph(definition);
  assert.equal(planned.ok, true);
  assert.equal(JSON.stringify(planned).includes("tracked-step-v1"), false);
  const observed = observedWorkflowGraph(definition, [
    { kind: "node-start", node_id: definition.start },
    { kind: "effect-end", node_id: definition.start },
    { kind: "node-end", node_id: definition.start, status: "ok" },
  ]);
  assert.equal(observed.nodes.find((node) => node.id === definition.start).visits, 1);
  assert.equal(observed.nodes.find((node) => node.id === definition.start).effects, 1);
});
