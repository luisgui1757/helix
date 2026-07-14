import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDocsTruth, HELIX_COMMANDS, MAX_README_LINES } from "../tools/ci/docs-truth-check.mjs";

function write(root, rel, text) {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), text, "utf8");
}

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "helix-docs-truth-"));
  write(root, "package.json", JSON.stringify({ pi: { extensions: ["a", "b", "c"] } }));
  write(root, "README.md", [
    "# Helix",
    "npm install -g @earendil-works/pi-coding-agent",
    "pi install git:github.com/luisgui1757/helix",
    "/helix-help",
    "/helix-onboarding",
    "/helix-settings",
    "~/.pi/agent/helix",
    "",
  ].join("\n"));
  write(root, "docs/manual.md", HELIX_COMMANDS.join("\n") + "\n");
  write(root, "docs/architecture.md", "# Architecture\n");
  return root;
}

test("docs truth accepts the concise native-command surface", () => {
  const root = fixtureRoot();
  try {
    assert.deepEqual(checkDocsTruth(root), { ok: true, errors: [] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("docs truth rejects missing commands, stale stages, and README bloat", () => {
  const root = fixtureRoot();
  try {
    write(root, "docs/manual.md", HELIX_COMMANDS.filter((command) => command !== "/helix-run").join("\n") + "\nStage 3\n");
    write(root, "README.md", Array.from({ length: MAX_README_LINES + 1 }, (_, index) => index === 0
      ? "npm install -g @earendil-works/pi-coding-agent pi install git:github.com/luisgui1757/helix /helix-help /helix-onboarding /helix-settings ~/.pi/agent/helix"
      : "line").join("\n"));
    const result = checkDocsTruth(root);
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /exceeds/);
    assert.match(result.errors.join("\n"), /\/helix-run/);
    assert.match(result.errors.join("\n"), /Stage 3/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("docs truth rejects a skill or theme package surface", () => {
  const root = fixtureRoot();
  try {
    write(root, "package.json", JSON.stringify({ pi: { extensions: ["a", "b", "c"], skills: ["skill"], themes: ["theme"] } }));
    const result = checkDocsTruth(root);
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /extension-only/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
