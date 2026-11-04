# Desktop purchasing workspace review

## Delivered direction

Pip now uses an editorial purchasing identity: warm paper, ink, cobalt, orange and chartreuse. Locally served Bricolage Grotesque provides display typography; DM Sans keeps operational content readable. The overview and eight work areas share navigation, spacing, controls, typography, focus states and semantic status colors. Legacy `/dashboard` links still redirect into the overview.

The overview opens with a custom Three.js parcel mascot, a cobalt conveyor and three selectable fulfillment depots. Selection changes the actual location’s cover, budget and storage readout. An accessible pause/resume control accompanies reduced-motion support. The operating picture below uses three distinct visual fields for stock coverage, supplier changes and open orders. Detailed stock, budget, decisions and capacity follow in the same palette.

Scenarios use a numbered case index, six case-specific diagrams and a decision receipt populated by the actual response. Original scenario inputs are explicitly distinguished from current workspace evidence. Selecting a case never runs it. Inventory uses a common 0–30-day coverage scale, separate on-hand/inbound supply, the 12-day review threshold and recorded demand traces. Its filters, stock table and underlying evidence remain available. Approvals compare recorded quantities, distinguish primary and follow-up purchases, expose policy checks and retain notes, history, execution and verification.

The persistent Pip drawer supports purchasing questions and reviewable suggested actions. Its mascot, typography, prompts, buttons and composer match the main application.

## Research and requested skill

The requested `stageshow` skill is installed at `.agents/skills/stageshow` from benjitaylor/skills. Its craft, motion, framing and review principles informed this pass. Operational data and real interactions take precedence over its faux-UI and filler conventions.

Research included the [Awwwards gallery](https://www.awwwards.com/websites/) and Site of the Day listings, [Terminal Industries](https://terminal-industries.com/), [Lusion](https://lusion.co/about/), [Obys](https://obys.agency/about), and [Exo Ape](https://www.exoape.com/). Awwwards submission images for Dragonfly and Lando Norris reinforced the use of one memorable focal object, strong editorial type and deliberate high-contrast color. References informed composition; no production assets or branding were copied. The mascot, scene geometry, diagrams and interface are local app code. The locally bundled Bricolage font includes its OFL license.

## Verification in this pass

- Visually inspected the new homepage in Chrome at regular desktop scale and 175% zoom for laptop-scale layout. The large headline, sculpture, location controls and primary action fit together without visible clipping. Saved a review capture at `artifacts/editorial-review/home-laptop.png`.
- Selected Cartagena in the supply network and observed its actual cover, budget, capacity and inventory link update.
- Visually inspected the new scenario lab, inventory coverage map, approval queue/history and Pip drawer. Lab and inventory were reviewed at 175% zoom. The remaining order/activity/evaluation/opportunity pages retain their task-specific layouts with the shared editorial palette and typography.
- Opened the custom inventory dropdown and selected “Needs review” with the keyboard; its selected value updated correctly. Popup placement and contrast were checked visually.
- Review corrected translucent sticky navigation, residual lavender operating-data styles, duplicate disclosure arrows, low-contrast metadata, missing anchor offsets, route scroll/focus handling, misleading minimum/missing coverage bars and their accessible description. Inventory axis bounds now explicitly align with the row plot and include a low-cover color legend.
- TypeScript and the Webpack production build passed. The default Turbopack builder remains unsuitable in this sandbox because its CSS worker attempts a restricted port bind.
- Existing isolated tests passed: 13 chat tests and 3 legacy network-clock regressions. These clock tests are not coverage of the new sculpture. The new sculpture additionally received source lifecycle review and numeric projection checks at 760×505 and 560×450.
- Agents checked six scenario diagram renders, an updated approval receipt, and nine inventory/approval rendering fixtures, including missing data, split purchases and clipped coverage.
- Native-dialog keyboard behavior, dropdown navigation, reduced motion, offscreen animation suspension, WebGL fallback and resource disposal were reviewed in source. No live purchasing, approval or evaluation mutations were invoked during UI verification.
- Automated browser capture was unavailable in this environment. Review used the existing Chrome desktop through Computer Use; a concurrent session occasionally changed the route/zoom. Interrupted checks are not counted as passes. Exact pixel-width and exhaustive browser/device certification are not claimed.

## Assignment scope

Investigate → Decide → Act → Verify remains the application’s working flow. Chat is advisory; execution, approval and validation use the existing workflows. See `ASSIGNMENT-COVERAGE.md` for detailed requirement mapping. A previous isolated deterministic evaluation passed 7 cases / 61 assertions; this visual pass did not rerun it against the live database. Provider/domain edits from another session were preserved.
