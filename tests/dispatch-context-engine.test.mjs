// Context engine: prompt compiler (hashes, never text), handoff packets
// (fresh context; adapter inputs vs structural projections), disagreement log
// (open entries never dropped), transcript degeneration, pressure events.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { compileStepPrompt, COMPILER_CODES } from "../dispatch/lib/prompt-compiler.mjs";
import {
  buildHandoffPacket,
  buildTranscriptHandoff,
  packetRecord,
  extractDisagreements,
  makeDisagreementLog,
  validateDisagreementDocument,
} from "../dispatch/lib/handoff.mjs";
import { makeEventLog, validateEvent, validateEventHistory } from "../dispatch/lib/events.mjs";
import { runStagedTaskLoop, makeGitWorktreeEffect, createStagedMockAdapter } from "../dispatch/lib/runner.mjs";
import { loadPresetRegistry } from "../dispatch/lib/presets.mjs";

const NOW = 1_751_731_200;
const templatesDir = new URL("../dispatch/config/templates/", import.meta.url).pathname;
const briefsDir = new URL("../dispatch/config/agents/", import.meta.url).pathname;
const presets = loadPresetRegistry(new URL("../dispatch/config/matrices/", import.meta.url).pathname).presets;
const chainRegistry = JSON.parse(readFileSync(new URL("../dispatch/config/chains.json", import.meta.url), "utf8"));
const baseConfig = JSON.parse(readFileSync(new URL("../dispatch/config/run-configs.json", import.meta.url), "utf8")).configs[0];

test("every dispatch role has a tracked brief and compiles through the tracked template", () => {
  const roles = ["scout", "planner", "builder", "reviewer", "redteam", "judge", "synthesizer", "verifier", "documenter"];
  for (const role of roles) {
    const compiled = compileStepPrompt({
      template_id: "step-prompt-v1",
      templates_dir: templatesDir,
      briefs_dir: briefsDir,
      role,
      fields: { chain_id: "full-cycle", stage_id: "plan", pass: 1, gate_summary: "g", task_instruction: "t", handoff: "h" },
    });
    assert.equal(compiled.ok, true, `${role}: ${JSON.stringify(compiled)}`);
    assert.match(compiled.prompt, new RegExp(role === "redteam" ? "Red Team" : role, "i"));
    // The structural record carries hashes only — no compiled text, no brief text.
    assert.match(compiled.record.template_hash, /^sha256:[0-9a-f]{64}$/);
    assert.match(compiled.record.brief_ref, /^sha256:[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(compiled.record).includes("You are one member"));
  }
});

test("the compiler fails closed on missing template/brief and unresolved placeholders", () => {
  const args = {
    template_id: "step-prompt-v1", templates_dir: templatesDir, briefs_dir: briefsDir, role: "builder",
    fields: { chain_id: "c", stage_id: "s", pass: 1, gate_summary: "g", task_instruction: "t", handoff: "h" },
  };
  assert.equal(compileStepPrompt({ ...args, template_id: "nope" }).code, COMPILER_CODES.TEMPLATE_MISSING);
  assert.equal(compileStepPrompt({ ...args, role: "warlock" }).code, COMPILER_CODES.BRIEF_MISSING);

  const dir = mkdtempSync(join(tmpdir(), "helix-tpl-"));
  try {
    writeFileSync(join(dir, "holey-v1.md"), "{{role_brief}} {{mystery_field}}", "utf8");
    const holey = compileStepPrompt({ ...args, template_id: "holey-v1", templates_dir: dir });
    assert.equal(holey.code, COMPILER_CODES.PLACEHOLDER_UNRESOLVED);
    assert.equal(holey.detail, "mystery_field");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("compiled prompts remain memory-only even when a caller supplies the removed debug option", () => {
  const dir = mkdtempSync(join(tmpdir(), "helix-dbg-"));
  try {
    const compiled = compileStepPrompt({
      template_id: "step-prompt-v1", templates_dir: templatesDir, briefs_dir: briefsDir, role: "builder",
      fields: { chain_id: "c", stage_id: "plan", pass: 2, gate_summary: "g", task_instruction: "t", handoff: "h" },
      debug_dir: dir,
    });
    assert.equal(compiled.ok, true);
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("packets carry claim text as adapter input; the structural projection never does", () => {
  const packet = buildHandoffPacket({
    from_stage: "plan",
    to_stage: "implement",
    claims: [{ text: "use the staged runner", evidence: [{ path: "PLAN.md", ref: "local-ref:evidence/x" }] }],
    counterclaims: [{ text: "the debate loop suffices" }],
    disagreement_ids: [],
  });
  assert.equal(packet.kind, "packet");
  assert.match(packet.claims[0].id, /^sha256:/);
  const record = packetRecord(packet);
  assert.deepEqual(Object.keys(record).sort(), ["claim_ids", "counterclaim_ids", "disagreement_ids", "evidence_refs", "from_stage", "to_stage"]);
  const serialized = JSON.stringify(record);
  assert.ok(!serialized.includes("staged runner") && !serialized.includes("debate loop"), "no claim text in the projection");

  const transcript = buildTranscriptHandoff("plan", "implement", ["raw output A"]);
  assert.equal(transcript.kind, "transcript");
  assert.deepEqual(transcript.outputs, ["raw output A"]);
});

test("the disagreement log merges without ever dropping an open entry", () => {
  const log = makeDisagreementLog();
  const entries = extractDisagreements([
    { open_questions: ["contradicts-planner"], risks: [] },
    { open_questions: [], risks: ["missed-edge-case"] },
  ], "implement");
  assert.equal(entries.length, 2);
  for (const e of entries) log.add(e);
  assert.equal(log.openCount(), 2);

  // Re-adding as preserved upgrades; re-adding as open never demotes; resolving
  // is the only way out.
  log.add({ ...entries[0], status: "preserved" });
  assert.equal(log.list().find((e) => e.id === entries[0].id).status, "preserved");
  log.add({ ...entries[0], status: "open" });
  assert.equal(log.list().find((e) => e.id === entries[0].id).status, "preserved");
  log.add({ ...entries[0], status: "resolved" });
  assert.equal(log.openCount(), 1);
  assert.throws(() => log.add({ id: "x", stage_id: "s", status: "vanished" }), /invalid-disagreement-entry/);
});

test("events reject nested payloads, prose codes, and unsafe sequence seeds", () => {
  const base = {
    run_id: "event-boundary",
    seq: 1,
    t_rel_ms: 0,
    kind: "warning",
    code: "stable-warning-code",
  };
  const nested = validateEvent({ ...base, payload: { response: "ordinary model prose" } });
  assert.equal(nested.valid, false);
  assert.ok(nested.errors.includes("unexpected-field:payload"));

  const prose = validateEvent({ ...base, code: "ordinary model prose" });
  assert.equal(prose.valid, false);
  assert.ok(prose.errors.includes("invalid-field:code"));

  const log = makeEventLog({ run_id: "event-boundary" });
  assert.throws(
    () => log.emit("warning", { code: { nested: "ordinary model prose" } }),
    /invalid-field:code/,
  );
  assert.equal(log.events.length, 0, "invalid events never enter the in-memory stream");
  assert.throws(
    () => makeEventLog({ run_id: "event-boundary", start_seq: Number.MAX_SAFE_INTEGER + 1 }),
    /non-negative safe integer/,
  );
});

test("a converged terminal event must immediately follow its passing conclusion gate", () => {
  const log = makeEventLog({ run_id: "terminal-gate-binding" });
  log.emit("run-start", { chain_id: "full-cycle", config_id: "mock-core-loop", max_iterations: 5 });
  log.emit("gate", { stage_id: "implement", phase: "conclusion", result: "pass" });
  log.emit("warning", { code: "intervening-event" });
  log.emit("run-end", { converged: true, stop_reason: "converged", open_disagreements: 0 });
  const checked = validateEventHistory(log.events, { run_id: "terminal-gate-binding" });
  assert.equal(checked.valid, false);
  assert.ok(checked.errors.includes("converged-without-objective-gate"));
});

test("disagreement documents and resume seeds reject nested or inconsistent entries", () => {
  const id = `sha256:${"a".repeat(64)}`;
  const entry = { id, stage_id: "implement", status: "open" };
  const valid = { schema_version: 1, run_id: "disagreement-boundary", entries: [entry] };
  assert.equal(validateDisagreementDocument(valid, "disagreement-boundary").valid, true);

  for (const document of [
    { ...valid, metadata: { note: "ordinary model prose" } },
    { ...valid, entries: [{ ...entry, details: { note: "ordinary model prose" } }] },
    { ...valid, entries: [{ ...entry, stage_id: "ordinary stage prose" }] },
    { ...valid, run_id: "different-run" },
  ]) {
    assert.equal(validateDisagreementDocument(document, "disagreement-boundary").valid, false);
  }

  assert.throws(
    () => makeDisagreementLog([{ ...entry, details: { note: "ordinary model prose" } }]),
    /invalid-disagreement-entry/,
  );
  assert.throws(
    () => makeDisagreementLog([entry, { ...entry, stage_id: "plan" }]),
    /invalid-disagreement-entry/,
  );
});

function tempRepo() {
  const cwd = mkdtempSync(join(tmpdir(), "helix-ctx-"));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "helix@example.invalid"], { cwd });
  execFileSync("git", ["config", "user.name", "Helix Ctx"], { cwd });
  writeFileSync(join(cwd, "proposal.txt"), "initial\n", "utf8");
  writeFileSync(join(cwd, "PLAN.md"), "approved structural plan\n", "utf8");
  execFileSync("git", ["add", "proposal.txt", "PLAN.md"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "baseline"], { cwd });
  return cwd;
}

test("the runner threads fresh-context packets, emits prompt/pressure events, and persists the log", async () => {
  const repo = tempRepo();
  try {
    const events = [];
    const seenHandoffs = [];
    const mock = createStagedMockAdapter();
    const adapter = {
      ...mock.dispatchAdapter,
      runCandidate(spec, ctx) {
        seenHandoffs.push(ctx.handoff ? ctx.handoff.kind : null);
        assert.equal(typeof ctx.prompt, "string", "each candidate receives its compiled role prompt");
        return mock.dispatchAdapter.runCandidate(spec, ctx);
      },
    };
    const result = await runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, {
      cwd: repo, now: NOW, seed: 7, run_id: "ctx-e2e",
      adapter,
      revisionAdapter: mock.revisionAdapter({ "proposal.txt": "x\nHELIX_LOOP_PASS\n" }),
      worktree: makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") }),
      state_dir: join(repo, ".state"),
      events: { onEvent: (e) => events.push(e) },
    });
    assert.equal(result.converged, true, JSON.stringify({ code: result.code, stop: result.stop_reason }));

    // First stage has no handoff; later passes receive the packet.
    assert.equal(seenHandoffs[0], null);
    assert.ok(seenHandoffs.slice(-1)[0] === "packet");

    const kinds = events.map((e) => e.kind);
    assert.ok(kinds.includes("prompt") && kinds.includes("pressure"));
    const prompt = events.find((e) => e.kind === "prompt");
    assert.equal(prompt.template_id, "step-prompt-v1");
    assert.match(prompt.template_hash, /^sha256:/);
    const pressure = events.find((e) => e.kind === "pressure");
    assert.equal(pressure.status, "measured");
    assert.ok(pressure.tokens > 0);

    // The disagreement log persisted structurally.
    assert.ok(existsSync(result.disagreements_path));
    const doc = JSON.parse(readFileSync(result.disagreements_path, "utf8"));
    assert.equal(doc.run_id, "ctx-e2e");
    assert.ok(Array.isArray(doc.entries));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("context-engine OFF degenerates to transcript handoffs with a recorded warning", async () => {
  const repo = tempRepo();
  try {
    const seenHandoffs = [];
    const mock = createStagedMockAdapter();
    const adapter = {
      ...mock.dispatchAdapter,
      runCandidate(spec, ctx) {
        if (ctx.handoff) seenHandoffs.push(ctx.handoff.kind);
        return mock.dispatchAdapter.runCandidate(spec, ctx);
      },
    };
    const toggles = {
      "multi-model": true, loops: true, autoresearch: true,
      "context-engine": false, worktree: true, "visual-cues": true,
    };
    const result = await runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, {
      cwd: repo, now: NOW, seed: 7, run_id: "ctx-off", toggles,
      adapter,
      revisionAdapter: mock.revisionAdapter({ "proposal.txt": "x\nHELIX_LOOP_PASS\n" }),
      worktree: makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") }),
    });
    assert.equal(result.converged, true, JSON.stringify(result.flow));
    assert.ok(result.warnings.includes("context-engine-off-transcript"));
    assert.ok(seenHandoffs.length > 0 && seenHandoffs.every((k) => k === "transcript"));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("the disagreement log carries NON-EMPTY entries end to end and persists them", async () => {
  const repo = tempRepo();
  try {
    const events = [];
    const mock = createStagedMockAdapter();
    // A reviewer that raises a concrete risk marker each pass — real disagreements.
    const adapter = {
      ...mock.dispatchAdapter,
      runCandidate(spec, ctx) {
        const env = mock.dispatchAdapter.runCandidate(spec, ctx);
        if (spec.role === "reviewer") {
          return { ...env, risks: [`contradicts-${ctx.stage_id}-x`], recommendation: "approve" };
        }
        return env;
      },
    };
    const result = await runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, {
      cwd: repo, now: NOW, seed: 7, run_id: "disagree-e2e",
      adapter,
      revisionAdapter: mock.revisionAdapter({ "proposal.txt": "x\nHELIX_LOOP_PASS\n" }),
      worktree: makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") }),
      state_dir: join(repo, ".state"),
      events: { onEvent: (e) => events.push(e) },
    });
    assert.equal(result.converged, true, JSON.stringify({ code: result.code }));
    assert.ok(result.open_disagreements > 0, "reviewer risks became open disagreements");
    const runEnd = events.find((e) => e.kind === "run-end");
    assert.equal(runEnd.open_disagreements, result.open_disagreements);

    // Persisted structurally: hashes + status, never the marker text.
    const doc = JSON.parse(readFileSync(result.disagreements_path, "utf8"));
    assert.ok(doc.entries.length > 0);
    assert.ok(doc.entries.every((e) => /^sha256:/.test(e.id) && e.status === "open"));
    assert.ok(!JSON.stringify(doc).includes("contradicts-plan-x"), "marker text never persisted");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
