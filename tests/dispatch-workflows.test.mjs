import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveChain } from "../dispatch/lib/chains.mjs";

import {
  WORKFLOW_TEMPLATES,
  createWorkflowFromTemplate,
  decideWorkflowTransition,
  isSafeWorkflowPath,
  objectiveGateSummary,
  simulateWorkflow,
  testWorkflow,
  validateWorkflow,
  validateWorkflowLifecycleSnapshot,
  workflowLifecycleSnapshot,
  workflowFromExecution,
  workflowToExecution,
} from "../dispatch/lib/workflows.mjs";
import {
  listUserWorkflows,
  deleteUserWorkflow,
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
    assert.equal(tested.artifacts_declared, created.workflow.stages.length);
    assert.equal(tested.definition_tested, true);
    assert.equal(tested.deployment_projected, true);
    assert.equal(tested.runtime_tested, false);
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

test("workflow validation bounds every repeated collection and user-authored string surface", () => {
  const longId = template();
  longId.id = "a".repeat(65);
  assert.equal(validateWorkflow(longId).errors.some((error) => error.path === "$.id"), true);

  const longDescription = template();
  longDescription.description = "x".repeat(513);
  assert.equal(validateWorkflow(longDescription).errors.some((error) => error.path === "$.description"), true);

  const tooManyStages = template();
  tooManyStages.stages = Array.from({ length: 17 }, (_, index) => ({
    ...structuredClone(tooManyStages.stages[0]),
    id: `stage-${index}`,
    artifact: { path: `stage-${index}.txt`, kind: "notes" },
  }));
  assert.equal(validateWorkflow(tooManyStages).errors.some((error) => error.path === "$.stages"), true);

  const longLabel = template();
  longLabel.stages[0].label = "x".repeat(129);
  assert.equal(validateWorkflow(longLabel).errors.some((error) => error.path === "$.stages[0].label"), true);

  const oversized = template();
  oversized.source = "built-in";
  oversized.stages[0].steps[0] = { id: "check", kind: "local-check", note: "x".repeat(70_000) };
  assert.equal(validateWorkflow(oversized).errors.some((error) =>
    error.path === "$" && error.message.includes("65536 bytes")), true);
});

test("workflow lifecycle snapshots revalidate every persisted graph boundary", () => {
  const valid = workflowLifecycleSnapshot(template());
  assert.equal(validateWorkflowLifecycleSnapshot(valid), true);

  const invalidAction = structuredClone(valid);
  invalidAction.stages[0].transitions[0].action = "teleport";
  assert.equal(validateWorkflowLifecycleSnapshot(invalidAction), false);

  const duplicateRole = structuredClone(valid);
  duplicateRole.stages[0].roles.push(duplicateRole.stages[0].roles[0]);
  assert.equal(validateWorkflowLifecycleSnapshot(duplicateRole), false);

  const incompleteVerdicts = structuredClone(valid);
  incompleteVerdicts.stages[0].transitions.pop();
  assert.equal(validateWorkflowLifecycleSnapshot(incompleteVerdicts), false);

  const oversizedStage = structuredClone(valid);
  oversizedStage.stages[0].id = "a".repeat(65);
  assert.equal(validateWorkflowLifecycleSnapshot(oversizedStage), false);

  const extraField = structuredClone(valid);
  extraField.stages[0].transitions[0].unexpected = true;
  assert.equal(validateWorkflowLifecycleSnapshot(extraField), false);
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

test("command objective checks are argv-style, bounded, and independent of model-written artifacts", () => {
  const workflow = template();
  workflow.stop.objective_gate = {
    type: "command-exit-zero",
    command: "npm",
    args: ["test"],
    timeout_ms: 120_000,
  };
  assert.equal(validateWorkflow(workflow).valid, true);
  assert.equal(workflowToExecution(workflow).ok, true);

  const shell = structuredClone(workflow);
  shell.stop.objective_gate.command = "npm test && curl";
  assert.equal(validateWorkflow(shell).valid, false);

  const traversal = structuredClone(workflow);
  traversal.stop.objective_gate.command = "./../verify.sh";
  assert.equal(validateWorkflow(traversal).valid, false);

  const oversized = structuredClone(workflow);
  oversized.stop.objective_gate.args = Array.from({ length: 33 }, () => "x");
  assert.equal(validateWorkflow(oversized).valid, false);

  const longCommand = structuredClone(workflow);
  longCommand.stop.objective_gate.command = "a".repeat(129);
  assert.equal(validateWorkflow(longCommand).valid, false);

  const longerThanRun = structuredClone(workflow);
  longerThanRun.stop.max_runtime_ms = 60_000;
  longerThanRun.stop.objective_gate.timeout_ms = 120_000;
  assert.equal(validateWorkflow(longerThanRun).errors.some((error) =>
    error.path === "$.stop.objective_gate.timeout_ms"), true);
  assert.equal(objectiveGateSummary({
    type: "command-exit-zero", command: "node", args: ["arg with spaces"], timeout_ms: 1_000,
  }), 'command-exit-zero argv=["node","arg with spaces"]');
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
  assert.equal(validateWorkflow(readOnlyFirstStage).valid, true);

  const readOnlyLaterStage = template();
  readOnlyLaterStage.stages[1].steps = [
    { id: "review", kind: "role", role: "reviewer" },
  ];
  readOnlyLaterStage.stages[1].transitions = [
    { when: { type: "verdict", role: "reviewer", is: "approve" }, action: "advance" },
    { when: { type: "verdict", role: "reviewer", is: "revise" }, action: "retry" },
    { when: { type: "verdict", role: "reviewer", is: "revise-jump" }, action: "back", target: "plan" },
  ];
  assert.equal(validateWorkflow(readOnlyLaterStage).valid, true);

  const hostEffect = template();
  hostEffect.stages[0].steps.unshift({ id: "check", kind: "local-check", note: "unwired" });
  assert.equal(validateWorkflow(hostEffect).valid, false);

  const missingOutput = template();
  delete missingOutput.stages[0].artifact;
  assert.equal(validateWorkflow(missingOutput).valid, false);

  const unboundGate = template();
  unboundGate.stop.objective_gate.path = "UNDECLARED.md";
  assert.equal(validateWorkflow(unboundGate).valid, false);

  const unresolvedRepository = template();
  unresolvedRepository.deployment.run_target = { repo: "other", ref: "bound-repo" };
  assert.equal(validateWorkflow(unresolvedRepository).valid, false);

  const ignoredMatrix = template();
  ignoredMatrix.deployment.role_matrix = "silently-ignored";
  assert.equal(validateWorkflow(ignoredMatrix).errors.some((error) =>
    error.path === "$.deployment.role_matrix"), true);
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
  assert.equal(workflow.stages[1].artifact, undefined, "compatibility projection must not fabricate a stage artifact");
  const execution = workflowToExecution(workflow);
  assert.equal(execution.ok, true, JSON.stringify(execution));
  assert.equal(execution.chain.stages[1].transitions.find((rule) => rule.action === "back").target, "plan");
  assert.equal(execution.config.max_iterations, config.max_iterations);
  const resolved = resolveChain(chains, chain.id);
  assert.equal(resolved.ok, true);
  const resolvedWorkflow = workflowFromExecution(resolved.chain, config);
  assert.equal(validateWorkflow(resolvedWorkflow).valid, true);
  assert.equal(workflowToExecution(resolvedWorkflow).ok, true);
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
  assert.equal(deleteUserWorkflow(stateRoot, "my-flow").ok, true);
  assert.equal(resolveWorkflow(stateRoot, "my-flow", chains, configs).code, "unknown-workflow");

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

test("workflow loading bounds the on-disk file before parsing", () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-workflows-oversized-"));
  mkdirSync(join(stateRoot, "workflows"), { recursive: true });
  writeFileSync(join(stateRoot, "workflows", "huge.json"), `${" ".repeat(300 * 1024)}{}`, "utf8");
  assert.deepEqual(listUserWorkflows(stateRoot), {
    ok: false, code: "helix-workflow-unreadable", detail: "huge.json",
  });
});

test("workflow deletion bounds ids and on-disk files before reading them", () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-workflows-delete-bounds-"));
  mkdirSync(join(stateRoot, "workflows"), { recursive: true });
  writeFileSync(join(stateRoot, "workflows", "huge.json"), `${" ".repeat(300 * 1024)}{}`, "utf8");

  assert.deepEqual(deleteUserWorkflow(stateRoot, "huge"), {
    ok: false, code: "helix-workflow-unreadable", detail: "huge",
  });
  assert.deepEqual(deleteUserWorkflow(stateRoot, "a".repeat(65)), {
    ok: false, code: "unknown-workflow", detail: "workflow-id-invalid",
  });
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
