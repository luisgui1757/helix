import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const errors = [];

const requiredThemeColors = [
  "accent",
  "border",
  "borderAccent",
  "borderMuted",
  "success",
  "error",
  "warning",
  "muted",
  "dim",
  "text",
  "thinkingText",
  "selectedBg",
  "userMessageBg",
  "userMessageText",
  "customMessageBg",
  "customMessageText",
  "customMessageLabel",
  "toolPendingBg",
  "toolSuccessBg",
  "toolErrorBg",
  "toolTitle",
  "toolOutput",
  "mdHeading",
  "mdLink",
  "mdLinkUrl",
  "mdCode",
  "mdCodeBlock",
  "mdCodeBlockBorder",
  "mdQuote",
  "mdQuoteBorder",
  "mdHr",
  "mdListBullet",
  "toolDiffAdded",
  "toolDiffRemoved",
  "toolDiffContext",
  "syntaxComment",
  "syntaxKeyword",
  "syntaxFunction",
  "syntaxVariable",
  "syntaxString",
  "syntaxNumber",
  "syntaxType",
  "syntaxOperator",
  "syntaxPunctuation",
  "thinkingOff",
  "thinkingMinimal",
  "thinkingLow",
  "thinkingMedium",
  "thinkingHigh",
  "thinkingXhigh",
  "bashMode"
];

function fail(message) {
  errors.push(message);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(join(root, path), "utf8"));
  } catch (error) {
    fail(`${path}: ${error.message}`);
    return undefined;
  }
}

function sameArray(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function walk(dir, predicate, found = []) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(rel, predicate, found);
    } else if (predicate(rel)) {
      found.push(rel);
    }
  }
  return found;
}

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result = {};
  for (const line of match[1].split("\n")) {
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim().replace(/^"|"$/g, "");
    result[key] = value;
  }
  return result;
}

function checkPackage() {
  const pkg = readJson("package.json");
  if (!pkg) return;
  if (!sameArray(pkg.keywords, ["pi-package", "pi-skill", "pi-theme", "pi-extension"])) {
    fail("package.json: keywords must identify the Helix Pi package surface");
  }
  if (!sameArray(pkg.pi?.skills, ["./skills/helix-ui"])) {
    fail("package.json: pi.skills must expose exactly ./skills/helix-ui");
  }
  if (!sameArray(pkg.pi?.themes, ["./themes"])) {
    fail("package.json: pi.themes must expose exactly ./themes");
  }
  if (!sameArray(pkg.pi?.extensions, ["./extensions/helix-fence.ts", "./extensions/helix-answer.ts", "./extensions/helix-command.ts"])) {
    fail("package.json: pi.extensions must expose exactly helix-fence.ts, helix-answer.ts, and helix-command.ts");
  }
  for (const depKey of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    if (pkg[depKey] && Object.keys(pkg[depKey]).length > 0) {
      fail(`package.json: ${depKey} must stay empty for resource-only package`);
    }
  }
}

function checkSettings() {
  const settings = readJson(".pi/settings.json");
  if (!settings) return;
  if (settings.enableInstallTelemetry !== false) {
    fail(".pi/settings.json: enableInstallTelemetry must be false");
  }
  if (settings.enableAnalytics !== false) {
    fail(".pi/settings.json: enableAnalytics must be false");
  }
  if (settings.defaultProvider !== undefined) {
    fail(".pi/settings.json: defaultProvider must remain machine-local");
  }
  if (settings.theme !== "helix-rose-pine") {
    fail(".pi/settings.json: theme must be helix-rose-pine");
  }
  if (!sameArray(settings.skills, ["../skills/helix-ui"])) {
    fail(".pi/settings.json: skills must point only at ../skills/helix-ui");
  }
  if (!sameArray(settings.themes, ["../themes"])) {
    fail(".pi/settings.json: themes must point only at ../themes");
  }
  if (!sameArray(settings.extensions, ["../extensions/helix-fence.ts", "../extensions/helix-answer.ts", "../extensions/helix-command.ts"])) {
    fail(".pi/settings.json: extensions must point only at helix-fence.ts, helix-answer.ts, and helix-command.ts");
  }
}

function checkExtensions() {
  const tsFiles = walk("extensions", (path) => path.endsWith(".ts")).sort();
  const expected = ["extensions/helix-answer.ts", "extensions/helix-command.ts", "extensions/helix-fence.ts"];
  if (!sameArray(tsFiles, expected)) {
    fail(`extensions: expected exactly ${expected.join(", ")}, got ${tsFiles.join(", ") || "(none)"}`);
  }
}

function checkSkills() {
  const skillFiles = walk("skills", (path) => path.endsWith("/SKILL.md"));
  if (!sameArray(skillFiles, ["skills/helix-ui/SKILL.md"])) {
    fail(`skills: expected only skills/helix-ui/SKILL.md, got ${skillFiles.join(", ")}`);
    return;
  }
  const text = readFileSync(join(root, skillFiles[0]), "utf8");
  const frontmatter = parseFrontmatter(text);
  if (frontmatter.name !== "helix-ui") {
    fail("skills/helix-ui/SKILL.md: frontmatter name must be helix-ui");
  }
  if (!frontmatter.description || frontmatter.description.length > 1024) {
    fail("skills/helix-ui/SKILL.md: description is required and must be <= 1024 chars");
  }
}

function checkThemes() {
  const expectedNames = [
    "helix-rose-pine",
    "helix-rose-pine-dawn",
    "helix-rose-pine-moon"
  ];
  const themeFiles = walk("themes", (path) => path.endsWith(".json")).sort();
  const names = [];
  for (const path of themeFiles) {
    const theme = readJson(path);
    if (!theme) continue;
    names.push(theme.name);
    for (const key of requiredThemeColors) {
      if (!(key in (theme.colors ?? {}))) {
        fail(`${path}: missing colors.${key}`);
      }
    }
    for (const [key, value] of Object.entries(theme.colors ?? {})) {
      if (typeof value === "string") {
        const isHex = /^#[0-9a-fA-F]{6}$/.test(value);
        const isVar = value in (theme.vars ?? {});
        const isEmpty = value === "";
        if (!isHex && !isVar && !isEmpty) {
          fail(`${path}: colors.${key} references unknown value ${value}`);
        }
      } else if (!Number.isInteger(value) || value < 0 || value > 255) {
        fail(`${path}: colors.${key} must be a color string or 0-255 integer`);
      }
    }
  }
  if (!sameArray(names.sort(), expectedNames)) {
    fail(`themes: expected ${expectedNames.join(", ")}, got ${names.sort().join(", ")}`);
  }
}

function checkPublicSafety() {
  const rootsToScan = [
    ".pi/settings.json",
    "README.md",
    "package.json",
    "skills",
    "themes",
    "docs/resources",
    "docs/architecture",
    "reviews/package-audits"
  ];
  const patterns = [
    /api[_-]?key\s*[:=]/i,
    /secret\s*[:=]/i,
    /token\s*[:=]/i,
    /auth\.json/i,
    /claude\.ai\/code/i,
    /session_[A-Za-z0-9_-]+/i,
    /Co-Authored-By:/i,
    /noreply@anthropic/i
  ];
  const files = [];
  for (const entry of rootsToScan) {
    const full = join(root, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walk(entry, () => true));
    } else {
      files.push(entry);
    }
  }
  for (const file of files) {
    const text = readFileSync(join(root, file), "utf8");
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        fail(`${file}: public-safety pattern matched ${pattern}`);
      }
    }
  }
}

checkPackage();
checkSettings();
checkSkills();
checkThemes();
checkExtensions();
checkPublicSafety();

if (errors.length > 0) {
  for (const error of errors) console.error(`ERROR ${error}`);
  process.exit(1);
}

console.log("Helix resource checks passed.");
