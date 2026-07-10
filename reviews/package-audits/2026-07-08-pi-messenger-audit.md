# pi-messenger Audit Posture

Status: metadata/catalog artifact only, 2026-07-08. Not installed, not adopted,
not run.

## Current Metadata

Queried with `npm view pi-messenger ... --json` on 2026-07-08.

| Field | Value |
| --- | --- |
| Package | `pi-messenger` |
| Version | `0.14.1` |
| License | MIT |
| Repository | `https://github.com/nicobailon/pi-messenger` |

## Scope

Only these questions are in scope:

- inter-agent messaging,
- file reservation / parallel-edit safety,
- possible overlap with live pipeline visibility.

Firstmate-style orchestration, autonomous loops, and broad command-surface
expansion are out of scope for this audit.

## Required Before Adoption

- Inspect source and package scripts.
- Review message storage and transport.
- Verify whether it writes raw prompts, model output, or private file paths.
- Verify file-reservation semantics under concurrent edits.
- Verify command/tool surface and trim unused surfaces if adopted later.
- Prove no unapproved egress.

Disposition: audit-only candidate.
