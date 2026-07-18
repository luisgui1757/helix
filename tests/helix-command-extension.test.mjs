import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import helixCommand from "../extensions/helix-command.ts";
import { createWorkflowFromTemplate } from "../dispatch/lib/workflows.mjs";
import { agent, objectiveGate, pipeline, terminal, workflow } from "../dispatch/workflow/builder.mjs";
import { saveUserWorkflow, saveUserWorkflowV4 } from "../extensions/lib/helix-workflows.mjs";
import { saveProfile, switchProfile } from "../extensions/lib/helix-local.mjs";

const COMMAND_NAMES = [
  "helix",
  "helix-help",
  "helix-onboarding",
  "helix-run",
  "helix-runs",
  "helix-run-status",
  "helix-run-watch",
  "helix-run-resume",
  "helix-run-prune",
  "helix-models",
  "helix-chains",
  "helix-workflows",
  "helix-workflow-create",
  "helix-workflow-edit",
  "helix-workflow-clone",
  "helix-workflow-delete",
  "helix-settings",
  "helix-profiles",
  "helix-setup",
  "helix-research",
];

function loadHelixCommands(overrides = {}) {
  const commands = [];
  const messages = [];
  const renderers = new Map();
  const handlers = new Map();
  helixCommand({
    on(event, handler) {
      handlers.set(event, handler);
    },
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
  return { commands, handlers, messages, renderers };
}

function commandByName(commands, name) {
  return commands.find((command) => command.name === name);
}

function onboardingUi({ choice = "Start the 4-step tour", inputs = ["ENTER", "ENTER", "ENTER", "ENTER"], width = 80 } = {}) {
  const notices = [];
  const renders = [];
  let selects = 0;
  let customs = 0;
  const theme = {
    bold: (text) => text,
    fg: (_color, text) => text,
  };
  const keybindings = {
    matches(data, action) {
      return (action === "tui.select.up" && data === "UP")
        || (action === "tui.select.down" && data === "DOWN")
        || (action === "tui.select.confirm" && data === "ENTER")
        || (action === "tui.select.cancel" && data === "ESC");
    },
  };
  return {
    get customs() { return customs; },
    get selects() { return selects; },
    notices,
    renders,
    async select(title, options) {
      selects += 1;
      assert.equal(title, "Welcome to Helix");
      assert.deepEqual(options, ["Start the 4-step tour", "Later", "Don't show again"]);
      return choice;
    },
    notify(message, level) {
      notices.push({ message, level });
    },
    async custom(factory) {
      customs += 1;
      let result;
      const component = await factory({ requestRender() {} }, theme, keybindings, (value) => { result = value; });
      renders.push(component.render(width));
      for (const input of inputs) component.handleInput(input);
      return result;
    },
  };
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

test("run completion discovers personal workflows from Helix state", () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-workflow-completion-"));
  const previous = process.env.HELIX_STATE_DIR;
  process.env.HELIX_STATE_DIR = stateRoot;
  try {
    const created = createWorkflowFromTemplate({ id: "personal-flow" });
    assert.equal(created.ok, true);
    assert.equal(saveUserWorkflow(stateRoot, created.workflow).ok, true);
    const { commands } = loadHelixCommands();
    const runs = commandByName(commands, "helix-run").getArgumentCompletions("personal");
    assert.deepEqual(runs, [{
      value: "personal-flow",
      label: "personal-flow",
      description: "Personal Helix workflow",
    }]);
  } finally {
    if (previous === undefined) delete process.env.HELIX_STATE_DIR;
    else process.env.HELIX_STATE_DIR = previous;
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("helix-help renders product help without loading mutable state", async () => {
  const { commands, messages } = loadHelixCommands();
  await commandByName(commands, "helix-help").handler("", { mode: "print", ui: {} });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].message.details.title, "Helix help");
  assert.equal(messages[0].message.details.status, "ok");
  assert.match(messages[0].message.content, /\/helix-onboarding/);
  assert.match(messages[0].message.content, /\/helix-settings/);
});

test("first cold TUI startup gives an explicit Pi-provider prerequisite tour once", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-onboarding-startup-"));
  const previous = process.env.HELIX_STATE_DIR;
  process.env.HELIX_STATE_DIR = stateRoot;
  try {
    const { handlers } = loadHelixCommands();
    const ui = onboardingUi({ width: 30 });
    await handlers.get("session_start")({ reason: "startup" }, { mode: "tui", ui });

    const firstPage = ui.renders[0].join("\n");
    assert.match(firstPage, /Connect providers in Pi/);
    assert.match(firstPage, /configure or sync the/);
    assert.match(firstPage, /does\s+not log in, choose, or/);
    assert.match(firstPage, /esc later/);
    assert.equal(ui.renders[0].every((line) => line.length <= 30), true);
    assert.deepEqual(JSON.parse(readFileSync(join(stateRoot, "onboarding.json"), "utf8")), {
      schema_version: 1,
      status: "completed",
    });

    await handlers.get("session_start")({ reason: "startup" }, { mode: "tui", ui });
    assert.equal(ui.selects, 1);
    assert.equal(ui.customs, 1);
  } finally {
    if (previous === undefined) delete process.env.HELIX_STATE_DIR;
    else process.env.HELIX_STATE_DIR = previous;
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("first-run onboarding only prompts on a cold attended startup", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-onboarding-reasons-"));
  const previous = process.env.HELIX_STATE_DIR;
  process.env.HELIX_STATE_DIR = stateRoot;
  try {
    const { handlers } = loadHelixCommands();
    const ui = onboardingUi();
    for (const reason of ["reload", "new", "resume", "fork"]) {
      await handlers.get("session_start")({ reason }, { mode: "tui", ui });
    }
    await handlers.get("session_start")({ reason: "startup" }, { mode: "print", ui });
    assert.equal(ui.selects, 0);
    assert.equal(ui.customs, 0);
    assert.equal(existsSync(join(stateRoot, "onboarding.json")), false);
  } finally {
    if (previous === undefined) delete process.env.HELIX_STATE_DIR;
    else process.env.HELIX_STATE_DIR = previous;
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("an unreadable onboarding marker refuses with an actionable recovery", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-onboarding-unreadable-"));
  const previous = process.env.HELIX_STATE_DIR;
  process.env.HELIX_STATE_DIR = stateRoot;
  try {
    writeFileSync(join(stateRoot, "onboarding.json"), "{}\n", "utf8");
    const { handlers } = loadHelixCommands();
    const ui = onboardingUi();
    await handlers.get("session_start")({ reason: "startup" }, { mode: "tui", ui });

    assert.equal(ui.selects, 0);
    assert.equal(ui.customs, 0);
    assert.deepEqual(ui.notices, [{
      message: "Helix onboarding state is unreadable · fix or remove onboarding.json in Helix state, then retry",
      level: "warning",
    }]);
  } finally {
    if (previous === undefined) delete process.env.HELIX_STATE_DIR;
    else process.env.HELIX_STATE_DIR = previous;
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("Later defers without state while Don't show again persists a rerunnable dismissal", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-onboarding-choices-"));
  const previous = process.env.HELIX_STATE_DIR;
  process.env.HELIX_STATE_DIR = stateRoot;
  try {
    const { commands, handlers } = loadHelixCommands();
    const later = onboardingUi({ choice: "Later", inputs: [] });
    await handlers.get("session_start")({ reason: "startup" }, { mode: "tui", ui: later });
    assert.equal(existsSync(join(stateRoot, "onboarding.json")), false);

    const dismissed = onboardingUi({ choice: "Don't show again", inputs: [] });
    await handlers.get("session_start")({ reason: "startup" }, { mode: "tui", ui: dismissed });
    assert.equal(JSON.parse(readFileSync(join(stateRoot, "onboarding.json"), "utf8")).status, "dismissed");

    const rerun = onboardingUi();
    await commandByName(commands, "helix-onboarding").handler("", { mode: "tui", ui: rerun });
    assert.equal(rerun.selects, 0);
    assert.equal(rerun.customs, 1);
    assert.equal(JSON.parse(readFileSync(join(stateRoot, "onboarding.json"), "utf8")).status, "completed");
  } finally {
    if (previous === undefined) delete process.env.HELIX_STATE_DIR;
    else process.env.HELIX_STATE_DIR = previous;
    rmSync(stateRoot, { recursive: true, force: true });
  }
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
        return [
          { provider: "openai", id: "gpt-5x", reasoning: true },
          { provider: "CustomProvider", id: "custom-model", reasoning: false },
        ];
      },
    },
  });
  assert.equal(messages[0].message.details.status, "ok");
  assert.match(messages[0].message.content, /openai-api\/gpt-5x \(reasoning\)/);
  assert.match(messages[0].message.content, /CustomProvider\/custom-model/);
});

test("whole-cast effort preflight refuses one unsupported mixed-panel member before confirmation or any session", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-effort-preflight-"));
  const previous = process.env.HELIX_STATE_DIR;
  process.env.HELIX_STATE_DIR = stateRoot;
  let confirmations = 0;
  let sessions = 0;
  let prompts = 0;
  try {
    const overlord = JSON.parse(readFileSync(new URL("../dispatch/config/matrices/overlord.json", import.meta.url), "utf8"));
    const roles = structuredClone(overlord.roles);
    roles.reviewer = [
      {
        provider: "openrouter", model: "supported-model", effort: "high", instances: 1,
        effort_vocab: ["high"],
      },
      {
        provider: "openrouter", model: "unsupported-model", effort: "xhigh", instances: 1,
        effort_vocab: ["xhigh"],
      },
    ];
    assert.equal(saveProfile(stateRoot, {
      schema_version: 1,
      profile_id: "mixed-effort",
      overrides: { presets: { overlord: { roles } } },
    }).ok, true);
    assert.equal(switchProfile(stateRoot, "mixed-effort").ok, true);

    const { commands, messages } = loadHelixCommands({
      async helixSessionFactory() {
        sessions += 1;
        return {
          messages: [],
          async prompt() { prompts += 1; },
          async dispose() {},
        };
      },
    });
    await commandByName(commands, "helix-run").handler("mock-core-loop -- prove preflight atomicity", {
      mode: "tui",
      cwd: process.cwd(),
      modelRegistry: {
        async getAvailable() {
          return [
            { provider: "openrouter", id: "supported-model", reasoning: true },
            {
              provider: "openrouter", id: "unsupported-model", reasoning: true,
              thinkingLevelMap: { xhigh: null },
            },
          ];
        },
        find() { throw new Error("model lookup must not run"); },
        hasConfiguredAuth() { throw new Error("auth lookup must not run"); },
      },
      ui: {
        async confirm() { confirmations += 1; return true; },
        notify() {},
      },
    });

    assert.equal(messages.length, 1);
    assert.equal(messages[0].message.details.code, "pi-effort-unsupported");
    assert.equal(confirmations, 0);
    assert.equal(sessions, 0);
    assert.equal(prompts, 0);
    assert.equal(existsSync(join(stateRoot, "runs")), false);
  } finally {
    if (previous === undefined) delete process.env.HELIX_STATE_DIR;
    else process.env.HELIX_STATE_DIR = previous;
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("helix-run executes the canonical workflow in-process with the exact user task", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-run-ui-"));
  const previous = process.env.HELIX_STATE_DIR;
  process.env.HELIX_STATE_DIR = stateRoot;
  const cwd = mkdtempSync(join(tmpdir(), "helix-run-repo-"));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "helix@example.invalid"], { cwd });
  execFileSync("git", ["config", "user.name", "Helix Run Test"], { cwd });
  writeFileSync(join(cwd, "proposal.txt"), "initial\n", "utf8");
  execFileSync("git", ["add", "proposal.txt"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "baseline"], { cwd });
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
  let confirmation = null;
  try {
    await commandByName(commands, "helix-run").handler("mock-core-loop -- Implement the requested test change", {
      mode: "tui",
      cwd,
      signal: undefined,
      ui: {
        confirm: async (title, body) => { confirmation = { title, body }; return true; },
        notify() {},
        setWorkingMessage: (message) => working.push(message ?? null),
        setWorkingVisible: (visible) => working.push(visible),
      },
    });

    assert.equal(messages.length, 2);
    assert.equal(messages[0].message.details.title, "Helix run preflight");
    assert.equal(messages[1].message.details.title, "Helix run complete");
    assert.equal(confirmation.title, "Start Helix workflow");
    assert.match(confirmation.body, /Exact cast:\n  plan \[composite:overlord\]/);
    assert.match(confirmation.body, /planner: mock\/mock-overlord-planner:max x1/);
    assert.match(confirmation.body, /Bound inputs: task/);
    assert.match(messages[1].message.content, /Inspect: \/helix-run-status helix-/);
    assert.equal(invocation, null, "the extension keeps Pi ModelRegistry/AuthStorage in-process");
    assert.deepEqual(working, [
      "Helix is running mock-core-loop", true,
      "Helix · plan · visit 1",
      "Helix · plan-decision · visit 1",
      "Helix · implement · visit 1",
      "Helix · implement-decision · visit 1",
      "Helix · objective-gate · visit 1",
      "Helix · objective check fail",
      "Helix · implement · visit 2",
      "Helix · implement-decision · visit 2",
      "Helix · objective-gate · visit 2",
      "Helix · objective check pass",
      "Helix · succeeded · visit 1",
      false, null,
    ]);
  } finally {
    if (previous === undefined) delete process.env.HELIX_STATE_DIR;
    else process.env.HELIX_STATE_DIR = previous;
    rmSync(stateRoot, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("helix-run collects required and optional typed inputs and renders only bound names", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-run-input-ui-"));
  const previous = process.env.HELIX_STATE_DIR;
  process.env.HELIX_STATE_DIR = stateRoot;
  const cwd = mkdtempSync(join(tmpdir(), "helix-run-input-repo-"));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "helix@example.invalid"], { cwd });
  execFileSync("git", ["config", "user.name", "Helix Input Test"], { cwd });
  writeFileSync(join(cwd, "tracked.txt"), "baseline\n", "utf8");
  execFileSync("git", ["add", "tracked.txt"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "baseline"], { cwd });
  const objective = { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 };
  const built = workflow({
    id: "typed-ui", name: "Typed UI", description: "Collect typed input.", start: "review",
    inputs: {
      type: "object", additionalProperties: false, required: ["task", "items"],
      properties: {
        task: { type: "string", minLength: 1, maxLength: 65_536 },
        items: { type: "array", description: "Items to inspect", items: { type: "string", minLength: 1, maxLength: 32 }, minItems: 1, maxItems: 3 },
        note: { type: "string", description: "Optional note", maxLength: 64 },
        strict: { type: "boolean", default: true },
      },
    },
    nodes: {
      review: pipeline([agent({ role: "reviewer", stage_id: "review", output_schema: "verdict-v1", mutation: "read-only", timeout_ms: 1_000 })], "objective", { max_visits: 1 }),
      objective: objectiveGate("success", "failed"),
      success: terminal("succeeded"),
      failed: terminal("failed", "objective-failed"),
    },
    objective_gate: objective,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  assert.equal(saveUserWorkflowV4(stateRoot, built.definition).ok, true);
  const { commands } = loadHelixCommands();
  const prompts = [];
  const answers = ['["a","b"]', "", ""];
  let confirmation = null;
  try {
    await commandByName(commands, "helix-run").handler("typed-ui -- Review typed data", {
      mode: "tui", cwd,
      ui: {
        input: async (prompt) => { prompts.push(prompt); return answers.shift() ?? null; },
        confirm: async (_title, body) => { confirmation = body; return false; },
        notify() {},
      },
    });
    assert.match(prompts[0], /items.*required.*Items to inspect/);
    assert.match(prompts[1], /note.*optional; leave blank to omit.*Optional note/);
    assert.match(prompts[2], /strict.*default true; leave blank to use it/);
    assert.match(confirmation, /Bound inputs: items, strict, task/);
    assert.equal(confirmation.includes("a\",\"b"), false, "consent never renders input values");
    assert.equal(existsSync(join(stateRoot, "runs")), false);
  } finally {
    if (previous === undefined) delete process.env.HELIX_STATE_DIR;
    else process.env.HELIX_STATE_DIR = previous;
    rmSync(stateRoot, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
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

test("workflow creator guides template, limits, transitions, validation, simulation, and save", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-workflow-ui-"));
  const previous = process.env.HELIX_STATE_DIR;
  process.env.HELIX_STATE_DIR = stateRoot;
  try {
    const { commands, messages } = loadHelixCommands();
    const selections = [
      "Implement and review — Build, review, and retry until approved.",
      "6 (recommended)",
      "Check text in a stage output (weaker: the model writes the marker)",
      "proposal.txt",
      "3 (recommended)",
      "Retry this stage",
      "Stop the workflow",
      "Finish building",
    ];
    const inputs = ["guided-flow", "proposal.txt", "READY TO SHIP"];
    const notices = [];
    await commandByName(commands, "helix-workflow-create").handler("", {
      mode: "tui",
      ui: {
        select: async () => selections.shift() ?? null,
        input: async () => inputs.shift() ?? null,
        confirm: async (_title, body) => {
          assert.match(body, /revise-jump → stop/);
          assert.match(body, /Definition transitions tested: 3\/3/);
          assert.match(body, /Runtime effects: not executed/);
          assert.match(body, /Simulation: converged/);
          return true;
        },
        notify: (message, level) => notices.push({ message, level }),
      },
    });
    const saved = JSON.parse(readFileSync(join(stateRoot, "workflows", "guided-flow.json"), "utf8"));
    assert.equal(saved.stop.objective_gate.contains, "READY TO SHIP");
    assert.equal(saved.stages[0].transitions.find((rule) => rule.when.is === "revise-jump").action, "stop");
    assert.equal(notices.some((notice) => notice.message.includes("transitions tested 3\/3")), true);
    assert.equal(messages.at(-1).message.details.title, "Helix workflow");
  } finally {
    if (previous === undefined) delete process.env.HELIX_STATE_DIR;
    else process.env.HELIX_STATE_DIR = previous;
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("workflow creator refuses an unsafe durable output without changing the template output", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-workflow-output-ui-"));
  const previous = process.env.HELIX_STATE_DIR;
  process.env.HELIX_STATE_DIR = stateRoot;
  try {
    const { commands } = loadHelixCommands();
    const selections = [
      "Implement and review — Build, review, and retry until approved.",
      "6 (recommended)",
      "Check text in a stage output (weaker: the model writes the marker)", "proposal.txt",
      "3 (recommended)", "Retry this stage", "Retry this stage",
      "Edit stage durable output", "implement", "Finish building",
    ];
    const inputs = ["safe-output-flow", "proposal.txt", "DONE", ".git"];
    const notices = [];
    await commandByName(commands, "helix-workflow-create").handler("", {
      mode: "tui",
      ui: {
        select: async () => selections.shift() ?? null,
        input: async () => inputs.shift() ?? null,
        notify: (message, level) => notices.push({ message, level }),
        confirm: async () => true,
      },
    });
    assert.deepEqual(selections, []);
    const saved = JSON.parse(readFileSync(join(stateRoot, "workflows", "safe-output-flow.json"), "utf8"));
    assert.deepEqual(saved.stages[0].artifact, { path: "proposal.txt", kind: "notes" });
    assert.equal(notices.some((notice) => notice.message.includes("safe repository-relative file path")), true);
  } finally {
    if (previous === undefined) delete process.env.HELIX_STATE_DIR;
    else process.env.HELIX_STATE_DIR = previous;
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("workflow creator refuses an unavailable command objective check before saving", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-workflow-command-ui-"));
  const previous = process.env.HELIX_STATE_DIR;
  process.env.HELIX_STATE_DIR = stateRoot;
  try {
    const { commands } = loadHelixCommands();
    const selections = [
      "Implement and review — Build, review, and retry until approved.",
      "6 (recommended)",
      "Run a command (recommended)", "2 minutes (recommended)",
      "3 (recommended)", "Retry this stage", "Stop the workflow",
      "Finish building",
    ];
    const inputs = ["missing-command-flow", "proposal.txt", "helix-command-that-does-not-exist", ""];
    const notices = [];
    await commandByName(commands, "helix-workflow-create").handler("", {
      mode: "tui",
      cwd: stateRoot,
      ui: {
        select: async () => selections.shift() ?? null,
        input: async () => inputs.shift() ?? null,
        confirm: async () => { throw new Error("invalid workflow must not reach save confirmation"); },
        notify: (message, level) => notices.push({ message, level }),
      },
    });
    assert.equal(existsSync(join(stateRoot, "workflows", "missing-command-flow.json")), false);
    assert.equal(notices.some((notice) => notice.message.includes("executable is unavailable")), true);
  } finally {
    if (previous === undefined) delete process.env.HELIX_STATE_DIR;
    else process.env.HELIX_STATE_DIR = previous;
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("workflow creator composes stage, panel, transition, deployment, and duration blocks", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-workflow-block-ui-"));
  const previous = process.env.HELIX_STATE_DIR;
  process.env.HELIX_STATE_DIR = stateRoot;
  try {
    const { commands } = loadHelixCommands();
    const selections = [
      "Plan, implement, review — Review the plan, implement it, and send flawed work back to planning.",
      "6 (recommended)",
      "Check text in a stage output (weaker: the model writes the marker)", "proposal.txt",
      "3 (recommended)", "Retry this stage", "Retry this stage",
      "3 (recommended)", "Retry this stage", "Go back to plan",
      "Add stage", "builder", "reviewer", "Done adding roles", "notes", "2", "Always advance",
      "Move stage earlier", "verify",
      "Edit stage panel roles", "verify", "Add role", "redteam",
      "Edit stage transitions", "verify", "Replace condition family", "Verdict from a panel role", "reviewer",
      "Edit stage transitions", "verify", "Change action", "reviewer=revise-jump → retry", "Stop",
      "Edit stage durable output", "verify", "brief",
      "Edit deployment", "Stage cast preset", "verify", "overlord",
      "Edit deployment", "Maximum concurrency", "3",
      "Edit duration limits", "20 minutes", "5 minutes",
      "Add stage", "builder", "Done adding roles", "notes", "1", "Always advance",
      "Remove stage", "plan",
      "Remove stage", "temp",
      "Finish building",
    ];
    const inputs = [
      "blocks-flow", "proposal.txt", "BLOCKS_DONE", "verify", "VERIFY.md", "review-blocked",
      "REVIEW.md", "temp", "TEMP.md",
    ];
    const notices = [];
    await commandByName(commands, "helix-workflow-create").handler("", {
      mode: "tui",
      ui: {
        select: async () => selections.shift() ?? null,
        input: async () => inputs.shift() ?? null,
        notify: (message, level) => notices.push({ message, level }),
        confirm: async (_title, body) => {
          assert.match(body, /panel: builder, reviewer, redteam/);
          assert.match(body, /output: REVIEW.md \(brief\)/);
          assert.match(body, /reviewer=revise-jump → stop/);
          assert.match(body, /Stage casts: verify=overlord/);
          assert.match(body, /Concurrency: 3/);
          assert.match(body, /Runtime: 1200000ms total; 300000ms per call/);
          return true;
        },
      },
    });

    assert.deepEqual(selections, []);
    const saved = JSON.parse(readFileSync(join(stateRoot, "workflows", "blocks-flow.json"), "utf8"));
    assert.deepEqual(saved.stages.map((stage) => stage.id), ["plan", "verify", "implement"]);
    assert.deepEqual(saved.stages[1].steps.map((step) => step.role), ["builder", "reviewer", "redteam"]);
    assert.deepEqual(saved.stages[1].artifact, { path: "REVIEW.md", kind: "brief" });
    assert.equal(saved.stages[1].transitions.find((rule) => rule.when.is === "revise-jump").reason, "review-blocked");
    assert.deepEqual(saved.deployment.assignments.verify, { kind: "composite", preset: "overlord" });
    assert.equal(saved.deployment.parallel.max_concurrency, 3);
    assert.equal(saved.stop.max_runtime_ms, 1_200_000);
    assert.equal(saved.deployment.call_timeout_ms, 300_000);
    assert.equal(notices.some((notice) => notice.message.includes("back target")), true);
  } finally {
    if (previous === undefined) delete process.env.HELIX_STATE_DIR;
    else process.env.HELIX_STATE_DIR = previous;
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("workflow edit, clone, and delete form a complete attended personal lifecycle", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-workflow-lifecycle-ui-"));
  const previous = process.env.HELIX_STATE_DIR;
  process.env.HELIX_STATE_DIR = stateRoot;
  try {
    const created = createWorkflowFromTemplate({ id: "lifecycle-flow" });
    assert.equal(created.ok, true);
    assert.equal(saveUserWorkflow(stateRoot, created.workflow).ok, true);
    const { commands } = loadHelixCommands();

    await commandByName(commands, "helix-workflow-edit").handler("lifecycle-flow", {
      mode: "tui",
      ui: {
        select: async () => "Finish building",
        input: async () => null,
        confirm: async () => true,
        notify() {},
      },
    });
    assert.equal(existsSync(join(stateRoot, "workflows", "lifecycle-flow.json")), true);

    const cloneInputs = ["lifecycle-copy"];
    await commandByName(commands, "helix-workflow-clone").handler("lifecycle-flow", {
      mode: "tui",
      ui: {
        select: async () => "Finish building",
        input: async () => cloneInputs.shift(),
        confirm: async () => true,
        notify() {},
      },
    });
    const clone = JSON.parse(readFileSync(join(stateRoot, "workflows", "lifecycle-copy.json"), "utf8"));
    assert.equal(clone.deployment.chain_id, "lifecycle-copy");
    assert.equal(clone.deployment.claims_ref, "local-ref:claims/lifecycle-copy");

    await commandByName(commands, "helix-workflow-delete").handler("lifecycle-copy", {
      mode: "tui",
      ui: { select: async () => null, input: async () => null, confirm: async () => true, notify() {} },
    });
    assert.equal(existsSync(join(stateRoot, "workflows", "lifecycle-copy.json")), false);
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
