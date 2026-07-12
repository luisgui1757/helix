// Helix dispatch — clean-context handoff packets + disagreement log (M6).
//
// Each stage starts FRESH: it receives a handoff packet (claims, counterclaims,
// evidence refs, unresolved disagreement ids) instead of a dragged transcript.
// Packets are ADAPTER INPUTS (Stage 3D precedent): they may carry substantive
// text BETWEEN steps, but records/events persist only the structural
// projection (ids, hashes, refs, counts).
//
// The disagreement log extends contradiction preservation: entries are
// structural (hashes + status), persisted per run, and merging never drops an
// open entry — a disagreement disappears only by being explicitly resolved.
//
// context-engine toggle OFF degenerates to transcript pass-through: the next
// stage receives the prior stage's raw outputs instead of a packet (recorded
// as a warning; still an adapter input, still never persisted).

import { join } from "node:path";
import { hashRef, assertPublicSafe, REF_PATTERN, stableStringify } from "./run-record.mjs";
import { writeTextAtomic } from "./persistence.mjs";

export const HANDOFF_CODES = Object.freeze({
  INVALID_PACKET: "invalid-handoff-packet",
  INVALID_ENTRY: "invalid-disagreement-entry",
});

const DISAGREEMENT_STATUSES = Object.freeze(["open", "preserved", "resolved"]);
const CODE_PATTERN = /^[A-Za-z0-9._:/-]+$/;
const RUN_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

function disagreementEntryErrors(entry, path = "entry") {
  const errors = [];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [`${path}:not-object`];
  for (const key of Object.keys(entry)) {
    if (!["id", "stage_id", "status"].includes(key)) errors.push(`${path}:unexpected-field:${key}`);
  }
  if (typeof entry.id !== "string" || !REF_PATTERN.test(entry.id)) errors.push(`${path}:invalid-id`);
  if (typeof entry.stage_id !== "string" || !CODE_PATTERN.test(entry.stage_id)) errors.push(`${path}:invalid-stage-id`);
  if (!DISAGREEMENT_STATUSES.includes(entry.status)) errors.push(`${path}:invalid-status`);
  return errors;
}

/** Closed validator for the persisted disagreement document read on resume. */
export function validateDisagreementDocument(doc, expectedRunId = null) {
  const errors = [];
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { valid: false, errors: ["document-not-object"] };
  for (const key of Object.keys(doc)) {
    if (!["schema_version", "run_id", "entries"].includes(key)) errors.push(`unexpected-field:${key}`);
  }
  if (doc.schema_version !== 1) errors.push("invalid-schema-version");
  if (typeof doc.run_id !== "string" || !RUN_ID_PATTERN.test(doc.run_id)) errors.push("invalid-run-id");
  if (expectedRunId !== null && doc.run_id !== expectedRunId) errors.push("run-id-mismatch");
  if (!Array.isArray(doc.entries)) errors.push("entries-not-array");
  else doc.entries.forEach((entry, index) => errors.push(...disagreementEntryErrors(entry, `entries[${index}]`)));
  try {
    assertPublicSafe(doc);
  } catch {
    errors.push("public-safety-scan-failed");
  }
  return { valid: errors.length === 0, errors };
}

function assertDisagreementEntry(entry) {
  if (disagreementEntryErrors(entry).length > 0) throw new Error(HANDOFF_CODES.INVALID_ENTRY);
}

/**
 * Build a handoff packet from a stage's outputs. Claims carry text (adapter
 * input); every claim gets a deterministic content hash so the structural
 * projection can reference it without the text.
 *
 * @param {object} args { from_stage, to_stage, claims: [{text, evidence?:
 *   [{path, ref}]}], counterclaims?: [{text}], disagreement_ids?: string[] }
 */
export function buildHandoffPacket(args = {}) {
  const { from_stage, to_stage } = args;
  if (!Array.isArray(args.claims ?? []) || !Array.isArray(args.counterclaims ?? [])
    || !Array.isArray(args.disagreement_ids ?? [])) throw new Error(HANDOFF_CODES.INVALID_PACKET);
  if ([...(args.claims ?? []), ...(args.counterclaims ?? [])].some((claim) => !claim || typeof claim !== "object" || Array.isArray(claim))) {
    throw new Error(HANDOFF_CODES.INVALID_PACKET);
  }
  if ((args.claims ?? []).some((claim) => !Array.isArray(claim.evidence ?? []))) throw new Error(HANDOFF_CODES.INVALID_PACKET);
  const claims = (args.claims ?? []).map((claim) => ({
    id: hashRef(String(claim.text ?? "")),
    text: String(claim.text ?? ""),
    evidence: (claim.evidence ?? []).map((e) => ({ path: String(e.path ?? ""), ref: String(e.ref ?? "") })),
  }));
  const counterclaims = (args.counterclaims ?? []).map((claim) => ({
    id: hashRef(String(claim.text ?? "")),
    text: String(claim.text ?? ""),
  }));
  return {
    kind: "packet",
    from_stage: String(from_stage ?? ""),
    to_stage: String(to_stage ?? ""),
    claims,
    counterclaims,
    disagreement_ids: [...(args.disagreement_ids ?? [])],
  };
}

/**
 * The structural, public-safe projection of a packet — the ONLY part that may
 * enter records/events. No claim text survives this projection.
 */
export function packetRecord(packet) {
  if (!packet || packet.kind !== "packet" || !Array.isArray(packet.claims)
    || !Array.isArray(packet.counterclaims) || !Array.isArray(packet.disagreement_ids)) {
    throw new Error(HANDOFF_CODES.INVALID_PACKET);
  }
  if (packet.claims.some((claim) => !claim || typeof claim !== "object" || !Array.isArray(claim.evidence)
      || claim.evidence.some((evidence) => !evidence || typeof evidence !== "object"))
    || packet.counterclaims.some((claim) => !claim || typeof claim !== "object")) {
    throw new Error(HANDOFF_CODES.INVALID_PACKET);
  }
  const record = {
    from_stage: packet.from_stage,
    to_stage: packet.to_stage,
    claim_ids: packet.claims.map((c) => c.id),
    counterclaim_ids: packet.counterclaims.map((c) => c.id),
    evidence_refs: packet.claims.flatMap((c) => c.evidence.map((e) => e.ref)).filter(Boolean),
    disagreement_ids: [...packet.disagreement_ids],
  };
  if (typeof record.from_stage !== "string" || !CODE_PATTERN.test(record.from_stage)
    || typeof record.to_stage !== "string" || !CODE_PATTERN.test(record.to_stage)
    || [...record.claim_ids, ...record.counterclaim_ids, ...record.evidence_refs, ...record.disagreement_ids]
      .some((ref) => typeof ref !== "string" || !REF_PATTERN.test(ref))) {
    throw new Error(HANDOFF_CODES.INVALID_PACKET);
  }
  assertPublicSafe(record);
  return record;
}

/** Transcript-mode handoff (context-engine OFF): raw prior outputs, adapter input only. */
export function buildTranscriptHandoff(fromStage, toStage, outputs) {
  return {
    kind: "transcript",
    from_stage: String(fromStage ?? ""),
    to_stage: String(toStage ?? ""),
    outputs: (outputs ?? []).map((o) => String(o)),
  };
}

/**
 * Extract disagreement entries from a stage's launched envelopes: every
 * open_questions/risks marker becomes a structural entry (hash, never text).
 */
export function extractDisagreements(envelopes, stageId) {
  const entries = [];
  for (const envelope of envelopes ?? []) {
    for (const marker of [...(envelope.open_questions ?? []), ...(envelope.risks ?? [])]) {
      entries.push({
        id: hashRef(String(marker)),
        stage_id: String(stageId),
        status: "open",
      });
    }
  }
  return entries;
}

/**
 * Append-only per-run disagreement log; merge never drops an open entry.
 * `seed` rehydrates a persisted log on resume so open disagreements from before
 * an interrupt are not silently dropped.
 */
export function makeDisagreementLog(seed = []) {
  const entries = new Map(); // id -> entry
  if (!Array.isArray(seed)) throw new Error(HANDOFF_CODES.INVALID_ENTRY);
  for (const entry of seed) {
    assertDisagreementEntry(entry);
    const existing = entries.get(entry.id);
    if (existing && existing.stage_id !== entry.stage_id) throw new Error(HANDOFF_CODES.INVALID_ENTRY);
    entries.set(entry.id, { id: entry.id, stage_id: entry.stage_id, status: entry.status });
  }

  function add(entry) {
    assertDisagreementEntry(entry);
    const existing = entries.get(entry.id);
    if (!existing) {
      entries.set(entry.id, { id: entry.id, stage_id: entry.stage_id, status: entry.status });
      return;
    }
    if (existing.stage_id !== entry.stage_id) throw new Error(HANDOFF_CODES.INVALID_ENTRY);
    // Merge rule: resolved wins only as an EXPLICIT transition; an open entry
    // can never be silently dropped or demoted.
    if (existing.status !== "resolved" && entry.status === "resolved") {
      entries.set(entry.id, { ...existing, status: "resolved" });
    } else if (existing.status === "open" && entry.status === "preserved") {
      entries.set(entry.id, { ...existing, status: "preserved" });
    }
  }

  function list() {
    return [...entries.values()];
  }

  function openCount() {
    return list().filter((e) => e.status !== "resolved").length;
  }

  function write(dir, runId) {
    const doc = {
      schema_version: 1,
      run_id: runId,
      entries: list(),
    };
    const valid = validateDisagreementDocument(doc, runId);
    if (!valid.valid) throw new Error(`${HANDOFF_CODES.INVALID_ENTRY}:${valid.errors.join(",")}`);
    assertPublicSafe(doc);
    const path = join(dir, `${runId}.disagreements.json`);
    writeTextAtomic(dir, `${runId}.disagreements.json`, stableStringify(doc) + "\n");
    return path;
  }

  return { add, list, openCount, write };
}
