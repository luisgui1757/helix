import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const FILE_SEARCH_LIMITS = Object.freeze({
  max_query_length: 512,
  max_results: 200,
  max_files: 10_000,
  max_file_bytes: 2 * 1024 * 1024,
  max_total_bytes: 32 * 1024 * 1024,
  max_preview_length: 500,
});

const DEFAULT_EXCLUDED_DIRECTORIES = new Set([".git", "node_modules"]);

function contained(root, path) {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function safeRelativePath(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 1_024
    && !isAbsolute(value) && !value.includes("\0");
}

function readRegularFile(path, maxBytes) {
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > FILE_SEARCH_LIMITS.max_file_bytes || stat.size > maxBytes) return null;
    return readFileSync(descriptor);
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function literalMatcher(query, caseSensitive) {
  if (caseSensitive) return (line) => line.indexOf(query);
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(escaped, "iu");
  return (line) => expression.exec(line)?.index ?? -1;
}

export function searchFiles({
  root,
  query,
  path = ".",
  case_sensitive = true,
  extensions = [],
  max_results = 50,
} = {}) {
  if (typeof root !== "string" || root.length < 1
    || typeof query !== "string" || query.length < 1 || query.length > FILE_SEARCH_LIMITS.max_query_length
    || !safeRelativePath(path) || typeof case_sensitive !== "boolean"
    || !Number.isSafeInteger(max_results) || max_results < 1 || max_results > FILE_SEARCH_LIMITS.max_results
    || !Array.isArray(extensions) || extensions.length > 16
    || extensions.some((entry) => typeof entry !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$/.test(entry))) {
    return { ok: false, code: "file-search-input-invalid", matches: [] };
  }
  let canonicalRoot;
  let target;
  try {
    canonicalRoot = realpathSync(root);
    target = resolve(canonicalRoot, path);
    if (!contained(canonicalRoot, target)) throw new Error("outside");
    const targetEntry = lstatSync(target);
    if (targetEntry.isSymbolicLink()) throw new Error("symlink");
    target = realpathSync(target);
    if (!contained(canonicalRoot, target)) throw new Error("outside");
  } catch {
    return { ok: false, code: "file-search-path-invalid", matches: [] };
  }

  const suffixes = new Set(extensions.map((entry) => entry.startsWith(".") ? entry : `.${entry}`));
  const pending = [target];
  const matches = [];
  const matchLine = literalMatcher(query, case_sensitive);
  let filesScanned = 0;
  let bytesScanned = 0;
  let truncated = false;

  while (pending.length > 0 && matches.length < max_results) {
    const current = pending.pop();
    let entry;
    try { entry = lstatSync(current); } catch { continue; }
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      let children;
      try {
        children = readdirSync(current, { withFileTypes: true })
          .sort((left, right) => left.name < right.name ? 1 : left.name > right.name ? -1 : 0);
      } catch { continue; }
      for (const child of children) {
        if (child.isSymbolicLink() || DEFAULT_EXCLUDED_DIRECTORIES.has(child.name)) continue;
        const childPath = resolve(current, child.name);
        if (contained(canonicalRoot, childPath)) pending.push(childPath);
      }
      continue;
    }
    if (!entry.isFile()) continue;
    if (suffixes.size > 0 && ![...suffixes].some((suffix) => current.endsWith(suffix))) continue;
    if (filesScanned >= FILE_SEARCH_LIMITS.max_files || bytesScanned + entry.size > FILE_SEARCH_LIMITS.max_total_bytes) {
      truncated = true;
      break;
    }
    filesScanned += 1;
    const bytes = readRegularFile(current, FILE_SEARCH_LIMITS.max_total_bytes - bytesScanned);
    if (bytes == null) continue;
    bytesScanned += bytes.length;
    if (bytes.includes(0)) continue;
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length && matches.length < max_results; index += 1) {
      const column = matchLine(lines[index]);
      if (column < 0) continue;
      matches.push({
        path: relative(canonicalRoot, current) || ".",
        line: index + 1,
        column: column + 1,
        preview: lines[index].slice(0, FILE_SEARCH_LIMITS.max_preview_length),
      });
    }
    if (matches.length >= max_results) truncated = true;
  }
  return { ok: true, code: null, matches, files_scanned: filesScanned, bytes_scanned: bytesScanned, truncated };
}
