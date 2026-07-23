import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { agent, checkpoint, decision, map, objectiveGate, parallel, pipeline, reduce, subworkflow, terminal, workflow } from "../dispatch/workflow/builder.mjs";
import { createEffectJournal, journalRef } from "../dispatch/kernel/journal.mjs";
import { createBudgetLedger } from "../dispatch/kernel/budgets.mjs";
import { runWorkflowKernel as runWorkflowKernelImpl } from "../dispatch/kernel/scheduler.mjs";
import {
  EMPTY_KERNEL_EVENT_PREFIX_REF,
  KERNEL_CHECKPOINT_LIMITS,
  extendKernelEventPrefixRef,
  kernelEventPrefixRef,
  kernelResultIsComplete,
} from "../dispatch/kernel/state.mjs";
import { createCanonicalWorkspace } from "../dispatch/kernel/workspace.mjs";
import { makePrivateCheckpointEffect } from "../dispatch/lib/runner.mjs";
import { observedWorkflowGraph } from "../dispatch/workflow/visualize.mjs";

const objective = { type: "file-contains", path: "proposal.txt", contains: "PASS" };
const KERNEL_TEST_EXECUTION_MODE = process.env.HELIX_KERNEL_TEST_EXECUTION_MODE;

function runWorkflowKernel(definitionValue, input, deps = {}) {
  return runWorkflowKernelImpl(definitionValue, input, KERNEL_TEST_EXECUTION_MODE == null
    ? deps
    : { ...deps, execution_mode: deps.execution_mode ?? KERNEL_TEST_EXECUTION_MODE });
}

function authenticatedResume(result, checkpointState) {
  return {
    resume: checkpointState,
    resume_events: result.events.slice(0, checkpointState.event_seq),
  };
}
const reviewer = () => agent({ role: "reviewer", stage_id: "review", output_schema: "verdict-v1", mutation: "read-only", timeout_ms: 1_000 });
const builder = () => agent({ role: "builder", stage_id: "build", mutation: "shared-serialized", timeout_ms: 1_000 });

test("event-prefix refs bind exact ordered parent and child-wrapper content", () => {
  const first = { schema_version: 1, seq: 1, run_id: "event-ref", kind: "run-start", node_id: "work" };
  const child = {
    schema_version: 1, seq: 2, run_id: "event-ref", kind: "subworkflow-event", node_id: "child",
    child_run_id: "event-ref.child.1", child_seq: 1, child_kind: "run-start", child_node_id: "work",
  };
  const firstRef = extendKernelEventPrefixRef(EMPTY_KERNEL_EVENT_PREFIX_REF, first);
  assert.match(firstRef, /^sha256:[0-9a-f]{64}$/);
  assert.equal(kernelEventPrefixRef([first, child]), extendKernelEventPrefixRef(firstRef, child));
  assert.notEqual(kernelEventPrefixRef([child, first]), kernelEventPrefixRef([first, child]));
  const tampered = structuredClone(child);
  tampered.child_node_id = "other";
  assert.notEqual(kernelEventPrefixRef([first, tampered]), kernelEventPrefixRef([first, child]));
  assert.equal(kernelEventPrefixRef([first], "invalid"), null);
});

test("every bound continuation requires its exact retained event prefix before callbacks", async () => {
  const graph = definition({
    approval: checkpoint("operator-approval", "objective"),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  }, "approval");
  for (const executionMode of ["original-mode", "graph-mode"]) {
    let saved = null;
    const base = readOnlyDeps({
      run_id: `prefix-required-${executionMode}`,
      execution_mode: executionMode,
      task_ref: journalRef(`prefix-required-task-${executionMode}`),
      runtime_ref: journalRef(`prefix-required-runtime-${executionMode}`),
      workspace: {
        currentRef: () => journalRef(`prefix-required-workspace-${executionMode}`),
        verifyRef: () => true,
      },
      async onCheckpoint(state) { saved = structuredClone(state); return { ok: true }; },
      checkpoint: async () => ({ continue: false }),
    });
    const paused = await runWorkflowKernel(graph, { task: "authenticate the prefix" }, base);
    assert.equal(paused.status, "paused", executionMode);
    const forged = structuredClone(saved);
    forged.event_ref = `sha256:${"f".repeat(64)}`;
    let callbacks = 0;
    const refused = await runWorkflowKernel(graph, { task: "authenticate the prefix" }, {
      ...base,
      resume: forged,
      workspace: {
        currentRef() { callbacks += 1; return journalRef("unreachable-workspace"); },
        verifyRef() { callbacks += 1; return true; },
      },
      async executeAgent() { callbacks += 1; return { ok: true, value: {} }; },
      async runGate() { callbacks += 1; return { result: "pass" }; },
      async checkpoint() { callbacks += 1; return { continue: true }; },
      async onCheckpoint() { callbacks += 1; return { ok: true }; },
    });
    assert.equal(refused.code, "kernel-checkpoint-events-invalid", executionMode);
    assert.equal(callbacks, 0, executionMode);
  }
});

function definition(nodes, start = "work", limits = {}, inputs = null) {
  const built = workflow({
    id: "kernel-test", name: "Kernel test", description: "Kernel test workflow.", start, nodes,
    limits: { max_total_effects: 32, max_concurrency: 4, max_map_items: 16, max_run_ms: 5_000, max_call_ms: 1_000, ...limits },
    ...(inputs ? { inputs } : {}),
    objective_gate: objective,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  return built.definition;
}

function readOnlyDeps(overrides = {}) {
  return {
    run_id: "run-1",
    async executeAgent(node, ctx) {
      return { ok: true, value: { recommendation: node.role === "reviewer" ? "approve" : "ok", item: ctx.local.item ?? null }, usage: { tokens: 1, cost_micros: 0 } };
    },
    async runGate() { return { result: "pass", evidence_ref: journalRef("gate") }; },
    ...overrides,
  };
}

test("objective-gated pipeline converges with structural events", async () => {
  const graph = definition({
    work: pipeline([reviewer()], "objective", { max_visits: 1 }),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  }, "work", { max_total_effects: 1 });
  const result = await runWorkflowKernel(graph, { task: "review" }, readOnlyDeps());
  assert.equal(result.ok, true);
  assert.equal(result.status, "succeeded");
  assert.equal(result.events.at(-1).kind, "run-end");
  assert.equal(result.outputs.objective.result, "pass");
});

test("the final gate executes only the workflow-level objective", async () => {
  const graph = definition({
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  }, "objective");
  let received = null;
  const result = await runWorkflowKernel(graph, { task: "prove one objective authority" }, readOnlyDeps({
    async runGate(gateDefinition) {
      received = structuredClone(gateDefinition);
      return { result: "pass", evidence_ref: journalRef("gate") };
    },
  }));
  assert.equal(result.ok, true);
  assert.deepEqual(received, graph.objective_gate);
  assert.equal(Object.hasOwn(graph.nodes.objective, "gate"), false);
});

test("a closed failed checkpoint is idempotent and never replays its provider effect", async () => {
  const graph = definition({
    work: pipeline([reviewer()], "objective", { max_visits: 1 }),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  }, "work", { max_total_effects: 1 });
  const checkpoints = [];
  const journal = createEffectJournal({ verify_workspace: () => true });
  let calls = 0;
  const deps = readOnlyDeps({
    task_ref: journalRef("closed-failure-task"),
    runtime_ref: journalRef("closed-failure-runtime"),
    workspace: {
      currentRef: () => journalRef("closed-failure-workspace"),
      verifyRef: () => true,
    },
    journal,
    async executeAgent() {
      calls += 1;
      return {
        ok: false, code: "closed-agent-failure", failure_class: "agent",
        usage: { tokens: 1, cost_micros: 0 },
      };
    },
    async onCheckpoint(snapshot) {
      checkpoints.push(structuredClone(snapshot));
      return { ok: true };
    },
  });
  const first = await runWorkflowKernel(graph, { task: "close exactly once" }, deps);
  assert.equal(first.code, "closed-agent-failure");
  const closed = checkpoints.at(-1);
  assert.deepEqual(closed.terminal_result, { status: "failed", code: "closed-agent-failure" });
  assert.equal(closed.active, null);
  const resumed = await runWorkflowKernel(graph, { task: "close exactly once" }, {
    ...deps, ...authenticatedResume(first, closed),
  });
  assert.equal(resumed.code, "closed-agent-failure");
  assert.equal(resumed.terminal, "work");
  assert.deepEqual(resumed.events, []);
  assert.equal(calls, 1);
});

test("failure of the first checkpoint emits a complete non-resumable lifecycle", async () => {
  const graph = definition({
    work: pipeline([reviewer()], "objective", { max_visits: 1 }),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  });
  let calls = 0;
  const result = await runWorkflowKernel(graph, { task: "fail before a durable checkpoint" }, readOnlyDeps({
    task_ref: journalRef("first-checkpoint-task"),
    runtime_ref: journalRef("first-checkpoint-runtime"),
    workspace: { currentRef: () => journalRef("first-checkpoint-workspace"), verifyRef: () => true },
    async executeAgent() { calls += 1; return { ok: true, value: { recommendation: "approve" } }; },
    async onCheckpoint() { return { ok: false, code: "kernel-checkpoint-write-failed" }; },
  }));
  assert.equal(result.code, "kernel-checkpoint-write-failed");
  assert.equal(result.terminal, "work");
  assert.deepEqual(result.events.map((event) => event.kind), ["run-start", "node-start", "node-end", "run-end"]);
  assert.equal(observedWorkflowGraph(graph, result.events, {
    execution_mode: KERNEL_TEST_EXECUTION_MODE ?? "original-mode",
  }).ok, true);
  assert.equal(calls, 0);
});

test("a closed terminal checkpoint refuses when its recorded final-gate evidence is removed", async () => {
  const graph = definition({
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  }, "objective");
  const checkpoints = [];
  const runtimeRef = journalRef("runtime");
  const taskRef = journalRef("task");
  const workspaceRef = journalRef("workspace");
  const deps = readOnlyDeps({
    runtime_ref: runtimeRef,
    task_ref: taskRef,
    workspace: { currentRef: () => workspaceRef, verifyRef: (ref) => ref === workspaceRef },
    async onCheckpoint(snapshot) {
      checkpoints.push(structuredClone(snapshot));
      return { ok: true };
    },
  });
  const first = await runWorkflowKernel(graph, { task: "resume proof" }, deps);
  assert.equal(first.ok, true);
  const forged = structuredClone(checkpoints.findLast((snapshot) => snapshot.current === "success"));
  delete forged.outputs.objective;
  let gateCalls = 0;
  const resumed = await runWorkflowKernel(graph, { task: "resume proof" }, {
    ...deps,
    ...authenticatedResume(first, forged),
    async runGate() {
      gateCalls += 1;
      return { result: "pass" };
    },
  });
  assert.equal(resumed.ok, false);
  assert.equal(resumed.status, "refused");
  assert.equal(resumed.code, "kernel-checkpoint-terminal-invalid");
  assert.equal(gateCalls, 0);
});

test("decision retries are bounded and loops-off advances explicitly", async () => {
  let calls = 0;
  const graph = definition({
    work: pipeline([reviewer()], "route", { max_visits: 2 }),
    route: { ...decision([
      { when: { op: "eq", path: "/outputs/work/by_role/reviewer/recommendation", value: "revise" }, target: "work", loop: true },
    ], "objective"), loops_off: "objective" },
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  });
  const deps = readOnlyDeps({ async executeAgent() { calls += 1; return { ok: true, value: { recommendation: "revise" }, usage: { tokens: 1, cost_micros: 0 } }; } });
  const bounded = await runWorkflowKernel(graph, { task: "review" }, deps);
  assert.equal(bounded.code, "kernel-node-visits-exhausted:work");
  assert.equal(calls, 2);
  calls = 0;
  const single = await runWorkflowKernel(graph, { task: "review" }, { ...deps, loops: false });
  assert.equal(single.ok, true);
  assert.equal(calls, 1);
});

test("agent retries are explicit, budgeted, and stop at the declared ceiling", async () => {
  const retrying = { ...reviewer(), retry: { max_attempts: 3, backoff_ms: 0 } };
  const graph = definition({
    work: pipeline([retrying], "objective", { max_visits: 1 }),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  });
  let calls = 0;
  const recovered = await runWorkflowKernel(graph, { task: "retry" }, readOnlyDeps({
    async executeAgent() {
      calls += 1;
      return calls < 3
        ? { ok: false, code: "structured-output-invalid", failure_class: "agent" }
        : { ok: true, value: { recommendation: "approve" } };
    },
  }));
  assert.equal(recovered.ok, true);
  assert.equal(calls, 3);
  assert.equal(recovered.budget.effects, 3);
  assert.equal(recovered.events.filter((event) => event.kind === "effect-retry").length, 2);
});

test("parallel preserves order and bounds in-flight effects", async () => {
  let active = 0;
  let peak = 0;
  const branches = Array.from({ length: 6 }, (_, index) => ({ ...reviewer(), label: `r${index}` }));
  const graph = definition({
    work: parallel(branches, "objective", { max_concurrency: 2 }),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  });
  const result = await runWorkflowKernel(graph, { task: "review" }, readOnlyDeps({
    async executeAgent(_node, ctx) {
      active += 1; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return { ok: true, value: ctx.instance_id };
    },
  }));
  assert.equal(result.ok, true);
  assert.equal(peak, 2);
  assert.deepEqual(result.outputs.work.map((entry) => entry.value), Array.from({ length: 6 }, (_, i) => `work:1:${i}:attempt-1`));
});

test("parallel and map abort release unstarted reservations after the first decisive failure", async () => {
  const cases = [
    {
      graph: definition({
        work: parallel([reviewer(), reviewer(), reviewer()], "objective", { max_concurrency: 1, failure: "abort" }),
        objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "objective-failed"),
      }),
      input: { task: "abort parallel" },
    },
    {
      graph: definition({
        work: map("/inputs/items", reviewer(), "objective", { max_items: 3, failure: "abort" }),
        objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "objective-failed"),
      }, "work", { max_concurrency: 1 }, {
        type: "object", additionalProperties: false, required: ["task", "items"],
        properties: {
          task: { type: "string", minLength: 1, maxLength: 65_536 },
          items: { type: "array", maxItems: 3, items: { type: "string", minLength: 1, maxLength: 8 } },
        },
      }),
      input: { task: "abort map", items: ["a", "b", "c"] },
    },
    {
      graph: definition({
        work: parallel([builder(), builder(), builder()], "objective", { max_concurrency: 2, failure: "abort" }),
        objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "objective-failed"),
      }),
      input: { task: "abort queued writers" },
      workspace: (() => {
        let generation = 0;
        return {
          cwd: "/tmp/mock", currentRef: () => journalRef({ generation }), verifyRef: () => true,
          async begin() { return { ok: true, cwd: "/tmp/mock", before_ref: journalRef({ generation }) }; },
          async commit() { generation += 1; return { ok: true, workspace_ref: journalRef({ generation }) }; },
          async rollback() { return { ok: true }; },
          serialize() { return { generation }; },
          async finalize() { return { ok: true }; },
        };
      })(),
    },
  ];
  for (const { graph, input, workspace } of cases) {
    let calls = 0;
    const result = await runWorkflowKernel(graph, input, readOnlyDeps({
      ...(workspace ? { workspace } : {}),
      async executeAgent() {
        calls += 1;
        return { ok: false, code: "decisive-agent-failure", failure_class: "agent" };
      },
    }));
    assert.equal(result.code, "decisive-agent-failure");
    assert.equal(calls, 1);
    assert.equal(result.budget.effects, 1);
    assert.equal(result.budget.reserved, 0);
  }
});

test("abort reports the decisive failure instead of a stopped retrying sibling", async () => {
  const retrying = { ...reviewer(), retry: { max_attempts: 2, backoff_ms: 0 } };
  const decisive = { ...reviewer(), retry: { max_attempts: 1, backoff_ms: 0 } };
  const cases = [
    {
      name: "parallel",
      graph: definition({
        work: parallel([retrying, decisive], "objective", { max_concurrency: 2, failure: "abort" }),
        objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "objective-failed"),
      }),
      input: { task: "attribute parallel abort" },
    },
    {
      name: "map",
      graph: definition({
        work: map("/inputs/items", retrying, "objective", { max_items: 2, failure: "abort" }),
        objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "objective-failed"),
      }, "work", { max_concurrency: 2 }, {
        type: "object", additionalProperties: false, required: ["task", "items"],
        properties: {
          task: { type: "string", minLength: 1, maxLength: 64 },
          items: { type: "array", minItems: 2, maxItems: 2, items: { type: "string", minLength: 1, maxLength: 8 } },
        },
      }),
      input: { task: "attribute map abort", items: ["a", "b"] },
    },
    {
      name: "expanded members",
      graph: definition({
        work: parallel([retrying], "objective", { max_concurrency: 1, failure: "abort" }),
        objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "objective-failed"),
      }, "work", { max_concurrency: 2 }),
      input: { task: "attribute expanded abort" },
      expandAgent: () => [retrying, decisive],
    },
  ];
  for (const candidate of cases) {
    let calls = 0;
    let releaseSecond;
    const secondStarted = new Promise((resolve) => { releaseSecond = resolve; });
    const result = await runWorkflowKernel(candidate.graph, candidate.input, readOnlyDeps({
      ...(candidate.expandAgent ? { expandAgent: candidate.expandAgent } : {}),
      async executeAgent(_node, ctx) {
        calls += 1;
        const index = ctx.local.member_index ?? ctx.local.index;
        if (index === 0 && ctx.local.attempt === 1) {
          await secondStarted;
          await new Promise((resolve) => setTimeout(resolve, 20));
        } else if (index === 1) {
          releaseSecond();
        }
        return {
          ok: false,
          code: index === 1 ? "decisive-agent-failure" : "retrying-agent-failure",
          failure_class: "agent",
          usage: { tokens: 0, cost_micros: 0 },
        };
      },
    }));
    assert.equal(result.status, "failed", candidate.name);
    assert.equal(result.code, "decisive-agent-failure", candidate.name);
    assert.ok(calls >= 2 && calls <= 3, `${candidate.name}: unexpected call count ${calls}`);
  }
});

test("malformed usage fails closed and budget arithmetic never creates unsafe totals", async () => {
  const graph = definition({
    work: pipeline([reviewer()], "objective", { max_visits: 1 }),
    objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "objective-failed"),
  });
  const result = await runWorkflowKernel(graph, { task: "usage" }, readOnlyDeps({
    async executeAgent() {
      return { ok: true, value: { recommendation: "approve" }, usage: { tokens: "100", cost_micros: 0 } };
    },
  }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "kernel-agent-usage-invalid");
  assert.equal(result.budget.tokens, 0);

  let rollbacks = 0;
  const workspaceRef = journalRef("usage-rollback-workspace");
  const mutatingGraph = definition({
    work: { ...builder(), next: "objective", max_visits: 1 },
    objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "objective-failed"),
  });
  const mutatingResult = await runWorkflowKernel(mutatingGraph, { task: "usage rollback" }, readOnlyDeps({
    workspace: {
      cwd: "/tmp/mock", currentRef: () => workspaceRef, verifyRef: () => true,
      async begin() { return { ok: true, cwd: "/tmp/mock", before_ref: workspaceRef }; },
      async commit() { return { ok: true, workspace_ref: workspaceRef }; },
      async rollback() { rollbacks += 1; return { ok: true }; },
      serialize() { return { workspace_ref: workspaceRef }; },
      async finalize() { return { ok: true }; },
    },
    async executeAgent() {
      return { ok: true, value: { recommendation: "approve" }, usage: { tokens: -1, cost_micros: 0 } };
    },
  }));
  assert.equal(mutatingResult.code, "kernel-agent-usage-invalid");
  assert.equal(rollbacks, 1);

  const failedUsage = await runWorkflowKernel(graph, { task: "failed usage" }, readOnlyDeps({
    async executeAgent() {
      return { ok: false, code: "provider-refused", failure_class: "agent", usage: { tokens: 7, cost_micros: 2 } };
    },
  }));
  assert.equal(failedUsage.code, "provider-refused");
  assert.equal(failedUsage.budget.tokens, 7);
  assert.equal(failedUsage.budget.cost_micros, 2);

  const budget = createBudgetLedger({ max_effects: 2 });
  assert.equal(budget.account({ tokens: Number.MAX_SAFE_INTEGER, cost_micros: 0 }).ok, true);
  assert.deepEqual(budget.account({ tokens: 1, cost_micros: 0 }), { ok: false, code: "kernel-budget-arithmetic-overflow" });
  assert.equal(budget.snapshot().tokens, Number.MAX_SAFE_INTEGER);
  const overflowBatch = createBudgetLedger({ max_effects: 2 }).reserveBatch([
    { tokens: Number.MAX_SAFE_INTEGER, cost_micros: 0 },
    { tokens: 1, cost_micros: 0 },
  ]);
  assert.deepEqual(overflowBatch, { ok: false, code: "kernel-budget-arithmetic-overflow" });
});

test("settled failures require an explicit code and can never mask identity failures", async () => {
  const optionalCode = "optional-analysis-unavailable";
  const graph = definition({
    work: parallel([reviewer(), reviewer()], "objective", {
      max_concurrency: 2, failure: "settle", allow_failure_codes: [optionalCode],
    }),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  });
  let calls = 0;
  const settled = await runWorkflowKernel(graph, { task: "settle" }, readOnlyDeps({
    async executeAgent() {
      calls += 1;
      return calls === 1
        ? { ok: false, code: optionalCode, failure_class: "agent" }
        : { ok: true, value: { recommendation: "approve" } };
    },
  }));
  assert.equal(settled.ok, true, JSON.stringify(settled));
  const identityGraph = structuredClone(graph);
  identityGraph.nodes.work.allow_failure_codes = ["provider-model-identity-mismatch"];
  const refused = await runWorkflowKernel(identityGraph, { task: "identity" }, readOnlyDeps({
    async executeAgent() { return { ok: false, code: "provider-model-identity-mismatch" }; },
  }));
  assert.equal(refused.code, "provider-model-identity-mismatch");
});

test("map passes exact ordered items and reduce consumes its output", async () => {
  const graph = definition({
    work: map("/inputs/items", reviewer(), "collect", { max_items: 3 }),
    collect: reduce("/outputs/work", "count", "objective"),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  }, "work", {}, {
    type: "object", additionalProperties: false, required: ["task", "items"],
    properties: {
      task: { type: "string", minLength: 1, maxLength: 65_536 },
      items: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 4 },
    },
  });
  const result = await runWorkflowKernel(graph, { task: "map", items: ["a", "b", "c"] }, readOnlyDeps());
  assert.equal(result.ok, true);
  assert.deepEqual(result.outputs.work.map((entry) => entry.result.value.item), ["a", "b", "c"]);
  assert.equal(result.outputs.collect, 3);
  const tooMany = await runWorkflowKernel(graph, { task: "map", items: ["a", "b", "c", "d"] }, readOnlyDeps());
  assert.equal(tooMany.code, "kernel-map-cardinality-exceeded");
});

test("declared workflow inputs reject unknown fields before any effect", async () => {
  let calls = 0;
  const graph = definition({
    work: pipeline([reviewer()], "objective", { max_visits: 1 }),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  });
  const result = await runWorkflowKernel(graph, { task: "review", unexpected: true }, readOnlyDeps({
    async executeAgent() { calls += 1; return { ok: true, value: {} }; },
  }));
  assert.equal(result.code, "kernel-input-invalid");
  assert.equal(calls, 0);
});

test("declared workflow input defaults materialize identically for direct kernel callers", async () => {
  let observed = null;
  const graph = definition({
    work: pipeline([reviewer()], "objective", { max_visits: 1 }),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  }, "work", {}, {
    type: "object", additionalProperties: false, required: ["task"],
    properties: {
      task: { type: "string", minLength: 1, maxLength: 65_536 },
      strict: { type: "boolean", default: true },
    },
  });
  const result = await runWorkflowKernel(graph, { task: "defaults" }, readOnlyDeps({
    async executeAgent(_node, ctx) {
      observed = ctx.input;
      return { ok: true, value: { recommendation: "approve" }, usage: { tokens: 0, cost_micros: 0 } };
    },
  }));
  assert.equal(result.ok, true);
  assert.deepEqual(observed, { task: "defaults", strict: true });
});

test("cyclic defaults are explicit and loops-off exits them when loops are disabled", async () => {
  const invalid = definition({
    route: decision([], "objective"),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "stopped"),
  }, "route");
  const candidate = structuredClone(invalid);
  candidate.nodes.route.default = { target: "route" };
  candidate.nodes.route.loops_off = "objective";
  assert.equal((await runWorkflowKernel(candidate, { task: "loop" }, readOnlyDeps({ loops: false }))).code, "kernel-definition-invalid");

  const graph = definition({
    route: decision([], "route", { default_loop: true, loops_off: "objective" }),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  }, "route");
  const result = await runWorkflowKernel(graph, { task: "loop" }, readOnlyDeps({ loops: false }));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.visits.route, 1);
});

test("expanded cast members reserve atomically and journal one effect per invocation", async () => {
  const graph = definition({
    work: pipeline([reviewer()], "objective", { max_visits: 1 }),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  }, "work", { max_total_effects: 1 });
  let calls = 0;
  const refused = await runWorkflowKernel(graph, { task: "panel" }, readOnlyDeps({
    expandAgent: (node) => [{ ...node, member: 0 }, { ...node, member: 1 }],
    async executeAgent() { calls += 1; return { ok: true, value: { recommendation: "approve" } }; },
  }));
  assert.equal(refused.code, "kernel-budget-exhausted");
  assert.equal(calls, 0);

  const allowed = structuredClone(graph);
  allowed.limits.max_total_effects = 2;
  const result = await runWorkflowKernel(allowed, { task: "panel" }, readOnlyDeps({
    expandAgent: (node) => [{ ...node, member: 0 }, { ...node, member: 1 }],
  }));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.budget.effects, 2);
  assert.equal(result.journal.length, 2);
});

test("runtime expansion may narrow but never raise the authored retry ceiling", async () => {
  const graph = definition({
    work: pipeline([reviewer()], "objective", { max_visits: 1 }),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  });
  let calls = 0;
  const result = await runWorkflowKernel(graph, { task: "keep retry policy authored" }, readOnlyDeps({
    expandAgent: (node) => [{ ...node, retry: { ...node.retry, max_attempts: 2 } }],
    async executeAgent() { calls += 1; return { ok: true, value: { recommendation: "approve" } }; },
  }));
  assert.equal(result.code, "kernel-agent-expansion-invalid");
  assert.equal(calls, 0);
});

test("a completed resumed panel reuses its effects before atomic reservation", async () => {
  const graph = definition({
    work: pipeline([reviewer()], "objective", { max_visits: 1 }),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  }, "work", { max_total_effects: 2, max_concurrency: 2 });
  const taskRef = journalRef("panel-resume-task");
  const workspaceRef = journalRef("panel-resume-workspace");
  const workspace = { cwd: "/tmp/mock", currentRef: () => workspaceRef, verifyRef: () => true };
  const journal = createEffectJournal({ verify_workspace: workspace.verifyRef });
  let calls = 0;
  let checkpoint = null;
  const deps = readOnlyDeps({
    task_ref: taskRef,
    runtime_ref: journalRef("panel-resume-runtime"),
    workspace,
    journal,
    expandAgent: (node) => [{ ...node }, { ...node }],
    async executeAgent() {
      calls += 1;
      return { ok: true, value: { recommendation: "approve" }, usage: { tokens: 0, cost_micros: 0 } };
    },
    async onCheckpoint(state) {
      const completed = Object.values(state.active?.completed ?? {});
      if (completed.length === 2 && completed.every((entry) => !entry._journal_pending)) {
        return { ok: false, code: "synthetic-panel-stop" };
      }
      checkpoint = structuredClone(state);
      return { ok: true };
    },
  });
  const interrupted = await runWorkflowKernel(graph, { task: "panel resume" }, deps);
  assert.equal(interrupted.code, "synthetic-panel-stop");
  assert.equal(calls, 2);
  assert.equal(checkpoint.budget.effects, 2);
  const resumed = await runWorkflowKernel(graph, { task: "panel resume" }, {
    ...deps,
    ...authenticatedResume(interrupted, checkpoint),
    async onCheckpoint() { return { ok: true }; },
  });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(calls, 2);
  assert.equal(resumed.budget.effects, 2);
  assert.equal(resumed.budget.reserved, 0);
});

test("mutating effects serialize and journal only after workspace commit", async () => {
  let active = 0;
  let peak = 0;
  let generation = 0;
  const refs = new Set();
  const beforeRefs = [];
  const graph = definition({
    work: parallel([builder(), builder()], "objective", { max_concurrency: 2 }),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  });
  const workspace = {
    cwd: "/tmp/mock",
    currentRef: () => journalRef({ generation }),
    async begin() {
      const beforeRef = journalRef({ generation });
      beforeRefs.push(beforeRef);
      return { ok: true, before_ref: beforeRef, cwd: "/tmp/mock" };
    },
    async commit() { generation += 1; const ref = journalRef({ generation }); refs.add(ref); return { ok: true, workspace_ref: ref }; },
    async rollback() { return { ok: true }; },
    serialize() { return { generation }; },
    async finalize() { return { ok: true }; },
    verifyRef: (ref) => refs.has(ref),
  };
  const journal = createEffectJournal({ verify_workspace: workspace.verifyRef });
  const result = await runWorkflowKernel(graph, { task: "build" }, readOnlyDeps({
    workspace, journal,
    async executeAgent() {
      active += 1; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return { ok: true, value: { recommendation: "ok" } };
    },
  }));
  assert.equal(result.ok, true);
  assert.equal(peak, 1);
  const mutating = result.journal.filter((entry) => entry.mutating);
  assert.equal(mutating.length, 2);
  assert.equal(mutating.every((entry) => refs.has(entry.workspace_ref)), true);
  assert.deepEqual(mutating.map((entry) => entry.before_ref), beforeRefs);
  assert.notEqual(mutating[0].before_ref, mutating[1].before_ref);
});

test("failed workspace restoration preserves its recovery snapshot and is non-maskable", async () => {
  let current = journalRef("before");
  let removals = 0;
  const checkpointEffect = {
    snapshot: (_run, generation) => ({ ok: true, generation, tree_ref: current }),
    restore: () => ({ ok: false, code: "synthetic-restore-failed" }),
    remove: () => { removals += 1; return { ok: true }; },
    fingerprint: () => ({ ok: true, tree_ref: current }),
  };
  const workspace = createCanonicalWorkspace({ cwd: "/tmp/mock", run_id: "restore-run", checkpoint_effect: checkpointEffect });
  const tx = await workspace.begin({ mode: "shared-serialized" });
  current = journalRef("after");
  assert.equal((await workspace.commit(tx)).ok, true);
  const restored = await workspace.rollback(tx);
  assert.equal(restored.code, "kernel-workspace-restore-failed");
  assert.equal(removals, 0, "recovery material remains available after a failed restore");
});

test("a resumed workspace retakes stale orphaned effect snapshots before rollback", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "helix-kernel-stale-effect-repo-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd });
    execFileSync("git", ["config", "user.email", "helix@example.invalid"], { cwd });
    execFileSync("git", ["config", "user.name", "Helix Workspace Recovery Test"], { cwd });
    writeFileSync(join(cwd, "value.txt"), "base\n");
    execFileSync("git", ["add", "value.txt"], { cwd });
    execFileSync("git", ["commit", "-q", "-m", "base"], { cwd });
    const checkpointEffect = makePrivateCheckpointEffect(cwd);

    const crashedProcess = createCanonicalWorkspace({ cwd, run_id: "stale-effect-run", checkpoint_effect: checkpointEffect });
    const orphan = await crashedProcess.begin({ mode: "shared-serialized" });
    assert.equal(orphan.ok, true);
    writeFileSync(join(cwd, "value.txt"), "committed-intervening-work\n");

    const resumedProcess = createCanonicalWorkspace({ cwd, run_id: "stale-effect-run", checkpoint_effect: checkpointEffect });
    const resumed = await resumedProcess.begin({ mode: "shared-serialized" });
    assert.equal(resumed.ok, true);
    assert.notEqual(resumed.tree_ref, orphan.tree_ref, "the stale generation must be retaken at the live tree");
    writeFileSync(join(cwd, "value.txt"), "failed-new-effect\n");
    assert.equal((await resumedProcess.rollback(resumed)).ok, true);
    assert.equal(readFileSync(join(cwd, "value.txt"), "utf8"), "committed-intervening-work\n");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("journal failure after a workspace apply restores before returning", async () => {
  const graph = definition({
    work: { ...builder(), next: "objective", max_visits: 1 },
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  });
  let rolledBack = 0;
  const workspace = {
    cwd: "/tmp/mock",
    currentRef: () => journalRef("workspace"),
    verifyRef: () => true,
    async begin() { return { ok: true, mode: "shared-serialized", cwd: "/tmp/mock", generation: "effect-1", tree_ref: journalRef("before"), before_ref: journalRef("workspace") }; },
    async commit() { return { ok: true, workspace_ref: journalRef("after") }; },
    async rollback() { rolledBack += 1; return { ok: true }; },
    serialize() { return { generation: "effect-1" }; },
    async finalize() { return { ok: true }; },
  };
  const journal = {
    lookup: () => null,
    lookupBase: () => null,
    nextInvocation: () => 1,
    find: () => null,
    commit: () => ({ ok: false, code: "kernel-journal-write-failed" }),
    records: () => [],
  };
  const result = await runWorkflowKernel(graph, { task: "mutate" }, readOnlyDeps({ workspace, journal }));
  assert.equal(result.code, "kernel-journal-write-failed");
  assert.equal(rolledBack, 1);
});

test("read-only cache reuses output but mutating cache requires workspace verification", async () => {
  const root = mkdtempSync(join(tmpdir(), "helix-kernel-journal-"));
  try {
    let calls = 0;
    const graph = definition({
      work: pipeline([reviewer()], "objective", { max_visits: 1 }),
      objective: objectiveGate("success", "failed"),
      success: terminal("succeeded"),
      failed: terminal("failed", "objective-failed"),
    });
    const journal = createEffectJournal({ root, run_id: "run-1", verify_workspace: () => false });
    const deps = readOnlyDeps({ journal, async executeAgent() { calls += 1; return { ok: true, value: { recommendation: "approve" } }; } });
    assert.equal((await runWorkflowKernel(graph, { task: "cache" }, deps)).ok, true);
    assert.equal((await runWorkflowKernel(graph, { task: "cache" }, deps)).ok, true);
    assert.equal(calls, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("journal read/write paths agree for Unicode roots and missing expected journals refuse", () => {
  const root = mkdtempSync(join(tmpdir(), "helix journal ü "));
  try {
    const journal = createEffectJournal({ root, run_id: "unicode-run" });
    const ref = journalRef("journal-field");
    assert.equal(journal.commit({
      run_id: "unicode-run", identity: journalRef("identity"), node_id: "work", instance_id: "work:1",
      input_ref: ref, runtime_ref: ref, before_ref: ref, mutating: false,
      status: "ok", result: { status: "ok", value: "done" },
    }).ok, true);
    assert.equal(createEffectJournal({ root, run_id: "unicode-run", expected_records: 1 }).records().length, 1);
    const journalPath = join(root, "unicode-run.kernel.journal.jsonl");
    const record = JSON.parse(readFileSync(journalPath, "utf8"));
    assert.equal(record.schema_version, 3);
    assert.equal(record.run_id, "unicode-run");
    const legacy = { ...record, schema_version: 2 };
    delete legacy.run_id;
    writeFileSync(journalPath, `${JSON.stringify(legacy)}\n`, "utf8");
    const legacyJournal = createEffectJournal({ root, run_id: "unicode-run", expected_records: 1 });
    assert.equal(legacyJournal.records()[0].schema_version, 2);
    assert.equal(legacyJournal.find(legacy.identity, { run_id: "unicode-run" }), null);
    legacy.result.value = "corrupted";
    writeFileSync(journalPath, `${JSON.stringify(legacy)}\n`, "utf8");
    assert.throws(() => createEffectJournal({ root, run_id: "unicode-run", expected_records: 1 }), /kernel-journal-corrupt/);
    unlinkSync(journalPath);
    assert.throws(() => createEffectJournal({ root, run_id: "unicode-run", expected_records: 1 }), /kernel-journal-corrupt/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("resume refuses every journal suffix identity not bound to durable pending state", async () => {
  const graph = definition({
    work: pipeline([reviewer()], "objective", { max_visits: 1 }),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  }, "work", { max_total_effects: 2 });
  const workspaceRef = journalRef("exact-suffix-workspace");
  const journal = createEffectJournal({ verify_workspace: () => true });
  let checkpoint = null;
  let failed = false;
  const deps = readOnlyDeps({
    task_ref: journalRef("exact-suffix-task"), runtime_ref: journalRef("exact-suffix-runtime"), journal,
    workspace: { cwd: "/tmp/mock", currentRef: () => workspaceRef, verifyRef: () => true },
    async onCheckpoint(state) {
      if (!failed && Object.values(state.active?.completed ?? {}).some((entry) => entry._journal_pending)) {
        failed = true;
        return { ok: false, code: "kernel-checkpoint-write-failed" };
      }
      checkpoint = structuredClone(state);
      return { ok: true };
    },
  });
  const interrupted = await runWorkflowKernel(graph, { task: "exact suffix" }, deps);
  assert.equal(interrupted.code, "kernel-checkpoint-write-failed");
  const ref = journalRef("foreign-record");
  assert.equal(journal.commit({
    run_id: "run-1", identity: journalRef("foreign-identity"), node_id: "foreign", instance_id: "foreign:1",
    input_ref: ref, runtime_ref: ref, before_ref: ref, mutating: false,
    status: "ok", result: { status: "ok", value: "foreign" },
  }).ok, true);
  const resumed = await runWorkflowKernel(graph, { task: "exact suffix" }, {
    ...deps, ...authenticatedResume(interrupted, checkpoint),
  });
  assert.equal(resumed.code, "kernel-journal-checkpoint-drift");
  assert.equal(kernelResultIsComplete(resumed, { has_checkpoint: true }), true);
});

test("oversized and deeply nested agent values return closed kernel failures", async () => {
  const graph = definition({
    work: pipeline([reviewer()], "objective", { max_visits: 1 }),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  });
  for (const value of ["x".repeat(3 * 1024 * 1024), (() => {
    let nested = "leaf";
    for (let index = 0; index < 70; index += 1) nested = [nested];
    return nested;
  })()]) {
    let checkpoint = null;
    let calls = 0;
    const workspaceRef = journalRef("bounded-result-workspace");
    const journal = createEffectJournal({ verify_workspace: () => true });
    const deps = readOnlyDeps({
      task_ref: journalRef("bounded-result-task"),
      runtime_ref: journalRef("bounded-result-runtime"),
      journal,
      workspace: { currentRef: () => workspaceRef, verifyRef: () => true },
      async executeAgent() { calls += 1; return { ok: true, value }; },
      async onCheckpoint(state) { checkpoint = structuredClone(state); return { ok: true }; },
    });
    let result;
    await assert.doesNotReject(async () => { result = await runWorkflowKernel(graph, { task: "bounded result" }, deps); });
    assert.equal(result.code, "kernel-agent-result-invalid");
    assert.equal(result.status, "failed");
    assert.equal(result.terminal, "work");
    assert.deepEqual(result.events.slice(-2).map((event) => event.kind), ["node-end", "run-end"]);
    assert.equal(checkpoint.active, null);
    assert.equal(calls, 1);
  }
});

test("aggregate accepted effect results become a durable bounded failure before checkpoint overflow", async (t) => {
  const graph = definition({
    work: parallel(Array.from({ length: 16 }, () => reviewer()), "objective", { max_concurrency: 1, failure: "abort" }),
    objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "objective-failed"),
  }, "work", { max_total_effects: 16, max_concurrency: 1 });
  const workspaceRef = journalRef("aggregate-result-workspace");
  const journalRoot = mkdtempSync(join(tmpdir(), "helix-aggregate-journal-"));
  t.after(() => rmSync(journalRoot, { recursive: true, force: true }));
  const journal = createEffectJournal({ root: journalRoot, run_id: "run-1", verify_workspace: () => true });
  const payload = "x".repeat(1_250_000);
  let calls = 0;
  let checkpoint = null;
  const deps = readOnlyDeps({
    task_ref: journalRef("aggregate-result-task"),
    runtime_ref: journalRef("aggregate-result-runtime"),
    journal,
    workspace: { cwd: "/tmp/mock", currentRef: () => workspaceRef, verifyRef: () => true },
    async executeAgent() {
      calls += 1;
      return { ok: true, value: { payload }, usage: { tokens: 0, cost_micros: 0 } };
    },
    async onCheckpoint(state) { checkpoint = state; return { ok: true }; },
  });
  const first = await runWorkflowKernel(graph, { task: "aggregate capacity" }, deps);
  assert.equal(first.code, "kernel-result-capacity-exceeded");
  assert.ok(calls > 1 && calls < 16, `capacity must stop later dispatch, observed ${calls} calls`);
  assert.ok(Buffer.byteLength(JSON.stringify(checkpoint), "utf8") <= KERNEL_CHECKPOINT_LIMITS.max_scheduler_bytes);
  const reopened = createEffectJournal({
    root: journalRoot,
    run_id: "run-1",
    expected_records: journal.records().length,
    verify_workspace: () => true,
  });
  assert.equal(reopened.records().at(-1).result.code, "kernel-result-capacity-exceeded");
  assert.equal(first.terminal, "work");
  assert.equal(first.events.at(-1).kind, "run-end");
  assert.equal(checkpoint.active, null);
});

test("effect-boundary checkpoint resumes without repeating a completed effect", async () => {
  const graph = definition({
    work: pipeline([reviewer()], "objective", { max_visits: 1 }),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  }, "work", { max_total_effects: 1 });
  const taskRef = journalRef("resume-task");
  const workspaceRef = journalRef("resume-workspace");
  const workspace = { cwd: "/tmp/mock", currentRef: () => workspaceRef, verifyRef: () => true };
  const journal = createEffectJournal({ verify_workspace: workspace.verifyRef });
  let calls = 0;
  let checkpoint = null;
  const interrupted = await runWorkflowKernel(graph, { task: "resume" }, readOnlyDeps({
    task_ref: taskRef,
    runtime_ref: journalRef("resume-runtime"),
    workspace,
    journal,
    async executeAgent() { calls += 1; return { ok: true, value: { recommendation: "approve" } }; },
    async onCheckpoint(state) {
      const completed = Object.values(state.active?.completed ?? {});
      if (completed.length > 0 && completed.every((entry) => !entry._journal_pending)) {
        return { ok: false, code: "synthetic-process-stop" };
      }
      checkpoint = structuredClone(state);
      return { ok: true };
    },
  }));
  assert.equal(interrupted.code, "synthetic-process-stop");
  assert.equal(calls, 1);
  const resumed = await runWorkflowKernel(graph, { task: "resume" }, readOnlyDeps({
    task_ref: taskRef,
    runtime_ref: journalRef("resume-runtime"),
    workspace,
    journal,
    ...authenticatedResume(interrupted, checkpoint),
    async executeAgent() { calls += 1; return { ok: true, value: { recommendation: "approve" } }; },
    async onCheckpoint() { return { ok: true }; },
  }));
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(calls, 1);
  assert.equal(resumed.events.some((event) => event.kind === "effect-resumed"), true);
});

test("a retained effect-end is not duplicated when its node resumes after settlement", async () => {
  for (const executionMode of ["original-mode", "graph-mode"]) {
    const graph = definition({
      work: pipeline([builder()], "objective", { max_visits: 1 }),
      objective: objectiveGate("success", "failed"),
      success: terminal("succeeded"),
      failed: terminal("failed", "objective-failed"),
    }, "work", { max_total_effects: 1 });
    const journal = createEffectJournal({ verify_workspace: () => true });
    const beforeRef = journalRef(`closed-effect-before-${executionMode}`);
    const afterRef = journalRef(`closed-effect-after-${executionMode}`);
    let workspaceRef = beforeRef;
    const workspace = {
      cwd: "/tmp/mock",
      currentRef: () => workspaceRef,
      verifyRef: () => true,
      async begin({ before_ref: capturedRef }) {
        return { ok: true, cwd: "/tmp/mock", before_ref: capturedRef, generation: "closed-effect" };
      },
      async commit() {
        workspaceRef = afterRef;
        return { ok: true, workspace_ref: afterRef };
      },
      async rollback() { workspaceRef = beforeRef; return { ok: true }; },
      serialize: () => ({ generation: "closed-effect" }),
      async finalize() { return { ok: true }; },
    };
    const retainedEvents = [];
    let durable = null;
    let failed = false;
    let calls = 0;
    const deps = readOnlyDeps({
      run_id: `closed-effect-${executionMode}`,
      execution_mode: executionMode,
      task_ref: journalRef(`closed-effect-task-${executionMode}`),
      runtime_ref: journalRef(`closed-effect-runtime-${executionMode}`),
      workspace,
      journal,
      async executeAgent() {
        calls += 1;
        return { ok: true, value: { recommendation: "approve" }, usage: { tokens: 1, cost_micros: 0 } };
      },
      async onCheckpoint(snapshot) {
        durable = structuredClone(snapshot);
        return { ok: true };
      },
      onEvent(event) {
        if (!failed && event.kind === "node-end" && event.node_id === "work") {
          failed = true;
          throw new Error("synthetic-post-effect-event-failure");
        }
        retainedEvents.push(structuredClone(event));
      },
    });
    const interrupted = await runWorkflowKernel(graph, { task: "retain one effect completion" }, deps);
    assert.equal(interrupted.code, "kernel-event-write-failed", executionMode);
    assert.equal(calls, 1, executionMode);
    assert.equal(retainedEvents.at(-1)?.kind, "effect-end", executionMode);
    assert.equal(Object.keys(durable.active?.completed ?? {}).length, 1, executionMode);
    const prefix = retainedEvents.filter((event) => event.seq <= durable.event_seq);
    const resumedEvents = [];
    const resumed = await runWorkflowKernel(graph, { task: "retain one effect completion" }, {
      ...deps,
      resume: durable,
      resume_events: prefix,
      onEvent: (event) => resumedEvents.push(structuredClone(event)),
      onCheckpoint: async () => ({ ok: true }),
    });
    assert.equal(resumed.ok, true, JSON.stringify(resumed));
    assert.equal(calls, 1, executionMode);
    assert.equal(resumedEvents.some((event) =>
      ["effect-end", "effect-resumed", "effect-recovered", "effect-cache-hit"].includes(event.kind)), false,
    `${executionMode}: ${JSON.stringify(resumedEvents)}`);
    assert.equal(observedWorkflowGraph(graph, [...prefix, ...resumedEvents], {
      execution_mode: executionMode,
    }).ok, true, executionMode);
  }
});

test("a read-only result survives failure of its first result checkpoint", async () => {
  const graph = definition({
    work: pipeline([reviewer()], "objective", { max_visits: 1 }),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  }, "work", { max_total_effects: 1 });
  const taskRef = journalRef("result-checkpoint-task");
  const workspaceRef = journalRef("result-checkpoint-workspace");
  const journal = createEffectJournal({ verify_workspace: () => true });
  let calls = 0;
  let checkpoint = null;
  let failedResultCheckpoint = false;
  const deps = readOnlyDeps({
    task_ref: taskRef,
    runtime_ref: journalRef("result-checkpoint-runtime"),
    workspace: { cwd: "/tmp/mock", currentRef: () => workspaceRef, verifyRef: () => true },
    journal,
    async executeAgent() { calls += 1; return { ok: true, value: { recommendation: "approve" }, usage: { tokens: 9, cost_micros: 4 } }; },
    async onCheckpoint(state) {
      if (!failedResultCheckpoint && Object.values(state.active?.completed ?? {}).some((entry) => entry._journal_pending)) {
        failedResultCheckpoint = true;
        return { ok: false, code: "kernel-checkpoint-write-failed" };
      }
      checkpoint = structuredClone(state);
      return { ok: true };
    },
  });
  const interrupted = await runWorkflowKernel(graph, { task: "result checkpoint" }, deps);
  assert.equal(interrupted.code, "kernel-checkpoint-write-failed");
  assert.equal(calls, 1);
  assert.equal(journal.records().length, 1);
  assert.equal(checkpoint.active.inflight["work:1:0:attempt-1"] != null, true);
  const resumeCheckpoint = structuredClone(checkpoint);
  const resumed = await runWorkflowKernel(graph, { task: "result checkpoint" }, {
    ...deps, ...authenticatedResume(interrupted, resumeCheckpoint),
  });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(calls, 1);
  assert.equal(resumed.budget.effects, 1);
  assert.equal(resumed.budget.tokens, 9);
  assert.equal(resumed.budget.cost_micros, 4);
  assert.equal(resumed.events.some((event) => event.kind === "effect-recovered"), true);
  assert.equal(resumed.events.some((event) => event.kind === "effect-resumed"), false);
  const durableEvents = interrupted.events.filter((event) => event.seq <= resumeCheckpoint.event_seq);
  const observed = observedWorkflowGraph(graph, [...durableEvents, ...resumed.events], {
    execution_mode: KERNEL_TEST_EXECUTION_MODE ?? "original-mode",
  });
  assert.equal(observed.ok, true, JSON.stringify(observed));
  assert.equal(observed.nodes.find((node) => node.id === "work").effects, 1);
});

test("journal-ahead inflight results retain their exact instance bindings", async () => {
  const graph = definition({
    work: parallel([reviewer(), reviewer()], "objective", { max_concurrency: 2 }),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  }, "work", { max_total_effects: 2 });
  const workspaceRef = journalRef("inflight-binding-workspace");
  const journal = createEffectJournal({ verify_workspace: () => true });
  let checkpoint = null;
  let calls = 0;
  let releaseCalls;
  const callsStarted = new Promise((resolve) => { releaseCalls = resolve; });
  const deps = readOnlyDeps({
    task_ref: journalRef("inflight-binding-task"),
    runtime_ref: journalRef("inflight-binding-runtime"),
    workspace: { cwd: "/tmp/mock", currentRef: () => workspaceRef, verifyRef: () => true },
    journal,
    async executeAgent(_agent, context) {
      calls += 1;
      if (calls === 2) releaseCalls();
      await callsStarted;
      const index = context.instance_id.includes(":0:") ? 0 : 1;
      return {
        ok: true,
        value: { recommendation: "approve", instance_id: context.instance_id },
        usage: { tokens: index === 0 ? 10 : 20, cost_micros: index === 0 ? 1 : 2 },
      };
    },
    async onCheckpoint(state) {
      const inflight = Object.keys(state.active?.inflight ?? {});
      const completed = Object.values(state.active?.completed ?? {});
      if (inflight.length === 2 && completed.length === 0 && state.journal_entries === 0) {
        checkpoint = structuredClone(state);
      }
      return completed.some((entry) => entry._journal_pending)
        ? { ok: false, code: "kernel-checkpoint-write-failed" }
        : { ok: true };
    },
  });
  const interrupted = await runWorkflowKernel(graph, { task: "bind inflight results" }, deps);
  assert.equal(interrupted.code, "kernel-checkpoint-write-failed");
  assert.equal(calls, 2);
  assert.equal(journal.records().length, 2);
  assert.equal(Object.keys(checkpoint.active.inflight).length, 2);

  const swapped = structuredClone(checkpoint);
  const [first, second] = Object.keys(swapped.active.inflight).sort();
  const firstIdentity = swapped.active.inflight[first].identity;
  swapped.active.inflight[first].identity = swapped.active.inflight[second].identity;
  swapped.active.inflight[second].identity = firstIdentity;
  const refused = await runWorkflowKernel(graph, { task: "bind inflight results" }, {
    ...deps,
    ...authenticatedResume(interrupted, swapped),
    async onCheckpoint() { return { ok: true }; },
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "kernel-checkpoint-journal-invalid");
  assert.equal(calls, 2);
});

test("a transient journal write interruption heals on resume without another invocation", async () => {
  const graph = definition({
    work: pipeline([reviewer()], "objective", { max_visits: 1 }),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  }, "work", { max_total_effects: 1 });
  const taskRef = journalRef("journal-heal-task");
  const workspaceRef = journalRef("journal-heal-workspace");
  const baseJournal = createEffectJournal({ verify_workspace: () => true });
  let failCommit = true;
  const journal = {
    records: () => baseJournal.records(),
    suffix: (count) => baseJournal.suffix(count),
    nextInvocation: (identity) => baseJournal.nextInvocation(identity),
    find: (identity, options) => baseJournal.find(identity, options),
    lookup: (identity, options) => baseJournal.lookup(identity, options),
    lookupBase: (identity, options) => baseJournal.lookupBase(identity, options),
    commit(record) {
      if (failCommit) { failCommit = false; return { ok: false, code: "kernel-journal-write-failed" }; }
      return baseJournal.commit(record);
    },
  };
  let calls = 0;
  let checkpoint = null;
  const deps = readOnlyDeps({
    task_ref: taskRef,
    runtime_ref: journalRef("journal-heal-runtime"),
    workspace: { cwd: "/tmp/mock", currentRef: () => workspaceRef, verifyRef: () => true },
    journal,
    async executeAgent() { calls += 1; return { ok: true, value: { recommendation: "approve" } }; },
    async onCheckpoint(state) { checkpoint = structuredClone(state); return { ok: true }; },
  });
  const interrupted = await runWorkflowKernel(graph, { task: "heal journal" }, deps);
  assert.equal(interrupted.code, "kernel-journal-write-failed");
  assert.equal(calls, 1);
  assert.equal(checkpoint.active.completed["work:1:0:attempt-1"]._journal_pending != null, true);
  const resumed = await runWorkflowKernel(graph, { task: "heal journal" }, {
    ...deps, ...authenticatedResume(interrupted, checkpoint),
  });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(calls, 1);
  assert.equal(resumed.budget.effects, 1);
});

test("a recoverable workspace commit failure retries as a new counted invocation", async () => {
  const graph = definition({
    work: pipeline([builder()], "objective", { max_visits: 1 }),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  }, "work", { max_total_effects: 2 });
  const before = journalRef("workspace-retry-before");
  const after = journalRef("workspace-retry-after");
  let commitCalls = 0;
  const workspace = {
    cwd: "/tmp/mock",
    currentRef: () => commitCalls > 1 ? after : before,
    verifyRef: (ref) => ref === after,
    async begin() { return { ok: true, mode: "shared-serialized", cwd: "/tmp/mock", before_ref: before }; },
    async commit() {
      commitCalls += 1;
      return commitCalls === 1
        ? { ok: false, code: "kernel-workspace-commit-failed" }
        : { ok: true, workspace_ref: after };
    },
    serialize() { return { mode: "shared-serialized", before_ref: before, workspace_ref: after }; },
    async rollback() { return { ok: true }; },
    async finalize() { return { ok: true }; },
  };
  const journal = createEffectJournal({ verify_workspace: workspace.verifyRef });
  let calls = 0;
  let checkpoint = null;
  const deps = readOnlyDeps({
    task_ref: journalRef("workspace-retry-task"),
    runtime_ref: journalRef("workspace-retry-runtime"),
    workspace,
    journal,
    async executeAgent() { calls += 1; return { ok: true, value: { recommendation: "approve" }, usage: { tokens: 5, cost_micros: 2 } }; },
    async onCheckpoint(state) { checkpoint = structuredClone(state); return { ok: true }; },
  });
  const interrupted = await runWorkflowKernel(graph, { task: "retry workspace" }, deps);
  assert.equal(interrupted.code, "kernel-workspace-commit-failed");
  const resumed = await runWorkflowKernel(graph, { task: "retry workspace" }, {
    ...deps, ...authenticatedResume(interrupted, checkpoint),
  });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(calls, 2);
  assert.equal(resumed.budget.effects, 2);
  assert.equal(resumed.budget.tokens, 10);
  assert.equal(resumed.budget.cost_micros, 4);
  assert.equal(journal.records().length, 2);
});

test("resume binds immutable lifetime ceilings and rejects cap drift before effects", async () => {
  const graph = definition({
    approval: checkpoint("operator-approval", "work"),
    work: pipeline([reviewer()], "objective", { max_visits: 1 }),
    objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "objective-failed"),
  }, "approval", { max_total_effects: 1 });
  const workspaceRef = journalRef("budget-binding-workspace");
  let snapshot = null;
  let calls = 0;
  const deps = readOnlyDeps({
    task_ref: journalRef("budget-binding-task"), runtime_ref: journalRef("budget-binding-runtime"),
    max_tokens: 10, max_cost_micros: 20,
    workspace: { currentRef: () => workspaceRef, verifyRef: () => true },
    async executeAgent() { calls += 1; return { ok: true, value: { recommendation: "approve" }, usage: { tokens: 8, cost_micros: 3 } }; },
    checkpoint: () => ({ continue: false }),
    async onCheckpoint(state) { snapshot = structuredClone(state); return { ok: true }; },
  });
  const paused = await runWorkflowKernel(graph, { task: "bind budgets" }, deps);
  assert.equal(paused.status, "paused");
  for (const drift of [{ max_tokens: null, max_cost_micros: 20 }, { max_tokens: 10, max_cost_micros: null }, { max_tokens: 11, max_cost_micros: 20 }]) {
    const refused = await runWorkflowKernel(graph, { task: "bind budgets" }, {
      ...deps, ...drift, ...authenticatedResume(paused, snapshot), checkpoint: () => ({ continue: true }),
    });
    assert.equal(refused.code, "kernel-budget-binding-drift");
  }
  assert.equal(calls, 0);
  const resumed = await runWorkflowKernel(graph, { task: "bind budgets" }, {
    ...deps, ...authenticatedResume(paused, snapshot), checkpoint: () => ({ continue: true }),
  });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(calls, 1);
  assert.deepEqual(resumed.budget, {
    effects: 1, tokens: 8, cost_micros: 3, max_effects: 1, max_tokens: 10, max_cost_micros: 20, reserved: 0,
  });

  const injectedRaised = await runWorkflowKernel(graph, { task: "reject raised injected budget" }, {
    ...deps,
    budget: createBudgetLedger({ max_effects: 2, max_tokens: 10, max_cost_micros: 20 }),
  });
  assert.equal(injectedRaised.code, "kernel-budget-binding-invalid");

  const injectedPaused = await runWorkflowKernel(graph, { task: "bind injected budget" }, {
    ...deps,
    budget: createBudgetLedger({ max_effects: 1, max_tokens: 10, max_cost_micros: 20 }),
  });
  assert.equal(injectedPaused.status, "paused");
  const injectedSnapshot = structuredClone(snapshot);
  const injectedDrift = await runWorkflowKernel(graph, { task: "bind injected budget" }, {
    ...deps,
    ...authenticatedResume(injectedPaused, injectedSnapshot),
    checkpoint: () => ({ continue: true }),
    budget: createBudgetLedger({ max_effects: 2, max_tokens: 10, max_cost_micros: 20 }),
  });
  assert.equal(injectedDrift.code, "kernel-budget-binding-drift");
});

test("checkpoint validation rejects forged completion and active-visit replay state", async () => {
  const graph = definition({
    work: pipeline([reviewer()], "objective", { max_visits: 1 }),
    objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "objective-failed"),
  }, "work", { max_total_effects: 1 });
  const workspaceRef = journalRef("checkpoint-integrity-workspace");
  let preEffect = null;
  const deps = readOnlyDeps({
    task_ref: journalRef("checkpoint-integrity-task"), runtime_ref: journalRef("checkpoint-integrity-runtime"),
    workspace: { currentRef: () => workspaceRef, verifyRef: () => true },
    journal: createEffectJournal({ verify_workspace: () => true }),
    async onCheckpoint(state) {
      if (state.active?.node_id === "work" && Object.keys(state.active.inflight).length === 0) {
        preEffect = structuredClone(state);
        return { ok: false, code: "synthetic-stop-before-effect" };
      }
      return { ok: true };
    },
  });
  const interrupted = await runWorkflowKernel(graph, { task: "checkpoint integrity" }, deps);
  assert.equal(interrupted.code, "synthetic-stop-before-effect");
  const forged = structuredClone(preEffect);
  forged.active.completed["work:1:0:attempt-1"] = {
    status: "ok", value: { recommendation: "approve" }, usage: { tokens: 0, cost_micros: 0 }, attestation_ref: null,
  };
  const forgedResult = await runWorkflowKernel(graph, { task: "checkpoint integrity" }, {
    ...deps, journal: createEffectJournal({ verify_workspace: () => true }),
    ...authenticatedResume(interrupted, forged), onCheckpoint: async () => ({ ok: true }),
  });
  assert.equal(forgedResult.code, "kernel-checkpoint-journal-invalid");
  const visitDrift = structuredClone(preEffect);
  visitDrift.active.visit += 1;
  const driftResult = await runWorkflowKernel(graph, { task: "checkpoint integrity" }, {
    ...deps, journal: createEffectJournal({ verify_workspace: () => true }),
    ...authenticatedResume(interrupted, visitDrift), onCheckpoint: async () => ({ ok: true }),
  });
  assert.equal(driftResult.code, "kernel-checkpoint-active-invalid");
});

test("gate exceptions and malformed results are kernel failures, never authored fail edges", async () => {
  const graph = definition({
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  }, "objective");
  const thrown = await runWorkflowKernel(graph, { task: "throwing gate" }, readOnlyDeps({
    async runGate() { throw new Error("gate host failed"); },
  }));
  assert.equal(thrown.code, "kernel-gate-effect-failed");
  for (const value of [null, {}, { result: "PASS" }, { result: true }, { result: "pass", evidence_ref: "bad-ref" }]) {
    const malformed = await runWorkflowKernel(graph, { task: "malformed gate" }, readOnlyDeps({
      async runGate() { return value; },
    }));
    assert.equal(malformed.code, "kernel-gate-result-invalid", JSON.stringify(value));
    assert.notEqual(malformed.status, "succeeded");
  }
});

test("declared mutations and artifacts require complete host effects and serialize failures restore", async () => {
  const mutating = definition({
    work: { ...builder(), next: "objective", max_visits: 1 },
    objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "objective-failed"),
  });
  assert.equal((await runWorkflowKernel(mutating, { task: "missing workspace" }, readOnlyDeps())).code,
    "kernel-workspace-effects-missing");

  const artifact = definition({
    work: pipeline([reviewer()], "objective", { max_visits: 1, artifact: { path: "proposal.txt", kind: "notes" } }),
    objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "objective-failed"),
  });
  assert.equal((await runWorkflowKernel(artifact, { task: "missing verifier" }, readOnlyDeps())).code,
    "kernel-artifact-effect-missing");

  const workspaceRef = journalRef("serialize-workspace");
  let rollbacks = 0;
  const serialization = await runWorkflowKernel(mutating, { task: "serialize rollback" }, readOnlyDeps({
    workspace: {
      cwd: "/tmp/mock", currentRef: () => workspaceRef, verifyRef: () => true,
      async begin() { return { ok: true, cwd: "/tmp/mock", before_ref: workspaceRef }; },
      async commit() { return { ok: true, workspace_ref: workspaceRef }; },
      async rollback() { rollbacks += 1; return { ok: true }; },
      serialize() { throw new Error("cannot serialize"); },
      async finalize() { return { ok: true }; },
    },
  }));
  assert.equal(serialization.code, "kernel-workspace-serialize-failed");
  assert.equal(rollbacks, 1);
});

test("parallel, map, and child identities are scoped to each node visit", async () => {
  const loop = (work) => ({
    work,
    route: decision([
      { when: { op: "eq", path: "/visits/work", value: 1 }, target: "work", loop: true },
    ], "objective", { loops_off: "objective" }),
    objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "objective-failed"),
  });
  const observed = [];
  const parallelGraph = definition(loop(parallel([reviewer()], "route", { max_concurrency: 1 })), "work", { max_total_effects: 2 });
  const parallelResult = await runWorkflowKernel(parallelGraph, { task: "parallel visits" }, readOnlyDeps({
    async executeAgent(_node, ctx) {
      observed.push(`${ctx.run_id}:${ctx.instance_id}`);
      return { ok: true, value: { recommendation: "approve" }, usage: { tokens: 0, cost_micros: 0 } };
    },
  }));
  assert.equal(parallelResult.ok, true, JSON.stringify(parallelResult));
  assert.deepEqual(observed, ["run-1:work:1:0:attempt-1", "run-1:work:2:0:attempt-1"]);

  observed.length = 0;
  const mapGraph = definition(loop(map("/inputs/items", reviewer(), "route", { max_items: 1 })), "work", { max_total_effects: 2 }, {
    type: "object", additionalProperties: false, required: ["task", "items"],
    properties: {
      task: { type: "string", minLength: 1, maxLength: 64 },
      items: { type: "array", items: { type: "string", minLength: 1, maxLength: 8 }, minItems: 1, maxItems: 1 },
    },
  });
  const mapResult = await runWorkflowKernel(mapGraph, { task: "map visits", items: ["x"] }, readOnlyDeps({
    async executeAgent(_node, ctx) {
      observed.push(`${ctx.run_id}:${ctx.instance_id}`);
      return { ok: true, value: { recommendation: "approve" }, usage: { tokens: 0, cost_micros: 0 } };
    },
  }));
  assert.equal(mapResult.ok, true, JSON.stringify(mapResult));
  assert.deepEqual(observed, ["run-1:work:1:0:attempt-1", "run-1:work:2:0:attempt-1"]);

  const child = workflow({
    id: "visit-child", name: "Visit child", description: "Visit-scoped child workflow.", start: "work",
    nodes: {
      work: pipeline([reviewer()], "objective", { max_visits: 1 }),
      objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "child-failed"),
    },
    objective_gate: objective,
  });
  assert.equal(child.ok, true, JSON.stringify(child.errors));
  observed.length = 0;
  const parent = definition(loop(subworkflow("visit-child", 1, "route")), "work", { max_total_effects: 2 });
  const childResult = await runWorkflowKernel(parent, { task: "child visits" }, readOnlyDeps({
    depth: 0,
    resolveSubworkflow: () => child.definition,
    async executeAgent(_node, ctx) {
      observed.push(`${ctx.run_id}:${ctx.instance_id}`);
      return { ok: true, value: { recommendation: "approve" }, usage: { tokens: 0, cost_micros: 0 } };
    },
  }));
  assert.equal(childResult.ok, true, JSON.stringify(childResult));
  assert.deepEqual(observed, [
    "run-1.work.1:work:1:0:attempt-1",
    "run-1.work.2:work:1:0:attempt-1",
  ]);
});

test("structured output repair is separately bounded and every repair is a counted effect", async () => {
  const repairing = { ...reviewer(), retry: { max_attempts: 1, backoff_ms: 0 } };
  const graph = definition({
    work: pipeline([repairing], "objective", { max_visits: 1 }),
    objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "objective-failed"),
  }, "work", { max_total_effects: 3, structured_repair_attempts: 2 });
  let calls = 0;
  const result = await runWorkflowKernel(graph, { task: "repair output" }, readOnlyDeps({
    async executeAgent(_node, ctx) {
      calls += 1;
      assert.equal(ctx.local.attempt, calls);
      assert.equal(ctx.local.repair_attempt, Math.max(0, calls - 1));
      return calls < 3
        ? { ok: false, code: "pi-agent-semantic-output-invalid", failure_class: "agent", usage: { tokens: 1, cost_micros: 0 } }
        : { ok: true, value: { recommendation: "approve" }, usage: { tokens: 1, cost_micros: 0 } };
    },
  }));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(calls, 3);
  assert.equal(result.budget.effects, 3);
  assert.equal(result.events.filter((event) => event.kind === "effect-repair").length, 2);
  assert.equal(result.events.some((event) => event.kind === "effect-retry"), false);
});

test("failed workspace finalization resumes as non-maskable without replay", async () => {
  const graph = definition({
    work: pipeline([builder()], "objective", { max_visits: 1 }),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  });
  const taskRef = journalRef("finalize-task");
  const workspaceRef = journalRef("finalize-workspace");
  const journal = createEffectJournal({ verify_workspace: () => true });
  let calls = 0;
  let checkpoint = null;
  const workspace = {
    cwd: "/tmp/mock",
    currentRef: () => workspaceRef,
    verifyRef: () => true,
    async begin() { return { ok: true, mode: "shared-serialized", cwd: "/tmp/mock", generation: "effect-1", tree_ref: workspaceRef, before_ref: workspaceRef }; },
    async commit() { return { ok: true, workspace_ref: workspaceRef }; },
    serialize(tx) { return { ...tx, workspace_ref: workspaceRef, applied: true }; },
    async finalize() { return { ok: false, code: "kernel-workspace-snapshot-cleanup-failed" }; },
    async rollback() { return { ok: true }; },
  };
  const deps = readOnlyDeps({
    task_ref: taskRef,
    runtime_ref: journalRef("finalize-runtime"),
    workspace,
    journal,
    async executeAgent() {
      calls += 1;
      return { ok: true, value: { recommendation: "approve" }, usage: { tokens: 0, cost_micros: 0 } };
    },
    async onCheckpoint(state) {
      if (Object.values(state.active?.completed ?? {}).some((entry) => entry._workspace_pending)) checkpoint = structuredClone(state);
      return { ok: true };
    },
  });
  const interrupted = await runWorkflowKernel(graph, { task: "finalize" }, deps);
  assert.equal(interrupted.code, "kernel-workspace-snapshot-cleanup-failed");
  assert.equal(kernelResultIsComplete(interrupted, { has_checkpoint: true }), false);
  assert.equal(kernelResultIsComplete(interrupted), true);
  assert.equal(calls, 1);
  assert.ok(checkpoint);
  const resumed = await runWorkflowKernel(graph, { task: "finalize" }, {
    ...deps, ...authenticatedResume(interrupted, checkpoint),
  });
  assert.equal(resumed.code, "kernel-workspace-snapshot-cleanup-failed");
  assert.equal(calls, 1);
});

test("budget exhaustion and cancellation are terminal, never allowed failures", async () => {
  const graph = definition({
    work: parallel([reviewer(), reviewer()], "objective", { max_concurrency: 2 }),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  }, "work", { max_total_effects: 1 });
  let calls = 0;
  const exhausted = await runWorkflowKernel(graph, { task: "budget" }, readOnlyDeps({
    async executeAgent() { calls += 1; return { ok: true, value: { recommendation: "approve" } }; },
  }));
  assert.equal(exhausted.code, "kernel-budget-exhausted");
  assert.equal(calls, 0, "an impossible first wave launches no effects");
  const controller = new AbortController();
  controller.abort("operator-cancelled");
  const cancelled = await runWorkflowKernel(graph, { task: "cancel" }, readOnlyDeps({ signal: controller.signal }));
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.budget.reserved, 0);
});

test("parallel and map propagate mid-effect cancellation as cancelled", async () => {
  const parallelGraph = definition({
    work: parallel([reviewer(), reviewer()], "objective", { max_concurrency: 2 }),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  });
  const mappedGraph = definition({
    work: map("/inputs/items", reviewer(), "objective", { max_items: 2 }),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  }, "work", {}, {
    type: "object", additionalProperties: false, required: ["task", "items"],
    properties: {
      task: { type: "string", minLength: 1, maxLength: 65_536 },
      items: { type: "array", minItems: 2, maxItems: 2, items: { type: "string" } },
    },
  });
  for (const [graph, input] of [[parallelGraph, { task: "cancel" }], [mappedGraph, { task: "cancel", items: ["a", "b"] }]]) {
    const controller = new AbortController();
    const resultPromise = runWorkflowKernel(graph, input, readOnlyDeps({
      signal: controller.signal,
      async executeAgent(_node, { signal }) {
        return new Promise((resolve) => signal.addEventListener("abort", () => resolve({ ok: false, code: "kernel-effect-cancelled" }), { once: true }));
      },
    }));
    setTimeout(() => controller.abort("operator-cancelled"), 5);
    const result = await resultPromise;
    assert.equal(result.status, "cancelled", JSON.stringify(result));
  }
});

test("cancellation waits for provider settlement and accounts its late usage before terminal evidence", async () => {
  const graph = definition({
    work: pipeline([reviewer()], "objective", { max_visits: 1 }),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  });
  for (const executionMode of ["original-mode", "graph-mode"]) {
    const controller = new AbortController();
    const workspaceRef = journalRef(`settle-cancellation-workspace-${executionMode}`);
    let settled = false;
    let terminalCheckpointBeforeSettlement = false;
    const resultPromise = runWorkflowKernel(graph, { task: "settle cancellation" }, readOnlyDeps({
      execution_mode: executionMode,
      signal: controller.signal,
      workspace: { cwd: "/tmp/mock", currentRef: () => workspaceRef, verifyRef: () => true },
      async onCheckpoint(state) {
        if (state.terminal_result) terminalCheckpointBeforeSettlement = !settled;
        return { ok: true };
      },
      async executeAgent() {
        setTimeout(() => controller.abort("operator-cancelled"), 5);
        await new Promise((resolve) => setTimeout(resolve, 40));
        settled = true;
        return {
          ok: false,
          code: "kernel-effect-cancelled",
          usage: { tokens: 17, cost_micros: 3 },
        };
      },
    }));
    const result = await resultPromise;
    assert.equal(settled, true, executionMode);
    assert.equal(terminalCheckpointBeforeSettlement, false, executionMode);
    assert.equal(result.status, "cancelled", executionMode);
    assert.equal(result.budget.tokens, 17, executionMode);
    assert.equal(result.budget.cost_micros, 3, executionMode);
    assert.deepEqual(result.journal[0].result.usage, { tokens: 17, cost_micros: 3 }, executionMode);
    assert.equal(result.events.at(-1).kind, "run-end", executionMode);
  }
});

test("a durable terminal checkpoint remains authoritative over cancellation during persistence", async () => {
  const graph = definition({
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  }, "objective");
  for (const executionMode of ["original-mode", "graph-mode"]) {
    const controller = new AbortController();
    const durable = [];
    const result = await runWorkflowKernel(graph, { task: "commit the terminal result exactly once" }, readOnlyDeps({
      run_id: `terminal-checkpoint-cancel-${executionMode}`,
      execution_mode: executionMode,
      signal: controller.signal,
      task_ref: journalRef(`terminal-checkpoint-cancel-task-${executionMode}`),
      runtime_ref: journalRef(`terminal-checkpoint-cancel-runtime-${executionMode}`),
      workspace: {
        currentRef: () => journalRef(`terminal-checkpoint-cancel-workspace-${executionMode}`),
        verifyRef: () => true,
      },
      async onCheckpoint(state) {
        durable.push(structuredClone(state));
        if (state.terminal_result) controller.abort("operator-cancelled");
        return { ok: true };
      },
    }));
    const terminal = durable.at(-1);
    assert.deepEqual(terminal.terminal_result, { status: "succeeded", code: null }, executionMode);
    assert.equal(result.status, terminal.terminal_result.status, executionMode);
    assert.equal(result.code, terminal.terminal_result.code, executionMode);
    assert.equal(result.ok, true, executionMode);
    assert.equal(result.events.at(-1).kind, "run-end", executionMode);
    assert.equal(result.events.at(-1).status, "succeeded", executionMode);
  }
});

test("cancellation and deadlines win before every authored terminal commit in both modes", async () => {
  const terminalCases = [
    { status: "succeeded", gateResult: "pass", target: "succeeded", code: null },
    { status: "failed", gateResult: "fail", target: "stopped", code: "authored-failed" },
    { status: "refused", gateResult: "fail", target: "stopped", code: "authored-refused" },
    { status: "cancelled", gateResult: "fail", target: "stopped", code: "authored-cancelled" },
  ];
  for (const executionMode of ["original-mode", "graph-mode"]) {
    for (const terminalCase of terminalCases) {
      for (const interruptionCase of ["cancel", "deadline"]) {
        const graph = definition({
          objective: objectiveGate("succeeded", "stopped"),
          succeeded: terminal("succeeded"),
          stopped: terminal(
            terminalCase.status === "succeeded" ? "failed" : terminalCase.status,
            terminalCase.status === "succeeded" ? "unused-failure" : terminalCase.code,
          ),
        }, "objective", { max_run_ms: interruptionCase === "deadline" ? 1_000 : 5_000 });
        const controller = new AbortController();
        const durable = [];
        let interrupted = false;
        const result = await runWorkflowKernel(graph, { task: "arbitrate before terminal commit" }, readOnlyDeps({
          run_id: `preterminal-${executionMode}-${terminalCase.status}-${interruptionCase}`,
          execution_mode: executionMode,
          signal: controller.signal,
          task_ref: journalRef(`preterminal-task-${executionMode}-${terminalCase.status}-${interruptionCase}`),
          runtime_ref: journalRef(`preterminal-runtime-${executionMode}-${terminalCase.status}-${interruptionCase}`),
          workspace: {
            currentRef: () => journalRef(`preterminal-workspace-${executionMode}-${terminalCase.status}-${interruptionCase}`),
            verifyRef: () => true,
          },
          async runGate() {
            return { result: terminalCase.gateResult, evidence_ref: journalRef(`preterminal-gate-${terminalCase.status}`) };
          },
          async onCheckpoint(state) {
            durable.push(structuredClone(state));
            if (!interrupted && state.terminal_result == null
              && state.current === terminalCase.target
              && state.active?.node_id === terminalCase.target) {
              interrupted = true;
              if (interruptionCase === "cancel") controller.abort("operator-cancelled");
              else await new Promise((resolve) => setTimeout(resolve, 1_050));
            }
            return { ok: true };
          },
        }));
        const label = `${executionMode}/${terminalCase.status}/${interruptionCase}`;
        const expected = interruptionCase === "cancel"
          ? { status: "cancelled", code: "kernel-run-cancelled" }
          : { status: "failed", code: "kernel-run-deadline-exceeded" };
        assert.equal(interrupted, true, label);
        assert.equal(result.ok, false, label);
        assert.equal(result.status, expected.status, label);
        assert.equal(result.code, expected.code, label);
        assert.deepEqual(durable.at(-1).terminal_result, expected, label);
        assert.equal(result.events.filter((event) => event.kind === "run-end").length, 1, label);
        assert.equal(result.events.at(-1).status, expected.status, label);
        assert.equal(result.events.at(-1).code, expected.code, label);
      }
    }
  }
});

test("resumed active terminals re-arbitrate cancellation and deadlines before publication", async () => {
  const terminalCases = [
    { status: "succeeded", gateResult: "pass", target: "succeeded", code: null },
    { status: "failed", gateResult: "fail", target: "stopped", code: "resumed-authored-failed" },
    { status: "refused", gateResult: "fail", target: "stopped", code: "resumed-authored-refused" },
    { status: "cancelled", gateResult: "fail", target: "stopped", code: "resumed-authored-cancelled" },
  ];
  for (const executionMode of ["original-mode", "graph-mode"]) {
    for (const terminalCase of terminalCases) {
      for (const interruptionCase of ["cancel", "deadline"]) {
        const graph = definition({
          objective: objectiveGate("succeeded", "stopped"),
          succeeded: terminal("succeeded"),
          stopped: terminal(
            terminalCase.status === "succeeded" ? "failed" : terminalCase.status,
            terminalCase.status === "succeeded" ? "unused-resume-failure" : terminalCase.code,
          ),
        }, "objective", { max_run_ms: 1_000 });
        const runId = `resumed-terminal-${executionMode}-${terminalCase.status}-${interruptionCase}`;
        const taskRef = journalRef(`${runId}-task`);
        const runtimeRef = journalRef(`${runId}-runtime`);
        const workspaceRef = journalRef(`${runId}-workspace`);
        const checkpoints = [];
        let clock = 0;
        let failTerminalEnd = true;
        const base = readOnlyDeps({
          run_id: runId,
          execution_mode: executionMode,
          task_ref: taskRef,
          runtime_ref: runtimeRef,
          now: () => clock,
          workspace: {
            currentRef: () => workspaceRef,
            verifyRef: (ref) => ref === workspaceRef,
          },
          async runGate() {
            return {
              result: terminalCase.gateResult,
              evidence_ref: journalRef(`${runId}-gate`),
            };
          },
          async onCheckpoint(state) {
            checkpoints.push(structuredClone(state));
            return { ok: true };
          },
          onEvent(event) {
            if (failTerminalEnd && event.kind === "node-end" && event.node_id === terminalCase.target) {
              failTerminalEnd = false;
              throw new Error("synthetic-terminal-event-failure");
            }
          },
        });
        const first = await runWorkflowKernel(graph, { task: "resume an active terminal exactly" }, base);
        const activeTerminal = checkpoints.findLast((state) =>
          state.current === terminalCase.target
          && state.active?.node_id === terminalCase.target
          && state.terminal_result == null);
        const label = `${executionMode}/${terminalCase.status}/${interruptionCase}`;
        assert.equal(first.code, "kernel-event-write-failed", label);
        assert.ok(activeTerminal, label);
        assert.equal(first.events.length, activeTerminal.event_seq, label);
        const visit = activeTerminal.visits[terminalCase.target];
        const controller = new AbortController();
        const resumedCheckpoints = [];
        let terminalStarts = 0;
        const resumed = await runWorkflowKernel(graph, { task: "resume an active terminal exactly" }, {
          ...base,
          signal: controller.signal,
          resume: activeTerminal,
          resume_events: first.events.slice(0, activeTerminal.event_seq),
          async onCheckpoint(state) {
            resumedCheckpoints.push(structuredClone(state));
            return { ok: true };
          },
          onEvent(event) {
            if (event.kind !== "node-start" || event.node_id !== terminalCase.target) return;
            terminalStarts += 1;
            if (interruptionCase === "cancel") controller.abort("operator-cancelled");
            else clock = graph.limits.max_run_ms;
          },
        });
        const expected = interruptionCase === "cancel"
          ? { status: "cancelled", code: "kernel-run-cancelled" }
          : { status: "failed", code: "kernel-run-deadline-exceeded" };
        assert.equal(terminalStarts, 1, label);
        assert.equal(resumed.ok, false, label);
        assert.equal(resumed.status, expected.status, label);
        assert.equal(resumed.code, expected.code, label);
        assert.equal(resumed.visits[terminalCase.target], visit, label);
        assert.deepEqual(resumedCheckpoints.at(-1).terminal_result, expected, label);
        assert.deepEqual(
          resumed.events.filter((event) => ["node-end", "run-end"].includes(event.kind))
            .map((event) => ({ kind: event.kind, status: event.status, code: event.code })),
          [
            { kind: "node-end", ...expected },
            { kind: "run-end", ...expected },
          ],
          label,
        );
      }
    }
  }
});

test("late provider success never outruns cancellation, run deadlines, or call timeouts", async () => {
  const cases = [
    { id: "cancel", expectedStatus: "cancelled", expectedCode: "kernel-run-cancelled", delay: 30 },
    { id: "run-deadline", expectedStatus: "failed", expectedCode: "kernel-run-deadline-exceeded", delay: 1_050 },
    { id: "call-timeout", expectedStatus: "failed", expectedCode: "kernel-effect-timeout", delay: 1_050 },
  ];
  for (const executionMode of ["original-mode", "graph-mode"]) {
    for (const mutation of ["read-only", "shared-serialized"]) {
      for (const scenario of cases) {
        const worker = mutation === "read-only" ? reviewer() : builder();
        worker.timeout_ms = scenario.id === "run-deadline" ? 2_000 : 1_000;
        const graph = definition({
          work: pipeline([worker], "objective", { max_visits: 1 }),
          objective: objectiveGate("success", "failed"),
          success: terminal("succeeded"),
          failed: terminal("failed", "objective-failed"),
        }, "work", {
          max_run_ms: scenario.id === "run-deadline" ? 1_000 : 5_000,
          max_call_ms: scenario.id === "run-deadline" ? 2_000 : 1_000,
        });
        const controller = new AbortController();
        const beforeRef = journalRef(`late-success-before-${executionMode}-${mutation}-${scenario.id}`);
        let commits = 0;
        let rollbacks = 0;
        const workspace = {
          cwd: "/tmp/mock",
          currentRef: () => beforeRef,
          verifyRef: () => true,
          async begin() {
            return {
              ok: true, mode: "shared-serialized", cwd: "/tmp/mock", before_ref: beforeRef,
              generation: "late-success", tree_ref: beforeRef,
            };
          },
          async commit() { commits += 1; return { ok: true, workspace_ref: journalRef("unexpected-commit") }; },
          async rollback() { rollbacks += 1; return { ok: true }; },
          serialize() { return { generation: "late-success" }; },
          async finalize() { return { ok: true }; },
        };
        const result = await runWorkflowKernel(graph, { task: "late success must not advance" }, readOnlyDeps({
          execution_mode: executionMode,
          signal: controller.signal,
          workspace,
          async executeAgent() {
            if (scenario.id === "cancel") setTimeout(() => controller.abort("operator-cancelled"), 5);
            await new Promise((resolve) => setTimeout(resolve, scenario.delay));
            return { ok: true, value: { recommendation: "approve" }, usage: { tokens: 9, cost_micros: 2 } };
          },
        }));
        const label = `${executionMode}/${mutation}/${scenario.id}`;
        assert.equal(result.status, scenario.expectedStatus, `${label}: ${JSON.stringify(result)}`);
        assert.equal(result.code, scenario.expectedCode, `${label}: ${JSON.stringify(result)}`);
        assert.equal(commits, 0, label);
        assert.equal(rollbacks, mutation === "read-only" ? 0 : 1, label);
        assert.equal(result.budget.tokens, 9, label);
        assert.equal(result.budget.cost_micros, 2, label);
        assert.equal(result.journal[0].status, scenario.expectedStatus, label);
        assert.deepEqual(result.journal[0].result.usage, { tokens: 9, cost_micros: 2 }, label);
        assert.equal(result.events.some((event) => event.kind === "transition"), false, label);
        assert.equal(result.events.some((event) => event.kind === "node-start" && event.node_id === "objective"), false, label);
      }
    }
  }
});

test("late gate success cannot survive cancellation or deadline plus terminal checkpoint failure", async () => {
  for (const executionMode of ["original-mode", "graph-mode"]) {
    for (const scenario of ["cancel", "deadline"]) {
      const graph = definition({
        objective: objectiveGate("success", "failed"),
        success: terminal("succeeded"),
        failed: terminal("failed", "objective-failed"),
      }, "objective", { max_run_ms: 1_000 });
      const controller = new AbortController();
      const durable = [];
      const expectedCode = scenario === "deadline"
        ? "kernel-run-deadline-exceeded"
        : "kernel-run-cancelled";
      const deps = readOnlyDeps({
        run_id: `late-gate-${executionMode}-${scenario}`,
        execution_mode: executionMode,
        signal: controller.signal,
        task_ref: journalRef(`late-gate-task-${executionMode}-${scenario}`),
        runtime_ref: journalRef(`late-gate-runtime-${executionMode}-${scenario}`),
        workspace: {
          currentRef: () => journalRef(`late-gate-workspace-${executionMode}-${scenario}`),
          verifyRef: () => true,
        },
        async runGate() {
          if (scenario === "cancel") setTimeout(() => controller.abort("operator-cancelled"), 5);
          await new Promise((resolve) => setTimeout(resolve, scenario === "deadline" ? 1_050 : 30));
          return { result: "pass", evidence_ref: journalRef("late-gate-pass") };
        },
        async onCheckpoint(state) {
          if (state.terminal_result) return { ok: false, code: "kernel-checkpoint-write-failed" };
          durable.push(structuredClone(state));
          return { ok: true };
        },
      });
      const interrupted = await runWorkflowKernel(graph, { task: "late gate must stay interrupted" }, deps);
      const saved = durable.at(-1);
      const label = `${executionMode}/${scenario}`;
      assert.equal(interrupted.code, "kernel-checkpoint-write-failed", label);
      assert.equal(saved.active.boundary.status, "settled", label);
      assert.equal(saved.active.boundary.result.result, "error", label);
      assert.equal(saved.active.boundary.result.code, expectedCode, label);
      let resumedGateCalls = 0;
      const resumed = await runWorkflowKernel(graph, { task: "late gate must stay interrupted" }, {
        ...deps,
        signal: null,
        ...authenticatedResume(interrupted, saved),
        async runGate() {
          resumedGateCalls += 1;
          return { result: "pass", evidence_ref: journalRef("unexpected-resume-pass") };
        },
        async onCheckpoint() { return { ok: true }; },
      });
      assert.notEqual(resumed.status, "succeeded", label);
      assert.equal(resumed.status, scenario === "cancel" ? "cancelled" : "failed", label);
      assert.equal(resumed.code, expectedCode, label);
      assert.equal(resumedGateCalls, 0, label);
    }
  }
});

test("an unconfirmed provider outcome retains its in-flight checkpoint without terminal evidence", async () => {
  const graph = definition({
    work: pipeline([reviewer()], "objective", { max_visits: 1 }),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  });
  const controller = new AbortController();
  const workspaceRef = journalRef("unknown-provider-workspace");
  let durable = null;
  const resultPromise = runWorkflowKernel(graph, { task: "retain unknown provider" }, readOnlyDeps({
    signal: controller.signal,
    workspace: { cwd: "/tmp/mock", currentRef: () => workspaceRef, verifyRef: () => true },
    effect_settlement_timeout_ms: 25,
    async onCheckpoint(state) { durable = structuredClone(state); return { ok: true }; },
    async executeAgent() { return new Promise(() => {}); },
  }));
  setTimeout(() => controller.abort("operator-cancelled"), 5);
  const result = await resultPromise;
  assert.equal(result.code, "kernel-effect-outcome-unknown");
  assert.equal(result.events.some((event) => event.kind === "run-end"), false);
  assert.equal(Object.keys(durable.active.inflight).length, 1);
  assert.equal(durable.budget.effects, 1);
  assert.equal(durable.budget.tokens, 0);
  assert.equal(result.journal?.length ?? 0, 0);
});

test("the scheduler hard deadline bounds a non-cooperative objective gate", async () => {
  const graph = definition({
    work: pipeline([reviewer()], "objective", { max_visits: 1 }),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  }, "work", { max_run_ms: 1_000 });
  const started = Date.now();
  const result = await runWorkflowKernel(graph, { task: "deadline" }, readOnlyDeps({
    effect_settlement_timeout_ms: 50,
    async runGate() { return new Promise(() => {}); },
  }));
  assert.equal(result.status, "failed");
  assert.equal(result.code, "kernel-boundary-outcome-unknown");
  assert.equal(result.events.some((event) => event.kind === "run-end"), false);
  assert.ok(Date.now() - started < 2_500);
});

test("max_run_ms is cumulative across a paused continuation", async () => {
  const graph = definition({
    hold: checkpoint("operator-approval", "objective"),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  }, "hold", { max_run_ms: 1_000 });
  const workspaceRef = journalRef("deadline-resume-workspace");
  let clock = 0;
  let snapshot = null;
  const base = readOnlyDeps({
    task_ref: journalRef("deadline-resume-task"),
    runtime_ref: journalRef("deadline-resume-runtime"),
    workspace: { cwd: "/tmp/mock", currentRef: () => workspaceRef, verifyRef: () => true },
    now: () => clock,
    async onCheckpoint(state) { snapshot = structuredClone(state); return { ok: true }; },
  });
  const paused = await runWorkflowKernel(graph, { task: "deadline resume" }, {
    ...base,
    checkpoint() { clock = 800; return { continue: false }; },
  });
  assert.equal(paused.status, "paused");
  assert.equal(snapshot.elapsed_ms, 800);
  const pausedSnapshot = structuredClone(snapshot);
  const started = Date.now();
  const resumed = await runWorkflowKernel(graph, { task: "deadline resume" }, {
    ...base,
    resume: snapshot,
    resume_events: paused.events.slice(0, snapshot.event_seq),
    effect_settlement_timeout_ms: 50,
    checkpoint: () => ({ continue: true }),
    async runGate() { return new Promise(() => {}); },
  });
  assert.equal(resumed.status, "failed");
  assert.equal(resumed.code, "kernel-boundary-outcome-unknown");
  assert.equal(resumed.events.some((event) => event.kind === "run-end"), false);
  assert.ok(Date.now() - started < 500);

  const legacy = structuredClone(pausedSnapshot);
  legacy.schema_version = 1;
  delete legacy.elapsed_ms;
  delete legacy.event_ref;
  delete legacy.active.inflight;
  const legacyResume = await runWorkflowKernel(graph, { task: "deadline resume" }, { ...base, resume: legacy });
  assert.equal(legacyResume.status, "refused");
  assert.equal(legacyResume.code, KERNEL_TEST_EXECUTION_MODE === "graph-mode"
    ? "kernel-checkpoint-invalid"
    : "kernel-checkpoint-events-unbound");
});

test("isolated proposals promote atomically, roll back, and refuse stale-base conflicts", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "helix-kernel-proposal-repo-"));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "helix@example.invalid"], { cwd });
  execFileSync("git", ["config", "user.name", "Helix Kernel Test"], { cwd });
  writeFileSync(join(cwd, "value.txt"), "base\n");
  execFileSync("git", ["add", "value.txt"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "base"], { cwd });
  const checkpoint = makePrivateCheckpointEffect(cwd);
  const workspace = createCanonicalWorkspace({ cwd, run_id: "proposal-run", checkpoint_effect: checkpoint });

  const promoted = await workspace.begin({ mode: "isolated-proposal" });
  assert.equal(promoted.ok, true);
  writeFileSync(join(promoted.cwd, "value.txt"), "promoted\n");
  assert.equal((await workspace.commit(promoted)).ok, true);
  assert.equal((await workspace.finalize(promoted)).ok, true);
  assert.equal(readFileSync(join(cwd, "value.txt"), "utf8"), "promoted\n");

  const rolledBack = await workspace.begin({ mode: "isolated-proposal" });
  writeFileSync(join(rolledBack.cwd, "value.txt"), "discarded\n");
  assert.equal((await workspace.rollback(rolledBack)).ok, true);
  assert.equal(readFileSync(join(cwd, "value.txt"), "utf8"), "promoted\n");

  const stale = await workspace.begin({ mode: "isolated-proposal" });
  writeFileSync(join(stale.cwd, "value.txt"), "stale\n");
  writeFileSync(join(cwd, "value.txt"), "concurrent\n");
  const refused = await workspace.commit(stale);
  assert.equal(refused.code, "kernel-proposal-conflict");
  assert.equal(readFileSync(join(cwd, "value.txt"), "utf8"), "concurrent\n");
  rmSync(cwd, { recursive: true, force: true });
});

test("proposal restore failure retains both the snapshot and proposal for recovery", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "helix-kernel-proposal-restore-"));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "helix@example.invalid"], { cwd });
  execFileSync("git", ["config", "user.name", "Helix Kernel Test"], { cwd });
  writeFileSync(join(cwd, "value.txt"), "base\n");
  execFileSync("git", ["add", "value.txt"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "base"], { cwd });
  let removals = 0;
  const checkpointEffect = {
    fingerprint: (path) => ({ ok: true, tree_ref: journalRef(readFileSync(join(path, "value.txt"), "utf8")) }),
    snapshot: (_run, generation) => ({ ok: true, generation, tree_ref: journalRef("base\n") }),
    restore: () => ({ ok: false, code: "synthetic-restore-failed" }),
    remove: () => { removals += 1; return { ok: true }; },
  };
  let promotion = false;
  const workspace = createCanonicalWorkspace({
    cwd, run_id: "proposal-restore", checkpoint_effect: checkpointEffect,
    sync_tree(source, destination) {
      if (destination !== cwd) return;
      promotion = true;
      writeFileSync(join(cwd, "value.txt"), readFileSync(join(source, "value.txt")));
      throw new Error("synthetic-promotion-failure");
    },
  });
  const tx = await workspace.begin({ mode: "isolated-proposal" });
  assert.equal(tx.ok, true);
  writeFileSync(join(tx.cwd, "value.txt"), "partial\n");
  const result = await workspace.commit(tx);
  assert.equal(result.code, "kernel-workspace-restore-failed");
  assert.equal(promotion, true);
  assert.equal(removals, 0);
  assert.equal(existsSync(tx.temp_root), true);
  execFileSync("git", ["worktree", "remove", "--force", tx.cwd], { cwd });
  rmSync(tx.temp_root, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

test("version-pinned subworkflow shares budgets and emits nested structural progress", async () => {
  const childBuilt = workflow({
    id: "child-flow", name: "Child", description: "Child workflow.", start: "work",
    nodes: {
      work: pipeline([reviewer()], "objective", { max_visits: 1 }),
      objective: objectiveGate("success", "failed"),
      success: terminal("succeeded"),
      failed: terminal("failed", "child-objective-failed"),
    },
    objective_gate: objective,
  });
  assert.equal(childBuilt.ok, true);
  const parent = definition({
    work: subworkflow("child-flow", 1, "objective"),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "parent-objective-failed"),
  });
  const result = await runWorkflowKernel(parent, { task: "nested" }, readOnlyDeps({
    depth: 0,
    resolveSubworkflow: (id, version) => id === "child-flow" && version === 1 ? childBuilt.definition : null,
  }));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.budget.effects, 1);
  assert.equal(result.events.some((event) => event.kind === "subworkflow-event" && event.child_kind === "run-end"), true);
});

test("subworkflows enforce both child-local and parent-shared effect ceilings on every visit", async () => {
  const child = workflow({
    id: "child-budget", name: "Child budget", description: "Child budget workflow.", start: "work",
    nodes: {
      work: pipeline([
        agent({ role: "reviewer", stage_id: "child-one", tools: [], mutation: "read-only" }),
        agent({ role: "reviewer", stage_id: "child-two", tools: [], mutation: "read-only" }),
      ], "objective", { max_visits: 1 }),
      objective: objectiveGate("success", "failed"),
      success: terminal("succeeded"),
      failed: terminal("failed", "child-failed"),
    },
    limits: { max_total_effects: 1 },
    objective_gate: objective,
  });
  assert.equal(child.ok, true, JSON.stringify(child.errors));
  const parent = definition({
    child: subworkflow("child-budget", 1, "objective"),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "parent-failed"),
  }, "child", { max_total_effects: 2 });
  let calls = 0;
  const childLimited = await runWorkflowKernel(parent, { task: "child local limit" }, readOnlyDeps({
    resolveSubworkflow: () => child.definition,
    async executeAgent() {
      calls += 1;
      return { ok: true, value: { recommendation: "approve" }, usage: { tokens: 1, cost_micros: 0 } };
    },
  }));
  assert.equal(childLimited.code, "kernel-budget-exhausted");
  assert.equal(calls, 1);
  assert.equal(childLimited.terminal, "child");
  assert.equal(childLimited.budget.effects, 1);
  assert.equal(childLimited.events.at(-1).kind, "run-end");

  const largerChild = structuredClone(child.definition);
  largerChild.limits.max_total_effects = 2;
  const smallerParent = definition({
    child: subworkflow("child-budget", 1, "objective"),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "parent-failed"),
  }, "child", { max_total_effects: 1 });
  calls = 0;
  const parentLimited = await runWorkflowKernel(smallerParent, { task: "parent shared limit" }, readOnlyDeps({
    resolveSubworkflow: () => largerChild,
    async executeAgent() {
      calls += 1;
      return { ok: true, value: { recommendation: "approve" }, usage: { tokens: 1, cost_micros: 0 } };
    },
  }));
  assert.equal(parentLimited.code, "kernel-budget-exhausted");
  assert.equal(calls, 1);

  const oneEffectChild = structuredClone(child.definition);
  oneEffectChild.nodes.work.stages = [oneEffectChild.nodes.work.stages[0]];
  const repeatedParent = definition({
    child: subworkflow("child-budget", 1, "route"),
    route: {
      ...decision([{
        when: { op: "eq", path: "/outputs/child/status", value: "succeeded" },
        target: "child", loop: true,
      }], "objective"),
      loops_off: "objective",
    },
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "parent-failed"),
  }, "child", { max_total_effects: 2 });
  calls = 0;
  const repeated = await runWorkflowKernel(repeatedParent, { task: "repeated child visits" }, readOnlyDeps({
    resolveSubworkflow: () => oneEffectChild,
    async executeAgent() {
      calls += 1;
      return { ok: true, value: { recommendation: "approve" }, usage: { tokens: 1, cost_micros: 0 } };
    },
  }));
  assert.equal(repeated.code, "kernel-budget-exhausted");
  assert.equal(calls, 2);
});

test("a paused child preserves its local effect allowance across parent continuation", async () => {
  const child = workflow({
    id: "child-budget-pause", name: "Child budget pause", description: "Child budget continuation.", start: "first",
    nodes: {
      first: agent({ role: "reviewer", stage_id: "first", tools: [], mutation: "read-only", next: "approval" }),
      approval: checkpoint("operator-approval", "second"),
      second: agent({ role: "reviewer", stage_id: "second", tools: [], mutation: "read-only", next: "objective" }),
      objective: objectiveGate("success", "failed"),
      success: terminal("succeeded"),
      failed: terminal("failed", "child-failed"),
    },
    limits: { max_total_effects: 2 },
    objective_gate: objective,
  });
  assert.equal(child.ok, true, JSON.stringify(child.errors));
  const parent = definition({
    child: subworkflow("child-budget-pause", 1, "objective"),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "parent-failed"),
  }, "child", { max_total_effects: 3 });
  const workspaceRef = journalRef("child-budget-workspace");
  const journal = createEffectJournal();
  let snapshot = null;
  let calls = 0;
  const deps = readOnlyDeps({
    task_ref: journalRef("child-budget-task"),
    runtime_ref: journalRef("child-budget-runtime"),
    journal,
    workspace: { cwd: "/tmp/mock", currentRef: () => workspaceRef, verifyRef: () => true },
    resolveSubworkflow: () => child.definition,
    async executeAgent() {
      calls += 1;
      return { ok: true, value: { recommendation: "approve" }, usage: { tokens: 1, cost_micros: 1 } };
    },
    async onCheckpoint(state) { snapshot = structuredClone(state); return { ok: true }; },
  });
  const paused = await runWorkflowKernel(parent, { task: "child budget pause" }, {
    ...deps,
    checkpoint: () => ({ continue: false }),
  });
  assert.equal(paused.status, "paused");
  assert.equal(calls, 1);
  assert.equal(snapshot.active.child.scheduler.budget.effects, 1);
  assert.equal(snapshot.active.child.scheduler.budget.tokens, 1);
  assert.equal(snapshot.active.child.scheduler.budget.cost_micros, 1);
  assert.equal(snapshot.active.child.scheduler.budget.max_effects, 2);
  const resumeEvents = paused.events.slice(0, snapshot.event_seq);
  const resetParentBudget = structuredClone(snapshot);
  resetParentBudget.budget.effects = 0;
  resetParentBudget.budget.tokens = 0;
  resetParentBudget.budget.cost_micros = 0;
  const inconsistent = await runWorkflowKernel(parent, { task: "child budget pause" }, {
    ...deps,
    resume: resetParentBudget,
    resume_events: resumeEvents,
    checkpoint: () => ({ continue: true }),
  });
  assert.equal(inconsistent.ok, false);
  assert.equal(inconsistent.code, "kernel-checkpoint-child-invalid");
  assert.equal(calls, 1);
  const resetAllBudgets = structuredClone(snapshot);
  for (const budget of [resetAllBudgets.budget, resetAllBudgets.active.child.scheduler.budget]) {
    budget.effects = 0;
    budget.tokens = 0;
    budget.cost_micros = 0;
  }
  const journalInconsistent = await runWorkflowKernel(parent, { task: "child budget pause" }, {
    ...deps,
    resume: resetAllBudgets,
    resume_events: resumeEvents,
    checkpoint: () => ({ continue: true }),
  });
  assert.equal(journalInconsistent.ok, false);
  assert.equal(journalInconsistent.code, "kernel-checkpoint-budget-invalid");
  assert.equal(calls, 1);
  const resumed = await runWorkflowKernel(parent, { task: "child budget pause" }, {
    ...deps,
    resume: snapshot,
    resume_events: resumeEvents,
    checkpoint: () => ({ continue: true }),
  });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(calls, 2);
  assert.equal(resumed.budget.effects, 2);
  assert.equal(resumed.budget.tokens, 2);
  assert.equal(resumed.budget.cost_micros, 2);
});

test("a namespaced child checkpoint advances exactly once on parent resume", async () => {
  const child = workflow({
    id: "child-checkpoint", name: "Child checkpoint", description: "Child checkpoint workflow.", start: "approval",
    nodes: {
      approval: checkpoint("operator-approval", "objective"),
      objective: objectiveGate("success", "failed"),
      success: terminal("succeeded"),
      failed: terminal("failed", "child-failed"),
    },
    objective_gate: objective,
  });
  assert.equal(child.ok, true, JSON.stringify(child.errors));
  const parent = definition({
    child: subworkflow("child-checkpoint", 1, "objective"),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "parent-failed"),
  }, "child");
  const workspaceRef = journalRef("child-workspace");
  const taskRef = journalRef("child-task");
  const runtimeRef = journalRef("child-runtime");
  let snapshot = null;
  const base = readOnlyDeps({
    task_ref: taskRef,
    runtime_ref: runtimeRef,
    workspace: { cwd: "/tmp/mock", currentRef: () => workspaceRef, verifyRef: () => true },
    resolveSubworkflow: () => child.definition,
    async onCheckpoint(state) { snapshot = structuredClone(state); return { ok: true }; },
  });
  const paused = await runWorkflowKernel(parent, { task: "child pause" }, {
    ...base,
    checkpoint: () => ({ continue: false }),
  });
  assert.equal(paused.status, "paused");
  assert.equal(snapshot.active.child.scheduler.current, "approval");
  const resumeEvents = paused.events.slice(0, snapshot.event_seq);
  const nestedBindingDrift = structuredClone(snapshot);
  nestedBindingDrift.active.child.run_id = "run-1.child.2";
  nestedBindingDrift.active.child.scheduler.run_id = "run-1.child.2";
  const bindingRefusal = await runWorkflowKernel(parent, { task: "child pause" }, {
    ...base,
    resume: nestedBindingDrift,
    resume_events: resumeEvents,
    checkpoint: () => ({ continue: true }),
  });
  assert.equal(bindingRefusal.code, "kernel-checkpoint-events-invalid");
  const nestedDrift = structuredClone(snapshot);
  nestedDrift.active.child.scheduler.budget.max_effects = 0;
  const nestedRefusal = await runWorkflowKernel(parent, { task: "child pause" }, {
    ...base,
    resume: nestedDrift,
    resume_events: resumeEvents,
    checkpoint: () => ({ continue: true }),
  });
  assert.equal(nestedRefusal.code, "kernel-checkpoint-child-invalid");
  const resumed = await runWorkflowKernel(parent, { task: "child pause" }, {
    ...base,
    resume: snapshot,
    resume_events: resumeEvents,
    checkpoint: ({ node_id, child_run_id }) => ({
      continue: child_run_id === "run-1.child.1" && node_id === "approval",
    }),
  });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(resumed.budget.effects, 0);
});

test("a resumed parent retains its checkpoint-bound successful child terminal", async () => {
  for (const executionMode of ["original-mode", "graph-mode"]) {
    const childBuilt = workflow({
      id: `terminal-child-${executionMode}`,
      name: "Terminal child",
      description: "Child terminal evidence survives its parent continuation.",
      start: "objective",
      nodes: {
        objective: objectiveGate("success", "failed"),
        success: terminal("succeeded"),
        failed: terminal("failed", "child-failed"),
      },
      objective_gate: objective,
    });
    assert.equal(childBuilt.ok, true, JSON.stringify(childBuilt.errors));
    const parent = definition({
      child: subworkflow(childBuilt.definition.id, 1, "objective"),
      objective: objectiveGate("success", "failed"),
      success: terminal("succeeded"),
      failed: terminal("failed", "parent-failed"),
    }, "child");
    const workspaceRef = journalRef(`terminal-child-workspace-${executionMode}`);
    const firstEvents = [];
    let durable = null;
    let failedTransition = false;
    const deps = readOnlyDeps({
      run_id: `terminal-child-parent-${executionMode}`,
      execution_mode: executionMode,
      runtime_ref: journalRef(`terminal-child-runtime-${executionMode}`),
      task_ref: journalRef(`terminal-child-task-${executionMode}`),
      workspace: { cwd: "/tmp/mock", currentRef: () => workspaceRef, verifyRef: () => true },
      resolveSubworkflow: () => childBuilt.definition,
      onEvent: (event) => firstEvents.push(structuredClone(event)),
      async onCheckpoint(snapshot) {
        if (!failedTransition && snapshot.current === "objective" && snapshot.active === null
          && snapshot.terminal_result == null) {
          failedTransition = true;
          return { ok: false, code: "kernel-checkpoint-write-failed" };
        }
        durable = structuredClone(snapshot);
        return { ok: true };
      },
    });
    const interrupted = await runWorkflowKernel(parent, { task: "retain child terminal evidence" }, deps);
    assert.equal(interrupted.code, "kernel-checkpoint-write-failed", executionMode);
    assert.equal(durable.active?.child?.scheduler?.terminal_result?.status, "succeeded", executionMode);
    const prefix = firstEvents.filter((event) => event.seq <= durable.event_seq);
    assert.equal(prefix.at(-1)?.kind, "subworkflow-event", executionMode);
    assert.equal(prefix.at(-1)?.child_kind, "run-end", executionMode);
    assert.equal(prefix.at(-1)?.child_status, "succeeded", executionMode);
    const resumedEvents = [];
    const resumed = await runWorkflowKernel(parent, { task: "retain child terminal evidence" }, {
      ...deps,
      resume: durable,
      resume_events: prefix,
      onEvent: (event) => resumedEvents.push(structuredClone(event)),
      onCheckpoint: async () => ({ ok: true }),
    });
    assert.equal(resumed.ok, true, JSON.stringify(resumed));
    assert.equal(observedWorkflowGraph(parent, [...prefix, ...resumedEvents], {
      execution_mode: executionMode,
      subworkflows: [childBuilt.definition],
    }).ok, true, executionMode);
  }
});

test("a resumed active child terminal re-arbitrates parent cancellation before publication", async () => {
  for (const executionMode of ["original-mode", "graph-mode"]) {
    const childBuilt = workflow({
      id: `active-terminal-child-${executionMode}`,
      name: "Active terminal child",
      description: "A continuing child terminal observes parent cancellation.",
      start: "objective",
      nodes: {
        objective: objectiveGate("success", "failed"),
        success: terminal("succeeded"),
        failed: terminal("failed", "child-failed"),
      },
      objective_gate: objective,
    });
    assert.equal(childBuilt.ok, true, JSON.stringify(childBuilt.errors));
    const parent = definition({
      child: subworkflow(childBuilt.definition.id, 1, "objective"),
      objective: objectiveGate("success", "failed"),
      success: terminal("succeeded"),
      failed: terminal("failed", "parent-failed"),
    }, "child");
    const runId = `active-terminal-child-parent-${executionMode}`;
    const workspaceRef = journalRef(`${runId}-workspace`);
    const checkpoints = [];
    let failChildEnd = true;
    const base = readOnlyDeps({
      run_id: runId,
      execution_mode: executionMode,
      runtime_ref: journalRef(`${runId}-runtime`),
      task_ref: journalRef(`${runId}-task`),
      workspace: { cwd: "/tmp/mock", currentRef: () => workspaceRef, verifyRef: () => true },
      resolveSubworkflow: () => childBuilt.definition,
      async onCheckpoint(snapshot) {
        checkpoints.push(structuredClone(snapshot));
        return { ok: true };
      },
      onEvent(event) {
        if (failChildEnd && event.kind === "subworkflow-event"
          && event.child_kind === "node-end" && event.child_node_id === "success") {
          failChildEnd = false;
          throw new Error("synthetic-child-terminal-event-failure");
        }
      },
    });
    const first = await runWorkflowKernel(parent, { task: "cancel the resumed child terminal" }, base);
    const activeChild = checkpoints.findLast((snapshot) =>
      snapshot.active?.child?.scheduler?.current === "success"
      && snapshot.active.child.scheduler.active?.node_id === "success"
      && snapshot.active.child.scheduler.terminal_result == null);
    assert.equal(first.code, "kernel-event-write-failed", executionMode);
    assert.ok(activeChild, executionMode);
    const controller = new AbortController();
    const resumedCheckpoints = [];
    const resumed = await runWorkflowKernel(parent, { task: "cancel the resumed child terminal" }, {
      ...base,
      signal: controller.signal,
      resume: activeChild,
      resume_events: first.events.slice(0, activeChild.event_seq),
      async onCheckpoint(snapshot) {
        resumedCheckpoints.push(structuredClone(snapshot));
        return { ok: true };
      },
      onEvent(event) {
        if (event.kind === "subworkflow-event"
          && event.child_kind === "node-start" && event.child_node_id === "success") {
          controller.abort("operator-cancelled");
        }
      },
    });
    assert.equal(resumed.status, "cancelled", executionMode);
    assert.equal(resumed.code, "kernel-run-cancelled", executionMode);
    assert.equal(resumed.events.some((event) =>
      event.kind === "subworkflow-event" && event.child_kind === "run-end"
      && event.child_status === "succeeded"), false, executionMode);
    assert.deepEqual(resumedCheckpoints.at(-1).terminal_result, {
      status: "cancelled",
      code: "kernel-run-cancelled",
    }, executionMode);
  }
});

test("a child journal-ahead result reconciles through the parent checkpoint without replay", async () => {
  const child = workflow({
    id: "child-journal-ahead", name: "Child journal ahead", description: "Child recovery workflow.", start: "work",
    nodes: {
      work: pipeline([reviewer()], "objective", { max_visits: 1 }),
      objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "child-failed"),
    },
    objective_gate: objective,
  });
  assert.equal(child.ok, true, JSON.stringify(child.errors));
  const parent = definition({
    child: subworkflow("child-journal-ahead", 1, "objective"),
    objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "parent-failed"),
  }, "child", { max_total_effects: 1 });
  const workspaceRef = journalRef("child-ahead-workspace");
  const journal = createEffectJournal({ verify_workspace: () => true });
  let snapshot = null;
  let failed = false;
  let calls = 0;
  const deps = readOnlyDeps({
    task_ref: journalRef("child-ahead-task"), runtime_ref: journalRef("child-ahead-runtime"), journal,
    workspace: { cwd: "/tmp/mock", currentRef: () => workspaceRef, verifyRef: () => true },
    resolveSubworkflow: () => child.definition,
    async executeAgent() { calls += 1; return { ok: true, value: { recommendation: "approve" } }; },
    async onCheckpoint(state) {
      if (!failed && state.active?.child?.scheduler?.journal_entries === 1) {
        failed = true;
        return { ok: false, code: "kernel-checkpoint-write-failed" };
      }
      snapshot = structuredClone(state);
      return { ok: true };
    },
  });
  const interrupted = await runWorkflowKernel(parent, { task: "child ahead" }, deps);
  assert.equal(interrupted.code, "kernel-checkpoint-write-failed");
  assert.equal(calls, 1);
  assert.equal(journal.records().length, 1);
  const resumed = await runWorkflowKernel(parent, { task: "child ahead" }, {
    ...deps,
    resume: snapshot,
    resume_events: interrupted.events.slice(0, snapshot.event_seq),
  });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(calls, 1);
});

test("journal-ahead results cannot move between parent and child run namespaces", async () => {
  const child = workflow({
    id: "colliding-child", name: "Colliding child", description: "Child with a colliding node name.", start: "work",
    nodes: {
      work: pipeline([reviewer()], "objective", { max_visits: 1 }),
      objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "child-failed"),
    },
    objective_gate: objective,
  });
  assert.equal(child.ok, true, JSON.stringify(child.errors));
  const parent = definition({
    child: subworkflow("colliding-child", 1, "work"),
    work: pipeline([reviewer()], "objective", { max_visits: 1 }),
    objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "parent-failed"),
  }, "child", { max_total_effects: 2 });
  const workspaceRef = journalRef("cross-level-workspace");
  const journal = createEffectJournal({ verify_workspace: () => true });
  let durable = null;
  let failed = false;
  let calls = 0;
  const deps = readOnlyDeps({
    task_ref: journalRef("cross-level-task"), runtime_ref: journalRef("cross-level-runtime"), journal,
    workspace: { cwd: "/tmp/mock", currentRef: () => workspaceRef, verifyRef: () => true },
    resolveSubworkflow: () => child.definition,
    async executeAgent(_node, ctx) {
      calls += 1;
      return {
        ok: true,
        value: { recommendation: "approve", run_id: ctx.run_id },
        usage: { tokens: 1, cost_micros: 1 },
      };
    },
    async onCheckpoint(state) {
      const childActive = state.active?.child?.scheduler?.active;
      const resultPending = Object.values(childActive?.completed ?? {}).some((entry) => entry._journal_pending);
      if (!failed && resultPending) {
        failed = true;
        return { ok: false, code: "kernel-checkpoint-write-failed" };
      }
      durable = structuredClone(state);
      return { ok: true };
    },
  });
  const interrupted = await runWorkflowKernel(parent, { task: "bind cross-level result" }, deps);
  assert.equal(interrupted.code, "kernel-checkpoint-write-failed");
  assert.equal(calls, 1);
  assert.equal(journal.records().length, 1);
  assert.equal(journal.records()[0].run_id, "run-1.child.1");
  assert.equal(Object.keys(durable.active.child.scheduler.active.inflight).length, 1);

  const forged = structuredClone(durable);
  const childScheduler = forged.active.child.scheduler;
  forged.current = "work";
  forged.visits.work = childScheduler.visits.work;
  forged.active = structuredClone(childScheduler.active);
  forged.journal_entries = 0;
  const refused = await runWorkflowKernel(parent, { task: "bind cross-level result" }, {
    ...deps,
    resume: forged,
    resume_events: interrupted.events.slice(0, forged.event_seq),
    async onCheckpoint() { return { ok: true }; },
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "kernel-checkpoint-journal-invalid");
  assert.equal(calls, 1);

  const resumed = await runWorkflowKernel(parent, { task: "bind cross-level result" }, {
    ...deps,
    resume: durable,
    resume_events: interrupted.events.slice(0, durable.event_seq),
  });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(calls, 2);
  assert.equal(resumed.outputs.work.values[0].run_id, "run-1");
  assert.equal(resumed.budget.effects, 2);
  assert.equal(resumed.budget.tokens, 2);
  assert.equal(resumed.budget.cost_micros, 2);
});

test("workspace fingerprint exceptions return a stable kernel failure", async () => {
  const graph = definition({
    work: pipeline([reviewer()], "objective", { max_visits: 1 }),
    objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "objective-failed"),
  });
  const result = await runWorkflowKernel(graph, { task: "fingerprint" }, readOnlyDeps({
    workspace: { currentRef() { throw new Error("filesystem failure"); } },
  }));
  assert.equal(result.code, "kernel-workspace-ref-invalid");
});

test("host callback exceptions return structured kernel failures and preserve workspace rollback", async () => {
  const mutating = definition({
    work: { ...builder(), next: "objective", max_visits: 1 },
    objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "objective-failed"),
  });
  const workspaceRef = journalRef("host-callback-workspace");
  let rollbacks = 0;
  const eventFailure = await runWorkflowKernel(mutating, { task: "event failure" }, readOnlyDeps({
    workspace: {
      cwd: "/tmp/mock", currentRef: () => workspaceRef, verifyRef: () => true,
      async begin() { return { ok: true, mode: "shared-serialized", cwd: "/tmp/mock", generation: "effect-1", tree_ref: workspaceRef, before_ref: workspaceRef }; },
      async commit() { return { ok: true, workspace_ref: workspaceRef }; },
      async rollback() { rollbacks += 1; return { ok: true }; },
      serialize() { return { generation: "effect-1" }; },
      async finalize() { return { ok: true }; },
    },
    onEvent(event) { if (event.kind === "effect-start") throw new Error("event sink failed"); },
  }));
  assert.equal(eventFailure.status, "failed");
  assert.equal(eventFailure.code, "kernel-event-write-failed");
  assert.equal(rollbacks, 1);

  const artifactGraph = definition({
    work: pipeline([reviewer()], "objective", { max_visits: 1, artifact: { path: "proposal.txt", kind: "notes" } }),
    objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "objective-failed"),
  });
  const artifactFailure = await runWorkflowKernel(artifactGraph, { task: "artifact callback" }, readOnlyDeps({
    async verifyArtifact() { throw new Error("artifact host failed"); },
  }));
  assert.equal(artifactFailure.code, "kernel-artifact-verification-failed");

  const declaredArtifact = { path: "proposal.txt", kind: "notes" };
  const detachedArtifactGraph = definition({
    work: { ...reviewer(), next: "objective", max_visits: 1, artifact: declaredArtifact },
    objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "objective-failed"),
  });
  let callbackArtifact = null;
  const detachedArtifact = await runWorkflowKernel(detachedArtifactGraph, { task: "detached artifact callback" }, readOnlyDeps({
    async executeAgent(_node, ctx) {
      callbackArtifact = ctx.artifact;
      ctx.artifact.path = "adapter-local.txt";
      return { ok: true, value: { recommendation: "approve" }, usage: { tokens: 1, cost_micros: 0 } };
    },
    async verifyArtifact() { return { ok: true, ref: journalRef("detached-artifact") }; },
  }));
  assert.equal(detachedArtifact.ok, true);
  assert.equal(callbackArtifact.path, "adapter-local.txt");
  assert.equal(detachedArtifactGraph.nodes.work.artifact.path, "proposal.txt");

  const checkpointGraph = definition({
    approval: checkpoint("operator-approval", "objective"),
    objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "objective-failed"),
  }, "approval");
  const checkpointFailure = await runWorkflowKernel(checkpointGraph, { task: "checkpoint callback" }, readOnlyDeps({
    checkpoint() { throw new Error("checkpoint host failed"); },
  }));
  assert.equal(checkpointFailure.code, "kernel-checkpoint-effect-failed");

  const childGraph = definition({
    child: subworkflow("child-flow", 1, "objective"),
    objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "objective-failed"),
  }, "child");
  const childFailure = await runWorkflowKernel(childGraph, { task: "child callback" }, readOnlyDeps({
    depth: 0,
    resolveSubworkflow() { throw new Error("resolver failed"); },
  }));
  assert.equal(childFailure.code, "kernel-subworkflow-resolution-failed");

  const started = Date.now();
  const runStartFailure = await runWorkflowKernel(checkpointGraph, { task: "run start callback" }, readOnlyDeps({
    onEvent(event) { if (event.kind === "run-start") throw new Error("start event failed"); },
  }));
  assert.equal(runStartFailure.code, "kernel-event-write-failed");
  assert.ok(Date.now() - started < 500, "run-start failure must clear the whole-run timer");

  const initialClockFailure = await runWorkflowKernel(checkpointGraph, { task: "initial clock callback" }, readOnlyDeps({
    now() { throw new Error("clock failed"); },
  }));
  assert.equal(initialClockFailure.code, "kernel-clock-failed");
  let clockReads = 0;
  const laterClockFailure = await runWorkflowKernel(checkpointGraph, { task: "later clock callback" }, readOnlyDeps({
    now() { clockReads += 1; if (clockReads > 1) throw new Error("clock failed later"); return 1; },
  }));
  assert.equal(laterClockFailure.code, "kernel-clock-failed");
});

test("an effect-start event failure never invokes the provider and retries truthfully from its checkpoint", async () => {
  const graph = definition({
    work: pipeline([reviewer()], "objective", { max_visits: 1 }),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  });
  const workspaceRef = journalRef("effect-start-event-workspace");
  const journal = createEffectJournal({ verify_workspace: () => true });
  let durable = null;
  let calls = 0;
  let failed = false;
  const deps = readOnlyDeps({
    task_ref: journalRef("effect-start-event-task"),
    runtime_ref: journalRef("effect-start-event-runtime"),
    workspace: { currentRef: () => workspaceRef, verifyRef: () => true },
    journal,
    async executeAgent() {
      calls += 1;
      return { ok: true, value: { recommendation: "approve" }, usage: { tokens: 1, cost_micros: 0 } };
    },
    async onCheckpoint(snapshot) {
      durable = structuredClone(snapshot);
      return { ok: true };
    },
    onEvent(event) {
      if (!failed && event.kind === "effect-start") {
        failed = true;
        throw new Error("effect-start event failed");
      }
    },
  });
  const interrupted = await runWorkflowKernel(graph, { task: "do not invoke after failed start evidence" }, deps);
  assert.equal(interrupted.code, "kernel-event-write-failed");
  assert.equal(calls, 0);
  assert.ok(durable);

  const resumed = await runWorkflowKernel(graph, { task: "do not invoke after failed start evidence" }, {
    ...deps, ...authenticatedResume(interrupted, durable),
  });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(calls, 1);
  assert.equal(resumed.budget.effects, 2, "the failed durable intent and retried provider call are both lifetime effects");
});

for (const eventBarrier of ["gate", "intermediate-node-end", "transition", "terminal-node-end", "run-end"]) {
  test(`a failed ${eventBarrier} event barrier cannot publish a terminal checkpoint`, async () => {
    const graph = definition({
      approval: checkpoint("operator-approval", "objective"),
      objective: objectiveGate("success", "failed"),
      success: terminal("succeeded"),
      failed: terminal("failed", "objective-failed"),
    }, "approval");
    const workspaceRef = journalRef(`event-barrier-workspace-${eventBarrier}`);
    const journal = createEffectJournal({ verify_workspace: () => true });
    let durable = null;
    let failed = false;
    const isTarget = (event) => event.kind === eventBarrier
      || (eventBarrier === "intermediate-node-end" && event.kind === "node-end" && event.node_id === "approval")
      || (eventBarrier === "terminal-node-end" && event.kind === "node-end" && event.node_id === "success");
    const deps = readOnlyDeps({
      task_ref: journalRef(`event-barrier-task-${eventBarrier}`),
      runtime_ref: journalRef(`event-barrier-runtime-${eventBarrier}`),
      workspace: { currentRef: () => workspaceRef, verifyRef: () => true },
      journal,
      checkpoint: async () => ({ continue: true }),
      async onCheckpoint(snapshot) {
        durable = structuredClone(snapshot);
        return { ok: true };
      },
      onEvent(event) {
        if (!failed && isTarget(event)) {
          failed = true;
          throw new Error("event barrier failed");
        }
      },
    });

    const interrupted = await runWorkflowKernel(graph, { task: `fail ${eventBarrier}` }, deps);
    assert.equal(interrupted.ok, false);
    assert.equal(interrupted.code, "kernel-event-write-failed");
    assert.ok(durable);
    assert.equal(Object.hasOwn(durable, "terminal_result"), false);

    const resumed = await runWorkflowKernel(graph, { task: `fail ${eventBarrier}` }, {
      ...deps, ...authenticatedResume(interrupted, durable),
    });
    assert.equal(resumed.ok, true, JSON.stringify(resumed));
    assert.equal(resumed.status, "succeeded");
    assert.equal(resumed.events.at(-1).kind, "run-end");
    assert.deepEqual(resumed.events.at(-1), {
      schema_version: 1,
      seq: resumed.events.at(-1).seq,
      run_id: "run-1",
      kind: "run-end",
      node_id: "success",
      status: "succeeded",
    });
  });
}
