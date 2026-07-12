import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const gate = fileURLToPath(new URL("../tools/ship/pr-gate.sh", import.meta.url));

function executable(path, text) {
  writeFileSync(path, text, "utf8");
  chmodSync(path, 0o755);
}

function runGate(root, branch) {
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  executable(join(bin, "git"), `#!/bin/sh
case "$1:$2" in
  rev-parse:--show-toplevel) printf '%s\\n' "$FAKE_ROOT"; exit 0 ;;
  rev-parse:--verify) exit 1 ;;
  branch:--show-current) [ -n "$FAKE_BRANCH" ] && printf '%s\\n' "$FAKE_BRANCH"; exit 0 ;;
  diff:*) exit 0 ;;
  *) exit 0 ;;
esac
`);
  executable(join(bin, "node"), `#!/bin/sh
if [ "$1" = "-e" ]; then exit 1; fi
cat >/dev/null
exit 0
`);
  return spawnSync("bash", [gate, "--dry-run"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:/bin:/usr/bin`,
      FAKE_ROOT: root,
      FAKE_BRANCH: branch,
    },
  });
}

test("pr gate refuses detached HEAD instead of passing an empty feature branch", () => {
  const root = mkdtempSync(join(tmpdir(), "helix-pr-gate-"));
  try {
    const detached = runGate(root, "");
    assert.equal(detached.status, 1, detached.stderr);
    assert.match(detached.stdout, /FAIL detached HEAD/);
    assert.doesNotMatch(detached.stdout, /PASS on feature branch ''/);

    const feature = runGate(root, "fix/publication-docs");
    assert.equal(feature.status, 0, feature.stdout + feature.stderr);
    assert.match(feature.stdout, /PASS on feature branch 'fix\/publication-docs'/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
