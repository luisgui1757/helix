// In-process workflow execution for the Pi extension. This keeps Pi's configured
// ModelRegistry/AuthStorage in scope, runs the canonical workflow-derived
// chain/config, and keeps the raw user task in memory for the duration of the run.

import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadPresetRegistry } from "../../dispatch/lib/presets.mjs";
import { loadSettings, toggleVector, DEFAULT_SETTINGS_REL_PATH } from "../../dispatch/lib/settings.mjs";
import { prepareRunDirectory, validateRunId } from "../../dispatch/lib/run-manager.mjs";
import { writeTextAtomic } from "../../dispatch/lib/persistence.mjs";
import { hashRef, stableStringify } from "../../dispatch/lib/run-record.mjs";
import {
  createStagedMockAdapter,
  makeGitWorktreeEffect,
  makePrivateCheckpointEffect,
} from "../../dispatch/lib/runner.mjs";
import { resolveChainCast } from "../../dispatch/lib/presets.mjs";
import { compileStepPrompt } from "../../dispatch/lib/prompt-compiler.mjs";
import { assertRoleEnvelope } from "../../dispatch/lib/role-envelope.mjs";
import { makeObjectiveGate } from "../../dispatch/lib/task-loop.mjs";
import { appendText } from "../../dispatch/lib/persistence.mjs";
import { normalizeWorkflowDefinition, workflowDefinitionHash } from "../../dispatch/workflow/schema.mjs";
import { runWorkflowKernel } from "../../dispatch/kernel/scheduler.mjs";
import { createCanonicalWorkspace } from "../../dispatch/kernel/workspace.mjs";
import { createEffectJournal } from "../../dispatch/kernel/journal.mjs";
import { validateKernelCheckpoint } from "../../dispatch/kernel/state.mjs";
import { frameContent } from "../../dispatch/kernel/content.mjs";
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

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function aggregateRecommendation(envelopes) {
  const values = envelopes.map((entry) => entry.recommendation);
  if (values.includes("revise-jump")) return "revise-jump";
  if (values.includes("revise")) return "revise";
  if (values.length > 0 && values.every((value) => value === "approve")) return "approve";
  return values.at(-1) ?? "missing";
}

function membersFor(stageCast, role) {
  return (stageCast?.roles?.[role] ?? []).flatMap((member) =>
    Array.from({ length: member.instances }, () => ({ ...member, role })));
}

function resolveCastContexts(candidates, presets, toggles) {
  const contexts = [];
  for (const candidate of candidates) {
    const resolved = resolveChainCast({
      chain: candidate.execution.chain,
      assignments: candidate.config.assignments ?? {},
      defaults: candidate.config.default_assignment ?? null,
      presets,
      toggles,
    });
    if (!resolved.ok) return { ok: false, code: resolved.code };
    contexts.push({ definition: candidate.definition, cast: resolved.cast });
  }
  return { ok: true, contexts };
}

function nonMockSpecs(castContexts) {
  return castContexts.flatMap((entry) => entry.cast).flatMap((stage) => [
    ...Object.entries(stage.roles ?? {}).flatMap(([role, members]) =>
      members.flatMap((member) => Array.from({ length: member.instances }, () => ({ ...member, role })))),
    ...Object.entries(stage.panel_roles ?? {}).flatMap(([role, member]) =>
      Array.from({ length: member.instances }, () => ({ ...member, role }))),
  ]).filter((spec) => spec.provider !== "mock");
}

async function certifyCast(adapter, specs, signal) {
  if (specs.length === 0) return { ok: true, bindings: [] };
  if (adapter?.kind !== "helix-pi-agent" || adapter.exactMode !== true
    || typeof adapter.preflightExact !== "function" || typeof adapter.attests !== "function"
    || specs.some((spec) => adapter.supportsProvider?.(spec.provider) !== true)) {
    return { ok: false, code: "provider-exact-adapter-required" };
  }
  try {
    const result = await adapter.preflightExact(specs, { signal });
    return result?.ok === true ? result : { ok: false, code: result?.code ?? "provider-exact-preflight-failed" };
  } catch {
    return { ok: false, code: "provider-exact-preflight-failed" };
  }
}

function publicKernelState({ runId, definition, definitionRef, result, worktree }) {
  return {
    schema_version: 4,
    run_id: runId,
    workflow_id: definition.id,
    workflow_version: definition.version,
    definition_ref: definitionRef,
    task_ref: result.task_ref,
    completed: result.completed,
    terminal: result.terminal,
    status: result.status,
    code: result.code,
    journal_entries: result.journal_entries,
    event_count: result.event_count,
    worktree_enabled: true,
    worktree_ref: worktree.worktree_ref,
    worktree_branch: worktree.branch_ref,
    worktree_owner_ref: worktree.owner_ref,
    baseline_ref: worktree.baseline_ref,
  };
}

async function executeKernelDefinition({
  definition, definitionRef, execution, config, presets, toggles, adapter, task, runId, cwd,
  prepared, packageRoot, stateRoot, signal, onEvent, castContexts, resumeDocument = null, subworkflows = [],
}) {
  if (!Array.isArray(castContexts) || castContexts.length !== subworkflows.length + 1) {
    return { ok: false, status: "fail-closed", code: "provider-cast-binding-invalid" };
  }
  const castResult = { ok: true, cast: castContexts[0].cast };
  const castsByDefinition = new Map(castContexts.map((entry) => [
    entry.definition.id,
    new Map(entry.cast.map((stage) => [stage.stage_id, stage])),
  ]));
  const definitionsByKey = new Map(subworkflows.map((entry) => [`${entry.definition.id}@${entry.definition.version}`, entry.definition]));
  const exactSpecs = nonMockSpecs(castContexts);
  const nonMock = exactSpecs.map((spec) => spec.provider);
  if (exactSpecs.length > 0 && (adapter?.exactMode !== true || typeof adapter.attests !== "function")) {
    return { ok: false, status: "fail-closed", code: "provider-exact-adapter-required" };
  }
  const taskRef = hashRef(task);
  const runtimeRef = hashRef(stableStringify({
    definition_ref: definitionRef,
    casts: castContexts.map((entry) => ({ workflow_id: entry.definition.id, version: entry.definition.version, cast: entry.cast })),
  }));
  if (resumeDocument) {
    const validResume = validateKernelCheckpoint(resumeDocument.scheduler, {
      run_id: runId,
      definition_ref: definitionRef,
      runtime_ref: runtimeRef,
      task_ref: taskRef,
      node_ids: new Set(Object.keys(definition.nodes)),
    });
    if (!validResume.valid) return { ok: false, status: "fail-closed", code: validResume.code };
  }
  const baselineOid = git(cwd, ["rev-parse", "--verify", "HEAD"]);
  if (!baselineOid) return { ok: false, status: "fail-closed", code: "run-repository-invalid" };
  const baselineRef = resumeDocument?.public_state?.baseline_ref ?? hashRef(baselineOid);
  const generation = `kernel-${definition.version}-${definitionRef.slice(-12)}`;
  const worktreeEffect = makeGitWorktreeEffect(cwd);
  let created;
  if (resumeDocument) {
    created = worktreeEffect.create(runId, {
      reuse: true,
      run_generation: generation,
      baseline_ref: baselineRef,
      owner_ref: resumeDocument.public_state.worktree_owner_ref,
    });
  } else {
    const checked = worktreeEffect.preflight(runId, { run_generation: generation, baseline_ref: baselineRef });
    if (!checked.ok) return { ok: false, status: "fail-closed", code: checked.code };
    const claimed = worktreeEffect.claim(runId, { run_generation: generation, baseline_ref: baselineRef });
    if (!claimed.ok || claimed.owner_ref !== checked.owner_ref) return { ok: false, status: "fail-closed", code: "worktree-create-failed" };
    created = worktreeEffect.create(runId, {
      reuse: false, run_generation: generation, baseline_ref: baselineRef, owner_ref: claimed.owner_ref,
    });
  }
  if (!created.ok) return { ok: false, status: "fail-closed", code: created.code };
  const checkpoint = makePrivateCheckpointEffect(cwd);
  if (!checkpoint) return { ok: false, status: "fail-closed", code: "private-checkpoint-failed" };
  if (resumeDocument) {
    const restored = checkpoint.restore(
      runId,
      resumeDocument.snapshot_generation,
      resumeDocument.snapshot_ref,
      created.path,
    );
    if (!restored.ok) return { ok: false, status: "fail-closed", code: "kernel-resume-snapshot-invalid" };
  }
  const workspace = createCanonicalWorkspace({
    cwd: created.path,
    run_id: runId,
    checkpoint_effect: checkpoint,
  });
  const mock = createStagedMockAdapter();
  const artifactChecks = new Map();
  const templatesDir = join(packageRoot, "dispatch", "config", "templates");
  const briefsDir = join(packageRoot, "dispatch", "config", "agents");
  const eventPath = `${runId}.kernel.events.jsonl`;
  let runningState = null;
  const emit = (event) => {
    appendText(prepared.path, eventPath, `${JSON.stringify(event)}\n`);
    if (runningState) {
      runningState.event_count = event.seq;
      writeTextAtomic(prepared.path, `${runId}.state.json`, `${stableStringify(publicKernelState({
        runId, definition, definitionRef, result: runningState,
        worktree: { ...created, baseline_ref: baselineRef },
      }))}\n`);
    }
    onEvent?.(event);
  };
  const executeAgent = async (node, ctx) => {
    const stageCast = castsByDefinition.get(ctx.definition_id)?.get(node.stage_id);
    const specs = membersFor(stageCast, node.role);
    if (specs.length === 0) return { ok: false, code: "kernel-agent-cast-missing" };
    let compiled;
    try {
      compiled = compileStepPrompt({
        template_id: "step-prompt-v1",
        templates_dir: templatesDir,
        briefs_dir: briefsDir,
        role: node.role,
        fields: {
          chain_id: definition.id,
          stage_id: node.stage_id,
          pass: 1,
          gate_summary: JSON.stringify(definition.objective_gate),
          artifact_summary: "workflow-node-output",
          task_instruction: frameContent("operator-task", task),
          handoff: frameContent("agent-output", ctx.local.upstream ?? ctx.local.item ?? null),
        },
      });
    } catch { compiled = null; }
    if (!compiled?.ok) return { ok: false, code: compiled?.code ?? "prompt-compile-failed" };
    const envelopes = [];
    for (const [index, spec] of specs.entries()) {
      const selected = spec.provider === "mock" && adapter == null ? mock.dispatchAdapter : adapter;
      if (!selected || typeof selected.runCandidate !== "function") {
        return { ok: false, code: "kernel-agent-adapter-missing" };
      }
      let envelope;
      try {
        envelope = await selected.runCandidate(spec, {
          run_id: `${runId}-${ctx.node_id}-${index}`,
          stage_id: node.stage_id,
          verdict_role: node.role === "reviewer" ? "reviewer" : null,
          prompt: compiled.prompt,
          cwd: ctx.cwd,
          pass: 1,
          attempt: 1,
          signal: ctx.signal,
        });
        assertRoleEnvelope(envelope);
      } catch { return { ok: false, code: "kernel-agent-envelope-invalid" }; }
      if (spec.provider !== "mock") {
        if (!envelope.effective || envelope.effective.evidence === "requested-only"
          || envelope.effective.provider !== spec.provider || envelope.effective.model !== spec.model
          || envelope.effective.effort !== spec.effort
          || adapter.attests(spec, envelope.attestation_ref) !== true) {
          return { ok: false, code: "provider-identity-unverified" };
        }
      }
      envelopes.push(envelope);
    }
    const value = envelopes.length === 1 ? envelopes[0] : {
      values: envelopes,
      recommendation: aggregateRecommendation(envelopes),
      uncertainty: envelopes.flatMap((entry) => entry.uncertainty),
      risks: envelopes.flatMap((entry) => entry.risks),
      proposed_actions: envelopes.flatMap((entry) => entry.proposed_actions),
      open_questions: envelopes.flatMap((entry) => entry.open_questions),
    };
    return {
      ok: true,
      value,
      usage: {
        tokens: envelopes.reduce((sum, entry) => sum + entry.usage.input_tokens + entry.usage.output_tokens, 0),
        cost_micros: 0,
      },
      attestation_ref: envelopes.length === 1 ? envelopes[0].attestation_ref ?? null : hashRef(stableStringify(envelopes.map((entry) => entry.attestation_ref ?? "mock"))),
    };
  };
  const verifyArtifact = async (artifact, ctx) => {
    const activeDefinition = ctx.definition_id === definition.id
      ? definition
      : subworkflows.find((entry) => entry.definition.id === ctx.definition_id)?.definition;
    const castByStage = castsByDefinition.get(ctx.definition_id);
    const stageCast = castByStage?.get(ctx.node_id) ?? castByStage?.get(activeDefinition?.nodes[ctx.node_id]?.stages?.[0]?.stage_id);
    const allMock = Object.values(stageCast?.roles ?? {}).flat().every((member) => member.provider === "mock");
    const path = join(ctx.cwd, artifact.path);
    const artifactKey = `${ctx.definition_id}:${artifact.path}`;
    const checks = (artifactChecks.get(artifactKey) ?? 0) + 1;
    artifactChecks.set(artifactKey, checks);
    if (allMock && !existsSync(path)) {
      const marker = activeDefinition?.objective_gate.type === "file-contains" && activeDefinition.objective_gate.path === artifact.path
        ? `\n${activeDefinition.objective_gate.contains}\n` : "\n";
      writeTextAtomic(ctx.cwd, artifact.path, `Synthetic no-egress ${artifact.kind} artifact.${marker}`);
    } else if (allMock && checks > 1 && activeDefinition?.objective_gate.type === "file-contains"
      && activeDefinition.objective_gate.path === artifact.path) {
      appendText(ctx.cwd, artifact.path, `\n${activeDefinition.objective_gate.contains}\n`);
      mock.calls.revisions += 1;
    }
    try {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 16 * 1024 * 1024) return { ok: false, code: "kernel-artifact-invalid" };
      return { ok: true, ref: hashRef(readFileSync(path)) };
    } catch { return { ok: false, code: "kernel-artifact-invalid" }; }
  };
  const runGate = async (gateDefinition, ctx) => {
    const objective = makeObjectiveGate(created.path, gateDefinition, { signal });
    const result = await objective({ stage_id: ctx.node_id, phase: ctx.final ? "conclusion" : "stage-expectation" });
    if (ctx.final && result.result === "fail" && nonMock.length === 0
      && gateDefinition.type === "file-contains") {
      appendText(created.path, gateDefinition.path, `\n${gateDefinition.contains}\n`);
      mock.calls.revisions += 1;
    }
    return result;
  };
  const started = {
    task_ref: taskRef, completed: false, terminal: null, status: "running", code: null,
    journal_entries: resumeDocument?.scheduler.journal_entries ?? 0,
    event_count: resumeDocument?.scheduler.event_seq ?? 0,
  };
  if (!resumeDocument) {
    writeTextAtomic(prepared.path, `${runId}.state.json`, `${stableStringify(publicKernelState({
      runId, definition, definitionRef, result: started,
      worktree: { ...created, baseline_ref: baselineRef },
    }))}\n`);
  } else {
    const eventsFile = join(prepared.path, eventPath);
    try {
      const text = existsSync(eventsFile) ? readFileSync(eventsFile, "utf8") : "";
      if (text !== "" && !text.endsWith("\n")) throw new Error("partial");
      const events = text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
      if (events.length < resumeDocument.scheduler.event_seq
        || events.some((event, index) => event.seq !== index + 1 || event.run_id !== runId)) throw new Error("invalid");
      const prefix = events.slice(0, resumeDocument.scheduler.event_seq);
      writeTextAtomic(prepared.path, eventPath, prefix.map((event) => JSON.stringify(event)).join("\n") + (prefix.length ? "\n" : ""));
    } catch {
      return { ok: false, status: "fail-closed", code: "kernel-resume-events-invalid" };
    }
  }
  runningState = started;
  const journal = createEffectJournal({
    root: prepared.path,
    run_id: runId,
    verify_workspace: workspace.verifyRef,
    expected_records: resumeDocument?.scheduler.journal_entries ?? null,
  });
  let previousSnapshot = resumeDocument ? {
    generation: resumeDocument.snapshot_generation,
    ref: resumeDocument.snapshot_ref,
  } : null;
  const onCheckpoint = async (schedulerState) => {
    const snapshotGeneration = `kernel-${schedulerState.event_seq}-${schedulerState.journal_entries}`;
    const snapshot = checkpoint.snapshot(runId, snapshotGeneration, created.path);
    if (!snapshot.ok || snapshot.tree_ref !== schedulerState.workspace_ref) {
      return { ok: false, code: "kernel-checkpoint-snapshot-failed" };
    }
    const document = {
      schema_version: 1,
      scheduler: schedulerState,
      snapshot_generation: snapshotGeneration,
      snapshot_ref: snapshot.tree_ref,
    };
    try {
      writeTextAtomic(stateRoot, join("private", "runs", runId, "kernel-checkpoint.json"), `${stableStringify(document)}\n`);
    } catch {
      if (previousSnapshot?.generation !== snapshotGeneration) checkpoint.remove(runId, snapshotGeneration);
      return { ok: false, code: "kernel-checkpoint-write-failed" };
    }
    if (previousSnapshot && previousSnapshot.generation !== snapshotGeneration) {
      const removed = checkpoint.remove(runId, previousSnapshot.generation);
      if (!removed.ok) return { ok: false, code: "kernel-checkpoint-cleanup-failed" };
    }
    previousSnapshot = { generation: snapshotGeneration, ref: snapshot.tree_ref };
    runningState.journal_entries = schedulerState.journal_entries;
    runningState.event_count = schedulerState.event_seq;
    writeTextAtomic(prepared.path, `${runId}.state.json`, `${stableStringify(publicKernelState({
      runId, definition, definitionRef, result: runningState,
      worktree: { ...created, baseline_ref: baselineRef },
    }))}\n`);
    return { ok: true };
  };
  const result = await runWorkflowKernel(definition, { task }, {
    run_id: runId,
    cwd: created.path,
    workspace,
    journal,
    runtime_ref: runtimeRef,
    task_ref: taskRef,
    ...(resumeDocument ? { resume: resumeDocument.scheduler } : {}),
    onCheckpoint,
    executeAgent,
    verifyArtifact,
    runGate,
    checkpoint: ({ node_id }) => ({
      continue: resumeDocument?.scheduler?.current === node_id,
    }),
    resolveSubworkflow: (workflowId, version) => definitionsByKey.get(`${workflowId}@${version}`) ?? null,
    depth: 0,
    loops: toggles.loops !== false,
    signal,
    onEvent: emit,
  });
  const completed = {
    task_ref: taskRef,
    completed: !["paused", "running"].includes(result.status),
    terminal: result.terminal ?? null,
    status: result.status,
    code: result.code ?? null,
    journal_entries: result.journal?.length ?? journal.records().length,
    event_count: result.events?.at(-1)?.seq ?? runningState?.event_count ?? started.event_count,
  };
  runningState = null;
  writeTextAtomic(prepared.path, `${runId}.state.json`, `${stableStringify(publicKernelState({
    runId, definition, definitionRef, result: completed,
    worktree: { ...created, baseline_ref: baselineRef },
  }))}\n`);
  return {
    ok: result.ok,
    status: result.ok ? "ok" : "fail-closed",
    code: result.code,
    run_id: runId,
    chain_id: definition.id,
    converged: result.status === "succeeded",
    stop_reason: result.status,
    total_passes: Object.entries(result.visits ?? {}).reduce((sum, [nodeId, value]) =>
      sum + (["agent", "pipeline", "parallel", "map"].includes(definition.nodes[nodeId]?.kind) ? value : 0), 0),
    flow: result.events?.filter((event) => event.kind === "transition").map((event) => ({ stage_id: event.node_id, action: "advance", code: null })) ?? [],
    cast: castResult.cast.map((entry) => ({ stage_id: entry.stage_id, executor_ref: entry.executor_ref })),
    worktree_path: created.path,
    worktree_branch: created.branch_ref,
    events_path: join(prepared.path, eventPath),
    state_path: join(prepared.path, `${runId}.state.json`),
    open_disagreements: 0,
    warnings: [],
    calls: nonMock.length === 0 ? mock.calls : null,
  };
}

function resolveSubworkflowBundles(definition, { stateRoot, chainRegistry, runRegistry, profile }) {
  const bundles = [];
  const seen = new Set();
  for (const node of Object.values(definition.nodes)) {
    if (node.kind !== "subworkflow") continue;
    const key = `${node.workflow_id}@${node.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (node.workflow_id === definition.id) return { ok: false, code: "kernel-subworkflow-recursive" };
    const resolved = resolveWorkflow(stateRoot, node.workflow_id, chainRegistry, runRegistry);
    if (!resolved.ok) return { ok: false, code: resolved.code };
    const normalized = normalizeWorkflowDefinition(resolved.workflow);
    if (!normalized.ok || normalized.definition.version !== node.version
      || Object.values(normalized.definition.nodes).some((child) => child.kind === "subworkflow")) {
      return { ok: false, code: "kernel-subworkflow-binding-invalid" };
    }
    const execution = workflowToExecution(normalized.definition);
    if (!execution.ok) return { ok: false, code: execution.code };
    const config = applyProfileToConfig(execution.config, profile, {
      stageIds: execution.chain.stages.map((stage) => stage.id),
    }).config;
    bundles.push({ definition: normalized.definition, execution, config });
  }
  return { ok: true, bundles };
}

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
  expected_exact_ref = null,
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
  const normalized = normalizeWorkflowDefinition(named.workflow);
  if (!normalized.ok) return { ok: false, status: "fail-closed", code: normalized.code };

  const active = resolveActiveProfile(state_root);
  if (!active.ok) return { ok: false, status: "fail-closed", code: active.code };
  const childWorkflows = resolveSubworkflowBundles(normalized.definition, {
    stateRoot: state_root,
    chainRegistry: chain_registry,
    runRegistry: run_registry,
    profile: active.profile,
  });
  if (!childWorkflows.ok) return { ok: false, status: "fail-closed", code: childWorkflows.code };
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
    subworkflows: childWorkflows.bundles.map((entry) => entry.definition),
  });
  if (actualBindingRef !== expected_binding_ref) {
    return { ok: false, status: "fail-closed", code: "workflow-preflight-drift" };
  }
  const castResolution = resolveCastContexts([
    { definition: normalized.definition, execution, config },
    ...childWorkflows.bundles,
  ], profiled.presets, toggles);
  if (!castResolution.ok) return { ok: false, status: "fail-closed", code: castResolution.code };
  const certified = await certifyCast(adapter, nonMockSpecs(castResolution.contexts), signal);
  if (!certified.ok) return { ok: false, status: "fail-closed", code: certified.code };
  if (certified.bindings.length > 0
    && (typeof expected_exact_ref !== "string" || certified.binding_ref !== expected_exact_ref)) {
    return { ok: false, status: "fail-closed", code: "provider-exact-consent-drift" };
  }

  const runsRoot = join(state_root, "runs");
  const runPath = join(runsRoot, run_id);
  if (existsSync(runPath)) return { ok: false, status: "fail-closed", code: "fresh-run-id-exists" };

  const prepared = prepareRunDirectory(runsRoot, run_id, { clean: false });
  if (!prepared.ok) return { ok: false, status: "fail-closed", code: prepared.code };
  const definitionRef = workflowDefinitionHash(normalized.definition);
  const lifecycle = workflowLifecycleSnapshot(normalized.definition);
  if (!lifecycle) return { ok: false, status: "fail-closed", code: "workflow-lifecycle-snapshot-invalid" };
  const lifecycleText = stableStringify(lifecycle);
  try {
    writeTextAtomic(prepared.path, `${run_id}.workflow.json`, `${lifecycleText}\n`);
    writeTextAtomic(prepared.path, `${run_id}.definition.json`, `${stableStringify(normalized.definition)}\n`);
  } catch {
    return { ok: false, status: "fail-closed", code: "workflow-lifecycle-snapshot-write-failed" };
  }

  return executeKernelDefinition({
    definition: normalized.definition,
    execution,
    config,
    presets: profiled.presets,
    toggles,
    adapter,
    task,
    runId: run_id,
    cwd,
    prepared,
    packageRoot: package_root,
    stateRoot: state_root,
    signal,
    onEvent,
    definitionRef,
    castContexts: castResolution.contexts,
    subworkflows: childWorkflows.bundles,
  });
}

function readBoundJson(path, maxBytes) {
  const entry = lstatSync(path);
  if (entry.isSymbolicLink() || !entry.isFile() || entry.size < 1 || entry.size > maxBytes) throw new Error("invalid-file");
  return JSON.parse(readFileSync(path, "utf8"));
}

export async function resumeNamedWorkflow({
  run_id,
  task,
  cwd,
  state_root,
  package_root,
  chain_registry,
  run_registry,
  adapter = null,
  expected_binding_ref,
  expected_exact_ref = null,
  signal = null,
  onEvent = null,
} = {}) {
  if (![cwd, state_root, package_root].every((value) => typeof value === "string" && value.length > 0)) {
    return { ok: false, status: "fail-closed", code: "workflow-execution-path-invalid" };
  }
  if (!validateRunId(run_id).ok) return { ok: false, status: "fail-closed", code: "unsafe-run-id" };
  if (typeof task !== "string" || task.trim() === "") {
    return { ok: false, status: "fail-closed", code: "workflow-task-required" };
  }
  const runPath = join(state_root, "runs", run_id);
  let publicState;
  let definition;
  let resumeDocument;
  try {
    const runEntry = lstatSync(runPath);
    if (runEntry.isSymbolicLink() || !runEntry.isDirectory()) throw new Error("run-dir");
    publicState = readBoundJson(join(runPath, `${run_id}.state.json`), 64 * 1024);
    definition = readBoundJson(join(runPath, `${run_id}.definition.json`), 256 * 1024);
    resumeDocument = readBoundJson(join(state_root, "private", "runs", run_id, "kernel-checkpoint.json"), 16 * 1024 * 1024);
  } catch {
    return { ok: false, status: "fail-closed", code: "kernel-resume-record-invalid" };
  }
  if (publicState?.schema_version !== 4 || publicState.run_id !== run_id || publicState.completed !== false
    || typeof publicState.workflow_id !== "string" || !/^sha256:[0-9a-f]{64}$/.test(publicState.definition_ref ?? "")
    || !/^sha256:[0-9a-f]{64}$/.test(publicState.baseline_ref ?? "")
    || !/^sha256:[0-9a-f]{64}$/.test(publicState.worktree_owner_ref ?? "")
    || resumeDocument?.schema_version !== 1
    || !/^[A-Za-z0-9._-]+$/.test(resumeDocument.snapshot_generation ?? "")
    || !/^sha256:[0-9a-f]{64}$/.test(resumeDocument.snapshot_ref ?? "")) {
    return { ok: false, status: "fail-closed", code: "kernel-resume-record-invalid" };
  }
  const normalized = normalizeWorkflowDefinition(definition);
  if (!normalized.ok || normalized.migrated || workflowDefinitionHash(normalized.definition) !== publicState.definition_ref
    || normalized.definition.id !== publicState.workflow_id) {
    return { ok: false, status: "fail-closed", code: "kernel-resume-definition-invalid" };
  }
  const named = resolveWorkflow(state_root, publicState.workflow_id, chain_registry, run_registry);
  if (!named.ok) return { ok: false, status: "fail-closed", code: named.code };
  const current = normalizeWorkflowDefinition(named.workflow);
  if (!current.ok || workflowDefinitionHash(current.definition) !== publicState.definition_ref) {
    return { ok: false, status: "fail-closed", code: "workflow-resume-definition-drift" };
  }
  const execution = workflowToExecution(normalized.definition);
  if (!execution.ok) return { ok: false, status: "fail-closed", code: execution.code };
  const hostEffects = workflowRequiredHostEffects(normalized.definition);
  if (hostEffects.length > 0) return { ok: false, status: "fail-closed", code: "workflow-host-effects-unavailable" };
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
  const toggles = toggleVector(settings.settings);
  const childWorkflows = resolveSubworkflowBundles(normalized.definition, {
    stateRoot: state_root,
    chainRegistry: chain_registry,
    runRegistry: run_registry,
    profile: active.profile,
  });
  if (!childWorkflows.ok) return { ok: false, status: "fail-closed", code: childWorkflows.code };
  const actualBindingRef = workflowExecutionBindingRef({
    workflow: named.workflow,
    profile: active.profile,
    toggles,
    presets: profiled.presets,
    subworkflows: childWorkflows.bundles.map((entry) => entry.definition),
  });
  if (typeof expected_binding_ref !== "string" || actualBindingRef !== expected_binding_ref) {
    return { ok: false, status: "fail-closed", code: "workflow-preflight-drift" };
  }
  const castResolution = resolveCastContexts([
    { definition: normalized.definition, execution, config },
    ...childWorkflows.bundles,
  ], profiled.presets, toggles);
  if (!castResolution.ok) return { ok: false, status: "fail-closed", code: castResolution.code };
  const certified = await certifyCast(adapter, nonMockSpecs(castResolution.contexts), signal);
  if (!certified.ok) return { ok: false, status: "fail-closed", code: certified.code };
  if (certified.bindings.length > 0
    && (typeof expected_exact_ref !== "string" || certified.binding_ref !== expected_exact_ref)) {
    return { ok: false, status: "fail-closed", code: "provider-exact-consent-drift" };
  }
  return executeKernelDefinition({
    definition: normalized.definition,
    definitionRef: publicState.definition_ref,
    execution,
    config,
    presets: profiled.presets,
    toggles,
    adapter,
    task,
    runId: run_id,
    cwd,
    prepared: { ok: true, path: runPath },
    packageRoot: package_root,
    stateRoot: state_root,
    signal,
    onEvent,
    castContexts: castResolution.contexts,
    resumeDocument: { ...resumeDocument, public_state: publicState },
    subworkflows: childWorkflows.bundles,
  });
}
