import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveChain,
  validateChainRegistry,
} from "../dispatch/lib/chains.mjs";
import {
  resolveRunConfig,
  validateRunConfigRegistry,
} from "../dispatch/lib/run-configs.mjs";
import {
  createNoLiveMockAdapter,
  runTaskLoop,
  preflightTaskLoopConfig,
  decideTaskLoopTransition,
  makeCommandExitZeroGate,
  objectiveGateWorkspaceRef,
  preflightObjectiveGate,
} from "../dispatch/lib/task-loop.mjs";
import { MAX_ITERATIONS, MAX_PANEL_MEMBERS } from "../dispatch/lib/limits.mjs";
import {
  LINUX_OBJECTIVE_GATE_NAMESPACE_FLAGS,
  preflightObjectiveGateSandbox,
  prepareObjectiveGateSandbox,
} from "../dispatch/lib/objective-gate-sandbox.mjs";

const root = new URL("..", import.meta.url);
const NOW = 1_751_731_200;

test("task-loop mode uses canonical workflow retry and loops-off degeneration", () => {
  assert.deepEqual(decideTaskLoopTransition(true), { action: "retry", code: null });
  assert.deepEqual(decideTaskLoopTransition(false), {
    action: "advance",
    code: null,
    warning: "loops-off-transition-ignored:task-loop:retry",
  });
});

test("command objective gates resolve an executable and use argv without a shell", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "helix-command-gate-"));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "helix@example.invalid"], { cwd });
  execFileSync("git", ["config", "user.name", "Helix Test"], { cwd });
  execFileSync("git", ["commit", "--allow-empty", "-qm", "initial"], { cwd });
  const passing = {
    type: "command-exit-zero",
    command: "node",
    args: ["-e", "process.exit(0)"],
    timeout_ms: 5_000,
  };
  assert.equal(preflightObjectiveGate(cwd, passing).ok, true);
  if (process.platform !== "win32") {
    const local = join(cwd, "helix-local-check");
    writeFileSync(local, "#!/bin/sh\nexit 0\n", "utf8");
    chmodSync(local, 0o755);
    assert.equal(preflightObjectiveGate(cwd, { ...passing, command: "helix-local-check" }, {
      env: { PATH: "" },
    }).ok, true, "an empty PATH segment resolves against the run cwd");
  }
  const passed = await makeCommandExitZeroGate(cwd, passing)();
  assert.equal(passed.result, "pass", JSON.stringify(passed));
  assert.equal(passed.source, "deterministic-checker");
  assert.deepEqual(passed.command_names.slice(0, 2), [
    "command-exit-zero:node",
    `sandbox:${process.platform === "darwin" ? "darwin-sandbox-v1" : "linux-namespace-v1"}`,
  ]);
  assert.match(passed.evidence_ref, /^sha256:[0-9a-f]{64}$/);
  const failing = { ...passing, args: ["-e", "process.exit(7)"] };
  assert.equal((await makeCommandExitZeroGate(cwd, failing)()).result, "fail");

  const controller = new AbortController();
  controller.abort();
  let spawns = 0;
  const aborted = await makeCommandExitZeroGate(cwd, passing, {
    signal: controller.signal,
    spawnEffect() { spawns += 1; },
  })();
  assert.equal(aborted.result, "error");
  assert.equal(aborted.code, "objective-gate-cancelled");
  assert.equal(spawns, 0, "a pre-aborted gate must not create a process");
});

test("Linux containment helpers never resolve from an authored PATH", () => {
  const hostileBin = mkdtempSync(join(tmpdir(), "helix-hostile-boundary-"));
  const marker = join(hostileBin, "invoked");
  for (const name of ["unshare", "mount", "chroot", "setpriv"]) {
    const path = join(hostileBin, name);
    writeFileSync(path, `#!/bin/sh\n: > ${JSON.stringify(marker)}\nexit 0\n`, "utf8");
    chmodSync(path, 0o755);
  }
  const result = preflightObjectiveGateSandbox({
    platform: "linux",
    env: { PATH: hostileBin },
    find_trusted_executable: () => null,
  });
  assert.deepEqual(result, { ok: false, code: "objective-gate-sandbox-unavailable" });
  assert.equal(existsSync(marker), false);
});

test("sandbox setup prioritizes cleanup failure after scratch creation", {
  skip: process.platform === "win32",
}, () => {
  const cwd = tempRepo();
  let scratch = null;
  try {
    const result = prepareObjectiveGateSandbox({
      cwd,
      executable: process.execPath,
      args: ["--version"],
      readOnlyPaths: [cwd],
      makeScratch() {
        scratch = mkdtempSync(join(tmpdir(), "helix-objective-gate-cleanup-"));
        return scratch;
      },
      removeScratch() {},
    });
    assert.deepEqual(result, {
      ok: false,
      code: "objective-gate-sandbox-cleanup-failed",
    });
    assert.equal(existsSync(scratch), true);
  } finally {
    if (scratch != null) rmSync(scratch, { recursive: true, force: true });
  }
});

test("Nix runtime discovery ignores ambient plugins, remotes, proxies, credentials, and PATH", {
  skip: !process.execPath.startsWith("/nix/store/")
    || !existsSync("/nix/var/nix/profiles/default/bin/nix-store"),
}, () => {
  const cwd = tempRepo();
  const hostileRoot = mkdtempSync(join(tmpdir(), "helix-hostile-nix-"));
  const hostileBin = join(hostileRoot, "bin");
  const hostileHome = join(hostileRoot, "home");
  const hostileConfig = join(hostileRoot, "config");
  const hostileXdg = join(hostileRoot, "xdg");
  mkdirSync(hostileBin, { recursive: true });
  mkdirSync(join(hostileHome, ".config", "nix"), { recursive: true });
  mkdirSync(hostileConfig, { recursive: true });
  mkdirSync(join(hostileXdg, "nix"), { recursive: true });
  const sshMarker = join(hostileRoot, "ssh-invoked");
  const hostileSsh = join(hostileBin, "ssh");
  writeFileSync(hostileSsh, `#!/bin/sh\n: > ${JSON.stringify(sshMarker)}\nexit 1\n`, "utf8");
  chmodSync(hostileSsh, 0o755);
  const missingPlugin = join(hostileRoot, "missing-plugin.so");
  const hostileNixConfig = `plugin-files = ${missingPlugin}\nstore = ssh-ng://invalid.example.invalid\n`;
  writeFileSync(join(hostileConfig, "nix.conf"), hostileNixConfig, "utf8");
  writeFileSync(join(hostileHome, ".config", "nix", "nix.conf"), hostileNixConfig, "utf8");
  writeFileSync(join(hostileXdg, "nix", "nix.conf"), hostileNixConfig, "utf8");
  const userConfig = join(hostileRoot, "user-nix.conf");
  writeFileSync(userConfig, hostileNixConfig, "utf8");
  const hostile = {
    PATH: `${hostileBin}${delimiter}${process.env.PATH ?? ""}`,
    HOME: hostileHome,
    XDG_CONFIG_HOME: hostileXdg,
    NIX_CONFIG: hostileNixConfig,
    NIX_CONF_DIR: hostileConfig,
    NIX_USER_CONF_FILES: userConfig,
    NIX_REMOTE: "ssh-ng://invalid.example.invalid",
    NIX_PATH: `nixpkgs=${hostileRoot}`,
    NIX_ACCESS_TOKENS: "invalid.example.invalid=secret-sentinel",
    HTTP_PROXY: "http://invalid.example.invalid:9",
    HTTPS_PROXY: "http://invalid.example.invalid:9",
    ALL_PROXY: "socks5://invalid.example.invalid:9",
    http_proxy: "http://invalid.example.invalid:9",
    https_proxy: "http://invalid.example.invalid:9",
    all_proxy: "socks5://invalid.example.invalid:9",
    AWS_ACCESS_KEY_ID: "secret-sentinel",
    AWS_SECRET_ACCESS_KEY: "secret-sentinel",
    GITHUB_TOKEN: "secret-sentinel",
    SSH_AUTH_SOCK: join(hostileRoot, "agent.sock"),
    SSH_ASKPASS: hostileSsh,
  };
  const original = Object.fromEntries(Object.keys(hostile).map((key) => [key, process.env[key]]));
  Object.assign(process.env, hostile);
  try {
    const prepared = prepareObjectiveGateSandbox({
      cwd,
      executable: process.execPath,
      args: ["--version"],
      env: process.env,
    });
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    assert.equal(existsSync(sshMarker), false);
    assert.deepEqual(prepared.cleanup(), { ok: true });
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("command objective gates cannot write the candidate or an outside path", async () => {
  const cwd = tempRepo();
  const outside = `/var/tmp/helix-objective-gate-outside-${process.pid}-${Date.now()}`;
  const candidate = join(cwd, "gate-write.txt");
  const candidateWrite = {
    type: "command-exit-zero",
    command: "node",
    args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(candidate)},"candidate")`],
    timeout_ms: 5_000,
  };
  const candidateResult = await makeCommandExitZeroGate(cwd, candidateWrite)();
  assert.equal(candidateResult.result, "fail", JSON.stringify(candidateResult));
  assert.equal(existsSync(candidate), false);

  const outsideWrite = {
    ...candidateWrite,
    args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(outside)},"outside")`],
  };
  const outsideResult = await makeCommandExitZeroGate(cwd, outsideWrite)();
  assert.equal(outsideResult.result, "fail", JSON.stringify(outsideResult));
  assert.equal(existsSync(outside), false);
});

test("command objective gates read only admitted candidate/runtime evidence and isolate Linux IPC", async () => {
  const cwd = tempRepo();
  const historicalPath = join(cwd, "historical-secret.txt");
  writeFileSync(historicalPath, "historical-only-object", "utf8");
  execFileSync("git", ["add", "historical-secret.txt"], { cwd });
  execFileSync("git", ["commit", "-qm", "add historical object"], { cwd });
  const historicalCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
  const historicalBlob = execFileSync("git", ["rev-parse", "HEAD:historical-secret.txt"], {
    cwd, encoding: "utf8",
  }).trim();
  execFileSync("git", ["rm", "-q", "historical-secret.txt"], { cwd });
  execFileSync("git", ["commit", "-qm", "remove historical object"], { cwd });
  const fingerprint = objectiveGateWorkspaceRef(cwd);
  execFileSync("git", ["replace", "HEAD", historicalCommit], { cwd });
  assert.equal(objectiveGateWorkspaceRef(cwd), fingerprint,
    "replacement refs cannot redirect ordinary-worktree fingerprints");
  assert.equal(execFileSync("git", ["cat-file", "-e", historicalBlob], { cwd }).length, 0);
  const outside = join(mkdtempSync(join(tmpdir(), "helix-gate-private-")), "credential.txt");
  writeFileSync(outside, "credential-bytes", "utf8");
  const candidate = join(cwd, "proposal.txt");
  const reads = (path) => ({
    type: "command-exit-zero",
    command: "node",
    args: ["-e", `require("node:fs").readFileSync(${JSON.stringify(path)})`],
    timeout_ms: 5_000,
  });
  assert.equal((await makeCommandExitZeroGate(cwd, reads(candidate))()).result, "pass");
  assert.equal((await makeCommandExitZeroGate(cwd, reads(outside))()).result, "fail");
  assert.equal((await makeCommandExitZeroGate(cwd, reads(join(cwd, ".git", "HEAD")))()).result, "fail",
    "the candidate's physical Git metadata is never readable");
  assert.equal((await makeCommandExitZeroGate(cwd, {
    type: "command-exit-zero", command: "git", args: ["status", "--porcelain=v1"], timeout_ms: 5_000,
  })()).result, "pass", "sanitized Git metadata remains sufficient for repository checkers");
  assert.equal((await makeCommandExitZeroGate(cwd, {
    type: "command-exit-zero", command: "git", args: ["cat-file", "-e", historicalBlob], timeout_ms: 5_000,
  })()).result, "fail", "the private Git snapshot excludes objects reachable only through host history");
  assert.equal((await makeCommandExitZeroGate(cwd, {
    type: "command-exit-zero", command: "git", args: ["show", "HEAD:historical-secret.txt"], timeout_ms: 5_000,
  })()).result, "fail", "replacement history is excluded from the ordinary checker view");
  assert.equal((await makeCommandExitZeroGate(cwd, {
    type: "command-exit-zero", command: "git",
    args: [`--git-dir=${join(cwd, ".git")}`, "cat-file", "-e", historicalBlob], timeout_ms: 5_000,
  })()).result, "fail", "an explicit physical Git directory cannot bypass the private snapshot");
  assert.equal(LINUX_OBJECTIVE_GATE_NAMESPACE_FLAGS.includes("--ipc"), true);
  const hostileBin = mkdtempSync(join(tmpdir(), "helix-hostile-git-"));
  const hostileMarker = join(hostileBin, "invoked");
  const hostileGit = join(hostileBin, "git");
  writeFileSync(hostileGit, `#!/bin/sh\n: > ${JSON.stringify(hostileMarker)}\nexit 1\n`, "utf8");
  chmodSync(hostileGit, 0o755);
  const hostilePrepared = prepareObjectiveGateSandbox({
    cwd, executable: process.execPath, args: ["--version"], env: { ...process.env, PATH: hostileBin },
  });
  assert.equal(hostilePrepared.ok, true);
  assert.equal(existsSync(hostileMarker), false, "host preparation never executes PATH-selected Git helpers");
  hostilePrepared.cleanup();
  if (process.platform === "darwin") {
    const prepared = prepareObjectiveGateSandbox({ cwd, executable: process.execPath, args: ["--version"] });
    assert.equal(prepared.ok, true);
    assert.equal(prepared.args[1].includes("(allow file-read*)"), false);
    assert.equal(prepared.args[1].includes('(subpath "/private/etc")'), false);
    assert.equal(prepared.args[1].includes('(subpath "/dev")'), false);
    assert.equal(prepared.args[1].includes(outside), false);
    prepared.cleanup();
  }
});

test("the complete command-gate path ignores hostile PATH, Git targeting, and fsmonitor helpers", async () => {
  const cwd = tempRepo();
  const other = tempRepo();
  const hostileBin = mkdtempSync(join(tmpdir(), "helix-hostile-fingerprint-"));
  const marker = join(hostileBin, "invoked");
  const hostileGit = join(hostileBin, "git");
  writeFileSync(hostileGit, `#!/bin/sh\n: > ${JSON.stringify(marker)}\nexit 1\n`, "utf8");
  chmodSync(hostileGit, 0o755);
  execFileSync("git", ["config", "core.fsmonitor", hostileGit], { cwd });
  const result = await makeCommandExitZeroGate(cwd, {
    type: "command-exit-zero",
    command: "node",
    args: ["-e", "process.exit(0)"],
    timeout_ms: 5_000,
  }, {
    env: {
      ...process.env,
      PATH: [hostileBin, dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter),
      GIT_DIR: join(other, ".git"),
      GIT_WORK_TREE: other,
      GIT_INDEX_FILE: join(other, ".git", "hostile-index"),
      GIT_OBJECT_DIRECTORY: join(other, ".git", "objects"),
      GIT_COMMON_DIR: join(other, ".git"),
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.fsmonitor",
      GIT_CONFIG_VALUE_0: hostileGit,
    },
  })();
  assert.equal(result.result, "pass", JSON.stringify(result));
  assert.equal(existsSync(marker), false);
});

test("host fingerprint and Git-view preparation never execute clean or process filters", () => {
  const exercise = (cwd, driver) => {
    const markerRoot = mkdtempSync(join(tmpdir(), `helix-hostile-${driver}-`));
    const marker = join(markerRoot, "invoked");
    const helper = join(markerRoot, "filter");
    writeFileSync(helper, `#!/bin/sh\n: > ${JSON.stringify(marker)}\nexit 1\n`, "utf8");
    chmodSync(helper, 0o755);
    execFileSync("git", ["config", `filter.hostile.${driver}`, helper], { cwd });
    execFileSync("git", ["config", "filter.hostile.required", "true"], { cwd });
    writeFileSync(join(cwd, "proposal.txt"), `${driver} filter candidate change\n`, "utf8");
    assert.match(objectiveGateWorkspaceRef(cwd), /^sha256:[0-9a-f]{64}$/);
    const prepared = prepareObjectiveGateSandbox({ cwd, executable: process.execPath, args: ["--version"] });
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    prepared.cleanup();
    assert.equal(existsSync(marker), false, `${driver} filter must remain unexecuted`);
  };

  const ordinary = tempRepo();
  writeFileSync(join(ordinary, ".gitattributes"), "proposal.txt filter=hostile\n", "utf8");
  execFileSync("git", ["add", ".gitattributes"], { cwd: ordinary });
  execFileSync("git", ["commit", "-qm", "add filter attributes"], { cwd: ordinary });
  exercise(ordinary, "clean");

  const primary = tempRepo();
  writeFileSync(join(primary, ".gitattributes"), "proposal.txt filter=hostile\n", "utf8");
  execFileSync("git", ["add", ".gitattributes"], { cwd: primary });
  execFileSync("git", ["commit", "-qm", "add linked filter attributes"], { cwd: primary });
  const linked = join(mkdtempSync(join(tmpdir(), "helix-filter-linked-")), "candidate");
  execFileSync("git", ["worktree", "add", "-q", "-b", "helix-filter-gate", linked], { cwd: primary });
  exercise(linked, "process");
});

test("command objective gates mask linked-worktree Git metadata while keeping the private snapshot usable", async () => {
  const primary = tempRepo();
  const historicalPath = join(primary, "linked-history.txt");
  writeFileSync(historicalPath, "linked historical object", "utf8");
  execFileSync("git", ["add", "linked-history.txt"], { cwd: primary });
  execFileSync("git", ["commit", "-qm", "add linked history"], { cwd: primary });
  const historicalCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: primary, encoding: "utf8" }).trim();
  const historicalBlob = execFileSync("git", ["rev-parse", "HEAD:linked-history.txt"], {
    cwd: primary, encoding: "utf8",
  }).trim();
  execFileSync("git", ["rm", "-q", "linked-history.txt"], { cwd: primary });
  execFileSync("git", ["commit", "-qm", "remove linked history"], { cwd: primary });
  const linked = join(mkdtempSync(join(tmpdir(), "helix-linked-parent-")), "candidate");
  execFileSync("git", ["worktree", "add", "-q", "-b", "helix-linked-gate", linked], { cwd: primary });
  const fingerprint = objectiveGateWorkspaceRef(linked);
  execFileSync("git", ["replace", "HEAD", historicalCommit], { cwd: linked });
  assert.equal(objectiveGateWorkspaceRef(linked), fingerprint,
    "replacement refs cannot redirect linked-worktree fingerprints");
  assert.equal((await makeCommandExitZeroGate(linked, {
    type: "command-exit-zero", command: "node",
    args: ["-e", `require("node:fs").readFileSync(${JSON.stringify(join(linked, ".git"))})`], timeout_ms: 5_000,
  })()).result, "fail");
  assert.equal((await makeCommandExitZeroGate(linked, {
    type: "command-exit-zero", command: "git", args: ["status", "--porcelain=v1"], timeout_ms: 5_000,
  })()).result, "pass");
  assert.equal((await makeCommandExitZeroGate(linked, {
    type: "command-exit-zero", command: "git", args: ["cat-file", "-e", historicalBlob], timeout_ms: 5_000,
  })()).result, "fail");
  assert.equal((await makeCommandExitZeroGate(linked, {
    type: "command-exit-zero", command: "git", args: ["show", "HEAD:linked-history.txt"], timeout_ms: 5_000,
  })()).result, "fail", "replacement history is excluded from the linked checker view");
});

test("parent-directory checkers cannot recover ordinary or linked-worktree Git metadata", async () => {
  const check = async (cwd, gitPath) => {
    const parent = join(cwd, "..");
    const checker = join(parent, "helix-parent-check");
    const visible = join(cwd, "parent-check-visible.txt");
    writeFileSync(checker, "#!/bin/sh\nIFS= read -r line < \"$1\"\n", "utf8");
    chmodSync(checker, 0o755);
    writeFileSync(visible, "visible candidate evidence\n", "utf8");
    const run = (path) => makeCommandExitZeroGate(cwd, {
      type: "command-exit-zero",
      command: "helix-parent-check",
      args: [path],
      timeout_ms: 5_000,
    }, { env: { ...process.env, PATH: parent } })();
    const admitted = await run(visible);
    assert.equal(admitted.result, "pass", JSON.stringify(admitted));
    const result = await run(gitPath);
    assert.equal(result.result, "fail", JSON.stringify(result));
  };

  const ordinaryParent = mkdtempSync(join(tmpdir(), "helix-parent-gate-"));
  const ordinary = join(ordinaryParent, "candidate");
  execFileSync("git", ["init", "-q", ordinary]);
  execFileSync("git", ["-C", ordinary, "config", "user.email", "helix@example.invalid"]);
  execFileSync("git", ["-C", ordinary, "config", "user.name", "Helix Test"]);
  execFileSync("git", ["-C", ordinary, "commit", "--allow-empty", "-qm", "initial"]);
  assert.deepEqual(prepareObjectiveGateSandbox({
    cwd: ordinary,
    executable: process.execPath,
    args: ["--version"],
    readOnlyPaths: [ordinaryParent],
  }), { ok: false, code: "objective-gate-sandbox-unavailable" });
  await check(ordinary, join(ordinary, ".git", "HEAD"));

  const primary = tempRepo();
  const linkedParent = mkdtempSync(join(tmpdir(), "helix-parent-linked-gate-"));
  const linked = join(linkedParent, "candidate");
  execFileSync("git", ["worktree", "add", "-q", "-b", `helix-parent-${Date.now()}`, linked], { cwd: primary });
  await check(linked, join(linked, ".git"));
});

test("dependency and checker grants intersecting every physical Git metadata root refuse before execution", () => {
  const assertRefused = (cwd, metadataPath, suffix = "primary") => {
    const dependency = join(cwd, `node_modules-${suffix}`);
    symlinkSync(metadataPath, dependency, "dir");
    assert.deepEqual(prepareObjectiveGateSandbox({
      cwd,
      executable: process.execPath,
      args: ["--version"],
      readOnlyPaths: [realpathSync(dependency)],
    }), { ok: false, code: "objective-gate-sandbox-unavailable" });

    const checker = join(metadataPath, `helix-metadata-checker-${suffix}`);
    writeFileSync(checker, "#!/bin/sh\nexit 0\n", "utf8");
    chmodSync(checker, 0o755);
    const checkerLink = join(cwd, `helix-metadata-checker-${suffix}`);
    symlinkSync(checker, checkerLink);
    assert.deepEqual(prepareObjectiveGateSandbox({
      cwd,
      executable: realpathSync(checkerLink),
      args: [],
    }), { ok: false, code: "objective-gate-sandbox-unavailable" });
  };

  const ordinary = tempRepo();
  assertRefused(ordinary, join(ordinary, ".git"));

  const primary = tempRepo();
  const linked = join(mkdtempSync(join(tmpdir(), "helix-metadata-linked-")), "candidate");
  execFileSync("git", ["worktree", "add", "-q", "-b", `helix-metadata-${Date.now()}`, linked], { cwd: primary });
  const linkedGitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
    cwd: linked,
    encoding: "utf8",
  }).trim();
  const linkedCommonDir = realpathSync(resolve(linked, execFileSync("git", ["rev-parse", "--git-common-dir"], {
    cwd: linked,
    encoding: "utf8",
  }).trim()));
  assertRefused(linked, linkedGitDir, "worktree");
  assertRefused(linked, linkedCommonDir, "common");
});

test("a running command-gate timeout waits for close before cleanup and evidence", async () => {
  const cwd = tempRepo();
  const child = new EventEmitter();
  let killed = false;
  let closed = false;
  let cleaned = false;
  child.kill = () => { killed = true; };
  const gate = makeCommandExitZeroGate(cwd, {
    type: "command-exit-zero", command: "node", args: ["--version"], timeout_ms: 5,
  }, {
    terminationTimeoutMs: 1_000,
    prepareSandbox: () => ({
      ok: true, mode: "test-sandbox-v1", command: "sandbox", args: [], options: {},
      cleanup() { assert.equal(closed, true); cleaned = true; return { ok: true }; },
    }),
    spawnEffect() {
      setTimeout(() => { closed = true; child.emit("close", null, "SIGKILL"); }, 30);
      return child;
    },
  });
  const outcome = await gate();
  assert.equal(killed, true);
  assert.equal(closed, true);
  assert.equal(cleaned, true);
  assert.equal(outcome.result, "error");
  assert.equal(outcome.code, "objective-gate-timeout");
});

test("command-gate spawn and process errors are typed integrity failures", async () => {
  const cwd = tempRepo();
  const sandbox = () => ({
    ok: true, mode: "test-sandbox-v1", command: "sandbox", args: [], options: {}, cleanup: () => ({ ok: true }),
  });
  const thrown = await makeCommandExitZeroGate(cwd, {
    type: "command-exit-zero", command: "node", args: ["--version"], timeout_ms: 5_000,
  }, {
    prepareSandbox: sandbox,
    spawnEffect() { throw new Error("synthetic-spawn-failure"); },
  })();
  assert.equal(thrown.result, "error");
  assert.equal(thrown.code, "gate-execution-failure");

  const child = new EventEmitter();
  const errored = makeCommandExitZeroGate(cwd, {
    type: "command-exit-zero", command: "node", args: ["--version"], timeout_ms: 5_000,
  }, {
    prepareSandbox: sandbox,
    spawnEffect() {
      queueMicrotask(() => child.emit("error", new Error("synthetic-process-error")));
      return child;
    },
  })();
  const processFailure = await errored;
  assert.equal(processFailure.result, "error");
  assert.equal(processFailure.code, "gate-execution-failure");
});

test("an unconfirmed command-gate process never samples or cleans a purported after-state", async () => {
  const cwd = tempRepo();
  const child = new EventEmitter();
  child.kill = () => true;
  let fingerprints = 0;
  let cleaned = false;
  const outcome = await makeCommandExitZeroGate(cwd, {
    type: "command-exit-zero", command: "node", args: ["--version"], timeout_ms: 5,
  }, {
    terminationTimeoutMs: 10,
    fingerprintEffect() { fingerprints += 1; return `sha256:${"1".repeat(64)}`; },
    prepareSandbox: () => ({
      ok: true, mode: "test-sandbox-v1", command: "sandbox", args: [], options: {},
      cleanup() { cleaned = true; return { ok: true }; },
    }),
    spawnEffect: () => child,
  })();
  assert.equal(outcome.result, "error");
  assert.equal(outcome.code, "objective-gate-termination-unconfirmed");
  assert.equal(outcome.command_names.includes("objective-gate-termination-unconfirmed"), true);
  assert.equal(fingerprints, 1, "only the pre-run fingerprint is sampled");
  assert.equal(cleaned, false, "scratch is retained while process termination is unconfirmed");
});

test("a command-gate fingerprint drift is refused and restored through its workspace guard", async () => {
  const cwd = tempRepo();
  const beforeRef = `sha256:${"1".repeat(64)}`;
  const afterRef = `sha256:${"2".repeat(64)}`;
  let currentRef = beforeRef;
  let rolledBack = 0;
  const child = new EventEmitter();
  child.pid = 12345;
  const gate = makeCommandExitZeroGate(cwd, {
    type: "command-exit-zero", command: "node", args: ["--version"], timeout_ms: 5_000,
  }, {
    workspaceGuard: {
      currentRef: () => currentRef,
      async begin() { return { ok: true, cwd, before_ref: beforeRef }; },
      async rollback() { rolledBack += 1; currentRef = beforeRef; return { ok: true }; },
    },
    prepareSandbox: () => ({
      ok: true, mode: "test-sandbox-v1", command: "sandbox", args: [], options: {}, cleanup: () => ({ ok: true }),
    }),
    spawnEffect(command) {
      assert.equal(command, "sandbox");
      currentRef = afterRef;
      queueMicrotask(() => child.emit("close", 0));
      return child;
    },
  });
  const result = await gate();
  assert.equal(result.result, "error");
  assert.equal(result.code, "objective-gate-workspace-drift");
  assert.equal(result.command_names.includes("objective-gate-workspace-drift"), true);
  assert.equal(currentRef, beforeRef);
  assert.equal(rolledBack, 1);
});

test("command-gate sandbox preparation always rolls back and preserves cleanup failure priority", async () => {
  const cwd = tempRepo();
  const beforeRef = objectiveGateWorkspaceRef(cwd);
  assert.match(beforeRef, /^sha256:[0-9a-f]{64}$/);
  const run = async ({ prepareSandbox, rollbackOk }) => {
    let rolledBack = 0;
    const result = await makeCommandExitZeroGate(cwd, {
      type: "command-exit-zero", command: "node", args: ["--version"], timeout_ms: 5_000,
    }, {
      workspaceGuard: {
        currentRef: () => beforeRef,
        async begin() { return { ok: true, cwd, before_ref: beforeRef }; },
        async rollback() {
          rolledBack += 1;
          return { ok: rollbackOk };
        },
      },
      prepareSandbox,
    })();
    assert.equal(rolledBack, 1);
    return result.code;
  };
  assert.equal(await run({
    prepareSandbox() { throw new Error("synthetic-setup-failure"); },
    rollbackOk: true,
  }), "objective-gate-sandbox-unavailable");
  assert.equal(await run({
    prepareSandbox: () => ({ ok: false, code: "objective-gate-sandbox-cleanup-failed" }),
    rollbackOk: true,
  }), "objective-gate-sandbox-cleanup-failed");
  assert.equal(await run({
    prepareSandbox: () => ({ ok: false, code: "objective-gate-sandbox-cleanup-failed" }),
    rollbackOk: false,
  }), "objective-gate-sandbox-cleanup-failed");
  assert.equal(await run({
    prepareSandbox: () => ({ ok: false, code: "objective-gate-sandbox-unavailable" }),
    rollbackOk: false,
  }), "objective-gate-workspace-restore-failed");
});

function readJson(rel) {
  return JSON.parse(readFileSync(new URL(rel, root), "utf8"));
}

function chainRegistry() {
  return readJson("dispatch/config/chains.json");
}

function runRegistry() {
  return readJson("dispatch/config/run-configs.json");
}

function roleMatrix() {
  return readJson("dispatch/config/role-matrix-defaults.json");
}

function agentTeam() {
  return readJson("dispatch/config/agent-team-defaults.json");
}

function tempRepo(objectFormat = null) {
  const cwd = mkdtempSync(join(tmpdir(), "helix-loop-"));
  execFileSync("git", ["init", "-q", ...(objectFormat ? [`--object-format=${objectFormat}`] : [])], { cwd });
  execFileSync("git", ["config", "user.email", "helix@example.invalid"], { cwd });
  execFileSync("git", ["config", "user.name", "Helix Test"], { cwd });
  writeFileSync(join(cwd, "proposal.txt"), "initial proposal\n", "utf8");
  execFileSync("git", ["add", "proposal.txt"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "baseline"], { cwd });
  return cwd;
}

test("objective-gate workspace fingerprints bind indexed metadata and physical tracked bytes", () => {
  const cwd = tempRepo();
  const before = objectiveGateWorkspaceRef(cwd);
  writeFileSync(join(cwd, "proposal.txt"), "changed tracked evidence\n", "utf8");
  const changed = objectiveGateWorkspaceRef(cwd);
  assert.match(before, /^sha256:[0-9a-f]{64}$/);
  assert.match(changed, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(changed, before);
});

test("objective-gate workspace fingerprints support untracked files in SHA-256 repositories", () => {
  const cwd = tempRepo("sha256");
  writeFileSync(join(cwd, "untracked.txt"), "sha256 workspace evidence\n", "utf8");
  assert.match(objectiveGateWorkspaceRef(cwd), /^sha256:[0-9a-f]{64}$/);
});

test("objective-gate workspace fingerprints hash an untracked symlink itself, never its external target", () => {
  const cwd = tempRepo();
  const outside = join(mkdtempSync(join(tmpdir(), "helix-fingerprint-outside-")), "large.bin");
  writeFileSync(outside, Buffer.alloc(17 * 1024 * 1024, 0x61));
  symlinkSync(outside, join(cwd, "external-link"));
  const before = objectiveGateWorkspaceRef(cwd);
  assert.match(before, /^sha256:[0-9a-f]{64}$/);
  writeFileSync(outside, Buffer.alloc(17 * 1024 * 1024, 0x62));
  assert.equal(objectiveGateWorkspaceRef(cwd), before,
    "external target bytes are outside the candidate fingerprint authority");
});

test("objective-gate workspace fingerprints fail closed on oversized untracked regular files", () => {
  const cwd = tempRepo();
  writeFileSync(join(cwd, "oversized.bin"), Buffer.alloc(16 * 1024 * 1024 + 1));
  assert.equal(objectiveGateWorkspaceRef(cwd), null);
});

test("objective-gate workspace fingerprints classify FIFOs without opening them", {
  skip: process.platform === "win32",
}, () => {
  const cwd = tempRepo();
  execFileSync("mkfifo", [join(cwd, "untracked-fifo")]);
  assert.match(objectiveGateWorkspaceRef(cwd), /^sha256:[0-9a-f]{64}$/);
});

function tempRepoWithSymlinkedProposal(marker = "HELIX_LOOP_PASS\n") {
  const outside = mkdtempSync(join(tmpdir(), "helix-loop-outside-"));
  const outsidePath = join(outside, "outside.txt");
  writeFileSync(outsidePath, marker, "utf8");

  const cwd = mkdtempSync(join(tmpdir(), "helix-loop-symlink-"));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "helix@example.invalid"], { cwd });
  execFileSync("git", ["config", "user.name", "Helix Test"], { cwd });
  symlinkSync(outsidePath, join(cwd, "proposal.txt"));
  execFileSync("git", ["add", "proposal.txt"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "baseline"], { cwd });
  return { cwd, outsidePath };
}

test("default chain registry is valid and resolves named chains", () => {
  const registry = chainRegistry();
  const { valid, errors } = validateChainRegistry(registry);
  assert.equal(valid, true, JSON.stringify(errors));
  assert.equal(resolveChain(registry, "full-cycle").ok, true);
  assert.equal(resolveChain(registry, "tdd-fix").ok, true);
  assert.equal(resolveChain(registry, "scout").chain.task_class, "architecture");
  assert.equal(resolveChain(registry, "research").ok, true);
  assert.equal(resolveChain(registry, "ship-pre-pr").chain.task_class, "pr-preflight");
  assert.equal(resolveChain(registry, "missing").code, "unknown-chain");
});

test("malformed chain registry fails closed, including recursive-looking steps", () => {
  const registry = chainRegistry();
  const malformed = {
    ...registry,
    chains: [
      {
        ...registry.chains[0],
        stages: [
          {
            id: "one",
            steps: [
              { id: "implement", kind: "role", role: "builder", chain: "scout" },
            ],
          },
        ],
      },
    ],
  };
  const result = resolveChain(malformed, "full-cycle");
  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid-chain-registry");
});

test("default run config registry is valid and resolves mock-core-loop", () => {
  const registry = runRegistry();
  const { valid, errors } = validateRunConfigRegistry(registry);
  assert.equal(valid, true, JSON.stringify(errors));
  const resolved = resolveRunConfig(registry, "mock-core-loop");
  assert.equal(resolved.ok, true);
  assert.equal(resolved.config.max_iterations, 5);
  assert.equal(resolved.config.parallel.max_concurrency, 2);
  assert.equal(resolveRunConfig(registry, "missing").code, "unknown-run-config");
});

test("run config fails closed on unsafe gate paths, duplicate ids, and removed cost-control fields", () => {
  const registry = runRegistry();
  const badGate = {
    ...registry,
    configs: [
      {
        ...registry.configs[0],
        objective_gate: { ...registry.configs[0].objective_gate, path: "../outside.txt" },
      },
    ],
  };
  assert.equal(resolveRunConfig(badGate, "mock-core-loop").code, "invalid-run-config-registry");

  const duplicate = {
    ...registry,
    configs: [registry.configs[0], { ...registry.configs[0] }],
  };
  assert.equal(resolveRunConfig(duplicate, "mock-core-loop").code, "invalid-run-config-registry");

  // Cost control left the harness: its config fields are unknown properties now.
  for (const removed of [
    { profile: "no-spend-test" },
    { token_budget: 1_000_000 },
    { write_allowlist: ["proposal.txt"] },
    { live: { enabled: false } },
  ]) {
    const withRemoved = {
      ...registry,
      configs: [{ ...registry.configs[0], ...removed }],
    };
    assert.equal(
      resolveRunConfig(withRemoved, "mock-core-loop").code,
      "invalid-run-config-registry",
      JSON.stringify(removed),
    );
  }
});

test("run config iteration and concurrency rails have practical maxima", () => {
  const registry = runRegistry();
  const atLimits = {
    ...registry,
    configs: [{
      ...registry.configs[0],
      max_iterations: MAX_ITERATIONS,
      parallel: { max_concurrency: MAX_PANEL_MEMBERS },
    }],
  };
  assert.equal(validateRunConfigRegistry(atLimits).valid, true);
  for (const override of [
    { max_iterations: MAX_ITERATIONS + 1 },
    { max_iterations: Number.MAX_SAFE_INTEGER + 1 },
    { parallel: { max_concurrency: MAX_PANEL_MEMBERS + 1 } },
  ]) {
    const invalid = {
      ...registry,
      configs: [{ ...registry.configs[0], ...override }],
    };
    assert.equal(validateRunConfigRegistry(invalid).valid, false, JSON.stringify(override));
  }
});

test("bounded task loop converges over a real temp repo with no-live mock adapters", async () => {
  const cwd = tempRepo();
  const recordDir = mkdtempSync(join(tmpdir(), "helix-loop-records-"));
  const config = resolveRunConfig(runRegistry(), "mock-core-loop").config;
  const result = await runTaskLoop(config, {
    chainRegistry: chainRegistry(),
    roleMatrix: roleMatrix(),
    agentTeam: agentTeam(),
  }, {
    cwd,
    now: NOW,
    seed: 7,
    record_dir: recordDir,
    run_id: "task-loop-test",
  });

  assert.equal(result.status, "ok", JSON.stringify({ code: result.code, detail: result.debate?.detail }));
  assert.equal(result.debate.converged, true);
  assert.equal(result.debate.iterations_run, 3);
  assert.equal(result.calls.candidates, 9);
  assert.equal(result.calls.revisions, 2);
  assert.equal(readFileSync(join(cwd, "proposal.txt"), "utf8").includes("HELIX_LOOP_PASS"), true);
  assert.ok(existsSync(join(recordDir, "task-loop-test.debate.json")));
});

test("an injected dispatch adapter without a revision adapter fails closed instead of throwing", async () => {
  const cwd = tempRepo();
  const config = resolveRunConfig(runRegistry(), "mock-core-loop").config;
  const injected = createNoLiveMockAdapter();
  const result = await runTaskLoop(config, {
    chainRegistry: chainRegistry(),
    roleMatrix: roleMatrix(),
    agentTeam: agentTeam(),
  }, {
    cwd,
    now: NOW,
    seed: 7,
    run_id: "missing-revision-adapter",
    adapter: injected.dispatchAdapter,
  });

  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "revision-failed");
  assert.match(result.debate.detail, /revision-subcode:revision-missing-adapter/);
});

test("task loop refuses a symlinked objective gate before accepting outside evidence", async () => {
  const { cwd, outsidePath } = tempRepoWithSymlinkedProposal();
  const recordDir = mkdtempSync(join(tmpdir(), "helix-loop-records-"));
  const config = resolveRunConfig(runRegistry(), "mock-core-loop").config;
  const result = await runTaskLoop(config, {
    chainRegistry: chainRegistry(),
    roleMatrix: roleMatrix(),
    agentTeam: agentTeam(),
  }, {
    cwd,
    now: NOW,
    seed: 7,
    record_dir: recordDir,
    run_id: "loop-symlink-gate",
  });

  assert.equal(readFileSync(outsidePath, "utf8").includes(config.objective_gate.contains), true);
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "revision-failed");
  assert.equal(result.debate.iterations_run, 1);
  assert.equal(result.debate.iterations[0].gate_result, "fail");
  assert.equal(result.debate.iterations[0].gate_pass, false);
  assert.match(result.debate.detail, /revision-subcode:revision-unsafe-path/);

  const firstRecord = JSON.parse(readFileSync(join(recordDir, "loop-symlink-gate-iter1.json"), "utf8"));
  assert.deepEqual(firstRecord.gate.command_names, ["file-contains:proposal.txt", "unsafe-gate-path"]);
  assert.equal(firstRecord.gate.result, "fail");
});

test("task loop refuses non-automated providers before dispatch or revision adapters run", async () => {
  const cwd = tempRepo();
  const config = {
    ...resolveRunConfig(runRegistry(), "mock-core-loop").config,
    role_matrix: "claude-local-matrix",
  };
  const badMatrix = {
    schema_version: 1,
    matrix_id: "claude-local-matrix",
    roles: {
      builder: [{ provider: "claude-local", model: "claude-cli", effort: "default", instances: 1 }],
      reviewer: [{ provider: "openai-codex", model: "codex-review", effort: "default", instances: 1 }],
      redteam: [{ provider: "openai-codex", model: "codex-redteam", effort: "default", instances: 1 }],
    },
  };
  const adapterCalls = { candidates: 0 };
  const revisionCalls = { revisions: 0 };
  const result = await runTaskLoop(config, {
    chainRegistry: chainRegistry(),
    roleMatrix: badMatrix,
  }, {
    cwd,
    now: NOW,
    seed: 7,
    adapter: {
      runCandidate() {
        adapterCalls.candidates += 1;
        throw new Error("should not launch");
      },
    },
    revisionAdapter: {
      runRevision() {
        revisionCalls.revisions += 1;
        throw new Error("should not revise");
      },
    },
  });

  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "matrix-provider-not-automated:claude-local");
  assert.equal(adapterCalls.candidates, 0);
  assert.equal(revisionCalls.revisions, 0);
});

test("task loop refuses a real-provider cast before any injected adapter or revision effect", async () => {
  const cwd = tempRepo();
  const config = {
    ...resolveRunConfig(runRegistry(), "mock-core-loop").config,
    role_matrix: "live-matrix",
  };
  const liveMatrix = {
    schema_version: 1,
    matrix_id: "live-matrix",
    roles: {
      builder: [{ provider: "openrouter", model: "vendor/builder", effort: "default", instances: 1 }],
      reviewer: [{ provider: "openai-codex", model: "codex-review", effort: "default", instances: 1 }],
      redteam: [{ provider: "github-copilot", model: "copilot-redteam", effort: "default", instances: 1 }],
    },
  };
  const injected = createNoLiveMockAdapter();
  const result = await runTaskLoop(config, {
    chainRegistry: chainRegistry(),
    roleMatrix: liveMatrix,
  }, {
    cwd,
    now: NOW,
    seed: 7,
    adapter: injected.dispatchAdapter,
    revisionAdapter: injected.revisionAdapter({ "proposal.txt": "HELIX_LOOP_PASS\n" }),
  });

  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "live-adapter-not-wired");
  assert.deepEqual(injected.calls, { candidates: 0, judges: 0, synthesis: 0, verifiers: 0, revisions: 0 });
  assert.equal(readFileSync(join(cwd, "proposal.txt"), "utf8"), "initial proposal\n");
});

test("task loop reports non-builder chains as not loop-runnable", async () => {
  const cwd = tempRepo();
  const config = {
    ...resolveRunConfig(runRegistry(), "mock-core-loop").config,
    chain: "scout",
  };
  const result = await runTaskLoop(config, {
    chainRegistry: chainRegistry(),
    roleMatrix: roleMatrix(),
    agentTeam: agentTeam(),
  }, {
    cwd,
    now: NOW,
    seed: 7,
  });

  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "chain-not-loop-runnable:scout");
});

test("task loop refuses configs carrying removed cost-control fields before adapters run", async () => {
  const cwd = tempRepo();
  const base = resolveRunConfig(runRegistry(), "mock-core-loop").config;
  const config = { ...base, token_budget: 1_000_000 };
  const adapterCalls = { candidates: 0 };
  const result = await runTaskLoop(config, {
    chainRegistry: chainRegistry(),
    roleMatrix: roleMatrix(),
    agentTeam: agentTeam(),
  }, {
    cwd,
    now: NOW,
    seed: 7,
    adapter: {
      runCandidate() {
        adapterCalls.candidates += 1;
        throw new Error("should not launch");
      },
    },
  });

  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "invalid-run-config");
  assert.equal(adapterCalls.candidates, 0);
});

test("preflight carries no profile and the loop still requires an injected clock", async () => {
  const config = resolveRunConfig(runRegistry(), "mock-core-loop").config;
  const registries = {
    chainRegistry: chainRegistry(),
    roleMatrix: roleMatrix(),
    agentTeam: agentTeam(),
  };
  const pre = preflightTaskLoopConfig(config, registries);
  assert.equal(pre.ok, true, JSON.stringify({ code: pre.code, detail: pre.detail }));
  assert.equal("profile" in pre, false);

  // runTaskLoop still needs deps.now for record timestamps (fail closed, no ambient clock).
  const cwd = tempRepo();
  const result = await runTaskLoop(config, registries, { cwd, seed: 7 });
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "missing-clock");
});
