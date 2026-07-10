import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_AGENT_ROLES,
  canonicalRoleToDispatchRole,
  projectAgentTeamForDisplay,
  projectAgentTeamForRouting,
  validateAgentTeamConfig,
} from "../dispatch/lib/agent-team.mjs";

const root = new URL("..", import.meta.url);

function readJson(rel) {
  return JSON.parse(readFileSync(new URL(rel, root), "utf8"));
}

function defaultTeam() {
  return readJson("dispatch/config/agent-team-defaults.json");
}

test("canonical agent-team role ids stay stable", () => {
  assert.deepEqual([...CANONICAL_AGENT_ROLES], [
    "Scout",
    "Planner",
    "Builder",
    "Reviewer",
    "Documenter",
    "RedTeam",
  ]);
  assert.equal(canonicalRoleToDispatchRole("Builder"), "builder");
  assert.equal(canonicalRoleToDispatchRole("Reviewer"), "reviewer");
  assert.equal(canonicalRoleToDispatchRole("RedTeam"), "redteam");
  assert.equal(canonicalRoleToDispatchRole("builder"), null);
});

test("lean default team is additive Builder plus independent-provider Reviewer", () => {
  const team = defaultTeam();
  const { valid, errors } = validateAgentTeamConfig(team);
  assert.equal(valid, true, JSON.stringify(errors));
  assert.equal(team.defaults_are_additive, true);
  assert.deepEqual(team.roles.map((role) => role.canonical_id), ["Builder", "Reviewer"]);
  assert.deepEqual(team.roles.find((role) => role.canonical_id === "Reviewer").independent_provider_from, ["Builder"]);
});

test("default agent markdown artifacts exist and carry canonical ids", () => {
  for (const role of defaultTeam().roles) {
    const fullPath = join(root.pathname, role.agent_file);
    assert.equal(existsSync(fullPath), true, `${role.agent_file} missing`);
    const text = readFileSync(fullPath, "utf8");
    assert.match(text, new RegExp(`Canonical role: \`${role.canonical_id}\``));
    assert.match(text, new RegExp(`Dispatch role: \`${role.dispatch_role}\``));
  }
});

test("routing and logging projection uses canonical ids, never display aliases", () => {
  const team = defaultTeam();
  const baseline = projectAgentTeamForRouting(team);
  const withAliases = {
    ...team,
    roles: team.roles.map((role) => ({
      ...role,
      display_alias: role.canonical_id === "Builder" ? "Road Captain" : "Mirror",
    })),
  };
  const aliased = projectAgentTeamForRouting(withAliases);
  assert.deepEqual(aliased, baseline);
  assert.deepEqual(aliased.role_ids, ["Builder", "Reviewer"]);
  assert.deepEqual(aliased.dispatch_roles, ["builder", "reviewer"]);
  assert.deepEqual(aliased.log_roles, ["Builder", "Reviewer"]);
});

test("display projection may label aliases but keeps canonical handles", () => {
  const display = projectAgentTeamForDisplay(defaultTeam(), {
    displayAliases: { Builder: "Road Captain", Reviewer: "Mirror" },
  });
  assert.deepEqual(display.map((role) => role.canonical_id), ["Builder", "Reviewer"]);
  assert.deepEqual(display.map((role) => role.label), ["Road Captain", "Mirror"]);
});

test("cosmetic aliases cannot be the only role handle", () => {
  const team = defaultTeam();
  const aliasOnly = {
    ...team,
    roles: [
      { ...team.roles[0], canonical_id: "Road Captain" },
      team.roles[1],
    ],
  };
  const { valid, errors } = validateAgentTeamConfig(aliasOnly);
  assert.equal(valid, false);
  assert.ok(errors.some((error) => error.path === "$.roles[0].canonical_id"));
});

test("canonical role to dispatch-role mismatches fail closed", () => {
  const team = defaultTeam();
  const mismatched = {
    ...team,
    roles: [
      { ...team.roles[0], dispatch_role: "reviewer" },
      team.roles[1],
    ],
  };
  const { valid, errors } = validateAgentTeamConfig(mismatched);
  assert.equal(valid, false);
  assert.ok(errors.some((error) => error.path === "$.roles[0].dispatch_role"));
});

test("duplicate canonical roles and dangling independence references fail closed", () => {
  const team = defaultTeam();
  const duplicate = {
    ...team,
    roles: [
      team.roles[0],
      { ...team.roles[1], canonical_id: "Builder", dispatch_role: "builder" },
    ],
  };
  assert.equal(validateAgentTeamConfig(duplicate).valid, false);

  const dangling = {
    ...team,
    roles: [
      team.roles[0],
      { ...team.roles[1], independent_provider_from: ["Scout"] },
    ],
  };
  const { valid, errors } = validateAgentTeamConfig(dangling);
  assert.equal(valid, false);
  assert.ok(errors.some((error) => error.path === "$.roles[1].independent_provider_from[0]"));
});
