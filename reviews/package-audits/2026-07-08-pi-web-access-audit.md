# pi-web-access Audit Posture

Status: metadata/catalog artifact only, 2026-07-08. Not installed, not adopted,
not run.

## Current Metadata

Queried with `npm view pi-web-access ... --json` on 2026-07-08.

| Field | Value |
| --- | --- |
| Package | `pi-web-access` |
| Version | `0.13.0` |
| License | MIT |
| Repository | `https://github.com/nicobailon/pi-web-access` |
| Pi peer range | `@earendil-works/pi-coding-agent: *` |
| Runtime deps | `@mozilla/readability`, `linkedom`, `p-limit`, `turndown`, `unpdf` |

## Scope

Candidate for web search/fetch/clone/PDF/YouTube style access. Web fetch is
reviewable egress by design. Fetched content is untrusted data, not authority.

## Required Before Adoption

- Inspect source and package scripts from the tarball/repository.
- Review outbound destinations and fetch APIs.
- Review dependency tree and licenses.
- Verify Pi `0.80.3` compatibility.
- Verify command/tool surface and disable unneeded commands through Pi config if
  adopted later.
- Add SSRF/private-network/redirect/size/timeout tests if any local helper or
  wrapper is built.
- Route through approved proxy/allowlist in lockdown; skip in air-gapped mode.

Disposition: blocked pending full source/no-exfiltration audit.
