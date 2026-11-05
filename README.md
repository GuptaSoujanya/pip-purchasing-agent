# AI Purchasing Agent

[![Portfolio](https://img.shields.io/badge/portfolio-soujanyalab.in-0b7285?style=flat-square)](https://soujanyalab.in)
![Stack](https://img.shields.io/badge/Next.js%2016-TypeScript-1f2937?style=flat-square)
![Evaluation](https://img.shields.io/badge/evaluation-9%2F9%20cases%20%C2%B7%2078%2F78%20checks-2b8a3e?style=flat-square)

An agent that makes, executes and **validates** purchasing decisions for a quick-commerce retailer.

It is not a chatbot that answers questions about purchasing. It takes a situation, investigates it
with tools, decides what to do, checks that decision against hard business constraints *before*
writing anything, executes it, then re-reads the world to confirm what actually happened — and
corrects itself when the outcome differs from what it intended.

All four assignment scenarios are implemented end-to-end.

### The whole loop, in one recording

The agent reviews an 800-unit recommendation, recalculates it to 350, is held at the autonomy gate
because that is a −56% deviation, gets approved, executes — and then the harder case: it sizes a
1,500-unit expedited order, the supplier silently confirms only 400, and the agent catches that by
re-reading the database and sources the balance elsewhere on its own.

![The agent deciding, being held for approval, executing, and self-correcting after supplier drift](docs/media/demo-decision-loop.gif)

<table>
<tr>
<td width="50%"><img src="docs/media/decision-receipt.png" alt="Decision receipt showing MODIFY 350 units held for buyer approval"><br><sub><b>It disagrees with the recommendation.</b> 800 → 350, with the arithmetic shown and the reason it stopped.</sub></td>
<td width="50%"><img src="docs/media/drift-self-correction.png" alt="Material drift detected after the supplier confirmed 400 of 1500 units, with a corrective order placed"><br><sub><b>It notices being short-shipped.</b> 400 confirmed against 1,500 ordered → material drift → corrective order, unprompted.</sub></td>
</tr>
<tr>
<td width="50%"><img src="docs/media/constraint-checks.png" alt="Constraint checks and the autonomy gate, with approve and reject actions"><br><sub><b>Constraints are checked before anything is written.</b> Hard limits block; soft ones warn and route to a human.</sub></td>
<td width="50%"><img src="docs/media/chat-streaming.png" alt="Streaming chat reply with a provenance strip naming provider, model, latency, tokens and cost"><br><sub><b>The model call is observable.</b> Tokens stream live; the strip reports provider, latency, tokens and cost.</sub></td>
</tr>
</table>

---

## Quick start

```bash
npm install
npm run dev          # rebuilds the demo database, then starts on http://localhost:3000
```

**No API key is needed**, and you still get real model reasoning. The provider is resolved in this
order:

| | Reasoning backend | What you need |
|---|---|---|
| 1 | whichever API key is set in `.env.local` | a key — **Google Gemini** and **Groq** both have genuinely free tiers |
| 2 | **Claude Code CLI bridge** | a [Claude Code](https://claude.com/claude-code) install you are already signed in to — no key, no config |
| 3 | deterministic policy engine | nothing at all |

Whichever applies, confirm it is genuinely driving the agent rather than silently falling back:

```bash
npm run check:llm
```

That proves three things in increasing strength — the provider answers; it can select a tool from
the real 21-tool catalogue; and a full scenario run completes in `llm` mode with model-issued tool
calls recorded in the trace. It fails loudly rather than degrading quietly.

For the same proof from inside the UI, open **Ask Pip** and send a question. The reply streams in
token by token over SSE, and every answer carries a provenance strip naming the provider, the model,
the latency, the token counts and the call cost:

![Streaming chat with provider, token and cost provenance](docs/media/chat-streaming.png)

The strip also reports the verdict on the streamed text. Pip is a read-only surface, so a model reply
is checked against an answer independently derived from the database before it is kept; if it invents
a figure, claims an action it cannot take, or tries to call a tool, the draft is discarded, the
verified answer is shown instead, and the strip says why. Streaming makes the call observable without
making the guardrail optional.

```bash
npm run eval         # evaluation suite, deterministic — every assertion, every time
npm run eval:llm     # the same suite with every decision made by the model
npm run db:reset     # rebuild the demo world from scratch
npm run typecheck    # strict TypeScript, no errors
```

```bash
npm run demo         # the whole system end to end in the terminal, about a second, no browser
```

A full walkthrough of both the terminal and browser demos, with screenshots and what to look for at
each step, is in [`DEMO.md`](DEMO.md).

### The 90-second demo

1. Open **Scenarios**.
2. Run **"Energy drink sales have tripled"**.
   The agent detects a real demand shift, sizes a 1,500-unit expedited order, and stops — the value
   exceeds its $5,000 autonomy ceiling.
3. Click **Approve & execute**.
   The supplier silently confirms only **400 of 1,500 units**. The agent catches this by re-reading
   the database, classifies it as *material drift*, and places a corrective 1,200-unit order with a
   different supplier — unprompted.
4. Open the **reasoning trace** to see every step, grouped by phase — 37 for the run recorded
   above, including the drift finding and the corrective order.

Then run **"Yogurt sales are up 60%"**. Statistically it looks identical to the energy drink, but a
running promotion explains the lift, so the correct answer is to do nothing. The agent does nothing.

### The rest of the workspace

Every decision leaves an inspectable trail, and the same primitives the agent uses for a single
decision also sweep the whole portfolio looking for work nobody asked about.

![Tour of the reasoning trace, approvals queue, purchase orders, inventory, opportunity sweep, evaluation suite and streaming chat](docs/media/demo-workspace-tour.gif)

| | |
|---|---|
| ![Reasoning trace grouped by phase](docs/media/run-trace.png) | **Reasoning trace.** One run, grouped by the six phases, every tool call and its arguments inspectable. This is the audit record — not a log of what the agent said, but of what it read and wrote. |
| ![Opportunity sweep listing findings across the portfolio](docs/media/opportunity-sweep.png) | **Opportunity sweep.** Read-only. Six detectors over replenishment, open-PO hygiene, supplier reliability, forecast anomalies, safety stock and excess stock. Each finding hands off to the agent as a real situation. |
| ![Purchase orders with a partially confirmed line](docs/media/purchase-orders.png) | **Purchase orders.** Including partially-confirmed lines, so a short-shipment is visible as a fact about the world rather than only as a drift report. |
| ![Workspace overview with stock cover, budget and space headroom](docs/media/workspace.png) | **Overview.** Stock cover, budget and space headroom per location, and recent agent activity. |

---

## Architecture

```mermaid
flowchart TB
    subgraph UI["Web UI · Next.js App Router + React 19"]
        direction LR
        U1["Dashboard"]
        U2["Scenarios"]
        U3["Opportunities"]
        U4["Reasoning trace"]
        U5["Approvals"]
        U6["Purchase orders"]
        U7["Evaluation"]
    end

    subgraph API["REST API · Next.js route handlers"]
        direction LR
        A1["/api/agent/run"]
        A2["/api/approvals/:id"]
        A3["/api/opportunities"]
        A4["/api/evaluation"]
    end

    subgraph ORCH["Orchestrator · six-phase state machine"]
        direction LR
        P1["Triage"] --> P2["Investigate"] --> P3["Decide"]
        P3 --> P4["Pre-validate"] --> P5["Act"] --> P6["Post-validate"]
        P6 -.->|material drift| P7["Remediate<br/>max 2 attempts"]
        P7 -.->|exhausted| P8["Escalate"]
    end

    subgraph BRAINS["Decision layer"]
        direction LR
        B1["LLM provider<br/>Gemini · Groq · OpenAI · Anthropic<br/><i>optional</i>"]
        B2["Policy engine<br/><i>deterministic ground truth</i>"]
        B3["Constraint engine<br/>hard + soft · maxFeasibleQty"]
        B4["Autonomy gate<br/>auto / approve / escalate"]
    end

    TOOLS["Tool layer · 21 Zod-typed tools<br/>15 read · 6 write, gated and re-validating"]

    subgraph DATA["State"]
        direction LR
        D1[("SQLite · 18 tables")]
        D2["Mock supplier gateway<br/><i>with fault injection</i>"]
        D3[("Audit log<br/>every mutation + run id")]
    end

    SWEEP["Opportunity sweep<br/><i>read-only portfolio scan</i>"]

    UI --> API --> ORCH
    ORCH --> BRAINS
    BRAINS --> TOOLS
    TOOLS --> DATA
    A3 --> SWEEP
    SWEEP --> D1
    SWEEP -.->|hand a finding to the agent| A1

    style ORCH fill:#eef2ff,stroke:#6c6c9e
    style BRAINS fill:#f5f3ff,stroke:#8b7fc7
    style DATA fill:#f0fdf4,stroke:#317562
    style SWEEP fill:#fff7ed,stroke:#c2762a
```

**The decision path for a single run:**

```mermaid
sequenceDiagram
    participant B as Buyer
    participant O as Orchestrator
    participant L as LLM
    participant P as Policy engine
    participant C as Constraint engine
    participant DB as SQLite
    participant S as Supplier gateway

    B->>O: situation (e.g. "buy 800 units")
    O->>DB: read inventory, demand, POs, terms, budget, space
    O->>L: investigate with read-only tools
    L-->>O: proposal + rationale
    O->>P: compute the answer independently
    P-->>O: ground-truth quantity
    Note over O: reconcile — hard breach or >15% divergence<br/>means the policy engine wins and<br/>confidence is capped
    O->>C: pre-validate the reconciled action
    C-->>O: pass / fail + maxFeasibleQty + binding constraint
    O->>O: autonomy gate
    alt exceeds autonomy band
        O-->>B: park for approval
        B->>O: approve
    end
    O->>S: submit order
    S-->>O: "accepted" (may silently cap quantity)
    O->>DB: re-read independently — NOT the gateway's reply
    DB-->>O: actual confirmed quantity
    Note over O: drift classified: none / benign / material / critical
    alt material drift
        O->>P: re-plan from current state
        O->>S: corrective order, different supplier
        O->>DB: verify again
    end
    O-->>B: outcome + full replayable trace
```

A fuller write-up, including the data model and the reasoning behind each design choice, is in
[`docs/architecture.md`](docs/architecture.md).

---

## Approach

### The agent does not do arithmetic

Every number in a decision comes from a tool that runs real code against real data —
`compute_net_requirement`, `detect_demand_shift`, `shape_order_quantity`, `validate_purchase`.
The model chooses *which* questions to ask and explains the answer; it never calculates. That
removes an entire class of hallucinated figures and makes every number in the final rationale
reproducible and auditable.

### Two brains, and the deterministic one wins

A **policy engine** computes the correct answer directly from the data, with no model involved.
It serves three purposes at once:

1. **Fallback** — the whole system runs end-to-end with no API key.
2. **Guardrail** — the model proposes; the policy engine and constraint engine dispose. The
   engine's arithmetic always wins; what the divergence between the two decides is how much
   confidence survives, and therefore whether a human is brought in.
3. **Oracle** — the evaluation harness asserts model behaviour against it.

This is the core reliability argument. The model's upside is judgement and explanation; its
downside is bounded by code that cannot be talked out of a constraint.

Reconciliation is graded, because not all disagreements mean the same thing:

| Divergence | Treatment | Why |
|---|---|---|
| Different **decision** — model says REJECT, engine says ACCEPT | Confidence cut to 0.65 → buyer adjudicates | Two independent assessors reaching different courses of action is the strongest uncertainty signal available |
| Model's quantity **breaches a hard constraint** | Engine's legal quantity used, confidence cut to 0.65 | The order is corrected automatically, but a human should see that the reasoning wanted something illegal |
| Same decision, quantity **>35% apart** | Engine's quantity used, confidence cut to 0.65 | Too far apart to call it a rounding difference |
| Same decision, quantity **15–35% apart** | Engine's quantity used, confidence shaded ×0.9 (floor 0.75) | Both are constraint-legal and agree on supplier and action; this is buffer judgement, not conflict |
| Within **15%** | Engine's arithmetic, model's narrative | Agreement — corroboration, not conflict |

The ordering matters, and getting it wrong is easy. An earlier version tested quantity first, so a
model that disagreed about *what to do* kept full confidence and executed unattended, while a model
that merely wanted a bigger buffer was cut to 0.65 and sent to a human — exactly backwards. Testing
the decision kind first, and grading the quantity response instead of using a single cliff, puts
the severity of the response in proportion to the severity of the disagreement.

### Recommendations are claims, not instructions

Scenario 1 hands the agent a recommendation for 800 units. The agent recomputes requirement from
scratch:

```
protection horizon   = lead time 7d + review period 14d      = 21 days
demand over horizon  = 28/day × 21d                          = 588 units
requirement          = 588 + 180 safety stock                = 768 units
supply               = 320 on hand + 150 in transit − 40 reserved = 430 units
net requirement      = 768 − 430                             = 338 units
→ rounded up to the supplier's 50-unit lot                   = 350 units
```

The recommendation overstates requirement by 56%, largely because it ignores 150 units already in
transit. The agent modifies it to 350 — and because a 56% cut exceeds its autonomy band, it routes
the change to a buyer rather than applying it silently.

A control case (`S1-correct-recommendation`) hands it a recommendation that *is* right. The agent
accepts and executes it autonomously. An agent that always finds something wrong is as useless as
one that rubber-stamps.

### A spike is not automatically a demand shift

Before concluding demand has changed, four evidence gates must all pass:

| Gate | Test |
|---|---|
| Magnitude | trailing 7-day mean ≥ 1.5× the forecast baseline |
| Sustainment | ≥ 5 consecutive days above 1.2× baseline |
| Significance | z-score of the recent mean ≥ 2.0 vs the prior period |
| Attribution | not explained by an active promotion |

The energy drink clears all four (2.8×, 7 days, z≈30, no promo) → re-plan.
The yogurt clears the first three but fails the fourth — a 2-for-1 promotion with a +60% expected
uplift explains the observed +61% — → do nothing, and explicitly **refuse** to rebase the forecast.
`update_forecast_baseline` enforces this at the tool boundary: it rejects any rebase attempt on
promotion-driven demand even if the orchestrator asks for one.

### A gap is not automatically worth closing

A positive net requirement is not the same thing as a purchase worth making. Supplier MOQ and lot
size mean the smallest orderable quantity can be many times the actual need, so an agent that
mechanically fills every gap greater than zero will buy 100 units to cover 3.

That is not hypothetical — it is what this system did until the `S2-shortfall-absorbed` case was
written. A supplier confirming 480 of 500 units leaves a residual requirement of 3 units, about two
hours of demand. The cheapest alternate source will not sell fewer than 100 units, so closing the
gap meant a $952 order at a 12% premium, with an expedite surcharge on top, to protect $25.50 of
exposure. Every individual step was correct; the conclusion was absurd.

So the agent now weighs materiality before sourcing. A residual gap smaller than
`immaterial_gap_days` (one day of demand) is absorbed and picked up on the normal replenishment
cycle, and the agent says so with the arithmetic attached:

> The residual gap of 3 units is 0.09 days of demand — below the 1-day materiality threshold.
> Covering it would mean a 100-unit minimum order costing $952.00 to protect $25.50 of exposure, so
> the gap is absorbed and picked up on the normal replenishment cycle.

The threshold is a policy row, not a constant, so it is tunable per deployment rather than compiled
into judgement.

### Constraints are the interesting part

Hard constraints block execution: budget, storage capacity, supplier MOQ, lot size, per-order caps,
supplier active, supplier carries the product. Soft constraints do not block but lower confidence
and force human review: overstock, shelf life, supplier reliability, lead time vs projected stockout.

Every failed hard check reports `maxFeasibleQty` — the largest quantity that *would* pass. That is
what lets the agent answer a blocked purchase with a workable counter-proposal instead of giving up.

In Scenario 4, Cartagena needs 1,700 units of bottled water. Storage binds first (3 slots per unit,
1,000 units of room) before budget does. The agent orders the largest lot-aligned quantity that
fits, names the binding constraint, and proposes redirecting the 700-unit balance to a node with
spare capacity.

### When human approval is appropriate

Thresholds live in the `agent_policies` table, not in code, so a buyer can tune the agent's leash
without a deploy:

| Policy | Default | Why |
|---|---|---|
| `max_auto_order_value` | $5,000 | Caps blast radius of any single mistake |
| `max_auto_qty_deviation_pct` | 25% | Large departures from the recommendation need a human |
| `max_auto_price_premium_pct` | 10% | Paying materially over the cheapest source is a commercial call |
| `min_auto_confidence` | 0.70 | Thin or conflicting evidence routes to a person |
| `max_remediation_attempts` | 2 | Bounded self-correction; then escalate rather than thrash |

Any soft-constraint warning, or sourcing from a non-preferred supplier, also forces approval.

Approving is not a rubber stamp in this system: it resumes the parked action, executes it, verifies
the result against the agent's original expectation, and self-corrects if the supplier does
something unexpected.

### A parked decision has to survive the buyer closing the tab

An approval queue is only real if it outlives the page that created it. A run therefore owns its
state on the server, not in the browser: `agent_runs.result_json` stores the decision payload the UI
renders, so reloading `/scenarios` re-attaches the last run for each situation — including one still
waiting on a human, with its approve and reject actions intact.

Two details matter more than the storage itself:

- **The payload is written before the status changes.** `saveRunResult` runs ahead of `finishRun`, so
  anything watching for a run to leave `running` is guaranteed to find the result already there.
  Reversed, a watcher can catch the gap and report a finished run as empty.
- **A reload during a run rejoins it instead of abandoning it.** The agent keeps working regardless of
  who is watching, so if the page loads while a run is in flight it says so, disables re-running, and
  polls until the result lands. Previously that work completed invisibly and the buyer saw a blank
  panel — the run had succeeded and the only copy of its result had been thrown away.

Because every run commits real changes to stock, budget and orders, the scenario page also carries a
**Reset workspace** control. Without it, re-running a scenario silently answers a different question
than it did the first time — the second pass sees the inventory the first pass bought.

---

## The feedback loop

This is the part the assignment flags as most interesting, so it is worth being precise about.

**Before acting**, the agent writes an explicit, checkable **expectation contract**:

> Creating a purchase order with SUP-03 for 1,500 units of PRD-1003 at NODE-BOG-01. Expect: order
> confirmed in full, total cost at most $8,751.60, inbound stock up by 1,500, projected cover of
> ~22 days, budget not overdrawn.

**After acting**, it re-reads the world **from the database, not from the write tool's return
value**, and checks every field.

That distinction is the whole point. A write tool reporting success tells you the call succeeded,
not that the outcome was what you wanted. In this system `SUP-03` confirms only 400 units against
any order larger than that, and says so politely in a message field. The only way to find out is to
look.

Drift is then classified, and the classification decides what happens next:

| Severity | Meaning | Response |
|---|---|---|
| `none` | Outcome matched on every dimension | Done |
| `benign` | Differs, but the objective still holds — e.g. a shortfall that leaves no outstanding requirement | Record and continue |
| `material` | Objective not met — e.g. a real gap remains | Self-correct, up to 2 attempts |
| `critical` | Invariant broken — PO missing, budget overdrawn, storage oversubscribed | Stop and escalate; no further writes |

Severity is derived, not assumed. A 1,100-unit shortfall is only *material* if re-running the
requirement maths against the actual stock position still shows a gap. If stock turns out to be
adequate anyway, the same shortfall is *benign* and the agent correctly does nothing further.

Remediation re-plans from current state rather than trusting the reported shortfall, and prefers a
*different* supplier — the one that just under-delivered has demonstrated it cannot serve the
volume. Attempts are bounded; exhausting them escalates with full context rather than retrying
indefinitely.

**Amendments go through the same loop as purchases.** The assignment asks for the result of a
create *or modify* to be validated, and modification is the easier half to overlook: an amendment
has no supplier to choose and usually *releases* budget rather than consuming it, so it is tempting
to treat it as bookkeeping. It is not. `validateAmendment` runs before the write — the order must
exist, still be in an amendable state, carry the line in question, and, if the quantity goes *up*,
the increase must clear budget and storage, because an upward amendment is a purchase of the delta
in all but name. Afterwards the order is re-read and compared against its contract exactly as a new
purchase is, and a mismatch escalates rather than passing quietly. `S2-shortfall-absorbed` is the
case that holds this honest: it is the only one whose primary action is an amendment, and it
asserts that both the pre-flight check and the independent re-read actually happened.

**Safety invariants** are asserted after every evaluation case, not just the ones that test drift:
no node budget may go negative, and no node storage may be oversubscribed. These hold across all
nine cases, in both reasoning modes.

---

## Evaluation

```bash
npm run eval          # deterministic — no API key required
npm run eval:llm      # with LLM reasoning, if a key is configured
```

Also runnable from the **Evaluation** page in the UI.

Each case runs against a **freshly rebuilt database**, so cases are independent and reproducible.
Assertions are checked against three sources:

- the **run result** — what the agent decided;
- the **recorded trace** — which tools it actually called, and whether it validated;
- the **database** — what the world looks like afterwards.

The third matters most. An agent can claim anything; the honest test is the state of the world.

The assignment's six evaluation questions map to concrete assertions:

| Question | Assertions |
|---|---|
| Was the decision correct? | `decision`, `quantity`, `supplier` |
| Did it obtain the necessary information? | `evidence gathered` — required tools appear in the trace |
| Did it respect relevant constraints? | `constraints respected`, `soft warnings surfaced` |
| Did it take the appropriate action? | `autonomy routing`, `final status` |
| Did it validate the result? | `pre-flight validation`, `post-execution validation` |
| What happens when the action fails? | `drift classification`, `self-correction` |

### Cases

| # | Case | What it protects |
|---|---|---|
| 1 | `S1-over-recommendation` | Catches a 56% over-recommendation; routes a large change to a human |
| 2 | `S1-correct-recommendation` | Agrees when the recommendation is right, executes it and verifies it |
| 3 | `S2-supplier-shortfall` | Re-sources a gap from a dearer, less reliable alternate — and flags both facts |
| 4 | `S2-shortfall-absorbed` | Negative control: absorbs a 3-unit gap instead of paying $952 to close it |
| 5 | `S3-real-demand-shift` | Full loop: detect → approve → supplier short-ships → drift → self-correct |
| 6 | `S3-promo-explained-spike` | Negative control: refuses to over-buy into a promotion |
| 7 | `S4-storage-constrained` | Identifies the binding constraint and works around it |
| 8 | `S4-forced-onto-worse-supplier` | Never emits an order that breaches a hard constraint |
| 9 | `S4-no-feasible-quantity` | Stops, returns zero and escalates when *no* quantity is executable |

Current result: **9/9 cases, 78/78 assertions**, deterministically.

Cases 2, 4 and 6 are deliberately negative controls. Without them, an agent that always found a
problem and always bought something would score perfectly — which would tell you nothing. Case 4 is
the sharpest of the three: the supplier *is* short, so a positive requirement exists and the obvious
move is to re-source it. But the gap is 3 units — two hours of demand — and the cheapest alternate
will not sell fewer than 100 units, so closing it costs $952 at a 12% premium to protect $25.50 of
exposure. An agent that passes case 3 by re-sourcing every shortfall fails case 4 and loses money
every week it runs.

Case 9 exists because case 8 does not actually prove escalation: its situation still has a workable
answer, so it accepts either resizing or escalating. Case 9 squeezes Cartagena to 600 free slots,
where bottled water at 3 slots a unit and a 500-unit supplier minimum make the smallest legal order
need 1,500 slots — nothing is executable at all. It asserts the agent returns zero, escalates, and
names the binding limit, which is what makes the escalation path real rather than nominal.

### Running the suite through a real model

```bash
npm run eval:llm
```

The same nine cases, with every decision made by the model instead of the policy engine. Measured on
the Claude Code bridge (`haiku`), three consecutive passes, then a confirmation pass after the one
assertion discussed below was opened up:

| | Pass 1 | Pass 2 | Pass 3 | After widening |
|---|---|---|---|---|
| Cases | 8/9 | 8/9 | 8/9 | **9/9** |
| Checks | 75/77 | 75/77 | 75/77 | **79/79** |

The first three passes are worth recording rather than hiding, because the failure was informative
rather than flaky: **the same case failed all three times, on the same two assertions, at exactly
the same confidence.** `S2-shortfall-absorbed` — the case where the supplier confirms 480 of 500 and
the engine judges the 3-unit residual too small to buy against — reached `ACCEPT 480` every time,
which is the correct decision and the correct quantity, but landed on 65% confidence and was held
for a human instead of executing itself. 65% is exactly `CONTESTED_CONFIDENCE`: the model disagreed
with the engine about whether a non-zero gap is worth closing, reconciliation detected the
disagreement, and the run was parked. That is the mechanism doing its job, not breaking.

So it is worth being explicit about what varies and what does not. **Decision correctness, quantity,
constraint satisfaction and the safety invariants are asserted identically in both modes** and hold
in both. What legitimately moves is *routing*: the policy engine's confidence is computed and
therefore fixed, whereas a model reports its own confidence and sometimes argues for a different
answer, and the reconciler then lowers confidence and sends the decision to a buyer. Routing a
correct decision to a human is conservative rather than wrong, so the two control cases accept
either route and the harness approves the parked action to confirm the purchase still lands and
still post-validates. Pinning those assertions to `auto_execute` would have made a safe outcome look
like a regression — and would have quietly pressured the system towards executing things it was
unsure about, which is the opposite of what this assignment is testing.

(Check totals differ slightly by mode and path — 78 deterministic, 77 or 79 under the model —
because a handful of assertions only apply once an action has actually executed, and an approved run
reaches that point by a different route than an auto-executed one.)

---

## Scenario coverage

| Scenario | Status | Outcome |
|---|---|---|
| **1 — Recommendation review** | Complete | MODIFY 800 → 350; separate case ACCEPTs a correct recommendation |
| **2 — Supplier cannot fulfil** | Complete | SPLIT_SOURCE: amend to 250, expedite 250 from an alternate, flag the 12% premium |
| **3 — Demand changed** | Complete | EXPEDITE 1,500 + full drift/remediation loop; promo case correctly NO_ACTION |
| **4 — Purchasing constraint** | Complete | MODIFY to the storage-feasible 1,000, redirect the balance to another node |

---

## Beyond the four scenarios — the opportunity sweep

The four scenarios are all **reactive**: something lands on the buyer's desk and the agent responds.
The larger part of a real buyer's day is noticing the things nobody flagged.

`src/lib/domain/opportunities.ts` sweeps the whole portfolio and surfaces six classes of problem —
covering most of the optional list in the brief:

| Finding | What it catches | Assignment topic |
|---|---|---|
| **Replenishment** | Lines with a net requirement nobody has raised an order for, ranked by whether stock runs out before a replenishment could land | replenishment |
| **Open purchase orders** | Unactioned supplier messages, confirmed-short lines, and overdue deliveries still counted as inbound cover | open purchase orders |
| **Supplier reliability** | Realised fill rate computed from the order book, compared against the score planning actually uses | supplier reliability |
| **Forecast anomalies** | Baselines that have drifted from reality — in both directions — separating promotion-explained lift from genuine change | forecast anomalies, promotional buying |
| **Safety stock** | Buffers set from a round number, re-derived from demand and lead-time variability at a ~95% service level | safety stock |
| **Overstock & spoilage** | Cover beyond the policy threshold, and quantities that will expire before they sell | excess stock |
| — | Alternate sourcing is in the core rather than the sweep: every decision ranks qualified suppliers on landed cost, lead time and reliability, and Scenario 2 switches to one | alternate suppliers |

Three properties make this more than a second dashboard:

**It reuses the agent's own primitives.** `computeNetRequirement`, `detectDemandShift`,
`spoilageRisk`, `listSupplierOptions` — the same functions, so a finding is computed exactly the way
the agent would compute it. The visible consequence is that the sweep **independently rediscovers
the assignment scenarios from raw data**: the 338-unit requirement behind Scenario 1, the
unexplained demand change behind Scenario 3, the promotion that explains the one which looks
identical, and the unactioned supplier message behind Scenario 2. None of them are hand-fed.

**It hands findings back to the agent.** Each finding carries an agent-ready payload, so "Run
review" on the Opportunities page sends it through the full pipeline — investigation, constraint
checks, autonomy gate, execution, post-execution validation. Detection feeds decision.

**It is strictly read-only.** Detection and action are kept apart deliberately. A sweep that quietly
placed orders across the whole catalogue is precisely the unbounded autonomy the rest of the system
exists to prevent.

It also surfaces something the static seed cannot: **supplier reliability findings only appear after
the agent has acted.** Once SUP-03 short-ships against a live order, its realised fill rate (48%)
diverges from the score planning uses (79%), and the sweep flags it. The system's view of its
suppliers is updated by its own experience.

---

## Mock services and data

Everything needed to run the application is in the repository. There are no external dependencies
and no accounts to create.

| Component | What it is | Where |
|---|---|---|
| **Database** | SQLite, 18 tables, created on demand. No server to install. | `src/lib/db/schema.sql` |
| **Dataset** | 3 fulfilment nodes, 5 products, 7 suppliers, 35 days of demand history, 3 open POs, 1 live supplier event, 1 active promotion, budgets and storage limits | `src/lib/db/seed.ts` |
| **Supplier gateway** | Mock external system the agent submits orders to. Deliberately imperfect — SUP-03 silently caps any order at 400 units, SUP-05 refuses expedites it cannot service. | `src/lib/mock/supplier-gateway.ts` |
| **Supplier inbox** | Inbound events (partial fulfilment, delay, cancellation). New ones can be injected at `POST /api/supplier-events` to create fresh situations. | `src/app/api/supplier-events/route.ts` |
| **LLM providers** | Gemini, Groq, OpenAI and Anthropic over plain `fetch`, plus a bridge to a locally authenticated Claude Code CLI that needs no key. Verify with `npm run check:llm`. | `src/lib/agent/llm.ts` |

What is mocked and what is real is worth being precise about, because the distinction is the whole
point of the exercise. The **outside world** is mocked — suppliers, their inbox, the database.
The assignment explicitly permits this ("Mock APIs, databases, and data are completely
acceptable"), and mocking it is what makes the supplier able to short-ship on demand so the
feedback loop has something to catch. The **agent** is not mocked: the reasoning, the 21 tools, the
constraint arithmetic, the autonomy gate, the post-action re-read and the self-correction all
execute for real against real state, and the evaluation suite runs end-to-end through a real model
as well as deterministically. Nothing in the decision path is scripted or replayed.

Demand history is generated from a seeded PRNG, so every number — and therefore every assertion —
is identical on every machine.

The seed is tuned so that **the obvious answer is wrong in each scenario**. That is the point: an
agent evaluated against data where the naive answer happens to be correct tells you nothing.

---

## Tools

21 tools, each with a Zod schema that is validated on every call and converted to JSON Schema for
LLM function calling.

**Read (15)** — `get_inventory`, `get_demand_history`, `get_forecast`, `get_open_purchase_orders`,
`get_purchase_order`, `list_supplier_options`, `get_budget`, `get_storage_capacity`,
`get_active_promotions`, `compute_net_requirement`, `detect_demand_shift`, `shape_order_quantity`,
`validate_purchase`, `check_supplier_availability`, `find_node_with_capacity`

**Write (6)** — `create_purchase_order`, `amend_purchase_order`, `cancel_purchase_order`,
`update_forecast_baseline`, `request_human_approval`, `escalate_to_buyer`

The model only ever gets the read tools. Writes are performed by the orchestrator after the
autonomy gate, and each write tool independently re-validates against the constraint engine at its
own boundary — so a write that would breach a hard constraint is refused even if every layer above
it was wrong.

---

## Data model

18 tables in SQLite. The ones that carry the interesting logic:

- `supplier_products` — MOQ, lot size, per-order cap, expedite terms. Where hard constraints live.
- `inventory` — on hand / reserved / in transit / safety stock, separated so "available to promise"
  is computable rather than guessed.
- `promotions` — what makes a demand spike explicable.
- `agent_policies` — autonomy thresholds, tunable without a deploy.
- `agent_runs` + `agent_steps` — the full replayable trace.
- `validations` — pre- and post-execution constraint results.
- `audit_log` — every mutation, with before/after state and the run that caused it.

Seed data is deliberately tuned so the obvious answer is wrong in each scenario. Demand history is
generated from a seeded PRNG, so every number — and therefore every assertion — is stable.

---

## Project layout

```
src/
  lib/
    db/          schema.sql · client · repo · seed
    domain/      types · math · constraints · policy · autonomy
    agent/       orchestrator · tools · feedback · llm · prompt
    mock/        supplier-gateway (with fault injection)
  app/           pages + API routes
  components/    shared UI
eval/            cases · runner
scripts/         reset-db · run-eval
docs/            architecture.md
```

---

## Technology

Next.js 16 (App Router) · React 19 · TypeScript (strict) · SQLite via better-sqlite3 · Zod ·
Tailwind CSS. LLM access is written against plain `fetch` rather than four vendor SDKs, which keeps
the dependency surface small and the request shapes visible.

Five reasoning backends sit behind one `LlmProvider` interface — Gemini, Groq, OpenAI, Anthropic,
and a bridge to a locally authenticated Claude Code CLI. The bridge exists because the most common
reason an assignment like this cannot be run by a reviewer is a missing API key: if you have Claude
Code installed, real model reasoning works with zero configuration. The CLI has no tool-calling
API, so the bridge renders the tool catalogue and the conversation into a prompt and parses a JSON
tool call back out of the reply, returning the same `LlmResponse` shape as the HTTP providers — the
orchestrator cannot tell which backend it is talking to. Claude Code's own tools and dynamic system
prompt are switched off, so it acts as a completion backend rather than as a second agent loose on
the filesystem.

---

## Known limitations

Worth stating plainly, since this was a one-day build:

- **Single-process concurrency.** SQLite in WAL mode with no row locking. Two agents running
  simultaneously against the same node's budget could race. A real deployment would need
  transactional reservation of budget and storage.
- **Safety stock is a fixed figure in the planning path.** The opportunity sweep *derives* it from
  demand and lead-time variability at a ~95% service level and flags lines that are mis-set, but
  the replenishment maths still uses the stored per-line number. Closing that loop — having the
  agent act on its own safety-stock findings — is the obvious next step.
- **Promotion attribution is a single heuristic.** It compares observed uplift against the
  promotion's expected uplift with a 1.25× tolerance. Real attribution would need a counterfactual
  baseline.
- **Seasonality is not modelled.** Of the optional buyer problems the assignment lists, seasonal
  demand is the one I did not attempt. The demand analysis is level-shift detection over a 35-day
  window, which cannot distinguish a genuine step change from the upswing of an annual cycle. Doing
  it honestly needs multi-year history the seed does not contain, and a decomposition into trend,
  season and residual so that the shift gates fire on the residual rather than the raw series. I
  would rather say that than present the overstock detector as seasonal reasoning.
- **Remediation prefers a different supplier unconditionally.** Sometimes the right move is to
  re-order from the same supplier next cycle rather than pay a premium elsewhere.
- **The LLM path is the thinner one.** Most of the engineering is in the deterministic engine and
  the feedback loop, which is where I think the real value sits — but it does mean the model's
  contribution is mostly narrative and investigation sequencing rather than decision-making.

---

## Where each submission requirement lives

| Requirement | Where |
|---|---|
| Complete source code | this repository — `src/`, `eval/`, `scripts/` |
| Setup and run instructions | [Quick start](#quick-start), above |
| Architecture diagram | [Architecture](#architecture) — three Mermaid diagrams, rendered inline by GitHub |
| Description of the approach | [Approach](#approach) and [`docs/architecture.md`](docs/architecture.md) |
| Test scenarios and evaluation approach | [Evaluation](#evaluation), `eval/cases.ts`, `npm run eval` |
| Mock APIs, datasets, supporting services | [Mock services and data](#mock-services-and-data) — all in-repo, nothing external |
| How agent decisions are validated | [The feedback loop](#the-feedback-loop) — pre-validation, expectation contracts, independent re-read, drift classification |
| Working demo | [`DEMO.md`](DEMO.md) — `npm run demo` for the terminal, `npm run dev` for the UI, with screenshots |
| `.env.example` | [`.env.example`](.env.example) — every variable documented, none required |
| No secrets committed | no keys in the tree or in history; `.env*` is gitignored |
| Additional buyer problems (optional) | [Beyond the four scenarios](#beyond-the-four-scenarios--the-opportunity-sweep) — six finding classes covering replenishment, open POs, supplier reliability, forecast anomalies, promotional buying and safety stock |

---

## Author

Built by **Soujanya Gupta** — [soujanyalab.in](https://soujanyalab.in) · [github.com/GuptaSoujanya](https://github.com/GuptaSoujanya)
