import { randomBytes } from "node:crypto";
import { accessSync, constants, lstatSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

export const PROCESS_LIMITS = Object.freeze({
  max_processes: 8,
  max_records: 128,
  max_args: 64,
  max_arg_length: 4_096,
  max_output_bytes: 64 * 1024,
  max_timeout_ms: 60 * 60 * 1_000,
  termination_grace_ms: 2_000,
});

const EXECUTABLE_ROOTS = Object.freeze([
  "/usr/bin", "/bin", "/usr/sbin", "/sbin", "/usr/local/bin", "/opt/homebrew/bin",
]);
const MINIMAL_ENV = Object.freeze({
  PATH: EXECUTABLE_ROOTS.join(":"),
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  TERM: "dumb",
});

function contained(root, path) {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function resolveExecutable(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 1_024 || value.includes("\0")) return null;
  const candidates = isAbsolute(value)
    ? [value]
    : value.includes("/") ? [] : EXECUTABLE_ROOTS.map((root) => resolve(root, value));
  for (const candidate of candidates) {
    try {
      const entry = lstatSync(candidate);
      if (entry.isSymbolicLink() || !entry.isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return realpathSync(candidate);
    } catch {
      // Try the next fixed executable root.
    }
  }
  return null;
}

function resolveCwd(root, value) {
  if (typeof root !== "string" || typeof value !== "string" || value.length < 1
    || value.length > 1_024 || isAbsolute(value) || value.includes("\0")) return null;
  try {
    const canonicalRoot = realpathSync(root);
    const candidate = resolve(canonicalRoot, value);
    if (!contained(canonicalRoot, candidate)) return null;
    const entry = lstatSync(candidate);
    if (entry.isSymbolicLink() || !entry.isDirectory()) return null;
    const canonical = realpathSync(candidate);
    return contained(canonicalRoot, canonical) ? canonical : null;
  } catch {
    return null;
  }
}

function boundedUtf8(buffer) {
  const decoded = buffer.toString("utf8");
  if (Buffer.byteLength(decoded, "utf8") <= PROCESS_LIMITS.max_output_bytes) {
    return { text: decoded, truncated: false };
  }
  let low = 0;
  let high = decoded.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(decoded.slice(0, middle), "utf8") <= PROCESS_LIMITS.max_output_bytes) low = middle;
    else high = middle - 1;
  }
  if (low > 0 && /[\uD800-\uDBFF]/.test(decoded[low - 1])) low -= 1;
  return { text: decoded.slice(0, low), truncated: true };
}

function publicRecord(record) {
  const output = boundedUtf8(record.output);
  return {
    id: record.id,
    executable: record.executable,
    args: [...record.args],
    cwd: record.cwd,
    status: record.status,
    exit_code: record.exit_code,
    signal: record.signal,
    stop_reason: record.stop_reason,
    output: output.text,
    output_truncated: record.output_truncated || output.truncated,
    started_at: record.started_at,
    ended_at: record.ended_at,
  };
}

function processGroupAlive(record) {
  if (process.platform === "win32") return record.parent_closed !== true;
  if (!Number.isSafeInteger(record.child.pid) || record.child.pid < 1) return false;
  try {
    process.kill(-record.child.pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function finalStatus(record) {
  return record.stop_reason === "timeout" ? "timed-out"
    : record.stop_reason === "process-error" ? "failed"
      : record.stop_reason ? "stopped"
      : record.exit_code === 0 ? "succeeded" : "failed";
}

function finalizeRecord(record, now) {
  if (!record.parent_closed || processGroupAlive(record)) return false;
  record.status = finalStatus(record);
  record.ended_at ??= now();
  if (record.timer) clearTimeout(record.timer);
  if (record.group_monitor) clearInterval(record.group_monitor);
  record.timer = null;
  record.group_monitor = null;
  return true;
}

function waitForClose(record, timeoutMs) {
  if (record.parent_closed) return Promise.resolve(true);
  return new Promise((resolveWait) => {
    let timer;
    const done = () => {
      if (timer) clearTimeout(timer);
      resolveWait(true);
    };
    record.child.once("close", done);
    timer = setTimeout(() => {
      record.child.removeListener("close", done);
      resolveWait(false);
    }, timeoutMs);
  });
}

async function waitForGroupClosure(record, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (processGroupAlive(record)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  return true;
}

export function createProcessSupervisor({ now = Date.now } = {}) {
  const records = new Map();

  const trim = () => {
    if (records.size < PROCESS_LIMITS.max_records) return;
    const removable = [...records.values()]
      .filter((record) => !["running", "stopping"].includes(record.status) && !processGroupAlive(record))
      .sort((left, right) => left.started_at - right.started_at);
    while (records.size >= PROCESS_LIMITS.max_records && removable.length > 0) {
      records.delete(removable.shift().id);
    }
  };

  const appendOutput = (record, chunk) => {
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    const available = PROCESS_LIMITS.max_output_bytes - record.output.length;
    if (available <= 0) {
      record.output_truncated = true;
      return;
    }
    record.output = Buffer.concat([record.output, incoming.subarray(0, available)]);
    if (incoming.length > available) record.output_truncated = true;
  };

  const terminate = async (id, reason = "user-stop") => {
    const record = records.get(id);
    if (!record) return { ok: false, code: "process-not-found" };
    if (!processGroupAlive(record) && record.parent_closed) {
      finalizeRecord(record, now);
      return { ok: true, code: null, process: publicRecord(record), already_closed: true };
    }
    if (record.termination != null) return record.termination;
    record.stop_reason ??= reason;
    record.termination = (async () => {
      record.status = "stopping";
      const target = process.platform === "win32" ? record.child.pid : -record.child.pid;
      try {
        process.kill(target, "SIGTERM");
      } catch {
        if (processGroupAlive(record)) {
          return { ok: false, code: "process-termination-failed", process: publicRecord(record) };
        }
      }
      if (!await waitForGroupClosure(record, PROCESS_LIMITS.termination_grace_ms)) {
        try {
          process.kill(target, "SIGKILL");
        } catch {
          if (processGroupAlive(record)) {
            return { ok: false, code: "process-termination-unconfirmed", process: publicRecord(record) };
          }
        }
        if (!await waitForGroupClosure(record, PROCESS_LIMITS.termination_grace_ms)) {
          return { ok: false, code: "process-termination-unconfirmed", process: publicRecord(record) };
        }
      }
      if (!await waitForClose(record, PROCESS_LIMITS.termination_grace_ms)) {
        return { ok: false, code: "process-termination-unconfirmed", process: publicRecord(record) };
      }
      finalizeRecord(record, now);
      return { ok: true, code: null, process: publicRecord(record), already_closed: false };
    })();
    const result = await record.termination;
    if (!result.ok) record.termination = null;
    return result;
  };

  return Object.freeze({
    start({ root, executable, args = [], cwd = ".", timeout_ms = 10 * 60 * 1_000 } = {}) {
      const active = [...records.values()].filter((entry) => ["running", "stopping"].includes(entry.status)).length;
      const resolvedExecutable = resolveExecutable(executable);
      const resolvedCwd = resolveCwd(root, cwd);
      if (active >= PROCESS_LIMITS.max_processes) return { ok: false, code: "process-capacity-exceeded" };
      trim();
      if (records.size >= PROCESS_LIMITS.max_records) return { ok: false, code: "process-capacity-exceeded" };
      if (!resolvedExecutable || !resolvedCwd || !Array.isArray(args) || args.length > PROCESS_LIMITS.max_args
        || args.some((entry) => typeof entry !== "string" || entry.length > PROCESS_LIMITS.max_arg_length || entry.includes("\0"))
        || !Number.isSafeInteger(timeout_ms) || timeout_ms < 1_000 || timeout_ms > PROCESS_LIMITS.max_timeout_ms) {
        return { ok: false, code: "process-input-invalid" };
      }
      const id = `proc-${randomBytes(8).toString("hex")}`;
      let child;
      try {
        child = spawn(resolvedExecutable, args, {
          cwd: resolvedCwd,
          env: { ...MINIMAL_ENV },
          shell: false,
          detached: process.platform !== "win32",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch {
        return { ok: false, code: "process-spawn-failed" };
      }
      const record = {
        id,
        executable: resolvedExecutable,
        args: [...args],
        cwd: resolvedCwd,
        child,
        status: "running",
        exit_code: null,
        signal: null,
        stop_reason: null,
        output: Buffer.alloc(0),
        output_truncated: false,
        started_at: now(),
        ended_at: null,
        timer: null,
        group_monitor: null,
        parent_closed: false,
        termination: null,
      };
      records.set(id, record);
      child.stdout?.on("data", (chunk) => appendOutput(record, chunk));
      child.stderr?.on("data", (chunk) => appendOutput(record, chunk));
      child.once("error", () => {
        record.stop_reason ??= "process-error";
      });
      child.once("close", (code, signal) => {
        record.exit_code = Number.isInteger(code) ? code : null;
        record.signal = typeof signal === "string" ? signal : null;
        record.parent_closed = true;
        if (!finalizeRecord(record, now) && record.group_monitor == null) {
          record.group_monitor = setInterval(() => { finalizeRecord(record, now); }, 50);
          record.group_monitor.unref?.();
        }
      });
      record.timer = setTimeout(() => { void terminate(id, "timeout"); }, timeout_ms);
      return { ok: true, code: null, process: publicRecord(record) };
    },
    status(id) {
      const record = records.get(id);
      return record
        ? { ok: true, code: null, process: publicRecord(record) }
        : { ok: false, code: "process-not-found" };
    },
    list() {
      return [...records.values()].map(publicRecord);
    },
    stop(id) {
      return terminate(id, "user-stop");
    },
    async shutdown() {
      const results = await Promise.all([...records.values()]
        .filter((record) => ["running", "stopping"].includes(record.status))
        .map((record) => terminate(record.id, "session-shutdown")));
      return { ok: results.every((entry) => entry.ok), results };
    },
  });
}
