// In-process workflow execution for the Pi extension. This keeps Pi's configured
// ModelRegistry/AuthStorage in scope, runs the canonical workflow-derived
// chain/config, and keeps the raw user task in memory for the duration of the run.

import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadPresetRegistry } from "../../dispatch/lib/presets.mjs";
import { loadSettings, toggleVector, DEFAULT_SETTINGS_REL_PATH } from "../../dispatch/lib/settings.mjs";
import {
  kernelPublicCountsAreValid,
  prepareRunDirectory,
  validateRunId,
} from "../../dispatch/lib/run-manager.mjs";
import { writeTextAtomic } from "../../dispatch/lib/persistence.mjs";
import { hashRef, stableStringify } from "../../dispatch/lib/run-record.mjs";
import {
  acquireRunLease,
  createStagedMockAdapter,
  makeGitWorktreeEffect,
  makePrivateCheckpointEffect,
  releaseRunLease,
  RUNNER_CODES,
} from "../../dispatch/lib/runner.mjs";
import { resolveChainCast } from "../../dispatch/lib/presets.mjs";
import { compileStepPrompt } from "../../dispatch/lib/prompt-compiler.mjs";
import { assertRoleEnvelope } from "../../dispatch/lib/role-envelope.mjs";
import { makeObjectiveGate } from "../../dispatch/lib/task-loop.mjs";
import { appendText } from "../../dispatch/lib/persistence.mjs";
import {
  childInputSchemaAcceptsParent,
  normalizeWorkflowDefinition,
  normalizeWorkflowInput,
  WORKFLOW_LIMITS,
  workflowChildDefinitionArtifactName,
  workflowDefinitionHash,
} from "../../dispatch/workflow/schema.mjs";
import {
  DEFAULT_WORKFLOW_EXECUTION_MODE,
  validateWorkflowExecutionMode,
} from "../../dispatch/workflow/graph.mjs";
import {
  bindWorkflowKernelRuntimeRef,
  runWorkflowKernel,
  validateWorkflowKernelResumeAuthority,
} from "../../dispatch/kernel/scheduler.mjs";
import { createCanonicalWorkspace } from "../../dispatch/kernel/workspace.mjs";
import { createEffectJournal } from "../../dispatch/kernel/journal.mjs";
import {
  EMPTY_KERNEL_EVENT_PREFIX_REF,
  extendKernelEventPrefixRef,
  KERNEL_CHECKPOINT_LIMITS,
  kernelEventPrefixRef,
  kernelResultIsComplete,
  validateKernelCheckpoint,
  validateKernelCheckpointEventPrefix,
} from "../../dispatch/kernel/state.mjs";
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

const MAX_KERNEL_EVENT_FILE_BYTES = 64 * 1024 * 1024;
const RETRYABLE_AGENT_FAILURES = new Set([
  "pi-agent-provider-failed",
  "pi-agent-semantic-output-invalid",
  "pi-agent-session-failed",
]);

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function readPersistedChildDefinitions(runPath, runId, bundles) {
  const definitions = [];
  try {
    for (const bundle of bundles) {
      const persisted = readBoundJson(
        join(runPath, workflowChildDefinitionArtifactName(
          runId,
          bundle.definition.id,
          bundle.definition.version,
        )),
        WORKFLOW_LIMITS.max_workflow_read_bytes,
      );
      const normalized = normalizeWorkflowDefinition(persisted);
      if (!normalized.ok || normalized.migrated
        || normalized.definition.id !== bundle.definition.id
        || normalized.definition.version !== bundle.definition.version
        || workflowDefinitionHash(normalized.definition) !== workflowDefinitionHash(bundle.definition)) return null;
      definitions.push(normalized.definition);
    }
  } catch {
    return null;
  }
  return definitions;
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

function agentContracts(definition) {
  const contracts = new Map();
  const add = (agent) => {
    if (agent?.kind === "agent" && typeof agent.stage_id === "string") {
      contracts.set(agent.stage_id, {
        tools: Array.isArray(agent.tools) ? structuredClone(agent.tools) : null,
        mutation: agent.mutation,
      });
    }
  };
  for (const node of Object.values(definition.nodes)) {
    if (node.kind === "agent") add(node);
    else if (node.kind === "pipeline") node.stages.forEach(add);
    else if (node.kind === "parallel") node.branches.forEach(add);
    else if (node.kind === "map") add(node.body);
  }
  return contracts;
}

function nonMockSpecs(castContexts) {
  return castContexts.flatMap((entry) => {
    const contracts = agentContracts(entry.definition);
    return entry.cast.flatMap((stage) => {
      const contract = contracts.get(stage.stage_id) ?? { tools: null, mutation: null };
      return [
        ...Object.entries(stage.roles ?? {}).flatMap(([role, members]) =>
          members.flatMap((member) => Array.from({ length: member.instances }, () => ({ ...member, role, ...contract })))),
        ...Object.entries(stage.panel_roles ?? {}).flatMap(([role, member]) =>
          Array.from({ length: member.instances }, () => ({ ...member, role, ...contract }))),
      ];
    });
  }).filter((spec) => spec.provider !== "mock");
}

function workflowKernelRuntimeRef(definitionRef, castContexts, executionMode) {
  const binding = {
    definition_ref: definitionRef,
    casts: castContexts.map((entry) => ({
      workflow_id: entry.definition.id,
      version: entry.definition.version,
      cast: entry.cast,
    })),
  };
  return hashRef(stableStringify(executionMode === DEFAULT_WORKFLOW_EXECUTION_MODE
    ? binding
    : { ...binding, execution_mode: executionMode }));
}

function promptHandoff(ctx) {
  const priorNode = ctx.outputs?.[ctx.node_id] ?? null;
  const gates = Object.fromEntries(Object.entries(ctx.outputs ?? {}).filter(([, value]) =>
    value && typeof value === "object" && ["pass", "fail"].includes(value.result)));
  const value = {
    upstream: ctx.local.upstream ?? null,
    item: ctx.local.item ?? null,
    revision: ctx.visit > 1 ? { prior_node_output: priorNode, gate_outputs: gates } : null,
  };
  try { return frameContent("agent-output", value); }
  catch {
    return frameContent("agent-output", {
      upstream_ref: hashRef(stableStringify(value.upstream ?? null)),
      item_ref: hashRef(stableStringify(value.item ?? null)),
      revision_ref: hashRef(stableStringify(value.revision ?? null)),
    });
  }
}

function agentOutputMatchesSchema(envelope, outputSchema) {
  if (outputSchema?.id === "semantic-v2") return true;
  return outputSchema?.id === "verdict-v1"
    && ["approve", "revise", "revise-jump"].includes(envelope?.recommendation);
}

function schedulerUsageFromAdapterError(error) {
  const value = error?.usage;
  if (value == null || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== 2
    || !Number.isSafeInteger(value.input_tokens) || value.input_tokens < 0
    || !Number.isSafeInteger(value.output_tokens) || value.output_tokens < 0) return null;
  const tokens = value.input_tokens + value.output_tokens;
  return Number.isSafeInteger(tokens) ? { tokens, cost_micros: 0 } : null;
}

async function certifyCast(adapter, specs, signal, { require_live = false } = {}) {
  if (require_live && adapter?.liveCertification !== true) {
    return { ok: false, code: "provider-live-certification-required" };
  }
  if (specs.length === 0) return { ok: true, bindings: [] };
  if (adapter?.kind !== "helix-pi-agent" || adapter.exactMode !== true
    || typeof adapter.preflightExact !== "function" || typeof adapter.attests !== "function"
    || specs.some((spec) => adapter.supportsProvider?.(spec.provider) !== true)) {
    return { ok: false, code: "provider-exact-adapter-required" };
  }
  try {
    const result = await adapter.preflightExact(specs, { signal, require_live });
    if (require_live && result?.certification !== "live-certified") {
      return { ok: false, code: "provider-live-certification-required" };
    }
    return result?.ok === true ? result : { ok: false, code: result?.code ?? "provider-exact-preflight-failed" };
  } catch {
    return { ok: false, code: "provider-exact-preflight-failed" };
  }
}

function publicKernelState({ runId, definition, definitionRef, executionMode, result, worktree }) {
  return {
    schema_version: 5,
    run_id: runId,
    workflow_id: definition.id,
    workflow_version: definition.version,
    definition_ref: definitionRef,
    execution_mode: executionMode,
    task_ref: result.task_ref,
    completed: result.completed,
    terminal: result.terminal,
    status: result.status,
    code: result.code,
    journal_entries: result.journal_entries,
    event_count: result.event_count,
    event_ref: result.event_ref,
    worktree_enabled: true,
    worktree_ref: worktree.worktree_ref,
    worktree_branch: worktree.branch_ref,
    worktree_owner_ref: worktree.owner_ref,
    baseline_ref: worktree.baseline_ref,
  };
}

function resumeProjectionRelationIsValid(publicState, resumeDocument) {
  const scheduler = resumeDocument.scheduler;
  const marker = scheduler.terminal_result ?? null;
  const projectionPending = resumeDocument.schema_version === 2
    && resumeDocument.maintenance.public_projection_pending === true;
  if (marker == null) return publicState.completed === false;
  if (!projectionPending) return false;
  return publicState.completed === false
    || (publicState.completed === true
      && publicState.terminal === scheduler.current
      && publicState.status === marker.status
      && publicState.code === marker.code);
}

function authenticateResumeEvents(runPath, runId, publicState, resumeDocument) {
  const scheduler = resumeDocument.scheduler;
  const projectionPending = resumeDocument.schema_version === 2
    && resumeDocument.maintenance.public_projection_pending === true;
  if (!resumeProjectionRelationIsValid(publicState, resumeDocument)) return null;
  let events;
  try {
    const eventsPath = join(runPath, `${runId}.kernel.events.jsonl`);
    const entry = lstatSync(eventsPath);
    if (entry.isSymbolicLink() || !entry.isFile() || entry.size > MAX_KERNEL_EVENT_FILE_BYTES) return null;
    const text = readFileSync(eventsPath, "utf8");
    if (text !== "" && !text.endsWith("\n")) return null;
    events = text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch { return null; }
  if (!kernelPublicCountsAreValid(publicState)
    || publicState.event_count > scheduler.event_seq
    || publicState.journal_entries > scheduler.journal_entries
    || events.length < scheduler.event_seq
    || events.some((event, index) => event?.seq !== index + 1 || event.run_id !== runId)) return null;
  const prefix = events.slice(0, scheduler.event_seq);
  const publicPrefix = prefix.slice(0, publicState.event_count);
  if (kernelEventPrefixRef(publicPrefix) !== publicState.event_ref
    || !validateKernelCheckpointEventPrefix(scheduler, prefix)
    || (!(projectionPending && publicState.completed === false)
      && (publicState.event_count !== scheduler.event_seq
        || publicState.event_ref !== scheduler.event_ref
        || publicState.journal_entries !== scheduler.journal_entries))) return null;
  return { prefix, projection_pending: projectionPending };
}

async function executeKernelDefinition({
  definition, definitionRef, execution, config, presets, toggles, adapter, input, runId, cwd,
  prepared, packageRoot, stateRoot, signal, onEvent, castContexts,
  executionMode = DEFAULT_WORKFLOW_EXECUTION_MODE, resumeDocument = null, resumeEvents = null, subworkflows = [],
  writeText = writeTextAtomic,
}) {
  if (!validateWorkflowExecutionMode(executionMode).ok) {
    return { ok: false, status: "fail-closed", code: "workflow-execution-mode-invalid" };
  }
  if (!Array.isArray(castContexts) || castContexts.length !== subworkflows.length + 1) {
    return { ok: false, status: "fail-closed", code: "provider-cast-binding-invalid" };
  }
  const castResult = { ok: true, cast: castContexts[0].cast };
  const castsByDefinition = new Map(castContexts.map((entry) => [
    entry.definition.id,
    new Map(entry.cast.map((stage) => [stage.stage_id, stage])),
  ]));
  const definitionsByKey = new Map(subworkflows.map((entry) => [`${entry.definition.id}@${entry.definition.version}`, entry.definition]));
  const definitionsById = new Map([
    [definition.id, definition],
    ...subworkflows.map((entry) => [entry.definition.id, entry.definition]),
  ]);
  const exactSpecs = nonMockSpecs(castContexts);
  const nonMock = exactSpecs.map((spec) => spec.provider);
  if (exactSpecs.length > 0 && (adapter?.exactMode !== true || typeof adapter.attests !== "function")) {
    return { ok: false, status: "fail-closed", code: "provider-exact-adapter-required" };
  }
  const task = input.task;
  const taskRef = hashRef(stableStringify(input));
  const runtimeRef = workflowKernelRuntimeRef(definitionRef, castContexts, executionMode);
  if (resumeDocument) {
    const schedulerRuntimeRef = bindWorkflowKernelRuntimeRef(runtimeRef, executionMode);
    if (schedulerRuntimeRef == null) {
      return { ok: false, status: "fail-closed", code: "kernel-runtime-binding-invalid" };
    }
    const validResume = validateKernelCheckpoint(resumeDocument.scheduler, {
      run_id: runId,
      definition_ref: definitionRef,
      runtime_ref: schedulerRuntimeRef,
      task_ref: taskRef,
      node_ids: new Set(Object.keys(definition.nodes)),
      execution_mode: executionMode,
      event_prefix: resumeEvents,
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
  const templatesDir = join(packageRoot, "dispatch", "config", "templates");
  const briefsDir = join(packageRoot, "dispatch", "config", "agents");
  const eventPath = `${runId}.kernel.events.jsonl`;
  let runningState = null;
  let acceptedEventRef = resumeDocument?.scheduler.event_ref ?? EMPTY_KERNEL_EVENT_PREFIX_REF;
  let acceptedEventCount = resumeDocument?.scheduler.event_seq ?? 0;
  const emit = (event) => {
    onEvent?.(event);
    const nextEventRef = extendKernelEventPrefixRef(acceptedEventRef, event);
    if (nextEventRef == null) throw new Error("kernel-event-prefix-invalid");
    appendText(prepared.path, eventPath, `${JSON.stringify(event)}\n`);
    acceptedEventRef = nextEventRef;
    acceptedEventCount = event.seq;
  };
  const expandAgent = (node, ctx) => {
    const stageCast = castsByDefinition.get(ctx.definition_id)?.get(node.stage_id);
    return membersFor(stageCast, node.role).map((member, index) => ({
      ...node,
      _helix_member: member,
      _helix_member_index: index,
    }));
  };
  const executeAgent = async (node, ctx) => {
    const spec = node._helix_member;
    if (!spec) return { ok: false, code: "kernel-agent-cast-missing" };
    const activeDefinition = definitionsById.get(ctx.definition_id);
    if (!activeDefinition) return { ok: false, code: "kernel-subworkflow-binding-invalid" };
    const attempt = ctx.local.attempt;
    const iteration = ctx.visit;
    const envelopeRunId = `${ctx.run_id}:${ctx.instance_id}`;
    const activeArtifact = ctx.artifact ?? (node.mutation !== "read-only"
      && activeDefinition.objective_gate.type === "file-contains"
      ? { path: activeDefinition.objective_gate.path, kind: "notes" }
      : null);
    if (!Number.isSafeInteger(attempt) || attempt < 1 || !Number.isSafeInteger(iteration) || iteration < 1) {
      return { ok: false, code: "kernel-agent-context-invalid" };
    }
    let compiled;
    try {
      compiled = compileStepPrompt({
        template_id: node.prompt === "tracked-step-v1" ? "step-prompt-v1" : node.prompt,
        templates_dir: templatesDir,
        briefs_dir: briefsDir,
        role: node.role,
        fields: {
          chain_id: activeDefinition.id,
          stage_id: node.stage_id,
          pass: iteration,
          gate_summary: JSON.stringify(activeDefinition.objective_gate),
          artifact_summary: stableStringify(activeArtifact ?? { kind: "none", path: null }),
          task_instruction: frameContent("operator-task", task),
          handoff: promptHandoff(ctx),
        },
      });
    } catch { compiled = null; }
    if (!compiled?.ok) return { ok: false, code: compiled?.code ?? "prompt-compile-failed" };
    const selected = spec.provider === "mock" ? mock.dispatchAdapter : adapter;
    if (!selected || typeof selected.runCandidate !== "function") return { ok: false, code: "kernel-agent-adapter-missing" };
    let envelope;
    try {
      envelope = await selected.runCandidate(spec, {
          run_id: envelopeRunId,
          stage_id: node.stage_id,
          verdict_role: node.output_schema.id === "verdict-v1" ? node.role : null,
          prompt: compiled.prompt,
          cwd: ctx.cwd,
          pass: iteration,
          attempt,
          tools: structuredClone(node.tools),
          mutation: node.mutation,
          output_schema: structuredClone(node.output_schema),
          ...(spec.provider === "mock" ? { mock_effect: {
            mutation: node.mutation,
            artifact: activeArtifact == null ? null : structuredClone(activeArtifact),
            objective_gate: structuredClone(activeDefinition.objective_gate),
            visit: iteration,
            max_visits: activeDefinition.nodes[ctx.node_id]?.max_visits ?? 1,
          } } : {}),
          signal: ctx.signal,
      });
    } catch (error) {
      const usage = schedulerUsageFromAdapterError(error);
      if (error?.message === "pi-agent-call-cancelled") {
        return { ok: false, code: "kernel-effect-cancelled", ...(usage ? { usage } : {}) };
      }
      const code = RETRYABLE_AGENT_FAILURES.has(error?.message) ? error.message : "kernel-agent-adapter-failed";
      return { ok: false, code, ...(RETRYABLE_AGENT_FAILURES.has(code) ? { failure_class: "agent" } : {}),
        ...(usage ? { usage } : {}) };
    }
    try { assertRoleEnvelope(envelope); }
    catch { return { ok: false, code: "kernel-agent-envelope-invalid" }; }
    if (envelope.run_id !== envelopeRunId || envelope.stage !== "candidate" || envelope.role !== node.role
      || envelope.provider !== spec.provider || envelope.model !== spec.model
      || envelope.attempt !== attempt || envelope.iteration !== iteration) {
      return { ok: false, code: "kernel-agent-envelope-identity-invalid" };
    }
    if (spec.provider !== "mock") {
      if (!envelope.requested || envelope.requested.provider !== spec.provider || envelope.requested.model !== spec.model
        || envelope.requested.effort !== spec.effort
        || !envelope.effective || Object.values(envelope.effective.evidence).includes("requested-only")
        || envelope.effective.provider !== spec.provider || envelope.effective.model !== spec.model
        || envelope.effective.effort !== spec.effort
        || adapter.attests(spec, envelope.attestation_ref) !== true) {
        return { ok: false, code: "provider-identity-unverified" };
      }
    }
    const tokens = envelope.usage.input_tokens + envelope.usage.output_tokens;
    if (!Number.isSafeInteger(tokens)) return { ok: false, code: "kernel-agent-usage-invalid" };
    const usage = { tokens, cost_micros: 0 };
    if (envelope.status !== "ok") {
      return { ok: false, code: `pi-agent-status-${envelope.status}`, failure_class: "agent", usage };
    }
    if (!agentOutputMatchesSchema(envelope, node.output_schema)) {
      return { ok: false, code: "kernel-agent-output-invalid", usage };
    }
    return {
      ok: true,
      value: envelope,
      usage,
      attestation_ref: envelope.attestation_ref ?? null,
    };
  };
  const verifyArtifact = async (artifact, ctx) => {
    const path = join(ctx.cwd, artifact.path);
    try {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 16 * 1024 * 1024) return { ok: false, code: "kernel-artifact-invalid" };
      return { ok: true, ref: hashRef(readFileSync(path)) };
    } catch { return { ok: false, code: "kernel-artifact-invalid" }; }
  };
  const runGate = async (gateDefinition, ctx) => {
    const objective = makeObjectiveGate(created.path, gateDefinition, {
      signal: ctx.signal,
      workspaceGuard: workspace,
    });
    const result = await objective({ stage_id: ctx.node_id, phase: ctx.final ? "conclusion" : "stage-expectation" });
    return result;
  };
  const started = {
    task_ref: taskRef, completed: false, terminal: null, status: "running", code: null,
    journal_entries: resumeDocument?.scheduler.journal_entries ?? 0,
    event_count: resumeDocument?.scheduler.event_seq ?? 0,
    event_ref: resumeDocument?.scheduler.event_ref ?? EMPTY_KERNEL_EVENT_PREFIX_REF,
  };
  if (!resumeDocument) {
    writeText(prepared.path, `${runId}.state.json`, `${stableStringify(publicKernelState({
      runId, definition, definitionRef, executionMode, result: started,
      worktree: { ...created, baseline_ref: baselineRef },
    }))}\n`);
  } else if (!Array.isArray(resumeEvents)
    || !validateKernelCheckpointEventPrefix(resumeDocument.scheduler, resumeEvents)) {
    return { ok: false, status: "fail-closed", code: "kernel-resume-events-invalid" };
  }
  runningState = started;
  let journal;
  try {
    journal = createEffectJournal({
      root: prepared.path,
      run_id: runId,
      verify_workspace: workspace.verifyRef,
      expected_records: resumeDocument?.scheduler.journal_entries ?? null,
    });
  } catch {
    return {
      ok: false, status: "fail-closed", code: "kernel-journal-corrupt", resumable: false,
      run_id: runId, state_path: join(prepared.path, `${runId}.state.json`),
    };
  }
  let previousSnapshot = resumeDocument ? {
    generation: resumeDocument.snapshot_generation,
    ref: resumeDocument.snapshot_ref,
  } : null;
  let terminalResultAuthoritative = resumeDocument?.scheduler?.terminal_result != null;
  let terminalProjectionCommitted = resumeDocument?.scheduler?.terminal_result != null
    && resumeDocument?.public_state?.completed === true;
  let durableCheckpointDocument = resumeDocument == null ? null : structuredClone(resumeDocument);
  let checkpointMaintenance = resumeDocument?.schema_version === 2
    ? structuredClone(resumeDocument.maintenance)
    : { cleanup_generations: [], public_projection_pending: false };
  const onCheckpoint = async (schedulerState) => {
    if (schedulerState.event_seq !== acceptedEventCount || schedulerState.event_ref !== acceptedEventRef) {
      return { ok: false, code: "kernel-event-prefix-invalid" };
    }
    const snapshotGeneration = `kernel-${schedulerState.event_seq}-${schedulerState.journal_entries}-${schedulerState.workspace_ref.slice(7, 23)}`;
    const snapshot = checkpoint.snapshot(runId, snapshotGeneration, created.path);
    if (!snapshot.ok || snapshot.tree_ref !== schedulerState.workspace_ref) {
      return { ok: false, code: "kernel-checkpoint-snapshot-failed" };
    }
    const document = {
      schema_version: 2,
      scheduler: schedulerState,
      snapshot_generation: snapshotGeneration,
      snapshot_ref: snapshot.tree_ref,
      maintenance: {
        cleanup_generations: [...new Set([
          ...checkpointMaintenance.cleanup_generations,
          ...(previousSnapshot && previousSnapshot.generation !== snapshotGeneration ? [previousSnapshot.generation] : []),
        ])].filter((generation) => generation !== snapshotGeneration),
        public_projection_pending: true,
      },
    };
    const checkpointPath = join("private", "runs", runId, "kernel-checkpoint.json");
    try {
      const text = `${stableStringify(document)}\n`;
      if (Buffer.byteLength(text, "utf8") > KERNEL_CHECKPOINT_LIMITS.max_document_bytes) {
        throw new Error("kernel-checkpoint-too-large");
      }
      writeText(stateRoot, checkpointPath, text);
      durableCheckpointDocument = structuredClone(document);
    } catch (error) {
      if (previousSnapshot?.generation !== snapshotGeneration) checkpoint.remove(runId, snapshotGeneration);
      return { ok: false, code: error?.message === "kernel-checkpoint-too-large"
        ? "kernel-checkpoint-too-large" : "kernel-checkpoint-write-failed" };
    }
    previousSnapshot = { generation: snapshotGeneration, ref: snapshot.tree_ref };
    if (schedulerState.terminal_result != null) terminalResultAuthoritative = true;
    runningState.journal_entries = schedulerState.journal_entries;
    runningState.event_count = schedulerState.event_seq;
    runningState.event_ref = schedulerState.event_ref;
    const projectionState = schedulerState.terminal_result == null ? runningState : {
      ...runningState,
      completed: true,
      terminal: schedulerState.current,
      status: schedulerState.terminal_result.status,
      code: schedulerState.terminal_result.code,
    };
    try {
      writeText(prepared.path, `${runId}.state.json`, `${stableStringify(publicKernelState({
        runId, definition, definitionRef, executionMode, result: projectionState,
        worktree: { ...created, baseline_ref: baselineRef },
      }))}\n`);
      document.maintenance.public_projection_pending = false;
      if (schedulerState.terminal_result != null) terminalProjectionCommitted = true;
    } catch {
      // The authoritative private checkpoint records this projection debt.
    }
    document.maintenance.cleanup_generations = document.maintenance.cleanup_generations.filter((generation) => {
      const removed = checkpoint.remove(runId, generation);
      return !removed.ok;
    });
    checkpointMaintenance = structuredClone(document.maintenance);
    try {
      writeText(stateRoot, checkpointPath, `${stableStringify(document)}\n`, { replace: true });
      durableCheckpointDocument = structuredClone(document);
    } catch {
      // The first canonical write retained a conservative superset of the debt.
    }
    return { ok: true };
  };
  const clearProjectionDebt = () => {
    if (durableCheckpointDocument?.maintenance?.public_projection_pending !== true) return;
    const maintained = structuredClone(durableCheckpointDocument);
    maintained.maintenance.public_projection_pending = false;
    try {
      writeText(
        stateRoot,
        join("private", "runs", runId, "kernel-checkpoint.json"),
        `${stableStringify(maintained)}\n`,
        { replace: true },
      );
      durableCheckpointDocument = maintained;
    } catch {
      // The exact public projection is durable; conservative private debt remains for maintenance.
    }
  };
  let checkpointConsentAvailable = resumeDocument != null;
  const result = await runWorkflowKernel(definition, input, {
    run_id: runId,
    cwd: created.path,
    workspace,
    journal,
    runtime_ref: runtimeRef,
    task_ref: taskRef,
    execution_mode: executionMode,
    ...(resumeDocument ? { resume: resumeDocument.scheduler } : {}),
    ...(resumeDocument ? { resume_events: resumeEvents } : {}),
    onCheckpoint,
    expandAgent,
    executeAgent,
    verifyArtifact,
    runGate,
    checkpoint: ({ node_id, visit, child_run_id = null }) => {
      const allowed = checkpointConsentAvailable && (child_run_id == null
        ? resumeDocument?.scheduler?.current === node_id
          && resumeDocument.scheduler.active?.visit === visit
        : resumeDocument?.scheduler?.active?.child?.run_id === child_run_id
          && resumeDocument.scheduler.active.child.scheduler?.current === node_id
          && resumeDocument.scheduler.active.child.scheduler?.active?.visit === visit);
      if (allowed) checkpointConsentAvailable = false;
      return { continue: allowed };
    },
    resolveSubworkflow: (workflowId, version) => definitionsByKey.get(`${workflowId}@${version}`) ?? null,
    depth: 0,
    loops: toggles.loops !== false,
    signal,
    onEvent: emit,
  });
  const hasDurableCheckpoint = previousSnapshot !== null;
  const completed = {
    task_ref: taskRef,
    completed: hasDurableCheckpoint && kernelResultIsComplete(result, { has_checkpoint: true }),
    terminal: result.terminal ?? null,
    status: result.status,
    code: result.code ?? null,
    journal_entries: runningState?.journal_entries ?? started.journal_entries,
    event_count: runningState?.event_count ?? started.event_count,
    event_ref: runningState?.event_ref ?? started.event_ref,
  };
  runningState = null;
  if (!terminalProjectionCommitted) {
    let finalProjectionCommitted = false;
    try {
      writeText(prepared.path, `${runId}.state.json`, `${stableStringify(publicKernelState({
        runId, definition, definitionRef, executionMode, result: completed,
        worktree: { ...created, baseline_ref: baselineRef },
      }))}\n`);
      finalProjectionCommitted = true;
    } catch (error) {
      if (!terminalResultAuthoritative) throw error;
    }
    if (finalProjectionCommitted) clearProjectionDebt();
  }
  if (terminalProjectionCommitted) clearProjectionDebt();
  return {
    ok: result.ok,
    status: result.ok ? "ok" : "fail-closed",
    code: result.code,
    run_id: runId,
    chain_id: definition.id,
    execution_mode: executionMode,
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
    terminal_authoritative: terminalResultAuthoritative,
    resumable: hasDurableCheckpoint && !completed.completed,
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
      || Object.values(normalized.definition.nodes).some((child) => child.kind === "subworkflow")
      || !childInputSchemaAcceptsParent(definition.inputs, normalized.definition.inputs)) {
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

async function executeNamedWorkflowLeased({
  workflow_id,
  task,
  input = null,
  run_id,
  cwd,
  state_root,
  package_root,
  chain_registry,
  run_registry,
  adapter = null,
  execution_mode = DEFAULT_WORKFLOW_EXECUTION_MODE,
  expected_binding_ref,
  expected_exact_ref = null,
  signal = null,
  now = Date.now(),
  onEvent = null,
  write_text_atomic = writeTextAtomic,
} = {}) {
  if (![cwd, state_root, package_root].every((value) => typeof value === "string" && value.length > 0)) {
    return { ok: false, status: "fail-closed", code: "workflow-execution-path-invalid" };
  }
  if (typeof write_text_atomic !== "function") {
    return { ok: false, status: "fail-closed", code: "workflow-execution-persistence-invalid" };
  }
  if (!validateWorkflowExecutionMode(execution_mode).ok) {
    return { ok: false, status: "fail-closed", code: "workflow-execution-mode-invalid" };
  }
  if (!validateRunId(run_id).ok) return { ok: false, status: "fail-closed", code: "unsafe-run-id" };
  if (input == null && (typeof task !== "string" || task.trim() === "")) {
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
  const inputValidation = normalizeWorkflowInput(normalized.definition.inputs, input ?? { task });
  if (!inputValidation.valid) return { ok: false, status: "fail-closed", code: "workflow-input-invalid", errors: inputValidation.errors };
  const runtimeInput = inputValidation.input;

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
  if (toggles.worktree === false) return { ok: false, status: "fail-closed", code: "workflow-canonical-worktree-required" };
  const actualBindingRef = workflowExecutionBindingRef({
    workflow: named.workflow,
    profile: active.profile,
    toggles,
    presets: profiled.presets,
    subworkflows: childWorkflows.bundles.map((entry) => entry.definition),
    execution_mode,
  });
  if (actualBindingRef !== expected_binding_ref) {
    return { ok: false, status: "fail-closed", code: "workflow-preflight-drift" };
  }
  const castResolution = resolveCastContexts([
    { definition: normalized.definition, execution, config },
    ...childWorkflows.bundles,
  ], profiled.presets, toggles);
  if (!castResolution.ok) return { ok: false, status: "fail-closed", code: castResolution.code };
  const certified = await certifyCast(adapter, nonMockSpecs(castResolution.contexts), signal, {
    require_live: castResolution.contexts.some((entry) => entry.definition.provider_policy.require_live_certification === true),
  });
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
    for (const bundle of childWorkflows.bundles) {
      writeTextAtomic(
        prepared.path,
        workflowChildDefinitionArtifactName(run_id, bundle.definition.id, bundle.definition.version),
        `${stableStringify(bundle.definition)}\n`,
      );
    }
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
    input: runtimeInput,
    runId: run_id,
    cwd,
    prepared,
    packageRoot: package_root,
    stateRoot: state_root,
    signal,
    onEvent,
    definitionRef,
    executionMode: execution_mode,
    castContexts: castResolution.contexts,
    subworkflows: childWorkflows.bundles,
    writeText: write_text_atomic,
  });
}

function readBoundJson(path, maxBytes) {
  const entry = lstatSync(path);
  if (entry.isSymbolicLink() || !entry.isFile() || entry.size < 1 || entry.size > maxBytes) throw new Error("invalid-file");
  return JSON.parse(readFileSync(path, "utf8"));
}

async function resumeNamedWorkflowLeased({
  run_id,
  task,
  input = null,
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
  write_text_atomic = writeTextAtomic,
} = {}) {
  if (![cwd, state_root, package_root].every((value) => typeof value === "string" && value.length > 0)) {
    return { ok: false, status: "fail-closed", code: "workflow-execution-path-invalid" };
  }
  if (typeof write_text_atomic !== "function") {
    return { ok: false, status: "fail-closed", code: "workflow-execution-persistence-invalid" };
  }
  if (!validateRunId(run_id).ok) return { ok: false, status: "fail-closed", code: "unsafe-run-id" };
  if (input == null && (typeof task !== "string" || task.trim() === "")) {
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
    definition = readBoundJson(join(runPath, `${run_id}.definition.json`), WORKFLOW_LIMITS.max_workflow_bytes + 1);
    resumeDocument = readBoundJson(
      join(state_root, "private", "runs", run_id, "kernel-checkpoint.json"),
      KERNEL_CHECKPOINT_LIMITS.max_document_bytes,
    );
  } catch {
    return { ok: false, status: "fail-closed", code: "kernel-resume-record-invalid" };
  }
  const executionMode = publicState?.schema_version === 4
    ? DEFAULT_WORKFLOW_EXECUTION_MODE
    : validateWorkflowExecutionMode(publicState?.execution_mode).ok
      ? publicState.execution_mode
      : null;
  if (publicState?.schema_version !== 5 || executionMode == null
    || publicState.run_id !== run_id || typeof publicState.completed !== "boolean"
    || typeof publicState.workflow_id !== "string" || !/^sha256:[0-9a-f]{64}$/.test(publicState.definition_ref ?? "")
    || !/^sha256:[0-9a-f]{64}$/.test(publicState.event_ref ?? "")
    || !kernelPublicCountsAreValid(publicState)
    || ![4, 5].includes(resumeDocument?.scheduler?.schema_version)
    || !/^sha256:[0-9a-f]{64}$/.test(publicState.baseline_ref ?? "")
    || !/^sha256:[0-9a-f]{64}$/.test(publicState.worktree_owner_ref ?? "")
    || ![1, 2].includes(resumeDocument?.schema_version)
    || Object.keys(resumeDocument).some((key) => ![
      "schema_version", "scheduler", "snapshot_generation", "snapshot_ref", "maintenance",
    ].includes(key))
    || (resumeDocument.schema_version === 1 && Object.hasOwn(resumeDocument, "maintenance"))
    || (resumeDocument.schema_version === 2
      && (!resumeDocument.maintenance
        || Object.keys(resumeDocument.maintenance).length !== 2
        || !Object.hasOwn(resumeDocument.maintenance, "cleanup_generations")
        || !Object.hasOwn(resumeDocument.maintenance, "public_projection_pending")
        || !Array.isArray(resumeDocument.maintenance.cleanup_generations)
        || new Set(resumeDocument.maintenance.cleanup_generations).size !== resumeDocument.maintenance.cleanup_generations.length
        || resumeDocument.maintenance.cleanup_generations.some((entry) => typeof entry !== "string" || !/^[A-Za-z0-9._-]+$/.test(entry))
        || resumeDocument.maintenance.cleanup_generations.includes(resumeDocument.snapshot_generation)
        || typeof resumeDocument.maintenance.public_projection_pending !== "boolean"))
    || !/^[A-Za-z0-9._-]+$/.test(resumeDocument.snapshot_generation ?? "")
    || !/^sha256:[0-9a-f]{64}$/.test(resumeDocument.snapshot_ref ?? "")) {
    return { ok: false, status: "fail-closed", code: "kernel-resume-record-invalid" };
  }
  if (!resumeProjectionRelationIsValid(publicState, resumeDocument)) {
    return { ok: false, status: "fail-closed", code: "kernel-resume-record-invalid" };
  }
  const authenticatedEvents = authenticateResumeEvents(runPath, run_id, publicState, resumeDocument);
  if (authenticatedEvents == null) {
    return { ok: false, status: "fail-closed", code: "kernel-resume-events-invalid" };
  }
  const normalized = normalizeWorkflowDefinition(definition);
  if (!normalized.ok || normalized.migrated || workflowDefinitionHash(normalized.definition) !== publicState.definition_ref
    || normalized.definition.id !== publicState.workflow_id) {
    return { ok: false, status: "fail-closed", code: "kernel-resume-definition-invalid" };
  }
  const inputValidation = normalizeWorkflowInput(normalized.definition.inputs, input ?? { task });
  if (!inputValidation.valid) return { ok: false, status: "fail-closed", code: "workflow-input-invalid", errors: inputValidation.errors };
  const runtimeInput = inputValidation.input;
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
  if (toggles.worktree === false) return { ok: false, status: "fail-closed", code: "workflow-canonical-worktree-required" };
  const childWorkflows = resolveSubworkflowBundles(normalized.definition, {
    stateRoot: state_root,
    chainRegistry: chain_registry,
    runRegistry: run_registry,
    profile: active.profile,
  });
  if (!childWorkflows.ok) return { ok: false, status: "fail-closed", code: childWorkflows.code };
  if (publicState.schema_version === 5
    && readPersistedChildDefinitions(runPath, run_id, childWorkflows.bundles) == null) {
    return { ok: false, status: "fail-closed", code: "kernel-resume-definition-invalid" };
  }
  const actualBindingRef = workflowExecutionBindingRef({
    workflow: named.workflow,
    profile: active.profile,
    toggles,
    presets: profiled.presets,
    subworkflows: childWorkflows.bundles.map((entry) => entry.definition),
    execution_mode: executionMode,
  });
  if (typeof expected_binding_ref !== "string" || actualBindingRef !== expected_binding_ref) {
    return { ok: false, status: "fail-closed", code: "workflow-preflight-drift" };
  }
  const castResolution = resolveCastContexts([
    { definition: normalized.definition, execution, config },
    ...childWorkflows.bundles,
  ], profiled.presets, toggles);
  if (!castResolution.ok) return { ok: false, status: "fail-closed", code: castResolution.code };
  if (resumeDocument.scheduler.terminal_result != null) {
    const taskRef = hashRef(stableStringify(runtimeInput));
    const runtimeRef = workflowKernelRuntimeRef(publicState.definition_ref, castResolution.contexts, executionMode);
    let authority;
    try {
      authority = await validateWorkflowKernelResumeAuthority(normalized.definition, runtimeInput, {
        run_id,
        runtime_ref: runtimeRef,
        task_ref: taskRef,
        execution_mode: executionMode,
        resume: resumeDocument.scheduler,
        resume_events: authenticatedEvents.prefix,
        journal_root: runPath,
        depth: 0,
      });
    } catch {
      return { ok: false, status: "fail-closed", code: "kernel-journal-corrupt" };
    }
    if (authority.resume_authoritative !== true) {
      return { ok: false, status: "fail-closed", code: authority.code ?? "kernel-checkpoint-terminal-invalid" };
    }
  }
  try {
    write_text_atomic(
      runPath,
      `${run_id}.kernel.events.jsonl`,
      authenticatedEvents.prefix.map((event) => JSON.stringify(event)).join("\n")
        + (authenticatedEvents.prefix.length ? "\n" : ""),
    );
    const terminalMarker = authenticatedEvents.projection_pending
      ? resumeDocument.scheduler.terminal_result ?? null
      : null;
    if (publicState.event_count !== resumeDocument.scheduler.event_seq
      || publicState.journal_entries !== resumeDocument.scheduler.journal_entries
      || publicState.event_ref !== resumeDocument.scheduler.event_ref
      || terminalMarker != null) {
      publicState = {
        ...publicState,
        journal_entries: resumeDocument.scheduler.journal_entries,
        event_count: resumeDocument.scheduler.event_seq,
        event_ref: resumeDocument.scheduler.event_ref,
        ...(terminalMarker == null ? {} : {
          completed: true,
          terminal: resumeDocument.scheduler.current,
          status: terminalMarker.status,
          code: terminalMarker.code,
        }),
      };
      write_text_atomic(runPath, `${run_id}.state.json`, `${stableStringify(publicState)}\n`);
    }
    if (authenticatedEvents.projection_pending) {
      const maintained = structuredClone(resumeDocument);
      maintained.maintenance.public_projection_pending = false;
      try {
        write_text_atomic(
          state_root,
          join("private", "runs", run_id, "kernel-checkpoint.json"),
          `${stableStringify(maintained)}\n`,
        );
        resumeDocument = maintained;
      } catch {
        return { ok: false, status: "fail-closed", code: "kernel-resume-projection-write-failed" };
      }
    }
  } catch {
    return { ok: false, status: "fail-closed", code: "kernel-resume-events-invalid" };
  }
  if (publicState.completed === true && resumeDocument.scheduler.terminal_result != null) {
    const terminalMarker = resumeDocument.scheduler.terminal_result;
    return {
      ok: terminalMarker.status === "succeeded",
      status: terminalMarker.status === "succeeded" ? "ok" : "fail-closed",
      code: terminalMarker.code,
      run_id,
      chain_id: normalized.definition.id,
      execution_mode: executionMode,
      converged: terminalMarker.status === "succeeded",
      stop_reason: terminalMarker.status,
      total_passes: 0,
      flow: [],
      cast: [],
      worktree_path: null,
      worktree_branch: publicState.worktree_branch,
      events_path: join(runPath, `${run_id}.kernel.events.jsonl`),
      state_path: join(runPath, `${run_id}.state.json`),
      open_disagreements: 0,
      warnings: [],
      calls: null,
      terminal_authoritative: true,
      resumable: false,
    };
  }
  const certified = await certifyCast(adapter, nonMockSpecs(castResolution.contexts), signal, {
    require_live: castResolution.contexts.some((entry) => entry.definition.provider_policy.require_live_certification === true),
  });
  if (!certified.ok) return { ok: false, status: "fail-closed", code: certified.code };
  if (certified.bindings.length > 0
    && (typeof expected_exact_ref !== "string" || certified.binding_ref !== expected_exact_ref)) {
    return { ok: false, status: "fail-closed", code: "provider-exact-consent-drift" };
  }
  return executeKernelDefinition({
    definition: normalized.definition,
    definitionRef: publicState.definition_ref,
    executionMode,
    execution,
    config,
    presets: profiled.presets,
    toggles,
    adapter,
    input: runtimeInput,
    runId: run_id,
    cwd,
    prepared: { ok: true, path: runPath },
    packageRoot: package_root,
    stateRoot: state_root,
    signal,
    onEvent,
    castContexts: castResolution.contexts,
    resumeDocument: { ...resumeDocument, public_state: publicState },
    resumeEvents: authenticatedEvents.prefix,
    subworkflows: childWorkflows.bundles,
    writeText: write_text_atomic,
  });
}

async function withNamedRunLease(options, operation, busyCode) {
  const { cwd, run_id: runId } = options ?? {};
  if (!validateRunId(runId).ok) return { ok: false, status: "fail-closed", code: "unsafe-run-id" };
  if (![cwd, options?.state_root, options?.package_root].every((value) => typeof value === "string" && value.length > 0)
    || (options?.input == null && (typeof options?.task !== "string" || options.task.trim() === ""))) {
    return operation(options);
  }
  const lease = acquireRunLease(cwd, runId);
  if (!lease.ok) return {
    ok: false,
    status: "fail-closed",
    code: lease.code === RUNNER_CODES.RESUME_IN_PROGRESS ? busyCode : lease.code,
  };
  let result;
  let released = false;
  try { result = await operation(options); }
  finally { released = releaseRunLease(lease); }
  return released ? result : {
    ...result,
    warnings: [...new Set([...(result?.warnings ?? []), "run-lease-cleanup-pending"])],
  };
}

export async function executeNamedWorkflow(options = {}) {
  return withNamedRunLease(options, executeNamedWorkflowLeased, RUNNER_CODES.RUN_IN_PROGRESS);
}

export async function resumeNamedWorkflow(options = {}) {
  return withNamedRunLease(options, resumeNamedWorkflowLeased, RUNNER_CODES.RESUME_IN_PROGRESS);
}
