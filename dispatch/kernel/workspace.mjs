// Canonical-worktree transaction adapter over Helix's private checkpoint
// boundary. A mutating effect commits only after the after-state fingerprint is
// durable; failure restores the exact before-state. Isolated proposals execute
// in disposable Git worktrees and promote only if the canonical tree still
// matches their captured base.

import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const MAX_FILES = 16_384;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

function syncRegularTree(source, destination) {
  let files = 0;
  let totalBytes = 0;
  const scan = (root, prefix = "") => {
    const entries = [];
    for (const name of readdirSync(root).sort()) {
      if (prefix === "" && name === ".git") continue;
      const relative = prefix ? `${prefix}/${name}` : name;
      const path = join(root, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error("kernel-proposal-special-file");
      if (stat.isFile()) {
        files += 1;
        totalBytes += stat.size;
        if (stat.size > MAX_FILE_BYTES || files > MAX_FILES || totalBytes > MAX_TOTAL_BYTES) {
          throw new Error("kernel-proposal-size-limit");
        }
      }
      entries.push({ relative, path, directory: stat.isDirectory(), mode: stat.mode & 0o7777 });
      if (stat.isDirectory()) entries.push(...scan(path, relative));
    }
    return entries;
  };
  const sourceEntries = scan(source);
  const wanted = new Set(sourceEntries.map((entry) => entry.relative));
  const clear = (root, prefix = "") => {
    for (const name of readdirSync(root)) {
      if (prefix === "" && name === ".git") continue;
      const relative = prefix ? `${prefix}/${name}` : name;
      const path = join(root, name);
      const stat = lstatSync(path);
      if (!wanted.has(relative)) rmSync(path, { recursive: true, force: true });
      else if (stat.isDirectory()) clear(path, relative);
    }
  };
  clear(destination);
  for (const entry of sourceEntries.filter((candidate) => candidate.directory)) {
    const path = join(destination, ...entry.relative.split("/"));
    if (existsSync(path) && !lstatSync(path).isDirectory()) rmSync(path, { recursive: true, force: true });
    mkdirSync(path, { recursive: true, mode: entry.mode });
  }
  for (const entry of sourceEntries.filter((candidate) => !candidate.directory)) {
    const path = join(destination, ...entry.relative.split("/"));
    if (existsSync(path) && !lstatSync(path).isFile()) rmSync(path, { recursive: true, force: true });
    copyFileSync(entry.path, path);
    chmodSync(path, entry.mode);
  }
  for (const entry of [...sourceEntries].reverse().filter((candidate) => candidate.directory)) {
    chmodSync(join(destination, ...entry.relative.split("/")), entry.mode);
  }
}

export function createCanonicalWorkspace({ cwd, run_id, checkpoint_effect, excluded_paths = [], proposal_factory = null } = {}) {
  if (typeof cwd !== "string" || typeof run_id !== "string" || !checkpoint_effect
    || typeof checkpoint_effect.snapshot !== "function" || typeof checkpoint_effect.restore !== "function"
    || typeof checkpoint_effect.remove !== "function" || typeof checkpoint_effect.fingerprint !== "function") {
    throw new Error("kernel-workspace-invalid");
  }
  let generation = 0;
  const committedRefs = new Set();
  const fingerprint = (path = cwd) => {
    const result = checkpoint_effect.fingerprint(path, excluded_paths);
    if (!result?.ok || !/^sha256:[0-9a-f]{64}$/.test(result.tree_ref ?? "")) throw new Error("kernel-workspace-fingerprint-failed");
    return result.tree_ref;
  };
  committedRefs.add(fingerprint());
  const removeProposal = (proposal) => {
    const removed = spawnSync("git", ["worktree", "remove", "--force", proposal.cwd], { cwd, encoding: "utf8" });
    if (removed.status !== 0) return { ok: false, code: "kernel-proposal-cleanup-failed" };
    rmSync(proposal.temp_root, { recursive: true, force: true });
    return { ok: true };
  };
  const createProposal = async ({ generation: proposalGeneration }) => {
    const id = `proposal-${proposalGeneration}`;
    const before = fingerprint();
    const snapshot = checkpoint_effect.snapshot(run_id, id, cwd, excluded_paths);
    if (!snapshot?.ok || snapshot.tree_ref !== before) return { ok: false, code: "kernel-proposal-snapshot-failed" };
    const tempRoot = mkdtempSync(join(tmpdir(), "helix-proposal-"));
    const proposalCwd = join(tempRoot, "worktree");
    const added = spawnSync("git", ["worktree", "add", "--detach", proposalCwd, "HEAD"], { cwd, encoding: "utf8" });
    if (added.status !== 0) {
      rmSync(tempRoot, { recursive: true, force: true });
      checkpoint_effect.remove(run_id, id);
      return { ok: false, code: "kernel-proposal-worktree-failed" };
    }
    try {
      syncRegularTree(cwd, proposalCwd);
    } catch {
      removeProposal({ cwd: proposalCwd, temp_root: tempRoot });
      checkpoint_effect.remove(run_id, id);
      return { ok: false, code: "kernel-proposal-copy-failed" };
    }
    const proposal = {
      ok: true,
      mode: "isolated-proposal",
      cwd: proposalCwd,
      temp_root: tempRoot,
      generation: id,
      before_ref: before,
      tree_ref: snapshot.tree_ref,
    };
    proposal.promote = async () => {
      if (fingerprint() !== before) {
        removeProposal(proposal);
        checkpoint_effect.remove(run_id, id);
        return { ok: false, code: "kernel-proposal-conflict" };
      }
      try {
        syncRegularTree(proposalCwd, cwd);
        const workspaceRef = fingerprint();
        const cleaned = removeProposal(proposal);
        const checkpointRemoved = checkpoint_effect.remove(run_id, id);
        if (!cleaned.ok || !checkpointRemoved?.ok) throw new Error("cleanup");
        return { ok: true, workspace_ref: workspaceRef };
      } catch {
        checkpoint_effect.restore(run_id, id, snapshot.tree_ref, cwd, excluded_paths);
        removeProposal(proposal);
        checkpoint_effect.remove(run_id, id);
        return { ok: false, code: "kernel-proposal-promotion-failed" };
      }
    };
    proposal.rollback = async () => {
      const cleaned = removeProposal(proposal);
      const checkpointRemoved = checkpoint_effect.remove(run_id, id);
      return cleaned.ok && checkpointRemoved?.ok ? { ok: true } : { ok: false, code: "kernel-proposal-cleanup-failed" };
    };
    return proposal;
  };
  return Object.freeze({
    cwd,
    currentRef() { return fingerprint(); },
    verifyRef(ref) {
      try { return committedRefs.has(ref) && fingerprint() === ref; } catch { return false; }
    },
    async begin({ mode = "shared-serialized" } = {}) {
      if (mode === "isolated-proposal") {
        const factory = proposal_factory ?? createProposal;
        const proposal = await factory({ cwd, run_id, generation: ++generation });
        return proposal?.ok ? proposal : { ok: false, code: proposal?.code ?? "kernel-isolated-proposal-failed" };
      }
      const id = `effect-${++generation}`;
      const snapshot = checkpoint_effect.snapshot(run_id, id, cwd, excluded_paths);
      if (!snapshot?.ok) return { ok: false, code: snapshot?.code ?? "kernel-workspace-snapshot-failed" };
      return { ok: true, mode, cwd, generation: id, tree_ref: snapshot.tree_ref, before_ref: snapshot.tree_ref };
    },
    async commit(tx) {
      if (tx?.mode === "isolated-proposal") {
        const promoted = await tx.promote?.();
        if (!promoted?.ok || !/^sha256:[0-9a-f]{64}$/.test(promoted.workspace_ref ?? "")) {
          return { ok: false, code: promoted?.code ?? "kernel-proposal-promotion-failed" };
        }
        committedRefs.add(promoted.workspace_ref);
        return promoted;
      }
      if (!tx?.generation || tx.cwd !== cwd) return { ok: false, code: "kernel-workspace-transaction-invalid" };
      let ref;
      try { ref = fingerprint(); } catch { return { ok: false, code: "kernel-workspace-fingerprint-failed" }; }
      const removed = checkpoint_effect.remove(run_id, tx.generation);
      if (!removed?.ok) return { ok: false, code: removed?.code ?? "kernel-workspace-snapshot-cleanup-failed" };
      committedRefs.add(ref);
      return { ok: true, workspace_ref: ref };
    },
    async rollback(tx) {
      if (tx?.mode === "isolated-proposal") return tx.rollback?.() ?? { ok: false, code: "kernel-proposal-rollback-unavailable" };
      if (!tx?.generation || tx.cwd !== cwd) return { ok: false, code: "kernel-workspace-transaction-invalid" };
      const restored = checkpoint_effect.restore(run_id, tx.generation, tx.tree_ref, cwd, excluded_paths);
      if (!restored?.ok) return { ok: false, code: restored?.code ?? "kernel-workspace-rollback-failed" };
      const removed = checkpoint_effect.remove(run_id, tx.generation);
      if (!removed?.ok) return { ok: false, code: removed?.code ?? "kernel-workspace-snapshot-cleanup-failed" };
      return { ok: true };
    },
  });
}
