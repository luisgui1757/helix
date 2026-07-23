// Helix dispatch — bounded task-loop entrypoint.
//
// This is the code-level entrypoint for daily-use loop configs. It composes the
// existing dispatch primitives and canonical workflow transitions instead of
// adding new authority:
//   run config -> chain -> route -> role matrix -> runDebate
// with a real git diff-stability checker, a real model-backed revision effect,
// and a deterministic no-live adapter for all-mock casts. This legacy engine is
// intentionally not the Pi-native provider path, so every real-provider cast
// refuses before any injected adapter/revision effect. Objective gates are deterministic checkers;
// model/judge/verifier output never decides convergence.

import { createHash } from "node:crypto";
import {
  accessSync, constants, existsSync, readFileSync, readlinkSync, statSync, realpathSync, lstatSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { delimiter, join, dirname, isAbsolute, resolve, sep } from "node:path";
import { devNull, tmpdir } from "node:os";
import { validateRunConfig } from "./run-configs.mjs";
import { resolveChain } from "./chains.mjs";
import { expandRoleMatrix } from "./role-matrix.mjs";
import { routeForClass } from "./routes.mjs";
import { runDebate } from "./debate.mjs";
import { makeGitDiffStability } from "./git-diff-surface.mjs";
import { makeModelRevision } from "./revision-effect.mjs";
import { decideWorkflowTransition } from "./workflows.mjs";
import {
  findTrustedObjectiveGateExecutable,
  preflightObjectiveGateSandbox,
  prepareObjectiveGateSandbox,
  probeObjectiveGateSandbox,
} from "./objective-gate-sandbox.mjs";
import { WORKSPACE_COPY_LIMITS } from "../kernel/limits.mjs";

export const TASK_LOOP_CODES = Object.freeze({
  UNSAFE_GATE_PATH: "unsafe-gate-path",
  CHAIN_NOT_LOOP_RUNNABLE: "chain-not-loop-runnable",
  GATE_SANDBOX_UNAVAILABLE: "objective-gate-sandbox-unavailable",
  GATE_SANDBOX_CLEANUP_FAILED: "objective-gate-sandbox-cleanup-failed",
  GATE_WORKSPACE_INVALID: "objective-gate-workspace-invalid",
  GATE_WORKSPACE_DRIFT: "objective-gate-workspace-drift",
  GATE_WORKSPACE_RESTORE_FAILED: "objective-gate-workspace-restore-failed",
  GATE_TERMINATION_UNCONFIRMED: "objective-gate-termination-unconfirmed",
  GATE_CANCELLED: "objective-gate-cancelled",
  GATE_TIMEOUT: "objective-gate-timeout",
  GATE_EXECUTION_FAILED: "gate-execution-failure",
});

/** Resolve multi-pass versus one-shot execution through the workflow loop rule. */
export function decideTaskLoopTransition(loopsEnabled) {
  return decideWorkflowTransition({
    id: "task-loop",
    max_passes: 1,
    transitions: [{ when: { type: "always" }, action: "retry" }],
  }, 0, {}, { loops: loopsEnabled });
}

function failClosed(code, detail = null, extra = {}) {
  return { ok: false, status: "fail-closed", code, detail, ...extra };
}

function structuralGateFailure(commandNames, code, extra = {}) {
  return {
    command_names: [...commandNames, code],
    result: "error",
    code,
    source: "deterministic-checker",
    ...extra,
  };
}

function errorsToDetail(errors) {
  return errors.map((error) => `${error.path} ${error.message}`).join("; ");
}

function resolveMatrix(matrixConfig, id) {
  if (matrixConfig?.matrix_id === id) return { ok: true, matrix: matrixConfig };
  return { ok: false, code: "unknown-role-matrix", detail: id };
}

function safeRelativePath(rel) {
  return typeof rel === "string"
    && rel.length > 0
    && !rel.includes("\0")
    && !isAbsolute(rel)
    && !rel.includes("..");
}

function inTree(realPath, realRoot) {
  return realPath === realRoot || realPath.startsWith(realRoot + sep);
}

function resolveContainedPath(cwd, rel) {
  const fail = () => ({ ok: false, code: TASK_LOOP_CODES.UNSAFE_GATE_PATH });
  if (!safeRelativePath(rel)) return fail();
  let root;
  let parent;
  let stat;
  let real;
  try {
    root = realpathSync(cwd);
    const full = join(cwd, rel);
    stat = lstatSync(full);
    if (stat.isSymbolicLink() || !stat.isFile()) return fail();
    parent = realpathSync(dirname(full));
    real = realpathSync(full);
  } catch {
    return fail();
  }
  if (!inTree(parent, root) || !inTree(real, root)) return fail();
  return { ok: true, path: real };
}

export function makeFileContainsGate(cwd, gate) {
  return () => {
    const resolved = resolveContainedPath(cwd, gate.path);
    if (!resolved.ok) {
      return { command_names: [`file-contains:${gate.path}`, resolved.code], result: "fail", source: "deterministic-checker" };
    }
    let text = "";
    try {
      text = readFileSync(resolved.path, "utf8");
    } catch {
      text = "";
    }
    return {
      command_names: [`file-contains:${gate.path}`],
      result: text.includes(gate.contains) ? "pass" : "fail",
      source: "deterministic-checker",
    };
  };
}

function executableCandidates(cwd, command, env = process.env) {
  if (command.startsWith("./")) return [resolve(cwd, command)];
  const extensions = process.platform === "win32"
    ? String(env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
    : [""];
  return String(env.PATH ?? "").split(delimiter)
    .flatMap((directory) => {
      const base = directory === "" ? cwd : isAbsolute(directory) ? directory : resolve(cwd, directory);
      return extensions.map((extension) => join(base, `${command}${extension}`));
    });
}

function gitOutput(cwd, args, {
  find_trusted_executable = findTrustedObjectiveGateExecutable,
  encoding = "utf8",
} = {}) {
  const git = find_trusted_executable("git");
  if (!git) return null;
  const result = spawnSync(git, [
    "-c", "core.fsmonitor=false",
    "-c", "core.untrackedCache=false",
    "-c", "core.hooksPath=/dev/null",
    "-c", `core.attributesFile=${devNull}`,
    ...args,
  ], {
    cwd,
    encoding,
    maxBuffer: 32 * 1024 * 1024,
    timeout: 5_000,
    env: {
      PATH: [...new Set([dirname(git), "/usr/bin", "/bin"])].join(delimiter),
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
  return result.status === 0
    && (encoding == null ? Buffer.isBuffer(result.stdout) : typeof result.stdout === "string")
    ? result.stdout
    : null;
}

export function gitObjectIdLength(cwd, options = {}) {
  const format = gitOutput(cwd, ["rev-parse", "--show-object-format"], options)?.trim();
  return format === "sha1" ? 40 : format === "sha256" ? 64 : null;
}

function exactUtf8(bytes) {
  const decoded = bytes.toString("utf8");
  return Buffer.from(decoded, "utf8").equals(bytes) ? decoded : null;
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

function admittedRelativePath(raw) {
  const decoded = exactUtf8(raw);
  if (decoded != null) return decoded;
  return process.platform === "win32" ? null : Buffer.from(raw);
}

function pathBytes(path) {
  return Buffer.isBuffer(path) ? path : Buffer.from(path, "utf8");
}

function validRelativePathBytes(bytes) {
  if (bytes.length === 0 || bytes[0] === 0x2f || bytes.includes(0)) return false;
  let offset = 0;
  for (let index = 0; index <= bytes.length; index += 1) {
    if (index !== bytes.length && bytes[index] !== 0x2f) continue;
    const part = bytes.subarray(offset, index);
    if (part.length === 0 || (part.length === 1 && part[0] === 0x2e)
      || (part.length === 2 && part[0] === 0x2e && part[1] === 0x2e)) return false;
    offset = index + 1;
  }
  return true;
}

function rawFullPath(root, relative) {
  if (!Buffer.isBuffer(relative)) return resolve(root, relative);
  return Buffer.concat([Buffer.from(resolve(root)), Buffer.from(sep), relative]);
}

function rawDirname(path) {
  if (!Buffer.isBuffer(path)) return dirname(path);
  const index = path.lastIndexOf(Buffer.from(sep));
  return index <= 0 ? Buffer.from(sep) : path.subarray(0, index);
}

function inByteTree(path, root) {
  return path.equals(root)
    || (path.length > root.length && path.subarray(0, root.length).equals(root)
      && path[root.length] === Buffer.from(sep)[0]);
}

function pathEvidence(path) {
  return Buffer.isBuffer(path) ? { bytes: path.toString("hex") } : path;
}

function physicalWorkspaceEntries(cwd, paths, {
  allow_missing = false,
  state = { files: 0, total_bytes: 0 },
} = {}) {
  let root;
  let byteRoot;
  try {
    root = realpathSync(cwd);
    byteRoot = realpathSync(Buffer.from(cwd), { encoding: "buffer" });
  }
  catch { return null; }
  const files = [];
  const unique = new Map();
  for (const path of paths) unique.set(pathBytes(path).toString("hex"), path);
  const ordered = [...unique.values()].sort((left, right) => Buffer.compare(pathBytes(left), pathBytes(right)));
  for (const path of ordered) {
    const relativeBytes = pathBytes(path);
    if (!validRelativePathBytes(relativeBytes)
      || (!Buffer.isBuffer(path) && isAbsolute(path))) return null;
    state.files += 1;
    if (!Number.isSafeInteger(state.files) || state.files > WORKSPACE_COPY_LIMITS.max_files) return null;
    const full = rawFullPath(cwd, path);
    if (!Buffer.isBuffer(full) && !inTree(full, resolve(cwd))) return null;
    let stat;
    let parent;
    try {
      stat = lstatSync(full);
      parent = Buffer.isBuffer(full)
        ? realpathSync(rawDirname(full), { encoding: "buffer" })
        : realpathSync(dirname(full));
    } catch (error) {
      if (allow_missing && error?.code === "ENOENT") {
        files.push([pathEvidence(path), "missing"]);
        continue;
      }
      return null;
    }
    if (Buffer.isBuffer(parent) ? !inByteTree(parent, byteRoot) : !inTree(parent, root)) return null;
    if (stat.isSymbolicLink()) {
      let target;
      try { target = readlinkSync(full, { encoding: "buffer" }); }
      catch { return null; }
      if (target.length > WORKSPACE_COPY_LIMITS.max_file_bytes
        || state.total_bytes > WORKSPACE_COPY_LIMITS.max_total_bytes - target.length) return null;
      state.total_bytes += target.length;
      files.push([pathEvidence(path), "symlink", createHash("sha256").update(target).digest("hex")]);
      continue;
    }
    if (!stat.isFile()) {
      const kind = stat.isDirectory() ? "directory"
        : stat.isFIFO() ? "fifo"
          : stat.isSocket() ? "socket"
            : stat.isCharacterDevice() ? "character-device"
              : stat.isBlockDevice() ? "block-device" : "nonfile";
      files.push([pathEvidence(path), kind, stat.mode & 0o777]);
      continue;
    }
    if (!Number.isSafeInteger(stat.size) || stat.size < 0
      || stat.size > WORKSPACE_COPY_LIMITS.max_file_bytes
      || state.total_bytes > WORKSPACE_COPY_LIMITS.max_total_bytes - stat.size) return null;
    let real;
    let bytes;
    let after;
    try {
      real = Buffer.isBuffer(full)
        ? realpathSync(full, { encoding: "buffer" })
        : realpathSync(full);
      if (Buffer.isBuffer(real) ? !inByteTree(real, byteRoot) : !inTree(real, root)) return null;
      bytes = readFileSync(real);
      after = lstatSync(full);
      const afterReal = Buffer.isBuffer(full)
        ? realpathSync(full, { encoding: "buffer" })
        : realpathSync(full);
      if (Buffer.isBuffer(real) ? !afterReal.equals(real) : afterReal !== real) return null;
    } catch { return null; }
    if (!after.isFile() || bytes.length !== stat.size || after.dev !== stat.dev || after.ino !== stat.ino
      || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.mode !== stat.mode
      || bytes.length > WORKSPACE_COPY_LIMITS.max_file_bytes) return null;
    state.total_bytes += bytes.length;
    files.push([pathEvidence(path), "file", stat.mode & 0o777, createHash("sha256").update(bytes).digest("hex")]);
  }
  return files;
}

function indexedWorkspacePaths(rawIndex, objectIdLength) {
  const rawEntries = splitNulBytes(rawIndex);
  if (rawEntries == null) return null;
  const paths = [];
  for (const entry of rawEntries) {
    const tab = entry.indexOf(0x09);
    if (tab < 0) return null;
    const matched = entry.subarray(0, tab).toString("ascii").match(/^([0-7]{6}) ([0-9a-f]+) ([0-3])$/);
    const path = admittedRelativePath(entry.subarray(tab + 1));
    if (!matched || matched[2].length !== objectIdLength || path == null) return null;
    paths.push(path);
  }
  return paths;
}

export function objectiveGateWorkspaceRef(cwd, options = {}) {
  const head = gitOutput(cwd, ["rev-parse", "HEAD"], options);
  const index = gitOutput(cwd, ["ls-files", "--stage", "-z"], { ...options, encoding: null });
  const untracked = gitOutput(cwd, ["ls-files", "--others", "--exclude-standard", "-z"], { ...options, encoding: null });
  const objectIdLength = gitObjectIdLength(cwd, options);
  if ([head, index, untracked].some((value) => value == null) || objectIdLength == null) return null;
  const headId = head.trim();
  if (headId.length !== objectIdLength || !/^[0-9a-f]+$/.test(headId)) return null;
  const indexedPaths = indexedWorkspacePaths(index, objectIdLength);
  const rawUntrackedPaths = splitNulBytes(untracked);
  const untrackedPaths = rawUntrackedPaths?.map(admittedRelativePath);
  if (indexedPaths == null || untrackedPaths == null || untrackedPaths.some((path) => path == null)) return null;
  const state = { files: 0, total_bytes: 0 };
  const trackedFiles = physicalWorkspaceEntries(cwd, indexedPaths, { allow_missing: true, state });
  const untrackedFiles = physicalWorkspaceEntries(cwd, untrackedPaths, { state });
  if (trackedFiles == null || untrackedFiles == null) return null;
  const indexText = exactUtf8(index);
  const digest = createHash("sha256").update(JSON.stringify({
    head: headId,
    index: indexText ?? { bytes: index.toString("hex") },
    tracked_files: trackedFiles,
    untracked_files: untrackedFiles,
  })).digest("hex");
  return `sha256:${digest}`;
}

function gateEvidence(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function objectiveGateReadOnlyPaths(cwd, executable) {
  const paths = new Set();
  let cursor = resolve(cwd);
  while (true) {
    for (const name of ["node_modules", ".venv", "venv"]) {
      const candidate = join(cursor, name);
      try {
        if (statSync(candidate).isDirectory()) paths.add(realpathSync(candidate));
      } catch {
        // Optional dependency roots are absent on most ancestors.
      }
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  const covered = [resolve(cwd), "/usr", "/bin", "/lib", "/lib64", "/nix/store"];
  if (!covered.some((root) => executable === root || executable.startsWith(`${root}${sep}`))) {
    paths.add(executable);
  }
  return [...paths].sort();
}

export function preflightObjectiveGate(cwd, gate, { env = process.env } = {}) {
  if (gate?.type === "file-contains") return { ok: true, gate_kind: gate.type };
  if (gate?.type !== "command-exit-zero") return { ok: false, code: "objective-gate-invalid" };
  const candidates = executableCandidates(cwd, gate.command, env);
  const executable = candidates.find((candidate) => {
    try {
      if (!existsSync(candidate) || !statSync(candidate).isFile()) return false;
      accessSync(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
  if (!executable) return { ok: false, code: "objective-gate-command-unavailable" };
  const sandbox = preflightObjectiveGateSandbox({ env });
  if (!sandbox.ok) return { ok: false, code: sandbox.code };
  const probed = probeObjectiveGateSandbox(cwd, { env });
  return probed.ok
    ? { ok: true, gate_kind: gate.type, executable: realpathSync(executable), sandbox_mode: probed.mode }
    : { ok: false, code: probed.code };
}

export function makeCommandExitZeroGate(cwd, gate, {
  signal = null,
  spawnEffect = spawn,
  env = process.env,
  workspaceGuard = null,
  fingerprintEffect = objectiveGateWorkspaceRef,
  prepareSandbox = prepareObjectiveGateSandbox,
  terminationTimeoutMs = 5_000,
} = {}) {
  return async () => {
    const name = `command-exit-zero:${gate.command}`;
    let gateCwd = cwd;
    let beforeRef = null;
    let transaction = null;
    const rollbackGuard = async () => {
      if (!transaction) return { ok: true };
      let restored;
      try { restored = await workspaceGuard.rollback(transaction); }
      catch { restored = null; }
      transaction = null;
      return restored?.ok ? { ok: true } : { ok: false, code: TASK_LOOP_CODES.GATE_WORKSPACE_RESTORE_FAILED };
    };
    try {
      if (workspaceGuard) {
        beforeRef = workspaceGuard.currentRef();
        const begun = await workspaceGuard.begin({ mode: "shared-serialized", before_ref: beforeRef });
        if (begun?.ok !== true) {
          return structuralGateFailure([name], TASK_LOOP_CODES.GATE_WORKSPACE_INVALID);
        }
        transaction = begun;
        if (transaction.before_ref !== beforeRef || typeof transaction.cwd !== "string") {
          const restored = await rollbackGuard();
          return structuralGateFailure([name], restored.ok ? TASK_LOOP_CODES.GATE_WORKSPACE_INVALID : restored.code);
        }
        gateCwd = transaction.cwd;
      } else {
        beforeRef = fingerprintEffect(gateCwd, { env });
      }
    } catch {
      const restored = await rollbackGuard();
      return structuralGateFailure([name], restored.ok ? TASK_LOOP_CODES.GATE_WORKSPACE_INVALID : restored.code);
    }
    if (!/^sha256:[0-9a-f]{64}$/.test(beforeRef ?? "")) {
      const restored = await rollbackGuard();
      return structuralGateFailure([name], restored.ok ? TASK_LOOP_CODES.GATE_WORKSPACE_INVALID : restored.code);
    }
    const checked = preflightObjectiveGate(gateCwd, gate, { env });
    if (!checked.ok) {
      const restored = await rollbackGuard();
      return structuralGateFailure([name], restored.ok ? checked.code : restored.code);
    }
    const readOnlyPaths = objectiveGateReadOnlyPaths(gateCwd, checked.executable);
    if (readOnlyPaths == null) {
      const restored = await rollbackGuard();
      return structuralGateFailure([name], restored.ok ? TASK_LOOP_CODES.GATE_WORKSPACE_INVALID : restored.code);
    }
    let sandbox;
    try {
      sandbox = prepareSandbox({
        cwd: gateCwd,
        executable: checked.executable,
        args: gate.args,
        env,
        readOnlyPaths,
      });
    } catch {
      const restored = await rollbackGuard();
      return structuralGateFailure([name], restored.ok
        ? TASK_LOOP_CODES.GATE_SANDBOX_UNAVAILABLE
        : restored.code);
    }
    if (!sandbox?.ok) {
      const restored = await rollbackGuard();
      const sandboxCode = sandbox?.code ?? TASK_LOOP_CODES.GATE_SANDBOX_UNAVAILABLE;
      return structuralGateFailure([name],
        sandboxCode === TASK_LOOP_CODES.GATE_SANDBOX_CLEANUP_FAILED || restored.ok
          ? sandboxCode
          : restored.code);
    }
    return new Promise((resolveOutcome) => {
    let settled = false;
    let timer = null;
    let terminationTimer = null;
    let child = null;
    let abortRequested = false;
    const finish = async (observedResult, executionCode = null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (terminationTimer) clearTimeout(terminationTimer);
      signal?.removeEventListener?.("abort", cancel);
      let cleaned;
      try { cleaned = sandbox.cleanup(); }
      catch { cleaned = { ok: false, code: "objective-gate-sandbox-cleanup-failed" }; }
      let afterRef = null;
      try { afterRef = workspaceGuard ? workspaceGuard.currentRef() : fingerprintEffect(gateCwd, { env }); }
      catch { afterRef = null; }
      const restored = await rollbackGuard();
      const guardCode = !cleaned.ok ? cleaned.code
        : !restored?.ok ? TASK_LOOP_CODES.GATE_WORKSPACE_RESTORE_FAILED
          : afterRef == null ? TASK_LOOP_CODES.GATE_WORKSPACE_INVALID
            : afterRef !== beforeRef ? TASK_LOOP_CODES.GATE_WORKSPACE_DRIFT
              : null;
      const result = guardCode == null && executionCode == null ? observedResult : "error";
      const evidenceRef = gateEvidence({
          executable: checked.executable,
          args: gate.args,
          sandbox: sandbox.mode,
          before_ref: beforeRef,
          after_ref: afterRef,
          result,
          guard_code: guardCode,
          execution_code: executionCode,
          termination_confirmed: true,
        });
      resolveOutcome(guardCode != null
        ? structuralGateFailure([name, `sandbox:${sandbox.mode}`], guardCode, { evidence_ref: evidenceRef })
        : executionCode != null
          ? structuralGateFailure([name, `sandbox:${sandbox.mode}`], executionCode, { evidence_ref: evidenceRef })
          : {
            command_names: [name, `sandbox:${sandbox.mode}`],
            result,
            source: "deterministic-checker",
            evidence_ref: evidenceRef,
          });
    };
    const finishUnconfirmed = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (terminationTimer) clearTimeout(terminationTimer);
      signal?.removeEventListener?.("abort", cancel);
      resolveOutcome(structuralGateFailure(
        [name, `sandbox:${sandbox.mode}`],
        TASK_LOOP_CODES.GATE_TERMINATION_UNCONFIRMED,
        { evidence_ref: gateEvidence({
          executable: checked.executable,
          args: gate.args,
          sandbox: sandbox.mode,
          before_ref: beforeRef,
          after_ref: null,
          result: "error",
          guard_code: TASK_LOOP_CODES.GATE_TERMINATION_UNCONFIRMED,
          execution_code: abortCode,
          termination_confirmed: false,
        }) },
      ));
    };
    let abortCode = null;
    const abort = (code) => {
      if (settled || abortRequested) return;
      abortRequested = true;
      abortCode = code;
      if (timer) clearTimeout(timer);
      try {
        if (process.platform !== "win32" && Number.isSafeInteger(child?.pid)) process.kill(-child.pid, "SIGKILL");
        else child?.kill?.("SIGKILL");
      } catch {
        try { child?.kill?.("SIGKILL"); } catch { /* termination confirmation remains authoritative */ }
      }
      terminationTimer = setTimeout(finishUnconfirmed, terminationTimeoutMs);
    };
    const cancel = () => abort(TASK_LOOP_CODES.GATE_CANCELLED);
    if (signal?.aborted) return void finish("error", TASK_LOOP_CODES.GATE_CANCELLED);
    try {
      child = spawnEffect(sandbox.command, sandbox.args, sandbox.options);
    } catch {
      return void finish("error", TASK_LOOP_CODES.GATE_EXECUTION_FAILED);
    }
    if (typeof child?.once !== "function") {
      return void finish("error", TASK_LOOP_CODES.GATE_EXECUTION_FAILED);
    }
    child.once("error", () => {
      if (Number.isSafeInteger(child?.pid)) abort(TASK_LOOP_CODES.GATE_EXECUTION_FAILED);
      else void finish("error", TASK_LOOP_CODES.GATE_EXECUTION_FAILED);
    });
    child.once("close", (code) => {
      if (abortRequested) void finish("error", abortCode ?? TASK_LOOP_CODES.GATE_EXECUTION_FAILED);
      else if (Number.isInteger(code)) void finish(code === 0 ? "pass" : "fail");
      else void finish("error", TASK_LOOP_CODES.GATE_EXECUTION_FAILED);
    });
    signal?.addEventListener?.("abort", cancel, { once: true });
    timer = setTimeout(() => abort(TASK_LOOP_CODES.GATE_TIMEOUT), gate.timeout_ms);
    if (signal?.aborted) cancel();
  });
  };
}

export function makeObjectiveGate(cwd, gate, options = {}) {
  if (gate?.type === "file-contains") return makeFileContainsGate(cwd, gate);
  if (gate?.type === "command-exit-zero") return makeCommandExitZeroGate(cwd, gate, options);
  return async () => structuralGateFailure([], "objective-gate-invalid");
}

function structuralEnvelope({ run_id, role, provider, model, stage = "candidate", status = "ok", recommendation = "ok", open_questions = [] }) {
  return {
    schema_version: 2,
    run_id,
    stage,
    role,
    provider,
    model,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
    },
    attempt: 1,
    iteration: 1,
    input_ref: { kind: "local-ref", value: `local-ref:input/${run_id}`, algorithm: null },
    claims_ref: `local-ref:claims/${run_id}`,
    evidence_ref: `local-ref:evidence/${run_id}`,
    uncertainty: [],
    risks: [],
    recommendation,
    proposed_actions: [],
    open_questions,
    status,
  };
}

function stageConfig(spec, rubricId) {
  return {
    provider: spec.provider,
    model: spec.model,
    ...(spec.effort ? { effort: spec.effort } : {}),
    rubric_id: rubricId,
  };
}

function builderConfig(spec) {
  const out = { provider: spec.provider, model: spec.model };
  if (spec.effort) out.effort = spec.effort;
  return out;
}

export function createNoLiveMockAdapter() {
  const calls = { candidates: 0, judges: 0, synthesis: 0, verifiers: 0, revisions: 0 };
  return {
    calls,
    dispatchAdapter: {
      runCandidate(spec, ctx) {
        calls.candidates += 1;
        return structuralEnvelope({
          run_id: ctx.run_id,
          role: spec.role,
          provider: spec.provider,
          model: spec.model,
          recommendation: `${spec.role}-ok`,
        });
      },
      runJudge(input, ctx) {
        calls.judges += 1;
        return structuralEnvelope({
          run_id: ctx.run_id,
          stage: "judge",
          role: "judge",
          provider: "mock",
          model: "mock-judge",
          recommendation: input.rubric_id,
        });
      },
      runSynthesis(input, ctx) {
        calls.synthesis += 1;
        return structuralEnvelope({
          run_id: ctx.run_id,
          stage: "synthesis",
          role: "synthesizer",
          provider: "mock",
          model: "mock-synthesizer",
          recommendation: input.rubric_id ?? "synthesized",
          open_questions: input.contradictions ?? [],
        });
      },
      runVerifier(_input, ctx) {
        calls.verifiers += 1;
        return structuralEnvelope({
          run_id: ctx.run_id,
          stage: "verification",
          role: "verifier",
          provider: "mock",
          model: "mock-verifier",
          recommendation: "proof summarized",
        });
      },
    },
    revisionAdapter(contentByPath) {
      return {
        runRevision() {
          calls.revisions += 1;
          return { edits: Object.entries(contentByPath).map(([path, content]) => ({ path, content })) };
        },
      };
    },
  };
}

export function preflightTaskLoopConfig(config, registries) {
  const configValid = validateRunConfig(config);
  if (!configValid.valid) return failClosed("invalid-run-config", errorsToDetail(configValid.errors));

  const chainResult = resolveChain(registries?.chainRegistry, config.chain);
  if (!chainResult.ok) return failClosed(chainResult.code, chainResult.detail);
  const chain = chainResult.chain;
  if (!chain.requires_objective_gate) return failClosed("chain-missing-objective-gate");

  const route = routeForClass(chain.task_class);
  if (!route) return failClosed("chain-route-unknown", chain.task_class);
  if (!route.roles.includes("builder")) {
    return failClosed(`${TASK_LOOP_CODES.CHAIN_NOT_LOOP_RUNNABLE}:${chain.id}`, chain.task_class);
  }

  const matrixResult = resolveMatrix(registries?.roleMatrix, config.role_matrix);
  if (!matrixResult.ok) return failClosed(matrixResult.code, matrixResult.detail);
  const expanded = expandRoleMatrix({
    matrix: matrixResult.matrix,
    route,
    agent_team: registries?.agentTeam,
  });
  if (!expanded.ok) return failClosed(expanded.code, expanded.detail, { warnings: expanded.warnings });

  const builder = expanded.candidates.find((spec) => spec.role === "builder");
  if (!builder) return failClosed("matrix-missing-role:builder");

  return {
    ok: true,
    status: "ok",
    config,
    chain,
    route,
    matrix: matrixResult.matrix,
    expanded,
    builder,
    warnings: expanded.warnings,
  };
}

/**
 * Run a bounded task loop from a validated run config.
 *
 * @param {object} config RUN_CONFIG_SCHEMA-shaped config.
 * @param {object} registries { chainRegistry, roleMatrix, agentTeam? }.
 * @param {object} deps { cwd, now, seed, mode?, record_dir?, adapter?, revisionAdapter? }.
 */
export async function runTaskLoop(config, registries, deps = {}) {
  const fail = failClosed;

  const preflight = preflightTaskLoopConfig(config, registries);
  if (!preflight.ok) return preflight;
  if (typeof deps.now !== "number" || !Number.isFinite(deps.now)) return fail("missing-clock");
  if (typeof deps.cwd !== "string") return fail("missing-worktree");
  try {
    if (!statSync(deps.cwd).isDirectory()) return fail("missing-worktree");
  } catch {
    return fail("missing-worktree");
  }

  const { chain, route, matrix, expanded, builder } = preflight;

  const effectiveProviders = [
    ...expanded.candidates,
    expanded.judge,
    expanded.synthesis,
    expanded.verification,
  ].filter(Boolean).map((spec) => spec.provider);
  if (effectiveProviders.some((provider) => provider !== "mock")) {
    return fail("live-adapter-not-wired");
  }

  const runId = deps.run_id ?? config.id;
  const request = {
    run_id: runId,
    task: { class_hint: chain.task_class, confident: true },
    candidates: expanded.candidates,
    ...(expanded.judge ? { judge: stageConfig(expanded.judge, `${chain.id}-rubric-v1`) } : {}),
    ...(expanded.synthesis ? { synthesis: stageConfig(expanded.synthesis, `${chain.id}-rubric-v1`) } : {}),
    ...(expanded.verification ? { verification: stageConfig(expanded.verification, `${chain.id}-rubric-v1`) } : {}),
    run_target: config.run_target,
    input_refs: config.input_refs ?? [],
    claims_ref: config.claims_ref,
    evidence_ref: config.evidence_ref,
  };

  const mock = deps.adapter ? null : createNoLiveMockAdapter();
  const dispatchAdapter = deps.adapter ?? mock.dispatchAdapter;
  const revisionContent = config.objective_gate.type === "file-contains"
    ? { [config.objective_gate.path]: `Helix synthetic proposal\n${config.objective_gate.contains}\n` }
    : {};
  const revisionModelAdapter = deps.revisionAdapter ?? mock?.revisionAdapter(revisionContent) ?? null;

  const revise = makeModelRevision({
    cwd: deps.cwd,
    builder: builderConfig(builder),
  }, { modelAdapter: revisionModelAdapter });

  // With loops OFF, execution degenerates to a single pass: every stage
  // runs at most once — max_iterations is forced to 1, gates still run and
  // report. This is degeneration, never an error.
  const toggles = deps.toggles ?? null;
  const loopsEnabled = !toggles || toggles.loops !== false;
  const loopTransition = decideTaskLoopTransition(loopsEnabled);
  const effectiveMaxIterations = loopTransition.action === "retry" ? config.max_iterations : 1;

  const debate = await runDebate({
    run_id: runId,
    base_request: request,
    max_iterations: effectiveMaxIterations,
  }, {
    adapter: dispatchAdapter,
    runGate: makeObjectiveGate(deps.cwd, config.objective_gate),
    now: deps.now,
    seed: deps.seed ?? 7,
    mode: deps.mode ?? "print",
    record_dir: deps.record_dir,
    parallel: config.parallel,
    diffStability: makeGitDiffStability({ cwd: deps.cwd }),
    revise,
    ...(toggles != null ? { toggles } : {}),
  });

  return {
    ok: debate.ok,
    status: debate.status,
    code: debate.code,
    chain_id: chain.id,
    route_id: route.id,
    matrix_id: matrix.matrix_id,
    warnings: [...expanded.warnings, ...debate.warnings],
    debate,
    calls: mock?.calls ?? null,
  };
}
