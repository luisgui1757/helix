// Provider-free runtime smoke test for one user workflow. Every accepted shape
// is normalized to WorkflowDefinition v4 and executed by the real workflow
// kernel in a temporary detached Git worktree. Model and objective effects are
// deterministic test boundaries; routing, limits, events, and cleanup are real.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { journalRef } from "../../dispatch/kernel/journal.mjs";
import { runWorkflowKernel } from "../../dispatch/kernel/scheduler.mjs";
import { normalizeWorkflowDefinition } from "../../dispatch/workflow/schema.mjs";

function git(cwd, args) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function targets(node) {
  if (["agent", "parallel", "map", "pipeline", "reduce", "checkpoint", "subworkflow"].includes(node.kind)) return [node.next];
  if (node.kind === "decision") return [...node.transitions.map((entry) => entry.target), node.default.target, ...(node.loops_off ? [node.loops_off] : [])];
  if (node.kind === "gate") return [node.on_pass, node.on_fail, ...(node.loops_off ? [node.loops_off] : [])];
  return [];
}

function distanceTo(definition, start, target) {
  const queue = [[start, 0]];
  const seen = new Set();
  while (queue.length > 0) {
    const [id, distance] = queue.shift();
    if (id === target) return distance;
    if (seen.has(id) || !definition.nodes[id]) continue;
    seen.add(id);
    for (const next of targets(definition.nodes[id])) queue.push([next, distance + 1]);
  }
  return Number.POSITIVE_INFINITY;
}

function preferredGateResult(definition, nodeId, finalGateId) {
  if (nodeId === finalGateId) return "pass";
  const node = definition.nodes[nodeId];
  return distanceTo(definition, node.on_pass, finalGateId) <= distanceTo(definition, node.on_fail, finalGateId)
    ? "pass"
    : "fail";
}

function preferredOutputs(definition, finalGateId) {
  const preferred = new Map();
  for (const node of Object.values(definition.nodes)) {
    if (node.kind !== "decision") continue;
    const ordered = [...node.transitions].sort((left, right) =>
      distanceTo(definition, left.target, finalGateId) - distanceTo(definition, right.target, finalGateId));
    for (const transition of ordered) {
      if (transition.when?.op !== "eq" || typeof transition.when.path !== "string") continue;
      const byRole = transition.when.path.match(/^\/outputs\/([^/]+)\/by_role\/([^/]+)\/([^/]+)$/);
      if (byRole) {
        preferred.set(`${byRole[1]}:${byRole[2]}:${byRole[3]}`, transition.when.value);
        break;
      }
      const direct = transition.when.path.match(/^\/outputs\/([^/]+)\/value\/([^/]+)$/);
      if (direct) {
        preferred.set(`${direct[1]}:*:${direct[2]}`, transition.when.value);
        break;
      }
    }
  }
  return preferred;
}

function smokeValue(preferred, nodeId, role) {
  const value = {
    recommendation: preferred.get(`${nodeId}:${role}:recommendation`)
      ?? preferred.get(`${nodeId}:*:recommendation`)
      ?? "approve",
    summary: "deterministic workflow-kernel smoke output",
    risks: [],
    evidence: [],
  };
  for (const [key, selected] of preferred) {
    const [candidateNode, candidateRole, field] = key.split(":");
    if (candidateNode === nodeId && (candidateRole === role || candidateRole === "*")) value[field] = selected;
  }
  return value;
}

function smokeValueForSchema(schema) {
  if (Object.hasOwn(schema, "default")) return structuredClone(schema.default);
  if (schema.type === "object") {
    return Object.fromEntries((schema.required ?? []).map((key) => [key, smokeValueForSchema(schema.properties[key])]));
  }
  if (schema.type === "array") {
    return Array.from({ length: schema.minItems ?? 0 }, () => smokeValueForSchema(schema.items));
  }
  if (schema.type === "string") return "s".repeat(Math.max(1, schema.minLength ?? 0)).slice(0, schema.maxLength ?? 65_536);
  if (schema.type === "boolean") return false;
  if (schema.type === "integer") {
    const minimum = schema.minimum == null ? Number.MIN_SAFE_INTEGER : Math.ceil(schema.minimum);
    const maximum = schema.maximum == null ? Number.MAX_SAFE_INTEGER : Math.floor(schema.maximum);
    return minimum <= 0 && maximum >= 0 ? 0 : minimum > 0 ? minimum : maximum;
  }
  if (schema.type === "number") {
    const minimum = schema.minimum ?? Number.NEGATIVE_INFINITY;
    const maximum = schema.maximum ?? Number.POSITIVE_INFINITY;
    return minimum <= 0 && maximum >= 0 ? 0 : Number.isFinite(minimum) ? minimum : maximum;
  }
  return null;
}

function smokeInput(definition) {
  return smokeValueForSchema(definition.inputs);
}

function worktreeRef(cwd) {
  const head = git(cwd, ["rev-parse", "HEAD"]);
  const status = git(cwd, ["status", "--porcelain=v1", "-z"]);
  if (head.status !== 0 || status.status !== 0) return null;
  return journalRef({ head: head.stdout.trim(), status: status.stdout });
}

export async function smokeTestWorkflowRuntime({ workflow, subworkflows = [], cwd, signal = null, onEvent = null } = {}) {
  const normalized = normalizeWorkflowDefinition(workflow);
  if (!normalized.ok) return { ok: false, code: normalized.code ?? "workflow-runtime-smoke-invalid" };
  const definition = normalized.definition;
  const children = new Map();
  for (const candidate of subworkflows) {
    const child = normalizeWorkflowDefinition(candidate);
    if (!child.ok || Object.values(child.definition.nodes).some((node) => node.kind === "subworkflow")) {
      return { ok: false, code: "kernel-subworkflow-binding-invalid" };
    }
    children.set(`${child.definition.id}@${child.definition.version}`, child.definition);
  }
  for (const node of Object.values(definition.nodes)) {
    if (node.kind === "subworkflow" && !children.has(`${node.workflow_id}@${node.version}`)) {
      return { ok: false, code: "kernel-subworkflow-binding-invalid" };
    }
  }
  const top = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (top.status !== 0 || !top.stdout.trim()) return { ok: false, code: "workflow-runtime-smoke-git-required" };
  const repoRoot = top.stdout.trim();
  const root = mkdtempSync(join(tmpdir(), "helix-workflow-smoke-"));
  const checkout = join(root, "repo");
  const events = [];
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
      const definitions = [definition, ...children.values()];
      const finalGates = new Map(definitions.map((entry) => [entry.id, Object.keys(entry.nodes)
        .find((id) => entry.nodes[id].kind === "gate" && entry.nodes[id].final === true)]));
      const preferredByDefinition = new Map(definitions.map((entry) => [entry.id, preferredOutputs(entry, finalGates.get(entry.id))]));
      const workspace = {
        cwd: checkout,
        currentRef: () => worktreeRef(checkout),
        verifyRef: (ref) => ref === worktreeRef(checkout),
        async begin() { return { ok: true, cwd: checkout, before_ref: worktreeRef(checkout) }; },
        async commit() { return { ok: true, workspace_ref: worktreeRef(checkout) }; },
        async rollback() { return { ok: true }; },
      };
      result = await runWorkflowKernel(definition, smokeInput(definition), {
        run_id: `smoke-${process.pid}-${Date.now().toString(36)}`,
        cwd: checkout,
        signal,
        workspace,
        async executeAgent(agent, ctx) {
          return { ok: true, value: smokeValue(preferredByDefinition.get(ctx.definition_id), ctx.node_id, agent.role), usage: { tokens: 0, cost_micros: 0 } };
        },
        async runGate(_gate, ctx) {
          const activeDefinition = definitions.find((entry) => entry.id === ctx.definition_id);
          return { result: preferredGateResult(activeDefinition, ctx.node_id, finalGates.get(ctx.definition_id)), evidence_ref: journalRef({ smoke: ctx.node_id }) };
        },
        async checkpoint() { return { continue: true }; },
        resolveSubworkflow: (id, version) => children.get(`${id}@${version}`) ?? null,
        depth: 0,
        onEvent(event) {
          events.push(structuredClone(event));
          onEvent?.(structuredClone(event));
        },
      });
    }
  } catch {
    failure = "workflow-runtime-smoke-failed";
  } finally {
    if (added && git(repoRoot, ["worktree", "remove", "--force", checkout]).status !== 0) cleanupOk = false;
    rmSync(root, { recursive: true, force: true });
  }
  if (!cleanupOk) return { ok: false, code: "workflow-runtime-smoke-cleanup-failed" };
  if (failure) return { ok: false, code: failure };
  if (!result?.ok || result.status !== "succeeded") {
    return { ok: false, code: result?.code ?? "workflow-runtime-smoke-failed" };
  }
  const nodeIds = new Set(events.flatMap((event) => event.kind === "node-start"
    ? [`${event.run_id}:${event.node_id}`]
    : event.kind === "subworkflow-event" && event.child_kind === "node-start" && event.child_node_id
      ? [`${event.child_run_id}:${event.child_node_id}`]
      : []));
  const finalGate = events.find((event) => event.kind === "gate" && event.final === true);
  return {
    ok: true,
    runner: "workflow-kernel-v4",
    provider_calls: 0,
    objective_check: "simulated",
    nodes_exercised: nodeIds.size,
    effects_exercised: events.filter((event) => event.kind === "effect-end"
      || (event.kind === "subworkflow-event" && event.child_kind === "effect-end")).length,
    transitions_exercised: events.filter((event) => event.kind === "transition"
      || (event.kind === "subworkflow-event" && event.child_kind === "transition")).length,
    objective_gate_exercised: finalGate?.result === "pass",
  };
}
