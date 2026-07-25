import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildOptions,
  formatOption,
  optionFromLabel,
  resolveAnswer,
} from "../extensions/lib/answer-core.mjs";

const input = {
  question: "Which container runtime?",
  recommendation: { label: "Docker", reason: "ubiquitous + CI-friendly" },
  alternatives: [
    { label: "Podman", reason: "daemonless/rootless" },
    { label: "Apple Containers", reason: "native on macOS" },
  ],
};

test("buildOptions puts the recommendation first and ranks alternatives", () => {
  const opts = buildOptions(input);
  assert.equal(opts.length, 3);
  assert.equal(opts[0].label, "Docker");
  assert.equal(opts[0].isRecommended, true);
  assert.equal(opts[0].rank, 1);
  assert.equal(opts[1].label, "Podman");
  assert.equal(opts[1].rank, 2);
  assert.equal(opts[2].isRecommended, false);
});

test("buildOptions skips malformed alternatives and requires a recommendation", () => {
  const opts = buildOptions({ recommendation: { label: "A" }, alternatives: [{ nope: 1 }, { label: "B" }] });
  assert.deepEqual(opts.map((o) => o.label), ["A", "B"]);
  assert.throws(() => buildOptions({ alternatives: [] }), /recommendation/);
});

test("formatOption + optionFromLabel round-trip", () => {
  const opts = buildOptions(input);
  const label = formatOption(opts[1]);
  assert.match(label, /^2\. Podman — daemonless\/rootless$/);
  assert.equal(optionFromLabel(opts, label).label, "Podman");
  assert.equal(optionFromLabel(opts, "not a real label"), null);
});

test("resolveAnswer fails closed when non-interactive", async () => {
  const opts = buildOptions(input);
  const r = await resolveAnswer(opts, { interactive: false });
  assert.equal(r.status, "unavailable");
  assert.equal(r.chosen, null);
  assert.equal(r.interactive, false);
});

test("resolveAnswer returns the user's interactive pick", async () => {
  const opts = buildOptions(input);
  const select = async (labels) => labels[1]; // pick the second row (Podman)
  const r = await resolveAnswer(opts, { interactive: true, select });
  assert.equal(r.status, "answered");
  assert.equal(r.chosen.label, "Podman");
  assert.equal(r.interactive, true);
});

test("resolveAnswer remains unresolved on cancel", async () => {
  const opts = buildOptions(input);
  const select = async () => null; // user cancelled
  const r = await resolveAnswer(opts, { interactive: true, select });
  assert.equal(r.status, "cancelled");
  assert.equal(r.chosen, null);
});

test("resolveAnswer accepts one explicit bounded custom answer", async () => {
  const opts = buildOptions(input);
  const r = await resolveAnswer(opts, {
    interactive: true,
    allowCustom: true,
    select: async (labels) => labels.at(-1),
    input: async () => "  Lima  ",
  });
  assert.equal(r.status, "answered");
  assert.equal(r.custom, "Lima");
  assert.equal(r.chosen, null);
});

test("resolveAnswer rejects invalid selections and empty custom answers", async () => {
  const opts = buildOptions(input);
  assert.equal((await resolveAnswer(opts, {
    interactive: true,
    select: async () => "fabricated",
  })).status, "invalid-selection");
  assert.equal((await resolveAnswer(opts, {
    interactive: true,
    allowCustom: true,
    select: async (labels) => labels.at(-1),
    input: async () => " ",
  })).status, "cancelled");
});
