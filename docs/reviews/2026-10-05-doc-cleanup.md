# Documentation cleanup

Date: 2026-10-05. Baseline: `bb4be27`. The owner requested canonical delivery
and Opus 5.5/xhigh review of the agreed cleanup, authorizing the archive move
and the reporting corrections after the earlier blocked handoff.

## Scope and preserved evidence

- Added the practical how-to drafted with Opus and checked against the skills.
- Shortened duplicate usage and role documentation. The setup reference remains
  the single Claude reviewer template.
- Made STATUS the entry point to results, failures and untested scenarios.
- Applied the owner's approved proposal to keep future review records concise
  and put round-by-round discussion in the PR. CONTRIBUTING documents that rule
  and the authorized archive exception; the governance page now links the
  public-readiness record at its pinned location.
- Appended corrections E-I to the [collection record](2026-10-04-four-skills.md#reporting-corrections-2026-10-05).
- Replaced 11 retired-engine records, totaling 248,212 bytes, with the
  [archive index](../history/README.md). Each file matches a Git blob at existing
  main commit `d28d81aa481b9363862ab6aefb8732c2f190bd17`, including the two files
  archived under their original paths. Current skill records remain append-only.
- Kept all seven installable files byte-identical to the hashes in the collection
  record. The benchmark, fixtures, published data and `.github` policies are unchanged.
  The link test now includes the how-to and this record; no check was removed.

Removing archive files reduces the active tree and reading burden. It does not
establish token, cache or time savings. Installed-skill discovery does not load
these archive files; an agent working in this repository may read them. Prompt
changes would require separate behavioral and performance checks.

## Verification and handoff

- `node --test tests/*.test.mjs`: 27 passed, no failures or skips. This includes
  both hosts' documented install commands, idempotence and conflict cases.
- `git diff --cached --check`, `git diff --check` and
  `gitleaks dir --redact .`: passed. The cached check covers the staged change.
- All 11 archive permalinks returned HTTP 200. The remote GitHub tree reports
  the same blob IDs as the removed files, and local `git show` byte comparisons
  matched each file before removal.
- All seven installable SHA-256 values match `bb4be27`. The three October 3
  records are unchanged; the October 4 record retains its original bytes as
  a prefix and adds the dated corrections.
- Native delivery and cache benchmarks were not rerun: this change edits no
  installed instructions, runtime or benchmark implementation. The dated
  behavior results and OPEN limitation remain the evidence for those areas.

The final source-review receipt and exact-commit GitHub checks are recorded in
[PR #16](https://github.com/luisgui1757/helix-cc/pull/16). Source review is separate
from the owner's merge decision. No merge or release is authorized by this record.

The Claude incomplete-evidence/false-COMPLETE limitation remains OPEN. This
cleanup corrects its reporting; it does not claim to fix model adherence.
