// First-run onboarding state is user-local and intentionally independent of
// session history: finishing or dismissing the tour once applies to every Pi
// session, while "Later" writes nothing and offers the tour at the next cold
// startup.

import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeTextAtomic } from "../../dispatch/lib/persistence.mjs";

export const ONBOARDING_STATE_FILE = "onboarding.json";
export const ONBOARDING_STATUSES = Object.freeze(["completed", "dismissed"]);

export const ONBOARDING_PAGES = Object.freeze([
  Object.freeze({
    title: "Connect providers in Pi",
    body: Object.freeze([
      "Before using Helix, configure or sync the providers you want in Pi.",
      "Helix uses Pi's already available models. It does not log in, choose, or configure providers for you.",
    ]),
  }),
  Object.freeze({
    title: "Choose Helix behavior",
    body: Object.freeze([
      "Helix starts with its features enabled, so configuration is optional.",
      "Run /helix-settings to review loops, context handoffs, worktrees, research, and visual cues.",
    ]),
  }),
  Object.freeze({
    title: "Assemble a cast",
    body: Object.freeze([
      "Run /helix-profiles to create a named cast, then /helix-setup to assign Pi's available models to stages.",
      "You can keep the packaged defaults until you need a custom cast.",
    ]),
  }),
  Object.freeze({
    title: "Run and inspect",
    body: Object.freeze([
      "Use /helix-run to preflight a workflow. Inspect progress with /helix-runs and /helix-run-watch.",
      "Open /helix-help for the full command map. Rerun this tour any time with /helix-onboarding.",
    ]),
  }),
]);

function validState(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const keys = Object.keys(parsed).sort();
  return keys.length === 2
    && keys[0] === "schema_version"
    && keys[1] === "status"
    && parsed.schema_version === 1
    && ONBOARDING_STATUSES.includes(parsed.status);
}

export function loadOnboardingState(root) {
  const path = join(root, ONBOARDING_STATE_FILE);
  if (!existsSync(path)) return { ok: true, status: "unseen" };
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return { ok: false, code: "helix-onboarding-state-unreadable" };
    }
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!validState(parsed)) return { ok: false, code: "helix-onboarding-state-invalid" };
    return { ok: true, status: parsed.status };
  } catch {
    return { ok: false, code: "helix-onboarding-state-unreadable" };
  }
}

export function saveOnboardingState(root, status) {
  if (!ONBOARDING_STATUSES.includes(status)) {
    return { ok: false, code: "helix-onboarding-status-invalid" };
  }
  try {
    writeTextAtomic(
      root,
      ONBOARDING_STATE_FILE,
      `${JSON.stringify({ schema_version: 1, status }, null, 2)}\n`,
    );
    return { ok: true, status };
  } catch {
    return { ok: false, code: "helix-onboarding-state-write-failed" };
  }
}
