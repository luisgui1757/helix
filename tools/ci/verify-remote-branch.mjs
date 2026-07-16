#!/usr/bin/env node

import { spawnSync } from "node:child_process";

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const repo = arg("--repo");
const branch = arg("--branch");
const sha = arg("--sha");
const wait = process.argv.includes("--wait");
if (![repo, branch, sha].every(Boolean) || !/^[0-9a-f]{40}$/.test(sha)) {
  console.error("usage: verify-remote-branch.mjs --repo OWNER/REPO --branch NAME --sha SHA [--wait]");
  process.exit(2);
}

function gh(args) {
  const result = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(String(result.stderr).trim().split("\n").at(-1) || "gh-failed");
  return result.stdout;
}

const deadline = Date.now() + 20 * 60 * 1000;
while (true) {
  const runs = JSON.parse(gh([
    "run", "list", "--repo", repo, "--branch", branch, "--commit", sha,
    "--json", "databaseId,name,headSha,status,conclusion,url", "--limit", "100",
  ]));
  const exact = runs.filter((run) => run.headSha === sha);
  const ci = exact.filter((run) => run.name === "CI");
  if (ci.length > 0 && ci.every((run) => run.status === "completed")) {
    const bad = ci.filter((run) => run.conclusion !== "success");
    console.log(JSON.stringify({ ok: bad.length === 0, sha, runs: ci }, null, 2));
    process.exit(bad.length === 0 ? 0 : 1);
  }
  if (!wait) {
    console.log(JSON.stringify({ ok: false, code: ci.length ? "remote-checks-pending" : "remote-checks-missing", sha, runs: ci }, null, 2));
    process.exit(1);
  }
  if (Date.now() >= deadline) throw new Error("remote-checks-timeout");
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}
