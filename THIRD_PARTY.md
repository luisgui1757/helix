# Third-party attribution

`skills/unslop/SKILL.md` adapts Lauren Tan's
[pstack unslop](https://github.com/cursor/plugins/blob/e43c7ee26e0038c6c1fa8380dd34ce86ff94cb2a/pstack/skills/unslop/SKILL.md)
from `cursor/plugins`, pinned to revision
`e43c7ee26e0038c6c1fa8380dd34ce86ff94cb2a` on 2026-10-04.
The [upstream MIT license](skills/unslop/LICENSE) is included in the installable
skill folder. Its numbered prose rules retain their original IDs.

This adaptation narrows activation to prose work, removes upstream
invocation metadata, and adds safeguards for factual meaning, uncertainty,
literal content, and task scope. Upstream's numbered rules are otherwise
preserved.

The setup and consultation skills are original text, informed by reviewing
pstack's setup and the advisor plugin. They do not copy those plugins' hooks,
persistent modes, routing configuration, or agent definitions.

## Frontend design

`skills/frontend-design/` includes Anthropic's unmodified
[Frontend Design skill](https://github.com/anthropics/skills/tree/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/frontend-design),
pinned to revision `dbd4588f9e1033efb41dad4bef2f7947c8993d44` on 2026-10-13.
The skill is byte-identical to the frontend-design plugin in
[Claude Code](https://github.com/anthropics/claude-code/blob/bf2323b3021c9d3db7a31e1e7d61068c3f704497/plugins/frontend-design/skills/frontend-design/SKILL.md).
The skills repository supplies its [Apache 2.0 license](skills/frontend-design/LICENSE.txt),
which stays inside the independently installable folder. This third-party skill
is covered by that license, rather than Helix's MIT license.

## Document view and TLDR

`doc-view` and `tldr` are original Helix instructions under the repository's MIT
license. Pstack's bro and ketchup skills informed the discussion, but their text
is not copied. Doc-view composes separately installed design and writing skills;
it does not vendor Impeccable or change any third-party license.
