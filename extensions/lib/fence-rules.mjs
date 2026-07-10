// Prime yolo-fence — pure classification rules (zero dependencies, unit-testable).
//
// The fence is a DEFENSE-IN-DEPTH SPEED BUMP, not containment. A regex denylist
// on command strings is evadable (heredocs, aliases, `$(...)`, base64, scripts,
// `find -delete`, env-var indirection). The real boundary is OS/container
// sandboxing (see docs/stage1-2/yolo-fence.md and docs/m0a/lockdown-boundary.md).
// These rules exist to catch the obvious, high-blast-radius, irreversible cases
// and force an explicit confirm (TTY) or a fail-closed block (non-TTY).

/**
 * Irreversible / high-blast-radius shell command patterns. Each has a stable
 * `rule` id (used in tests, logs, and the block reason) and a `pattern`.
 * Ordered most-specific first; the first match wins.
 */
export const DANGEROUS_COMMAND_RULES = [
  { rule: "rm-recursive", pattern: /\brm\s+(?:-[a-z]*r[a-z]*f?|-[a-z]*f[a-z]*r|--recursive)\b/i },
  { rule: "git-push-force", pattern: /\bgit\s+push\b[^\n]*\s(?:--force(?!-with-lease)\b|-f\b)/i },
  { rule: "git-reset-hard", pattern: /\bgit\s+reset\s+--hard\b/i },
  { rule: "git-clean-force", pattern: /\bgit\s+clean\b[^\n]*-[a-z]*f/i },
  { rule: "git-branch-delete", pattern: /\bgit\s+branch\s+-[dD]\b/i },
  { rule: "sudo", pattern: /\bsudo\b/i },
  { rule: "chmod-chown-777", pattern: /\b(?:chmod|chown)\b[^\n]*\b777\b/i },
  { rule: "chmod-chown-recursive", pattern: /\b(?:chmod|chown)\s+-[a-z]*R/i },
  { rule: "mkfs", pattern: /\bmkfs\b/i },
  { rule: "dd-disk", pattern: /\bdd\b[^\n]*\bof=\/dev\//i },
  { rule: "disk-redirect", pattern: />\s*\/dev\/(?:sd|nvme|disk|rdisk)/i },
  { rule: "fork-bomb", pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/ },
  { rule: "db-drop", pattern: /\bdrop\s+(?:database|table|schema)\b/i },
  { rule: "kubectl-delete", pattern: /\bkubectl\s+delete\b/i },
  { rule: "terraform-destroy", pattern: /\bterraform\s+destroy\b/i },
  { rule: "docker-system-prune", pattern: /\bdocker\s+system\s+prune\b/i },
];

/**
 * Paths that must not be written/edited without an explicit confirm. Secret and
 * VCS-internal surfaces the agent should never silently mutate.
 */
export const PROTECTED_PATH_RULES = [
  { rule: "dotenv", pattern: /(?:^|\/)\.env(?:\.[\w.-]+)?$/i },
  { rule: "auth-json", pattern: /(?:^|\/)auth\.json$/i },
  { rule: "ssh-dir", pattern: /(?:^|\/)\.ssh\// },
  { rule: "private-key", pattern: /(?:^|\/)id_(?:rsa|ed25519|ecdsa|dsa)\b/ },
  { rule: "git-internal", pattern: /(?:^|\/)\.git\// },
  { rule: "credentials", pattern: /(?:^|\/)\.?(?:credentials|secrets?)(?:\.[\w.-]+)?$/i },
  { rule: "netrc", pattern: /(?:^|\/)\.netrc$/i },
];

/**
 * Classify a bash/user-shell command string.
 * @param {string} command
 * @returns {{ risky: boolean, rule: string | null }}
 */
export function classifyCommand(command) {
  if (typeof command !== "string" || command.length === 0) {
    return { risky: false, rule: null };
  }
  for (const { rule, pattern } of DANGEROUS_COMMAND_RULES) {
    if (pattern.test(command)) return { risky: true, rule };
  }
  return { risky: false, rule: null };
}

/**
 * Classify a write/edit target path.
 * @param {string} path
 * @returns {{ protectedPath: boolean, rule: string | null }}
 */
export function classifyWritePath(path) {
  if (typeof path !== "string" || path.length === 0) {
    return { protectedPath: false, rule: null };
  }
  for (const { rule, pattern } of PROTECTED_PATH_RULES) {
    if (pattern.test(path)) return { protectedPath: true, rule };
  }
  return { protectedPath: false, rule: null };
}
