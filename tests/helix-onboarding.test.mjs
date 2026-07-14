import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadOnboardingState,
  ONBOARDING_STATE_FILE,
  saveOnboardingState,
} from "../extensions/lib/helix-onboarding.mjs";

test("onboarding state distinguishes unseen, completed, and dismissed", () => {
  const root = mkdtempSync(join(tmpdir(), "helix-onboarding-state-"));
  try {
    assert.deepEqual(loadOnboardingState(root), { ok: true, status: "unseen" });
    assert.deepEqual(saveOnboardingState(root, "completed"), { ok: true, status: "completed" });
    assert.deepEqual(loadOnboardingState(root), { ok: true, status: "completed" });
    assert.deepEqual(saveOnboardingState(root, "dismissed"), { ok: true, status: "dismissed" });
    assert.deepEqual(loadOnboardingState(root), { ok: true, status: "dismissed" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("onboarding state refuses malformed data and symlink targets", () => {
  const root = mkdtempSync(join(tmpdir(), "helix-onboarding-invalid-"));
  const outside = join(root, "outside.json");
  try {
    writeFileSync(join(root, ONBOARDING_STATE_FILE), "{}\n", "utf8");
    assert.equal(loadOnboardingState(root).ok, false);
    rmSync(join(root, ONBOARDING_STATE_FILE));
    writeFileSync(outside, '{"schema_version":1,"status":"completed"}\n', "utf8");
    symlinkSync(outside, join(root, ONBOARDING_STATE_FILE));
    assert.deepEqual(loadOnboardingState(root), { ok: false, code: "helix-onboarding-state-unreadable" });
    assert.equal(saveOnboardingState(root, "unknown").ok, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
