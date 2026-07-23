// Read-only process boundary for authored command objective gates. The caller
// supplies an already-resolved executable and argv; no authored text is ever
// interpreted by a shell.

import {
  accessSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  rmSync, writeFileSync,
} from "node:fs";
import { devNull, tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const LINUX_SETUP = String.raw`
const { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } = require("node:fs");
const { dirname } = require("node:path");
const { spawnSync } = require("node:child_process");
const [root, cwd, executable, mount, chroot, setpriv, gitSource, gitMetadataKind, rawReadOnlyPaths, ...argv] = process.argv.slice(1);
let readOnlyPaths;
try { readOnlyPaths = JSON.parse(rawReadOnlyPaths); }
catch { process.exit(125); }
if (!Array.isArray(readOnlyPaths) || readOnlyPaths.some((path) => typeof path !== "string" || !path.startsWith("/"))
  || !["none", "file", "directory"].includes(gitMetadataKind)) process.exit(125);
const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: "ignore" });
  if (result.status !== 0) process.exit(125);
};
const directory = (path, mode = 0o755) => { mkdirSync(path, { recursive: true, mode }); };
const target = (source) => {
  const destination = root + source;
  directory(dirname(destination));
  if (existsSync(source) && require("node:fs").statSync(source).isDirectory()) directory(destination);
  else if (!existsSync(destination)) writeFileSync(destination, "");
  return destination;
};
const bindReadOnly = (source) => {
  if (!existsSync(source)) return;
  const destination = target(source);
  run(mount, ["--bind", source, destination]);
  run(mount, ["-o", "remount,bind,ro,nosuid,nodev", destination]);
};
run(mount, ["-t", "tmpfs", "-o", "nodev,nosuid,noexec,size=64m", "tmpfs", root]);
const systemRoots = ["/usr", "/bin", "/lib", "/lib64"];
for (const source of systemRoots) bindReadOnly(source);
directory(root + "/etc");
for (const source of ["/etc/ld.so.cache", "/etc/nsswitch.conf", "/etc/passwd", "/etc/group", "/etc/hosts", "/etc/resolv.conf"]) {
  if (!existsSync(source)) continue;
  const destination = target(source);
  copyFileSync(source, destination);
  chmodSync(destination, 0o444);
}
bindReadOnly("/etc/ssl");
directory(root + "/tmp", 0o1777);
run(mount, ["-t", "tmpfs", "-o", "nodev,nosuid,noexec,size=64m,mode=1777", "tmpfs", root + "/tmp"]);
bindReadOnly(cwd);
if (![cwd, ...systemRoots].some((source) => executable === source || executable.startsWith(source + "/"))) bindReadOnly(executable);
for (const source of readOnlyPaths) {
  if (![cwd, ...systemRoots].some((covered) => source === covered || source.startsWith(covered + "/"))) bindReadOnly(source);
}
if (gitMetadataKind === "directory") {
  run(mount, ["-t", "tmpfs", "-o", "nodev,nosuid,noexec,ro,size=64k,mode=0555", "tmpfs", root + cwd + "/.git"]);
} else if (gitMetadataKind === "file") {
  const mask = root + "/tmp/helix-git-metadata-mask";
  writeFileSync(mask, "");
  chmodSync(mask, 0o000);
  run(mount, ["--bind", mask, root + cwd + "/.git"]);
  run(mount, ["-o", "remount,bind,ro,nosuid,nodev", root + cwd + "/.git"]);
}
if (gitSource !== "-") {
  directory(root + "/tmp/helix-git");
  run(mount, ["--bind", gitSource, root + "/tmp/helix-git"]);
  run(mount, ["-o", "remount,bind,rw,nosuid,nodev", root + "/tmp/helix-git"]);
}
directory(root + "/dev");
run(mount, ["-t", "tmpfs", "-o", "nosuid,noexec,size=1m,mode=755", "tmpfs", root + "/dev"]);
for (const device of ["/dev/null", "/dev/zero", "/dev/random", "/dev/urandom"]) {
  const destination = target(device);
  run(mount, ["--bind", device, destination]);
}
chmodSync(root, 0o755);
const result = spawnSync(chroot, [root, setpriv,
  "--bounding-set=-all", "--inh-caps=-all", "--ambient-caps=-all", "--no-new-privs", "--",
  "/bin/sh", "-c", "cd \"$1\"; shift; exec \"$@\"", "helix-objective-gate", cwd,
  executable, ...argv], { env: process.env, stdio: "inherit" });
if (result.error || !Number.isInteger(result.status)) process.exit(125);
process.exit(result.status);
`;
export const LINUX_OBJECTIVE_GATE_NAMESPACE_FLAGS = Object.freeze([
  "--user", "--map-root-user", "--mount", "--net", "--ipc", "--pid", "--fork", "--kill-child=SIGKILL",
]);
const successfulProbes = new Map();

function executable(path) {
  try {
    accessSync(path, constants.X_OK);
    return realpathSync(path);
  } catch {
    return null;
  }
}

export function findTrustedObjectiveGateExecutable(name) {
  for (const directory of [
    "/usr/bin", "/bin", "/usr/sbin", "/sbin",
    "/run/current-system/sw/bin", "/nix/var/nix/profiles/default/bin",
  ]) {
    const path = join(directory, name);
    try {
      accessSync(path, constants.X_OK);
      return path;
    } catch { /* continue */ }
  }
  return null;
}

export function preflightObjectiveGateSandbox({
  platform = process.platform,
  find_trusted_executable = findTrustedObjectiveGateExecutable,
} = {}) {
  if (typeof find_trusted_executable !== "function") {
    return { ok: false, code: "objective-gate-sandbox-unavailable" };
  }
  if (platform === "darwin") {
    const sandbox = executable("/usr/bin/sandbox-exec");
    return sandbox ? { ok: true, mode: "darwin-sandbox-v1", sandbox } : { ok: false, code: "objective-gate-sandbox-unavailable" };
  }
  if (platform === "linux") {
    const unshare = find_trusted_executable("unshare");
    const mount = find_trusted_executable("mount");
    const chroot = find_trusted_executable("chroot");
    const setpriv = find_trusted_executable("setpriv");
    return unshare && mount && chroot && setpriv
      ? { ok: true, mode: "linux-namespace-v1", unshare, mount, chroot, setpriv }
      : { ok: false, code: "objective-gate-sandbox-unavailable" };
  }
  return { ok: false, code: "objective-gate-sandbox-unavailable" };
}

function sanitizedEnvironment(_env, home, command = null) {
  return Object.freeze({
    PATH: [...new Set([
      ...(typeof command === "string" && isAbsolute(command) ? [dirname(command)] : []),
      "/usr/bin",
      "/bin",
    ])].join(delimiter),
    HOME: home,
    TMPDIR: home,
    TMP: home,
    TEMP: home,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    NO_COLOR: "1",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
  });
}

function gitPreparationEnvironment(git, home) {
  return Object.freeze({
    ...sanitizedEnvironment({}, home, git),
  });
}

function nixQueryEnvironment(scratch) {
  const configRoot = join(scratch, "nix-config");
  const home = join(scratch, "nix-home");
  const temporary = join(scratch, "nix-tmp");
  const xdgConfig = join(scratch, "xdg-config");
  const xdgConfigDirs = join(scratch, "xdg-config-dirs");
  const xdgCache = join(scratch, "xdg-cache");
  const xdgData = join(scratch, "xdg-data");
  const xdgState = join(scratch, "xdg-state");
  for (const path of [
    configRoot, home, temporary, xdgConfig, xdgConfigDirs, xdgCache, xdgData, xdgState,
  ]) mkdirSync(path, { recursive: true, mode: 0o700 });
  writeFileSync(join(configRoot, "nix.conf"), "", { flag: "wx", mode: 0o600 });
  return Object.freeze({
    PATH: "/usr/bin:/bin",
    HOME: home,
    TMPDIR: temporary,
    TMP: temporary,
    TEMP: temporary,
    XDG_CONFIG_HOME: xdgConfig,
    XDG_CONFIG_DIRS: xdgConfigDirs,
    XDG_CACHE_HOME: xdgCache,
    XDG_DATA_HOME: xdgData,
    XDG_STATE_HOME: xdgState,
    LANG: "C",
    LC_ALL: "C",
    TZ: "UTC",
    NO_COLOR: "1",
    NIX_CONF_DIR: configRoot,
    NIX_USER_CONF_FILES: devNull,
    NIX_REMOTE: "daemon",
  });
}

function candidateGitMetadata(cwd) {
  const gitPath = resolve(cwd, ".git");
  let entry;
  try {
    entry = lstatSync(gitPath);
  } catch (error) {
    return error?.code === "ENOENT" ? { kind: "none", paths: [] } : null;
  }
  try {
    if (entry.isSymbolicLink()) return null;
    const metadataPaths = (gitDir) => {
      const paths = [gitDir, realpathSync(gitDir)];
      const commonPointer = join(gitDir, "commondir");
      let commonEntry;
      try { commonEntry = lstatSync(commonPointer); }
      catch (error) {
        if (error?.code === "ENOENT") return paths;
        return null;
      }
      if (commonEntry.isSymbolicLink() || !commonEntry.isFile()
        || commonEntry.size < 1 || commonEntry.size > 4_096) return null;
      const matched = readFileSync(commonPointer, "utf8").match(/^([^\0\r\n]+)\r?\n?$/);
      if (!matched) return null;
      const commonDir = isAbsolute(matched[1]) ? resolve(matched[1]) : resolve(gitDir, matched[1]);
      const commonDirEntry = lstatSync(commonDir);
      if (commonDirEntry.isSymbolicLink() || !commonDirEntry.isDirectory()) return null;
      return [...paths, commonDir, realpathSync(commonDir)];
    };
    if (entry.isDirectory()) {
      const paths = metadataPaths(gitPath);
      return paths == null ? null : { kind: "directory", paths: [...new Set(paths)] };
    }
    if (entry.isFile()) {
      if (entry.size < 1 || entry.size > 4_096) return null;
      const matched = readFileSync(gitPath, "utf8").match(/^gitdir: ([^\0\r\n]+)\r?\n?$/);
      if (!matched) return null;
      const gitDir = isAbsolute(matched[1]) ? resolve(matched[1]) : resolve(cwd, matched[1]);
      const gitDirEntry = lstatSync(gitDir);
      if (gitDirEntry.isSymbolicLink() || !gitDirEntry.isDirectory()) return null;
      const paths = metadataPaths(gitDir);
      if (paths == null) return null;
      return {
        kind: "file",
        paths: [...new Set([gitPath, realpathSync(gitPath), ...paths])],
      };
    }
    return null;
  } catch { return null; }
}

function commandResult(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], ...options });
  return result.status === 0 ? result.stdout.trim() : null;
}

function createSanitizedGitView(cwd, scratch) {
  const git = executable("/usr/bin/git") ?? executable("/bin/git");
  if (!git) return null;
  const discoveryEnv = gitPreparationEnvironment(git, scratch);
  const candidateArgs = (...args) => [
    "-c", "core.fsmonitor=false",
    "-c", "core.untrackedCache=false",
    "-c", "core.hooksPath=/dev/null",
    "-c", "core.attributesFile=/dev/null",
    "-C", cwd,
    ...args,
  ];
  const head = commandResult(git, candidateArgs("rev-parse", "HEAD"), { env: discoveryEnv });
  const tree = commandResult(git, candidateArgs("rev-parse", "HEAD^{tree}"), { env: discoveryEnv });
  const objectFormat = commandResult(git, candidateArgs("rev-parse", "--show-object-format"), { env: discoveryEnv });
  if (head == null && tree == null) return { git_dir: null };
  const oidPattern = objectFormat === "sha256" ? /^[0-9a-f]{64}$/ : /^[0-9a-f]{40}$/;
  if (!oidPattern.test(head ?? "") || !oidPattern.test(tree ?? "") || !["sha1", "sha256"].includes(objectFormat)) return null;
  const maxGitSnapshotBytes = 64 * 1024 * 1024;
  const indexInfo = spawnSync(git, candidateArgs("ls-files", "--stage", "-z"), {
    env: discoveryEnv,
    maxBuffer: maxGitSnapshotBytes,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (indexInfo.status !== 0 || !Buffer.isBuffer(indexInfo.stdout)) return null;
  const indexOids = indexInfo.stdout.toString("utf8").split("\0").filter(Boolean).map((entry) => {
    const matched = entry.match(/^\d{6} ([0-9a-f]+) [0-3]\t/);
    return matched && oidPattern.test(matched[1]) ? matched[1] : null;
  });
  if (indexOids.some((oid) => oid == null)) return null;
  const gitDir = join(scratch, "git");
  mkdirSync(gitDir, { recursive: true });
  if (spawnSync(git, ["init", "--bare", `--object-format=${objectFormat}`, "-q", gitDir], {
    env: discoveryEnv, stdio: "ignore",
  }).status !== 0) return null;
  const gitEnv = { ...discoveryEnv, GIT_DIR: gitDir, GIT_WORK_TREE: cwd };
  for (const [key, value] of [
    ["core.bare", "false"],
    ["core.logallrefupdates", "false"],
    ["core.fsmonitor", "false"],
    ["core.untrackedcache", "false"],
    ["credential.helper", ""],
  ]) {
    if (spawnSync(git, ["--git-dir", gitDir, "config", "--local", key, value], {
      env: gitEnv, stdio: "ignore",
    }).status !== 0) return null;
  }
  const pack = spawnSync(git, candidateArgs("pack-objects", "--revs", "--stdout"), {
    env: discoveryEnv,
    input: Buffer.from(`${[tree, ...new Set(indexOids)].join("\n")}\n`, "utf8"),
    maxBuffer: maxGitSnapshotBytes,
    stdio: ["pipe", "pipe", "ignore"],
  });
  if (pack.status !== 0 || !Buffer.isBuffer(pack.stdout) || pack.stdout.length === 0
    || pack.stdout.length > maxGitSnapshotBytes) return null;
  if (spawnSync(git, ["--git-dir", gitDir, "index-pack", "--stdin"], {
    env: gitEnv,
    input: pack.stdout,
    maxBuffer: 1024 * 1024,
    stdio: ["pipe", "ignore", "ignore"],
  }).status !== 0) return null;
  const commitEnv = {
    ...gitEnv,
    GIT_AUTHOR_NAME: "Helix Objective Gate",
    GIT_AUTHOR_EMAIL: "helix-objective-gate@example.invalid",
    GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
    GIT_COMMITTER_NAME: "Helix Objective Gate",
    GIT_COMMITTER_EMAIL: "helix-objective-gate@example.invalid",
    GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
  };
  const syntheticCommit = spawnSync(git, ["--git-dir", gitDir, "commit-tree", tree], {
    env: commitEnv,
    input: "Helix objective-gate snapshot\n",
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    stdio: ["pipe", "pipe", "ignore"],
  });
  const syntheticHead = syntheticCommit.status === 0 ? syntheticCommit.stdout.trim() : null;
  if (!oidPattern.test(syntheticHead ?? "")
    || spawnSync(git, ["update-ref", "refs/heads/helix-objective-gate", syntheticHead], {
      env: gitEnv, stdio: "ignore",
    }).status !== 0
    || spawnSync(git, ["read-tree", "--empty"], { env: gitEnv, stdio: "ignore" }).status !== 0
    || spawnSync(git, ["update-index", "-z", "--index-info"], {
      env: gitEnv,
      input: indexInfo.stdout,
      stdio: ["pipe", "ignore", "ignore"],
    }).status !== 0) return null;
  writeFileSync(join(gitDir, "HEAD"), "ref: refs/heads/helix-objective-gate\n", { mode: 0o600 });
  return { git_dir: gitDir };
}

function runtimeDependencyPaths(command, scratch) {
  if (!command.startsWith("/nix/store/")) return [];
  const parts = command.split("/");
  const runtimeRoot = parts.length > 4 ? parts.slice(0, 5).join("/") : null;
  const nixStore = findTrustedObjectiveGateExecutable("nix-store");
  if (!runtimeRoot || !nixStore) return null;
  let queryEnv;
  try { queryEnv = nixQueryEnvironment(scratch); }
  catch { return null; }
  const closure = commandResult(nixStore, [
    "--store", "daemon",
    "--option", "plugin-files", "",
    "--option", "substitute", "false",
    "--option", "substituters", "",
    "--option", "builders", "",
    "-qR", runtimeRoot,
  ], {
    cwd: scratch,
    env: queryEnv,
    shell: false,
    timeout: 30_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (closure == null) return null;
  const paths = closure.split("\n").filter(Boolean);
  return paths.length > 0 && paths.every((path) =>
    path.startsWith("/nix/store/") && path.length <= 4_096
    && !path.includes("\0") && resolve(path) === path)
    ? [...new Set(paths)].sort()
    : null;
}

function containsPath(parent, child) {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`);
}

function normalizedPath(path) {
  try { return realpathSync(path); }
  catch { return resolve(path); }
}

function unsafeAdmission(path, candidateRoots, gitMetadataPaths) {
  const normalized = normalizedPath(path);
  return candidateRoots.some((root) => containsPath(normalized, root))
    || gitMetadataPaths.some((metadataPath) =>
      containsPath(metadataPath, normalized) || containsPath(normalized, metadataPath));
}

const LINUX_IMPLICIT_READ_PATHS = Object.freeze([
  "/usr", "/bin", "/lib", "/lib64",
  "/etc/ld.so.cache", "/etc/nsswitch.conf", "/etc/passwd", "/etc/group",
  "/etc/hosts", "/etc/resolv.conf", "/etc/ssl",
  "/dev/null", "/dev/zero", "/dev/random", "/dev/urandom",
]);

function macReadPaths(command, scratch, readOnlyPaths, candidateRoots, gitMetadataPaths) {
  const fixed = [
    "/usr", "/bin", "/sbin", "/System", "/Library/Apple",
    "/private/etc/hosts", "/private/etc/resolv.conf", "/private/etc/nsswitch.conf",
    "/private/etc/passwd", "/private/etc/group", "/private/etc/ssl",
    "/dev/null", "/dev/random", "/dev/urandom",
    "/private/var/db/dyld", "/private/var/db/timezone", "/private/var/select",
    "/opt/homebrew/Cellar", "/opt/homebrew/opt", "/opt/homebrew/lib",
  ];
  const commandParts = command.split("/");
  const runtimeRoot = command.startsWith("/nix/store/") && commandParts.length > 4
    ? commandParts.slice(0, 5).join("/")
    : command;
  const paths = [...new Set([command, runtimeRoot, scratch, ...fixed, ...readOnlyPaths]
    .filter((path) => typeof path === "string" && path.startsWith("/")).flatMap((path) => {
      try { return [path, realpathSync(path)]; } catch { return [path]; }
    }))];
  return paths.some((path) => unsafeAdmission(path, candidateRoots, gitMetadataPaths))
    ? null
    : paths;
}

function macCandidateReadFilters(cwd) {
  let names;
  let roots;
  try {
    names = readdirSync(cwd);
    roots = [...new Set([cwd, realpathSync(cwd)])];
  } catch { return null; }
  if (names.length > 4_096) return null;
  const entries = [];
  for (const name of names) {
    if (name === ".git") continue;
    let entry;
    try { entry = lstatSync(join(cwd, name)); }
    catch { return null; }
    entries.push({ name, directory: entry.isDirectory() && !entry.isSymbolicLink() });
  }
  return roots.flatMap((root) => [
    `(literal ${JSON.stringify(root)})`,
    ...entries.map(({ name, directory }) => `(${directory ? "subpath" : "literal"} ${JSON.stringify(join(root, name))})`),
  ]);
}

export function prepareObjectiveGateSandbox({
  cwd,
  executable: command,
  args,
  platform = process.platform,
  env = process.env,
  readOnlyPaths = [],
  makeScratch = () => mkdtempSync(join(tmpdir(), "helix-objective-gate-")),
  removeScratch = (path) => rmSync(path, { recursive: true, force: true }),
} = {}) {
  const checked = preflightObjectiveGateSandbox({ platform, env });
  if (!checked.ok) return checked;
  let scratch;
  try { scratch = makeScratch(); }
  catch { return { ok: false, code: "objective-gate-sandbox-unavailable" }; }
  const cleanup = () => {
    try {
      if (existsSync(scratch)) removeScratch(scratch);
      return existsSync(scratch)
        ? { ok: false, code: "objective-gate-sandbox-cleanup-failed" }
        : { ok: true };
    } catch {
      return { ok: false, code: "objective-gate-sandbox-cleanup-failed" };
    }
  };
  const unavailableAfterCleanup = () => {
    const cleaned = cleanup();
    return cleaned.ok ? { ok: false, code: "objective-gate-sandbox-unavailable" } : cleaned;
  };
  try {
    let gitView;
    try { gitView = createSanitizedGitView(cwd, scratch); }
    catch { gitView = null; }
    const gitMetadata = candidateGitMetadata(cwd);
    if (!gitView || gitMetadata == null) return unavailableAfterCleanup();
    const runtimePaths = runtimeDependencyPaths(command, scratch);
    if (runtimePaths == null) return unavailableAfterCleanup();
    const candidateRoots = [...new Set([resolve(cwd), normalizedPath(cwd)])];
    const gitMetadataPaths = gitMetadata.paths.map(normalizedPath);
    const admittedReadPaths = [...new Set([...readOnlyPaths, ...runtimePaths].map(normalizedPath))];
    if (unsafeAdmission(command, candidateRoots, gitMetadataPaths)
      || admittedReadPaths.some((path) => unsafeAdmission(path, candidateRoots, gitMetadataPaths))
      || (platform === "linux" && LINUX_IMPLICIT_READ_PATHS
        .some((path) => unsafeAdmission(path, candidateRoots, gitMetadataPaths)))) {
      return unavailableAfterCleanup();
    }
    if (platform === "darwin") {
      const quotedScratch = JSON.stringify(realpathSync(scratch));
      const candidateReads = macCandidateReadFilters(cwd);
      if (candidateReads == null) return unavailableAfterCleanup();
      const readPaths = macReadPaths(command, scratch, admittedReadPaths, candidateRoots, gitMetadataPaths);
      if (readPaths == null) return unavailableAfterCleanup();
      const parents = new Set(["/"]);
      for (const path of [...readPaths, ...candidateRoots]) {
        let parent = dirname(path);
        while (parent !== "/") {
          parents.add(parent);
          parent = dirname(parent);
        }
      }
      const reads = [
        ...[...parents].map((path) => `(literal ${JSON.stringify(path)})`),
        ...candidateReads,
        ...readPaths.map((path) => `(subpath ${JSON.stringify(path)})`),
      ].join(" ");
      if (Buffer.byteLength(reads, "utf8") > 1024 * 1024) return unavailableAfterCleanup();
      const profile = `(version 1)\n(deny default)\n(allow process-exec)\n(allow process-fork)\n(allow signal (target self))\n(allow file-read* ${reads})\n(allow sysctl-read)\n(allow mach-lookup (global-name \"com.apple.system.logger\") (global-name \"com.apple.system.opendirectoryd.libinfo\") (global-name \"com.apple.system.opendirectoryd.membership\"))\n(allow file-write* (subpath ${quotedScratch}))\n(allow file-write-data (literal \"/dev/null\"))`;
      const gateEnv = gitView.git_dir == null ? sanitizedEnvironment(env, scratch, command) : {
        ...sanitizedEnvironment(env, scratch, command), GIT_DIR: gitView.git_dir, GIT_WORK_TREE: cwd,
      };
      return {
        ok: true,
        mode: checked.mode,
        command: checked.sandbox,
        args: ["-p", profile, command, ...args],
        options: {
          cwd,
          shell: false,
          stdio: "ignore",
          detached: true,
          env: gateEnv,
        },
        cleanup,
      };
    }
    const linuxRoot = join(scratch, "root");
    mkdirSync(linuxRoot, { recursive: true, mode: 0o700 });
    return {
      ok: true,
      mode: checked.mode,
      command: checked.unshare,
      args: [
        ...LINUX_OBJECTIVE_GATE_NAMESPACE_FLAGS,
        process.execPath, "-e", LINUX_SETUP,
        linuxRoot, cwd, command, checked.mount, checked.chroot, checked.setpriv,
        gitView.git_dir ?? "-", gitMetadata.kind, JSON.stringify(admittedReadPaths), ...args,
      ],
      options: {
        cwd,
        shell: false,
        stdio: "ignore",
        detached: true,
        env: gitView.git_dir == null ? sanitizedEnvironment(env, "/tmp", command) : {
          ...sanitizedEnvironment(env, "/tmp", command), GIT_DIR: "/tmp/helix-git", GIT_WORK_TREE: cwd,
        },
      },
      cleanup,
    };
  } catch {
    return unavailableAfterCleanup();
  }
}

export function probeObjectiveGateSandbox(cwd, { platform = process.platform, env = process.env } = {}) {
  let probeKey;
  try { probeKey = `${platform}\0${realpathSync(cwd)}`; }
  catch { return { ok: false, code: "objective-gate-sandbox-unavailable" }; }
  if (successfulProbes.has(probeKey)) return { ok: true, mode: successfulProbes.get(probeKey) };
  const command = platform === "win32" ? null : executable("/usr/bin/true") ?? executable("/bin/true");
  if (!command) return { ok: false, code: "objective-gate-sandbox-unavailable" };
  const prepared = prepareObjectiveGateSandbox({ cwd, executable: command, args: [], platform, env });
  if (!prepared.ok) return prepared;
  let result;
  try { result = spawnSync(prepared.command, prepared.args, prepared.options); }
  catch { result = null; }
  const cleaned = prepared.cleanup();
  if (result?.status === 0 && cleaned.ok) {
    successfulProbes.set(probeKey, prepared.mode);
    return { ok: true, mode: prepared.mode };
  }
  return { ok: false, code: cleaned.ok ? "objective-gate-sandbox-unavailable" : cleaned.code };
}
