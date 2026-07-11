import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  checkDocsTruth,
  collectDocsTruthFacts,
  HISTORICAL_STAGE_BANNER,
} from "../tools/ci/docs-truth-check.mjs";

function write(root, rel, text) {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), text);
}

test("docs truth check locks package surface and test count to docs", () => {
  const root = mkdtempSync(join(tmpdir(), "prime-docs-truth-"));
  const historicalStage = "docs/stage3/example-stage.md";
  write(root, "package.json", JSON.stringify({
    pi: {
      skills: ["./skills/prime-ui"],
      themes: ["./themes"],
      extensions: ["./extensions/prime-command.ts"],
    },
  }));
  write(root, "themes/a.json", "{}");
  write(root, "extensions/prime-command.ts", "pi.registerCommand(\"prime\", {});");
  write(root, "tests/a.test.mjs", "test(\"one\", () => {});\ntest(\"two\", () => {});\n");
  write(root, "ROADMAP.md", [
    "Stage 3P whole-repo gap closure",
    "Current v1 | Publication hardening",
    "Phase 0-3P rows and named Stage 3B-N pages below preserve dated build",
    "",
  ].join("\n"));
  write(root, "ROADMAP_SUMMARY.html", [
    '<p data-node-test-declarations="2">Stage 3P whole-repo gap closure</p>',
    "Historical build chronology (superseded)",
    "Historical Stage 3 build chronology",
    "live-adapter-not-wired",
    "",
  ].join("\n"));
  write(root, "docs/resources/README.md", "/prime help\n");
  write(root, "docs/manual.md", "/prime help\n");
  write(root, "docs/stage3/design-contracts.md", [
    "Fail closed on structure, YOLO on behavior",
    "Named Stage 3B-N implementation pages are dated historical records",
    "",
  ].join("\n"));
  write(root, historicalStage, `# Stage 3Z — fixture\n\n${HISTORICAL_STAGE_BANNER}\n`);

  const facts = collectDocsTruthFacts(root);
  write(root, "README.md", [
    "<!-- PRIME-DOCS-TRUTH:BEGIN -->",
    "```json",
    JSON.stringify(facts, null, 2),
    "```",
    "<!-- PRIME-DOCS-TRUTH:END -->",
    "",
  ].join("\n"));
  assert.deepEqual(checkDocsTruth(root), { ok: true, errors: [], facts });

  write(root, historicalStage, "# Stage 3Z — fixture\n\nstale stage instructions without a banner\n");
  const unmarkedHistorical = checkDocsTruth(root);
  assert.equal(unmarkedHistorical.ok, false);
  assert.match(unmarkedHistorical.errors.join("\n"), /Historical implementation record/);
  write(root, historicalStage, `# Stage 3Z — fixture\n\n${HISTORICAL_STAGE_BANNER}\n`);

  write(root, "ROADMAP_SUMMARY.html", [
    '<p data-node-test-declarations="1">Stage 3P whole-repo gap closure</p>',
    "Historical build chronology (superseded)",
    "Historical Stage 3 build chronology",
    "live-adapter-not-wired",
    "",
  ].join("\n"));
  const staleHtmlCount = checkDocsTruth(root);
  assert.equal(staleHtmlCount.ok, false);
  assert.match(staleHtmlCount.errors.join("\n"), /data-node-test-declarations/);
  write(root, "ROADMAP_SUMMARY.html", [
    '<p data-node-test-declarations="2">Stage 3P whole-repo gap closure</p>',
    "Historical build chronology (superseded)",
    "Historical Stage 3 build chronology",
    "live-adapter-not-wired",
    "",
  ].join("\n"));

  write(root, "ROADMAP_SUMMARY.html", `${readFileSync(join(root, "ROADMAP_SUMMARY.html"), "utf8")}322 tests\n`);
  const staleHtmlClaim = checkDocsTruth(root);
  assert.equal(staleHtmlClaim.ok, false);
  assert.match(staleHtmlClaim.errors.join("\n"), /stale docs-truth snippet/);
  write(root, "ROADMAP_SUMMARY.html", [
    '<p data-node-test-declarations="2">Stage 3P whole-repo gap closure</p>',
    "Historical build chronology (superseded)",
    "Historical Stage 3 build chronology",
    "live-adapter-not-wired",
    "",
  ].join("\n"));

  write(root, "README.md", [
    "<!-- PRIME-DOCS-TRUTH:BEGIN -->",
    "```json",
    JSON.stringify({ ...facts, node_test_declarations: 1 }, null, 2),
    "```",
    "<!-- PRIME-DOCS-TRUTH:END -->",
    "",
  ].join("\n"));
  const drifted = checkDocsTruth(root);
  assert.equal(drifted.ok, false);
  assert.match(drifted.errors.join("\n"), /PRIME-DOCS-TRUTH drifted/);
});
