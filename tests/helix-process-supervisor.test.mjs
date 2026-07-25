import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProcessSupervisor,
  PROCESS_LIMITS,
} from "../extensions/lib/helix-process-supervisor.mjs";

async function waitForClosed(supervisor, id) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = supervisor.status(id);
    if (state.ok && state.process.status !== "running" && state.process.status !== "stopping") return state.process;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  throw new Error("process did not close");
}

async function waitForOutput(supervisor, id) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const state = supervisor.status(id);
    if (state.ok && state.process.output.trim() !== "") return state.process.output;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  throw new Error("process did not produce output");
}

test("process supervisor runs argv-only with a contained cwd and bounded output", async () => {
  const root = mkdtempSync(join(tmpdir(), "helix-process-"));
  const supervisor = createProcessSupervisor();
  try {
    const started = supervisor.start({
      root,
      executable: "/bin/echo",
      args: ["hello; not a shell"],
      timeout_ms: 2_000,
    });
    assert.equal(started.ok, true);
    const closed = await waitForClosed(supervisor, started.process.id);
    assert.equal(closed.status, "succeeded");
    assert.equal(closed.output, "hello; not a shell\n");
  } finally {
    await supervisor.shutdown();
    rmSync(root, { recursive: true, force: true });
  }
});

test("process supervisor refuses outside cwd and confirms explicit stop", async () => {
  const root = mkdtempSync(join(tmpdir(), "helix-process-"));
  const supervisor = createProcessSupervisor();
  try {
    assert.equal(supervisor.start({ root, executable: "/bin/echo", cwd: "../" }).code, "process-input-invalid");
    const started = supervisor.start({
      root,
      executable: "/bin/sleep",
      args: ["30"],
      timeout_ms: 60_000,
    });
    assert.equal(started.ok, true);
    const stopped = await supervisor.stop(started.process.id);
    assert.equal(stopped.ok, true);
    assert.equal(stopped.process.status, "stopped");
  } finally {
    await supervisor.shutdown();
    rmSync(root, { recursive: true, force: true });
  }
});

test("process supervisor gives the first concurrent stop request causal authority", async () => {
  const root = mkdtempSync(join(tmpdir(), "helix-process-"));
  const supervisor = createProcessSupervisor();
  try {
    const started = supervisor.start({
      root,
      executable: "/bin/sleep",
      args: ["30"],
      timeout_ms: 60_000,
    });
    assert.equal(started.ok, true);
    const stop = supervisor.stop(started.process.id);
    const shutdown = supervisor.shutdown();
    const [stopped, closed] = await Promise.all([stop, shutdown]);
    assert.equal(stopped.ok, true);
    assert.equal(stopped.process.stop_reason, "user-stop");
    assert.equal(closed.ok, true);
    assert.equal(supervisor.status(started.process.id).process.stop_reason, "user-stop");
  } finally {
    await supervisor.shutdown();
    rmSync(root, { recursive: true, force: true });
  }
});

test("process supervisor truncates captured bytes at the exact output ceiling", async () => {
  const root = mkdtempSync(join(tmpdir(), "helix-process-"));
  const supervisor = createProcessSupervisor();
  try {
    const started = supervisor.start({
      root,
      executable: "/usr/bin/yes",
      timeout_ms: 60_000,
    });
    assert.equal(started.ok, true);
    let state;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      state = supervisor.status(started.process.id).process;
      if (state.output_truncated) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 5));
    }
    assert.equal(state.output_truncated, true);
    assert.equal(Buffer.byteLength(state.output, "utf8") <= PROCESS_LIMITS.max_output_bytes, true);
    assert.equal((await supervisor.stop(started.process.id)).ok, true);
  } finally {
    await supervisor.shutdown();
    rmSync(root, { recursive: true, force: true });
  }
});

test("process supervisor does not report closure while a detached descendant group remains", {
  skip: process.platform === "win32",
}, async () => {
  const root = mkdtempSync(join(tmpdir(), "helix-process-"));
  const supervisor = createProcessSupervisor();
  let processGroupId = null;
  try {
    const started = supervisor.start({
      root,
      executable: "/bin/bash",
      args: [
        "-c",
        "trap 'exit 0' TERM; /bin/sh -c 'trap \"\" TERM; while :; do /bin/sleep 1; done' </dev/null >/dev/null 2>&1 & echo $$; wait",
      ],
      timeout_ms: 60_000,
    });
    assert.equal(started.ok, true);
    processGroupId = Number((await waitForOutput(supervisor, started.process.id)).trim());
    assert.equal(Number.isSafeInteger(processGroupId), true);
    const stopped = await supervisor.stop(started.process.id);
    assert.equal(stopped.ok, true);
    assert.equal(stopped.process.status, "stopped");
    assert.throws(
      () => process.kill(-processGroupId, 0),
      (error) => error?.code === "ESRCH",
    );
  } finally {
    if (processGroupId != null) {
      try { process.kill(-processGroupId, "SIGKILL"); } catch {}
    }
    await supervisor.shutdown();
    rmSync(root, { recursive: true, force: true });
  }
});

test("session shutdown terminates every concurrent process with one causal reason", async () => {
  const root = mkdtempSync(join(tmpdir(), "helix-process-shutdown-"));
  const supervisor = createProcessSupervisor();
  try {
    const started = Array.from({ length: 3 }, () => supervisor.start({
      root,
      executable: "/bin/sleep",
      args: ["30"],
      timeout_ms: 60_000,
    }));
    assert.equal(started.every((entry) => entry.ok), true);
    const shutdown = await supervisor.shutdown();
    assert.equal(shutdown.ok, true);
    assert.equal(shutdown.results.length, 3);
    for (const entry of shutdown.results) {
      assert.equal(entry.process.status, "stopped");
      assert.equal(entry.process.stop_reason, "session-shutdown");
      assert.equal(entry.already_closed, false);
    }
    assert.deepEqual(
      started.map((entry) => supervisor.status(entry.process.id).process.status),
      ["stopped", "stopped", "stopped"],
    );
  } finally {
    await supervisor.shutdown();
    rmSync(root, { recursive: true, force: true });
  }
});
