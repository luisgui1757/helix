#!/usr/bin/env node
// helix-task-loop.mjs — staged task-loop entrypoint.
//
// Runs a named run config through the STAGED runner: chain stages + casts +
// per-run worktree + structural events + interrupt-safe resumable state.
// Default is no-live: a synthetic temp git repo and the mock adapter (the
// tracked configs are mock skeletons). Presence declares live intent, but this
// build has no staged live transport: any real-provider cast refuses as
// live-adapter-not-wired rather than executing the mock adapter under real ids.
//
//   node tools/loop/helix-task-loop.mjs [--config mock-core-loop] [--run-id ID]
//        [--repo PATH]      run against PATH (per-run worktree of that repo)
//        [--resume ID]      resume an interrupted run from its state file
//        [--summary]        summary verbosity (default: full event stream)
//        [--list-configs]

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { resolveRunConfig, validateRunConfigRegistry } from "../../dispatch/lib/run-configs.mjs";
import { hashRef } from "../../dispatch/lib/run-record.mjs";
import {
  runStagedTaskLoop,
  makeGitWorktreeEffect,
  validateRunnerState,
} from "../../dispatch/lib/runner.mjs";
import { loadPresetRegistry } from "../../dispatch/lib/presets.mjs";
import { loadSettings, toggleVector, DEFAULT_SETTINGS_REL_PATH } from "../../dispatch/lib/settings.mjs";
import { renderEventLine } from "../../dispatch/lib/events.mjs";
import { prepareRunDirectory, validateRunId } from "../../dispatch/lib/run-manager.mjs";
import {
  applyProfileToConfig,
  applyProfileToPresets,
  resolveActiveProfile,
} from "../../extensions/lib/helix-local.mjs";
import { helixStateRoot } from "../../extensions/lib/helix-paths.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const stateRoot = helixStateRoot();
const NOW = 1_751_731_200;

function usage(exitCode = 0) {
  console.log(`Usage:
  node tools/loop/helix-task-loop.mjs [--config mock-core-loop] [--run-id ID] [--repo PATH] [--resume ID] [--summary]
  node tools/loop/helix-task-loop.mjs --list-configs

Default: staged runner over a synthetic temp repo with the mock adapter (no-live).
--repo runs against a real repository via a per-run git worktree.`);
  process.exit(exitCode);
}

function readJson(rel) {
  return JSON.parse(readFileSync(join(root, rel), "utf8"));
}

function tempRepo() {
  const cwd = mkdtempSync(join(tmpdir(), "helix-task-loop-"));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "helix@example.invalid"], { cwd });
  execFileSync("git", ["config", "user.name", "Helix Loop"], { cwd });
  writeFileSync(join(cwd, "proposal.txt"), "initial proposal\n", "utf8");
  execFileSync("git", ["add", "proposal.txt"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "baseline"], { cwd });
  return cwd;
}

let configId = "mock-core-loop";
let configExplicit = false;
let runId = null;
let repo = null;
let resumeId = null;
let verbosity = "stream";
let list = false;
let peekedResumeState = null;

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--config") { configId = args[++i]; configExplicit = true; }
  else if (arg === "--run-id") runId = args[++i];
  else if (arg === "--repo") repo = args[++i];
  else if (arg === "--resume") resumeId = args[++i];
  else if (arg === "--summary") verbosity = "summary";
  else if (arg === "--list-configs") list = true;
  else if (arg === "-h" || arg === "--help") usage(0);
  else {
    console.error(JSON.stringify({ status: "fail-closed", code: "unknown-argument", detail: null }));
    usage(2);
  }
}

const runRegistry = readJson("dispatch/config/run-configs.json");
if (list) {
  const checked = validateRunConfigRegistry(runRegistry);
  if (!checked.valid) {
    console.error(JSON.stringify({ status: "fail-closed", code: "invalid-run-config-registry", detail: null }));
    process.exit(1);
  }
  for (const config of runRegistry.configs) console.log(`${config.id}\t${hashRef(config.description)}`);
  process.exit(0);
}

// On resume, the config is whatever the interrupted run recorded — read it from
// the state file so `--resume <id>` alone restores the SAME config, never the
// default. An explicit --config that disagrees fails closed (the runner also
// cross-checks). Resume needs the original repo: the per-run worktree lives
// under it, so a synthetic-temp-repo run cannot be resumed.
if (resumeId) {
  const resumeIdValid = validateRunId(resumeId);
  if (!resumeIdValid.ok) {
    console.error(JSON.stringify({ status: "fail-closed", code: resumeIdValid.code, detail: resumeIdValid.detail }));
    process.exit(1);
  }
  const statePath = join(stateRoot, "runs", resumeId, `${resumeId}.state.json`);
  if (!existsSync(statePath)) {
    console.error(JSON.stringify({ status: "fail-closed", code: "resume-state-missing", detail: resumeId }));
    process.exit(1);
  }
  try {
    peekedResumeState = JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    console.error(JSON.stringify({ status: "fail-closed", code: "resume-state-unreadable", detail: resumeId }));
    process.exit(1);
  }
  if (!validateRunnerState(peekedResumeState).valid) {
    console.error(JSON.stringify({ status: "fail-closed", code: "invalid-resume-state", detail: resumeId }));
    process.exit(1);
  }
  if (typeof peekedResumeState.config_id === "string") {
    if (repo == null) {
      console.error(JSON.stringify({ status: "fail-closed", code: "resume-requires-repo", detail: "pass --repo <the original repository>" }));
      process.exit(1);
    }
    // An explicit --config that disagrees with the interrupted run's config
    // fails closed rather than being silently overwritten.
    if (configExplicit && configId !== peekedResumeState.config_id) {
      console.error(JSON.stringify({ status: "fail-closed", code: "resume-config-mismatch", detail: "explicit-config-does-not-match-state" }));
      process.exit(1);
    }
    configId = peekedResumeState.config_id;
  }
}

const resolvedConfig = resolveRunConfig(runRegistry, configId);
if (!resolvedConfig.ok) {
  console.error(JSON.stringify({ status: "fail-closed", code: resolvedConfig.code, detail: resolvedConfig.detail }));
  process.exit(1);
}

// Apply the ACTIVE profile's saved cast (assignments/member lineups only —
// never chain/gate)
// so the CLI runs exactly what `/helix run` preflight showed and confirmed.
let effectiveConfig = resolvedConfig.config;
let activeProfile = { ok: true, profile: null };
if (!resumeId) {
  activeProfile = resolveActiveProfile(stateRoot);
  if (!activeProfile.ok) {
    console.error(JSON.stringify({ status: "fail-closed", code: activeProfile.code, detail: activeProfile.detail }));
    process.exit(1);
  }
  effectiveConfig = applyProfileToConfig(effectiveConfig, activeProfile.profile).config;
}

const safeRunId = resumeId ?? runId ?? `${configId}-run`;
const runIdValid = validateRunId(safeRunId);
if (!runIdValid.ok) {
  console.error(JSON.stringify({ status: "fail-closed", code: runIdValid.code, detail: runIdValid.detail }));
  process.exit(1);
}

// User-local settings (absent file = all toggles ON; corrupt file fails closed).
let toggles = peekedResumeState?.toggles ?? null;
if (!resumeId) {
  const settingsResult = loadSettings(join(stateRoot, DEFAULT_SETTINGS_REL_PATH));
  if (!settingsResult.ok) {
    console.error(JSON.stringify({ status: "fail-closed", code: settingsResult.code, detail: settingsResult.detail }));
    process.exit(1);
  }
  toggles = toggleVector(settingsResult.settings);
}

const presetsResult = loadPresetRegistry(join(root, "dispatch/config/matrices"));
if (!presetsResult.ok) {
  console.error(JSON.stringify({ status: "fail-closed", code: presetsResult.code, detail: presetsResult.detail }));
  process.exit(1);
}
const profiledPresets = resumeId
  ? { ok: true, presets: presetsResult.presets }
  : applyProfileToPresets(presetsResult.presets, activeProfile.profile);
if (!profiledPresets.ok) {
  console.error(JSON.stringify({ status: "fail-closed", code: profiledPresets.code, detail: profiledPresets.detail }));
  process.exit(1);
}

let baseRepo = repo;
let tempRepoCreated = false;
let exitCode = 0;

try {
  if (!baseRepo) {
    baseRepo = tempRepo();
    tempRepoCreated = true;
  }
  const recordsRoot = join(stateRoot, "runs");
  const recordsPath = join(recordsRoot, safeRunId);
  const recordsReplaced = false;
  let runDirPath;
  if (resumeId) {
    runDirPath = recordsPath; // resume appends to the existing run directory
  } else {
    // Every existing id is durable evidence, including corrupt/incomplete
    // directories. Replacement is never implicit.
    if (existsSync(recordsPath)) {
      console.error(JSON.stringify({
        status: "fail-closed",
        code: "fresh-run-id-exists",
        detail: `run '${safeRunId}' already exists; resume it or choose a new --run-id`,
      }));
      process.exit(1);
    }
    const runDir = prepareRunDirectory(recordsRoot, safeRunId, { clean: false });
    if (!runDir.ok) {
      console.error(JSON.stringify({ status: "fail-closed", code: runDir.code, detail: runDir.detail }));
      process.exit(1);
    }
    runDirPath = runDir.path;
  }

  let resumeState = null;
  if (resumeId) {
    resumeState = peekedResumeState;
  }

  const result = await runStagedTaskLoop(effectiveConfig, {
    chainRegistry: readJson("dispatch/config/chains.json"),
    presets: profiledPresets.presets,
  }, {
    cwd: baseRepo,
    now: NOW,
    seed: 7,
    run_id: safeRunId,
    toggles,
    record_dir: runDirPath,
    state_dir: runDirPath,
    worktree: makeGitWorktreeEffect(baseRepo, tempRepoCreated ? { baseDir: join(baseRepo, ".wt") } : {}),
    events: {
      dir: runDirPath,
      monotonic: () => performance.now(),
      onEvent: (event) => {
        // This CLI is already the plain-line degeneration. visual-cues OFF must
        // not become an undocumented summary filter; only --summary changes
        // event verbosity.
        const line = renderEventLine(event, { verbosity });
        if (line) console.log(line);
      },
    },
    ...(resumeState ? { resume_state: resumeState } : {}),
  });

  const out = {
    status: result.status,
    code: result.code ?? null,
    run_id: result.run_id,
    chain_id: result.chain_id ?? null,
    converged: result.converged ?? false,
    stop_reason: result.stop_reason ?? null,
    total_passes: result.total_passes ?? 0,
    cast: result.cast ?? null,
    noop: result.noop ?? false,
    warnings: result.warnings ?? [],
    worktree_branch: result.worktree_branch ?? null,
    events_path: result.events_path ? relative(stateRoot, result.events_path) : null,
    state_path: result.state_path ? relative(stateRoot, result.state_path) : null,
    records_replaced: recordsReplaced,
    synthetic_worktree_cleaned: tempRepoCreated,
  };
  console.log(JSON.stringify(out, null, 2));
  exitCode = result.ok ? 0 : 1;
} catch {
  console.error(JSON.stringify({ status: "fail-closed", code: "task-loop-cli-failed", detail: null }));
  exitCode = 1;
} finally {
  if (tempRepoCreated) rmSync(baseRepo, { recursive: true, force: true });
}
process.exit(exitCode);
