// Helix dispatch — canonical grammars for persisted public structural fields.
//
// Character allowlists alone are insufficient: URI and absolute-path strings
// can be composed entirely from otherwise-valid model/code characters. These
// helpers apply both a narrow grammar and locator-shape refusal.

const TOKEN_CHARS = "[A-Za-z0-9._:@+~-]";
const CODE_CHARS = "[A-Za-z0-9._:/-]";
const NOT_LOCATOR_PREFIX = "(?![A-Za-z][A-Za-z0-9+.-]*:/)(?!(?:[A-Za-z0-9-]+\\.)+[A-Za-z]{2,}(?::\\d+)?(?:/|$))";

export const PUBLIC_CODE_PATTERN = new RegExp(`^[A-Za-z0-9]${CODE_CHARS}*$`);
export const MODEL_ID_PATTERN = new RegExp(`^${NOT_LOCATOR_PREFIX}[A-Za-z0-9]${TOKEN_CHARS}*(?:/[A-Za-z0-9]${TOKEN_CHARS}*)*$`);
export const EXECUTOR_REF_PATTERN = new RegExp(`^${NOT_LOCATOR_PREFIX}[A-Za-z0-9]${TOKEN_CHARS}*(?:/[A-Za-z0-9]${TOKEN_CHARS}*)*$`);

const LOCAL_REF_PATTERN = /^local-ref:[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const REDACTED_ID_PATTERN = /^redacted-id:[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const SHA256_PATTERN = /^(?:sha256:)?[0-9a-f]{64}$/;

export const REF_PATTERN = /^(?:sha256:[0-9a-f]{64}|local-ref:[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*|redacted-id:[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*|[0-9a-f]{64})$/;

export const INPUT_REF_VALUE_PATTERNS = Object.freeze({
  sha256: SHA256_PATTERN,
  "local-ref": LOCAL_REF_PATTERN,
  "redacted-id": REDACTED_ID_PATTERN,
});

/** URI, network-location, drive-path, root-path, or traversal-shaped token. */
export function hasLocatorShape(value) {
  if (typeof value !== "string") return true;
  return value.startsWith("/")
    || value.startsWith("\\")
    || /^[A-Za-z]:[\\/]/.test(value)
    || /^[A-Za-z][A-Za-z0-9+.-]*:\/{1,2}/.test(value)
    || /^(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?::\d+)?(?:\/|$)/.test(value)
    || value.includes("\\")
    || value.includes("//")
    || value.split("/").some((segment) => segment === "." || segment === "..");
}

export function isPublicCode(value) {
  return typeof value === "string" && PUBLIC_CODE_PATTERN.test(value) && !hasLocatorShape(value);
}

export function isModelId(value) {
  return typeof value === "string" && MODEL_ID_PATTERN.test(value) && !hasLocatorShape(value);
}

export function isExecutorRef(value) {
  return typeof value === "string" && EXECUTOR_REF_PATTERN.test(value) && !hasLocatorShape(value);
}

export function isPublicRef(value) {
  return typeof value === "string" && REF_PATTERN.test(value);
}
