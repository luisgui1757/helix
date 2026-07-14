import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  WORKFLOW_TEMPLATES,
  createWorkflowFromTemplate,
  decideWorkflowTransition,
  isSafeWorkflowPath,
  simulateWorkflow,
  testWorkflow,
  validateWorkflow,
  workflowFromExecution,
  workflowToExecution,
} from "../dispatch/lib/workflows.mjs";
import {
  listUserWorkflows,
  resolveWorkflow,
  saveUserWorkflow,
  workflowCatalog,
} from "../extensions/lib/helix-workflows.mjs";

const root = new URL("..", import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));

function template(overrides = {}) {
  const created = createWorkflowFromTemplate({ id: "my-flow", template: "plan-implement", ...overrides });
  assert.equal(created.ok, true, JSON.stringify(created));
  return created.workflow;
}

test("workflow templates are concise, named, and produce valid explicit transition blocks", () => {
  assert.deepEqual(WORKFLOW_TEMPLATES.map((entry) => entry.id), ["implement-review", "plan-implement", "tdd-fix"]);
  for (const entry of WORKFLOW_TEMPLATES) {
    const created = createWorkflowFromTemplate({ id: `test-${entry.id}`, template: entry.id });
    assert.equal(created.ok, true, JSON.stringify(created));
    assert.equal(validateWorkflow(created.workflow).valid, true);
    assert.equal(created.workflow.stages.every((stage) => stage.transitions.length > 0), true);
    assert.equal(created.workflow.stages.every((stage) => Number.isInteger(stage.max_passes)), true);
    assert.equal(created.workflow.stages.every((stage) => stage.artifact?.path), true);
    assert.equal(created.workflow.stages.some((stage) => stage.artifact.path === created.workflow.stop.objective_gate.path), true);
    const tested = testWorkflow(created.workflow);
    assert.equal(tested.ok, true, JSON.stringify(tested));
    assert.equal(tested.artifacts_tested, created.workflow.stages.length);
    assert.equal(tested.deployment_tested, true);
  }
});

test("workflow validation rejects forward backtracking, unbounded rails, and incomplete stop blocks", () => {
  const forward = template();
  forward.stages[0].transitions[0] = {
    when: { type: "verdict", role: "reviewer", is: "approve" },
    action: "back",
    target: "implement",
  };
  assert.equal(validateWorkflow(forward).valid, false);

  const unbounded = template();
  unbounded.stop.max_iterations = Number.MAX_SAFE_INTEGER;
  assert.equal(validateWorkflow(unbounded).valid, false);

  const missingGate = template();
  delete missingGate.stop.objective_gate.contains;
  assert.equal(validateWorkflow(missingGate).valid, false);
});

test("workflow paths match the persistence boundary and protect Git metadata", () => {
  for (const path of [".", "dir/", "a//b", "a/./b", "../outside", ".git", ".Git/config"]) {
    assert.equal(isSafeWorkflowPath(path), false, path);
    const created = createWorkflowFromTemplate({ id: "unsafe-path", gate_path: path });
    assert.equal(created.ok, false, path);
  }
  for (const path of ["proposal.txt", "docs/result.md", ".helix-result.json"]) {
    assert.equal(isSafeWorkflowPath(path), true, path);
  }
});

test("workflow validation guarantees deployable fields and public transition semantics before save", () => {
  const requiredDeploymentFields = Object.keys(template().deployment);
  for (const field of requiredDeploymentFields) {
    const missing = template();
    delete missing.deployment[field];
    assert.equal(validateWorkflow(missing).valid, false, `missing deployment.${field}`);
  }

  for (const [field, value] of [
    ["role_matrix", "not/a/matrix"],
    ["run_target", { repo: "somewhere" }],
    ["input_refs", [{ kind: "sha256", value: "not-a-hash", algorithm: "sha256" }]],
    ["claims_ref", "private/path.txt"],
    ["evidence_ref", "https://private.example/evidence"],
  ]) {
    const malformed = template();
    malformed.deployment[field] = value;
    assert.equal(validateWorkflow(malformed).valid, false, `malformed deployment.${field}`);
  }

  const mixedVerdictRoles = template();
  mixedVerdictRoles.stages[0].steps.push({ id: "redteam", kind: "role", role: "redteam" });
  mixedVerdictRoles.stages[0].transitions[1].when.role = "redteam";
  assert.equal(validateWorkflow(mixedVerdictRoles).valid, false);

  const privateStopReason = template();
  privateStopReason.stages[0].transitions.unshift({
    when: { type: "gate", is: "fail" }, action: "stop", reason: "../../private/task.txt",
  });
  assert.equal(validateWorkflow(privateStopReason).valid, false);

  const incompleteVerdicts = template();
  incompleteVerdicts.stages[0].transitions = incompleteVerdicts.stages[0].transitions
    .filter((rule) => rule.when.is !== "revise-jump");
  assert.equal(validateWorkflow(incompleteVerdicts).valid, false);

  const mixedFamilies = template();
  mixedFamilies.stages[0].transitions.unshift({ when: { type: "gate", is: "pass" }, action: "advance" });
  assert.equal(validateWorkflow(mixedFamilies).valid, false);

  const duplicateRole = template();
  duplicateRole.stages[0].steps.push({ id: "review-again", kind: "role", role: "reviewer" });
  assert.equal(validateWorkflow(duplicateRole).valid, false);

  const metaRole = template();
  metaRole.stages[0].steps[0] = { id: "judge", kind: "role", role: "judge" };
  assert.equal(validateWorkflow(metaRole).valid, false);

  const unavailableRole = template();
  unavailableRole.stages[0].steps[0] = { id: "documenter", kind: "role", role: "documenter" };
  assert.equal(validateWorkflow(unavailableRole).valid, false);

  const readOnlyFirstStage = template();
  readOnlyFirstStage.stages[0].steps[0] = { id: "scout", kind: "role", role: "scout" };
  assert.equal(validateWorkflow(readOnlyFirstStage).valid, false);

  const readOnlyLaterStage = template();
  readOnlyLaterStage.stages[1].steps = [
    { id: "review", kind: "role", role: "reviewer" },
  ];
  readOnlyLaterStage.stages[1].transitions = [
    { when: { type: "verdict", role: "reviewer", is: "approve" }, action: "advance" },
    { when: { type: "verdict", role: "reviewer", is: "revise" }, action: "retry" },
    { when: { type: "verdict", role: "reviewer", is: "revise-jump" }, action: "back", target: "plan" },
  ];
  assert.equal(validateWorkflow(readOnlyLaterStage).valid, false);

  const missingOutput = template();
  delete missingOutput.stages[0].artifact;
  assert.equal(validateWorkflow(missingOutput).valid, false);

  const unboundGate = template();
  unboundGate.stop.objective_gate.path = "UNDECLARED.md";
  assert.equal(validateWorkflow(unboundGate).valid, false);

  const unresolvedRepository = template();
  unresolvedRepository.deployment.run_target = { repo: "other", ref: "bound-repo" };
  assert.equal(validateWorkflow(unresolvedRepository).valid, false);
});

test("transition blocks advance, retry, go back to a named stage, and stop deterministically", () => {
  const workflow = template();
  const plan = workflow.stages[0];
  const implement = workflow.stages[1];
  assert.equal(decideWorkflowTransition(plan, 1, { verdict: "approve" }).action, "advance");
  assert.equal(decideWorkflowTransition(implement, 1, { verdict: "revise" }).action, "retry");
  assert.deepEqual(
    decideWorkflowTransition(implement, 1, { verdict: "revise-jump" }),
    { action: "back", code: null, target: "plan" },
  );

  const stopping = structuredClone(workflow);
  stopping.stages[0].transitions.unshift({
    when: { type: "gate", is: "fail" }, action: "stop", reason: "prerequisite-failed",
  });
  assert.deepEqual(
    decideWorkflowTransition(stopping.stages[0], 1, { gate_result: "fail" }),
    { action: "stop", code: "prerequisite-failed" },
  );
});

test("simulation tests backtracking and stopping without a provider call", () => {
  const workflow = template({ max_iterations: 6 });
  const simulated = simulateWorkflow(workflow, [
    { verdict: "approve" },
    { verdict: "revise-jump" },
    { verdict: "approve" },
    { verdict: "approve" },
  ]);
  assert.equal(simulated.ok, true);
  assert.equal(simulated.converged, true);
  assert.deepEqual(simulated.trace.map((entry) => `${entry.stage_id}:${entry.action}`), [
    "plan:advance", "implement:back", "plan:advance", "implement:advance",
  ]);

  const exhausted = simulateWorkflow(workflow, [
    { verdict: "revise" }, { verdict: "revise" }, { verdict: "revise" },
  ]);
  assert.equal(exhausted.ok, false);
  assert.equal(exhausted.code, "stage-max-passes-exhausted:plan");

  const pingPong = template();
  pingPong.stages[0].max_passes = 1;
  const backtrackExhausted = simulateWorkflow(pingPong, [
    { verdict: "approve" }, { verdict: "revise-jump" }, { verdict: "approve" },
  ]);
  assert.equal(backtrackExhausted.ok, false);
  assert.equal(backtrackExhausted.code, "stage-max-passes-exhausted:plan");
  assert.equal(backtrackExhausted.total_passes, 2);
});

test("existing shipped chains normalize into the same workflow blocks and back into runner inputs", () => {
  const chains = readJson("dispatch/config/chains.json");
  const configs = readJson("dispatch/config/run-configs.json");
  const chain = chains.chains.find((entry) => entry.id === "full-cycle");
  const config = configs.configs.find((entry) => entry.chain === chain.id);
  const workflow = workflowFromExecution(chain, config);
  assert.equal(validateWorkflow(workflow).valid, true);
  assert.equal(workflow.stages[1].transitions.find((rule) => rule.action === "back").target, "plan");
  assert.equal(workflow.stages[1].artifact.path, config.objective_gate.path);
  const execution = workflowToExecution(workflow);
  assert.equal(execution.ok, true, JSON.stringify(execution));
  assert.equal(execution.chain.stages[1].transitions.find((rule) => rule.action === "back").target, "plan");
  assert.equal(execution.config.max_iterations, config.max_iterations);
});

test("user workflows persist atomically, reject collisions, and retain legacy tracked workflows", () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-workflows-"));
  const chains = readJson("dispatch/config/chains.json");
  const configs = readJson("dispatch/config/run-configs.json");
  const workflow = template();

  assert.equal(saveUserWorkflow(stateRoot, workflow, { builtInIds: chains.chains.map((entry) => entry.id) }).ok, true);
  assert.equal(saveUserWorkflow(stateRoot, workflow).code, "helix-workflow-exists");
  assert.deepEqual(listUserWorkflows(stateRoot).workflows.map((entry) => entry.id), ["my-flow"]);
  assert.equal(resolveWorkflow(stateRoot, "my-flow", chains, configs).workflow.source, "user");

  const catalog = workflowCatalog(stateRoot, chains, configs);
  assert.equal(catalog.ok, true);
  assert.equal(catalog.workflows.some((entry) => entry.id === "mock-core-loop" && entry.source === "built-in"), true);
});

test("malformed and legacy-version user files fail closed instead of disappearing", () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-workflows-invalid-"));
  mkdirSync(join(stateRoot, "workflows"), { recursive: true });
  writeFileSync(join(stateRoot, "workflows", "old.json"), JSON.stringify({ schema_version: 0, id: "old" }), "utf8");
  assert.equal(listUserWorkflows(stateRoot).code, "invalid-workflow");
});

test("workflow listing refuses symlink and non-regular entries before reading them", () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-workflows-symlink-"));
  const victimRoot = mkdtempSync(join(tmpdir(), "helix-workflow-victim-"));
  const victim = join(victimRoot, "victim.json");
  mkdirSync(join(stateRoot, "workflows"), { recursive: true });
  writeFileSync(victim, JSON.stringify(template()), "utf8");
  symlinkSync(victim, join(stateRoot, "workflows", "my-flow.json"));

  assert.deepEqual(listUserWorkflows(stateRoot), {
    ok: false, code: "helix-workflow-unreadable", detail: "my-flow.json",
  });
});
