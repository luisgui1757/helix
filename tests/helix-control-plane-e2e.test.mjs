import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import helixFence from "../extensions/helix-fence.ts";
import helixAnswer from "../extensions/helix-answer.ts";
import helixTools from "../extensions/helix-tools.ts";
import helixCommand from "../extensions/helix-command.ts";

function loadControlPlane() {
  const commands = new Map();
  const tools = new Map();
  const handlers = new Map();
  const messages = [];
  const entries = [];
  const pi = {
    on(event, handler) {
      const registered = handlers.get(event) ?? [];
      registered.push(handler);
      handlers.set(event, registered);
    },
    registerCommand(name, command) {
      commands.set(name, command);
    },
    registerTool(tool) {
      tools.set(tool.name, tool);
    },
    registerMessageRenderer() {},
    appendEntry(type, data) {
      entries.push({ type, data });
    },
    sendMessage(message, options) {
      messages.push({ message, options });
    },
  };
  for (const extension of [helixFence, helixAnswer, helixTools, helixCommand]) {
    extension(pi);
  }
  const emit = async (event, payload, ctx) => {
    const results = [];
    for (const handler of handlers.get(event) ?? []) {
      results.push(await handler(payload, ctx));
    }
    return results;
  };
  const invokeTool = async (name, id, params, ctx, signal) => {
    const verdicts = await emit("tool_call", { toolName: name, input: params }, ctx);
    const blocked = verdicts.find((verdict) => verdict?.block === true);
    if (blocked) return { blocked };
    return tools.get(name).execute(id, params, signal, undefined, ctx);
  };
  return { commands, tools, handlers, messages, entries, emit, invokeTool };
}

async function until(check) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const value = await check(attempt);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition not reached");
}

test("the shipped extensions survive a human-and-agent command/tool chain across session rotation", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-control-plane-state-"));
  const root = mkdtempSync(join(tmpdir(), "helix-control-plane-repo-"));
  const previous = process.env.HELIX_STATE_DIR;
  process.env.HELIX_STATE_DIR = stateRoot;
  writeFileSync(join(root, "baseline.txt"), "initial needle\n", "utf8");
  const {
    commands,
    tools,
    messages,
    entries,
    emit,
    invokeTool,
  } = loadControlPlane();
  const notices = [];
  const ui = {
    async confirm() { return true; },
    async select(_question, options) { return options[0]; },
    async input() { return "custom"; },
    notify(message, level) { notices.push({ message, level }); },
    setStatus() {},
  };
  const tui = { mode: "tui", cwd: root, ui };
  try {
    assert.equal(commands.size, 22);
    assert.deepEqual([...tools.keys()], [
      "answer",
      "helix_file_search",
      "helix_process_start",
      "helix_process_status",
      "helix_process_stop",
    ]);
    await emit("session_start", { reason: "switch" }, tui);

    const destructive = await emit(
      "tool_call",
      { toolName: "bash", input: { command: "rm -rf /tmp/helix-e2e" } },
      { mode: "rpc", ui: {} },
    );
    assert.equal(destructive.find((entry) => entry?.block)?.block, true);

    const answer = await invokeTool(
      "answer",
      "chain-answer",
      {
        question: "Which safe path?",
        recommendation: { label: "Proceed", reason: "bounded" },
        alternatives: [{ label: "Stop", reason: "cancel" }],
      },
      tui,
    );
    assert.equal(answer.details.status, "answered");
    assert.equal(answer.details.chosen, "Proceed");

    const baseline = await invokeTool(
      "helix_file_search",
      "chain-search",
      { query: "needle", path: "." },
      tui,
    );
    assert.deepEqual(baseline.details.matches.map((entry) => entry.path), ["baseline.txt"]);

    const unattended = await invokeTool(
      "helix_process_start",
      "chain-unattended",
      { executable: "/bin/echo", args: ["must-not-run"] },
      { mode: "rpc", cwd: root, ui: {} },
    );
    assert.equal(unattended.details.code, "process-start-requires-attended-confirmation");

    const started = await invokeTool(
      "helix_process_start",
      "chain-process-start",
      {
        executable: "/bin/bash",
        args: ["-c", "printf 'generated needle\\n' > generated.txt; sleep 30"],
        timeout_ms: 60_000,
      },
      tui,
    );
    assert.equal(started.details.ok, true);
    const processId = started.details.process.id;
    await until(() => existsSync(join(root, "generated.txt")));

    const generated = await invokeTool(
      "helix_file_search",
      "chain-generated-search",
      { query: "generated needle", path: "generated.txt" },
      tui,
    );
    assert.deepEqual(generated.details.matches, [{
      path: "generated.txt",
      line: 1,
      column: 1,
      preview: "generated needle",
    }]);

    const running = await invokeTool(
      "helix_process_status",
      "chain-process-status",
      { id: processId },
      tui,
    );
    assert.equal(running.details.process.status, "running");
    const stopped = await invokeTool(
      "helix_process_stop",
      "chain-process-stop",
      { id: processId },
      tui,
    );
    assert.equal(stopped.details.process.status, "stopped");

    await commands.get("helix-help").handler("", { mode: "print", cwd: root, ui });
    assert.equal(messages.at(-1).message.details.title, "Helix help");

    const crossToolReplay = await invokeTool(
      "helix_file_search",
      "chain-answer",
      { query: "needle" },
      tui,
    );
    assert.equal(crossToolReplay.details.code, "tool-turn-intent-invalid");

    await emit("session_shutdown", {}, tui);
    await emit("session_start", { reason: "switch" }, tui);
    const reusedAfterRotation = await invokeTool(
      "helix_file_search",
      "chain-answer",
      { query: "needle" },
      tui,
    );
    assert.equal(reusedAfterRotation.details.ok, true);
    const staleProcess = await invokeTool(
      "helix_process_status",
      "next-session-status",
      { id: processId },
      tui,
    );
    assert.equal(staleProcess.details.code, "process-not-found");

    const journalText = JSON.stringify(entries);
    for (const privateText of [
      "Which safe path?",
      "generated needle",
      "must-not-run",
      "generated.txt",
    ]) {
      assert.equal(journalText.includes(privateText), false);
    }
    assert.equal(
      entries.every((entry) => entry.type === "helix-tool-turn"),
      true,
    );
  } finally {
    await emit("session_shutdown", {}, tui);
    if (previous === undefined) delete process.env.HELIX_STATE_DIR;
    else process.env.HELIX_STATE_DIR = previous;
    rmSync(stateRoot, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
