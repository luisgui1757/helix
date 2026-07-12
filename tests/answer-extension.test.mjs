import { test } from "node:test";
import assert from "node:assert/strict";
import helixAnswer from "../extensions/helix-answer.ts";

function loadAnswerTool() {
  const tools = [];
  helixAnswer({
    registerTool(tool) {
      tools.push(tool);
    },
  });
  assert.equal(tools.length, 1);
  return tools[0];
}

test("helix-answer registers the model-callable answer tool", () => {
  const tool = loadAnswerTool();
  assert.equal(tool.name, "answer");
  assert.equal(tool.label, "Answer");
  assert.equal(typeof tool.execute, "function");
  assert.deepEqual(tool.parameters.required, ["question", "recommendation"]);
});

test("helix-answer non-interactive execute returns the deterministic recommendation", async () => {
  const tool = loadAnswerTool();
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
  assert.equal(result.content[0].text, "Chosen: Docker (non-interactive: auto-selected the recommendation)");
  assert.equal(result.details.question, "Which container runtime?");
  assert.equal(result.details.chosen, "Docker");
  assert.equal(result.details.recommended, true);
  assert.equal(result.details.interactive, false);
  assert.deepEqual(result.details.options, [
    "1. Docker (recommended) — ubiquitous + CI-friendly",
    "2. Podman — daemonless/rootless",
    "3. Apple Containers — native on macOS",
  ]);
});
