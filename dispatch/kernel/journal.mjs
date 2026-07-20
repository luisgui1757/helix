// Private effect journal. Current records bind the executing run namespace plus
// workflow/node/input/runtime/base identity. Mutating entries additionally
// require a durable workspace ref and a caller-supplied verification of that ref
// before reuse. Legacy records remain readable but cannot prove current-run
// continuation identity.

import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { appendText, resolveConfinedFile } from "../lib/persistence.mjs";
import { stableWorkflowStringify } from "../workflow/schema.mjs";

const HASH = /^sha256:[0-9a-f]{64}$/;
const FAILURE_CODE = /^[a-z0-9][a-z0-9-]{0,159}$/;
export const KERNEL_JOURNAL_LIMITS = Object.freeze({
  max_document_bytes: 8 * 1024 * 1024,
  min_failure_headroom_bytes: 16 * 1024,
});

function hash(value) {
  const serialized = stableWorkflowStringify(value);
  if (typeof serialized !== "string") return null;
  return `sha256:${createHash("sha256").update(serialized).digest("hex")}`;
}

function requiredHash(value) {
  const ref = hash(value);
  if (ref == null) throw new Error("kernel-journal-value-invalid");
  return ref;
}

export function effectIdentity(binding) {
  return requiredHash(binding);
}

function validResult(result, status) {
  return result !== null && typeof result === "object" && !Array.isArray(result)
    && result.status === status
    && (status === "ok" || FAILURE_CODE.test(result.code ?? ""));
}

function validRecord(record, seq) {
  return record && typeof record === "object" && !Array.isArray(record)
    && Object.keys(record).every((key) => [
      "schema_version", "seq", "run_id", "identity", "node_id", "instance_id", "input_ref", "runtime_ref",
      "before_ref", "base_identity", "result_ref", "workspace_ref", "mutating", "status", "result",
    ].includes(key))
    && [1, 2, 3].includes(record.schema_version) && record.seq === seq
    && (record.schema_version === 3
      ? typeof record.run_id === "string" && record.run_id.length > 0
      : !Object.hasOwn(record, "run_id"))
    && ["ok", "failed", "refused", "cancelled"].includes(record.status)
    && [record.identity, record.input_ref, record.runtime_ref, record.before_ref, record.result_ref]
      .every((value) => HASH.test(value))
    && (record.schema_version === 1 ? !Object.hasOwn(record, "base_identity") : HASH.test(record.base_identity))
    && (record.workspace_ref === null || HASH.test(record.workspace_ref))
    && typeof record.node_id === "string" && typeof record.instance_id === "string"
    && typeof record.mutating === "boolean"
    && validResult(record.result, record.status)
    && hash(record.result) === record.result_ref;
}

export function createEffectJournal({ root = null, run_id = null, verify_workspace = null, expected_records = null } = {}) {
  const records = [];
  const byIdentity = new Map();
  let bytes = 0;
  const relativePath = run_id ? `${run_id}.kernel.journal.jsonl` : null;
  if (root != null && relativePath != null) {
    try {
      const resolved = resolveConfinedFile(root, relativePath, { allow_missing: true });
      if (!resolved.exists && expected_records !== null && expected_records !== 0) throw new Error("invalid");
      if (resolved.exists) {
        const path = resolved.path;
        const stat = lstatSync(path);
        const text = stat.isFile() && !stat.isSymbolicLink() && stat.size <= KERNEL_JOURNAL_LIMITS.max_document_bytes
          ? readFileSync(path, "utf8") : null;
        if (text == null || (text !== "" && !text.endsWith("\n"))) throw new Error("invalid");
        for (const [index, line] of text.split("\n").filter(Boolean).entries()) {
          const record = JSON.parse(line);
          if (!validRecord(record, index + 1) || byIdentity.has(record.identity)) throw new Error("invalid");
          records.push(record);
          byIdentity.set(record.identity, record);
        }
        bytes = stat.size;
        if (expected_records != null) {
          if (!Number.isSafeInteger(expected_records) || expected_records < 0 || records.length < expected_records) {
            throw new Error("invalid");
          }
        }
      }
    } catch {
      throw new Error("kernel-journal-corrupt");
    }
  }
  const prepareRecord = ({ run_id: recordRunId, identity, base_identity = identity, node_id, instance_id, input_ref, runtime_ref, before_ref, workspace_ref = null, mutating, status, result }) => {
    let clonedResult;
    try { clonedResult = structuredClone(result); }
    catch { return { ok: false, code: "kernel-journal-value-invalid" }; }
    const resultRef = hash(clonedResult);
    if (resultRef == null) return { ok: false, code: "kernel-journal-value-invalid" };
    const record = {
      schema_version: 3,
      seq: records.length + 1,
      run_id: recordRunId,
      identity,
      base_identity,
      node_id,
      instance_id,
      input_ref,
      runtime_ref,
      before_ref,
      result_ref: resultRef,
      workspace_ref,
      mutating,
      status,
      result: clonedResult,
    };
    if (!validRecord(record, record.seq) || (mutating && status === "ok" && workspace_ref == null)) {
      return { ok: false, code: "kernel-journal-record-invalid" };
    }
    const line = `${JSON.stringify(record)}\n`;
    return { ok: true, record, line, line_bytes: Buffer.byteLength(line, "utf8") };
  };
  return Object.freeze({
    records() { return structuredClone(records); },
    suffix(expected = 0) {
      if (!Number.isSafeInteger(expected) || expected < 0 || expected > records.length) {
        return { ok: false, code: "kernel-journal-corrupt", records: [] };
      }
      return { ok: true, records: structuredClone(records.slice(expected)) };
    },
    nextInvocation(baseIdentity, { run_id: recordRunId = null } = {}) {
      if (!HASH.test(baseIdentity ?? "")) return null;
      return records.filter((record) => (record.base_identity ?? record.identity) === baseIdentity
        && (recordRunId == null || record.run_id === recordRunId)).length + 1;
    },
    find(identity, { mutating = null, run_id: recordRunId = null } = {}) {
      const record = byIdentity.get(identity);
      if (!record || (mutating !== null && record.mutating !== mutating)
        || (recordRunId != null && record.run_id !== recordRunId)) return null;
      return structuredClone(record);
    },
    lookup(identity, { mutating = false, run_id: recordRunId = null } = {}) {
      const record = byIdentity.get(identity);
      if (!record || record.status !== "ok" || record.mutating !== mutating
        || (recordRunId != null && record.run_id !== recordRunId)) return null;
      if (mutating) {
        if (record.workspace_ref == null || typeof verify_workspace !== "function") return null;
        try { if (verify_workspace(record.workspace_ref) !== true) return null; }
        catch { return null; }
      }
      return structuredClone(record);
    },
    lookupBase(baseIdentity, { mutating = false, run_id: recordRunId = null } = {}) {
      const record = records.findLast((entry) => (entry.base_identity ?? entry.identity) === baseIdentity
        && entry.status === "ok" && entry.mutating === mutating
        && (recordRunId == null || entry.run_id === recordRunId));
      if (!record) return null;
      if (mutating) {
        if (record.workspace_ref == null || typeof verify_workspace !== "function") return null;
        try { if (verify_workspace(record.workspace_ref) !== true) return null; }
        catch { return null; }
      }
      return structuredClone(record);
    },
    canCommit(candidate, { reserve_bytes: reserveBytes = 0 } = {}) {
      if (!Number.isSafeInteger(reserveBytes) || reserveBytes < 0) {
        return { ok: false, code: "kernel-journal-capacity-invalid" };
      }
      const prepared = prepareRecord(candidate);
      if (!prepared.ok) return prepared;
      const existing = byIdentity.get(prepared.record.identity);
      if (existing) {
        return hash({ ...existing, seq: prepared.record.seq }) === hash(prepared.record)
          ? { ok: true, existing: true }
          : { ok: false, code: "kernel-journal-identity-collision" };
      }
      return bytes + prepared.line_bytes + reserveBytes <= KERNEL_JOURNAL_LIMITS.max_document_bytes
        ? { ok: true }
        : { ok: false, code: "kernel-journal-capacity-exceeded" };
    },
    commit(candidate) {
      const prepared = prepareRecord(candidate);
      if (!prepared.ok) return prepared;
      const { record, line, line_bytes: lineBytes } = prepared;
      const existing = byIdentity.get(record.identity);
      if (existing) {
        return hash({ ...existing, seq: record.seq }) === hash(record)
          ? { ok: true, record: structuredClone(existing), existing: true }
          : { ok: false, code: "kernel-journal-identity-collision" };
      }
      if (bytes + lineBytes > KERNEL_JOURNAL_LIMITS.max_document_bytes) {
        return { ok: false, code: "kernel-journal-capacity-exceeded" };
      }
      try {
        if (root != null && relativePath != null) appendText(root, relativePath, line);
      } catch {
        return { ok: false, code: "kernel-journal-write-failed" };
      }
      bytes += lineBytes;
      records.push(record);
      byIdentity.set(record.identity, record);
      return { ok: true, record: structuredClone(record) };
    },
  });
}

export function journalRef(value) {
  return requiredHash(value);
}

export function tryJournalRef(value) {
  return hash(value);
}
