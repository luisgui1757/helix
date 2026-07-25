import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createToolTurnJournal,
  piToolTurnJournal,
  resetPiToolTurnJournal,
  TOOL_TURN_LIMITS,
} from "../extensions/lib/helix-tool-journal.mjs";

test("tool journal persists hash-only intent before exactly one result", () => {
  const entries = [];
  const journal = createToolTurnJournal({ append: (entry) => entries.push(entry) });
  const intent = journal.start({
    tool_call_id: "call-1",
    tool: "helix_file_search",
    args: { query: "secret text is hashed" },
  });
  assert.equal(intent.ok, true);
  assert.equal(entries[0].kind, "intent");
  assert.equal(JSON.stringify(entries).includes("secret text"), false);
  assert.equal(journal.settle({
    tool_call_id: "call-1",
    tool: "helix_file_search",
    intent_token: intent.intent_token,
    result: { ok: true, matches: [] },
  }).ok, true);
  assert.equal(entries[1].kind, "result");
  assert.equal(entries[1].status, "ok");
  assert.equal(journal.settle({
    tool_call_id: "call-1",
    tool: "helix_file_search",
    intent_token: intent.intent_token,
    result: {},
  }).code, "tool-turn-result-invalid");
  assert.deepEqual(journal.snapshot(), { sequence: 2, inflight: [] });
});

test("tool journal fails closed on duplicate or unbound calls", () => {
  const journal = createToolTurnJournal();
  assert.equal(journal.start({
    tool_call_id: "../private/path",
    tool: "helix_file_search",
    args: {},
  }).code, "tool-turn-intent-invalid");
  assert.equal(journal.start({ tool_call_id: "x", tool: "bash", args: {} }).code, "tool-turn-intent-invalid");
  const intent = journal.start({ tool_call_id: "x", tool: "helix_file_search", args: {} });
  assert.equal(intent.ok, true);
  assert.equal(journal.start({ tool_call_id: "x", tool: "helix_file_search", args: {} }).code, "tool-turn-intent-invalid");
  assert.equal(journal.settle({
    tool_call_id: "x",
    tool: "helix_process_stop",
    intent_token: intent.intent_token,
    result: {},
  }).code, "tool-turn-result-invalid");
  assert.equal(journal.settle({
    tool_call_id: "x",
    tool: "helix_file_search",
    intent_token: intent.intent_token,
    result: { ok: false },
    status: "refused",
  }).ok, true);
  assert.equal(
    journal.start({ tool_call_id: "x", tool: "answer", args: {} }).code,
    "tool-turn-intent-invalid",
    "a completed call id remains one-use for the whole session",
  );
});

test("tool journal preserves an unsettled intent when result persistence fails", () => {
  const entries = [];
  const journal = createToolTurnJournal({
    append(entry) {
      if (entry.kind === "result") throw new Error("disk-full");
      entries.push(entry);
    },
  });
  const intent = journal.start({ tool_call_id: "x", tool: "helix_file_search", args: {} });
  assert.equal(intent.ok, true);
  assert.equal(journal.settle({
    tool_call_id: "x",
    tool: "helix_file_search",
    intent_token: intent.intent_token,
    result: { ok: true },
  }).code, "tool-turn-journal-write-failed");
  assert.deepEqual(journal.snapshot(), { sequence: 1, inflight: ["x"] });
  assert.equal(entries.length, 1);
});

test("Pi tool journal resets session-local inflight identity through existing facades", () => {
  const entries = [];
  const pi = { appendEntry: (type, entry) => entries.push({ type, entry }) };
  const journal = piToolTurnJournal(pi);
  const oldIntent = journal.start({ tool_call_id: "x", tool: "helix_file_search", args: {} });
  assert.equal(oldIntent.ok, true);
  assert.equal(resetPiToolTurnJournal(pi), true);
  assert.deepEqual(journal.snapshot(), { sequence: 0, inflight: [] });
  const newIntent = journal.start({ tool_call_id: "x", tool: "helix_file_search", args: {} });
  assert.equal(newIntent.ok, true);
  assert.equal(journal.settle({
    tool_call_id: "x",
    tool: "helix_file_search",
    intent_token: oldIntent.intent_token,
    result: { ok: true },
  }).code, "tool-turn-result-invalid");
  assert.deepEqual(journal.snapshot(), { sequence: 1, inflight: ["x"] });
  assert.equal(journal.settle({
    tool_call_id: "x",
    tool: "helix_file_search",
    intent_token: newIntent.intent_token,
    result: { ok: true },
  }).ok, true);
  assert.equal(entries.length, 3);
});

test("tool journal bounds lifetime one-use call ids per session", () => {
  const journal = createToolTurnJournal();
  for (let index = 0; index < TOOL_TURN_LIMITS.max_calls; index += 1) {
    const intent = journal.start({
      tool_call_id: `bounded-${index}`,
      tool: "helix_file_search",
      args: {},
    });
    assert.equal(intent.ok, true);
    assert.equal(journal.settle({
      tool_call_id: `bounded-${index}`,
      tool: "helix_file_search",
      intent_token: intent.intent_token,
      result: { ok: true },
    }).ok, true);
  }
  assert.equal(journal.start({
    tool_call_id: "one-too-many",
    tool: "helix_file_search",
    args: {},
  }).code, "tool-turn-capacity-exceeded");
  assert.deepEqual(journal.snapshot(), {
    sequence: TOOL_TURN_LIMITS.max_calls * 2,
    inflight: [],
  });
});
