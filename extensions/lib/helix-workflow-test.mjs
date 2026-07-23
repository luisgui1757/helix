// Provider-free runtime smoke test for one user workflow. Every accepted shape
// is normalized to WorkflowDefinition v4 and executed by the real workflow
// kernel in a temporary detached Git worktree. Model and objective effects are
// deterministic test boundaries; routing, limits, events, and cleanup are real.

import {
  chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync,
  realpathSync, rmdirSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { devNull, tmpdir } from "node:os";
import { delimiter, dirname, join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { journalRef } from "../../dispatch/kernel/journal.mjs";
import { writeTextAtomic } from "../../dispatch/lib/persistence.mjs";
import { hashRef } from "../../dispatch/lib/run-record.mjs";
import { makeObjectiveGate, objectiveGateWorkspaceRef } from "../../dispatch/lib/task-loop.mjs";
import { findTrustedObjectiveGateExecutable } from "../../dispatch/lib/objective-gate-sandbox.mjs";
import { runWorkflowKernel } from "../../dispatch/kernel/scheduler.mjs";
import { WORKSPACE_COPY_LIMITS } from "../../dispatch/kernel/limits.mjs";
import { normalizeWorkflowDefinition } from "../../dispatch/workflow/schema.mjs";
import {
  compileWorkflowGraph,
  WORKFLOW_EXECUTION_MODES,
} from "../../dispatch/workflow/graph.mjs";

const TRUSTED_GIT = findTrustedObjectiveGateExecutable("git");

function git(cwd, args, {
  encoding = "utf8",
  input = undefined,
  maxBuffer = 64 * 1024 * 1024,
} = {}) {
  if (TRUSTED_GIT == null) return { status: null, stdout: encoding == null ? Buffer.alloc(0) : "" };
  return spawnSync(TRUSTED_GIT, [
    "-c", "core.fsmonitor=false",
    "-c", "core.untrackedCache=false",
    "-c", `core.hooksPath=${devNull}`,
    "-c", `core.attributesFile=${devNull}`,
    ...args,
  ], {
    cwd,
    encoding,
    input,
    maxBuffer,
    timeout: 30_000,
    env: {
      PATH: [...new Set([dirname(TRUSTED_GIT), "/usr/bin", "/bin"])].join(delimiter),
      HOME: tmpdir(),
      TMPDIR: tmpdir(),
      TMP: tmpdir(),
      TEMP: tmpdir(),
      LANG: "C",
      LC_ALL: "C",
      TZ: "UTC",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: devNull,
      GIT_CONFIG_SYSTEM: devNull,
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
}

function splitNulBytes(bytes) {
  const entries = [];
  let offset = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0) continue;
    if (index > offset) entries.push(bytes.subarray(offset, index));
    offset = index + 1;
  }
  return offset === bytes.length ? entries : null;
}

function exactUtf8(bytes) {
  const decoded = bytes.toString("utf8");
  return Buffer.from(decoded, "utf8").equals(bytes) ? decoded : null;
}

function rawPathParts(path) {
  const parts = [];
  let offset = 0;
  for (let index = 0; index <= path.length; index += 1) {
    if (index !== path.length && path[index] !== 0x2f) continue;
    parts.push(path.subarray(offset, index));
    offset = index + 1;
  }
  return parts;
}

function isDotGit(part) {
  return part.length === 4
    && (part[0] === 0x2e)
    && (part[1] === 0x67 || part[1] === 0x47)
    && (part[2] === 0x69 || part[2] === 0x49)
    && (part[3] === 0x74 || part[3] === 0x54);
}

function validRawPath(path) {
  if (!Buffer.isBuffer(path) || path.length === 0 || path.length > 4_096
    || path[0] === 0x2f || path.includes(0)) return false;
  const parts = rawPathParts(path);
  return parts.every((part) => part.length > 0 && part.length <= 255
    && !(part.length === 1 && part[0] === 0x2e)
    && !(part.length === 2 && part[0] === 0x2e && part[1] === 0x2e)
    && !isDotGit(part));
}

function windowsPathSupported(path, mode) {
  const decoded = exactUtf8(path);
  if (decoded == null || mode === "120000" || mode === "100755") return false;
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
  return decoded.split("/").every((part) => !reserved.test(part)
    && !/[<>:"\\|?*]/.test(part) && !/[ .]$/.test(part));
}

function expectedIndexBytes(entries) {
  return Buffer.concat(entries.flatMap((entry) => [
    Buffer.from(`${entry.mode} ${entry.oid} 0\t`, "ascii"),
    entry.path,
    Buffer.from([0]),
  ]));
}

function inspectRawTree(cwd, baselineOid, gitEffect) {
  const format = gitEffect(cwd, ["rev-parse", "--show-object-format"]);
  const objectIdLength = format.status === 0 && format.stdout.trim() === "sha1" ? 40
    : format.status === 0 && format.stdout.trim() === "sha256" ? 64 : null;
  if (objectIdLength == null || baselineOid.length !== objectIdLength) {
    return { ok: false, code: "workflow-runtime-smoke-baseline-invalid" };
  }
  const listed = gitEffect(cwd, ["ls-tree", "-r", "-z", "-l", "--full-tree", baselineOid], {
    encoding: null,
    maxBuffer: WORKSPACE_COPY_LIMITS.max_total_bytes,
  });
  const records = listed.status === 0 && Buffer.isBuffer(listed.stdout)
    ? splitNulBytes(listed.stdout)
    : null;
  if (records == null) return { ok: false, code: "workflow-runtime-smoke-baseline-invalid" };
  const entries = [];
  const seen = new Set();
  let totalBytes = 0n;
  for (const record of records) {
    const tab = record.indexOf(0x09);
    if (tab < 0) return { ok: false, code: "workflow-runtime-smoke-baseline-invalid" };
    const header = record.subarray(0, tab).toString("ascii");
    const matched = header.match(/^([0-7]{6}) (blob|commit) ([0-9a-f]+) +([0-9]+|-)$/);
    const path = Buffer.from(record.subarray(tab + 1));
    if (!matched || matched[3].length !== objectIdLength || !validRawPath(path)) {
      return { ok: false, code: "workflow-runtime-smoke-baseline-invalid" };
    }
    const [, mode, type, oid, rawSize] = matched;
    if (!((["100644", "100755", "120000"].includes(mode) && type === "blob" && rawSize !== "-")
      || (mode === "160000" && type === "commit" && rawSize === "-"))) {
      return { ok: false, code: "workflow-runtime-smoke-baseline-invalid" };
    }
    if (process.platform === "win32" && !windowsPathSupported(path, mode)) {
      return { ok: false, code: "workflow-runtime-smoke-baseline-unsupported" };
    }
    const pathKey = path.toString("hex");
    if (seen.has(pathKey)) return { ok: false, code: "workflow-runtime-smoke-baseline-invalid" };
    seen.add(pathKey);
    if (entries.length >= WORKSPACE_COPY_LIMITS.max_files) {
      return { ok: false, code: "workflow-runtime-smoke-baseline-capacity-exceeded" };
    }
    const sizeValue = rawSize === "-" ? 0n : BigInt(rawSize);
    if (sizeValue > BigInt(WORKSPACE_COPY_LIMITS.max_file_bytes)
      || totalBytes + sizeValue > BigInt(WORKSPACE_COPY_LIMITS.max_total_bytes)) {
      return { ok: false, code: "workflow-runtime-smoke-baseline-capacity-exceeded" };
    }
    totalBytes += sizeValue;
    entries.push({
      mode,
      type,
      oid,
      size: Number(sizeValue),
      path,
      bytes: null,
    });
  }
  entries.sort((left, right) => Buffer.compare(left.path, right.path));
  for (let index = 1; index < entries.length; index += 1) {
    const parent = entries[index - 1].path;
    const child = entries[index].path;
    if (child.length > parent.length && child.subarray(0, parent.length).equals(parent)
      && child[parent.length] === 0x2f) {
      return { ok: false, code: "workflow-runtime-smoke-baseline-invalid" };
    }
  }
  const blobs = new Map();
  for (const entry of entries) {
    if (entry.type !== "blob") continue;
    let bytes = blobs.get(entry.oid);
    if (bytes == null) {
      const blob = gitEffect(cwd, ["cat-file", "blob", entry.oid], {
        encoding: null,
        maxBuffer: WORKSPACE_COPY_LIMITS.max_file_bytes + 1,
      });
      if (blob.status !== 0 || !Buffer.isBuffer(blob.stdout)) {
        return { ok: false, code: "workflow-runtime-smoke-baseline-invalid" };
      }
      bytes = Buffer.from(blob.stdout);
      blobs.set(entry.oid, bytes);
    }
    if (bytes.length !== entry.size || (entry.mode === "120000" && bytes.includes(0))) {
      return { ok: false, code: "workflow-runtime-smoke-baseline-invalid" };
    }
    if (entry.mode === "120000" && bytes.length === 0) {
      return { ok: false, code: "workflow-runtime-smoke-baseline-unsupported" };
    }
    entry.bytes = bytes;
  }
  return {
    ok: true,
    entries,
    index_bytes: expectedIndexBytes(entries),
  };
}

function rawTreeListing(cwd) {
  const entries = [];
  const visit = (directory, relative) => {
    const children = readdirSync(directory, { encoding: "buffer", withFileTypes: true })
      .sort((left, right) => Buffer.compare(left.name, right.name));
    for (const child of children) {
      const path = relative.length === 0
        ? Buffer.from(child.name)
        : Buffer.concat([relative, Buffer.from("/"), child.name]);
      if (child.isSymbolicLink()) entries.push({ mode: "120000", path });
      else if (child.isDirectory()) {
        const target = Buffer.concat([directory, Buffer.from(sep), child.name]);
        const nested = readdirSync(target, { encoding: "buffer", withFileTypes: true });
        if (nested.length === 0) entries.push({ mode: "160000", path });
        else visit(target, path);
      } else if (child.isFile()) {
        const target = Buffer.concat([directory, Buffer.from(sep), child.name]);
        const created = lstatSync(target);
        entries.push({ mode: (created.mode & 0o111) === 0 ? "100644" : "100755", path });
      }
      else throw new Error("probe-entry-invalid");
    }
  };
  visit(Buffer.from(resolve(cwd)), Buffer.alloc(0));
  return entries.sort((left, right) => Buffer.compare(left.path, right.path));
}

function verifyManifestFilesystem(root, manifest, chmodEffect) {
  const probe = join(root, ".helix-tree-probe");
  let verified = false;
  try {
    mkdirSync(probe, { mode: 0o700 });
    for (const entry of manifest.entries) {
      ensureRawParents(probe, entry.path);
      const target = rawCheckoutPath(probe, entry.path);
      if (entry.mode === "160000") mkdirSync(target, { mode: 0o755 });
      else if (entry.mode === "120000") {
        symlinkSync(entry.bytes, target);
        if (!readlinkSync(target, { encoding: "buffer" }).equals(entry.bytes)) {
          throw new Error("probe-symlink-target-invalid");
        }
      } else {
        const mode = entry.mode === "100755" ? 0o755 : 0o644;
        writeFileSync(target, Buffer.alloc(0), { flag: "wx", mode });
        chmodEffect(target, mode);
      }
    }
    const actual = rawTreeListing(probe);
    if (actual.length !== manifest.entries.length) throw new Error("probe-tree-count-invalid");
    for (let index = 0; index < actual.length; index += 1) {
      const expected = manifest.entries[index];
      if (!actual[index].path.equals(expected.path)
        || actual[index].mode !== expected.mode) {
        throw new Error("probe-tree-identity-invalid");
      }
    }
    verified = true;
  } catch {
    verified = false;
  } finally {
    try { rmSync(probe, { recursive: true, force: false }); }
    catch { return false; }
  }
  return verified && !pathPresent(probe);
}

function rawCheckoutPath(cwd, relative) {
  if (process.platform === "win32") return resolve(cwd, exactUtf8(relative));
  return Buffer.concat([Buffer.from(resolve(cwd)), Buffer.from(sep), relative]);
}

function ensureRawParents(cwd, relative) {
  const parts = rawPathParts(relative);
  let parent = process.platform === "win32" ? resolve(cwd) : Buffer.from(resolve(cwd));
  for (const part of parts.slice(0, -1)) {
    parent = process.platform === "win32"
      ? join(parent, exactUtf8(part))
      : Buffer.concat([parent, Buffer.from(sep), part]);
    try { mkdirSync(parent, { mode: 0o755 }); }
    catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const entry = lstatSync(parent);
      if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error("raw-parent-invalid");
    }
  }
}

function distanceTo(graph, start, target) {
  const queue = [[start, 0]];
  const seen = new Set();
  while (queue.length > 0) {
    const [id, distance] = queue.shift();
    if (id === target) return distance;
    if (seen.has(id) || !Object.hasOwn(graph.adjacency, id)) continue;
    seen.add(id);
    for (const edge of graph.adjacency[id]) queue.push([edge.to, distance + 1]);
  }
  return Number.POSITIVE_INFINITY;
}

function preferredOutputs(definition, graph, finalGateId) {
  const preferred = new Map();
  for (const node of Object.values(definition.nodes)) {
    if (node.kind !== "decision") continue;
    const ordered = [...node.transitions].sort((left, right) =>
      distanceTo(graph, left.target, finalGateId) - distanceTo(graph, right.target, finalGateId));
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

function applySmokeCandidateEffect(agent, ctx, definition) {
  if (agent.mutation === "read-only") return;
  const artifact = ctx.artifact ?? (definition.objective_gate.type === "file-contains"
    ? { path: definition.objective_gate.path, kind: "notes" }
    : null);
  if (artifact == null) return;
  const authoredNode = definition.nodes[ctx.node_id];
  const satisfies = ctx.visit > 1 || (authoredNode.max_visits ?? 1) === 1;
  const marker = definition.objective_gate.type === "file-contains"
    && definition.objective_gate.path === artifact.path && satisfies
    ? `\n${definition.objective_gate.contains}\n`
    : "\n";
  writeTextAtomic(ctx.cwd, artifact.path, `Deterministic no-egress ${artifact.kind} artifact.${marker}`);
}

function verifySmokeArtifact(artifact, ctx) {
  const path = join(ctx.cwd, artifact.path);
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 16 * 1024 * 1024) {
      return { ok: false, code: "kernel-artifact-invalid" };
    }
    return { ok: true, ref: hashRef(readFileSync(path)) };
  } catch {
    return { ok: false, code: "kernel-artifact-invalid" };
  }
}

function materializeRawCheckout(cwd, manifest, { gitEffect, signal }) {
  const indexed = gitEffect(cwd, ["ls-files", "--stage", "-z"], { encoding: null });
  if (indexed.status !== 0 || !Buffer.isBuffer(indexed.stdout)
    || !indexed.stdout.equals(manifest.index_bytes)) {
    return { ok: false, code: "workflow-runtime-smoke-baseline-invalid" };
  }
  try {
    for (const entry of manifest.entries) {
      if (signal?.aborted) return { ok: false, code: "workflow-runtime-smoke-cancelled" };
      ensureRawParents(cwd, entry.path);
      const target = rawCheckoutPath(cwd, entry.path);
      if (entry.mode === "160000") {
        mkdirSync(target, { mode: 0o755 });
        const created = lstatSync(target);
        if (created.isSymbolicLink() || !created.isDirectory()) throw new Error("gitlink-materialization-invalid");
        continue;
      }
      if (entry.mode === "120000") {
        symlinkSync(entry.bytes, target);
        const created = lstatSync(target);
        const linkText = readlinkSync(target, { encoding: "buffer" });
        if (!created.isSymbolicLink() || !linkText.equals(entry.bytes)) {
          throw new Error("symlink-materialization-invalid");
        }
        continue;
      }
      const mode = entry.mode === "100755" ? 0o755 : 0o644;
      writeFileSync(target, entry.bytes, { flag: "wx", mode });
      chmodSync(target, mode);
      const created = lstatSync(target);
      const readBack = readFileSync(target);
      if (created.isSymbolicLink() || !created.isFile() || readBack.length !== entry.size
        || !readBack.equals(entry.bytes)
        || ((created.mode & 0o111) !== (mode & 0o111))) {
        throw new Error("blob-materialization-invalid");
      }
    }
    return { ok: true };
  } catch {
    return { ok: false, code: "workflow-runtime-smoke-materialization-failed" };
  }
}

function worktreeRef(cwd) {
  return objectiveGateWorkspaceRef(cwd);
}

function pathPresent(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    return error?.code !== "ENOENT";
  }
}

function registeredWorktreePaths(repoRoot, gitEffect) {
  let listed;
  try { listed = gitEffect(repoRoot, ["worktree", "list", "--porcelain", "-z"], { encoding: null }); }
  catch { return null; }
  const records = listed.status === 0 && Buffer.isBuffer(listed.stdout)
    ? splitNulBytes(listed.stdout)
    : null;
  if (records == null) return null;
  const prefix = Buffer.from("worktree ", "ascii");
  return records
    .filter((record) => record.length > prefix.length && record.subarray(0, prefix.length).equals(prefix))
    .map((record) => Buffer.from(record.subarray(prefix.length)));
}

function existingPathIdentities(path) {
  const lexical = Buffer.from(resolve(path));
  try {
    const physical = realpathSync(Buffer.from(path), { encoding: "buffer" });
    return lexical.equals(physical) ? [lexical] : [lexical, physical];
  } catch {
    return null;
  }
}

function childPathIdentities(parentIdentities, name) {
  return parentIdentities?.map((parent) =>
    Buffer.concat([parent, Buffer.from(sep), Buffer.from(name)])) ?? null;
}

function cleanupSmokeWorktrees(repoRoot, root, rootIdentities, checkouts, {
  gitEffect,
  removeWorktree,
  removeRoot,
}) {
  let certain = rootIdentities != null;
  for (const checkout of [...checkouts].reverse()) {
    try { removeWorktree(repoRoot, checkout.path); }
    catch { /* reconciliation below is authoritative */ }
    const registered = registeredWorktreePaths(repoRoot, gitEffect);
    if (checkout.identities == null || registered == null
      || registered.some((path) => checkout.identities.some((candidate) => path.equals(candidate)))
      || checkout.identities.some(pathPresent)) certain = false;
  }
  if (!certain) return false;
  try { removeRoot(root); }
  catch { return false; }
  return rootIdentities.every((path) => !pathPresent(path));
}

function normalizedParityResult(entry) {
  const normalized = structuredClone(entry.result);
  delete normalized.elapsed_ms;
  const identityRefs = new Map();
  const identity = (ref) => {
    if (!identityRefs.has(ref)) identityRefs.set(ref, `<effect-ref-${identityRefs.size + 1}>`);
    return identityRefs.get(ref);
  };
  for (const record of normalized.journal ?? []) {
    record.runtime_ref = "<mode-runtime-ref>";
    record.base_identity = identity(record.base_identity);
    record.identity = identity(record.identity);
  }
  for (const event of normalized.events ?? []) {
    delete event.execution_mode;
    delete event.edge_id;
    delete event.edge_kind;
    delete event.child_execution_mode;
    delete event.child_edge_id;
    delete event.child_edge_kind;
    if (event.effect_ref) event.effect_ref = identity(event.effect_ref);
    if (event.child_effect_ref) event.child_effect_ref = identity(event.child_effect_ref);
  }
  return { result: normalized, workspace_ref: entry.workspace_ref };
}

export function workflowRuntimeResultsMatch(left, right) {
  try {
    return JSON.stringify(normalizedParityResult(left)) === JSON.stringify(normalizedParityResult(right));
  } catch {
    return false;
  }
}

export async function smokeTestWorkflowRuntime({
  workflow,
  subworkflows = [],
  cwd,
  signal = null,
  onEvent = null,
  effects = {},
} = {}) {
  const gitEffect = effects.git ?? git;
  const makeRoot = effects.make_root ?? (() => mkdtempSync(join(tmpdir(), "helix-workflow-smoke-")));
  const removeWorktree = effects.remove_worktree
    ?? ((repoRoot, checkout) => gitEffect(repoRoot, ["worktree", "remove", "--force", checkout]));
  const removeRoot = effects.remove_root ?? ((path) => rmdirSync(path));
  const chmodEffect = effects.chmod ?? chmodSync;
  if (![gitEffect, makeRoot, removeWorktree, removeRoot, chmodEffect]
    .every((effect) => typeof effect === "function")) {
    return { ok: false, code: "workflow-runtime-smoke-effects-invalid" };
  }
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
  if (signal?.aborted) return { ok: false, code: "workflow-runtime-smoke-cancelled" };
  const top = gitEffect(cwd, ["rev-parse", "--show-toplevel"]);
  const baseline = gitEffect(cwd, ["rev-parse", "--verify", "HEAD"]);
  if (top.status !== 0 || !top.stdout.trim() || baseline.status !== 0 || !/^[0-9a-f]+$/.test(baseline.stdout.trim())) {
    return { ok: false, code: "workflow-runtime-smoke-git-required" };
  }
  const repoRoot = top.stdout.trim();
  const baselineOid = baseline.stdout.trim();
  const manifest = inspectRawTree(repoRoot, baselineOid, gitEffect);
  if (!manifest.ok) return manifest;
  let root;
  try { root = makeRoot(); }
  catch { return { ok: false, code: "workflow-runtime-smoke-worktree-failed" }; }
  const rootIdentities = existingPathIdentities(root);
  const checkouts = [];
  let result = null;
  let failure = null;
  let cleanupOk = true;
  try {
    if (rootIdentities == null || !verifyManifestFilesystem(root, manifest, chmodEffect)) {
      failure = "workflow-runtime-smoke-baseline-unsupported";
    }
    const definitions = [definition, ...children.values()];
    const graphs = new Map(definitions.map((entry) => [entry.id, compileWorkflowGraph(entry)]));
    if (failure == null && [...graphs.values()].some((graph) => !graph.ok)) {
      throw new Error("workflow-runtime-smoke-invalid");
    }
    const finalGates = new Map([...graphs].map(([id, graph]) => [id, graph.final_gate_id]));
    const preferredByDefinition = new Map(definitions.map((entry) => [
      entry.id, preferredOutputs(entry, graphs.get(entry.id), finalGates.get(entry.id)),
    ]));
    const smokeRunId = `smoke-${process.pid}-${Date.now().toString(36)}`;
    result = [];
    for (const executionMode of failure == null ? WORKFLOW_EXECUTION_MODES : []) {
      if (signal?.aborted) {
        failure = "workflow-runtime-smoke-cancelled";
        break;
      }
      const checkout = join(root, executionMode);
      checkouts.push({
        path: checkout,
        identities: childPathIdentities(rootIdentities, executionMode),
      });
      const add = gitEffect(repoRoot, ["worktree", "add", "--detach", "--no-checkout", checkout, baselineOid]);
      if (add.status !== 0) {
        failure = "workflow-runtime-smoke-worktree-failed";
        break;
      }
      const indexed = gitEffect(checkout, ["read-tree", baselineOid]);
      if (indexed.status !== 0) {
        failure = "workflow-runtime-smoke-worktree-failed";
        break;
      }
      const materialized = materializeRawCheckout(checkout, manifest, { gitEffect, signal });
      if (!materialized.ok) {
        failure = materialized.code;
        break;
      }
      const initialWorkspaceRef = worktreeRef(checkout);
      if (initialWorkspaceRef == null) {
        failure = "workflow-runtime-smoke-baseline-invalid";
        break;
      }
      const workspace = {
        cwd: checkout,
        currentRef: () => worktreeRef(checkout),
        verifyRef: (ref) => ref === worktreeRef(checkout),
        async begin() { return { ok: true, cwd: checkout, before_ref: worktreeRef(checkout) }; },
        async commit() { return { ok: true, workspace_ref: worktreeRef(checkout) }; },
        async rollback() { return { ok: true }; },
        serialize() { return { cwd: checkout, workspace_ref: worktreeRef(checkout) }; },
        async finalize() { return { ok: true }; },
      };
      const modeEvents = [];
      const modeResult = await runWorkflowKernel(definition, smokeInput(definition), {
          run_id: smokeRunId,
          execution_mode: executionMode,
          cwd: checkout,
          signal,
          workspace,
          async executeAgent(agent, ctx) {
            const activeDefinition = definitions.find((entry) => entry.id === ctx.definition_id);
            if (!activeDefinition) return { ok: false, code: "kernel-subworkflow-binding-invalid", usage: { tokens: 0, cost_micros: 0 } };
            applySmokeCandidateEffect(agent, ctx, activeDefinition);
            return { ok: true, value: smokeValue(preferredByDefinition.get(ctx.definition_id), ctx.node_id, agent.role), usage: { tokens: 0, cost_micros: 0 } };
          },
          async runGate(gate, ctx) {
            const outcome = await makeObjectiveGate(ctx.cwd, gate, {
              signal: ctx.signal,
              workspaceGuard: workspace,
            })();
            return {
              result: outcome.result,
              evidence_ref: outcome.evidence_ref ?? journalRef({ gate, result: outcome.result }),
              ...(outcome.result === "error" ? { code: outcome.code } : {}),
            };
          },
          verifyArtifact: verifySmokeArtifact,
          async checkpoint() { return { continue: true }; },
          resolveSubworkflow: (id, version) => children.get(`${id}@${version}`) ?? null,
          depth: 0,
          onEvent(event) {
            const copied = structuredClone(event);
            modeEvents.push(copied);
            if (executionMode === "original-mode") onEvent?.(copied);
          },
      });
      result.push({
        execution_mode: executionMode,
        result: modeResult,
        events: modeEvents,
        workspace_ref: worktreeRef(checkout),
      });
    }
  } catch {
    failure = "workflow-runtime-smoke-failed";
  } finally {
    cleanupOk = cleanupSmokeWorktrees(repoRoot, root, rootIdentities, checkouts, {
      gitEffect,
      removeWorktree,
      removeRoot,
    });
  }
  if (!cleanupOk) return { ok: false, code: "workflow-runtime-smoke-cleanup-failed" };
  if (failure) return { ok: false, code: failure };
  if (!Array.isArray(result) || result.length !== WORKFLOW_EXECUTION_MODES.length
    || result.some((entry) => !entry.result?.ok || entry.result.status !== "succeeded")) {
    return { ok: false, code: result?.find((entry) => !entry.result?.ok)?.result?.code ?? "workflow-runtime-smoke-failed" };
  }
  const summarize = ({ execution_mode: executionMode, result: modeResult, events: modeEvents }) => {
    const nodeIds = new Set(modeEvents.flatMap((event) => event.kind === "node-start"
      ? [`${event.run_id}:${event.node_id}`]
      : event.kind === "subworkflow-event" && event.child_kind === "node-start" && event.child_node_id
        ? [`${event.child_run_id}:${event.child_node_id}`]
        : []));
    const finalGatePassed = modeEvents.some((event) =>
      event.kind === "gate" && event.final === true && event.result === "pass");
    return {
      execution_mode: executionMode,
      status: modeResult.status,
      terminal: modeResult.terminal,
      nodes_exercised: nodeIds.size,
      effects_exercised: modeEvents.filter((event) => event.kind === "effect-end"
        || (event.kind === "subworkflow-event" && event.child_kind === "effect-end")).length,
      transitions_exercised: modeEvents.filter((event) => event.kind === "transition"
        || (event.kind === "subworkflow-event" && event.child_kind === "transition")).length,
      objective_gate_exercised: finalGatePassed,
    };
  };
  const summaries = result.map(summarize);
  if (!workflowRuntimeResultsMatch(result[0], result[1])) {
    return { ok: false, code: "workflow-runtime-mode-parity-failed" };
  }
  const baselineSummary = summaries[0];
  return {
    ok: true,
    runner: "workflow-kernel-v4",
    provider_calls: 0,
    objective_check: "real",
    nodes_exercised: baselineSummary.nodes_exercised,
    effects_exercised: baselineSummary.effects_exercised,
    transitions_exercised: baselineSummary.transitions_exercised,
    objective_gate_exercised: baselineSummary.objective_gate_exercised,
    mode_comparison: {
      matched: true,
      original_mode: summaries.find((entry) => entry.execution_mode === "original-mode"),
      graph_mode: summaries.find((entry) => entry.execution_mode === "graph-mode"),
    },
  };
}
