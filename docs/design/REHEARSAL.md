# Purchasing workspace design review

## Plan

Medium: working Next.js application at desktop and phone widths, not a faux product demo.
Focal object: real stock exceptions and decisions requiring buyer attention.
Action: filter the stock list, inspect a position, review approvals, or run a scenario.
Payoff: the buyer can identify what needs action and see remaining capacity without scrolling past a promotional hero.
Remove: decorative sparkles, rainbow summary cards, vague promotional copy, oversized robot artwork, inset/extruded shadows, redundant summaries.
Keep: live data, existing routes and actions, a restrained Pip companion and buyer avatar.

## Stageshow references

Installed from https://github.com/benjitaylor/skills/tree/main/stageshow in `.agents/skills/stageshow`.
The requested npx command failed because npm DNS was unavailable. The skill was downloaded from the same public GitHub repository and installed locally, including its references, kit and examples.

Study: `examples/static-card` — read its source and CSS. Apply its aligned row columns, compact density, neutral surfaces, selected-state emphasis and consistent insets. This live application retains its real components and semantic headings; faux filler bars, cropped controls, staged actions and animation loops do not apply.
Rules: `references/craft.md`, `looks.md`, `review.md`, `verify.md`, `rehearse.md`.

## Research

- https://linear.app/now/behind-the-latest-design-refresh — quiet navigation and consistent action placement.
- https://support.ramp.com/ramp-procurement-quick-start-guide — distinct jobs for requests, approvals and issued purchase orders.
- https://mercury.com/blog/designing-in-the-open — product identity grounded in actual workflows and states.

The warm-neutral / forest palette is our design synthesis, not a palette copied from those products.

## Visual system

Canvas #F5F4F0; surface #FFFFFF; sidebar #ECEDE7; ink #202923; secondary text #59645C; line #DADFD6; action #285940; selection #E3EBDD; warning #9C542D on #F8EDE3.
Use system sans throughout, 14px body and 12px metadata, tabular figures for quantities, 8–12px corner radii, shadows only for overlays. Color denotes interaction or status. Official Tabler icons replace hand-authored generic icons.

## Verification

Implementation and visual verification in progress. No Stageshow animation gate claimed: this deliverable is a live app, not a Stage animation.
