import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

import { createWorkflowFromTemplate } from "../dispatch/lib/workflows.mjs";
import { executeNamedWorkflow } from "../extensions/lib/helix-execution.mjs";
import { executeHelixCommand } from "../extensions/lib/helix-command-core.mjs";
import { saveUserWorkflow } from "../extensions/lib/helix-workflows.mjs";

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

function executionBinding(stateRoot, id) {
  const preflight = executeHelixCommand(`run ${id}`, { mode: "print" }, {
    stateRoot,
    chainRegistry: chains,
    runRegistry: runs,
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
  assert.equal(state.task_bound, true);
  assert.deepEqual(state.runtime_limits, { max_runtime_ms: 600_000, call_timeout_ms: 120_000 });
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

test("user-workflow resume refuses explicitly and never prints the legacy tracked-config CLI", async () => {
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
  assert.equal(resume.code, "workflow-resume-unsupported");
  assert.equal(resume.text.includes("helix-task-loop.mjs"), false);
  assert.equal(resume.details.cli_invocation, undefined);
});

test("built-in workflow keeps tracked chain identity and task-bound resume never prints a broken CLI", async () => {
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
  assert.equal(state.config_id, "mock-core-loop");
  assert.equal(state.chain_id, "full-cycle");
  assert.equal(state.task_bound, true);

  const resume = executeHelixCommand("runs resume built-in-task-run", { mode: "print" }, {
    stateRoot,
    runsRoot: join(stateRoot, "runs"),
    chainRegistry: chains,
    runRegistry: runs,
  });
  assert.equal(resume.code, "workflow-resume-unsupported");
  assert.equal(resume.details.cli_invocation, undefined);
  assert.equal(resume.text.includes("helix-task-loop.mjs"), false);
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
