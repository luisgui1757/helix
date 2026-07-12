import { mkdirSync, writeFileSync, cpSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RUNTIME_RPC_TIMEOUT_MS, runPiE2ELoad } from "../tools/smoke/pi-e2e-load.mjs";

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "helix-load-helper-"));
  mkdirSync(join(root, ".pi"), { recursive: true });
  mkdirSync(join(root, "skills/helix-ui"), { recursive: true });
  mkdirSync(join(root, "themes"), { recursive: true });
  mkdirSync(join(root, "extensions"), { recursive: true });
  writeFileSync(join(root, "skills/helix-ui/SKILL.md"), "---\nname: helix-ui\n---\n", "utf8");
  for (const file of ["helix-fence.ts", "helix-answer.ts", "helix-command.ts"]) {
    writeFileSync(join(root, "extensions", file), "export default function x() {}\n", "utf8");
  }
  writeFileSync(join(root, "themes/helix-rose-pine.json"), "{}\n", "utf8");
  writeFileSync(join(root, "package.json"), JSON.stringify({
    pi: {
      skills: ["./skills/helix-ui"],
      themes: ["./themes"],
      extensions: ["./extensions/helix-fence.ts", "./extensions/helix-answer.ts", "./extensions/helix-command.ts"],
    },
  }), "utf8");
  writeFileSync(join(root, ".pi/settings.json"), JSON.stringify({
    skills: ["../skills/helix-ui"],
    themes: ["../themes"],
    extensions: ["../extensions/helix-fence.ts", "../extensions/helix-answer.ts", "../extensions/helix-command.ts"],
  }), "utf8");
  return root;
}

test("static Pi load helper separates proof types without claiming discoverability", () => {
  const root = fixtureRoot();
  try {
    const result = runPiE2ELoad({ root });
    assert.equal(result.ok, true);
    assert.equal(result.mode, "static-no-live");
    assert.equal(result.gates.find((g) => g.id === "package-resource-loadability").status, "pass");
    assert.equal(result.gates.find((g) => g.id === "pi-discoverability").status, "not-run");
    assert.equal(result.gates.find((g) => g.id === "live-provider-proof").status, "skipped");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("static Pi load helper fails package/resource loadability on drift", () => {
  const root = fixtureRoot();
  try {
    cpSync(join(root, "package.json"), join(root, "package.good.json"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ pi: { skills: [], themes: ["./themes"], extensions: [] } }), "utf8");
    const result = runPiE2ELoad({ root });
    assert.equal(result.ok, false);
    const load = result.gates.find((g) => g.id === "package-resource-loadability");
    assert.equal(load.status, "fail");
    assert.match(load.detail, /package-skill-surface/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runtime RPC helper default timeout is long enough for cold Pi startup", () => {
  assert.equal(DEFAULT_RUNTIME_RPC_TIMEOUT_MS, 60_000);
});
