# Skill directory — 2026-10-15

Scope: at the owner's request, present Helix as a directory of skills and stop
hardcoding the skill list in the install guide. No skill bytes change.

Changes:
- The README introduces Helix as a directory and lists each skill with its
  origin and license; the Helix workflow keeps its own section.
- Each install block checks that it runs from the Helix repository, defines its
  folder list once (`set -- "$PWD"/skills/*/`) and uses it in both loops. A new
  skill installs without editing the guide. A subset is one edit to that line,
  which also keeps an existing copy of a skill, such as Anthropic's
  frontend-design plugin.
- Contributing gains an "Adding a skill" checklist that matches the tests.

Verification: 53 maintenance tests and `git diff --check` pass. The
installation tests run the documented commands for both hosts in disposable
directories. Existing cases still pass: wrong working directory, existing
link, other link, directory, file, dangling link and repeat installation. A
missing folder is no longer an error, so the incomplete-source case is now a
folder without `SKILL.md`. New cases per host cover another repository's
`skills/` tree, a listed subset and a newly added folder. Removing the
repository check makes the foreign-tree case fail, and the previous guide fails
the added-folder case. Live native discovery was not rerun, because link names
and targets are unchanged.

Review: a fresh read-only reviewer (a general-purpose subagent of the writing
Claude Code session on Opus 5.5; effort not observed) ran the commands under dash, bash and
busybox with a substituted home. It found two material issues, both fixed. The
guide would silently install another repository's skills; it now requires
`skills/helix/SKILL.md`. The Contributing checklist disagreed with the
metadata and digest tests; it now matches them. From its nits, the folder list
is defined once so a subset is a single edit, each README row names its
license, and the product description moved to the directory level.

A closure check of the fixes found no unresolved findings; it repeated the
probes from a path containing spaces and glob characters.

Digests: `docs/install.md` `73c2c734dbddc059b174f0082d2b60ebba939cc9679555efc11369c6a71ea3db`;
`tests/skill.test.mjs` `a78c00fb46cad406539b4c859fde8505f8c5412bb8d0e2003325027397e9fc2c`.
