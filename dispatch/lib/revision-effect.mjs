// Helix dispatch — real model-backed revision effect.
//
// This module turns the debate loop's injected `revise` boundary into a
// provider-policed builder effect while keeping the policy core pure.
//
// WHERE THIS SITS. `runDebate` (debate.mjs) stays policy-pure: the worktree/model
// side effects live ONLY inside the effect this module builds. `makeModelRevision`
// returns a `revise(revisionState, ctx)` function shaped exactly for
// `runDebate`'s `deps.revise` — so debate.mjs is UNCHANGED by this slice and the
// dispatch core imports nothing new (dependencies still flow inward). It is the
// same "build an injected boundary effect from config" pattern as
// `makeGitDiffStability` (git-diff-surface.mjs).
//
// BUILDER→CRITIC. The effect is the BUILDER half: given the prior revision ref and
// iteration context, it asks an injected model adapter for the next proposal and
// applies it to the worktree. The CRITIC half is the debate loop itself — each
// iteration's reviewer/redteam panel and, decisively, the OBJECTIVE GATE. This
// effect never decides convergence: `runDebate` converges only on diff-stability +
// objective-gate-pass, both deterministic checkers. A model producing a revision is
// never final authority (hard boundary), so there is no second, convergence-gating
// "critic" call inside the effect — that authority belongs to the gate alone.
//
// SAFETY POSTURE (owner decision 2026-07-09: Pi-default YOLO inside the worktree —
// no write allowlists, no edit/byte caps, no provider/cost gating; the worktree
// boundary itself and structural validation are what remain):
//   - The model's revision output is validated at the boundary; malformed output
//     fails closed and its free text is NEVER surfaced.
//   - Worktree CONTAINMENT holds: an unsafe path (traversal/absolute/null-byte/
//     outside-tree/symlink-escape/non-file target) fails closed — the effect may
//     edit anything INSIDE its worktree, never outside it. The write set is
//     applied all-or-nothing (validate every edit before mutating anything).
//   - It returns ONLY a structural ref/hash + a stable code to `runDebate`; it never
//     surfaces a thrown message, a model narrative, a private path, or provider
//     payloads in any returned/persisted field.
//
// REAL ADAPTER BOUNDARY. `deps.modelAdapter.runRevision(input, ctx)` IS the real
// adapter boundary: a live provider adapter implements it by prompting a builder
// model with the worktree + prior critique and parsing the model's structured
// edits. Presence = live: a config naming a real provider is launchable as-is.

import { readFileSync, rmSync, statSync, lstatSync, realpathSync } from "node:fs";
import { join, dirname, sep, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { validate } from "./schema.mjs";
import { PROVIDER_ID_PATTERN } from "./providers.mjs";
import { EFFORTS } from "./routes.mjs";
import { hashRef } from "./run-record.mjs";
import { MODEL_ID_PATTERN } from "./public-values.mjs";
import { writeTextAtomic } from "./persistence.mjs";

/** Stable revision codes (kebab markers; safe as a public-safe debate subcode). */
export const REVISION_CODES = Object.freeze({
  APPLIED: "revision-applied",
  INVALID_CONFIG: "invalid-revision-config",
  MISSING_ADAPTER: "revision-missing-adapter",
  ADAPTER_FAILED: "revision-adapter-failed",
  MALFORMED: "revision-malformed",
  UNSAFE_PATH: "revision-unsafe-path",
  WRITE_FAILED: "revision-write-failed",
});

/** The builder model spec. */
const BUILDER_SPEC_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["provider", "model"],
  properties: {
    provider: { type: "string", pattern: PROVIDER_ID_PATTERN },
    model: { type: "string", pattern: MODEL_ID_PATTERN },
    effort: { type: "string", enum: EFFORTS },
  },
});

/** The revision-effect config: the worktree and the builder. */
export const REVISION_CONFIG_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["cwd", "builder"],
  properties: {
    cwd: { type: "string", minLength: 1 },
    builder: BUILDER_SPEC_SCHEMA,
  },
});

/** The model's structured revision output: a bounded set of whole-file edits. */
export const REVISION_OUTPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["edits"],
  properties: {
    edits: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "content"],
        properties: {
          path: { type: "string", minLength: 1 },
          content: { type: "string" },
        },
      },
    },
  },
});

/**
 * Validate one edit path and resolve its write target, or return a stable refusal
 * code. Worktree CONTAINMENT only (owner decision: no write allowlists, no
 * secret-shape denylists): well-formed repo-relative path and in-tree containment
 * (never follow/overwrite a symlink, never write onto a non-file, never escape
 * the work tree through a symlinked parent).
 */
function resolveEditPath(rel, cwd, realCwd) {
  if (typeof rel !== "string" || rel.length === 0 || rel.includes("\0") || isAbsolute(rel) || rel.includes("..")) {
    return { code: REVISION_CODES.UNSAFE_PATH };
  }
  const full = join(cwd, rel);
  // An existing target must be a regular file — never overwrite/follow a symlink or
  // write onto a directory/fifo/socket/device.
  let st = null;
  try {
    st = lstatSync(full);
  } catch {
    st = null; // ENOENT: a new file is fine (its parent is checked next).
  }
  if (st && (st.isSymbolicLink() || !st.isFile())) return { code: REVISION_CODES.UNSAFE_PATH };
  // The parent must exist and resolve INSIDE the tree (guards a symlinked parent that
  // would let the write land outside the work tree). No mkdir from model output.
  let parentReal;
  try {
    parentReal = realpathSync(dirname(full));
  } catch {
    return { code: REVISION_CODES.UNSAFE_PATH };
  }
  if (parentReal !== realCwd && !parentReal.startsWith(realCwd + sep)) return { code: REVISION_CODES.UNSAFE_PATH };
  return { full, relative: rel, mode: st ? (st.mode & 0o777) : 0o644 };
}

/** Structural, deterministic revision ref: a content hash over the sorted edits. */
function revisionRef(edits) {
  const doc = edits
    .map((e) => `${e.path}\0${createHash("sha256").update(e.content, "utf8").digest("hex")}`)
    .sort()
    .join("\n");
  return hashRef(doc);
}

/**
 * Apply whole-file edits with rollback. Path validation has already proved every
 * target is safe; this step snapshots original bytes before mutating so a later
 * disk write failure cannot leave an earlier edit applied.
 */
function applyWritesAllOrNothing(root, writes) {
  const originals = [];
  try {
    for (const w of writes) {
      try {
        lstatSync(w.full);
        const stat = lstatSync(w.full);
        originals.push({ full: w.full, relative: w.relative, existed: true, content: readFileSync(w.full), mode: stat.mode & 0o777 });
      } catch (error) {
        if (error && error.code === "ENOENT") {
          originals.push({ full: w.full, relative: w.relative, existed: false });
          continue;
        }
        throw error;
      }
    }
    for (const w of writes) writeTextAtomic(root, w.relative, w.content, {
      mode: w.mode,
      require_writable_existing: true,
    });
  } catch (error) {
    let rollbackError = null;
    for (const original of originals) {
      try {
        if (original.existed) {
          writeTextAtomic(root, original.relative, original.content, { mode: original.mode });
        } else {
          rmSync(original.full, { force: true });
        }
      } catch (error) {
        rollbackError = error;
        break;
      }
    }
    if (rollbackError) throw rollbackError;
    throw error;
  }
}

/**
 * Build a real model-backed `revise` boundary effect for `runDebate`.
 *
 * @param {object} config see REVISION_CONFIG_SCHEMA:
 *   { cwd, builder:{provider,model,effort?} }
 * @param {object} deps injected effects:
 *   modelAdapter: { runRevision(revisionInput, ctx) → { edits: [{path, content}] } }
 *     — the REAL adapter boundary (may be async). It receives a structural,
 *     provider-bound revision input ({ role:"builder", run_id, iteration,
 *     previous_revision_ref }) and returns the next proposal as whole-file
 *     edits. A live adapter prompts a builder model and parses its edits here.
 * @returns {(revisionState:object|null, ctx:object) => Promise<{ok:boolean, revision_ref?:string, code:string}>}
 *   The shape `runDebate` injects as `deps.revise`. On success returns
 *   { ok:true, revision_ref:"sha256:…", code:"revision-applied" }; on any refusal
 *   returns { ok:false, code:"<stable-code>" } — never a thrown message, model
 *   narrative, private path, or provider payload.
 */
export function makeModelRevision(config, deps = {}) {
  const fail = (code) => ({ ok: false, code });

  return async function revise(revisionState, ctx = {}) {
    // --- config boundary (pure + cheap; re-checked each call) ------------------
    if (!validate(REVISION_CONFIG_SCHEMA, config, "$").valid) return fail(REVISION_CODES.INVALID_CONFIG);

    // --- injected effects ------------------------------------------------------
    if (!deps.modelAdapter || typeof deps.modelAdapter.runRevision !== "function") return fail(REVISION_CODES.MISSING_ADAPTER);

    // --- worktree root (real dir; canonical root for containment) --------------
    let realCwd;
    try {
      if (!statSync(config.cwd).isDirectory()) return fail(REVISION_CODES.UNSAFE_PATH);
      realCwd = realpathSync(config.cwd);
    } catch {
      return fail(REVISION_CODES.UNSAFE_PATH);
    }

    // --- model call (real adapter boundary) ------------------------------------
    const revisionInput = {
      role: "builder",
      run_id: ctx?.run_id ?? null,
      iteration: ctx?.iteration ?? null,
      previous_revision_ref: revisionState && typeof revisionState.revision_ref === "string" ? revisionState.revision_ref : null,
    };
    let output;
    try {
      output = await deps.modelAdapter.runRevision(revisionInput, ctx);
    } catch {
      // A thrown adapter may carry a private path / raw provider error / model text —
      // NEVER surface it; only a fixed structural code is returned.
      return fail(REVISION_CODES.ADAPTER_FAILED);
    }

    // --- validate the model output at the boundary -----------------------------
    if (!validate(REVISION_OUTPUT_SCHEMA, output).valid) return fail(REVISION_CODES.MALFORMED);
    const edits = output.edits;

    // --- containment, all-or-nothing (validate EVERY edit before mutating) -----
    const writes = [];
    for (const e of edits) {
      const v = resolveEditPath(e.path, config.cwd, realCwd);
      if (v.code) return fail(v.code);
      writes.push({ full: v.full, relative: v.relative, mode: v.mode, content: e.content });
    }

    // --- apply to the worktree (the only mutation this effect performs) --------
    try {
      applyWritesAllOrNothing(config.cwd, writes);
    } catch {
      return fail(REVISION_CODES.WRITE_FAILED);
    }

    return { ok: true, revision_ref: revisionRef(edits), code: REVISION_CODES.APPLIED };
  };
}
