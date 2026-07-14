// Provider-free runtime smoke test for one user workflow. The definition runs
// through the real staged runner in a temporary detached Git worktree. Model
// calls and the task-specific objective check are simulated explicitly; stage
// effects, artifacts, transitions, checkpoints, and cleanup are real.

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { workflowToExecution } from "../../dispatch/lib/workflows.mjs";
import { loadPresetRegistry } from "../../dispatch/lib/presets.mjs";
import { defaultSettings, toggleVector } from "../../dispatch/lib/settings.mjs";
import { runStagedTaskLoop } from "../../dispatch/lib/runner.mjs";

function git(cwd, args) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function simulatedGate(workflow) {
  return async (ctx) => {
    let result = "pass";
    if (ctx.phase === "stage-expectation") {
      const stage = workflow.stages.find((candidate) => candidate.id === ctx.stage_id);
      result = stage?.transitions.find((transition) =>
        transition.action === "advance" && transition.when.type === "gate")?.when.is ?? "pass";
    }
    return { command_names: ["workflow-runtime-smoke"], result, source: "deterministic-checker" };
  };
}

export async function smokeTestWorkflowRuntime({ workflow, cwd, package_root, signal = null, onEvent = null } = {}) {
  const execution = workflowToExecution(workflow);
  if (!execution.ok) return { ok: false, code: execution.code ?? "workflow-runtime-smoke-invalid" };
  const top = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (top.status !== 0 || !top.stdout.trim()) return { ok: false, code: "workflow-runtime-smoke-git-required" };
  const repoRoot = top.stdout.trim();
  const root = mkdtempSync(join(tmpdir(), "helix-workflow-smoke-"));
  const checkout = join(root, "repo");
  const stateDir = join(root, "state");
  let added = false;
  let result = null;
  let failure = null;
  let cleanupOk = true;
  try {
    const add = git(repoRoot, ["worktree", "add", "--detach", checkout, "HEAD"]);
    if (add.status !== 0) {
      failure = "workflow-runtime-smoke-worktree-failed";
    } else {
      added = true;
      mkdirSync(stateDir, { recursive: true });
      const presets = loadPresetRegistry(join(package_root, "dispatch", "config", "matrices"));
      if (!presets.ok) {
        failure = presets.code;
      } else {
        const toggles = { ...toggleVector(defaultSettings()), worktree: false };
        const smokeConfig = {
          ...execution.config,
          assignments: {},
          default_assignment: { kind: "composite", preset: "daily" },
        };
        result = await runStagedTaskLoop(smokeConfig, {
          chainRegistry: { schema_version: 3, chains: [execution.chain] },
          presets: presets.presets,
        }, {
          cwd: checkout,
          now: Date.now(),
          seed: 7,
          run_id: `smoke-${process.pid}-${Date.now().toString(36)}`,
          task_instruction: "Exercise this workflow definition without provider calls.",
          toggles,
          signal,
          record_dir: stateDir,
          state_dir: stateDir,
          objective_gate_effect: simulatedGate(workflow),
          events: {
            dir: stateDir,
            ...(typeof onEvent === "function" ? { onEvent } : {}),
          },
        });
      }
    }
  } catch {
    failure = "workflow-runtime-smoke-failed";
  } finally {
    if (added && git(repoRoot, ["worktree", "remove", "--force", checkout]).status !== 0) cleanupOk = false;
    rmSync(root, { recursive: true, force: true });
  }
  if (!cleanupOk) return { ok: false, code: "workflow-runtime-smoke-cleanup-failed" };
  if (failure) return { ok: false, code: failure };
  if (!result?.ok || result.converged !== true) {
    return { ok: false, code: result?.code ?? result?.stop_reason ?? "workflow-runtime-smoke-failed" };
  }
  return {
    ok: true,
    provider_calls: 0,
    objective_check: "simulated",
    total_passes: result.total_passes,
    stages_exercised: workflow.stages.length,
  };
}
