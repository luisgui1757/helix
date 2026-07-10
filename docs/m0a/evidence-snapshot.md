# M0a evidence snapshot & refresh

This is the human-readable, pinned snapshot of the environment M0a is built on. The
machine-readable source is [`tools/m0a/collect-evidence.sh`](../../tools/m0a/collect-evidence.sh);
re-run it after any `pi update` and reconcile any drift back into `ROADMAP.md` §4 and
this file **in the same change**.

## Last verified snapshot

Captured **2026-07-03** (UTC) with `tools/m0a/collect-evidence.sh` on the maintainer's
macOS host (Darwin 25.5.0, arm64). Values that are host-specific are noted.

| Fact | Value | Source |
| --- | --- | --- |
| Pi CLI version | `0.80.3` | `pi --version` |
| Pi binary (host-specific) | `/opt/homebrew/bin/pi` | `which pi` |
| Global npm root (host-specific) | `/opt/homebrew/lib/node_modules` | `npm root -g` |
| Installed package | `@earendil-works/pi-coding-agent@0.80.3` | package `package.json` |
| node / npm | `v26.4.0` / `11.17.0` | `node --version` / `npm --version` |
| Docs/examples checksum | `5aa4edd22108919537fe3f56b80afc3b8fa6d8a678163f3c2a4b8469b53c7a5e` | §4 checksum command |
| Docs files / examples files | 33 / 126 (161 files total in the checksum set) | `find … -type f \| wc -l` |

**Result:** version pin **OK**, docs/examples checksum **OK** — the ROADMAP §4
evidence is still valid as of 2026-07-03. No drift.

### Checksum command (reproducible)

```sh
cd "$(npm root -g)/@earendil-works/pi-coding-agent" \
  && find docs examples README.md CHANGELOG.md -type f | sort | xargs shasum -a 256 | shasum -a 256
```

### Named lead-candidate npm metadata (rechecked 2026-07-03, `--network`)

Read-only npm registry metadata; **not an install**. Compat target = installed Pi `0.80.3`.

| Package | Latest | Declared `@earendil-works/pi-coding-agent` range | Covers 0.80.3? |
| --- | --- | --- | --- |
| `remote-pi` | `0.5.3` | `^0.78.0` | **No** — blocked (§9-Q7) |
| `pi-nvim` | `0.2.4` | `^0.74.0` | **No** — deferred |
| `pi-web-access` | `0.13.0` | `*` | Permissive; still requires the full §5 audit |
| `pi-annotate` | `0.4.3` | (none declared) | n/a; still requires the full §5 audit |
| `pi-messenger` | `0.14.1` | (none declared) | n/a; still requires the full §5 audit |

`^0.78.0` and `^0.74.0` do **not** satisfy `0.80.3` (a caret range does not cross
minors in `0.x`). `remote-pi` stays **candidate-only** until upstream widens the range
or compatibility is otherwise proven; `pi-nvim` is deferred and only returns if a
concrete bidirectional-editor workflow becomes necessary. Declared version
range is only a prefilter — stars/downloads/recency/license and the no-exfiltration
source audit are the full catalog gate (ROADMAP §5) and live under
`reviews/package-audits/<date>-<slug>/`, not in this snapshot.

## How to refresh

```sh
# 1. From the repo root — offline by default, prints the snapshot report:
tools/m0a/collect-evidence.sh

# 2. To also refresh candidate npm metadata (public registry, read-only):
tools/m0a/collect-evidence.sh --network
```

The script reports **OK / DRIFT** for the Pi version pin and the docs/examples
checksum against the values pinned at the top of the script.

**On any DRIFT:**

1. Re-verify any Pi capability claim that depends on the changed docs against the
   offline docs tree (§4) — do not trust older embedded snapshots.
2. Update `EXPECTED_PI_VERSION` / `EXPECTED_DOCS_CHECKSUM` in
   `tools/m0a/collect-evidence.sh` and the values in this file and `ROADMAP.md` §4.
3. Do it in the **same change** (the roadmap's re-pin-after-update convention, §12).

## Safety notes

- The script forces `PI_OFFLINE=1`, `PI_SKIP_VERSION_CHECK=1`, `PI_TELEMETRY=0`
  for every `pi` call, so even `pi --version` / `pi --help` make no network request.
- It never reads or prints `~/.pi/agent/auth.json`, tokens, or provider key values.
- `--network` only performs read-only GETs to the public npm registry for the five
  named candidate packages above.
