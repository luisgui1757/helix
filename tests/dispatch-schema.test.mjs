import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, isValid, assertValid, SchemaError } from "../dispatch/lib/schema.mjs";

const person = {
  type: "object",
  additionalProperties: false,
  required: ["name", "age"],
  properties: {
    name: { type: "string", minLength: 1 },
    age: { type: "integer", minimum: 0 },
    nickname: { anyOf: [{ type: "string" }, { type: "null" }] },
    role: { type: "string", enum: ["admin", "user"] },
  },
};

test("valid object passes", () => {
  assert.equal(isValid(person, { name: "A", age: 3, nickname: null, role: "user" }), true);
});

test("missing required field fails", () => {
  const { valid, errors } = validate(person, { name: "A" });
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.path === "$.age" && /required/.test(e.message)));
});

test("additionalProperties:false rejects unknown keys", () => {
  const { valid, errors } = validate(person, { name: "A", age: 1, extra: 1 });
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.path === "$.extra"));
});

test("required and known properties use own keys, not prototype inheritance", () => {
  const proto = { age: 42, nickname: "proto-nickname" };
  const inheritedAge = Object.create(proto);
  inheritedAge.name = "A";
  const missing = validate(person, inheritedAge);
  assert.equal(missing.valid, false);
  assert.ok(missing.errors.some((e) => e.path === "$.age" && /required/.test(e.message)));

  const protoExtra = { toString: () => "inherited" };
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["toString"],
    properties: { toString: { type: "string" } },
  };
  const inheritedRequired = Object.create(protoExtra);
  const invalid = validate(schema, inheritedRequired);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((e) => e.path === "$.toString" && /required/.test(e.message)));

  const ownRequired = { toString: "own" };
  assert.equal(validate(schema, ownRequired).valid, true);
});

test("enum membership is enforced", () => {
  assert.equal(isValid(person, { name: "A", age: 1, role: "root" }), false);
});

test("integer rejects a float; number would accept it", () => {
  assert.equal(isValid({ type: "integer" }, 1.5), false);
  assert.equal(isValid({ type: "number" }, 1.5), true);
});

test("integer rejects values outside JavaScript's safe integer range", () => {
  assert.equal(isValid({ type: "integer" }, Number.MAX_SAFE_INTEGER), true);
  assert.equal(isValid({ type: "integer" }, Number.MAX_SAFE_INTEGER + 1), false);
  assert.equal(isValid({ type: "integer" }, Number.MIN_SAFE_INTEGER - 1), false);
});

test("anyOf nullable accepts null and the base type, rejects others", () => {
  const s = { anyOf: [{ type: "string" }, { type: "null" }] };
  assert.equal(isValid(s, null), true);
  assert.equal(isValid(s, "x"), true);
  assert.equal(isValid(s, 5), false);
});

test("const is exact-match", () => {
  assert.equal(isValid({ const: 1 }, 1), true);
  assert.equal(isValid({ const: 1 }, 2), false);
});

test("array items + minItems", () => {
  const s = { type: "array", items: { type: "string" }, minItems: 1 };
  assert.equal(isValid(s, ["a"]), true);
  assert.equal(isValid(s, []), false);
  assert.equal(isValid(s, [1]), false);
});

test("a string `pattern` (JSON-Schema/TypeBox shape) is enforced, not ignored", () => {
  const s = { type: "string", pattern: "^[a]+$" };
  assert.equal(isValid(s, "aaa"), true);
  assert.equal(isValid(s, "bbb"), false); // was silently accepted before the fix
});

test("a RegExp `pattern` still works as an internal convenience", () => {
  const s = { type: "string", pattern: /^[a]+$/ };
  assert.equal(isValid(s, "aaa"), true);
  assert.equal(isValid(s, "bbb"), false);
});

test("assertValid throws SchemaError with structured errors", () => {
  assert.throws(
    () => assertValid(person, { name: "" }, "person"),
    (err) => err instanceof SchemaError && Array.isArray(err.errors) && err.errors.length > 0,
  );
});
