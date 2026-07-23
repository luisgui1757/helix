// Pure programmatic WorkflowDefinition v4 builder. The returned document is
// ordinary JSON data and still passes through the same closed validator as UI
// or imported definitions. Helix never executes the program that constructed it.

import { types } from "node:util";

import {
  stableWorkflowStringify,
  WORKFLOW_DEFAULTS,
  WORKFLOW_LIMITS,
  WORKFLOW_SCHEMA_VERSION,
  validateWorkflowDefinition,
} from "./schema.mjs";

function options(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function agent(value = {}) {
  const { role, stage_id, prompt = "tracked-step-v1", output_schema = "semantic-v2", tools, mutation, timeout_ms, retry, next, max_visits, artifact, label } = options(value);
  const activeMutation = mutation ?? "read-only";
  return {
    kind: "agent",
    role,
    stage_id,
    prompt,
    output_schema: { id: output_schema },
    tools: tools ?? (activeMutation === "read-only" ? ["read", "grep", "find", "ls"] : ["read", "grep", "find", "ls", "bash", "edit", "write"]),
    mutation: activeMutation,
    timeout_ms: timeout_ms ?? WORKFLOW_DEFAULTS.max_call_ms,
    retry: retry ?? { max_attempts: 1, backoff_ms: 0 },
    ...(next ? { next } : {}),
    ...(max_visits != null ? { max_visits } : {}),
    ...(artifact ? { artifact } : {}),
    ...(label ? { label } : {}),
  };
}

export function pipeline(stages, next, value = {}) {
  const { label, max_visits = WORKFLOW_DEFAULTS.max_visits, artifact } = options(value);
  return { kind: "pipeline", stages, next, max_visits, ...(label ? { label } : {}), ...(artifact ? { artifact } : {}) };
}

export function parallel(branches, next, value = {}) {
  const { label, max_concurrency = WORKFLOW_DEFAULTS.max_concurrency, failure = "abort", allow_failure_codes } = options(value);
  return { kind: "parallel", branches, next, max_concurrency, failure, ...(allow_failure_codes ? { allow_failure_codes } : {}), ...(label ? { label } : {}) };
}

export function map(items_path, body, next, value = {}) {
  const { label, max_items = WORKFLOW_DEFAULTS.max_map_items, failure = "abort", allow_failure_codes } = options(value);
  return { kind: "map", items_path, body, next, max_items, failure, ...(allow_failure_codes ? { allow_failure_codes } : {}), ...(label ? { label } : {}) };
}

export function reduce(items_path, strategy, next, value = {}) {
  const { label, separator } = options(value);
  return { kind: "reduce", items_path, strategy, next, ...(label ? { label } : {}), ...(separator != null ? { separator } : {}) };
}

export function decision(transitions, fallback, value = {}) {
  const { label, loops_off, default_loop = false } = options(value);
  return { kind: "decision", transitions, default: { target: fallback, ...(default_loop ? { loop: true } : {}) }, ...(label ? { label } : {}), ...(loops_off ? { loops_off } : {}) };
}

export function gate(objective, on_pass, on_fail, value = {}) {
  const { label, loops_off } = options(value);
  return { kind: "gate", gate: objective, on_pass, on_fail, ...(label ? { label } : {}), ...(loops_off ? { loops_off } : {}) };
}

export function objectiveGate(on_pass, on_fail, value = {}) {
  const { label, loops_off } = options(value);
  return { kind: "gate", on_pass, on_fail, final: true, ...(label ? { label } : {}), ...(loops_off ? { loops_off } : {}) };
}

export function checkpoint(reason, next, value = {}) {
  const { label } = options(value);
  return { kind: "checkpoint", reason, next, ...(label ? { label } : {}) };
}

export function subworkflow(workflow_id, version, next, value = {}) {
  const { label } = options(value);
  return { kind: "subworkflow", workflow_id, version, next, ...(label ? { label } : {}) };
}

export function terminal(status, code = null, value = {}) {
  const { label } = options(value);
  return { kind: "terminal", status, ...(code ? { code } : {}), ...(label ? { label } : {}) };
}

const FRAGMENT_KIND = "workflow-fragment";
const FRAGMENT_SCHEMA_VERSION = 1;
const FRAGMENT_ID = /^[a-z][a-z0-9-]*$/;
const SEQUENTIAL_KINDS = new Set(["agent", "parallel", "map", "pipeline", "reduce", "checkpoint", "subworkflow"]);

function fragmentFailure(code) {
  return { ok: false, code };
}

function exactObject(value, required, optional = []) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isFragmentId(value) {
  return typeof value === "string" && value.length <= WORKFLOW_LIMITS.max_id_length && FRAGMENT_ID.test(value);
}

function boundedJsonValue(root) {
  const seen = new Set();
  let bytes = 0;
  const append = (text) => {
    bytes += Buffer.byteLength(text, "utf8");
    return bytes <= WORKFLOW_LIMITS.max_canonical_bytes;
  };
  const visit = (value, depth) => {
    if (depth > WORKFLOW_LIMITS.max_canonical_depth) return false;
    if (value === null || typeof value === "boolean") return append(JSON.stringify(value));
    if (typeof value === "number") return Number.isFinite(value) && append(JSON.stringify(value));
    if (typeof value === "string") {
      if (bytes + Buffer.byteLength(value, "utf8") + 2 > WORKFLOW_LIMITS.max_canonical_bytes) return false;
      return append(JSON.stringify(value));
    }
    if (typeof value !== "object" || seen.has(value) || types.isProxy(value)) return false;
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (!array && prototype !== Object.prototype && prototype !== null) return false;
    if (array) {
      const minimumBytes = value.length === 0 ? 2 : value.length * 2 + 1;
      if (bytes + minimumBytes > WORKFLOW_LIMITS.max_canonical_bytes) return false;
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) return false;
    seen.add(value);
    try {
      if (array) {
        if (keys.length !== value.length + 1
          || keys.some((key) => key !== "length" && !/^(0|[1-9][0-9]*)$/.test(key))
          || !append("[")) return false;
        for (let index = 0; index < value.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (!descriptor || descriptor.get != null || descriptor.set != null || descriptor.enumerable !== true
            || !Object.hasOwn(descriptor, "value")
            || (index > 0 && !append(","))
            || !visit(descriptor.value, depth + 1)) return false;
        }
        return append("]");
      }
      const descriptors = keys.map((key) => [key, Object.getOwnPropertyDescriptor(value, key)])
        .sort(([left], [right]) => lexicalCompare(left, right));
      if (descriptors.some(([_key, descriptor]) => !descriptor || descriptor.get != null || descriptor.set != null
        || descriptor.enumerable !== true || !Object.hasOwn(descriptor, "value"))
        || !append("{")) return false;
      for (let index = 0; index < descriptors.length; index += 1) {
        const [key, descriptor] = descriptors[index];
        if ((index > 0 && !append(","))
          || bytes + Buffer.byteLength(key, "utf8") + 3 > WORKFLOW_LIMITS.max_canonical_bytes
          || !append(JSON.stringify(key)) || !append(":")
          || !visit(descriptor.value, depth + 1)) return false;
      }
      return append("}");
    } finally {
      seen.delete(value);
    }
  };
  return visit(root, 0);
}

function cloneJson(value) {
  try {
    if (!boundedJsonValue(value)) return null;
    const cloned = structuredClone(value);
    return stableWorkflowStringify(cloned) == null ? null : cloned;
  } catch {
    return null;
  }
}

function targetSlots(node) {
  if (node === null || typeof node !== "object" || Array.isArray(node)) return null;
  if (SEQUENTIAL_KINDS.has(node.kind)) return ["next"];
  if (node.kind === "decision") {
    if (!Array.isArray(node.transitions) || node.default === null || typeof node.default !== "object" || Array.isArray(node.default)) return null;
    return [
      ...node.transitions.map((_entry, index) => `transitions[${index}].target`),
      "default.target",
      ...(Object.hasOwn(node, "loops_off") ? ["loops_off"] : []),
    ];
  }
  if (node.kind === "gate") return [
    "on_pass", "on_fail", ...(Object.hasOwn(node, "loops_off") ? ["loops_off"] : []),
  ];
  if (node.kind === "terminal") return [];
  return null;
}

function targetValue(node, field) {
  if (field === "next" || field === "on_pass" || field === "on_fail" || field === "loops_off") return node[field];
  if (field === "default.target") return node.default?.target;
  const match = /^transitions\[([0-9]+)\]\.target$/.exec(field);
  return match ? node.transitions?.[Number(match[1])]?.target : undefined;
}

function setTarget(node, field, value) {
  if (field === "next" || field === "on_pass" || field === "on_fail" || field === "loops_off") {
    node[field] = value;
    return true;
  }
  if (field === "default.target" && node.default && typeof node.default === "object") {
    node.default.target = value;
    return true;
  }
  const match = /^transitions\[([0-9]+)\]\.target$/.exec(field);
  const transition = match ? node.transitions?.[Number(match[1])] : null;
  if (!transition || typeof transition !== "object") return false;
  transition.target = value;
  return true;
}

function conditionPaths(condition, output = []) {
  if (condition === null || typeof condition !== "object" || Array.isArray(condition)) return output;
  if (typeof condition.path === "string") output.push({ owner: condition, field: "path" });
  if (Array.isArray(condition.conditions)) condition.conditions.forEach((entry) => conditionPaths(entry, output));
  if (condition.condition) conditionPaths(condition.condition, output);
  return output;
}

function outputPointerFields(node) {
  const fields = [];
  if (["map", "reduce"].includes(node.kind) && typeof node.items_path === "string") {
    fields.push({ owner: node, field: "items_path" });
  }
  if (node.kind === "decision" && Array.isArray(node.transitions)) {
    node.transitions.forEach((entry) => conditionPaths(entry?.when, fields));
  }
  return fields;
}

function outputPointerNode(pointer) {
  if (typeof pointer !== "string" || !pointer.startsWith("/outputs/")) return null;
  return pointer.slice("/outputs/".length).split("/", 1)[0];
}

function rewriteOutputPointer(pointer, ids) {
  const nodeId = outputPointerNode(pointer);
  if (nodeId == null) return pointer;
  const rewritten = ids.get(nodeId);
  return rewritten == null ? null : `/outputs/${rewritten}${pointer.slice(`/outputs/${nodeId}`.length)}`;
}

function normalizeFragment(value) {
  if (!exactObject(value, ["schema_version", "kind", "entry", "nodes", "exits"])
    || value.schema_version !== FRAGMENT_SCHEMA_VERSION || value.kind !== FRAGMENT_KIND
    || !isFragmentId(value.entry) || value.nodes === null || typeof value.nodes !== "object" || Array.isArray(value.nodes)
    || value.exits === null || typeof value.exits !== "object" || Array.isArray(value.exits)) {
    return fragmentFailure("workflow-fragment-invalid");
  }
  const cloned = cloneJson(value);
  if (cloned == null) return fragmentFailure("workflow-fragment-invalid");
  const nodeIds = Object.keys(cloned.nodes);
  if (nodeIds.length < 1 || nodeIds.length > WORKFLOW_LIMITS.max_nodes || !nodeIds.every(isFragmentId)
    || !Object.hasOwn(cloned.nodes, cloned.entry)) return fragmentFailure("workflow-fragment-invalid");
  const openSlots = new Set();
  for (const [port, slots] of Object.entries(cloned.exits)) {
    if (!isFragmentId(port) || !Array.isArray(slots) || slots.length < 1) return fragmentFailure("workflow-fragment-invalid");
    for (const slot of slots) {
      if (!exactObject(slot, ["node", "field"]) || !Object.hasOwn(cloned.nodes, slot.node)
        || !targetSlots(cloned.nodes[slot.node])?.includes(slot.field)) return fragmentFailure("workflow-fragment-invalid");
      const key = `${slot.node}:${slot.field}`;
      if (openSlots.has(key) || targetValue(cloned.nodes[slot.node], slot.field) !== null) {
        return fragmentFailure("workflow-fragment-port-invalid");
      }
      openSlots.add(key);
    }
  }
  for (const [id, node] of Object.entries(cloned.nodes)) {
    const slots = targetSlots(node);
    if (slots == null) return fragmentFailure("workflow-fragment-node-invalid");
    for (const field of slots) {
      const target = targetValue(node, field);
      const key = `${id}:${field}`;
      if (target === null) {
        if (!openSlots.has(key)) return fragmentFailure("workflow-fragment-port-dangling");
      } else if (!isFragmentId(target) || !Object.hasOwn(cloned.nodes, target)) {
        return fragmentFailure("workflow-fragment-target-dangling");
      }
    }
    for (const pointer of outputPointerFields(node)) {
      const target = outputPointerNode(pointer.owner[pointer.field]);
      if (target != null && !Object.hasOwn(cloned.nodes, target)) {
        return fragmentFailure("workflow-fragment-output-dangling");
      }
    }
  }
  const nodes = Object.fromEntries(Object.entries(cloned.nodes).sort(([left], [right]) => lexicalCompare(left, right)));
  const exits = Object.fromEntries(Object.entries(cloned.exits).sort(([left], [right]) => lexicalCompare(left, right))
    .map(([port, slots]) => [port, [...slots].sort((left, right) => lexicalCompare(`${left.node}:${left.field}`, `${right.node}:${right.field}`))]));
  return { ok: true, fragment: { schema_version: FRAGMENT_SCHEMA_VERSION, kind: FRAGMENT_KIND, entry: cloned.entry, nodes, exits } };
}

/** Create a closed, JSON-only graph fragment with explicit unresolved target ports. */
export function fragment(value = {}) {
  value = cloneJson(value);
  if (!exactObject(value, ["entry", "nodes"], ["exits"])) return fragmentFailure("workflow-fragment-invalid");
  return normalizeFragment({
    schema_version: FRAGMENT_SCHEMA_VERSION,
    kind: FRAGMENT_KIND,
    entry: value.entry,
    nodes: value.nodes,
    exits: value.exits ?? {},
  });
}

/** Connect an ordered list of next-bearing nodes and expose the final next port. */
export function sequence(entries, value = {}) {
  entries = cloneJson(entries);
  value = cloneJson(value);
  if (entries == null || value == null) return fragmentFailure("workflow-fragment-sequence-invalid");
  const { exit = "next" } = options(value);
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > WORKFLOW_LIMITS.max_nodes || !isFragmentId(exit)) {
    return fragmentFailure("workflow-fragment-sequence-invalid");
  }
  const nodes = {};
  for (const entry of entries) {
    if (!exactObject(entry, ["id", "node"]) || !isFragmentId(entry.id) || Object.hasOwn(nodes, entry.id)) {
      return fragmentFailure("workflow-fragment-sequence-invalid");
    }
    const node = cloneJson(entry.node);
    if (node == null || !SEQUENTIAL_KINDS.has(node.kind) || ![null, undefined].includes(node.next)) {
      return fragmentFailure("workflow-fragment-sequence-invalid");
    }
    nodes[entry.id] = node;
  }
  for (let index = 0; index < entries.length; index += 1) {
    nodes[entries[index].id].next = entries[index + 1]?.id ?? null;
  }
  return fragment({ entry: entries[0].id, nodes, exits: { [exit]: [{ node: entries.at(-1).id, field: "next" }] } });
}

/** Build one decision node whose branch targets are explicit named fragment ports. */
export function conditional(value = {}) {
  value = cloneJson(value);
  if (!exactObject(value, ["id", "branches", "fallback"], ["loops_off", "label"])) {
    return fragmentFailure("workflow-fragment-conditional-invalid");
  }
  if (!isFragmentId(value.id) || !isFragmentId(value.fallback) || !Array.isArray(value.branches)
    || value.branches.length > WORKFLOW_LIMITS.max_transitions || (value.loops_off != null && !isFragmentId(value.loops_off))) {
    return fragmentFailure("workflow-fragment-conditional-invalid");
  }
  const ports = [value.fallback, ...(value.loops_off ? [value.loops_off] : [])];
  const transitions = [];
  for (const branch of value.branches) {
    if (!exactObject(branch, ["port", "when"], ["loop"]) || !isFragmentId(branch.port)
      || (branch.loop != null && typeof branch.loop !== "boolean") || cloneJson(branch.when) == null) {
      return fragmentFailure("workflow-fragment-conditional-invalid");
    }
    ports.push(branch.port);
    transitions.push({ when: cloneJson(branch.when), target: null, ...(branch.loop === true ? { loop: true } : {}) });
  }
  if (new Set(ports).size !== ports.length) return fragmentFailure("workflow-fragment-port-collision");
  const node = {
    kind: "decision",
    transitions,
    default: { target: null },
    ...(value.loops_off ? { loops_off: null } : {}),
    ...(value.label ? { label: value.label } : {}),
  };
  const exits = Object.fromEntries([
    ...value.branches.map((branch, index) => [branch.port, [{ node: value.id, field: `transitions[${index}].target` }]]),
    [value.fallback, [{ node: value.id, field: "default.target" }]],
    ...(value.loops_off ? [[value.loops_off, [{ node: value.id, field: "loops_off" }]]] : []),
  ]);
  return fragment({ entry: value.id, nodes: { [value.id]: node }, exits });
}

/** Build a bounded optimizer -> evaluator -> route cycle with explicit completion ports. */
export function evaluatorOptimizerLoop(value = {}) {
  value = cloneJson(value);
  const optional = ["decision_id", "max_visits", "done", "loops_off", "label"];
  if (!exactObject(value, ["optimizer", "evaluator", "approve_when"], optional)) {
    return fragmentFailure("workflow-fragment-evaluator-optimizer-invalid");
  }
  const decisionId = value.decision_id ?? "route";
  const done = value.done ?? "done";
  const loopsOff = value.loops_off ?? "loops-off";
  const maxVisits = value.max_visits ?? WORKFLOW_DEFAULTS.max_visits;
  if (![value.optimizer, value.evaluator].every((entry) => exactObject(entry, ["id", "node"]))
    || ![value.optimizer.id, value.evaluator.id, decisionId, done, loopsOff].every(isFragmentId)
    || new Set([value.optimizer.id, value.evaluator.id, decisionId]).size !== 3 || done === loopsOff
    || !Number.isSafeInteger(maxVisits) || maxVisits < 1 || maxVisits > WORKFLOW_LIMITS.max_node_visits) {
    return fragmentFailure("workflow-fragment-evaluator-optimizer-invalid");
  }
  const optimizerNode = cloneJson(value.optimizer.node);
  const evaluatorNode = cloneJson(value.evaluator.node);
  const approveWhen = cloneJson(value.approve_when);
  if ([optimizerNode, evaluatorNode, approveWhen].some((entry) => entry == null)
    || ![optimizerNode.kind, evaluatorNode.kind].every((kind) => ["agent", "pipeline"].includes(kind))
    || ![optimizerNode.next, evaluatorNode.next].every((next) => next == null)) {
    return fragmentFailure("workflow-fragment-evaluator-optimizer-invalid");
  }
  optimizerNode.next = value.evaluator.id;
  optimizerNode.max_visits = maxVisits;
  evaluatorNode.next = decisionId;
  evaluatorNode.max_visits = maxVisits;
  return fragment({
    entry: value.optimizer.id,
    nodes: {
      [value.optimizer.id]: optimizerNode,
      [value.evaluator.id]: evaluatorNode,
      [decisionId]: {
        kind: "decision",
        transitions: [{ when: approveWhen, target: null }],
        default: { target: value.optimizer.id, loop: true },
        loops_off: null,
        ...(value.label ? { label: value.label } : {}),
      },
    },
    exits: {
      [done]: [{ node: decisionId, field: "transitions[0].target" }],
      [loopsOff]: [{ node: decisionId, field: "loops_off" }],
    },
  });
}

/** Connect a bounded map/parallel fan-out to a deterministic reduce node. */
export function fanOutReduce(value = {}) {
  value = cloneJson(value);
  const optional = ["items_path", "strategy", "separator", "exit", "label"];
  if (!exactObject(value, ["fan_out", "reduce_id"], optional) || !exactObject(value.fan_out, ["id", "node"])) {
    return fragmentFailure("workflow-fragment-fan-out-reduce-invalid");
  }
  const exit = value.exit ?? "next";
  const strategy = value.strategy ?? "collect";
  if (![value.fan_out.id, value.reduce_id, exit].every(isFragmentId) || value.fan_out.id === value.reduce_id) {
    return fragmentFailure("workflow-fragment-fan-out-reduce-invalid");
  }
  const fanOut = cloneJson(value.fan_out.node);
  if (fanOut == null || !["map", "parallel"].includes(fanOut.kind) || fanOut.next != null) {
    return fragmentFailure("workflow-fragment-fan-out-reduce-invalid");
  }
  fanOut.next = value.reduce_id;
  const reduced = reduce(value.items_path ?? `/outputs/${value.fan_out.id}`, strategy, null, {
    ...(value.separator != null ? { separator: value.separator } : {}),
    ...(value.label ? { label: value.label } : {}),
  });
  return fragment({
    entry: value.fan_out.id,
    nodes: { [value.fan_out.id]: fanOut, [value.reduce_id]: reduced },
    exits: { [exit]: [{ node: value.reduce_id, field: "next" }] },
  });
}

function namespaceFragment(namespace, source) {
  const checked = normalizeFragment(source);
  if (!checked.ok || !isFragmentId(namespace)) return fragmentFailure("workflow-fragment-namespace-invalid");
  const ids = new Map(Object.keys(checked.fragment.nodes).map((id) => [id, `${namespace}-${id}`]));
  if ([...ids.values()].some((id) => !isFragmentId(id))) return fragmentFailure("workflow-fragment-namespace-invalid");
  const nodes = {};
  for (const [id, sourceNode] of Object.entries(checked.fragment.nodes)) {
    const node = cloneJson(sourceNode);
    for (const field of targetSlots(node)) {
      const target = targetValue(node, field);
      if (target != null && !setTarget(node, field, ids.get(target))) return fragmentFailure("workflow-fragment-target-dangling");
    }
    for (const pointer of outputPointerFields(node)) {
      const rewritten = rewriteOutputPointer(pointer.owner[pointer.field], ids);
      if (rewritten == null) return fragmentFailure("workflow-fragment-output-dangling");
      pointer.owner[pointer.field] = rewritten;
    }
    nodes[ids.get(id)] = node;
  }
  const ports = new Map(Object.entries(checked.fragment.exits).map(([port, slots]) => [port, slots.map((slot) => ({
    node: ids.get(slot.node), field: slot.field,
  }))]));
  return { ok: true, entry: ids.get(checked.fragment.entry), nodes, ports };
}

/** Namespace and connect fragments. Every source port must be connected or explicitly exported. */
export function composeFragments(value = {}) {
  value = cloneJson(value);
  if (!exactObject(value, ["fragments", "entry"], ["connections", "exports"]) || !Array.isArray(value.fragments)
    || value.fragments.length < 1 || !isFragmentId(value.entry) || !Array.isArray(value.connections ?? [])) {
    return fragmentFailure("workflow-fragment-composition-invalid");
  }
  const specs = [...value.fragments];
  if (specs.some((entry) => !exactObject(entry, ["namespace", "fragment"]) || !isFragmentId(entry.namespace))
    || new Set(specs.map((entry) => entry.namespace)).size !== specs.length) {
    return fragmentFailure("workflow-fragment-composition-invalid");
  }
  specs.sort((left, right) => lexicalCompare(left.namespace, right.namespace));
  const compiled = new Map();
  const nodes = {};
  const ports = new Map();
  for (const spec of specs) {
    const namespaced = namespaceFragment(spec.namespace, spec.fragment);
    if (!namespaced.ok) return namespaced;
    compiled.set(spec.namespace, namespaced);
    for (const [id, node] of Object.entries(namespaced.nodes)) {
      if (Object.hasOwn(nodes, id)) return fragmentFailure("workflow-fragment-node-collision");
      nodes[id] = node;
    }
    for (const [port, slots] of namespaced.ports) ports.set(`${spec.namespace}.${port}`, slots);
  }
  if (!compiled.has(value.entry)) return fragmentFailure("workflow-fragment-composition-invalid");
  const used = new Set();
  const connections = [...(value.connections ?? [])];
  if (connections.some((entry) => !exactObject(entry, ["from", "to"])
    || typeof entry.from !== "string" || !isFragmentId(entry.to))) {
    return fragmentFailure("workflow-fragment-connection-invalid");
  }
  connections.sort((left, right) => lexicalCompare(`${left.from}:${left.to}`, `${right.from}:${right.to}`));
  for (const connection of connections) {
    const slots = ports.get(connection.from);
    const target = compiled.get(connection.to)?.entry;
    if (!slots || !target || used.has(connection.from)) return fragmentFailure("workflow-fragment-connection-invalid");
    for (const slot of slots) if (!setTarget(nodes[slot.node], slot.field, target)) return fragmentFailure("workflow-fragment-connection-invalid");
    used.add(connection.from);
  }
  const exported = value.exports ?? {};
  if (exported === null || typeof exported !== "object" || Array.isArray(exported)) {
    return fragmentFailure("workflow-fragment-export-invalid");
  }
  const exits = {};
  for (const [port, source] of Object.entries(exported).sort(([left], [right]) => lexicalCompare(left, right))) {
    if (!isFragmentId(port) || typeof source !== "string" || !ports.has(source) || used.has(source)) {
      return fragmentFailure("workflow-fragment-export-invalid");
    }
    exits[port] = ports.get(source);
    used.add(source);
  }
  if ([...ports.keys()].some((port) => !used.has(port))) return fragmentFailure("workflow-fragment-port-dangling");
  return fragment({ entry: compiled.get(value.entry).entry, nodes, exits });
}

export function workflow(value = {}) {
  const { id, name, description, version = 1, source = "user", inputs, start, nodes, limits = {}, provider_policy, workspace_policy, objective_gate } = options(value);
  const safeLimits = options(limits);
  const definition = {
    schema_version: WORKFLOW_SCHEMA_VERSION,
    id,
    name,
    description,
    version,
    source,
    inputs: inputs ?? {
      type: "object", additionalProperties: false, required: ["task"],
      properties: { task: { type: "string", minLength: 1, maxLength: WORKFLOW_LIMITS.max_input_string_length } },
    },
    start,
    nodes,
    limits: {
      max_total_effects: safeLimits.max_total_effects ?? WORKFLOW_DEFAULTS.max_total_effects,
      max_concurrency: safeLimits.max_concurrency ?? WORKFLOW_DEFAULTS.max_concurrency,
      max_map_items: safeLimits.max_map_items ?? WORKFLOW_DEFAULTS.max_map_items,
      max_run_ms: safeLimits.max_run_ms ?? WORKFLOW_DEFAULTS.max_run_ms,
      max_call_ms: safeLimits.max_call_ms ?? WORKFLOW_DEFAULTS.max_call_ms,
      structured_repair_attempts: safeLimits.structured_repair_attempts ?? WORKFLOW_DEFAULTS.structured_repair_attempts,
    },
    provider_policy: provider_policy ?? {
      exact: true, assignments: {}, default_assignment: { kind: "composite", preset: "daily" }, require_live_certification: false,
    },
    workspace_policy: workspace_policy ?? { mode: "canonical-worktree", proposal_cleanup: "unchanged", transcripts: "off" },
    objective_gate,
  };
  const valid = validateWorkflowDefinition(definition);
  return valid.valid ? { ok: true, definition } : { ok: false, code: "invalid-workflow-v4", errors: valid.errors };
}
