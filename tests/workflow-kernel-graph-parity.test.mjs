import test from "node:test";
import assert from "node:assert/strict";

import {
  agent,
  checkpoint,
  decision,
  map,
  objectiveGate,
  parallel,
  pipeline,
  reduce,
  subworkflow,
  terminal,
  workflow,
} from "../dispatch/workflow/builder.mjs";
import { journalRef } from "../dispatch/kernel/journal.mjs";
import { runWorkflowKernel } from "../dispatch/kernel/scheduler.mjs";

const objective = { type: "file-contains", path: "proposal.txt", contains: "PASS" };

function reviewer(stageId, next = null) {
  return agent({
    role: "reviewer",
    stage_id: stageId,
    output_schema: "verdict-v1",
    mutation: "read-only",
    timeout_ms: 1_000,
    ...(next ? { next } : {}),
  });
}

function definition(id, nodes, start, { inputs = null, limits = {} } = {}) {
  const built = workflow({
    id,
    name: `Parity ${id}`,
    description: `Exercise ${id} through both workflow execution modes.`,
    start,
    nodes,
    ...(inputs ? { inputs } : {}),
    limits: {
      max_total_effects: 64,
      max_concurrency: 4,
      max_map_items: 8,
      max_run_ms: 10_000,
      max_call_ms: 1_000,
      ...limits,
    },
    objective_gate: objective,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  return built.definition;
}

function deterministicClock() {
  let value = 0;
  return () => value++;
}

function normalizedResult(result) {
  const value = structuredClone(result);
  delete value.elapsed_ms;
  const refs = new Map();
  const normalizedRef = (ref) => {
    if (!refs.has(ref)) refs.set(ref, `<effect-ref-${refs.size + 1}>`);
    return refs.get(ref);
  };
  for (const record of value.journal ?? []) {
    record.runtime_ref = "<mode-runtime-ref>";
    record.base_identity = normalizedRef(record.base_identity);
    record.identity = normalizedRef(record.identity);
  }
  for (const event of value.events ?? []) {
    delete event.execution_mode;
    delete event.edge_id;
    delete event.edge_kind;
    delete event.child_execution_mode;
    delete event.child_edge_id;
    delete event.child_edge_kind;
    if (event.effect_ref) event.effect_ref = normalizedRef(event.effect_ref);
    if (event.child_effect_ref) event.child_effect_ref = normalizedRef(event.child_effect_ref);
  }
  return value;
}

async function runPair(definitionValue, input, makeOverrides = () => ({}), base = {}) {
  const runs = [];
  for (const executionMode of ["original-mode", "graph-mode"]) {
    const calls = [];
    const gates = [];
    const checkpoints = [];
    const childDefinitions = base.children ?? new Map();
    const overrides = makeOverrides({ executionMode, calls, gates, checkpoints });
    const result = await runWorkflowKernel(definitionValue, input, {
      run_id: "parity-run",
      runtime_ref: journalRef("parity-runtime"),
      task_ref: journalRef("parity-task"),
      execution_mode: executionMode,
      now: deterministicClock(),
      async executeAgent(node, ctx) {
        calls.push({
          definition_id: ctx.definition_id,
          node_id: ctx.node_id,
          instance_id: ctx.instance_id,
          visit: ctx.visit,
          role: node.role,
          item: ctx.local.item ?? null,
          upstream: ctx.local.upstream ?? null,
        });
        return {
          ok: true,
          value: {
            recommendation: "approve",
            role: node.role,
            item: ctx.local.item ?? null,
          },
          usage: { tokens: 1, cost_micros: 0 },
        };
      },
      async runGate(_gate, ctx) {
        gates.push({ definition_id: ctx.definition_id, node_id: ctx.node_id, final: ctx.final });
        return { result: "pass", evidence_ref: journalRef({ gate: ctx.node_id }) };
      },
      async checkpoint(ctx) {
        checkpoints.push({ node_id: ctx.node_id, visit: ctx.visit, child_run_id: ctx.child_run_id ?? null });
        return { continue: true };
      },
      resolveSubworkflow: (id, version) => childDefinitions.get(`${id}@${version}`) ?? null,
      ...base.deps,
      ...overrides,
    });
    runs.push({ executionMode, result, calls, gates, checkpoints });
  }
  assert.deepEqual(normalizedResult(runs[1].result), normalizedResult(runs[0].result));
  assert.deepEqual(runs[1].calls, runs[0].calls);
  assert.deepEqual(runs[1].gates, runs[0].gates);
  assert.deepEqual(runs[1].checkpoints, runs[0].checkpoints);
  return runs;
}

test("graph-mode matches original-mode across every workflow node kind", async () => {
  const child = definition("parity-child", {
    child: reviewer("child", "objective"),
    objective: objectiveGate("succeeded", "failed"),
    succeeded: terminal("succeeded"),
    failed: terminal("failed", "child-objective-failed"),
  }, "child");
  const inputSchema = {
    type: "object",
    additionalProperties: false,
    required: ["task", "items"],
    properties: {
      task: { type: "string", minLength: 1, maxLength: 128 },
      items: {
        type: "array",
        minItems: 0,
        maxItems: 4,
        items: { type: "string", minLength: 1, maxLength: 16 },
      },
    },
  };
  child.inputs = structuredClone(inputSchema);
  const graph = definition("all-node-kinds", {
    single: reviewer("single", "pipe"),
    pipe: pipeline([reviewer("pipe")], "panel", { max_visits: 1 }),
    panel: parallel([reviewer("panel-a"), reviewer("panel-b")], "mapped", { max_concurrency: 2 }),
    mapped: map("/inputs/items", reviewer("mapped"), "reduced", { max_items: 4 }),
    reduced: reduce("/outputs/mapped", "count", "route"),
    route: decision([
      { when: { op: "eq", path: "/outputs/reduced", value: 2 }, target: "evidence" },
    ], "failed"),
    evidence: {
      kind: "gate",
      gate: objective,
      on_pass: "pause",
      on_fail: "failed",
    },
    pause: checkpoint("parity-checkpoint", "child"),
    child: subworkflow("parity-child", 1, "objective"),
    objective: objectiveGate("succeeded", "failed"),
    succeeded: terminal("succeeded"),
    failed: terminal("failed", "parity-failed"),
  }, "single", { inputs: inputSchema });
  const runs = await runPair(graph, { task: "exercise the graph", items: ["a", "b"] }, () => ({}), {
    children: new Map([["parity-child@1", child]]),
  });
  assert.equal(runs[0].result.ok, true);
  assert.equal(runs[0].result.outputs.reduced, 2);
  assert.deepEqual(runs[0].result.visits, {
    single: 1, pipe: 1, panel: 1, mapped: 1, reduced: 1, route: 1,
    evidence: 1, pause: 1, child: 1, objective: 1, succeeded: 1, failed: 0,
  });
});

test("graph-mode preserves ordered decisions, cyclic routing, gate loops-off, and failure terminals", async () => {
  const graph = definition("loop-parity", {
    work: pipeline([reviewer("work")], "route", { max_visits: 3 }),
    route: decision([
      { when: { op: "eq", path: "/outputs/work/by_role/reviewer/recommendation", value: "revise" }, target: "work", loop: true },
      { when: { op: "eq", path: "/outputs/work/by_role/reviewer/recommendation", value: "approve" }, target: "evidence", loop: true },
      { when: { op: "always" }, target: "evidence", loop: true },
    ], "failed", { loops_off: "evidence" }),
    evidence: {
      kind: "gate",
      gate: objective,
      on_pass: "objective",
      on_fail: "work",
      loops_off: "objective",
    },
    objective: objectiveGate("succeeded", "work", { loops_off: "failed" }),
    succeeded: terminal("succeeded"),
    failed: terminal("failed", "loop-parity-failed"),
  }, "work");
  for (const loops of [true, false]) {
    const runs = await runPair(graph, { task: "exercise loops" }, ({ calls, gates }) => ({
      loops,
      async executeAgent(node, ctx) {
        calls.push({ definition_id: ctx.definition_id, node_id: ctx.node_id, instance_id: ctx.instance_id, visit: ctx.visit, role: node.role });
        return {
          ok: true,
          value: { recommendation: loops && ctx.visit === 1 ? "revise" : "approve" },
          usage: { tokens: 1, cost_micros: 0 },
        };
      },
      async runGate(_gate, ctx) {
        gates.push({ definition_id: ctx.definition_id, node_id: ctx.node_id, final: ctx.final });
        const localGateVisits = gates.filter((entry) => entry.node_id === "evidence").length;
        return {
          result: loops && ctx.node_id === "evidence" && localGateVisits === 1 ? "fail" : "pass",
          evidence_ref: journalRef({ gate: ctx.node_id, visit: localGateVisits }),
        };
      },
    }));
    assert.equal(runs[0].result.ok, true);
    assert.equal(runs[0].result.visits.work, loops ? 3 : 1);
  }
});

test("graph-mode exposes stable selected-edge metadata without changing original events", async () => {
  const graph = definition("edge-events", {
    route: decision([
      { when: { op: "always" }, target: "objective" },
      { when: { op: "always" }, target: "objective" },
    ], "failed"),
    objective: objectiveGate("succeeded", "failed"),
    succeeded: terminal("succeeded"),
    failed: terminal("failed", "edge-event-failed"),
  }, "route");
  const runs = await runPair(graph, { task: "edge metadata" });
  const originalTransition = runs[0].result.events.find((event) => event.kind === "transition");
  const graphTransition = runs[1].result.events.find((event) => event.kind === "transition");
  assert.equal(Object.hasOwn(originalTransition, "edge_id"), false);
  assert.equal(graphTransition.edge_id, "route:condition:0");
  assert.equal(graphTransition.edge_kind, "condition");
});

test("invalid execution modes refuse before workflow effects", async () => {
  const graph = definition("invalid-mode", {
    objective: objectiveGate("succeeded", "failed"),
    succeeded: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  }, "objective");
  let effects = 0;
  const result = await runWorkflowKernel(graph, { task: "must not run" }, {
    execution_mode: "Graph",
    async executeAgent() { effects += 1; return { ok: true }; },
    async runGate() { effects += 1; return { result: "pass" }; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "kernel-execution-mode-invalid");
  assert.equal(effects, 0);
});

test("effect and expansion callbacks cannot mutate either mode's admitted routing", async () => {
  const graph = definition("immutable-routing", {
    work: reviewer("work", "objective"),
    objective: objectiveGate("succeeded", "failed"),
    succeeded: terminal("succeeded"),
    failed: terminal("failed", "mutated-route"),
  }, "work");
  const runs = await runPair(graph, { task: "keep routing immutable" }, () => ({
    expandAgent(node) {
      node.next = "failed";
      return [node];
    },
    async executeAgent(node) {
      node.next = "failed";
      return {
        ok: true,
        value: { recommendation: "approve" },
        usage: { tokens: 1, cost_micros: 0 },
      };
    },
  }));
  for (const { result } of runs) {
    assert.equal(result.status, "succeeded");
    assert.deepEqual(result.events.filter((event) => event.kind === "transition")
      .map((event) => [event.node_id, event.target]), [
      ["work", "objective"], ["objective", "succeeded"],
    ]);
  }
});

test("checkpoint identity refuses both execution-mode switches and recursively binds child mode", async () => {
  const root = definition("mode-resume", {
    approval: checkpoint("operator-approval", "objective"),
    objective: objectiveGate("succeeded", "failed"),
    succeeded: terminal("succeeded"),
    failed: terminal("failed", "mode-resume-failed"),
  }, "approval");
  const runtimeRef = journalRef("mode-resume-runtime");
  const taskRef = journalRef("mode-resume-task");
  const workspaceRef = journalRef("mode-resume-workspace");
  const workspace = { currentRef: () => workspaceRef, verifyRef: (ref) => ref === workspaceRef };
  const pause = async (executionMode) => {
    let saved = null;
    const result = await runWorkflowKernel(root, { task: "bind the execution mode" }, {
      run_id: "mode-resume-run",
      execution_mode: executionMode,
      runtime_ref: runtimeRef,
      task_ref: taskRef,
      workspace,
      executeAgent: async () => ({ ok: true, value: {}, usage: { tokens: 0, cost_micros: 0 } }),
      runGate: async () => ({ result: "pass", evidence_ref: journalRef("mode-resume-gate") }),
      checkpoint: async () => ({ continue: false }),
      onCheckpoint: async (checkpointState) => {
        saved = structuredClone(checkpointState);
        return { ok: true };
      },
    });
    assert.equal(result.status, "paused");
    return saved;
  };
  for (const [from, to] of [["original-mode", "graph-mode"], ["graph-mode", "original-mode"]]) {
    const saved = await pause(from);
    assert.equal(saved.schema_version, from === "original-mode" ? 4 : 5);
    assert.equal(saved.execution_mode, from === "graph-mode" ? "graph-mode" : undefined);
    let gates = 0;
    const switched = await runWorkflowKernel(root, { task: "bind the execution mode" }, {
      run_id: "mode-resume-run",
      execution_mode: to,
      runtime_ref: runtimeRef,
      task_ref: taskRef,
      workspace,
      resume: saved,
      executeAgent: async () => ({ ok: true, value: {}, usage: { tokens: 0, cost_micros: 0 } }),
      runGate: async () => {
        gates += 1;
        return { result: "pass", evidence_ref: journalRef("mode-resume-gate") };
      },
      checkpoint: async () => ({ continue: true }),
    });
    assert.equal(switched.code, "kernel-checkpoint-invalid");
    assert.equal(gates, 0);
  }
  for (const mode of ["original-mode", "graph-mode"]) {
    const unbound = await pause(mode);
    unbound.schema_version = mode === "original-mode" ? 2 : 3;
    delete unbound.event_ref;
    let effects = 0;
    const refused = await runWorkflowKernel(root, { task: "bind the execution mode" }, {
      run_id: "mode-resume-run",
      execution_mode: mode,
      runtime_ref: runtimeRef,
      task_ref: taskRef,
      workspace,
      resume: unbound,
      executeAgent: async () => { effects += 1; return { ok: true, value: {} }; },
      runGate: async () => { effects += 1; return { result: "pass" }; },
      checkpoint: async () => { effects += 1; return { continue: true }; },
    });
    assert.equal(refused.code, "kernel-checkpoint-events-unbound", mode);
    assert.equal(effects, 0, mode);
  }
  const forgedOriginal = await pause("original-mode");
  forgedOriginal.schema_version = 3;
  forgedOriginal.execution_mode = "original-mode";
  let forgedEffects = 0;
  const forgedSchema = await runWorkflowKernel(root, { task: "bind the execution mode" }, {
    run_id: "mode-resume-run",
    execution_mode: "original-mode",
    runtime_ref: runtimeRef,
    task_ref: taskRef,
    workspace,
    resume: forgedOriginal,
    executeAgent: async () => { forgedEffects += 1; return { ok: true, value: {} }; },
    runGate: async () => { forgedEffects += 1; return { result: "pass" }; },
    checkpoint: async () => { forgedEffects += 1; return { continue: true }; },
  });
  assert.equal(forgedSchema.code, "kernel-checkpoint-invalid");
  assert.equal(forgedEffects, 0);

  const child = definition("mode-child", {
    "child-approval": checkpoint("operator-approval", "child-objective"),
    "child-objective": objectiveGate("child-succeeded", "child-failed"),
    "child-succeeded": terminal("succeeded"),
    "child-failed": terminal("failed", "mode-child-failed"),
  }, "child-approval");
  const parent = definition("mode-parent", {
    child: subworkflow("mode-child", 1, "objective"),
    objective: objectiveGate("succeeded", "failed"),
    succeeded: terminal("succeeded"),
    failed: terminal("failed", "mode-parent-failed"),
  }, "child");
  let parentCheckpoint = null;
  const pausedParent = await runWorkflowKernel(parent, { task: "bind nested mode" }, {
    run_id: "mode-parent-run",
    execution_mode: "graph-mode",
    runtime_ref: runtimeRef,
    task_ref: taskRef,
    workspace,
    executeAgent: async () => ({ ok: true, value: {}, usage: { tokens: 0, cost_micros: 0 } }),
    runGate: async () => ({ result: "pass", evidence_ref: journalRef("mode-parent-gate") }),
    resolveSubworkflow: () => child,
    depth: 0,
    checkpoint: async () => ({ continue: false }),
    onCheckpoint: async (checkpointState) => {
      parentCheckpoint = structuredClone(checkpointState);
      return { ok: true };
    },
  });
  assert.equal(pausedParent.status, "paused");
  assert.equal(parentCheckpoint.schema_version, 5);
  assert.equal(parentCheckpoint.active.child.scheduler.schema_version, 5);
  const pristineParentCheckpoint = structuredClone(parentCheckpoint);
  const parentResumeEvents = pausedParent.events.slice(0, parentCheckpoint.event_seq);
  const modeTamperedCheckpoint = structuredClone(pristineParentCheckpoint);
  modeTamperedCheckpoint.active.child.scheduler.execution_mode = "original-mode";
  const tamperedChild = await runWorkflowKernel(parent, { task: "bind nested mode" }, {
    run_id: "mode-parent-run",
    execution_mode: "graph-mode",
    runtime_ref: runtimeRef,
    task_ref: taskRef,
    workspace,
    resume: modeTamperedCheckpoint,
    resume_events: parentResumeEvents,
    executeAgent: async () => ({ ok: true, value: {}, usage: { tokens: 0, cost_micros: 0 } }),
    runGate: async () => ({ result: "pass", evidence_ref: journalRef("mode-parent-gate") }),
    resolveSubworkflow: () => child,
    depth: 0,
    checkpoint: async () => ({ continue: true }),
  });
  assert.equal(tamperedChild.code, "kernel-checkpoint-child-invalid");

  const unboundChildCheckpoint = structuredClone(pristineParentCheckpoint);
  unboundChildCheckpoint.active.child.scheduler.schema_version = 3;
  delete unboundChildCheckpoint.active.child.scheduler.event_ref;
  const unboundChild = await runWorkflowKernel(parent, { task: "bind nested mode" }, {
    run_id: "mode-parent-run",
    execution_mode: "graph-mode",
    runtime_ref: runtimeRef,
    task_ref: taskRef,
    workspace,
    resume: unboundChildCheckpoint,
    resume_events: parentResumeEvents,
    executeAgent: async () => ({ ok: true, value: {}, usage: { tokens: 0, cost_micros: 0 } }),
    runGate: async () => ({ result: "pass", evidence_ref: journalRef("mode-parent-gate") }),
    resolveSubworkflow: () => child,
    depth: 0,
    checkpoint: async () => ({ continue: true }),
  });
  assert.equal(unboundChild.code, "kernel-checkpoint-events-invalid");

  for (const field of ["runtime_ref", "task_ref"]) {
    const bindingTampered = structuredClone(pristineParentCheckpoint);
    bindingTampered.active.child.scheduler[field] = journalRef(`wrong-child-${field}`);
    let resolverCalls = 0;
    let checkpointCalls = 0;
    const refused = await runWorkflowKernel(parent, { task: "bind nested mode" }, {
      run_id: "mode-parent-run",
      execution_mode: "graph-mode",
      runtime_ref: runtimeRef,
      task_ref: taskRef,
      workspace,
      resume: bindingTampered,
      resume_events: parentResumeEvents,
      executeAgent: async () => ({ ok: true, value: {} }),
      runGate: async () => ({ result: "pass" }),
      resolveSubworkflow: () => { resolverCalls += 1; return child; },
      depth: 0,
      checkpoint: async () => { checkpointCalls += 1; return { continue: true }; },
    });
    assert.equal(refused.code, "kernel-checkpoint-child-invalid", field);
    assert.equal(resolverCalls, 0, field);
    assert.equal(checkpointCalls, 0, field);
  }
  const eventRefTampered = structuredClone(pristineParentCheckpoint);
  eventRefTampered.active.child.scheduler.event_ref = `sha256:${"a".repeat(64)}`;
  const eventRefRefusal = await runWorkflowKernel(parent, { task: "bind nested mode" }, {
    run_id: "mode-parent-run",
    execution_mode: "graph-mode",
    runtime_ref: runtimeRef,
    task_ref: taskRef,
    workspace,
    resume: eventRefTampered,
    resume_events: parentResumeEvents,
    executeAgent: async () => ({ ok: true, value: {}, usage: { tokens: 0, cost_micros: 0 } }),
    runGate: async () => ({ result: "pass", evidence_ref: journalRef("mode-parent-gate") }),
    resolveSubworkflow: () => child,
    depth: 0,
    checkpoint: async () => ({ continue: true }),
  });
  assert.equal(eventRefRefusal.code, "kernel-checkpoint-events-invalid");
});

test("typed objective-gate integrity failures are non-routable in both execution modes", async () => {
  const graph = definition("gate-integrity", {
    objective: objectiveGate("success", "work", { loops_off: "failed" }),
    work: reviewer("work", "objective"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  }, "objective");
  for (const executionMode of ["original-mode", "graph-mode"]) {
    let providerCalls = 0;
    let gateCalls = 0;
    const result = await runWorkflowKernel(graph, { task: "reject integrity routing" }, {
      run_id: `gate-integrity-${executionMode}`,
      execution_mode: executionMode,
      runtime_ref: journalRef("gate-integrity-runtime"),
      task_ref: journalRef("gate-integrity-task"),
      workspace: { cwd: "/tmp/mock", currentRef: () => journalRef("gate-integrity-workspace"), verifyRef: () => true },
      async executeAgent() {
        providerCalls += 1;
        return { ok: true, value: {}, usage: { tokens: 0, cost_micros: 0 } };
      },
      async runGate() {
        gateCalls += 1;
        return {
          result: "error",
          code: "objective-gate-termination-unconfirmed",
          evidence_ref: journalRef("unconfirmed-gate"),
        };
      },
    });
    assert.equal(result.code, "objective-gate-termination-unconfirmed", executionMode);
    assert.equal(providerCalls, 0, executionMode);
    assert.equal(gateCalls, 1, executionMode);
    assert.equal(result.events.some((event) => event.kind === "gate" || event.kind === "run-end"), false, executionMode);
  }
});

test("an unconfirmed objective gate remains bound across resume and is never relaunched", async () => {
  const graph = definition("gate-unknown-resume", {
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  }, "objective");
  for (const executionMode of ["original-mode", "graph-mode"]) {
    let gateCalls = 0;
    let checkpoint = null;
    const deps = {
      run_id: `gate-unknown-resume-${executionMode}`,
      execution_mode: executionMode,
      runtime_ref: journalRef("gate-unknown-resume-runtime"),
      task_ref: journalRef("gate-unknown-resume-task"),
      workspace: {
        cwd: "/tmp/mock",
        currentRef: () => journalRef("gate-unknown-resume-workspace"),
        verifyRef: () => true,
      },
      async executeAgent() {
        return { ok: true, value: {}, usage: { tokens: 0, cost_micros: 0 } };
      },
      async runGate() {
        gateCalls += 1;
        return { result: "error", code: "objective-gate-termination-unconfirmed" };
      },
      async onCheckpoint(snapshot) {
        checkpoint = structuredClone(snapshot);
        return { ok: true };
      },
    };
    const first = await runWorkflowKernel(graph, { task: "retain the gate intent" }, deps);
    assert.equal(first.code, "objective-gate-termination-unconfirmed", executionMode);
    assert.equal(gateCalls, 1, executionMode);
    assert.equal(checkpoint.active.boundary.status, "settled", executionMode);
    assert.equal(checkpoint.active.boundary.result.code, "objective-gate-termination-unconfirmed", executionMode);
    const durableCheckpoint = structuredClone(checkpoint);
    const tamperedCheckpoint = structuredClone(durableCheckpoint);
    tamperedCheckpoint.active.boundary.identity = `sha256:${"a".repeat(64)}`;
    const tampered = await runWorkflowKernel(graph, { task: "retain the gate intent" }, {
      ...deps,
      resume: tamperedCheckpoint,
      resume_events: first.events.slice(0, tamperedCheckpoint.event_seq),
    });
    assert.equal(tampered.code, "kernel-checkpoint-boundary-invalid", executionMode);
    assert.equal(gateCalls, 1, executionMode);
    const resumed = await runWorkflowKernel(graph, { task: "retain the gate intent" }, {
      ...deps,
      resume: durableCheckpoint,
      resume_events: first.events.slice(0, durableCheckpoint.event_seq),
    });
    assert.equal(resumed.code, "objective-gate-termination-unconfirmed", executionMode);
    assert.equal(gateCalls, 1, executionMode);
    assert.equal(resumed.events.some((event) => event.kind === "gate" || event.kind === "run-end"), false, executionMode);
  }
});
