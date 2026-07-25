import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { searchFiles } from "../extensions/lib/helix-file-search.mjs";
import {
  FILE_SEARCH_LIMITS,
} from "../extensions/lib/helix-file-search.mjs";

test("structured file search returns bounded literal matches and skips excluded trees", () => {
  const root = mkdtempSync(join(tmpdir(), "helix-search-"));
  try {
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, ".git"));
    writeFileSync(join(root, "src", "a.mjs"), "alpha\nNeedle here\n");
    writeFileSync(join(root, "src", "b.txt"), "needle there\n");
    writeFileSync(join(root, ".git", "secret"), "Needle hidden\n");
    const result = searchFiles({
      root,
      query: "Needle",
      extensions: ["mjs"],
      max_results: 10,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.matches, [{
      path: "src/a.mjs",
      line: 2,
      column: 1,
      preview: "Needle here",
    }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("structured file search refuses traversal and does not follow symlinks", () => {
  const root = mkdtempSync(join(tmpdir(), "helix-search-"));
  const outside = mkdtempSync(join(tmpdir(), "helix-search-outside-"));
  try {
    writeFileSync(join(outside, "secret.txt"), "needle\n");
    symlinkSync(outside, join(root, "escape"));
    assert.equal(searchFiles({ root, query: "needle", path: "../" }).code, "file-search-path-invalid");
    assert.equal(searchFiles({ root, query: "needle", path: "escape" }).code, "file-search-path-invalid");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("structured file search enforces result and input bounds", () => {
  assert.equal(searchFiles({ root: "/", query: "", path: "." }).code, "file-search-input-invalid");
  assert.equal(searchFiles({ root: "/", query: "x", max_results: 201 }).code, "file-search-input-invalid");
});

test("structured file search reports exact case-folded columns, truncation, and skips invalid UTF-8", () => {
  const root = mkdtempSync(join(tmpdir(), "helix-search-"));
  try {
    writeFileSync(join(root, "text.txt"), "xx ÄBC\nÄBC twice ÄBC\n");
    writeFileSync(join(root, "binary.txt"), Buffer.from([0xc3, 0x28, 0x41]));
    const result = searchFiles({
      root,
      query: "äbc",
      case_sensitive: false,
      max_results: 1,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.matches, [{
      path: "text.txt",
      line: 1,
      column: 4,
      preview: "xx ÄBC",
    }]);
    assert.equal(result.truncated, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("structured file search stops at the exact aggregate byte ceiling", () => {
  const root = mkdtempSync(join(tmpdir(), "helix-search-"));
  try {
    const fullFile = Buffer.alloc(FILE_SEARCH_LIMITS.max_file_bytes, 0x78);
    const count = FILE_SEARCH_LIMITS.max_total_bytes / FILE_SEARCH_LIMITS.max_file_bytes;
    for (let index = 0; index < count; index += 1) {
      writeFileSync(join(root, `${String(index).padStart(2, "0")}.txt`), fullFile);
    }
    writeFileSync(join(root, "99.txt"), "needle\n");
    const result = searchFiles({ root, query: "needle", max_results: 10 });
    assert.equal(result.ok, true);
    assert.equal(result.bytes_scanned, FILE_SEARCH_LIMITS.max_total_bytes);
    assert.equal(result.files_scanned, count);
    assert.equal(result.truncated, true);
    assert.deepEqual(result.matches, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
