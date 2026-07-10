import { test } from "node:test";
import assert from "node:assert/strict";
import { ROUTES, validateRouteConfig, resolvePanel, routeForClass } from "../dispatch/lib/routes.mjs";

test("all built-in routes are schema-valid", () => {
  for (const id of Object.keys(ROUTES)) {
    const { valid, errors } = validateRouteConfig(ROUTES[id]);
    assert.equal(valid, true, `${id}: ${JSON.stringify(errors)}`);
  }
});

test("resolvePanel defaults to the route panel max and honors numeric min_successes", () => {
  // routine-code: panel {2,2}, min_successes 2 — no requested count needed.
  const r = resolvePanel(ROUTES["routine-code"]);
  assert.deepEqual(
    { launched: r.launched, required: r.required_successes, fc: r.fail_closed },
    { launched: 2, required: 2, fc: false },
  );
  assert.equal(r.min_panel, 2);
  assert.deepEqual(r.warnings, []);
});

test("resolvePanel launches min(panel.max, requested); 'panel' successes track launched", () => {
  // security: panel {2,3}, min_successes "panel".
  const capped = resolvePanel(ROUTES.security, 5); // requested above max → capped to max
  assert.deepEqual(
    { launched: capped.launched, required: capped.required_successes, fc: capped.fail_closed },
    { launched: 3, required: 3, fc: false },
  );
  const reduced = resolvePanel(ROUTES.security, 2); // requested below max → launch what was requested
  assert.deepEqual(
    { launched: reduced.launched, required: reduced.required_successes, fc: reduced.fail_closed },
    { launched: 2, required: 2, fc: false },
  );
  assert.deepEqual(reduced.warnings, []);
});

test("resolvePanel fails closed when required successes exceed the launched panel", () => {
  const route = {
    ...ROUTES["ui-quality"], panel: { min: 1, max: 3 }, min_successes: 3,
  };
  const r = resolvePanel(route, 2);
  assert.equal(r.launched, 2);
  assert.equal(r.required_successes, 3);
  assert.equal(r.fail_closed, true);
  assert.equal(r.reason, "required-successes-exceeds-launched");
  assert.ok(r.warnings.includes("required-successes-unmeetable"));
});

test("routeForClass returns null for an unknown class", () => {
  assert.equal(routeForClass("nonsense"), null);
  assert.equal(routeForClass("security").id, "security");
});
