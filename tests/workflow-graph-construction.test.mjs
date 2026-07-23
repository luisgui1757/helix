import test from "node:test";
import assert from "node:assert/strict";

import {
  agent,
  composeFragments,
  conditional,
  evaluatorOptimizerLoop,
  fanOutReduce,
  fragment,
  gate,
  map,
  objectiveGate,
  sequence,
  terminal,
  workflow,
} from "../dispatch/workflow/builder.mjs";
import { stableWorkflowStringify, WORKFLOW_LIMITS } from "../dispatch/workflow/schema.mjs";

const objective = { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 };
const reviewer = (stageId) => agent({ role: "reviewer", stage_id: stageId, output_schema: "verdict-v1", mutation: "read-only", timeout_ms: 1_000 });

function terminalFragment() {
  return fragment({
    entry: "objective",
    nodes: {
      objective: objectiveGate("success", "failed"),
      success: terminal("succeeded"),
      failed: terminal("failed", "objective-failed"),
    },
  }).fragment;
}

test("sequence is deterministic and covers empty, singleton, and node-count boundaries", () => {
  assert.equal(sequence([]).code, "workflow-fragment-sequence-invalid");
  const singleton = sequence([{ id: "review", node: reviewer("review") }]);
  assert.equal(singleton.ok, true);
  assert.equal(singleton.fragment.entry, "review");
  assert.deepEqual(singleton.fragment.exits, { next: [{ node: "review", field: "next" }] });
  assert.equal(singleton.fragment.nodes.review.next, null);
  assert.deepEqual(sequence([{ id: "review", node: reviewer("review") }]), singleton);

  const exact = sequence(Array.from({ length: WORKFLOW_LIMITS.max_nodes }, (_, index) => ({
    id: `node-${index}`,
    node: reviewer(`stage-${index}`),
  })));
  assert.equal(exact.ok, true);
  assert.equal(Object.keys(exact.fragment.nodes).length, WORKFLOW_LIMITS.max_nodes);
  assert.equal(sequence(Array.from({ length: WORKFLOW_LIMITS.max_nodes + 1 }, (_, index) => ({
    id: `node-${index}`, node: reviewer(`stage-${index}`),
  }))).code, "workflow-fragment-sequence-invalid");
});

test("conditional exposes distinct typed target ports without inventing targets", () => {
  const built = conditional({
    id: "route",
    branches: [
      { port: "approved", when: { op: "eq", path: "/outputs/review/recommendation", value: "approve" } },
      { port: "retry", when: { op: "eq", path: "/outputs/review/recommendation", value: "revise" }, loop: true },
    ],
    fallback: "failed",
    loops_off: "disabled",
  });
  assert.equal(built.ok, false, "standalone conditional correctly refuses its dangling output pointer");

  const selfContained = conditional({
    id: "route",
    branches: [{ port: "approved", when: { op: "eq", path: "/inputs/approved", value: true } }],
    fallback: "failed",
    loops_off: "disabled",
  });
  assert.equal(selfContained.ok, true);
  assert.deepEqual(Object.keys(selfContained.fragment.exits), ["approved", "disabled", "failed"]);
  assert.equal(selfContained.fragment.nodes.route.transitions[0].target, null);
  assert.equal(conditional({
    id: "route", branches: [{ port: "same", when: { op: "always" } }], fallback: "same",
  }).code, "workflow-fragment-port-collision");
});

test("composition rewrites every control target and supported output pointer hygienically", () => {
  const source = fragment({
    entry: "start",
    nodes: {
      start: { kind: "checkpoint", reason: "start", next: "route" },
      route: {
        kind: "decision",
        transitions: [{ when: { op: "eq", path: "/outputs/start/result", value: "pass" }, target: "check" }],
        default: { target: "check" },
        loops_off: "check",
      },
      check: gate(objective, "fanout", "fanout", { loops_off: "fanout" }),
      fanout: map("/outputs/start/items", reviewer("fanout"), "collect", { max_items: 4 }),
      collect: { kind: "reduce", items_path: "/outputs/fanout", strategy: "collect", next: "end" },
      end: terminal("failed", "end"),
    },
  });
  assert.equal(source.ok, true, JSON.stringify(source));
  const composed = composeFragments({ fragments: [{ namespace: "unit", fragment: source.fragment }], entry: "unit" });
  assert.equal(composed.ok, true, JSON.stringify(composed));
  const nodes = composed.fragment.nodes;
  assert.equal(nodes["unit-start"].next, "unit-route");
  assert.equal(nodes["unit-route"].transitions[0].target, "unit-check");
  assert.equal(nodes["unit-route"].default.target, "unit-check");
  assert.equal(nodes["unit-route"].loops_off, "unit-check");
  assert.equal(nodes["unit-check"].on_pass, "unit-fanout");
  assert.equal(nodes["unit-check"].on_fail, "unit-fanout");
  assert.equal(nodes["unit-check"].loops_off, "unit-fanout");
  assert.equal(nodes["unit-route"].transitions[0].when.path, "/outputs/unit-start/result");
  assert.equal(nodes["unit-fanout"].items_path, "/outputs/unit-start/items");
  assert.equal(nodes["unit-collect"].items_path, "/outputs/unit-fanout");
});

test("fragment construction rejects dangling output pointers and executable values", () => {
  const dangling = fragment({
    entry: "route",
    nodes: {
      route: {
        kind: "decision",
        transitions: [{ when: { op: "eq", path: "/outputs/missing/value", value: true }, target: "end" }],
        default: { target: "end" },
      },
      end: terminal("failed", "end"),
    },
  });
  assert.equal(dangling.code, "workflow-fragment-output-dangling");
  assert.doesNotThrow(() => fragment({ entry: "end", nodes: { end: { kind: "terminal", status: "failed", code: () => "bad" } } }));
  assert.equal(fragment({ entry: "end", nodes: { end: { kind: "terminal", status: "failed", code: () => "bad" } } }).code, "workflow-fragment-invalid");
  const sparseTransitions = [];
  sparseTransitions.length = 1;
  assert.equal(fragment({
    entry: "route",
    nodes: { route: { kind: "decision", transitions: sparseTransitions, default: { target: "end" } }, end: terminal("failed", "end") },
  }).code, "workflow-fragment-invalid");
});

test("every graph combinator totally refuses accessors, proxies, cycles, and excessive depth", () => {
  const accessorObject = (field) => {
    const value = {};
    Object.defineProperty(value, field, { enumerable: true, get() { throw new Error("getter-executed"); } });
    return value;
  };
  const accessorArray = [];
  Object.defineProperty(accessorArray, "0", { enumerable: true, get() { throw new Error("getter-executed"); } });
  accessorArray.length = 1;
  const cyclicObject = {};
  cyclicObject.self = cyclicObject;
  const cyclicArray = [];
  cyclicArray.push(cyclicArray);
  let deep = {};
  for (let index = 0; index <= WORKFLOW_LIMITS.max_canonical_depth; index += 1) deep = { child: deep };
  const throwingProxy = (array = false) => new Proxy(array ? [] : {}, {
    getPrototypeOf() { throw new Error("proxy-executed"); },
  });
  const cases = [
    ["fragment", fragment, accessorObject("entry"), cyclicObject, throwingProxy(), deep],
    ["sequence", sequence, accessorArray, cyclicArray, throwingProxy(true), [deep]],
    ["conditional", conditional, accessorObject("id"), cyclicObject, throwingProxy(), deep],
    ["evaluatorOptimizerLoop", evaluatorOptimizerLoop, accessorObject("optimizer"), cyclicObject, throwingProxy(), deep],
    ["fanOutReduce", fanOutReduce, accessorObject("fan_out"), cyclicObject, throwingProxy(), deep],
    ["composeFragments", composeFragments, accessorObject("fragments"), cyclicObject, throwingProxy(), deep],
  ];
  for (const [name, helper, ...values] of cases) {
    for (const value of values) {
      let result;
      assert.doesNotThrow(() => { result = helper(value); }, `${name} must be total`);
      assert.equal(result?.ok, false, name);
    }
  }
  let unsafeSequenceOptions;
  assert.doesNotThrow(() => {
    unsafeSequenceOptions = sequence([{ id: "safe", node: reviewer("safe") }], accessorObject("exit"));
  });
  assert.equal(unsafeSequenceOptions.ok, false);

  let proxyTraps = 0;
  const proxy = new Proxy({}, Object.fromEntries([
    "get", "getPrototypeOf", "getOwnPropertyDescriptor", "has", "ownKeys",
  ].map((trap) => [trap, () => {
    proxyTraps += 1;
    throw new Error(`proxy-${trap}-executed`);
  }])));
  for (const [name, helper] of [
    ["fragment", fragment], ["sequence", sequence], ["conditional", conditional],
    ["evaluatorOptimizerLoop", evaluatorOptimizerLoop], ["fanOutReduce", fanOutReduce],
    ["composeFragments", composeFragments],
  ]) {
    assert.equal(helper(proxy).ok, false, name);
    assert.equal(proxyTraps, 0, `${name} must refuse proxies without reflection`);
  }
});

test("fragment admission accepts the exact canonical byte limit and refuses one byte over", () => {
  const makeDocument = (label) => ({
    schema_version: 1,
    kind: "workflow-fragment",
    entry: "end",
    nodes: { end: { kind: "terminal", status: "failed", label } },
    exits: {},
  });
  const overhead = Buffer.byteLength(stableWorkflowStringify(makeDocument("")), "utf8");
  const exactLabel = "x".repeat(WORKFLOW_LIMITS.max_canonical_bytes - overhead);
  const exact = fragment({ entry: "end", nodes: makeDocument(exactLabel).nodes });
  assert.equal(exact.ok, true);
  assert.equal(Buffer.byteLength(stableWorkflowStringify(exact.fragment), "utf8"), WORKFLOW_LIMITS.max_canonical_bytes);
  assert.equal(fragment({ entry: "end", nodes: makeDocument(`${exactLabel}x`).nodes }).code,
    "workflow-fragment-invalid");

  const originalClone = globalThis.structuredClone;
  let cloneCalls = 0;
  globalThis.structuredClone = (value, options) => {
    cloneCalls += 1;
    return originalClone(value, options);
  };
  try {
    const oversized = fragment({
      entry: "end",
      nodes: { end: { kind: "terminal", status: "failed", label: "x".repeat(WORKFLOW_LIMITS.max_canonical_bytes + 1) } },
    });
    assert.equal(oversized.code, "workflow-fragment-invalid");
    assert.equal(cloneCalls, 0, "over-limit author input must refuse before cloning");
  } finally {
    globalThis.structuredClone = originalClone;
  }
});

test("composition refuses namespace collisions, unknown connections, and unaccounted ports", () => {
  const left = fragment({ entry: "b-c", nodes: { "b-c": terminal("failed", "left") } }).fragment;
  const right = fragment({ entry: "c", nodes: { c: terminal("failed", "right") } }).fragment;
  assert.equal(composeFragments({
    fragments: [{ namespace: "a", fragment: left }, { namespace: "a-b", fragment: right }], entry: "a",
  }).code, "workflow-fragment-node-collision");

  const open = sequence([{ id: "work", node: reviewer("work") }]).fragment;
  assert.equal(composeFragments({ fragments: [{ namespace: "open", fragment: open }], entry: "open" }).code,
    "workflow-fragment-port-dangling");
  assert.equal(composeFragments({
    fragments: [{ namespace: "open", fragment: open }], entry: "open",
    connections: [{ from: "open.missing", to: "open" }], exports: { next: "open.next" },
  }).code, "workflow-fragment-connection-invalid");
});

test("composition output is deterministic across fragment and connection ordering", () => {
  const first = sequence([{ id: "first", node: reviewer("first") }]).fragment;
  const second = sequence([{ id: "second", node: reviewer("second") }]).fragment;
  const tail = terminalFragment();
  const build = (fragments, connections) => composeFragments({ fragments, connections, entry: "a" });
  const ordered = build([
    { namespace: "a", fragment: first }, { namespace: "b", fragment: second }, { namespace: "tail", fragment: tail },
  ], [{ from: "a.next", to: "b" }, { from: "b.next", to: "tail" }]);
  const reversed = build([
    { namespace: "tail", fragment: tail }, { namespace: "b", fragment: second }, { namespace: "a", fragment: first },
  ], [{ from: "b.next", to: "tail" }, { from: "a.next", to: "b" }]);
  assert.equal(ordered.ok, true);
  assert.deepEqual(reversed, ordered);

  const aa = sequence([{ id: "aa", node: reviewer("aa") }]).fragment;
  const b = sequence([{ id: "b", node: reviewer("b") }]).fragment;
  const lexical = composeFragments({
    fragments: [{ namespace: "aa", fragment: aa }, { namespace: "b", fragment: b }, { namespace: "tail", fragment: tail }],
    entry: "aa",
    connections: [{ from: "aa.next", to: "b" }, { from: "b.next", to: "tail" }],
  });
  assert.equal(lexical.ok, true);
  assert.deepEqual(Object.keys(lexical.fragment.nodes), [
    "aa-aa", "b-b", "tail-failed", "tail-objective", "tail-success",
  ]);
});

test("bounded evaluator/optimizer helper composes into a valid ordinary v4 workflow", () => {
  const loop = evaluatorOptimizerLoop({
    optimizer: { id: "optimize", node: agent({ role: "builder", stage_id: "optimize", mutation: "shared-serialized", timeout_ms: 1_000 }) },
    evaluator: { id: "evaluate", node: reviewer("evaluate") },
    approve_when: { op: "eq", path: "/outputs/evaluate/value/recommendation", value: "approve" },
    max_visits: 3,
  });
  assert.equal(loop.ok, true, JSON.stringify(loop));
  assert.equal(loop.fragment.nodes.optimize.max_visits, 3);
  assert.equal(loop.fragment.nodes.route.default.loop, true);
  const composed = composeFragments({
    fragments: [{ namespace: "loop", fragment: loop.fragment }, { namespace: "tail", fragment: terminalFragment() }],
    entry: "loop",
    connections: [{ from: "loop.done", to: "tail" }, { from: "loop.loops-off", to: "tail" }],
  });
  assert.equal(composed.ok, true, JSON.stringify(composed));
  const built = workflow({
    id: "composed-loop", name: "Composed loop", description: "A composed bounded evaluator optimizer loop.",
    start: composed.fragment.entry, nodes: composed.fragment.nodes, objective_gate: objective,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
});

test("bounded fan-out/reduce helper composes into a valid ordinary v4 workflow", () => {
  const fanout = fanOutReduce({
    fan_out: {
      id: "fanout",
      node: map("/inputs/items", reviewer("fanout"), null, { max_items: 4, failure: "abort" }),
    },
    reduce_id: "collect",
    strategy: "collect",
  });
  assert.equal(fanout.ok, true, JSON.stringify(fanout));
  assert.equal(fanout.fragment.nodes.fanout.next, "collect");
  assert.equal(fanout.fragment.nodes.collect.items_path, "/outputs/fanout");
  const composed = composeFragments({
    fragments: [{ namespace: "work", fragment: fanout.fragment }, { namespace: "tail", fragment: terminalFragment() }],
    entry: "work", connections: [{ from: "work.next", to: "tail" }],
  });
  const built = workflow({
    id: "composed-fanout", name: "Composed fanout", description: "A composed bounded fan-out and reduce workflow.",
    inputs: {
      type: "object", additionalProperties: false, required: ["task", "items"],
      properties: {
        task: { type: "string", minLength: 1 },
        items: { type: "array", maxItems: 4, items: { type: "string" } },
      },
    },
    start: composed.fragment.entry, nodes: composed.fragment.nodes, objective_gate: objective,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
});
