import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "../dispatch/lib/classify.mjs";

const tui = { mode: "tui" };
const ci = { mode: "print" };

test("a confident hint with no floors routes to that class", () => {
  const d = classify({ class_hint: "routine-code", confident: true }, tui);
  assert.equal(d.task_class, "routine-code");
  assert.equal(d.route_id, "routine-code");
  assert.equal(d.fail_closed, false);
});

test("security-floor signals can never route below security", () => {
  for (const signal of ["auth", "credentials", "provider-config", "egress", "telemetry", "sandboxing", "public-safety"]) {
    const d = classify({ class_hint: "routine-code", confident: true, signals: [signal] }, tui);
    assert.equal(d.task_class, "security", signal);
    assert.ok(d.warnings.includes("floor-raised-classification"), signal);
  }
});

test("persisted-shape / branch-protection / release-gates floor to risky-change", () => {
  for (const signal of ["persisted-shape", "branch-protection", "release-gates"]) {
    const d = classify({ class_hint: "trivial", confident: true, signals: [signal] }, tui);
    assert.equal(d.task_class, "risky-change", signal);
  }
});

test("pr-preflight signal floors to pr-preflight", () => {
  const d = classify({ class_hint: "trivial", confident: true, signals: ["pr-preflight"] }, tui);
  assert.equal(d.task_class, "pr-preflight");
});

test("the highest-risk floor wins when several are present", () => {
  const d = classify({ class_hint: "trivial", confident: true, signals: ["persisted-shape", "egress"] }, tui);
  assert.equal(d.task_class, "security");
});

test("uncertain classification with nothing to route from fails closed in non-TTY", () => {
  const d = classify({ confident: false }, ci);
  assert.equal(d.fail_closed, true);
  assert.equal(d.escalation, "non-tty-stop");
  assert.equal(d.reason, "uncertain-classification-non-tty-fail-closed");
});

test("uncertain classification in TUI escalates to the user (not fail-closed)", () => {
  const d = classify({ confident: false }, tui);
  assert.equal(d.escalation, "tui-user");
  assert.equal(d.fail_closed, false);
});

test("uncertain-but-anchored classification routes upward", () => {
  const d = classify({ class_hint: "routine-code", confident: false }, ci);
  assert.ok(d.warnings.includes("uncertain-routed-upward"));
  // routine-code (risk 1) bumps to the next ladder rung (roadmap-reconciliation, risk 2).
  assert.equal(d.task_class, "roadmap-reconciliation");
});

test("user override may raise risk and is recorded", () => {
  const d = classify({ class_hint: "routine-code", confident: true, override: { task_class: "security" } }, tui);
  assert.equal(d.task_class, "security");
  assert.ok(d.overrides_applied.includes("raise:security"));
});

test("user override may not lower risk", () => {
  const d = classify({ class_hint: "security", confident: true, override: { task_class: "trivial" } }, tui);
  assert.equal(d.task_class, "security");
  assert.ok(d.warnings.some((w) => w.startsWith("override-rejected-not-raising")));
});

test("disabling adversarial review is an explicit, recorded override", () => {
  const d = classify({ class_hint: "routine-code", confident: true, override: { disable_adversarial: true } }, tui);
  assert.ok(d.overrides_applied.includes("disable-adversarial"));
});

test("an unknown class hint is ignored and treated as uncertain", () => {
  const d = classify({ class_hint: "make-it-good", signals: ["egress"] }, ci);
  assert.ok(d.warnings.some((w) => w.startsWith("unknown-class-hint")));
  // still floored to security by the egress signal
  assert.equal(d.task_class, "security");
});
