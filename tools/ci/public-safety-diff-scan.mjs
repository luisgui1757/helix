#!/usr/bin/env node
// Public-safety scan for PR diffs and PR bodies.
//
// This is the shared signature set used by CI and tools/ship/pr-gate.sh. It
// reports only code + line number so a failing scan does not print the matched
// secret, session URL, private path, or provenance trailer.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PROVENANCE_RE = new RegExp(
  "Co-Authored-By:\\s|Claude-Session:\\s|" + "Generated " + "with",
  "i",
);

export const PUBLIC_SAFETY_PATTERNS = Object.freeze([
  { code: "provider-key", re: /sk-[a-z0-9-]{20,}|ghp_[a-z0-9]{20,}|gho_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}/i },
  { code: "auth-token", re: /"(access_token|refresh_token)"\s*:\s*"/i },
  { code: "session-url", re: /https:\/\/claude\.ai\/(code|share)\/|\/session\/[a-z0-9]{8,}/i },
  { code: "provenance", re: PROVENANCE_RE },
  { code: "home-path", re: /(?:\/Users\/[a-z][a-z0-9_-]*\/|\/home\/[a-z][a-z0-9_-]*\/|[A-Z]:\\+Users\\+[a-z][a-z0-9_-]*\\+)/i },
]);

export function scanText(text) {
  const hits = [];
  const lines = String(text ?? "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    for (const pattern of PUBLIC_SAFETY_PATTERNS) {
      if (pattern.re.test(lines[i])) hits.push({ code: pattern.code, line: i + 1 });
    }
  }
  return hits;
}

export function scanDiffText(text) {
  const hits = [];
  const lines = String(text ?? "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith("-") && !line.startsWith("---")) continue;
    for (const pattern of PUBLIC_SAFETY_PATTERNS) {
      if (pattern.re.test(line)) hits.push({ code: pattern.code, line: i + 1 });
    }
  }
  return hits;
}

function git(args) {
  const res = spawnSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) return null;
  return res.stdout ?? "";
}

function diffForBase(base) {
  if (!base) return git(["diff", "HEAD"]) ?? "";
  const baseExists = git(["rev-parse", "--verify", "--quiet", base]);
  if (baseExists === null) return git(["diff", "HEAD"]) ?? "";
  const mergeBase = git(["merge-base", base, "HEAD"])?.trim();
  return mergeBase ? (git(["diff", `${mergeBase}..HEAD`]) ?? "") : (git(["diff", "HEAD"]) ?? "");
}

function parseArgs(argv) {
  const options = { base: "origin/main", file: null, stdin: false, mode: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base") options.base = argv[++i];
    else if (arg === "--file") options.file = argv[++i];
    else if (arg === "--stdin") options.stdin = true;
    else if (arg === "--mode") options.mode = argv[++i];
    else if (arg === "-h" || arg === "--help") {
      console.log("usage: node tools/ci/public-safety-diff-scan.mjs --mode diff|text [--base REF] [--file PATH|--stdin]");
      process.exit(0);
    } else {
      throw new Error(`unknown arg: ${arg}`);
    }
  }
  if (options.mode !== "diff" && options.mode !== "text") {
    throw new Error("--mode must be either 'diff' or 'text'");
  }
  return options;
}

function readInput(options) {
  if (options.stdin) return readFileSync(0, "utf8");
  if (options.file) return readFileSync(options.file, "utf8");
  return diffForBase(options.base);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const input = readInput(options);
    const hits = options.mode === "text" ? scanText(input) : scanDiffText(input);
    if (hits.length === 0) {
      console.log("public-safety-diff-scan: PASS");
      process.exit(0);
    }
    for (const hit of hits) console.error(`public-safety-diff-scan: LEAK[${hit.code}] line=${hit.line}`);
    process.exit(1);
  } catch (error) {
    console.error(`public-safety-diff-scan: ${error.message}`);
    process.exit(2);
  }
}
