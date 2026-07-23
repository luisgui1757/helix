import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_WORKFLOW_EXECUTION_MODE,
  WORKFLOW_EXECUTION_MODES,
  WORKFLOW_GRAPH_CODES,
  WORKFLOW_GRAPH_EDGE_KINDS,
  WORKFLOW_GRAPH_EDGE_VIEWS,
  compileWorkflowGraph,
  extractWorkflowNodeEdges,
  projectPublicWorkflowGraph,
  reachableWorkflowNodes,
  reverseReachableWorkflowNodes,
  routeWorkflowDecision,
  routeWorkflowGate,
  routeWorkflowNext,
  stronglyConnectedWorkflowComponents,
  validateWorkflowExecutionMode,
  workflowGraphEdges,
  workflowGraphHasPath,
} from "../dispatch/workflow/graph.mjs";

function allKindsDefinition() {
  return {
    start: "agent",
    nodes: {
      agent: { kind: "agent", next: "pipeline" },
      pipeline: { kind: "pipeline", next: "parallel" },
      parallel: { kind: "parallel", next: "map" },
      map: { kind: "map", next: "reduce" },
      reduce: { kind: "reduce", next: "checkpoint" },
      checkpoint: { kind: "checkpoint", next: "subworkflow" },
      subworkflow: { kind: "subworkflow", next: "decision" },
      decision: {
        kind: "decision",
        transitions: [
          { when: { op: "eq", path: "/outputs/private", value: "secret-a" }, target: "local-gate" },
          { when: { op: "neq", path: "/outputs/private", value: "secret-b" }, target: "local-gate", loop: true },
        ],
        default: { target: "objective" },
        loops_off: "objective",
      },
      "local-gate": { kind: "gate", on_pass: "objective", on_fail: "failed", loops_off: "objective" },
      objective: { kind: "gate", final: true, on_pass: "success", on_fail: "failed", loops_off: "failed" },
      success: { kind: "terminal", status: "succeeded" },
      failed: { kind: "terminal", status: "failed" },
    },
  };
}

function compiledAllKinds() {
  const result = compileWorkflowGraph(allKindsDefinition());
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}

function cyclicDefinition() {
  return {
    start: "route",
    nodes: {
      route: {
        kind: "decision",
        transitions: [{ when: { op: "always" }, target: "a", loop: true }],
        default: { target: "self" },
        loops_off: "objective",
      },
      a: { kind: "checkpoint", next: "b" },
      b: { kind: "checkpoint", next: "route" },
      self: { kind: "checkpoint", next: "self" },
      objective: { kind: "gate", final: true, on_pass: "success", on_fail: "failed", loops_off: "failed" },
      success: { kind: "terminal", status: "succeeded" },
      failed: { kind: "terminal", status: "failed" },
    },
  };
}

test("execution modes are a closed enum and omission selects original-mode", () => {
  assert.deepEqual(WORKFLOW_EXECUTION_MODES, ["original-mode", "graph-mode"]);
  assert.equal(DEFAULT_WORKFLOW_EXECUTION_MODE, "original-mode");
  assert.deepEqual(validateWorkflowExecutionMode(), { ok: true, mode: "original-mode" });
  assert.deepEqual(validateWorkflowExecutionMode("original-mode"), { ok: true, mode: "original-mode" });
  assert.deepEqual(validateWorkflowExecutionMode("graph-mode"), { ok: true, mode: "graph-mode" });
  for (const malformed of [null, "graph", "", 0, false, {}, []]) {
    assert.deepEqual(validateWorkflowExecutionMode(malformed), {
      ok: false, status: "refused", code: WORKFLOW_GRAPH_CODES.execution_mode_invalid,
    });
  }
  assert.equal(Object.isFrozen(WORKFLOW_EXECUTION_MODES), true);
});

test("typed extraction covers every node kind with stable ids, fields, kinds, and ordinals", () => {
  assert.deepEqual(WORKFLOW_GRAPH_EDGE_KINDS, ["next", "condition", "default", "loops-off", "pass", "fail"]);
  for (const kind of ["agent", "pipeline", "parallel", "map", "reduce", "checkpoint", "subworkflow"]) {
    const extracted = extractWorkflowNodeEdges("work", { kind, next: "done" });
    assert.equal(extracted.ok, true, kind);
    assert.deepEqual(extracted.edges.map(({ id, from, to, kind: edgeKind, ordinal, field }) => ({
      id, from, to, kind: edgeKind, ordinal, field,
    })), [{ id: "work:next", from: "work", to: "done", kind: "next", ordinal: 0, field: "next" }]);
  }
  const decision = extractWorkflowNodeEdges("route", allKindsDefinition().nodes.decision);
  assert.equal(decision.ok, true);
  assert.deepEqual(decision.edges.map(({ id, to, kind, ordinal, field, loop }) => ({ id, to, kind, ordinal, field, loop })), [
    { id: "route:condition:0", to: "local-gate", kind: "condition", ordinal: 0, field: "transitions[0].target", loop: false },
    { id: "route:condition:1", to: "local-gate", kind: "condition", ordinal: 1, field: "transitions[1].target", loop: true },
    { id: "route:default", to: "objective", kind: "default", ordinal: 2, field: "default.target", loop: false },
    { id: "route:loops-off", to: "objective", kind: "loops-off", ordinal: 3, field: "loops_off", loop: undefined },
  ]);
  const gate = extractWorkflowNodeEdges("gate", { kind: "gate", on_pass: "yes", on_fail: "no", loops_off: "stop" });
  assert.deepEqual(gate.edges.map(({ id, kind, ordinal, field }) => ({ id, kind, ordinal, field })), [
    { id: "gate:pass", kind: "pass", ordinal: 0, field: "on_pass" },
    { id: "gate:fail", kind: "fail", ordinal: 1, field: "on_fail" },
    { id: "gate:loops-off", kind: "loops-off", ordinal: 2, field: "loops_off" },
  ]);
  assert.deepEqual(extractWorkflowNodeEdges("done", { kind: "terminal" }), { ok: true, edges: [] });
});

test("compilation canonicalizes node order, preserves decision order, and distinguishes duplicate endpoints", () => {
  const graph = compiledAllKinds();
  assert.deepEqual(graph.nodes.map(({ id, ordinal }) => [id, ordinal]), Object.keys(allKindsDefinition().nodes).sort()
    .map((id, ordinal) => [id, ordinal]));
  assert.equal(graph.final_gate_id, "objective");
  assert.equal(graph.success_terminal_id, "success");
  assert.equal(graph.adjacency.decision.length, 4);
  assert.deepEqual(graph.adjacency.decision.map((candidate) => candidate.id), [
    "decision:condition:0", "decision:condition:1", "decision:default", "decision:loops-off",
  ]);
  assert.equal(graph.adjacency.decision[0].to, graph.adjacency.decision[1].to);
  assert.notEqual(graph.adjacency.decision[0].id, graph.adjacency.decision[1].id);
  assert.notEqual(graph.adjacency.decision[0].condition_ref, graph.adjacency.decision[1].condition_ref);
  assert.deepEqual(graph.reverse_adjacency["local-gate"].map((candidate) => candidate.id), [
    "decision:condition:0", "decision:condition:1",
  ]);
  const reordered = allKindsDefinition();
  reordered.nodes = Object.fromEntries(Object.entries(reordered.nodes).reverse());
  assert.deepEqual(projectPublicWorkflowGraph(compileWorkflowGraph(reordered)), projectPublicWorkflowGraph(graph));
  assert.equal(Object.isFrozen(graph), true);
  assert.equal(Object.isFrozen(graph.adjacency.decision), true);

  const localeSensitive = allKindsDefinition();
  localeSensitive.start = "aa";
  localeSensitive.nodes = {
    aa: { kind: "checkpoint", next: "b" },
    b: { kind: "checkpoint", next: "objective" },
    objective: { kind: "gate", final: true, on_pass: "success", on_fail: "failed" },
    success: { kind: "terminal", status: "succeeded" },
    failed: { kind: "terminal", status: "failed" },
  };
  assert.deepEqual(compileWorkflowGraph(localeSensitive).nodes.map((node) => node.id),
    ["aa", "b", "failed", "objective", "success"]);
});

test("authored, runtime, and loops-disabled views preserve exact escape semantics", () => {
  const graph = compileWorkflowGraph(cyclicDefinition());
  assert.equal(graph.ok, true);
  assert.deepEqual(WORKFLOW_GRAPH_EDGE_VIEWS, ["authored", "runtime", "loops-disabled"]);
  const authored = workflowGraphEdges(graph).edges;
  const runtime = workflowGraphEdges(graph, { view: "runtime" }).edges;
  const disabled = workflowGraphEdges(graph, { view: "loops-disabled" }).edges;
  assert.equal(authored.some((candidate) => candidate.id === "route:loops-off"), true);
  assert.equal(runtime.some((candidate) => candidate.kind === "loops-off"), false);
  assert.equal(runtime.some((candidate) => candidate.id === "route:condition:0"), true);
  assert.equal(disabled.some((candidate) => candidate.id === "route:condition:0"), false);
  assert.equal(disabled.some((candidate) => candidate.id === "route:default"), true);
  assert.equal(disabled.some((candidate) => candidate.id === "route:loops-off"), true);
  assert.equal(disabled.some((candidate) => candidate.id === "objective:fail"), false);
  assert.equal(disabled.some((candidate) => candidate.id === "objective:loops-off"), true);
  assert.deepEqual(workflowGraphEdges(graph, { view: "unknown" }), {
    ok: false, status: "refused", code: WORKFLOW_GRAPH_CODES.edge_view_invalid,
  });
});

test("reachability, reverse reachability, paths, and SCCs are deterministic across edge views", () => {
  const graph = compileWorkflowGraph(cyclicDefinition());
  assert.equal(graph.ok, true);
  assert.deepEqual(reachableWorkflowNodes(graph, "route", { view: "runtime" }).node_ids,
    ["a", "b", "route", "self"]);
  assert.deepEqual(reachableWorkflowNodes(graph, "route", { view: "loops-disabled" }).node_ids,
    ["failed", "objective", "route", "self", "success"]);
  assert.deepEqual(reverseReachableWorkflowNodes(graph, "route", { view: "runtime" }).node_ids,
    ["a", "b", "route"]);
  assert.deepEqual(workflowGraphHasPath(graph, "route", "a", { view: "runtime" }), { ok: true, exists: true });
  assert.deepEqual(workflowGraphHasPath(graph, "route", "a", { view: "loops-disabled" }), { ok: true, exists: false });
  assert.deepEqual(workflowGraphHasPath(graph, "route", "objective", { view: "loops-disabled" }), { ok: true, exists: true });
  assert.deepEqual(stronglyConnectedWorkflowComponents(graph, { view: "runtime" }).components, [
    ["a", "b", "route"], ["failed"], ["objective"], ["self"], ["success"],
  ]);
  assert.deepEqual(stronglyConnectedWorkflowComponents(graph, { view: "loops-disabled" }).components, [
    ["a"], ["b"], ["failed"], ["objective"], ["route"], ["self"], ["success"],
  ]);
});

test("next and decision routing preserve first-match, default, and loops-off behavior", () => {
  const graph = compiledAllKinds();
  assert.deepEqual(routeWorkflowNext(graph, "agent"), {
    ok: true, target: "pipeline", edge: graph.adjacency.agent[0],
  });
  const firstCalls = [];
  const first = routeWorkflowDecision(graph, "decision", {
    evaluate(condition) { firstCalls.push(condition.op); return true; },
  });
  assert.equal(first.target, "local-gate");
  assert.equal(first.edge.id, "decision:condition:0");
  assert.deepEqual(firstCalls, ["eq"]);
  const secondCalls = [];
  const second = routeWorkflowDecision(graph, "decision", {
    evaluate(condition) { secondCalls.push(condition.op); return condition.op === "neq"; },
  });
  assert.equal(second.edge.id, "decision:condition:1");
  assert.deepEqual(secondCalls, ["eq", "neq"]);
  const escaped = routeWorkflowDecision(graph, "decision", {
    loops: false,
    evaluate(condition) { return condition.op === "neq"; },
  });
  assert.equal(escaped.target, "objective");
  assert.equal(escaped.edge.id, "decision:loops-off");
  const nonLoop = routeWorkflowDecision(graph, "decision", { loops: false, evaluate: () => true });
  assert.equal(nonLoop.edge.id, "decision:condition:0");
  const fallback = routeWorkflowDecision(graph, "decision", { evaluate: () => false });
  assert.equal(fallback.edge.id, "decision:default");
});

test("cyclic defaults route through loops-off only when loops are disabled", () => {
  const definition = {
    start: "route",
    nodes: {
      route: { kind: "decision", transitions: [], default: { target: "route", loop: true }, loops_off: "objective" },
      objective: { kind: "gate", final: true, on_pass: "success", on_fail: "failed" },
      success: { kind: "terminal", status: "succeeded" },
      failed: { kind: "terminal", status: "failed" },
    },
  };
  const graph = compileWorkflowGraph(definition);
  assert.equal(routeWorkflowDecision(graph, "route", { evaluate: () => false }).edge.id, "route:default");
  assert.equal(routeWorkflowDecision(graph, "route", { evaluate: () => false, loops: false }).edge.id, "route:loops-off");
  delete definition.nodes.route.loops_off;
  const noEscape = compileWorkflowGraph(definition);
  assert.equal(noEscape.ok, true);
  assert.deepEqual(routeWorkflowDecision(noEscape, "route", { evaluate: () => false, loops: false }), {
    ok: false, status: "refused", code: WORKFLOW_GRAPH_CODES.route_invalid,
  });
});

test("gate routing replaces only a failed edge with loops-off", () => {
  const graph = compiledAllKinds();
  assert.equal(routeWorkflowGate(graph, "local-gate", { result: "pass", loops: false }).edge.id, "local-gate:pass");
  assert.equal(routeWorkflowGate(graph, "local-gate", { result: "fail" }).edge.id, "local-gate:fail");
  assert.equal(routeWorkflowGate(graph, "local-gate", { result: "fail", loops: false }).edge.id, "local-gate:loops-off");
  assert.equal(routeWorkflowGate(graph, "objective", { result: "fail" }).edge.id, "objective:fail");
  assert.equal(routeWorkflowGate(graph, "objective", { result: "fail", loops: false }).edge.id, "objective:loops-off");
  const withoutEscape = structuredClone(allKindsDefinition());
  delete withoutEscape.nodes["local-gate"].loops_off;
  const compiled = compileWorkflowGraph(withoutEscape);
  assert.equal(routeWorkflowGate(compiled, "local-gate", { result: "fail", loops: false }).edge.id, "local-gate:fail");
});

test("routing failures are stable for wrong kinds, malformed outcomes, and unsafe evaluators", () => {
  const graph = compiledAllKinds();
  const failure = { ok: false, status: "refused", code: WORKFLOW_GRAPH_CODES.route_invalid };
  assert.deepEqual(routeWorkflowNext(graph, "decision"), failure);
  assert.deepEqual(routeWorkflowDecision(graph, "agent", { evaluate: () => true }), failure);
  assert.deepEqual(routeWorkflowDecision(graph, "decision"), failure);
  assert.deepEqual(routeWorkflowDecision(graph, "decision", { evaluate: () => "yes" }), failure);
  assert.deepEqual(routeWorkflowDecision(graph, "decision", { evaluate() { throw new Error("unsafe"); } }), failure);
  assert.deepEqual(routeWorkflowGate(graph, "local-gate", { result: true }), failure);
  assert.deepEqual(routeWorkflowGate(graph, "decision", { result: "pass" }), failure);
  assert.deepEqual(routeWorkflowGate(graph, "local-gate", { result: "pass", loops: "off" }), failure);
});

test("the public graph is structural and conditions have canonical private-value-free references", () => {
  const firstDefinition = allKindsDefinition();
  const firstGraph = compileWorkflowGraph(firstDefinition);
  const projected = projectPublicWorkflowGraph(firstGraph);
  assert.equal(projected.ok, true);
  assert.deepEqual(projected.edges.map(({ id, field }) => ({ id, field })),
    firstGraph.edges.map(({ id, field }) => ({ id, field })));
  assert.equal(projected.edges.every((candidate) => typeof candidate.id === "string"
    && typeof candidate.field === "string"), true);
  const text = JSON.stringify(projected);
  assert.equal(text.includes("secret-a"), false);
  assert.equal(text.includes("secret-b"), false);
  assert.equal(text.includes("prompt"), false);
  const condition = projected.edges.find((candidate) => candidate.id === "decision:condition:0");
  assert.deepEqual({ id: condition.id, field: condition.field, operator: condition.condition.operator, path: condition.condition.path }, {
    id: "decision:condition:0", field: "transitions[0].target", operator: "eq", path: "/outputs/private",
  });
  assert.match(condition.condition.ref, /^sha256:[0-9a-f]{64}$/);

  const reordered = allKindsDefinition();
  reordered.nodes.decision.transitions[0].when = { value: "secret-a", path: "/outputs/private", op: "eq" };
  const reorderedRef = projectPublicWorkflowGraph(compileWorkflowGraph(reordered)).edges
    .find((candidate) => candidate.id === "decision:condition:0").condition.ref;
  assert.equal(reorderedRef, condition.condition.ref);
  reordered.nodes.decision.transitions[0].when.value = "different-secret";
  const changedRef = projectPublicWorkflowGraph(compileWorkflowGraph(reordered)).edges
    .find((candidate) => candidate.id === "decision:condition:0").condition.ref;
  assert.notEqual(changedRef, condition.condition.ref);
});

test("compilation accepts the exact node boundary and refuses one over", () => {
  const nodes = {};
  for (let index = 0; index < 253; index += 1) {
    nodes[`n-${index}`] = { kind: "checkpoint", next: index === 252 ? "objective" : `n-${index + 1}` };
  }
  nodes.objective = { kind: "gate", final: true, on_pass: "success", on_fail: "failed" };
  nodes.success = { kind: "terminal", status: "succeeded" };
  nodes.failed = { kind: "terminal", status: "failed" };
  const exact = compileWorkflowGraph({ start: "n-0", nodes });
  assert.equal(exact.ok, true, JSON.stringify(exact));
  assert.equal(exact.nodes.length, 256);
  nodes.extra = { kind: "terminal", status: "failed" };
  assert.deepEqual(compileWorkflowGraph({ start: "n-0", nodes }), {
    ok: false, status: "refused", code: WORKFLOW_GRAPH_CODES.graph_invalid,
  });
});

test("graph helpers are total and fail closed on malformed nodes, targets, conditions, and graphs", () => {
  const invalid = { ok: false, status: "refused", code: WORKFLOW_GRAPH_CODES.graph_invalid };
  const malformedDefinitions = [
    null,
    {},
    { start: "missing", nodes: {} },
    { start: "bad_id", nodes: { bad_id: { kind: "terminal", status: "succeeded" } } },
    { start: "work", nodes: { work: { kind: "unknown", next: "work" } } },
    { start: "work", nodes: { work: { kind: "checkpoint", next: "missing" }, objective: { kind: "gate", final: true, on_pass: "success", on_fail: "failed" }, success: { kind: "terminal", status: "succeeded" }, failed: { kind: "terminal" } } },
    { start: "route", nodes: { route: { kind: "decision", transitions: null, default: { target: "objective" } }, objective: { kind: "gate", final: true, on_pass: "success", on_fail: "failed" }, success: { kind: "terminal", status: "succeeded" }, failed: { kind: "terminal" } } },
    { start: "route", nodes: { route: { kind: "decision", transitions: [{ when: { op: "always", extra: () => {} }, target: "objective" }], default: { target: "objective" } }, objective: { kind: "gate", final: true, on_pass: "success", on_fail: "failed" }, success: { kind: "terminal", status: "succeeded" }, failed: { kind: "terminal" } } },
    { start: "objective", nodes: { objective: { kind: "gate", on_pass: "success", on_fail: "failed" }, success: { kind: "terminal", status: "succeeded" }, failed: { kind: "terminal" } } },
    { start: "objective", nodes: { objective: { kind: "gate", final: true, on_pass: "failed", on_fail: "failed" }, failed: { kind: "terminal" } } },
  ];
  const cyclicCondition = { op: "not" };
  cyclicCondition.condition = cyclicCondition;
  malformedDefinitions.push({
    start: "route",
    nodes: {
      route: { kind: "decision", transitions: [{ when: cyclicCondition, target: "objective" }], default: { target: "objective" } },
      objective: { kind: "gate", final: true, on_pass: "success", on_fail: "failed" },
      success: { kind: "terminal", status: "succeeded" }, failed: { kind: "terminal" },
    },
  });
  for (const candidate of malformedDefinitions) {
    assert.doesNotThrow(() => compileWorkflowGraph(candidate));
    assert.deepEqual(compileWorkflowGraph(candidate), invalid);
  }
  assert.deepEqual(extractWorkflowNodeEdges("route", {
    kind: "decision", transitions: [{ when: cyclicCondition, target: "route", loop: true }], default: { target: "route" },
  }), invalid);
  for (const candidate of [null, {}, { ok: true, nodes: [], edges: [] }]) {
    assert.deepEqual(workflowGraphEdges(candidate), invalid);
    assert.deepEqual(reachableWorkflowNodes(candidate), invalid);
    assert.deepEqual(reverseReachableWorkflowNodes(candidate, "node"), invalid);
    assert.deepEqual(workflowGraphHasPath(candidate, "a", "b"), invalid);
    assert.deepEqual(stronglyConnectedWorkflowComponents(candidate), invalid);
    assert.deepEqual(projectPublicWorkflowGraph(candidate), invalid);
    assert.deepEqual(routeWorkflowNext(candidate, "node"), {
      ok: false, status: "refused", code: WORKFLOW_GRAPH_CODES.route_invalid,
    });
  }
});
