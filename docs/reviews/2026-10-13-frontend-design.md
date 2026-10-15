# Frontend-design import — 2026-10-13

The owner requested Anthropic’s frontend-design skill as part of Helix. The
linked Claude Code plugin is the correct skill, but that directory omits the
LICENSE.txt named in its frontmatter. Anthropic’s skills repository contains
byte-identical skill text and its Apache 2.0 license. Import that complete folder,
unmodified, rather than inventing a new design workflow or copying the Claude
Code repository’s separate commercial root license.

Sources:
- Skills revision `dbd4588f9e1033efb41dad4bef2f7947c8993d44`.
- Claude Code comparison revision `bf2323b3021c9d3db7a31e1e7d61068c3f704497`.
- SKILL.md SHA-256 `d91970639e9f5c37682ac7ab60094d35f1c7c1f38d731bd56396563aee10c1d3`.
- LICENSE.txt SHA-256 `0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594`.

The fifth skill remains independently installable. Existing conflict-preserving
installation preflight and repeat-install checks now include its folder and
license. Documentation shows optional composition with Helix; implementation,
verification, independent review and correction remain Helix’s responsibility.
No orchestration runtime, provider adapter or package dependency was added.

## Verification

Baseline: 46 maintenance tests passed. Candidate: 47 maintenance tests, all five
skill metadata validators and Gitleaks in the existing disposable Ubuntu guest
passed. A source-integrity regression binds both imported files to their reviewed
upstream hashes; documented installation tests exercise both target hosts.

An actual installed Claude Code 2.1.287 trial explicitly requested the imported
skill and produced one dependency-free HTML page in a disposable fixture. The
returned usage metadata identifies claude-opus-5-5; effort used the existing host
default and was not independently observed. The trial was limited to Read, Write
and Edit tools, with no shell or delegation. This is tool restriction, not an OS
filesystem sandbox. The agent disclosed invented library details and correctly
said it had not rendered or interactively tested the result.

The acceptance operator subsequently passed 12 checks: no scripts or external
resources, valid anchor targets, both required brand colors, both event times,
skip link, focus CSS, main landmark, mobile layout and no CSS motion. Firefox in
the Ubuntu guest rendered 1280×1000 and 390×1000 screenshots; both were inspected.
These are initial-viewport rendering checks, not full-page or screen-reader proof.
Actual keyboard behavior and complete skill-loading tool telemetry remain
unverified. One sample does not establish aesthetic quality or general adherence;
there was no old-skill or plain-agent comparison. Raw CLI output, prompt, checks,
HTML and screenshots stay outside Git in the operator’s acceptance evidence.

Independent source review is pending; no merge or publication is authorized.


## Independent review and follow-up

Opus 5.5/xhigh reviewed the complete candidate with Read/Glob/Grep tools only.
Requested effort is recorded; its effective value is not exposed in the result.
The reviewer accepted the source/attribution, packaging, preservation and gate
evidence. It identified a missing native discovery/invocation trial and a
possible collision with an already installed upstream frontend-design skill.
The install guide now explains keeping an existing copy or selecting one skill
by changing both loops, preserving the existing all-or-nothing preflight.

Clarification: the first trial supplied the checkout SKILL.md path directly.
It did not exercise `/frontend-design` invocation, and its JSON export does not
prove which files were read. The reviewer’s inferred read sequence from the turn
count is not telemetry. The phrase “installed Claude Code” describes the host
CLI, not verified installed-skill discovery. The initial result remains preserved;
native invocation trials are running separately on both hosts.

The upstream directory tree contains only SKILL.md and LICENSE.txt, no NOTICE.
The original demo’s fictional details were disclosed in its response but not
labeled in-page; the renewed trial explicitly requires an in-page demo label.
The initial 12 checks did not assert system sans-serif; its rendered CSS was
inspected separately. No full-page, keyboard or screen-reader pass is claimed.

## Native discovery results

The first `/frontend-design` trial failed discovery because the operator supplied
`--safe-mode`. Claude Code's own help explicitly says this disables custom
skills. The CLI correctly disclosed that absence; its generated page is not
evidence of skill use. This was an evaluation setup error, not a packaging defect.

A fresh Claude Code 2.1.287 invocation with custom skills enabled, hooks disabled,
no MCP servers and only Skill/Read tools listed frontend-design in its native
skill catalog and answered `/frontend-design` with a bounded design plan. It
reported the skill loaded and made no files. The export does not expose the
expanded skill body, so complete loading remains unobserved. A separate Codex
0.162.1 `$frontend-design` invocation in a read-only sandbox recorded a successful
read of the entire installed SKILL.md and returned a plan without edits. Both
used their existing host model defaults; no effort observation is claimed.

These trials resolve the missing native invocation exercise while preserving its
telemetry limit. They do not validate the optional combined Helix/design prompt
or a complete implementation/review workflow. Raw dispatch records and native
JSONL output, including the failed safe-mode trial, remain in operator evidence.

## Final review receipt

A fresh Opus 5.5/xhigh read-only review found no material findings and accepted
both corrections. Returned model metadata identifies Opus 5.5; effective effort
is unobserved. Its remaining precision notes are retained here: Codex read the
installed symlink's checkout target; the host version was captured separately
from the discovery dispatch; in-page demo labeling with the skill actually loaded
has not been exercised. Claude's first corrected response referred to an
unrecorded Python dispatch script. That response cannot establish input
provenance or full loading. A further fresh invocation explicitly closed stdin,
recorded its argv/prompt, discovered the skill and returned a plan without that
reference or any file writes. The original trial remains preserved; its cause
is unproven.

Final verification is 47 maintenance tests, five skill validators, a guest
Gitleaks scan and diff checks. The reviewer inspected captured outputs; its
Read/Glob/Grep-only role could not independently recompute hashes or execute
checks. The upstream source files, tree response, CLI help, exact commands and
native trial records remain outside Git. Source review does not approve a merge
or establish complete skill-loading telemetry, visual accessibility, combined
workflow success or general agent adherence.

## Port to main — 2026-10-15

The import above was first made on an unpublished local branch alongside
separate T3 orchestration work. This change carries only the frontend-design
import onto `main`; none of the T3 changes are included.

Upstream was rechecked through the GitHub API before porting. `anthropics/skills`
`main` still pointed at `dbd4588f9e1033efb41dad4bef2f7947c8993d44`; the latest
commit touching `skills/frontend-design` remains
`41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f` (2026-09-03). The directory still
contains only SKILL.md and LICENSE.txt, and both re-fetched files match the
SHA-256 digests above. The Claude Code plugin's SKILL.md at that repository's
`main`, `94506ff0d3bd9185f1752da36e968775021fb48f`, is also byte-identical.

Differences from the original candidate: `main` has no T3 references, so the
repeat-install check lists `main`'s packaged files plus the frontend-design
license. Current documentation touched by this change, outside this preserved
record, no longer states a current skill count and uses straight apostrophes like the
rest of `main`. Contributing notes how to re-pin the skill. STATUS records the
result as a table row, and the documentation index gains no separate skill link.
The source-integrity test also pins the folder to exactly its two files.

The installed skill bytes match those used in the trials above, so the trial
results and the source/attribution conclusions carry over. The earlier reviews
accepted a different tree, with other documentation and test lists; they do not
review this port. No new live trial ran for this port. Baseline `main`
passed 46 maintenance tests; the candidate passes 47. Gitleaks and a separate
skill metadata validator were not available on this host and were not run here;
the repository tests check frontmatter keys, the name, description length and
the pinned digests.

### Port review receipt

A fresh read-only reviewer (general-purpose subagent of the porting Claude Code
session on Opus 5.5; effort not observed) reviewed the staged port against `main`
and `5a6dd8d`. It recomputed both file digests against upstream, confirmed the
upstream and Claude Code revision claims above, found no T3 content and ran 47
passing tests. It reported no material findings. Its low-severity findings were
corrected: stale "this cleanup" references in STATUS, an overbroad carry-over
claim, an unpinned folder file list and a missing collection-scenario mention.
Its nits on historical wording, a missing rendering qualifier and undisclosed
punctuation changes were also corrected. A mutation check confirmed the folder
pin fails on an extra file. Re-review of the corrections found no material
findings; its remaining wording and wrap nits were applied. Gitleaks remains
unrun and is required before merge. This receipt does not approve a merge.

## Branch review — 2026-10-15

The owner asked for a review of the branch before shipping. A forked code-review
pass over the staged diff reported eight findings and no failing check.

Accepted and corrected:
- The install guide now also covers an existing frontend-design plugin or a copy
  in another skills directory, which the link preflight cannot detect.
- The how-to no longer shows a combined Helix/frontend-design command as normal
  usage. It explains that only the leading command invokes a skill, asks users
  to confirm the guidance loaded, and links the unevaluated status. This also
  resolves the reported conflict with "use only the skill the task needs".
- STATUS now states that the October 13 build trial disclosed invented details
  in its response, not in the page.
- Gitleaks 8.30.1 ran from the official release binary after its published
  checksum was verified: `dir --redact` exited 0 with no leaks.
- The new collection scenario was run on both hosts; results follow below.

Rejected, with reasons:
- Allowing an optional `license` key for every skill, or a per-skill key map:
  the single exception is deliberate. Only the pinned upstream file may carry
  extra metadata, and the digest test already pins its bytes; loosening the
  check would let Helix-authored skills gain keys unnoticed.
- Deriving the test digests from THIRD_PARTY.md: an offline test cannot prove
  that a revision contains particular bytes, so this would move the constants
  without adding verification. Contributing requires the revision, attribution
  and digests to change together, and review checks that rule.

The import commit `5a6dd8d` is published through the T3 orchestration pull
request, which preserves that branch's commits.

### Live collection-scenario trials

Both hosts ran the new collection scenario on 2026-10-15 in fresh disposable Git
fixtures through the documented user-level links (installed SKILL.md SHA-256
`d91970639e9f5c37682ac7ab60094d35f1c7c1f38d731bd56396563aee10c1d3` on both). Each
received the same brief (SHA-256 `1ac0b3588a7e94eee064432d7e035320a72971ecca15f2aee51fd45bea155fb1`):
exact brand colors and typefaces, two exact events, no external resources, one
allowed file `site/index.html`, invented details labeled in the page, working
in-page navigation, landmarks, visible focus and a 390px layout.

- Claude Code 2.1.287 ran `claude -p "/frontend-design …"` with only the Skill,
  Read, Write, Edit and Glob tools, `acceptEdits` and no session persistence.
  The result identifies `claude-opus-5-5`; effort was the host default and is
  not exposed. It took 4 turns and 534 seconds, made one Write and had no
  permission denials. The init event listed frontend-design as an available
  skill and command. The stream does not expose the injected skill text, so
  full loading remains unobserved.
- Codex 0.162.1 ran `codex exec --sandbox workspace-write "$frontend-design …"`.
  Its trace records a `cat` of the installed skill's checkout target that
  returned the complete file. The configured default is `gpt-6-astra` /
  `xhigh`; the JSON export does not identify the model that ran. While looking
  for a browser it listed directories outside the fixture. Those were reads;
  no write left the fixture.

An external 22-assertion checker (SHA-256
`83ba2333d88098074e83c8e4af4236252af329f13501116306d03babf895467f`) passed 22/22
on both pages. It checks that only `site/index.html` changed; no scripts,
external URLs or font loading; both brand colors; Source Serif 4 with Georgia
and a system sans stack; both events with exact names, dates and times; that
in-page links resolve; header, nav, main and footer landmarks; one h1; `lang`;
viewport; focus styles; responsive media queries; motion that is either absent
or gated by the reduced-motion preference; and in-page demo labeling. Reading
the pages confirmed the labeling: Codex invented only welcome copy and labeled
it; Claude invented event descriptions, an address, opening hours and About
text, tagged each, and explained the tag at the top.

T3's preview browser rendered both pages at 1280×800 and 390×844 initial
viewports with no horizontal overflow and the requested fonts in computed
styles. Claude's vertical "What's on" book-spine link renders its apostrophe
rotated, a visible typographic defect. Tab moved focus to each page's skip
link, but the preview window lacked OS focus, so `:focus-visible` styling was
not observable; focus styling is verified only as declared CSS. Screen-reader
use, full-page rendering and other browsers were not exercised.

These two samples show in-page demo labeling for this brief on both hosts, with
complete skill loading observed only for Codex. They do not establish aesthetic
quality, general adherence or an advantage over a plain agent; no control ran.
Raw transcripts, the prompt, checker, pages and screenshots stay outside Git in
the operator's evidence.

### Fact-check corrections

A fresh read-only reviewer checked the two sections above against the raw
evidence. It recomputed every quoted digest, reran the checker (22/22 on both
pages), and confirmed the returned model, turn count, duration, tool calls,
Codex's complete skill read and the in-page labeling. Corrections, appended
rather than rewritten:

- The statement that `5a6dd8d` is published was written ahead of the push.
  It became true when the T3 branch was pushed; the commit resolves on GitHub
  through [pull request #23](https://github.com/luisgui1757/helix/pull/23).
- The branch review's claim that only the leading command invokes a skill holds
  for Claude Code slash commands, not Codex: Codex 0.162.1 can load a `$skill`
  mentioned anywhere in a prompt. The how-to now says so.
- Codex's out-of-fixture reads were broader than stated. It probed parent
  directories for `AGENTS.md` and searched the operator's development directory
  for browsers. "No write left the fixture" refers to agent-directed writes;
  each host also wrote its own session or memory storage.
- "Requested fonts in computed styles" means the declared font stacks.
  Headings rendered in the Georgia fallback on the preview machine, which
  lacks Source Serif 4; the brief forbids loading it.
- The checker only detects that a reduced-motion query exists, not that each
  motion is gated, and does not tie each date and time to its event. Reading
  both pages confirmed gating and the event pairings.
- Claude's address and opening hours share one demo tag. Its page also has an
  invented year in machine-readable `datetime` attributes, disclosed only in
  its response.
- Claude's skip link appears through `:focus`, not `:focus-visible`.
- `claude.argv` stores a placeholder for the prompt; the brief file and the
  `/frontend-design` prefix in the run command are the invocation record.
  Codex's own session log records the `$frontend-design` invocation and the
  injected skill text.
- The operator's global Claude and Codex instructions, an installed design
  plugin and a session-start hook were active, as on the operator's normal
  hosts. They were not part of the brief.
- The screenshots now sit in the evidence folder with a checksum list.
- Gitleaks was rerun on the final commit of this branch.

### Squash — 2026-10-15

At the owner's request, both pull requests were squashed to one commit each.
Commit `5a6dd8d` and this branch's intermediate commits are no longer in either
branch's history. GitHub may keep them reachable by SHA, but that is not
guaranteed; the SHA-256 digests above are the durable provenance for the
imported files.
