---
name: helix-ui
description: Runs Helix's canonical UI quality workflow for frontend and interface work: design context, UX shaping, accessibility, performance, theme, responsive behavior, layout, typography, copy, color, motion, polish, and final optimization. Use when building, reviewing, or upgrading a UI to production quality.
version: 1.0.0
user-invocable: true
argument-hint: "[target]"
---

# Helix UI

Helix UI is the single consolidated UI-quality skill for Helix. It absorbs the
useful checks from the former design-skill fanout into one workflow so the slash
surface stays focused.

## Operating Rules

- Build the actual usable screen or component first; do not replace product work
  with a marketing page unless the user explicitly asks for one.
- Match the product domain. Operational tools should be dense, restrained, and
  easy to scan; expressive products can carry more visual weight.
- Use existing application patterns, design tokens, component libraries, and icon
  libraries before inventing new primitives.
- Keep cards for repeated items, framed tools, and modals. Do not nest cards or
  turn page sections into decorative floating cards.
- Avoid generic AI aesthetics: one-note palettes, decorative gradient blobs,
  oversized ornamental heroes, vague stock imagery, and ungrounded visual noise.
- Use icons for familiar tool actions. Use text labels for commands that need
  semantic clarity.
- Make text fit in every supported viewport. Do not scale font size with viewport
  width; use responsive layout, line wrapping, and stable dimensions instead.
- Verify the rendered UI when feasible. Screenshots, visual inspection, and
  focused accessibility/performance checks are evidence; descriptions are not.

## Workflow

1. Context
   - Identify the user, the primary workflow, the target surface, and the
     existing visual system.
   - Inspect nearby UI code, styles, tokens, and component conventions before
     changing anything.
   - State the intended change and the verification path before editing.

2. Shape
   - Decide the information hierarchy, navigation, major states, and responsive
     behavior.
   - Prefer fewer, more capable controls over scattered feature fragments.
   - Define empty, loading, error, success, disabled, and long-content states
     where the workflow can reach them.

3. Build
   - Use semantic HTML and accessible controls.
   - Keep dimensions stable for toolbars, grids, boards, tiles, buttons, and
     counters so hover states and dynamic labels do not shift layout.
   - Use real assets for product, place, object, person, or gameplay surfaces
     when inspection matters. Use generated bitmap assets only when that is the
     right medium.

4. Audit
   - Check accessibility: labels, focus order, keyboard operation, contrast,
     target sizes, reduced-motion behavior, and screen-reader names.
   - Check responsive behavior across mobile and desktop breakpoints.
   - Check theme behavior in light/dark modes and with the product palette.
   - Check performance: avoid unnecessary work in render paths, oversized
     assets, layout thrash, and janky animations.

5. Refine
   - Fix layout rhythm, spacing, alignment, and visual hierarchy.
   - Tune typography for readable sizes, weights, measure, and hierarchy.
   - Clarify labels, empty states, errors, and irreversible actions.
   - Add purposeful motion only where it explains state, confirms input, or
     improves orientation.

6. Verify
   - Run the relevant automated checks for the repository.
   - Render the UI in the intended environment and inspect at least one desktop
     and one narrow viewport when the change is visual.
   - Report what passed, what was not run, and any residual risk.

## Review Rubric

Rate material issues by user impact:

- P0: user cannot complete the primary workflow, data is lost, or security or
  privacy is compromised.
- P1: core workflow is confusing, inaccessible, broken on a supported viewport,
  or visually inconsistent enough to block release.
- P2: polish, responsiveness, hierarchy, copy, or performance issues that reduce
  quality but do not block core use.
- P3: minor cosmetic cleanup.

Lead reviews with findings and exact locations. If there are no material
findings, say that directly and name any verification gaps.

## Handoff

End implementation work with:

- What changed.
- Why the change satisfies the requested workflow.
- The checks that ran.
- Any check that was intentionally skipped.
- A compact file table when files changed.
