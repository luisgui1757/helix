// Public-safe planned and observed graph projections. Stable node ids join the
// two views; prompts, tasks, provider payloads, and account ids never render.

import { validateWorkflowDefinition, workflowDefinitionHash } from "./schema.mjs";
import {
  compileWorkflowGraph,
  DEFAULT_WORKFLOW_EXECUTION_MODE,
  projectPublicWorkflowGraph,
  stronglyConnectedWorkflowComponents,
  validateWorkflowExecutionMode,
} from "./graph.mjs";

const HASH = /^sha256:[0-9a-f]{64}$/;
const EVENT_KINDS = new Set([
  "run-start", "run-resume", "run-end", "node-start", "node-end", "transition", "gate",
  "effect-plan", "effect-start", "effect-end", "effect-resumed", "effect-recovered", "effect-cache-hit", "effect-repair", "effect-retry",
  "subworkflow-event",
]);
const NODE_STATUSES = new Set(["ok", "succeeded", "failed", "refused", "cancelled"]);
const EFFECT_STATUSES = new Set(["ok", "failed", "refused", "cancelled"]);
const CODE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const BASE_EVENT_FIELDS = Object.freeze(["schema_version", "seq", "run_id", "kind", "node_id"]);
const CHILD_WRAPPER_FIELDS = Object.freeze([
  "child_run_id", "child_workflow_id", "child_workflow_version", "child_seq", "child_kind", "child_node_id",
]);
const LEGACY_CHILD_WRAPPER_FIELDS = Object.freeze(["child_run_id", "child_seq", "child_kind"]);
const LEGACY_CHILD_OPTIONAL_FIELDS = Object.freeze(["child_node_id", "child_status", "child_code"]);

function plain(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

function exactFields(value, required, optional = []) {
  if (!plain(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((field) => Object.hasOwn(value, field))
    && Object.keys(value).every((field) => allowed.has(field));
}

function eventMode(event) {
  if (event.execution_mode == null) return DEFAULT_WORKFLOW_EXECUTION_MODE;
  const checked = validateWorkflowExecutionMode(event.execution_mode);
  return checked.ok ? checked.mode : null;
}

function eventFields(kind, mode, { legacy = false } = {}) {
  if (["run-start", "run-resume"].includes(kind)) {
    return { required: ["definition_ref", ...(mode === "graph-mode" ? ["execution_mode"] : [])], optional: [] };
  }
  if (kind === "run-end" || kind === "node-end") return { required: ["status"], optional: ["code"] };
  if (kind === "node-start") return { required: ["visit"], optional: [] };
  if (kind === "effect-plan") return legacy ? null : { required: ["slot_count"], optional: [] };
  if (kind === "transition") return {
    required: ["target", ...(mode === "graph-mode" ? ["edge_id", "edge_kind"] : [])],
    optional: mode === "graph-mode" ? [] : ["edge_id", "edge_kind"],
  };
  if (kind === "gate") return { required: ["result", "final"], optional: ["evidence_ref"] };
  if (["effect-start", "effect-cache-hit"].includes(kind)) {
    return { required: ["instance_id", "effect_ref"], optional: [] };
  }
  if (kind === "effect-end") {
    return { required: ["instance_id", "effect_ref", "status"], optional: ["code", "failure_class"] };
  }
  if (kind === "effect-resumed") return legacy
    ? { required: ["instance_id"], optional: [] }
    : { required: ["instance_id", "effect_ref", "status"], optional: ["code", "failure_class"] };
  if (kind === "effect-recovered") return legacy
    ? null
    : { required: ["instance_id", "effect_ref", "status"], optional: ["code", "failure_class"] };
  if (kind === "effect-repair") return {
    required: ["instance_id", "repair_attempt", ...(legacy ? [] : ["prior_instance_id"])], optional: [],
  };
  if (kind === "effect-retry") return {
    required: ["instance_id", "attempt", "next_attempt", ...(legacy ? [] : ["prior_instance_id"])], optional: [],
  };
  return null;
}

function validIdentifier(value, maximum = 256) {
  return typeof value === "string" && value.length >= 1 && value.length <= maximum;
}

function validCode(value) {
  return validIdentifier(value, 160) && CODE.test(value);
}

function validKnownEvent(event, nodeIds, mode, definitionRef = null, {
  allowSubworkflow = true,
  legacyChildEvents = false,
} = {}) {
  if (!plain(event) || !EVENT_KINDS.has(event.kind) || event.schema_version !== 1
    || !positiveInteger(event.seq) || !validIdentifier(event.run_id)
    || !validIdentifier(event.node_id) || (nodeIds instanceof Set && !nodeIds.has(event.node_id))) return false;
  if (event.kind === "subworkflow-event") {
    if (legacyChildEvents) {
      return allowSubworkflow && mode === DEFAULT_WORKFLOW_EXECUTION_MODE
        && exactFields(event, [...BASE_EVENT_FIELDS, ...LEGACY_CHILD_WRAPPER_FIELDS], LEGACY_CHILD_OPTIONAL_FIELDS)
        && validIdentifier(event.child_run_id) && positiveInteger(event.child_seq)
        && EVENT_KINDS.has(event.child_kind) && event.child_kind !== "subworkflow-event"
        && (event.child_node_id == null || validIdentifier(event.child_node_id))
        && (event.child_status == null || NODE_STATUSES.has(event.child_status))
        && (event.child_code == null || validCode(event.child_code));
    }
    if (!allowSubworkflow || !validIdentifier(event.child_run_id)
      || !validIdentifier(event.child_workflow_id) || !positiveInteger(event.child_workflow_version)
      || !positiveInteger(event.child_seq) || !EVENT_KINDS.has(event.child_kind)
      || event.child_kind === "subworkflow-event" || !validIdentifier(event.child_node_id)) return false;
    const shape = eventFields(event.child_kind, mode);
    if (shape == null) return false;
    const required = [
      ...BASE_EVENT_FIELDS, ...CHILD_WRAPPER_FIELDS,
      ...shape.required.map((field) => `child_${field}`),
    ];
    const optional = shape.optional.map((field) => `child_${field}`);
    return exactFields(event, required, optional)
      && validKnownEvent(childEvent(event), null, mode, null, { allowSubworkflow: false });
  }
  const shape = eventFields(event.kind, mode, { legacy: legacyChildEvents });
  if (shape == null || !exactFields(event, [...BASE_EVENT_FIELDS, ...shape.required], shape.optional)) return false;
  if (["run-start", "run-resume"].includes(event.kind)) {
    return HASH.test(event.definition_ref ?? "")
      && (definitionRef == null || event.definition_ref === definitionRef)
      && eventMode(event) === mode
      && (mode !== "graph-mode" || event.execution_mode === "graph-mode");
  }
  if (event.kind === "run-end") return NODE_STATUSES.has(event.status) && (event.code == null || validCode(event.code));
  if (event.kind === "node-start") return positiveInteger(event.visit);
  if (event.kind === "effect-plan") return Number.isSafeInteger(event.slot_count) && event.slot_count >= 0;
  if (event.kind === "node-end") return NODE_STATUSES.has(event.status) && (event.code == null || validCode(event.code));
  if (event.kind === "transition") {
    if (!validIdentifier(event.target) || (nodeIds instanceof Set && !nodeIds.has(event.target))) return false;
    const hasEdgeId = event.edge_id != null;
    const hasEdgeKind = event.edge_kind != null;
    return mode === "graph-mode"
      ? validIdentifier(event.edge_id) && validIdentifier(event.edge_kind)
      : hasEdgeId === hasEdgeKind && (!hasEdgeId
        || (validIdentifier(event.edge_id) && validIdentifier(event.edge_kind)));
  }
  if (event.kind === "gate") {
    return ["pass", "fail"].includes(event.result) && typeof event.final === "boolean"
      && (event.evidence_ref == null || HASH.test(event.evidence_ref));
  }
  if (["effect-start", "effect-cache-hit"].includes(event.kind)) {
    return validIdentifier(event.instance_id) && HASH.test(event.effect_ref ?? "");
  }
  if (event.kind === "effect-end") {
    return validIdentifier(event.instance_id) && HASH.test(event.effect_ref ?? "")
      && EFFECT_STATUSES.has(event.status) && (event.code == null || validCode(event.code))
      && (event.failure_class == null || ["agent", "kernel"].includes(event.failure_class))
      && (legacyChildEvents || (event.status === "ok"
        ? event.failure_class == null && event.code == null
        : event.failure_class != null && event.code != null));
  }
  if (["effect-resumed", "effect-recovered"].includes(event.kind)) {
    if (!validIdentifier(event.instance_id)) return false;
    if (legacyChildEvents) return event.kind === "effect-resumed";
    return HASH.test(event.effect_ref ?? "") && EFFECT_STATUSES.has(event.status)
      && (event.code == null || validCode(event.code))
      && (event.failure_class == null || ["agent", "kernel"].includes(event.failure_class))
      && (event.status === "ok"
        ? event.failure_class == null && event.code == null
        : event.failure_class != null && event.code != null);
  }
  if (event.kind === "effect-repair") {
    return validIdentifier(event.instance_id) && positiveInteger(event.repair_attempt)
      && (legacyChildEvents || validIdentifier(event.prior_instance_id));
  }
  if (event.kind === "effect-retry") {
    return validIdentifier(event.instance_id) && positiveInteger(event.attempt)
      && event.next_attempt === event.attempt + 1
      && (legacyChildEvents || validIdentifier(event.prior_instance_id));
  }
  return false;
}

function childEvent(event) {
  const projected = {
    schema_version: 1,
    seq: event.child_seq,
    run_id: event.child_run_id,
    kind: event.child_kind,
    ...(event.child_node_id ? { node_id: event.child_node_id } : {}),
  };
  const fields = [
    "definition_ref", "execution_mode", "target", "edge_id", "edge_kind", "visit", "instance_id",
    "effect_ref", "slot_count", "result", "final", "evidence_ref", "repair_attempt", "attempt", "next_attempt",
    "prior_instance_id", "status", "code", "failure_class",
  ];
  for (const field of fields) {
    const childField = `child_${field}`;
    if (Object.hasOwn(event, childField)) projected[field] = event[childField];
  }
  return projected;
}

function effectPolicy(definition, nodeId, visit, instanceId, { attempt = false } = {}) {
  if (!validIdentifier(instanceId)) return null;
  let baseId = instanceId;
  let attemptNumber = null;
  if (attempt) {
    const matched = instanceId.match(/^(.*):attempt-([1-9][0-9]*)$/);
    if (!matched || !Number.isSafeInteger(Number(matched[2]))) return null;
    [, baseId] = matched;
    attemptNumber = Number(matched[2]);
  }
  let coreId = baseId;
  const member = baseId.match(/^(.*):member-(0|[1-9][0-9]*)$/);
  if (member) {
    if (!Number.isSafeInteger(Number(member[2])) || Number(member[2]) >= 64) return null;
    coreId = member[1];
  }
  const parts = coreId.split(":");
  if (parts[0] !== nodeId || parts[1] !== String(visit) || !positiveInteger(Number(parts[1]))) return null;
  const node = definition.nodes[nodeId];
  let agent = null;
  if (node?.kind === "agent" && parts.length === 2) agent = node;
  if (["pipeline", "parallel"].includes(node?.kind) && parts.length === 3) {
    const index = Number(parts[2]);
    const agents = node.kind === "pipeline" ? node.stages : node.branches;
    if (parts[2] === String(index) && Number.isSafeInteger(index) && index >= 0 && index < agents.length) agent = agents[index];
  }
  if (node?.kind === "map" && parts.length === 3) {
    const index = Number(parts[2]);
    if (parts[2] === String(index) && Number.isSafeInteger(index) && index >= 0 && index < node.max_items) agent = node.body;
  }
  if (agent == null) return null;
  return { base_id: baseId, core_id: coreId, attempt: attemptNumber, max_attempts: agent.retry.max_attempts };
}

function effectAttemptCanStart(policy, invocationCounts, completedEffects) {
  if (!policy || policy.attempt !== (invocationCounts.get(policy.base_id) ?? 0) + 1) return false;
  if (policy.attempt === 1) return true;
  const prior = completedEffects.get(`${policy.base_id}:attempt-${policy.attempt - 1}`);
  return prior?.controlled === true;
}

function allowedNodeOutcome(node, outcome) {
  if (outcome?.status === "ok") return true;
  return ["parallel", "map"].includes(node.kind)
    && node.failure === "settle"
    && outcome?.status === "failed"
    && outcome.failure_class === "agent"
    && node.allow_failure_codes.includes(outcome.code);
}

function effectCoreComplete(node, coreId, invocationCounts, completedEffects) {
  const bases = [...invocationCounts.keys()].flatMap((baseId) => {
    const member = baseId.match(/^(.*):member-(0|[1-9][0-9]*)$/);
    return (member?.[1] ?? baseId) === coreId
      ? [{ base_id: baseId, member: member == null ? null : Number(member[2]) }]
      : [];
  });
  if (bases.length === 0) return false;
  const direct = bases.filter((entry) => entry.member == null);
  const members = bases.filter((entry) => entry.member != null).sort((left, right) => left.member - right.member);
  if ((direct.length !== 0 && members.length !== 0) || direct.length > 1
    || (members.length !== 0 && members.some((entry, index) => entry.member !== index))) return false;
  for (const { base_id: baseId } of bases) {
    const attempts = invocationCounts.get(baseId);
    if (!positiveInteger(attempts)) return false;
    for (let attempt = 1; attempt < attempts; attempt += 1) {
      if (completedEffects.get(`${baseId}:attempt-${attempt}`)?.controlled !== true) return false;
    }
    const finalOutcome = completedEffects.get(`${baseId}:attempt-${attempts}`);
    if (!finalOutcome || finalOutcome.controlled || !allowedNodeOutcome(node, finalOutcome)) return false;
  }
  return true;
}

function nodeEffectObligationComplete(definition, nodeId, visit, slotCount, invocationCounts, completedEffects) {
  const node = definition.nodes[nodeId];
  if (!["agent", "pipeline", "parallel", "map"].includes(node?.kind)) return true;
  const expectedSlots = node.kind === "agent" ? 1
    : node.kind === "pipeline" ? node.stages.length
      : node.kind === "parallel" ? node.branches.length
        : slotCount;
  if (!Number.isSafeInteger(slotCount) || slotCount !== expectedSlots) return false;
  const expectedCores = new Set(Array.from({ length: expectedSlots }, (_, index) =>
    node.kind === "agent" ? `${nodeId}:${visit}` : `${nodeId}:${visit}:${index}`));
  const observedCores = new Set();
  for (const baseId of invocationCounts.keys()) {
    const policy = effectPolicy(definition, nodeId, visit, baseId);
    if (policy == null) continue;
    const coreId = policy.core_id;
    if (!expectedCores.has(coreId)) return false;
    observedCores.add(coreId);
  }
  if (observedCores.size !== expectedCores.size) return false;
  for (const coreId of expectedCores) {
    if (!effectCoreComplete(node, coreId, invocationCounts, completedEffects)) return false;
  }
  return true;
}

function validEventLifecycle(events, definition, { legacy = false } = {}) {
  if (events.length === 0) return true;
  const visits = new Map();
  const openEffects = new Map();
  const completedEffects = new Map();
  const seenEffects = new Set();
  const repairCounts = new Map();
  const retryCounts = new Map();
  const invocationCounts = new Map();
  const finalGateId = Object.keys(definition.nodes).find((id) =>
    definition.nodes[id]?.kind === "gate" && definition.nodes[id].final === true);
  const successTerminalId = Object.keys(definition.nodes).find((id) =>
    definition.nodes[id]?.kind === "terminal" && definition.nodes[id].status === "succeeded");
  let phase = "initial";
  let nodeId = null;
  let visit = null;
  let expectedNode = definition.start;
  let expectedVisit = 1;
  let gateResult = null;
  let finalPassTraversed = false;
  let nodeEnd = null;
  let hasRunResume = false;
  let resumeNodeId = null;
  let resumeVisit = null;
  let childLastEvent = null;
  let effectPlanSlots = null;
  let segmentEffectSeen = false;
  let pipelineStage = -1;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.kind === "run-start") {
      if (index !== 0 || event.node_id !== definition.start) return false;
      phase = "bound";
      nodeId = event.node_id;
      expectedVisit = 1;
      continue;
    }
    if (event.kind === "run-resume") {
      if (phase === "terminal" || phase === "initial") {
        if (index !== 0) return false;
        nodeId = event.node_id;
        expectedVisit = null;
      } else if (phase === "active" || phase === "ended") {
        if (event.node_id !== nodeId) return false;
        expectedVisit = visit;
      } else if (phase === "expected") {
        if (event.node_id !== expectedNode) return false;
        nodeId = expectedNode;
        expectedVisit = (visits.get(expectedNode) ?? 0) + 1;
      } else if (phase === "bound") {
        if (event.node_id !== nodeId) return false;
      } else return false;
      phase = "bound";
      hasRunResume = true;
      resumeNodeId = nodeId;
      resumeVisit = expectedVisit;
      continue;
    }
    if (event.kind === "node-start") {
      const target = phase === "expected" ? expectedNode : nodeId;
      if (!["bound", "expected"].includes(phase) || event.node_id !== target
        || (expectedVisit != null && event.visit !== expectedVisit)) return false;
      const priorVisit = visits.get(event.node_id) ?? 0;
      const continuingResume = hasRunResume && resumeNodeId === event.node_id
        && (resumeVisit == null || resumeVisit === event.visit) && priorVisit === event.visit;
      if (expectedVisit == null && event.visit < priorVisit) return false;
      visits.set(event.node_id, Math.max(priorVisit, event.visit));
      nodeId = event.node_id;
      visit = event.visit;
      if (resumeNodeId === nodeId && resumeVisit == null) resumeVisit = visit;
      gateResult = null;
      nodeEnd = null;
      if (!continuingResume) childLastEvent = null;
      effectPlanSlots = null;
      segmentEffectSeen = false;
      pipelineStage = Math.max(-1, ...[...invocationCounts.keys()].flatMap((baseId) => {
        const policy = effectPolicy(definition, nodeId, visit, baseId);
        return policy && definition.nodes[nodeId]?.kind === "pipeline"
          ? [Number(policy.core_id.split(":")[2])]
          : [];
      }));
      phase = "active";
      continue;
    }
    if ([
      "gate", "effect-plan", "effect-start", "effect-end", "effect-resumed", "effect-recovered", "effect-cache-hit",
      "effect-repair", "effect-retry", "subworkflow-event",
    ].includes(event.kind)) {
      const authoredNode = definition.nodes[nodeId];
      if (phase !== "active" || event.node_id !== nodeId
        || (event.kind === "gate" && definition.nodes[nodeId]?.kind !== "gate")
        || (event.kind === "subworkflow-event" && definition.nodes[nodeId]?.kind !== "subworkflow")
        || (event.kind.startsWith("effect-")
          && !["agent", "pipeline", "parallel", "map"].includes(authoredNode?.kind))) return false;
      if (event.kind === "gate") {
        if (gateResult != null || event.final !== (authoredNode.final === true)) return false;
        gateResult = event.result;
      }
      if (event.kind === "effect-plan") {
        const expected = authoredNode.kind === "agent" ? 1
          : authoredNode.kind === "pipeline" ? authoredNode.stages.length
            : authoredNode.kind === "parallel" ? authoredNode.branches.length
              : null;
        if (legacy || effectPlanSlots != null || segmentEffectSeen
          || (expected != null && event.slot_count !== expected)
          || (authoredNode.kind === "map" && event.slot_count > authoredNode.max_items)) return false;
        effectPlanSlots = event.slot_count;
      }
      if (event.kind === "effect-start") {
        const policy = legacy ? null : effectPolicy(definition, nodeId, visit, event.instance_id, { attempt: true });
        if (seenEffects.has(event.instance_id) || (!legacy && (effectPlanSlots == null
          || !effectAttemptCanStart(policy, invocationCounts, completedEffects)))) return false;
        if (!legacy && authoredNode.kind === "pipeline") {
          const stage = Number(policy.core_id.split(":")[2]);
          if (stage < pipelineStage || stage > pipelineStage + 1
            || (stage > pipelineStage && pipelineStage >= 0 && !effectCoreComplete(
              authoredNode, `${nodeId}:${visit}:${pipelineStage}`, invocationCounts, completedEffects,
            ))) return false;
          pipelineStage = Math.max(pipelineStage, stage);
        }
        if (!legacy) invocationCounts.set(policy.base_id, policy.attempt);
        segmentEffectSeen = true;
        seenEffects.add(event.instance_id);
        openEffects.set(event.instance_id, event.effect_ref);
      }
      if (event.kind === "effect-end") {
        if ((!legacy && effectPolicy(definition, nodeId, visit, event.instance_id, { attempt: true }) == null)
          || openEffects.get(event.instance_id) !== event.effect_ref) return false;
        openEffects.delete(event.instance_id);
        completedEffects.set(event.instance_id, {
          status: event.status, code: event.code ?? null,
          failure_class: event.failure_class ?? null, controlled: false,
        });
      }
      if (event.kind === "effect-cache-hit") {
        const policy = legacy ? null : effectPolicy(definition, nodeId, visit, event.instance_id, { attempt: true });
        if (seenEffects.has(event.instance_id) || (!legacy && (effectPlanSlots == null
          || !effectAttemptCanStart(policy, invocationCounts, completedEffects)))) return false;
        if (!legacy && authoredNode.kind === "pipeline") {
          const stage = Number(policy.core_id.split(":")[2]);
          if (stage < pipelineStage || stage > pipelineStage + 1
            || (stage > pipelineStage && pipelineStage >= 0 && !effectCoreComplete(
              authoredNode, `${nodeId}:${visit}:${pipelineStage}`, invocationCounts, completedEffects,
            ))) return false;
          pipelineStage = Math.max(pipelineStage, stage);
        }
        if (!legacy) invocationCounts.set(policy.base_id, policy.attempt);
        segmentEffectSeen = true;
        seenEffects.add(event.instance_id);
        completedEffects.set(event.instance_id, {
          status: "ok", code: null, failure_class: null, controlled: false,
        });
      }
      if (event.kind === "effect-resumed") {
        const policy = legacy ? null : effectPolicy(definition, nodeId, visit, event.instance_id, { attempt: true });
        if (!hasRunResume || resumeNodeId !== nodeId || resumeVisit !== visit || (!legacy
          && (!policy || effectPlanSlots == null))
          || !openEffects.has(event.instance_id)
          || (!legacy && openEffects.get(event.instance_id) !== event.effect_ref)) return false;
        if (!legacy && authoredNode.kind === "pipeline") {
          const stage = Number(policy.core_id.split(":")[2]);
          if (stage < pipelineStage || stage > pipelineStage + 1
            || (stage > pipelineStage && pipelineStage >= 0 && !effectCoreComplete(
              authoredNode, `${nodeId}:${visit}:${pipelineStage}`, invocationCounts, completedEffects,
            ))) return false;
          pipelineStage = Math.max(pipelineStage, stage);
        }
        openEffects.delete(event.instance_id);
        completedEffects.set(event.instance_id, {
          status: event.status ?? null, code: event.code ?? null,
          failure_class: event.failure_class ?? null, controlled: false,
        });
        segmentEffectSeen = true;
      }
      if (event.kind === "effect-recovered") {
        const policy = effectPolicy(definition, nodeId, visit, event.instance_id, { attempt: true });
        if (legacy || !hasRunResume || resumeNodeId !== nodeId || resumeVisit !== visit
          || !policy || seenEffects.has(event.instance_id)
          || openEffects.has(event.instance_id) || effectPlanSlots == null
          || !effectAttemptCanStart(policy, invocationCounts, completedEffects)) return false;
        if (authoredNode.kind === "pipeline") {
          const stage = Number(policy.core_id.split(":")[2]);
          if (stage < pipelineStage || stage > pipelineStage + 1
            || (stage > pipelineStage && pipelineStage >= 0 && !effectCoreComplete(
              authoredNode, `${nodeId}:${visit}:${pipelineStage}`, invocationCounts, completedEffects,
            ))) return false;
          pipelineStage = Math.max(pipelineStage, stage);
        }
        invocationCounts.set(policy.base_id, policy.attempt);
        segmentEffectSeen = true;
        seenEffects.add(event.instance_id);
        completedEffects.set(event.instance_id, {
          status: event.status, code: event.code ?? null,
          failure_class: event.failure_class ?? null, controlled: false,
        });
      }
      if (["effect-repair", "effect-retry"].includes(event.kind)) {
        const priorId = event.prior_instance_id;
        const prior = priorId == null ? null : completedEffects.get(priorId);
        const policy = legacy ? null : effectPolicy(definition, nodeId, visit, event.instance_id);
        const priorPolicy = legacy || priorId == null
          ? null
          : effectPolicy(definition, nodeId, visit, priorId, { attempt: true });
        if (legacy) {
          const prefix = `${event.instance_id}:attempt-`;
          const eligible = [...completedEffects.entries()].findLast(([id, outcome]) =>
            id.startsWith(prefix) && outcome.controlled === false);
          if (!eligible) return false;
          eligible[1].controlled = true;
        } else if (!policy || !priorPolicy || priorPolicy.base_id !== policy.base_id
          || priorPolicy.attempt !== invocationCounts.get(policy.base_id)
          || !prior || prior.controlled
          || prior.status !== "failed" || prior.failure_class !== "agent") return false;
        else prior.controlled = true;
        if (event.kind === "effect-repair") {
          const expected = (repairCounts.get(event.instance_id) ?? 0) + 1;
          if (event.repair_attempt !== expected || (!legacy
            && (prior.code !== "pi-agent-semantic-output-invalid"
              || event.repair_attempt > definition.limits.structured_repair_attempts))) return false;
          repairCounts.set(event.instance_id, expected);
        } else {
          const expected = (retryCounts.get(event.instance_id) ?? 0) + 1;
          if (event.attempt !== expected || event.next_attempt !== expected + 1
            || (!legacy && event.next_attempt > policy.max_attempts)) return false;
          retryCounts.set(event.instance_id, expected);
        }
      }
      if (event.kind === "subworkflow-event") {
        if (event.child_run_id !== `${event.run_id}.${nodeId}.${visit}`) return false;
        childLastEvent = event;
      }
      continue;
    }
      if (event.kind === "node-end") {
      if (phase !== "active" || event.node_id !== nodeId
        || openEffects.size !== 0
        || (!legacy && event.status === "ok"
          && !nodeEffectObligationComplete(
            definition, nodeId, visit, effectPlanSlots, invocationCounts, completedEffects,
          ))
        || (definition.nodes[nodeId]?.kind === "gate" && event.status === "ok" && gateResult == null)
        || (!legacy && definition.nodes[nodeId]?.kind === "subworkflow" && event.status === "ok"
          && (childLastEvent?.child_kind !== "run-end" || childLastEvent.child_status !== "succeeded"))) return false;
      nodeEnd = { status: event.status, code: event.code ?? null };
      phase = "ended";
      continue;
    }
    if (event.kind === "transition") {
      if (phase !== "ended" || event.node_id !== nodeId || nodeEnd?.status !== "ok") return false;
      const authoredNode = definition.nodes[nodeId];
      if (authoredNode.kind === "gate") {
        const expectedKinds = gateResult === "pass" ? ["pass"] : ["fail", "loops-off"];
        const expectedTargets = gateResult === "pass"
          ? [authoredNode.on_pass]
          : [authoredNode.on_fail, ...(authoredNode.loops_off ? [authoredNode.loops_off] : [])];
        if (!expectedTargets.includes(event.target)
          || (event.edge_kind != null && !expectedKinds.includes(event.edge_kind))) return false;
        if (nodeId === finalGateId && gateResult === "pass" && event.target === successTerminalId) {
          finalPassTraversed = true;
        }
      }
      expectedNode = event.target;
      expectedVisit = (visits.get(expectedNode) ?? 0) + 1;
      nodeId = null;
      visit = null;
      gateResult = null;
      nodeEnd = null;
      resumeNodeId = null;
      resumeVisit = null;
      phase = "expected";
      continue;
    }
    if (event.kind === "run-end") {
      const terminal = definition.nodes[nodeId];
      const eventEnd = { status: event.status, code: event.code ?? null };
      const authoredEnd = { status: terminal?.status, code: terminal?.code ?? null };
      const missingEvidenceEnd = terminal?.kind === "terminal" && terminal.status === "succeeded"
        && event.status === "refused" && event.code === "kernel-objective-gate-evidence-missing";
      const nonterminalFailure = terminal?.kind !== "terminal"
        && ["failed", "refused", "cancelled"].includes(event.status)
        && event.code != null;
      if (phase !== "ended" || event.node_id !== nodeId || index !== events.length - 1
        || nodeEnd?.status !== eventEnd.status || nodeEnd?.code !== eventEnd.code
        || (!nonterminalFailure && terminal?.kind !== "terminal")
        || (!nonterminalFailure && !missingEvidenceEnd
          && (authoredEnd.status !== eventEnd.status || authoredEnd.code !== eventEnd.code))
        || (event.status === "succeeded"
          && (nodeId !== successTerminalId || finalPassTraversed !== true))) return false;
      phase = "terminal";
      continue;
    }
    return false;
  }
  return true;
}

function cyclicComponents(graph, components) {
  return components.filter((component) => component.length > 1
    || graph.edges.some((edge) => edge.from === component[0] && edge.to === component[0]));
}

export function plannedWorkflowGraph(definition) {
  const valid = validateWorkflowDefinition(definition);
  if (!valid.valid) return { ok: false, code: "invalid-workflow-v4" };
  const compiled = compileWorkflowGraph(definition);
  if (!compiled.ok) return { ok: false, code: "invalid-workflow-v4" };
  const projected = projectPublicWorkflowGraph(compiled);
  const authoredComponents = stronglyConnectedWorkflowComponents(compiled);
  const loopsDisabledComponents = stronglyConnectedWorkflowComponents(compiled, { view: "loops-disabled" });
  if (!projected.ok || !authoredComponents.ok || !loopsDisabledComponents.ok) {
    return { ok: false, code: "invalid-workflow-v4" };
  }
  const edgesByNode = new Map(projected.nodes.map((node) => [node.id, []]));
  for (const edge of projected.edges) edgesByNode.get(edge.from).push(edge);
  return {
    ok: true,
    start: projected.start,
    final_gate_id: projected.final_gate_id,
    success_terminal_id: projected.success_terminal_id,
    limits: structuredClone(definition.limits),
    nodes: projected.nodes.map(({ id, kind }) => {
      const node = definition.nodes[id];
      return {
      id, kind,
      label: node.label ?? id,
      targets: edgesByNode.get(id).map((edge) => edge.to),
      ...(node.kind === "agent" ? { role: node.role, mutation: node.mutation } : {}),
      ...(node.kind === "pipeline" ? { roles: node.stages.map((stage) => stage.role), max_visits: node.max_visits } : {}),
      ...(node.kind === "parallel" ? { branches: node.branches.length, max_concurrency: node.max_concurrency } : {}),
      ...(node.kind === "map" ? { max_items: node.max_items } : {}),
      ...(node.kind === "gate" ? { final: node.final === true } : {}),
      ...(node.kind === "terminal" ? { status: node.status } : {}),
    }; }),
    edges: projected.edges,
    cycles: cyclicComponents(compiled, authoredComponents.components),
    loops_disabled_cycles: cyclicComponents(compiled, loopsDisabledComponents.components),
  };
}

export function observedWorkflowGraph(definition, events = [], {
  execution_mode: expectedMode = undefined,
  subworkflows = [],
  legacy_child_events: legacyChildEvents = false,
} = {}) {
  const planned = plannedWorkflowGraph(definition);
  if (!planned.ok) return planned;
  const hasExpectedMode = expectedMode !== undefined;
  const checkedMode = validateWorkflowExecutionMode(expectedMode);
  if (!Array.isArray(events) || !Array.isArray(subworkflows)
    || subworkflows.some((entry) => !plannedWorkflowGraph(entry).ok)
    || typeof legacyChildEvents !== "boolean"
    || (hasExpectedMode && !checkedMode.ok)) {
    return { ok: false, code: "workflow-events-invalid" };
  }
  const firstEvent = events[0] ?? null;
  if (firstEvent != null && !["run-start", "run-resume"].includes(firstEvent?.kind)) {
    return { ok: false, code: "workflow-events-invalid" };
  }
  const executionMode = hasExpectedMode ? checkedMode.mode
    : firstEvent == null ? DEFAULT_WORKFLOW_EXECUTION_MODE : eventMode(firstEvent);
  if (executionMode == null || (legacyChildEvents && executionMode !== DEFAULT_WORKFLOW_EXECUTION_MODE)
    || (firstEvent?.kind === "run-start" && firstEvent.node_id !== definition.start)) {
    return { ok: false, code: "workflow-events-invalid" };
  }
  const definitionRef = workflowDefinitionHash(definition);
  const runId = firstEvent?.run_id ?? null;
  if (events.some((event, index) => event?.seq !== index + 1 || event?.run_id !== runId
    || (index > 0 && event?.kind === "run-start")
    || (event?.kind === "run-end" && index !== events.length - 1)
    || !validKnownEvent(event, new Set(planned.nodes.map((node) => node.id)), executionMode, definitionRef, {
      legacyChildEvents,
    }))) {
    return { ok: false, code: "workflow-events-invalid" };
  }
  if (!validEventLifecycle(events, definition, { legacy: legacyChildEvents })) {
    return { ok: false, code: "workflow-events-invalid" };
  }
  const byNode = new Map(planned.nodes.map((node) => [node.id, { ...node, visits: 0, effects: 0, status: "pending" }]));
  const nodeIds = new Set(byNode.keys());
  const edgeById = new Map(planned.edges.map((edge) => [edge.id, edge]));
  const edgesByEndpoints = new Map();
  for (const edge of planned.edges) {
    const key = `${edge.from}\0${edge.to}`;
    if (!edgesByEndpoints.has(key)) edgesByEndpoints.set(key, []);
    edgesByEndpoints.get(key).push(edge);
  }
  const edges = [];
  const traversals = new Map();
  const childDefinitions = new Map(subworkflows.map((entry) => [`${entry.id}@${entry.version}`, entry]));
  const childStreams = new Map();
  const childSequences = new Map();
  let currentNode = null;
  let lastNode = null;
  for (const event of events) {
    const node = byNode.get(event.node_id);
    const authoredNode = definition.nodes[event.node_id];
    lastNode = event.node_id;
    if (event.kind === "run-start" || event.kind === "run-resume") currentNode = event.node_id;
    if (event.kind === "node-start") {
      node.visits = Math.max(node.visits, event.visit);
      node.status = "running";
      currentNode = event.node_id;
    }
    if (["effect-end", "effect-resumed", "effect-recovered"].includes(event.kind)) node.effects += 1;
    if (event.kind === "node-end") node.status = event.status;
    if (event.kind === "run-end") currentNode = null;
    if (event.kind === "transition") {
      const candidates = edgesByEndpoints.get(`${event.node_id}\0${event.target}`) ?? [];
      let selected = null;
      if (event.edge_id != null || event.edge_kind != null) {
        if (typeof event.edge_id !== "string" || typeof event.edge_kind !== "string") {
          return { ok: false, code: "workflow-events-invalid" };
        }
        selected = edgeById.get(event.edge_id) ?? null;
        if (!selected || selected.from !== event.node_id || selected.to !== event.target
          || selected.kind !== event.edge_kind) return { ok: false, code: "workflow-events-invalid" };
      } else if (candidates.length === 1) {
        [selected] = candidates;
      } else if (candidates.length === 0) {
        return { ok: false, code: "workflow-events-invalid" };
      }
      const observed = selected
        ? { id: selected.id, kind: selected.kind, from: selected.from, to: selected.to }
        : { from: event.node_id, to: event.target, ambiguous: true, candidate_edge_ids: candidates.map((edge) => edge.id) };
      edges.push(observed);
      const key = selected?.id ?? `ambiguous:${event.node_id}:${event.target}`;
      const prior = traversals.get(key);
      if (prior) prior.count += 1;
      else traversals.set(key, { ...observed, count: 1 });
      currentNode = event.target;
    }
    if (event.kind === "subworkflow-event") {
      if (authoredNode.kind !== "subworkflow" || typeof event.child_run_id !== "string" || !positiveInteger(event.child_seq)
        || !EVENT_KINDS.has(event.child_kind) || event.child_kind === "subworkflow-event"
        || (executionMode === "graph-mode" && (event.child_workflow_id !== authoredNode.workflow_id
          || event.child_workflow_version !== authoredNode.version))) {
        return { ok: false, code: "workflow-events-invalid" };
      }
      if (event.child_workflow_id != null && event.child_workflow_id !== authoredNode.workflow_id) {
        return { ok: false, code: "workflow-events-invalid" };
      }
      if (event.child_workflow_version != null && event.child_workflow_version !== authoredNode.version) {
        return { ok: false, code: "workflow-events-invalid" };
      }
      const previousSequence = childSequences.get(event.child_run_id) ?? 0;
      if (event.child_seq !== previousSequence + 1) return { ok: false, code: "workflow-events-invalid" };
      childSequences.set(event.child_run_id, event.child_seq);
      if (legacyChildEvents) continue;
      if (!childStreams.has(event.child_run_id)) {
        childStreams.set(event.child_run_id, {
          parent_node_id: event.node_id,
          workflow_id: authoredNode.workflow_id,
          workflow_version: authoredNode.version,
          events: [],
        });
      }
      const stream = childStreams.get(event.child_run_id);
      if (stream.parent_node_id !== event.node_id || stream.workflow_id !== authoredNode.workflow_id
        || stream.workflow_version !== authoredNode.version) return { ok: false, code: "workflow-events-invalid" };
      stream.events.push(childEvent(event));
    }
  }
  const childGraphs = [];
  for (const [runId, stream] of childStreams) {
    const childDefinition = childDefinitions.get(`${stream.workflow_id}@${stream.workflow_version}`);
    if (!childDefinition) return { ok: false, code: "workflow-events-invalid" };
    const graph = observedWorkflowGraph(childDefinition, stream.events, { execution_mode: executionMode });
    if (!graph.ok) {
      return { ok: false, code: "workflow-events-invalid" };
    }
    childGraphs.push({
      parent_node_id: stream.parent_node_id,
      run_id: runId,
      workflow_id: stream.workflow_id,
      workflow_version: stream.workflow_version,
      current_node: graph.current_node,
      last_node: graph.last_node,
      graph,
    });
  }
  return {
    ...planned,
    execution_mode: executionMode,
    current_node: currentNode,
    last_node: lastNode,
    nodes: [...byNode.values()],
    observed_edges: edges,
    edge_traversals: [...traversals.values()],
    child_graphs: childGraphs,
  };
}
