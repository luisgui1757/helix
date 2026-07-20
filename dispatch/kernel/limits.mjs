// One source of truth for bounded private workspace copies. Checkpoint snapshots
// and isolated-proposal promotion must reject at identical boundaries.

export const WORKSPACE_COPY_LIMITS = Object.freeze({
  max_files: 16_384,
  max_file_bytes: 16 * 1024 * 1024,
  max_total_bytes: 64 * 1024 * 1024,
});
