# Fence V2 Remote-Approval Boundary

Status: design note only, 2026-07-08. No remote approval is enabled.

Remote control is remote code execution on the development machine. The current
`helix-fence` contract therefore remains:

```ts
ctx.mode === "tui"
```

Only a real terminal may present approval. RPC/headless modes fail closed even
when `ctx.hasUI` is true.

## Why Remote Approval Is Not Enabled

Routing approvals through a remote device would relax the current yolo-fence
contract. That requires a new design, not an exception in `helix-fence`.
`remote-pi` also remains blocked until package audit, relay evidence, and current
Pi compatibility clear.

## Fence V2 Requirements

A future fence-v2 remote approval path must:

- use a separate authenticated paired-device channel,
- prove the approving device is paired for the current session,
- bind the approval to the exact operation and stable operation hash,
- deny on timeout,
- deny on undefined/null dialog result,
- deny on device mismatch,
- deny on unpaired device,
- deny on stale approval,
- keep local TUI approval as the only current implementation until those proofs
  exist.

## Remote Package Evidence Required

Before any remote package is adopted, the audit must prove:

- Pi `0.80.3` compatibility,
- source and protocol behavior,
- relay visibility and end-to-end encryption claims,
- daemon/scheduler behavior,
- dependency risk,
- no-exfiltration posture,
- packet trace or equivalent boundary evidence.

This PR only records the design boundary.
