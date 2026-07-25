import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import helixTools from "../extensions/helix-tools.ts";

function loadTools({ appendEntry } = {}) {
  const tools = new Map();
  const handlers = new Map();
  const entries = [];
  helixTools({
    registerTool(tool) { tools.set(tool.name, tool); },
    on(event, handler) { handlers.set(event, handler); },
    appendEntry(type, data) {
      if (appendEntry) return appendEntry(type, data);
      entries.push({ type, data });
    },
  });
  return { tools, handlers, entries };
}

async function until(check) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const value = await check(attempt);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition not reached");
}

test("Helix tool extension registers the bounded tool surface and journals search before result", async () => {
  const root = mkdtempSync(join(tmpdir(), "helix-tools-"));
  try {
    writeFileSync(join(root, "a.txt"), "needle\n");
    const { tools, entries } = loadTools();
    assert.deepEqual([...tools.keys()], [
      "helix_file_search",
      "helix_process_start",
      "helix_process_status",
      "helix_process_stop",
    ]);
    const result = await tools.get("helix_file_search").execute(
      "call-search",
      { query: "needle" },
      undefined,
      undefined,
      { cwd: root },
    );
    assert.equal(result.details.ok, true);
    assert.equal(result.details.matches[0].path, "a.txt");
    assert.deepEqual(entries.map((entry) => [entry.type, entry.data.kind]), [
      ["helix-tool-turn", "intent"],
      ["helix-tool-turn", "result"],
    ]);
    assert.equal(JSON.stringify(entries).includes("needle"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("process start is attended, argv-only, session-scoped, and journaled", async () => {
  const root = mkdtempSync(join(tmpdir(), "helix-tools-"));
  const { tools, handlers, entries } = loadTools();
  let confirmation = null;
  try {
    const refused = await tools.get("helix_process_start").execute(
      "call-print",
      { executable: "/bin/echo", args: ["no"] },
      undefined,
      undefined,
      { cwd: root, mode: "print", ui: {} },
    );
    assert.equal(refused.details.code, "process-start-requires-attended-confirmation");

    const started = await tools.get("helix_process_start").execute(
      "call-start",
      { executable: "/bin/sleep", args: ["30"], timeout_ms: 60_000 },
      undefined,
      undefined,
      {
        cwd: root,
        mode: "tui",
        ui: {
          async confirm(title, body) {
            confirmation = { title, body };
            return true;
          },
        },
      },
    );
    assert.equal(started.details.ok, true);
    assert.equal(confirmation.title, "Start supervised process?");
    assert.match(confirmation.body, /"30"/);
    const stopped = await tools.get("helix_process_stop").execute(
      "call-stop",
      { id: started.details.process.id },
    );
    assert.equal(stopped.details.ok, true);
    assert.equal(stopped.details.process.status, "stopped");
    await handlers.get("session_shutdown")();
    assert.deepEqual(entries.map((entry) => entry.data.kind), [
      "intent", "result",
      "intent", "result",
      "intent", "result",
    ]);
  } finally {
    await handlers.get("session_shutdown")();
    rmSync(root, { recursive: true, force: true });
  }
});

test("journal intent failure prevents process confirmation and execution", async () => {
  const root = mkdtempSync(join(tmpdir(), "helix-tools-"));
  let confirmations = 0;
  const { tools, handlers } = loadTools({
    appendEntry() { throw new Error("unavailable"); },
  });
  try {
    const result = await tools.get("helix_process_start").execute(
      "call-start",
      { executable: "/bin/sleep", args: ["30"], timeout_ms: 60_000 },
      undefined,
      undefined,
      {
        cwd: root,
        mode: "tui",
        ui: { async confirm() { confirmations += 1; return true; } },
      },
    );
    assert.equal(result.details.code, "tool-turn-journal-write-failed");
    assert.equal(confirmations, 0);
  } finally {
    await handlers.get("session_shutdown")();
    rmSync(root, { recursive: true, force: true });
  }
});

test("an aborted process start never reaches confirmation or spawn", async () => {
  const root = mkdtempSync(join(tmpdir(), "helix-tools-"));
  const { tools, handlers, entries } = loadTools();
  const controller = new AbortController();
  controller.abort();
  let confirmations = 0;
  try {
    const result = await tools.get("helix_process_start").execute(
      "call-aborted",
      { executable: "/bin/sleep", args: ["30"], timeout_ms: 60_000 },
      controller.signal,
      undefined,
      {
        cwd: root,
        mode: "tui",
        ui: { async confirm() { confirmations += 1; return true; } },
      },
    );
    assert.equal(result.details.code, "process-start-cancelled");
    assert.equal(confirmations, 0);
    assert.deepEqual(entries.map((entry) => [entry.data.kind, entry.data.status ?? null]), [
      ["intent", null],
      ["result", "refused"],
    ]);
  } finally {
    await handlers.get("session_shutdown")();
    rmSync(root, { recursive: true, force: true });
  }
});

test("session shutdown closes the start race and the next session gets a fresh supervisor", async () => {
  const root = mkdtempSync(join(tmpdir(), "helix-tools-"));
  const { tools, handlers } = loadTools();
  let releaseConfirmation;
  let confirmationStarted;
  const started = new Promise((resolve) => { confirmationStarted = resolve; });
  try {
    const pending = tools.get("helix_process_start").execute(
      "call-racing-start",
      { executable: "/bin/sleep", args: ["30"], timeout_ms: 60_000 },
      undefined,
      undefined,
      {
        cwd: root,
        mode: "tui",
        ui: {
          confirm() {
            confirmationStarted();
            return new Promise((resolve) => { releaseConfirmation = resolve; });
          },
        },
      },
    );
    await started;
    const shutdown = handlers.get("session_shutdown")();
    releaseConfirmation(true);
    const [result] = await Promise.all([pending, shutdown]);
    assert.equal(result.details.code, "process-start-cancelled");

    await handlers.get("session_start")();
    const next = await tools.get("helix_process_start").execute(
      "call-next-session",
      { executable: "/bin/echo", args: ["next"], timeout_ms: 2_000 },
      undefined,
      undefined,
      {
        cwd: root,
        mode: "tui",
        ui: { async confirm() { return true; } },
      },
    );
    assert.equal(next.details.ok, true);
    await handlers.get("session_shutdown")();
  } finally {
    await handlers.get("session_shutdown")();
    rmSync(root, { recursive: true, force: true });
  }
});

test("an agent can chain process start, status, stop, repeated stop, and session rotation without identity bleed", async () => {
  const root = mkdtempSync(join(tmpdir(), "helix-tools-chain-"));
  const { tools, handlers } = loadTools();
  try {
    await handlers.get("session_start")();
    const started = await tools.get("helix_process_start").execute(
      "chain-start",
      { executable: "/bin/sleep", args: ["30"], timeout_ms: 60_000 },
      undefined,
      undefined,
      {
        cwd: root,
        mode: "tui",
        ui: { async confirm() { return true; } },
      },
    );
    assert.equal(started.details.ok, true);
    const processId = started.details.process.id;

    const running = await tools.get("helix_process_status").execute(
      "chain-status",
      { id: processId },
    );
    assert.equal(running.details.process.status, "running");
    const replay = await tools.get("helix_process_stop").execute(
      "chain-status",
      { id: processId },
    );
    assert.equal(replay.details.code, "tool-turn-intent-invalid");

    const stopped = await tools.get("helix_process_stop").execute(
      "chain-stop",
      { id: processId },
    );
    assert.equal(stopped.details.process.status, "stopped");
    assert.equal(stopped.details.process.stop_reason, "user-stop");
    const repeated = await tools.get("helix_process_stop").execute(
      "chain-stop-again",
      { id: processId },
    );
    assert.equal(repeated.details.ok, true);
    assert.equal(repeated.details.already_closed, true);

    await handlers.get("session_start")();
    const reused = await tools.get("helix_process_status").execute(
      "chain-status",
      { id: processId },
    );
    assert.equal(reused.details.code, "process-not-found");
  } finally {
    await handlers.get("session_shutdown")();
    rmSync(root, { recursive: true, force: true });
  }
});

test("session start without a preceding shutdown terminates the complete active process group", async () => {
  const root = mkdtempSync(join(tmpdir(), "helix-tools-rotation-"));
  const { tools, handlers } = loadTools();
  let childPid = null;
  try {
    await handlers.get("session_start")();
    const started = await tools.get("helix_process_start").execute(
      "rotation-start",
      {
        executable: "/bin/bash",
        args: ["-c", "echo $$; exec sleep 30"],
        timeout_ms: 60_000,
      },
      undefined,
      undefined,
      {
        cwd: root,
        mode: "tui",
        ui: { async confirm() { return true; } },
      },
    );
    assert.equal(started.details.ok, true);
    const processId = started.details.process.id;
    const observed = await until(async (attempt) => {
      const status = await tools.get("helix_process_status").execute(
        `rotation-status-${attempt}`,
        { id: processId },
      );
      const parsed = Number.parseInt(status.details.process?.output?.trim() ?? "", 10);
      return Number.isSafeInteger(parsed) && parsed > 1 ? parsed : null;
    });
    childPid = observed;

    await handlers.get("session_start")();
    assert.throws(() => process.kill(childPid, 0), (error) => error?.code === "ESRCH");
    const stale = await tools.get("helix_process_status").execute(
      "rotation-stale-status",
      { id: processId },
    );
    assert.equal(stale.details.code, "process-not-found");
  } finally {
    if (childPid != null) {
      try {
        process.kill(-childPid, "SIGKILL");
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    }
    await handlers.get("session_shutdown")();
    rmSync(root, { recursive: true, force: true });
  }
});
