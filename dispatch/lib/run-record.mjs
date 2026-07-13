// Helix dispatch — public-safe run-record writer.
//
// Persists STRUCTURAL public-safe records only: ids, hashes/refs, metadata, and
// rollups — never raw prompts, model responses, provider payloads, transcripts,
// private code, secrets, session URLs, or home paths. Claims/evidence are
// refs/hashes to ignored local storage, never free text. Branch names and gate
// file paths are plain only when the run target is THIS repository; for any other
// target they are hashed.
//
// The builder fails closed: malformed input, free-text refs, or any public-safety
// pattern in the assembled record throws rather than persisting.

import { createHash } from "node:crypto";
import { join } from "node:path";
import { validate, assertValid, SchemaError } from "./schema.mjs";
import { HELIX_PROVIDERS } from "./providers.mjs";
import { ROLES } from "./role-envelope.mjs";
import { HELIX_TOGGLES } from "./settings.mjs";
import {
  INPUT_REF_VALUE_PATTERNS,
  MODEL_ID_PATTERN,
  PUBLIC_CODE_PATTERN,
  REF_PATTERN,
  isModelId,
  isPublicCode,
  isPublicRef,
} from "./public-values.mjs";
import { writeTextAtomic } from "./persistence.mjs";

export { PUBLIC_CODE_PATTERN, REF_PATTERN } from "./public-values.mjs";

/** Legacy relative default for direct library callers; product adapters inject user state. */
export const DEFAULT_RUN_RECORD_DIR = "dispatch/runs";


const RUN_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const RELATIVE_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._@+/-]+$/;

/**
 * Per-kind ref/hash patterns for `input_refs[].value`. Inputs enter the public
 * record only as redacted refs/hashes (spec §"Public-Safe Logging"); raw prompt
 * text must never reach a tracked record. Each kind constrains its value shape.
 */
export { INPUT_REF_VALUE_PATTERNS } from "./public-values.mjs";

/**
 * The algorithm each input-ref kind must record: a `sha256` hash records
 * `"sha256"`; non-hash refs (`local-ref`/`redacted-id`) record `null`. This
 * keeps `algorithm` meaningful — a sha256 ref may not leave it `null`.
 */
export const INPUT_REF_ALGORITHM = Object.freeze({
  sha256: "sha256",
  "local-ref": null,
  "redacted-id": null,
});

/** Compute a stable content ref for a value that must not appear in the clear. */
export function hashRef(text) {
  return "sha256:" + createHash("sha256").update(String(text), "utf8").digest("hex");
}

const refSchema = { type: "string", pattern: REF_PATTERN };

export const RUN_RECORD_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version", "run_id", "timestamp", "task_class", "route_id", "role_ids",
    "provider_ids", "model_ids", "usage_rollup",
    "iteration_count", "exit_status", "gate", "warning_codes",
    "judge", "input_refs", "claims_ref", "evidence_ref", "run_target",
  ],
  properties: {
    schema_version: { const: 2 },
    run_id: { type: "string", pattern: RUN_ID_PATTERN },
    timestamp: { anyOf: [{ type: "string", pattern: ISO_TIMESTAMP_PATTERN }, { type: "integer", minimum: 0 }] },
    task_class: { type: "string", pattern: PUBLIC_CODE_PATTERN },
    route_id: { type: "string", pattern: PUBLIC_CODE_PATTERN },
    role_ids: { type: "array", items: { type: "string", enum: ROLES } },
    provider_ids: { type: "array", items: { type: "string", enum: HELIX_PROVIDERS } },
    model_ids: { type: "array", items: { type: "string", pattern: MODEL_ID_PATTERN } },
    // Token counts are capacity telemetry only — Helix does no cost accounting.
    usage_rollup: {
      type: "object",
      additionalProperties: false,
      required: ["input_tokens", "output_tokens"],
      properties: {
        input_tokens: { type: "integer", minimum: 0 },
        output_tokens: { type: "integer", minimum: 0 },
      },
    },
    iteration_count: { type: "integer", minimum: 0 },
    exit_status: { type: "string", enum: ["ok", "blocked", "failed", "refused", "timeout", "fail-closed"] },
    gate: {
      type: "object",
      additionalProperties: false,
      required: ["command_names", "kind", "result", "source"],
      properties: {
        command_names: { type: "array", items: { type: "string", pattern: PUBLIC_CODE_PATTERN } },
        kind: { type: "string", enum: ["objective", "advisory"] },
        result: { type: "string", enum: ["pass", "fail", "not-run"] },
        // Gate outcome MUST come from process exit status or a deterministic
        // checker — never a model narrative. "model" is not an allowed source.
        source: { type: "string", enum: ["exit-status", "deterministic-checker", "advisory"] },
      },
    },
    warning_codes: { type: "array", items: { type: "string", pattern: PUBLIC_CODE_PATTERN } },
    judge: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["seed", "permutation", "blinding", "rubric_id", "label_reveal_events", "judge_in_panel"],
          properties: {
            seed: { type: "integer" },
            permutation: { type: "array", items: { type: "integer", minimum: 0 } },
            blinding: { type: "boolean" },
            rubric_id: { type: "string", pattern: PUBLIC_CODE_PATTERN },
            label_reveal_events: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["key", "field", "reason"],
                properties: {
                  key: { type: "string", pattern: PUBLIC_CODE_PATTERN },
                  field: { type: "string", pattern: PUBLIC_CODE_PATTERN },
                  reason: { type: "string", pattern: PUBLIC_CODE_PATTERN },
                },
              },
            },
            judge_in_panel: { type: "boolean" },
          },
        },
      ],
    },
    input_refs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "value", "algorithm"],
        properties: {
          kind: { type: "string", enum: ["sha256", "redacted-id", "local-ref"] },
          value: { type: "string", minLength: 1 },
          algorithm: { anyOf: [{ type: "string", enum: ["sha256"] }, { type: "null" }] },
        },
      },
    },
    claims_ref: refSchema,
    evidence_ref: refSchema,
    run_target: {
      type: "object",
      additionalProperties: false,
      required: ["repo"],
      properties: {
        repo: { type: "string", enum: ["self", "other"] },
        ref: refSchema,
      },
    },
    // Conditional: plain only for repo==="self"; hashed for any other target.
    branch: { anyOf: [{ type: "string", pattern: BRANCH_PATTERN }, refSchema] },
    gate_file_paths: { type: "array", items: { anyOf: [{ type: "string", pattern: RELATIVE_PATH_PATTERN }, refSchema] } },
    // The resolved feature-toggle vector this run executed under — exactly
    // the six booleans, so a record is reproducible against its settings.
    // Optional: pre-toggle callers omit it; the runner always embeds it.
    toggles: {
      type: "object",
      additionalProperties: false,
      required: [...HELIX_TOGGLES],
      properties: Object.fromEntries(HELIX_TOGGLES.map((t) => [t, { type: "boolean" }])),
    },
  },
});

/** Public-safety leak patterns (mirrors tools/ship/pr-gate.sh intent). */
const LEAK_PATTERNS = Object.freeze([
  { code: "home-path", re: /(?:\/Users\/[a-z][a-z0-9_-]*\/|\/home\/[a-z][a-z0-9_-]*\/|[A-Z]:\\+Users\\+[a-z][a-z0-9_-]*\\+)/i },
  { code: "session-url", re: /claude\.ai\/(code|share)|\/session\/[a-z0-9]{8,}/i },
  { code: "uri", re: /\b[a-z][a-z0-9+.-]*:\/{1,2}[^\s"']+/i },
  { code: "web-url", re: /\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?\/[a-z0-9._~!$&'()*+,;=:@%/-]*/i },
  // Modern key forms carry hyphenated prefixes (sk-proj-…, sk-live-…, sk-ant-api03-…),
  // so allow hyphens in the body rather than only bare sk-… tokens.
  { code: "provider-key", re: /sk-[a-z0-9-]{20,}|ghp_[a-z0-9]{20,}|gho_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}/i },
  { code: "auth-token", re: /"(access_token|refresh_token)"\s*:\s*"/i },
  {
    code: "provenance",
    re: new RegExp("Co-Authored-By:\\s|Claude-Session:\\s|" + "Generated " + "with", "i"),
  },
]);

/**
 * Fail-closed public-safety scan over the serialized record. Throws when any leak
 * pattern matches — "public-safe logging cannot be guaranteed" ⇒ stop.
 * @param {object} record
 */
export function assertPublicSafe(record) {
  const serialized = stableStringify(record);
  const hits = LEAK_PATTERNS.filter((p) => p.re.test(serialized)).map((p) => p.code);
  if (hits.length > 0) {
    throw new Error(`run-record public-safety scan failed: ${hits.join(", ")}`);
  }
}

function assertRef(value, label) {
  if (!isPublicRef(value)) {
    throw new SchemaError(label, [{ path: `$.${label}`, message: "must be a ref/hash, not free text" }]);
  }
}

function identifierGrammarErrors(record) {
  const errors = [];
  const codeFields = [
    ["$.task_class", record.task_class],
    ["$.route_id", record.route_id],
    ...record.warning_codes.map((value, index) => [`$.warning_codes[${index}]`, value]),
    ...record.gate.command_names.map((value, index) => [`$.gate.command_names[${index}]`, value]),
  ];
  for (const [path, value] of codeFields) {
    if (!isPublicCode(value)) errors.push({ path, message: "must be an opaque or relative structural code" });
  }
  record.model_ids.forEach((value, index) => {
    if (!isModelId(value)) errors.push({ path: `$.model_ids[${index}]`, message: "must be a model id, not a URI or path" });
  });
  return errors;
}

/**
 * Each input ref's value must match its declared kind (never raw input text),
 * and its `algorithm` must be the one that kind records (sha256 ⇒ "sha256",
 * non-hash refs ⇒ null) so a hash ref cannot leave its algorithm unrecorded.
 */
function assertInputRefValue(ref, index) {
  const pattern = INPUT_REF_VALUE_PATTERNS[ref?.kind];
  if (!pattern || typeof ref.value !== "string" || !pattern.test(ref.value)) {
    throw new SchemaError("input_refs", [
      { path: `$.input_refs[${index}].value`, message: `must be a ${ref?.kind} ref/hash, not free text` },
    ]);
  }
  const expectedAlgorithm = INPUT_REF_ALGORITHM[ref.kind];
  if (ref.algorithm !== expectedAlgorithm) {
    throw new SchemaError("input_refs", [
      { path: `$.input_refs[${index}].algorithm`, message: `for kind '${ref.kind}' must be ${JSON.stringify(expectedAlgorithm)}` },
    ]);
  }
}

/**
 * Build a validated, frozen, public-safe run record. Applies the self/other
 * branch+path rule, rejects free-text claims/evidence refs, validates the
 * structural schema, and runs the public-safety scan. Throws on any violation.
 *
 * @param {object} input see RUN_RECORD_SCHEMA; plus optional `branch` and
 *   `gate_file_paths` which are hashed automatically unless run_target.repo==="self".
 * @returns {object} frozen run record
 */
export function buildRunRecord(input) {
  if (!input || typeof input !== "object") throw new Error("run-record: input object required");
  const isSelf = input.run_target?.repo === "self";

  const record = {
    schema_version: 2,
    run_id: input.run_id,
    timestamp: input.timestamp,
    task_class: input.task_class,
    route_id: input.route_id,
    role_ids: [...(input.role_ids ?? [])],
    provider_ids: [...(input.provider_ids ?? [])],
    model_ids: [...(input.model_ids ?? [])],
    usage_rollup: input.usage_rollup ? { ...input.usage_rollup } : input.usage_rollup,
    iteration_count: input.iteration_count,
    exit_status: input.exit_status,
    gate: input.gate ? { ...input.gate, command_names: [...(input.gate.command_names ?? [])] } : input.gate,
    warning_codes: [...(input.warning_codes ?? [])],
    judge: input.judge
      ? {
        ...input.judge,
        permutation: [...(input.judge.permutation ?? [])],
        label_reveal_events: (input.judge.label_reveal_events ?? []).map((event) => ({ ...event })),
      }
      : null,
    input_refs: (input.input_refs ?? []).map((ref) => ({ ...ref })),
    claims_ref: input.claims_ref,
    evidence_ref: input.evidence_ref,
    run_target: input.run_target ? { ...input.run_target } : input.run_target,
  };

  // The resolved toggle vector rides along verbatim (validated by the schema).
  if (input.toggles != null) {
    record.toggles = { ...input.toggles };
  }

  // Branch + gate file paths: plain only for this repo; hashed otherwise.
  if (input.branch != null) {
    record.branch = isSelf ? input.branch : hashRef(input.branch);
  }
  if (Array.isArray(input.gate_file_paths)) {
    record.gate_file_paths = isSelf ? [...input.gate_file_paths] : input.gate_file_paths.map(hashRef);
  }

  // Claims/evidence must be refs/hashes, never free text.
  assertRef(record.claims_ref, "claims_ref");
  assertRef(record.evidence_ref, "evidence_ref");

  // Preserve the public-safety refusal category for known toxic signatures,
  // even when a stricter structural pattern would reject the same field too.
  assertPublicSafe(record);

  // Structural schema (fail closed on any shape violation).
  assertValid(RUN_RECORD_SCHEMA, record, "run-record");

  const grammarErrors = identifierGrammarErrors(record);
  if (grammarErrors.length > 0) throw new SchemaError("run-record", grammarErrors);

  // Inputs enter the record only as redacted refs/hashes — never raw text.
  record.input_refs.forEach(assertInputRefValue);

  // Mechanical public-safety guarantee.
  assertPublicSafe(record);

  return deepFreeze(record);
}

/** Deterministic JSON with recursively sorted object keys (stable across runs). */
export function stableStringify(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** Validate an already-built record without rebuilding it. */
export function validateRunRecord(record) {
  const structural = validate(RUN_RECORD_SCHEMA, record, "$");
  const errors = [...structural.errors];
  if (structural.valid) {
    errors.push(...identifierGrammarErrors(record));
    for (let index = 0; index < record.input_refs.length; index += 1) {
      try {
        assertInputRefValue(record.input_refs[index], index);
      } catch (error) {
        errors.push(...(error?.errors ?? [{ path: `$.input_refs[${index}]`, message: "invalid input ref" }]));
      }
    }
    if (record.run_target.repo === "other") {
      if (record.branch !== undefined && !REF_PATTERN.test(record.branch)) {
        errors.push({ path: "$.branch", message: "other-repo branch must be hashed" });
      }
      for (let index = 0; index < (record.gate_file_paths ?? []).length; index += 1) {
        if (!REF_PATTERN.test(record.gate_file_paths[index])) {
          errors.push({ path: `$.gate_file_paths[${index}]`, message: "other-repo path must be hashed" });
        }
      }
    } else {
      if (typeof record.branch === "string"
        && (record.branch.includes("..") || record.branch.includes("@{") || record.branch.endsWith(".") || record.branch.endsWith("/"))) {
        errors.push({ path: "$.branch", message: "must be a safe git branch ref" });
      }
    }
    try {
      assertPublicSafe(record);
    } catch {
      errors.push({ path: "$", message: "public-safety scan failed" });
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Persist a built record to `${dir}/${run_id}.json` (deterministic filename).
 * The record is re-scanned for public safety before writing. Returns the path.
 * @param {object} record a record from buildRunRecord
 * @param {string} [dir] output directory (product adapters inject user state)
 */
export function writeRunRecord(record, dir = DEFAULT_RUN_RECORD_DIR) {
  if (!RUN_ID_PATTERN.test(record?.run_id ?? "")) {
    throw new Error("run-record: run_id is not a safe filename token");
  }
  const valid = validateRunRecord(record);
  if (!valid.valid) throw new SchemaError("run-record", valid.errors);
  assertPublicSafe(record);
  const path = join(dir, `${record.run_id}.json`);
  writeTextAtomic(dir, `${record.run_id}.json`, stableStringify(record) + "\n");
  return path;
}
