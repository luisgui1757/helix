// Helix dispatch — the staged runner.
//
// Executes a run config end to end: resolve chain + cast → per-run worktree →
// stage machine over REAL per-stage dispatch cycles → objective gate concludes.
// Emits the structural event stream every renderer consumes, and persists an
// interrupt-safe machine state after every pass so a killed run resumes from
// its last completed pass (`/helix-run-resume`). Resuming a completed run
// is a recorded no-op.
//
// Stage execution: each pass of a stage is ONE runDispatch cycle over the
// stage's cast (a composite's members form the panel, with the preset's judge/
// synthesizer wired when the panel has more than one member; a plain model is
// a panel of one). The stage VERDICT comes from the verdict role's envelopes
// with a deterministic strictest-wins rule across multiple reviewers:
// any revise-jump > any revise > unanimous approve. Models route; only the
// machine-level objective gate concludes.
//
// Worktree policy (toggles.worktree, default ON): mutations happen in a
// per-run worktree created by the injected worktree effect; OFF runs directly
// in the caller's working tree (recorded as a warning — the owner's YOLO
// choice, not an error). `makeGitWorktreeEffect` is the real git effect.

import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { validateRunConfig } from "./run-configs.mjs";
import { resolveChain } from "./chains.mjs";
import { objectiveGateSummary, workflowVerdictRole } from "./workflows.mjs";
import { resolveChainCast } from "./presets.mjs";
import { runStagedChain, STAGE_VERDICTS, validateMachineResume } from "./stage-machine.mjs";
import { runDispatch } from "./orchestrate.mjs";
import { makeObjectiveGate } from "./task-loop.mjs";
import { makeModelRevision } from "./revision-effect.mjs";
import {
  makeEventLog,
  validateCheckpointEventBinding,
  validateEvent,
  validateEventHistory as validateStructuralEventHistory,
} from "./events.mjs";
import { isRoleValidForStage } from "./role-envelope.mjs";
import { hashRef, assertPublicSafe, stableStringify } from "./run-record.mjs";
import { compileStepPrompt } from "./prompt-compiler.mjs";
import { stageStepSchedule } from "./stage-schedule.mjs";
import {
  buildHandoffPacket,
  buildTranscriptHandoff,
  packetRecord,
  extractDisagreements,
  makeDisagreementLog,
  validateDisagreementDocument,
} from "./handoff.mjs";
import { fileURLToPath } from "node:url";
import { MAX_ITERATIONS, MAX_PANEL_MEMBERS } from "./limits.mjs";
import { HELIX_TOGGLES } from "./settings.mjs";
import { isHelixProvider } from "./providers.mjs";
import { ROLES } from "./role-envelope.mjs";
import { EFFORTS } from "./routes.mjs";
import { isExecutorRef, isModelId, isPublicCode } from "./public-values.mjs";
import {
  ensureConfinedDirectory,
  installConfinedDirectory,
  reserveConfinedDirectory,
  resolveConfinedDirectory,
  writeTextAtomic,
} from "./persistence.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export const RUNNER_CODES = Object.freeze({
  INVALID_CONFIG: "invalid-run-config",
  MISSING_CLOCK: "missing-clock",
  MISSING_WORKTREE_EFFECT: "missing-worktree-effect",
  WORKTREE_FAILED: "worktree-create-failed",
  WORKTREE_COLLISION: "worktree-run-id-collision",
  RUN_STATE_COLLISION: "run-state-collision",
  ALREADY_COMPLETED: "run-already-completed",
  INVALID_STATE: "invalid-resume-state",
  STATE_CONFIG_MISMATCH: "resume-config-mismatch",
  WORKTREE_MISSING_FOR_RESUME: "resume-worktree-missing",
  WORKTREE_INVALID_FOR_RESUME: "resume-worktree-invalid",
  REPOSITORY_INVALID: "run-repository-invalid",
  STATE_EXECUTION_MISMATCH: "resume-execution-mismatch",
  STATE_REPOSITORY_MISMATCH: "resume-repository-mismatch",
  RESUME_EVENTS_INVALID: "resume-events-invalid",
  RESUME_DISAGREEMENTS_INVALID: "resume-disagreements-invalid",
  RESUME_HANDOFF_INVALID: "resume-handoff-invalid",
  MISSING_STEP_EFFECT: "missing-chain-step-effect",
  STAGE_ARTIFACT_INVALID: "stage-artifact-invalid",
  PANEL_CAP_EXCEEDED: "stage-panel-cap-exceeded",
  STAGE_DISPATCH_FAILED: "stage-dispatch-failed",
  LIVE_ADAPTER_NOT_WIRED: "live-adapter-not-wired",
  RESUME_IN_PROGRESS: "resume-in-progress",
  RUN_IN_PROGRESS: "run-in-progress",
  RESUME_STATE_STALE: "resume-state-stale",
  CHECKPOINT_FAILED: "private-checkpoint-failed",
  CHECKPOINT_INVALID: "private-checkpoint-invalid",
});

export const RUNNER_STATE_SCHEMA_VERSION = 3;

const STEP_EFFECT_FAILURE_CODES = Object.freeze({
  "local-check": "local-check-failed",
  handoff: "handoff-failed",
});
const WORKTREE_MUTATING_ROLES = new Set(["planner", "builder", "documenter"]);

function raceRunBoundary(factory, signal) {
  if (!signal) return Promise.resolve().then(factory);
  if (signal.aborted) return Promise.reject(new Error("workflow-run-aborted"));
  return new Promise((resolvePromise, rejectPromise) => {
    const onAbort = () => rejectPromise(new Error("workflow-run-aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve().then(factory).then(resolvePromise, rejectPromise).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

function validateResolvedCast(cast) {
  if (!Array.isArray(cast) || cast.length === 0) return false;
  const stageIds = new Set();
  const validMember = (member, panel = false) => {
    const keys = member && typeof member === "object" && !Array.isArray(member) ? Object.keys(member) : [];
    if (keys.length !== 4 || !["provider", "model", "effort", "instances"].every((key) => keys.includes(key))) return false;
    if (!isHelixProvider(member.provider) || !isModelId(member.model)
      || !EFFORTS.includes(member.effort) || !Number.isSafeInteger(member.instances)
      || member.instances < 1 || (panel && member.instances !== 1)) return false;
    return member.instances <= MAX_PANEL_MEMBERS;
  };
  for (const stage of cast) {
    const keys = stage && typeof stage === "object" && !Array.isArray(stage) ? Object.keys(stage) : [];
    if (keys.some((key) => !["stage_id", "executor_ref", "roles", "panel_roles"].includes(key))
      || !isPublicCode(stage.stage_id) || stageIds.has(stage.stage_id)
      || !isExecutorRef(stage.executor_ref)
      || !stage.roles || typeof stage.roles !== "object" || Array.isArray(stage.roles)
      || !stage.panel_roles || typeof stage.panel_roles !== "object" || Array.isArray(stage.panel_roles)) return false;
    stageIds.add(stage.stage_id);
    let stageMembers = 0;
    for (const [role, members] of Object.entries(stage.roles)) {
      if (!ROLES.includes(role) || !Array.isArray(members) || members.length === 0
        || !members.every((member) => validMember(member))) return false;
      stageMembers += members.reduce((sum, member) => sum + member.instances, 0);
      if (!Number.isSafeInteger(stageMembers) || stageMembers > MAX_PANEL_MEMBERS) return false;
    }
    for (const [role, member] of Object.entries(stage.panel_roles)) {
      if (!["judge", "synthesizer"].includes(role) || !validMember(member, true)) return false;
    }
  }
  return true;
}

function configSemantics(config) {
  const { assignments: _assignments, default_assignment: _defaultAssignment, ...semantics } = config;
  return semantics;
}

function promptResourcesRef(cast, templatesDir, briefsDir, templateId) {
  try {
    const template = readFileSync(join(templatesDir, `${templateId}.md`), "utf8");
    const roles = [...new Set(cast.flatMap((stage) => Object.keys(stage.roles)))].sort();
    const briefs = Object.fromEntries(roles.map((role) => [role, hashRef(readFileSync(join(briefsDir, `${role}.md`), "utf8"))]));
    return hashRef(stableStringify({ template_id: templateId, template_ref: hashRef(template), briefs }));
  } catch {
    return null;
  }
}

function gitResult(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0 || typeof result.stdout !== "string" || result.stdout.trim() === "") return null;
  return result.stdout.trim();
}

/** Private paths never leave this helper; persisted identity is hashes only. */
function gitIdentity(cwd) {
  if (typeof cwd !== "string") return null;
  try {
    const topText = gitResult(cwd, ["rev-parse", "--show-toplevel"]);
    const commonText = gitResult(cwd, ["rev-parse", "--git-common-dir"]);
    if (!topText || !commonText) return null;
    const top = realpathSync(topText);
    const common = realpathSync(resolve(cwd, commonText));
    return {
      top,
      common,
      repository_ref: hashRef(common),
      checkout_ref: hashRef(top),
    };
  } catch {
    return null;
  }
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function acquireResumeLease(cwd, runId) {
  const identity = gitIdentity(cwd);
  if (!identity) return { ok: false, code: RUNNER_CODES.REPOSITORY_INVALID };
  let dir;
  try {
    dir = ensureConfinedDirectory(identity.common, join("helix", "leases"));
  } catch {
    return { ok: false, code: RUNNER_CODES.RESUME_IN_PROGRESS };
  }
  const name = `${hashRef(`${identity.repository_ref}:${runId}`).slice("sha256:".length)}.lock`;
  const path = join(dir, name);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(path,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
      if (!fstatSync(fd).isFile()) {
        closeSync(fd);
        return { ok: false, code: RUNNER_CODES.RESUME_IN_PROGRESS };
      }
      writeFileSync(fd, `${process.pid}\n`, "utf8");
      fsyncSync(fd);
      return { ok: true, fd, path };
    } catch (error) {
      if (error?.code !== "EEXIST") return { ok: false, code: RUNNER_CODES.RESUME_IN_PROGRESS };
      try {
        const owner = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
        if (processIsAlive(owner)) return { ok: false, code: RUNNER_CODES.RESUME_IN_PROGRESS };
        unlinkSync(path);
      } catch {
        return { ok: false, code: RUNNER_CODES.RESUME_IN_PROGRESS };
      }
    }
  }
  return { ok: false, code: RUNNER_CODES.RESUME_IN_PROGRESS };
}

function releaseResumeLease(lease) {
  if (!lease?.ok) return false;
  let valid = true;
  try { closeSync(lease.fd); } catch { valid = false; }
  try { unlinkSync(lease.path); } catch { valid = false; }
  return valid;
}

function hashBytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function gitCheckpointState(cwd, backupDir = null) {
  const run = (args) => spawnSync("git", args, { cwd, encoding: "utf8" });
  const head = run(["rev-parse", "--verify", "HEAD"]);
  const gitDirResult = run(["rev-parse", "--git-dir"]);
  const indexResult = run(["rev-parse", "--git-path", "index"]);
  if (head.status !== 0 || gitDirResult.status !== 0 || indexResult.status !== 0) {
    throw new Error("private-checkpoint-git-state-invalid");
  }
  const headOid = head.stdout.trim();
  if (!/^[0-9a-f]{40,64}$/.test(headOid)) throw new Error("private-checkpoint-head-invalid");
  const symbolicResult = run(["symbolic-ref", "-q", "HEAD"]);
  const symbolicHead = symbolicResult.status === 0 ? symbolicResult.stdout.trim() : null;
  if (symbolicHead !== null && !/^refs\/[A-Za-z0-9._/-]+$/.test(symbolicHead)) {
    throw new Error("private-checkpoint-symbolic-head-invalid");
  }
  const gitDir = resolve(cwd, gitDirResult.stdout.trim());
  const indexPath = resolve(cwd, indexResult.stdout.trim());
  const indexExists = existsSync(indexPath);
  const indexRef = indexExists ? hashBytes(readFileSync(indexPath)) : null;
  if (backupDir) {
    const backupStat = lstatSync(backupDir);
    if (backupStat.isSymbolicLink() || !backupStat.isDirectory() || realpathSync(backupDir) !== backupDir) {
      throw new Error("private-checkpoint-backup-dir-invalid");
    }
    if (indexExists) writeTextAtomic(backupDir, "index", readFileSync(indexPath), { replace: false });
  }
  return {
    gitdir_ref: hashRef(realpathSync(gitDir)),
    head_oid: headOid,
    symbolic_head: symbolicHead,
    index_ref: indexRef,
  };
}

function restoreGitCheckpointState(cwd, backupDir, expected) {
  const current = gitCheckpointState(cwd);
  if (current.gitdir_ref !== expected.gitdir_ref) throw new Error("private-checkpoint-gitdir-mismatch");
  const git = (args) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (result.status !== 0) throw new Error("private-checkpoint-git-restore-failed");
  };
  if (expected.symbolic_head) {
    const branch = spawnSync("git", ["rev-parse", "--verify", expected.symbolic_head], { cwd, encoding: "utf8" });
    const currentBranchOid = branch.status === 0 ? branch.stdout.trim() : null;
    if (currentBranchOid !== expected.head_oid) {
      const args = ["update-ref", expected.symbolic_head, expected.head_oid];
      if (currentBranchOid) args.push(currentBranchOid);
      git(args);
    }
    git(["symbolic-ref", "HEAD", expected.symbolic_head]);
  }
  else git(["update-ref", "--no-deref", "HEAD", expected.head_oid]);
  const indexResult = spawnSync("git", ["rev-parse", "--git-path", "index"], { cwd, encoding: "utf8" });
  if (indexResult.status !== 0) throw new Error("private-checkpoint-index-path-invalid");
  const indexPath = resolve(cwd, indexResult.stdout.trim());
  if (expected.index_ref) {
    const source = join(backupDir, "index");
    if (!existsSync(source) || hashBytes(readFileSync(source)) !== expected.index_ref) {
      throw new Error("private-checkpoint-index-invalid");
    }
    writeTextAtomic(dirname(indexPath), basename(indexPath), readFileSync(source));
  } else {
    rmSync(indexPath, { force: true });
  }
  if (stableStringify(gitCheckpointState(cwd)) !== stableStringify(expected)) {
    throw new Error("private-checkpoint-git-restore-mismatch");
  }
}

function checkpointExclusions(root, paths = []) {
  const rootPath = resolve(root);
  return [...new Set(paths.flatMap((path) => {
    if (typeof path !== "string") return [];
    const absolute = resolve(path);
    const rel = relative(rootPath, absolute);
    if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`)) return [];
    return [rel.split(sep).join("/")];
  }))].sort();
}

function scanCheckout(root, copyRoot = null, excludedPaths = []) {
  const entries = [];
  const exclusions = checkpointExclusions(root, excludedPaths);
  const hardlinks = new Map();
  const copiedHardlinks = new Map();
  let nextHardlink = 1;
  const walk = (dir, prefix) => {
    const names = readdirSync(dir).sort();
    for (const name of names) {
      if (name === ".git") {
        if (prefix === "") continue;
      }
      const source = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (exclusions.some((excluded) => rel === excluded || rel.startsWith(`${excluded}/`))) continue;
      const stat = lstatSync(source);
      const mode = stat.mode & 0o7777;
      const destination = copyRoot ? join(copyRoot, ...rel.split("/")) : null;
      if (stat.isDirectory()) {
        entries.push({ path: rel, type: "directory", mode });
        if (destination) mkdirSync(destination, { recursive: false, mode });
        walk(source, rel);
        if (destination) chmodSync(destination, mode);
        continue;
      }
      if (stat.isSymbolicLink()) {
        const target = readlinkSync(source);
        entries.push({ path: rel, type: "symlink", mode, target_ref: hashRef(target) });
        if (destination) symlinkSync(target, destination);
        continue;
      }
      if (!stat.isFile()) throw new Error("private-checkpoint-special-file-unsupported");
      let linkGroup;
      if (stat.nlink > 1) {
        const inode = `${stat.dev}:${stat.ino}`;
        linkGroup = hardlinks.get(inode);
        if (!linkGroup) {
          linkGroup = `h${nextHardlink++}`;
          hardlinks.set(inode, linkGroup);
        }
      }
      const content = readFileSync(source);
      entries.push({
        path: rel,
        type: "file",
        mode,
        size: stat.size,
        content_ref: hashBytes(content),
        ...(linkGroup ? { link_group: linkGroup } : {}),
      });
      if (destination) {
        const prior = linkGroup ? copiedHardlinks.get(linkGroup) : null;
        if (prior) linkSync(prior, destination);
        else {
          copyFileSync(source, destination);
          if (linkGroup) copiedHardlinks.set(linkGroup, destination);
        }
        chmodSync(destination, mode);
      }
    }
  };
  walk(root, "");
  return {
    schema_version: 1,
    exclusions: exclusions.map((path) => hashRef(path)),
    entries,
  };
}

function restoreCheckout(root, backupRoot, manifest, excludedPaths) {
  const exclusions = checkpointExclusions(root, excludedPaths);
  if (stableStringify(exclusions.map((path) => hashRef(path))) !== stableStringify(manifest.exclusions)) {
    throw new Error("private-checkpoint-exclusions-mismatch");
  }
  const desired = new Map(manifest.entries.map((entry) => [entry.path, entry]));
  const preserve = (rel) => exclusions.some((excluded) =>
    rel === excluded || rel.startsWith(`${excluded}/`) || excluded.startsWith(`${rel}/`));
  const clear = (dir, prefix) => {
    for (const name of readdirSync(dir)) {
      if (prefix === "" && name === ".git") continue;
      const rel = prefix ? `${prefix}/${name}` : name;
      if (exclusions.some((excluded) => rel === excluded || rel.startsWith(`${excluded}/`))) continue;
      const path = join(dir, name);
      const wanted = desired.get(rel);
      if (!wanted) {
        if (lstatSync(path).isDirectory() && preserve(rel)) clear(path, rel);
        else rmSync(path, { recursive: true, force: true });
      } else if (wanted.type === "directory" && lstatSync(path).isDirectory()) {
        clear(path, rel);
      }
    }
  };
  clear(root, "");
  const directories = manifest.entries.filter((entry) => entry.type === "directory")
    .sort((a, b) => a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path));
  for (const entry of directories) {
    const destination = join(root, ...entry.path.split("/"));
    if (existsSync(destination) && !lstatSync(destination).isDirectory()) rmSync(destination, { recursive: true, force: true });
    if (!existsSync(destination)) mkdirSync(destination, { recursive: false, mode: entry.mode });
  }
  const restoredHardlinks = new Map();
  for (const entry of manifest.entries.filter((candidate) => candidate.type !== "directory")) {
    const source = join(backupRoot, ...entry.path.split("/"));
    const destination = join(root, ...entry.path.split("/"));
    if (existsSync(destination) || (() => { try { lstatSync(destination); return true; } catch { return false; } })()) {
      rmSync(destination, { recursive: true, force: true });
    }
    if (entry.type === "symlink") {
      symlinkSync(readlinkSync(source), destination);
    } else {
      const prior = entry.link_group ? restoredHardlinks.get(entry.link_group) : null;
      if (prior) linkSync(prior, destination);
      else {
        copyFileSync(source, destination);
        if (entry.link_group) restoredHardlinks.set(entry.link_group, destination);
      }
      chmodSync(destination, entry.mode);
    }
  }
  for (const entry of [...directories].reverse()) chmodSync(join(root, ...entry.path.split("/")), entry.mode);
  return scanCheckout(root, null, excludedPaths);
}

/**
 * Private, dependency-free pass checkpoint storage. Raw bytes live only below
 * the repository common-dir, never in Git objects or public run records.
 */
export function makePrivateCheckpointEffect(repoRoot) {
  const identity = gitIdentity(repoRoot);
  if (!identity) return null;
  const generationRelative = (runId, generation) => {
    if (typeof runId !== "string" || !/^[A-Za-z0-9._-]+$/.test(runId)
      || runId === "." || runId === ".."
      || typeof generation !== "string" || !/^[A-Za-z0-9._-]+$/.test(generation)
      || generation === "." || generation === "..") return null;
    return join("helix-checkpoints", runId, generation);
  };
  const inspect = (runId, generation, expectedRef = null) => {
    try {
      const relativePath = generationRelative(runId, generation);
      if (!relativePath) return null;
      const path = resolveConfinedDirectory(identity.common, relativePath);
      const manifestPath = join(path, "manifest.json");
      const manifestStat = lstatSync(manifestPath);
      if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) return null;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      const treeRef = hashRef(stableStringify(manifest));
      if (expectedRef && treeRef !== expectedRef) return null;
      const tree = resolveConfinedDirectory(identity.common, join(relativePath, "tree"));
      const gitBackup = resolveConfinedDirectory(identity.common, join(relativePath, "git"));
      const scanned = scanCheckout(tree);
      if (stableStringify(scanned.entries) !== stableStringify(manifest.entries)) return null;
      const backupIndex = join(gitBackup, "index");
      if ((manifest.git?.index_ref === null && existsSync(backupIndex))
        || (typeof manifest.git?.index_ref === "string"
          && (!existsSync(backupIndex) || lstatSync(backupIndex).isSymbolicLink()
            || !lstatSync(backupIndex).isFile()
            || hashBytes(readFileSync(backupIndex)) !== manifest.git.index_ref))) return null;
      return { manifest, tree_ref: treeRef };
    } catch {
      return null;
    }
  };
  return {
    snapshot(runId, generation, cwd, excludedPaths = []) {
      const relativePath = generationRelative(runId, generation);
      if (!relativePath || !gitIdentity(cwd) || gitIdentity(cwd).repository_ref !== identity.repository_ref) {
        return { ok: false, code: RUNNER_CODES.CHECKPOINT_FAILED };
      }
      const runRelative = join("helix-checkpoints", runId);
      const pendingRelative = join(runRelative, `${generation}.${process.pid}.${randomUUID()}.pending`);
      let pending = null;
      try {
        ensureConfinedDirectory(identity.common, runRelative);
        const existing = inspect(runId, generation);
        if (existing) {
          return {
            ok: true,
            generation,
            tree_ref: existing.tree_ref,
            baseline_ref: hashRef(existing.manifest.git.head_oid),
            reused: true,
          };
        }
        try {
          resolveConfinedDirectory(identity.common, relativePath);
          return { ok: false, code: RUNNER_CODES.CHECKPOINT_FAILED };
        } catch {
          // Absent is the only valid state; reservation/installation recheck it.
        }
        pending = reserveConfinedDirectory(identity.common, pendingRelative);
        const tree = ensureConfinedDirectory(identity.common, join(pendingRelative, "tree"));
        const gitBackup = ensureConfinedDirectory(identity.common, join(pendingRelative, "git"));
        const manifest = {
          ...scanCheckout(cwd, tree, excludedPaths),
          git: gitCheckpointState(cwd, gitBackup),
        };
        const rescanned = { ...scanCheckout(cwd, null, excludedPaths), git: gitCheckpointState(cwd) };
        if (stableStringify(rescanned) !== stableStringify(manifest)) {
          throw new Error("private-checkpoint-source-changed");
        }
        writeTextAtomic(identity.common, join(pendingRelative, "manifest.json"),
          `${stableStringify(manifest)}\n`, { replace: false });
        installConfinedDirectory(identity.common, pendingRelative, relativePath);
        pending = null;
        return {
          ok: true,
          generation,
          tree_ref: hashRef(stableStringify(manifest)),
          baseline_ref: hashRef(manifest.git.head_oid),
          reused: false,
        };
      } catch {
        if (pending) {
          try {
            const cleanup = resolveConfinedDirectory(identity.common, pendingRelative);
            rmSync(cleanup, { recursive: true, force: true });
          } catch {
            // Fail closed and leave ambiguous residue for manual inspection.
          }
        }
        return { ok: false, code: RUNNER_CODES.CHECKPOINT_FAILED };
      }
    },
    restore(runId, generation, treeRef, cwd, excludedPaths = []) {
      const relativePath = generationRelative(runId, generation);
      const currentIdentity = gitIdentity(cwd);
      if (!relativePath || !currentIdentity || currentIdentity.repository_ref !== identity.repository_ref) {
        return { ok: false, code: RUNNER_CODES.CHECKPOINT_INVALID };
      }
      const checked = inspect(runId, generation, treeRef);
      if (!checked) return { ok: false, code: RUNNER_CODES.CHECKPOINT_INVALID };
      let path;
      try {
        path = resolveConfinedDirectory(identity.common, relativePath);
      } catch {
        return { ok: false, code: RUNNER_CODES.CHECKPOINT_INVALID };
      }
      try {
        restoreGitCheckpointState(cwd, join(path, "git"), checked.manifest.git);
        const tree = restoreCheckout(cwd, join(path, "tree"), checked.manifest, excludedPaths);
        const restored = { ...tree, git: gitCheckpointState(cwd) };
        if (stableStringify(restored) !== stableStringify(checked.manifest)) {
          throw new Error("private-checkpoint-restore-mismatch");
        }
        return { ok: true, baseline_ref: hashRef(checked.manifest.git.head_oid) };
      } catch {
        return { ok: false, code: RUNNER_CODES.CHECKPOINT_INVALID };
      }
    },
    remove(runId, generation) {
      const relativePath = generationRelative(runId, generation);
      if (!relativePath) return { ok: false, code: RUNNER_CODES.CHECKPOINT_FAILED };
      try {
        const path = resolveConfinedDirectory(identity.common, relativePath);
        rmSync(path, { recursive: true, force: true });
        return { ok: true };
      } catch {
        return { ok: false, code: RUNNER_CODES.CHECKPOINT_FAILED };
      }
    },
    fingerprint(cwd, excludedPaths = []) {
      try {
        const currentIdentity = gitIdentity(cwd);
        if (!currentIdentity || currentIdentity.repository_ref !== identity.repository_ref) {
          return { ok: false, code: RUNNER_CODES.CHECKPOINT_INVALID };
        }
        const manifest = { ...scanCheckout(cwd, null, excludedPaths), git: gitCheckpointState(cwd) };
        return {
          ok: true,
          tree_ref: hashRef(stableStringify(manifest)),
          baseline_ref: hashRef(manifest.git.head_oid),
        };
      } catch {
        return { ok: false, code: RUNNER_CODES.CHECKPOINT_INVALID };
      }
    },
  };
}

function isContainedRegularFile(root, candidate) {
  try {
    const rootReal = realpathSync(root);
    const candidateReal = realpathSync(candidate);
    const rel = relative(rootReal, candidateReal);
    return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`)
      && !resolve(candidateReal).startsWith(`${resolve(rootReal)}${sep}..${sep}`)
      && lstatSync(candidate).isFile();
  } catch {
    return false;
  }
}

function artifactRef(workPath, artifact) {
  const path = resolve(workPath, artifact.path);
  if (!isContainedRegularFile(workPath, path)) return null;
  return hashRef(readFileSync(path));
}

function durableHandoffSource(workPath, stage, config) {
  const kind = stage.artifact ? "stage-artifact" : "objective-gate";
  const relativePath = stage.artifact?.path ?? config.objective_gate.path;
  const path = resolve(workPath, relativePath);
  if (!isContainedRegularFile(workPath, path)) return null;
  const content = readFileSync(path, "utf8");
  return {
    content,
    record: { stage_id: stage.id, kind, content_ref: hashRef(content) },
  };
}

function reconstructHandoff(workPath, source, chain, config, contextEngineOn, disagreementIds) {
  if (source == null) return { ok: true, handoff: null };
  const stage = chain.stages.find((candidate) => candidate.id === source.stage_id);
  if (!stage) return { ok: false };
  const durable = durableHandoffSource(workPath, stage, config);
  if (!durable || stableStringify(durable.record) !== stableStringify(source)) return { ok: false };
  const content = durable.content;
  if (!contextEngineOn) {
    return { ok: true, handoff: buildTranscriptHandoff(stage.id, "next", [content]) };
  }
  const packet = buildHandoffPacket({
    from_stage: stage.id,
    to_stage: "next",
    claims: [{ text: content, evidence: [{ path: "", ref: source.content_ref }] }],
    disagreement_ids: disagreementIds,
  });
  packetRecord(packet);
  return { ok: true, handoff: packet };
}

function validateCheckpointEventHistory(path, state, maxIterations, chain, toggles) {
  const runId = state?.run_id;
  const checkpointCount = state?.event_count;
  const completed = state?.completed;
  if (!path || !existsSync(path) || !Number.isSafeInteger(checkpointCount) || checkpointCount < 0) return null;
  try {
    const text = readFileSync(path, "utf8");
    if (!text.endsWith("\n")) return null;
    const events = text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
    if (events.length === 0 || checkpointCount > events.length) return null;
    if (!validateStructuralEventHistory(events, { run_id: runId }).valid) return null;
    if (!completed && events.some((event) => event.kind === "run-end")) return null;
    if (completed) {
      const hasRunEnd = events.some((event) => event.kind === "run-end");
      if (state.pending_event?.kind !== "run-end" && !hasRunEnd) return null;
      if (state.pending_event === null && checkpointCount !== events.length) return null;
    }
    if (!validateCheckpointEventBinding(events, state, {
      max_iterations: maxIterations,
      chain,
      toggles,
    })) return null;
    return { count: events.length, events };
  } catch {
    return null;
  }
}

function writeAtomicJson(path, value) {
  assertPublicSafe(value);
  writeTextAtomic(dirname(path), basename(path), stableStringify(value) + "\n");
}

/** Immutable structural disagreement generation selected by runner state. */
export function disagreementSnapshotPath(dir, runId, ref) {
  if (typeof dir !== "string" || typeof runId !== "string"
    || !/^[A-Za-z0-9._-]+$/.test(runId)
    || typeof ref !== "string" || !/^sha256:[0-9a-f]{64}$/.test(ref)) return null;
  return join(dir, `${runId}.disagreements.${ref.slice("sha256:".length)}.json`);
}

function writeDisagreementGeneration(dir, runId, document) {
  const ref = hashRef(stableStringify(document));
  const snapshot = disagreementSnapshotPath(dir, runId, ref);
  if (!snapshot) throw new Error(RUNNER_CODES.RESUME_DISAGREEMENTS_INVALID);
  if (existsSync(snapshot)) {
    const existing = JSON.parse(readFileSync(snapshot, "utf8"));
    if (stableStringify(existing) !== stableStringify(document)) {
      throw new Error(RUNNER_CODES.RESUME_DISAGREEMENTS_INVALID);
    }
  } else {
    writeAtomicJson(snapshot, document);
  }
  // Compatibility/latest view only. Resume and rendering select the immutable
  // generation through the hash stored in state.
  writeAtomicJson(join(dir, `${runId}.disagreements.json`), document);
  return { ref, snapshot };
}

function pendingEventMatches(event, pending) {
  if (!event || !pending) return false;
  const projected = { kind: event.kind };
  for (const key of Object.keys(pending.fields)) projected[key] = event[key];
  return stableStringify(projected) === stableStringify({ kind: pending.kind, ...pending.fields });
}

function reconcilePendingEvent(state, { statePath, eventsPath, maxIterations, chain, toggles, monotonic, onEvent }) {
  try {
    const history = validateCheckpointEventHistory(eventsPath, state, maxIterations, chain, toggles);
    if (!history) return { ok: false };
    let eventCount = history.count;
    if (state.pending_event) {
      const existing = history.events[state.event_count];
      let recoveredEvents = [];
      if (existing) {
        if (!pendingEventMatches(existing, state.pending_event)) return { ok: false };
      } else {
        if (state.event_count !== history.count) return { ok: false };
        const virtualEvent = {
          run_id: state.run_id,
          seq: history.count + 1,
          t_rel_ms: history.events.at(-1)?.t_rel_ms ?? 0,
          kind: state.pending_event.kind,
          ...state.pending_event.fields,
        };
        if (!validateStructuralEventHistory([...history.events, virtualEvent], { run_id: state.run_id }).valid) {
          return { ok: false };
        }
        const recoveryLog = makeEventLog({
          run_id: state.run_id,
          dir: resolve(eventsPath, ".."),
          start_seq: history.count,
          start_t_rel_ms: history.events.at(-1)?.t_rel_ms ?? 0,
          monotonic,
          onEvent,
        });
        recoveryLog.emit(state.pending_event.kind, state.pending_event.fields);
        recoveredEvents = recoveryLog.events;
        eventCount += 1;
      }
      const reconciled = { ...state, event_count: eventCount, pending_event: null };
      if (!validateRunnerState(reconciled).valid) return { ok: false };
      writeAtomicJson(statePath, reconciled);
      return { ok: true, state: reconciled, eventCount, events: [...history.events, ...recoveredEvents] };
    }
    return { ok: true, state, eventCount, events: history.events };
  } catch {
    return { ok: false };
  }
}

/** Closed, public-safe validation for any parsed runner state on disk. */
export function validateRunnerState(state, expected = {}) {
  const allowed = new Set([
    "schema_version", "run_id", "config_id", "chain_id", "run_target", "completed", "stop_reason",
    "machine", "event_count", "toggles", "execution_ref", "repository_ref", "checkout_ref",
    "worktree_enabled", "worktree_ref", "handoff_source", "disagreement_ref", "pending_event",
    "resolved_cast", "prompt_resources_ref", "initializing", "baseline_ref", "checkpoint_tree_ref",
    "checkpoint_generation", "pass_in_progress",
    "run_generation", "checkout_state_ref", "worktree_owner_ref", "task_bound", "runtime_limits",
  ]);
  const hash = (value) => typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
  const token = isPublicCode;
  if (!state || typeof state !== "object" || Array.isArray(state)
    || Object.keys(state).some((key) => !allowed.has(key))) {
    return { valid: false, code: RUNNER_CODES.INVALID_STATE };
  }
  try {
    assertPublicSafe(state);
  } catch {
    return { valid: false, code: RUNNER_CODES.INVALID_STATE };
  }
  const machine = state.machine;
  const machineKeys = machine && typeof machine === "object" && !Array.isArray(machine)
    ? Object.keys(machine)
    : [];
  const counts = machine?.pass_counts;
  const countKeys = counts && typeof counts === "object" && !Array.isArray(counts)
    ? Object.keys(counts)
    : [];
  const countSum = countKeys.reduce((sum, key) => sum + counts[key], 0);
  const togglesValid = state.toggles === undefined
    || (state.toggles && typeof state.toggles === "object" && !Array.isArray(state.toggles)
      && Object.keys(state.toggles).length === HELIX_TOGGLES.length
      && HELIX_TOGGLES.every((name) => typeof state.toggles[name] === "boolean"));
  const targetKeys = state.run_target && typeof state.run_target === "object" && !Array.isArray(state.run_target)
    ? Object.keys(state.run_target)
    : [];
  const targetValid = (targetKeys.length === 1 || targetKeys.length === 2)
    && targetKeys.every((key) => key === "repo" || key === "ref")
    && (state.run_target.repo === "self" || state.run_target.repo === "other")
    && (state.run_target.ref === undefined || token(state.run_target.ref));
  const runtimeLimits = state.runtime_limits;
  const runtimeLimitsValid = runtimeLimits == null || (typeof runtimeLimits === "object" && !Array.isArray(runtimeLimits)
    && Object.keys(runtimeLimits).length === 2
    && Number.isSafeInteger(runtimeLimits.max_runtime_ms) && runtimeLimits.max_runtime_ms >= 1_000
    && runtimeLimits.max_runtime_ms <= 60 * 60 * 1000
    && Number.isSafeInteger(runtimeLimits.call_timeout_ms) && runtimeLimits.call_timeout_ms >= 1_000
    && runtimeLimits.call_timeout_ms <= runtimeLimits.max_runtime_ms);
  const sourceKeys = state.handoff_source && typeof state.handoff_source === "object"
    && !Array.isArray(state.handoff_source) ? Object.keys(state.handoff_source) : [];
  const handoffSourceValid = state.handoff_source === null
    || (sourceKeys.length === 3
      && ["stage_id", "kind", "content_ref"].every((key) => sourceKeys.includes(key))
      && token(state.handoff_source.stage_id)
      && ["stage-artifact", "objective-gate"].includes(state.handoff_source.kind)
      && hash(state.handoff_source.content_ref));
  let pendingEventValid = state.pending_event === null;
  if (state.pending_event && typeof state.pending_event === "object" && !Array.isArray(state.pending_event)) {
    const pendingKeys = Object.keys(state.pending_event);
    const fields = state.pending_event.fields;
    if (pendingKeys.length === 2 && pendingKeys.includes("kind") && pendingKeys.includes("fields")
      && ["stage-end", "jump-back", "run-end"].includes(state.pending_event.kind)
      && fields && typeof fields === "object" && !Array.isArray(fields)) {
      pendingEventValid = validateEvent({
        run_id: state.run_id,
        seq: 1,
        t_rel_ms: 0,
        kind: state.pending_event.kind,
        ...fields,
      }).valid;
    }
  }
  const activePassKeys = state.pass_in_progress && typeof state.pass_in_progress === "object"
    && !Array.isArray(state.pass_in_progress) ? Object.keys(state.pass_in_progress) : [];
  const activePassValid = state.pass_in_progress === null
    || (activePassKeys.length === 3
      && ["stage_id", "pass", "total_passes"].every((key) => activePassKeys.includes(key))
      && token(state.pass_in_progress.stage_id)
      && Number.isSafeInteger(state.pass_in_progress.pass) && state.pass_in_progress.pass >= 1
      && Number.isSafeInteger(state.pass_in_progress.total_passes)
      && state.pass_in_progress.total_passes === machine?.total_passes + 1
      && state.pass_in_progress.total_passes <= MAX_ITERATIONS);
  const checkpointBundleValid = state.pass_in_progress === null
    ? state.checkpoint_generation === null && state.checkpoint_tree_ref === null
    : token(state.checkpoint_generation) && hash(state.checkpoint_tree_ref)
      && state.checkpoint_tree_ref === state.checkout_state_ref;
  const completionValid = state.completed === true
    ? token(state.stop_reason)
      && state.initializing === false
      && state.pass_in_progress === null
      && (state.pending_event === null || state.pending_event?.kind === "run-end")
      && (state.pending_event?.kind !== "run-end"
        || (state.pending_event.fields.stop_reason === state.stop_reason
          && state.pending_event.fields.converged === (state.stop_reason === "converged")))
    : state.stop_reason === undefined && state.pending_event?.kind !== "run-end";
  const structural = state.schema_version === RUNNER_STATE_SCHEMA_VERSION
    && token(state.run_id) && token(state.config_id) && token(state.chain_id)
    && typeof state.completed === "boolean"
    && (state.stop_reason === undefined || token(state.stop_reason))
    && targetValid && Number.isSafeInteger(state.event_count) && state.event_count >= 0
    && (state.task_bound == null || typeof state.task_bound === "boolean") && runtimeLimitsValid
    && hash(state.execution_ref) && hash(state.repository_ref) && hash(state.checkout_ref)
    && typeof state.worktree_enabled === "boolean"
    && (state.worktree_ref === null || hash(state.worktree_ref))
    && (state.worktree_enabled ? hash(state.worktree_owner_ref) : state.worktree_owner_ref === null)
    && handoffSourceValid && pendingEventValid && Object.hasOwn(state, "pending_event")
    && validateResolvedCast(state.resolved_cast) && hash(state.prompt_resources_ref)
    && typeof state.initializing === "boolean" && hash(state.baseline_ref)
    && activePassValid && checkpointBundleValid
    && completionValid
    && token(state.run_generation)
    && (hash(state.checkout_state_ref) || (state.initializing && state.checkout_state_ref === null))
    && hash(state.disagreement_ref) && togglesValid
    && machineKeys.length === 4
    && ["phase", "stage_index", "pass_counts", "total_passes"].every((key) => machineKeys.includes(key))
    && (machine.phase === "stage" || machine.phase === "conclusion")
    && Number.isSafeInteger(machine.stage_index) && machine.stage_index >= 0
    && machine.stage_index < countKeys.length
    && Number.isSafeInteger(machine.total_passes) && machine.total_passes >= 0
    && machine.total_passes <= MAX_ITERATIONS
    && countKeys.length > 0 && countKeys.every((key) => token(key)
      && Number.isSafeInteger(counts[key]) && counts[key] >= 0 && counts[key] <= MAX_ITERATIONS)
    && Number.isSafeInteger(countSum) && countSum === machine.total_passes
    && (machine.total_passes !== 0 || (machine.stage_index === 0 && machine.phase === "stage"))
    && (machine.phase !== "conclusion" || machine.total_passes > 0)
    && (state.worktree_enabled ? (state.initializing || state.worktree_ref !== null) : state.worktree_ref === null)
    && (!state.initializing || state.pass_in_progress === null)
    && (state.completed || machine.total_passes === 0 || state.handoff_source !== null);
  if (!structural) return { valid: false, code: RUNNER_CODES.INVALID_STATE };
  for (const [key, expectedValue] of Object.entries(expected)) {
    const actualKey = ({ runId: "run_id", configId: "config_id", chainId: "chain_id" })[key] ?? key;
    if (stableStringify(state[actualKey] ?? null) !== stableStringify(expectedValue ?? null)) {
      return { valid: false, code: RUNNER_CODES.INVALID_STATE };
    }
  }
  return { valid: true, code: null };
}

function validateResumeEnvelope(state, {
  runId,
  config,
  chain,
  executionRef,
  repositoryRef,
  worktreeEnabled,
  toggles,
}) {
  if (!validateRunnerState(state).valid
    || state.run_id !== runId || state.config_id !== config.id || state.chain_id !== chain.id
    || !validateMachineResume(chain, config.max_iterations, state.toggles ?? null, state.machine)) {
    return RUNNER_CODES.INVALID_STATE;
  }
  if (state.handoff_source) {
    const sourceStage = chain.stages.find((stage) => stage.id === state.handoff_source.stage_id);
    const expectedKind = sourceStage?.artifact ? "stage-artifact" : "objective-gate";
    if (!sourceStage || state.handoff_source.kind !== expectedKind) return RUNNER_CODES.INVALID_STATE;
  }
  if (state.resolved_cast.length !== chain.stages.length
    || chain.stages.some((stage, index) => {
      const castStage = state.resolved_cast[index];
      const requiredRoles = [...new Set(stage.steps.filter((step) => step.kind === "role").map((step) => step.role))].sort();
      return castStage?.stage_id !== stage.id
        || stableStringify(Object.keys(castStage.roles).sort()) !== stableStringify(requiredRoles);
    })) return RUNNER_CODES.INVALID_STATE;
  if (state.execution_ref !== executionRef) return RUNNER_CODES.STATE_EXECUTION_MISMATCH;
  if (stableStringify(state.toggles ?? null) !== stableStringify(toggles)) {
    return RUNNER_CODES.STATE_EXECUTION_MISMATCH;
  }
  if (state.repository_ref !== repositoryRef) return RUNNER_CODES.STATE_REPOSITORY_MISMATCH;
  if (state.worktree_enabled !== worktreeEnabled) return RUNNER_CODES.STATE_EXECUTION_MISMATCH;
  return null;
}

function stepEffect(deps, kind) {
  if (kind === "local-check") return deps.step_effects?.localCheck;
  if (kind === "handoff") return deps.step_effects?.handoff;
  return null;
}

/** Real per-run git worktree effect over the repo at `repoRoot`. */
export function makeGitWorktreeEffect(repoRoot, { baseDir } = {}) {
  const requestedBase = baseDir ?? join(repoRoot, "dispatch", "local", "worktrees");
  const git = (args) => spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  const rootIdentity = gitIdentity(repoRoot);
  const validRunId = (runId) => typeof runId === "string" && /^[A-Za-z0-9._-]+$/.test(runId)
    && runId !== "." && runId !== "..";
  const branchForRun = (runId) => `helix/run-${hashRef(runId).slice("sha256:".length, "sha256:".length + 24)}`;
  const baseRelative = relative(resolve(repoRoot), resolve(requestedBase));
  const safeBase = () => {
    if (baseRelative === "" || baseRelative === ".." || baseRelative.startsWith(`..${sep}`)) return null;
    try { return ensureConfinedDirectory(repoRoot, baseRelative); } catch { return null; }
  };
  const pathEntryExists = (path) => {
    try { lstatSync(path); return true; } catch (error) { return error?.code !== "ENOENT"; }
  };
  const branchExists = (branch) => git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).status === 0;
  const ownerKey = (branch) => `branch.${branch}.helixOwner`;
  const configuredOwner = (branch) => gitResult(repoRoot, ["config", "--local", "--get", ownerKey(branch)]);
  const baselineRef = (ref = "HEAD") => {
    const oid = gitResult(repoRoot, ["rev-parse", "--verify", ref]);
    return oid ? hashRef(oid) : null;
  };
  const ownerFor = (runId, options = {}) => {
    if (!validRunId(runId)) return null;
    const branch = branchForRun(runId);
    const generation = options.run_generation ?? `direct-${runId}`;
    const baseline = options.baseline_ref ?? baselineRef();
    if (!rootIdentity || !isPublicCode(generation) || !/^sha256:[0-9a-f]{64}$/.test(baseline ?? "")) return null;
    return hashRef(stableStringify({
      run_id: runId,
      run_generation: generation,
      repository_ref: rootIdentity.repository_ref,
      branch_ref: branch,
      baseline_ref: baseline,
    }));
  };
  const isClean = (path) => {
    const status = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: path,
      encoding: "utf8",
    });
    return status.status === 0 && status.stdout === "";
  };
  const verifyRegistered = (path) => {
    if (!rootIdentity || !existsSync(path)) return null;
    const identity = gitIdentity(path);
    if (!identity || identity.repository_ref !== rootIdentity.repository_ref) return null;
    try {
      if (identity.top !== realpathSync(path)) return null;
      const listed = git(["worktree", "list", "--porcelain"]);
      if (listed.status !== 0) return null;
      const registered = listed.stdout.split("\n")
        .filter((line) => line.startsWith("worktree "))
        .map((line) => line.slice("worktree ".length))
        .some((listedPath) => {
          try { return realpathSync(listedPath) === identity.top; } catch { return false; }
        });
      return registered ? identity : null;
    } catch {
      return null;
    }
  };
  const effect = {
    preflight(runId, options = {}) {
      if (!validRunId(runId)) return { ok: false, code: "unsafe-run-id" };
      const base = safeBase();
      const branch = branchForRun(runId);
      const path = base ? join(base, runId) : null;
      const ownerRef = ownerFor(runId, options);
      if (!base || !ownerRef) return { ok: false, code: RUNNER_CODES.WORKTREE_FAILED };
      if (pathEntryExists(path) || branchExists(branch) || configuredOwner(branch) !== null) {
        return { ok: false, code: RUNNER_CODES.WORKTREE_COLLISION, path };
      }
      return { ok: true, path, branch_ref: branch, owner_ref: ownerRef };
    },
    claim(runId, options = {}) {
      if (!validRunId(runId)) return { ok: false, code: "unsafe-run-id" };
      const checked = effect.preflight(runId, options);
      if (checked.ok) {
        if (git(["config", "--local", ownerKey(checked.branch_ref), checked.owner_ref]).status !== 0) {
          return { ok: false, code: RUNNER_CODES.WORKTREE_FAILED };
        }
        return checked;
      }
      const branch = branchForRun(runId);
      const expectedOwner = ownerFor(runId, options);
      if (expectedOwner && !branchExists(branch) && configuredOwner(branch) === expectedOwner) {
        const base = safeBase();
        return base
          ? { ok: true, path: join(base, runId), branch_ref: branch, owner_ref: expectedOwner }
          : { ok: false, code: RUNNER_CODES.WORKTREE_FAILED };
      }
      return checked;
    },
    // reuse: true only for RESUME. A FRESH run that collides with an existing
    // per-run worktree fails closed (worktree-run-id-collision). A RESUME whose
    // worktree is ABSENT fails closed too (resume-worktree-missing) — the
    // per-run worktree lives under the ORIGINAL repo, so a resume pointed at a
    // different repo has no worktree here and must not silently recreate one
    // from that repo's HEAD (a wrong-repo resume the review confirmed).
    create(runId, {
      reuse = false,
      initialize = false,
      run_generation,
      baseline_ref,
      owner_ref,
    } = {}) {
      if (!validRunId(runId)) return { ok: false, code: "unsafe-run-id" };
      const base = safeBase();
      if (!base) return { ok: false, code: RUNNER_CODES.WORKTREE_FAILED };
      const path = join(base, runId);
      const branch = branchForRun(runId);
      const expectedOwner = ownerFor(runId, { run_generation, baseline_ref });
      if (!expectedOwner || (owner_ref != null && owner_ref !== expectedOwner)) {
        return { ok: false, code: RUNNER_CODES.WORKTREE_INVALID_FOR_RESUME };
      }
      const expectedBaseline = baseline_ref ?? baselineRef();
      const owner = configuredOwner(branch);
      if (pathEntryExists(path)) {
        if (!reuse) return { ok: false, code: RUNNER_CODES.WORKTREE_COLLISION, path };
        const identity = verifyRegistered(path);
        const symbolic = identity ? gitResult(path, ["symbolic-ref", "--quiet", "--short", "HEAD"]) : null;
        const baselineMatches = !initialize || baselineRef(branch) === expectedBaseline;
        return identity && symbolic === branch && owner === expectedOwner && baselineMatches
          && (!initialize || isClean(path))
          ? {
            ok: true,
            path,
            reused: true,
            branch_ref: branch,
            worktree_ref: identity.checkout_ref,
            repository_ref: identity.repository_ref,
            owner_ref: expectedOwner,
          }
          : { ok: false, code: RUNNER_CODES.WORKTREE_INVALID_FOR_RESUME };
      }
      if (reuse && !initialize) return { ok: false, code: RUNNER_CODES.WORKTREE_MISSING_FOR_RESUME, path };
      if (reuse) {
        if (owner === null && initialize && !branchExists(branch)) {
          if (git(["config", "--local", ownerKey(branch), expectedOwner]).status !== 0) {
            return { ok: false, code: RUNNER_CODES.WORKTREE_INVALID_FOR_RESUME };
          }
        } else if (owner !== expectedOwner) {
          return { ok: false, code: RUNNER_CODES.WORKTREE_INVALID_FOR_RESUME };
        }
      } else {
        if (branchExists(branch) || (owner !== null && owner !== expectedOwner)) {
          return { ok: false, code: RUNNER_CODES.WORKTREE_COLLISION, path };
        }
        if (owner === null && git(["config", "--local", ownerKey(branch), expectedOwner]).status !== 0) {
          return { ok: false, code: RUNNER_CODES.WORKTREE_FAILED };
        }
      }
      if (!branchExists(branch)) {
        if (baselineRef() !== expectedBaseline) {
          return { ok: false, code: RUNNER_CODES.STATE_REPOSITORY_MISMATCH };
        }
        if (git(["branch", branch, "HEAD"]).status !== 0) {
          return { ok: false, code: RUNNER_CODES.WORKTREE_FAILED };
        }
      } else if (baselineRef(branch) !== expectedBaseline) {
        return { ok: false, code: RUNNER_CODES.STATE_REPOSITORY_MISMATCH };
      }
      const result = git(["worktree", "add", path, branch]);
      if (result.status !== 0) return { ok: false, code: RUNNER_CODES.WORKTREE_FAILED };
      const identity = verifyRegistered(path);
      if (!identity || gitResult(path, ["symbolic-ref", "--quiet", "--short", "HEAD"]) !== branch
        || configuredOwner(branch) !== expectedOwner || !isClean(path)) {
        return { ok: false, code: RUNNER_CODES.WORKTREE_FAILED };
      }
      return {
        ok: true,
        path,
        reused: false,
        branch_ref: branch,
        worktree_ref: identity.checkout_ref,
        repository_ref: identity.repository_ref,
        owner_ref: expectedOwner,
      };
    },
    remove(runId) {
      if (!validRunId(runId)) return { ok: false, path: null };
      const base = safeBase();
      if (!base) return { ok: false, path: null };
      const path = join(base, runId);
      const result = git(["worktree", "remove", "--force", path]);
      return { ok: result.status === 0, path };
    },
  };
  return effect;
}

/** Deterministic no-live adapter for the staged runner (reviewers approve). */
export function createStagedMockAdapter({ verdicts = {} } = {}) {
  const remaining = Object.fromEntries(Object.entries(verdicts).map(([k, v]) => [k, [...v]]));
  const calls = { candidates: 0, judges: 0, synthesis: 0, verifiers: 0, revisions: 0 };
  const envelope = ({ run_id, stage = "candidate", role, provider, model, recommendation, risks = [], open_questions = [] }) => ({
    schema_version: 2,
    run_id,
    stage,
    role,
    provider,
    model,
    usage: { input_tokens: 10, output_tokens: 5 },
    attempt: 1,
    iteration: 1,
    input_ref: { kind: "local-ref", value: `local-ref:input/${run_id}`, algorithm: null },
    claims_ref: `local-ref:claims/${run_id}`,
    evidence_ref: `local-ref:evidence/${run_id}`,
    uncertainty: [],
    risks,
    recommendation,
    proposed_actions: [],
    open_questions,
    status: "ok",
  });
  return {
    calls,
    dispatchAdapter: {
      kind: "helix-staged-mock",
      runCandidate(spec, ctx) {
        calls.candidates += 1;
        let recommendation = `${spec.role}-ok`;
        if (ctx.stage_id != null && remaining[ctx.stage_id]?.length && spec.role === ctx.verdict_role) {
          recommendation = remaining[ctx.stage_id].shift();
        } else if (spec.role === ctx.verdict_role) {
          recommendation = "approve";
        }
        return envelope({ run_id: ctx.run_id, role: spec.role, provider: spec.provider, model: spec.model, recommendation });
      },
      runJudge(_input, ctx) {
        calls.judges += 1;
        return envelope({ run_id: ctx.run_id, stage: "judge", role: "judge", provider: ctx.judge.provider, model: ctx.judge.model, recommendation: "ranked" });
      },
      runSynthesis(input, ctx) {
        calls.synthesis += 1;
        // Preserve every candidate contradiction (the synthesis contract); a
        // dropped one fails the run closed. The old task-loop mock did this;
        // the staged mock must too or a reviewer raising a risk deadlocks.
        return envelope({
          run_id: ctx.run_id, stage: "synthesis", role: "synthesizer",
          provider: ctx.synthesis.provider, model: ctx.synthesis.model,
          recommendation: "synthesized",
          open_questions: input?.contradictions ?? [],
        });
      },
      runVerifier(_input, ctx) {
        calls.verifiers += 1;
        return envelope({ run_id: ctx.run_id, stage: "verification", role: "verifier", provider: ctx.verification.provider, model: ctx.verification.model, recommendation: "proof summarized" });
      },
    },
    revisionAdapter(contentByPath) {
      return {
        runRevision() {
          calls.revisions += 1;
          return { edits: Object.entries(contentByPath).map(([path, content]) => ({ path, content })) };
        },
      };
    },
  };
}

/**
 * Every provider a resolved cast names — INCLUDING panel_roles (a composite's
 * judge/synthesizer live only there on multi-member stages, not in `roles`).
 * The live-adapter guard and /helix's Live signal both scan this, so a real
 * judge on an otherwise-mock cast can never masquerade as no-live.
 */
export function allCastProviders(cast) {
  const providers = [];
  for (const stage of cast ?? []) {
    for (const entries of Object.values(stage.roles ?? {})) {
      for (const entry of entries) providers.push(entry.provider);
    }
    for (const member of Object.values(stage.panel_roles ?? {})) {
      if (member?.provider) providers.push(member.provider);
    }
  }
  return [...new Set(providers)];
}

function expandCastRoles(roles) {
  const specs = [];
  for (const [role, entries] of Object.entries(roles)) {
    for (const entry of entries) {
      for (let i = 0; i < entry.instances; i += 1) {
        specs.push({ role, provider: entry.provider, model: entry.model, effort: entry.effort });
      }
    }
  }
  return specs;
}

/** Strictest-wins verdict across the verdict role's launched envelopes. */
export function extractStageVerdict(dispatchResult, verdictRole) {
  const verdicts = (dispatchResult.candidates ?? [])
    .filter((c) => c.disposition === "launched" && c.role === verdictRole)
    .map((c) => c.envelope?.recommendation)
    .filter((v) => STAGE_VERDICTS.includes(v));
  if (verdicts.length === 0) return undefined;
  if (verdicts.includes("revise-jump")) return "revise-jump";
  if (verdicts.includes("revise")) return "revise";
  return "approve";
}

function stageRoute(chain, stage, cast) {
  const candidateRoles = Object.keys(cast.roles).filter((role) => isRoleValidForStage("candidate", role));
  const candidateCount = expandCastRoles(
    Object.fromEntries(candidateRoles.map((role) => [role, cast.roles[role]])),
  ).length;
  const roles = [...candidateRoles];
  if (cast.panel_roles?.judge && candidateCount > 1) roles.push("judge");
  if (cast.panel_roles?.synthesizer && candidateCount > 1) roles.push("synthesizer");
  if (cast.roles.verifier) roles.push("verifier");
  return {
    id: `stage:${chain.id}:${stage.id}`,
    task_class: chain.task_class,
    roles,
    panel: { min: 1, max: Math.max(candidateCount, 1) },
    min_successes: "panel",
    judge_synthesis_rule: "stage panel",
    objective_gate: null, // the MACHINE gate concludes; stage cycles are advisory
    gate_kind: "advisory",
    requires_cross_family: false,
    role_matrix: {},
  };
}

/**
 * Run a config through the staged runner. See module header.
 *
 * @param {object} config RUN_CONFIG_SCHEMA config (with assignments).
 * @param {object} registries { chainRegistry, presets (Map) }.
 * @param {object} deps {
 *   cwd, now, seed, toggles?, mode?,
 *   record_dir?, state_dir?, events?: { onEvent?, dir?, monotonic? },
 *   adapter?, revisionAdapter?, worktree?, availability?, resume_state?,
 * }
 */
async function runStagedTaskLoopLeased(config, registries, deps = {}) {
  const fail = (code, detail = null) => ({ ok: false, status: "fail-closed", code, detail });

  const configValid = validateRunConfig(config);
  if (!configValid.valid) {
    return fail(RUNNER_CODES.INVALID_CONFIG, configValid.errors.map((e) => `${e.path} ${e.message}`).join("; "));
  }
  if (typeof deps.now !== "number" || !Number.isFinite(deps.now)) return fail(RUNNER_CODES.MISSING_CLOCK);
  const runId = deps.run_id ?? config.id;
  if (typeof runId !== "string" || !/^[A-Za-z0-9._-]+$/.test(runId) || runId === "." || runId === "..") {
    return fail("unsafe-run-id");
  }
  const runtimeLimits = deps.runtime_limits ?? null;
  if (runtimeLimits != null && (!(typeof runtimeLimits === "object" && !Array.isArray(runtimeLimits))
    || Object.keys(runtimeLimits).length !== 2
    || !Number.isSafeInteger(runtimeLimits.max_runtime_ms) || runtimeLimits.max_runtime_ms < 1_000
    || runtimeLimits.max_runtime_ms > 60 * 60 * 1000
    || !Number.isSafeInteger(runtimeLimits.call_timeout_ms) || runtimeLimits.call_timeout_ms < 1_000
    || runtimeLimits.call_timeout_ms > runtimeLimits.max_runtime_ms)) {
    return fail("workflow-runtime-limits-invalid");
  }
  const isResume = deps.resume_state != null;
  let resumeState = deps.resume_state ?? null;
  if (isResume && !validateRunnerState(resumeState).valid) return fail(RUNNER_CODES.INVALID_STATE);
  const runGeneration = isResume ? resumeState.run_generation : `r-${randomUUID()}`;

  const chainResult = resolveChain(registries?.chainRegistry, config.chain);
  if (!chainResult.ok) return fail(chainResult.code, chainResult.detail);
  const chain = chainResult.chain;

  // Resume restores the original resolved execution inputs. Current settings
  // and active-profile edits cannot silently diverge or brick an interrupt.
  const effectiveToggles = isResume ? (resumeState.toggles ?? null) : (deps.toggles ?? null);
  const castResult = isResume
    ? { ok: true, cast: resumeState.resolved_cast }
    : resolveChainCast({
      chain,
      assignments: config.assignments ?? {},
      defaults: config.default_assignment ?? null,
      presets: registries?.presets,
      toggles: effectiveToggles,
      availability: deps.availability,
    });
  if (!castResult.ok) return fail(castResult.code, castResult.detail);
  const castByStage = new Map(castResult.cast.map((c) => [c.stage_id, c]));
  const scheduleByStage = new Map();

  for (const stageCast of castResult.cast) {
    let members = 0;
    for (const entries of Object.values(stageCast.roles ?? {})) {
      for (const entry of entries) {
        if (!Number.isSafeInteger(entry.instances) || entry.instances < 1) {
          return fail(RUNNER_CODES.PANEL_CAP_EXCEEDED);
        }
        members += entry.instances;
        if (!Number.isSafeInteger(members) || members > MAX_PANEL_MEMBERS) {
          return fail(RUNNER_CODES.PANEL_CAP_EXCEEDED);
        }
      }
    }
  }
  // Presence is live intent. A real cast is executable only when the injected
  // adapter explicitly advertises the matching configured-provider boundary;
  // a mock adapter under real ids still refuses before any effect.
  const nonMock = [...new Set(allCastProviders(castResult.cast))].filter((provider) => provider !== "mock");
  if (nonMock.length > 0 && (deps.adapter?.kind !== "helix-pi-agent"
    || nonMock.some((provider) => deps.adapter.supportsProvider?.(provider) !== true))) {
    return fail(RUNNER_CODES.LIVE_ADAPTER_NOT_WIRED, `cast names non-mock provider(s): ${nonMock.join(", ")}`);
  }

  for (const stage of chain.stages) {
    const schedule = stageStepSchedule(stage);
    if (!schedule) return fail("unsupported-chain-step-order");
    scheduleByStage.set(stage.id, schedule);
    for (const step of stage.steps.filter((candidate) => candidate.kind !== "role")) {
      if (typeof stepEffect(deps, step.kind) !== "function") {
        return fail(`${RUNNER_CODES.MISSING_STEP_EFFECT}:${step.kind}`);
      }
    }
  }

  const worktreeEnabled = !effectiveToggles || effectiveToggles.worktree !== false;
  const repositoryIdentity = gitIdentity(deps.cwd);
  if (!repositoryIdentity) return fail(RUNNER_CODES.REPOSITORY_INVALID);
  const repositoryHead = gitResult(deps.cwd, ["rev-parse", "--verify", "HEAD"]);
  if (!repositoryHead) return fail(RUNNER_CODES.REPOSITORY_INVALID);
  const sourceBaselineRef = hashRef(repositoryHead);
  let worktreeOwnerRef = isResume ? resumeState.worktree_owner_ref : null;
  const templatesDir = deps.templates_dir ?? join(REPO_ROOT, "dispatch", "config", "templates");
  const briefsDir = deps.briefs_dir ?? join(REPO_ROOT, "dispatch", "config", "agents");
  const templateId = deps.template_id ?? "step-prompt-v1";
  const resourcesRef = promptResourcesRef(castResult.cast, templatesDir, briefsDir, templateId);
  if (!resourcesRef) return fail("prompt-resources-invalid");
  const executionRef = hashRef(stableStringify({
    config: configSemantics(config),
    chain,
    cast: castResult.cast,
    toggles: effectiveToggles,
    task_ref: hashRef(deps.task_instruction ?? config.description),
    runtime_limits: runtimeLimits,
    prompt_resources_ref: resourcesRef,
  }));
  const publicRunTarget = {
    repo: config.run_target.repo,
    ...(config.run_target.ref == null
      ? {}
      : { ref: config.run_target.repo === "self" && isPublicCode(config.run_target.ref)
        ? config.run_target.ref
        : hashRef(config.run_target.ref) }),
  };

  // --- resume ----------------------------------------------------------------
  // A resume must bind to the SAME config and chain the state was written
  // under — otherwise `--resume <id>` alone would silently run a different
  // config against a mismatched worktree. Validation happens BEFORE any state
  // is written, so a refused resume never bricks a valid interrupt state.
  let resumeMachine = null;
  let resumeEventCount = 0;
  let resumeEvents = [];
  const statePath = typeof deps.state_dir === "string" ? join(deps.state_dir, `${runId}.state.json`) : null;
  if (isResume) {
    const state = resumeState;
    if (state?.config_id !== config.id || state?.chain_id !== chain.id) {
      return fail(RUNNER_CODES.STATE_CONFIG_MISMATCH, `state config '${state.config_id}' != '${config.id}'`);
    }
    const envelopeCode = validateResumeEnvelope(state, {
      runId,
      config,
      chain,
      executionRef,
      repositoryRef: repositoryIdentity.repository_ref,
      worktreeEnabled,
      toggles: effectiveToggles,
    });
    if (envelopeCode) return fail(envelopeCode);
    const priorEventsPath = typeof deps.events?.dir === "string"
      ? join(deps.events.dir, `${runId}.events.jsonl`)
      : null;
    if (!statePath || !priorEventsPath) return fail(RUNNER_CODES.RESUME_EVENTS_INVALID);
    if (state.initializing) {
      const empty = { schema_version: 1, run_id: runId, entries: [] };
      if (hashRef(stableStringify(empty)) !== state.disagreement_ref) {
        return fail(RUNNER_CODES.RESUME_DISAGREEMENTS_INVALID);
      }
      try {
        writeDisagreementGeneration(deps.state_dir, runId, empty);
      } catch {
        return fail(RUNNER_CODES.RESUME_DISAGREEMENTS_INVALID);
      }
    }
    let reconciled;
    if (state.initializing) {
      try {
        if (state.event_count !== 0) throw new Error("invalid-initializing-count");
        let events = [];
        if (existsSync(priorEventsPath)) {
          const text = readFileSync(priorEventsPath, "utf8");
          if (text !== "" && !text.endsWith("\n")) throw new Error("partial-initializing-events");
          events = text === "" ? [] : text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
          if (events.length > 1 || (events.length === 1 && (events[0].kind !== "run-start"
            || !validateEvent(events[0]).valid || events[0].run_id !== runId || events[0].seq !== 1))) {
            throw new Error("invalid-initializing-events");
          }
          if (!validateCheckpointEventBinding(events, state, {
            max_iterations: config.max_iterations,
            chain,
            toggles: state.toggles ?? effectiveToggles,
          })) {
            throw new Error("initializing-event-binding");
          }
        }
        reconciled = { ok: true, state, eventCount: events.length, events };
      } catch {
        reconciled = { ok: false };
      }
    } else {
      reconciled = reconcilePendingEvent(state, {
        statePath,
        eventsPath: priorEventsPath,
        maxIterations: config.max_iterations,
        chain,
        toggles: state.toggles ?? effectiveToggles,
        monotonic: deps.events?.monotonic,
        onEvent: deps.events?.onEvent,
      });
    }
    if (!reconciled.ok) return fail(RUNNER_CODES.RESUME_EVENTS_INVALID);
    resumeState = reconciled.state;
    resumeEventCount = reconciled.eventCount;
    resumeEvents = reconciled.events;
    if (resumeState.completed === true) {
      return { ok: true, status: "ok", code: RUNNER_CODES.ALREADY_COMPLETED, noop: true, run_id: runId };
    }
    resumeMachine = resumeState.machine;
  }
  if (!isResume) {
    const durablePaths = [
      statePath,
      typeof deps.events?.dir === "string" ? join(deps.events.dir, `${runId}.events.jsonl`) : null,
      typeof deps.state_dir === "string" ? join(deps.state_dir, `${runId}.disagreements.json`) : null,
    ].filter(Boolean);
    if (durablePaths.some((path) => existsSync(path))) return fail(RUNNER_CODES.RUN_STATE_COLLISION);
    if (worktreeEnabled) {
      if (!deps.worktree || typeof deps.worktree.preflight !== "function"
        || typeof deps.worktree.claim !== "function" || typeof deps.worktree.create !== "function") {
        return fail(RUNNER_CODES.MISSING_WORKTREE_EFFECT);
      }
      const preflight = deps.worktree.preflight(runId, {
        run_generation: runGeneration,
        baseline_ref: sourceBaselineRef,
      });
      if (!preflight.ok) return fail(preflight.code ?? RUNNER_CODES.WORKTREE_FAILED);
      worktreeOwnerRef = preflight.owner_ref;
    }
    if (statePath) {
      try {
        const machine = {
          phase: "stage",
          stage_index: 0,
          pass_counts: Object.fromEntries(chain.stages.map((stage) => [stage.id, 0])),
          total_passes: 0,
        };
        const emptyDisagreements = { schema_version: 1, run_id: runId, entries: [] };
        const emptyDisagreementRef = hashRef(stableStringify(emptyDisagreements));
        const initialState = {
          schema_version: RUNNER_STATE_SCHEMA_VERSION,
          run_id: runId,
          config_id: config.id,
          chain_id: chain.id,
          run_target: publicRunTarget,
          task_bound: typeof deps.task_instruction === "string",
          runtime_limits: runtimeLimits,
          completed: false,
          machine,
          event_count: 0,
          execution_ref: executionRef,
          repository_ref: repositoryIdentity.repository_ref,
          checkout_ref: repositoryIdentity.checkout_ref,
          worktree_enabled: worktreeEnabled,
          worktree_ref: null,
          worktree_owner_ref: worktreeEnabled ? worktreeOwnerRef : null,
          handoff_source: null,
          disagreement_ref: emptyDisagreementRef,
          pending_event: null,
          resolved_cast: castResult.cast,
          prompt_resources_ref: resourcesRef,
          initializing: true,
          baseline_ref: sourceBaselineRef,
          checkpoint_tree_ref: null,
          checkpoint_generation: null,
          pass_in_progress: null,
          run_generation: runGeneration,
          checkout_state_ref: null,
          ...(effectiveToggles ? { toggles: effectiveToggles } : {}),
        };
        if (!validateRunnerState(initialState).valid) throw new Error(RUNNER_CODES.INVALID_STATE);
        writeAtomicJson(statePath, initialState);
        if (worktreeEnabled) {
          const claimed = deps.worktree.claim(runId, {
            run_generation: runGeneration,
            baseline_ref: sourceBaselineRef,
          });
          if (!claimed.ok || claimed.owner_ref !== worktreeOwnerRef) throw new Error(RUNNER_CODES.WORKTREE_FAILED);
        }
        if (typeof deps.on_initial_state === "function") deps.on_initial_state(initialState);
        writeDisagreementGeneration(deps.state_dir, runId, emptyDisagreements);
      } catch {
        return fail("checkpoint-persistence-failed");
      }
    }
  }

  // --- worktree ----------------------------------------------------------------
  const warnings = [];
  let workPath;
  let worktreeRef = null;
  let worktreeBranchRef = null;
  if (worktreeEnabled) {
    if (!deps.worktree || typeof deps.worktree.create !== "function") {
      return fail(RUNNER_CODES.MISSING_WORKTREE_EFFECT);
    }
    // Only a resume may reuse an existing worktree; a fresh colliding run id
    // fails closed rather than inheriting a stale tree.
    const created = deps.worktree.create(runId, {
      reuse: isResume,
      initialize: resumeState?.initializing === true,
      run_generation: runGeneration,
      baseline_ref: resumeState?.baseline_ref ?? sourceBaselineRef,
      owner_ref: worktreeOwnerRef,
    });
    if (!created.ok) return fail(created.code ?? RUNNER_CODES.WORKTREE_FAILED);
    if (created.owner_ref !== worktreeOwnerRef) return fail(RUNNER_CODES.WORKTREE_INVALID_FOR_RESUME);
    workPath = created.path;
    const createdIdentity = gitIdentity(workPath);
    if (!createdIdentity || createdIdentity.repository_ref !== repositoryIdentity.repository_ref) {
      return fail(RUNNER_CODES.WORKTREE_INVALID_FOR_RESUME);
    }
    worktreeRef = createdIdentity.checkout_ref;
    worktreeBranchRef = created.branch_ref ?? null;
    if (isResume && resumeState.initializing
      && hashRef(gitResult(workPath, ["rev-parse", "HEAD"]) ?? "missing") !== resumeState.baseline_ref) {
      return fail(RUNNER_CODES.STATE_REPOSITORY_MISMATCH);
    }
    if (isResume && !resumeState.initializing && resumeState.worktree_ref !== worktreeRef) {
      return fail(RUNNER_CODES.STATE_REPOSITORY_MISMATCH);
    }
  } else {
    if (typeof deps.cwd !== "string") return fail("missing-worktree");
    workPath = deps.cwd;
    if (isResume && resumeState.checkout_ref !== repositoryIdentity.checkout_ref) {
      return fail(RUNNER_CODES.STATE_REPOSITORY_MISMATCH);
    }
    warnings.push("worktree-off-working-tree");
  }

  const checkpointEffect = statePath ? (deps.checkpoint ?? makePrivateCheckpointEffect(deps.cwd)) : null;
  const checkpointRuntimePaths = [
    deps.state_dir,
    deps.events?.dir,
    deps.record_dir,
  ].filter((path) => typeof path === "string");
  if (statePath && (!checkpointEffect || typeof checkpointEffect.snapshot !== "function"
      || typeof checkpointEffect.restore !== "function" || typeof checkpointEffect.remove !== "function"
      || typeof checkpointEffect.fingerprint !== "function")) {
    return fail(RUNNER_CODES.CHECKPOINT_FAILED);
  }
  if (isResume && resumeState.pass_in_progress) {
    const restored = checkpointEffect.restore(
      runId,
      resumeState.checkpoint_generation,
      resumeState.checkpoint_tree_ref,
      workPath,
      checkpointRuntimePaths,
    );
    if (!restored.ok || restored.baseline_ref !== resumeState.baseline_ref) {
      return fail(restored.code ?? RUNNER_CODES.CHECKPOINT_INVALID);
    }
  } else if (isResume && !resumeState.initializing) {
    const fingerprint = checkpointEffect.fingerprint(workPath, checkpointRuntimePaths);
    if (!fingerprint.ok || fingerprint.tree_ref !== resumeState.checkout_state_ref
      || fingerprint.baseline_ref !== resumeState.baseline_ref) {
      return fail(RUNNER_CODES.WORKTREE_INVALID_FOR_RESUME);
    }
  }
  let initialCheckoutFingerprint = null;
  if (statePath && (!isResume || resumeState.initializing)) {
    initialCheckoutFingerprint = checkpointEffect.fingerprint(workPath, checkpointRuntimePaths);
    const expectedBaseline = resumeState?.baseline_ref
      ?? hashRef(gitResult(deps.cwd, ["rev-parse", "HEAD"]) ?? "missing");
    if (!initialCheckoutFingerprint.ok || initialCheckoutFingerprint.baseline_ref !== expectedBaseline) {
      return fail(RUNNER_CODES.STATE_REPOSITORY_MISMATCH);
    }
  }

  // --- events + state persistence ---------------------------------------------
  // Resume continues the event seq from the ACTUAL last seq in the on-disk
  // JSONL, not the state's event_count — a mid-pass kill leaves orphan events
  // appended past the last state write, and trusting event_count would re-issue
  // (duplicate) their seqs. Reading the file's true high-water mark keeps the
  // append-only stream strictly monotonic across any kill window.
  const log = makeEventLog({
    run_id: runId,
    monotonic: deps.events?.monotonic,
    onEvent: deps.events?.onEvent,
    dir: deps.events?.dir,
    start_seq: resumeEventCount,
    start_t_rel_ms: resumeEvents.at(-1)?.t_rel_ms ?? 0,
  });
  let currentHandoffSource = resumeState?.handoff_source ?? null;
  let disagreementRef = resumeState?.disagreement_ref ?? null;
  let pendingEvent = null;
  let initializing = false;
  let baselineRef = resumeState?.baseline_ref ?? sourceBaselineRef;
  let checkpointTreeRef = resumeState?.checkpoint_tree_ref ?? null;
  let checkpointGeneration = resumeState?.checkpoint_generation ?? null;
  let passInProgress = resumeState?.pass_in_progress ?? null;
  let checkoutStateRef = resumeState?.checkout_state_ref ?? initialCheckoutFingerprint?.tree_ref ?? null;
  const writeState = (machine, completed, stopReason) => {
    if (!statePath) return;
    const state = {
      schema_version: RUNNER_STATE_SCHEMA_VERSION,
      run_id: runId,
      config_id: config.id,
      chain_id: chain.id,
      run_target: publicRunTarget,
      task_bound: typeof deps.task_instruction === "string",
      runtime_limits: runtimeLimits,
      completed,
      ...(stopReason ? { stop_reason: stopReason } : {}),
      machine,
      // The event high-water mark so a resume can continue the seq.
      event_count: log.events.length + resumeEventCount,
      execution_ref: executionRef,
      repository_ref: repositoryIdentity.repository_ref,
      checkout_ref: repositoryIdentity.checkout_ref,
      worktree_enabled: worktreeEnabled,
      worktree_ref: worktreeRef,
      worktree_owner_ref: worktreeEnabled ? worktreeOwnerRef : null,
      handoff_source: currentHandoffSource,
      disagreement_ref: disagreementRef,
      pending_event: pendingEvent,
      resolved_cast: castResult.cast,
      prompt_resources_ref: resourcesRef,
      initializing,
      baseline_ref: baselineRef,
      checkpoint_tree_ref: checkpointTreeRef,
      checkpoint_generation: checkpointGeneration,
      pass_in_progress: passInProgress,
      run_generation: runGeneration,
      checkout_state_ref: checkoutStateRef,
      ...(effectiveToggles ? { toggles: effectiveToggles } : {}),
    };
    if (!validateRunnerState(state).valid) throw new Error(RUNNER_CODES.INVALID_STATE);
    writeAtomicJson(statePath, state);
  };

  const vectorFields = effectiveToggles ?? undefined;
  if (!isResume || (resumeState.initializing && resumeEvents.length === 0)) {
    log.emit("run-start", {
      chain_id: chain.id,
      config_id: config.id,
      max_iterations: config.max_iterations,
      ...(deps.workflow_ref ? { workflow_ref: deps.workflow_ref } : {}),
      ...(worktreeEnabled ? {} : { warning: "worktree-off-working-tree" }),
    });
  }

  // --- effects -------------------------------------------------------------------
  const mock = createStagedMockAdapter();
  const liveAdapter = deps.adapter ?? null;
  const piLiveAdapter = liveAdapter?.kind === "helix-pi-agent" ? liveAdapter : null;
  const dispatchAdapter = piLiveAdapter ? {
    kind: "helix-mixed-provider-router",
    runCandidate(spec, ctx) {
      return (spec.provider === "mock" ? mock.dispatchAdapter : piLiveAdapter).runCandidate(spec, ctx);
    },
    runJudge(input, ctx) {
      return (ctx.judge?.provider === "mock" ? mock.dispatchAdapter : piLiveAdapter).runJudge(input, ctx);
    },
    runSynthesis(input, ctx) {
      return (ctx.synthesis?.provider === "mock" ? mock.dispatchAdapter : piLiveAdapter).runSynthesis(input, ctx);
    },
    runVerifier(input, ctx) {
      return (ctx.verification?.provider === "mock" ? mock.dispatchAdapter : piLiveAdapter).runVerifier(input, ctx);
    },
  } : liveAdapter ?? mock.dispatchAdapter;
  const mockRevisionModelAdapter = mock.revisionAdapter(config.objective_gate.type === "file-contains" ? {
    [config.objective_gate.path]: `Helix staged proposal\n${config.objective_gate.contains}\n`,
  } : {});
  const artifactEffect = deps.artifact_effect ?? (async (artifact, ctx) => {
    const stageCast = castByStage.get(ctx.stage_id);
    const mutatingMembers = Object.entries(stageCast?.roles ?? {})
      .filter(([role]) => WORKTREE_MUTATING_ROLES.has(role))
      .flatMap(([, members]) => members);
    if (mutatingMembers.length === 0) {
      const results = (ctx.stage_result?.candidates ?? [])
        .filter((candidate) => candidate.disposition === "launched" && candidate.envelope)
        .map((candidate) => ({
          role: candidate.role,
          status: candidate.envelope.status,
          uncertainty: candidate.envelope.uncertainty,
          risks: candidate.envelope.risks,
          recommendation: candidate.envelope.recommendation,
          proposed_actions: candidate.envelope.proposed_actions,
          open_questions: candidate.envelope.open_questions,
        }));
      if (results.length === 0) return { ok: false };
      writeTextAtomic(ctx.cwd, artifact.path, stableStringify({
        schema_version: 1,
        stage_id: ctx.stage_id,
        pass: ctx.pass,
        results,
      }) + "\n");
      return { ok: true };
    }
    if (mutatingMembers.length > 0 && mutatingMembers.every((member) => member.provider === "mock")) {
      const path = resolve(ctx.cwd, artifact.path);
      const existing = existsSync(path) && isContainedRegularFile(ctx.cwd, path) ? readFileSync(path, "utf8") : "";
      const gateMarker = config.objective_gate.type === "file-contains"
        && artifact.path === config.objective_gate.path ? `\n${config.objective_gate.contains}\n` : "";
      writeTextAtomic(ctx.cwd, artifact.path,
        `${existing}\nMock ${artifact.kind} artifact pass ${ctx.pass}.${gateMarker}`);
    }
    return { ok: true };
  });

  const gate = deps.objective_gate_effect
    ?? makeObjectiveGate(workPath, config.objective_gate, { signal: deps.signal ?? null });
  let passCounter = 0;
  const seenStages = new Set(
    isResume
      ? Object.entries(resumeMachine.pass_counts).filter(([, count]) => count > 0).map(([stageId]) => stageId)
      : [],
  );
  const stageArtifactRefs = new Map();
  const passAttempts = new Map();
  for (const event of resumeEvents) {
    if (event.kind !== "pass-start") continue;
    const key = `${event.stage_id}:${event.pass}`;
    passAttempts.set(key, Math.max(passAttempts.get(key) ?? 0, event.attempt ?? 1));
  }

  // --- context engine ----------------------------------------------------------
  // Each stage starts FRESH from a handoff (packet, or raw transcript when the
  // context-engine toggle is OFF). Handoffs are ADAPTER INPUTS — records/events
  // only ever see the structural projection. Disagreements accumulate in the
  // per-run structural log; open entries are never dropped.
  const contextEngineOn = !effectiveToggles || effectiveToggles["context-engine"] !== false;
  if (!contextEngineOn) warnings.push("context-engine-off-transcript");
  // Rehydrate the disagreement log on resume so open entries from before an
  // interrupt survive (they are re-persisted after every pass, below).
  let disagreementSeed = [];
  if (isResume) {
    if (typeof deps.state_dir !== "string") return fail(RUNNER_CODES.RESUME_DISAGREEMENTS_INVALID);
    const priorPath = disagreementSnapshotPath(deps.state_dir, runId, resumeState.disagreement_ref);
    try {
      if (!priorPath || !existsSync(priorPath) || !lstatSync(priorPath).isFile()) throw new Error("missing");
      const document = JSON.parse(readFileSync(priorPath, "utf8"));
      if (!validateDisagreementDocument(document, runId).valid
        || hashRef(stableStringify(document)) !== resumeState.disagreement_ref) throw new Error("invalid");
      disagreementSeed = document.entries;
      disagreementRef = resumeState.disagreement_ref;
    } catch {
      return fail(RUNNER_CODES.RESUME_DISAGREEMENTS_INVALID);
    }
  }
  const disagreements = makeDisagreementLog(disagreementSeed);
  let currentHandoff = null;
  if (isResume) {
    const disagreementIds = disagreements.list().filter((entry) => entry.status !== "resolved").map((entry) => entry.id);
    const restored = reconstructHandoff(
      workPath,
      resumeState.handoff_source,
      chain,
      config,
      contextEngineOn,
      disagreementIds,
    );
    if (!restored.ok) return fail(RUNNER_CODES.RESUME_HANDOFF_INVALID);
    currentHandoff = restored.handoff;
    currentHandoffSource = resumeState.handoff_source;
  }
  const gateSummary = objectiveGateSummary(config.objective_gate);
  let disagreementsPath = isResume && typeof deps.state_dir === "string"
    ? join(deps.state_dir, `${runId}.disagreements.json`)
    : null;
  let lastMachineState = resumeMachine ?? {
    phase: "stage",
    stage_index: 0,
    pass_counts: Object.fromEntries(chain.stages.map((stage) => [stage.id, 0])),
    total_passes: 0,
  };
  let passBaseMachine = passInProgress ? lastMachineState : null;

  const persistCheckpointDocuments = () => {
    const document = { schema_version: 1, run_id: runId, entries: disagreements.list() };
    if (typeof deps.state_dir === "string") {
      const persisted = writeDisagreementGeneration(deps.state_dir, runId, document);
      disagreementRef = persisted.ref;
      disagreementsPath = join(deps.state_dir, `${runId}.disagreements.json`);
    } else {
      disagreementRef = hashRef(stableStringify(document));
    }
  };

  const executeNonRoleStep = async (step, stage, pass) => {
    const effect = stepEffect(deps, step.kind);
    let effectResult;
    try {
      effectResult = await effect(step, {
        run_id: runId,
        chain_id: chain.id,
        stage_id: stage.id,
        pass,
        cwd: workPath,
        // A handoff may become an outward mutation (for example opening a PR).
        // The stable key lets that boundary deduplicate a kill-and-resume retry.
        idempotency_key: `${runId}:${chain.id}:${stage.id}:${step.id}`,
        signal: deps.signal ?? null,
      });
    } catch {
      effectResult = null;
    }
    if (effectResult?.ok !== true) {
      const returnedCode = STEP_EFFECT_FAILURE_CODES[step.kind] ?? RUNNER_CODES.MISSING_STEP_EFFECT;
      log.emit("blocked", {
        stage_id: stage.id,
        code: returnedCode,
        next_action: "satisfy-chain-step-then-rerun",
      });
      throw new Error(returnedCode);
    }
    return effectResult;
  };

  const runStage = async (stage, ctx) => {
    if (statePath) {
      if (passInProgress) {
        if (passInProgress.stage_id !== stage.id || passInProgress.pass !== ctx.pass
          || passInProgress.total_passes !== ctx.total_passes) {
          throw new Error(RUNNER_CODES.CHECKPOINT_INVALID);
        }
      } else {
        const generation = `g-${runGeneration}-${ctx.total_passes}-${stage.id}-${ctx.pass}`;
        const snapshot = checkpointEffect.snapshot(runId, generation, workPath, checkpointRuntimePaths);
        if (!snapshot.ok) throw new Error(snapshot.code ?? RUNNER_CODES.CHECKPOINT_FAILED);
        if (snapshot.reused) {
          const restored = checkpointEffect.restore(
            runId, generation, snapshot.tree_ref, workPath, checkpointRuntimePaths,
          );
          if (!restored.ok) throw new Error(restored.code ?? RUNNER_CODES.CHECKPOINT_INVALID);
        }
        if (snapshot.tree_ref !== checkoutStateRef || snapshot.baseline_ref !== baselineRef) {
          throw new Error(RUNNER_CODES.CHECKPOINT_INVALID);
        }
        passBaseMachine = lastMachineState;
        passInProgress = { stage_id: stage.id, pass: ctx.pass, total_passes: ctx.total_passes };
        checkpointGeneration = snapshot.generation;
        checkpointTreeRef = snapshot.tree_ref;
        baselineRef = snapshot.baseline_ref;
        if (typeof deps.on_private_snapshot === "function") {
          deps.on_private_snapshot({ generation: snapshot.generation, tree_ref: snapshot.tree_ref });
        }
        writeState(lastMachineState, false);
      }
    }
    const artifactBefore = stage.artifact ? artifactRef(workPath, stage.artifact) : null;
    const artifactRequiresProduction = (lastMachineState.pass_counts[stage.id] ?? 0) === 0;
    const attemptedCounts = { ...lastMachineState.pass_counts, [stage.id]: ctx.pass };
    lastMachineState = {
      phase: "stage",
      stage_index: chain.stages.findIndex((candidate) => candidate.id === stage.id),
      pass_counts: attemptedCounts,
      total_passes: ctx.total_passes,
    };
    const cast = castByStage.get(stage.id);
    if (!seenStages.has(stage.id)) {
      seenStages.add(stage.id);
      log.emit("stage-start", { stage_id: stage.id, executor_ref: cast.executor_ref });
    }
    passCounter += 1;
    const attemptKey = `${stage.id}:${ctx.pass}`;
    const attempt = (passAttempts.get(attemptKey) ?? 0) + 1;
    passAttempts.set(attemptKey, attempt);
    log.emit("pass-start", {
      stage_id: stage.id,
      pass: ctx.pass,
      of: config.max_iterations,
      attempt,
      executor_ref: cast.executor_ref,
    });

    // Compile the per-role prompts from tracked template + briefs; records get
    // hashes only. A missing template/brief refuses the stage (structure).
    const stageRolesInCast = Object.keys(cast.roles);
    const prompts = {};
    const declaredOutput = stage.artifact ?? { path: config.objective_gate.path, kind: "notes" };
    for (const role of stageRolesInCast) {
      const compiled = compileStepPrompt({
        template_id: templateId,
        templates_dir: templatesDir,
        briefs_dir: briefsDir,
        role,
        fields: {
          chain_id: chain.id,
          stage_id: stage.id,
          pass: ctx.pass,
          gate_summary: gateSummary,
          artifact_summary: `${declaredOutput.kind}:${declaredOutput.path}`,
          task_instruction: deps.task_instruction ?? config.description,
          handoff: currentHandoff
            ? (currentHandoff.kind === "packet"
              ? currentHandoff.claims.map((c) => `- ${c.text}`).join("\n")
              : currentHandoff.outputs.map((o) => `- ${o}`).join("\n"))
            : "(first stage: no handoff yet)",
        },
      });
      if (!compiled.ok) {
        log.emit("blocked", { stage_id: stage.id, code: compiled.code, next_action: "restore-template-or-brief-then-resume" });
        throw new Error(compiled.code);
      }
      prompts[role] = compiled;
      log.emit("prompt", {
        stage_id: stage.id,
        role,
        template_id: compiled.record.template_id,
        template_hash: compiled.record.template_hash,
        brief_ref: compiled.record.brief_ref,
      });
    }

    // Builder-bearing stages revise the worktree from the second pass on
    // (the builder addressing critique / a failed gate).
    const builderEntries = cast.roles.builder;
    const revisionModelAdapter = deps.revisionAdapter
      ?? (builderEntries?.every((member) => member.provider === "mock") ? mockRevisionModelAdapter : null);
    if (builderEntries && ctx.pass > 1 && revisionModelAdapter) {
      const revise = makeModelRevision(
        {
          cwd: workPath,
          builder: {
            provider: builderEntries[0].provider,
            model: builderEntries[0].model,
            effort: builderEntries[0].effort,
          },
        },
        { modelAdapter: revisionModelAdapter },
      );
      const revision = await revise(null, {
        run_id: `${runId}-p${ctx.total_passes}`, iteration: ctx.pass, signal: deps.signal ?? null,
      });
      log.emit("revision", { stage_id: stage.id, code: revision.code, ...(revision.revision_ref ? { revision_ref: revision.revision_ref } : {}) });
      if (!revision.ok) throw new Error(revision.code);
    }

    const schedule = scheduleByStage.get(stage.id);
    for (const step of schedule.leading) await executeNonRoleStep(step, stage, ctx.pass);

    const candidateRoles = Object.fromEntries(
      Object.entries(cast.roles).filter(([role]) => isRoleValidForStage("candidate", role)),
    );
    const request = {
      run_id: `${runId}-p${ctx.total_passes}`,
      task: { class_hint: chain.task_class, confident: true },
      candidates: expandCastRoles(candidateRoles),
      ...(cast.panel_roles?.judge && stageRoute(chain, stage, cast).roles.includes("judge")
        ? { judge: { provider: cast.panel_roles.judge.provider, model: cast.panel_roles.judge.model, effort: cast.panel_roles.judge.effort, rubric_id: `${chain.id}-${stage.id}-rubric-v1` } }
        : {}),
      ...(cast.panel_roles?.synthesizer && stageRoute(chain, stage, cast).roles.includes("synthesizer")
        ? { synthesis: { provider: cast.panel_roles.synthesizer.provider, model: cast.panel_roles.synthesizer.model, effort: cast.panel_roles.synthesizer.effort, rubric_id: `${chain.id}-${stage.id}-rubric-v1` } }
        : {}),
      ...(cast.roles.verifier
        ? { verification: { provider: cast.roles.verifier[0].provider, model: cast.roles.verifier[0].model, effort: cast.roles.verifier[0].effort, rubric_id: `${chain.id}-${stage.id}-rubric-v1` } }
        : {}),
      run_target: config.run_target,
      input_refs: config.input_refs ?? [],
      claims_ref: config.claims_ref,
      evidence_ref: config.evidence_ref,
    };

    const result = await runDispatch(request, {
      adapter: {
        runCandidate: (spec, dctx) => dispatchAdapter.runCandidate(spec, {
          ...dctx,
          stage_id: stage.id,
          verdict_role: stage.advance?.verdict_role ?? workflowVerdictRole(stage),
          // ADAPTER INPUTS (never persisted): the fresh-context handoff and the
          // compiled role prompt. A live adapter sends these to the provider.
          handoff: currentHandoff,
          prompt: prompts[spec.role]?.prompt ?? null,
          cwd: workPath,
          pass: ctx.pass,
          attempt,
          signal: deps.signal ?? null,
        }),
        runJudge: dispatchAdapter.runJudge
          ? (input, dctx) => dispatchAdapter.runJudge(input, {
            ...dctx, judge: request.judge, cwd: workPath, pass: ctx.pass, attempt,
            task_instruction: deps.task_instruction ?? config.description,
            signal: deps.signal ?? null,
          })
          : undefined,
        runSynthesis: dispatchAdapter.runSynthesis
          ? (input, dctx) => dispatchAdapter.runSynthesis(input, {
            ...dctx, synthesis: request.synthesis, cwd: workPath, pass: ctx.pass, attempt,
            task_instruction: deps.task_instruction ?? config.description,
            signal: deps.signal ?? null,
          })
          : undefined,
        runVerifier: dispatchAdapter.runVerifier
          ? (input, dctx) => dispatchAdapter.runVerifier(input, {
            ...dctx, verification: request.verification, cwd: workPath, pass: ctx.pass, attempt,
            task_instruction: deps.task_instruction ?? config.description,
            signal: deps.signal ?? null,
          })
          : undefined,
      },
      now: deps.now,
      seed: deps.seed ?? 7,
      mode: deps.mode ?? "print",
      record_dir: deps.record_dir,
      route: stageRoute(chain, stage, cast),
      parallel: Object.keys(candidateRoles).some((role) => WORKTREE_MUTATING_ROLES.has(role))
        ? { max_concurrency: 1 }
        : config.parallel,
      ...(schedule.beforeVerification.length > 0 ? {
        beforeVerification: async () => {
          try {
            const proof = [];
            for (const step of schedule.beforeVerification) {
              const effectResult = await executeNonRoleStep(step, stage, ctx.pass);
              proof.push({
                step_id: step.id,
                status: "pass",
                ...(typeof effectResult.proof_ref === "string"
                  && /^sha256:[0-9a-f]{64}$/.test(effectResult.proof_ref)
                  ? { proof_ref: effectResult.proof_ref }
                  : {}),
              });
            }
            return { ok: true, proof };
          } catch (error) {
            const code = isPublicCode(error?.message)
              ? error.message
              : "before-verification-check-failed";
            return { ok: false, code };
          }
        },
      } : {}),
      ...(vectorFields ? { toggles: vectorFields } : {}),
    });

    if (result.status === "fail-closed" || result.status === "escalate") {
      log.emit("blocked", {
        stage_id: stage.id,
        code: result.code ?? "stage-dispatch-failed",
        next_action: "inspect-pass-record-fix-cast-then-resume",
      });
      throw new Error(result.code ?? RUNNER_CODES.STAGE_DISPATCH_FAILED);
    }

    // Context pressure: measured from the pass's structural usage rollup, or
    // honestly unavailable when no record was produced.
    if (result.record?.usage_rollup) {
      const tokens = result.record.usage_rollup.input_tokens + result.record.usage_rollup.output_tokens;
      log.emit("pressure", { stage_id: stage.id, tokens, status: "measured" });
    } else {
      log.emit("pressure", { stage_id: stage.id, status: "unavailable" });
    }

    // Accumulate structural disagreement entries (open, never dropped). The
    // next handoff is reconstructed below from the durable worktree source,
    // never from a persisted raw model envelope.
    const launchedEnvelopes = (result.candidates ?? [])
      .filter((c) => c.disposition === "launched")
      .map((c) => c.envelope);
    for (const entry of extractDisagreements(launchedEnvelopes, stage.id)) disagreements.add(entry);

    if (stage.artifact && typeof artifactEffect === "function") {
      let produced;
      try {
        produced = await artifactEffect(stage.artifact, {
          run_id: runId, chain_id: chain.id, stage_id: stage.id, pass: ctx.pass, cwd: workPath,
          stage_result: result,
          signal: deps.signal ?? null,
        });
      } catch {
        produced = null;
      }
      if (produced?.ok !== true) throw new Error(RUNNER_CODES.STAGE_ARTIFACT_INVALID);
    }

    for (const step of schedule.trailing) await executeNonRoleStep(step, stage, ctx.pass);

    if (stage.artifact) {
      const ref = artifactRef(workPath, stage.artifact);
      if (!ref || (artifactRequiresProduction && ref === artifactBefore)) {
        const code = `${RUNNER_CODES.STAGE_ARTIFACT_INVALID}:${stage.id}`;
        log.emit("blocked", { stage_id: stage.id, code, next_action: "write-contained-artifact-then-rerun" });
        throw new Error(code);
      }
      stageArtifactRefs.set(stage.id, ref);
    }

    // Uninterrupted and resumed execution derive the SAME handoff from an
    // intended durable worktree source. Raw model envelopes are never written
    // anywhere; the checkpoint stores only this source's content hash.
    const durable = durableHandoffSource(workPath, stage, config);
    if (!durable) {
      const code = `${RUNNER_CODES.RESUME_HANDOFF_INVALID}:${stage.id}`;
      log.emit("blocked", { stage_id: stage.id, code, next_action: "write-contained-handoff-source-then-rerun" });
      throw new Error(code);
    }
    currentHandoffSource = durable.record;
    const reconstructed = reconstructHandoff(
      workPath,
      currentHandoffSource,
      chain,
      config,
      contextEngineOn,
      disagreements.list().filter((entry) => entry.status !== "resolved").map((entry) => entry.id),
    );
    if (!reconstructed.ok) throw new Error(RUNNER_CODES.RESUME_HANDOFF_INVALID);
    currentHandoff = reconstructed.handoff;

    let verdict;
    const verdictRole = stage.advance?.verdict_role ?? workflowVerdictRole(stage);
    if (verdictRole) {
      verdict = deps.extractVerdict
        ? deps.extractVerdict(result, verdictRole)
        : extractStageVerdict(result, verdictRole);
      log.emit("verdict", { stage_id: stage.id, verdict: verdict ?? "missing" });
    }
    return { verdict };
  };

  const runGate = async (ctx) => {
    const outcome = await gate(ctx);
    log.emit("gate", { stage_id: ctx.stage_id, phase: ctx.phase, result: outcome.result });
    // Handoffs are outward effects, not evidence for convergence. Execute them
    // only after the objective gate has independently passed. On a kill after
    // the external effect, the stable idempotency key above lets the injected
    // boundary safely deduplicate the conclusion-phase retry.
    if (ctx.phase === "conclusion" && outcome.result === "pass") {
      for (const stage of chain.stages) {
        for (const step of stage.steps.filter((candidate) => candidate.kind === "handoff")) {
          await executeNonRoleStep(step, stage, lastMachineState.pass_counts[stage.id]);
        }
      }
    }
    return outcome;
  };

  if (!isResume || resumeState.initializing) {
    try {
      // Establish a resumable zero-pass checkpoint before the first adapter
      // call. A kill during pass one can then replay only that incomplete pass;
      // it never leaves an orphan worktree with no state.
      persistCheckpointDocuments();
      pendingEvent = null;
      writeState(lastMachineState, false);
    } catch {
      return fail("checkpoint-persistence-failed");
    }
  }

  let machineResult = await runStagedChain({
    chain,
    max_iterations: config.max_iterations,
    ...(effectiveToggles ? { toggles: effectiveToggles } : {}),
    ...(resumeMachine ? { resume: resumeMachine } : {}),
  }, {
    runStage: (stage, ctx) => raceRunBoundary(() => runStage(stage, ctx), deps.signal),
    runGate: (ctx) => raceRunBoundary(() => runGate(ctx), deps.signal),
    onPass: (entry, state) => {
      lastMachineState = state;
      // Commit the handoff source hash + disagreement + machine state first.
      // Boundary events follow the durable checkpoint and can never get ahead.
      persistCheckpointDocuments();
      if (entry.action === "jump") {
        pendingEvent = { kind: "jump-back", fields: { stage_id: entry.stage_id, code: entry.code } };
      } else if (entry.action === "advance") {
        const ref = stageArtifactRefs.get(entry.stage_id);
        pendingEvent = {
          kind: "stage-end",
          fields: { stage_id: entry.stage_id, ...(ref ? { artifact_ref: ref } : {}) },
        };
      } else {
        pendingEvent = null;
      }
      const completedGeneration = checkpointGeneration;
      passInProgress = null;
      checkpointGeneration = null;
      checkpointTreeRef = null;
      passBaseMachine = null;
      const fingerprint = checkpointEffect?.fingerprint(workPath, checkpointRuntimePaths);
      if (statePath && !fingerprint?.ok) throw new Error(RUNNER_CODES.CHECKPOINT_FAILED);
      if (fingerprint?.ok) {
        baselineRef = fingerprint.baseline_ref;
        checkoutStateRef = fingerprint.tree_ref;
      }
      writeState(state, false);
      if (completedGeneration) {
        const removed = checkpointEffect.remove(runId, completedGeneration);
        if (!removed.ok) throw new Error(removed.code ?? RUNNER_CODES.CHECKPOINT_FAILED);
      }
      if (pendingEvent) {
        log.emit(pendingEvent.kind, pendingEvent.fields);
        pendingEvent = null;
        writeState(state, false);
      }
    },
    onCheckpoint: (state) => {
      lastMachineState = state;
      persistCheckpointDocuments();
      pendingEvent = null;
      writeState(state, false);
    },
  });

  const runAbortCode = isPublicCode(deps.signal?.reason)
    ? deps.signal.reason
    : deps.run_abort_code?.() ?? null;
  if (runAbortCode) {
    machineResult = {
      ...machineResult,
      ok: false,
      converged: false,
      stop_reason: runAbortCode,
      code: runAbortCode,
    };
  }

  for (const warning of machineResult.warnings) warnings.push(warning);
  if (!machineResult.ok && passInProgress) {
    const restored = checkpointEffect.restore(
      runId, checkpointGeneration, checkpointTreeRef, workPath, checkpointRuntimePaths,
    );
    if (!restored.ok || restored.baseline_ref !== baselineRef) {
      return fail(restored.code ?? RUNNER_CODES.CHECKPOINT_INVALID);
    }
    const abandonedGeneration = checkpointGeneration;
    passInProgress = null;
    checkpointGeneration = null;
    checkpointTreeRef = null;
    const fingerprint = checkpointEffect.fingerprint(workPath, checkpointRuntimePaths);
    if (!fingerprint.ok) return fail(RUNNER_CODES.CHECKPOINT_INVALID);
    baselineRef = fingerprint.baseline_ref;
    checkoutStateRef = fingerprint.tree_ref;
    if (abandonedGeneration) {
      const removed = checkpointEffect.remove(runId, abandonedGeneration);
      if (!removed.ok) return fail(removed.code ?? RUNNER_CODES.CHECKPOINT_FAILED);
    }
  }
  if (!machineResult.ok && machineResult.code) {
    log.emit("blocked", {
      code: machineResult.code,
      next_action: machineResult.code.startsWith("stage-max-passes")
        ? "revise-cast-or-raise-stage-ceiling-then-resume"
        : "inspect-events-and-records-then-resume-or-rerun",
    });
  }
  if (machineResult.code !== "checkpoint-persistence-failed") {
    persistCheckpointDocuments();
    // Completion is the durable commit. The terminal event is exposed only
    // after this atomic state replacement succeeds.
    pendingEvent = {
      kind: "run-end",
      fields: {
        converged: machineResult.converged,
        stop_reason: machineResult.stop_reason,
        open_disagreements: disagreements.openCount(),
        ...(machineResult.code ? { code: machineResult.code } : {}),
      },
    };
    writeState(lastMachineState, true, machineResult.stop_reason);
    try {
      log.emit(pendingEvent.kind, pendingEvent.fields);
    } catch (error) {
      if (error?.code !== "event-renderer-failed") throw error;
      // The event is appended before the live renderer callback runs. A broken
      // renderer must not rewrite a durably completed run into a false failure.
      warnings.push("event-renderer-failed");
    }
    pendingEvent = null;
    writeState(lastMachineState, true, machineResult.stop_reason);
  }

  return {
    ok: machineResult.ok,
    status: machineResult.ok ? "ok" : "fail-closed",
    code: machineResult.code,
    run_id: runId,
    chain_id: chain.id,
    converged: machineResult.converged,
    stop_reason: machineResult.stop_reason,
    total_passes: machineResult.total_passes,
    flow: machineResult.flow,
    cast: castResult.cast.map((c) => ({ stage_id: c.stage_id, executor_ref: c.executor_ref })),
    worktree_path: workPath,
    worktree_branch: worktreeBranchRef,
    events_path: log.path,
    state_path: statePath,
    disagreements_path: disagreementsPath,
    open_disagreements: disagreements.openCount(),
    warnings: [...new Set(warnings)],
    calls: !liveAdapter || piLiveAdapter ? mock.calls : null,
  };
}

/**
 * Public runner entrypoint. Resume is serialized by a repository-private
 * lease and compare-and-swap against the exact state bytes supplied by the
 * caller before any reconciliation or provider effect can run.
 */
export async function runStagedTaskLoop(config, registries, deps = {}) {
  const fail = (code) => ({ ok: false, status: "fail-closed", code, detail: null });
  const runId = deps.run_id ?? config?.id;
  if (typeof runId !== "string" || !/^[A-Za-z0-9._-]+$/.test(runId) || runId === "." || runId === "..") {
    return fail("unsafe-run-id");
  }
  const lease = acquireResumeLease(deps.cwd, runId);
  if (!lease.ok) return fail(deps.resume_state == null ? RUNNER_CODES.RUN_IN_PROGRESS : lease.code);
  const runController = new AbortController();
  let runAbortCode = null;
  const cancelRun = () => {
    runAbortCode ??= isPublicCode(deps.signal?.reason)
      ? deps.signal.reason
      : "workflow-run-cancelled";
    runController.abort(runAbortCode);
  };
  if (deps.signal?.aborted) cancelRun();
  else deps.signal?.addEventListener?.("abort", cancelRun, { once: true });
  const maxRuntimeMs = deps.runtime_limits?.max_runtime_ms;
  const runTimer = Number.isSafeInteger(maxRuntimeMs) && maxRuntimeMs > 0
    ? setTimeout(() => {
      runAbortCode ??= "workflow-run-timeout";
      runController.abort(runAbortCode);
    }, maxRuntimeMs)
    : null;
  const controlledDeps = {
    ...deps,
    signal: runController.signal,
    run_abort_code: () => runAbortCode,
  };
  let result;
  let cleanupOk = false;
  try {
    if (runAbortCode) {
      result = fail(runAbortCode);
    } else if (deps.resume_state != null) {
      if (typeof deps.state_dir !== "string") result = fail(RUNNER_CODES.RESUME_STATE_STALE);
      else {
        const statePath = join(deps.state_dir, `${runId}.state.json`);
        let onDisk = null;
        try {
          onDisk = JSON.parse(readFileSync(statePath, "utf8"));
        } catch {
          onDisk = null;
        }
        if (!validateRunnerState(onDisk).valid
          || stableStringify(onDisk) !== stableStringify(deps.resume_state)) {
          result = fail(RUNNER_CODES.RESUME_STATE_STALE);
        } else {
          result = await runStagedTaskLoopLeased(config, registries, { ...controlledDeps, resume_state: onDisk });
        }
      }
    } else {
      result = await runStagedTaskLoopLeased(config, registries, controlledDeps);
    }
  } catch {
    result = fail("runner-unexpected-failure");
  } finally {
    if (runTimer) clearTimeout(runTimer);
    deps.signal?.removeEventListener?.("abort", cancelRun);
    cleanupOk = releaseResumeLease(lease);
  }
  if (runAbortCode && result) {
    result = {
      ...result,
      ok: false,
      status: "fail-closed",
      code: runAbortCode,
      converged: false,
      stop_reason: runAbortCode,
    };
  }
  if (!cleanupOk) result = {
    ...result,
    warnings: [...new Set([...(result?.warnings ?? []), "run-lease-cleanup-pending"])],
  };
  return result;
}
