// Prime dispatch — real working-tree diff surface (Stage 3H boundary effect).
//
// Source of truth: fusion-dispatch-research.md §"Routing Policy" ("Convergence
// means diff stability plus objective-gate pass") and §"Public-Safe Logging".
// Stage 3G's debate loop consumed diff-stability as an INJECTED deterministic
// checker over a mock string; this module supplies the REAL signal from the git
// working tree — a boundary effect exactly like `runGate`.
//
// It computes a STRUCTURAL fingerprint of the current working-tree change against
// a baseline commit using git plumbing/CLI, and never persists raw diff/patch
// text: the returned surface carries only a content hash (`sha256:…`), a resolved
// baseline commit hash, and integer counts. The debate core compares consecutive
// fingerprints; equal ⇒ the proposal stopped changing (diff-stable).
//
// Untracked-file handling + REAL untracked diff stability (YOLO posture,
// owner decision 2026-07-09). Untracked proposal files are part of the diff, so
// their CONTENT is reflected in the fingerprint (a metadata-only signal would
// miss a same-size content edit and falsely report diff-stable — false
// convergence on a moving proposal). Every untracked regular file is
// content-hashed by default — no allowlist. Two exceptions protect RECORDS
// (hashes only ever enter records, but the read itself is bounded):
//   - a symlink is never FOLLOWED (it could point outside the tree — an exfil
//     vector); it enters the fingerprint as a marker + a hash of its own target
//     string, and a non-regular entry (dir/fifo/socket/device) as a marker.
//   - a credential/private-shaped path (`.env*`, `auth.json`, `*.pem`/`*.key`,
//     `id_rsa*`, `*secret*`, `*token*`, …) is never content-read; it enters the
//     fingerprint as a path marker only. Neither case kills the loop.
// Tracked changes (the primary proposal medium) stay content-hashed via `git diff`.
//
// Fail-closed posture applies to STRUCTURE (a crash/refusal is recoverable; a
// silently-wrong "stable" is not — convergence requires BOTH diff-stability AND
// objective-gate-pass to be true):
//   unsafe-path                — cwd is missing/not a dir/has a null byte
//   unsafe-baseline-ref        — baseline ref is not a safe token (arg-injection guard)
//   not-a-git-repo             — cwd is not inside a git work tree
//   missing-baseline           — baseline does not resolve to a commit (unborn HEAD)
//   index-ambiguous            — unmerged/conflict paths cannot be classified
//   git-command-failed         — a git invocation exited non-zero / could not spawn
//   diff-read-failed           — an untracked entry could not be lstat'd/resolved/read
//   unsafe-untracked-path      — an untracked regular file resolves outside the tree
//   diff-nondeterministic      — two back-to-back reads disagreed (unstable input)
//
// Determinism is enforced at the boundary: the structural snapshot is taken TWICE
// and a mismatch fails closed, so the debate's determinism guarantee does not rest
// on the caller. The default git runner also pins a clean, config-independent
// environment (no global/system gitconfig bleed) so the fingerprint depends on the
// tree, not on machine-local diff settings, and never reads a user home config.

import { spawnSync } from "node:child_process";
import { statSync, lstatSync, realpathSync, readFileSync, readlinkSync } from "node:fs";
import { join, sep, basename } from "node:path";
import { createHash } from "node:crypto";
import { devNull } from "node:os";
import { hashRef } from "./run-record.mjs";

/** Stable fail-closed codes (kebab markers, never prose). */
export const DIFF_SURFACE_CODES = Object.freeze({
  UNSAFE_PATH: "unsafe-path",
  UNSAFE_BASELINE_REF: "unsafe-baseline-ref",
  NOT_A_GIT_REPO: "not-a-git-repo",
  MISSING_BASELINE: "missing-baseline",
  INDEX_AMBIGUOUS: "index-ambiguous",
  GIT_COMMAND_FAILED: "git-command-failed",
  READ_FAILED: "diff-read-failed",
  NONDETERMINISTIC: "diff-nondeterministic",
  // A regular file whose realpath escapes the tree is still refused (containment).
  UNSAFE_UNTRACKED_PATH: "unsafe-untracked-path",
});

/** Structural diff-stability codes returned to the debate loop (match DIFF_CODE_PATTERN). */
export const DIFF_STABILITY_CODES = Object.freeze({
  STABLE: "diff-stable",
  CHANGING: "diff-changing",
  BASELINE: "diff-baseline",
});

/**
 * A conservative baseline-ref token: starts alnum, then a bounded git-ref
 * vocabulary. `git` is invoked argv-style (no shell), so this is defence in depth
 * against an argument that starts with `-` (option injection) or carries
 * whitespace/control characters.
 */
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._/@^{}~-]*$/;

/** Porcelain XY codes that mark an unmerged/conflict entry (ambiguous state). */
const UNMERGED_XY = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

/**
 * Credential/private-shaped untracked paths that must NEVER be content-read, even if
 * a caller allowlists them (the denylist wins). Matched against the basename and the
 * full repo-relative path, case-insensitively. Conservative and non-exhaustive by
 * design — it is a defence-in-depth backstop over the fail-closed default, not the
 * primary guard (untracked content is refused by default; the allowlist is opt-in).
 */
const SENSITIVE_PATHS = new Set([
  ".docker/config.json",
  ".kube/config",
]);
const SENSITIVE_BASENAME = /^(\.env(\..*)?|auth\.json|\.npmrc|\.netrc|\.pgpass|\.pypirc|\.htpasswd|\.git-credentials|service-account\.json|id_(rsa|dsa|ecdsa|ed25519)(_sk)?(\.pub)?)$/i;
const SENSITIVE_EXT = /\.(pem|key|p12|pfx|keystore|jks|asc|gpg|ppk)$/i;
const SENSITIVE_SUBSTR = /(secret|token|credential|password|passwd|apikey|api[-_]key|private[-_]key)/i;

/** Whether an untracked repo-relative path is credential/private-shaped. */
export function isSensitiveUntrackedPath(rel) {
  const normalized = rel.replaceAll("\\", "/").toLowerCase();
  const base = basename(rel);
  return SENSITIVE_PATHS.has(normalized) || SENSITIVE_BASENAME.test(base) || SENSITIVE_EXT.test(base) || SENSITIVE_SUBSTR.test(rel);
}

const GIT_REPO_TARGETING_ENV = Object.freeze([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
  "GIT_CEILING_DIRECTORIES",
]);

function gitEnv() {
  const env = { ...process.env };
  for (const key of GIT_REPO_TARGETING_ENV) delete env[key];
  return {
    ...env,
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_SYSTEM: devNull,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
    TZ: "UTC",
  };
}

/**
 * Default git runner: a process-boundary effect returning `{status, stdout,
 * stderr}` and NEVER throwing on a non-zero exit (only a spawn failure yields a
 * null status). Pins a clean environment so the diff is deterministic and
 * config-independent, and so no global/system gitconfig (identity, home paths,
 * external diff drivers) can bleed into the structural fingerprint.
 * @param {string[]} args
 * @param {{cwd:string}} opts
 */
export function defaultGitRun(args, { cwd }) {
  const res = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: gitEnv(),
  });
  if (res.error) return { status: null, stdout: "", stderr: String(res.error.message ?? res.error) };
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/** Parse `git status --porcelain=v1 -z`: collect untracked paths, flag unmerged. */
function parsePorcelainZ(out) {
  const tokens = out.split("\0");
  const untracked = [];
  let unmerged = false;
  for (let i = 0; i < tokens.length; i++) {
    const rec = tokens[i];
    if (rec.length < 3) continue; // "" trailer, or malformed short entry
    const xy = rec.slice(0, 2);
    const path = rec.slice(3); // skip "XY "
    if (xy === "??") { untracked.push(path); continue; }
    if (UNMERGED_XY.has(xy) || xy[0] === "U" || xy[1] === "U") unmerged = true;
    // Rename/copy entries carry an extra NUL-separated original path — consume it
    // so the XY parsing of following entries stays aligned.
    if (xy[0] === "R" || xy[0] === "C") i++;
  }
  return { untracked, unmerged };
}

/** Parse `git diff --numstat` into rolled-up counts (binary lines count as files, 0/0). */
function parseNumstat(out) {
  let files = 0, insertions = 0, deletions = 0;
  for (const line of out.split("\n")) {
    if (line.length === 0) continue;
    files += 1;
    const tab = line.indexOf("\t");
    const tab2 = line.indexOf("\t", tab + 1);
    if (tab === -1 || tab2 === -1) continue;
    const ins = line.slice(0, tab);
    const del = line.slice(tab + 1, tab2);
    if (ins !== "-") insertions += Number(ins) || 0;
    if (del !== "-") deletions += Number(del) || 0;
  }
  return { files, insertions, deletions };
}

/** Run a git command that must succeed; throw the fail-closed code otherwise. */
function gitOk(run, args, cwd) {
  const res = run(args, { cwd });
  if (res.status !== 0) throw DIFF_SURFACE_CODES.GIT_COMMAND_FAILED;
  return res.stdout;
}

/**
 * One structural snapshot of the working tree vs a resolved baseline commit.
 * Throws a fail-closed code string on any git/read failure or an ambiguous index.
 * Returns `{ fingerprint, changed_files, insertions, deletions, untracked_files }`.
 * The fingerprint is a content hash of the tracked patch plus per-untracked-file
 * STRUCTURAL METADATA — the raw patch is hashed here and never returned, and
 * untracked content is never read (see the module header).
 *
 * @param {string} realCwd the canonical (realpath) work-tree root, used to prove an
 *   untracked regular file resolves inside the tree before it is read.
 */
function snapshot(run, cwd, baselineRef, realCwd) {
  const statusOut = gitOk(run, ["status", "--porcelain=v1", "-z", "-uall"], cwd);
  const { untracked, unmerged } = parsePorcelainZ(statusOut);
  if (unmerged) throw DIFF_SURFACE_CODES.INDEX_AMBIGUOUS;

  const numstatOut = gitOk(run, ["diff", "--numstat", "--no-color", "--no-ext-diff", baselineRef, "--"], cwd);
  const counts = parseNumstat(numstatOut);

  // Full tracked patch — hashed, never stored/returned.
  const patch = gitOk(run, ["diff", "--no-color", "--no-ext-diff", "--no-textconv", baselineRef, "--"], cwd);

  // Untracked proposal files are part of the diff, so their CONTENT is hashed to
  // give a real diff-stability signal — every in-tree regular file, no allowlist
  // (YOLO posture). Symlinks are never followed (their target STRING is hashed),
  // non-regular entries and credential-shaped paths become structural markers —
  // none of them kills the loop. Sorted for order-independence; raw bytes are
  // hashed here and never returned/persisted.
  const untrackedDoc = [];
  for (const rel of [...untracked].sort()) {
    // git emits repo-relative, non-traversing paths; reject anything else defensively.
    if (rel.length === 0 || rel.includes("..")) throw DIFF_SURFACE_CODES.UNSAFE_UNTRACKED_PATH;
    const full = join(cwd, rel);
    let st;
    try {
      st = lstatSync(full); // lstat: never dereferences the final component
    } catch {
      throw DIFF_SURFACE_CODES.READ_FAILED;
    }
    // A symlink could point outside the tree; hash its TARGET STRING, never follow it.
    if (st.isSymbolicLink()) {
      let target;
      try {
        target = readlinkSync(full);
      } catch {
        throw DIFF_SURFACE_CODES.READ_FAILED;
      }
      untrackedDoc.push(`${rel}:symlink:` + createHash("sha256").update(target, "utf8").digest("hex"));
      continue;
    }
    // Dir/fifo/socket/device are not file content; a structural marker suffices.
    if (!st.isFile()) {
      untrackedDoc.push(`${rel}:nonfile`);
      continue;
    }
    // Credential/private-shaped files are never content-read (records safety);
    // their presence still enters the fingerprint as a path marker.
    if (isSensitiveUntrackedPath(rel)) {
      untrackedDoc.push(`${rel}:sensitive-skipped`);
      continue;
    }
    // Belt-and-suspenders: a regular file reached through a symlinked PARENT could
    // still resolve outside the tree. realpath resolves parent symlinks; require
    // containment before its content is read.
    let real;
    try {
      real = realpathSync(full);
    } catch {
      throw DIFF_SURFACE_CODES.READ_FAILED;
    }
    if (real !== realCwd && !real.startsWith(realCwd + sep)) throw DIFF_SURFACE_CODES.UNSAFE_UNTRACKED_PATH;
    let bytes;
    try {
      bytes = readFileSync(real);
    } catch {
      throw DIFF_SURFACE_CODES.READ_FAILED;
    }
    untrackedDoc.push(`${rel}:` + createHash("sha256").update(bytes).digest("hex"));
  }

  const canonical = patch + "\0untracked\0" + untrackedDoc.join("\n");
  return {
    fingerprint: hashRef(canonical),
    changed_files: counts.files,
    insertions: counts.insertions,
    deletions: counts.deletions,
    untracked_files: untracked.length,
  };
}

/**
 * Compute a public-safe structural fingerprint of the current working-tree diff
 * against `baseline` (default `HEAD`). Pure w.r.t. the tree (read-only); returns a
 * structured result and never throws.
 *
 * @param {object} [opts]
 * @param {string} opts.cwd absolute path to the target git work tree
 * @param {string} [opts.baseline="HEAD"] baseline ref (validated against SAFE_REF)
 * @param {(args:string[], o:{cwd:string}) => {status:number|null, stdout:string, stderr:string}} [opts.run]
 *   process-boundary git runner (injected for tests; defaults to `defaultGitRun`)
 * @returns {{ ok:true, fingerprint:string, baseline_ref:string, changed_files:number,
 *             insertions:number, deletions:number, untracked_files:number }
 *          | { ok:false, code:string, detail?:string }}
 */
export function computeDiffFingerprint(opts = {}) {
  const { cwd, baseline = "HEAD", run = defaultGitRun } = opts;

  // --- bound external input at the boundary ---------------------------------
  if (typeof cwd !== "string" || cwd.length === 0 || cwd.includes("\0")) {
    return { ok: false, code: DIFF_SURFACE_CODES.UNSAFE_PATH, detail: "cwd must be a non-empty path without a null byte" };
  }
  let realCwd;
  try {
    if (!statSync(cwd).isDirectory()) {
      return { ok: false, code: DIFF_SURFACE_CODES.UNSAFE_PATH, detail: "cwd is not a directory" };
    }
    // Canonical work-tree root used for untracked-path containment checks.
    realCwd = realpathSync(cwd);
  } catch {
    return { ok: false, code: DIFF_SURFACE_CODES.UNSAFE_PATH, detail: "cwd does not exist" };
  }
  if (typeof baseline !== "string" || !SAFE_REF.test(baseline)) {
    return { ok: false, code: DIFF_SURFACE_CODES.UNSAFE_BASELINE_REF, detail: "baseline ref is not a safe token" };
  }

  // --- git repo + baseline resolution ---------------------------------------
  const inside = run(["rev-parse", "--is-inside-work-tree"], { cwd });
  if (inside.status !== 0 || inside.stdout.trim() !== "true") {
    return { ok: false, code: DIFF_SURFACE_CODES.NOT_A_GIT_REPO, detail: "cwd is not inside a git work tree" };
  }
  const rev = run(["rev-parse", "--verify", "--quiet", `${baseline}^{commit}`], { cwd });
  if (rev.status !== 0 || rev.stdout.trim().length === 0) {
    return { ok: false, code: DIFF_SURFACE_CODES.MISSING_BASELINE, detail: `baseline '${baseline}' does not resolve to a commit` };
  }
  const baselineRef = rev.stdout.trim();
  if (!/^[0-9a-f]{40,64}$/.test(baselineRef)) {
    return { ok: false, code: DIFF_SURFACE_CODES.GIT_COMMAND_FAILED, detail: "baseline did not resolve to a commit hash" };
  }

  // --- structural snapshot, taken twice for a determinism guard -------------
  let a, b;
  try {
    a = snapshot(run, cwd, baselineRef, realCwd);
    b = snapshot(run, cwd, baselineRef, realCwd);
  } catch (code) {
    return { ok: false, code: typeof code === "string" ? code : DIFF_SURFACE_CODES.GIT_COMMAND_FAILED };
  }
  // Compare the FULL structural snapshot (fingerprint AND counts), not just the
  // fingerprint, so a count-only skew under a racing tree also fails closed.
  const skew = a.fingerprint !== b.fingerprint
    || a.changed_files !== b.changed_files
    || a.insertions !== b.insertions
    || a.deletions !== b.deletions
    || a.untracked_files !== b.untracked_files;
  if (skew) {
    return { ok: false, code: DIFF_SURFACE_CODES.NONDETERMINISTIC, detail: "diff output changed between two reads" };
  }

  return {
    ok: true,
    fingerprint: a.fingerprint,
    baseline_ref: baselineRef,
    changed_files: a.changed_files,
    insertions: a.insertions,
    deletions: a.deletions,
    untracked_files: a.untracked_files,
  };
}

/**
 * Build a `diffStability` boundary effect (the shape `runDebate` injects) backed
 * by the real git working tree. It memoizes the fingerprint per `ctx.run_id` so
 * the debate loop's determinism double-probe (two calls with the same ctx) is
 * idempotent, and compares the current iteration's fingerprint to the one recorded
 * for `ctx.previous_run_id`:
 *   - no comparable previous snapshot  ⇒ `{ stable:false, code:"diff-baseline" }`
 *   - fingerprints equal               ⇒ `{ stable:true,  code:"diff-stable"   }`
 *   - fingerprints differ              ⇒ `{ stable:false, code:"diff-changing" }`
 * A fail-closed fingerprint throws its stable code string, which `runDebate`
 * propagates as the debate's fail-closed code.
 *
 * Create ONE checker per debate run so the per-iteration cache persists across
 * iterations (per-iteration run_ids are distinct, so there is no cross-debate
 * collision).
 *
 * NOTE (footgun): keep the debate's `record_dir` OUTSIDE the baseline's scope (or
 * `.gitignore`d). With the default `HEAD` baseline, per-iteration run records
 * written into the diffed worktree show up as untracked files and are hashed into
 * the fingerprint — the fingerprint then changes every iteration and the debate
 * can never report diff-stable. The repo's own `dispatch/runs/` is already
 * gitignored, which avoids this.
 *
 * @param {object} opts forwarded to `computeDiffFingerprint`
 *   ({ cwd, baseline?, run? })
 * @returns {(prevRecord:object|null, currRecord:object, ctx:object) => {stable:boolean, code:string}}
 */
export function makeGitDiffStability(opts = {}) {
  const cache = new Map(); // run_id -> computeDiffFingerprint result
  return function gitDiffStability(_prevRecord, _currRecord, ctx) {
    const runId = ctx?.run_id;
    if (typeof runId !== "string" || runId.length === 0) throw "diff-checker-invalid";
    if (!cache.has(runId)) cache.set(runId, computeDiffFingerprint(opts));
    const curr = cache.get(runId);
    if (!curr.ok) throw curr.code;

    const prevRunId = ctx?.previous_run_id;
    const prev = typeof prevRunId === "string" && cache.has(prevRunId) ? cache.get(prevRunId) : null;
    if (prev && prev.ok) {
      const stable = prev.fingerprint === curr.fingerprint;
      return { stable, code: stable ? DIFF_STABILITY_CODES.STABLE : DIFF_STABILITY_CODES.CHANGING };
    }
    // Need two observations to prove the proposal stopped changing; the first
    // iteration (or a missing predecessor) is a baseline, never "stable".
    return { stable: false, code: DIFF_STABILITY_CODES.BASELINE };
  };
}
