# Assignment coverage and UI preservation

Audited 2026-11-05 against the supplied **AI Purchasing Agent — Assignment** PDF, repository source, and the saved evaluation report. This was a read-only implementation audit: no scenario, approval, reset, or evaluation was executed and no purchasing data was changed. Screens below are verified route/component entrypoints, not a claim of fresh browser acceptance testing.

The assignment requires at least one complete purchasing workflow: investigate a situation, challenge the initial recommendation, decide, act when appropriate, and validate the actual outcome. An animated interface and Pip's read-only chat should make that workflow easier to use without replacing it.

## Required capabilities

| Requirement | Verified implementation | Screen / interaction to preserve |
| --- | --- | --- |
| Accept a purchasing situation | Four Zod-validated scenario inputs in [`POST /api/agent/run`](../../src/app/api/agent/run/route.ts); `runAgent` in [`orchestrator.ts`](../../src/lib/agent/orchestrator.ts). | `/scenarios`: runnable presets and mode selection; `/opportunities`: findings can start a real agent review. |
| Investigate relevant information | [`tools.ts`](../../src/lib/agent/tools.ts) exposes inventory, forecasts, demand history, open orders, supplier terms/availability, promotions, budgets, and capacity. Deterministic investigation records its calls; optional model investigation receives read tools only. | `/runs/[id]`: investigation steps, inputs, outputs, and evidence; `/inventory` for stock context. |
| Make and explain a decision | [`policy.ts`](../../src/lib/domain/policy.ts) independently recomputes need, handles partial fulfilment, tests demand attribution, and finds feasible quantities. The orchestrator reconciles model proposals against that policy. | Scenario result: decision, quantity, supplier, rationale, key factors, alternatives, and confidence; trace remains reachable. |
| Respect purchasing constraints | [`constraints.ts`](../../src/lib/domain/constraints.ts) checks budget, storage, MOQ, lot size, supplier status/catalogue/capacity and soft risks; returns a feasible quantity and binding constraint. Purchase creation repeats hard checks at the tool boundary. | Result and trace show named checks and their outcomes, including why an order was reduced or held. |
| Take action / request human approval | [`autonomy.ts`](../../src/lib/domain/autonomy.ts) routes actions. `resumeApprovedAction` executes parked actions through [`POST /api/approvals/[id]`](../../src/app/api/approvals/[id]/route.ts). Tools create/amend/cancel mock purchase orders and record audit state. | `/approvals` and inline scenario controls: explicit **Approve & execute** / reject actions, result status, and run link. `/purchase-orders` shows persisted orders. |
| Validate results independently | [`feedback.ts`](../../src/lib/agent/feedback.ts) builds an expectation before the primary purchase, then re-reads orders, inventory, budgets, and storage. `validateResultingPo` persists post-checks. | `/runs/[id]`: expectation, pre/post validations, actual outcome, and drift; `/purchase-orders` provides the resulting record. See coverage limits below. |
| Respond when outcomes differ | [`supplier-gateway.ts`](../../src/lib/mock/supplier-gateway.ts) injects supplier faults. The orchestrator classifies drift, plans corrective purchases from current state, verifies them, and bounds attempts before escalation. | Preserve the full demand-shift → approval → shortfall → corrective order → verification sequence, not merely a success toast. |
| Evaluate appropriateness | [`eval/cases.ts`](../../eval/cases.ts) defines seven cases; [`eval/runner.ts`](../../eval/runner.ts) checks decisions, evidence calls, constraints, routing, validations, drift, remediation and database invariants. | `/evaluation`: report mode/time, individual assertions, rationale and failures. Running evaluation must retain the explicit demo-data reset notice. |

## Scenario evidence

The existing [`latest-report.json`](../../eval/latest-report.json) records **deterministic mode, 7/7 cases and 61/61 checks**, generated **2026-11-04T20:02:36.095Z**. These are historical results, not tests rerun during this audit and not evidence that an LLM provider was exercised.

| Assignment scenario | Implemented path | What the saved report actually demonstrates |
| --- | --- | --- |
| Recommendation review: proposed 800 units | `reviewRecommendation` recomputes need from stock, inbound supply, demand and supplier terms. | MODIFY to 350, held for approval. A separate correct 500-unit recommendation is ACCEPTed, executed and post-validated. |
| Supplier can provide only 250 of 500 | `resolveShortfall` checks the remaining requirement, proposes amending the original order and sourcing the gap elsewhere. | SPLIT_SOURCE, 250 from SUP-04, reliability warning and approval required. This case stops before approval; its report does not prove subsequent execution. |
| Demand / forecast change | `assessDemandShift` tests magnitude, sustainment, statistical evidence and promotion attribution. | Genuine shift: 1,500-unit expedited order, approval, 400-unit supplier confirmation, material drift, corrective order and nonnegative budget/capacity. Promotion control: NO_ACTION. |
| Purchasing constraint | `planConstrainedPurchase` names the binding limit, sizes a feasible order, considers overflow and can escalate when nothing fits. | Storage case proposes 1,000 units and waits for approval. The separate case named `S4-infeasible-escalates` also returns MODIFY 1,000 / awaiting_approval: its assertions allow MODIFY, so it does **not** demonstrate a fully infeasible escalation. |

## Fresh regression verification after UI integration

On 2026-11-05, the existing seven deterministic cases were rerun against a separate temporary database (`DB_PATH=/private/tmp/purchasing-unified-ui-evaluation.db`). All **7 cases and 61 checks passed**. This run preserved both the live demo database and `eval/latest-report.json`; its report is saved locally in `artifacts/unified-review/evaluation.json`. The test definitions and coverage limits below remain unchanged, so passing this suite does not close those gaps.

## Boundaries and gaps

- **Post-action coverage is uneven.** The full independent verification loop covers the primary `create_po` and remediation orders. In `executeAndVerify`, standalone amend/cancel actions return without that loop, and follow-up amendments/cancellations/overflow orders are logged without equivalent post-validation. Do not describe every mutation as independently verified.
- **Failure-path evaluation can be stronger.** No current case requires a genuinely zero-feasible-quantity escalation, critical drift, or exhausted remediation. The promotion control asserts NO_ACTION and quantity zero but does not compare complete before/after order state. Existing checks establish useful coverage, not exhaustive safety proof.
- **Evaluation uses the active demo database.** `runCase` calls `resetSchema()` and `seed()` for each case. `POST /api/evaluation` invokes that runner. It is a deliberate demo operation, not a read-only refresh or background health check. `npm run dev` also resets demo data before starting.
- **Mock, single-process environment.** SQLite state and the supplier gateway demonstrate the assignment; real supplier connectivity, authentication, transactional cross-run reservations, and production concurrency are outside the implemented demo scope.
- **Chat is advisory.** [`/api/chat`](../../src/app/api/chat/route.ts) and [`chat.ts`](../../src/lib/agent/chat.ts) answer from current purchasing records and provide navigation actions. They do not place orders or approve requests. A chat answer is not a completed agent run.
- **Submission is not verified.** Source, setup instructions, architecture diagrams, approach, dataset/schema, mock gateway, evaluation code, validation explanation, `.env.example`, and [`DEMO.md`](../../DEMO.md) exist. No Git remote was configured at audit time; public repository visibility, submission URL, deadline compliance, and the final deployed demo have not been verified. Existing screenshots may predate this redesign.

## Recommended unified experience

Keep a persistent workspace navigation to **Overview, Inventory, Scenarios, Opportunities, Approvals, Orders, Runs, and Evaluation**. The immersive opening can lead directly to **Review a purchasing situation**, with **Ask Pip** alongside it. Show pending approvals as actionable navigation, and preserve deep links to each run.

The primary walkthrough should be **Energy drink sales have tripled → inspect recommendation and constraints → Approve & execute → open trace → inspect original and corrective orders**. Follow it with **Yogurt sales are up 60%** to demonstrate that promotion evidence can correctly produce no purchase. Progress animations should represent actual loading or recorded phases; completion, approval, drift and escalation must come from server state. Keep evidence and validation accessible within the same visual system, with readable tables, keyboard controls and reduced-motion support.
