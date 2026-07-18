import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

import { createWorkflowFromTemplate } from "../dispatch/lib/workflows.mjs";
import { normalizeWorkflowDefinition } from "../dispatch/workflow/schema.mjs";
import { agent, checkpoint, decision, objectiveGate, pipeline, subworkflow, terminal, workflow } from "../dispatch/workflow/builder.mjs";
import { executeNamedWorkflow, resumeNamedWorkflow } from "../extensions/lib/helix-execution.mjs";
import { executeHelixCommand } from "../extensions/lib/helix-command-core.mjs";
import { saveUserWorkflow, saveUserWorkflowV4 } from "../extensions/lib/helix-workflows.mjs";
import { smokeTestWorkflowRuntime } from "../extensions/lib/helix-workflow-test.mjs";

const packageRoot = new URL("..", import.meta.url).pathname;
const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const chains = readJson("../dispatch/config/chains.json");
const runs = readJson("../dispatch/config/run-configs.json");

function repo() {
  const cwd = mkdtempSync(join(tmpdir(), "helix-workflow-exec-"));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "helix@example.invalid"], { cwd });
  execFileSync("git", ["config", "user.name", "Helix Workflow Test"], { cwd });
  writeFileSync(join(cwd, "README.md"), "# Empty workflow fixture\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "baseline"], { cwd });
  return cwd;
}

function installWorkflow(stateRoot, id = "user-loop", template = "implement-review") {
  const created = createWorkflowFromTemplate({ id, template, gate_contains: "DONE" });
  assert.equal(created.ok, true);
  assert.equal(saveUserWorkflow(stateRoot, created.workflow).ok, true);
}

test("every stock workflow template runs end-to-end with a mock cast in an empty committed repository", async () => {
  for (const template of ["implement-review", "plan-implement", "tdd-fix"]) {
    const stateRoot = mkdtempSync(join(tmpdir(), `helix-workflow-template-${template}-`));
    const cwd = repo();
    const id = `template-${template}`;
    installWorkflow(stateRoot, id, template);
    const result = await executeNamedWorkflow({
      workflow_id: id,
      task: `Exercise ${template}`,
      run_id: `run-${template}`,
      cwd,
      state_root: stateRoot,
      package_root: packageRoot,
      chain_registry: chains,
      run_registry: runs,
      expected_binding_ref: executionBinding(stateRoot, id),
      now: 1_751_731_200,
    });
    assert.equal(result.ok, true, `${template}: ${JSON.stringify(result)}`);
    assert.equal(result.converged, true, template);
  }
});

test("runtime smoke testing exercises the real v4 kernel and removes its detached worktree", async () => {
  const cwd = repo();
  const created = createWorkflowFromTemplate({ id: "smoke-flow", template: "plan-implement" });
  assert.equal(created.ok, true);
  created.workflow.deployment.default_assignment = {
    kind: "model", provider: "openrouter", model: "cohere/north-mini-code:free", effort: "low",
  };
  const before = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd, encoding: "utf8" });
  const outcome = await smokeTestWorkflowRuntime({ workflow: created.workflow, cwd, package_root: packageRoot });
  assert.deepEqual(outcome, {
    ok: true,
    runner: "workflow-kernel-v4",
    provider_calls: 0,
    objective_check: "simulated",
    nodes_exercised: 6,
    effects_exercised: 5,
    transitions_exercised: 5,
    objective_gate_exercised: true,
  });
  const after = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd, encoding: "utf8" });
  assert.equal(after, before);
});

test("native v4 runtime smoke follows a real kernel decision and reports only observed work", async () => {
  const cwd = repo();
  const objective = { type: "file-contains", path: "result.md", contains: "PASS" };
  const built = workflow({
    id: "native-smoke", name: "Native smoke", description: "Native v4 smoke workflow.", start: "review",
    nodes: {
      review: pipeline([agent({ role: "reviewer", stage_id: "review", output_schema: "verdict-v1", mutation: "read-only", timeout_ms: 1_000 })], "route", { max_visits: 1 }),
      route: decision([{ when: { op: "eq", path: "/outputs/review/by_role/reviewer/recommendation", value: "approve" }, target: "objective" }], "failed"),
      objective: objectiveGate("success", "failed"),
      success: terminal("succeeded"),
      failed: terminal("failed", "review-failed"),
    },
    objective_gate: objective,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const observed = [];
  const outcome = await smokeTestWorkflowRuntime({
    workflow: built.definition,
    cwd,
    onEvent(event) { observed.push(event); },
  });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.deepEqual(observed.filter((event) => event.kind === "node-start").map((event) => event.node_id), [
    "review", "route", "objective", "success",
  ]);
  assert.equal(outcome.nodes_exercised, 4);
  assert.equal(outcome.effects_exercised, 1);
  assert.equal(outcome.transitions_exercised, 3);
});

function executionBinding(stateRoot, id, modelInventory = null) {
  const preflight = executeHelixCommand(`run ${id}`, { mode: "print" }, {
    stateRoot,
    chainRegistry: chains,
    runRegistry: runs,
    ...(modelInventory ? { modelInventory } : {}),
  });
  assert.equal(preflight.ok, true, JSON.stringify(preflight));
  assert.match(preflight.details.execution_binding_ref, /^sha256:[0-9a-f]{64}$/);
  return preflight.details.execution_binding_ref;
}

test("named user workflow executes canonical blocks and never persists the raw task", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-workflow-state-"));
  const cwd = repo();
  installWorkflow(stateRoot);
  const task = "Implement a private-shaped request without persisting this sentence";
  const result = await executeNamedWorkflow({
    workflow_id: "user-loop",
    task,
    run_id: "user-loop-run",
    cwd,
    state_root: stateRoot,
    package_root: packageRoot,
    chain_registry: chains,
    run_registry: runs,
    expected_binding_ref: executionBinding(stateRoot, "user-loop"),
    now: 1_751_731_200,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.converged, true);
  assert.equal(existsSync(join(stateRoot, "private", "tasks", "user-loop-run.txt")), false);
  const publicDir = join(stateRoot, "runs", "user-loop-run");
  for (const name of readdirSync(publicDir)) {
    const path = join(publicDir, name);
    if (statSync(path).isFile()) assert.equal(readFileSync(path, "utf8").includes(task), false, name);
  }
  const state = JSON.parse(readFileSync(join(publicDir, "user-loop-run.state.json"), "utf8"));
  assert.equal(state.schema_version, 4);
  assert.equal(state.workflow_id, "user-loop");
  assert.equal(state.completed, true);
  assert.match(state.task_ref, /^sha256:[0-9a-f]{64}$/);
  const lifecycle = JSON.parse(readFileSync(join(publicDir, "user-loop-run.workflow.json"), "utf8"));
  assert.equal(lifecycle.workflow_id, "user-loop");
  assert.equal(lifecycle.schema_version, 2);
  const listed = executeHelixCommand("runs list", { mode: "print" }, {
    stateRoot, runsRoot: join(stateRoot, "runs"), chainRegistry: chains, runRegistry: runs,
  });
  assert.equal(listed.ok, true);
  assert.match(listed.text, /user-loop-run: workflow-kernel succeeded/);
  assert.equal(listed.text.includes("invalid"), false);

  const workflowPath = join(stateRoot, "workflows", "user-loop.json");
  const edited = JSON.parse(readFileSync(workflowPath, "utf8"));
  edited.stop.max_iterations = 1;
  writeFileSync(workflowPath, JSON.stringify(edited), "utf8");
  const watched = executeHelixCommand("runs watch user-loop-run", { mode: "print" }, {
    stateRoot,
    runsRoot: join(stateRoot, "runs"),
    chainRegistry: chains,
    runRegistry: runs,
  });
  assert.equal(watched.ok, true, JSON.stringify(watched));
  assert.match(watched.text, /Flow:/);
  assert.match(watched.text, /✓ implement/);
  lifecycle.workflow_version += 1;
  writeFileSync(join(publicDir, "user-loop-run.workflow.json"), JSON.stringify(lifecycle), "utf8");
  const tampered = executeHelixCommand("runs watch user-loop-run", { mode: "print" }, {
    stateRoot, runsRoot: join(stateRoot, "runs"), chainRegistry: chains, runRegistry: runs,
  });
  assert.equal(tampered.code, "run-record-invalid-or-unsafe");
});

test("run-directory collisions refuse without creating a raw task artifact", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-workflow-collision-"));
  const cwd = repo();
  installWorkflow(stateRoot);
  mkdirSync(join(stateRoot, "runs", "collision-run"), { recursive: true });
  const expectedBinding = executionBinding(stateRoot, "user-loop");
  const result = await executeNamedWorkflow({
    workflow_id: "user-loop", task: "new task", run_id: "collision-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: expectedBinding,
  });
  assert.equal(result.code, "fresh-run-id-exists");
  assert.equal(existsSync(join(stateRoot, "private")), false);
});

test("execution validates required task and roots before filesystem effects", async () => {
  const missingTask = await executeNamedWorkflow({ run_id: "safe-run", task: "", cwd: "/tmp", state_root: "/tmp", package_root: "/tmp" });
  assert.equal(missingTask.code, "workflow-task-required");
  const missingRoot = await executeNamedWorkflow({ run_id: "safe-run", task: "x", cwd: "", state_root: "/tmp", package_root: "/tmp" });
  assert.equal(missingRoot.code, "workflow-execution-path-invalid");
});

test("execution refuses persisted workflows with unsafe outputs before reserving a run or worktree", async () => {
  for (const [index, path] of [".", "dir/", "a//b", ".git"].entries()) {
    const stateRoot = mkdtempSync(join(tmpdir(), "helix-workflow-unsafe-output-"));
    const cwd = repo();
    const id = `unsafe-output-${index}`;
    const created = createWorkflowFromTemplate({ id, template: "implement-review" });
    assert.equal(created.ok, true);
    created.workflow.stages[0].artifact.path = path;
    created.workflow.stop.objective_gate.path = path;
    mkdirSync(join(stateRoot, "workflows"), { recursive: true });
    writeFileSync(join(stateRoot, "workflows", `${id}.json`), JSON.stringify(created.workflow), "utf8");
    const result = await executeNamedWorkflow({
      workflow_id: id, task: "must not run", run_id: `unsafe-run-${index}`, cwd,
      state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
      expected_binding_ref: `sha256:${"0".repeat(64)}`,
    });
    assert.equal(result.code, "invalid-workflow", path);
    assert.equal(existsSync(join(stateRoot, "runs")), false, path);
    assert.equal(existsSync(join(cwd, ".git")), true, path);
  }
});

test("completed failed user workflow resume is a structural no-op and never prints the legacy CLI", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-workflow-resume-"));
  const cwd = repo();
  installWorkflow(stateRoot);
  const failed = await executeNamedWorkflow({
    workflow_id: "user-loop",
    task: "task that will be interrupted",
    run_id: "user-resume-run",
    cwd,
    state_root: stateRoot,
    package_root: packageRoot,
    chain_registry: chains,
    run_registry: runs,
    expected_binding_ref: executionBinding(stateRoot, "user-loop"),
    adapter: {
      kind: "test-failure",
      runCandidate() { throw new Error("private adapter detail"); },
    },
    now: 1_751_731_200,
  });
  assert.equal(failed.ok, false);
  const resume = executeHelixCommand("runs resume user-resume-run", { mode: "print" }, {
    stateRoot,
    runsRoot: join(stateRoot, "runs"),
    chainRegistry: chains,
    runRegistry: runs,
  });
  assert.equal(resume.ok, true);
  assert.equal(resume.details.completed, true);
  assert.equal(resume.text.includes("helix-task-loop.mjs"), false);
  assert.equal(resume.details.cli_invocation, undefined);
});

test("built-in workflow keeps pinned workflow identity and completed resume never prints a broken CLI", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-built-in-resume-"));
  const cwd = repo();
  const failed = await executeNamedWorkflow({
    workflow_id: "mock-core-loop",
    task: "exact built-in workflow task",
    run_id: "built-in-task-run",
    cwd,
    state_root: stateRoot,
    package_root: packageRoot,
    chain_registry: chains,
    run_registry: runs,
    expected_binding_ref: executionBinding(stateRoot, "mock-core-loop"),
    adapter: {
      kind: "test-failure",
      runCandidate() { throw new Error("private adapter detail"); },
    },
    now: 1_751_731_200,
  });
  assert.equal(failed.ok, false);
  const state = JSON.parse(readFileSync(join(stateRoot, "runs", "built-in-task-run", "built-in-task-run.state.json"), "utf8"));
  assert.equal(state.workflow_id, "mock-core-loop");
  assert.equal(state.schema_version, 4);
  assert.equal(state.completed, true);

  const resume = executeHelixCommand("runs resume built-in-task-run", { mode: "print" }, {
    stateRoot,
    runsRoot: join(stateRoot, "runs"),
    chainRegistry: chains,
    runRegistry: runs,
  });
  assert.equal(resume.ok, true);
  assert.equal(resume.details.completed, true);
  assert.equal(resume.details.cli_invocation, undefined);
  assert.equal(resume.text.includes("helix-task-loop.mjs"), false);
});

test("built-in workflow projection preserves the tracked loop's pass, gate, and revision behavior", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-built-in-parity-"));
  const cwd = repo();
  writeFileSync(join(cwd, "proposal.txt"), "initial proposal\n", "utf8");
  execFileSync("git", ["add", "proposal.txt"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "add tracked gate fixture"], { cwd });
  const result = await executeNamedWorkflow({
    workflow_id: "mock-core-loop",
    task: "exercise the tracked compatibility loop",
    run_id: "built-in-parity-run",
    cwd,
    state_root: stateRoot,
    package_root: packageRoot,
    chain_registry: chains,
    run_registry: runs,
    expected_binding_ref: executionBinding(stateRoot, "mock-core-loop"),
    now: 1_751_731_200,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.total_passes, 3, "plan, implement gate failure, implement revision");
  assert.equal(result.calls.revisions, 1);
  const events = readFileSync(join(stateRoot, "runs", "built-in-parity-run", "built-in-parity-run.kernel.events.jsonl"), "utf8")
    .trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(events.filter((event) => event.kind === "gate").map((event) => event.result), ["fail", "pass"]);
});

test("interrupted product workflow resumes from its private effect checkpoint without repeating committed work", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-workflow-kernel-resume-"));
  const cwd = repo();
  installWorkflow(stateRoot, "resume-loop");
  const binding = executionBinding(stateRoot, "resume-loop");
  await assert.rejects(executeNamedWorkflow({
    workflow_id: "resume-loop",
    task: "resume this exact task",
    run_id: "kernel-resume-run",
    cwd,
    state_root: stateRoot,
    package_root: packageRoot,
    chain_registry: chains,
    run_registry: runs,
    expected_binding_ref: binding,
    onEvent(event) {
      if (event.kind === "effect-end") throw new Error("synthetic-process-boundary-stop");
    },
  }), /synthetic-process-boundary-stop/);
  const statePath = join(stateRoot, "runs", "kernel-resume-run", "kernel-resume-run.state.json");
  assert.equal(JSON.parse(readFileSync(statePath, "utf8")).completed, false);
  const ready = executeHelixCommand("runs resume kernel-resume-run", { mode: "print" }, {
    stateRoot, runsRoot: join(stateRoot, "runs"), chainRegistry: chains, runRegistry: runs,
  });
  assert.equal(ready.ok, true, JSON.stringify(ready));
  assert.equal(ready.details.in_process_resume, true);
  const resumed = await resumeNamedWorkflow({
    run_id: "kernel-resume-run",
    task: "resume this exact task",
    cwd,
    state_root: stateRoot,
    package_root: packageRoot,
    chain_registry: chains,
    run_registry: runs,
    expected_binding_ref: binding,
  });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(resumed.converged, true);
  assert.equal(JSON.parse(readFileSync(statePath, "utf8")).completed, true);
});

test("product execution pins and runs a depth-one named subworkflow through the same kernel", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-product-subworkflow-"));
  const cwd = repo();
  const childGate = { type: "file-contains", path: "child.md", contains: "CHILD_PASS" };
  const child = workflow({
    id: "child-v4", name: "Child", description: "Child workflow.", start: "child-work",
    nodes: {
      "child-work": pipeline([agent({ role: "reviewer", stage_id: "child-work", mutation: "read-only", timeout_ms: 1_000 })], "child-objective", { max_visits: 1, artifact: { path: "child.md", kind: "notes" } }),
      "child-objective": objectiveGate("child-success", "child-failed"),
      "child-success": terminal("succeeded"),
      "child-failed": terminal("failed", "child-gate-failed"),
    },
    objective_gate: childGate,
  });
  const parentGate = { type: "file-contains", path: "parent.md", contains: "PARENT_PASS" };
  const parent = workflow({
    id: "parent-v4", name: "Parent", description: "Parent workflow.", start: "parent-work",
    nodes: {
      "parent-work": pipeline([agent({ role: "reviewer", stage_id: "parent-work", mutation: "read-only", timeout_ms: 1_000 })], "child", { max_visits: 1, artifact: { path: "parent.md", kind: "notes" } }),
      child: subworkflow("child-v4", 1, "parent-objective"),
      "parent-objective": objectiveGate("parent-success", "parent-failed"),
      "parent-success": terminal("succeeded"),
      "parent-failed": terminal("failed", "parent-gate-failed"),
    },
    objective_gate: parentGate,
  });
  assert.equal(child.ok, true, JSON.stringify(child.errors));
  assert.equal(parent.ok, true, JSON.stringify(parent.errors));
  assert.equal(saveUserWorkflowV4(stateRoot, child.definition).ok, true);
  assert.equal(saveUserWorkflowV4(stateRoot, parent.definition).ok, true);
  const result = await executeNamedWorkflow({
    workflow_id: "parent-v4", task: "run parent and child", run_id: "subworkflow-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: executionBinding(stateRoot, "parent-v4"),
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  const events = readFileSync(join(stateRoot, "runs", "subworkflow-run", "subworkflow-run.kernel.events.jsonl"), "utf8")
    .trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(events.some((event) => event.kind === "subworkflow-event" && event.child_kind === "run-end"), true);
  const watch = executeHelixCommand("runs watch subworkflow-run", { mode: "print" }, {
    stateRoot, runsRoot: join(stateRoot, "runs"), chainRegistry: chains, runRegistry: runs,
  });
  assert.equal(watch.ok, true, JSON.stringify(watch));
});

test("checkpoint node pauses durably and attended resume is its explicit continue action", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-product-checkpoint-"));
  const cwd = repo();
  const objective = { type: "file-contains", path: "checkpoint.md", contains: "PASS" };
  const built = workflow({
    id: "checkpoint-v4", name: "Checkpoint", description: "Checkpoint workflow.", start: "work",
    nodes: {
      work: pipeline([agent({ role: "reviewer", stage_id: "work", mutation: "read-only", timeout_ms: 1_000 })], "approval", { max_visits: 1, artifact: { path: "checkpoint.md", kind: "notes" } }),
      approval: checkpoint("operator-approval", "objective"),
      objective: objectiveGate("success", "failed"),
      success: terminal("succeeded"),
      failed: terminal("failed", "objective-failed"),
    },
    objective_gate: objective,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  assert.equal(saveUserWorkflowV4(stateRoot, built.definition).ok, true);
  const binding = executionBinding(stateRoot, "checkpoint-v4");
  const paused = await executeNamedWorkflow({
    workflow_id: "checkpoint-v4", task: "pause and continue", run_id: "checkpoint-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding,
  });
  assert.equal(paused.stop_reason, "paused");
  assert.equal(JSON.parse(readFileSync(join(stateRoot, "runs", "checkpoint-run", "checkpoint-run.state.json"), "utf8")).completed, false);
  const resumed = await resumeNamedWorkflow({
    run_id: "checkpoint-run", task: "pause and continue", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding,
  });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(resumed.converged, true);
});

test("execution refuses confirmation-source drift before reserving a run or calling an adapter", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-workflow-drift-"));
  const cwd = repo();
  installWorkflow(stateRoot);
  const expectedBinding = executionBinding(stateRoot, "user-loop");
  const workflowPath = join(stateRoot, "workflows", "user-loop.json");
  const workflow = JSON.parse(readFileSync(workflowPath, "utf8"));
  workflow.stop.max_iterations -= 1;
  writeFileSync(workflowPath, JSON.stringify(workflow), "utf8");
  let calls = 0;
  const result = await executeNamedWorkflow({
    workflow_id: "user-loop", task: "must not execute", run_id: "drift-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: expectedBinding,
    adapter: { runCandidate() { calls += 1; } },
  });
  assert.equal(result.code, "workflow-preflight-drift");
  assert.equal(calls, 0);
  assert.equal(existsSync(join(stateRoot, "runs", "drift-run")), false);
});

test("real product execution requires an exact adapter before reserving a run", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-workflow-exact-adapter-"));
  const cwd = repo();
  const created = createWorkflowFromTemplate({ id: "real-exact-flow", template: "implement-review" });
  assert.equal(created.ok, true);
  created.workflow.deployment.default_assignment = {
    kind: "model", provider: "openrouter", model: "vendor/exact:free", effort: "high",
  };
  assert.equal(saveUserWorkflow(stateRoot, created.workflow).ok, true);
  const inventory = [{
    provider: "openrouter", model: "vendor/exact:free", reasoning: true,
    supported_efforts: ["high"],
  }];
  const adapter = {
    kind: "helix-pi-agent", exactMode: false,
    supportsProvider: () => true,
    async preflightExact() { throw new Error("must not accept non-exact adapter"); },
    runCandidate() { throw new Error("must not execute"); },
  };
  const result = await executeNamedWorkflow({
    workflow_id: "real-exact-flow", task: "must not leave preflight", run_id: "exact-adapter-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: executionBinding(stateRoot, "real-exact-flow", inventory), adapter,
  });
  assert.equal(result.code, "provider-exact-adapter-required");
  assert.equal(existsSync(join(stateRoot, "runs", "exact-adapter-run")), false);

  const exactAdapter = {
    kind: "helix-pi-agent", exactMode: true,
    supportsProvider: () => true,
    async preflightExact() {
      return {
        ok: true,
        bindings: [{
          provider: "openrouter", model: "vendor/exact:free", effort: "high",
          route: "ExactRoute", account_ref: `sha256:${"1".repeat(64)}`,
        }],
        binding_ref: `sha256:${"2".repeat(64)}`,
      };
    },
    attests: () => true,
    runCandidate() { throw new Error("must not execute after consent drift"); },
  };
  const drift = await executeNamedWorkflow({
    workflow_id: "real-exact-flow", task: "must not leave exact consent", run_id: "exact-consent-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: executionBinding(stateRoot, "real-exact-flow", inventory),
    expected_exact_ref: `sha256:${"3".repeat(64)}`,
    adapter: exactAdapter,
  });
  assert.equal(drift.code, "provider-exact-consent-drift");
  assert.equal(existsSync(join(stateRoot, "runs", "exact-consent-run")), false);
});

test("live-certification policy refuses before provider preflight when the adapter cannot prove it", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-workflow-live-cert-"));
  const cwd = repo();
  const created = createWorkflowFromTemplate({ id: "live-cert-flow", template: "implement-review" });
  assert.equal(created.ok, true);
  created.workflow.deployment.default_assignment = {
    kind: "model", provider: "openrouter", model: "vendor/exact:free", effort: "high",
  };
  const normalized = normalizeWorkflowDefinition(created.workflow);
  assert.equal(normalized.ok, true);
  normalized.definition.provider_policy.require_live_certification = true;
  assert.equal(saveUserWorkflowV4(stateRoot, normalized.definition).ok, true);
  const inventory = [{
    provider: "openrouter", model: "vendor/exact:free", reasoning: true,
    supported_efforts: ["high"],
  }];
  let preflightCalls = 0;
  const adapter = {
    kind: "helix-pi-agent",
    exactMode: true,
    liveCertification: false,
    supportsProvider: () => true,
    attests: () => true,
    async preflightExact() {
      preflightCalls += 1;
      return { ok: true, bindings: [] };
    },
  };
  const result = await executeNamedWorkflow({
    workflow_id: "live-cert-flow", task: "must refuse before provider egress", run_id: "live-cert-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: executionBinding(stateRoot, "live-cert-flow", inventory), adapter,
  });
  assert.equal(result.code, "provider-live-certification-required");
  assert.equal(preflightCalls, 0);
  assert.equal(existsSync(join(stateRoot, "runs", "live-cert-run")), false);
});
