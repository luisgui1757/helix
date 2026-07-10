import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, symlinkSync, chmodSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir, devNull } from "node:os";
import { join } from "node:path";
import { makeModelRevision, REVISION_CODES } from "../dispatch/lib/revision-effect.mjs";
import { runDebate } from "../dispatch/lib/debate.mjs";
import { makeGitDiffStability } from "../dispatch/lib/git-diff-surface.mjs";
import { stableStringify } from "../dispatch/lib/run-record.mjs";
import { makeEnvelope } from "../dispatch/fixtures/sample.mjs";

const NOW = 1_751_731_200; // fixed epoch seconds — determinism over wall clock
const SEED = 7;

// A model adapter that returns fixed whole-file edits and counts its calls, so a
// test can assert the adapter was NEVER reached when the boundary refuses first.
function countingAdapter(edits) {
  return {
    calls: 0,
    runRevision(_input, _ctx) {
      this.calls += 1;
      return { edits };
    },
  };
}

// The minimal, complete config: exactly { cwd, builder } (owner YOLO decision —
// no profile/input_class/allow/caps; containment is the only write fence).
function revisionConfig(cwd, overrides = {}) {
  return {
    cwd,
    builder: { provider: "mock", model: "mock-model" },
    ...overrides,
  };
}

function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function readdirLength(dir) {
  return readdirSync(dir).length;
}

// ----------------------------------------------------------------------------
// No provider/cost gating: any Prime provider builder reaches the adapter
// ----------------------------------------------------------------------------

test("any Prime provider builder is accepted — no cost/eligibility gate before the adapter", async () => {
  const cwd = tmp("prime-rev-");
  try {
    // These providers were refused under the demolished cost policy; presence = live
    // now, so the effect goes straight to the injected adapter for all of them.
    for (const builder of [
      { provider: "openai-api", model: "gpt" },
      { provider: "azure-foundry", model: "az" },
      { provider: "openrouter", model: "vendor/x" },
      { provider: "github-copilot", model: "github-copilot/gpt-5-mini" },
    ]) {
      const adapter = countingAdapter([{ path: "proposal.txt", content: "x" }]);
      const revise = makeModelRevision(revisionConfig(cwd, { builder }), { modelAdapter: adapter });
      const result = await revise(null, { run_id: "r-iter1", iteration: 1 });
      assert.equal(result.ok, true, JSON.stringify({ builder, result }));
      assert.equal(result.code, REVISION_CODES.APPLIED);
      assert.equal(adapter.calls, 1, `${builder.provider} reached the adapter`);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ----------------------------------------------------------------------------
// Config / wiring fail closed with stable codes
// ----------------------------------------------------------------------------

test("a config still carrying removed cost-control fields fails closed as invalid", async () => {
  // The config schema is exactly { cwd, builder } with additionalProperties:false —
  // demolished fields are rejected structurally, never silently ignored.
  const cwd = tmp("prime-rev-");
  try {
    const legacies = [
      { profile: "no-spend-test" },
      { input_class: "synthetic" },
      { allow: ["proposal.txt"] },
      { caps: { max_edits: 4, max_bytes: 10_000 } },
    ];
    for (const legacy of legacies) {
      const adapter = countingAdapter([{ path: "proposal.txt", content: "x" }]);
      const revise = makeModelRevision(revisionConfig(cwd, legacy), { modelAdapter: adapter });
      const result = await revise(null, { run_id: "r", iteration: 1 });
      assert.equal(result.ok, false, JSON.stringify(legacy));
      assert.equal(result.code, REVISION_CODES.INVALID_CONFIG, JSON.stringify(legacy));
      assert.equal(adapter.calls, 0, "the model adapter is never reached");
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a malformed config, bad cwd, or missing adapter fails closed before any model call", async () => {
  const cwd = tmp("prime-rev-");
  try {
    const adapter = countingAdapter([{ path: "proposal.txt", content: "x" }]);
    // Missing required builder.
    let r = await makeModelRevision({ cwd }, { modelAdapter: adapter })(null, {});
    assert.equal(r.code, REVISION_CODES.INVALID_CONFIG);
    // Unknown provider string.
    r = await makeModelRevision(revisionConfig(cwd, { builder: { provider: "not-a-provider", model: "m" } }), { modelAdapter: adapter })(null, {});
    assert.equal(r.code, REVISION_CODES.INVALID_CONFIG);
    // URI-shaped model string.
    r = await makeModelRevision(revisionConfig(cwd, { builder: { provider: "mock", model: "https:" + "/example.test/model" } }), { modelAdapter: adapter })(null, {});
    assert.equal(r.code, REVISION_CODES.INVALID_CONFIG);
    // cwd does not exist / is not a directory.
    r = await makeModelRevision(revisionConfig(join(cwd, "missing")), { modelAdapter: adapter })(null, {});
    assert.equal(r.code, REVISION_CODES.UNSAFE_PATH);
    // Missing adapter.
    r = await makeModelRevision(revisionConfig(cwd), {})(null, {});
    assert.equal(r.code, REVISION_CODES.MISSING_ADAPTER);
    assert.equal(adapter.calls, 0, "none of these reached the model");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ----------------------------------------------------------------------------
// Malformed model output fails closed and never leaks model text
// ----------------------------------------------------------------------------

test("malformed model output fails closed without surfacing model text", async () => {
  const cwd = tmp("prime-rev-");
  try {
    const LEAK = "SECRET-MODEL-NARRATIVE-ZZZ";
    for (const bad of [LEAK, { edits: [] }, { edits: [{ path: "proposal.txt" }] }, { edits: [{ path: "proposal.txt", content: 5 }] }, { edits: [{ path: "proposal.txt", content: LEAK, extra: 1 }] }, { notes: LEAK }]) {
      const adapter = { calls: 0, runRevision() { this.calls += 1; return bad; } };
      const revise = makeModelRevision(revisionConfig(cwd), { modelAdapter: adapter });
      const result = await revise(null, { run_id: "r", iteration: 1 });
      assert.equal(result.ok, false, JSON.stringify(bad));
      assert.equal(result.code, REVISION_CODES.MALFORMED);
      assert.ok(!stableStringify(result).includes(LEAK), "model text must not surface in the result");
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ----------------------------------------------------------------------------
// Worktree write safety: CONTAINMENT only (traversal/absolute/escape refused;
// anything inside the tree is writable — owner YOLO decision)
// ----------------------------------------------------------------------------

test("traversal, absolute, and null-byte write paths fail closed and mutate nothing", async () => {
  const cwd = tmp("prime-rev-");
  const outside = tmp("prime-rev-out-");
  try {
    const before = readdirLength(cwd);
    // The REAL destinations `../escape.txt` and `/etc/passwd` would resolve to
    // (asserted below so the "nothing escaped" check is actually falsifiable).
    const parentEscape = join(cwd, "..", "escape.txt"); // where ../escape.txt lands
    for (const path of ["../escape.txt", "/etc/passwd", "evil\0.txt", "a/../escape.txt"]) {
      const adapter = countingAdapter([{ path, content: "MALICIOUS" }]);
      const revise = makeModelRevision(revisionConfig(cwd), { modelAdapter: adapter });
      const result = await revise(null, { run_id: "r", iteration: 1 });
      assert.equal(result.ok, false, path);
      assert.equal(result.code, REVISION_CODES.UNSAFE_PATH, path);
    }
    assert.equal(readdirLength(cwd), before, "no file was written by any refused revision");
    // The actual parent-dir escape target of `../escape.txt` — a path the code
    // COULD reach if containment were broken, so this assertion can fail.
    assert.ok(!existsSync(parentEscape), "the ../escape.txt target was never written");
    assert.ok(!existsSync(join(outside, "escape.txt")), "nothing escaped the tree");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("an in-tree secret-shaped filename IS writable (containment only, no denylist)", async () => {
  // Owner YOLO decision (2026-07-09): the write fence is worktree containment, not
  // filename shape. A secret-shaped path INSIDE the tree is a legitimate edit target.
  const cwd = tmp("prime-rev-");
  try {
    const adapter = countingAdapter([
      { path: ".env", content: "SYNTHETIC_FIXTURE=1\n" },
      { path: "auth.json", content: "{\"synthetic\":true}\n" },
      { path: "config-secret.json", content: "{}\n" },
    ]);
    const revise = makeModelRevision(revisionConfig(cwd), { modelAdapter: adapter });
    const result = await revise(null, { run_id: "r", iteration: 1 });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.code, REVISION_CODES.APPLIED);
    assert.equal(adapter.calls, 1);
    assert.equal(readFileSync(join(cwd, ".env"), "utf8"), "SYNTHETIC_FIXTURE=1\n");
    assert.equal(readFileSync(join(cwd, "auth.json"), "utf8"), "{\"synthetic\":true}\n");
    assert.equal(readFileSync(join(cwd, "config-secret.json"), "utf8"), "{}\n");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a symlinked existing target is refused (never followed/overwritten)", async () => {
  const cwd = tmp("prime-rev-");
  const outside = tmp("prime-rev-out-");
  try {
    writeFileSync(join(outside, "target.txt"), "outside-secret");
    // proposal.txt is a symlink pointing outside the tree.
    symlinkSync(join(outside, "target.txt"), join(cwd, "proposal.txt"));
    const adapter = countingAdapter([{ path: "proposal.txt", content: "OVERWRITE" }]);
    const revise = makeModelRevision(revisionConfig(cwd), { modelAdapter: adapter });
    const result = await revise(null, { run_id: "r", iteration: 1 });
    assert.equal(result.code, REVISION_CODES.UNSAFE_PATH);
    assert.equal(readFileSync(join(outside, "target.txt"), "utf8"), "outside-secret", "symlink target untouched");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("a write through a symlinked parent that escapes the tree is refused", async () => {
  const cwd = tmp("prime-rev-");
  const outside = tmp("prime-rev-out-");
  try {
    // cwd/sub -> outside: a new file under sub/ would land outside the work tree.
    symlinkSync(outside, join(cwd, "sub"));
    const adapter = countingAdapter([{ path: "sub/leak.txt", content: "ESCAPED" }]);
    const revise = makeModelRevision(revisionConfig(cwd), { modelAdapter: adapter });
    const result = await revise(null, { run_id: "r", iteration: 1 });
    assert.equal(result.ok, false);
    assert.equal(result.code, REVISION_CODES.UNSAFE_PATH);
    assert.ok(!existsSync(join(outside, "leak.txt")), "nothing was written outside the tree");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("a non-file target (existing directory) is refused", async () => {
  const cwd = tmp("prime-rev-");
  try {
    mkdirSync(join(cwd, "a-dir"));
    const adapter = countingAdapter([{ path: "a-dir", content: "CLOBBER" }]);
    const revise = makeModelRevision(revisionConfig(cwd), { modelAdapter: adapter });
    const result = await revise(null, { run_id: "r", iteration: 1 });
    assert.equal(result.ok, false);
    assert.equal(result.code, REVISION_CODES.UNSAFE_PATH);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a disk write failure rolls back earlier edits", async () => {
  const cwd = tmp("prime-rev-");
  try {
    writeFileSync(join(cwd, "a.txt"), "old-a");
    writeFileSync(join(cwd, "b.txt"), "old-b");
    chmodSync(join(cwd, "b.txt"), 0o444);

    const adapter = countingAdapter([
      { path: "a.txt", content: "new-a" },
      { path: "b.txt", content: "new-b" },
    ]);
    const revise = makeModelRevision(revisionConfig(cwd), { modelAdapter: adapter });

    const result = await revise(null, { run_id: "r", iteration: 1 });
    assert.equal(result.ok, false);
    assert.equal(result.code, REVISION_CODES.WRITE_FAILED);
    assert.equal(readFileSync(join(cwd, "a.txt"), "utf8"), "old-a", "earlier write rolled back");
    assert.equal(readFileSync(join(cwd, "b.txt"), "utf8"), "old-b", "failed target preserved");
  } finally {
    if (existsSync(join(cwd, "b.txt"))) chmodSync(join(cwd, "b.txt"), 0o644);
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ----------------------------------------------------------------------------
// The happy path really mutates the worktree and returns a structural ref
// ----------------------------------------------------------------------------

test("a valid revision writes the worktree and returns a sha256 ref (not canned)", async () => {
  const cwd = tmp("prime-rev-");
  try {
    const adapter = countingAdapter([{ path: "draft.txt", content: "revised-by-model\n" }]);
    const revise = makeModelRevision(revisionConfig(cwd), { modelAdapter: adapter });
    const result = await revise(null, { run_id: "r", iteration: 1 });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.code, "revision-applied");
    assert.match(result.revision_ref, /^sha256:[0-9a-f]{64}$/);
    assert.equal(readFileSync(join(cwd, "draft.txt"), "utf8"), "revised-by-model\n", "the model's edit actually landed on disk");
    assert.equal(adapter.calls, 1);
    // The ref is a content hash: different content ⇒ different ref (not canned).
    const other = makeModelRevision(revisionConfig(cwd), { modelAdapter: countingAdapter([{ path: "draft.txt", content: "DIFFERENT\n" }]) });
    const r2 = await other(null, {});
    assert.notEqual(r2.revision_ref, result.revision_ref);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a thrown model adapter fails closed as revision-adapter-failed without leaking its message", async () => {
  const cwd = tmp("prime-rev-");
  // Split literal so repo-wide public-safety scanners do not self-match this source.
  const HOMEISH = "/Us" + "ers/alice/private/secret.diff";
  try {
    const adapter = { calls: 0, runRevision() { this.calls += 1; throw new Error(HOMEISH); } };
    const revise = makeModelRevision(revisionConfig(cwd), { modelAdapter: adapter });
    const result = await revise(null, { run_id: "r", iteration: 1 });
    assert.equal(result.code, REVISION_CODES.ADAPTER_FAILED);
    assert.ok(!stableStringify(result).includes("secret.diff") && !stableStringify(result).includes(HOMEISH), "thrown message must not surface");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ----------------------------------------------------------------------------
// Real temp-repo DEBATE: the module mutates the proposal and converges only
// after diff-stability + objective-gate-pass
// ----------------------------------------------------------------------------

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_SYSTEM: devNull,
  GIT_AUTHOR_NAME: "prime-test",
  GIT_AUTHOR_EMAIL: "prime@test.invalid",
  GIT_COMMITTER_NAME: "prime-test",
  GIT_COMMITTER_EMAIL: "prime@test.invalid",
  LC_ALL: "C",
  TZ: "UTC",
};

function gitCmd(cwd, args) {
  const res = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr || res.stdout}`);
}

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "prime-rev-git-"));
  gitCmd(dir, ["init", "-q"]);
  writeFileSync(join(dir, "proposal.txt"), "base\n");
  gitCmd(dir, ["add", "proposal.txt"]);
  gitCmd(dir, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "base"]);
  return dir;
}

// risky-change base request (builder + reviewer + redteam; objective gate; adversarial).
function riskyBase(overrides = {}) {
  return {
    run_id: "base-placeholder",
    task: { class_hint: "risky-change", confident: true },
    candidates: [
      { role: "builder", provider: "mock", model: "mock-model" },
      { role: "reviewer", provider: "mock", model: "mock-model" },
      { role: "redteam", provider: "mock", model: "mock-model" },
    ],
    run_target: { repo: "self" },
    claims_ref: "local-ref:claims/rev",
    evidence_ref: "local-ref:evidence/rev",
    ...overrides,
  };
}
function debateAdapter() {
  return { runCandidate: (s, ctx) => makeEnvelope({ run_id: ctx.run_id, role: s.role, provider: s.provider, model: s.model, recommendation: "ok" }) };
}
function gate(result) {
  return () => ({ command_names: ["relevant-tests", "risk-gate"], result, source: "deterministic-checker" });
}

test("a real temp-repo debate: the model-backed revision mutates the proposal and converges on diff-stability + gate-pass", async () => {
  const repo = makeRepo();
  const records = tmp("prime-rev-rec-"); // kept OUT of the repo tree (avoid untracked churn)
  try {
    // The model returns a CONSTANT proposal: iteration 1's revision changes the tree,
    // iteration 2's is a no-op, so the real git diff surface reports diff-stable and
    // the debate converges — only after the objective gate also passes.
    const adapter = countingAdapter([{ path: "proposal.txt", content: "base\nrevised-by-model\n" }]);
    const revise = makeModelRevision(revisionConfig(repo), { modelAdapter: adapter });
    const result = await runDebate(
      { run_id: "rev-conv", base_request: riskyBase(), max_iterations: 5 },
      { adapter: debateAdapter(), runGate: gate("pass"), now: NOW, seed: SEED, mode: "tui", record_dir: records, diffStability: makeGitDiffStability({ cwd: repo }), revise },
    );
    assert.equal(result.status, "ok", JSON.stringify({ code: result.code, detail: result.detail }));
    assert.equal(result.converged, true);
    assert.equal(result.iterations_run, 3, "baseline → changing → stable");
    assert.deepEqual(result.iterations.map((it) => it.diff_code), ["diff-baseline", "diff-changing", "diff-stable"]);
    // The revision ran after iterations 1 and 2 (not after the converged one) and the
    // worktree actually holds the model's proposal.
    assert.equal(result.revisions.length, 2);
    assert.equal(adapter.calls, 2, "the model adapter was really called between iterations");
    assert.equal(readFileSync(join(repo, "proposal.txt"), "utf8"), "base\nrevised-by-model\n");
    for (const r of result.revisions) assert.match(r.revision_ref, /^sha256:[0-9a-f]{64}$/);
    // No raw diff / model text / private path in the persisted summary.
    const persisted = readFileSync(result.summary_path, "utf8");
    for (const needle of ["revised-by-model", "/Us" + "ers/", "proposal.txt"]) {
      assert.ok(!persisted.includes(needle), `summary must not contain '${needle}'`);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(records, { recursive: true, force: true });
  }
});

test("a legacy-config revision inside a debate fails closed before the model adapter is called", async () => {
  const repo = makeRepo();
  const records = tmp("prime-rev-rec-");
  try {
    // A config still carrying a demolished field is structurally invalid → the
    // revision refuses before the model adapter, so the debate fails closed with the
    // stable subcode and the adapter call count stays 0.
    const adapter = countingAdapter([{ path: "proposal.txt", content: "should-never-be-written\n" }]);
    const revise = makeModelRevision(revisionConfig(repo, { profile: "no-spend-test" }), { modelAdapter: adapter });
    const result = await runDebate(
      // The diff never stabilizes on its own, so the loop must revise.
      { run_id: "rev-refuse", base_request: riskyBase(), max_iterations: 5 },
      { adapter: debateAdapter(), runGate: gate("pass"), now: NOW, seed: SEED, mode: "tui", record_dir: records, diffStability: makeGitDiffStability({ cwd: repo }), revise },
    );
    assert.equal(result.status, "fail-closed");
    assert.equal(result.code, "revision-failed");
    assert.match(result.detail, /revision-subcode:invalid-revision-config/);
    assert.equal(adapter.calls, 0, "the model adapter is never reached");
    assert.equal(readFileSync(join(repo, "proposal.txt"), "utf8"), "base\n", "the worktree is untouched");
    assert.equal(result.iterations_run, 1, "the first iteration's evidence is preserved");
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(records, { recursive: true, force: true });
  }
});

test("a revision whose model adapter throws preserves prior iteration evidence and leaks nothing", async () => {
  const repo = makeRepo();
  const records = tmp("prime-rev-rec-");
  const HOMEISH = "/Us" + "ers/bob/secret-plan.diff";
  try {
    let calls = 0;
    const adapter = {
      get calls() { return calls; },
      runRevision(_i, _c) {
        calls += 1;
        if (calls === 1) { writeFileSync(join(repo, "proposal.txt"), "base\nround-1\n"); return { edits: [{ path: "proposal.txt", content: "base\nround-1\n" }] }; }
        throw new Error(HOMEISH);
      },
    };
    const revise = makeModelRevision(revisionConfig(repo), { modelAdapter: adapter });
    const result = await runDebate(
      { run_id: "rev-throw", base_request: riskyBase(), max_iterations: 5 },
      { adapter: debateAdapter(), runGate: gate("pass"), now: NOW, seed: SEED, mode: "tui", record_dir: records, diffStability: makeGitDiffStability({ cwd: repo }), revise },
    );
    assert.equal(result.status, "fail-closed");
    assert.equal(result.code, "revision-failed");
    assert.match(result.detail, /revision-subcode:revision-adapter-failed/);
    assert.equal(result.iterations_run, 2, "iterations before the failed revision are preserved");
    assert.equal(result.revisions.length, 1, "only the first successful revision is recorded");
    const persisted = existsSync(result.summary_path) ? readFileSync(result.summary_path, "utf8") : "";
    for (const blob of [result.detail, stableStringify(result.summary ?? {}), JSON.stringify(result.warnings), persisted]) {
      assert.ok(!blob.includes(HOMEISH) && !blob.includes("secret-plan.diff") && !blob.includes("/Us" + "ers/"), `leaked into: ${blob}`);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(records, { recursive: true, force: true });
  }
});

test("a fixed input yields byte-identical debate summaries across two runs (determinism)", async () => {
  const run = async () => {
    const repo = makeRepo();
    const records = tmp("prime-rev-rec-");
    try {
      const revise = makeModelRevision(revisionConfig(repo), { modelAdapter: countingAdapter([{ path: "proposal.txt", content: "base\nrevised-by-model\n" }]) });
      const result = await runDebate(
        { run_id: "rev-det", base_request: riskyBase(), max_iterations: 5 },
        { adapter: debateAdapter(), runGate: gate("pass"), now: NOW, seed: SEED, mode: "tui", record_dir: records, diffStability: makeGitDiffStability({ cwd: repo }), revise },
      );
      return result;
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(records, { recursive: true, force: true });
    }
  };
  const a = await run();
  const b = await run();
  assert.equal(a.status, "ok");
  assert.equal(stableStringify(a.summary), stableStringify(b.summary), "same input ⇒ byte-identical summary (independent of the temp commit hash)");
  assert.deepEqual(a.revisions.map((r) => r.revision_ref), b.revisions.map((r) => r.revision_ref));
});
