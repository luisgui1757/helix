# Public-source search — 2026-10-16

Searched for official source before writing replacements. No missing skill body was recovered from these checks. The files in `skills/` are consequently labeled reconstructions/completions, not downloaded originals.

## What was checked

- [Theo (`t3dotgg`)](https://github.com/t3dotgg): public GitHub API repository enumeration, 135 repositories. Filtered names/descriptions for skills, dotfiles, fleet, agents, config and T3 Code. No obvious personal fleet/skills repository. Agent-related candidates were unrelated forks.
- [Julius Marminge (`juliusmarminge`)](https://github.com/juliusmarminge): public enumeration, 271 repositories. Relevant candidates: `agent-tools` and his T3 Code fork. JuliusBrussee is a different account/person and was not treated as Theo's collaborator.
- [pingdotgg](https://github.com/pingdotgg): public enumeration, 14 repositories. Inspected current T3 Code tree.
- [juliusmarminge/agent-tools](https://github.com/juliusmarminge/agent-tools): README and complete recursive tree. It contains development tools, not these skills. Returned tree SHA `85caa830830ff39b9325c2d726a95df7a4bd8996`.
- [pingdotgg/t3code](https://github.com/pingdotgg/t3code): complete recursive tree, SHA `3962ae8586333310eeef655c917389b35f7b679d`. Project skills include contribution triage and app/mobile testing; the requested skill names were not present. Vendored unrelated skills were not substituted.
- [juliusmarminge/t3code](https://github.com/juliusmarminge/t3code): complete recursive tree, SHA `9bedd7140ce22f7f05d3990cdb50cafcceae37de`; no requested skill paths.
- Public gist inventories: [Theo](https://gist.github.com/t3dotgg), 16; [Julius](https://gist.github.com/juliusmarminge), 9. Names/descriptions did not identify these skills. Unrelated gist bodies were not downloaded.
- Web searches scoped to those accounts and exact skill combinations. Third-party skills with matching names were excluded: a name match is not provenance.

API repository lists were paginated to completion; the three inspected trees reported `truncated: false`. The SHAs above are the **tree identifiers returned by the tree API**, not asserted release/commit IDs. Public API requests used no account token.

## Limits

This was a bounded search of public likely locations, not every blob/history/branch of every repository. No private repository access was attempted. At about [1:05:40](https://www.youtube.com/watch?v=SY_woOjzlW4&t=3940s), Theo said he had not decided to publish the files and was leaning against it. That describes his statement in the video, not proof of today's publication status.

No third-party skill text was imported. No official source license is invented for the reconstructed bundle.
