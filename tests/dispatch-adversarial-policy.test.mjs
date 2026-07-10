import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveAdversarialPolicy,
  routeHasAdversarialRole,
  MEANINGFUL_WORK_CLASSES,
  ADVERSARIAL_ROLES,
} from "../dispatch/lib/adversarial-policy.mjs";
import { ROUTES, routeForClass } from "../dispatch/lib/routes.mjs";

// ----------------------------------------------------------------------------
// Default-on for meaningful work
// ----------------------------------------------------------------------------

test("adversarial/multi-team debate is default-on for every meaningful-work class", () => {
  for (const cls of MEANINGFUL_WORK_CLASSES) {
    const policy = resolveAdversarialPolicy(routeForClass(cls), {});
    assert.equal(policy.default_on, true, `${cls} must be default-on`);
    assert.equal(policy.effective_on, true, `${cls} runs adversarial by default`);
    assert.equal(policy.opted_out, false);
    assert.deepEqual(policy.warnings, [], `${cls} records no single-pass/opt-out warning`);
  }
});

test("non-meaningful classes are single-pass (adversarial off by nature)", () => {
  for (const cls of ["trivial", "routine-code", "ui-quality"]) {
    const policy = resolveAdversarialPolicy(routeForClass(cls), {});
    assert.equal(policy.default_on, false, `${cls} is not meaningful work`);
    assert.equal(policy.effective_on, false);
    assert.ok(policy.warnings.includes("single-pass-route"), `${cls} records single-pass-route`);
    assert.ok(!policy.warnings.includes("adversarial-opt-out"), `${cls} has no opt-out to record`);
  }
});

// ----------------------------------------------------------------------------
// Explicit opt-out (equivalent to /adversarial off) is recorded structurally
// ----------------------------------------------------------------------------

test("an explicit opt-out disables a default-on route and records adversarial-opt-out", () => {
  const request = { task: { override: { disable_adversarial: true } } };
  const policy = resolveAdversarialPolicy(routeForClass("risky-change"), request);
  assert.equal(policy.default_on, true);
  assert.equal(policy.opted_out, true);
  assert.equal(policy.effective_on, false, "opt-out turns the route single-pass");
  assert.ok(policy.warnings.includes("adversarial-opt-out"), "opt-out is a stable structural code");
  assert.ok(policy.warnings.includes("single-pass-route"));
});

test("opting out of an already-single-pass route records no adversarial-opt-out", () => {
  const request = { task: { override: { disable_adversarial: true } } };
  const policy = resolveAdversarialPolicy(routeForClass("routine-code"), request);
  assert.equal(policy.default_on, false);
  assert.equal(policy.effective_on, false);
  assert.ok(policy.warnings.includes("single-pass-route"));
  assert.ok(!policy.warnings.includes("adversarial-opt-out"), "there was no adversarial default to opt out of");
});

// ----------------------------------------------------------------------------
// Consistency + guardrails
// ----------------------------------------------------------------------------

test("MEANINGFUL_WORK_CLASSES is exactly the set of routes carrying an adversarial role", () => {
  const derived = Object.keys(ROUTES)
    .filter((cls) => routeHasAdversarialRole(ROUTES[cls]))
    .sort();
  assert.deepEqual([...MEANINGFUL_WORK_CLASSES].sort(), derived,
    "the human-readable list must track the role-based definition");
  // Every adversarial role is a real role that appears in at least one route.
  for (const role of ADVERSARIAL_ROLES) {
    assert.ok(Object.values(ROUTES).some((r) => r.roles.includes(role)), `${role} appears in a route`);
  }
});

test("a null/unknown route is single-pass, never adversarial (fail-closed direction)", () => {
  const policy = resolveAdversarialPolicy(null, {});
  assert.equal(policy.default_on, false);
  assert.equal(policy.effective_on, false);
  assert.ok(policy.warnings.includes("single-pass-route"));
});

test("the policy never widens a panel — heavier/every-task runs stay explicit opt-in", () => {
  // resolveAdversarialPolicy only decides whether the DEFAULT route iterates; it
  // exposes no panel-size / instance-count knob, so it cannot silently escalate a
  // route to a heavier 3+ model run.
  const policy = resolveAdversarialPolicy(routeForClass("security"), {});
  assert.deepEqual(
    Object.keys(policy).sort(),
    ["default_on", "effective_on", "opted_out", "warnings"],
  );
});
