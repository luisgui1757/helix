// Canonical provider-neutral control-flow graph for WorkflowDefinition v4.
//
// This module deliberately does not import schema.mjs: schema validation owns
// admission, while graph compilation owns a total, deterministic projection of
// the already-admitted node/edge contract. Conditions remain available to the
// scheduler internally; the public projection exposes only structural fields
// and a stable condition reference.

import { createHash } from "node:crypto";

export const WORKFLOW_EXECUTION_MODES = Object.freeze(["original-mode", "graph-mode"]);
export const DEFAULT_WORKFLOW_EXECUTION_MODE = "original-mode";

export const WORKFLOW_GRAPH_EDGE_KINDS = Object.freeze([
  "next", "condition", "default", "loops-off", "pass", "fail",
]);

export const WORKFLOW_GRAPH_EDGE_VIEWS = Object.freeze([
  "authored", "runtime", "loops-disabled",
]);

export const WORKFLOW_GRAPH_CODES = Object.freeze({
  execution_mode_invalid: "kernel-execution-mode-invalid",
  graph_invalid: "kernel-graph-invalid",
  edge_view_invalid: "kernel-graph-edge-view-invalid",
  route_invalid: "kernel-graph-route-invalid",
});

const GRAPH_BRAND = Symbol("helix-workflow-graph");
const NODE_ID = /^[a-z][a-z0-9-]{0,63}$/;
const MAX_GRAPH_NODES = 256;
const MAX_DECISION_TRANSITIONS = 16;
const MAX_GRAPH_EDGES = MAX_GRAPH_NODES * (MAX_DECISION_TRANSITIONS + 2);
const MAX_CONDITION_DEPTH = 64;
const MAX_CONDITION_BYTES = 256 * 1024;
const NEXT_KINDS = new Set([
  "agent", "pipeline", "parallel", "map", "reduce", "checkpoint", "subworkflow",
]);
const NODE_KINDS = new Set([...NEXT_KINDS, "decision", "gate", "terminal"]);

function plain(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function refusal(code) {
  return { ok: false, status: "refused", code };
}

function validNodeId(value) {
  return typeof value === "string" && NODE_ID.test(value);
}

function stableJson(value) {
  const seen = new Set();
  let bytes = 0;
  const account = (text) => {
    bytes += Buffer.byteLength(text, "utf8");
    return bytes <= MAX_CONDITION_BYTES;
  };
  const accountBytes = (count) => {
    bytes += count;
    return bytes <= MAX_CONDITION_BYTES;
  };
  const serialize = (candidate, depth) => {
    if (depth > MAX_CONDITION_DEPTH) return null;
    if (candidate === null) return account("null") ? "null" : null;
    if (typeof candidate === "string" || typeof candidate === "boolean") {
      const text = JSON.stringify(candidate);
      return account(text) ? text : null;
    }
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate)) return null;
      const text = JSON.stringify(candidate);
      return account(text) ? text : null;
    }
    if (typeof candidate !== "object" || seen.has(candidate)) return null;
    seen.add(candidate);
    let text;
    if (Array.isArray(candidate)) {
      if (!accountBytes(candidate.length + 1)) {
        seen.delete(candidate);
        return null;
      }
      const values = [];
      for (const entry of candidate) {
        const serialized = serialize(entry, depth + 1);
        if (serialized == null) {
          seen.delete(candidate);
          return null;
        }
        values.push(serialized);
      }
      text = `[${values.join(",")}]`;
    } else if (plain(candidate)) {
      const keys = Object.keys(candidate).sort();
      if (!accountBytes(keys.length + 1)) {
        seen.delete(candidate);
        return null;
      }
      const values = [];
      for (const key of keys) {
        const serializedKey = JSON.stringify(key);
        if (!account(`${serializedKey}:`)) {
          seen.delete(candidate);
          return null;
        }
        const serialized = serialize(candidate[key], depth + 1);
        if (serialized == null) {
          seen.delete(candidate);
          return null;
        }
        values.push(`${serializedKey}:${serialized}`);
      }
      text = `{${values.join(",")}}`;
    } else {
      seen.delete(candidate);
      return null;
    }
    seen.delete(candidate);
    return text;
  };
  return serialize(value, 0);
}

function conditionRef(condition) {
  const serialized = stableJson(condition);
  return serialized == null
    ? null
    : `sha256:${createHash("sha256").update(serialized).digest("hex")}`;
}

function freezeTree(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const entry of Array.isArray(value) ? value : Object.values(value)) freezeTree(entry, seen);
  return Object.freeze(value);
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function cloneCondition(condition) {
  if (!plain(condition) || typeof condition.op !== "string" || conditionRef(condition) == null) return null;
  try {
    return freezeTree(structuredClone(condition));
  } catch {
    return null;
  }
}

function edgeIdentity(from, kind, metadata) {
  if (kind === "condition") {
    const index = metadata.transition_index;
    if (!Number.isSafeInteger(index) || index < 0) return null;
    return { id: `${from}:condition:${index}`, field: `transitions[${index}].target` };
  }
  if (kind === "default") return { id: `${from}:default`, field: "default.target" };
  if (kind === "pass") return { id: `${from}:pass`, field: "on_pass" };
  if (kind === "fail") return { id: `${from}:fail`, field: "on_fail" };
  if (kind === "loops-off") return { id: `${from}:loops-off`, field: "loops_off" };
  if (kind === "next") return { id: `${from}:next`, field: "next" };
  return null;
}

function edge(from, to, kind, ordinal, metadata = {}) {
  if (!validNodeId(from) || !validNodeId(to) || !WORKFLOW_GRAPH_EDGE_KINDS.includes(kind)
    || !Number.isSafeInteger(ordinal) || ordinal < 0 || !plain(metadata)) return null;
  const identity = edgeIdentity(from, kind, metadata);
  return identity == null ? null : Object.freeze({ ...identity, from, to, kind, ordinal, ...metadata });
}

function extractNodeEdgesUnchecked(nodeId, node) {
  if (!validNodeId(nodeId) || !plain(node) || !NODE_KINDS.has(node.kind)) return null;
  if (NEXT_KINDS.has(node.kind)) {
    const selected = edge(nodeId, node.next, "next", 0);
    return selected ? [selected] : null;
  }
  if (node.kind === "terminal") return [];
  if (node.kind === "gate") {
    const edges = [
      edge(nodeId, node.on_pass, "pass", 0),
      edge(nodeId, node.on_fail, "fail", 1),
    ];
    if (node.loops_off != null) edges.push(edge(nodeId, node.loops_off, "loops-off", 2));
    return edges.every(Boolean) ? edges : null;
  }
  if (!Array.isArray(node.transitions) || node.transitions.length > MAX_DECISION_TRANSITIONS
    || !plain(node.default)) return null;
  const edges = [];
  for (let index = 0; index < node.transitions.length; index += 1) {
    const transition = node.transitions[index];
    if (!plain(transition) || (transition.loop != null && typeof transition.loop !== "boolean")) return null;
    const condition = cloneCondition(transition.when);
    const selected = condition && edge(nodeId, transition.target, "condition", index, {
      transition_index: index,
      condition,
      condition_ref: conditionRef(condition),
      loop: transition.loop === true,
    });
    if (!selected) return null;
    edges.push(selected);
  }
  if (node.default.loop != null && typeof node.default.loop !== "boolean") return null;
  const defaultEdge = edge(nodeId, node.default.target, "default", edges.length, {
    loop: node.default.loop === true,
  });
  if (!defaultEdge) return null;
  edges.push(defaultEdge);
  if (node.loops_off != null) {
    const loopsOff = edge(nodeId, node.loops_off, "loops-off", edges.length);
    if (!loopsOff) return null;
    edges.push(loopsOff);
  }
  return edges;
}

export function validateWorkflowExecutionMode(value) {
  try {
    const mode = value === undefined ? DEFAULT_WORKFLOW_EXECUTION_MODE : value;
    return WORKFLOW_EXECUTION_MODES.includes(mode)
      ? { ok: true, mode }
      : refusal(WORKFLOW_GRAPH_CODES.execution_mode_invalid);
  } catch {
    return refusal(WORKFLOW_GRAPH_CODES.execution_mode_invalid);
  }
}

export function extractWorkflowNodeEdges(nodeId, node) {
  try {
    const edges = extractNodeEdgesUnchecked(nodeId, node);
    return edges == null
      ? refusal(WORKFLOW_GRAPH_CODES.graph_invalid)
      : { ok: true, edges: Object.freeze(edges) };
  } catch {
    return refusal(WORKFLOW_GRAPH_CODES.graph_invalid);
  }
}

function compiled(graph) {
  return graph?.[GRAPH_BRAND] === true;
}

export function compileWorkflowGraph(definition) {
  try {
    if (!plain(definition) || !plain(definition.nodes)) return refusal(WORKFLOW_GRAPH_CODES.graph_invalid);
    const entries = Object.entries(definition.nodes)
      .sort(([left], [right]) => lexicalCompare(left, right));
    if (entries.length < 1 || entries.length > MAX_GRAPH_NODES
      || !validNodeId(definition.start) || !Object.hasOwn(definition.nodes, definition.start)) {
      return refusal(WORKFLOW_GRAPH_CODES.graph_invalid);
    }
    const nodes = [];
    const edges = [];
    for (let ordinal = 0; ordinal < entries.length; ordinal += 1) {
      const [id, node] = entries[ordinal];
      if (!validNodeId(id) || !plain(node) || !NODE_KINDS.has(node.kind)) {
        return refusal(WORKFLOW_GRAPH_CODES.graph_invalid);
      }
      nodes.push(Object.freeze({ id, kind: node.kind, ordinal }));
      const extracted = extractNodeEdgesUnchecked(id, node);
      if (extracted == null) return refusal(WORKFLOW_GRAPH_CODES.graph_invalid);
      edges.push(...extracted);
      if (edges.length > MAX_GRAPH_EDGES) return refusal(WORKFLOW_GRAPH_CODES.graph_invalid);
    }
    const ids = new Set(nodes.map((node) => node.id));
    if (edges.some((candidate) => !ids.has(candidate.to))) return refusal(WORKFLOW_GRAPH_CODES.graph_invalid);
    const finalGates = entries.filter(([, node]) => node.kind === "gate" && node.final === true).map(([id]) => id);
    const successTerminals = entries.filter(([, node]) => node.kind === "terminal" && node.status === "succeeded").map(([id]) => id);
    if (finalGates.length !== 1 || successTerminals.length !== 1) {
      return refusal(WORKFLOW_GRAPH_CODES.graph_invalid);
    }
    const adjacency = Object.create(null);
    const reverseAdjacency = Object.create(null);
    for (const node of nodes) {
      adjacency[node.id] = [];
      reverseAdjacency[node.id] = [];
    }
    for (const candidate of edges) {
      adjacency[candidate.from].push(candidate);
      reverseAdjacency[candidate.to].push(candidate);
    }
    for (const id of ids) {
      Object.freeze(adjacency[id]);
      Object.freeze(reverseAdjacency[id]);
    }
    const graph = {
      ok: true,
      start: definition.start,
      nodes: Object.freeze(nodes),
      edges: Object.freeze(edges),
      adjacency: Object.freeze(adjacency),
      reverse_adjacency: Object.freeze(reverseAdjacency),
      final_gate_id: finalGates[0],
      success_terminal_id: successTerminals[0],
    };
    Object.defineProperty(graph, GRAPH_BRAND, { value: true });
    return Object.freeze(graph);
  } catch {
    return refusal(WORKFLOW_GRAPH_CODES.graph_invalid);
  }
}

function validView(view) {
  return WORKFLOW_GRAPH_EDGE_VIEWS.includes(view);
}

function edgeEnabled(candidate, outgoing, view) {
  if (view === "authored") return true;
  if (view === "runtime") return candidate.kind !== "loops-off";
  if (candidate.kind === "condition" || candidate.kind === "default") return candidate.loop !== true;
  if (candidate.kind === "loops-off") {
    const kind = outgoing[0]?.kind;
    return kind === "condition" || kind === "default"
      ? outgoing.some((entry) => ["condition", "default"].includes(entry.kind) && entry.loop === true)
      : kind === "pass";
  }
  if (candidate.kind === "fail") return !outgoing.some((entry) => entry.kind === "loops-off");
  return true;
}

export function workflowGraphEdges(graph, { view = "authored" } = {}) {
  try {
    if (!compiled(graph)) return refusal(WORKFLOW_GRAPH_CODES.graph_invalid);
    if (!validView(view)) return refusal(WORKFLOW_GRAPH_CODES.edge_view_invalid);
    const edges = graph.edges.filter((candidate) => edgeEnabled(candidate, graph.adjacency[candidate.from], view));
    return { ok: true, edges: Object.freeze(edges) };
  } catch {
    return refusal(WORKFLOW_GRAPH_CODES.graph_invalid);
  }
}

function selectedAdjacency(graph, view, reverse = false) {
  if (!compiled(graph)) return null;
  const selected = workflowGraphEdges(graph, { view });
  if (!selected.ok) return selected;
  const index = Object.create(null);
  for (const node of graph.nodes) index[node.id] = [];
  for (const candidate of selected.edges) {
    index[reverse ? candidate.to : candidate.from].push(reverse ? candidate.from : candidate.to);
  }
  return index;
}

function orderedReachable(graph, start, view, reverse = false) {
  if (!compiled(graph) || !validNodeId(start) || !Object.hasOwn(graph.adjacency, start)) {
    return refusal(WORKFLOW_GRAPH_CODES.graph_invalid);
  }
  if (!validView(view)) return refusal(WORKFLOW_GRAPH_CODES.edge_view_invalid);
  const adjacency = selectedAdjacency(graph, view, reverse);
  if (adjacency?.ok === false) return adjacency;
  const seen = new Set();
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    for (const target of adjacency[current]) if (!seen.has(target)) queue.push(target);
  }
  return {
    ok: true,
    node_ids: Object.freeze(graph.nodes.filter((node) => seen.has(node.id)).map((node) => node.id)),
  };
}

export function reachableWorkflowNodes(graph, start = graph?.start, { view = "authored" } = {}) {
  try {
    return orderedReachable(graph, start, view, false);
  } catch {
    return refusal(WORKFLOW_GRAPH_CODES.graph_invalid);
  }
}

export function reverseReachableWorkflowNodes(graph, target, { view = "authored" } = {}) {
  try {
    return orderedReachable(graph, target, view, true);
  } catch {
    return refusal(WORKFLOW_GRAPH_CODES.graph_invalid);
  }
}

export function workflowGraphHasPath(graph, from, to, { view = "authored" } = {}) {
  try {
    if (!compiled(graph) || !validNodeId(to) || !Object.hasOwn(graph.adjacency, to)) {
      return refusal(WORKFLOW_GRAPH_CODES.graph_invalid);
    }
    const reachable = orderedReachable(graph, from, view, false);
    return reachable.ok ? { ok: true, exists: reachable.node_ids.includes(to) } : reachable;
  } catch {
    return refusal(WORKFLOW_GRAPH_CODES.graph_invalid);
  }
}

export function stronglyConnectedWorkflowComponents(graph, { view = "authored" } = {}) {
  try {
    if (!compiled(graph)) return refusal(WORKFLOW_GRAPH_CODES.graph_invalid);
    if (!validView(view)) return refusal(WORKFLOW_GRAPH_CODES.edge_view_invalid);
    const adjacency = selectedAdjacency(graph, view, false);
    if (adjacency?.ok === false) return adjacency;
    const ordinals = new Map(graph.nodes.map((node) => [node.id, node.ordinal]));
    let nextIndex = 0;
    const indices = new Map();
    const lowlinks = new Map();
    const stack = [];
    const onStack = new Set();
    const components = [];
    const visit = (id) => {
      indices.set(id, nextIndex);
      lowlinks.set(id, nextIndex);
      nextIndex += 1;
      stack.push(id);
      onStack.add(id);
      for (const target of adjacency[id]) {
        if (!indices.has(target)) {
          visit(target);
          lowlinks.set(id, Math.min(lowlinks.get(id), lowlinks.get(target)));
        } else if (onStack.has(target)) {
          lowlinks.set(id, Math.min(lowlinks.get(id), indices.get(target)));
        }
      }
      if (lowlinks.get(id) !== indices.get(id)) return;
      const component = [];
      let current;
      do {
        current = stack.pop();
        onStack.delete(current);
        component.push(current);
      } while (current !== id);
      component.sort((left, right) => ordinals.get(left) - ordinals.get(right));
      components.push(component);
    };
    for (const node of graph.nodes) if (!indices.has(node.id)) visit(node.id);
    components.sort((left, right) => ordinals.get(left[0]) - ordinals.get(right[0]));
    return { ok: true, components: Object.freeze(components.map((component) => Object.freeze(component))) };
  } catch {
    return refusal(WORKFLOW_GRAPH_CODES.graph_invalid);
  }
}

function routeFailure() {
  return refusal(WORKFLOW_GRAPH_CODES.route_invalid);
}

function routeSuccess(candidate) {
  return candidate && validNodeId(candidate.to)
    ? { ok: true, target: candidate.to, edge: candidate }
    : routeFailure();
}

function nodeKind(graph, nodeId) {
  return graph.nodes.find((node) => node.id === nodeId)?.kind ?? null;
}

export function routeWorkflowNext(graph, nodeId) {
  try {
    if (!compiled(graph) || !NEXT_KINDS.has(nodeKind(graph, nodeId))) return routeFailure();
    const candidates = graph.adjacency[nodeId].filter((candidate) => candidate.kind === "next");
    return candidates.length === 1 ? routeSuccess(candidates[0]) : routeFailure();
  } catch {
    return routeFailure();
  }
}

export function routeWorkflowDecision(graph, nodeId, { evaluate, loops = true } = {}) {
  try {
    if (!compiled(graph) || nodeKind(graph, nodeId) !== "decision" || typeof evaluate !== "function"
      || typeof loops !== "boolean") return routeFailure();
    const outgoing = graph.adjacency[nodeId];
    const conditions = outgoing.filter((candidate) => candidate.kind === "condition");
    let selected = null;
    for (const candidate of conditions) {
      const matched = evaluate(candidate.condition, candidate);
      if (typeof matched !== "boolean") return routeFailure();
      if (matched) {
        selected = candidate;
        break;
      }
    }
    if (selected == null) {
      const defaults = outgoing.filter((candidate) => candidate.kind === "default");
      if (defaults.length !== 1) return routeFailure();
      selected = defaults[0];
    }
    if (selected.loop === true && loops === false) {
      const escapes = outgoing.filter((candidate) => candidate.kind === "loops-off");
      return escapes.length === 1 ? routeSuccess(escapes[0]) : routeFailure();
    }
    return routeSuccess(selected);
  } catch {
    return routeFailure();
  }
}

export function routeWorkflowGate(graph, nodeId, { result, loops = true } = {}) {
  try {
    if (!compiled(graph) || nodeKind(graph, nodeId) !== "gate"
      || !["pass", "fail"].includes(result) || typeof loops !== "boolean") return routeFailure();
    const outgoing = graph.adjacency[nodeId];
    if (result === "fail" && loops === false) {
      const escapes = outgoing.filter((candidate) => candidate.kind === "loops-off");
      if (escapes.length === 1) return routeSuccess(escapes[0]);
      if (escapes.length > 1) return routeFailure();
    }
    const candidates = outgoing.filter((candidate) => candidate.kind === result);
    return candidates.length === 1 ? routeSuccess(candidates[0]) : routeFailure();
  } catch {
    return routeFailure();
  }
}

function publicCondition(candidate) {
  return Object.freeze({
    operator: candidate.condition.op,
    ...(typeof candidate.condition.path === "string" ? { path: candidate.condition.path } : {}),
    ref: candidate.condition_ref,
  });
}

export function projectPublicWorkflowGraph(graph) {
  try {
    if (!compiled(graph)) return refusal(WORKFLOW_GRAPH_CODES.graph_invalid);
    return Object.freeze({
      ok: true,
      start: graph.start,
      final_gate_id: graph.final_gate_id,
      success_terminal_id: graph.success_terminal_id,
      nodes: Object.freeze(graph.nodes.map((node) => Object.freeze({ ...node }))),
      edges: Object.freeze(graph.edges.map((candidate) => Object.freeze({
        id: candidate.id,
        from: candidate.from,
        to: candidate.to,
        kind: candidate.kind,
        ordinal: candidate.ordinal,
        field: candidate.field,
        ...(candidate.kind === "condition" ? {
          transition_index: candidate.transition_index,
          loop: candidate.loop,
          condition: publicCondition(candidate),
        } : {}),
        ...(candidate.kind === "default" ? { loop: candidate.loop } : {}),
      }))),
    });
  } catch {
    return refusal(WORKFLOW_GRAPH_CODES.graph_invalid);
  }
}
