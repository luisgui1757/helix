import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import helixCommand from "../extensions/helix-command.ts";

const COMMAND_NAMES = [
  "helix",
  "helix-help",
  "helix-run",
  "helix-runs",
  "helix-run-status",
  "helix-run-watch",
  "helix-run-resume",
  "helix-run-prune",
  "helix-models",
  "helix-chains",
  "helix-settings",
  "helix-profiles",
  "helix-setup",
  "helix-research",
];

function loadHelixCommands(overrides = {}) {
  const commands = [];
  const messages = [];
  const renderers = new Map();
  helixCommand({
    registerCommand(name, options) {
      commands.push({ name, ...options });
    },
    registerMessageRenderer(name, renderer) {
      renderers.set(name, renderer);
    },
    sendMessage(message, options) {
      messages.push({ message, options });
    },
    ...overrides,
  });
  return { commands, messages, renderers };
}

function commandByName(commands, name) {
  return commands.find((command) => command.name === name);
}

test("helix extension registers one dedicated command per user-facing capability", () => {
  const { commands } = loadHelixCommands();
  assert.deepEqual(commands.map((command) => command.name), COMMAND_NAMES);
  assert.equal(commands.every((command) => typeof command.handler === "function"), true);
  assert.equal(typeof(commandByName(commands, "helix-run").getArgumentCompletions), "function");
  assert.equal(typeof(commandByName(commands, "helix-settings").getArgumentCompletions), "function");
});

test("dedicated run and settings completions omit legacy verb prefixes", () => {
  const { commands } = loadHelixCommands();
  const runs = commandByName(commands, "helix-run").getArgumentCompletions("");
  assert.ok(runs.some((item) => item.value === "mock-core-loop"));
  assert.equal(runs.some((item) => item.value.startsWith("run ")), false);

  const settings = commandByName(commands, "helix-settings").getArgumentCompletions("");
  assert.deepEqual(settings.map((item) => item.label), [
    "multi-model", "loops", "autoresearch", "context-engine", "worktree", "visual-cues",
  ]);
  assert.deepEqual(
    commandByName(commands, "helix-settings").getArgumentCompletions("loops ").map((item) => item.label),
    ["on", "off"],
  );
});

test("helix-help renders product help without loading mutable state", async () => {
  const { commands, messages } = loadHelixCommands();
  await commandByName(commands, "helix-help").handler("", { mode: "print", ui: {} });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].message.details.title, "Helix help");
  assert.equal(messages[0].message.details.status, "ok");
  assert.match(messages[0].message.content, /\/helix-settings/);
});

test("legacy /helix verbs remain compatible while dedicated commands are primary", async () => {
  const { commands, messages } = loadHelixCommands();
  await commandByName(commands, "helix").handler("unknown", { mode: "print", ui: {} });
  assert.equal(messages[0].message.details.status, "usage");
  assert.match(messages[0].message.content, /Usage:/);
});

test("profile mutations stay attended and a declined change does not write", async () => {
  const { commands, messages } = loadHelixCommands();
  let prompts = 0;
  await commandByName(commands, "helix-profiles").handler("create must-not-write", {
    mode: "tui",
    ui: { confirm: async () => { prompts += 1; return false; } },
  });
  assert.equal(prompts, 1);
  assert.equal(messages[0].message.details.code, "helix-mutation-cancelled");
  assert.equal(messages[0].message.details.mutating, false);
});

test("helix-setup projects Pi's available model inventory", async () => {
  const { commands, messages } = loadHelixCommands();
  await commandByName(commands, "helix-setup").handler("", {
    mode: "tui",
    ui: {},
    modelRegistry: {
      async getAvailable() {
        return [{ provider: "openai", id: "gpt-5x", reasoning: true }];
      },
    },
  });
  assert.equal(messages[0].message.details.status, "ok");
  assert.match(messages[0].message.content, /openai-api\/gpt-5x \(reasoning\)/);
});

test("helix-run executes the packaged mock runner only after TUI confirmation", async () => {
  let invocation = null;
  const { commands, messages } = loadHelixCommands({
    async exec(command, args, options) {
      invocation = { command, args, options };
      return {
        stdout: '{"converged":true,"stop_reason":"converged"}\n',
        stderr: "",
        code: 0,
        killed: false,
      };
    },
  });
  const working = [];
  await commandByName(commands, "helix-run").handler("mock-core-loop", {
    mode: "tui",
    cwd: process.cwd(),
    signal: undefined,
    ui: {
      confirm: async () => true,
      notify() {},
      setWorkingMessage: (message) => working.push(message ?? null),
      setWorkingVisible: (visible) => working.push(visible),
    },
  });

  assert.equal(messages.length, 2);
  assert.equal(messages[0].message.details.title, "Helix run preflight");
  assert.equal(messages[1].message.details.title, "Helix run complete");
  assert.match(messages[1].message.content, /Inspect: \/helix-run-status helix-/);
  assert.equal(invocation.command, process.execPath);
  assert.match(invocation.args[0], /tools\/loop\/helix-task-loop\.mjs$/);
  assert.deepEqual(invocation.args.slice(1, 3), ["--config", "mock-core-loop"]);
  assert.equal(invocation.args.includes("--repo"), false);
  assert.deepEqual(working, ["Helix is running mock-core-loop", true, false, null]);
});

test("helix-settings is a keyboard-native checkbox list with immediate persistence", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-command-ui-"));
  const previous = process.env.HELIX_STATE_DIR;
  process.env.HELIX_STATE_DIR = stateRoot;
  try {
    const { commands } = loadHelixCommands();
    const notices = [];
    let firstRender = [];
    const theme = {
      bold: (text) => text,
      fg: (_color, text) => text,
      bg: (_color, text) => text,
    };
    const keybindings = {
      matches(data, action) {
        return (action === "tui.select.up" && data === "UP")
          || (action === "tui.select.down" && data === "DOWN")
          || (action === "tui.select.confirm" && data === "ENTER")
          || (action === "tui.select.cancel" && data === "ESC");
      },
    };
    await commandByName(commands, "helix-settings").handler("", {
      mode: "tui",
      ui: {
        notify: (message, level) => notices.push({ message, level }),
        async custom(factory) {
          const component = await factory({ requestRender() {} }, theme, keybindings, () => {});
          firstRender = component.render(80);
          component.handleInput(" ");
          component.handleInput("ESC");
        },
      },
    });

    assert.ok(firstRender.some((line) => line.includes("[x] Multi-model")));
    assert.ok(firstRender.some((line) => line.includes("[x] Visual cues")));
    const settings = JSON.parse(readFileSync(join(stateRoot, "settings.json"), "utf8"));
    assert.equal(settings.toggles["multi-model"], false);
    assert.deepEqual(notices, [{ message: "Multi-model disabled", level: "info" }]);
  } finally {
    if (previous === undefined) delete process.env.HELIX_STATE_DIR;
    else process.env.HELIX_STATE_DIR = previous;
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("helix message renderer respects narrow terminal widths", () => {
  const { renderers } = loadHelixCommands();
  const renderer = renderers.get("helix-command");
  const component = renderer(
    { content: "A long Helix message that must wrap safely.", details: { title: "Helix help", status: "ok" } },
    { expanded: false },
    { bold: (text) => text, fg: (_color, text) => text },
  );
  assert.equal(component.render(20).every((line) => line.length <= 20), true);
});
