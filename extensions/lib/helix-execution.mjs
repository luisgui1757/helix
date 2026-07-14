// In-process workflow execution for the Pi extension. This keeps Pi's configured
// ModelRegistry/AuthStorage in scope, runs the canonical workflow-derived
// chain/config, and keeps the raw user task in memory for the duration of the run.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadPresetRegistry } from "../../dispatch/lib/presets.mjs";
import { loadSettings, toggleVector, DEFAULT_SETTINGS_REL_PATH } from "../../dispatch/lib/settings.mjs";
import { prepareRunDirectory, validateRunId } from "../../dispatch/lib/run-manager.mjs";
import { writeTextAtomic } from "../../dispatch/lib/persistence.mjs";
import { hashRef, stableStringify } from "../../dispatch/lib/run-record.mjs";
import { makeGitWorktreeEffect, runStagedTaskLoop } from "../../dispatch/lib/runner.mjs";
import {
  workflowExecutionBindingRef,
  workflowLifecycleSnapshot,
  workflowRequiredHostEffects,
  workflowToExecution,
} from "../../dispatch/lib/workflows.mjs";
import {
  applyProfileToConfig,
  applyProfileToPresets,
  resolveActiveProfile,
} from "./helix-local.mjs";
import { resolveWorkflow } from "./helix-workflows.mjs";

export async function executeNamedWorkflow({
  workflow_id,
  task,
  run_id,
  cwd,
  state_root,
  package_root,
  chain_registry,
  run_registry,
  adapter = null,
  expected_binding_ref,
  signal = null,
  now = Date.now(),
  onEvent = null,
} = {}) {
  if (![cwd, state_root, package_root].every((value) => typeof value === "string" && value.length > 0)) {
    return { ok: false, status: "fail-closed", code: "workflow-execution-path-invalid" };
  }
  if (!validateRunId(run_id).ok) return { ok: false, status: "fail-closed", code: "unsafe-run-id" };
  if (typeof task !== "string" || task.trim() === "") {
    return { ok: false, status: "fail-closed", code: "workflow-task-required" };
  }
  const named = resolveWorkflow(state_root, workflow_id, chain_registry, run_registry);
  if (!named.ok) return { ok: false, status: "fail-closed", code: named.code };
  const execution = workflowToExecution(named.workflow);
  if (!execution.ok) return { ok: false, status: "fail-closed", code: execution.code };
  const hostEffects = workflowRequiredHostEffects(named.workflow);
  if (hostEffects.length > 0) {
    return { ok: false, status: "fail-closed", code: "workflow-host-effects-unavailable" };
  }

  const active = resolveActiveProfile(state_root);
  if (!active.ok) return { ok: false, status: "fail-closed", code: active.code };
  const config = applyProfileToConfig(execution.config, active.profile, {
    stageIds: execution.chain.stages.map((stage) => stage.id),
  }).config;
  const presets = loadPresetRegistry(join(package_root, "dispatch", "config", "matrices"));
  if (!presets.ok) return { ok: false, status: "fail-closed", code: presets.code };
  const profiled = applyProfileToPresets(presets.presets, active.profile);
  if (!profiled.ok) return { ok: false, status: "fail-closed", code: profiled.code };
  const settings = loadSettings(join(state_root, DEFAULT_SETTINGS_REL_PATH));
  if (!settings.ok) return { ok: false, status: "fail-closed", code: settings.code };
  if (typeof expected_binding_ref !== "string" || !/^sha256:[0-9a-f]{64}$/.test(expected_binding_ref)) {
    return { ok: false, status: "fail-closed", code: "workflow-execution-binding-required" };
  }
  const toggles = toggleVector(settings.settings);
  const actualBindingRef = workflowExecutionBindingRef({
    workflow: named.workflow,
    profile: active.profile,
    toggles,
    presets: profiled.presets,
  });
  if (actualBindingRef !== expected_binding_ref) {
    return { ok: false, status: "fail-closed", code: "workflow-preflight-drift" };
  }

  const runsRoot = join(state_root, "runs");
  const runPath = join(runsRoot, run_id);
  if (existsSync(runPath)) return { ok: false, status: "fail-closed", code: "fresh-run-id-exists" };

  const prepared = prepareRunDirectory(runsRoot, run_id, { clean: false });
  if (!prepared.ok) return { ok: false, status: "fail-closed", code: prepared.code };
  const lifecycle = workflowLifecycleSnapshot(named.workflow);
  if (!lifecycle) return { ok: false, status: "fail-closed", code: "workflow-lifecycle-snapshot-invalid" };
  const lifecycleText = stableStringify(lifecycle);
  const workflowRef = hashRef(lifecycleText);
  try {
    writeTextAtomic(prepared.path, `${run_id}.workflow.json`, `${lifecycleText}\n`);
  } catch {
    return { ok: false, status: "fail-closed", code: "workflow-lifecycle-snapshot-write-failed" };
  }

  return runStagedTaskLoop(config, {
    chainRegistry: { schema_version: 3, chains: [execution.chain] },
    presets: profiled.presets,
  }, {
    cwd,
    now,
    seed: 7,
    run_id,
    task_instruction: task,
    workflow_ref: workflowRef,
    runtime_limits: {
      max_runtime_ms: named.workflow.stop.max_runtime_ms,
      call_timeout_ms: named.workflow.deployment.call_timeout_ms,
    },
    toggles,
    signal,
    record_dir: prepared.path,
    state_dir: prepared.path,
    worktree: makeGitWorktreeEffect(cwd),
    ...(adapter ? { adapter } : {}),
    events: {
      dir: prepared.path,
      monotonic: () => performance.now(),
      ...(typeof onEvent === "function" ? { onEvent } : {}),
    },
  });
}
