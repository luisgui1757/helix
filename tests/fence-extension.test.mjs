import { test } from "node:test";
import assert from "node:assert/strict";
import helixFence from "../extensions/helix-fence.ts";

// Minimal fake ExtensionAPI + ctx to drive the real handlers deterministically
// (no model call, no TUI). Mirrors the Pi 0.80.3 shapes we verified.
//
// IMPORTANT: the fence fails closed on ctx.mode, NOT ctx.hasUI — hasUI is TRUE in
// RPC mode (docs/extensions.md:914, docs/rpc.md:1068), so only "tui" may prompt.
function loadFence() {
  const handlers = {};
  helixFence({ on: (event, handler) => { handlers[event] = handler; } });
  return handlers;
}

function ctx({ mode = "json", select, confirm } = {}) {
  return {
    mode,
    // hasUI mirrors Pi: true in tui AND rpc. The fence must NOT rely on this.
    hasUI: mode === "tui" || mode === "rpc",
    ui: {
      select: async () => (typeof select === "function" ? select() : select),
      confirm: async () => (typeof confirm === "function" ? confirm() : confirm),
      notify: () => {},
    },
  };
}

const NON_TTY = ["rpc", "json", "print"];

test("fence fails closed for a destructive bash tool call in EVERY non-tui mode", async () => {
  const h = loadFence();
  for (const mode of NON_TTY) {
    const verdict = await h.tool_call({ toolName: "bash", input: { command: "rm -rf /tmp/x" } }, ctx({ mode }));
    assert.equal(verdict?.block, true, `expected block in mode=${mode}`);
    assert.match(verdict.reason, /fail-closed/);
  }
});

test("fence fails closed in RPC mode even though hasUI is true (regression)", async () => {
  const h = loadFence();
  const c = ctx({ mode: "rpc" });
  assert.equal(c.hasUI, true, "sanity: rpc has hasUI true");
  for (const command of ["rm -rf /tmp/x", "sudo rm /etc/hosts", "git push --force origin main"]) {
    const verdict = await h.tool_call({ toolName: "bash", input: { command } }, c);
    assert.equal(verdict?.block, true, `rpc must block: ${command}`);
  }
});

test("fence allows a safe bash tool call (non-tui)", async () => {
  const h = loadFence();
  const verdict = await h.tool_call({ toolName: "bash", input: { command: "ls -la" } }, ctx({ mode: "json" }));
  assert.equal(verdict, undefined);
});

test("fence blocks writes to a protected path in non-tui modes (incl. rpc)", async () => {
  const h = loadFence();
  for (const mode of NON_TTY) {
    const verdict = await h.tool_call({ toolName: "write", input: { path: "app/.env" } }, ctx({ mode }));
    assert.equal(verdict?.block, true, `expected block in mode=${mode}`);
  }
});

test("fence allows writes to a normal path", async () => {
  const h = loadFence();
  const verdict = await h.tool_call({ toolName: "edit", input: { path: "src/index.ts" } }, ctx({ mode: "json" }));
  assert.equal(verdict, undefined);
});

test("fence honours a TTY confirm: allow", async () => {
  const h = loadFence();
  const verdict = await h.tool_call(
    { toolName: "bash", input: { command: "git push --force origin main" } },
    ctx({ mode: "tui", select: "Yes, allow once" }),
  );
  assert.equal(verdict, undefined);
});

test("fence honours a TTY confirm: deny", async () => {
  const h = loadFence();
  const verdict = await h.tool_call(
    { toolName: "bash", input: { command: "git push --force origin main" } },
    ctx({ mode: "tui", select: "No, block it" }),
  );
  assert.equal(verdict?.block, true);
});

test("fence refuses a risky user_bash command in EVERY non-tui mode (incl. rpc)", async () => {
  const h = loadFence();
  for (const mode of NON_TTY) {
    const out = await h.user_bash({ command: "sudo rm /etc/hosts" }, ctx({ mode }));
    assert.equal(out?.result?.exitCode, 1, `expected refuse in mode=${mode}`);
    assert.equal(out?.result?.cancelled, true);
  }
});

test("fence honours a TTY confirm for user_bash: allow / deny", async () => {
  const h = loadFence();
  const allowed = await h.user_bash({ command: "sudo reboot" }, ctx({ mode: "tui", confirm: true }));
  assert.equal(allowed, undefined);
  const denied = await h.user_bash({ command: "sudo reboot" }, ctx({ mode: "tui", confirm: false }));
  assert.equal(denied?.result?.cancelled, true);
});

test("fence lets a safe user_bash command through", async () => {
  const h = loadFence();
  const out = await h.user_bash({ command: "git status" }, ctx({ mode: "json" }));
  assert.equal(out, undefined);
});
