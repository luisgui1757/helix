// Helix Workflow Kernel scheduler. It interprets only validated v4 nodes,
// delegates model/provider and workspace effects, and emits structural events.

import { createBudgetLedger, createScopedBudgetLedger } from "./budgets.mjs";
import { createEffectJournal, effectIdentity, journalRef, KERNEL_JOURNAL_LIMITS, tryJournalRef } from "./journal.mjs";
import {
  childInputSchemaAcceptsParent,
  evaluateCondition,
  normalizeWorkflowInput,
  resolveJsonPointer,
  validateWorkflowDefinition,
  WORKFLOW_LIMITS,
  workflowDefinitionHash,
} from "../workflow/schema.mjs";
import { isRecoverableKernelFailure, KERNEL_CHECKPOINT_LIMITS, validateKernelCheckpoint } from "./state.mjs";

const MUTATING = new Set(["shared-serialized", "isolated-proposal"]);
const FAILURE_CLASSES = new Set(["agent", "kernel"]);
const HASH = /^sha256:[0-9a-f]{64}$/;

function safeCode(value, fallback) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) && value.length <= 160 ? value : fallback;
}

function settled(status, extra = {}) {
  const result = { status, ...extra };
  if (status !== "ok" && !FAILURE_CLASSES.has(result.failure_class)) result.failure_class = "kernel";
  return result;
}

async function mapConcurrent(values, limit, task, shouldStop = null) {
  const output = new Array(values.length);
  let cursor = 0;
  let stopped = false;
  const started = new Set();
  const controller = new AbortController();
  const stop = (result, index) => {
    if (!stopped && shouldStop?.(result, index) === true) {
      stopped = true;
      controller.abort("kernel-branch-aborted");
    }
  };
  const workers = Array.from({ length: Math.min(limit, Math.max(1, values.length)) }, async () => {
    while (!stopped && cursor < values.length) {
      const index = cursor++;
      started.add(index);
      output[index] = await task(values[index], index, { signal: controller.signal, stop: (result) => stop(result, index) });
      stop(output[index], index);
    }
  });
  await Promise.all(workers);
  return { output, started };
}

function normalizedUsage(value) {
  if (value == null) return { tokens: 0, cost_micros: 0 };
  if (typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== 2
    || !Object.hasOwn(value, "tokens") || !Object.hasOwn(value, "cost_micros")) return null;
  const tokens = value.tokens;
  const costMicros = value.cost_micros;
  return Number.isSafeInteger(tokens) && tokens >= 0 && Number.isSafeInteger(costMicros) && costMicros >= 0
    ? { tokens, cost_micros: costMicros }
    : null;
}

function checkedUsageTotal(results) {
  let tokens = 0;
  let costMicros = 0;
  for (const result of results) {
    const usage = normalizedUsage(result?.usage);
    if (usage == null) return null;
    tokens += usage.tokens;
    costMicros += usage.cost_micros;
    if (!Number.isSafeInteger(tokens) || !Number.isSafeInteger(costMicros)) return null;
  }
  return { tokens, cost_micros: costMicros };
}

function strictRecommendation(values) {
  const recommendations = values.map((entry) => entry?.value?.recommendation).filter((value) => typeof value === "string");
  if (recommendations.includes("revise-jump")) return "revise-jump";
  if (recommendations.includes("revise")) return "revise";
  if (recommendations.length > 0 && recommendations.every((value) => value === "approve")) return "approve";
  return recommendations.at(-1) ?? "missing";
}

function outputValue(result) {
  return result?.status === "ok" ? result.value : null;
}

function pendingJournalIdentities(active, identities = new Set()) {
  if (!active || typeof active !== "object") return identities;
  for (const intent of Object.values(active.inflight ?? {})) {
    if (typeof intent?.identity === "string") identities.add(intent.identity);
  }
  for (const result of Object.values(active.completed ?? {})) {
    if (typeof result?._journal_pending?.identity === "string") identities.add(result._journal_pending.identity);
  }
  return pendingJournalIdentities(active.child?.scheduler?.active, identities);
}

function journalResult(result) {
  if (result == null || typeof result !== "object" || Array.isArray(result)) return null;
  const cloned = structuredClone(result);
  delete cloned._journal_identity;
  delete cloned._journal_pending;
  delete cloned._workspace_pending;
  return cloned;
}

function validateCompletedJournalState(active, records) {
  if (active == null) return { ok: true };
  if (typeof active !== "object" || Array.isArray(active)) return { ok: false };
  const byIdentity = new Map(records.map((record) => [record.identity, record]));
  for (const [instanceId, completed] of Object.entries(active.completed ?? {})) {
    let clean;
    try { clean = journalResult(completed); } catch { return { ok: false }; }
    const resultRef = tryJournalRef(clean);
    if (resultRef == null) return { ok: false };
    const pending = completed._journal_pending ?? null;
    let identity = completed._journal_identity ?? pending?.identity ?? null;
    if (pending != null) {
      if (typeof pending !== "object" || Array.isArray(pending)
        || !HASH.test(pending.identity ?? "") || !HASH.test(pending.base_identity ?? "")
        || pending.node_id !== active.node_id || pending.instance_id !== instanceId
        || pending.status !== clean.status || tryJournalRef(pending.result) !== resultRef
        || typeof pending.mutating !== "boolean") return { ok: false };
      identity = pending.identity;
    }
    const matches = records.filter((record) => record.node_id === active.node_id
      && record.instance_id === instanceId && record.result_ref === resultRef);
    if (identity != null && !HASH.test(identity)) return { ok: false };
    if (identity != null && byIdentity.has(identity)) {
      const record = byIdentity.get(identity);
      if (record.node_id !== active.node_id || record.instance_id !== instanceId || record.result_ref !== resultRef) return { ok: false };
    } else if (pending == null && matches.length !== 1) {
      return { ok: false };
    } else if (pending == null) {
      identity = matches[0].identity;
    }
    if (completed._journal_identity != null && completed._journal_identity !== identity) return { ok: false };
  }
  return validateCompletedJournalState(active.child?.scheduler?.active ?? null, records);
}

function checkpointBudgetEvidence(checkpoint, records) {
  const prefix = records.slice(0, checkpoint.journal_entries);
  const usage = checkedUsageTotal(prefix.map((record) => record.result));
  if (usage == null) return null;
  let effects = prefix.length;
  let tokens = usage.tokens;
  let costMicros = usage.cost_micros;
  const prefixIdentities = new Set(prefix.map((record) => record.identity));
  const activeIdentities = new Set();
  const addEffect = (result = null) => {
    const resultUsage = normalizedUsage(result?.usage);
    const nextEffects = effects + 1;
    const nextTokens = resultUsage == null ? null : tokens + resultUsage.tokens;
    const nextCost = resultUsage == null ? null : costMicros + resultUsage.cost_micros;
    if (![nextEffects, nextTokens, nextCost].every((value) => Number.isSafeInteger(value) && value >= 0)) return false;
    effects = nextEffects;
    tokens = nextTokens;
    costMicros = nextCost;
    return true;
  };
  const visit = (active) => {
    if (active == null) return true;
    for (const intent of Object.values(active.inflight ?? {})) {
      if (prefixIdentities.has(intent.identity) || activeIdentities.has(intent.identity)) return false;
      activeIdentities.add(intent.identity);
      if (!addEffect()) return false;
    }
    for (const completed of Object.values(active.completed ?? {})) {
      const identity = completed?._journal_identity ?? completed?._journal_pending?.identity ?? null;
      if (completed?._journal_pending && prefixIdentities.has(identity)) return false;
      if (identity != null && !prefixIdentities.has(identity)) {
        if (activeIdentities.has(identity)) return false;
        activeIdentities.add(identity);
        if (!addEffect(completed)) return false;
      }
    }
    return visit(active.child?.scheduler?.active ?? null);
  };
  return visit(checkpoint.active) ? { effects, tokens, cost_micros: costMicros } : null;
}

function validBudgetSnapshot(value) {
  const keys = ["effects", "tokens", "cost_micros", "max_effects", "max_tokens", "max_cost_micros", "reserved"];
  return value != null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
    && [value.effects, value.tokens, value.cost_micros, value.reserved]
      .every((entry) => Number.isSafeInteger(entry) && entry >= 0)
    && Number.isSafeInteger(value.max_effects) && value.max_effects >= 1
    && Number.isSafeInteger(value.effects + value.reserved)
    && value.effects + value.reserved <= value.max_effects
    && [value.max_tokens, value.max_cost_micros]
      .every((entry) => entry === null || (Number.isSafeInteger(entry) && entry >= 0));
}

export async function runWorkflowKernel(definition, input, deps = {}) {
  const validation = validateWorkflowDefinition(definition);
  if (!validation.valid) return { ok: false, status: "refused", code: "kernel-definition-invalid", errors: validation.errors };
  const inputValidation = normalizeWorkflowInput(definition.inputs, input);
  if (!inputValidation.valid) return { ok: false, status: "refused", code: "kernel-input-invalid", errors: inputValidation.errors };
  input = inputValidation.input;
  if (typeof deps.executeAgent !== "function" || typeof deps.runGate !== "function") {
    return { ok: false, status: "refused", code: "kernel-effects-missing" };
  }
  const agents = Object.values(definition.nodes).flatMap((node) => node.kind === "agent" ? [node]
    : node.kind === "pipeline" ? node.stages
      : node.kind === "parallel" ? node.branches
        : node.kind === "map" ? [node.body] : []);
  if (agents.some((agent) => MUTATING.has(agent.mutation))) {
    const required = ["currentRef", "verifyRef", "begin", "commit", "rollback", "serialize", "finalize"];
    if (deps.workspace == null || required.some((name) => typeof deps.workspace[name] !== "function")) {
      return { ok: false, status: "refused", code: "kernel-workspace-effects-missing" };
    }
  }
  if (Object.values(definition.nodes).some((node) => ["agent", "pipeline"].includes(node.kind) && node.artifact)
    && typeof deps.verifyArtifact !== "function") {
    return { ok: false, status: "refused", code: "kernel-artifact-effect-missing" };
  }
  const runId = deps.run_id ?? definition.id;
  const finalGateId = Object.keys(definition.nodes).find((id) => definition.nodes[id].kind === "gate" && definition.nodes[id].final === true);
  const definitionRef = workflowDefinitionHash(definition);
  const runtimeRef = deps.runtime_ref ?? journalRef({ runtime: "kernel-injected", version: 1 });
  const resume = deps.resume ?? null;
  if (resume) {
    const checked = validateKernelCheckpoint(resume, {
      run_id: runId,
      definition_ref: definitionRef,
      runtime_ref: runtimeRef,
      task_ref: deps.task_ref,
      node_ids: new Set(Object.keys(definition.nodes)),
    });
    if (!checked.valid) return { ok: false, status: "refused", code: checked.code };
    if (resume.schema_version === 1) {
      return { ok: false, status: "refused", code: "kernel-checkpoint-elapsed-unknown" };
    }
    if (resume.active?.child) {
      const parentNode = definition.nodes[resume.active.node_id];
      const expectedChildRunId = `${runId}.${resume.active.node_id}.${resume.active.visit}`;
      if (parentNode?.kind !== "subworkflow"
        || resume.active.child.workflow_id !== parentNode.workflow_id
        || resume.active.child.version !== parentNode.version
        || resume.active.child.run_id !== expectedChildRunId
        || resume.active.child.scheduler.run_id !== expectedChildRunId) {
        return { ok: false, status: "refused", code: "kernel-checkpoint-child-invalid" };
      }
    }
  }
  const events = [];
  let seq = resume?.event_seq ?? 0;
  let eventFailure = null;
  let stopRun = () => {};
  const emit = (kind, fields = {}) => {
    if (eventFailure != null) return false;
    const event = { schema_version: 1, seq: ++seq, run_id: runId, kind, ...fields };
    events.push(event);
    try { deps.onEvent?.(structuredClone(event)); }
    catch {
      events.pop();
      seq -= 1;
      eventFailure = "kernel-event-write-failed";
      stopRun(eventFailure);
    }
    return eventFailure == null;
  };
  const journal = deps.journal ?? createEffectJournal({
    root: deps.journal_root ?? null,
    run_id: deps.journal_root ? runId : null,
    verify_workspace: deps.workspace?.verifyRef,
    expected_records: resume?.journal_entries ?? null,
  });
  if (resume) {
    const records = journal.records();
    const consistent = validateCompletedJournalState(resume.active, records);
    if (!consistent.ok) return { ok: false, status: "refused", code: "kernel-checkpoint-journal-invalid" };
    if ((deps.depth ?? 0) === 0) {
      const evidence = checkpointBudgetEvidence(resume, records);
      if (evidence == null || resume.budget.effects < evidence.effects
        || resume.budget.tokens < evidence.tokens || resume.budget.cost_micros < evidence.cost_micros) {
        return { ok: false, status: "refused", code: "kernel-checkpoint-budget-invalid" };
      }
    }
    const suffix = journal.suffix(resume.journal_entries);
    if (!suffix.ok) return { ok: false, status: "refused", code: suffix.code };
    const pending = resume.schema_version === 2 ? pendingJournalIdentities(resume.active) : new Set();
    if (suffix.records.some((record) => !pending.has(record.identity))) {
      return { ok: false, status: "refused", code: "kernel-journal-checkpoint-drift" };
    }
  }
  let injectedBudget = null;
  if (deps.budget != null) {
    const required = ["snapshot", "reserve", "reserveBatch", "consume", "revertConsume", "account", "revertAccount", "release"];
    if (required.some((name) => typeof deps.budget[name] !== "function")) {
      return { ok: false, status: "refused", code: "kernel-budget-effects-missing" };
    }
    try { injectedBudget = deps.budget.snapshot(); } catch { injectedBudget = null; }
    if (!validBudgetSnapshot(injectedBudget)) {
      return { ok: false, status: "refused", code: "kernel-budget-binding-invalid" };
    }
    if (injectedBudget.max_effects > definition.limits.max_total_effects) {
      return { ok: false, status: "refused", code: resume ? "kernel-budget-binding-drift" : "kernel-budget-binding-invalid" };
    }
  }
  const budgetLimits = injectedBudget ?? {
    max_effects: definition.limits.max_total_effects,
    max_tokens: deps.max_tokens ?? null,
    max_cost_micros: deps.max_cost_micros ?? null,
  };
  if (resume && (resume.budget.max_effects !== budgetLimits.max_effects
    || resume.budget.max_tokens !== budgetLimits.max_tokens
    || resume.budget.max_cost_micros !== budgetLimits.max_cost_micros
    || (injectedBudget != null && tryJournalRef(resume.budget) !== tryJournalRef(injectedBudget)))) {
    return { ok: false, status: "refused", code: "kernel-budget-binding-drift" };
  }
  let budget;
  try {
    budget = deps.budget ?? createBudgetLedger({
      max_effects: budgetLimits.max_effects,
      max_tokens: budgetLimits.max_tokens,
      max_cost_micros: budgetLimits.max_cost_micros,
      initial_effects: resume?.budget.effects ?? 0,
      initial_tokens: resume?.budget.tokens ?? 0,
      initial_cost_micros: resume?.budget.cost_micros ?? 0,
    });
  } catch {
    return { ok: false, status: "refused", code: "kernel-budget-binding-invalid" };
  }
  const outputs = resume ? structuredClone(resume.outputs) : {};
  const visits = resume ? structuredClone(resume.visits) : Object.fromEntries(Object.keys(definition.nodes).map((id) => [id, 0]));
  let startedAt;
  try { startedAt = deps.now?.() ?? Date.now(); }
  catch { return { ok: false, status: "failed", code: "kernel-clock-failed" }; }
  if (!Number.isSafeInteger(startedAt) || startedAt < 0) {
    return { ok: false, status: "failed", code: "kernel-clock-failed" };
  }
  let lastNow = startedAt;
  let clockFailure = null;
  const now = () => {
    let value;
    try { value = deps.now?.() ?? Date.now(); }
    catch { value = null; }
    if (!Number.isSafeInteger(value) || value < lastNow) {
      clockFailure ??= "kernel-clock-failed";
      return lastNow;
    }
    lastNow = value;
    return value;
  };
  const priorElapsed = resume?.schema_version === 2 ? resume.elapsed_ms : 0;
  const totalElapsed = () => {
    const elapsed = priorElapsed + (now() - startedAt);
    if (!Number.isSafeInteger(elapsed) || elapsed < 0) {
      clockFailure ??= "kernel-clock-failed";
      return priorElapsed;
    }
    return elapsed;
  };
  let current = resume?.current ?? definition.start;
  let active = resume?.active ? structuredClone(resume.active) : null;
  if (active && !Object.hasOwn(active, "inflight")) active.inflight = {};
  let checkpointTail = Promise.resolve({ ok: true });
  let writerTail = Promise.resolve();
  let cancelled = false;
  let interruptionCode = null;
  const runController = new AbortController();
  stopRun = (code) => {
    cancelled = true;
    interruptionCode ??= safeCode(code, "kernel-run-cancelled");
    if (!runController.signal.aborted) runController.abort(interruptionCode);
  };
  const abort = () => stopRun("kernel-run-cancelled");
  const deadline = () => stopRun("kernel-run-deadline-exceeded");
  const interruption = () => ({
    status: interruptionCode === "kernel-run-deadline-exceeded" || eventFailure != null ? "failed" : "cancelled",
    code: eventFailure ?? interruptionCode ?? "kernel-run-cancelled",
  });
  if (deps.signal?.aborted) abort();
  else deps.signal?.addEventListener?.("abort", abort, { once: true });
  const remainingRunMs = definition.limits.max_run_ms - priorElapsed;
  const runTimer = remainingRunMs > 0 ? setTimeout(deadline, remainingRunMs) : null;
  if (remainingRunMs <= 0) deadline();
  const runBoundary = async (operation, abortedValue = null) => {
    if (runController.signal.aborted) return abortedValue;
    let onAbort;
    const aborted = new Promise((resolve) => {
      onAbort = () => resolve(abortedValue);
      runController.signal.addEventListener("abort", onAbort, { once: true });
    });
    try { return await Promise.race([Promise.resolve().then(operation), aborted]); }
    finally { runController.signal.removeEventListener("abort", onAbort); }
  };
  const context = () => ({ inputs: input, outputs, visits, budget: budget.snapshot() });
  const checkpointSnapshot = (workspaceRef, { outputState = outputs, activeState = active } = {}) => ({
    schema_version: 2,
    run_id: runId,
    definition_ref: definitionRef,
    runtime_ref: runtimeRef,
    task_ref: deps.task_ref,
    current,
    outputs: structuredClone(outputState),
    visits: structuredClone(visits),
    active: activeState == null ? null : structuredClone(activeState),
    event_seq: seq,
    journal_entries: journal.records().length,
    budget: budget.snapshot(),
    workspace_ref: workspaceRef,
    elapsed_ms: totalElapsed(),
  });
  const checkpointFits = (options = {}) => {
    try {
      const bytes = Buffer.byteLength(JSON.stringify(checkpointSnapshot(journalRef("kernel-capacity-workspace"), options)), "utf8");
      return bytes + (options.reserve_bytes ?? 0) <= KERNEL_CHECKPOINT_LIMITS.max_scheduler_bytes;
    } catch {
      return false;
    }
  };
  const storeOutput = (nodeId, value) => {
    let cloned;
    try { cloned = structuredClone(value); } catch { return false; }
    const candidate = { ...outputs, [nodeId]: cloned };
    if (!checkpointFits({ outputState: candidate, activeState: null, reserve_bytes: KERNEL_CHECKPOINT_LIMITS.min_failure_headroom_bytes })) {
      return false;
    }
    outputs[nodeId] = cloned;
    return true;
  };
  const checkpoint = async () => {
    totalElapsed();
    if (clockFailure) return { ok: false, code: clockFailure };
    if (typeof deps.onCheckpoint !== "function") return { ok: true };
    const task = async () => {
      let workspaceRef;
      try { workspaceRef = deps.workspace?.currentRef?.(); } catch { workspaceRef = null; }
      if (!/^sha256:[0-9a-f]{64}$/.test(workspaceRef ?? "")) return { ok: false, code: "kernel-checkpoint-workspace-invalid" };
      const snapshot = checkpointSnapshot(workspaceRef);
      if (clockFailure) return { ok: false, code: clockFailure };
      try {
        if (Buffer.byteLength(JSON.stringify(snapshot), "utf8") > KERNEL_CHECKPOINT_LIMITS.max_scheduler_bytes) {
          return { ok: false, code: "kernel-checkpoint-capacity-exceeded" };
        }
      } catch {
        return { ok: false, code: "kernel-checkpoint-capacity-exceeded" };
      }
      try {
        const saved = await deps.onCheckpoint(snapshot);
        return saved?.ok === true ? { ok: true } : { ok: false, code: safeCode(saved?.code, "kernel-checkpoint-write-failed") };
      } catch {
        return { ok: false, code: "kernel-checkpoint-write-failed" };
      }
    };
    checkpointTail = checkpointTail.then(task, task);
    return checkpointTail;
  };
  const verifyNodeArtifact = async (node, nodeId) => {
    if (!node.artifact) return { ok: true, artifact_ref: null };
    let artifact;
    try {
      artifact = await runBoundary(() => deps.verifyArtifact(node.artifact, {
        run_id: runId, node_id: nodeId, definition_id: definition.id, cwd: deps.workspace?.cwd ?? deps.cwd,
        signal: runController.signal,
      }));
    } catch {
      return { ok: false, status: "failed", code: "kernel-artifact-verification-failed" };
    }
    if (cancelled) return { ok: false, ...interruption() };
    if (!artifact?.ok) return { ok: false, status: "failed", code: safeCode(artifact?.code, "kernel-artifact-invalid") };
    if (!HASH.test(artifact.ref ?? "")) return { ok: false, status: "failed", code: "kernel-artifact-result-invalid" };
    return { ok: true, artifact_ref: artifact.ref };
  };

  const resumeCompleted = async (nodeId, instanceId) => {
    if (active?.node_id === nodeId && Object.hasOwn(active.inflight, instanceId)) {
      const intent = active.inflight[instanceId];
      const record = journal.find(intent.identity, { mutating: intent.mutating });
      if (!record || (record.status === "ok" && intent.mutating && journal.lookup(intent.identity, { mutating: true }) == null)) {
        return { found: true, result: settled("failed", { code: "kernel-effect-outcome-unknown" }) };
      }
      const usage = normalizedUsage(record.result?.usage);
      if (usage == null) return { found: true, result: settled("failed", { code: "kernel-agent-usage-invalid" }) };
      const accounted = budget.account(usage);
      if (!accounted.ok && !(accounted.code === "kernel-budget-provider-overshoot"
        && record.result?.code === "kernel-budget-provider-overshoot")) {
        if (accounted.code === "kernel-budget-provider-overshoot") budget.revertAccount(usage);
        return { found: true, result: settled("failed", { code: accounted.code }) };
      }
      delete active.inflight[instanceId];
      if (isRecoverableKernelFailure(record.result?.code)) {
        const saved = await checkpoint();
        if (!saved.ok) {
          budget.revertAccount(usage);
          active.inflight[instanceId] = intent;
        }
        return saved.ok
          ? { found: false, result: null }
          : { found: true, result: settled("failed", { code: saved.code }) };
      }
      active.completed[instanceId] = structuredClone({ ...record.result, _journal_identity: record.identity });
      const saved = await checkpoint();
      if (!saved.ok) {
        budget.revertAccount(usage);
        delete active.completed[instanceId];
        active.inflight[instanceId] = intent;
        return { found: true, result: settled("failed", { code: saved.code }) };
      }
    }
    if (active?.node_id === nodeId && Object.hasOwn(active.completed, instanceId)) {
      const resumed = structuredClone(active.completed[instanceId]);
      if (resumed._journal_pending) {
        const journaled = journal.commit(resumed._journal_pending);
        if (!journaled.ok) return { found: true, result: settled("failed", { code: journaled.code }) };
        delete resumed._journal_pending;
        active.completed[instanceId] = structuredClone(resumed);
        const saved = await checkpoint();
        if (!saved.ok) return { found: true, result: settled("failed", { code: saved.code }) };
      }
      if (resumed._workspace_pending) {
        let finalized;
        try { finalized = await deps.workspace.finalize(resumed._workspace_pending); }
        catch { finalized = null; }
        if (!finalized?.ok) {
          return { found: true, result: settled("failed", { code: safeCode(finalized?.code, "kernel-workspace-finalize-failed") }) };
        }
        delete resumed._workspace_pending;
        active.completed[instanceId] = structuredClone(resumed);
        const saved = await checkpoint();
        if (!saved.ok) return { found: true, result: settled("failed", { code: saved.code }) };
      }
      if (isRecoverableKernelFailure(resumed.code)) {
        delete active.completed[instanceId];
        const saved = await checkpoint();
        return saved.ok
          ? { found: false, result: null }
          : { found: true, result: settled("failed", { code: saved.code }) };
      }
      emit("effect-resumed", { node_id: nodeId, instance_id: instanceId });
      return { found: true, result: resumed };
    }
    return { found: false, result: null };
  };

  const executeOne = async (agent, nodeId, instanceId, local = {}, preReservation = null, coordination = null) => {
    const mutating = MUTATING.has(agent.mutation);
    const resumed = await resumeCompleted(nodeId, instanceId);
    if (resumed.found) {
      if (preReservation) budget.release(preReservation.id);
      return resumed.result;
    }
    if (coordination?.signal?.aborted) {
      if (preReservation) budget.release(preReservation.id);
      return settled("cancelled", { code: "kernel-branch-aborted" });
    }
    let beforeRef;
    try { beforeRef = deps.workspace?.currentRef?.() ?? journalRef({ workspace: "untracked", run_id: runId }); }
    catch {
      if (preReservation) budget.release(preReservation.id);
      return settled("failed", { code: "kernel-workspace-ref-invalid" });
    }
    const inputRef = tryJournalRef({ input, outputs, local, node_id: nodeId, instance_id: instanceId });
    if (inputRef == null) {
      if (preReservation) budget.release(preReservation.id);
      return settled("failed", { code: "kernel-effect-input-invalid" });
    }
    const baseIdentity = effectIdentity({ definition_ref: definitionRef, node_id: nodeId, instance_id: instanceId, agent, input_ref: inputRef, runtime_ref: runtimeRef, before_ref: beforeRef });
    const cached = journal.lookupBase(baseIdentity, { mutating });
    if (cached) {
      if (preReservation) budget.release(preReservation.id);
      emit("effect-cache-hit", { node_id: nodeId, instance_id: instanceId, effect_ref: cached.identity });
      return cached.result;
    }
    const invocation = journal.nextInvocation(baseIdentity);
    if (!Number.isSafeInteger(invocation) || invocation < 1) return settled("failed", { code: "kernel-journal-state-invalid" });
    const identity = effectIdentity({ base_identity: baseIdentity, invocation });
    const reservation = preReservation ?? budget.reserve({
      tokens: agent.reserve_tokens ?? 0,
      cost_micros: agent.reserve_cost_micros ?? 0,
    });
    if (!reservation.ok) return settled("refused", { code: reservation.code });
    const perform = async () => {
      if (cancelled) {
        budget.release(reservation.id);
        const stopped = interruption();
        return settled(stopped.status, { code: stopped.code });
      }
      let tx = null;
      if (mutating) {
        try { tx = await deps.workspace.begin({ node_id: nodeId, instance_id: instanceId, mode: agent.mutation, before_ref: beforeRef }); }
        catch {
          budget.release(reservation.id);
          return settled("failed", { code: "kernel-workspace-begin-failed" });
        }
        if (tx?.ok === false) {
          budget.release(reservation.id);
          return settled("refused", { code: safeCode(tx.code, "kernel-workspace-begin-failed") });
        }
        if (tx?.ok !== true || tx.before_ref !== beforeRef || typeof tx.cwd !== "string" || tx.cwd.length === 0) {
          budget.release(reservation.id);
          return settled("failed", { code: "kernel-workspace-begin-invalid" });
        }
      }
      const consumed = budget.consume(reservation.id);
      if (!consumed.ok) {
        let restored = { ok: true };
        if (mutating && tx) {
          try { restored = await deps.workspace.rollback(tx); }
          catch { restored = null; }
        }
        return settled("failed", { code: restored?.ok ? consumed.code : safeCode(restored?.code, "kernel-workspace-restore-failed") });
      }
      active.inflight[instanceId] = { identity, base_identity: baseIdentity, mutating };
      const intentSaved = await checkpoint();
      if (!intentSaved.ok) {
        delete active.inflight[instanceId];
        budget.revertConsume();
        let restored = { ok: true };
        if (mutating && tx) {
          try { restored = await deps.workspace.rollback(tx); }
          catch { restored = null; }
        }
        return settled("failed", { code: restored?.ok ? intentSaved.code : safeCode(restored?.code, "kernel-workspace-restore-failed") });
      }
      emit("effect-start", { node_id: nodeId, instance_id: instanceId, effect_ref: identity });
      const controller = new AbortController();
      const cancel = () => controller.abort("kernel-effect-cancelled");
      if (cancelled || deps.signal?.aborted) cancel();
      else {
        deps.signal?.addEventListener?.("abort", cancel, { once: true });
        runController.signal.addEventListener("abort", cancel, { once: true });
      }
      const timer = setTimeout(() => controller.abort("kernel-effect-timeout"), Math.min(agent.timeout_ms, definition.limits.max_call_ms));
      let raw;
      if (controller.signal.aborted) {
        raw = { ok: false, code: controller.signal.reason };
      } else try {
        raw = await Promise.race([
          Promise.resolve(deps.executeAgent(agent, {
            run_id: runId, node_id: nodeId, instance_id: instanceId, task: input.task,
            definition_id: definition.id,
            input: structuredClone(input), outputs: structuredClone(outputs), local: structuredClone(local),
            visit: visits[nodeId], artifact: definition.nodes[nodeId]?.artifact ?? agent.artifact ?? null,
            cwd: tx?.cwd ?? deps.workspace?.cwd ?? deps.cwd, signal: controller.signal,
          })),
          new Promise((resolve) => controller.signal.addEventListener("abort", () => resolve({ ok: false, code: controller.signal.reason }), { once: true })),
        ]);
      } catch { raw = { ok: false, code: "kernel-agent-effect-failed" }; }
      clearTimeout(timer);
      deps.signal?.removeEventListener?.("abort", cancel);
      runController.signal.removeEventListener("abort", cancel);
      let result;
      let observedUsage = normalizedUsage(raw?.usage);
      if (observedUsage == null) {
        result = settled("failed", { code: "kernel-agent-usage-invalid" });
      }
      if (observedUsage != null && raw?.ok === true) {
        try {
          result = settled("ok", {
            value: structuredClone(raw.value),
            usage: structuredClone(observedUsage),
            attestation_ref: raw.attestation_ref ?? null,
          });
        } catch {
          result = settled("failed", { code: "kernel-agent-result-invalid" });
        }
        if (result.status === "ok" && tryJournalRef(result) == null) {
          result = settled("failed", { code: "kernel-agent-result-invalid" });
        }
      } else if (observedUsage != null) {
        const stopped = cancelled ? interruption() : null;
        result = settled(stopped?.status
          ?? (raw?.code === "kernel-effect-cancelled" || raw?.code === "kernel-run-cancelled" ? "cancelled" : "failed"), {
          code: stopped?.code ?? safeCode(raw?.code, "kernel-agent-effect-failed"),
          failure_class: raw?.failure_class === "agent" ? "agent" : "kernel",
        });
      }
      let workspaceRef = null;
      let workspaceApplied = false;
      let workspaceRecoveryFailed = false;
      let workspaceRecoveryCode = null;
      const rollback = async () => {
        if (!mutating || !tx) return { ok: true };
        let restored;
        try { restored = await deps.workspace.rollback(tx); }
        catch { restored = null; }
        workspaceApplied = false;
        workspaceRef = null;
        if (restored?.ok) return { ok: true };
        workspaceRecoveryFailed = true;
        workspaceRecoveryCode = safeCode(restored?.code, "kernel-workspace-restore-failed");
        return { ok: false, code: workspaceRecoveryCode };
      };
      if (mutating) {
        if (result.status === "ok") {
          let committed;
          try { committed = await deps.workspace.commit(tx, result); }
          catch { committed = null; }
          if (!committed?.ok || !/^sha256:[0-9a-f]{64}$/.test(committed.workspace_ref ?? "")) {
            result = settled("failed", { code: safeCode(committed?.code, "kernel-workspace-commit-failed") });
            const restored = await rollback();
            if (!restored.ok) result = settled("failed", { code: restored.code });
          } else {
            workspaceRef = committed.workspace_ref;
            workspaceApplied = true;
          }
        } else {
          const restored = await rollback();
          if (!restored.ok) result = settled("failed", { code: restored.code });
        }
      }
      if (observedUsage != null) result = { ...result, usage: observedUsage };
      const accounted = budget.account(observedUsage ?? { tokens: 0, cost_micros: 0 });
      if (!accounted.ok) {
        result = settled("failed", { code: accounted.code, ...(observedUsage ? { usage: observedUsage } : {}) });
        if (workspaceApplied) {
          const restored = await rollback();
          if (!restored.ok) result = settled("failed", { code: restored.code, ...(observedUsage ? { usage: observedUsage } : {}) });
        }
      }
      if (observedUsage != null && result.usage == null) result = { ...result, usage: observedUsage };
      if (workspaceRecoveryFailed) {
        emit("effect-end", { node_id: nodeId, instance_id: instanceId, effect_ref: identity, status: "failed", code: workspaceRecoveryCode });
        return settled("failed", { code: workspaceRecoveryCode });
      }
      let journalRecord = {
        identity, base_identity: baseIdentity, node_id: nodeId, instance_id: instanceId, input_ref: inputRef, runtime_ref: runtimeRef,
        before_ref: beforeRef, workspace_ref: workspaceRef, mutating, status: result.status, result,
      };
      if (result.status === "ok" && journal.canCommit?.(journalRecord, {
        reserve_bytes: KERNEL_JOURNAL_LIMITS.min_failure_headroom_bytes,
      })?.code === "kernel-journal-capacity-exceeded") {
        const restored = await rollback();
        result = settled("failed", { code: restored.ok ? "kernel-result-capacity-exceeded" : restored.code,
          ...(observedUsage ? { usage: observedUsage } : {}) });
        workspaceRef = null;
        workspaceApplied = false;
        journalRecord = {
          identity, base_identity: baseIdentity, node_id: nodeId, instance_id: instanceId, input_ref: inputRef, runtime_ref: runtimeRef,
          before_ref: beforeRef, workspace_ref: null, mutating, status: result.status, result,
        };
      }
      if (active?.node_id === nodeId) {
        let pending = null;
        if (workspaceApplied) {
          try { pending = deps.workspace.serialize(tx); } catch { pending = null; }
          if (pending == null || tryJournalRef(pending) == null) {
            const restored = await rollback();
            result = settled("failed", { code: restored.ok ? "kernel-workspace-serialize-failed" : restored.code,
              ...(observedUsage ? { usage: observedUsage } : {}) });
            workspaceRef = null;
            workspaceApplied = false;
            pending = null;
            journalRecord = {
              identity, base_identity: baseIdentity, node_id: nodeId, instance_id: instanceId, input_ref: inputRef, runtime_ref: runtimeRef,
              before_ref: beforeRef, workspace_ref: null, mutating, status: result.status, result,
            };
          }
        }
        const installCompleted = () => {
          active.completed[instanceId] = structuredClone({
            ...result,
            _journal_identity: identity,
            _journal_pending: journalRecord,
            ...(pending ? { _workspace_pending: pending } : {}),
          });
          delete active.inflight[instanceId];
        };
        installCompleted();
        if (!checkpointFits({ reserve_bytes: KERNEL_CHECKPOINT_LIMITS.min_failure_headroom_bytes })) {
          const restored = await rollback();
          result = settled("failed", { code: restored.ok ? "kernel-result-capacity-exceeded" : restored.code,
            ...(observedUsage ? { usage: observedUsage } : {}) });
          workspaceRef = null;
          workspaceApplied = false;
          pending = null;
          journalRecord = {
            identity, base_identity: baseIdentity, node_id: nodeId, instance_id: instanceId, input_ref: inputRef, runtime_ref: runtimeRef,
            before_ref: beforeRef, workspace_ref: null, mutating, status: result.status, result,
          };
          installCompleted();
          if (!checkpointFits()) {
            delete active.completed[instanceId];
            active.inflight[instanceId] = { identity, base_identity: baseIdentity, mutating };
            if (observedUsage != null) budget.revertAccount(observedUsage);
            return settled("failed", { code: "kernel-checkpoint-capacity-exceeded" });
          }
        }
        const saved = await checkpoint();
        if (!saved.ok) {
          const restored = await rollback();
          delete active.completed[instanceId];
          active.inflight[instanceId] = { identity, base_identity: baseIdentity, mutating };
          if (observedUsage != null) budget.revertAccount(observedUsage);
          const recoverableRecord = !mutating && restored.ok
            ? journalRecord
            : (() => {
              const failure = settled("failed", { code: restored.ok ? saved.code : restored.code,
                ...(observedUsage ? { usage: observedUsage } : {}) });
              return { ...journalRecord, workspace_ref: null, status: failure.status, result: failure };
            })();
          const reconciled = journal.commit(recoverableRecord);
          return settled("failed", { code: reconciled.ok ? saved.code : reconciled.code });
        }
        const journaled = journal.commit(journalRecord);
        if (!journaled.ok) {
          if (typeof deps.onCheckpoint !== "function") {
            const restored = await rollback();
            delete active.completed[instanceId];
            return settled("failed", { code: restored.ok ? journaled.code : restored.code });
          }
          return settled("failed", { code: journaled.code });
        }
        delete active.completed[instanceId]._journal_pending;
        const journalCheckpoint = await checkpoint();
        if (!journalCheckpoint.ok) return settled("failed", { code: journalCheckpoint.code });
        emit("effect-end", { node_id: nodeId, instance_id: instanceId, effect_ref: identity, status: result.status, ...(result.code ? { code: result.code } : {}) });
        if (workspaceApplied) {
          let finalized;
          try { finalized = await deps.workspace.finalize(tx); }
          catch { finalized = null; }
          if (!finalized?.ok) return settled("failed", { code: safeCode(finalized?.code, "kernel-workspace-finalize-failed") });
          delete active.completed[instanceId]._workspace_pending;
          const finalizedCheckpoint = await checkpoint();
          if (!finalizedCheckpoint.ok) return settled("failed", { code: finalizedCheckpoint.code });
        }
      } else {
        emit("effect-end", { node_id: nodeId, instance_id: instanceId, effect_ref: identity, status: result.status, ...(result.code ? { code: result.code } : {}) });
      }
      return result;
    };
    return perform();
  };

  const executeWithRetry = async (agent, nodeId, instanceId, local = {}, firstReservation = null, firstCompleted = null, coordination = null, writerLocked = false) => {
    if (MUTATING.has(agent.mutation) && !writerLocked) {
      const prior = writerTail;
      let release;
      writerTail = new Promise((resolve) => { release = resolve; });
      await prior;
      try {
        return await executeWithRetry(agent, nodeId, instanceId, local, firstReservation, firstCompleted, coordination, true);
      } finally { release(); }
    }
    let ordinaryAttempt = 1;
    let repairAttempt = 0;
    let invocationAttempt = 1;
    while (ordinaryAttempt <= agent.retry.max_attempts) {
      const result = invocationAttempt === 1 && firstCompleted?.found
        ? firstCompleted.result
        : await executeOne(agent, nodeId, `${instanceId}:attempt-${invocationAttempt}`,
          { ...local, attempt: invocationAttempt, repair_attempt: repairAttempt }, invocationAttempt === 1 ? firstReservation : null, coordination);
      if (result.status === "failed" && result.failure_class === "agent"
        && result.code === "pi-agent-semantic-output-invalid"
        && repairAttempt < definition.limits.structured_repair_attempts) {
        repairAttempt += 1;
        invocationAttempt += 1;
        emit("effect-repair", { node_id: nodeId, instance_id: instanceId, repair_attempt: repairAttempt });
        continue;
      }
      if (result.status === "ok" || result.status === "cancelled" || result.status === "refused"
        || result.failure_class !== "agent"
        || ordinaryAttempt === agent.retry.max_attempts) {
        coordination?.stop?.(result);
        return result;
      }
      emit("effect-retry", { node_id: nodeId, instance_id: instanceId, attempt: ordinaryAttempt, next_attempt: ordinaryAttempt + 1 });
      if (agent.retry.backoff_ms > 0) {
        await new Promise((resolve) => {
          let timer;
          const finish = () => {
            if (timer) clearTimeout(timer);
            runController.signal.removeEventListener("abort", finish);
            resolve();
          };
          timer = setTimeout(finish, agent.retry.backoff_ms);
          runController.signal.addEventListener("abort", finish, { once: true });
        });
      }
      if (cancelled) {
        const stopped = interruption();
        const result = settled(stopped.status, { code: stopped.code });
        coordination?.stop?.(result);
        return result;
      }
      ordinaryAttempt += 1;
      invocationAttempt += 1;
    }
    const result = settled("failed", { code: "kernel-retry-state-invalid" });
    coordination?.stop?.(result);
    return result;
  };

  const prepareAgentExecution = async (agent, nodeId, instanceId, local = {}) => {
    let expanded = [agent];
    let isExpanded = false;
    if (typeof deps.expandAgent === "function") {
      try { expanded = await deps.expandAgent(agent, { definition_id: definition.id, node_id: nodeId, instance_id: instanceId, local: structuredClone(local) }); }
      catch { expanded = null; }
      isExpanded = true;
    }
    if (!Array.isArray(expanded) || expanded.length < 1 || expanded.length > 64
      || expanded.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry))) {
      return { ok: false, result: settled("refused", { code: "kernel-agent-expansion-invalid" }) };
    }
    const completed = [];
    for (let index = 0; index < expanded.length; index += 1) {
      const memberInstance = isExpanded ? `${instanceId}:member-${index}` : instanceId;
      const resumed = await resumeCompleted(nodeId, `${memberInstance}:attempt-1`);
      completed[index] = resumed;
    }
    return {
      ok: true,
      nodeId,
      instanceId,
      local,
      isExpanded,
      members: expanded.map((entry, index) => ({
        entry,
        index,
        completed: completed[index],
        instanceId: isExpanded ? `${instanceId}:member-${index}` : instanceId,
        reservation: null,
      })),
    };
  };
  const reservePrepared = (prepared) => {
    const pending = prepared.flatMap((item) => item.ok ? item.members.filter((member) => !member.completed.found) : []);
    if (pending.length === 0) return { ok: true };
    const reserved = budget.reserveBatch(pending.map(({ entry }) => ({
      tokens: entry.reserve_tokens ?? 0,
      cost_micros: entry.reserve_cost_micros ?? 0,
    })));
    if (!reserved.ok) return reserved;
    pending.forEach((member, index) => { member.reservation = reserved.reservations[index]; });
    return { ok: true };
  };
  const releasePrepared = (prepared) => {
    for (const member of prepared?.members ?? []) {
      if (member.reservation) budget.release(member.reservation.id);
    }
  };
  const executePrepared = async (prepared, _index = 0, coordination = null) => {
    if (!prepared.ok) return prepared.result;
    const concurrent = await mapConcurrent(prepared.members, Math.min(prepared.members.length, definition.limits.max_concurrency),
      (member) => executeWithRetry(member.entry, prepared.nodeId, member.instanceId,
        { ...prepared.local, ...(prepared.isExpanded ? { member_index: member.index } : {}) },
        member.reservation, member.completed, coordination));
    const results = concurrent.output;
    const failed = results.find((entry) => entry.status !== "ok");
    if (failed) return failed;
    if (results.length === 1) return results[0];
    const values = results.map((entry) => entry.value);
    const usage = checkedUsageTotal(results);
    if (usage == null) return settled("failed", { code: "kernel-agent-usage-overflow" });
    const combined = settled("ok", {
      value: {
        values,
        recommendation: strictRecommendation(results),
        uncertainty: values.flatMap((entry) => entry?.uncertainty ?? []),
        risks: values.flatMap((entry) => entry?.risks ?? []),
        proposed_actions: values.flatMap((entry) => entry?.proposed_actions ?? []),
        open_questions: values.flatMap((entry) => entry?.open_questions ?? []),
      },
      usage,
      attestation_ref: tryJournalRef(results.map((entry) => entry.attestation_ref ?? null)),
    });
    return combined.attestation_ref != null && tryJournalRef(combined) != null
      ? combined
      : settled("failed", { code: "kernel-agent-result-invalid" });
  };
  const executeAgentWithRetry = async (agent, nodeId, instanceId, local = {}) => {
    const prepared = await prepareAgentExecution(agent, nodeId, instanceId, local);
    const reserved = reservePrepared([prepared]);
    return reserved.ok ? executePrepared(prepared) : settled("refused", { code: reserved.code });
  };

  const allowedFailure = (result, codes = []) => result.status === "ok"
    || (result.status === "failed" && result.failure_class === "agent" && codes.includes(result.code));
  const runInlineList = async (agents, nodeId, { visit, concurrency = 1, failure = "abort", allow_failure_codes = [], local = {} } = {}) => {
    const prepared = [];
    for (let index = 0; index < agents.length; index += 1) {
      prepared.push(await prepareAgentExecution(agents[index], nodeId, `${nodeId}:${visit}:${index}`, { ...local, index }));
    }
    const reserved = reservePrepared(prepared);
    if (!reserved.ok) return { ok: false, status: "refused", code: reserved.code, values: [] };
    const hard = (entry) => entry.status !== "ok"
      && (failure === "abort" || !allowedFailure(entry, allow_failure_codes));
    const concurrent = await mapConcurrent(prepared, concurrency, executePrepared,
      failure === "abort" ? hard : null);
    for (let index = 0; index < prepared.length; index += 1) {
      if (!concurrent.started.has(index)) releasePrepared(prepared[index]);
    }
    const values = concurrent.output;
    const hardFailure = values.find((entry) => entry && entry.status !== "ok"
      && (failure === "abort" || !allowedFailure(entry, allow_failure_codes)));
    return hardFailure
      ? { ok: false, status: hardFailure.status, code: hardFailure.code ?? "kernel-child-failed", values }
      : { ok: true, values };
  };

  try {
    emit(resume ? "run-resume" : "run-start", { node_id: current, definition_ref: definitionRef });
    if (cancelled) {
      const stopped = interruption();
      return { ok: false, ...stopped, events, outputs, budget: budget.snapshot() };
    }
    const initialCheckpoint = await checkpoint();
    if (!initialCheckpoint.ok) return { ok: false, status: "failed", code: initialCheckpoint.code, events, outputs };
    while (!cancelled) {
      const node = definition.nodes[current];
      if (!node) return { ok: false, status: "refused", code: "kernel-node-missing", events, outputs };
      const continuing = active?.node_id === current && active.visit === visits[current];
      if (!continuing) {
        visits[current] += 1;
        active = { node_id: current, visit: visits[current], completed: {}, inflight: {} };
      }
      const maxVisits = node.max_visits ?? Math.min(
        WORKFLOW_LIMITS.max_implicit_node_visits,
        definition.limits.max_total_effects + Object.keys(definition.nodes).length,
      );
      if (visits[current] > maxVisits) return { ok: false, status: "refused", code: `kernel-node-visits-exhausted:${current}`, events, outputs };
      emit("node-start", { node_id: current, visit: visits[current] });
      if (!continuing) {
        const nodeCheckpoint = await checkpoint();
        if (!nodeCheckpoint.ok) return { ok: false, status: "failed", code: nodeCheckpoint.code, events, outputs };
      }
      let next = null;
      let nodeStatus = "ok";
      if (node.kind === "agent") {
        const result = await executeAgentWithRetry(node, current, `${current}:${visits[current]}`);
        if (result.status !== "ok") return { ok: false, status: result.status, code: result.code ?? "kernel-agent-failed", events, outputs, budget: budget.snapshot() };
        const artifact = await verifyNodeArtifact(node, current);
        if (!artifact.ok) return { ok: false, status: artifact.status, code: artifact.code, events, outputs, budget: budget.snapshot() };
        const agentOutput = artifact.artifact_ref ? { ...result, artifact_ref: artifact.artifact_ref } : result;
        if (!storeOutput(current, agentOutput)) return { ok: false, status: "failed", code: "kernel-output-capacity-exceeded", events, outputs, budget: budget.snapshot() };
        next = node.next;
      } else if (node.kind === "pipeline") {
        const values = [];
        let upstream = null;
        for (let index = 0; index < node.stages.length; index += 1) {
          const agent = node.stages[index];
          const result = await executeAgentWithRetry(agent, current, `${current}:${visits[current]}:${index}`, { upstream });
          values.push({ role: agent.role, ...result });
          if (result.status !== "ok") return { ok: false, status: result.status, code: result.code ?? "kernel-pipeline-failed", events, outputs, budget: budget.snapshot() };
          upstream = result.value;
        }
        const grouped = {};
        for (const value of values) (grouped[value.role] ??= []).push(value);
        const byRole = Object.fromEntries(Object.entries(grouped).map(([role, entries]) => [role, entries.length === 1
          ? entries[0].value
          : { values: entries.map(outputValue), recommendation: strictRecommendation(entries) }]));
        if (!storeOutput(current, { values: values.map(outputValue), by_role: byRole })) {
          return { ok: false, status: "failed", code: "kernel-output-capacity-exceeded", events, outputs, budget: budget.snapshot() };
        }
        if (node.artifact) {
          const artifact = await verifyNodeArtifact(node, current);
          if (!artifact.ok) return { ok: false, status: artifact.status, code: artifact.code, events, outputs, budget: budget.snapshot() };
          if (!storeOutput(current, { ...outputs[current], artifact_ref: artifact.artifact_ref })) {
            return { ok: false, status: "failed", code: "kernel-output-capacity-exceeded", events, outputs, budget: budget.snapshot() };
          }
        }
        next = node.next;
      } else if (node.kind === "parallel") {
        const result = await runInlineList(node.branches, current, {
          visit: visits[current],
          concurrency: Math.min(node.max_concurrency, definition.limits.max_concurrency),
          failure: node.failure,
          allow_failure_codes: node.allow_failure_codes ?? [],
        });
        if (!storeOutput(current, result.values)) return { ok: false, status: "failed", code: "kernel-output-capacity-exceeded", events, outputs, budget: budget.snapshot() };
        if (!result.ok) return { ok: false, status: result.status ?? "failed", code: result.code, events, outputs, budget: budget.snapshot() };
        next = node.next;
      } else if (node.kind === "map") {
        const resolved = resolveJsonPointer(context(), node.items_path);
        if (!resolved.found || !Array.isArray(resolved.value)) return { ok: false, status: "refused", code: "kernel-map-input-invalid", events, outputs };
        if (resolved.value.length > node.max_items || resolved.value.length > definition.limits.max_map_items) return { ok: false, status: "refused", code: "kernel-map-cardinality-exceeded", events, outputs };
        const prepared = [];
        for (let index = 0; index < resolved.value.length; index += 1) {
          prepared.push(await prepareAgentExecution(node.body, current, `${current}:${visits[current]}:${index}`, { item: resolved.value[index], index }));
        }
        const reserved = reservePrepared(prepared);
        if (!reserved.ok) return { ok: false, status: "refused", code: reserved.code, events, outputs, budget: budget.snapshot() };
        const hard = (entry) => entry.status !== "ok"
          && (node.failure === "abort" || !allowedFailure(entry, node.allow_failure_codes ?? []));
        const concurrent = await mapConcurrent(prepared, definition.limits.max_concurrency, executePrepared,
          node.failure === "abort" ? hard : null);
        for (let index = 0; index < prepared.length; index += 1) {
          if (!concurrent.started.has(index)) releasePrepared(prepared[index]);
        }
        const values = concurrent.output;
        const hardFailure = values.find((entry) => entry && entry.status !== "ok"
          && (node.failure === "abort" || !allowedFailure(entry, node.allow_failure_codes ?? [])));
        if (!storeOutput(current, values.map((entry, index) => ({ item: resolved.value[index], result: entry ?? null })))) {
          return { ok: false, status: "failed", code: "kernel-output-capacity-exceeded", events, outputs, budget: budget.snapshot() };
        }
        if (hardFailure) {
          return { ok: false, status: hardFailure.status, code: hardFailure.code ?? "kernel-child-failed", events, outputs, budget: budget.snapshot() };
        }
        next = node.next;
      } else if (node.kind === "reduce") {
        const resolved = resolveJsonPointer(context(), node.items_path);
        if (!resolved.found || !Array.isArray(resolved.value)) return { ok: false, status: "refused", code: "kernel-reduce-input-invalid", events, outputs };
        const reduced = node.strategy === "collect" ? structuredClone(resolved.value)
          : node.strategy === "count" ? resolved.value.length
            : resolved.value.map((value) => typeof value === "string" ? value : JSON.stringify(value)).join(node.separator);
        if (!storeOutput(current, reduced)) return { ok: false, status: "failed", code: "kernel-output-capacity-exceeded", events, outputs, budget: budget.snapshot() };
        next = node.next;
      } else if (node.kind === "decision") {
        const selected = node.transitions.find((entry) => evaluateCondition(entry.when, context()));
        const edge = selected ?? node.default;
        if (edge.loop === true && deps.loops === false) next = node.loops_off;
        else next = edge.target;
        if (!storeOutput(current, { selected: next })) return { ok: false, status: "failed", code: "kernel-output-capacity-exceeded", events, outputs, budget: budget.snapshot() };
      } else if (node.kind === "gate") {
        let result;
        const objective = node.final === true ? definition.objective_gate : node.gate;
        try { result = await runBoundary(() => deps.runGate(objective, { run_id: runId, node_id: current, definition_id: definition.id, final: node.final === true, cwd: deps.workspace?.cwd ?? deps.cwd, signal: runController.signal })); }
        catch { return { ok: false, status: "failed", code: "kernel-gate-effect-failed", events, outputs, budget: budget.snapshot() }; }
        if (cancelled) {
          const stopped = interruption();
          return { ok: false, ...stopped, events, outputs, budget: budget.snapshot() };
        }
        if (!result || typeof result !== "object" || Array.isArray(result)
          || !["pass", "fail"].includes(result.result)
          || (result.evidence_ref != null && !HASH.test(result.evidence_ref))) {
          return { ok: false, status: "failed", code: "kernel-gate-result-invalid", events, outputs, budget: budget.snapshot() };
        }
        const pass = result?.result === "pass";
        if (!storeOutput(current, { result: pass ? "pass" : "fail", evidence_ref: result?.evidence_ref ?? null, final: node.final === true })) {
          return { ok: false, status: "failed", code: "kernel-output-capacity-exceeded", events, outputs, budget: budget.snapshot() };
        }
        emit("gate", {
          node_id: current,
          result: pass ? "pass" : "fail",
          final: node.final === true,
          ...(result?.evidence_ref ? { evidence_ref: result.evidence_ref } : {}),
        });
        next = !pass && deps.loops === false && node.loops_off ? node.loops_off : (pass ? node.on_pass : node.on_fail);
      } else if (node.kind === "checkpoint") {
        let result;
        try {
          result = await runBoundary(() => deps.checkpoint?.({
            run_id: runId, node_id: current, visit: visits[current], reason: node.reason,
            outputs: structuredClone(outputs), signal: runController.signal,
          }));
        } catch {
          return { ok: false, status: "failed", code: "kernel-checkpoint-effect-failed", events, outputs, budget: budget.snapshot() };
        }
        if (cancelled) {
          const stopped = interruption();
          return { ok: false, ...stopped, events, outputs, budget: budget.snapshot() };
        }
        if (result?.continue !== true) {
          const pausedCheckpoint = await checkpoint();
          if (!pausedCheckpoint.ok) return { ok: false, status: "failed", code: pausedCheckpoint.code, events, outputs, budget: budget.snapshot() };
          return { ok: false, status: "paused", code: node.reason, node_id: current, events, outputs, budget: budget.snapshot() };
        }
        next = node.next;
      } else if (node.kind === "subworkflow") {
        if (typeof deps.resolveSubworkflow !== "function" || deps.depth >= 1) return { ok: false, status: "refused", code: "kernel-subworkflow-unavailable", events, outputs };
        let child;
        try { child = await runBoundary(() => deps.resolveSubworkflow(node.workflow_id, node.version)); }
        catch { return { ok: false, status: "failed", code: "kernel-subworkflow-resolution-failed", events, outputs, budget: budget.snapshot() }; }
        if (cancelled) {
          const stopped = interruption();
          return { ok: false, ...stopped, events, outputs, budget: budget.snapshot() };
        }
        if (child && !childInputSchemaAcceptsParent(definition.inputs, child.inputs)) {
          return { ok: false, status: "refused", code: "kernel-subworkflow-binding-invalid", events, outputs };
        }
        const childRunId = `${runId}.${current}.${visits[current]}`;
        const childResume = active?.child?.workflow_id === node.workflow_id
          && active.child.version === node.version && active.child.run_id === childRunId
          ? active.child.scheduler
          : null;
        let childBudget = null;
        if (child) {
          try {
            childBudget = createScopedBudgetLedger(budget, {
              max_effects: child.limits.max_total_effects,
              initial_effects: childResume?.budget.effects ?? 0,
              initial_tokens: childResume?.budget.tokens ?? 0,
              initial_cost_micros: childResume?.budget.cost_micros ?? 0,
            });
          } catch {
            return { ok: false, status: "refused", code: "kernel-budget-binding-invalid", events, outputs };
          }
        }
        const result = child ? await runWorkflowKernel(child, input, {
          ...deps,
          budget: childBudget,
          signal: runController.signal,
          depth: (deps.depth ?? 0) + 1,
          run_id: childRunId,
          resume: childResume,
          onCheckpoint: typeof deps.onCheckpoint === "function" ? async (scheduler) => {
            active.child = { workflow_id: node.workflow_id, version: node.version, run_id: childRunId, scheduler: structuredClone(scheduler) };
            return checkpoint();
          } : null,
          checkpoint: (context) => deps.checkpoint?.({ ...context, child_run_id: childRunId, parent_node_id: current }),
          onEvent: (event) => emit("subworkflow-event", {
            node_id: current,
            child_run_id: childRunId,
            child_seq: event.seq,
            child_kind: event.kind,
            ...(event.node_id ? { child_node_id: event.node_id } : {}),
            ...(event.status ? { child_status: event.status } : {}),
            ...(event.code ? { child_code: event.code } : {}),
          }),
        }) : null;
        if (!result?.ok) return { ok: false, status: result?.status ?? "refused", code: result?.code ?? "kernel-subworkflow-failed", events, outputs };
        delete active.child;
        if (!storeOutput(current, { status: result.status, terminal: result.terminal })) {
          return { ok: false, status: "failed", code: "kernel-output-capacity-exceeded", events, outputs, budget: budget.snapshot() };
        }
        next = node.next;
      } else {
        if (node.status === "succeeded"
          && (visits[finalGateId] < 1 || outputs[finalGateId]?.result !== "pass" || outputs[finalGateId]?.final !== true)) {
          emit("node-end", { node_id: current, status: "refused", code: "kernel-objective-gate-evidence-missing" });
          emit("run-end", { node_id: current, status: "refused", code: "kernel-objective-gate-evidence-missing" });
          active = null;
          const terminalCheckpoint = await checkpoint();
          if (!terminalCheckpoint.ok) return { ok: false, status: "failed", code: terminalCheckpoint.code, events, outputs };
          if (cancelled) {
            const stopped = interruption();
            return { ok: false, ...stopped, events, outputs, budget: budget.snapshot() };
          }
          return {
            ok: false,
            status: "refused",
            code: "kernel-objective-gate-evidence-missing",
            terminal: current,
            outputs,
            visits,
            events,
            budget: budget.snapshot(),
            journal: journal.records(),
            elapsed_ms: totalElapsed(),
          };
        }
        nodeStatus = node.status;
        emit("node-end", { node_id: current, status: nodeStatus });
        emit("run-end", { node_id: current, status: nodeStatus, ...(node.code ? { code: node.code } : {}) });
        active = null;
        const terminalCheckpoint = await checkpoint();
        if (!terminalCheckpoint.ok) return { ok: false, status: "failed", code: terminalCheckpoint.code, events, outputs };
        if (cancelled) {
          const stopped = interruption();
          return { ok: false, ...stopped, events, outputs, budget: budget.snapshot() };
        }
        return {
          ok: node.status === "succeeded",
          status: node.status,
          code: node.code ?? null,
          terminal: current,
          outputs,
          visits,
          events,
          budget: budget.snapshot(),
          journal: journal.records(),
          elapsed_ms: totalElapsed(),
        };
      }
      emit("node-end", { node_id: current, status: nodeStatus });
      emit("transition", { node_id: current, target: next });
      active = null;
      current = next;
      const transitionCheckpoint = await checkpoint();
      if (!transitionCheckpoint.ok) return { ok: false, status: "failed", code: transitionCheckpoint.code, events, outputs };
    }
    const stopped = interruption();
    return { ok: false, ...stopped, events, outputs, budget: budget.snapshot() };
  } finally {
    if (runTimer) clearTimeout(runTimer);
    deps.signal?.removeEventListener?.("abort", abort);
  }
}
