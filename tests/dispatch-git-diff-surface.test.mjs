import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, symlinkSync, mkdirSync } from "node:fs";
import { tmpdir, devNull } from "node:os";
import { join } from "node:path";
import {
  computeDiffFingerprint,
  makeGitDiffStability,
  DIFF_SURFACE_CODES,
} from "../dispatch/lib/git-diff-surface.mjs";
import { assertPublicSafe, stableStringify } from "../dispatch/lib/run-record.mjs";

// --- real temp git repos (mock only at the process boundary, per test rules) ----
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_SYSTEM: devNull,
  GIT_AUTHOR_NAME: "prime-test",
  GIT_AUTHOR_EMAIL: "prime@test.invalid",
  GIT_COMMITTER_NAME: "prime-test",
  GIT_COMMITTER_EMAIL: "prime@test.invalid",
  LC_ALL: "C",
  TZ: "UTC",
};

function git(cwd, args) {
  const res = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr || res.stdout}`);
  return res.stdout;
}

/** A temp repo with one committed file `proposal.txt` and a clean tree. */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "prime-diff-"));
  git(dir, ["init", "-q"]);
  writeFileSync(join(dir, "proposal.txt"), "base\n");
  git(dir, ["add", "proposal.txt"]);
  git(dir, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "base"]);
  return dir;
}

/** Mock process-boundary runner: happy prefix (repo + baseline), custom tail. */
function mockRun(tail) {
  return (args) => {
    const a = args.join(" ");
    if (a === "rev-parse --is-inside-work-tree") return { status: 0, stdout: "true\n", stderr: "" };
    if (args[0] === "rev-parse") return { status: 0, stdout: "a".repeat(40) + "\n", stderr: "" };
    return tail(args);
  };
}

/** Mock runner whose `git status` claims the given untracked entries; all else empty. */
function mockStatus(untrackedPaths) {
  return mockRun((args) => {
    if (args[0] === "status") return { status: 0, stdout: untrackedPaths.map((p) => `?? ${p}\0`).join(""), stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  });
}

// ----------------------------------------------------------------------------
// Happy path: deterministic structural fingerprint
// ----------------------------------------------------------------------------

test("a clean working tree yields a deterministic public-safe fingerprint", () => {
  const repo = makeRepo();
  try {
    const a = computeDiffFingerprint({ cwd: repo });
    const b = computeDiffFingerprint({ cwd: repo });
    assert.equal(a.ok, true, JSON.stringify(a));
    assert.match(a.fingerprint, /^sha256:[0-9a-f]{64}$/);
    assert.match(a.baseline_ref, /^[0-9a-f]{40,64}$/);
    assert.equal(a.changed_files, 0);
    assert.equal(a.insertions, 0);
    assert.equal(a.deletions, 0);
    assert.equal(a.untracked_files, 0);
    // Same tree state ⇒ byte-identical fingerprint (deterministic).
    assert.equal(a.fingerprint, b.fingerprint);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("a tracked modification changes the fingerprint and reports counts", () => {
  const repo = makeRepo();
  try {
    const clean = computeDiffFingerprint({ cwd: repo });
    writeFileSync(join(repo, "proposal.txt"), "base\nrevised line\n");
    const changed = computeDiffFingerprint({ cwd: repo });
    assert.equal(changed.ok, true);
    assert.notEqual(changed.fingerprint, clean.fingerprint, "content change ⇒ different fingerprint");
    assert.equal(changed.changed_files, 1);
    assert.ok(changed.insertions >= 1, `insertions ${changed.insertions}`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("repo-targeting git environment variables cannot redirect the diff surface", () => {
  const target = makeRepo();
  const other = makeRepo();
  const previous = {};
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_COMMON_DIR"]) {
    previous[key] = process.env[key];
  }
  try {
    writeFileSync(join(target, "proposal.txt"), "base\ntarget change\n");
    writeFileSync(join(other, "proposal.txt"), "base\nother change\nextra\n");
    process.env.GIT_DIR = join(other, ".git");
    process.env.GIT_WORK_TREE = other;
    process.env.GIT_INDEX_FILE = join(other, ".git", "index");
    process.env.GIT_OBJECT_DIRECTORY = join(other, ".git", "objects");
    process.env.GIT_COMMON_DIR = join(other, ".git");

    const poisoned = computeDiffFingerprint({ cwd: target });
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    const clean = computeDiffFingerprint({ cwd: target });
    assert.equal(poisoned.ok, true, JSON.stringify(poisoned));
    assert.deepEqual(
      { fingerprint: poisoned.fingerprint, changed_files: poisoned.changed_files, insertions: poisoned.insertions, deletions: poisoned.deletions },
      { fingerprint: clean.fingerprint, changed_files: clean.changed_files, insertions: clean.insertions, deletions: clean.deletions },
    );
  } finally {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    rmSync(target, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});

// ----------------------------------------------------------------------------
// Untracked semantics (YOLO posture): content-hashed by default, no allowlist
// ----------------------------------------------------------------------------

test("an untracked regular file is content-hashed by default (no opt-in, no policy)", () => {
  const repo = makeRepo();
  try {
    const clean = computeDiffFingerprint({ cwd: repo });
    assert.equal(clean.ok, true);
    writeFileSync(join(repo, "extra.txt"), "new untracked content\n");
    const added = computeDiffFingerprint({ cwd: repo });
    assert.equal(added.ok, true, JSON.stringify(added));
    assert.notEqual(added.fingerprint, clean.fingerprint, "adding an untracked file changes the fingerprint");
    assert.equal(added.untracked_files, 1);
    assert.equal(added.changed_files, 0, "untracked file is not a tracked change");
    // Its CONTENT drives the fingerprint (real diff stability), not just its presence.
    writeFileSync(join(repo, "extra.txt"), "different untracked content\n");
    const edited = computeDiffFingerprint({ cwd: repo });
    assert.equal(edited.ok, true);
    assert.notEqual(edited.fingerprint, added.fingerprint, "an untracked content edit changes the fingerprint");
    // Removing it restores the clean fingerprint.
    rmSync(join(repo, "extra.txt"));
    assert.equal(computeDiffFingerprint({ cwd: repo }).fingerprint, clean.fingerprint);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("an untracked file detects a SAME-SIZE content change (real diff stability)", () => {
  // The core review-Finding regression: same-size content edits must NOT be invisible.
  const repo = makeRepo();
  try {
    writeFileSync(join(repo, "draft.txt"), "AAAA");
    const fp1 = computeDiffFingerprint({ cwd: repo });
    assert.equal(fp1.ok, true, JSON.stringify(fp1));
    writeFileSync(join(repo, "draft.txt"), "BBBB"); // same size (4), same mode, new content
    const fp2 = computeDiffFingerprint({ cwd: repo });
    assert.equal(fp2.ok, true);
    assert.notEqual(fp1.fingerprint, fp2.fingerprint, "same-size content change must change the fingerprint");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// ----------------------------------------------------------------------------
// Raw diff text never persists
// ----------------------------------------------------------------------------

test("raw diff/patch text never appears in the structural surface", () => {
  const repo = makeRepo();
  const SENTINEL = "SENTINEL-DIFF-BODY-DO-NOT-LEAK-ZZZ";
  try {
    writeFileSync(join(repo, "proposal.txt"), `base\n${SENTINEL}\n`);
    const result = computeDiffFingerprint({ cwd: repo });
    assert.equal(result.ok, true);
    const serialized = stableStringify(result);
    assert.ok(!serialized.includes(SENTINEL), "the raw diff body must not be in the surface");
    // Only hashes + counts + a baseline ref — passes the run-record public-safety scan.
    assert.doesNotThrow(() => assertPublicSafe(result));
    assert.equal(result.changed_files, 1);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// ----------------------------------------------------------------------------
// Fail-closed matrix
// ----------------------------------------------------------------------------

test("a non-git directory fails closed (not-a-git-repo)", () => {
  const dir = mkdtempSync(join(tmpdir(), "prime-nogit-"));
  try {
    const result = computeDiffFingerprint({ cwd: dir });
    assert.equal(result.ok, false);
    assert.equal(result.code, DIFF_SURFACE_CODES.NOT_A_GIT_REPO);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing baseline ref fails closed (missing-baseline)", () => {
  const repo = makeRepo();
  try {
    const result = computeDiffFingerprint({ cwd: repo, baseline: "no.such.ref" });
    assert.equal(result.ok, false);
    assert.equal(result.code, DIFF_SURFACE_CODES.MISSING_BASELINE);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("an unsafe cwd or baseline ref fails closed before touching git", () => {
  const dir = mkdtempSync(join(tmpdir(), "prime-unsafe-"));
  try {
    assert.equal(computeDiffFingerprint({ cwd: "" }).code, DIFF_SURFACE_CODES.UNSAFE_PATH);
    assert.equal(computeDiffFingerprint({ cwd: `${dir}\0evil` }).code, DIFF_SURFACE_CODES.UNSAFE_PATH);
    assert.equal(computeDiffFingerprint({ cwd: join(dir, "does-not-exist") }).code, DIFF_SURFACE_CODES.UNSAFE_PATH);
    // Argument-injection guard: refs starting with '-' or carrying whitespace.
    assert.equal(computeDiffFingerprint({ cwd: dir, baseline: "-rf" }).code, DIFF_SURFACE_CODES.UNSAFE_BASELINE_REF);
    assert.equal(computeDiffFingerprint({ cwd: dir, baseline: "bad ref" }).code, DIFF_SURFACE_CODES.UNSAFE_BASELINE_REF);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a git command failure fails closed (git-command-failed)", () => {
  const dir = mkdtempSync(join(tmpdir(), "prime-gitfail-"));
  try {
    const run = mockRun((args) => {
      if (args[0] === "status") return { status: 0, stdout: "", stderr: "" };
      if (args[0] === "diff") return { status: 1, stdout: "", stderr: "fatal: bad revision" };
      return { status: 0, stdout: "", stderr: "" };
    });
    const result = computeDiffFingerprint({ cwd: dir, run });
    assert.equal(result.ok, false);
    assert.equal(result.code, DIFF_SURFACE_CODES.GIT_COMMAND_FAILED);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unmerged/conflict index fails closed (index-ambiguous)", () => {
  const dir = mkdtempSync(join(tmpdir(), "prime-conflict-"));
  try {
    const run = mockRun((args) => {
      if (args[0] === "status") return { status: 0, stdout: "UU conflict.txt\0", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    });
    const result = computeDiffFingerprint({ cwd: dir, run });
    assert.equal(result.ok, false);
    assert.equal(result.code, DIFF_SURFACE_CODES.INDEX_AMBIGUOUS);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("non-deterministic diff output fails closed (diff-nondeterministic)", () => {
  const dir = mkdtempSync(join(tmpdir(), "prime-nondet-"));
  try {
    let patchCall = 0;
    const run = mockRun((args) => {
      if (args[0] === "status") return { status: 0, stdout: "", stderr: "" };
      if (args[0] === "diff" && args[1] === "--numstat") return { status: 0, stdout: "1\t0\tf.txt\n", stderr: "" };
      if (args[0] === "diff") return { status: 0, stdout: `@@ patch ${patchCall++}\n`, stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    });
    const result = computeDiffFingerprint({ cwd: dir, run });
    assert.equal(result.ok, false);
    assert.equal(result.code, DIFF_SURFACE_CODES.NONDETERMINISTIC);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ----------------------------------------------------------------------------
// makeGitDiffStability: baseline → changing → stable across a revision
// ----------------------------------------------------------------------------

test("makeGitDiffStability reports baseline, then changing, then stable", () => {
  const repo = makeRepo();
  try {
    const check = makeGitDiffStability({ cwd: repo });

    // Iteration 1: no comparable predecessor ⇒ baseline (never stable).
    const r1 = check(null, null, { iteration: 1, run_id: "g-iter1", previous_run_id: null });
    assert.deepEqual(r1, { stable: false, code: "diff-baseline" });

    // A revision changes the proposal ⇒ the next observation is changing.
    writeFileSync(join(repo, "proposal.txt"), "base\nrev-1\n");
    const r2 = check(null, null, { iteration: 2, run_id: "g-iter2", previous_run_id: "g-iter1" });
    assert.deepEqual(r2, { stable: false, code: "diff-changing" });
    // Memoized per run_id ⇒ the debate's double-probe is idempotent.
    const r2again = check(null, null, { iteration: 2, run_id: "g-iter2", previous_run_id: "g-iter1" });
    assert.deepEqual(r2again, r2);

    // No further change ⇒ the proposal stabilized.
    const r3 = check(null, null, { iteration: 3, run_id: "g-iter3", previous_run_id: "g-iter2" });
    assert.deepEqual(r3, { stable: true, code: "diff-stable" });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// ----------------------------------------------------------------------------
// Untracked-entry safety: symlinks are never followed, non-regular entries and
// credential-shaped paths become structural markers, containment still holds
// ----------------------------------------------------------------------------

test("an untracked symlink becomes a target-string marker; its outside target is never read", () => {
  const repo = makeRepo();
  const outside = mkdtempSync(join(tmpdir(), "prime-outside-"));
  const secret = join(outside, "credential.txt");
  try {
    const clean = computeDiffFingerprint({ cwd: repo });
    writeFileSync(secret, "SUPER-SECRET-TARGET-BYTES-V1\n");
    symlinkSync(secret, join(repo, "link-to-secret")); // untracked symlink -> outside the repo
    const withLink = computeDiffFingerprint({ cwd: repo });
    assert.equal(withLink.ok, true, JSON.stringify(withLink));
    assert.equal(withLink.untracked_files, 1);
    assert.notEqual(withLink.fingerprint, clean.fingerprint, "the symlink's presence changes the fingerprint");
    // Changing ONLY the outside target's CONTENT cannot change the fingerprint —
    // the link is never followed, so the target bytes are never read.
    writeFileSync(secret, "SUPER-SECRET-TARGET-BYTES-V2-DIFFERENT-LENGTH\n");
    const targetChanged = computeDiffFingerprint({ cwd: repo });
    assert.equal(targetChanged.ok, true);
    assert.equal(targetChanged.fingerprint, withLink.fingerprint, "outside target content is invisible (never read)");
    assert.ok(!stableStringify(targetChanged).includes("SUPER-SECRET"), "no target bytes in the surface");
    // Re-pointing the link (a different target STRING) changes the marker hash.
    rmSync(join(repo, "link-to-secret"));
    symlinkSync(join(outside, "elsewhere.txt"), join(repo, "link-to-secret"));
    const repointed = computeDiffFingerprint({ cwd: repo });
    assert.equal(repointed.ok, true);
    assert.notEqual(repointed.fingerprint, withLink.fingerprint, "the target string is part of the marker");
    // With the symlink removed the clean fingerprint returns.
    rmSync(join(repo, "link-to-secret"));
    assert.equal(computeDiffFingerprint({ cwd: repo }).fingerprint, clean.fingerprint);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("an untracked non-regular entry (directory) becomes a structural marker, not a failure", () => {
  const dir = mkdtempSync(join(tmpdir(), "prime-nonfile-"));
  try {
    mkdirSync(join(dir, "a-dir"));
    // git -uall normally lists files, not dirs; drive the branch via a boundary mock
    // that claims a real directory is untracked, and let the real lstat classify it.
    const withDir = computeDiffFingerprint({ cwd: dir, run: mockStatus(["a-dir"]) });
    assert.equal(withDir.ok, true, JSON.stringify(withDir));
    assert.equal(withDir.untracked_files, 1);
    const without = computeDiffFingerprint({ cwd: dir, run: mockStatus([]) });
    assert.notEqual(withDir.fingerprint, without.fingerprint, "the nonfile marker's presence changes the fingerprint");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("credential-shaped untracked files are path markers: present in the fingerprint, never content-read", () => {
  for (const name of ["auth.json", ".env", "id_rsa", "id_ed25519_sk", "id_rsa_sk", "server.pem", "my-secret.txt", ".pypirc", "service-account.json", ".kube/config", ".docker/config.json"]) {
    const repo = makeRepo();
    try {
      const clean = computeDiffFingerprint({ cwd: repo });
      if (name.includes("/")) mkdirSync(join(repo, name.split("/").slice(0, -1).join("/")), { recursive: true });
      writeFileSync(join(repo, name), "PRIVATE-CREDENTIAL-BYTES\n");
      // ADDING a sensitive-shaped file changes the fingerprint (presence is structural).
      const present = computeDiffFingerprint({ cwd: repo });
      assert.equal(present.ok, true, `${name} present`);
      assert.equal(present.untracked_files, 1, name);
      assert.notEqual(present.fingerprint, clean.fingerprint, `${name}: presence must change the fingerprint`);
      // A CONTENT change is invisible — the file is never content-read.
      writeFileSync(join(repo, name), "PRIVATE-CREDENTIAL-BYTES-CHANGED-AND-LONGER\n");
      const contentChanged = computeDiffFingerprint({ cwd: repo });
      assert.equal(contentChanged.ok, true, `${name} content-changed`);
      assert.equal(contentChanged.fingerprint, present.fingerprint, `${name}: content change must NOT change the fingerprint`);
      // No raw content is ever surfaced.
      assert.ok(!stableStringify(contentChanged).includes("PRIVATE-CREDENTIAL-BYTES"), name);
      // REMOVING it restores the clean fingerprint (presence is structural).
      rmSync(join(repo, name));
      assert.equal(computeDiffFingerprint({ cwd: repo }).fingerprint, clean.fingerprint, `${name} removed`);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }
});

test("an untracked regular file whose realpath escapes the tree still fails closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "prime-escape-"));
  const outside = mkdtempSync(join(tmpdir(), "prime-escape-out-"));
  try {
    writeFileSync(join(outside, "evil.txt"), "OUTSIDE-BYTES-NEVER-READ");
    // dir/sub -> outside: a regular file reached through a symlinked PARENT resolves
    // outside the tree. Drive the porcelain via a boundary mock (git would list the
    // symlink itself); the real lstat/realpath containment check must refuse.
    symlinkSync(outside, join(dir, "sub"));
    const result = computeDiffFingerprint({ cwd: dir, run: mockStatus(["sub/evil.txt"]) });
    assert.equal(result.ok, false);
    assert.equal(result.code, DIFF_SURFACE_CODES.UNSAFE_UNTRACKED_PATH);
    assert.ok(!stableStringify(result).includes("OUTSIDE-BYTES"), "the outside file is never read");
    // A traversing untracked path is refused defensively too.
    const traversal = computeDiffFingerprint({ cwd: dir, run: mockStatus(["../evil.txt"]) });
    assert.equal(traversal.ok, false);
    assert.equal(traversal.code, DIFF_SURFACE_CODES.UNSAFE_UNTRACKED_PATH);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("an unreadable untracked entry fails closed (diff-read-failed)", () => {
  const dir = mkdtempSync(join(tmpdir(), "prime-readfail-"));
  try {
    // The porcelain claims an entry that does not exist on disk ⇒ lstat fails.
    const result = computeDiffFingerprint({ cwd: dir, run: mockStatus(["ghost.txt"]) });
    assert.equal(result.ok, false);
    assert.equal(result.code, DIFF_SURFACE_CODES.READ_FAILED);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a staged rename does not misalign untracked-file detection (porcelain parsing)", () => {
  // A rename entry carries an extra NUL-separated original path; the parser must
  // consume it so a following untracked file stays correctly classified (not folded
  // into the rename). Assert the untracked count is exactly the real untracked file.
  const repo = makeRepo();
  try {
    git(repo, ["mv", "proposal.txt", "renamed.txt"]); // staged rename
    writeFileSync(join(repo, "z-untracked.txt"), "brand new\n");
    const result = computeDiffFingerprint({ cwd: repo });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.untracked_files, 1, "the untracked file after a rename is counted once, not swallowed");
    assert.ok(result.changed_files >= 1, "the rename is a tracked change");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("makeGitDiffStability throws the fail-closed code outside a git repo", () => {
  const dir = mkdtempSync(join(tmpdir(), "prime-nogit2-"));
  try {
    const check = makeGitDiffStability({ cwd: dir });
    assert.throws(
      () => check(null, null, { iteration: 1, run_id: "x-iter1", previous_run_id: null }),
      (err) => err === DIFF_SURFACE_CODES.NOT_A_GIT_REPO,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
