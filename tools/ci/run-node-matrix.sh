#!/usr/bin/env bash
set -euo pipefail

for name in HELIX_NODE22_BIN HELIX_NODE26_BIN; do
  value="${!name:-}"
  if [[ -z "$value" || ! -x "$value" ]]; then
    echo "node-matrix: $name must name an existing executable" >&2
    exit 1
  fi
done

run_one() {
  local node_bin="$1"
  local version
  version="$($node_bin --version)"
  echo "node-matrix: $version"
  "$node_bin" --test tests/*.test.mjs
  "$node_bin" tools/check-helix-resources.mjs
  "$node_bin" tools/ci/docs-truth-check.mjs
  "$node_bin" tools/ci/no-live-egress-check.mjs
}

run_one "$HELIX_NODE22_BIN"
run_one "$HELIX_NODE26_BIN"
