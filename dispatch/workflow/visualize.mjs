// Public-safe planned and observed graph projections. Stable node ids join the
// two views; prompts, tasks, provider payloads, and account ids never render.

import { validateWorkflowDefinition } from "./schema.mjs";

function targets(node) {
  if (["agent", "parallel", "map", "pipeline", "reduce", "checkpoint", "subworkflow"].includes(node.kind)) return [node.next];
  if (node.kind === "decision") return [...node.transitions.map((entry) => entry.target), node.default.target, ...(node.loops_off ? [node.loops_off] : [])];
  if (node.kind === "gate") return [node.on_pass, node.on_fail, ...(node.loops_off ? [node.loops_off] : [])];
  return [];
}

export function plannedWorkflowGraph(definition) {
  const valid = validateWorkflowDefinition(definition);
  if (!valid.valid) return { ok: false, code: "invalid-workflow-v4" };
  return {
    ok: true,
    start: definition.start,
    limits: structuredClone(definition.limits),
    nodes: Object.entries(definition.nodes).sort(([left], [right]) => left.localeCompare(right)).map(([id, node]) => ({
      id,
      kind: node.kind,
      label: node.label ?? id,
      targets: targets(node),
      ...(node.kind === "agent" ? { role: node.role, mutation: node.mutation } : {}),
      ...(node.kind === "pipeline" ? { roles: node.stages.map((stage) => stage.role), max_visits: node.max_visits } : {}),
      ...(node.kind === "parallel" ? { branches: node.branches.length, max_concurrency: node.max_concurrency } : {}),
      ...(node.kind === "map" ? { max_items: node.max_items } : {}),
      ...(node.kind === "gate" ? { final: node.final === true } : {}),
      ...(node.kind === "terminal" ? { status: node.status } : {}),
    })),
  };
}

export function observedWorkflowGraph(definition, events = []) {
  const planned = plannedWorkflowGraph(definition);
  if (!planned.ok) return planned;
  if (!Array.isArray(events)) return { ok: false, code: "workflow-events-invalid" };
  const byNode = new Map(planned.nodes.map((node) => [node.id, { ...node, visits: 0, effects: 0, status: "pending" }]));
  const edges = [];
  for (const event of events) {
    if (typeof event?.node_id !== "string" || !byNode.has(event.node_id)) continue;
    const node = byNode.get(event.node_id);
    if (event.kind === "node-start") {
      node.visits += 1;
      node.status = "running";
    }
    if (event.kind === "effect-end") node.effects += 1;
    if (event.kind === "node-end") node.status = event.status ?? "completed";
    if (event.kind === "transition" && typeof event.target === "string") edges.push({ from: event.node_id, to: event.target });
  }
  return { ...planned, nodes: [...byNode.values()], observed_edges: edges };
}
