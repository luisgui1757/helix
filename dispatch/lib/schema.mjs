// Prime dispatch — minimal runtime structural validator (zero dependencies).
//
// WHY THIS EXISTS INSTEAD OF LITERAL TypeBox
// ------------------------------------------
// The Stage 3A spec (docs/architecture/fusion-dispatch-research.md) mandates a
// *runtime* validator (TypeScript types alone are insufficient because
// provider/model output arrives at runtime) and names TypeBox as the Pi-native
// mechanism. But this package is dependency-free by invariant:
// tools/check-prime-resources.mjs fails the build if package.json declares ANY
// runtime dependency, and the bare `typebox` specifier resolves only inside Pi's
// runtime (it is MODULE_NOT_FOUND under `node --test`). So the tested policy core
// cannot import TypeBox. See docs/stage3/dispatch-policy-core.md for the full
// reconciliation recorded against the spec.
//
// The schema descriptors below are authored in the SAME JSON-Schema shape that
// `Type.Object(...)` / `Type.Union(...)` emit, so they are drop-in portable to
// real TypeBox the moment the dispatcher is wired into a Pi extension (where
// `typebox` is available). This module is the zero-dependency runtime validator
// that enforces those descriptors under `node --test` and fails closed.
//
// Supported JSON-Schema keywords (exactly the subset the envelope/config need):
//   type: object|array|string|integer|number|boolean|null
//   object: properties, required, additionalProperties
//   array:  items, minItems
//   string: enum, const, minLength, pattern
//   number/integer: enum, const, minimum, maximum (integers must be JS-safe)
//   composite: anyOf (used for nullable and string|number unions)

/** Error raised by assertValid — carries the structured error list for logging. */
export class SchemaError extends Error {
  /** @param {string} label @param {Array<{path:string,message:string}>} errors */
  constructor(label, errors) {
    super(`${label}: ${errors.length} validation error(s): ${errors.map((e) => `${e.path} ${e.message}`).join("; ")}`);
    this.name = "SchemaError";
    this.errors = errors;
  }
}

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return Number.isSafeInteger(value) ? "integer" : "unsafe integer";
  return typeof value; // number|string|boolean|object|undefined|function
}

function matchesType(schemaType, value) {
  switch (schemaType) {
    case "null": return value === null;
    case "boolean": return typeof value === "boolean";
    case "integer": return Number.isSafeInteger(value);
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "string": return typeof value === "string";
    case "array": return Array.isArray(value);
    case "object": return value !== null && typeof value === "object" && !Array.isArray(value);
    default: return false;
  }
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Collect validation errors for `value` against `schema` at `path`.
 * @param {object} schema
 * @param {unknown} value
 * @param {string} path
 * @param {Array<{path:string,message:string}>} errors
 */
function collect(schema, value, path, errors) {
  if (Array.isArray(schema.anyOf)) {
    const anyValid = schema.anyOf.some((sub) => collectInto(sub, value, path).length === 0);
    if (!anyValid) errors.push({ path, message: `did not match any of ${schema.anyOf.length} variants` });
    return;
  }

  if (hasOwn(schema, "const")) {
    if (value !== schema.const) errors.push({ path, message: `must equal ${JSON.stringify(schema.const)}` });
    return;
  }

  if (schema.type && !matchesType(schema.type, value)) {
    errors.push({ path, message: `expected ${schema.type}, got ${typeOf(value)}` });
    return; // no point checking sub-constraints on a type mismatch
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push({ path, message: `must be one of ${JSON.stringify(schema.enum)}` });
    return;
  }

  switch (schema.type) {
    case "string":
      if (typeof schema.minLength === "number" && value.length < schema.minLength) {
        errors.push({ path, message: `must be at least ${schema.minLength} char(s)` });
      }
      if (schema.pattern !== undefined) {
        // JSON Schema / TypeBox emit `pattern` as a STRING; a RegExp is accepted
        // as an internal convenience. A string pattern must be enforced too —
        // silently ignoring it is a fail-open.
        const re = schema.pattern instanceof RegExp ? schema.pattern : new RegExp(schema.pattern);
        if (!re.test(value)) errors.push({ path, message: `must match ${re}` });
      }
      break;
    case "integer":
    case "number":
      if (typeof schema.minimum === "number" && value < schema.minimum) {
        errors.push({ path, message: `must be >= ${schema.minimum}` });
      }
      if (typeof schema.maximum === "number" && value > schema.maximum) {
        errors.push({ path, message: `must be <= ${schema.maximum}` });
      }
      break;
    case "array":
      if (typeof schema.minItems === "number" && value.length < schema.minItems) {
        errors.push({ path, message: `must have at least ${schema.minItems} item(s)` });
      }
      if (schema.items) {
        value.forEach((el, i) => collect(schema.items, el, `${path}[${i}]`, errors));
      }
      break;
    case "object": {
      const props = schema.properties ?? {};
      const required = schema.required ?? [];
      for (const key of required) {
        if (!hasOwn(value, key)) errors.push({ path: `${path}.${key}`, message: "is required" });
      }
      for (const key of Object.keys(props)) {
        if (hasOwn(value, key)) collect(props[key], value[key], `${path}.${key}`, errors);
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!hasOwn(props, key)) errors.push({ path: `${path}.${key}`, message: "is not an allowed property" });
        }
      }
      break;
    }
    default:
      break;
  }
}

function collectInto(schema, value, path) {
  const errors = [];
  collect(schema, value, path, errors);
  return errors;
}

/**
 * Validate `value` against `schema`.
 * @param {object} schema
 * @param {unknown} value
 * @param {string} [path]
 * @returns {{ valid: boolean, errors: Array<{path:string,message:string}> }}
 */
export function validate(schema, value, path = "$") {
  const errors = collectInto(schema, value, path);
  return { valid: errors.length === 0, errors };
}

/** @param {object} schema @param {unknown} value */
export function isValid(schema, value) {
  return collectInto(schema, value, "$").length === 0;
}

/**
 * Fail-closed assertion: throws SchemaError when `value` does not conform.
 * @param {object} schema
 * @param {unknown} value
 * @param {string} label
 * @returns {unknown} the validated value (for chaining)
 */
export function assertValid(schema, value, label = "value") {
  const errors = collectInto(schema, value, "$");
  if (errors.length > 0) throw new SchemaError(label, errors);
  return value;
}
