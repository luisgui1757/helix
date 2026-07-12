// Helix dispatch — per-role model/effort/instance matrix expansion (Stage 3L).
//
// Source of truth: ROADMAP Phase 3 / Theme J and the Stage 3A routing policy:
// role -> [{ provider, model, effort, instances }], deterministic expansion into
// dispatch specs, and provider-diversity requirements enforced or warned by
// policy. Helix performs no cost control; a matrix naming real providers is
// launchable as-is (presence = live).
//
// This module deliberately sits BEFORE runDispatch. It turns matrix config into
// the request pieces runDispatch already understands (`candidates`, optional
// `judge` / `synthesis` / `verification`). runDispatch still re-checks every
// spec at launch, so this is an early fail-closed expander, not a second
// authority path.

import { validate, SchemaError } from "./schema.mjs";
import { ROLES, isRoleValidForStage } from "./role-envelope.mjs";
import { ROLE_MATRIX_ENTRY_SCHEMA, validateRouteConfig } from "./routes.mjs";
import { providerFamily, isAutomatedDispatchProvider } from "./providers.mjs";
import { DISPATCH_ROLE_BY_CANONICAL, validateAgentTeamConfig } from "./agent-team.mjs";
import { MAX_PANEL_MEMBERS } from "./limits.mjs";

const MATRIX_ID_PATTERN = "^[a-z0-9][a-z0-9._:-]*$";
const SINGLETON_STAGE_ROLES = Object.freeze({
  judge: "judge",
  synthesizer: "synthesis",
  verifier: "verification",
});

const ROLE_MATRIX_OBJECT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: Object.fromEntries(ROLES.map((role) => [
    role,
    { type: "array", items: ROLE_MATRIX_ENTRY_SCHEMA },
  ])),
});

export const ROLE_MATRIX_CONFIG_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["schema_version", "matrix_id", "roles"],
  properties: {
    schema_version: { const: 1 },
    matrix_id: { type: "string", pattern: MATRIX_ID_PATTERN },
    roles: ROLE_MATRIX_OBJECT_SCHEMA,
  },
});

function stableError(path, message) {
  return { path, message };
}

function errorsToDetail(errors) {
  return errors.map((error) => `${error.path} ${error.message}`).join("; ");
}

function uniqueInOrder(values) {
  return [...new Set(values)];
}

function matrixRoles(matrix) {
  return matrix?.roles ?? matrix ?? {};
}

function normalizedMatrixForValidation(matrix) {
  if (matrix && typeof matrix === "object" && "schema_version" in matrix) return matrix;
  return { schema_version: 1, matrix_id: "inline", roles: matrix };
}

export function validateRoleMatrixConfig(config) {
  const structural = validate(ROLE_MATRIX_CONFIG_SCHEMA, config, "$");
  const errors = [...structural.errors];
  if (!structural.valid) return { valid: false, errors };

  for (const [role, entries] of Object.entries(config.roles)) {
    entries.forEach((entry, index) => {
      if (!Number.isSafeInteger(entry.instances) || entry.instances < 1) {
        errors.push(stableError(`$.roles.${role}[${index}].instances`, "must be a positive integer"));
      }
      if (Number.isSafeInteger(entry.instances) && entry.instances > MAX_PANEL_MEMBERS) {
        errors.push(stableError(
          `$.roles.${role}[${index}].instances`,
          `must be <= ${MAX_PANEL_MEMBERS}`,
        ));
      }
      if (role in SINGLETON_STAGE_ROLES && entry.instances !== 1) {
        errors.push(stableError(
          `$.roles.${role}[${index}].instances`,
          `${role} is a singleton stage in the current orchestrator and must use instances=1`,
        ));
      }
    });
  }

  return { valid: errors.length === 0, errors };
}

export function assertRoleMatrixConfig(config, label = "role-matrix-config") {
  const { valid, errors } = validateRoleMatrixConfig(config);
  if (!valid) throw new SchemaError(label, errors);
  return config;
}

function routeCandidateRoles(route) {
  return route.roles.filter((role) => isRoleValidForStage("candidate", role));
}

function expandEntries(role, entries) {
  const specs = [];
  entries.forEach((entry, entryIndex) => {
    for (let instance = 1; instance <= entry.instances; instance++) {
      specs.push({
        role,
        provider: entry.provider,
        model: entry.model,
        effort: entry.effort,
        matrix_entry: entryIndex,
        instance,
      });
    }
  });
  return specs;
}

function publicSpec(spec) {
  const { matrix_entry: _matrixEntry, instance: _instance, ...out } = spec;
  return out;
}

function independencePairs(teamConfig) {
  if (!teamConfig) return [];
  const valid = validateAgentTeamConfig(teamConfig);
  if (!valid.valid) {
    return { errors: valid.errors };
  }
  return teamConfig.roles.flatMap((role) => role.independent_provider_from.map((source) => ({
    role: DISPATCH_ROLE_BY_CANONICAL[role.canonical_id],
    independent_from: DISPATCH_ROLE_BY_CANONICAL[source],
    canonical_role: role.canonical_id,
    canonical_from: source,
  })));
}

function enforceIndependence({ teamConfig, roles, policy, warnings }) {
  const pairs = independencePairs(teamConfig);
  if (pairs.errors) return { code: "invalid-agent-team-config", detail: errorsToDetail(pairs.errors) };
  for (const pair of pairs) {
    const providers = uniqueInOrder((roles[pair.role] ?? []).map((entry) => entry.provider));
    const sourceProviders = uniqueInOrder((roles[pair.independent_from] ?? []).map((entry) => entry.provider));
    if (providers.length === 0 || sourceProviders.length === 0) continue;
    const overlap = providers.filter((provider) => sourceProviders.includes(provider));
    if (overlap.length === 0) continue;
    const code = `provider-independence-not-satisfied:${pair.role}:${pair.independent_from}`;
    if (policy === "enforce") return { code, detail: `${pair.canonical_role} shares provider(s) with ${pair.canonical_from}` };
    warnings.push(code);
  }
  return null;
}

function crossFamilyCheck({ route, candidates, warnings }) {
  if (!route.requires_cross_family) return null;
  const families = new Set(candidates.map((spec) => providerFamily(spec.provider)));
  if (families.size >= 2) return null;
  // Advisory only: a single-family panel warns (an all-mock panel is one family).
  warnings.push("cross-family-not-satisfied");
  return null;
}

/**
 * Expand a per-role matrix into concrete runDispatch specs.
 *
 * @param {object} args
 * @param {object} args.matrix ROLE_MATRIX_CONFIG_SCHEMA-shaped config, or the
 *   bare `roles` object for inline tests.
 * @param {object} args.route ROUTE_CONFIG_SCHEMA-shaped route.
 * @param {object} [args.agent_team] optional Stage 3K team config. Provider
 *   independence from this team is enforced or warned per policy.
 * @param {"enforce"|"warn"} [args.provider_independence_policy] default:
 *   all-mock matrices warn (a mock fixture cannot prove independent providers);
 *   matrices naming real providers enforce.
 * @returns {{ok:boolean, candidates?:object[], judge?:object|null,
 *   synthesis?:object|null, verification?:object|null, warnings:string[],
 *   code?:string, detail?:string}}
 */
export function expandRoleMatrix(args) {
  const warnings = [];
  const fail = (code, detail = null) => ({ ok: false, code, detail, warnings: uniqueInOrder(warnings) });

  const matrixConfig = normalizedMatrixForValidation(args?.matrix);
  const matrixValid = validateRoleMatrixConfig(matrixConfig);
  if (!matrixValid.valid) return fail("invalid-role-matrix", errorsToDetail(matrixValid.errors));

  const { route } = args ?? {};
  if (!route || typeof route !== "object") return fail("missing-route");
  const routeValid = validateRouteConfig(route);
  if (!routeValid.valid) return fail("invalid-route", errorsToDetail(routeValid.errors));

  const roles = matrixRoles(matrixConfig);
  const candidateRoles = routeCandidateRoles(route);
  const candidates = [];
  let candidateCount = 0;

  for (const role of candidateRoles) {
    const entries = roles[role] ?? [];
    if (entries.length === 0) return fail(`matrix-missing-role:${role}`);
    for (const entry of entries) {
      candidateCount += entry.instances;
      if (candidateCount > route.panel.max) {
        return fail(
          "matrix-exceeds-route-panel-max",
          `${candidateCount} candidate(s) > route maximum ${route.panel.max}`,
        );
      }
      if (candidateCount > MAX_PANEL_MEMBERS) {
        return fail(
          "matrix-exceeds-panel-limit",
          `${candidateCount} candidate(s) > practical maximum ${MAX_PANEL_MEMBERS}`,
        );
      }
    }
  }

  if (candidateCount < route.panel.min) {
    return fail("matrix-below-route-panel-min", `${candidateCount} candidate(s) < route minimum ${route.panel.min}`);
  }
  for (const role of candidateRoles) {
    candidates.push(...expandEntries(role, roles[role]));
  }

  const allProvidersMock = () =>
    Object.values(roles).every((entries) => entries.every((entry) => entry.provider === "mock"));
  const policy = args?.provider_independence_policy ?? (allProvidersMock() ? "warn" : "enforce");
  if (policy !== "enforce" && policy !== "warn") return fail("invalid-provider-independence-policy");
  const independence = enforceIndependence({ teamConfig: args?.agent_team, roles, policy, warnings });
  if (independence) return fail(independence.code, independence.detail);

  const crossFamily = crossFamilyCheck({ route, candidates, warnings });
  if (crossFamily) return fail(crossFamily.code, crossFamily.detail);

  const allSpecs = [...candidates];
  const stageSpecs = { judge: null, synthesis: null, verification: null };
  for (const [role, outputKey] of Object.entries(SINGLETON_STAGE_ROLES)) {
    if (!route.roles.includes(role)) continue;
    const entries = roles[role] ?? [];
    if (entries.length !== 1) return fail(`matrix-missing-role:${role}`, `${role} needs exactly one configured entry`);
    const expanded = expandEntries(role, entries);
    if (expanded.length !== 1) return fail(`matrix-singleton-instances:${role}`, `${role} must expand to exactly one spec`);
    stageSpecs[outputKey] = expanded[0];
    allSpecs.push(expanded[0]);
  }

  // Structural provider check only: the provider must be a known Helix provider
  // eligible for automated dispatch (claude-local stays excluded by roadmap gate).
  for (const spec of allSpecs) {
    if (!isAutomatedDispatchProvider(spec.provider)) {
      return fail(`matrix-provider-not-automated:${spec.provider}`, `${spec.role}:${spec.provider}/${spec.model}`);
    }
  }

  return {
    ok: true,
    candidates: candidates.map(publicSpec),
    judge: stageSpecs.judge ? publicSpec(stageSpecs.judge) : null,
    synthesis: stageSpecs.synthesis ? publicSpec(stageSpecs.synthesis) : null,
    verification: stageSpecs.verification ? publicSpec(stageSpecs.verification) : null,
    warnings: uniqueInOrder(warnings),
  };
}
