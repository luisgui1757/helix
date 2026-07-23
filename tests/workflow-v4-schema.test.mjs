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
import { agent, checkpoint, decision, map, objectiveGate, parallel, pipeline, terminal, workflow } from "../dispatch/workflow/builder.mjs";
import { observedWorkflowGraph, plannedWorkflowGraph } from "../dispatch/workflow/visualize.mjs";

function currentWorkflow() {
  const chains = JSON.parse(readFileSync(new URL("../dispatch/config/chains.json", import.meta.url), "utf8"));
  const configs = JSON.parse(readFileSync(new URL("../dispatch/config/run-configs.json", import.meta.url), "utf8"));
  return workflowFromExecution(chains.chains[0], configs.configs[0], { source: "built-in" });
}

function eventStream(definition, events = [], { mode = "original-mode", runId = "visual-run", resume = false } = {}) {
  return [{
    kind: resume ? "run-resume" : "run-start",
    node_id: definition.start,
    definition_ref: workflowDefinitionHash(definition),
    ...(mode === "graph-mode" ? { execution_mode: mode } : {}),
  }, ...events].map((event, index) => ({
    schema_version: 1,
    seq: index + 1,
    run_id: runId,
    ...event,
  }));
}

function executionEvents(definition, nodeId, visit = 1, { slots = null, status = "ok" } = {}) {
  const node = definition.nodes[nodeId];
  const slotCount = slots ?? (node.kind === "agent" ? 1
    : node.kind === "pipeline" ? node.stages.length
      : node.kind === "parallel" ? node.branches.length
        : node.kind === "map" ? 0 : null);
  if (slotCount == null) return [];
  const effectRef = `sha256:${"a".repeat(64)}`;
  return [
    { kind: "effect-plan", node_id: nodeId, slot_count: slotCount },
    ...Array.from({ length: slotCount }, (_, index) => {
      const instanceId = node.kind === "agent"
        ? `${nodeId}:${visit}:attempt-1`
        : `${nodeId}:${visit}:${index}:attempt-1`;
      return [
        { kind: "effect-start", node_id: nodeId, instance_id: instanceId, effect_ref: effectRef },
        { kind: "effect-end", node_id: nodeId, instance_id: instanceId, effect_ref: effectRef, status },
      ];
    }).flat(),
  ];
}

function completedVisit(definition, nodeId, { visit = 1, edge = null } = {}) {
  const node = definition.nodes[nodeId];
  return [
    { kind: "node-start", node_id: nodeId, visit },
    ...executionEvents(definition, nodeId, visit),
    ...(node.kind === "gate" ? [{
      kind: "gate", node_id: nodeId,
      result: edge?.kind === "pass" ? "pass" : "fail", final: node.final === true,
    }] : []),
    { kind: "node-end", node_id: nodeId, status: node.kind === "terminal" ? node.status : "ok", ...(node.code ? { code: node.code } : {}) },
  ];
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
  assert.deepEqual(agent({ role: "reviewer", stage_id: "review" }).tools, ["read", "grep", "find", "ls"]);
});

test("v4 executable agent and workspace policy fields are closed to implemented contracts", () => {
  const base = normalizeWorkflowDefinition(currentWorkflow()).definition;
  const pipelineId = Object.keys(base.nodes).find((id) => base.nodes[id].kind === "pipeline");
  const agentPath = `$.nodes.${pipelineId}.stages[0]`;
  const cases = [
    ["role", "judge"],
    ["prompt", "custom-prompt"],
    ["output_schema", { id: "freeform-v1" }],
  ];
  for (const [field, value] of cases) {
    const candidate = structuredClone(base);
    candidate.nodes[pipelineId].stages[0][field] = value;
    const checked = validateWorkflowDefinition(candidate);
    assert.equal(checked.valid, false, field);
    assert.equal(checked.errors.some((entry) => entry.path === `${agentPath}.${field}`), true, field);
  }
  const builderVerdict = structuredClone(base);
  builderVerdict.nodes[pipelineId].stages[0].role = "builder";
  builderVerdict.nodes[pipelineId].stages[0].mutation = "shared-serialized";
  builderVerdict.nodes[pipelineId].stages[0].output_schema = { id: "verdict-v1" };
  assert.equal(validateWorkflowDefinition(builderVerdict).errors.some((entry) => entry.path === `${agentPath}.output_schema`), true);

  for (const [field, value] of [["proposal_cleanup", "explicit"], ["transcripts", "private"]]) {
    const candidate = structuredClone(base);
    candidate.workspace_policy[field] = value;
    const checked = validateWorkflowDefinition(candidate);
    assert.equal(checked.valid, false, field);
    assert.equal(checked.errors.some((entry) => entry.path === "$.workspace_policy"), true, field);
  }
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
  assert.equal(JSON.stringify(planned).includes('"value":"approve"'), false);
  assert.equal(planned.edges.every((edge) => typeof edge.id === "string" && typeof edge.field === "string"), true);
  assert.equal(typeof planned.final_gate_id, "string");
  assert.equal(typeof planned.success_terminal_id, "string");
  assert.equal(Array.isArray(planned.cycles), true);
  assert.equal(Array.isArray(planned.loops_disabled_cycles), true);
  const observed = observedWorkflowGraph(definition, eventStream(definition, [
    { kind: "node-start", node_id: definition.start, visit: 1 },
    ...executionEvents(definition, definition.start),
    { kind: "node-end", node_id: definition.start, status: "ok" },
  ]));
  assert.equal(observed.nodes.find((node) => node.id === definition.start).visits, 1);
  assert.equal(observed.nodes.find((node) => node.id === definition.start).effects,
    definition.nodes[definition.start].kind === "agent" ? 1 : definition.nodes[definition.start].stages.length);

  const selected = planned.edges.find((edge) => edge.from === definition.start);
  const exactTransition = [
    ...completedVisit(definition, selected.from, { edge: selected }),
    {
      kind: "transition", node_id: selected.from, target: selected.to,
      edge_id: selected.id, edge_kind: selected.kind,
    },
  ];
  const exact = observedWorkflowGraph(definition, eventStream(definition, exactTransition));
  assert.deepEqual(exact.observed_edges, [{ id: selected.id, kind: selected.kind, from: selected.from, to: selected.to }]);
  assert.equal(exact.edge_traversals[0].count, 1);
  const wrongEdge = structuredClone(exactTransition);
  wrongEdge.at(-1).edge_id = "wrong:edge";
  assert.deepEqual(observedWorkflowGraph(definition, eventStream(definition, wrongEdge)), {
    ok: false, code: "workflow-events-invalid",
  });

  const duplicate = planned.edges.find((edge) => planned.edges.some((candidate) =>
    candidate.id !== edge.id && candidate.from === edge.from && candidate.to === edge.to));
  assert.ok(duplicate);
  const queue = [[definition.start, []]];
  const seen = new Set();
  let prefix = null;
  while (queue.length > 0 && prefix == null) {
    const [nodeId, path] = queue.shift();
    if (nodeId === duplicate.from) {
      prefix = path;
      break;
    }
    if (seen.has(nodeId)) continue;
    seen.add(nodeId);
    for (const edge of planned.edges.filter((entry) => entry.from === nodeId)) {
      queue.push([edge.to, [...path, edge]]);
    }
  }
  assert.ok(prefix);
  const legacyEvents = prefix.flatMap((edge) => [
    ...completedVisit(definition, edge.from, { edge }),
    { kind: "transition", node_id: edge.from, target: edge.to },
  ]);
  legacyEvents.push(
    ...completedVisit(definition, duplicate.from, { edge: duplicate }),
    { kind: "transition", node_id: duplicate.from, target: duplicate.to },
  );
  const legacy = observedWorkflowGraph(definition,
    eventStream(definition, legacyEvents));
  const ambiguous = legacy.observed_edges.find((edge) => edge.ambiguous === true);
  assert.equal(ambiguous?.ambiguous, true);
  assert.equal(ambiguous.candidate_edge_ids.length, 2);
});

test("observed graphs reject corrupt modes, event kinds, statuses, and graph edge identity", () => {
  const definition = normalizeWorkflowDefinition(currentWorkflow()).definition;
  const planned = plannedWorkflowGraph(definition);
  const selected = planned.edges.find((edge) => edge.from === definition.start);
  const [start] = eventStream(definition, [], { mode: "graph-mode" });
  assert.deepEqual(observedWorkflowGraph(definition, [{ ...start, execution_mode: "not-a-mode" }]), {
    ok: false, code: "workflow-events-invalid",
  });
  assert.deepEqual(observedWorkflowGraph(definition, [{ ...start, kind: "unknown-event" }]), {
    ok: false, code: "workflow-events-invalid",
  });
  assert.deepEqual(observedWorkflowGraph(definition, eventStream(definition, [
    { kind: "node-end", node_id: definition.start, status: "maybe" },
  ])), {
    ok: false, code: "workflow-events-invalid",
  });
  assert.deepEqual(observedWorkflowGraph(definition, [start, {
    schema_version: 1, seq: 2, run_id: start.run_id,
    kind: "transition", node_id: selected.from, target: selected.to,
  }], { execution_mode: "graph-mode" }), { ok: false, code: "workflow-events-invalid" });
  assert.deepEqual(observedWorkflowGraph(definition, [{ ...start, execution_mode: undefined }], {
    execution_mode: "graph-mode",
  }), { ok: false, code: "workflow-events-invalid" });
  const exact = observedWorkflowGraph(definition, eventStream(definition, [
    ...completedVisit(definition, selected.from, { edge: selected }),
    {
      kind: "transition", node_id: selected.from, target: selected.to,
      edge_id: selected.id, edge_kind: selected.kind,
    },
  ], { mode: "graph-mode" }), { execution_mode: "graph-mode" });
  assert.equal(exact.ok, true);
  assert.equal(exact.current_node, selected.to);
  assert.equal(exact.last_node, selected.from);
  assert.deepEqual(observedWorkflowGraph(definition, [{
    ...start, definition_ref: `sha256:${"f".repeat(64)}`,
  }], { execution_mode: "graph-mode" }), { ok: false, code: "workflow-events-invalid" });
  assert.deepEqual(observedWorkflowGraph(definition, [start, {
    schema_version: 1, seq: 2, run_id: start.run_id,
    kind: "node-start", node_id: definition.start, visit: 1,
    execution_mode: "original-mode", unexpected: true,
  }], { execution_mode: "graph-mode" }), { ok: false, code: "workflow-events-invalid" });
  assert.deepEqual(observedWorkflowGraph(definition, [{
    schema_version: 1, seq: 1, run_id: "visual-run",
    kind: "node-start", node_id: definition.start, visit: 1,
  }], { execution_mode: "graph-mode" }), { ok: false, code: "workflow-events-invalid" });
  assert.deepEqual(observedWorkflowGraph(definition, eventStream(definition, [
    { kind: "node-end", node_id: definition.start, status: "ok" },
  ], { mode: "graph-mode" }), { execution_mode: "graph-mode" }), {
    ok: false, code: "workflow-events-invalid",
  });
  assert.deepEqual(observedWorkflowGraph(definition, eventStream(definition, [
    { kind: "node-start", node_id: definition.start, visit: 2 },
  ], { mode: "graph-mode" }), { execution_mode: "graph-mode" }), {
    ok: false, code: "workflow-events-invalid",
  });
});

test("observed graph lifecycle binds effects and objective-gated terminal success in both modes", () => {
  const built = workflow({
    id: "visual-lifecycle", name: "Visual lifecycle", description: "Lifecycle admission fixture.",
    start: "work",
    nodes: {
      work: { ...agent({ role: "reviewer", stage_id: "work", mutation: "read-only" }), next: "objective" },
      objective: objectiveGate("succeeded", "failed"),
      succeeded: terminal("succeeded"),
      failed: terminal("failed", "visual-lifecycle-failed"),
    },
    objective_gate: { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 },
  });
  assert.equal(built.ok, true);
  const definition = built.definition;
  const effectRef = `sha256:${"a".repeat(64)}`;
  for (const mode of ["original-mode", "graph-mode"]) {
    const options = { execution_mode: mode };
    const stream = (events, extra = {}) => eventStream(definition, events, { mode, ...extra });
    assert.deepEqual(observedWorkflowGraph(definition, stream([
      { kind: "node-start", node_id: "work", visit: 1 },
      { kind: "effect-end", node_id: "work", instance_id: "orphan", effect_ref: effectRef, status: "ok" },
    ]), options), { ok: false, code: "workflow-events-invalid" });
    assert.deepEqual(observedWorkflowGraph(definition, stream([
      { kind: "node-start", node_id: "work", visit: 1 },
      { kind: "effect-start", node_id: "work", instance_id: "open", effect_ref: effectRef },
      { kind: "node-end", node_id: "work", status: "ok" },
    ]), options), { ok: false, code: "workflow-events-invalid" });
    assert.deepEqual(observedWorkflowGraph(definition, stream([
      { kind: "node-start", node_id: "work", visit: 1 },
      { kind: "node-end", node_id: "work", status: "ok" },
      { kind: "run-end", node_id: "work", status: "succeeded" },
    ]), options), { ok: false, code: "workflow-events-invalid" });
    assert.deepEqual(observedWorkflowGraph(definition, stream([
      { kind: "node-start", node_id: "work", visit: 1 },
      { kind: "effect-resumed", node_id: "work", instance_id: "not-resumed" },
    ]), options), { ok: false, code: "workflow-events-invalid" });

    const edge = (id, kind, from, target) => ({
      kind: "transition", node_id: from, target,
      ...(mode === "graph-mode" ? { edge_id: id, edge_kind: kind } : {}),
    });
    const succeeded = stream([
      { kind: "node-start", node_id: "work", visit: 1 },
      { kind: "effect-plan", node_id: "work", slot_count: 1 },
      { kind: "effect-start", node_id: "work", instance_id: "work:1:attempt-1", effect_ref: effectRef },
      { kind: "effect-end", node_id: "work", instance_id: "work:1:attempt-1", effect_ref: effectRef, status: "ok" },
      { kind: "node-end", node_id: "work", status: "ok" },
      edge("work:next", "next", "work", "objective"),
      { kind: "node-start", node_id: "objective", visit: 1 },
      { kind: "gate", node_id: "objective", result: "pass", final: true },
      { kind: "node-end", node_id: "objective", status: "ok" },
      edge("objective:pass", "pass", "objective", "succeeded"),
      { kind: "node-start", node_id: "succeeded", visit: 1 },
      { kind: "node-end", node_id: "succeeded", status: "succeeded" },
      { kind: "run-end", node_id: "succeeded", status: "succeeded" },
    ]);
    assert.equal(observedWorkflowGraph(definition, succeeded, options).ok, true);
    const forgedTerminal = structuredClone(succeeded);
    const objectiveTransition = forgedTerminal.findIndex((event) => event.kind === "transition" && event.node_id === "objective");
    forgedTerminal[objectiveTransition] = {
      ...forgedTerminal[objectiveTransition], ...edge("objective:fail", "fail", "objective", "failed"),
    };
    for (const event of forgedTerminal.slice(objectiveTransition + 1)) event.node_id = "failed";
    assert.deepEqual(observedWorkflowGraph(definition, forgedTerminal, options), {
      ok: false, code: "workflow-events-invalid",
    });

    const resumed = stream([
      { kind: "node-start", node_id: "work", visit: 1 },
      { kind: "effect-plan", node_id: "work", slot_count: 1 },
      { kind: "effect-start", node_id: "work", instance_id: "work:1:attempt-1", effect_ref: effectRef },
      {
        kind: "run-resume", node_id: "work", definition_ref: workflowDefinitionHash(definition),
        ...(mode === "graph-mode" ? { execution_mode: mode } : {}),
      },
      { kind: "node-start", node_id: "work", visit: 1 },
      { kind: "effect-plan", node_id: "work", slot_count: 1 },
      {
        kind: "effect-resumed", node_id: "work", instance_id: "work:1:attempt-1",
        effect_ref: effectRef, status: "ok",
      },
      { kind: "node-end", node_id: "work", status: "ok" },
    ]);
    assert.equal(observedWorkflowGraph(definition, resumed, options).ok, true);

    const orphanResume = stream([
      { kind: "node-start", node_id: "work", visit: 1 },
      { kind: "effect-plan", node_id: "work", slot_count: 1 },
      {
        kind: "effect-resumed", node_id: "work", instance_id: "work:1:attempt-1",
        effect_ref: effectRef, status: "ok",
      },
    ], { resume: true });
    assert.deepEqual(observedWorkflowGraph(definition, orphanResume, options), {
      ok: false, code: "workflow-events-invalid",
    });
  }
});

test("successful observed visits prove every authored effect obligation and controlled retry", () => {
  const readOnly = (stageId, retry = undefined) => agent({
    role: "reviewer", stage_id: stageId, mutation: "read-only", timeout_ms: 1_000,
    ...(retry ? { retry } : {}),
  });
  const makeDefinition = (id, work, inputs = undefined) => {
    const built = workflow({
      id, name: id, description: "Observed effect obligation fixture.", start: "work",
      ...(inputs ? { inputs } : {}),
      nodes: {
        work,
        objective: objectiveGate("succeeded", "failed"),
        succeeded: terminal("succeeded"),
        failed: terminal("failed", `${id}-failed`),
      },
      objective_gate: { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 },
    });
    assert.equal(built.ok, true, JSON.stringify(built.errors));
    return built.definition;
  };
  const effectRef = `sha256:${"d".repeat(64)}`;
  const effect = (nodeId, instanceId, status = "ok", code = null) => [
    { kind: "effect-start", node_id: nodeId, instance_id: instanceId, effect_ref: effectRef },
    {
      kind: "effect-end", node_id: nodeId, instance_id: instanceId, effect_ref: effectRef, status,
      ...(status === "ok" ? {} : { code, failure_class: "agent" }),
    },
  ];
  const visit = (definition, body) => eventStream(definition, [
    { kind: "node-start", node_id: "work", visit: 1 },
    ...body,
    { kind: "node-end", node_id: "work", status: "ok" },
  ], { mode: "graph-mode" });
  const admitted = (definition, body) => observedWorkflowGraph(definition, visit(definition, body), {
    execution_mode: "graph-mode",
  }).ok;

  const single = makeDefinition("obligation-agent", {
    ...readOnly("work", { max_attempts: 2, backoff_ms: 0 }), next: "objective",
  });
  assert.equal(admitted(single, []), false);
  assert.equal(admitted(single, [
    { kind: "effect-plan", node_id: "work", slot_count: 1 },
    ...effect("work", "work:1:attempt-1", "failed", "pi-agent-provider-failed"),
  ]), false);
  const retry = [
    { kind: "effect-plan", node_id: "work", slot_count: 1 },
    ...effect("work", "work:1:attempt-1", "failed", "pi-agent-provider-failed"),
    {
      kind: "effect-retry", node_id: "work", instance_id: "work:1",
      prior_instance_id: "work:1:attempt-1", attempt: 1, next_attempt: 2,
    },
    ...effect("work", "work:1:attempt-2"),
  ];
  assert.equal(admitted(single, retry), true);
  assert.equal(admitted(single, retry.filter((event) => event.kind !== "effect-retry")), false);

  const twoStage = makeDefinition("obligation-pipeline",
    pipeline([readOnly("first"), readOnly("second")], "objective", { max_visits: 1 }));
  assert.equal(admitted(twoStage, [
    { kind: "effect-plan", node_id: "work", slot_count: 2 },
    ...effect("work", "work:1:0:attempt-1"),
  ]), false);
  assert.equal(admitted(twoStage, [
    { kind: "effect-plan", node_id: "work", slot_count: 2 },
    ...effect("work", "work:1:1:attempt-1"),
    ...effect("work", "work:1:0:attempt-1"),
  ]), false);
  assert.equal(admitted(twoStage, [
    { kind: "effect-plan", node_id: "work", slot_count: 2 },
    { kind: "effect-start", node_id: "work", instance_id: "work:1:0:attempt-1", effect_ref: effectRef },
    { kind: "effect-start", node_id: "work", instance_id: "work:1:1:attempt-1", effect_ref: effectRef },
    { kind: "effect-end", node_id: "work", instance_id: "work:1:0:attempt-1", effect_ref: effectRef, status: "ok" },
    { kind: "effect-end", node_id: "work", instance_id: "work:1:1:attempt-1", effect_ref: effectRef, status: "ok" },
  ]), false);
  assert.equal(admitted(twoStage, [
    { kind: "effect-plan", node_id: "work", slot_count: 2 },
    ...effect("work", "work:1:0:attempt-1"),
    ...effect("work", "work:1:1:attempt-1"),
  ]), true);

  const twoBranch = makeDefinition("obligation-parallel",
    parallel([readOnly("left"), readOnly("right")], "objective", { max_concurrency: 2 }));
  assert.equal(admitted(twoBranch, [
    { kind: "effect-plan", node_id: "work", slot_count: 2 },
    ...effect("work", "work:1:0:attempt-1"),
  ]), false);
  assert.equal(admitted(twoBranch, [
    { kind: "effect-plan", node_id: "work", slot_count: 2 },
    ...effect("work", "work:1:1:attempt-1"),
    ...effect("work", "work:1:0:attempt-1"),
  ]), true);
  const settling = makeDefinition("obligation-settle", parallel(
    [readOnly("left"), readOnly("right")], "objective",
    { max_concurrency: 2, failure: "settle", allow_failure_codes: ["accepted-agent-failure"] },
  ));
  assert.equal(admitted(settling, [
    { kind: "effect-plan", node_id: "work", slot_count: 2 },
    ...effect("work", "work:1:0:attempt-1", "failed", "accepted-agent-failure"),
    ...effect("work", "work:1:1:attempt-1"),
  ]), true);

  const mapInputs = {
    type: "object", additionalProperties: false, required: ["task", "items"],
    properties: {
      task: { type: "string", minLength: 1, maxLength: 65_536 },
      items: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 2 },
    },
  };
  const mapped = makeDefinition("obligation-map",
    map("/inputs/items", readOnly("item"), "objective", { max_items: 2 }), mapInputs);
  assert.equal(admitted(mapped, [{ kind: "effect-plan", node_id: "work", slot_count: 0 }]), true);
  assert.equal(admitted(mapped, [
    { kind: "effect-plan", node_id: "work", slot_count: 2 },
    ...effect("work", "work:1:0:attempt-1"),
  ]), false);
  assert.equal(admitted(mapped, [
    { kind: "effect-plan", node_id: "work", slot_count: 2 },
    ...effect("work", "work:1:0:attempt-1"),
    ...effect("work", "work:1:1:attempt-1"),
  ]), true);

  assert.equal(admitted(single, [
    { kind: "effect-plan", node_id: "work", slot_count: 1 },
    ...effect("work", "work:1:member-0:attempt-1"),
    ...effect("work", "work:1:member-2:attempt-1"),
  ]), false);
  assert.equal(admitted(single, [
    { kind: "effect-plan", node_id: "work", slot_count: 1 },
    ...effect("work", "work:1:member-0:attempt-1"),
    ...effect("work", "work:1:member-1:attempt-1"),
  ]), true);
});

test("observed effect control is bounded by authored retry and repair policy", () => {
  const built = workflow({
    id: "visual-effect-policy", name: "Visual effect policy", description: "Effect policy fixture.",
    start: "work",
    nodes: {
      work: {
        ...agent({
          role: "reviewer", stage_id: "work", mutation: "read-only",
          retry: { max_attempts: 1, backoff_ms: 0 },
        }),
        next: "objective",
      },
      objective: objectiveGate("succeeded", "failed"),
      succeeded: terminal("succeeded"),
      failed: terminal("failed", "visual-effect-policy-failed"),
    },
    limits: { structured_repair_attempts: 0 },
    objective_gate: { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 },
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const effectRef = `sha256:${"b".repeat(64)}`;
  const failedAttempt = [
    { kind: "node-start", node_id: "work", visit: 1 },
    { kind: "effect-plan", node_id: "work", slot_count: 1 },
    { kind: "effect-start", node_id: "work", instance_id: "work:1:attempt-1", effect_ref: effectRef },
    {
      kind: "effect-end", node_id: "work", instance_id: "work:1:attempt-1", effect_ref: effectRef,
      status: "failed", code: "pi-agent-effect-failed", failure_class: "agent",
    },
  ];
  const excessiveRetry = eventStream(built.definition, [...failedAttempt, {
    kind: "effect-retry", node_id: "work", instance_id: "work:1",
    prior_instance_id: "work:1:attempt-1", attempt: 1, next_attempt: 2,
  }]);
  assert.deepEqual(observedWorkflowGraph(built.definition, excessiveRetry), {
    ok: false, code: "workflow-events-invalid",
  });
  const retrying = structuredClone(built.definition);
  retrying.nodes.work.retry.max_attempts = 2;
  assert.equal(observedWorkflowGraph(retrying, eventStream(retrying, excessiveRetry.slice(1).map((event) => {
    const copied = structuredClone(event);
    delete copied.schema_version;
    delete copied.seq;
    delete copied.run_id;
    return copied;
  }))).ok, true);

  const semanticFailure = structuredClone(failedAttempt);
  semanticFailure[3].code = "pi-agent-semantic-output-invalid";
  const excessiveRepair = eventStream(built.definition, [...semanticFailure, {
    kind: "effect-repair", node_id: "work", instance_id: "work:1",
    prior_instance_id: "work:1:attempt-1", repair_attempt: 1,
  }]);
  assert.deepEqual(observedWorkflowGraph(built.definition, excessiveRepair), {
    ok: false, code: "workflow-events-invalid",
  });
});

test("journal-ahead recovery has an explicit bounded observed event", () => {
  const built = workflow({
    id: "visual-effect-recovery", name: "Visual effect recovery", description: "Recovery event fixture.",
    start: "work",
    nodes: {
      work: { ...agent({ role: "reviewer", stage_id: "work", mutation: "read-only" }), next: "objective" },
      objective: objectiveGate("succeeded", "failed"),
      succeeded: terminal("succeeded"),
      failed: terminal("failed", "visual-effect-recovery-failed"),
    },
    objective_gate: { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 },
  });
  assert.equal(built.ok, true);
  for (const mode of ["original-mode", "graph-mode"]) {
    const recovered = eventStream(built.definition, [
      { kind: "node-start", node_id: "work", visit: 1 },
      { kind: "effect-plan", node_id: "work", slot_count: 1 },
      {
        kind: "effect-recovered", node_id: "work", instance_id: "work:1:attempt-1",
        effect_ref: `sha256:${"c".repeat(64)}`, status: "ok",
      },
    ], { mode, resume: true });
    const observed = observedWorkflowGraph(built.definition, recovered, { execution_mode: mode });
    assert.equal(observed.ok, true, JSON.stringify(observed));
    assert.equal(observed.nodes.find((node) => node.id === "work").effects, 1);
  }
});

test("observed graph rejects a nested child stream that manufactures non-terminal success", () => {
  const child = workflow({
    id: "visual-child-lifecycle", name: "Visual child lifecycle", description: "Child lifecycle fixture.",
    start: "work",
    nodes: {
      work: checkpoint("observe-child", "objective"),
      objective: objectiveGate("succeeded", "failed"),
      succeeded: terminal("succeeded"),
      failed: terminal("failed", "visual-child-lifecycle-failed"),
    },
    objective_gate: { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 },
  });
  const parent = workflow({
    id: "visual-parent-lifecycle", name: "Visual parent lifecycle", description: "Parent lifecycle fixture.",
    start: "child",
    nodes: {
      child: { kind: "subworkflow", workflow_id: "visual-child-lifecycle", version: 1, next: "objective" },
      objective: objectiveGate("succeeded", "failed"),
      succeeded: terminal("succeeded"),
      failed: terminal("failed", "visual-parent-lifecycle-failed"),
    },
    objective_gate: { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 },
  });
  assert.equal(child.ok, true);
  assert.equal(parent.ok, true);
  const childDefinition = child.definition;
  const wrap = (childEvent) => ({
    kind: "subworkflow-event", node_id: "child", child_run_id: "visual-run.child.1",
    child_workflow_id: childDefinition.id, child_workflow_version: childDefinition.version,
    ...Object.fromEntries(Object.entries(childEvent).map(([key, value]) => [`child_${key}`, value])),
  });
  const childEvents = [
    { seq: 1, kind: "run-start", node_id: "work", definition_ref: workflowDefinitionHash(childDefinition), execution_mode: "graph-mode" },
    { seq: 2, kind: "node-start", node_id: "work", visit: 1 },
    { seq: 3, kind: "node-end", node_id: "work", status: "ok" },
    { seq: 4, kind: "run-end", node_id: "work", status: "succeeded" },
  ];
  const events = eventStream(parent.definition, [
    { kind: "node-start", node_id: "child", visit: 1 },
    ...childEvents.map(wrap),
  ], { mode: "graph-mode" });
  assert.deepEqual(observedWorkflowGraph(parent.definition, events, {
    execution_mode: "graph-mode", subworkflows: [childDefinition],
  }), { ok: false, code: "workflow-events-invalid" });
});

test("observed graph recursively rejects an effectless successful child agent", () => {
  const child = workflow({
    id: "visual-child-effectless", name: "Visual child effectless", description: "Child effect evidence fixture.",
    start: "work",
    nodes: {
      work: { ...agent({ role: "reviewer", stage_id: "work", mutation: "read-only" }), next: "objective" },
      objective: objectiveGate("succeeded", "failed"),
      succeeded: terminal("succeeded"),
      failed: terminal("failed", "visual-child-effectless-failed"),
    },
    objective_gate: { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 },
  });
  const parent = workflow({
    id: "visual-parent-effectless", name: "Visual parent effectless", description: "Parent effect evidence fixture.",
    start: "child",
    nodes: {
      child: { kind: "subworkflow", workflow_id: child.definition.id, version: 1, next: "objective" },
      objective: objectiveGate("succeeded", "failed"),
      succeeded: terminal("succeeded"),
      failed: terminal("failed", "visual-parent-effectless-failed"),
    },
    objective_gate: { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 },
  });
  assert.equal(child.ok, true, JSON.stringify(child.errors));
  assert.equal(parent.ok, true, JSON.stringify(parent.errors));
  const childEvents = [
    { seq: 1, kind: "run-start", node_id: "work", definition_ref: workflowDefinitionHash(child.definition), execution_mode: "graph-mode" },
    { seq: 2, kind: "node-start", node_id: "work", visit: 1 },
    { seq: 3, kind: "node-end", node_id: "work", status: "ok" },
    { seq: 4, kind: "transition", node_id: "work", target: "objective", edge_id: "work:next", edge_kind: "next" },
    { seq: 5, kind: "node-start", node_id: "objective", visit: 1 },
    { seq: 6, kind: "gate", node_id: "objective", result: "pass", final: true },
    { seq: 7, kind: "node-end", node_id: "objective", status: "ok" },
    { seq: 8, kind: "transition", node_id: "objective", target: "succeeded", edge_id: "objective:pass", edge_kind: "pass" },
    { seq: 9, kind: "node-start", node_id: "succeeded", visit: 1 },
    { seq: 10, kind: "node-end", node_id: "succeeded", status: "succeeded" },
    { seq: 11, kind: "run-end", node_id: "succeeded", status: "succeeded" },
  ];
  const wrapped = childEvents.map((event) => ({
    kind: "subworkflow-event", node_id: "child", child_run_id: "visual-run.child.1",
    child_workflow_id: child.definition.id, child_workflow_version: 1,
    ...Object.fromEntries(Object.entries(event).map(([key, value]) => [`child_${key}`, value])),
  }));
  const events = eventStream(parent.definition, [
    { kind: "node-start", node_id: "child", visit: 1 },
    ...wrapped,
  ], { mode: "graph-mode" });
  assert.deepEqual(observedWorkflowGraph(parent.definition, events, {
    execution_mode: "graph-mode", subworkflows: [child.definition],
  }), { ok: false, code: "workflow-events-invalid" });
});

test("observed graph gates bind authored finality and their result to the traversed edge", () => {
  const built = workflow({
    id: "visual-gate", name: "Visual gate", description: "Gate event correlation fixture.",
    start: "objective",
    nodes: {
      objective: objectiveGate("succeeded", "failed", { loops_off: "failed" }),
      succeeded: terminal("succeeded"),
      failed: terminal("failed", "visual-gate-failed"),
    },
    objective_gate: { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 },
  });
  assert.equal(built.ok, true);
  const definition = built.definition;
  const events = eventStream(definition, [
    { kind: "node-start", node_id: "objective", visit: 1 },
    { kind: "gate", node_id: "objective", result: "pass", final: true },
    { kind: "node-end", node_id: "objective", status: "ok" },
    {
      kind: "transition", node_id: "objective", target: "succeeded",
      edge_id: "objective:pass", edge_kind: "pass",
    },
  ], { mode: "graph-mode" });
  assert.equal(observedWorkflowGraph(definition, events, { execution_mode: "graph-mode" }).ok, true);
  for (const mutate of [
    (candidate) => { candidate[2].final = false; },
    (candidate) => { candidate[2].result = "fail"; },
    (candidate) => { candidate[4].edge_kind = "fail"; candidate[4].edge_id = "objective:fail"; candidate[4].target = "failed"; },
  ]) {
    const corrupted = structuredClone(events);
    mutate(corrupted);
    assert.deepEqual(observedWorkflowGraph(definition, corrupted, { execution_mode: "graph-mode" }), {
      ok: false, code: "workflow-events-invalid",
    });
  }
});

test("observed graphs validate and project bounded nested child progress", () => {
  const childBuilt = workflow({
    id: "visual-child", name: "Visual child", description: "Nested graph visualization child.",
    start: "objective",
    nodes: {
      objective: objectiveGate("succeeded", "failed"),
      succeeded: terminal("succeeded"),
      failed: terminal("failed", "visual-child-failed"),
    },
    objective_gate: { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 },
  });
  assert.equal(childBuilt.ok, true);
  const parentBuilt = workflow({
    id: "visual-parent", name: "Visual parent", description: "Nested graph visualization parent.",
    start: "child",
    nodes: {
      child: { kind: "subworkflow", workflow_id: "visual-child", version: 1, next: "objective" },
      objective: objectiveGate("succeeded", "failed"),
      succeeded: terminal("succeeded"),
      failed: terminal("failed", "visual-parent-failed"),
    },
    objective_gate: { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 },
  });
  assert.equal(parentBuilt.ok, true);
  const childDefinition = childBuilt.definition;
  const parentDefinition = parentBuilt.definition;
  const childEdge = plannedWorkflowGraph(childDefinition).edges.find((edge) => edge.id === "objective:pass");
  const events = eventStream(parentDefinition, [
    { kind: "node-start", node_id: "child", visit: 1 },
    {
      kind: "subworkflow-event", node_id: "child", child_run_id: "visual-run.child.1",
      child_workflow_id: "visual-child", child_workflow_version: 1, child_seq: 1,
      child_kind: "run-start", child_node_id: "objective",
      child_definition_ref: workflowDefinitionHash(childDefinition), child_execution_mode: "graph-mode",
    },
    {
      kind: "subworkflow-event", node_id: "child", child_run_id: "visual-run.child.1",
      child_workflow_id: "visual-child", child_workflow_version: 1, child_seq: 2,
      child_kind: "node-start", child_node_id: "objective", child_visit: 1,
    },
    {
      kind: "subworkflow-event", node_id: "child", child_run_id: "visual-run.child.1",
      child_workflow_id: "visual-child", child_workflow_version: 1, child_seq: 3,
      child_kind: "gate", child_node_id: "objective", child_result: "pass", child_final: true,
    },
    {
      kind: "subworkflow-event", node_id: "child", child_run_id: "visual-run.child.1",
      child_workflow_id: "visual-child", child_workflow_version: 1, child_seq: 4,
      child_kind: "node-end", child_node_id: "objective", child_status: "ok",
    },
    {
      kind: "subworkflow-event", node_id: "child", child_run_id: "visual-run.child.1",
      child_workflow_id: "visual-child", child_workflow_version: 1, child_seq: 5,
      child_kind: "transition", child_node_id: "objective", child_target: "succeeded",
      child_edge_id: childEdge.id, child_edge_kind: childEdge.kind,
    },
  ], { mode: "graph-mode" });
  const observed = observedWorkflowGraph(parentDefinition, events, {
    execution_mode: "graph-mode", subworkflows: [childDefinition],
  });
  assert.equal(observed.ok, true);
  assert.equal(observed.current_node, "child");
  assert.equal(observed.last_node, "child");
  assert.equal(observed.child_graphs.length, 1);
  assert.equal(observed.child_graphs[0].current_node, "succeeded");
  assert.equal(observed.child_graphs[0].last_node, "objective");
  const corrupted = structuredClone(events);
  corrupted.at(-1).child_edge_id = "objective:fail";
  assert.deepEqual(observedWorkflowGraph(parentDefinition, corrupted, {
    execution_mode: "graph-mode", subworkflows: [childDefinition],
  }), { ok: false, code: "workflow-events-invalid" });
  const missingChildStart = events.filter((event) => !(event.kind === "subworkflow-event" && event.child_seq === 1));
  missingChildStart.forEach((event, index) => { event.seq = index + 1; });
  const firstChild = missingChildStart.find((event) => event.kind === "subworkflow-event");
  firstChild.child_seq = 1;
  assert.deepEqual(observedWorkflowGraph(parentDefinition, missingChildStart, {
    execution_mode: "graph-mode", subworkflows: [childDefinition],
  }), { ok: false, code: "workflow-events-invalid" });

  const unrelatedChild = structuredClone(events);
  for (const event of unrelatedChild) {
    if (event.kind === "subworkflow-event") event.child_run_id = "visual-run.unrelated.1";
  }
  assert.deepEqual(observedWorkflowGraph(parentDefinition, unrelatedChild, {
    execution_mode: "graph-mode", subworkflows: [childDefinition],
  }), { ok: false, code: "workflow-events-invalid" });

  const wrongFinal = structuredClone(events);
  wrongFinal.find((event) => event.child_kind === "gate").child_final = false;
  assert.deepEqual(observedWorkflowGraph(parentDefinition, wrongFinal, {
    execution_mode: "graph-mode", subworkflows: [childDefinition],
  }), { ok: false, code: "workflow-events-invalid" });

  for (const mode of ["original-mode", "graph-mode"]) {
    const noChild = eventStream(parentDefinition, [
      { kind: "node-start", node_id: "child", visit: 1 },
      { kind: "node-end", node_id: "child", status: "ok" },
      {
        kind: "transition", node_id: "child", target: "objective",
        ...(mode === "graph-mode" ? { edge_id: "child:next", edge_kind: "next" } : {}),
      },
    ], { mode });
    assert.deepEqual(observedWorkflowGraph(parentDefinition, noChild, {
      execution_mode: mode, subworkflows: [childDefinition],
    }), { ok: false, code: "workflow-events-invalid" });
  }
});

test("historical schema-4 child wrappers remain an opaque original-mode watch projection", () => {
  const built = workflow({
    id: "legacy-parent", name: "Legacy parent", description: "Historical child wrapper fixture.",
    start: "child",
    nodes: {
      child: { kind: "subworkflow", workflow_id: "legacy-child", version: 1, next: "objective" },
      objective: objectiveGate("succeeded", "failed"),
      succeeded: terminal("succeeded"),
      failed: terminal("failed", "legacy-parent-failed"),
    },
    objective_gate: { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 },
  });
  assert.equal(built.ok, true);
  const definition = built.definition;
  const events = eventStream(definition, [
    { kind: "node-start", node_id: "child", visit: 1 },
    {
      kind: "subworkflow-event", node_id: "child", child_run_id: "visual-run.child.1",
      child_seq: 1, child_kind: "run-start", child_node_id: "work",
    },
    {
      kind: "subworkflow-event", node_id: "child", child_run_id: "visual-run.child.1",
      child_seq: 2, child_kind: "node-end", child_node_id: "work", child_status: "ok",
    },
    { kind: "node-end", node_id: "child", status: "ok" },
    { kind: "transition", node_id: "child", target: "objective" },
  ]);
  assert.deepEqual(observedWorkflowGraph(definition, events), { ok: false, code: "workflow-events-invalid" });
  const observed = observedWorkflowGraph(definition, events, {
    execution_mode: "original-mode", legacy_child_events: true,
  });
  assert.equal(observed.ok, true);
  assert.equal(observed.current_node, "objective");
  assert.deepEqual(observed.child_graphs, []);

  const unrelated = structuredClone(events);
  unrelated[2].child_run_id = "visual-run.other.1";
  unrelated[3].child_run_id = "visual-run.other.1";
  assert.deepEqual(observedWorkflowGraph(definition, unrelated, {
    execution_mode: "original-mode", legacy_child_events: true,
  }), { ok: false, code: "workflow-events-invalid" });
  assert.deepEqual(observedWorkflowGraph(definition, events, {
    execution_mode: "graph-mode", legacy_child_events: true,
  }), { ok: false, code: "workflow-events-invalid" });
});
