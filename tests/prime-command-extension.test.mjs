import { test } from "node:test";
import assert from "node:assert/strict";
import primeCommand from "../extensions/prime-command.ts";

function loadPrimeCommand() {
  const commands = [];
  const messages = [];
  primeCommand({
    registerCommand(name, options) {
      commands.push({ name, ...options });
    },
    sendMessage(message, options) {
      messages.push({ message, options });
    },
  });
  return { commands, messages };
}

test("prime extension registers exactly one command named prime", () => {
  const { commands } = loadPrimeCommand();
  assert.equal(commands.length, 1);
  assert.equal(commands[0].name, "prime");
  assert.equal(typeof commands[0].handler, "function");
  assert.equal(typeof commands[0].getArgumentCompletions, "function");
});

test("prime extension exposes argument completions for PR1 verbs", () => {
  const { commands } = loadPrimeCommand();
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

test("prime extension unknown verb returns usage", async () => {
  const { commands, messages } = loadPrimeCommand();
  const out = await commands[0].handler("unknown", { mode: "print", ui: {} });
  assert.equal(out.status, "usage");
  assert.equal(out.details.mutating, false);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].message.content.includes("Usage:"), true);
  assert.equal(messages[0].message.display, true);
  assert.equal(messages[0].message.details.title, "Prime usage");
});

test("prime extension confirms every mutation and keeps a declined mutation non-writing", async () => {
  const { commands } = loadPrimeCommand();
  let prompts = 0;
  const out = await commands[0].handler("profiles create must-not-write", {
    mode: "tui",
    ui: { confirm: async () => { prompts += 1; return false; } },
  });
  assert.equal(prompts, 1);
  assert.equal(out.code, "prime-mutation-cancelled");
  assert.equal(out.details.mutating, false);
});

test("prime extension projects Pi's available model inventory into /prime setup", async () => {
  const { commands } = loadPrimeCommand();
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
