import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import helixCommand from "../extensions/helix-command.ts";
import { createWorkflowFromTemplate } from "../dispatch/lib/workflows.mjs";
import {
  agent,
  checkpoint,
  humanChoice,
  objectiveGate,
  pipeline,
  subworkflow,
  terminal,
  workflow,
} from "../dispatch/workflow/builder.mjs";
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
  "helix-control",
  "helix-run-stop",
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

async function waitForMessage(messages, title, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = messages.find((entry) => entry.message.details?.title === title);
    if (found) return found.message;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`message-timeout:${title}`);
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
  assert.deepEqual(
    commandByName(commands, "helix-run").getArgumentCompletions("mock-core-loop --execution-mode ")
      .map((item) => item.label),
    ["original-mode", "graph-mode"],
  );

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

test("workflow import receives live inventory and validates before confirmation", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-import-inventory-"));
  const cwd = mkdtempSync(join(tmpdir(), "helix-import-inventory-cwd-"));
  const previous = process.env.HELIX_STATE_DIR;
  process.env.HELIX_STATE_DIR = stateRoot;
  const objective = { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 };
  const built = workflow({
    id: "inventory-import", name: "Inventory import", description: "Import with a real assignment.", start: "review",
    nodes: {
      review: pipeline([agent({ role: "reviewer", stage_id: "review", mutation: "read-only", timeout_ms: 1_000 })], "objective"),
      objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "objective-failed"),
    },
    provider_policy: {
      exact: true, assignments: {},
      default_assignment: { kind: "model", provider: "openrouter", model: "vendor/import:free", effort: "high" },
      require_live_certification: false,
    },
    objective_gate: objective,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  writeFileSync(join(cwd, "flow.json"), JSON.stringify(built.definition));
  writeFileSync(join(cwd, "malformed.json"), "{}\n");
  let inventoryCalls = 0;
  let confirmations = 0;
  try {
    const { commands, messages } = loadHelixCommands();
    const ctx = {
      mode: "tui", cwd,
      modelRegistry: { async getAvailable() { inventoryCalls += 1; return [{ provider: "openrouter", id: "vendor/import:free", reasoning: true }]; } },
      ui: { async confirm() { confirmations += 1; return false; }, notify() {} },
    };
    await commandByName(commands, "helix-workflows").handler("import flow.json", ctx);
    assert.equal(messages.at(-1).message.details.code, "helix-mutation-cancelled");
    assert.equal(inventoryCalls, 1);
    assert.equal(confirmations, 1);
    await commandByName(commands, "helix-workflows").handler("import malformed.json", ctx);
    assert.equal(messages.at(-1).message.details.code, "workflow-migration-input-invalid");
    assert.equal(confirmations, 1, "invalid imports never reach mutation confirmation");
  } finally {
    if (previous === undefined) delete process.env.HELIX_STATE_DIR;
    else process.env.HELIX_STATE_DIR = previous;
    rmSync(stateRoot, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
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

    const completed = await waitForMessage(messages, "Helix run complete");
    assert.equal(messages.length, 3);
    assert.equal(messages[0].message.details.title, "Helix run preflight");
    assert.equal(messages[1].message.details.title, "Helix run started");
    assert.equal(completed.details.title, "Helix run complete");
    assert.equal(confirmation.title, "Start Helix workflow");
    assert.match(confirmation.body, /Execution mode: original-mode/);
    assert.equal(messages[0].message.details.execution_mode, "original-mode");
    assert.equal(completed.details.execution_mode, "original-mode");
    assert.match(confirmation.body, /Exact cast:\n  plan \[composite:overlord\]/);
    assert.match(confirmation.body, /planner: mock\/mock-overlord-planner:max x1/);
    assert.match(confirmation.body, /Bound inputs: task/);
    assert.match(completed.content, /Inspect: \/helix-run-status helix-/);
    assert.equal(invocation, null, "the extension keeps Pi ModelRegistry/AuthStorage in-process");
    assert.deepEqual(working, [], "background workflows do not take over Pi's foreground working indicator");
    await commandByName(commands, "helix-run-watch").handler(completed.details.run_id, {
      mode: "print", cwd, ui: {},
    });
    assert.equal(messages.at(-1).message.details.title, "Helix run watch");
    assert.equal(messages.at(-1).message.details.execution_mode, "original-mode");
    assert.match(messages.at(-1).message.content, /Execution mode: original-mode/);
  } finally {
    if (previous === undefined) delete process.env.HELIX_STATE_DIR;
    else process.env.HELIX_STATE_DIR = previous;
    rmSync(stateRoot, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("helix-control inspects and cancels a session background run", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-control-ui-"));
  const previous = process.env.HELIX_STATE_DIR;
  process.env.HELIX_STATE_DIR = stateRoot;
  const cwd = mkdtempSync(join(tmpdir(), "helix-control-repo-"));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "helix@example.invalid"], { cwd });
  execFileSync("git", ["config", "user.name", "Helix Control Test"], { cwd });
  writeFileSync(join(cwd, "proposal.txt"), "initial\n", "utf8");
  execFileSync("git", ["add", "proposal.txt"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "baseline"], { cwd });
  const statuses = [];
  const selections = [];
  const notices = [];
  let confirmations = 0;
  const { commands, handlers, messages } = loadHelixCommands();
  const ui = {
    async confirm() {
      confirmations += 1;
      return true;
    },
    async select(title, options) {
      selections.push({ title, options });
      return options[0];
    },
    notify(message, level) { notices.push({ message, level }); },
    setStatus(key, value) { statuses.push({ key, value }); },
  };
  try {
    await commandByName(commands, "helix-run").handler(
      "mock-core-loop -- Keep the run active until control cancels it",
      { mode: "tui", cwd, ui },
    );
    const started = messages.find((entry) => entry.message.details?.title === "Helix run started")?.message;
    assert.ok(started);
    await commandByName(commands, "helix-control").handler("", { mode: "tui", cwd, ui });
    const control = messages.find((entry) => entry.message.details?.title === "Helix run control")?.message;
    assert.equal(control.details.run_id, started.details.run_id);
    assert.equal(control.details.status, "running");
    assert.equal(selections[0].title, "Helix run control");
    assert.match(selections[0].options[0], new RegExp(started.details.run_id));
    assert.equal(confirmations, 2);
    const cancelled = await waitForMessage(messages, "Helix run cancelled");
    assert.equal(cancelled.details.run_id, started.details.run_id);
    assert.equal(statuses.some((entry) => entry.key === "helix-runs"
      && /1 background run/.test(entry.value ?? "")), true);
    assert.equal(statuses.at(-1).value, undefined);
    await handlers.get("session_shutdown")({}, { ui });
    await handlers.get("session_start")({ reason: "switch" }, { ui });
    await commandByName(commands, "helix-control").handler("", { mode: "tui", cwd, ui });
    assert.equal(notices.at(-1).message, "No workflows are managed by this Pi session");
  } finally {
    if (previous === undefined) delete process.env.HELIX_STATE_DIR;
    else process.env.HELIX_STATE_DIR = previous;
    rmSync(stateRoot, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("helix-control re-reads a run that settles while its selection menu is open", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-control-settlement-"));
  const previous = process.env.HELIX_STATE_DIR;
  process.env.HELIX_STATE_DIR = stateRoot;
  const cwd = mkdtempSync(join(tmpdir(), "helix-control-settlement-repo-"));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "helix@example.invalid"], { cwd });
  execFileSync("git", ["config", "user.name", "Helix Control Settlement"], { cwd });
  writeFileSync(join(cwd, "baseline.txt"), "baseline\n", "utf8");
  execFileSync("git", ["add", "baseline.txt"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "baseline"], { cwd });
  const { commands, handlers, messages } = loadHelixCommands();
  let confirmations = 0;
  let releaseSelection;
  let selectionStarted;
  let selectedLabel = null;
  const selecting = new Promise((resolve) => { selectionStarted = resolve; });
  const ui = {
    async confirm() {
      confirmations += 1;
      return true;
    },
    select(_title, options) {
      selectedLabel = options[0];
      selectionStarted();
      return new Promise((resolve) => { releaseSelection = () => resolve(options[0]); });
    },
    notify() {},
    setStatus() {},
  };
  try {
    await commandByName(commands, "helix-run").handler(
      "mock-core-loop -- Complete while the control menu remains open",
      { mode: "tui", cwd, ui },
    );
    const pendingControl = commandByName(commands, "helix-control").handler(
      "",
      { mode: "tui", cwd, ui },
    );
    await selecting;
    assert.match(selectedLabel, /· running$/);
    await waitForMessage(messages, "Helix run complete");
    releaseSelection();
    await pendingControl;
    assert.equal(messages.at(-1).message.details.title, "Helix run control");
    assert.equal(messages.at(-1).message.details.status, "succeeded");
    assert.equal(confirmations, 1, "a settled run never reaches cancellation confirmation");
  } finally {
    await handlers.get("session_shutdown")({}, { ui });
    if (previous === undefined) delete process.env.HELIX_STATE_DIR;
    else process.env.HELIX_STATE_DIR = previous;
    rmSync(stateRoot, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("helix-control reports a run that settles while cancellation confirmation is open", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-control-confirmation-"));
  const previous = process.env.HELIX_STATE_DIR;
  process.env.HELIX_STATE_DIR = stateRoot;
  const cwd = mkdtempSync(join(tmpdir(), "helix-control-confirmation-repo-"));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "helix@example.invalid"], { cwd });
  execFileSync("git", ["config", "user.name", "Helix Control Confirmation"], { cwd });
  writeFileSync(join(cwd, "baseline.txt"), "baseline\n", "utf8");
  execFileSync("git", ["add", "baseline.txt"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "baseline"], { cwd });
  const { commands, handlers, messages } = loadHelixCommands();
  const notices = [];
  let releaseCancellation;
  let cancellationStarted;
  const confirmingCancellation = new Promise((resolve) => { cancellationStarted = resolve; });
  const ui = {
    confirm(title) {
      if (title === "Start Helix workflow") return Promise.resolve(true);
      cancellationStarted();
      return new Promise((resolve) => { releaseCancellation = () => resolve(true); });
    },
    async select(_title, options) { return options[0]; },
    notify(message, level) { notices.push({ message, level }); },
    setStatus() {},
  };
  try {
    await commandByName(commands, "helix-run").handler(
      "mock-core-loop -- Complete while cancellation confirmation remains open",
      { mode: "tui", cwd, ui },
    );
    const pendingControl = commandByName(commands, "helix-control").handler(
      "",
      { mode: "tui", cwd, ui },
    );
    await confirmingCancellation;
    assert.equal(messages.at(-1).message.details.status, "running");
    await waitForMessage(messages, "Helix run complete");
    releaseCancellation();
    await pendingControl;
    assert.match(notices.at(-1).message, /already closed before cancellation$/);
    assert.equal(notices.at(-1).level, "info");
  } finally {
    await handlers.get("session_shutdown")({}, { ui });
    if (previous === undefined) delete process.env.HELIX_STATE_DIR;
    else process.env.HELIX_STATE_DIR = previous;
    rmSync(stateRoot, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("session rotation revokes a delayed run-control selection and closes the prior supervisor", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-control-rotation-"));
  const previous = process.env.HELIX_STATE_DIR;
  process.env.HELIX_STATE_DIR = stateRoot;
  const cwd = mkdtempSync(join(tmpdir(), "helix-control-rotation-repo-"));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "helix@example.invalid"], { cwd });
  execFileSync("git", ["config", "user.name", "Helix Control Rotation"], { cwd });
  writeFileSync(join(cwd, "baseline.txt"), "baseline\n", "utf8");
  execFileSync("git", ["add", "baseline.txt"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "baseline"], { cwd });
  const { commands, handlers, messages } = loadHelixCommands();
  const notices = [];
  const statuses = [];
  let confirmations = 0;
  let releaseSelection;
  let selectionStarted;
  const selecting = new Promise((resolve) => { selectionStarted = resolve; });
  const ui = {
    async confirm() {
      confirmations += 1;
      return true;
    },
    select(_title, options) {
      selectionStarted();
      return new Promise((resolve) => { releaseSelection = () => resolve(options[0]); });
    },
    notify(message, level) { notices.push({ message, level }); },
    setStatus(key, value) { statuses.push({ key, value }); },
  };
  try {
    await commandByName(commands, "helix-run").handler(
      "mock-core-loop -- Cancel this run when the Pi session rotates",
      { mode: "tui", cwd, ui },
    );
    assert.equal(messages.at(-1).message.details.title, "Helix run started");

    const pendingControl = commandByName(commands, "helix-control").handler(
      "",
      { mode: "tui", cwd, ui },
    );
    await selecting;
    await handlers.get("session_start")({ reason: "switch" }, { mode: "tui", ui });
    releaseSelection();
    await pendingControl;
    assert.deepEqual(statuses.at(-1), { key: "helix-runs", value: undefined });
    assert.equal(
      messages.some((entry) => entry.message.details?.title === "Helix run control"),
      false,
    );
    assert.equal(confirmations, 1, "the stale control selection never reaches cancellation confirmation");

    await commandByName(commands, "helix-control").handler("", { mode: "tui", cwd, ui });
    assert.equal(notices.at(-1).message, "No workflows are managed by this Pi session");
  } finally {
    await handlers.get("session_shutdown")({}, { ui });
    if (previous === undefined) delete process.env.HELIX_STATE_DIR;
    else process.env.HELIX_STATE_DIR = previous;
    rmSync(stateRoot, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("session shutdown prevents a confirmation-delayed workflow from starting", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "helix-run-shutdown-race-"));
  const { commands, handlers, messages } = loadHelixCommands();
  let releaseConfirmation;
  let confirmationStarted;
  const started = new Promise((resolve) => { confirmationStarted = resolve; });
  const ui = {
    confirm() {
      confirmationStarted();
      return new Promise((resolve) => { releaseConfirmation = resolve; });
    },
    notify() {},
    setStatus() {},
  };
  try {
    const pending = commandByName(commands, "helix-run").handler(
      "mock-core-loop -- Never start after shutdown",
      { mode: "tui", cwd, ui },
    );
    await started;
    const shutdown = handlers.get("session_shutdown")({}, { ui });
    releaseConfirmation(true);
    await Promise.all([pending, shutdown]);
    assert.equal(
      messages.some((entry) => entry.message.details?.title === "Helix run started"),
      false,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("helix-run parses graph-mode before the task and preserves mode-like task text literally", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-run-mode-ui-"));
  const previous = process.env.HELIX_STATE_DIR;
  process.env.HELIX_STATE_DIR = stateRoot;
  const cwd = mkdtempSync(join(tmpdir(), "helix-run-mode-cwd-"));
  let confirmation = null;
  let confirmations = 0;
  try {
    const { commands, messages } = loadHelixCommands();
    await commandByName(commands, "helix-run").handler(
      "mock-core-loop --execution-mode graph-mode -- Keep --execution-mode original-mode as literal task text",
      {
        mode: "tui",
        cwd,
        ui: {
          async confirm(_title, body) {
            confirmations += 1;
            confirmation = body;
            return false;
          },
          notify() {},
        },
      },
    );
    assert.equal(confirmations, 1);
    assert.match(confirmation, /Execution mode: graph-mode/);
    assert.match(confirmation, /Task: Keep --execution-mode original-mode as literal task text/);
    assert.equal(messages[0].message.details.execution_mode, "graph-mode");

    await commandByName(commands, "helix-run").handler(
      "mock-core-loop --execution-mode -- private task",
      {
        mode: "tui",
        cwd,
        ui: {
          async confirm() {
            confirmations += 1;
            return false;
          },
          notify() {},
        },
      },
    );
    assert.equal(confirmations, 1, "malformed mode is refused before confirmation");
    assert.equal(messages.at(-1).message.details.code, "workflow-execution-mode-invalid");
    assert.equal(messages.at(-1).message.content.includes("private task"), false);
  } finally {
    if (previous === undefined) delete process.env.HELIX_STATE_DIR;
    else process.env.HELIX_STATE_DIR = previous;
    rmSync(stateRoot, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("attended graph-mode executes, watches, pauses, resumes, and cleans up its complete command path", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-run-graph-e2e-"));
  const previous = process.env.HELIX_STATE_DIR;
  process.env.HELIX_STATE_DIR = stateRoot;
  const cwd = mkdtempSync(join(tmpdir(), "helix-run-graph-repo-"));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "helix@example.invalid"], { cwd });
  execFileSync("git", ["config", "user.name", "Helix Graph E2E"], { cwd });
  writeFileSync(join(cwd, "baseline.txt"), "baseline\n", "utf8");
  execFileSync("git", ["add", "baseline.txt"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "baseline"], { cwd });
  const built = workflow({
    id: "graph-attended", name: "Graph attended", description: "Attended graph-mode pause and resume coverage.",
    start: "approval",
    nodes: {
      approval: checkpoint("operator-approval", "objective"),
      objective: objectiveGate("succeeded", "failed"),
      succeeded: terminal("succeeded"),
      failed: terminal("failed", "graph-attended-failed"),
    },
    objective_gate: {
      type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000,
    },
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  assert.equal(saveUserWorkflowV4(stateRoot, built.definition).ok, true);
  const confirmations = [];
  const controlSelections = [];
  const { commands, messages } = loadHelixCommands();
  const task = "Exercise the attended graph path";
  const ui = {
    async input() { return task; },
    async select(title, options) {
      controlSelections.push({ title, options });
      return options[0];
    },
    async confirm(title, body) {
      confirmations.push({ title, body });
      return true;
    },
    notify() {},
    setWorkingMessage() {},
    setWorkingVisible() {},
  };
  try {
    await commandByName(commands, "helix-run").handler(
      `graph-attended --execution-mode graph-mode -- ${task}`,
      { mode: "tui", cwd, ui },
    );
    const paused = await waitForMessage(messages, "Helix run paused");
    assert.equal(paused.details.execution_mode, "graph-mode");
    const runId = paused.details.run_id;
    const statePath = join(stateRoot, "runs", runId, `${runId}.state.json`);
    const pausedState = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(pausedState.schema_version, 5);
    assert.equal(pausedState.execution_mode, "graph-mode");
    assert.equal(pausedState.completed, false);
    const privateCheckpoint = JSON.parse(readFileSync(
      join(stateRoot, "private", "runs", runId, "kernel-checkpoint.json"),
      "utf8",
    ));
    assert.equal(privateCheckpoint.scheduler.schema_version, 5);
    assert.equal(privateCheckpoint.scheduler.execution_mode, "graph-mode");

    await commandByName(commands, "helix-control").handler("", { mode: "tui", cwd, ui });
    assert.equal(messages.at(-1).message.details.title, "Helix run control");
    assert.equal(messages.at(-1).message.details.status, "paused");

    await commandByName(commands, "helix-run-watch").handler(runId, { mode: "print", cwd, ui: {} });
    const pausedWatch = messages.at(-1).message;
    assert.equal(pausedWatch.details.execution_mode, "graph-mode");
    assert.equal(pausedWatch.details.current_node, "approval");
    assert.match(pausedWatch.content, /Position: current=approval; last=approval/);

    await commandByName(commands, "helix-run-resume").handler(runId, { mode: "tui", cwd, ui });
    const completed = messages.at(-1).message;
    assert.equal(completed.details.title, "Helix run complete");
    assert.equal(completed.details.execution_mode, "graph-mode");
    const completedState = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(completedState.completed, true);
    assert.equal(completedState.execution_mode, "graph-mode");

    await commandByName(commands, "helix-control").handler("", { mode: "tui", cwd, ui });
    assert.equal(messages.at(-1).message.details.title, "Helix run control");
    assert.equal(messages.at(-1).message.details.status, "succeeded");
    assert.match(controlSelections.at(-1).options[0], /· succeeded$/);

    await commandByName(commands, "helix-run-stop").handler(runId, { mode: "tui", cwd, ui });
    assert.equal(messages.at(-1).message.details.title, "Helix run already closed");
    assert.match(messages.at(-1).message.content, /Run already closed/);

    await commandByName(commands, "helix-run-watch").handler(runId, { mode: "print", cwd, ui: {} });
    const completedWatch = messages.at(-1).message;
    assert.equal(completedWatch.details.current_node, null);
    assert.equal(completedWatch.details.last_node, "succeeded");
    assert.match(completedWatch.content, /Position: current=none; last=succeeded/);
    assert.equal(confirmations.some((entry) => entry.title === "Start Helix workflow"
      && /Execution mode: graph-mode/.test(entry.body)), true);
    assert.equal(confirmations.some((entry) => entry.title === "Resume Helix workflow"
      && /Execution mode: graph-mode/.test(entry.body)), true);
  } finally {
    if (previous === undefined) delete process.env.HELIX_STATE_DIR;
    else process.env.HELIX_STATE_DIR = previous;
    rmSync(stateRoot, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a recoverable background interruption resumes through the same Pi session supervisor", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-interrupted-resume-e2e-"));
  const previous = process.env.HELIX_STATE_DIR;
  process.env.HELIX_STATE_DIR = stateRoot;
  const cwd = mkdtempSync(join(tmpdir(), "helix-interrupted-resume-repo-"));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "helix@example.invalid"], { cwd });
  execFileSync("git", ["config", "user.name", "Helix Interrupted Resume E2E"], { cwd });
  writeFileSync(join(cwd, "baseline.txt"), "baseline\n", "utf8");
  execFileSync("git", ["add", "baseline.txt"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "baseline"], { cwd });
  const built = workflow({
    id: "interrupted-resume-e2e",
    name: "Interrupted resume E2E",
    description: "A recoverable background interruption remains resumable in the same Pi session.",
    start: "objective",
    nodes: {
      objective: objectiveGate("succeeded", "failed"),
      succeeded: terminal("succeeded"),
      failed: terminal("failed", "interrupted-resume-objective-failed"),
    },
    objective_gate: {
      type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000,
    },
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  assert.equal(saveUserWorkflowV4(stateRoot, built.definition).ok, true);
  const { commands, messages } = loadHelixCommands();
  const task = "Resume this recoverable interruption";
  let statusUpdates = 0;
  let injectEventFailure = true;
  const notices = [];
  const ui = {
    async input() { return task; },
    async confirm() { return true; },
    notify(message, level) { notices.push({ message, level }); },
    setStatus() {
      statusUpdates += 1;
      if (injectEventFailure && statusUpdates === 3) {
        injectEventFailure = false;
        throw new Error("synthetic-event-sink-failure");
      }
    },
    setWorkingMessage() {},
    setWorkingVisible() {},
  };
  try {
    await commandByName(commands, "helix-run").handler(
      `interrupted-resume-e2e --execution-mode graph-mode -- ${task}`,
      { mode: "tui", cwd, ui },
    );
    const interrupted = await waitForMessage(messages, "Helix run interrupted");
    assert.match(interrupted.content, /Reason: kernel-event-write-failed/);
    const runId = interrupted.details.run_id;
    const statePath = join(stateRoot, "runs", runId, `${runId}.state.json`);
    assert.equal(JSON.parse(readFileSync(statePath, "utf8")).completed, false);

    await commandByName(commands, "helix-run-resume").handler(runId, { mode: "tui", cwd, ui });
    const completed = messages.at(-1).message;
    assert.equal(completed.details.title, "Helix run complete");
    assert.equal(completed.details.run_id, runId);
    assert.equal(JSON.parse(readFileSync(statePath, "utf8")).completed, true);
    assert.equal(notices.some((entry) => /run-supervisor-resume-invalid/.test(entry.message)), false);
  } finally {
    if (previous === undefined) delete process.env.HELIX_STATE_DIR;
    else process.env.HELIX_STATE_DIR = previous;
    rmSync(stateRoot, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("helix-run-stop interrupts an active attended resume through the shared run supervisor", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-resume-stop-e2e-"));
  const previous = process.env.HELIX_STATE_DIR;
  process.env.HELIX_STATE_DIR = stateRoot;
  const cwd = mkdtempSync(join(tmpdir(), "helix-resume-stop-repo-"));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "helix@example.invalid"], { cwd });
  execFileSync("git", ["config", "user.name", "Helix Resume Stop E2E"], { cwd });
  writeFileSync(join(cwd, "baseline.txt"), "baseline\n", "utf8");
  execFileSync("git", ["add", "baseline.txt"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "baseline"], { cwd });
  const built = workflow({
    id: "resume-stop-e2e",
    name: "Resume stop E2E",
    description: "An attended resume remains interruptible through run control.",
    start: "approval",
    nodes: {
      approval: checkpoint("operator-approval", "objective"),
      objective: objectiveGate("succeeded", "failed"),
      succeeded: terminal("succeeded"),
      failed: terminal("failed", "resume-stop-objective-failed"),
    },
    objective_gate: {
      type: "command-exit-zero",
      command: "node",
      args: ["-e", "setTimeout(() => process.exit(0), 3000)"],
      timeout_ms: 10_000,
    },
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  assert.equal(saveUserWorkflowV4(stateRoot, built.definition).ok, true);
  const { commands, messages } = loadHelixCommands();
  const task = "Interrupt the active resume";
  let markResumeActive;
  const resumeActive = new Promise((resolve) => { markResumeActive = resolve; });
  const ui = {
    async input() { return task; },
    async select(_title, options) { return options[0]; },
    async confirm() { return true; },
    notify() {},
    setStatus() {},
    setWorkingMessage() {},
    setWorkingVisible(visible) {
      if (visible) markResumeActive();
    },
  };
  try {
    await commandByName(commands, "helix-run").handler(
      `resume-stop-e2e --execution-mode graph-mode -- ${task}`,
      { mode: "tui", cwd, ui },
    );
    const paused = await waitForMessage(messages, "Helix run paused");
    const runId = paused.details.run_id;
    const pendingResume = commandByName(commands, "helix-run-resume").handler(
      runId,
      { mode: "tui", cwd, ui },
    );
    await resumeActive;

    await commandByName(commands, "helix-run-stop").handler(runId, { mode: "tui", cwd, ui });
    assert.equal(messages.at(-1).message.details.title, "Helix run cancellation");
    await pendingResume;

    const cancelled = messages.filter(
      (entry) => entry.message.details?.title === "Helix run cancelled",
    ).at(-1)?.message;
    assert.ok(cancelled);
    assert.equal(cancelled.details.run_id, runId);
    await commandByName(commands, "helix-control").handler("", { mode: "tui", cwd, ui });
    assert.equal(messages.at(-1).message.details.status, "cancelled");
  } finally {
    if (previous === undefined) delete process.env.HELIX_STATE_DIR;
    else process.env.HELIX_STATE_DIR = previous;
    rmSync(stateRoot, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("v5 human choice pauses durably and resumes only from the attended bound selection", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-human-choice-e2e-"));
  const previous = process.env.HELIX_STATE_DIR;
  process.env.HELIX_STATE_DIR = stateRoot;
  const cwd = mkdtempSync(join(tmpdir(), "helix-human-choice-repo-"));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "helix@example.invalid"], { cwd });
  execFileSync("git", ["config", "user.name", "Helix Choice E2E"], { cwd });
  writeFileSync(join(cwd, "baseline.txt"), "baseline\n", "utf8");
  execFileSync("git", ["add", "baseline.txt"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "baseline"], { cwd });
  const built = workflow({
    id: "human-choice-e2e",
    name: "Human choice E2E",
    description: "Durable attended human choice coverage.",
    start: "decision",
    nodes: {
      decision: humanChoice(
        "Continue to the objective check?",
        [
          { id: "proceed", label: "Proceed", target: "objective" },
          { id: "decline", label: "Decline", target: "declined" },
        ],
        { allow_custom: true, custom_target: "declined" },
      ),
      objective: objectiveGate("succeeded", "failed"),
      succeeded: terminal("succeeded"),
      failed: terminal("failed", "objective-failed"),
      declined: terminal("cancelled", "operator-declined"),
    },
    objective_gate: {
      type: "command-exit-zero",
      command: "node",
      args: ["-e", "process.exit(0)"],
      timeout_ms: 1_000,
    },
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  assert.equal(built.definition.schema_version, 5);
  assert.equal(saveUserWorkflowV4(stateRoot, built.definition).ok, true);
  const { commands, handlers, messages } = loadHelixCommands();
  const task = "Exercise durable human choice";
  const selections = [];
  const ui = {
    async input() { return task; },
    async select(question, options) {
      selections.push({ question, options });
      return "Proceed [proceed]";
    },
    async confirm() { return true; },
    notify() {},
    setStatus() {},
  };
  try {
    await commandByName(commands, "helix-run").handler(
      `human-choice-e2e --execution-mode graph-mode -- ${task}`,
      { mode: "tui", cwd, ui },
    );
    const paused = await waitForMessage(messages, "Helix run paused");
    const runId = paused.details.run_id;
    const privatePath = join(stateRoot, "private", "runs", runId, "kernel-checkpoint.json");
    const before = JSON.parse(readFileSync(privatePath, "utf8"));
    assert.equal(before.scheduler.current, "decision");
    assert.equal(before.scheduler.active.node_id, "decision");
    assert.equal(before.scheduler.active.boundary.kind, "human-choice");
    assert.equal(before.scheduler.active.boundary.status, "inflight");

    let releaseSessionChoice;
    let sessionChoiceStarted;
    const sessionChoiceOpen = new Promise((resolve) => { sessionChoiceStarted = resolve; });
    const sessionNotices = [];
    const rotatingResume = commandByName(commands, "helix-run-resume").handler(runId, {
      mode: "tui",
      cwd,
      ui: {
        ...ui,
        async select() {
          sessionChoiceStarted();
          return new Promise((resolve) => {
            releaseSessionChoice = () => resolve("Proceed [proceed]");
          });
        },
        notify(message, level) {
          sessionNotices.push({ message, level });
        },
      },
    });
    await sessionChoiceOpen;
    await handlers.get("session_start")({ reason: "switch" }, { mode: "tui", ui });
    releaseSessionChoice();
    await rotatingResume;
    const afterSessionSwitch = JSON.parse(readFileSync(privatePath, "utf8"));
    assert.equal(afterSessionSwitch.scheduler.active.boundary.status, "inflight");
    assert.equal(sessionNotices.at(-1).message, "Helix resume cancelled; the checkpoint was not changed");

    const cancelled = new AbortController();
    const cancellationNotices = [];
    await commandByName(commands, "helix-run-resume").handler(runId, {
      mode: "tui",
      cwd,
      signal: cancelled.signal,
      ui: {
        ...ui,
        async select() {
          cancelled.abort();
          return "Proceed [proceed]";
        },
        notify(message, level) {
          cancellationNotices.push({ message, level });
        },
      },
    });
    const unchanged = JSON.parse(readFileSync(privatePath, "utf8"));
    assert.equal(unchanged.scheduler.active.boundary.status, "inflight");
    assert.equal(cancellationNotices.at(-1).message, "Helix resume cancelled; the checkpoint was not changed");

    await commandByName(commands, "helix-run-resume").handler(runId, { mode: "tui", cwd, ui });
    const completed = messages.at(-1).message;
    assert.equal(completed.details.title, "Helix run complete");
    assert.equal(completed.details.converged, true);
    assert.deepEqual(selections, [{
      question: "Continue to the objective check?",
      options: ["Proceed [proceed]", "Decline [decline]", "Custom answer…"],
    }]);
    const after = JSON.parse(readFileSync(privatePath, "utf8"));
    assert.deepEqual(after.scheduler.outputs.decision, { kind: "option", option_id: "proceed" });
    const eventText = readFileSync(join(stateRoot, "runs", runId, `${runId}.kernel.events.jsonl`), "utf8");
    assert.match(eventText, /"kind":"human-choice".*"selection":"option:proceed"/);
    assert.equal(eventText.includes(task), false);
  } finally {
    if (previous === undefined) delete process.env.HELIX_STATE_DIR;
    else process.env.HELIX_STATE_DIR = previous;
    rmSync(stateRoot, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a pinned child human choice resumes from its persisted nested checkpoint", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-child-choice-e2e-"));
  const previous = process.env.HELIX_STATE_DIR;
  process.env.HELIX_STATE_DIR = stateRoot;
  const cwd = mkdtempSync(join(tmpdir(), "helix-child-choice-repo-"));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "helix@example.invalid"], { cwd });
  execFileSync("git", ["config", "user.name", "Helix Child Choice E2E"], { cwd });
  writeFileSync(join(cwd, "baseline.txt"), "baseline\n", "utf8");
  execFileSync("git", ["add", "baseline.txt"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "baseline"], { cwd });
  const objective = {
    type: "command-exit-zero",
    command: "node",
    args: ["-e", "process.exit(0)"],
    timeout_ms: 1_000,
  };
  const child = workflow({
    id: "nested-choice-child",
    name: "Nested choice child",
    description: "Pinned child with a durable choice.",
    start: "route",
    nodes: {
      route: humanChoice("Choose the child route", [
        { id: "continue", label: "Continue child", target: "objective" },
        { id: "decline", label: "Decline child", target: "declined" },
      ]),
      objective: objectiveGate("succeeded", "failed"),
      succeeded: terminal("succeeded"),
      failed: terminal("failed", "child-objective-failed"),
      declined: terminal("cancelled", "child-declined"),
    },
    objective_gate: objective,
  });
  const parent = workflow({
    id: "nested-choice-parent",
    name: "Nested choice parent",
    description: "Parent that pins the durable-choice child.",
    start: "child",
    nodes: {
      child: subworkflow("nested-choice-child", 1, "objective"),
      objective: objectiveGate("succeeded", "failed"),
      succeeded: terminal("succeeded"),
      failed: terminal("failed", "parent-objective-failed"),
    },
    objective_gate: objective,
  });
  assert.equal(child.ok, true, JSON.stringify(child.errors));
  assert.equal(parent.ok, true, JSON.stringify(parent.errors));
  assert.equal(saveUserWorkflowV4(stateRoot, child.definition).ok, true);
  assert.equal(saveUserWorkflowV4(stateRoot, parent.definition).ok, true);
  const { commands, messages } = loadHelixCommands();
  const task = "Exercise a nested durable choice";
  const selections = [];
  const ui = {
    async input() { return task; },
    async select(question, options) {
      selections.push({ question, options });
      return "Continue child [continue]";
    },
    async confirm() { return true; },
    notify() {},
    setStatus() {},
    setWorkingMessage() {},
    setWorkingVisible() {},
  };
  try {
    await commandByName(commands, "helix-run").handler(
      `nested-choice-parent --execution-mode graph-mode -- ${task}`,
      { mode: "tui", cwd, ui },
    );
    const paused = await waitForMessage(messages, "Helix run paused");
    const runId = paused.details.run_id;
    const privatePath = join(stateRoot, "private", "runs", runId, "kernel-checkpoint.json");
    const before = JSON.parse(readFileSync(privatePath, "utf8"));
    assert.equal(before.scheduler.active.node_id, "child");
    assert.equal(before.scheduler.active.child.scheduler.active.boundary.kind, "human-choice");

    await commandByName(commands, "helix-run-resume").handler(runId, { mode: "tui", cwd, ui });
    const completed = messages.at(-1).message;
    assert.equal(completed.details.title, "Helix run complete");
    assert.equal(completed.details.converged, true);
    assert.deepEqual(selections, [{
      question: "Choose the child route",
      options: ["Continue child [continue]", "Decline child [decline]"],
    }]);
    const eventText = readFileSync(join(stateRoot, "runs", runId, `${runId}.kernel.events.jsonl`), "utf8");
    assert.match(eventText, /"child_kind":"human-choice".*"child_selection":"option:continue"/);
    assert.equal(eventText.includes(task), false);
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
        count: { type: "integer", default: 7 },
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
  const answers = ["   ", '["a","b"]', "   ", ""];
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
    assert.match(prompts[0], /count.*default 7; leave blank to use it/);
    assert.match(prompts[1], /items.*required.*Items to inspect/);
    assert.match(prompts[2], /note.*optional; leave blank to omit.*Optional note/);
    assert.match(prompts[3], /strict.*default true; leave blank to use it/);
    assert.match(prompts[2], /spaces are preserved/);
    assert.match(confirmation, /Bound inputs: count, items, note, strict, task/);
    assert.equal(confirmation.includes("a\",\"b"), false, "consent never renders input values");
    assert.equal(existsSync(join(stateRoot, "runs")), false);
  } finally {
    if (previous === undefined) delete process.env.HELIX_STATE_DIR;
    else process.env.HELIX_STATE_DIR = previous;
    rmSync(stateRoot, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("helix-run refuses non-JSON numeric tokens before confirmation and binds JSON decimals and exponents", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-run-number-input-ui-"));
  const previous = process.env.HELIX_STATE_DIR;
  process.env.HELIX_STATE_DIR = stateRoot;
  const cwd = mkdtempSync(join(tmpdir(), "helix-run-number-input-repo-"));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "helix@example.invalid"], { cwd });
  execFileSync("git", ["config", "user.name", "Helix Number Input Test"], { cwd });
  writeFileSync(join(cwd, "tracked.txt"), "baseline\n", "utf8");
  execFileSync("git", ["add", "tracked.txt"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "baseline"], { cwd });
  const objective = { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 };
  const built = workflow({
    id: "number-input-ui", name: "Number input UI", description: "Collect strict JSON numbers.", start: "review",
    inputs: {
      type: "object", additionalProperties: false, required: ["task", "count", "ratio"],
      properties: {
        task: { type: "string", minLength: 1, maxLength: 65_536 },
        count: { type: "integer", minimum: 16, maximum: 16 },
        ratio: { type: "number", minimum: -0.025, maximum: -0.025 },
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
  const notices = [];
  let mode = "hex";
  let confirmations = 0;
  try {
    const ui = {
      input: async (prompt) => prompt.includes("'count'")
        ? (mode === "hex" ? "0x10" : "16.0e0")
        : prompt.includes("'ratio'") ? "-2.5E-2" : null,
      confirm: async (_title, body) => {
        confirmations += 1;
        assert.match(body, /Bound inputs: count, ratio, task/);
        return false;
      },
      notify: (message, level) => notices.push({ message, level }),
    };
    await commandByName(commands, "helix-run").handler("number-input-ui -- Check numeric inputs", { mode: "tui", cwd, ui });
    assert.equal(confirmations, 0, "0x10 must be refused before attended confirmation");
    assert.equal(notices.at(-1).message.includes("workflow-input-invalid:count"), true);

    mode = "json";
    await commandByName(commands, "helix-run").handler("number-input-ui -- Check numeric inputs", { mode: "tui", cwd, ui });
    assert.equal(confirmations, 1, "valid JSON decimal/exponent forms must bind and reach confirmation");
    assert.equal(existsSync(join(stateRoot, "runs")), false);
  } finally {
    if (previous === undefined) delete process.env.HELIX_STATE_DIR;
    else process.env.HELIX_STATE_DIR = previous;
    rmSync(stateRoot, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("helix-settings is a keyboard-native checkbox list with attended persistence", async () => {
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
