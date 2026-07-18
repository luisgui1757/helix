import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { makePrivateCheckpointEffect, PRIVATE_CHECKPOINT_LIMITS } from "../dispatch/lib/runner.mjs";

function emptyRepo() {
  const cwd = mkdtempSync(join(tmpdir(), "helix-checkpoint-limit-"));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "helix@example.invalid"], { cwd });
  execFileSync("git", ["config", "user.name", "Helix Checkpoint Test"], { cwd });
  execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "baseline"], { cwd });
  return cwd;
}

test("private checkpoint file-size limit accepts exact and refuses one byte over", () => {
  const cwd = emptyRepo();
  try {
    const effect = makePrivateCheckpointEffect(cwd);
    const payload = join(cwd, "payload.bin");
    writeFileSync(payload, "");
    truncateSync(payload, PRIVATE_CHECKPOINT_LIMITS.max_file_bytes);
    const exact = effect.snapshot("file-limit", "exact", cwd);
    assert.equal(exact.ok, true);
    assert.equal(effect.remove("file-limit", "exact").ok, true);
    truncateSync(payload, PRIVATE_CHECKPOINT_LIMITS.max_file_bytes + 1);
    assert.equal(effect.snapshot("file-limit", "over", cwd).ok, false);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("private checkpoint total-size limit accepts exact and refuses one byte over", () => {
  const cwd = emptyRepo();
  try {
    const effect = makePrivateCheckpointEffect(cwd);
    for (let index = 0; index < 4; index += 1) {
      const payload = join(cwd, `payload-${index}.bin`);
      writeFileSync(payload, "");
      truncateSync(payload, PRIVATE_CHECKPOINT_LIMITS.max_file_bytes);
    }
    const exact = effect.snapshot("total-limit", "exact", cwd);
    assert.equal(exact.ok, true);
    assert.equal(effect.remove("total-limit", "exact").ok, true);
    writeFileSync(join(cwd, "over.bin"), "x");
    assert.equal(effect.snapshot("total-limit", "over", cwd).ok, false);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("private checkpoint file-count limit accepts exact and refuses one over", () => {
  const cwd = emptyRepo();
  try {
    const effect = makePrivateCheckpointEffect(cwd);
    const files = join(cwd, "files");
    mkdirSync(files);
    for (let index = 0; index < PRIVATE_CHECKPOINT_LIMITS.max_files; index += 1) {
      writeFileSync(join(files, String(index)), "");
    }
    const exact = effect.snapshot("count-limit", "exact", cwd);
    assert.equal(exact.ok, true);
    assert.equal(effect.remove("count-limit", "exact").ok, true);
    writeFileSync(join(files, "over"), "");
    assert.equal(effect.snapshot("count-limit", "over", cwd).ok, false);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("manual checkpoint limits are generated from the tested runtime constants", () => {
  const manual = readFileSync(new URL("../docs/manual.md", import.meta.url), "utf8");
  assert.match(manual, new RegExp(`${PRIVATE_CHECKPOINT_LIMITS.max_files.toLocaleString("en-US")} regular files`));
  assert.match(manual, new RegExp(`${PRIVATE_CHECKPOINT_LIMITS.max_file_bytes / 1024 / 1024} MiB per`));
  assert.match(manual, new RegExp(`${PRIVATE_CHECKPOINT_LIMITS.max_total_bytes / 1024 / 1024} MiB total`));
});
