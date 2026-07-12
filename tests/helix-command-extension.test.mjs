import { test } from "node:test";
import assert from "node:assert/strict";
import helixCommand from "../extensions/helix-command.ts";

function loadHelixCommand() {
  const commands = [];
  const messages = [];
  helixCommand({
    registerCommand(name, options) {
      commands.push({ name, ...options });
    },
    sendMessage(message, options) {
      messages.push({ message, options });
    },
  });
  return { commands, messages };
}

test("helix extension registers exactly one command named helix", () => {
  const { commands } = loadHelixCommand();
  assert.equal(commands.length, 1);
  assert.equal(commands[0].name, "helix");
  assert.equal(typeof commands[0].handler, "function");
  assert.equal(typeof commands[0].getArgumentCompletions, "function");
});

test("helix extension exposes argument completions for PR1 verbs", () => {
  const { commands } = loadHelixCommand();
  assert.deepEqual(commands[0].getArgumentCompletions("").map((item) => item.label), [
    "help",
    "run",
    "runs",
    "models",
    "chains",
    "settings",
    "profiles",
    "setup",
    "research",
  ]);
});

test("helix extension unknown verb returns usage", async () => {
  const { commands, messages } = loadHelixCommand();
  const out = await commands[0].handler("unknown", { mode: "print", ui: {} });
  assert.equal(out.status, "usage");
  assert.equal(out.details.mutating, false);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].message.content.includes("Usage:"), true);
  assert.equal(messages[0].message.display, true);
  assert.equal(messages[0].message.details.title, "Helix usage");
});

test("helix extension confirms every mutation and keeps a declined mutation non-writing", async () => {
  const { commands } = loadHelixCommand();
  let prompts = 0;
  const out = await commands[0].handler("profiles create must-not-write", {
    mode: "tui",
    ui: { confirm: async () => { prompts += 1; return false; } },
  });
  assert.equal(prompts, 1);
  assert.equal(out.code, "helix-mutation-cancelled");
  assert.equal(out.details.mutating, false);
});

test("helix extension projects Pi's available model inventory into /helix setup", async () => {
  const { commands } = loadHelixCommand();
  const out = await commands[0].handler("setup", {
    mode: "tui",
    ui: {},
    modelRegistry: {
      async getAvailable() {
        return [{ provider: "openai", id: "gpt-5x", reasoning: true }];
      },
    },
  });
  assert.equal(out.ok, true);
  assert.match(out.text, /openai-api\/gpt-5x \(reasoning\)/);
});
