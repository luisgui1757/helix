import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createRunSupervisor,
  RUN_SUPERVISOR_LIMITS,
} from "../extensions/lib/helix-run-supervisor.mjs";

async function until(check) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = check();
    if (value) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 5));
  }
  throw new Error("condition not reached");
}

test("run supervisor settles in background and exposes completion exactly once", async () => {
  const supervisor = createRunSupervisor();
  const started = supervisor.start({
    run_id: "run-1",
    label: "test",
    async execute({ onEvent }) {
      onEvent({ kind: "node-start", node_id: "build" });
      return { ok: true, code: null, state_path: "/private/path" };
    },
  });
  assert.equal(started.ok, true);
  const settled = await until(() => {
    const state = supervisor.status("run-1").run;
    return state.status === "succeeded" ? state : null;
  });
  assert.equal(settled.last_event.node_id, "build");
  assert.equal(Object.hasOwn(settled, "result"), false);
  assert.equal(JSON.stringify(settled).includes("/private/path"), false);
  assert.deepEqual(supervisor.claimCompletion("run-1"), {
    ok: true,
    code: null,
    converged: false,
    stop_reason: null,
    resumable: false,
    terminal_authoritative: false,
    has_run_record: true,
  });
  assert.equal(supervisor.claimCompletion("run-1"), null);
});

test("run supervisor propagates cancellation and bounds duplicate ids", async () => {
  const supervisor = createRunSupervisor();
  supervisor.start({
    run_id: "run-1",
    label: "test",
    execute: ({ signal }) => new Promise((resolve) => {
      const cancelled = () => resolve({
        ok: false,
        status: "cancelled",
        code: "kernel-run-cancelled",
      });
      if (signal.aborted) cancelled();
      else signal.addEventListener("abort", cancelled, { once: true });
    }),
  });
  assert.equal(supervisor.start({ run_id: "run-1", label: "again", execute() {} }).code, "run-supervisor-start-invalid");
  assert.equal(supervisor.cancel("run-1").ok, true);
  const settled = await until(() => supervisor.status("run-1").run.status === "cancelled");
  assert.equal(settled, true);
  await supervisor.shutdown();
  assert.equal(supervisor.status("run-1").run.status, "cancelled");
});

test("run supervisor preserves a durable workflow pause as a closed paused session record", async () => {
  const supervisor = createRunSupervisor();
  supervisor.start({
    run_id: "run-paused",
    label: "workflow-paused",
    async execute() {
      return {
        ok: false,
        code: "kernel-human-choice-required",
        stop_reason: "paused",
        resumable: true,
        state_path: "/private/path",
      };
    },
  });
  const settled = await until(() => {
    const state = supervisor.status("run-paused").run;
    return state.status === "paused" ? state : null;
  });
  assert.equal(settled.outcome.resumable, true);
  assert.equal(settled.completion_pending, true);
  assert.equal(supervisor.claimCompletion("run-paused").resumable, true);
  const resumed = supervisor.resume({
    run_id: "run-paused",
    label: "workflow-paused",
    async execute() {
      return {
        ok: true,
        code: null,
        converged: true,
        state_path: "/private/path",
      };
    },
  });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.run.status, "running");
  await resumed.completion;
  assert.equal(supervisor.status("run-paused").run.status, "succeeded");
  assert.equal(supervisor.claimCompletion("run-paused").ok, true);
  assert.equal(supervisor.resume({
    run_id: "run-paused",
    label: "workflow-paused",
    execute() {},
  }).code, "run-supervisor-resume-invalid");
  await supervisor.shutdown();
});

test("run supervisor resumes an explicitly resumable failed session record", async () => {
  const supervisor = createRunSupervisor();
  const interrupted = supervisor.start({
    run_id: "run-interrupted",
    label: "workflow-interrupted",
    async execute() {
      return {
        ok: false,
        code: "kernel-event-write-failed",
        stop_reason: "failed",
        resumable: true,
        state_path: "/private/path",
      };
    },
  });
  await interrupted.completion;
  const settled = supervisor.status("run-interrupted").run;
  assert.equal(settled.status, "failed");
  assert.equal(settled.outcome.resumable, true);

  const resumed = supervisor.resume({
    run_id: "run-interrupted",
    label: "workflow-interrupted",
    async execute() {
      return {
        ok: true,
        code: null,
        converged: true,
        state_path: "/private/path",
      };
    },
  });
  assert.equal(resumed.ok, true);
  await resumed.completion;
  assert.equal(supervisor.status("run-interrupted").run.status, "succeeded");
  await supervisor.shutdown();
});

test("run supervisor owns cancellation for a resumed durable run absent from the session", async () => {
  const supervisor = createRunSupervisor();
  const resumed = supervisor.resume({
    run_id: "durable-run",
    label: "durable-workflow",
    execute: ({ signal }) => new Promise((resolve) => {
      const cancelled = () => resolve({
        ok: false,
        status: "cancelled",
        code: "kernel-run-cancelled",
      });
      if (signal.aborted) cancelled();
      else signal.addEventListener("abort", cancelled, { once: true });
    }),
  });
  assert.equal(resumed.ok, true);
  assert.equal(supervisor.status("durable-run").run.status, "running");
  assert.equal(supervisor.cancel("durable-run").already_closed, false);
  await resumed.completion;
  assert.equal(supervisor.status("durable-run").run.status, "cancelled");
  assert.equal(supervisor.claimCompletion("durable-run").code, "kernel-run-cancelled");
  await supervisor.shutdown();
});

test("run supervisor shutdown aborts and awaits an active durable resume", async () => {
  const supervisor = createRunSupervisor();
  supervisor.resume({
    run_id: "durable-run",
    label: "durable-workflow",
    execute: ({ signal }) => new Promise((resolve) => {
      const cancelled = () => resolve({
        ok: false,
        code: "kernel-run-cancelled",
      });
      if (signal.aborted) cancelled();
      else signal.addEventListener("abort", cancelled, { once: true });
    }),
  });
  await supervisor.shutdown();
  assert.equal(supervisor.status("durable-run").run.status, "cancelled");
});

test("run supervisor fails closed on contradictory successful pause or cancellation results", async () => {
  const supervisor = createRunSupervisor();
  const paused = supervisor.start({
    run_id: "invalid-pause",
    label: "invalid-pause",
    async execute() {
      return { ok: true, stop_reason: "paused" };
    },
  });
  const cancelled = supervisor.start({
    run_id: "invalid-cancellation",
    label: "invalid-cancellation",
    async execute() {
      return { ok: true, code: "kernel-run-cancelled" };
    },
  });
  await Promise.all([paused.completion, cancelled.completion]);
  assert.equal(supervisor.status("invalid-pause").run.status, "failed");
  assert.equal(supervisor.status("invalid-cancellation").run.status, "failed");
});

test("run supervisor bounds active work and strips non-structural completion data", async () => {
  const supervisor = createRunSupervisor();
  const releases = [];
  supervisor.start({
    run_id: "paused-capacity",
    label: "paused-capacity",
    async execute() {
      return { ok: false, stop_reason: "paused", resumable: true };
    },
  });
  await until(() => supervisor.status("paused-capacity").run.status === "paused");
  for (let index = 0; index < RUN_SUPERVISOR_LIMITS.max_active_runs; index += 1) {
    const started = supervisor.start({
      run_id: `run-${index}`,
      label: `workflow-${index}`,
      execute: () => new Promise((resolve) => releases.push(resolve)),
    });
    assert.equal(started.ok, true);
  }
  assert.equal(supervisor.start({
    run_id: "run-overflow",
    label: "workflow-overflow",
    execute() {},
  }).code, "run-supervisor-capacity-exceeded");
  assert.equal(supervisor.resume({
    run_id: "paused-capacity",
    label: "paused-capacity",
    execute() {},
  }).code, "run-supervisor-capacity-exceeded");
  await until(() => releases.length === RUN_SUPERVISOR_LIMITS.max_active_runs);
  releases[0]({
    ok: false,
    code: "safe-code",
    stop_reason: "/private/reason",
    state_path: "/private/state",
    private_payload: { task: "do not retain" },
  });
  await until(() => supervisor.status("run-0").run.status === "failed");
  const completion = supervisor.claimCompletion("run-0");
  assert.equal(completion.code, "safe-code");
  assert.equal(completion.stop_reason, null);
  assert.equal(completion.has_run_record, true);
  assert.equal(JSON.stringify(completion).includes("do not retain"), false);
  for (const release of releases.slice(1)) {
    release({ ok: false, code: "workflow-run-cancelled", status: "cancelled" });
  }
  await supervisor.shutdown();
});
