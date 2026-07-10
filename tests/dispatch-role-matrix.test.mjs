import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ROUTES } from "../dispatch/lib/routes.mjs";
import {
  expandRoleMatrix,
  validateRoleMatrixConfig,
} from "../dispatch/lib/role-matrix.mjs";
import { MAX_PANEL_MEMBERS } from "../dispatch/lib/limits.mjs";

const root = new URL("..", import.meta.url);

function readJson(rel) {
  return JSON.parse(readFileSync(new URL(rel, root), "utf8"));
}

function defaultMatrix() {
  return readJson("dispatch/config/role-matrix-defaults.json");
}

function defaultTeam() {
  return readJson("dispatch/config/agent-team-defaults.json");
}

function expand(overrides = {}) {
  return expandRoleMatrix({
    matrix: defaultMatrix(),
    route: ROUTES["risky-change"],
    ...overrides,
  });
}

test("default role matrix is schema-valid", () => {
  const { valid, errors } = validateRoleMatrixConfig(defaultMatrix());
  assert.equal(valid, true, JSON.stringify(errors));
});

test("role matrix expands deterministically in route role, entry, instance order", () => {
  const matrix = {
    schema_version: 1,
    matrix_id: "order-test",
    roles: {
      builder: [
        { provider: "mock", model: "builder-a", effort: "low", instances: 2 },
      ],
      reviewer: [
        { provider: "mock", model: "reviewer-a", effort: "medium", instances: 1 },
      ],
    },
  };
  const route = { ...ROUTES["routine-code"], panel: { min: 2, max: 3 } };
  const first = expandRoleMatrix({ matrix, route });
  const second = expandRoleMatrix({ matrix, route });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.deepEqual(first, second);
  assert.deepEqual(first.candidates.map((spec) => [spec.role, spec.model, spec.effort]), [
    ["builder", "builder-a", "low"],
    ["builder", "builder-a", "low"],
    ["reviewer", "reviewer-a", "medium"],
  ]);
});

test("matrix supplies singleton judge/synthesis/verification specs for those route roles", () => {
  const recon = expand({ route: ROUTES["roadmap-reconciliation"] });
  assert.equal(recon.ok, true, JSON.stringify(recon));
  assert.equal(recon.judge.role, "judge");
  assert.equal(recon.synthesis.role, "synthesizer");
  assert.equal(recon.verification, null);

  const preflight = expand({ route: ROUTES["pr-preflight"] });
  assert.equal(preflight.ok, true, JSON.stringify(preflight));
  assert.equal(preflight.verification.role, "verifier");
  assert.equal(preflight.judge, null);
});

test("missing routes, missing route roles, and malformed singleton instances fail closed", () => {
  assert.equal(expandRoleMatrix({ matrix: defaultMatrix() }).code, "missing-route");
  assert.equal(expandRoleMatrix({ matrix: { bogus: true }, route: ROUTES["routine-code"] }).code, "invalid-role-matrix");

  const matrix = defaultMatrix();
  const missing = {
    ...matrix,
    roles: Object.fromEntries(Object.entries(matrix.roles).filter(([role]) => role !== "redteam")),
  };
  assert.equal(expand({ matrix: missing }).code, "matrix-missing-role:redteam");

  const badJudge = {
    ...matrix,
    roles: { ...matrix.roles, judge: [{ ...matrix.roles.judge[0], instances: 2 }] },
  };
  const { valid, errors } = validateRoleMatrixConfig(badJudge);
  assert.equal(valid, false);
  assert.ok(errors.some((error) => error.path === "$.roles.judge[0].instances"));

  const locatorModel = {
    ...matrix,
    roles: {
      ...matrix.roles,
      builder: [{ ...matrix.roles.builder[0], model: "https:" + "/example.test/model" }],
    },
  };
  assert.equal(validateRoleMatrixConfig(locatorModel).valid, false);

  const twoJudgeEntries = {
    ...matrix,
    roles: { ...matrix.roles, judge: [matrix.roles.judge[0], { ...matrix.roles.judge[0], model: "mock-judge-b" }] },
  };
  assert.equal(
    expand({ matrix: twoJudgeEntries, route: ROUTES["roadmap-reconciliation"] }).code,
    "matrix-missing-role:judge",
  );
});

test("matrix expansion is bounded by the route panel min/max", () => {
  const oversized = {
    ...defaultMatrix(),
    roles: {
      ...defaultMatrix().roles,
      builder: [{ provider: "mock", model: "mock-builder", effort: "default", instances: 2 }],
      reviewer: [{ provider: "mock", model: "mock-reviewer", effort: "default", instances: 1 }],
    },
  };
  // routine-code panel max is 2; the matrix expands to 3 candidates.
  assert.equal(expand({ matrix: oversized, route: ROUTES["routine-code"] }).code, "matrix-exceeds-route-panel-max");

  // Default matrix expands to 2 routine-code candidates; a min-3 route refuses it.
  const wideRoute = { ...ROUTES["routine-code"], panel: { min: 3, max: 4 } };
  assert.equal(expand({ route: wideRoute }).code, "matrix-below-route-panel-min");
});

test("matrix instance counts are safe and expansion refuses oversized panels before allocation", () => {
  const base = defaultMatrix();
  for (const instances of [Number.MAX_SAFE_INTEGER + 1, MAX_PANEL_MEMBERS + 1]) {
    const invalid = {
      ...base,
      roles: {
        ...base.roles,
        builder: [{ ...base.roles.builder[0], instances }],
      },
    };
    assert.equal(validateRoleMatrixConfig(invalid).valid, false, `instances=${instances}`);
  }

  const members = Array.from({ length: MAX_PANEL_MEMBERS }, (_, index) => ({
    provider: "mock",
    model: `builder-${index}`,
    effort: "default",
    instances: 1,
  }));
  const oversized = {
    schema_version: 1,
    matrix_id: "oversized-panel",
    roles: {
      builder: members,
      reviewer: [{ provider: "mock", model: "reviewer", effort: "default", instances: 1 }],
    },
  };
  const wideRoute = {
    ...ROUTES["routine-code"],
    panel: { min: 1, max: MAX_PANEL_MEMBERS + 10 },
    min_successes: 1,
  };
  const result = expandRoleMatrix({ matrix: oversized, route: wideRoute });
  assert.equal(result.ok, false);
  assert.equal(result.code, "matrix-exceeds-panel-limit");
});

test("a non-automated provider is refused during matrix expansion before launch", () => {
  const matrix = {
    schema_version: 1,
    matrix_id: "claude-local-panel",
    roles: {
      builder: [{ provider: "claude-local", model: "claude-cli", effort: "default", instances: 1 }],
      reviewer: [{ provider: "mock", model: "mock-reviewer", effort: "default", instances: 1 }],
    },
  };
  const result = expandRoleMatrix({ matrix, route: ROUTES["routine-code"] });
  assert.equal(result.ok, false);
  assert.equal(result.code, "matrix-provider-not-automated:claude-local");
  assert.equal(result.detail, "builder:claude-local/claude-cli");
});

test("real providers pass the matrix gate with no price metadata (presence = live)", () => {
  const matrix = {
    schema_version: 1,
    matrix_id: "live-panel",
    roles: {
      builder: [{ provider: "openrouter", model: "vendor/paid", effort: "default", instances: 1 }],
      reviewer: [{ provider: "openai-codex", model: "codex-review", effort: "default", instances: 1 }],
    },
  };
  const result = expandRoleMatrix({ matrix, route: ROUTES["routine-code"] });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.candidates.map((spec) => [spec.provider, spec.model]), [
    ["openrouter", "vendor/paid"],
    ["openai-codex", "codex-review"],
  ]);
});

test("agent-team provider independence warns for all-mock matrices and enforces for real providers", () => {
  const warn = expand({ agent_team: defaultTeam() });
  assert.equal(warn.ok, true, JSON.stringify(warn));
  assert.ok(warn.warnings.includes("provider-independence-not-satisfied:reviewer:builder"));

  const sameProvider = {
    schema_version: 1,
    matrix_id: "same-provider-live",
    roles: {
      builder: [{ provider: "openai-codex", model: "codex-a", effort: "default", instances: 1 }],
      reviewer: [{ provider: "openai-codex", model: "codex-b", effort: "default", instances: 1 }],
    },
  };
  const enforced = expandRoleMatrix({
    matrix: sameProvider,
    route: ROUTES["routine-code"],
    agent_team: defaultTeam(),
  });
  assert.equal(enforced.ok, false);
  assert.equal(enforced.code, "provider-independence-not-satisfied:reviewer:builder");

  // An explicit policy override downgrades the same real-provider overlap to a warning.
  const overridden = expandRoleMatrix({
    matrix: sameProvider,
    route: ROUTES["routine-code"],
    agent_team: defaultTeam(),
    provider_independence_policy: "warn",
  });
  assert.equal(overridden.ok, true, JSON.stringify(overridden));
  assert.ok(overridden.warnings.includes("provider-independence-not-satisfied:reviewer:builder"));

  const badPolicy = expandRoleMatrix({
    matrix: sameProvider,
    route: ROUTES["routine-code"],
    provider_independence_policy: "block",
  });
  assert.equal(badPolicy.code, "invalid-provider-independence-policy");
});

test("cross-family diversity is always an advisory warning, never a blocker", () => {
  const mockMatrix = {
    ...defaultMatrix(),
    roles: {
      ...defaultMatrix().roles,
      redteam: [{ provider: "mock", model: "mock-redteam", effort: "default", instances: 2 }],
    },
  };
  const allMock = expand({ matrix: mockMatrix, route: ROUTES.security });
  assert.equal(allMock.ok, true, JSON.stringify(allMock));
  assert.ok(allMock.warnings.includes("cross-family-not-satisfied"));

  // Real providers from a single family (openai-codex + openai-api) still only warn.
  const singleFamily = {
    schema_version: 1,
    matrix_id: "single-family-live",
    roles: {
      redteam: [
        { provider: "openai-codex", model: "codex-red", effort: "default", instances: 1 },
        { provider: "openai-api", model: "gpt-red", effort: "default", instances: 1 },
      ],
      judge: [{ provider: "openai-api", model: "gpt-judge", effort: "default", instances: 1 }],
      synthesizer: [{ provider: "openai-api", model: "gpt-synth", effort: "default", instances: 1 }],
    },
  };
  const live = expandRoleMatrix({ matrix: singleFamily, route: ROUTES.security });
  assert.equal(live.ok, true, JSON.stringify(live));
  assert.ok(live.warnings.includes("cross-family-not-satisfied"));
});
