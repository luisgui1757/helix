// Helix dispatch — feature-toggle settings substrate.
//
// Six user-local toggles select Helix's behavior; all default ON. OFF never
// errors — each feature defines its degenerate form (multi-model off ⇒ solo
// model; loops off ⇒ single pass; autoresearch off ⇒ verb refusal;
// context-engine off ⇒ transcript pass-through; worktree off ⇒ working-tree
// runs; visual-cues off ⇒ plain lines). The only hard refusals are EXPLICIT
// conflicts (a config demanding a composite while multi-model is off, the
// research verb while autoresearch is off) — stable codes naming the toggle.
//
// Settings are user-local Pi state (`<pi-agent-dir>/helix/settings.json`) with a
// schema_version and refuse-on-mismatch. They are never tracked config and never
// carry secrets. Run records embed the resolved toggle vector so every run is
// reproducible against the settings it ran under.
//
// NOT toggleable (invariants, not features): public-safe structural records,
// CI-never-live, the native command registry, the max_iterations rail, and
// structural fail-closed validation.

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { validate } from "./schema.mjs";
import { writeTextAtomic } from "./persistence.mjs";

/** The six product toggles, in display order. */
export const HELIX_TOGGLES = Object.freeze([
  "multi-model",
  "loops",
  "autoresearch",
  "context-engine",
  "worktree",
  "visual-cues",
]);

/** Settings filename relative to Helix's user-state root. */
export const DEFAULT_SETTINGS_REL_PATH = "settings.json";

export const SETTINGS_CODES = Object.freeze({
  UNREADABLE: "helix-settings-unreadable",
  INVALID: "helix-settings-invalid",
  VERSION_MISMATCH: "helix-settings-version-mismatch",
  WRITE_FAILED: "helix-settings-write-failed",
});

export const SETTINGS_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["schema_version", "toggles"],
  properties: {
    schema_version: { const: 1 },
    toggles: {
      type: "object",
      additionalProperties: false,
      required: [...HELIX_TOGGLES],
      properties: Object.fromEntries(HELIX_TOGGLES.map((t) => [t, { type: "boolean" }])),
    },
  },
});

export const SETTINGS_SCHEMA_VERSION = 1;

/** All toggles ON — the product default. */
export function defaultSettings() {
  return Object.freeze({
    schema_version: SETTINGS_SCHEMA_VERSION,
    toggles: Object.freeze(Object.fromEntries(HELIX_TOGGLES.map((t) => [t, true]))),
  });
}

/** Structural validation; returns {valid, errors}. */
export function validateSettings(settings) {
  return validate(SETTINGS_SCHEMA, settings, "$");
}

/**
 * Load settings from an untracked user-local file. An ABSENT file is the
 * default vector (all ON) — not an error. A present-but-unreadable, malformed,
 * or version-mismatched file fails closed with a stable code (structure is
 * fail-closed even though behavior is YOLO): silently substituting defaults
 * over a corrupt file would run under a vector the user did not choose.
 *
 * @param {string} path absolute path to the settings file
 * @returns {{ok:true, settings:object, source:"defaults"|"file"}
 *          |{ok:false, code:string, detail:string|null}}
 */
export function loadSettings(path) {
  if (typeof path !== "string" || path.length === 0) {
    return { ok: false, code: SETTINGS_CODES.UNREADABLE, detail: "settings-path-missing" };
  }
  if (!existsSync(path)) {
    return { ok: true, settings: defaultSettings(), source: "defaults" };
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { ok: false, code: SETTINGS_CODES.UNREADABLE, detail: "settings-not-json" };
  }
  if (parsed && typeof parsed === "object" && parsed.schema_version !== SETTINGS_SCHEMA_VERSION) {
    return {
      ok: false,
      code: SETTINGS_CODES.VERSION_MISMATCH,
      detail: `settings-schema-version-${String(parsed.schema_version)}`,
    };
  }
  const valid = validateSettings(parsed);
  if (!valid.valid) {
    return { ok: false, code: SETTINGS_CODES.INVALID, detail: "settings-schema-invalid" };
  }
  return {
    ok: true,
    settings: Object.freeze({ schema_version: parsed.schema_version, toggles: Object.freeze({ ...parsed.toggles }) }),
    source: "file",
  };
}

/**
 * Persist settings to the untracked user-local file (validated first;
 * parent directory created). Returns {ok} or a stable failure code.
 */
export function saveSettings(settings, path) {
  if (settings && typeof settings === "object" && settings.schema_version !== SETTINGS_SCHEMA_VERSION) {
    return {
      ok: false,
      code: SETTINGS_CODES.VERSION_MISMATCH,
      detail: `settings-schema-version-${String(settings.schema_version)}`,
    };
  }
  const valid = validateSettings(settings);
  if (!valid.valid) return { ok: false, code: SETTINGS_CODES.INVALID, detail: "settings-schema-invalid" };
  if (typeof path !== "string" || path.length === 0) {
    return { ok: false, code: SETTINGS_CODES.WRITE_FAILED, detail: "settings-path-missing" };
  }
  try {
    writeTextAtomic(dirname(path), basename(path), JSON.stringify(settings, null, 2) + "\n");
  } catch {
    return { ok: false, code: SETTINGS_CODES.WRITE_FAILED, detail: null };
  }
  return { ok: true, path };
}

/**
 * Hard-refusal helper for EXPLICIT conflicts only. Features degrade when their
 * toggle is off; a refusal is returned only where the user explicitly asked
 * for the disabled capability (composite requested, research verb invoked).
 * @returns {{ok:true}|{ok:false, code:string}}
 */
export function requireToggle(settings, toggle) {
  if (!HELIX_TOGGLES.includes(toggle)) {
    return { ok: false, code: `unknown-toggle:${String(toggle)}` };
  }
  if (settings?.toggles?.[toggle] === true) return { ok: true };
  return { ok: false, code: `toggle-disabled:${toggle}` };
}

/**
 * The resolved boolean vector for embedding into run records and events —
 * exactly the six toggles, frozen, no extra fields.
 */
export function toggleVector(settings) {
  const toggles = settings?.toggles ?? {};
  return Object.freeze(Object.fromEntries(HELIX_TOGGLES.map((t) => [t, toggles[t] === true])));
}
