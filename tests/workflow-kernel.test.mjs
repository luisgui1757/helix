import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { agent, checkpoint, decision, map, objectiveGate, parallel, pipeline, reduce, subworkflow, terminal, workflow } from "../dispatch/workflow/builder.mjs";
import { createEffectJournal, journalRef } from "../dispatch/kernel/journal.mjs";
import { createBudgetLedger } from "../dispatch/kernel/budgets.mjs";
import { runWorkflowKernel } from "../dispatch/kernel/scheduler.mjs";
import { KERNEL_CHECKPOINT_LIMITS, kernelResultIsComplete } from "../dispatch/kernel/state.mjs";
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
  const callsBeforeResume = calls;
  const resumed = await runWorkflowKernel(graph, { task: "aggregate capacity" }, { ...deps, journal: reopened, resume: checkpoint });
  assert.equal(resumed.code, "kernel-result-capacity-exceeded");
  assert.equal(calls, callsBeforeResume, "continuation reuses the bounded failure without another provider call");
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
  const resumed = await runWorkflowKernel(graph, { task: "result checkpoint" }, { ...deps, resume: checkpoint });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(calls, 1);
  assert.equal(resumed.budget.effects, 1);
  assert.equal(resumed.budget.tokens, 9);
  assert.equal(resumed.budget.cost_micros, 4);
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
    resume: swapped,
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
    async executeAgent() { calls += 1; return { ok: true, value: { recommendation: "approve" }, usage: { tokens: 5, cost_micros: 2 } }; },
    async onCheckpoint(state) { checkpoint = structuredClone(state); return { ok: true }; },
  });
  const interrupted = await runWorkflowKernel(graph, { task: "retry workspace" }, deps);
  assert.equal(interrupted.code, "kernel-workspace-commit-failed");
  const resumed = await runWorkflowKernel(graph, { task: "retry workspace" }, { ...deps, resume: checkpoint });
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
  assert.equal((await runWorkflowKernel(graph, { task: "bind budgets" }, deps)).status, "paused");
  for (const drift of [{ max_tokens: null, max_cost_micros: 20 }, { max_tokens: 10, max_cost_micros: null }, { max_tokens: 11, max_cost_micros: 20 }]) {
    const refused = await runWorkflowKernel(graph, { task: "bind budgets" }, {
      ...deps, ...drift, resume: snapshot, checkpoint: () => ({ continue: true }),
    });
    assert.equal(refused.code, "kernel-budget-binding-drift");
  }
  assert.equal(calls, 0);
  const resumed = await runWorkflowKernel(graph, { task: "bind budgets" }, {
    ...deps, resume: snapshot, checkpoint: () => ({ continue: true }),
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
  const injectedDrift = await runWorkflowKernel(graph, { task: "bind injected budget" }, {
    ...deps,
    resume: snapshot,
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
  assert.equal((await runWorkflowKernel(graph, { task: "checkpoint integrity" }, deps)).code, "synthetic-stop-before-effect");
  const forged = structuredClone(preEffect);
  forged.active.completed["work:1:0:attempt-1"] = {
    status: "ok", value: { recommendation: "approve" }, usage: { tokens: 0, cost_micros: 0 }, attestation_ref: null,
  };
  const forgedResult = await runWorkflowKernel(graph, { task: "checkpoint integrity" }, {
    ...deps, journal: createEffectJournal({ verify_workspace: () => true }), resume: forged, onCheckpoint: async () => ({ ok: true }),
  });
  assert.equal(forgedResult.code, "kernel-checkpoint-journal-invalid");
  const visitDrift = structuredClone(preEffect);
  visitDrift.active.visit += 1;
  const driftResult = await runWorkflowKernel(graph, { task: "checkpoint integrity" }, {
    ...deps, journal: createEffectJournal({ verify_workspace: () => true }), resume: visitDrift, onCheckpoint: async () => ({ ok: true }),
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
  assert.equal(result.status, "failed");
  assert.equal(result.code, "kernel-run-deadline-exceeded");
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
  assert.equal(resumed.status, "failed");
  assert.equal(resumed.code, "kernel-run-deadline-exceeded");
  assert.ok(Date.now() - started < 500);

  const legacy = structuredClone(snapshot);
  legacy.schema_version = 1;
  delete legacy.elapsed_ms;
  delete legacy.active.inflight;
  const legacyResume = await runWorkflowKernel(graph, { task: "deadline resume" }, { ...base, resume: legacy });
  assert.equal(legacyResume.status, "refused");
  assert.equal(legacyResume.code, "kernel-checkpoint-elapsed-unknown");
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
  assert.equal(childLimited.budget, undefined);

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
  const resetParentBudget = structuredClone(snapshot);
  resetParentBudget.budget.effects = 0;
  resetParentBudget.budget.tokens = 0;
  resetParentBudget.budget.cost_micros = 0;
  const inconsistent = await runWorkflowKernel(parent, { task: "child budget pause" }, {
    ...deps,
    resume: resetParentBudget,
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
    checkpoint: () => ({ continue: true }),
  });
  assert.equal(journalInconsistent.ok, false);
  assert.equal(journalInconsistent.code, "kernel-checkpoint-budget-invalid");
  assert.equal(calls, 1);
  const resumed = await runWorkflowKernel(parent, { task: "child budget pause" }, {
    ...deps,
    resume: snapshot,
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
  const nestedBindingDrift = structuredClone(snapshot);
  nestedBindingDrift.active.child.run_id = "run-1.child.2";
  nestedBindingDrift.active.child.scheduler.run_id = "run-1.child.2";
  const bindingRefusal = await runWorkflowKernel(parent, { task: "child pause" }, {
    ...base,
    resume: nestedBindingDrift,
    checkpoint: () => ({ continue: true }),
  });
  assert.equal(bindingRefusal.code, "kernel-checkpoint-child-invalid");
  const nestedDrift = structuredClone(snapshot);
  nestedDrift.active.child.scheduler.budget.max_effects = 0;
  const nestedRefusal = await runWorkflowKernel(parent, { task: "child pause" }, {
    ...base,
    resume: nestedDrift,
    checkpoint: () => ({ continue: true }),
  });
  assert.equal(nestedRefusal.code, "kernel-checkpoint-child-invalid");
  const resumed = await runWorkflowKernel(parent, { task: "child pause" }, {
    ...base,
    resume: snapshot,
    checkpoint: ({ node_id, child_run_id }) => ({
      continue: child_run_id === "run-1.child.1" && node_id === "approval",
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
