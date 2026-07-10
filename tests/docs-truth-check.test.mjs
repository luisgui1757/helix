import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkDocsTruth, collectDocsTruthFacts } from "../tools/ci/docs-truth-check.mjs";

function write(root, rel, text) {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), text);
}

test("docs truth check locks package surface and test count to docs", () => {
  const root = mkdtempSync(join(tmpdir(), "prime-docs-truth-"));
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
  write(root, "ROADMAP.md", "Stage 3P whole-repo gap closure\n");
  write(root, "ROADMAP_SUMMARY.html", "<p>Stage 3P whole-repo gap closure</p>\n");
  write(root, "docs/resources/README.md", "/prime help\n");
  write(root, "docs/manual.md", "/prime help\n");
  write(root, "docs/stage3/design-contracts.md", "Fail closed on structure, YOLO on behavior\n");

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
