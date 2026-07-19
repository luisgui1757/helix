import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { agent, checkpoint, decision, map, objectiveGate, parallel, pipeline, reduce, subworkflow, terminal, workflow } from "../dispatch/workflow/builder.mjs";
import { createEffectJournal, journalRef } from "../dispatch/kernel/journal.mjs";
import { runWorkflowKernel } from "../dispatch/kernel/scheduler.mjs";
import { kernelResultIsComplete } from "../dispatch/kernel/state.mjs";
import { createCanonicalWorkspace } from "../dispatch/kernel/workspace.mjs";
import { makePrivateCheckpointEffect } from "../dispatch/lib/runner.mjs";

const objective = { type: "file-contains", path: "proposal.txt", contains: "PASS" };
const reviewer = () => agent({ role: "reviewer", stage_id: "review", output_schema: "verdict-v1", mutation: "read-only", timeout_ms: 1_000 });
const builder = () => agent({ role: "builder", stage_id: "build", mutation: "shared-serialized", timeout_ms: 1_000 });

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

test("a resumed succeeded terminal refuses without recorded final-gate pass evidence", async () => {
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
    resume: forged,
    async runGate() {
      gateCalls += 1;
      return { result: "pass" };
    },
  });
  assert.equal(resumed.ok, false);
  assert.equal(resumed.status, "refused");
  assert.equal(resumed.code, "kernel-objective-gate-evidence-missing");
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
  const deps = readOnlyDeps({ async executeAgent() { calls += 1; return { ok: true, value: { recommendation: "revise" }, usage: { tokens: 1 } }; } });
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
  assert.deepEqual(result.outputs.work.map((entry) => entry.value), Array.from({ length: 6 }, (_, i) => `work:${i}:attempt-1`));
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
    resume: checkpoint,
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
  const graph = definition({
    work: parallel([builder(), builder()], "objective", { max_concurrency: 2 }),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  });
  const workspace = {
    cwd: "/tmp/mock",
    currentRef: () => journalRef({ generation }),
    async begin() { return { ok: true, before_ref: journalRef({ generation }), cwd: "/tmp/mock" }; },
    async commit() { generation += 1; const ref = journalRef({ generation }); refs.add(ref); return { ok: true, workspace_ref: ref }; },
    async rollback() {},
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
    async begin() { return { ok: true, mode: "shared-serialized", cwd: "/tmp/mock", generation: "effect-1", tree_ref: journalRef("before") }; },
    async commit() { return { ok: true, workspace_ref: journalRef("after") }; },
    async rollback() { rolledBack += 1; return { ok: true }; },
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
      identity: journalRef("identity"), node_id: "work", instance_id: "work:1",
      input_ref: ref, runtime_ref: ref, before_ref: ref, mutating: false,
      status: "ok", result: { status: "ok", value: "done" },
    }).ok, true);
    assert.equal(createEffectJournal({ root, run_id: "unicode-run", expected_records: 1 }).records().length, 1);
    const journalPath = join(root, "unicode-run.kernel.journal.jsonl");
    const record = JSON.parse(readFileSync(journalPath, "utf8"));
    record.result.value = "corrupted";
    writeFileSync(journalPath, `${JSON.stringify(record)}\n`, "utf8");
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
  assert.equal((await runWorkflowKernel(graph, { task: "exact suffix" }, deps)).code, "kernel-checkpoint-write-failed");
  const ref = journalRef("foreign-record");
  assert.equal(journal.commit({
    identity: journalRef("foreign-identity"), node_id: "foreign", instance_id: "foreign:1",
    input_ref: ref, runtime_ref: ref, before_ref: ref, mutating: false,
    status: "ok", result: { status: "ok", value: "foreign" },
  }).ok, true);
  const resumed = await runWorkflowKernel(graph, { task: "exact suffix" }, { ...deps, resume: checkpoint });
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
    const resumed = await runWorkflowKernel(graph, { task: "bounded result" }, { ...deps, resume: checkpoint });
    assert.equal(resumed.code, "kernel-agent-result-invalid");
    assert.equal(calls, 1);
  }
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
    resume: checkpoint,
    async executeAgent() { calls += 1; return { ok: true, value: { recommendation: "approve" } }; },
    async onCheckpoint() { return { ok: true }; },
  }));
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(calls, 1);
  assert.equal(resumed.events.some((event) => event.kind === "effect-resumed"), true);
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
    async executeAgent() { calls += 1; return { ok: true, value: { recommendation: "approve" } }; },
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
  const resumed = await runWorkflowKernel(graph, { task: "result checkpoint" }, { ...deps, resume: checkpoint });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(calls, 1);
  assert.equal(resumed.budget.effects, 1);
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
  const resumed = await runWorkflowKernel(graph, { task: "heal journal" }, { ...deps, resume: checkpoint });
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
    async executeAgent() { calls += 1; return { ok: true, value: { recommendation: "approve" } }; },
    async onCheckpoint(state) { checkpoint = structuredClone(state); return { ok: true }; },
  });
  const interrupted = await runWorkflowKernel(graph, { task: "retry workspace" }, deps);
  assert.equal(interrupted.code, "kernel-workspace-commit-failed");
  const resumed = await runWorkflowKernel(graph, { task: "retry workspace" }, { ...deps, resume: checkpoint });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(calls, 2);
  assert.equal(resumed.budget.effects, 2);
  assert.equal(journal.records().length, 2);
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
  const resumed = await runWorkflowKernel(graph, { task: "finalize" }, { ...deps, resume: checkpoint });
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

test("the scheduler hard deadline bounds a non-cooperative objective gate", async () => {
  const graph = definition({
    work: pipeline([reviewer()], "objective", { max_visits: 1 }),
    objective: objectiveGate("success", "failed"),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  }, "work", { max_run_ms: 1_000 });
  const started = Date.now();
  const result = await runWorkflowKernel(graph, { task: "deadline" }, readOnlyDeps({
    async runGate() { return new Promise(() => {}); },
  }));
  assert.equal(result.status, "cancelled");
  assert.equal(result.code, "kernel-run-cancelled");
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
  const started = Date.now();
  const resumed = await runWorkflowKernel(graph, { task: "deadline resume" }, {
    ...base,
    resume: snapshot,
    checkpoint: () => ({ continue: true }),
    async runGate() { return new Promise(() => {}); },
  });
  assert.equal(resumed.status, "cancelled");
  assert.ok(Date.now() - started < 500);
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
  const resumed = await runWorkflowKernel(parent, { task: "child pause" }, {
    ...base,
    resume: snapshot,
    checkpoint: ({ node_id, child_run_id }) => ({
      continue: child_run_id === "run-1.child" && node_id === "approval",
    }),
  });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(resumed.budget.effects, 0);
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
  const resumed = await runWorkflowKernel(parent, { task: "child ahead" }, { ...deps, resume: snapshot });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(calls, 1);
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
