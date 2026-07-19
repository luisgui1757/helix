// Helix Workflow Kernel scheduler. It interprets only validated v4 nodes,
// delegates model/provider and workspace effects, and emits structural events.

import { createBudgetLedger } from "./budgets.mjs";
import { createEffectJournal, effectIdentity, journalRef, tryJournalRef } from "./journal.mjs";
import {
  childInputSchemaAcceptsParent,
  evaluateCondition,
  normalizeWorkflowInput,
  resolveJsonPointer,
  validateWorkflowDefinition,
  WORKFLOW_LIMITS,
  workflowDefinitionHash,
} from "../workflow/schema.mjs";
import { isRecoverableKernelFailure, validateKernelCheckpoint } from "./state.mjs";

const MUTATING = new Set(["shared-serialized", "isolated-proposal"]);
const FAILURE_CLASSES = new Set(["agent", "kernel"]);

function safeCode(value, fallback) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) && value.length <= 160 ? value : fallback;
}

function settled(status, extra = {}) {
  const result = { status, ...extra };
  if (status !== "ok" && !FAILURE_CLASSES.has(result.failure_class)) result.failure_class = "kernel";
  return result;
}

async function mapConcurrent(values, limit, task) {
  const output = new Array(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, Math.max(1, values.length)) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      output[index] = await task(values[index], index);
    }
  });
  await Promise.all(workers);
  return output;
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

export async function runWorkflowKernel(definition, input, deps = {}) {
  const validation = validateWorkflowDefinition(definition);
  if (!validation.valid) return { ok: false, status: "refused", code: "kernel-definition-invalid", errors: validation.errors };
  const inputValidation = normalizeWorkflowInput(definition.inputs, input);
  if (!inputValidation.valid) return { ok: false, status: "refused", code: "kernel-input-invalid", errors: inputValidation.errors };
  input = inputValidation.input;
  if (typeof deps.executeAgent !== "function" || typeof deps.runGate !== "function") {
    return { ok: false, status: "refused", code: "kernel-effects-missing" };
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
  }
  const events = [];
  let seq = resume?.event_seq ?? 0;
  const emit = (kind, fields = {}) => {
    const event = { schema_version: 1, seq: ++seq, run_id: runId, kind, ...fields };
    events.push(event);
    deps.onEvent?.(structuredClone(event));
  };
  const journal = deps.journal ?? createEffectJournal({
    root: deps.journal_root ?? null,
    run_id: deps.journal_root ? runId : null,
    verify_workspace: deps.workspace?.verifyRef,
    expected_records: resume?.journal_entries ?? null,
  });
  if (resume) {
    const suffix = journal.suffix(resume.journal_entries);
    if (!suffix.ok) return { ok: false, status: "refused", code: suffix.code };
    const pending = resume.schema_version === 2 ? pendingJournalIdentities(resume.active) : new Set();
    if (suffix.records.some((record) => !pending.has(record.identity))) {
      return { ok: false, status: "refused", code: "kernel-journal-checkpoint-drift" };
    }
  }
  const budget = deps.budget ?? createBudgetLedger({
    max_effects: definition.limits.max_total_effects,
    max_tokens: deps.max_tokens ?? null,
    max_cost_micros: deps.max_cost_micros ?? null,
    initial_effects: resume?.budget.effects ?? 0,
    initial_tokens: resume?.budget.tokens ?? 0,
    initial_cost_micros: resume?.budget.cost_micros ?? 0,
  });
  const outputs = resume ? structuredClone(resume.outputs) : {};
  const visits = resume ? structuredClone(resume.visits) : Object.fromEntries(Object.keys(definition.nodes).map((id) => [id, 0]));
  const startedAt = deps.now?.() ?? Date.now();
  const priorElapsed = resume?.schema_version === 2 ? resume.elapsed_ms : 0;
  const totalElapsed = () => priorElapsed + Math.max(0, (deps.now?.() ?? Date.now()) - startedAt);
  let current = resume?.current ?? definition.start;
  let active = resume?.active ? structuredClone(resume.active) : null;
  if (active && !Object.hasOwn(active, "inflight")) active.inflight = {};
  let checkpointTail = Promise.resolve({ ok: true });
  let writerTail = Promise.resolve();
  let cancelled = false;
  const runController = new AbortController();
  const abort = () => {
    cancelled = true;
    if (!runController.signal.aborted) runController.abort(deps.signal?.reason ?? "kernel-run-cancelled");
  };
  if (deps.signal?.aborted) abort();
  else deps.signal?.addEventListener?.("abort", abort, { once: true });
  const remainingRunMs = definition.limits.max_run_ms - priorElapsed;
  const runTimer = remainingRunMs > 0 ? setTimeout(abort, remainingRunMs) : null;
  if (remainingRunMs <= 0) abort();
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
  const checkpoint = async () => {
    if (typeof deps.onCheckpoint !== "function") return { ok: true };
    const task = async () => {
      let workspaceRef;
      try { workspaceRef = deps.workspace?.currentRef?.(); } catch { workspaceRef = null; }
      if (!/^sha256:[0-9a-f]{64}$/.test(workspaceRef ?? "")) return { ok: false, code: "kernel-checkpoint-workspace-invalid" };
      const snapshot = {
        schema_version: 2,
        run_id: runId,
        definition_ref: definitionRef,
        runtime_ref: runtimeRef,
        task_ref: deps.task_ref,
        current,
        outputs: structuredClone(outputs),
        visits: structuredClone(visits),
        active: active == null ? null : structuredClone(active),
        event_seq: seq,
        journal_entries: journal.records().length,
        budget: budget.snapshot(),
        workspace_ref: workspaceRef,
        elapsed_ms: totalElapsed(),
      };
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

  const resumeCompleted = async (nodeId, instanceId) => {
    if (active?.node_id === nodeId && Object.hasOwn(active.inflight, instanceId)) {
      const intent = active.inflight[instanceId];
      const record = journal.find(intent.identity, { mutating: intent.mutating });
      if (!record || (record.status === "ok" && intent.mutating && journal.lookup(intent.identity, { mutating: true }) == null)) {
        return { found: true, result: settled("failed", { code: "kernel-effect-outcome-unknown" }) };
      }
      delete active.inflight[instanceId];
      if (isRecoverableKernelFailure(record.result?.code)) {
        const saved = await checkpoint();
        return saved.ok
          ? { found: false, result: null }
          : { found: true, result: settled("failed", { code: saved.code }) };
      }
      active.completed[instanceId] = structuredClone(record.result);
      const saved = await checkpoint();
      if (!saved.ok) return { found: true, result: settled("failed", { code: saved.code }) };
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
        try { finalized = await deps.workspace?.finalize?.(resumed._workspace_pending) ?? { ok: true }; }
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

  const executeOne = async (agent, nodeId, instanceId, local = {}, preReservation = null) => {
    const resumed = await resumeCompleted(nodeId, instanceId);
    if (resumed.found) {
      if (preReservation) budget.release(preReservation.id);
      return resumed.result;
    }
    const mutating = MUTATING.has(agent.mutation);
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
      tokens: Number.isSafeInteger(agent.reserve_tokens) ? agent.reserve_tokens : 0,
      cost_micros: Number.isSafeInteger(agent.reserve_cost_micros) ? agent.reserve_cost_micros : 0,
    });
    if (!reservation.ok) return settled("refused", { code: reservation.code });
    const perform = async () => {
      if (cancelled) {
        budget.release(reservation.id);
        return settled("cancelled", { code: "kernel-run-cancelled" });
      }
      let tx = null;
      if (mutating) {
        try { tx = await deps.workspace?.begin?.({ node_id: nodeId, instance_id: instanceId, mode: agent.mutation, before_ref: beforeRef }) ?? { before_ref: beforeRef }; }
        catch {
          budget.release(reservation.id);
          return settled("failed", { code: "kernel-workspace-begin-failed" });
        }
        if (tx?.ok === false) {
          budget.release(reservation.id);
          return settled("refused", { code: safeCode(tx.code, "kernel-workspace-begin-failed") });
        }
      }
      const consumed = budget.consume(reservation.id);
      if (!consumed.ok) {
        let restored = { ok: true };
        if (mutating && tx) {
          try { restored = await deps.workspace?.rollback?.(tx) ?? { ok: true }; }
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
          try { restored = await deps.workspace?.rollback?.(tx) ?? { ok: true }; }
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
      try {
        raw = await Promise.race([
          Promise.resolve(deps.executeAgent(agent, {
            run_id: runId, node_id: nodeId, instance_id: instanceId, task: input.task,
            definition_id: definition.id,
            input: structuredClone(input), outputs: structuredClone(outputs), local: structuredClone(local),
            cwd: tx?.cwd ?? deps.workspace?.cwd ?? deps.cwd, signal: controller.signal,
          })),
          new Promise((resolve) => controller.signal.addEventListener("abort", () => resolve({ ok: false, code: controller.signal.reason }), { once: true })),
        ]);
      } catch { raw = { ok: false, code: "kernel-agent-effect-failed" }; }
      clearTimeout(timer);
      deps.signal?.removeEventListener?.("abort", cancel);
      runController.signal.removeEventListener("abort", cancel);
      let result;
      if (raw?.ok === true) {
        try {
          result = settled("ok", {
            value: structuredClone(raw.value),
            usage: structuredClone(raw.usage ?? { tokens: 0, cost_micros: 0 }),
            attestation_ref: raw.attestation_ref ?? null,
          });
        } catch {
          result = settled("failed", { code: "kernel-agent-result-invalid" });
        }
        if (result.status === "ok" && tryJournalRef(result) == null) {
          result = settled("failed", { code: "kernel-agent-result-invalid" });
        }
      } else result = settled(raw?.code === "kernel-effect-cancelled" || raw?.code === "kernel-run-cancelled" ? "cancelled" : "failed", {
          code: safeCode(raw?.code, "kernel-agent-effect-failed"),
          failure_class: raw?.failure_class === "agent" ? "agent" : "kernel",
        });
      let workspaceRef = null;
      let workspaceApplied = false;
      let workspaceRecoveryFailed = false;
      const rollback = async () => {
        if (!mutating || !tx) return { ok: true };
        let restored;
        try { restored = await deps.workspace?.rollback?.(tx) ?? { ok: true }; }
        catch { restored = null; }
        workspaceApplied = false;
        workspaceRef = null;
        if (restored?.ok) return { ok: true };
        workspaceRecoveryFailed = true;
        return { ok: false, code: safeCode(restored?.code, "kernel-workspace-restore-failed") };
      };
      if (mutating) {
        if (result.status === "ok") {
          let committed;
          try { committed = await deps.workspace?.commit?.(tx, result) ?? { ok: true, workspace_ref: journalRef({ before_ref: beforeRef, identity }) }; }
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
      const usage = result.usage ?? { tokens: 0, cost_micros: 0 };
      const accounted = budget.account({
        tokens: Number.isSafeInteger(usage.tokens) ? usage.tokens : 0,
        cost_micros: Number.isSafeInteger(usage.cost_micros) ? usage.cost_micros : 0,
      });
      if (!accounted.ok && result.status === "ok") {
        result = settled("failed", { code: accounted.code });
        const restored = await rollback();
        if (!restored.ok) result = settled("failed", { code: restored.code });
      }
      if (workspaceRecoveryFailed) {
        emit("effect-end", { node_id: nodeId, instance_id: instanceId, effect_ref: identity, status: "failed", code: "kernel-workspace-restore-failed" });
        return settled("failed", { code: "kernel-workspace-restore-failed" });
      }
      const journalRecord = {
        identity, base_identity: baseIdentity, node_id: nodeId, instance_id: instanceId, input_ref: inputRef, runtime_ref: runtimeRef,
        before_ref: beforeRef, workspace_ref: workspaceRef, mutating, status: result.status, result,
      };
      if (active?.node_id === nodeId) {
        const pending = workspaceApplied ? deps.workspace?.serialize?.(tx) ?? null : null;
        active.completed[instanceId] = structuredClone({
          ...result,
          _journal_pending: journalRecord,
          ...(pending ? { _workspace_pending: pending } : {}),
        });
        delete active.inflight[instanceId];
        const saved = await checkpoint();
        if (!saved.ok) {
          const restored = await rollback();
          delete active.completed[instanceId];
          active.inflight[instanceId] = { identity, base_identity: baseIdentity, mutating };
          const recoverableRecord = !mutating && restored.ok
            ? journalRecord
            : (() => {
              const failure = settled("failed", { code: restored.ok ? saved.code : restored.code });
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
          try { finalized = await deps.workspace?.finalize?.(tx) ?? { ok: true }; }
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
    if (!mutating) return perform();
    const prior = writerTail;
    let release;
    writerTail = new Promise((resolve) => { release = resolve; });
    await prior;
    try { return await perform(); } finally { release(); }
  };

  const executeWithRetry = async (agent, nodeId, instanceId, local = {}, firstReservation = null, firstCompleted = null) => {
    for (let attempt = 1; attempt <= agent.retry.max_attempts; attempt += 1) {
      const result = attempt === 1 && firstCompleted?.found
        ? firstCompleted.result
        : await executeOne(agent, nodeId, `${instanceId}:attempt-${attempt}`, { ...local, attempt }, attempt === 1 ? firstReservation : null);
      if (result.status === "ok" || result.status === "cancelled" || result.status === "refused"
        || result.failure_class !== "agent"
        || attempt === agent.retry.max_attempts) return result;
      emit("effect-retry", { node_id: nodeId, instance_id: instanceId, attempt, next_attempt: attempt + 1 });
      if (agent.retry.backoff_ms > 0) {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, agent.retry.backoff_ms);
          runController.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
        });
      }
      if (cancelled) return settled("cancelled", { code: "kernel-run-cancelled" });
    }
    return settled("failed", { code: "kernel-retry-state-invalid" });
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
      tokens: Number.isSafeInteger(entry.reserve_tokens) ? entry.reserve_tokens : 0,
      cost_micros: Number.isSafeInteger(entry.reserve_cost_micros) ? entry.reserve_cost_micros : 0,
    })));
    if (!reserved.ok) return reserved;
    pending.forEach((member, index) => { member.reservation = reserved.reservations[index]; });
    return { ok: true };
  };
  const executePrepared = async (prepared) => {
    if (!prepared.ok) return prepared.result;
    const results = await mapConcurrent(prepared.members, Math.min(prepared.members.length, definition.limits.max_concurrency),
      (member) => executeWithRetry(member.entry, prepared.nodeId, member.instanceId,
        { ...prepared.local, ...(prepared.isExpanded ? { member_index: member.index } : {}) },
        member.reservation, member.completed));
    const failed = results.find((entry) => entry.status !== "ok");
    if (failed) return failed;
    if (results.length === 1) return results[0];
    const values = results.map((entry) => entry.value);
    const combined = settled("ok", {
      value: {
        values,
        recommendation: strictRecommendation(results),
        uncertainty: values.flatMap((entry) => entry?.uncertainty ?? []),
        risks: values.flatMap((entry) => entry?.risks ?? []),
        proposed_actions: values.flatMap((entry) => entry?.proposed_actions ?? []),
        open_questions: values.flatMap((entry) => entry?.open_questions ?? []),
      },
      usage: {
        tokens: results.reduce((sum, entry) => sum + (entry.usage?.tokens ?? 0), 0),
        cost_micros: results.reduce((sum, entry) => sum + (entry.usage?.cost_micros ?? 0), 0),
      },
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
  const runInlineList = async (agents, nodeId, { concurrency = 1, failure = "abort", allow_failure_codes = [], local = {} } = {}) => {
    const prepared = [];
    for (let index = 0; index < agents.length; index += 1) {
      prepared.push(await prepareAgentExecution(agents[index], nodeId, `${nodeId}:${index}`, { ...local, index }));
    }
    const reserved = reservePrepared(prepared);
    if (!reserved.ok) return { ok: false, status: "refused", code: reserved.code, values: [] };
    const values = await mapConcurrent(prepared, concurrency, executePrepared);
    const hardFailure = values.find((entry) => entry.status !== "ok"
      && (failure === "abort" || !allowedFailure(entry, allow_failure_codes)));
    return hardFailure
      ? { ok: false, status: hardFailure.status, code: hardFailure.code ?? "kernel-child-failed", values }
      : { ok: true, values };
  };

  emit(resume ? "run-resume" : "run-start", { node_id: current, definition_ref: definitionRef });
  try {
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
        outputs[current] = result;
        if (result.status !== "ok") return { ok: false, status: result.status, code: result.code ?? "kernel-agent-failed", events, outputs, budget: budget.snapshot() };
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
        outputs[current] = { values: values.map(outputValue), by_role: byRole };
        if (node.artifact && typeof deps.verifyArtifact === "function") {
          const artifact = await runBoundary(() => deps.verifyArtifact(node.artifact, {
            run_id: runId, node_id: current, definition_id: definition.id, cwd: deps.workspace?.cwd ?? deps.cwd,
            signal: runController.signal,
          }));
          if (cancelled) return { ok: false, status: "cancelled", code: "kernel-run-cancelled", events, outputs, budget: budget.snapshot() };
          if (!artifact?.ok) return { ok: false, status: "failed", code: safeCode(artifact?.code, "kernel-artifact-invalid"), events, outputs, budget: budget.snapshot() };
          outputs[current].artifact_ref = artifact.ref ?? null;
        }
        next = node.next;
      } else if (node.kind === "parallel") {
        const result = await runInlineList(node.branches, current, {
          concurrency: Math.min(node.max_concurrency, definition.limits.max_concurrency),
          failure: node.failure,
          allow_failure_codes: node.allow_failure_codes ?? [],
        });
        outputs[current] = result.values;
        if (!result.ok) return { ok: false, status: result.status ?? "failed", code: result.code, events, outputs, budget: budget.snapshot() };
        next = node.next;
      } else if (node.kind === "map") {
        const resolved = resolveJsonPointer(context(), node.items_path);
        if (!resolved.found || !Array.isArray(resolved.value)) return { ok: false, status: "refused", code: "kernel-map-input-invalid", events, outputs };
        if (resolved.value.length > node.max_items || resolved.value.length > definition.limits.max_map_items) return { ok: false, status: "refused", code: "kernel-map-cardinality-exceeded", events, outputs };
        const prepared = [];
        for (let index = 0; index < resolved.value.length; index += 1) {
          prepared.push(await prepareAgentExecution(node.body, current, `${current}:${index}`, { item: resolved.value[index], index }));
        }
        const reserved = reservePrepared(prepared);
        if (!reserved.ok) return { ok: false, status: "refused", code: reserved.code, events, outputs, budget: budget.snapshot() };
        const values = await mapConcurrent(prepared, definition.limits.max_concurrency, executePrepared);
        const hardFailure = values.find((entry) => entry.status !== "ok"
          && (node.failure === "abort" || !allowedFailure(entry, node.allow_failure_codes ?? [])));
        outputs[current] = values.map((entry, index) => ({ item: resolved.value[index], result: entry }));
        if (hardFailure) {
          return { ok: false, status: hardFailure.status, code: hardFailure.code ?? "kernel-child-failed", events, outputs, budget: budget.snapshot() };
        }
        next = node.next;
      } else if (node.kind === "reduce") {
        const resolved = resolveJsonPointer(context(), node.items_path);
        if (!resolved.found || !Array.isArray(resolved.value)) return { ok: false, status: "refused", code: "kernel-reduce-input-invalid", events, outputs };
        if (node.strategy === "collect") outputs[current] = structuredClone(resolved.value);
        else if (node.strategy === "count") outputs[current] = resolved.value.length;
        else outputs[current] = resolved.value.map((value) => typeof value === "string" ? value : JSON.stringify(value)).join(node.separator);
        next = node.next;
      } else if (node.kind === "decision") {
        const selected = node.transitions.find((entry) => evaluateCondition(entry.when, context()));
        const edge = selected ?? node.default;
        if (edge.loop === true && deps.loops === false) next = node.loops_off;
        else next = edge.target;
        outputs[current] = { selected: next };
      } else if (node.kind === "gate") {
        let result;
        const objective = node.final === true ? definition.objective_gate : node.gate;
        try { result = await runBoundary(() => deps.runGate(objective, { run_id: runId, node_id: current, definition_id: definition.id, final: node.final === true, cwd: deps.workspace?.cwd ?? deps.cwd, signal: runController.signal })); }
        catch { result = null; }
        if (cancelled) return { ok: false, status: "cancelled", code: "kernel-run-cancelled", events, outputs, budget: budget.snapshot() };
        const pass = result?.result === "pass";
        outputs[current] = { result: pass ? "pass" : "fail", evidence_ref: result?.evidence_ref ?? null, final: node.final === true };
        emit("gate", {
          node_id: current,
          result: pass ? "pass" : "fail",
          final: node.final === true,
          ...(result?.evidence_ref ? { evidence_ref: result.evidence_ref } : {}),
        });
        next = !pass && deps.loops === false && node.loops_off ? node.loops_off : (pass ? node.on_pass : node.on_fail);
      } else if (node.kind === "checkpoint") {
        const result = await runBoundary(() => deps.checkpoint?.({
          run_id: runId, node_id: current, visit: visits[current], reason: node.reason,
          outputs: structuredClone(outputs), signal: runController.signal,
        }));
        if (cancelled) return { ok: false, status: "cancelled", code: "kernel-run-cancelled", events, outputs, budget: budget.snapshot() };
        if (result?.continue !== true) {
          const pausedCheckpoint = await checkpoint();
          if (!pausedCheckpoint.ok) return { ok: false, status: "failed", code: pausedCheckpoint.code, events, outputs, budget: budget.snapshot() };
          return { ok: false, status: "paused", code: node.reason, node_id: current, events, outputs, budget: budget.snapshot() };
        }
        next = node.next;
      } else if (node.kind === "subworkflow") {
        if (typeof deps.resolveSubworkflow !== "function" || deps.depth >= 1) return { ok: false, status: "refused", code: "kernel-subworkflow-unavailable", events, outputs };
        const child = await runBoundary(() => deps.resolveSubworkflow(node.workflow_id, node.version));
        if (cancelled) return { ok: false, status: "cancelled", code: "kernel-run-cancelled", events, outputs, budget: budget.snapshot() };
        if (child && !childInputSchemaAcceptsParent(definition.inputs, child.inputs)) {
          return { ok: false, status: "refused", code: "kernel-subworkflow-binding-invalid", events, outputs };
        }
        const childRunId = `${runId}.${current}`;
        const childResume = active?.child?.workflow_id === node.workflow_id
          && active.child.version === node.version && active.child.run_id === childRunId
          ? active.child.scheduler
          : null;
        const result = child ? await runWorkflowKernel(child, input, {
          ...deps,
          budget,
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
        outputs[current] = { status: result.status, terminal: result.terminal };
        next = node.next;
      } else {
        if (node.status === "succeeded"
          && (visits[finalGateId] < 1 || outputs[finalGateId]?.result !== "pass" || outputs[finalGateId]?.final !== true)) {
          emit("node-end", { node_id: current, status: "refused", code: "kernel-objective-gate-evidence-missing" });
          emit("run-end", { node_id: current, status: "refused", code: "kernel-objective-gate-evidence-missing" });
          active = null;
          const terminalCheckpoint = await checkpoint();
          if (!terminalCheckpoint.ok) return { ok: false, status: "failed", code: terminalCheckpoint.code, events, outputs };
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
    return { ok: false, status: "cancelled", code: deps.signal?.reason ?? "kernel-run-cancelled", events, outputs, budget: budget.snapshot() };
  } finally {
    if (runTimer) clearTimeout(runTimer);
    deps.signal?.removeEventListener?.("abort", abort);
  }
}
