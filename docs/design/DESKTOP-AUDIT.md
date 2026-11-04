# Desktop consistency audit

Source review on 2026-11-05 of Opportunities, Approvals, Purchase Orders, Runs, run detail, Scenarios, Evaluation, Inventory, shared UI, global CSS and the unified shell. This is a code-based audit; desktop screenshots and interaction checks remain separate verification. No purchasing actions, evaluation, resets or database writes were performed.

## Five prioritized fixes

| Priority | Concrete finding | Action / status |
| --- | --- | --- |
| 1 | Opportunity handoff labelled every successful HTTP response “Agent run complete,” including `awaiting_approval`. Approval results hardcoded “executed” / “order processed” even when the run escalated or failed. | **Corrected** in [`board.tsx`](../../src/app/opportunities/board.tsx) and [`queue.tsx`](../../src/app/approvals/queue.tsx): render server status, use conditional outcome copy, and keep drift/trace evidence. A missing refresh report no longer counts as a cleared finding. |
| 2 | The purple shell surrounds route-local stone, emerald and orange styling. Examples: `RunLink` and trace links use emerald; Opportunities selected filters used charcoal while Scenarios used violet-950; approval inner cards and run disclosures use unrelated white/stone fills. | Adopt shared semantic surface, text-link, filter and status styles. **Opportunities/Approvals now use `text-link`, and Opportunities uses `filter-pill`**; parent owns shared CSS and remaining routes. Keep green/amber/red for outcome meaning, rather than recoloring navigation as success. |
| 3 | Small controls follow different patterns: native reasoning selects, 7px `.btn` corners, 8px filter pills, 12px selects, native scenario disclosure markers and a text `›` in trace disclosure. | Integrate the shared `PurchasingSelect`; standardize filter height, selected appearance, disclosure chevron, hover and focus treatment. Preserve `aria-pressed`, `aria-current`, disabled LLM options, accessible labels and keyboard behavior. The new select received an independent source review; viewport/content resize cases were sent to its owner. |
| 4 | Opportunities initially displayed zero urgent/actionable findings before the report loaded, while its other metrics displayed “—”. Loading is bare text, Scenario loading uses a large illustrated panel, and most empty states share a generic box icon. A titleless `Panel` has no top content padding, affecting bare loading/error copy. | **Unknown metric values and neutral initial tones corrected** in Opportunities; its metric group is marked `aria-busy`. Share an intentional state block with consistent padding, contextual icon, title and next action. Keep `role="status"` / `role="alert"`; preserve previous results during refresh without implying fresh data. |
| 5 | Desktop density differs sharply between presentation and operational screens. Shared tables use 11px headers/12px body with 22px horizontal cell padding; Inventory/Orders have 11 columns. Inventory's two supplier tables split at `lg` while each table has a 600px minimum, so ordinary laptop widths need internal scrolling. Trace tool labels and timing can drop to 10.5–11px. | Use a deliberate desktop table density and legible secondary type, stack supplier tables until each has enough room, and make necessary horizontal scrolling discoverable. Use one nested-card/disclosure surface with a shared spacing scale. Preserve every operational column, trace payload and keyboard-scrollable table region. |

## Route coverage and preserved connections

| Route | Verified connection / preservation point | Visual focus |
| --- | --- | --- |
| `/opportunities` | GET findings, POST review, refreshed findings and run deep link remain connected. | Filter pills, state blocks, headroom cards, result status. |
| `/approvals` | Approve/reject POST, disabled controls while busy, refresh, drift and run history remain connected. | Pending/action/result card hierarchy and truthful outcome badges. |
| `/purchase-orders` | Reads actual order lines, confirmations, delivery state and audit run links. | Dense order table and activity table; consistent empty states. |
| `/runs` | Reads recent runs; scenario CTA and per-run links remain present. | Table hierarchy and actionable empty state. |
| `/runs/[id]` | Reads steps, validations, approvals and timestamps; disclosures preserve inputs/results. | Phase chips, nested disclosures, validation summaries and link color. |
| `/scenarios` | Scenario/approval POSTs, mode selection, result focus, busy disabling and trace links remain present. | Mode control, challenge filters, preset cards, state/result hierarchy. |
| `/evaluation` | Evaluation POST and explicit data-reset notice remain present; report mode/time/assertions stay visible. | Mode control, warning treatment, readable case/check rows. Do not run evaluation as part of visual review. |
| `/inventory` | Validated `?location=` deep links filter stock/demand summaries; suppliers and terms remain available. | Location navigation, clear network-wide supplier scope and table density. |

The existing shared `PageHeader`, `Panel`, `Stat`, `StatusBadge`, and keyboard-scrollable `Table` provide a useful base. Apply the same visual treatment to their nested content so the entire route feels part of the same workspace.

Verification for the two edited route components: `npm run typecheck` passed and `git diff --check` reported no whitespace errors. This does not claim fresh browser verification or a new purchasing evaluation run.

## Implemented desktop pass

The shared `desktop-system.css` now owns surfaces, page headings, type, buttons, semantic status tones, filters, inputs, disclosures, table density and focus states. All three native selects use the keyboard-accessible `PurchasingSelect`. Desktop navigation uses the anchored `WorkspaceMenu`; `DesktopMotion` adds fine-pointer cursor and restrained reveal/hover motion with reduced-motion support. Titleless panels now receive top padding, duplicated trace disclosure arrows were removed, and Inventory supplier tables remain stacked below the wide-desktop breakpoint. Short-height desktop rules keep the command-centre decision desk reachable. The final production Webpack build and TypeScript checks pass.
