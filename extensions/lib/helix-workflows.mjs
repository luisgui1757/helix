// User-local workflow persistence. Installed package workflows are immutable;
// user workflows live under <Pi agent dir>/helix/workflows and are atomically
// written so package upgrades cannot erase them.

import { existsSync, lstatSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { writeTextAtomic } from "../../dispatch/lib/persistence.mjs";
import {
  validateWorkflow,
  workflowFromExecution,
} from "../../dispatch/lib/workflows.mjs";
import {
  stableWorkflowStringify,
  validateWorkflowDefinition,
  WORKFLOW_LIMITS,
} from "../../dispatch/workflow/schema.mjs";

export const WORKFLOW_CODES = Object.freeze({
  INVALID: "invalid-workflow",
  UNREADABLE: "helix-workflow-unreadable",
  EXISTS: "helix-workflow-exists",
  UNKNOWN: "unknown-workflow",
  SHADOWS_BUILTIN: "helix-workflow-shadows-built-in",
  WRITE_FAILED: "helix-workflow-write-failed",
  DELETE_FAILED: "helix-workflow-delete-failed",
});

const WORKFLOW_ID = /^[a-z0-9][a-z0-9._-]*$/;
const MAX_WORKFLOW_FILE_BYTES = WORKFLOW_LIMITS.max_workflow_read_bytes;

function isWorkflowId(id) {
  return typeof id === "string" && id.length <= 64 && WORKFLOW_ID.test(id);
}

export function workflowsDir(root) {
  return join(root, "workflows");
}

export function listUserWorkflows(root) {
  const dir = workflowsDir(root);
  if (!existsSync(dir)) return { ok: true, workflows: [] };
  const workflows = [];
  let names;
  try {
    if (!lstatSync(dir).isDirectory()) return { ok: false, code: WORKFLOW_CODES.UNREADABLE, detail: "workflows" };
    names = readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
  } catch {
    return { ok: false, code: WORKFLOW_CODES.UNREADABLE, detail: "workflows" };
  }
  for (const name of names) {
    try {
      const path = join(dir, name);
      const entry = lstatSync(path);
      if (entry.isSymbolicLink() || !entry.isFile() || entry.size > MAX_WORKFLOW_FILE_BYTES) {
        return { ok: false, code: WORKFLOW_CODES.UNREADABLE, detail: name };
      }
      const workflow = JSON.parse(readFileSync(path, "utf8"));
      const valid = workflow.schema_version === 4 ? validateWorkflowDefinition(workflow) : validateWorkflow(workflow);
      if (!valid.valid || workflow.source !== "user" || `${workflow.id}.json` !== name) {
        return { ok: false, code: WORKFLOW_CODES.INVALID, detail: name };
      }
      workflows.push(workflow);
    } catch {
      return { ok: false, code: WORKFLOW_CODES.UNREADABLE, detail: name };
    }
  }
  return { ok: true, workflows };
}

export function saveUserWorkflow(root, workflow, { replace = false, builtInIds = [] } = {}) {
  const valid = validateWorkflow(workflow);
  if (!valid.valid || workflow.source !== "user") {
    return { ok: false, code: WORKFLOW_CODES.INVALID, detail: valid.errors?.map((entry) => entry.path).join(",") ?? "source" };
  }
  if (builtInIds.includes(workflow.id)) return { ok: false, code: WORKFLOW_CODES.SHADOWS_BUILTIN, detail: workflow.id };
  const path = join(workflowsDir(root), `${workflow.id}.json`);
  try {
    if (existsSync(path) && !replace) return { ok: false, code: WORKFLOW_CODES.EXISTS, detail: workflow.id };
    writeTextAtomic(root, join("workflows", `${workflow.id}.json`), `${JSON.stringify(workflow, null, 2)}\n`, { replace });
  } catch {
    return { ok: false, code: WORKFLOW_CODES.WRITE_FAILED, detail: workflow.id };
  }
  return { ok: true, workflow_id: workflow.id, path };
}

export function saveUserWorkflowV4(root, definition, { replace = false, builtInIds = [] } = {}) {
  const valid = validateWorkflowDefinition(definition);
  if (!valid.valid || definition.source !== "user") {
    return { ok: false, code: WORKFLOW_CODES.INVALID, detail: valid.errors?.map((entry) => entry.path).join(",") ?? "source" };
  }
  if (builtInIds.includes(definition.id)) return { ok: false, code: WORKFLOW_CODES.SHADOWS_BUILTIN, detail: definition.id };
  const serialized = stableWorkflowStringify(definition);
  if (typeof serialized !== "string" || Buffer.byteLength(serialized, "utf8") > WORKFLOW_LIMITS.max_workflow_bytes) {
    return { ok: false, code: WORKFLOW_CODES.INVALID, detail: "serialized-definition" };
  }
  const path = join(workflowsDir(root), `${definition.id}.json`);
  try {
    if (existsSync(path) && !replace) return { ok: false, code: WORKFLOW_CODES.EXISTS, detail: definition.id };
    writeTextAtomic(root, join("workflows", `${definition.id}.json`), `${serialized}\n`, { replace });
  } catch {
    return { ok: false, code: WORKFLOW_CODES.WRITE_FAILED, detail: definition.id };
  }
  return { ok: true, workflow_id: definition.id, path };
}

export function deleteUserWorkflow(root, id) {
  if (!isWorkflowId(id)) return { ok: false, code: WORKFLOW_CODES.UNKNOWN, detail: "workflow-id-invalid" };
  const path = join(workflowsDir(root), `${id}.json`);
  try {
    if (!existsSync(path)) return { ok: false, code: WORKFLOW_CODES.UNKNOWN, detail: id };
    const entry = lstatSync(path);
    if (entry.isSymbolicLink() || !entry.isFile() || entry.size > MAX_WORKFLOW_FILE_BYTES) {
      return { ok: false, code: WORKFLOW_CODES.UNREADABLE, detail: id };
    }
    const workflow = JSON.parse(readFileSync(path, "utf8"));
    const valid = workflow.schema_version === 4 ? validateWorkflowDefinition(workflow) : validateWorkflow(workflow);
    if (workflow.id !== id || workflow.source !== "user" || !valid.valid) {
      return { ok: false, code: WORKFLOW_CODES.INVALID, detail: id };
    }
    unlinkSync(path);
    return { ok: true, workflow_id: id };
  } catch {
    return { ok: false, code: WORKFLOW_CODES.DELETE_FAILED, detail: id };
  }
}

export function builtInWorkflows(chainRegistry, runRegistry) {
  const configByChain = new Map((runRegistry?.configs ?? []).map((config) => [config.chain, config]));
  return (chainRegistry?.chains ?? []).flatMap((chain) => {
    const config = configByChain.get(chain.id);
    return config ? [workflowFromExecution(chain, config, { source: "built-in" })] : [];
  });
}

export function workflowCatalog(root, chainRegistry, runRegistry) {
  const builtIns = builtInWorkflows(chainRegistry, runRegistry);
  const users = listUserWorkflows(root);
  if (!users.ok) return users;
  const builtInIds = new Set(builtIns.map((workflow) => workflow.id));
  const shadow = users.workflows.find((workflow) => builtInIds.has(workflow.id));
  if (shadow) return { ok: false, code: WORKFLOW_CODES.SHADOWS_BUILTIN, detail: shadow.id };
  return { ok: true, workflows: [...builtIns, ...users.workflows] };
}

export function resolveWorkflow(root, id, chainRegistry, runRegistry) {
  if (!isWorkflowId(id)) return { ok: false, code: WORKFLOW_CODES.UNKNOWN, detail: "workflow-id-invalid" };
  const catalog = workflowCatalog(root, chainRegistry, runRegistry);
  if (!catalog.ok) return catalog;
  const workflow = catalog.workflows.find((candidate) => candidate.id === id);
  return workflow
    ? { ok: true, workflow }
    : { ok: false, code: WORKFLOW_CODES.UNKNOWN, detail: "workflow-id-not-found" };
}
