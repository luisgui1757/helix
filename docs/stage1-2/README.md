# Stage 1+2 — safety posture + verification core

The first Helix **code** slice after M0a: the Phase-1 safety substrate and the Phase-2
verification/planning basics, built on **source-verified Pi 0.80.3 APIs**. Everything here
is the smallest complete, tested substrate — not the full systems (no orchestration,
Fusion dispatch, multi-team debate, remote-pi, web-access, statusbar, or live-shell).

## What shipped

| Item | Surface | Where | Proof |
| --- | --- | --- | --- |
| **yolo-fence** | Pi extension (`tool_call` + `user_bash`) | `extensions/helix-fence.ts`, `extensions/lib/fence-rules.mjs` | `tests/fence-rules.test.mjs` (5), `tests/fence-extension.test.mjs` (10), loads in real Pi. See [`yolo-fence.md`](./yolo-fence.md). |
| **Worktree manager** | shell | `tools/worktree/helix-worktree.sh` | `tools/worktree/selftest.sh` (9) |
| **Objective-gate loop** | shell | `tools/loop/objective-gate-loop.sh` | `tools/loop/selftest.sh` (8) |
| **`\answer` resolver** | Pi extension (`registerTool` + `ctx.ui.select`) | `extensions/helix-answer.ts`, `extensions/lib/answer-core.mjs` | `tests/answer-core.test.mjs` (7) + `tests/answer-extension.test.mjs` (2 fake-Pi registration/execute tests) |
| **PR-gate chain** | shell (one command, no `/` clutter) | `tools/ship/pr-gate.sh` | `--dry-run` smoke; fail-closed |
| **Plan/implement separation** | docs + native `/new` | [`plan-implement-separation.md`](./plan-implement-separation.md) | native primitives (nothing built) |

Run all tests: `npm test` (node unit tests + worktree + loop self-tests).

## How the extensions load

`.pi/settings.json` lists `extensions: ["../extensions/helix-fence.ts",
"../extensions/helix-answer.ts"]` (paths relative to `.pi/`), and `package.json` mirrors
them under `pi.extensions` for the published package. They load once the project is
trusted / `--approve`. `npm run check:resources` enforces both. Extensions are TypeScript
loaded via jiti (no build). The pure logic lives in `.mjs` siblings so it is unit-testable
with zero dependencies.

## Design rules honored

- **Security first, fail-closed.** The fence prompts only in a real terminal
  (`ctx.mode === "tui"`) and blocks in every other mode (`rpc`/`json`/`print`) — note
  `ctx.hasUI` is **true in RPC** (docs/rpc.md:1068), so gating on the terminal, not
  `hasUI`, is what actually fails closed. The gate loop stops on a missing gate; the
  PR-gate fails closed.
- **Objective gate is primary.** LLM/model review is advisory; the checkable gate decides.
- **Minimal `/` surface.** `\answer` is a model-callable tool (not in `/`); the fence is a
  hook; the worktree/loop/ship tools are shell commands. No new slash commands.
- **No paid model calls** were made building or testing this. The extensions' interactive
  paths are proven via deterministic fakes. Current Pi 0.80.3 headless RPC command
  inventory does not prove `helix-ui` package-skill visibility; see
  [`../resources/README.md`](../resources/README.md).

## Honest limits

- The fence denylist is a regex speed bump, not containment — see [`yolo-fence.md`](./yolo-fence.md).
- The gate loop's "fix" step runs a caller-provided command; it is not an autonomous
  code-fixer. The review step is advisory only.
- The PR-gate is a checklist runner, not an unbypassable push interceptor (deferred by
  scope).
