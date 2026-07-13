# No-egress smoke harness

This harness verifies Pi and the local Helix package inside plain Docker with
`--network none`. Image construction may use the network to install the pinned Pi
version; every smoke command runs without a non-loopback interface.

```sh
tools/lockdown/no-egress-smoke.sh
tools/lockdown/no-egress-smoke.sh --active
```

The default run proves outbound denial and offline package startup. `--active`
also runs a Pi prompt against the loopback-only mock endpoint. Real credentials
are never mounted or passed; the mock uses a runtime-generated dummy key. Logs
contain named checks and exit status only, never prompts, payloads, headers, keys,
or private paths.

Exit codes are `0` for pass, `1` for a failed check, `2` for bad usage, and `3`
when Docker is unavailable. The static CI guard in
`tools/ci/no-live-egress-check.mjs` prevents accidental live-provider wiring but
is not a packet-level proof; this container harness is the enforcing local proof.
