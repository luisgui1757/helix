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
import { WORKSPACE_COPY_LIMITS } from "./limits.mjs";

const {
  max_files: MAX_FILES,
  max_file_bytes: MAX_FILE_BYTES,
  max_total_bytes: MAX_TOTAL_BYTES,
} = WORKSPACE_COPY_LIMITS;

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

export function createCanonicalWorkspace({ cwd, run_id, checkpoint_effect, excluded_paths = [], proposal_factory = null, sync_tree = syncRegularTree } = {}) {
  if (typeof cwd !== "string" || typeof run_id !== "string" || !checkpoint_effect
    || typeof sync_tree !== "function"
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
    if (!existsSync(proposal.temp_root)) return { ok: true };
    if (existsSync(proposal.cwd)) {
      const removed = spawnSync("git", ["worktree", "remove", "--force", proposal.cwd], { cwd, encoding: "utf8" });
      if (removed.status !== 0) return { ok: false, code: "kernel-proposal-cleanup-failed" };
    } else {
      const pruned = spawnSync("git", ["worktree", "prune"], { cwd, encoding: "utf8" });
      if (pruned.status !== 0) return { ok: false, code: "kernel-proposal-cleanup-failed" };
    }
    try { rmSync(proposal.temp_root, { recursive: true, force: true }); }
    catch { return { ok: false, code: "kernel-proposal-cleanup-failed" }; }
    return { ok: true };
  };
  const removeSnapshot = (tx) => {
    const removed = checkpoint_effect.remove(run_id, tx.generation);
    if (removed?.ok) return { ok: true };
    const inspected = checkpoint_effect.inspect?.(run_id, tx.generation, tx.tree_ref);
    return inspected?.ok === true && inspected.exists === false
      ? { ok: true }
      : { ok: false, code: removed?.code ?? "kernel-workspace-snapshot-cleanup-failed" };
  };
  const createProposal = async ({ generation: proposalGeneration, before_ref: expectedBefore = null }) => {
    const id = `proposal-${proposalGeneration}`;
    const before = fingerprint();
    if (expectedBefore != null && before !== expectedBefore) return { ok: false, code: "kernel-workspace-conflict" };
    const snapshot = checkpoint_effect.snapshot(run_id, id, cwd, excluded_paths);
    if (!snapshot?.ok || snapshot.tree_ref !== before) return { ok: false, code: "kernel-proposal-snapshot-failed" };
    const tempRoot = mkdtempSync(join(tmpdir(), "helix-proposal-"));
    const proposalCwd = join(tempRoot, "worktree");
    const added = spawnSync("git", ["worktree", "add", "--detach", proposalCwd, "HEAD"], { cwd, encoding: "utf8" });
    if (added.status !== 0) {
      rmSync(tempRoot, { recursive: true, force: true });
      const removed = removeSnapshot({ generation: id, tree_ref: snapshot.tree_ref });
      return removed.ok
        ? { ok: false, code: "kernel-proposal-worktree-failed" }
        : { ok: false, code: removed.code };
    }
    try {
      sync_tree(cwd, proposalCwd);
    } catch {
      const cleaned = removeProposal({ cwd: proposalCwd, temp_root: tempRoot });
      const removed = cleaned.ok
        ? removeSnapshot({ generation: id, tree_ref: snapshot.tree_ref })
        : { ok: false, code: cleaned.code };
      return cleaned.ok && removed.ok
        ? { ok: false, code: "kernel-proposal-copy-failed" }
        : { ok: false, code: removed.code };
    }
    const proposal = {
      ok: true,
      mode: "isolated-proposal",
      cwd: proposalCwd,
      temp_root: tempRoot,
      generation: id,
      before_ref: before,
      tree_ref: snapshot.tree_ref,
      applied: false,
      workspace_ref: null,
    };
    proposal.promote = async () => {
      if (fingerprint() !== before) {
        const cleaned = removeProposal(proposal);
        const removed = removeSnapshot(proposal);
        if (!cleaned.ok || !removed.ok) return { ok: false, code: "kernel-proposal-cleanup-failed" };
        return { ok: false, code: "kernel-proposal-conflict" };
      }
      proposal.applied = true;
      try {
        sync_tree(proposalCwd, cwd);
        proposal.workspace_ref = fingerprint();
        return { ok: true, workspace_ref: proposal.workspace_ref };
      } catch {
        const restored = checkpoint_effect.restore(run_id, id, snapshot.tree_ref, cwd, excluded_paths);
        if (!restored?.ok) return { ok: false, code: "kernel-workspace-restore-failed" };
        proposal.applied = false;
        const cleaned = removeProposal(proposal);
        const removed = removeSnapshot(proposal);
        return cleaned.ok && removed.ok
          ? { ok: false, code: "kernel-proposal-promotion-failed" }
          : { ok: false, code: "kernel-proposal-cleanup-failed" };
      }
    };
    proposal.finalize = async () => {
      const cleaned = removeProposal(proposal);
      if (!cleaned.ok) return cleaned;
      return removeSnapshot(proposal);
    };
    proposal.rollback = async () => {
      if (proposal.applied) {
        const restored = checkpoint_effect.restore(run_id, id, snapshot.tree_ref, cwd, excluded_paths);
        if (!restored?.ok) return { ok: false, code: "kernel-workspace-restore-failed" };
        committedRefs.delete(proposal.workspace_ref);
        proposal.applied = false;
      }
      const cleaned = removeProposal(proposal);
      if (!cleaned.ok) return cleaned;
      return removeSnapshot(proposal);
    };
    return proposal;
  };
  return Object.freeze({
    cwd,
    currentRef() { return fingerprint(); },
    verifyRef(ref) {
      try { return committedRefs.has(ref) && fingerprint() === ref; } catch { return false; }
    },
    async begin({ mode = "shared-serialized", before_ref: expectedBefore = null } = {}) {
      if (mode === "isolated-proposal") {
        const factory = proposal_factory ?? createProposal;
        const proposal = await factory({ cwd, run_id, generation: ++generation, before_ref: expectedBefore });
        return proposal?.ok ? proposal : { ok: false, code: proposal?.code ?? "kernel-isolated-proposal-failed" };
      }
      const id = `effect-${++generation}`;
      const before = fingerprint();
      if (expectedBefore != null && before !== expectedBefore) return { ok: false, code: "kernel-workspace-conflict" };
      let snapshot = checkpoint_effect.snapshot(run_id, id, cwd, excluded_paths);
      if (!snapshot?.ok) return { ok: false, code: snapshot?.code ?? "kernel-workspace-snapshot-failed" };
      if (snapshot.tree_ref !== before) {
        const removed = removeSnapshot({ generation: id, tree_ref: snapshot.tree_ref });
        if (!removed.ok) return removed;
        snapshot = checkpoint_effect.snapshot(run_id, id, cwd, excluded_paths);
      }
      if (!snapshot?.ok || snapshot.tree_ref !== before) {
        return { ok: false, code: snapshot?.code ?? "kernel-workspace-snapshot-failed" };
      }
      return { ok: true, mode, cwd, generation: id, tree_ref: snapshot.tree_ref, before_ref: before, applied: false, workspace_ref: null };
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
      tx.applied = true;
      let ref;
      try { ref = fingerprint(); } catch { return { ok: false, code: "kernel-workspace-fingerprint-failed" }; }
      tx.workspace_ref = ref;
      committedRefs.add(ref);
      return { ok: true, workspace_ref: ref };
    },
    serialize(tx) {
      if (!tx?.generation || !tx?.tree_ref || !tx?.mode) return null;
      return {
        mode: tx.mode,
        generation: tx.generation,
        tree_ref: tx.tree_ref,
        before_ref: tx.before_ref,
        workspace_ref: tx.workspace_ref ?? null,
        applied: tx.applied === true,
        ...(tx.mode === "isolated-proposal" ? { cwd: tx.cwd, temp_root: tx.temp_root } : { cwd }),
      };
    },
    async finalize(tx) {
      if (!tx?.generation || (tx.cwd !== cwd && tx.mode !== "isolated-proposal")) {
        return { ok: false, code: "kernel-workspace-transaction-invalid" };
      }
      if (tx.mode === "isolated-proposal") {
        const cleaned = removeProposal(tx);
        if (!cleaned.ok) return cleaned;
      }
      return removeSnapshot(tx);
    },
    async rollback(tx) {
      if (tx?.mode === "isolated-proposal" && typeof tx.rollback === "function") return tx.rollback();
      if (tx?.mode === "isolated-proposal") {
        if (tx.applied) {
          const restored = checkpoint_effect.restore(run_id, tx.generation, tx.tree_ref, cwd, excluded_paths);
          if (!restored?.ok) return { ok: false, code: "kernel-workspace-restore-failed" };
          committedRefs.delete(tx.workspace_ref);
        }
        const cleaned = removeProposal(tx);
        if (!cleaned.ok) return cleaned;
        return removeSnapshot(tx);
      }
      if (!tx?.generation || tx.cwd !== cwd) return { ok: false, code: "kernel-workspace-transaction-invalid" };
      const restored = checkpoint_effect.restore(run_id, tx.generation, tx.tree_ref, cwd, excluded_paths);
      if (!restored?.ok) return { ok: false, code: "kernel-workspace-restore-failed" };
      committedRefs.delete(tx.workspace_ref);
      return removeSnapshot(tx);
    },
  });
}
