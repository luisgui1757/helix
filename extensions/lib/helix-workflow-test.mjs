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
  if (node.kind === "decision") return [...node.transitions.map((entry) => entry.target), node.default, ...(node.loops_off ? [node.loops_off] : [])];
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

function smokeInput(definition) {
  const input = { task: "Exercise this workflow definition without provider calls." };
  for (const key of definition.inputs.required) {
    if (key === "task") continue;
    const schema = definition.inputs.properties[key] ?? {};
    if (schema.type === "array") input[key] = [];
    else if (schema.type === "object") input[key] = {};
    else if (schema.type === "boolean") input[key] = false;
    else if (schema.type === "integer" || schema.type === "number") input[key] = schema.minimum ?? 0;
    else input[key] = "smoke";
  }
  return input;
}

function worktreeRef(cwd) {
  const head = git(cwd, ["rev-parse", "HEAD"]);
  const status = git(cwd, ["status", "--porcelain=v1", "-z"]);
  if (head.status !== 0 || status.status !== 0) return null;
  return journalRef({ head: head.stdout.trim(), status: status.stdout });
}

export async function smokeTestWorkflowRuntime({ workflow, cwd, signal = null, onEvent = null } = {}) {
  const normalized = normalizeWorkflowDefinition(workflow);
  if (!normalized.ok) return { ok: false, code: normalized.code ?? "workflow-runtime-smoke-invalid" };
  const definition = normalized.definition;
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
      const finalGateId = Object.keys(definition.nodes)
        .find((id) => definition.nodes[id].kind === "gate" && definition.nodes[id].final === true);
      const preferred = preferredOutputs(definition, finalGateId);
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
          return { ok: true, value: smokeValue(preferred, ctx.node_id, agent.role), usage: { tokens: 0, cost_micros: 0 } };
        },
        async runGate(_gate, ctx) {
          return { result: preferredGateResult(definition, ctx.node_id, finalGateId), evidence_ref: journalRef({ smoke: ctx.node_id }) };
        },
        async checkpoint() { return { continue: true }; },
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
  const nodeIds = new Set(events.filter((event) => event.kind === "node-start").map((event) => event.node_id));
  const finalGate = events.find((event) => event.kind === "gate" && event.final === true);
  return {
    ok: true,
    runner: "workflow-kernel-v4",
    provider_calls: 0,
    objective_check: "simulated",
    nodes_exercised: nodeIds.size,
    effects_exercised: events.filter((event) => event.kind === "effect-end").length,
    transitions_exercised: events.filter((event) => event.kind === "transition").length,
    objective_gate_exercised: finalGate?.result === "pass",
  };
}
