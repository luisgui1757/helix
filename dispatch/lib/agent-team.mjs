// Prime dispatch — lean agent-team defaults + canonical role identity.
//
// Source of truth: ROADMAP Theme J / Stage 3K. Agent-team defaults are config
// artifacts that feed later role-matrix/chain work; they do not launch models,
// fork dispatch policy, or let cosmetic aliases become routing/log identifiers.

import { validate, SchemaError } from "./schema.mjs";

/** Stable user-facing agent-team role IDs. Cosmetic aliases never replace these. */
export const CANONICAL_AGENT_ROLES = Object.freeze([
  "Scout",
  "Planner",
  "Builder",
  "Reviewer",
  "Documenter",
  "RedTeam",
]);

/** Bridge from Stage 3K canonical role IDs to the existing dispatch role enum. */
export const DISPATCH_ROLE_BY_CANONICAL = Object.freeze({
  Scout: "scout",
  Planner: "planner",
  Builder: "builder",
  Reviewer: "reviewer",
  Documenter: "documenter",
  RedTeam: "redteam",
});

const TEAM_ID_PATTERN = "^[a-z0-9][a-z0-9._:-]*$";
const AGENT_FILE_PATTERN = "^docs/stage3/agents/[a-z0-9._/-]+\\.md$";

const nullableString = { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] };

/** Schema for the config artifact in dispatch/config/agent-team-defaults.json. */
export const AGENT_TEAM_CONFIG_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["schema_version", "team_id", "defaults_are_additive", "roles"],
  properties: {
    schema_version: { const: 1 },
    team_id: { type: "string", pattern: TEAM_ID_PATTERN },
    defaults_are_additive: { const: true },
    roles: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "canonical_id",
          "dispatch_role",
          "agent_file",
          "independent_provider_from",
          "display_alias",
        ],
        properties: {
          canonical_id: { type: "string", enum: CANONICAL_AGENT_ROLES },
          dispatch_role: { type: "string", enum: Object.values(DISPATCH_ROLE_BY_CANONICAL) },
          agent_file: { type: "string", pattern: AGENT_FILE_PATTERN },
          independent_provider_from: {
            type: "array",
            items: { type: "string", enum: CANONICAL_AGENT_ROLES },
          },
          display_alias: nullableString,
        },
      },
    },
  },
});

function semanticError(path, message) {
  return { path, message };
}

/** @param {string} canonicalId */
export function canonicalRoleToDispatchRole(canonicalId) {
  return Object.prototype.hasOwnProperty.call(DISPATCH_ROLE_BY_CANONICAL, canonicalId)
    ? DISPATCH_ROLE_BY_CANONICAL[canonicalId]
    : null;
}

/**
 * Validate an agent-team config artifact.
 *
 * Semantic checks keep canonical IDs load-bearing:
 * - no duplicate canonical roles;
 * - dispatch_role must be the canonical mapping, not an alias-controlled value;
 * - independence references must point at roles present in this additive team.
 *
 * @param {unknown} config
 * @returns {{ valid:boolean, errors:Array<{path:string,message:string}> }}
 */
export function validateAgentTeamConfig(config) {
  const structural = validate(AGENT_TEAM_CONFIG_SCHEMA, config, "$");
  const errors = [...structural.errors];
  if (!structural.valid) return { valid: false, errors };

  const seen = new Set();
  const roleSet = new Set(config.roles.map((role) => role.canonical_id));
  config.roles.forEach((role, index) => {
    const path = `$.roles[${index}]`;
    if (seen.has(role.canonical_id)) {
      errors.push(semanticError(`${path}.canonical_id`, `duplicate canonical role '${role.canonical_id}'`));
    }
    seen.add(role.canonical_id);

    const expectedDispatchRole = canonicalRoleToDispatchRole(role.canonical_id);
    if (role.dispatch_role !== expectedDispatchRole) {
      errors.push(semanticError(
        `${path}.dispatch_role`,
        `must be '${expectedDispatchRole}' for canonical role '${role.canonical_id}'`,
      ));
    }

    role.independent_provider_from.forEach((source, sourceIndex) => {
      if (!roleSet.has(source)) {
        errors.push(semanticError(
          `${path}.independent_provider_from[${sourceIndex}]`,
          `must reference a role present in this team`,
        ));
      }
      if (source === role.canonical_id) {
        errors.push(semanticError(
          `${path}.independent_provider_from[${sourceIndex}]`,
          "must not reference the same role",
        ));
      }
    });
  });

  return { valid: errors.length === 0, errors };
}

/**
 * Fail-closed assertion for agent-team config artifacts.
 * @param {unknown} config
 * @param {string} [label]
 */
export function assertAgentTeamConfig(config, label = "agent-team-config") {
  const { valid, errors } = validateAgentTeamConfig(config);
  if (!valid) throw new SchemaError(label, errors);
  return config;
}

/**
 * Public-safe routing/log projection. It intentionally ignores display aliases.
 * @param {object} config
 */
export function projectAgentTeamForRouting(config) {
  const team = assertAgentTeamConfig(config);
  return Object.freeze({
    team_id: team.team_id,
    role_ids: Object.freeze(team.roles.map((role) => role.canonical_id)),
    dispatch_roles: Object.freeze(team.roles.map((role) => canonicalRoleToDispatchRole(role.canonical_id))),
    log_roles: Object.freeze(team.roles.map((role) => role.canonical_id)),
    provider_independence: Object.freeze(team.roles.flatMap((role) => role.independent_provider_from.map((source) => Object.freeze({
      role: role.canonical_id,
      independent_from: source,
    })))),
  });
}

/**
 * Display projection. Aliases are labels only; the canonical_id remains present.
 * @param {object} config
 * @param {{displayAliases?:Record<string,string>}} [options]
 */
export function projectAgentTeamForDisplay(config, options = {}) {
  const team = assertAgentTeamConfig(config);
  const aliases = options.displayAliases ?? {};
  return Object.freeze(team.roles.map((role) => {
    const configuredAlias = typeof role.display_alias === "string" ? role.display_alias : null;
    const localAlias = typeof aliases[role.canonical_id] === "string" && aliases[role.canonical_id].trim() !== ""
      ? aliases[role.canonical_id]
      : null;
    return Object.freeze({
      canonical_id: role.canonical_id,
      label: localAlias ?? configuredAlias ?? role.canonical_id,
      agent_file: role.agent_file,
    });
  }));
}
