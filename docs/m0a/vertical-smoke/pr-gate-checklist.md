# PR gate checklist

Stands in for the future `/ship` pre-PR gate chain (Phase 2/M3). Run this from a clean
context before opening a PR. It is the canonical release-hygiene sequence
(Intent → Rebase → Review → Test → Document → Lint → Push → PR → CI), mapped to this
repo's **actual** checks. Nothing here auto-runs — it is a checklist, not an interceptor.

## Intent

- [ ] The change traces to a source of truth (roadmap item, failing test, spec, or an
      explicit instruction). One-sentence "what and why" is clear.

## Rebase / sync

- [ ] Branched from up-to-date `origin/main`; rebased if main moved.

## Review

- [ ] Independent second-provider review done for meaningful work
      ([`second-provider-review-handoff.md`](./second-provider-review-handoff.md));
      findings dispositioned; rejected findings recorded with rationale.

## Test / verify (objective gate — the real decision)

Run the repo's focused checks and paste results into the PR body:

- [ ] `tools/m0a/collect-evidence.sh` → exit 0, version pin + docs checksum **OK**
      (record drift only if drift).
- [ ] `npm run check:resources` → **Prime resource checks passed.**
- [ ] `shellcheck` on any shell script you touched/added.
- [ ] `git diff --check` → clean (no whitespace/conflict markers).
- [ ] If `ROADMAP_SUMMARY.html` changed: HTML parses + tags balance.
- [ ] If lockdown/egress touched: `tools/lockdown/no-egress-smoke.sh [--active]`
      (Docker) — or note it as harness-ready if Docker is absent.
- [ ] Any new script has a self-test / dry-run that passes.
- [ ] Offline settings-load smoke: `PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0
      pi --approve --no-session --list-models` → exit 0.

## Document

- [ ] Related markdown updated in the same change: `ROADMAP.md` (+ dated changelog
      entry), `ROADMAP_SUMMARY.html`, `docs/m0a/*`, `reviews/m0a/*`, `README.md` /
      `docs/resources/README.md` if behavior changed. Historical changelog entries kept
      intact; superseding status added where needed.

## Lint / public-safety

- [ ] Public-safety grep over the committed diff: **no** secrets, `auth.json` contents,
      provider key literals, session URLs, private paths, payloads, or AI-provenance
      metadata (no `Co-Authored-By`, no `Claude-Session`, no generated-with footer).

## Push / PR

- [ ] Commit message is clean, no AI/provenance trailers (repo convention).
- [ ] Push the branch; open a PR against `main` (non-draft).
- [ ] PR body includes: summary · what closed · what remains open · exact checks run ·
      checks not run and why · public-safety statement · files-changed table.
- [ ] **Do not merge** without maintainer approval.

## CI

- [ ] When CI exists (Phase-0 cross-cutting task), it must be green before merge.
