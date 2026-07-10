import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PERSISTENCE_CODES,
  appendText,
  installConfinedDirectory,
  reserveConfinedDirectory,
  resolveConfinedDirectory,
  writeTextAtomic,
} from "../dispatch/lib/persistence.mjs";

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "prime-persistence-"));
}

test("atomic writes replace regular files and exclusive writes never clobber", () => {
  const root = tempRoot();
  try {
    const path = writeTextAtomic(root, "nested/state.json", "one\n", { replace: false });
    assert.equal(readFileSync(path, "utf8"), "one\n");
    assert.throws(
      () => writeTextAtomic(root, "nested/state.json", "two\n", { replace: false }),
      (error) => error.code === PERSISTENCE_CODES.EXISTS,
    );
    writeTextAtomic(root, "nested/state.json", "two\n");
    assert.equal(readFileSync(path, "utf8"), "two\n");
    appendText(root, "nested/state.json", "three\n");
    assert.equal(readFileSync(path, "utf8"), "two\nthree\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("atomic and append writers refuse final-path symlinks without touching victims", () => {
  const root = tempRoot();
  try {
    const victim = join(root, "victim.txt");
    writeFileSync(victim, "outside stays unchanged\n", "utf8");
    symlinkSync(victim, join(root, "atomic.json"));
    symlinkSync(victim, join(root, "append.jsonl"));
    for (const operation of [
      () => writeTextAtomic(root, "atomic.json", "overwrite\n"),
      () => appendText(root, "append.jsonl", "append\n"),
    ]) {
      assert.throws(operation, (error) => error.code === PERSISTENCE_CODES.SYMLINK);
      assert.equal(readFileSync(victim, "utf8"), "outside stays unchanged\n");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("writers refuse a symlinked descendant parent", () => {
  const root = tempRoot();
  const outside = tempRoot();
  try {
    symlinkSync(outside, join(root, "nested"));
    assert.throws(
      () => writeTextAtomic(root, "nested/state.json", "escape\n"),
      (error) => error.code === PERSISTENCE_CODES.SYMLINK,
    );
    assert.equal(existsSync(join(outside, "state.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("directory reservation and installation refuse collisions and symlinks", () => {
  const root = tempRoot();
  try {
    const reserved = reserveConfinedDirectory(root, "runs/one");
    assert.equal(existsSync(reserved), true);
    assert.throws(
      () => reserveConfinedDirectory(root, "runs/one"),
      (error) => error.code === PERSISTENCE_CODES.EXISTS,
    );
    mkdirSync(join(root, "outside"));
    symlinkSync(join(root, "outside"), join(root, "runs", "two"));
    assert.throws(
      () => reserveConfinedDirectory(root, "runs/two"),
      (error) => error.code === PERSISTENCE_CODES.SYMLINK,
    );
    const pending = reserveConfinedDirectory(root, "runs/pending");
    writeFileSync(join(pending, "manifest.json"), "bound\n", "utf8");
    const installed = installConfinedDirectory(root, "runs/pending", "runs/final");
    assert.equal(resolveConfinedDirectory(root, "runs/final"), installed);
    assert.equal(readFileSync(join(installed, "manifest.json"), "utf8"), "bound\n");
    assert.throws(
      () => installConfinedDirectory(root, "runs/one", "runs/final"),
      (error) => error.code === PERSISTENCE_CODES.EXISTS,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
