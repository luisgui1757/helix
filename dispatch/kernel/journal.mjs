// Private effect journal. A cache hit binds workflow/node/input/runtime/base
// identity. Mutating entries additionally require a durable workspace ref and
// a caller-supplied verification of that ref before reuse.

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { appendText, writeTextAtomic } from "../lib/persistence.mjs";
import { stableWorkflowStringify } from "../workflow/schema.mjs";

const HASH = /^sha256:[0-9a-f]{64}$/;

function hash(value) {
  return `sha256:${createHash("sha256").update(stableWorkflowStringify(value)).digest("hex")}`;
}

export function effectIdentity(binding) {
  return hash(binding);
}

function validRecord(record, seq) {
  return record && typeof record === "object" && !Array.isArray(record)
    && Object.keys(record).every((key) => [
      "schema_version", "seq", "identity", "node_id", "instance_id", "input_ref", "runtime_ref",
      "before_ref", "result_ref", "workspace_ref", "mutating", "status", "result",
    ].includes(key))
    && record.schema_version === 1 && record.seq === seq
    && ["ok", "failed", "refused", "cancelled"].includes(record.status)
    && [record.identity, record.input_ref, record.runtime_ref, record.before_ref, record.result_ref]
      .every((value) => HASH.test(value))
    && (record.workspace_ref === null || HASH.test(record.workspace_ref))
    && typeof record.node_id === "string" && typeof record.instance_id === "string"
    && typeof record.mutating === "boolean";
}

export function createEffectJournal({ root = null, run_id = null, verify_workspace = null, expected_records = null } = {}) {
  const records = [];
  const byIdentity = new Map();
  const relativePath = run_id ? `${run_id}.kernel.journal.jsonl` : null;
  if (root != null && relativePath != null) {
    const path = new URL(`file://${root.endsWith("/") ? root : `${root}/`}${relativePath}`).pathname;
    if (existsSync(path)) {
      try {
        const stat = lstatSync(path);
        const text = stat.isFile() && !stat.isSymbolicLink() && stat.size <= 8 * 1024 * 1024
          ? readFileSync(path, "utf8") : null;
        if (text == null || (text !== "" && !text.endsWith("\n"))) throw new Error("invalid");
        for (const [index, line] of text.split("\n").filter(Boolean).entries()) {
          const record = JSON.parse(line);
          if (!validRecord(record, index + 1) || byIdentity.has(record.identity)) throw new Error("invalid");
          records.push(record);
          byIdentity.set(record.identity, record);
        }
        if (expected_records != null) {
          if (!Number.isSafeInteger(expected_records) || expected_records < 0 || records.length < expected_records) {
            throw new Error("invalid");
          }
          if (records.length > expected_records) {
            records.splice(expected_records);
            byIdentity.clear();
            records.forEach((record) => byIdentity.set(record.identity, record));
            writeTextAtomic(root, relativePath, records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : ""));
          }
        }
      } catch {
        throw new Error("kernel-journal-corrupt");
      }
    }
  }
  return Object.freeze({
    records() { return structuredClone(records); },
    lookup(identity, { mutating = false } = {}) {
      const record = byIdentity.get(identity);
      if (!record || record.status !== "ok" || record.mutating !== mutating) return null;
      if (mutating && (record.workspace_ref == null || typeof verify_workspace !== "function"
        || verify_workspace(record.workspace_ref) !== true)) return null;
      return structuredClone(record);
    },
    commit({ identity, node_id, instance_id, input_ref, runtime_ref, before_ref, workspace_ref = null, mutating, status, result }) {
      if (byIdentity.has(identity)) return { ok: false, code: "kernel-journal-identity-collision" };
      const record = {
        schema_version: 1,
        seq: records.length + 1,
        identity,
        node_id,
        instance_id,
        input_ref,
        runtime_ref,
        before_ref,
        result_ref: hash(result),
        workspace_ref,
        mutating,
        status,
        result: structuredClone(result),
      };
      if (!validRecord(record, record.seq) || (mutating && status === "ok" && workspace_ref == null)) {
        return { ok: false, code: "kernel-journal-record-invalid" };
      }
      try {
        if (root != null && relativePath != null) appendText(root, relativePath, `${JSON.stringify(record)}\n`);
      } catch {
        return { ok: false, code: "kernel-journal-write-failed" };
      }
      records.push(record);
      byIdentity.set(identity, record);
      return { ok: true, record: structuredClone(record) };
    },
  });
}

export function journalRef(value) {
  return hash(value);
}
