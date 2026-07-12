# remote-pi Audit Posture

Status: metadata/catalog artifact only, 2026-07-08. Not installed, not adopted,
not run.

## Current Metadata

Queried with `npm view remote-pi ... --json` on 2026-07-08.

| Field | Value |
| --- | --- |
| Package | `remote-pi` |
| Version | `0.5.4` |
| License | MIT |
| Repository | `https://github.com/jacobaraujo7/remote_pi` |
| Pi dependency | `@earendil-works/pi-coding-agent: ^0.79.10` |
| Runtime deps | MCP SDK, native keyring, Ed25519, scheduler, QR terminal, TypeBox, WebSocket, Zod |

## Compatibility

The package has moved from the previously recorded `^0.78.0` line to
`^0.79.10`, but that still does not prove compatibility with installed Pi
`0.80.3` under Helix's current bar. Treat it as blocked until source and runtime
compatibility are verified without installing it into Helix.

## Security Framing

Remote control is remote code execution on the development machine. The current
fence remains local-TUI only; remote-routed approval requires future fence-v2.

## Required Before Adoption

- Inspect source and protocol docs.
- Prove relay visibility and end-to-end encryption claims.
- Review pairing and device identity semantics.
- Review daemon/scheduler behavior.
- Review dependency risk and native keyring behavior.
- Prove Pi `0.80.3` compatibility.
- Capture no-exfiltration/packet evidence in an approved boundary.
- Prove remote destructive operations remain blocked by the fence until a
  separate paired-device approval design exists.

Disposition: blocked; design/audit only in this PR.
