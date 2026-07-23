import {
  chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync,
  statSync, symlinkSync, truncateSync, unlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

import { createWorkflowFromTemplate } from "../dispatch/lib/workflows.mjs";
import { createPiAgentAdapter } from "../dispatch/lib/pi-agent-adapter.mjs";
import { normalizeWorkflowDefinition, stableWorkflowStringify, WORKFLOW_LIMITS } from "../dispatch/workflow/schema.mjs";
import { agent, checkpoint, decision, map, objectiveGate, parallel, pipeline, reduce, subworkflow, terminal, workflow } from "../dispatch/workflow/builder.mjs";
import { executeNamedWorkflow, resumeNamedWorkflow } from "../extensions/lib/helix-execution.mjs";
import { writeTextAtomic } from "../dispatch/lib/persistence.mjs";
import { objectiveGateWorkspaceRef } from "../dispatch/lib/task-loop.mjs";
import { EMPTY_KERNEL_EVENT_PREFIX_REF, kernelEventPrefixRef } from "../dispatch/kernel/state.mjs";
import { executeHelixCommand } from "../extensions/lib/helix-command-core.mjs";
import { saveUserWorkflow, saveUserWorkflowV4 } from "../extensions/lib/helix-workflows.mjs";
import {
  smokeTestWorkflowRuntime,
  workflowRuntimeResultsMatch,
} from "../extensions/lib/helix-workflow-test.mjs";

const packageRoot = new URL("..", import.meta.url).pathname;
const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const chains = readJson("../dispatch/config/chains.json");
const runs = readJson("../dispatch/config/run-configs.json");

test("runtime parity rejects equal aggregate counts with different paths, outputs, or workspaces", () => {
  const result = {
    ok: true,
    status: "succeeded",
    terminal: "succeeded",
    outputs: { route: "left" },
    visits: { start: 1, left: 1, right: 0, succeeded: 1 },
    budget: {
      effects: 0, tokens: 0, cost_micros: 0, max_effects: 1,
      max_tokens: null, max_cost_micros: null, reserved: 0,
    },
    events: [
      { kind: "run-start", run_id: "parity", node_id: "start" },
      { kind: "transition", run_id: "parity", node_id: "start", target: "left" },
    ],
    journal: [],
    elapsed_ms: 1,
  };
  const baseline = { result, workspace_ref: "sha256:" + "a".repeat(64) };
  const modeOnly = structuredClone(baseline);
  modeOnly.result.events[0].execution_mode = "graph-mode";
  modeOnly.result.events[1].edge_id = "start:condition:0";
  modeOnly.result.events[1].edge_kind = "condition";
  assert.equal(workflowRuntimeResultsMatch(baseline, modeOnly), true);
  const differentPath = structuredClone(modeOnly);
  differentPath.result.events[1].target = "right";
  assert.equal(workflowRuntimeResultsMatch(baseline, differentPath), false);
  const differentOutput = structuredClone(modeOnly);
  differentOutput.result.outputs.route = "right";
  assert.equal(workflowRuntimeResultsMatch(baseline, differentOutput), false);
  const differentWorkspace = structuredClone(modeOnly);
  differentWorkspace.workspace_ref = "sha256:" + "b".repeat(64);
  assert.equal(workflowRuntimeResultsMatch(baseline, differentWorkspace), false);
});

function repo(objectFormat = null) {
  const cwd = mkdtempSync(join(tmpdir(), "helix-workflow-exec-"));
  execFileSync("git", ["init", "-q", ...(objectFormat ? [`--object-format=${objectFormat}`] : [])], { cwd });
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
    const outcomes = [];
    for (const executionMode of ["original-mode", "graph-mode"]) {
      const result = await executeNamedWorkflow({
        workflow_id: id,
        task: `Exercise ${template}`,
        run_id: `run-${template}-${executionMode}`,
        execution_mode: executionMode,
        cwd,
        state_root: stateRoot,
        package_root: packageRoot,
        chain_registry: chains,
        run_registry: runs,
        expected_binding_ref: executionBinding(stateRoot, id, null, executionMode),
        now: 1_751_731_200,
      });
      assert.equal(result.ok, true, `${template}/${executionMode}: ${JSON.stringify(result)}`);
      assert.equal(result.converged, true, `${template}/${executionMode}`);
      outcomes.push({
        converged: result.converged, stop_reason: result.stop_reason,
        total_passes: result.total_passes, flow: result.flow, calls: result.calls,
      });
    }
    assert.deepEqual(outcomes[1], outcomes[0], template);
  }
});

test("named workflow original-mode and graph-mode produce the same product outcome with distinct bound evidence", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-workflow-mode-parity-"));
  const cwd = repo();
  installWorkflow(stateRoot, "mode-parity");
  const outcomes = [];
  for (const executionMode of ["original-mode", "graph-mode"]) {
    const runId = executionMode === "original-mode" ? "mode-original" : "mode-graph";
    const result = await executeNamedWorkflow({
      workflow_id: "mode-parity",
      task: "Compare the two execution modes",
      run_id: runId,
      execution_mode: executionMode,
      cwd,
      state_root: stateRoot,
      package_root: packageRoot,
      chain_registry: chains,
      run_registry: runs,
      expected_binding_ref: executionBinding(stateRoot, "mode-parity", null, executionMode),
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.execution_mode, executionMode);
    const statePath = join(stateRoot, "runs", runId, `${runId}.state.json`);
    const publicState = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(publicState.schema_version, 5);
    assert.equal(publicState.execution_mode, executionMode);
    const events = readFileSync(join(stateRoot, "runs", runId, `${runId}.kernel.events.jsonl`), "utf8")
      .trim().split("\n").map((line) => JSON.parse(line));
    const transitions = events.filter((event) => event.kind === "transition");
    assert.ok(transitions.length > 0);
    assert.equal(transitions.every((event) => executionMode === "graph-mode"
      ? typeof event.edge_id === "string" && typeof event.edge_kind === "string"
      : !Object.hasOwn(event, "edge_id") && !Object.hasOwn(event, "edge_kind")), true);
    const watchOptions = {
      stateRoot, runsRoot: join(stateRoot, "runs"), chainRegistry: chains, runRegistry: runs,
    };
    assert.equal(executeHelixCommand(`runs watch ${runId}`, { mode: "print" }, watchOptions).ok, true);
    if (executionMode === "graph-mode") {
      const eventsPath = join(stateRoot, "runs", runId, `${runId}.kernel.events.jsonl`);
      const corruptEdge = structuredClone(events);
      delete corruptEdge.find((event) => event.kind === "transition").edge_id;
      writeFileSync(eventsPath, `${corruptEdge.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
      assert.equal(executeHelixCommand(`runs watch ${runId}`, { mode: "print" }, watchOptions).ok, false);
      const corruptMode = structuredClone(events);
      corruptMode.find((event) => event.kind === "run-start").execution_mode = "original-mode";
      writeFileSync(eventsPath, `${corruptMode.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
      assert.equal(executeHelixCommand(`runs watch ${runId}`, { mode: "print" }, watchOptions).ok, false);
      writeFileSync(eventsPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
      writeFileSync(statePath, `${JSON.stringify({ ...publicState, status: "failed" })}\n`, "utf8");
      assert.equal(executeHelixCommand(`runs watch ${runId}`, { mode: "print" }, watchOptions).ok, false);
      writeFileSync(statePath, `${JSON.stringify(publicState)}\n`, "utf8");
    }
    outcomes.push({
      converged: result.converged,
      stop_reason: result.stop_reason,
      total_passes: result.total_passes,
      flow: result.flow,
      calls: result.calls,
    });
  }
  assert.deepEqual(outcomes[1], outcomes[0]);
});

test("every durably committed terminal stays authoritative through execution state and watch", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-terminal-authority-"));
  const cwd = repo();
  const terminalCases = [
    { status: "succeeded", gatePasses: true, target: "succeeded", code: null },
    { status: "failed", gatePasses: false, target: "stopped", code: "authored-failed" },
    { status: "refused", gatePasses: false, target: "stopped", code: "authored-refused" },
    { status: "cancelled", gatePasses: false, target: "stopped", code: "authored-cancelled" },
  ];
  for (const executionMode of ["original-mode", "graph-mode"]) {
    for (const terminalCase of terminalCases) {
      const workflowId = `terminal-authority-${terminalCase.status}`;
      if (!existsSync(join(stateRoot, "workflows", `${workflowId}.json`))) {
        const built = workflow({
          id: workflowId,
          name: `Terminal authority ${terminalCase.status}`,
          description: `Exercise durable ${terminalCase.status} terminal authority.`,
          start: "objective",
          nodes: {
            objective: objectiveGate("succeeded", "stopped"),
            succeeded: terminal("succeeded"),
            stopped: terminal(
              terminalCase.status === "succeeded" ? "failed" : terminalCase.status,
              terminalCase.status === "succeeded" ? "unused-failure" : terminalCase.code,
            ),
          },
          objective_gate: {
            type: "file-contains",
            path: "README.md",
            contains: terminalCase.gatePasses ? "Empty workflow fixture" : "absent-terminal-marker",
          },
        });
        assert.equal(built.ok, true, JSON.stringify(built.errors));
        assert.equal(saveUserWorkflowV4(stateRoot, built.definition).ok, true);
      }
      const runId = `terminal-authority-${terminalCase.status}-${executionMode}`;
      const result = await executeNamedWorkflow({
        workflow_id: workflowId,
        task: `Commit ${terminalCase.status} terminal evidence`,
        run_id: runId,
        execution_mode: executionMode,
        cwd,
        state_root: stateRoot,
        package_root: packageRoot,
        chain_registry: chains,
        run_registry: runs,
        expected_binding_ref: executionBinding(stateRoot, workflowId, null, executionMode),
      });
      const label = `${executionMode}/${terminalCase.status}`;
      assert.equal(result.terminal_authoritative, true, label);
      assert.equal(result.converged, terminalCase.status === "succeeded", label);
      assert.equal(result.stop_reason, terminalCase.status, label);
      assert.equal(result.code, terminalCase.code, label);
      const publicState = JSON.parse(readFileSync(
        join(stateRoot, "runs", runId, `${runId}.state.json`),
        "utf8",
      ));
      assert.equal(publicState.completed, true, label);
      assert.equal(publicState.status, terminalCase.status, label);
      assert.equal(publicState.code, terminalCase.code, label);
      assert.equal(publicState.terminal, terminalCase.target, label);
      const watched = executeHelixCommand(`runs watch ${runId}`, { mode: "print" }, {
        stateRoot, runsRoot: join(stateRoot, "runs"), chainRegistry: chains, runRegistry: runs,
      });
      assert.equal(watched.ok, true, `${label}: ${JSON.stringify(watched)}`);
      assert.equal(watched.details.finished, true, label);
      assert.equal(watched.details.status, terminalCase.status, label);
      assert.equal(watched.details.code, terminalCase.code, label);
      assert.equal(watched.details.terminal, terminalCase.target, label);
    }
  }
});

test("terminal projection debt preserves and repairs every authored status in both modes", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-terminal-projection-debt-"));
  const cwd = repo();
  const terminalCases = [
    { status: "succeeded", gatePasses: true, target: "succeeded", code: null },
    { status: "failed", gatePasses: false, target: "stopped", code: "projection-failed" },
    { status: "refused", gatePasses: false, target: "stopped", code: "projection-refused" },
    { status: "cancelled", gatePasses: false, target: "stopped", code: "projection-cancelled" },
  ];
  for (const terminalCase of terminalCases) {
    const workflowId = `terminal-projection-${terminalCase.status}`;
    const built = workflow({
      id: workflowId,
      name: `Terminal projection ${terminalCase.status}`,
      description: `Repair ${terminalCase.status} terminal projection debt.`,
      start: "objective",
      nodes: {
        objective: objectiveGate("succeeded", "stopped"),
        succeeded: terminal("succeeded"),
        stopped: terminal(
          terminalCase.status === "succeeded" ? "failed" : terminalCase.status,
          terminalCase.status === "succeeded" ? "unused-projection-failure" : terminalCase.code,
        ),
      },
      objective_gate: {
        type: "file-contains",
        path: "README.md",
        contains: terminalCase.gatePasses ? "Empty workflow fixture" : "absent-projection-marker",
      },
    });
    assert.equal(built.ok, true, JSON.stringify(built.errors));
    assert.equal(saveUserWorkflowV4(stateRoot, built.definition).ok, true);
  }

  for (const executionMode of ["original-mode", "graph-mode"]) {
    for (const terminalCase of terminalCases) {
      const workflowId = `terminal-projection-${terminalCase.status}`;
      const runId = `${workflowId}-${executionMode}`;
      const statePath = join(stateRoot, "runs", runId, `${runId}.state.json`);
      const checkpointPath = join(stateRoot, "private", "runs", runId, "kernel-checkpoint.json");
      const binding = executionBinding(stateRoot, workflowId, null, executionMode);
      const result = await executeNamedWorkflow({
        workflow_id: workflowId,
        task: `Retain ${terminalCase.status} while public projection fails`,
        run_id: runId,
        execution_mode: executionMode,
        cwd,
        state_root: stateRoot,
        package_root: packageRoot,
        chain_registry: chains,
        run_registry: runs,
        expected_binding_ref: binding,
        write_text_atomic(root, relativePath, data, options) {
          if (relativePath === `${runId}.state.json` && JSON.parse(data).completed === true) {
            throw new Error("synthetic-terminal-projection-failure");
          }
          return writeTextAtomic(root, relativePath, data, options);
        },
      });
      const label = `${executionMode}/${terminalCase.status}`;
      assert.equal(result.terminal_authoritative, true, label);
      assert.equal(result.stop_reason, terminalCase.status, label);
      assert.equal(result.code, terminalCase.code, label);
      assert.equal(result.resumable, false, label);
      assert.equal(JSON.parse(readFileSync(statePath, "utf8")).completed, false, label);
      assert.equal(JSON.parse(readFileSync(checkpointPath, "utf8"))
        .maintenance.public_projection_pending, true, label);
      const eventsPath = join(stateRoot, "runs", runId, `${runId}.kernel.events.jsonl`);
      const authenticState = readFileSync(statePath, "utf8");
      const authenticEvents = readFileSync(eventsPath, "utf8");
      const authenticCheckpoint = JSON.parse(readFileSync(checkpointPath, "utf8"));
      let adapterReads = 0;
      const hostileAdapter = new Proxy({}, {
        get() {
          adapterReads += 1;
          throw new Error("projection relation must reject before provider inspection");
        },
      });
      for (const invalidDebt of ["false", "absent"]) {
        const invalidCheckpoint = structuredClone(authenticCheckpoint);
        if (invalidDebt === "false") invalidCheckpoint.maintenance.public_projection_pending = false;
        else {
          invalidCheckpoint.schema_version = 1;
          delete invalidCheckpoint.maintenance;
        }
        writeFileSync(checkpointPath, JSON.stringify(invalidCheckpoint), "utf8");
        const checkpointBefore = readFileSync(checkpointPath, "utf8");
        let persistenceCalls = 0;
        let eventCalls = 0;
        const refused = await resumeNamedWorkflow({
          run_id: runId,
          task: `Retain ${terminalCase.status} while public projection fails`,
          cwd,
          state_root: stateRoot,
          package_root: packageRoot,
          chain_registry: chains,
          run_registry: runs,
          expected_binding_ref: binding,
          adapter: hostileAdapter,
          onEvent() { eventCalls += 1; },
          write_text_atomic(...args) {
            persistenceCalls += 1;
            return writeTextAtomic(...args);
          },
        });
        assert.equal(refused.code, "kernel-resume-record-invalid", `${label}/${invalidDebt}`);
        assert.equal(adapterReads, 0, `${label}/${invalidDebt}/adapter`);
        assert.equal(persistenceCalls, 0, `${label}/${invalidDebt}/persistence`);
        assert.equal(eventCalls, 0, `${label}/${invalidDebt}/events`);
        assert.equal(readFileSync(statePath, "utf8"), authenticState, `${label}/${invalidDebt}/state`);
        assert.equal(readFileSync(eventsPath, "utf8"), authenticEvents, `${label}/${invalidDebt}/event-file`);
        assert.equal(readFileSync(checkpointPath, "utf8"), checkpointBefore, `${label}/${invalidDebt}/checkpoint`);
      }
      writeFileSync(checkpointPath, JSON.stringify(authenticCheckpoint), "utf8");
      const watchOptions = {
        stateRoot, runsRoot: join(stateRoot, "runs"), chainRegistry: chains, runRegistry: runs,
      };
      const pendingWatch = executeHelixCommand(`runs watch ${runId}`, { mode: "print" }, watchOptions);
      assert.equal(pendingWatch.ok, true, `${label}: ${JSON.stringify(pendingWatch)}`);
      assert.equal(pendingWatch.details.finished, false, label);

      for (const failedProjectionWrite of [
        `${runId}.kernel.events.jsonl`,
        `${runId}.state.json`,
      ]) {
        const checkpointBefore = readFileSync(checkpointPath, "utf8");
        const failedRepair = await resumeNamedWorkflow({
          run_id: runId,
          task: `Retain ${terminalCase.status} while public projection fails`,
          cwd,
          state_root: stateRoot,
          package_root: packageRoot,
          chain_registry: chains,
          run_registry: runs,
          expected_binding_ref: binding,
          adapter: hostileAdapter,
          write_text_atomic(root, relativePath, data, options) {
            if (relativePath === failedProjectionWrite) {
              throw new Error("synthetic-terminal-projection-repair-failure");
            }
            return writeTextAtomic(root, relativePath, data, options);
          },
        });
        assert.equal(failedRepair.code, "kernel-resume-events-invalid",
          `${label}/${failedProjectionWrite}`);
        assert.equal(adapterReads, 0, `${label}/${failedProjectionWrite}/adapter`);
        assert.equal(readFileSync(statePath, "utf8"), authenticState,
          `${label}/${failedProjectionWrite}/state`);
        assert.equal(readFileSync(eventsPath, "utf8"), authenticEvents,
          `${label}/${failedProjectionWrite}/events`);
        assert.equal(readFileSync(checkpointPath, "utf8"), checkpointBefore,
          `${label}/${failedProjectionWrite}/checkpoint`);
      }

      const clearFailure = await resumeNamedWorkflow({
        run_id: runId,
        task: `Retain ${terminalCase.status} while public projection fails`,
        cwd,
        state_root: stateRoot,
        package_root: packageRoot,
        chain_registry: chains,
        run_registry: runs,
        expected_binding_ref: binding,
        write_text_atomic(root, relativePath, data, options) {
          if (relativePath === join("private", "runs", runId, "kernel-checkpoint.json")) {
            throw new Error("synthetic-terminal-debt-clear-failure");
          }
          return writeTextAtomic(root, relativePath, data, options);
        },
      });
      assert.equal(clearFailure.code, "kernel-resume-projection-write-failed", label);
      assert.equal(JSON.parse(readFileSync(statePath, "utf8")).completed, true, label);
      assert.equal(JSON.parse(readFileSync(checkpointPath, "utf8"))
        .maintenance.public_projection_pending, true, label);
      const repaired = await resumeNamedWorkflow({
        run_id: runId,
        task: `Retain ${terminalCase.status} while public projection fails`,
        cwd,
        state_root: stateRoot,
        package_root: packageRoot,
        chain_registry: chains,
        run_registry: runs,
        expected_binding_ref: binding,
        adapter: hostileAdapter,
      });
      assert.equal(adapterReads, 0, `${label}/maintenance-retry`);
      assert.equal(repaired.terminal_authoritative, true, label);
      assert.equal(repaired.stop_reason, terminalCase.status, label);
      assert.equal(repaired.code, terminalCase.code, label);
      assert.equal(repaired.resumable, false, label);
      const repairedState = JSON.parse(readFileSync(statePath, "utf8"));
      assert.equal(repairedState.completed, true, label);
      assert.equal(repairedState.status, terminalCase.status, label);
      assert.equal(repairedState.code, terminalCase.code, label);
      assert.equal(repairedState.terminal, terminalCase.target, label);
      assert.equal(JSON.parse(readFileSync(checkpointPath, "utf8"))
        .maintenance.public_projection_pending, false, label);
      const repairedWatch = executeHelixCommand(`runs watch ${runId}`, { mode: "print" }, watchOptions);
      assert.equal(repairedWatch.ok, true, `${label}: ${JSON.stringify(repairedWatch)}`);
      assert.equal(repairedWatch.details.finished, true, label);
      assert.equal(repairedWatch.details.status, terminalCase.status, label);
      assert.equal(repairedWatch.details.code, terminalCase.code, label);
      assert.equal(repairedWatch.details.terminal, terminalCase.target, label);
    }
  }
});

test("terminal projection repair refuses forged scheduler authority without changing durable debt", async () => {
  for (const executionMode of ["original-mode", "graph-mode"]) {
    const stateRoot = mkdtempSync(join(tmpdir(), `helix-terminal-admission-${executionMode}-`));
    const cwd = repo();
    const workflowId = `terminal-admission-${executionMode}`;
    const runId = `terminal-admission-run-${executionMode}`;
    const built = workflow({
      id: workflowId,
      name: `Terminal admission ${executionMode}`,
      description: "Projection repair requires complete scheduler resume authority.",
      start: "objective",
      nodes: {
        objective: objectiveGate("succeeded", "failed"),
        succeeded: terminal("succeeded"),
        failed: terminal("failed", "authored-terminal-failure"),
      },
      objective_gate: { type: "file-contains", path: "README.md", contains: "absent-terminal-evidence" },
    });
    assert.equal(built.ok, true, JSON.stringify(built.errors));
    assert.equal(saveUserWorkflowV4(stateRoot, built.definition).ok, true);
    const binding = executionBinding(stateRoot, workflowId, null, executionMode);
    const task = "Preserve exact terminal projection authority";
    const executed = await executeNamedWorkflow({
      workflow_id: workflowId,
      task,
      run_id: runId,
      execution_mode: executionMode,
      cwd,
      state_root: stateRoot,
      package_root: packageRoot,
      chain_registry: chains,
      run_registry: runs,
      expected_binding_ref: binding,
      write_text_atomic(root, relativePath, data, options) {
        if (relativePath === `${runId}.state.json` && JSON.parse(data).completed === true) {
          throw new Error("synthetic-terminal-projection-failure");
        }
        return writeTextAtomic(root, relativePath, data, options);
      },
    });
    assert.equal(executed.terminal_authoritative, true, executionMode);
    const runPath = join(stateRoot, "runs", runId);
    const statePath = join(runPath, `${runId}.state.json`);
    const eventsPath = join(runPath, `${runId}.kernel.events.jsonl`);
    const checkpointPath = join(stateRoot, "private", "runs", runId, "kernel-checkpoint.json");
    const authenticState = readFileSync(statePath, "utf8");
    const authenticEvents = readFileSync(eventsPath, "utf8");
    const authenticCheckpoint = JSON.parse(readFileSync(checkpointPath, "utf8"));
    assert.equal(authenticCheckpoint.maintenance.public_projection_pending, true, executionMode);

    const cases = [
      ["terminal status", (document) => { document.scheduler.terminal_result.status = "succeeded"; }],
      ["terminal code", (document) => { document.scheduler.terminal_result.code = "forged-terminal-code"; }],
      ["current node", (document) => { document.scheduler.current = "succeeded"; }],
      ["task identity", (document) => { document.scheduler.task_ref = `sha256:${"1".repeat(64)}`; }],
      ["runtime identity", (document) => { document.scheduler.runtime_ref = `sha256:${"2".repeat(64)}`; }],
      ["budget ceiling", (document) => { document.scheduler.budget.max_effects += 1; }],
      ["journal prefix", (document) => { document.scheduler.journal_entries += 1; }],
      ...(executionMode === "graph-mode"
        ? [["execution mode", (document) => { document.scheduler.execution_mode = "original-mode"; }]]
        : []),
    ];
    for (const [label, mutate] of cases) {
      const forged = structuredClone(authenticCheckpoint);
      mutate(forged);
      writeFileSync(checkpointPath, JSON.stringify(forged), "utf8");
      const checkpointBefore = readFileSync(checkpointPath, "utf8");
      const refused = await resumeNamedWorkflow({
        run_id: runId,
        task,
        cwd,
        state_root: stateRoot,
        package_root: packageRoot,
        chain_registry: chains,
        run_registry: runs,
        expected_binding_ref: binding,
      });
      assert.equal(refused.ok, false, `${executionMode}/${label}: ${JSON.stringify(refused)}`);
      assert.equal(readFileSync(statePath, "utf8"), authenticState, `${executionMode}/${label}/state`);
      assert.equal(readFileSync(eventsPath, "utf8"), authenticEvents, `${executionMode}/${label}/events`);
      assert.equal(readFileSync(checkpointPath, "utf8"), checkpointBefore, `${executionMode}/${label}/checkpoint`);
    }

    const forgedEvents = authenticEvents.trim().split("\n").map((line) => JSON.parse(line));
    forgedEvents.at(-1).code = "forged-event-code";
    const forgedEventsText = `${forgedEvents.map((event) => JSON.stringify(event)).join("\n")}\n`;
    const forgedEventCheckpoint = structuredClone(authenticCheckpoint);
    forgedEventCheckpoint.scheduler.event_ref = kernelEventPrefixRef(forgedEvents);
    writeFileSync(eventsPath, forgedEventsText, "utf8");
    writeFileSync(checkpointPath, JSON.stringify(forgedEventCheckpoint), "utf8");
    const eventPairRefused = await resumeNamedWorkflow({
      run_id: runId,
      task,
      cwd,
      state_root: stateRoot,
      package_root: packageRoot,
      chain_registry: chains,
      run_registry: runs,
      expected_binding_ref: binding,
    });
    assert.equal(eventPairRefused.code, "kernel-checkpoint-terminal-invalid", executionMode);
    assert.equal(readFileSync(statePath, "utf8"), authenticState, `${executionMode}/event-pair/state`);
    assert.equal(readFileSync(eventsPath, "utf8"), forgedEventsText, `${executionMode}/event-pair/events`);
    assert.equal(JSON.parse(readFileSync(checkpointPath, "utf8"))
      .maintenance.public_projection_pending, true, `${executionMode}/event-pair/debt`);

    writeFileSync(eventsPath, authenticEvents, "utf8");
    writeFileSync(checkpointPath, JSON.stringify(authenticCheckpoint), "utf8");
    const wrongBinding = await resumeNamedWorkflow({
      run_id: runId,
      task,
      cwd,
      state_root: stateRoot,
      package_root: packageRoot,
      chain_registry: chains,
      run_registry: runs,
      expected_binding_ref: `sha256:${"3".repeat(64)}`,
    });
    assert.equal(wrongBinding.code, "workflow-preflight-drift", executionMode);
    assert.equal(readFileSync(statePath, "utf8"), authenticState, `${executionMode}/binding/state`);
    assert.equal(JSON.parse(readFileSync(checkpointPath, "utf8"))
      .maintenance.public_projection_pending, true, `${executionMode}/binding/debt`);

    const repaired = await resumeNamedWorkflow({
      run_id: runId,
      task,
      cwd,
      state_root: stateRoot,
      package_root: packageRoot,
      chain_registry: chains,
      run_registry: runs,
      expected_binding_ref: binding,
    });
    assert.equal(repaired.terminal_authoritative, true, executionMode);
    assert.equal(repaired.code, "authored-terminal-failure", executionMode);
    assert.equal(JSON.parse(readFileSync(statePath, "utf8")).completed, true, executionMode);
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
    objective_check: "real",
    nodes_exercised: 6,
    effects_exercised: 8,
    transitions_exercised: 8,
    objective_gate_exercised: true,
    mode_comparison: {
      matched: true,
      original_mode: {
        execution_mode: "original-mode", status: "succeeded", terminal: "succeeded",
        nodes_exercised: 6, effects_exercised: 8, transitions_exercised: 8, objective_gate_exercised: true,
      },
      graph_mode: {
        execution_mode: "graph-mode", status: "succeeded", terminal: "succeeded",
        nodes_exercised: 6, effects_exercised: 8, transitions_exercised: 8, objective_gate_exercised: true,
      },
    },
  });
  const after = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd, encoding: "utf8" });
  assert.equal(after, before);
});

test("runtime smoke fingerprints untracked candidate artifacts in SHA-256 repositories", async () => {
  const cwd = repo("sha256");
  const created = createWorkflowFromTemplate({ id: "sha256-smoke", template: "implement-review" });
  assert.equal(created.ok, true);
  const outcome = await smokeTestWorkflowRuntime({ workflow: created.workflow, cwd, package_root: packageRoot });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(outcome.mode_comparison.matched, true);
});

function rawTreeGit(entries) {
  const oid = "1".repeat(40);
  const baseline = "2".repeat(40);
  const tree = Buffer.concat(entries.flatMap((entry) => [
    Buffer.from(`${entry.mode ?? "100644"} blob ${oid}     ${entry.size}\t`, "ascii"),
    Buffer.from(entry.path, "utf8"),
    Buffer.from([0]),
  ]));
  const blobs = new Map(entries.map((entry) => {
    const declared = Number(entry.size);
    const bytes = entry.bytes ?? (Number.isSafeInteger(declared) && declared >= 0
      && declared <= 16 * 1024 * 1024 ? Buffer.alloc(declared) : Buffer.alloc(0));
    return [oid, bytes];
  }));
  return (_cwd, args, options = {}) => {
    const command = args.join(" ");
    const output = (value) => ({
      status: 0,
      stdout: options.encoding === null ? Buffer.from(value) : String(value),
    });
    if (command === "rev-parse --show-toplevel") return output("/tmp/helix-virtual-smoke\n");
    if (command === "rev-parse --verify HEAD") return output(`${baseline}\n`);
    if (command === "rev-parse --show-object-format") return output("sha1\n");
    if (command === `ls-tree -r -z -l --full-tree ${baseline}`) return output(tree);
    if (command === `cat-file blob ${oid}`) return output(blobs.get(oid));
    if (command === "worktree list --porcelain -z") return output(Buffer.alloc(0));
    return { status: 1, stdout: options.encoding === null ? Buffer.alloc(0) : "" };
  };
}

test("runtime smoke admits exact manifest limits and refuses over-limit trees before scratch mutation", async () => {
  const built = workflow({
    id: "manifest-capacity",
    name: "Manifest capacity",
    description: "Exercise raw baseline admission limits.",
    start: "objective",
    nodes: {
      objective: objectiveGate("succeeded", "failed"),
      succeeded: terminal("succeeded"),
      failed: terminal("failed", "manifest-capacity-failed"),
    },
    objective_gate: { type: "file-contains", path: "README.md", contains: "fixture" },
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const run = async (entries) => {
    let rootCalls = 0;
    const outcome = await smokeTestWorkflowRuntime({
      workflow: built.definition,
      cwd: "/tmp/helix-virtual-smoke",
      effects: {
        git: rawTreeGit(entries),
        make_root() {
          rootCalls += 1;
          throw new Error("stop after manifest admission");
        },
      },
    });
    return { outcome, rootCalls };
  };
  const exactFile = await run([{
    path: "exact.bin",
    size: 16 * 1024 * 1024,
    bytes: Buffer.alloc(16 * 1024 * 1024),
  }]);
  assert.equal(exactFile.outcome.code, "workflow-runtime-smoke-worktree-failed");
  assert.equal(exactFile.rootCalls, 1);

  const exactAggregate = await run(Array.from({ length: 4 }, (_, index) => ({
    path: `aggregate-${index}.bin`,
    size: 16 * 1024 * 1024,
    bytes: Buffer.alloc(16 * 1024 * 1024),
  })));
  assert.equal(exactAggregate.outcome.code, "workflow-runtime-smoke-worktree-failed");
  assert.equal(exactAggregate.rootCalls, 1);

  const exactCount = await run(Array.from({ length: 16_384 }, (_, index) => ({
    path: `empty-${String(index).padStart(5, "0")}`,
    size: 0,
    bytes: Buffer.alloc(0),
  })));
  assert.equal(exactCount.outcome.code, "workflow-runtime-smoke-worktree-failed");
  assert.equal(exactCount.rootCalls, 1);

  for (const entries of [
    [{ path: "oversized.bin", size: 16 * 1024 * 1024 + 1 }],
    Array.from({ length: 5 }, (_, index) => ({
      path: `over-aggregate-${index}.bin`,
      size: 16 * 1024 * 1024,
    })),
    Array.from({ length: 16_385 }, (_, index) => ({
      path: `over-count-${String(index).padStart(5, "0")}`,
      size: 0,
    })),
    [{ path: "unsafe-arithmetic.bin", size: "999999999999999999999999999999999999" }],
  ]) {
    const refused = await run(entries);
    assert.equal(refused.outcome.code, "workflow-runtime-smoke-baseline-capacity-exceeded");
    assert.equal(refused.rootCalls, 0);
  }
});

test("runtime smoke preserves raw POSIX paths and symlink targets byte-for-byte", {
  skip: process.platform === "win32",
}, async () => {
  const cwd = repo();
  const rawTarget = Buffer.from([0x6d, 0x69, 0x73, 0x73, 0x69, 0x6e, 0x67, 0x2d, 0x82]);
  symlinkSync(rawTarget, join(cwd, "raw-link"));
  writeFileSync(join(cwd, "tab\tname"), "tab path\n");
  writeFileSync(join(cwd, "line\nname"), "newline path\n");
  writeFileSync(join(cwd, "-leading-dash"), "dash path\n");
  execFileSync("git", ["add", "-A"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "raw path baseline"], { cwd });
  assert.match(objectiveGateWorkspaceRef(cwd), /^sha256:[0-9a-f]{64}$/);
  const built = workflow({
    id: "raw-path-smoke",
    name: "Raw path smoke",
    description: "Preserve raw indexed bytes in both execution modes.",
    start: "objective",
    nodes: {
      objective: objectiveGate("succeeded", "failed"),
      succeeded: terminal("succeeded"),
      failed: terminal("failed", "raw-path-failed"),
    },
    objective_gate: { type: "file-contains", path: "README.md", contains: "Empty workflow fixture" },
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const outcome = await smokeTestWorkflowRuntime({ workflow: built.definition, cwd });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(outcome.mode_comparison.matched, true);
});

test("runtime smoke admits invalid UTF-8 Git paths only when filesystem and fingerprint boundaries preserve them", {
  skip: process.platform === "win32",
}, async () => {
  const cwd = repo();
  const rawBlob = execFileSync("git", ["hash-object", "-w", "--stdin"], {
    cwd,
    input: "raw path bytes\n",
    encoding: "utf8",
  }).trim();
  const readmeBlob = execFileSync("git", ["rev-parse", "HEAD:README.md"], {
    cwd,
    encoding: "utf8",
  }).trim();
  const rawPath = Buffer.from([0x72, 0x61, 0x77, 0x2d, 0x80, 0x2d, 0x66, 0x69, 0x6c, 0x65]);
  const treeInput = Buffer.concat([
    Buffer.from(`100644 blob ${readmeBlob}\tREADME.md\0`, "ascii"),
    Buffer.from(`100644 blob ${rawBlob}\t`, "ascii"),
    rawPath,
    Buffer.from([0]),
  ]);
  const tree = execFileSync("git", ["mktree", "-z"], {
    cwd,
    input: treeInput,
    encoding: "utf8",
  }).trim();
  const parent = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
  const commit = execFileSync("git", ["commit-tree", tree, "-p", parent], {
    cwd,
    input: "raw path tree\n",
    encoding: "utf8",
  }).trim();
  execFileSync("git", ["update-ref", "HEAD", commit, parent], { cwd });
  const probeRoot = mkdtempSync(join(tmpdir(), "helix-raw-path-capability-"));
  const probePath = Buffer.concat([Buffer.from(`${probeRoot}/`), Buffer.from([0x80])]);
  let rawPathsSupported = false;
  try {
    writeFileSync(probePath, "");
    const realized = realpathSync(probePath, { encoding: "buffer" });
    rawPathsSupported = Buffer.isBuffer(realized);
  } catch (error) {
    assert.ok(["EILSEQ", "EINVAL", "ENOTSUP", "ENOENT"].includes(error?.code), error?.code);
  } finally {
    rmSync(probeRoot, { recursive: true, force: true });
  }
  const before = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd, encoding: "utf8" });
  const built = workflow({
    id: "raw-name-capability",
    name: "Raw name capability",
    description: "Admit raw path bytes only when the host preserves them.",
    start: "objective",
    nodes: {
      objective: objectiveGate("succeeded", "failed"),
      succeeded: terminal("succeeded"),
      failed: terminal("failed", "raw-name-failed"),
    },
    objective_gate: { type: "file-contains", path: "README.md", contains: "Empty workflow fixture" },
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const outcome = await smokeTestWorkflowRuntime({ workflow: built.definition, cwd });
  if (rawPathsSupported) assert.equal(outcome.ok, true, JSON.stringify(outcome));
  else assert.deepEqual(outcome, { ok: false, code: "workflow-runtime-smoke-baseline-unsupported" });
  const after = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd, encoding: "utf8" });
  assert.equal(after, before);
});

function namesAreDistinctAndFingerprintableOnScratchFilesystem(left, right) {
  const root = mkdtempSync(join(tmpdir(), "helix-name-distinction-"));
  const raw = (name) => Buffer.concat([Buffer.from(root), Buffer.from(sep), name]);
  try {
    try {
      writeFileSync(raw(left), "", { flag: "wx" });
    } catch (error) {
      if (["EILSEQ", "EINVAL", "ENOTSUP"].includes(error?.code)) return "unsupported";
      throw error;
    }
    try {
      writeFileSync(raw(right), "", { flag: "wx" });
    } catch (error) {
      if (error?.code === "EEXIST") return false;
      throw error;
    }
    try {
      const realized = [
        realpathSync(Buffer.from(root), { encoding: "buffer" }),
        realpathSync(raw(left), { encoding: "buffer" }),
        realpathSync(raw(right), { encoding: "buffer" }),
      ];
      return realized.every((path) => Buffer.isBuffer(path)) ? true : "unsupported";
    } catch (error) {
      if (["EILSEQ", "EINVAL", "ENOTSUP", "ENOENT"].includes(error?.code)) return "unsupported";
      throw error;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("runtime smoke proves raw and Unicode collision classes before worktree registration", async () => {
  const cases = [
    {
      label: "raw-case-fold",
      left: Buffer.from([0x41, 0x2d, 0x80]),
      right: Buffer.from([0x61, 0x2d, 0x80]),
    },
    {
      label: "unicode-full-case-fold",
      left: Buffer.from("\u03c3", "utf8"),
      right: Buffer.from("\u03c2", "utf8"),
    },
  ];
  const built = workflow({
    id: "manifest-collision",
    name: "Manifest collision",
    description: "Prove every raw manifest path is distinct on the scratch filesystem.",
    start: "objective",
    nodes: {
      objective: objectiveGate("succeeded", "failed"),
      succeeded: terminal("succeeded"),
      failed: terminal("failed", "manifest-collision-failed"),
    },
    objective_gate: { type: "file-contains", path: "README.md", contains: "fixture" },
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  for (const candidate of cases) {
    const distinct = namesAreDistinctAndFingerprintableOnScratchFilesystem(
      candidate.left,
      candidate.right,
    );
    const baseGit = rawTreeGit([
      { path: candidate.left, size: 0, bytes: Buffer.alloc(0) },
      { path: candidate.right, size: 0, bytes: Buffer.alloc(0) },
    ]);
    let addCalls = 0;
    const outcome = await smokeTestWorkflowRuntime({
      workflow: built.definition,
      cwd: "/tmp/helix-virtual-smoke",
      effects: {
        git(cwd, args, options) {
          if (args[0] === "worktree" && args[1] === "add") addCalls += 1;
          return baseGit(cwd, args, options);
        },
      },
    });
    if (distinct === true) {
      assert.equal(addCalls, 1, candidate.label);
      assert.equal(outcome.code, "workflow-runtime-smoke-worktree-failed", candidate.label);
    } else {
      assert.equal(addCalls, 0, candidate.label);
      assert.deepEqual(outcome, {
        ok: false,
        code: "workflow-runtime-smoke-baseline-unsupported",
      }, candidate.label);
    }
  }
});

test("runtime smoke proves executable mode before worktree registration", async () => {
  const built = workflow({
    id: "manifest-executable-mode",
    name: "Manifest executable mode",
    description: "Prove the scratch filesystem preserves the Git executable bit.",
    start: "objective",
    nodes: {
      objective: objectiveGate("succeeded", "failed"),
      succeeded: terminal("succeeded"),
      failed: terminal("failed", "manifest-executable-mode-failed"),
    },
    objective_gate: { type: "file-contains", path: "README.md", contains: "fixture" },
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const baseGit = rawTreeGit([{
    path: Buffer.from("executable-check"),
    mode: "100755",
    size: 0,
    bytes: Buffer.alloc(0),
  }]);
  let addCalls = 0;
  const outcome = await smokeTestWorkflowRuntime({
    workflow: built.definition,
    cwd: "/tmp/helix-virtual-smoke",
    effects: {
      git(cwd, args, options) {
        if (args[0] === "worktree" && args[1] === "add") addCalls += 1;
        return baseGit(cwd, args, options);
      },
      chmod(path, mode) {
        chmodSync(path, mode & ~0o111);
      },
    },
  });
  assert.equal(addCalls, 0);
  assert.deepEqual(outcome, {
    ok: false,
    code: "workflow-runtime-smoke-baseline-unsupported",
  });
});

function ordinaryGitEffect(cwd, args, options = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: options.encoding === null ? null : (options.encoding ?? "utf8"),
    input: options.input,
    maxBuffer: options.maxBuffer,
    timeout: 30_000,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? (options.encoding === null ? Buffer.alloc(0) : ""),
  };
}

test("runtime smoke retains partial-add residue that cannot be reconciled", async () => {
  const cwd = repo();
  const created = createWorkflowFromTemplate({ id: "partial-add-cleanup", template: "implement-review" });
  assert.equal(created.ok, true);
  let scratchRoot = null;
  let intercepted = false;
  const outcome = await smokeTestWorkflowRuntime({
    workflow: created.workflow,
    cwd,
    effects: {
      make_root() {
        scratchRoot = mkdtempSync(join(tmpdir(), "helix-smoke-partial-add-"));
        return scratchRoot;
      },
      git(effectCwd, args, options) {
        if (!intercepted && args[0] === "worktree" && args[1] === "add") {
          intercepted = true;
          mkdirSync(args[4]);
          return { status: 1, stdout: options?.encoding === null ? Buffer.alloc(0) : "" };
        }
        return ordinaryGitEffect(effectCwd, args, options);
      },
    },
  });
  assert.equal(intercepted, true);
  assert.deepEqual(outcome, { ok: false, code: "workflow-runtime-smoke-cleanup-failed" });
  assert.equal(existsSync(join(scratchRoot, "original-mode")), true);
  rmSync(scratchRoot, { recursive: true, force: true });
});

test("runtime smoke never treats lexical alias removal as physical checkout cleanup", async () => {
  const cwd = repo();
  const created = createWorkflowFromTemplate({ id: "physical-cleanup", template: "implement-review" });
  assert.equal(created.ok, true);
  const physicalRoot = mkdtempSync(join(tmpdir(), "helix-smoke-physical-root-"));
  const aliasParent = mkdtempSync(join(tmpdir(), "helix-smoke-alias-parent-"));
  const aliasRoot = join(aliasParent, "scratch");
  symlinkSync(physicalRoot, aliasRoot, "dir");
  let hideScratchRegistrations = false;
  const outcome = await smokeTestWorkflowRuntime({
    workflow: created.workflow,
    cwd,
    effects: {
      make_root: () => aliasRoot,
      git(effectCwd, args, options) {
        if (hideScratchRegistrations && args.join(" ") === "worktree list --porcelain -z") {
          return { status: 0, stdout: options?.encoding === null ? Buffer.alloc(0) : "" };
        }
        return ordinaryGitEffect(effectCwd, args, options);
      },
      remove_worktree() {
        hideScratchRegistrations = true;
        if (existsSync(aliasRoot)) unlinkSync(aliasRoot);
        return { status: 0 };
      },
      remove_root() {
        throw new Error("physical recovery root must be retained");
      },
    },
  });
  assert.deepEqual(outcome, { ok: false, code: "workflow-runtime-smoke-cleanup-failed" });
  for (const mode of ["original-mode", "graph-mode"]) {
    const physicalCheckout = join(physicalRoot, mode);
    assert.equal(existsSync(physicalCheckout), true, mode);
    execFileSync("git", ["worktree", "remove", "--force", physicalCheckout], { cwd });
  }
  rmSync(physicalRoot, { recursive: true, force: true });
  rmSync(aliasParent, { recursive: true, force: true });
});

test("runtime smoke preserves recovery worktrees when Git removal remains registered", async () => {
  const built = workflow({
    id: "cleanup-recovery",
    name: "Cleanup recovery",
    description: "Cleanup uncertainty dominates an earlier workflow result.",
    start: "objective",
    nodes: {
      objective: objectiveGate("succeeded", "failed"),
      succeeded: terminal("succeeded"),
      failed: terminal("failed", "expected-smoke-failure"),
    },
    objective_gate: { type: "file-contains", path: "README.md", contains: "absent-cleanup-marker" },
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  for (const linked of [false, true]) {
    const primary = repo();
    const sourceRoot = mkdtempSync(join(tmpdir(), "helix-smoke-cleanup-source-"));
    const linkedPath = join(sourceRoot, "linked");
    if (linked) execFileSync("git", ["worktree", "add", "-q", "--detach", linkedPath], { cwd: primary });
    const cwd = linked ? linkedPath : primary;
    let scratchRoot = null;
    const attempted = [];
    const outcome = await smokeTestWorkflowRuntime({
      workflow: built.definition,
      cwd,
      effects: {
        make_root() {
          scratchRoot = mkdtempSync(join(tmpdir(), "helix-smoke-cleanup-recovery-"));
          return scratchRoot;
        },
        remove_worktree(repoRoot, checkout) {
          attempted.push({ repoRoot, checkout });
          return { status: 1 };
        },
      },
    });
    const label = linked ? "linked" : "ordinary";
    assert.deepEqual(outcome, { ok: false, code: "workflow-runtime-smoke-cleanup-failed" }, label);
    assert.equal(attempted.length, 2, label);
    assert.equal(existsSync(scratchRoot), true, label);
    const registered = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd,
      encoding: "utf8",
    });
    for (const { checkout } of attempted) {
      assert.equal(registered.includes(`worktree ${realpathSync(checkout)}\n`), true, `${label}/${checkout}`);
      assert.equal(existsSync(checkout), true, `${label}/${checkout}/preserved`);
    }
    for (const { repoRoot, checkout } of attempted) {
      execFileSync("git", ["worktree", "remove", "--force", checkout], { cwd: repoRoot });
    }
    rmSync(scratchRoot, { recursive: true, force: true });
    if (linked) execFileSync("git", ["worktree", "remove", "--force", linkedPath], { cwd: primary });
  }
});

test("runtime smoke types root-deletion failure after every worktree is unregistered", async () => {
  const cwd = repo();
  const created = createWorkflowFromTemplate({ id: "cleanup-root-failure", template: "implement-review" });
  assert.equal(created.ok, true);
  let scratchRoot = null;
  const before = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd, encoding: "utf8" });
  const outcome = await smokeTestWorkflowRuntime({
    workflow: created.workflow,
    cwd,
    effects: {
      make_root() {
        scratchRoot = mkdtempSync(join(tmpdir(), "helix-smoke-root-failure-"));
        return scratchRoot;
      },
      remove_root() {
        throw new Error("synthetic-root-removal-failure");
      },
    },
  });
  assert.deepEqual(outcome, { ok: false, code: "workflow-runtime-smoke-cleanup-failed" });
  assert.equal(existsSync(scratchRoot), true);
  const after = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd, encoding: "utf8" });
  assert.equal(after, before);
  rmSync(scratchRoot, { recursive: true, force: true });
});

test("runtime smoke ignores hostile Git configuration and binds both modes to one physical baseline", async () => {
  for (const linked of [false, true]) {
    const primary = repo();
    const oldHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: primary, encoding: "utf8" }).trim();
    const externalRoot = mkdtempSync(join(tmpdir(), "helix-smoke-external-"));
    const externalTarget = join(externalRoot, "outside.txt");
    writeFileSync(externalTarget, "outside bytes must never be followed\n", "utf8");
    writeFileSync(join(primary, "proposal.txt"), "tracked proposal\n", "utf8");
    writeFileSync(join(primary, "baseline-sentinel.txt"), "CURRENT_BASELINE\n", "utf8");
    writeFileSync(join(primary, ".gitattributes"), "proposal.txt diff=hostile filter=hostile\n", "utf8");
    symlinkSync(externalTarget, join(primary, "tracked-external-link"));
    execFileSync("git", ["add", ".gitattributes", "baseline-sentinel.txt", "proposal.txt", "tracked-external-link"], { cwd: primary });
    execFileSync("git", ["commit", "-q", "-m", "adversarial baseline"], { cwd: primary });
    const hostileHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: primary, encoding: "utf8" }).trim();
    const linkedRoot = mkdtempSync(join(tmpdir(), "helix-smoke-linked-"));
    const linkedPath = join(linkedRoot, "checkout");
    if (linked) execFileSync("git", ["worktree", "add", "-q", "--detach", linkedPath, hostileHead], { cwd: primary });
    const cwd = linked ? linkedPath : primary;

    const helperRoot = mkdtempSync(join(tmpdir(), "helix-smoke-hostile-"));
    const marker = join(helperRoot, "executed");
    const textconv = join(helperRoot, "textconv.sh");
    const filter = join(helperRoot, "filter.sh");
    const processFilter = join(helperRoot, "process-filter.sh");
    const monitor = join(helperRoot, "fsmonitor.sh");
    const hooks = join(helperRoot, "hooks");
    mkdirSync(hooks);
    writeFileSync(textconv, `#!/bin/sh\n: > '${marker}'\ncat "$1"\n`, "utf8");
    writeFileSync(filter, `#!/bin/sh\n: > '${marker}'\ncat\n`, "utf8");
    writeFileSync(processFilter, `#!/bin/sh\n: > '${marker}'\nexit 1\n`, "utf8");
    writeFileSync(monitor, `#!/bin/sh\n: > '${marker}'\nexit 0\n`, "utf8");
    writeFileSync(join(hooks, "post-checkout"), `#!/bin/sh\n: > '${marker}'\nexit 0\n`, "utf8");
    for (const path of [textconv, filter, processFilter, monitor, join(hooks, "post-checkout")]) chmodSync(path, 0o755);
    execFileSync("git", ["replace", hostileHead, oldHead], { cwd: primary });
    execFileSync("git", ["config", "diff.hostile.textconv", textconv], { cwd: primary });
    execFileSync("git", ["config", "filter.hostile.clean", filter], { cwd: primary });
    execFileSync("git", ["config", "filter.hostile.smudge", filter], { cwd: primary });
    execFileSync("git", ["config", "filter.hostile.process", processFilter], { cwd: primary });
    execFileSync("git", ["config", "filter.hostile.required", "true"], { cwd: primary });
    execFileSync("git", ["config", "core.fsmonitor", monitor], { cwd: primary });
    execFileSync("git", ["config", "core.hooksPath", hooks], { cwd: primary });

    const originalEnv = Object.fromEntries([
      "GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0", "GIT_WORK_TREE", "GIT_DIR",
    ].map((key) => [key, process.env[key]]));
    process.env.GIT_CONFIG_COUNT = "1";
    process.env.GIT_CONFIG_KEY_0 = "core.fsmonitor";
    process.env.GIT_CONFIG_VALUE_0 = monitor;
    process.env.GIT_WORK_TREE = externalRoot;
    process.env.GIT_DIR = join(externalRoot, "not-a-repository");
    try {
      const gateOnly = workflow({
        id: `physical-baseline-${linked}`,
        name: "Physical baseline",
        description: "The runtime smoke baseline ignores replacement refs.",
        start: "objective",
        nodes: {
          objective: objectiveGate("succeeded", "failed"),
          succeeded: terminal("succeeded"),
          failed: terminal("failed", "baseline-replaced"),
        },
        objective_gate: {
          type: "file-contains", path: "baseline-sentinel.txt", contains: "CURRENT_BASELINE",
        },
      });
      assert.equal(gateOnly.ok, true, JSON.stringify(gateOnly.errors));
      const baselineOutcome = await smokeTestWorkflowRuntime({ workflow: gateOnly.definition, cwd });
      assert.equal(baselineOutcome.ok, true, `${linked}/replacement: ${JSON.stringify(baselineOutcome)}`);

      const created = createWorkflowFromTemplate({ id: `hostile-smoke-${linked}`, template: "implement-review" });
      assert.equal(created.ok, true);
      let drifted = false;
      const outcome = await smokeTestWorkflowRuntime({
        workflow: created.workflow,
        cwd,
        onEvent(event) {
          if (drifted || event.kind !== "run-end") return;
          drifted = true;
          const env = {
            PATH: process.env.PATH,
            HOME: tmpdir(),
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_CONFIG_SYSTEM: "/dev/null",
            GIT_NO_REPLACE_OBJECTS: "1",
            GIT_AUTHOR_NAME: "Helix Drift Test",
            GIT_AUTHOR_EMAIL: "helix-drift@example.invalid",
            GIT_COMMITTER_NAME: "Helix Drift Test",
            GIT_COMMITTER_EMAIL: "helix-drift@example.invalid",
          };
          const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd, env, encoding: "utf8" }).trim();
          const tree = execFileSync("git", ["rev-parse", `${head}^{tree}`], { cwd, env, encoding: "utf8" }).trim();
          const driftCommit = execFileSync("git", ["commit-tree", tree, "-p", head], {
            cwd, env, encoding: "utf8", input: "direct drift between smoke modes\n",
          }).trim();
          execFileSync("git", ["update-ref", "HEAD", driftCommit, head], { cwd, env });
        },
      });
      assert.equal(drifted, true, `${linked}/direct-drift`);
      assert.equal(outcome.ok, true, `${linked}/hostile-config: ${JSON.stringify(outcome)}`);
      assert.equal(outcome.mode_comparison.matched, true, `${linked}/mode-parity`);
      assert.equal(existsSync(marker), false, `${linked}/host-helper-executed`);
      assert.equal(readFileSync(externalTarget, "utf8"), "outside bytes must never be followed\n", `${linked}/symlink`);
    } finally {
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value == null) delete process.env[key];
        else process.env[key] = value;
      }
      if (linked) {
        execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "worktree", "remove", "--force", linkedPath], {
          cwd: primary,
          env: {
            PATH: process.env.PATH,
            HOME: tmpdir(),
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_CONFIG_SYSTEM: "/dev/null",
            GIT_NO_REPLACE_OBJECTS: "1",
          },
        });
      }
    }
  }
});

test("runtime smoke refuses to manufacture an artifact or convergence for a read-only candidate", async () => {
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
  assert.deepEqual(outcome, { ok: false, code: "review-failed" });
  assert.deepEqual(observed.filter((event) => event.kind === "node-start").map((event) => event.node_id), [
    "review", "route", "objective", "failed",
  ]);
});

test("a valid zero-agent workflow deploys through the product boundary", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-zero-agent-"));
  const cwd = repo();
  const objective = { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 };
  const built = workflow({
    id: "zero-agent", name: "Zero agent", description: "A deterministic gate-only workflow.", start: "objective",
    nodes: { objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "objective-failed") },
    objective_gate: objective,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  assert.equal(saveUserWorkflowV4(stateRoot, built.definition).ok, true);
  const binding = executionBinding(stateRoot, "zero-agent");
  const result = await executeNamedWorkflow({
    workflow_id: "zero-agent", task: "run deterministic gate", run_id: "zero-agent-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.converged, true);
  assert.deepEqual(result.cast, []);
});

test("an exact-limit persisted definition can be watched and resumed while legacy unbound state stays history-only", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-definition-limit-"));
  const cwd = repo();
  const objective = { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 };
  const stages = Array.from({ length: WORKFLOW_LIMITS.max_inline_stages }, (_, index) => agent({
    role: "reviewer", stage_id: `review-${index}`, mutation: "read-only", timeout_ms: 1_000,
  }));
  const built = workflow({
    id: "definition-limit", name: "Definition limit", description: "Exact byte-limit workflow.", start: "approval",
    nodes: {
      approval: checkpoint("limit-approval", "route"),
      route: decision([{ when: { op: "eq", path: "/inputs/task", value: "" }, target: "work" }], "work"),
      work: pipeline(stages, "objective", { max_visits: 1 }),
      objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "objective-failed"),
    },
    limits: { max_total_effects: stages.length }, objective_gate: objective,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  let remaining = WORKFLOW_LIMITS.max_workflow_bytes - Buffer.byteLength(stableWorkflowStringify(built.definition));
  built.definition.nodes.route.transitions[0].when.value = "p".repeat(remaining);
  assert.ok(remaining > 0);
  assert.equal(saveUserWorkflowV4(stateRoot, built.definition).ok, true);
  const binding = executionBinding(stateRoot, "definition-limit");
  const paused = await executeNamedWorkflow({
    workflow_id: "definition-limit", task: "exercise exact definition", run_id: "definition-limit-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding,
  });
  assert.equal(paused.stop_reason, "paused");
  const legacyStatePath = join(stateRoot, "runs", "definition-limit-run", "definition-limit-run.state.json");
  const legacyState = JSON.parse(readFileSync(legacyStatePath, "utf8"));
  assert.equal(legacyState.schema_version, 5);
  assert.equal(legacyState.execution_mode, "original-mode");
  const boundState = structuredClone(legacyState);
  legacyState.schema_version = 4;
  delete legacyState.execution_mode;
  writeFileSync(legacyStatePath, JSON.stringify(legacyState), "utf8");
  const privateCheckpoint = JSON.parse(readFileSync(join(
    stateRoot, "private", "runs", "definition-limit-run", "kernel-checkpoint.json",
  ), "utf8"));
  assert.equal(privateCheckpoint.snapshot_generation.endsWith(privateCheckpoint.snapshot_ref.slice(7, 23)), true);
  const watched = executeHelixCommand("runs watch definition-limit-run", { mode: "print" }, {
    stateRoot, runsRoot: join(stateRoot, "runs"), chainRegistry: chains, runRegistry: runs,
  });
  assert.equal(watched.ok, true, JSON.stringify(watched));
  const legacyResume = await resumeNamedWorkflow({
    run_id: "definition-limit-run", task: "exercise exact definition", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding,
  });
  assert.equal(legacyResume.ok, false, JSON.stringify(legacyResume));
  assert.equal(legacyResume.code, "kernel-resume-record-invalid");
  writeFileSync(legacyStatePath, JSON.stringify(boundState), "utf8");
  const resumed = await resumeNamedWorkflow({
    run_id: "definition-limit-run", task: "exercise exact definition", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding,
  });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
});

function executionBinding(stateRoot, id, modelInventory = null, executionMode = "original-mode") {
  const preflight = executeHelixCommand(`run ${id}${executionMode === "original-mode" ? "" : ` --execution-mode ${executionMode}`}`, { mode: "print" }, {
    stateRoot,
    chainRegistry: chains,
    runRegistry: runs,
    ...(modelInventory ? { modelInventory } : {}),
  });
  assert.equal(preflight.ok, true, JSON.stringify(preflight));
  assert.match(preflight.details.execution_binding_ref, /^sha256:[0-9a-f]{64}$/);
  assert.equal(preflight.details.execution_mode, executionMode);
  return preflight.details.execution_binding_ref;
}

function exactEnvelope(spec, ctx, overrides = {}) {
  return {
    schema_version: 2, run_id: ctx.run_id, stage: "candidate", role: spec.role,
    provider: spec.provider, model: spec.model,
    requested: { provider: spec.provider, model: spec.model, effort: spec.effort },
    effective: {
      provider: spec.provider, model: spec.model, effort: spec.effort,
      evidence: { provider: "verified-response", model: "verified-response", effort: "verified-session" },
    },
    attestation_ref: `sha256:${"a".repeat(64)}`,
    usage: { input_tokens: 2, output_tokens: 1 }, attempt: ctx.attempt, iteration: ctx.pass,
    input_ref: { kind: "local-ref", value: "local-ref:input/workflow-contract", algorithm: null },
    claims_ref: "local-ref:claims/workflow-contract", evidence_ref: "local-ref:evidence/workflow-contract",
    uncertainty: [], risks: [], recommendation: "approve", proposed_actions: [], open_questions: [], status: "ok",
    ...overrides,
  };
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
  assert.equal(state.schema_version, 5);
  assert.equal(state.execution_mode, "original-mode");
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

test("typed named-workflow inputs validate before run creation and drive map nodes", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-typed-input-"));
  const cwd = repo();
  const objective = { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 };
  const built = workflow({
    id: "typed-map", name: "Typed map", description: "Typed map workflow.", start: "items",
    inputs: {
      type: "object", additionalProperties: false, required: ["task", "items"],
      properties: {
        task: { type: "string", minLength: 1, maxLength: 65_536 },
        items: { type: "array", description: "Items to review", items: { type: "string", minLength: 2, maxLength: 32 }, minItems: 1, maxItems: 3 },
      },
    },
    nodes: {
      items: map("/inputs/items", agent({ role: "reviewer", stage_id: "items", output_schema: "verdict-v1", mutation: "read-only", timeout_ms: 1_000 }), "count", { max_items: 3 }),
      count: reduce("/outputs/items", "count", "objective"),
      objective: objectiveGate("success", "failed"),
      success: terminal("succeeded"),
      failed: terminal("failed", "objective-failed"),
    },
    objective_gate: objective,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const smoke = await smokeTestWorkflowRuntime({ workflow: built.definition, cwd });
  assert.equal(smoke.ok, true, JSON.stringify(smoke));
  assert.equal(saveUserWorkflowV4(stateRoot, built.definition).ok, true);
  const binding = executionBinding(stateRoot, "typed-map");
  const refused = await executeNamedWorkflow({
    workflow_id: "typed-map", input: { task: "review" }, run_id: "typed-missing", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding,
  });
  assert.equal(refused.code, "workflow-input-invalid");
  assert.equal(existsSync(join(stateRoot, "runs", "typed-missing")), false);
  const completed = await executeNamedWorkflow({
    workflow_id: "typed-map", input: { task: "review", items: ["aa", "bb"] }, run_id: "typed-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding,
  });
  assert.equal(completed.ok, true, JSON.stringify(completed));
  assert.equal(completed.converged, true);
});

test("product panels enforce invocation-level effect limits before the first model call", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-panel-budget-"));
  const cwd = repo();
  const objective = { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 };
  const built = workflow({
    id: "panel-budget", name: "Panel budget", description: "Panel budget workflow.", start: "review",
    nodes: {
      review: pipeline([agent({ role: "reviewer", stage_id: "review", output_schema: "verdict-v1", mutation: "read-only", timeout_ms: 1_000 })], "objective", { max_visits: 1 }),
      objective: objectiveGate("success", "failed"),
      success: terminal("succeeded"),
      failed: terminal("failed", "objective-failed"),
    },
    limits: { max_total_effects: 1 },
    provider_policy: { exact: true, assignments: {}, default_assignment: { kind: "composite", preset: "overlord" }, require_live_certification: false },
    objective_gate: objective,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  assert.equal(saveUserWorkflowV4(stateRoot, built.definition).ok, true);
  const result = await executeNamedWorkflow({
    workflow_id: "panel-budget", task: "respect the panel budget", run_id: "panel-budget-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: executionBinding(stateRoot, "panel-budget"),
  });
  assert.equal(result.code, "kernel-budget-exhausted");
  assert.equal(result.calls.candidates, 0);
});

test("adapter and envelope failures are structurally non-maskable in product settlement", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-envelope-integrity-"));
  const cwd = repo();
  const objective = { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 };
  const integrityCode = "kernel-agent-envelope-invalid";
  const adapterCode = "kernel-agent-adapter-failed";
  const built = workflow({
    id: "envelope-integrity", name: "Envelope integrity", description: "Envelope failures cannot be settled.", start: "review",
    nodes: {
      review: parallel([
        agent({ role: "reviewer", stage_id: "review", output_schema: "verdict-v1", mutation: "read-only", timeout_ms: 1_000 }),
      ], "objective", { failure: "settle", allow_failure_codes: [integrityCode, adapterCode], max_concurrency: 1 }),
      objective: objectiveGate("success", "failed"),
      success: terminal("succeeded"),
      failed: terminal("failed", "objective-failed"),
    },
    provider_policy: {
      exact: true,
      assignments: {},
      default_assignment: { kind: "model", provider: "openrouter", model: "vendor/integrity:free", effort: "high" },
      require_live_certification: false,
    },
    objective_gate: objective,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  assert.equal(saveUserWorkflowV4(stateRoot, built.definition).ok, true);
  const inventory = [{ provider: "openrouter", model: "vendor/integrity:free", reasoning: true, supported_efforts: ["high"] }];
  const exactRef = `sha256:${"8".repeat(64)}`;
  let malformed = true;
  const adapter = {
    kind: "helix-pi-agent", exactMode: true, supportsProvider: () => true,
    async preflightExact() { return { ok: true, bindings: [], binding_ref: exactRef }; },
    attests: () => true,
    async runCandidate() {
      if (malformed) return {};
      throw new Error("synthetic adapter failure");
    },
  };
  const result = await executeNamedWorkflow({
    workflow_id: "envelope-integrity", task: "must not converge", run_id: "envelope-integrity-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: executionBinding(stateRoot, "envelope-integrity", inventory),
    expected_exact_ref: exactRef,
    adapter,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, integrityCode);
  assert.equal(result.converged, false);
  malformed = false;
  const adapterFailure = await executeNamedWorkflow({
    workflow_id: "envelope-integrity", task: "must not converge", run_id: "adapter-integrity-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: executionBinding(stateRoot, "envelope-integrity", inventory),
    expected_exact_ref: exactRef,
    adapter,
  });
  assert.equal(adapterFailure.ok, false);
  assert.equal(adapterFailure.code, adapterCode);
  assert.equal(adapterFailure.converged, false);
});

test("mixed casts route mock members locally and real members through the exact adapter", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-mixed-cast-"));
  const cwd = repo();
  const objective = { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 };
  const built = workflow({
    id: "mixed-cast", name: "Mixed cast", description: "Mock and exact members share one workflow.", start: "review",
    nodes: {
      review: parallel([
        agent({ role: "reviewer", stage_id: "mock-stage", output_schema: "verdict-v1", mutation: "read-only", timeout_ms: 1_000 }),
        agent({ role: "reviewer", stage_id: "real-stage", output_schema: "verdict-v1", mutation: "read-only", timeout_ms: 1_000 }),
      ], "objective", { max_concurrency: 2 }),
      objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "objective-failed"),
    },
    provider_policy: {
      exact: true,
      assignments: {
        "real-stage": { kind: "model", provider: "openrouter", model: "vendor/mixed:free", effort: "high" },
      },
      default_assignment: { kind: "model", provider: "mock", model: "mock-model", effort: "medium" },
      require_live_certification: false,
    },
    objective_gate: objective,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  assert.equal(saveUserWorkflowV4(stateRoot, built.definition).ok, true);
  const inventory = [{ provider: "openrouter", model: "vendor/mixed:free", reasoning: true, supported_efforts: ["high"] }];
  const exactRef = `sha256:${"9".repeat(64)}`;
  let adapterCalls = 0;
  const adapter = {
    kind: "helix-pi-agent", exactMode: true, supportsProvider: () => true,
    async preflightExact() { return { ok: true, bindings: [{ provider: "openrouter" }], binding_ref: exactRef }; },
    attests: () => true,
    async runCandidate(spec, ctx) {
      adapterCalls += 1;
      return {
        schema_version: 2, run_id: ctx.run_id, stage: "candidate", role: spec.role,
        provider: spec.provider, model: spec.model,
        requested: { provider: spec.provider, model: spec.model, effort: spec.effort },
        effective: {
          provider: spec.provider, model: spec.model, effort: spec.effort,
          evidence: { provider: "verified-response", model: "verified-response", effort: "verified-session" },
        },
        attestation_ref: `sha256:${"7".repeat(64)}`,
        usage: { input_tokens: 1, output_tokens: 1 }, attempt: 1, iteration: 1,
        input_ref: { kind: "local-ref", value: "local-ref:input/mixed", algorithm: null },
        claims_ref: "local-ref:claims/mixed", evidence_ref: "local-ref:evidence/mixed",
        uncertainty: [], risks: [], recommendation: "approve", proposed_actions: [], open_questions: [], status: "ok",
      };
    },
  };
  const result = await executeNamedWorkflow({
    workflow_id: "mixed-cast", task: "route each member exactly once", run_id: "mixed-cast-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: executionBinding(stateRoot, "mixed-cast", inventory), expected_exact_ref: exactRef, adapter,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(adapterCalls, 1);
});

test("product agents receive exact declared tools, mutation, output, artifact, and visit context", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-agent-contract-"));
  const cwd = repo();
  const objective = { type: "file-contains", path: "result.md", contains: "READY" };
  const built = workflow({
    id: "agent-contract", name: "Agent contract", description: "Exercise the exact v4 agent contract.", start: "work",
    nodes: {
      work: { ...agent({
        role: "builder", stage_id: "work", output_schema: "semantic-v2",
        tools: ["read", "write"], mutation: "shared-serialized", timeout_ms: 1_000,
        artifact: { path: "result.md", kind: "notes" },
      }), next: "objective", max_visits: 2 },
      objective: { ...objectiveGate("success", "work"), loops_off: "failed" },
      success: terminal("succeeded"), failed: terminal("failed", "objective-failed"),
    },
    limits: { max_total_effects: 2, structured_repair_attempts: 0 },
    provider_policy: {
      exact: true, assignments: {},
      default_assignment: { kind: "model", provider: "openrouter", model: "vendor/contract:free", effort: "high" },
      require_live_certification: false,
    },
    objective_gate: objective,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  assert.equal(saveUserWorkflowV4(stateRoot, built.definition).ok, true);
  const inventory = [{ provider: "openrouter", model: "vendor/contract:free", reasoning: true, supported_efforts: ["high"] }];
  const exactRef = `sha256:${"b".repeat(64)}`;
  const contexts = [];
  const adapter = {
    kind: "helix-pi-agent", exactMode: true, supportsProvider: () => true,
    async preflightExact() { return { ok: true, bindings: [{ provider: "openrouter" }], binding_ref: exactRef }; },
    attests: () => true,
    async runCandidate(spec, ctx) {
      contexts.push({
        run_id: ctx.run_id, pass: ctx.pass, attempt: ctx.attempt, tools: structuredClone(ctx.tools),
        mutation: ctx.mutation, output_schema: structuredClone(ctx.output_schema), prompt: ctx.prompt, cwd: ctx.cwd,
      });
      writeFileSync(join(ctx.cwd, "result.md"), ctx.pass === 1 ? "draft\n" : "READY\n", "utf8");
      return exactEnvelope(spec, ctx, { recommendation: "built" });
    },
  };
  const result = await executeNamedWorkflow({
    workflow_id: "agent-contract", task: "build the declared result", run_id: "agent-contract-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: executionBinding(stateRoot, "agent-contract", inventory), expected_exact_ref: exactRef, adapter,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.total_passes, 2);
  assert.deepEqual(contexts.map(({ run_id, pass, attempt, tools, mutation, output_schema }) => ({
    run_id, pass, attempt, tools, mutation, output_schema,
  })), [
    {
      run_id: "agent-contract-run:work:1:member-0:attempt-1", pass: 1, attempt: 1,
      tools: ["read", "write"], mutation: "shared-serialized", output_schema: { id: "semantic-v2" },
    },
    {
      run_id: "agent-contract-run:work:2:member-0:attempt-1", pass: 2, attempt: 1,
      tools: ["read", "write"], mutation: "shared-serialized", output_schema: { id: "semantic-v2" },
    },
  ]);
  assert.match(contexts[0].prompt, /Stage: work · Pass: 1/);
  assert.match(contexts[0].prompt, /\{"kind":"notes","path":"result.md"\}/);
  assert.match(contexts[1].prompt, /Stage: work · Pass: 2/);
  assert.match(contexts[1].prompt, /"revision":\{"prior_node_output":/);
  assert.equal(readFileSync(join(result.worktree_path, "result.md"), "utf8"), "READY\n");
});

test("non-ok envelopes and output-schema violations cannot reach the objective gate", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-agent-result-contract-"));
  const cwd = repo();
  const objective = { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 };
  const built = workflow({
    id: "agent-result-contract", name: "Agent result contract", description: "Refuse unusable agent envelopes.", start: "review",
    nodes: {
      review: pipeline([agent({
        role: "reviewer", stage_id: "review", output_schema: "verdict-v1", mutation: "read-only", timeout_ms: 1_000,
      })], "objective", { max_visits: 1 }),
      objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "objective-failed"),
    },
    limits: { max_total_effects: 2, structured_repair_attempts: 1 },
    provider_policy: {
      exact: true, assignments: {},
      default_assignment: { kind: "model", provider: "openrouter", model: "vendor/result:free", effort: "high" },
      require_live_certification: false,
    },
    objective_gate: objective,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  assert.equal(saveUserWorkflowV4(stateRoot, built.definition).ok, true);
  const inventory = [{ provider: "openrouter", model: "vendor/result:free", reasoning: true, supported_efforts: ["high"] }];
  const exactRef = `sha256:${"c".repeat(64)}`;
  let outcome = {};
  let repairMode = false;
  let repairCalls = 0;
  const adapter = {
    kind: "helix-pi-agent", exactMode: true, supportsProvider: () => true,
    async preflightExact() { return { ok: true, bindings: [{ provider: "openrouter" }], binding_ref: exactRef }; },
    attests: () => true,
    async runCandidate(spec, ctx) {
      if (repairMode) {
        repairCalls += 1;
        if (repairCalls === 1) {
          const error = new Error("pi-agent-semantic-output-invalid");
          error.usage = { input_tokens: 2, output_tokens: 1 };
          throw error;
        }
      }
      return exactEnvelope(spec, ctx, outcome);
    },
  };
  const binding = executionBinding(stateRoot, "agent-result-contract", inventory);
  for (const executionMode of ["original-mode", "graph-mode"]) {
    const modeBinding = executionBinding(stateRoot, "agent-result-contract", inventory, executionMode);
    for (const status of ["blocked", "failed", "refused", "timeout"]) {
      outcome = { status };
      const runId = `agent-status-${status}-${executionMode}`;
      const result = await executeNamedWorkflow({
        workflow_id: "agent-result-contract", task: "must not converge", run_id: runId,
        execution_mode: executionMode, cwd,
        state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
        expected_binding_ref: modeBinding, expected_exact_ref: exactRef, adapter,
      });
      assert.equal(result.code, `pi-agent-status-${status}`);
      assert.equal(result.converged, false);
      const watched = executeHelixCommand(`runs watch ${runId}`, { mode: "print" }, {
        stateRoot, runsRoot: join(stateRoot, "runs"), chainRegistry: chains, runRegistry: runs,
      });
      assert.equal(watched.ok, true, JSON.stringify(watched));
      assert.equal(watched.details.execution_mode, executionMode);
      assert.equal(watched.details.current_node, null);
      const events = readFileSync(result.events_path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      assert.deepEqual(events.slice(-2).map((event) => event.kind), ["node-end", "run-end"]);
      assert.equal(events.at(-1).node_id, "review");
      assert.equal(events.at(-1).code, `pi-agent-status-${status}`);
    }
  }
  outcome = { recommendation: "looks-good" };
  const invalidOutput = await executeNamedWorkflow({
    workflow_id: "agent-result-contract", task: "must not converge", run_id: "agent-output-invalid", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding, expected_exact_ref: exactRef, adapter,
  });
  assert.equal(invalidOutput.code, "kernel-agent-output-invalid");
  assert.equal(invalidOutput.converged, false);

  outcome = {};
  repairMode = true;
  const repaired = await executeNamedWorkflow({
    workflow_id: "agent-result-contract", task: "repair the closed output", run_id: "agent-output-repaired", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding, expected_exact_ref: exactRef, adapter,
  });
  assert.equal(repaired.ok, true, JSON.stringify(repaired));
  assert.equal(repairCalls, 2);
  const repairedCheckpoint = JSON.parse(readFileSync(
    join(stateRoot, "private", "runs", "agent-output-repaired", "kernel-checkpoint.json"), "utf8"));
  assert.equal(repairedCheckpoint.scheduler.budget.tokens, 6);
  const repairEvents = readFileSync(repaired.events_path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const [repairEvent] = repairEvents.filter((event) => event.kind === "effect-repair");
  assert.equal(repairEvent.prior_instance_id, "review:1:0:member-0:attempt-1");
  assert.equal(repairEvents.find((event) => event.kind === "effect-end"
    && event.instance_id === repairEvent.prior_instance_id)?.failure_class, "agent");
  const repairedWatch = executeHelixCommand("runs watch agent-output-repaired", { mode: "print" }, {
    stateRoot, runsRoot: join(stateRoot, "runs"), chainRegistry: chains, runRegistry: runs,
  });
  assert.equal(repairedWatch.ok, true, JSON.stringify(repairedWatch));
});

test("mock artifact mutation is one counted candidate effect, not a verifier or gate side effect", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-counted-mock-effect-"));
  const cwd = repo();
  const objective = { type: "file-contains", path: "mock-result.md", contains: "DONE" };
  const built = workflow({
    id: "counted-mock-effect", name: "Counted mock effect", description: "Mock mutations stay in the agent boundary.", start: "work",
    nodes: {
      work: { ...agent({
        role: "builder", stage_id: "work", mutation: "shared-serialized", timeout_ms: 1_000,
        artifact: { path: "mock-result.md", kind: "notes" },
      }), next: "objective", max_visits: 1 },
      objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "objective-failed"),
    },
    limits: { max_total_effects: 1 },
    objective_gate: objective,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  assert.equal(saveUserWorkflowV4(stateRoot, built.definition).ok, true);
  const result = await executeNamedWorkflow({
    workflow_id: "counted-mock-effect", task: "produce the mock artifact", run_id: "counted-mock-effect-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: executionBinding(stateRoot, "counted-mock-effect"),
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.calls.candidates, 1);
  const events = readFileSync(result.events_path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(events.filter((event) => event.kind === "effect-start").length, 1);
  assert.equal(events.filter((event) => event.kind === "effect-end").length, 1);
  assert.match(readFileSync(join(result.worktree_path, "mock-result.md"), "utf8"), /DONE/);
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
  const controller = new AbortController();
  controller.abort("synthetic-terminal-cancel");
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
    signal: controller.signal,
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
  const controller = new AbortController();
  controller.abort("synthetic-terminal-cancel");
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
    signal: controller.signal,
    now: 1_751_731_200,
  });
  assert.equal(failed.ok, false);
  const state = JSON.parse(readFileSync(join(stateRoot, "runs", "built-in-task-run", "built-in-task-run.state.json"), "utf8"));
  assert.equal(state.workflow_id, "mock-core-loop");
  assert.equal(state.schema_version, 5);
  assert.equal(state.execution_mode, "original-mode");
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
  const binding = executionBinding(stateRoot, "resume-loop", null, "graph-mode");
  const interrupted = await executeNamedWorkflow({
    workflow_id: "resume-loop",
    task: "resume this exact task",
    run_id: "kernel-resume-run",
    cwd,
    state_root: stateRoot,
    package_root: packageRoot,
    chain_registry: chains,
    run_registry: runs,
    execution_mode: "graph-mode",
    expected_binding_ref: binding,
    onEvent(event) {
      if (event.kind === "effect-end") throw new Error("synthetic-process-boundary-stop");
    },
  });
  assert.equal(interrupted.ok, false);
  assert.equal(interrupted.code, "kernel-event-write-failed");
  assert.equal(interrupted.resumable, true);
  const statePath = join(stateRoot, "runs", "kernel-resume-run", "kernel-resume-run.state.json");
  const boundState = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(boundState.completed, false);
  assert.equal(boundState.execution_mode, "graph-mode");
  const graphCheckpoint = JSON.parse(readFileSync(
    join(stateRoot, "private", "runs", "kernel-resume-run", "kernel-checkpoint.json"),
    "utf8",
  ));
  assert.equal(graphCheckpoint.scheduler.schema_version, 5);
  assert.equal(graphCheckpoint.scheduler.execution_mode, "graph-mode");
  assert.equal(boundState.event_count, graphCheckpoint.scheduler.event_seq);
  assert.equal(boundState.event_ref, graphCheckpoint.scheduler.event_ref);
  let hostileAdapterReads = 0;
  const hostileAdapter = new Proxy({}, {
    get() {
      hostileAdapterReads += 1;
      throw new Error("public count admission must precede adapter access");
    },
  });
  writeFileSync(statePath, JSON.stringify({ ...boundState, journal_entries: -1 }), "utf8");
  const negativeJournal = await resumeNamedWorkflow({
    run_id: "kernel-resume-run", task: "resume this exact task", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding, adapter: hostileAdapter,
  });
  assert.equal(negativeJournal.code, "kernel-resume-record-invalid");
  assert.equal(hostileAdapterReads, 0);
  writeFileSync(statePath, JSON.stringify({
    ...boundState,
    journal_entries: graphCheckpoint.scheduler.journal_entries + 1,
  }), "utf8");
  const journalAhead = await resumeNamedWorkflow({
    run_id: "kernel-resume-run", task: "resume this exact task", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding, adapter: hostileAdapter,
  });
  assert.equal(journalAhead.code, "kernel-resume-events-invalid");
  assert.equal(hostileAdapterReads, 0);
  writeFileSync(statePath, JSON.stringify(boundState), "utf8");
  const ready = executeHelixCommand("runs resume kernel-resume-run", { mode: "print" }, {
    stateRoot, runsRoot: join(stateRoot, "runs"), chainRegistry: chains, runRegistry: runs,
  });
  assert.equal(ready.ok, true, JSON.stringify(ready));
  assert.equal(ready.details.in_process_resume, true);
  assert.equal(ready.details.execution_mode, "graph-mode");

  writeFileSync(statePath, JSON.stringify({ ...boundState, execution_mode: "original-mode" }), "utf8");
  const tampered = await resumeNamedWorkflow({
    run_id: "kernel-resume-run", task: "resume this exact task", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: executionBinding(stateRoot, "resume-loop"),
  });
  assert.equal(tampered.code, "kernel-checkpoint-invalid");
  writeFileSync(statePath, JSON.stringify(boundState), "utf8");
  const resumeEventsPath = join(stateRoot, "runs", "kernel-resume-run", "kernel-resume-run.kernel.events.jsonl");
  const resumeEventsText = readFileSync(resumeEventsPath, "utf8");
  const outsideEvents = join(mkdtempSync(join(tmpdir(), "helix-resume-events-target-")), "events.jsonl");
  writeFileSync(outsideEvents, resumeEventsText, "utf8");
  rmSync(resumeEventsPath);
  symlinkSync(outsideEvents, resumeEventsPath);
  const symlinkedEvents = await resumeNamedWorkflow({
    run_id: "kernel-resume-run", task: "resume this exact task", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding,
  });
  assert.equal(symlinkedEvents.code, "kernel-resume-events-invalid");
  rmSync(resumeEventsPath);
  writeFileSync(resumeEventsPath, resumeEventsText, "utf8");
  truncateSync(resumeEventsPath, 64 * 1024 * 1024 + 1);
  const oversizedEvents = await resumeNamedWorkflow({
    run_id: "kernel-resume-run", task: "resume this exact task", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding,
  });
  assert.equal(oversizedEvents.code, "kernel-resume-events-invalid");
  writeFileSync(resumeEventsPath, resumeEventsText, "utf8");
  const privateCheckpointPath = join(
    stateRoot, "private", "runs", "kernel-resume-run", "kernel-checkpoint.json",
  );
  assert.equal(graphCheckpoint.schema_version, 2);
  assert.ok(graphCheckpoint.scheduler.event_seq > 0);
  assert.ok(graphCheckpoint.scheduler.journal_entries > 0);
  const debtCheckpoint = structuredClone(graphCheckpoint);
  debtCheckpoint.maintenance.public_projection_pending = true;
  writeFileSync(privateCheckpointPath, JSON.stringify(debtCheckpoint), "utf8");
  writeFileSync(statePath, JSON.stringify({
    ...boundState,
    event_count: 0,
    event_ref: EMPTY_KERNEL_EVENT_PREFIX_REF,
    journal_entries: debtCheckpoint.scheduler.journal_entries - 1,
  }), "utf8");
  const debtClearFailure = await resumeNamedWorkflow({
    run_id: "kernel-resume-run",
    task: "resume this exact task",
    cwd,
    state_root: stateRoot,
    package_root: packageRoot,
    chain_registry: chains,
    run_registry: runs,
    expected_binding_ref: binding,
    adapter: hostileAdapter,
    write_text_atomic(root, relativePath, data, options) {
      if (relativePath === join("private", "runs", "kernel-resume-run", "kernel-checkpoint.json")) {
        throw new Error("synthetic-projection-debt-clear-failure");
      }
      return writeTextAtomic(root, relativePath, data, options);
    },
  });
  assert.equal(debtClearFailure.code, "kernel-resume-projection-write-failed");
  assert.equal(hostileAdapterReads, 0);
  assert.equal(JSON.parse(readFileSync(privateCheckpointPath, "utf8"))
    .maintenance.public_projection_pending, true);
  let projectionRepairObserved = false;
  const resumed = await resumeNamedWorkflow({
    run_id: "kernel-resume-run",
    task: "resume this exact task",
    cwd,
    state_root: stateRoot,
    package_root: packageRoot,
    chain_registry: chains,
    run_registry: runs,
    expected_binding_ref: binding,
    onEvent() {
      if (projectionRepairObserved) return;
      const repairedState = JSON.parse(readFileSync(statePath, "utf8"));
      const repairedCheckpoint = JSON.parse(readFileSync(privateCheckpointPath, "utf8"));
      assert.equal(repairedState.event_count, debtCheckpoint.scheduler.event_seq);
      assert.equal(repairedState.event_ref, debtCheckpoint.scheduler.event_ref);
      assert.equal(repairedState.journal_entries, debtCheckpoint.scheduler.journal_entries);
      assert.equal(repairedCheckpoint.maintenance.public_projection_pending, false);
      projectionRepairObserved = true;
    },
  });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(projectionRepairObserved, true);
  assert.equal(resumed.converged, true);
  assert.equal(resumed.execution_mode, "graph-mode");
  const completedState = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(completedState.schema_version, 5);
  assert.equal(completedState.execution_mode, "graph-mode");
  assert.equal(completedState.completed, true);
  const resumedEvents = readFileSync(resumed.events_path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const resumedEffect = resumedEvents.find((event) => event.kind === "effect-resumed");
  assert.equal(resumedEffect.status, "ok");
  assert.match(resumedEffect.effect_ref, /^sha256:[0-9a-f]{64}$/);
  const watched = executeHelixCommand("runs watch kernel-resume-run", { mode: "print" }, {
    stateRoot, runsRoot: join(stateRoot, "runs"), chainRegistry: chains, runRegistry: runs,
  });
  assert.equal(watched.ok, true, JSON.stringify(watched));
});

test("failure before the first private checkpoint stays nonterminal, nonresumable, and watchable", async () => {
  for (const executionMode of ["original-mode", "graph-mode"]) {
    const stateRoot = mkdtempSync(join(tmpdir(), `helix-first-checkpoint-${executionMode}-`));
    const cwd = repo();
    const workflowId = `first-checkpoint-${executionMode}`;
    const runId = `first-checkpoint-run-${executionMode}`;
    installWorkflow(stateRoot, workflowId);
    const checkpointPath = join(stateRoot, "private", "runs", runId, "kernel-checkpoint.json");
    const outside = join(mkdtempSync(join(tmpdir(), "helix-first-checkpoint-target-")), "outside.json");
    writeFileSync(outside, "{}\n", "utf8");
    let obstructed = false;
    const failed = await executeNamedWorkflow({
      workflow_id: workflowId,
      task: "fail before scheduler authority exists",
      run_id: runId,
      execution_mode: executionMode,
      cwd,
      state_root: stateRoot,
      package_root: packageRoot,
      chain_registry: chains,
      run_registry: runs,
      expected_binding_ref: executionBinding(stateRoot, workflowId, null, executionMode),
      onEvent(event) {
        if (!obstructed && event.kind === "run-start") {
          mkdirSync(dirname(checkpointPath), { recursive: true });
          symlinkSync(outside, checkpointPath);
          obstructed = true;
        }
      },
    });
    assert.equal(failed.code, "kernel-checkpoint-write-failed", executionMode);
    assert.equal(failed.resumable, false, executionMode);
    const publicState = JSON.parse(readFileSync(
      join(stateRoot, "runs", runId, `${runId}.state.json`),
      "utf8",
    ));
    assert.equal(publicState.completed, false, executionMode);
    assert.equal(publicState.event_count, 0, executionMode);
    assert.equal(publicState.event_ref, EMPTY_KERNEL_EVENT_PREFIX_REF, executionMode);
    const watched = executeHelixCommand(`runs watch ${runId}`, { mode: "print" }, {
      stateRoot, runsRoot: join(stateRoot, "runs"), chainRegistry: chains, runRegistry: runs,
    });
    assert.equal(watched.ok, true, `${executionMode}: ${JSON.stringify(watched)}`);
    assert.equal(watched.details.events, 0, executionMode);
  }
});

test("checkpoint-write interruption keeps public state on the durable event prefix and truncates its suffix on resume", async () => {
  for (const executionMode of ["original-mode", "graph-mode"]) {
    const stateRoot = mkdtempSync(join(tmpdir(), `helix-prefix-checkpoint-${executionMode}-`));
    const cwd = repo();
    const workflowId = `prefix-checkpoint-${executionMode}`;
    const runId = `prefix-checkpoint-run-${executionMode}`;
    installWorkflow(stateRoot, workflowId);
    const binding = executionBinding(stateRoot, workflowId, null, executionMode);
    const checkpointPath = join(stateRoot, "private", "runs", runId, "kernel-checkpoint.json");
    const outside = join(mkdtempSync(join(tmpdir(), "helix-prefix-checkpoint-target-")), "outside.json");
    writeFileSync(outside, "{}\n", "utf8");
    let durableCheckpointText = null;
    let obstructed = false;
    const interrupted = await executeNamedWorkflow({
      workflow_id: workflowId,
      task: "resume only the durable prefix",
      run_id: runId,
      execution_mode: executionMode,
      cwd,
      state_root: stateRoot,
      package_root: packageRoot,
      chain_registry: chains,
      run_registry: runs,
      expected_binding_ref: binding,
      onEvent(event) {
        if (!obstructed && event.kind === "effect-start") {
          durableCheckpointText = readFileSync(checkpointPath, "utf8");
          rmSync(checkpointPath);
          symlinkSync(outside, checkpointPath);
          obstructed = true;
        }
      },
    });
    assert.equal(interrupted.code, "kernel-checkpoint-write-failed", executionMode);
    assert.equal(interrupted.resumable, true, executionMode);
    assert.equal(obstructed, true, executionMode);
    const durableCheckpoint = JSON.parse(durableCheckpointText);
    assert.equal(durableCheckpoint.scheduler.active?.node_id, "implement", JSON.stringify(durableCheckpoint.scheduler.active));
    assert.equal(Object.keys(durableCheckpoint.scheduler.active?.inflight ?? {}).length, 1, executionMode);
    const statePath = join(stateRoot, "runs", runId, `${runId}.state.json`);
    const publicState = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(publicState.completed, false, executionMode);
    assert.equal(publicState.event_count, durableCheckpoint.scheduler.event_seq, executionMode);
    assert.equal(publicState.event_ref, durableCheckpoint.scheduler.event_ref, executionMode);
    const eventsPath = join(stateRoot, "runs", runId, `${runId}.kernel.events.jsonl`);
    const interruptedEvents = readFileSync(eventsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.ok(interruptedEvents.length > publicState.event_count, executionMode);
    const watched = executeHelixCommand(`runs watch ${runId}`, { mode: "print" }, {
      stateRoot, runsRoot: join(stateRoot, "runs"), chainRegistry: chains, runRegistry: runs,
    });
    assert.equal(watched.ok, true, JSON.stringify(watched));
    assert.equal(watched.details.events, publicState.event_count, executionMode);
    rmSync(checkpointPath);
    writeFileSync(checkpointPath, durableCheckpointText, "utf8");
    const resumed = await resumeNamedWorkflow({
      run_id: runId,
      task: "resume only the durable prefix",
      cwd,
      state_root: stateRoot,
      package_root: packageRoot,
      chain_registry: chains,
      run_registry: runs,
      expected_binding_ref: binding,
    });
    assert.equal(resumed.ok, true, JSON.stringify(resumed));
    assert.equal(resumed.converged, true, executionMode);
    const resumedEvents = readFileSync(eventsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(resumedEvents.slice(0, publicState.event_count), interruptedEvents.slice(0, publicState.event_count), executionMode);
    assert.equal(resumedEvents[publicState.event_count]?.kind, "run-resume", executionMode);
    assert.equal(resumedEvents.every((event, index) => event.seq === index + 1), true, executionMode);
  }
});

test("a failed terminal event-file write never closes the product checkpoint and resumes to one truthful terminal pair", async () => {
  for (const executionMode of ["original-mode", "graph-mode"]) {
    const stateRoot = mkdtempSync(join(tmpdir(), `helix-terminal-event-${executionMode}-`));
    const cwd = repo();
    const workflowId = `terminal-event-${executionMode}`;
    const runId = `terminal-event-run-${executionMode}`;
    installWorkflow(stateRoot, workflowId);
    const binding = executionBinding(stateRoot, workflowId, null, executionMode);
    let failed = false;
    const interrupted = await executeNamedWorkflow({
      workflow_id: workflowId,
      task: "preserve exact terminal event evidence",
      run_id: runId,
      execution_mode: executionMode,
      cwd,
      state_root: stateRoot,
      package_root: packageRoot,
      chain_registry: chains,
      run_registry: runs,
      expected_binding_ref: binding,
      onEvent(event) {
        if (!failed && event.kind === "node-end" && event.status === "succeeded") {
          failed = true;
          throw new Error("synthetic-terminal-event-write-failure");
        }
      },
    });
    assert.equal(interrupted.ok, false);
    assert.equal(interrupted.code, "kernel-event-write-failed");
    assert.equal(interrupted.resumable, true);
    const checkpoint = JSON.parse(readFileSync(
      join(stateRoot, "private", "runs", runId, "kernel-checkpoint.json"),
      "utf8",
    ));
    assert.equal(Object.hasOwn(checkpoint.scheduler, "terminal_result"), false);
    assert.equal(JSON.parse(readFileSync(
      join(stateRoot, "runs", runId, `${runId}.state.json`),
      "utf8",
    )).completed, false);
    const eventsPath = join(stateRoot, "runs", runId, `${runId}.kernel.events.jsonl`);
    const authoritativeText = readFileSync(eventsPath, "utf8");
    const authoritativeEvents = authoritativeText.trim().split("\n").map((line) => JSON.parse(line));
    const tamperedEvents = structuredClone(authoritativeEvents);
    tamperedEvents[0].definition_ref = `sha256:${"f".repeat(64)}`;
    writeFileSync(eventsPath, `${tamperedEvents.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
    const tamperedResume = await resumeNamedWorkflow({
      run_id: runId,
      task: "preserve exact terminal event evidence",
      cwd,
      state_root: stateRoot,
      package_root: packageRoot,
      chain_registry: chains,
      run_registry: runs,
      expected_binding_ref: binding,
    });
    assert.equal(tamperedResume.ok, false);
    assert.equal(tamperedResume.code, "kernel-resume-events-invalid");
    writeFileSync(eventsPath, authoritativeText, "utf8");

    const suffix = {
      schema_version: 1,
      seq: authoritativeEvents.length + 1,
      run_id: runId,
      kind: "node-end",
      node_id: "succeeded",
      status: "succeeded",
    };
    writeFileSync(eventsPath, `${authoritativeText}${JSON.stringify(suffix)}\n`, "utf8");
    const preResumeWatch = executeHelixCommand(`runs watch ${runId}`, { mode: "print" }, {
      stateRoot, runsRoot: join(stateRoot, "runs"), chainRegistry: chains, runRegistry: runs,
    });
    assert.equal(preResumeWatch.ok, true, JSON.stringify(preResumeWatch));
    assert.equal(preResumeWatch.details.events, authoritativeEvents.length);
    writeFileSync(eventsPath, authoritativeText, "utf8");

    const resumed = await resumeNamedWorkflow({
      run_id: runId,
      task: "preserve exact terminal event evidence",
      cwd,
      state_root: stateRoot,
      package_root: packageRoot,
      chain_registry: chains,
      run_registry: runs,
      expected_binding_ref: binding,
    });
    assert.equal(resumed.ok, true, JSON.stringify(resumed));
    const events = readFileSync(resumed.events_path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(events.filter((event) => event.kind === "run-end" && event.status === "succeeded").length, 1);
    const effectCompletions = events.filter((event) => [
      "effect-end", "effect-resumed", "effect-recovered", "effect-cache-hit",
    ].includes(event.kind));
    assert.ok(effectCompletions.some((event) => event.kind === "effect-end"), executionMode);
    assert.equal(effectCompletions.every((event) => effectCompletions
      .filter((candidate) => candidate.effect_ref === event.effect_ref).length === 1), true, executionMode);
    const terminalEnd = events.findIndex((event) => event.kind === "node-end" && event.status === "succeeded");
    assert.ok(terminalEnd >= 0);
    assert.equal(events[terminalEnd + 1].kind, "run-end");
    assert.equal(events[terminalEnd + 1].status, "succeeded");
  }
});

test("post-publication snapshot cleanup failure remains durable maintenance debt", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-checkpoint-maintenance-"));
  const cwd = repo();
  installWorkflow(stateRoot, "checkpoint-maintenance");
  const runId = "checkpoint-maintenance-run";
  const outside = mkdtempSync(join(tmpdir(), "helix-checkpoint-symlink-"));
  let obstructed = null;
  const result = await executeNamedWorkflow({
    workflow_id: "checkpoint-maintenance", task: "retain cleanup debt", run_id: runId, cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: executionBinding(stateRoot, "checkpoint-maintenance"),
    onEvent(event) {
      if (obstructed != null || event.kind !== "effect-start") return;
      const root = join(cwd, ".git", "helix-checkpoints", runId);
      const generation = readdirSync(root).find((entry) => entry.startsWith("kernel-"));
      assert.ok(generation);
      obstructed = generation;
      rmSync(join(root, generation), { recursive: true, force: true });
      symlinkSync(outside, join(root, generation), "dir");
    },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  const document = JSON.parse(readFileSync(join(stateRoot, "private", "runs", runId, "kernel-checkpoint.json"), "utf8"));
  assert.equal(document.schema_version, 2);
  assert.equal(document.maintenance.cleanup_generations.includes(obstructed), true, JSON.stringify({ obstructed, maintenance: document.maintenance }));
  assert.equal(JSON.parse(readFileSync(join(stateRoot, "runs", runId, `${runId}.state.json`), "utf8")).completed, true);
  rmSync(stateRoot, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

test("product execution pins and runs a depth-one named subworkflow through the same kernel", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-product-subworkflow-"));
  const cwd = repo();
  const childGate = { type: "file-contains", path: "child.md", contains: "CHILD_PASS" };
  const child = workflow({
    id: "child-v4", name: "Child", description: "Child workflow.", start: "child-work",
    nodes: {
      "child-work": pipeline([agent({ role: "builder", stage_id: "child-work", mutation: "shared-serialized", timeout_ms: 1_000 })], "child-objective", { max_visits: 1, artifact: { path: "child.md", kind: "notes" } }),
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
      "parent-work": pipeline([agent({ role: "builder", stage_id: "parent-work", mutation: "shared-serialized", timeout_ms: 1_000 })], "child", { max_visits: 1, artifact: { path: "parent.md", kind: "notes" } }),
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
  const smoke = await smokeTestWorkflowRuntime({ workflow: parent.definition, subworkflows: [child.definition], cwd });
  assert.equal(smoke.ok, true, JSON.stringify(smoke));
  assert.equal(smoke.nodes_exercised, 7);
  assert.equal(smoke.effects_exercised, 2);
  assert.equal(smoke.transitions_exercised, 5);
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
  assert.equal(watch.details.child_graphs.length, 1);
  assert.equal(watch.details.child_graphs[0].workflow_id, "child-v4");
  assert.equal(watch.details.child_graphs[0].current_node, null);
  assert.equal(watch.details.child_graphs[0].last_node, "child-success");
  assert.match(watch.text, /Child subworkflow-run\.child\.1: child-v4 v1/);
  const listed = executeHelixCommand("runs list", { mode: "print" }, {
    stateRoot, runsRoot: join(stateRoot, "runs"), chainRegistry: chains, runRegistry: runs,
  });
  assert.equal(listed.ok, true, JSON.stringify(listed));
  assert.equal(listed.details.runs.some((entry) => entry.kind === "invalid"), false);
  assert.equal(listed.details.runs.filter((entry) => entry.run_id === "subworkflow-run").length, 1);
  const status = executeHelixCommand("runs status subworkflow-run", { mode: "print" }, {
    stateRoot, runsRoot: join(stateRoot, "runs"), chainRegistry: chains, runRegistry: runs,
  });
  assert.equal(status.ok, true, JSON.stringify(status));
  assert.equal(status.details.entries.some((entry) => entry.kind === "invalid"), false);
  const eventsPath = join(stateRoot, "runs", "subworkflow-run", "subworkflow-run.kernel.events.jsonl");
  const originalText = readFileSync(eventsPath, "utf8");
  const tampered = originalText.trim().split("\n").map((line) => JSON.parse(line));
  const wrapper = tampered.find((event) => event.kind === "subworkflow-event" && event.child_kind === "node-start");
  assert.ok(wrapper);
  wrapper.child_visit += 1;
  writeFileSync(eventsPath, `${tampered.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
  const tamperedWatch = executeHelixCommand("runs watch subworkflow-run", { mode: "print" }, {
    stateRoot, runsRoot: join(stateRoot, "runs"), chainRegistry: chains, runRegistry: runs,
  });
  assert.equal(tamperedWatch.ok, false);
  assert.equal(tamperedWatch.details.detail, "event-prefix");
  writeFileSync(eventsPath, originalText, "utf8");
});

test("product resume retains a completed child's terminal proof across its parent transition", async () => {
  for (const executionMode of ["original-mode", "graph-mode"]) {
    const stateRoot = mkdtempSync(join(tmpdir(), `helix-child-terminal-resume-${executionMode}-`));
    const cwd = repo();
    const objective = {
      type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000,
    };
    const childId = `child-terminal-${executionMode}`;
    const parentId = `parent-terminal-${executionMode}`;
    const runId = `child-terminal-run-${executionMode}`;
    const child = workflow({
      id: childId, name: "Terminal child", description: "A deterministic child workflow.", start: "objective",
      nodes: {
        objective: objectiveGate("success", "failed"),
        success: terminal("succeeded"),
        failed: terminal("failed", "child-objective-failed"),
      },
      objective_gate: objective,
    });
    const parent = workflow({
      id: parentId, name: "Terminal child parent", description: "A parent that resumes after its child terminal.", start: "child",
      nodes: {
        child: subworkflow(childId, 1, "objective"),
        objective: objectiveGate("success", "failed"),
        success: terminal("succeeded"),
        failed: terminal("failed", "parent-objective-failed"),
      },
      objective_gate: objective,
    });
    assert.equal(child.ok, true, JSON.stringify(child.errors));
    assert.equal(parent.ok, true, JSON.stringify(parent.errors));
    assert.equal(saveUserWorkflowV4(stateRoot, child.definition).ok, true);
    assert.equal(saveUserWorkflowV4(stateRoot, parent.definition).ok, true);
    const binding = executionBinding(stateRoot, parentId, null, executionMode);
    let failed = false;
    const interrupted = await executeNamedWorkflow({
      workflow_id: parentId,
      task: "resume after the child terminal",
      run_id: runId,
      execution_mode: executionMode,
      cwd,
      state_root: stateRoot,
      package_root: packageRoot,
      chain_registry: chains,
      run_registry: runs,
      expected_binding_ref: binding,
      onEvent(event) {
        if (!failed && event.kind === "transition" && event.node_id === "child") {
          failed = true;
          throw new Error("synthetic-parent-transition-write-failure");
        }
      },
    });
    assert.equal(failed, true, executionMode);
    assert.equal(interrupted.code, "kernel-event-write-failed", executionMode);
    assert.equal(interrupted.resumable, true, executionMode);

    const resumed = await resumeNamedWorkflow({
      run_id: runId,
      task: "resume after the child terminal",
      cwd,
      state_root: stateRoot,
      package_root: packageRoot,
      chain_registry: chains,
      run_registry: runs,
      expected_binding_ref: binding,
    });
    assert.equal(resumed.ok, true, JSON.stringify(resumed));
    assert.equal(resumed.converged, true, executionMode);
    const events = readFileSync(resumed.events_path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(events.filter((event) => event.kind === "subworkflow-event"
      && event.node_id === "child" && event.child_kind === "run-end").length, 1, executionMode);
    const watched = executeHelixCommand(`runs watch ${runId}`, { mode: "print" }, {
      stateRoot, runsRoot: join(stateRoot, "runs"), chainRegistry: chains, runRegistry: runs,
    });
    assert.equal(watched.ok, true, JSON.stringify(watched));
    assert.equal(watched.details.child_graphs.length, 1, executionMode);
    assert.equal(watched.details.child_graphs[0].last_node, "success", executionMode);
  }
});

test("parent preflight includes every pinned child cast and runtime requirement", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-child-cast-preflight-"));
  const cwd = repo();
  const objective = { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 };
  const child = workflow({
    id: "child-real-cast", name: "Child real cast", description: "Child with a non-mock assignment.", start: "work",
    nodes: {
      work: pipeline([agent({ role: "reviewer", stage_id: "work", mutation: "read-only", timeout_ms: 1_000 })], "objective"),
      objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "child-failed"),
    },
    provider_policy: {
      exact: true, assignments: {},
      default_assignment: { kind: "model", provider: "openrouter", model: "vendor/child:free", effort: "high" },
      require_live_certification: false,
    },
    objective_gate: objective,
  });
  const parent = workflow({
    id: "parent-mock-cast", name: "Parent mock cast", description: "Parent whose child owns the real assignment.", start: "parent-work",
    nodes: {
      "parent-work": pipeline([agent({ role: "reviewer", stage_id: "parent-work", mutation: "read-only", timeout_ms: 1_000 })], "child"),
      child: subworkflow("child-real-cast", 1, "objective"),
      objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "parent-failed"),
    },
    objective_gate: objective,
  });
  assert.equal(child.ok, true, JSON.stringify(child.errors));
  assert.equal(parent.ok, true, JSON.stringify(parent.errors));
  assert.equal(saveUserWorkflowV4(stateRoot, child.definition).ok, true);
  assert.equal(saveUserWorkflowV4(stateRoot, parent.definition).ok, true);
  const inventory = [{ provider: "openrouter", model: "vendor/child:free", reasoning: true, supported_efforts: ["high"] }];
  const preflight = executeHelixCommand("run parent-mock-cast", { mode: "print" }, {
    stateRoot, chainRegistry: chains, runRegistry: runs, modelInventory: inventory, cwd,
  });
  assert.equal(preflight.ok, true, JSON.stringify(preflight));
  assert.deepEqual(preflight.details.providers.sort(), ["mock", "openrouter"]);
  assert.equal(preflight.details.cast.some((stage) => stage.stage_id === "child-real-cast/work"), true);
  const result = await executeNamedWorkflow({
    workflow_id: "parent-mock-cast", task: "must preflight the child", run_id: "child-cast-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: preflight.details.execution_binding_ref,
  });
  assert.equal(result.code, "provider-exact-adapter-required");
  assert.equal(existsSync(join(stateRoot, "runs", "child-cast-run")), false);
});

test("child-only workflows deploy and compile agent prompts from the child objective", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-child-only-"));
  const cwd = repo();
  const childObjective = { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)", "child-objective-marker"], timeout_ms: 1_000 };
  const child = workflow({
    id: "child-only-work", name: "Child only work", description: "The child owns all model work.", start: "work",
    nodes: {
      work: pipeline([agent({ role: "reviewer", stage_id: "child-stage", mutation: "read-only", timeout_ms: 1_000 })], "objective"),
      objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "child-failed"),
    },
    provider_policy: {
      exact: true, assignments: {},
      default_assignment: { kind: "model", provider: "openrouter", model: "vendor/child-only:free", effort: "high" },
      require_live_certification: false,
    },
    objective_gate: childObjective,
  });
  const parent = workflow({
    id: "parent-child-only", name: "Parent child only", description: "The parent has no local agent.", start: "child",
    nodes: {
      child: subworkflow("child-only-work", 1, "objective"),
      objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "parent-failed"),
    },
    objective_gate: { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)", "parent-objective-marker"], timeout_ms: 1_000 },
  });
  assert.equal(child.ok, true, JSON.stringify(child.errors));
  assert.equal(parent.ok, true, JSON.stringify(parent.errors));
  assert.equal(saveUserWorkflowV4(stateRoot, child.definition).ok, true);
  assert.equal(saveUserWorkflowV4(stateRoot, parent.definition).ok, true);
  const inventory = [{ provider: "openrouter", model: "vendor/child-only:free", reasoning: true, supported_efforts: ["high"] }];
  const preflight = executeHelixCommand("run parent-child-only", { mode: "print" }, {
    stateRoot, chainRegistry: chains, runRegistry: runs, modelInventory: inventory, cwd,
  });
  assert.equal(preflight.ok, true, JSON.stringify(preflight));
  const exactRef = `sha256:${"8".repeat(64)}`;
  let prompt = null;
  const adapter = {
    kind: "helix-pi-agent", exactMode: true, supportsProvider: () => true, attests: () => true,
    async preflightExact() { return { ok: true, bindings: [{ provider: "openrouter" }], binding_ref: exactRef }; },
    async runCandidate(spec, ctx) {
      prompt = ctx.prompt;
      return {
        schema_version: 2, run_id: ctx.run_id, stage: "candidate", role: spec.role,
        provider: spec.provider, model: spec.model,
        requested: { provider: spec.provider, model: spec.model, effort: spec.effort },
        effective: { provider: spec.provider, model: spec.model, effort: spec.effort,
          evidence: { provider: "verified-response", model: "verified-response", effort: "verified-session" } },
        attestation_ref: `sha256:${"7".repeat(64)}`, usage: { input_tokens: 1, output_tokens: 1 }, attempt: 1, iteration: 1,
        input_ref: { kind: "local-ref", value: "local-ref:input/child-only", algorithm: null },
        claims_ref: "local-ref:claims/child-only", evidence_ref: "local-ref:evidence/child-only",
        uncertainty: [], risks: [], recommendation: "approve", proposed_actions: [], open_questions: [], status: "ok",
      };
    },
  };
  const result = await executeNamedWorkflow({
    workflow_id: "parent-child-only", task: "execute the child", run_id: "child-only-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: preflight.details.execution_binding_ref, expected_exact_ref: exactRef, adapter,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(prompt, /child-only-work/);
  assert.match(prompt, /child-objective-marker/);
  assert.doesNotMatch(prompt, /parent-objective-marker/);
});

test("parent and child input incompatibility refuses during deployment preflight", () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-child-input-binding-"));
  const cwd = repo();
  const objective = { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 };
  const child = workflow({
    id: "child-input-closed", name: "Child input closed", description: "Child accepts only task.", start: "objective",
    nodes: { objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "child-failed") },
    objective_gate: objective,
  });
  const parent = workflow({
    id: "parent-input-extra", name: "Parent input extra", description: "Parent adds an input field.", start: "child",
    inputs: {
      type: "object", additionalProperties: false, required: ["task"],
      properties: { task: { type: "string", minLength: 1 }, mode: { type: "string", default: "safe" } },
    },
    nodes: {
      child: subworkflow("child-input-closed", 1, "objective"), objective: objectiveGate("success", "failed"),
      success: terminal("succeeded"), failed: terminal("failed", "parent-failed"),
    },
    objective_gate: objective,
  });
  assert.equal(child.ok, true, JSON.stringify(child.errors));
  assert.equal(parent.ok, true, JSON.stringify(parent.errors));
  assert.equal(saveUserWorkflowV4(stateRoot, child.definition).ok, true);
  assert.equal(saveUserWorkflowV4(stateRoot, parent.definition).ok, true);
  const preflight = executeHelixCommand("run parent-input-extra", { mode: "print" }, {
    stateRoot, chainRegistry: chains, runRegistry: runs, cwd,
  });
  assert.equal(preflight.ok, false);
  assert.equal(preflight.code, "kernel-subworkflow-binding-invalid");
});

test("checkpoint resume consent is consumed by exactly one recorded visit", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-checkpoint-once-"));
  const cwd = repo();
  const objective = { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 };
  const built = workflow({
    id: "checkpoint-once", name: "Checkpoint once", description: "Every visit requires fresh consent.", start: "approval",
    nodes: {
      approval: checkpoint("operator-approval", "route"),
      route: decision([{ when: { op: "always" }, target: "approval", loop: true }], "failed", { loops_off: "objective" }),
      objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "failed"),
    },
    objective_gate: objective,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  assert.equal(saveUserWorkflowV4(stateRoot, built.definition).ok, true);
  const binding = executionBinding(stateRoot, "checkpoint-once");
  const paused = await executeNamedWorkflow({
    workflow_id: "checkpoint-once", task: "approve one visit", run_id: "checkpoint-once-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding,
  });
  assert.equal(paused.stop_reason, "paused");
  const resumed = await resumeNamedWorkflow({
    run_id: "checkpoint-once-run", task: "approve one visit", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding,
  });
  assert.equal(resumed.stop_reason, "paused");
  const privateState = JSON.parse(readFileSync(join(stateRoot, "private", "runs", "checkpoint-once-run", "kernel-checkpoint.json"), "utf8"));
  assert.equal(privateState.scheduler.current, "approval");
  assert.equal(privateState.scheduler.active.visit, 2);
});

test("child checkpoint consent cannot auto-approve a fresh child execution", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-child-checkpoint-once-"));
  const cwd = repo();
  const objective = { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 };
  const child = workflow({
    id: "child-checkpoint-once", name: "Child checkpoint once", description: "Child consent is visit-bound.", start: "approval",
    nodes: {
      approval: checkpoint("child-approval", "objective"), objective: objectiveGate("success", "failed"),
      success: terminal("succeeded"), failed: terminal("failed", "child-failed"),
    },
    objective_gate: objective,
  });
  const parent = workflow({
    id: "parent-child-checkpoint-once", name: "Parent child checkpoint once", description: "A fresh child pauses again.", start: "child",
    nodes: {
      child: subworkflow("child-checkpoint-once", 1, "route"),
      route: decision([{ when: { op: "always" }, target: "child", loop: true }], "failed", { loops_off: "objective" }),
      objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "parent-failed"),
    },
    objective_gate: objective,
  });
  assert.equal(child.ok, true, JSON.stringify(child.errors));
  assert.equal(parent.ok, true, JSON.stringify(parent.errors));
  assert.equal(saveUserWorkflowV4(stateRoot, child.definition).ok, true);
  assert.equal(saveUserWorkflowV4(stateRoot, parent.definition).ok, true);
  const binding = executionBinding(stateRoot, "parent-child-checkpoint-once");
  const paused = await executeNamedWorkflow({
    workflow_id: "parent-child-checkpoint-once", task: "approve one child", run_id: "child-checkpoint-once-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding,
  });
  assert.equal(paused.stop_reason, "paused");
  const resumed = await resumeNamedWorkflow({
    run_id: "child-checkpoint-once-run", task: "approve one child", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding,
  });
  assert.equal(resumed.stop_reason, "paused");
  const privateState = JSON.parse(readFileSync(
    join(stateRoot, "private", "runs", "child-checkpoint-once-run", "kernel-checkpoint.json"), "utf8",
  ));
  assert.equal(privateState.scheduler.current, "child");
  assert.equal(privateState.scheduler.active.child.scheduler.current, "approval");
  assert.equal(privateState.scheduler.active.child.scheduler.active.visit, 1);
});

test("a child checkpoint resumes through its namespaced parent state", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-child-checkpoint-"));
  const cwd = repo();
  const childObjective = { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 };
  const child = workflow({
    id: "child-pause", name: "Child pause", description: "Child pause workflow.", start: "work",
    nodes: {
      work: pipeline([agent({ role: "reviewer", stage_id: "work", output_schema: "verdict-v1", mutation: "read-only", timeout_ms: 1_000 })], "approval", { max_visits: 1 }),
      approval: checkpoint("child-approval", "objective"),
      objective: objectiveGate("success", "failed"),
      success: terminal("succeeded"),
      failed: terminal("failed", "child-failed"),
    },
    objective_gate: childObjective,
  });
  const parentObjective = { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 };
  const parent = workflow({
    id: "parent-pause", name: "Parent pause", description: "Parent pause workflow.", start: "work",
    nodes: {
      work: pipeline([agent({ role: "reviewer", stage_id: "work", output_schema: "verdict-v1", mutation: "read-only", timeout_ms: 1_000 })], "child", { max_visits: 1 }),
      child: subworkflow("child-pause", 1, "objective"),
      objective: objectiveGate("success", "failed"),
      success: terminal("succeeded"),
      failed: terminal("failed", "parent-failed"),
    },
    objective_gate: parentObjective,
  });
  assert.equal(child.ok, true, JSON.stringify(child.errors));
  assert.equal(parent.ok, true, JSON.stringify(parent.errors));
  assert.equal(saveUserWorkflowV4(stateRoot, child.definition).ok, true);
  assert.equal(saveUserWorkflowV4(stateRoot, parent.definition).ok, true);
  const binding = executionBinding(stateRoot, "parent-pause");
  const paused = await executeNamedWorkflow({
    workflow_id: "parent-pause", task: "pause child", run_id: "child-pause-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding,
  });
  assert.equal(paused.stop_reason, "paused");
  const resumed = await resumeNamedWorkflow({
    run_id: "child-pause-run", task: "pause child", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding,
  });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(resumed.converged, true);
});

test("checkpoint node pauses durably and attended resume is its explicit continue action", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-product-checkpoint-"));
  const cwd = repo();
  const objective = { type: "file-contains", path: "checkpoint.md", contains: "PASS" };
  const built = workflow({
    id: "checkpoint-v4", name: "Checkpoint", description: "Checkpoint workflow.", start: "work",
    nodes: {
      work: pipeline([agent({ role: "builder", stage_id: "work", mutation: "shared-serialized", timeout_ms: 1_000 })], "approval", { max_visits: 1, artifact: { path: "checkpoint.md", kind: "notes" } }),
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
  const watched = executeHelixCommand("runs watch checkpoint-run", { mode: "print" }, {
    stateRoot, runsRoot: join(stateRoot, "runs"), chainRegistry: chains, runRegistry: runs,
  });
  assert.equal(watched.ok, true, JSON.stringify(watched));
  assert.match(watched.text, /\(paused; resume required\)/);
  assert.match(watched.text, /Node: approval \(checkpoint, running\)/);
  const resumeOptions = {
    run_id: "checkpoint-run", task: "pause and continue", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding,
  };
  const attempts = await Promise.all([resumeNamedWorkflow(resumeOptions), resumeNamedWorkflow(resumeOptions)]);
  const resumed = attempts.find((entry) => entry.ok);
  const concurrent = attempts.find((entry) => entry.code === "resume-in-progress");
  assert.ok(resumed, JSON.stringify(attempts));
  assert.ok(concurrent, JSON.stringify(attempts));
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

test("named v4 workflows refuse worktree-off before consent or run creation", () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-worktree-required-"));
  const cwd = repo();
  installWorkflow(stateRoot, "worktree-required");
  const changed = executeHelixCommand("settings set worktree off", { mode: "tui", confirm: true }, {
    stateRoot, chainRegistry: chains, runRegistry: runs, cwd,
  });
  assert.equal(changed.ok, true, JSON.stringify(changed));
  const preflight = executeHelixCommand("run worktree-required", { mode: "tui" }, {
    stateRoot, chainRegistry: chains, runRegistry: runs, cwd,
  });
  assert.equal(preflight.code, "workflow-canonical-worktree-required");
  assert.equal(existsSync(join(stateRoot, "runs")), false);
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

  const singleTurnAdapter = createPiAgentAdapter({
    modelRegistry: {
      authStorage: { async getApiKey() { throw new Error("must not inspect credentials"); } },
      find: () => ({ provider: "openrouter", id: "vendor/exact:free" }),
      hasConfiguredAuth: () => true,
    },
    exactMode: true,
  });
  const toolBearing = await executeNamedWorkflow({
    workflow_id: "real-exact-flow", task: "must refuse before provider preflight", run_id: "exact-tools-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: executionBinding(stateRoot, "real-exact-flow", inventory), adapter: singleTurnAdapter,
  });
  assert.equal(toolBearing.code, "provider-exact-multi-turn-disabled");
  assert.equal(existsSync(join(stateRoot, "runs", "exact-tools-run")), false);

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

  const mismatchAdapter = {
    ...exactAdapter,
    async runCandidate(spec, ctx) {
      return {
        schema_version: 2, run_id: ctx.run_id, stage: "candidate", role: spec.role,
        provider: spec.provider, model: spec.model,
        requested: { provider: spec.provider, model: spec.model, effort: spec.effort },
        effective: {
          provider: spec.provider, model: spec.model, effort: "low",
          evidence: { provider: "verified-response", model: "verified-response", effort: "verified-session" },
        },
        attestation_ref: `sha256:${"4".repeat(64)}`,
        usage: { input_tokens: 1, output_tokens: 1 }, attempt: 1, iteration: 1,
        input_ref: { kind: "local-ref", value: "local-ref:input/exact", algorithm: null },
        claims_ref: "local-ref:claims/exact", evidence_ref: "local-ref:evidence/exact",
        uncertainty: [], risks: [], recommendation: "approve", proposed_actions: [], open_questions: [], status: "ok",
      };
    },
  };
  const mismatch = await executeNamedWorkflow({
    workflow_id: "real-exact-flow", task: "refuse effective effort mismatch", run_id: "exact-mismatch-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: executionBinding(stateRoot, "real-exact-flow", inventory),
    expected_exact_ref: `sha256:${"2".repeat(64)}`,
    adapter: mismatchAdapter,
  });
  assert.equal(mismatch.code, "provider-identity-unverified");
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
