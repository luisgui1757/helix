// The only supported import seam for @earendil-works/pi-coding-agent.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PI_VERSION_RANGE = Object.freeze({ min: [0, 80, 7], maxExclusive: [0, 81, 0] });

function parse(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(version));
  return match ? match.slice(1).map(Number) : null;
}

function compare(left, right) {
  for (let i = 0; i < 3; i += 1) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}

export function isSupportedPiVersion(version) {
  const parsed = parse(version);
  return parsed != null && compare(parsed, PI_VERSION_RANGE.min) >= 0 && compare(parsed, PI_VERSION_RANGE.maxExclusive) < 0;
}

async function installedVersion() {
  try {
    const entry = import.meta.resolve("@earendil-works/pi-coding-agent");
    let current = dirname(fileURLToPath(entry));
    for (let i = 0; i < 6; i += 1) {
      try {
        const pkg = JSON.parse(readFileSync(join(current, "package.json"), "utf8"));
        if (pkg.name === "@earendil-works/pi-coding-agent") return pkg.version;
      } catch { /* continue toward package root */ }
      current = dirname(current);
    }
  } catch { /* stable failure below */ }
  return null;
}

export async function loadPiSdk({ importer = () => import("@earendil-works/pi-coding-agent"), version = null } = {}) {
  const resolvedVersion = version ?? await installedVersion();
  if (!isSupportedPiVersion(resolvedVersion)) throw new Error("pi-version-unsupported");
  let sdk;
  try { sdk = await importer(); } catch { throw new Error("pi-runtime-load-failed"); }
  const required = ["createAgentSession", "DefaultResourceLoader", "SessionManager", "getAgentDir"];
  if (!sdk || required.some((key) => typeof sdk[key] === "undefined")) throw new Error("pi-runtime-contract-invalid");
  return { sdk, version: resolvedVersion };
}
