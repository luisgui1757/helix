import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scanDiffText, scanText } from "../tools/ci/public-safety-diff-scan.mjs";

const SCANNER = fileURLToPath(new URL("../tools/ci/public-safety-diff-scan.mjs", import.meta.url));

function runScanner(args, input = "") {
  return spawnSync(process.execPath, [SCANNER, ...args], { input, encoding: "utf8" });
}

test("public-safety diff scan uses stable codes without returning raw matched text", () => {
  const key = "sk-" + "proj-" + "a".repeat(24);
  const text = [
    "+ token=" + key,
    "+ path=/ho" + "me/someone/project",
    "+ path=C:" + "\\Us" + "ers\\someone\\project",
    "+ trailer=Gener" + "ated with a tool",
  ].join("\n");
  const hits = scanText(text);
  assert.deepEqual(hits.map((hit) => hit.code).sort(), ["home-path", "home-path", "provenance", "provider-key"]);
  assert.equal(JSON.stringify(hits).includes(key), false);
  assert.equal(JSON.stringify(hits).includes("someone"), false);
});

test("public-safety diff scan ignores removed lines but catches added lines", () => {
  const key = "sk-" + "live-" + "b".repeat(24);
  const diff = [
    "diff --git a/x b/x",
    "--- a/x",
    "+++ b/x",
    "- removed=" + key,
    "+ added=" + key,
  ].join("\n");
  assert.deepEqual(scanDiffText(diff), [{ code: "provider-key", line: 5 }]);
});

test("stdin text mode catches dash-prefixed text leak lines", () => {
  const key = "sk-" + "proj-" + "c".repeat(24);
  const result = runScanner(["--stdin", "--mode", "text"], "- token=" + key);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /LEAK\[provider-key\]/);
  assert.equal(result.stderr.includes(key), false);
});

test("stdin diff mode ignores genuinely removed leak lines", () => {
  const key = "sk-" + "live-" + "d".repeat(24);
  const diff = [
    "diff --git a/x b/x",
    "--- a/x",
    "+++ b/x",
    "- removed=" + key,
  ].join("\n");
  const result = runScanner(["--stdin", "--mode", "diff"], diff);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /PASS/);
});

test("invalid scan mode refuses as usage", () => {
  const result = runScanner(["--stdin", "--mode", "maybe"], "plain text\n");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--mode must be either 'diff' or 'text'/);
});
