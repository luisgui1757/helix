import { test } from "node:test";
import assert from "node:assert/strict";
import helixAnswer from "../extensions/helix-answer.ts";

function loadAnswerTool() {
  const tools = [];
  const entries = [];
  const handlers = new Map();
  const pi = {
    on(event, handler) {
      handlers.set(event, handler);
    },
    registerTool(tool) {
      tools.push(tool);
    },
    appendEntry(type, data) {
      entries.push({ type, data });
    },
  };
  helixAnswer(pi);
  assert.equal(tools.length, 1);
  return { tool: tools[0], entries, handlers, pi };
}

test("helix-answer registers the model-callable answer tool", () => {
  const { tool } = loadAnswerTool();
  assert.equal(tool.name, "answer");
  assert.equal(tool.label, "Answer");
  assert.equal(typeof tool.execute, "function");
  assert.deepEqual(tool.parameters.required, ["question", "recommendation"]);
});

test("helix-answer non-interactive execute fails closed", async () => {
  const { tool, entries } = loadAnswerTool();
  const result = await tool.execute(
    "tool-call-1",
    {
      question: "Which container runtime?",
      recommendation: { label: "Docker", reason: "ubiquitous + CI-friendly" },
      alternatives: [
        { label: "Podman", reason: "daemonless/rootless" },
        { label: "Apple Containers", reason: "native on macOS" },
      ],
    },
    undefined,
    undefined,
    { mode: "json" },
  );

  assert.equal(result.content[0].type, "text");
  assert.equal(result.content[0].text, "Unresolved: unavailable; no option was selected.");
  assert.equal(result.details.question, "Which container runtime?");
  assert.equal(result.details.status, "unavailable");
  assert.equal(result.details.chosen, null);
  assert.equal(result.details.recommended, false);
  assert.equal(result.details.interactive, false);
  assert.deepEqual(result.details.options, [
    "1. Docker (recommended) — ubiquitous + CI-friendly",
    "2. Podman — daemonless/rootless",
    "3. Apple Containers — native on macOS",
  ]);
  assert.deepEqual(entries.map((entry) => [entry.type, entry.data.kind, entry.data.status ?? null]), [
    ["helix-tool-turn", "intent", null],
    ["helix-tool-turn", "result", "refused"],
  ]);
  assert.equal(JSON.stringify(entries).includes("Which container runtime?"), false);
});

test("helix-answer refuses a selection that settles after cancellation", async () => {
  const { tool, entries } = loadAnswerTool();
  const controller = new AbortController();
  const result = await tool.execute(
    "tool-call-cancelled",
    {
      question: "Continue?",
      recommendation: { label: "Proceed" },
      alternatives: [{ label: "Stop" }],
    },
    controller.signal,
    undefined,
    {
      mode: "tui",
      ui: {
        async select(_question, options) {
          controller.abort();
          return options[0];
        },
      },
    },
  );
  assert.equal(result.details.status, "cancelled");
  assert.equal(result.details.chosen, null);
  assert.deepEqual(entries.map((entry) => [entry.data.kind, entry.data.status ?? null]), [
    ["intent", null],
    ["result", "refused"],
  ]);
});

test("session rotation prevents a late answer from settling a reused call id in the next session", async () => {
  const { tool, entries, handlers } = loadAnswerTool();
  await handlers.get("session_start")();
  let releaseOld;
  let oldStarted;
  const oldSelecting = new Promise((resolve) => { oldStarted = resolve; });
  const old = tool.execute(
    "reused-call",
    {
      question: "Old session?",
      recommendation: { label: "Old answer" },
      alternatives: [{ label: "Stop" }],
    },
    undefined,
    undefined,
    {
      mode: "tui",
      ui: {
        select(_question, options) {
          oldStarted();
          return new Promise((resolve) => { releaseOld = () => resolve(options[0]); });
        },
      },
    },
  );
  await oldSelecting;

  await handlers.get("session_start")();
  let releaseNew;
  let newStarted;
  const newSelecting = new Promise((resolve) => { newStarted = resolve; });
  const next = tool.execute(
    "reused-call",
    {
      question: "New session?",
      recommendation: { label: "New answer" },
      alternatives: [{ label: "Stop" }],
    },
    undefined,
    undefined,
    {
      mode: "tui",
      ui: {
        select(_question, options) {
          newStarted();
          return new Promise((resolve) => { releaseNew = () => resolve(options[0]); });
        },
      },
    },
  );
  await newSelecting;

  releaseOld();
  const oldResult = await old;
  assert.equal(oldResult.details.code, "tool-turn-result-invalid");
  releaseNew();
  const newResult = await next;
  assert.equal(newResult.details.status, "answered");
  assert.equal(newResult.details.chosen, "New answer");
  assert.deepEqual(entries.map((entry) => [entry.data.kind, entry.data.tool_call_id]), [
    ["intent", "reused-call"],
    ["intent", "reused-call"],
    ["result", "reused-call"],
  ]);
});

test("session shutdown revokes an answer returned by a late native UI selection", async () => {
  const { tool, entries, handlers } = loadAnswerTool();
  await handlers.get("session_start")();
  let release;
  let selectionStarted;
  const started = new Promise((resolve) => { selectionStarted = resolve; });
  const pending = tool.execute(
    "shutdown-answer",
    {
      question: "Continue after shutdown?",
      recommendation: { label: "Never" },
      alternatives: [{ label: "Stop" }],
    },
    undefined,
    undefined,
    {
      mode: "tui",
      ui: {
        select(_question, options) {
          selectionStarted();
          return new Promise((resolve) => { release = () => resolve(options[0]); });
        },
      },
    },
  );
  await started;
  await handlers.get("session_shutdown")();
  release();
  const result = await pending;
  assert.equal(result.details.status, "cancelled");
  assert.equal(result.details.chosen, null);
  assert.deepEqual(entries.map((entry) => [entry.data.kind, entry.data.status ?? null]), [
    ["intent", null],
    ["result", "refused"],
  ]);
});
