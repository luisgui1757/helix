#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
minimum_node="22.19.0"
minimum_claude="2.1.154"
bin_dir="${CLAUDEX_BIN_DIR:-$HOME/.local/bin}"
caller_path="$PATH"
skip_claude=false
launcher_only=false
login_codex=false
login_copilot=false
dry_run=false
temporary_dir=""

cleanup() {
  [[ -z "$temporary_dir" ]] || rm -rf -- "$temporary_dir"
}
trap cleanup EXIT INT TERM

usage() {
  cat <<'EOF'
Usage: ./setup.sh [options]

Install or verify Claude Code, install pinned Helix CC dependencies, prepare the
pinned CLIProxyAPI binary, validate the plugin, and publish `claudex` on PATH.

Options:
  --login-codex       Run the interactive OpenAI/Codex subscription login
  --login-copilot     Run the interactive GitHub Copilot device login
  --skip-claude       Do not install or update Claude Code
  --launcher-only     Only install the claudex command
  --bin-dir <path>    Install claudex here (default: ~/.local/bin)
  --dry-run           Print mutating commands without running them
  -h, --help          Show this help
EOF
}

while (($#)); do
  case "$1" in
    --login-codex) login_codex=true ;;
    --login-copilot) login_copilot=true ;;
    --skip-claude) skip_claude=true ;;
    --launcher-only) launcher_only=true ;;
    --dry-run) dry_run=true ;;
    --bin-dir)
      [[ $# -ge 2 && -n "$2" ]] || { echo "setup.sh: --bin-dir requires a value" >&2; exit 2; }
      bin_dir="$2"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "setup.sh: unknown option: $1" >&2
      exit 2
      ;;
  esac
  shift
done

[[ "$bin_dir" == /* ]] || { echo "setup.sh: --bin-dir must be an absolute path" >&2; exit 2; }
case "$(uname -s)" in
  Darwin|Linux) ;;
  *) echo "setup.sh: only macOS and Linux/WSL are supported" >&2; exit 1 ;;
esac

print_command() {
  printf '  +'
  printf ' %q' "$@"
  printf '\n'
}

run() {
  if [[ "$dry_run" == true ]]; then
    print_command "$@"
  else
    "$@"
  fi
}

version_at_least() {
  local actual="$1" required="$2" actual_part required_part index
  local -a actual_parts required_parts
  IFS=. read -r -a actual_parts <<<"$actual"
  IFS=. read -r -a required_parts <<<"$required"
  for index in 0 1 2; do
    actual_part="${actual_parts[index]:-0}"
    required_part="${required_parts[index]:-0}"
    [[ "$actual_part" =~ ^[0-9]+$ && "$required_part" =~ ^[0-9]+$ ]] || return 1
    ((10#$actual_part > 10#$required_part)) && return 0
    ((10#$actual_part < 10#$required_part)) && return 1
  done
  return 0
}

install_launcher() {
  local source="$repo_root/bin/claudex" target="$bin_dir/claudex"
  run mkdir -p "$bin_dir"
  if [[ "$dry_run" == true ]]; then
    print_command ln -s "$source" "$target"
    return
  fi
  if [[ -L "$target" && "$(readlink "$target")" == "$source" ]]; then
    return
  fi
  if [[ -e "$target" || -L "$target" ]]; then
    echo "setup.sh: refusing to replace existing launcher: $target" >&2
    exit 1
  fi
  ln -s "$source" "$target"
}

path_contains() {
  case ":$caller_path:" in
    *":$1:"*) return 0 ;;
    *) return 1 ;;
  esac
}

shell_profile() {
  case "${SHELL:-}" in
    */zsh) printf '%s/.zshrc' "$HOME" ;;
    */bash) printf '%s/.bashrc' "$HOME" ;;
    *) printf 'your shell startup file' ;;
  esac
}

report_launcher_handoff() {
  if path_contains "$bin_dir"; then
    echo "claudex is ready at $bin_dir/claudex"
    return
  fi
  cat <<EOF
Helix CC installation complete, but claudex is not on the invoking shell's PATH.

Run this in the current shell:
  export PATH="$bin_dir:\$PATH"

For future shells, add the same line to $(shell_profile), then open a new shell.
EOF
}

if [[ "$launcher_only" == true ]]; then
  install_launcher
  if [[ "$dry_run" == true ]]; then
    echo "Dry run complete; no changes were made."
  else
    report_launcher_handoff
  fi
  exit 0
fi

export PATH="$HOME/.local/bin:$PATH"
install_claude=false
if ! command -v claude >/dev/null 2>&1; then
  if [[ "$skip_claude" == true ]]; then
    echo "setup.sh: Claude Code is missing and --skip-claude was requested" >&2
    exit 1
  fi
  install_claude=true
else
  installed_claude_version="$(claude --version | awk 'NR == 1 { print $1 }')"
  if ! version_at_least "$installed_claude_version" "$minimum_claude"; then
    if [[ "$skip_claude" == true ]]; then
      echo "setup.sh: Claude Code $minimum_claude or newer is required; found $installed_claude_version" >&2
      exit 1
    fi
    install_claude=true
  fi
fi

if [[ "$install_claude" == true ]]; then
  command -v curl >/dev/null 2>&1 || { echo "setup.sh: curl is required to install Claude Code" >&2; exit 1; }
  if [[ "$dry_run" == true ]]; then
    echo "Would install Claude Code from Anthropic's official stable installer."
    print_command curl -fsSL https://claude.ai/install.sh -o '<temporary>/claude-install.sh'
    print_command bash '<temporary>/claude-install.sh' stable
  else
    temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/helix-cc-setup.XXXXXX")"
    curl -fsSL https://claude.ai/install.sh -o "$temporary_dir/claude-install.sh"
    bash "$temporary_dir/claude-install.sh" stable
    hash -r
  fi
fi

if [[ "$dry_run" == false ]]; then
  command -v claude >/dev/null 2>&1 || { echo 'setup.sh: Claude Code installation did not publish claude on PATH' >&2; exit 1; }
  claude_version="$(claude --version | awk 'NR == 1 { print $1 }')"
  version_at_least "$claude_version" "$minimum_claude" || {
    echo "setup.sh: Claude Code $minimum_claude or newer is required; found $claude_version" >&2
    exit 1
  }
fi

command -v node >/dev/null 2>&1 || { echo "setup.sh: Node.js $minimum_node or newer is required" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "setup.sh: npm is required" >&2; exit 1; }
node_version="$(node -p 'process.versions.node')"
version_at_least "$node_version" "$minimum_node" || {
  echo "setup.sh: Node.js $minimum_node or newer is required; found $node_version" >&2
  exit 1
}

run npm ci --ignore-scripts --include=optional --prefix "$repo_root"
run node "$repo_root/bin/helix-cc-cliproxy" prepare
run claude plugin validate --strict "$repo_root"

if [[ "$login_codex" == true ]]; then
  run node "$repo_root/bin/helix-cc-cliproxy" login
fi
if [[ "$login_copilot" == true ]]; then
  run node "$repo_root/bin/helix-cc-cliproxy" copilot-login
fi

install_launcher

if [[ "$dry_run" == true ]]; then
  echo "Dry run complete; no changes were made."
  exit 0
fi

cat <<EOF
Helix CC components installed and verified.
EOF
report_launcher_handoff
cat <<EOF

After the launcher is on PATH, start native Claude Code:
  claudex

Provider-backed examples require an explicit model:
  claudex --providers codex --model gpt-5.6-luna
  claudex --providers codex,copilot --model openai/gpt-5.6-luna

See docs/quickstart.md for provider connection, proof, and first-workflow steps.
EOF
