// Helix dispatch — structural run directory hygiene/status tooling.
//
// Command and CLI adapters inject the user-local runs directory. This module
// only manages structural JSON records and summaries; it
// never reads provider payload logs, transcripts, auth files, or private run
// payloads.

import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { assertPublicSafe, DEFAULT_RUN_RECORD_DIR, hashRef, validateRunRecord } from "./run-record.mjs";
import { validateDebateSummary } from "./debate.mjs";
import { PERSISTENCE_CODES, reserveConfinedDirectory } from "./persistence.mjs";

const RUN_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

function fail(code, detail = null) {
  return { ok: false, code, detail };
}

function rootPath(root = DEFAULT_RUN_RECORD_DIR) {
  return resolve(root);
}

export function validateRunId(runId) {
  if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId)) return fail("unsafe-run-id", "run-id-pattern");
  if (runId === "." || runId === "..") return fail("unsafe-run-id", "run-id-dot-segment");
  return { ok: true, run_id: runId };
}

function safeRunDir(root, runId) {
  const valid = validateRunId(runId);
  if (!valid.ok) return valid;
  const base = rootPath(root);
  const path = resolve(base, runId);
  if (path === base) return fail("unsafe-run-path", "run-path-root");
  if (path !== base && !path.startsWith(base + sep)) return fail("unsafe-run-path", "run-path-escape");
  return { ok: true, root: base, path };
}

export function prepareRunDirectory(root, runId, options = {}) {
  const safe = safeRunDir(root, runId);
  if (!safe.ok) return safe;
  if (options.clean === true) return fail("run-directory-clean-forbidden", "use-confirmed-prune");
  try {
    // Non-recursive mkdir is the reservation: concurrent creators cannot both
    // win the same run id, and existing/corrupt evidence is never removed.
    reserveConfinedDirectory(safe.root, runId);
  } catch (error) {
    if (error?.code === PERSISTENCE_CODES.EXISTS || error?.code === PERSISTENCE_CODES.SYMLINK) {
      return fail("run-directory-exists", "run-id-already-exists");
    }
    return fail("run-directory-create-failed", "run-directory-create-failed");
  }
  return { ok: true, path: safe.path };
}

function readJsonFile(path) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  assertPublicSafe(parsed);
  return parsed;
}

function recordIdFromFilename(path) {
  const name = basename(path);
  const stem = name.endsWith(".debate.json") ? name.slice(0, -".debate.json".length) : name.slice(0, -".json".length);
  return RUN_ID_PATTERN.test(stem) && stem !== "." && stem !== ".."
    ? stem
    : `invalid-${hashRef(name).slice("sha256:".length, "sha256:".length + 16)}`;
}

function publicPathLabel(root, path) {
  const rel = relative(rootPath(root), path);
  return rel.split(sep).every((part) => /^[A-Za-z0-9._-]+$/.test(part))
    ? rel
    : `redacted-id:${hashRef(rel).slice("sha256:".length)}`;
}

function entryFromJson(root, path) {
  const json = readJsonFile(path);
  const rel = publicPathLabel(root, path);
  const prunable = rel.includes(sep);
  if (basename(path).endsWith(".debate.json")) {
    const valid = validateDebateSummary(json);
    if (!valid.valid || basename(path) !== `${json.run_id}.debate.json`) throw new Error("debate-record-invalid");
    return {
      kind: "debate",
      run_id: json.run_id,
      status: json.converged ? "ok" : "fail-closed",
      stop_reason: json.stop_reason ?? null,
      iterations_run: json.iterations_run ?? null,
      total_tokens: json.total_tokens ?? null,
      path: rel,
      prunable,
    };
  }
  const valid = validateRunRecord(json);
  if (!valid.valid || basename(path) !== `${json.run_id}.json`) throw new Error("run-record-invalid");
  return {
    kind: "dispatch",
    run_id: json.run_id,
    status: json.exit_status,
    stop_reason: json.gate?.result ?? null,
    iterations_run: json.iteration_count ?? null,
    total_tokens: json.usage_rollup != null
      ? (json.usage_rollup.input_tokens ?? 0) + (json.usage_rollup.output_tokens ?? 0)
      : null,
    path: rel,
    prunable,
  };
}

function collectJsonFiles(root) {
  const base = rootPath(root);
  if (!existsSync(base)) return [];
  const files = [];
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    const first = join(base, entry.name);
    if (entry.isFile() && entry.name.endsWith(".json")) files.push(first);
    if (entry.isDirectory()) {
      for (const child of readdirSync(first, { withFileTypes: true })) {
        if (child.isFile() && child.name.endsWith(".json")) files.push(join(first, child.name));
      }
    }
  }
  return files.sort();
}

function isManagedCompanion(path) {
  const name = basename(path);
  const runId = basename(dirname(path));
  const escapedRunId = runId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return name === `${runId}.state.json`
    || name === `${runId}.disagreements.json`
    || name === `${runId}.research.json`
    || new RegExp(`^${escapedRunId}\\.disagreements\\.[0-9a-f]{64}\\.json$`).test(name);
}

export function listRuns(root = DEFAULT_RUN_RECORD_DIR) {
  const entries = [];
  for (const file of collectJsonFiles(root)) {
    // These are separately validated by the resume/research surfaces. They are
    // not dispatch or debate records, so listing them as corrupt records would
    // make every valid staged/research run look damaged.
    if (isManagedCompanion(file)) continue;
    try {
      const entry = entryFromJson(root, file);
      if (entry) entries.push(entry);
    } catch {
      const rel = publicPathLabel(root, file);
      entries.push({
        kind: "invalid",
        run_id: recordIdFromFilename(file),
        status: "fail-closed",
        stop_reason: "record-invalid-or-unsafe",
        iterations_run: null,
        total_tokens: null,
        path: rel,
        prunable: rel.includes(sep),
      });
    }
  }
  return entries;
}

export function statusRun(root, runId) {
  const safe = safeRunDir(root, runId);
  if (!safe.ok) return safe;
  const legacyIteration = new RegExp(`^${runId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-iter[1-9]\\d*$`);
  const stagedPass = new RegExp(`^${runId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-p[1-9]\\d*$`);
  const matches = listRuns(root).filter((entry) =>
    entry.run_id === runId
    || legacyIteration.test(entry.run_id)
    || stagedPass.test(entry.run_id));
  if (matches.length === 0) return fail("run-not-found", "run-id-not-found");
  return { ok: true, run_id: runId, entries: matches };
}

export function pruneRun(root, runId) {
  const safe = safeRunDir(root, runId);
  if (!safe.ok) return safe;
  if (!existsSync(safe.path)) return fail("run-not-found", "run-id-not-found");
  if (!statSync(safe.path).isDirectory()) return fail("run-path-not-directory", "run-path-not-directory");
  rmSync(safe.path, { recursive: true, force: true });
  return { ok: true, run_id: runId };
}
