// Helix dispatch — composite presets + per-stage cast assignments.
//
// A composite (overlord, daily) is a NAMED ROLE-MATRIX PRESET with a thin
// metadata wrapper. Composites are STEP-LEVEL EXECUTORS: a run config (or,
// later, a user profile) assigns each chain stage either a composite id or a
// plain {provider, model, effort} — "plan → overlord, implement → sonnet,
// scout → haiku". The interactive session driver (Pi's own /model) is never
// managed here.
//
// Tracked presets ship as SKELETONS with mock members; real member lineups
// depend on personal provider logins and live in untracked user-local profiles
// (assembled via `/helix-setup` from Pi's live inventory).
//
// Owner contracts (2026-07-09):
//   - degradation is fail-closed: a missing/unavailable member refuses NAMING
//     the member — no silent substitution, ever.
//   - multi-model OFF degenerates: one solo model fills every role (panels of
//     one, self-review); requesting a COMPOSITE while multi-model is off is an
//     EXPLICIT conflict and refuses naming the toggle.
//   - effort is validated against the member's declared effort vocabulary
//     (providers expose different reasoning tiers).

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { validate } from "./schema.mjs";
import { ROLES } from "./role-envelope.mjs";
import { EFFORTS } from "./routes.mjs";
import { HELIX_PROVIDERS, isAutomatedDispatchProvider } from "./providers.mjs";
import { requireToggle } from "./settings.mjs";
import { MAX_PANEL_MEMBERS } from "./limits.mjs";
import { MODEL_ID_PATTERN, isModelId } from "./public-values.mjs";

const PRESET_ID_PATTERN = "^[a-z0-9][a-z0-9._:-]*$";

export const PRESET_CODES = Object.freeze({
  UNREADABLE: "preset-registry-unreadable",
  INVALID: "invalid-preset",
  DUPLICATE: "duplicate-preset",
  UNKNOWN: "unknown-preset",
  MEMBER_UNAVAILABLE: "preset-member-unavailable",
  EFFORT_NOT_IN_VOCAB: "preset-effort-not-in-vocab",
  PROVIDER_NOT_AUTOMATED: "preset-provider-not-automated",
  INVALID_ASSIGNMENT: "invalid-assignment",
  UNKNOWN_STAGE: "assignment-unknown-stage",
});

export const MEMBER_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["provider", "model", "effort", "instances"],
  properties: {
    provider: { type: "string", enum: HELIX_PROVIDERS },
    model: { type: "string", pattern: MODEL_ID_PATTERN },
    effort: { type: "string", enum: EFFORTS },
    instances: { type: "integer", minimum: 1, maximum: MAX_PANEL_MEMBERS },
    // The reasoning-effort tiers this provider/model actually supports; the
    // member's own effort must be one of them when declared.
    effort_vocab: { type: "array", minItems: 1, items: { type: "string", enum: EFFORTS } },
  },
});

export const PRESET_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["schema_version", "preset_id", "display_name", "description", "degradation", "roles"],
  properties: {
    schema_version: { const: 1 },
    preset_id: { type: "string", pattern: PRESET_ID_PATTERN },
    display_name: { type: "string", minLength: 1 },
    description: { type: "string", minLength: 1 },
    // The only supported policy — recorded explicitly so a future alternative
    // is a visible schema change, not a silent behavior change.
    degradation: { const: "fail-closed" },
    roles: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(ROLES.map((role) => [
        role,
        { type: "array", minItems: 1, items: MEMBER_SCHEMA },
      ])),
    },
  },
});

/** A stage's executor: a composite by id, or one plain model. */
export const ASSIGNMENT_SCHEMA = Object.freeze({
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "preset"],
      properties: {
        kind: { const: "composite" },
        preset: { type: "string", pattern: PRESET_ID_PATTERN },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "provider", "model"],
      properties: {
        kind: { const: "model" },
        provider: { type: "string", enum: HELIX_PROVIDERS },
        model: { type: "string", pattern: MODEL_ID_PATTERN },
        effort: { type: "string", enum: EFFORTS },
      },
    },
  ],
});

export function validateMember(member) {
  const structural = validate(MEMBER_SCHEMA, member, "$");
  const errors = [...structural.errors];
  if (structural.valid && !isModelId(member.model)) {
    errors.push({ path: "$.model", message: "must be a model id, not a URI or path" });
  }
  return { valid: errors.length === 0, errors };
}

export function validateAssignment(assignment) {
  const structural = validate(ASSIGNMENT_SCHEMA, assignment, "$");
  const errors = [...structural.errors];
  if (structural.valid && assignment.kind === "model" && !isModelId(assignment.model)) {
    errors.push({ path: "$.model", message: "must be a model id, not a URI or path" });
  }
  return { valid: errors.length === 0, errors };
}

function fail(code, detail = null) {
  return { ok: false, code, detail };
}

function errorsToDetail(errors) {
  return errors.map((error) => `${error.path} ${error.message}`).join("; ");
}

/** Validate one preset (structure + effort vocab + automated providers). */
export function validatePreset(preset) {
  const structural = validate(PRESET_SCHEMA, preset, "$");
  const errors = [...structural.errors];
  if (!structural.valid) return { valid: false, errors };
  for (const [role, members] of Object.entries(preset.roles)) {
    let expandedMembers = 0;
    members.forEach((member, index) => {
      expandedMembers += member.instances;
      if (!validateMember(member).valid) {
        errors.push({
          path: `$.roles.${role}[${index}].model`,
          message: "must be a model id, not a URI or path",
        });
      }
      if (member.effort_vocab && !member.effort_vocab.includes(member.effort)) {
        errors.push({
          path: `$.roles.${role}[${index}].effort`,
          message: `effort '${member.effort}' is not in the member's effort_vocab`,
        });
      }
      if (!isAutomatedDispatchProvider(member.provider)) {
        errors.push({
          path: `$.roles.${role}[${index}].provider`,
          message: `provider '${member.provider}' is not eligible for automated dispatch`,
        });
      }
    });
    if (expandedMembers > MAX_PANEL_MEMBERS) {
      errors.push({
        path: `$.roles.${role}`,
        message: `expanded role must contain <= ${MAX_PANEL_MEMBERS} members`,
      });
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Load every preset JSON in a directory into a frozen registry (id → preset).
 * Malformed files, invalid presets, and duplicate ids fail closed.
 */
export function loadPresetRegistry(dir) {
  if (typeof dir !== "string" || !existsSync(dir)) {
    return fail(PRESET_CODES.UNREADABLE, "preset-dir-missing");
  }
  const presets = new Map();
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(join(dir, name), "utf8"));
    } catch {
      return fail(PRESET_CODES.UNREADABLE, name);
    }
    const valid = validatePreset(parsed);
    if (!valid.valid) return fail(PRESET_CODES.INVALID, `${name}: ${errorsToDetail(valid.errors)}`);
    if (presets.has(parsed.preset_id)) return fail(PRESET_CODES.DUPLICATE, parsed.preset_id);
    presets.set(parsed.preset_id, Object.freeze(parsed));
  }
  return { ok: true, presets };
}

/**
 * Fail-closed degradation: every member must be available. `availability` is
 * an injected checker `(member) => boolean` (`/helix-setup` wires Pi's live model
 * inventory; mock members are always available when it is absent). The refusal
 * NAMES the first unavailable member — no silent substitution.
 */
export function assertPresetAvailable(preset, availability) {
  if (typeof availability !== "function") return { ok: true };
  for (const [role, members] of Object.entries(preset.roles)) {
    for (const member of members) {
      if (!availability(member)) {
        return fail(
          `${PRESET_CODES.MEMBER_UNAVAILABLE}:${preset.preset_id}:${member.provider}/${member.model}`,
          role,
        );
      }
    }
  }
  return { ok: true };
}

/**
 * Resolve one stage assignment into a role-matrix-shaped `roles` object for
 * the roles that stage actually needs.
 *
 * - composite: the preset's members fill the stage's roles; a role the preset
 *   does not carry refuses naming it (fail-closed degradation).
 * - model: the ONE model fills every stage role (panels of one).
 * - multi-model OFF: composites are an explicit conflict
 *   (toggle-disabled:multi-model); plain models proceed (solo is the point).
 *
 * @param {object} args { assignment, stageRoles: string[], presets: Map,
 *   toggles?, availability? }
 * @returns {{ok:true, roles:object, executor_ref:string}
 *          |{ok:false, code, detail}}
 */
export function resolveStageExecutor({ assignment, stageRoles, presets, toggles, availability }) {
  const shape = validateAssignment(assignment);
  if (!shape.valid) return fail(PRESET_CODES.INVALID_ASSIGNMENT, errorsToDetail(shape.errors));

  if (assignment.kind === "composite") {
    if (toggles) {
      const gate = requireToggle({ toggles }, "multi-model");
      if (!gate.ok) return fail(gate.code, `composite '${assignment.preset}' requires multi-model`);
    }
    const preset = presets?.get?.(assignment.preset);
    if (!preset) return fail(`${PRESET_CODES.UNKNOWN}:${assignment.preset}`);
    const presetValid = validatePreset(preset);
    if (!presetValid.valid) return fail(PRESET_CODES.INVALID, errorsToDetail(presetValid.errors));
    const available = assertPresetAvailable(preset, availability);
    if (!available.ok) return available;
    const roles = {};
    let candidateMembers = 0;
    for (const role of stageRoles) {
      const members = preset.roles[role];
      if (!members || members.length === 0) {
        return fail(`${PRESET_CODES.MEMBER_UNAVAILABLE}:${preset.preset_id}:role/${role}`, "preset-missing-role");
      }
      roles[role] = members.map((member) => ({
        provider: member.provider,
        model: member.model,
        effort: member.effort,
        instances: member.instances,
      }));
      candidateMembers += members.reduce((sum, member) => sum + member.instances, 0);
      if (candidateMembers > MAX_PANEL_MEMBERS) {
        return fail(
          PRESET_CODES.INVALID,
          `stage panel must contain <= ${MAX_PANEL_MEMBERS} members`,
        );
      }
    }
    // A composite's value on a multi-member stage is the internal mini-panel:
    // candidates → blind judge → synthesis. Surface the preset's judge and
    // synthesizer (when it carries them) so the runner can wire that cycle;
    // a single-member stage needs neither.
    const panel_roles = {};
    if (candidateMembers > 1) {
      for (const extra of ["judge", "synthesizer"]) {
        const members = preset.roles[extra];
        if (members && members.length === 1 && members[0].instances === 1) {
          panel_roles[extra] = {
            provider: members[0].provider,
            model: members[0].model,
            effort: members[0].effort,
            instances: 1,
          };
        }
      }
    }
    return { ok: true, roles, panel_roles, executor_ref: `composite:${preset.preset_id}` };
  }

  // Plain model: one model plays every role of the stage (self-review is the
  // degenerate arbiter; the objective gate does not care who is talking).
  if (!isAutomatedDispatchProvider(assignment.provider)) {
    return fail(`${PRESET_CODES.PROVIDER_NOT_AUTOMATED}:${assignment.provider}`);
  }
  const plainMember = {
    provider: assignment.provider,
    model: assignment.model,
    effort: assignment.effort ?? "default",
    instances: 1,
  };
  if (assignment.provider !== "mock"
      && typeof availability === "function"
      && !availability(plainMember)) {
    return fail(`${PRESET_CODES.MEMBER_UNAVAILABLE}:${assignment.provider}/${assignment.model}`);
  }
  const roles = Object.fromEntries(stageRoles.map((role) => [
    role,
    [{ ...plainMember }],
  ]));
  return { ok: true, roles, panel_roles: {}, executor_ref: `model:${assignment.provider}/${assignment.model}` };
}

/**
 * Resolve a chain's full cast: every stage gets an executor from
 * `assignments[stage.id]`, falling back to `defaults.assignment` when a stage
 * is unassigned. Unknown stage keys refuse (a typo must not silently run the
 * default cast). multi-model OFF additionally collapses EVERY stage to the
 * first plain-model assignment... no: composites refuse (explicit conflict);
 * plain assignments already collapse per stage.
 *
 * @returns {{ok:true, cast: Array<{stage_id, executor_ref, roles}>}
 *          |{ok:false, code, detail}}
 */
export function resolveChainCast({ chain, assignments = {}, defaults = null, presets, toggles, availability }) {
  const stageIds = (chain?.stages ?? []).map((stage) => stage.id);
  for (const key of Object.keys(assignments)) {
    if (!stageIds.includes(key)) return fail(`${PRESET_CODES.UNKNOWN_STAGE}:${key}`);
  }
  const cast = [];
  for (const stage of chain.stages) {
    const stageRoles = [...new Set(stage.steps.filter((s) => s.kind === "role").map((s) => s.role))];
    if (stageRoles.length === 0) {
      cast.push({ stage_id: stage.id, executor_ref: "local-only", roles: {} });
      continue;
    }
    const assignment = assignments[stage.id] ?? defaults;
    if (!assignment) return fail(`${PRESET_CODES.INVALID_ASSIGNMENT}`, `stage '${stage.id}' has no assignment and no default`);
    const resolved = resolveStageExecutor({ assignment, stageRoles, presets, toggles, availability });
    if (!resolved.ok) return resolved;
    cast.push({
      stage_id: stage.id,
      executor_ref: resolved.executor_ref,
      roles: resolved.roles,
      panel_roles: resolved.panel_roles ?? {},
    });
  }
  return { ok: true, cast };
}
