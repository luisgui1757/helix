// Helix dispatch — root-confined local persistence.
//
// Structural records are public-safe data, but their storage paths are still an
// external boundary: a caller-controlled symlink must never turn a local write
// into an overwrite outside the selected root. All writers use this module so
// containment, parent/final checks, exclusive no-follow temporary creation, and
// post-rename verification have one implementation.

import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const PERSISTENCE_CODES = Object.freeze({
  INVALID_ROOT: "persistence-invalid-root",
  UNSAFE_PATH: "persistence-unsafe-path",
  SYMLINK: "persistence-symlink-refused",
  NOT_REGULAR: "persistence-non-regular-refused",
  EXISTS: "persistence-target-exists",
  WRITE_FAILED: "persistence-write-failed",
});

function persistenceError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function lstatMaybe(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function relativeSegments(relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0
    || relativePath.includes("\0") || isAbsolute(relativePath)) {
    throw persistenceError(PERSISTENCE_CODES.UNSAFE_PATH);
  }
  const segments = relativePath.split(/[\\/]/);
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")
    || segments[0].toLowerCase() === ".git") {
    throw persistenceError(PERSISTENCE_CODES.UNSAFE_PATH);
  }
  return segments;
}

/** The one accepted grammar for caller-authored files inside a Git worktree. */
export function isSafeWorktreeFilePath(relativePath) {
  if (typeof relativePath !== "string" || !/^[A-Za-z0-9._/-]+$/.test(relativePath)) return false;
  try {
    relativeSegments(relativePath);
    return true;
  } catch {
    return false;
  }
}

function contained(root, candidate) {
  const rel = relative(root, candidate);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function ensureRoot(root) {
  if (typeof root !== "string" || root.length === 0) {
    throw persistenceError(PERSISTENCE_CODES.INVALID_ROOT);
  }
  const lexical = resolve(root);
  try {
    mkdirSync(lexical, { recursive: true, mode: 0o700 });
    const stat = lstatSync(lexical);
    if (stat.isSymbolicLink()) throw persistenceError(PERSISTENCE_CODES.SYMLINK);
    if (!stat.isDirectory()) throw persistenceError(PERSISTENCE_CODES.INVALID_ROOT);
    return realpathSync(lexical);
  } catch (error) {
    if (error?.code?.startsWith?.("persistence-")) throw error;
    throw persistenceError(PERSISTENCE_CODES.INVALID_ROOT);
  }
}

function ensureParent(root, segments, { create = true } = {}) {
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    if (!contained(root, current)) throw persistenceError(PERSISTENCE_CODES.UNSAFE_PATH);
    let stat = lstatMaybe(current);
    if (stat === null) {
      if (!create) throw persistenceError(PERSISTENCE_CODES.WRITE_FAILED);
      try {
        mkdirSync(current, { mode: 0o700 });
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
      stat = lstatMaybe(current);
    }
    if (!stat) throw persistenceError(PERSISTENCE_CODES.WRITE_FAILED);
    if (stat.isSymbolicLink()) throw persistenceError(PERSISTENCE_CODES.SYMLINK);
    if (!stat.isDirectory()) throw persistenceError(PERSISTENCE_CODES.NOT_REGULAR);
    if (realpathSync(current) !== current) throw persistenceError(PERSISTENCE_CODES.SYMLINK);
  }
  return current;
}

function prepareTarget(root, relativePath) {
  const rootReal = ensureRoot(root);
  const segments = relativeSegments(relativePath);
  const name = segments.at(-1);
  const parent = ensureParent(rootReal, segments.slice(0, -1));
  const path = join(parent, name);
  if (!contained(rootReal, path)) throw persistenceError(PERSISTENCE_CODES.UNSAFE_PATH);
  return { root: rootReal, parent, path, name };
}

function assertRegularOrAbsent(path, { replace }) {
  const stat = lstatMaybe(path);
  if (!stat) return null;
  if (stat.isSymbolicLink()) throw persistenceError(PERSISTENCE_CODES.SYMLINK);
  if (!stat.isFile()) throw persistenceError(PERSISTENCE_CODES.NOT_REGULAR);
  if (!replace) throw persistenceError(PERSISTENCE_CODES.EXISTS);
  return stat;
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.isFile() && right.isFile();
}

/** Create a descendant directory without following a symlink below `root`. */
export function ensureConfinedDirectory(root, relativePath) {
  const rootReal = ensureRoot(root);
  const segments = relativeSegments(relativePath);
  return ensureParent(rootReal, segments);
}

/** Resolve an existing descendant directory without creating or following it. */
export function resolveConfinedDirectory(root, relativePath) {
  const rootReal = ensureRoot(root);
  const segments = relativeSegments(relativePath);
  return ensureParent(rootReal, segments, { create: false });
}

/** Atomically reserve a new descendant directory; an existing entry never wins. */
export function reserveConfinedDirectory(root, relativePath, { mode = 0o700 } = {}) {
  const rootReal = ensureRoot(root);
  const segments = relativeSegments(relativePath);
  const parent = ensureParent(rootReal, segments.slice(0, -1));
  const path = join(parent, segments.at(-1));
  if (!contained(rootReal, path)) throw persistenceError(PERSISTENCE_CODES.UNSAFE_PATH);
  const existing = lstatMaybe(path);
  if (existing) {
    if (existing.isSymbolicLink()) throw persistenceError(PERSISTENCE_CODES.SYMLINK);
    throw persistenceError(PERSISTENCE_CODES.EXISTS);
  }
  try {
    mkdirSync(path, { mode });
  } catch (error) {
    if (error?.code === "EEXIST") throw persistenceError(PERSISTENCE_CODES.EXISTS);
    throw persistenceError(PERSISTENCE_CODES.WRITE_FAILED);
  }
  const installed = lstatSync(path);
  if (installed.isSymbolicLink() || !installed.isDirectory() || realpathSync(path) !== path) {
    throw persistenceError(PERSISTENCE_CODES.WRITE_FAILED);
  }
  return path;
}

/** Atomically install one reserved descendant directory at an absent sibling path. */
export function installConfinedDirectory(root, sourceRelativePath, targetRelativePath) {
  const rootReal = ensureRoot(root);
  const sourceSegments = relativeSegments(sourceRelativePath);
  const targetSegments = relativeSegments(targetRelativePath);
  const sourceParent = ensureParent(rootReal, sourceSegments.slice(0, -1), { create: false });
  const targetParent = ensureParent(rootReal, targetSegments.slice(0, -1), { create: false });
  if (sourceParent !== targetParent) throw persistenceError(PERSISTENCE_CODES.UNSAFE_PATH);
  const source = join(sourceParent, sourceSegments.at(-1));
  const target = join(targetParent, targetSegments.at(-1));
  const sourceStat = lstatMaybe(source);
  if (!sourceStat || sourceStat.isSymbolicLink() || !sourceStat.isDirectory()
    || realpathSync(source) !== source) throw persistenceError(PERSISTENCE_CODES.NOT_REGULAR);
  if (lstatMaybe(target)) throw persistenceError(PERSISTENCE_CODES.EXISTS);
  try {
    renameSync(source, target);
    const installed = lstatSync(target);
    if (installed.isSymbolicLink() || !installed.isDirectory()
      || installed.dev !== sourceStat.dev || installed.ino !== sourceStat.ino
      || realpathSync(target) !== target) throw persistenceError(PERSISTENCE_CODES.WRITE_FAILED);
    return target;
  } catch (error) {
    if (error?.code?.startsWith?.("persistence-")) throw error;
    if (error?.code === "EEXIST") throw persistenceError(PERSISTENCE_CODES.EXISTS);
    throw persistenceError(PERSISTENCE_CODES.WRITE_FAILED);
  }
}

/**
 * Atomically write one regular file below `root`.
 *
 * `replace:false` uses an atomic hard-link installation so a concurrent writer
 * cannot be overwritten. Replacement uses same-directory rename and verifies
 * that the installed inode is the exclusively-created temporary file.
 */
export function writeTextAtomic(root, relativePath, data, {
  replace = true,
  mode = 0o600,
  require_writable_existing = false,
} = {}) {
  if (typeof data !== "string" && !Buffer.isBuffer(data)) {
    throw persistenceError(PERSISTENCE_CODES.WRITE_FAILED);
  }
  const target = prepareTarget(root, relativePath);
  const initialTarget = assertRegularOrAbsent(target.path, { replace });
  if (require_writable_existing && initialTarget && (initialTarget.mode & 0o200) === 0) {
    throw persistenceError(PERSISTENCE_CODES.WRITE_FAILED);
  }
  const pending = join(target.parent, `.${target.name}.${process.pid}.${randomUUID()}.pending`);
  let fd = null;
  let pendingCreated = false;
  try {
    const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0);
    fd = openSync(pending, flags, mode);
    pendingCreated = true;
    const opened = fstatSync(fd);
    if (!opened.isFile()) throw persistenceError(PERSISTENCE_CODES.NOT_REGULAR);
    writeFileSync(fd, data);
    fsyncSync(fd);
    closeSync(fd);
    fd = null;

    const pendingStat = lstatSync(pending);
    if (pendingStat.isSymbolicLink() || !pendingStat.isFile()) {
      throw persistenceError(PERSISTENCE_CODES.NOT_REGULAR);
    }
    // Recheck the final path immediately before installation. A rename replaces
    // a raced symlink itself rather than following it, but fail closed whenever
    // the symlink is observable.
    const currentTarget = assertRegularOrAbsent(target.path, { replace });
    if (require_writable_existing && currentTarget && (currentTarget.mode & 0o200) === 0) {
      throw persistenceError(PERSISTENCE_CODES.WRITE_FAILED);
    }
    if (replace) {
      renameSync(pending, target.path);
      pendingCreated = false;
    } else {
      linkSync(pending, target.path);
    }
    const installed = lstatSync(target.path);
    if (installed.isSymbolicLink() || !sameFile(pendingStat, installed)) {
      throw persistenceError(PERSISTENCE_CODES.WRITE_FAILED);
    }
    if (!replace) {
      unlinkSync(pending);
      pendingCreated = false;
    }
    return target.path;
  } catch (error) {
    let cleanupFailed = false;
    if (fd !== null) {
      try { closeSync(fd); } catch { cleanupFailed = true; }
    }
    if (pendingCreated) {
      try {
        const stat = lstatMaybe(pending);
        if (stat?.isFile() && !stat.isSymbolicLink()) unlinkSync(pending);
        else if (stat) cleanupFailed = true;
      } catch {
        cleanupFailed = true;
      }
    }
    if (cleanupFailed) throw persistenceError(PERSISTENCE_CODES.WRITE_FAILED);
    if (error?.code?.startsWith?.("persistence-")) throw error;
    if (error?.code === "EEXIST") throw persistenceError(PERSISTENCE_CODES.EXISTS);
    throw persistenceError(PERSISTENCE_CODES.WRITE_FAILED);
  }
}

/** Append to one regular file without following a final-path symlink. */
export function appendText(root, relativePath, data, { mode = 0o600 } = {}) {
  if (typeof data !== "string" && !Buffer.isBuffer(data)) {
    throw persistenceError(PERSISTENCE_CODES.WRITE_FAILED);
  }
  const target = prepareTarget(root, relativePath);
  assertRegularOrAbsent(target.path, { replace: true });
  let fd = null;
  try {
    const flags = constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0);
    fd = openSync(target.path, flags, mode);
    const opened = fstatSync(fd);
    if (!opened.isFile()) throw persistenceError(PERSISTENCE_CODES.NOT_REGULAR);
    writeFileSync(fd, data);
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    const installed = lstatSync(target.path);
    if (installed.isSymbolicLink() || !sameFile(opened, installed)) {
      throw persistenceError(PERSISTENCE_CODES.WRITE_FAILED);
    }
    return target.path;
  } catch (error) {
    let closeFailed = false;
    if (fd !== null) {
      try { closeSync(fd); } catch { closeFailed = true; }
    }
    if (closeFailed) throw persistenceError(PERSISTENCE_CODES.WRITE_FAILED);
    if (error?.code?.startsWith?.("persistence-")) throw error;
    throw persistenceError(PERSISTENCE_CODES.WRITE_FAILED);
  }
}
