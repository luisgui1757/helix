// Helix /helix — user-local state helpers (M8): named profiles + active
// pointer over gitignored dispatch/local/. Profiles are saved CASTS: they may
// override assignments, complete preset member lineups, the default assignment,
// and the default run config —
// NEVER run semantics (chain, gate, run_target): the overrides schema simply
// has no such keys, so an untracked file cannot smuggle a semantic change
// past review.

import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { validate } from "../../dispatch/lib/schema.mjs";
import { validateAssignment, validateMember, validatePreset } from "../../dispatch/lib/presets.mjs";
import { ROLES } from "../../dispatch/lib/role-envelope.mjs";
import { assertPublicSafe } from "../../dispatch/lib/run-record.mjs";
import { writeTextAtomic } from "../../dispatch/lib/persistence.mjs";

export const PROFILE_CODES = Object.freeze({
  UNREADABLE: "helix-profile-unreadable",
  INVALID: "invalid-profile",
  VERSION_MISMATCH: "helix-profile-version-mismatch",
  UNKNOWN: "unknown-profile",
  EXISTS: "helix-profile-exists",
  ACTIVE_INVALID: "helix-active-profile-invalid",
  PRESET_UNKNOWN: "helix-profile-preset-unknown",
  TRANSACTION_FAILED: "helix-profile-transaction-failed",
  WRITE_FAILED: "helix-profile-write-failed",
});

const PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const PRESET_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/;
const STAGE_KEY = /^[a-z][a-z0-9-]*$/;

function pathEntryExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export const PROFILE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["schema_version", "profile_id", "overrides"],
  properties: {
    schema_version: { const: 1 },
    profile_id: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]*$" },
    overrides: {
      type: "object",
      additionalProperties: false,
      properties: {
        default_run_config: { type: "string", pattern: "^[a-z0-9][a-z0-9._:-]*$" },
        assignments: { type: "object" },
        default_assignment: { type: "object" },
        // Complete member overlays for tracked composite ids. Values are
        // validated semantically because this zero-dependency schema subset
        // does not support schema-valued additionalProperties.
        presets: { type: "object" },
      },
    },
  },
});

export function validateProfile(profile) {
  const structural = validate(PROFILE_SCHEMA, profile, "$");
  const errors = [...structural.errors];
  if (!structural.valid) return { valid: false, errors };
  try {
    assertPublicSafe(profile);
  } catch {
    errors.push({ path: "$", message: "must pass the public-safety boundary" });
  }
  const assignments = profile.overrides.assignments ?? {};
  for (const [stageId, assignment] of Object.entries(assignments)) {
    if (!STAGE_KEY.test(stageId)) errors.push({ path: `$.overrides.assignments.${stageId}`, message: "must be a stage id" });
    if (!validateAssignment(assignment).valid) {
      errors.push({ path: `$.overrides.assignments.${stageId}`, message: "must be a composite or plain-model assignment" });
    }
  }
  if (profile.overrides.default_assignment != null
    && !validateAssignment(profile.overrides.default_assignment).valid) {
    errors.push({ path: "$.overrides.default_assignment", message: "must be a composite or plain-model assignment" });
  }
  const presetOverlays = profile.overrides.presets ?? {};
  for (const [presetId, overlay] of Object.entries(presetOverlays)) {
    if (!PRESET_ID_PATTERN.test(presetId)) {
      errors.push({ path: `$.overrides.presets.${presetId}`, message: "must be a preset id" });
      continue;
    }
    if (!overlay || typeof overlay !== "object" || Array.isArray(overlay)
      || Object.keys(overlay).some((key) => key !== "roles")
      || !overlay.roles || typeof overlay.roles !== "object" || Array.isArray(overlay.roles)) {
      errors.push({ path: `$.overrides.presets.${presetId}`, message: "must contain only a roles object" });
      continue;
    }
    for (const [role, members] of Object.entries(overlay.roles)) {
      if (!ROLES.includes(role) || !Array.isArray(members) || members.length === 0) {
        errors.push({ path: `$.overrides.presets.${presetId}.roles.${role}`, message: "must be a non-empty known-role member list" });
        continue;
      }
      members.forEach((member, index) => {
        if (!validateMember(member).valid) {
          errors.push({ path: `$.overrides.presets.${presetId}.roles.${role}[${index}]`, message: "must be a valid preset member" });
        }
      });
    }
  }
  return { valid: errors.length === 0, errors };
}

export function profilesDir(root) {
  return join(root, "dispatch", "local", "profiles");
}

export function listProfiles(root) {
  const dir = profilesDir(root);
  if (!existsSync(dir)) return { ok: true, profiles: [] };
  const profiles = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "active.json").sort()) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(join(dir, name), "utf8"));
    } catch {
      return { ok: false, code: PROFILE_CODES.UNREADABLE, detail: name };
    }
    if (parsed?.schema_version !== 1) return { ok: false, code: PROFILE_CODES.VERSION_MISMATCH, detail: name };
    const valid = validateProfile(parsed);
    if (!valid.valid) return { ok: false, code: PROFILE_CODES.INVALID, detail: name };
    if (`${parsed.profile_id}.json` !== name) return { ok: false, code: PROFILE_CODES.INVALID, detail: name };
    profiles.push(parsed);
  }
  return { ok: true, profiles };
}

export function loadProfile(root, profileId) {
  if (!PROFILE_ID_PATTERN.test(String(profileId ?? ""))) return { ok: false, code: PROFILE_CODES.UNKNOWN, detail: "profile-id-invalid" };
  const listed = listProfiles(root);
  if (!listed.ok) return listed;
  const profile = listed.profiles.find((p) => p.profile_id === profileId);
  if (!profile) return { ok: false, code: PROFILE_CODES.UNKNOWN, detail: profileId };
  return { ok: true, profile };
}

export function saveProfile(root, profile, { replace = false } = {}) {
  const valid = validateProfile(profile);
  if (!valid.valid) return { ok: false, code: PROFILE_CODES.INVALID, detail: valid.errors.map((e) => e.path).join(",") };
  try {
    const path = join(profilesDir(root), `${profile.profile_id}.json`);
    if (existsSync(path) && !replace) return { ok: false, code: PROFILE_CODES.EXISTS, detail: profile.profile_id };
    if (pathEntryExists(`${path}.pending`)) return { ok: false, code: PROFILE_CODES.WRITE_FAILED };
    writeTextAtomic(root, join("dispatch", "local", "profiles", `${profile.profile_id}.json`),
      JSON.stringify(profile, null, 2) + "\n", { replace });
  } catch {
    return { ok: false, code: PROFILE_CODES.WRITE_FAILED };
  }
  return { ok: true };
}

export function activeProfileId(root) {
  const path = join(profilesDir(root), "active.json");
  if (!existsSync(path)) return { ok: true, profile_id: null };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
      || !PROFILE_ID_PATTERN.test(String(parsed.profile_id ?? ""))) {
      return { ok: false, code: PROFILE_CODES.ACTIVE_INVALID, detail: "active.json" };
    }
    const keys = Object.keys(parsed).sort();
    const isLegacy = keys.length === 1 && keys[0] === "profile_id";
    const isV1 = keys.length === 2 && keys[0] === "profile_id" && keys[1] === "schema_version" && parsed.schema_version === 1;
    if (!isLegacy && !isV1) return { ok: false, code: PROFILE_CODES.ACTIVE_INVALID, detail: "active.json" };
    return { ok: true, profile_id: parsed.profile_id, legacy: isLegacy };
  } catch {
    return { ok: false, code: PROFILE_CODES.UNREADABLE, detail: "active.json" };
  }
}

/** Resolve the pointer and referenced profile as one fail-closed operation. */
export function resolveActiveProfile(root) {
  const active = activeProfileId(root);
  if (!active.ok || active.profile_id === null) return active.ok ? { ok: true, profile_id: null, profile: null } : active;
  const loaded = loadProfile(root, active.profile_id);
  if (!loaded.ok) return loaded;
  return { ok: true, profile_id: active.profile_id, profile: loaded.profile };
}

export function switchProfile(root, profileId) {
  const loaded = loadProfile(root, profileId);
  if (!loaded.ok) return loaded;
  try {
    const legacyPending = join(profilesDir(root), "active.json.pending");
    if (pathEntryExists(legacyPending)) return { ok: false, code: PROFILE_CODES.WRITE_FAILED };
    writeTextAtomic(root, join("dispatch", "local", "profiles", "active.json"),
      JSON.stringify({ schema_version: 1, profile_id: profileId }, null, 2) + "\n");
  } catch {
    return { ok: false, code: PROFILE_CODES.WRITE_FAILED };
  }
  return { ok: true, profile_id: profileId };
}

/**
 * Replace an existing profile and activate it as one command-level
 * transaction. `switchProfile` uses an atomic rename, so a reported activation
 * failure leaves the prior pointer intact; restore the prior profile before
 * returning that refusal. Setup deliberately requires an explicit prior
 * `profiles create`, avoiding an unremovable half-created profile on failure.
 */
export function saveAndActivateProfile(root, profile, options = {}) {
  const prior = loadProfile(root, profile?.profile_id);
  if (!prior.ok) return prior;
  const saved = saveProfile(root, profile, { replace: true });
  if (!saved.ok) return saved;
  const activate = typeof options.activate === "function" ? options.activate : switchProfile;
  const activated = activate(root, profile.profile_id);
  if (activated?.ok === true) return activated;
  const restored = saveProfile(root, prior.profile, { replace: true });
  if (!restored.ok) {
    return { ok: false, code: PROFILE_CODES.TRANSACTION_FAILED, detail: "profile-rollback-failed" };
  }
  return activated && typeof activated === "object"
    ? activated
    : { ok: false, code: PROFILE_CODES.WRITE_FAILED, detail: null };
}

/**
 * Apply the active profile's overrides to a run config. Only casts and the
 * default-config choice can change; chain/gate/run_target come from tracked
 * config by construction.
 */
export function applyProfileToConfig(config, profile) {
  if (!profile) return { config, overridden: [] };
  const overridden = [];
  const next = { ...config };
  if (profile.overrides.assignments) {
    next.assignments = { ...(config.assignments ?? {}), ...profile.overrides.assignments };
    overridden.push("assignments");
  }
  if (profile.overrides.default_assignment) {
    next.default_assignment = profile.overrides.default_assignment;
    overridden.push("default_assignment");
  }
  return { config: next, overridden };
}

/** Layer complete user-local member lineups over tracked preset metadata. */
export function applyProfileToPresets(presets, profile) {
  const next = new Map(presets ?? []);
  const overridden = [];
  for (const [presetId, overlay] of Object.entries(profile?.overrides?.presets ?? {})) {
    const base = next.get(presetId);
    if (!base) return { ok: false, code: PROFILE_CODES.PRESET_UNKNOWN, detail: presetId };
    const roleKeys = Object.keys(overlay.roles).sort();
    const baseRoleKeys = Object.keys(base.roles).sort();
    if (roleKeys.length !== baseRoleKeys.length || roleKeys.some((role, index) => role !== baseRoleKeys[index])) {
      return { ok: false, code: PROFILE_CODES.INVALID, detail: `preset-roles-incomplete:${presetId}` };
    }
    const candidate = {
      ...base,
      roles: Object.fromEntries(Object.entries(overlay.roles).map(([role, members]) => [role, members.map((member) => ({ ...member }))])),
    };
    const valid = validatePreset(candidate);
    if (!valid.valid) return { ok: false, code: PROFILE_CODES.INVALID, detail: `preset-invalid:${presetId}` };
    next.set(presetId, Object.freeze(candidate));
    overridden.push(presetId);
  }
  return { ok: true, presets: next, overridden };
}
