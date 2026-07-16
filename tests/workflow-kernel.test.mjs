import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { agent, decision, gate, map, parallel, pipeline, reduce, subworkflow, terminal, workflow } from "../dispatch/workflow/builder.mjs";
import { createEffectJournal, journalRef } from "../dispatch/kernel/journal.mjs";
import { runWorkflowKernel } from "../dispatch/kernel/scheduler.mjs";
import { createCanonicalWorkspace } from "../dispatch/kernel/workspace.mjs";
import { makePrivateCheckpointEffect } from "../dispatch/lib/runner.mjs";

const objective = { type: "file-contains", path: "proposal.txt", contains: "PASS" };
const reviewer = () => agent({ role: "reviewer", stage_id: "review", output_schema: "verdict-v1", mutation: "read-only", timeout_ms: 1_000 });
const builder = () => agent({ role: "builder", stage_id: "build", mutation: "shared-serialized", timeout_ms: 1_000 });

function definition(nodes, start = "work", limits = {}) {
  const built = workflow({
    id: "kernel-test", name: "Kernel test", description: "Kernel test workflow.", start, nodes,
    limits: { max_total_effects: 32, max_concurrency: 4, max_map_items: 16, max_run_ms: 5_000, max_call_ms: 1_000, ...limits },
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
    objective: gate(objective, "success", "failed", { final: true }),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  });
  const result = await runWorkflowKernel(graph, { task: "review" }, readOnlyDeps());
  assert.equal(result.ok, true);
  assert.equal(result.status, "succeeded");
  assert.equal(result.events.at(-1).kind, "run-end");
  assert.equal(result.outputs.objective.result, "pass");
});

test("decision retries are bounded and loops-off advances explicitly", async () => {
  let calls = 0;
  const graph = definition({
    work: pipeline([reviewer()], "route", { max_visits: 2 }),
    route: { ...decision([
      { when: { op: "eq", path: "/outputs/work/by_role/reviewer/recommendation", value: "revise" }, target: "work", loop: true },
    ], "objective"), loops_off: "objective" },
    objective: gate(objective, "success", "failed", { final: true }),
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
    objective: gate(objective, "success", "failed", { final: true }),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  });
  let calls = 0;
  const recovered = await runWorkflowKernel(graph, { task: "retry" }, readOnlyDeps({
    async executeAgent() {
      calls += 1;
      return calls < 3 ? { ok: false, code: "structured-output-invalid" } : { ok: true, value: { recommendation: "approve" } };
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
    objective: gate(objective, "success", "failed", { final: true }),
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
    objective: gate(objective, "success", "failed", { final: true }),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  });
  let calls = 0;
  const settled = await runWorkflowKernel(graph, { task: "settle" }, readOnlyDeps({
    async executeAgent() {
      calls += 1;
      return calls === 1 ? { ok: false, code: optionalCode } : { ok: true, value: { recommendation: "approve" } };
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
    objective: gate(objective, "success", "failed", { final: true }),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  });
  graph.inputs = { type: "object", additionalProperties: false, required: ["task"], properties: { task: { type: "string" }, items: { type: "array" } } };
  const result = await runWorkflowKernel(graph, { task: "map", items: ["a", "b", "c"] }, readOnlyDeps());
  assert.equal(result.ok, true);
  assert.deepEqual(result.outputs.work.map((entry) => entry.result.value.item), ["a", "b", "c"]);
  assert.equal(result.outputs.collect, 3);
  const tooMany = await runWorkflowKernel(graph, { task: "map", items: [1, 2, 3, 4] }, readOnlyDeps());
  assert.equal(tooMany.code, "kernel-map-cardinality-exceeded");
});

test("mutating effects serialize and journal only after workspace commit", async () => {
  let active = 0;
  let peak = 0;
  let generation = 0;
  const refs = new Set();
  const graph = definition({
    work: parallel([builder(), builder()], "objective", { max_concurrency: 2 }),
    objective: gate(objective, "success", "failed", { final: true }),
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

test("read-only cache reuses output but mutating cache requires workspace verification", async () => {
  const root = mkdtempSync(join(tmpdir(), "helix-kernel-journal-"));
  try {
    let calls = 0;
    const graph = definition({
      work: pipeline([reviewer()], "objective", { max_visits: 1 }),
      objective: gate(objective, "success", "failed", { final: true }),
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

test("effect-boundary checkpoint resumes without repeating a completed effect", async () => {
  const graph = definition({
    work: pipeline([reviewer()], "objective", { max_visits: 1 }),
    objective: gate(objective, "success", "failed", { final: true }),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  });
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
      checkpoint = structuredClone(state);
      return Object.keys(state.active?.completed ?? {}).length > 0
        ? { ok: false, code: "synthetic-process-stop" }
        : { ok: true };
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

test("budget exhaustion and cancellation are terminal, never allowed failures", async () => {
  const graph = definition({
    work: parallel([reviewer(), reviewer()], "objective", { max_concurrency: 2 }),
    objective: gate(objective, "success", "failed", { final: true }),
    success: terminal("succeeded"),
    failed: terminal("failed", "objective-failed"),
  }, "work", { max_total_effects: 1 });
  const exhausted = await runWorkflowKernel(graph, { task: "budget" }, readOnlyDeps());
  assert.equal(exhausted.code, "kernel-budget-exhausted");
  const controller = new AbortController();
  controller.abort("operator-cancelled");
  const cancelled = await runWorkflowKernel(graph, { task: "cancel" }, readOnlyDeps({ signal: controller.signal }));
  assert.equal(cancelled.status, "cancelled");
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

test("version-pinned subworkflow shares budgets and emits nested structural progress", async () => {
  const childBuilt = workflow({
    id: "child-flow", name: "Child", description: "Child workflow.", start: "work",
    nodes: {
      work: pipeline([reviewer()], "objective", { max_visits: 1 }),
      objective: gate(objective, "success", "failed", { final: true }),
      success: terminal("succeeded"),
      failed: terminal("failed", "child-objective-failed"),
    },
    objective_gate: objective,
  });
  assert.equal(childBuilt.ok, true);
  const parent = definition({
    work: subworkflow("child-flow", 1, "objective"),
    objective: gate(objective, "success", "failed", { final: true }),
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
