import type { ScenarioInput } from "../src/lib/agent/orchestrator";
import type { RunResult } from "../src/lib/agent/orchestrator";
import { consumeStorage, getNode, storageFreeSlots } from "../src/lib/db/repo";
import type { DecisionKind } from "../src/lib/domain/types";

/**
 * Evaluation cases.
 *
 * The assignment asks six questions of every agent decision. Each case answers
 * them as explicit, machine-checkable assertions rather than as prose:
 *
 *   1. Was the decision correct?              -> expectDecision / expectQty
 *   2. Did it obtain the necessary information? -> requiredEvidence (tools called)
 *   3. Did it respect relevant constraints?     -> constraintsRespected
 *   4. Did it take the appropriate action?      -> expectAction / expectAutonomy
 *   5. Did it validate the result?              -> expectPostValidation
 *   6. What happens when the action fails?      -> expectDrift / expectRemediation
 *
 * `why` states the buyer-level reasoning the case is protecting, so a failure
 * tells you what broke conceptually, not just which number moved.
 */

export type EvalAssertions = {
  /** Acceptable decisions. More than one where several are defensible. */
  expectDecision: DecisionKind[];
  /** Expected order quantity, with tolerance for lot rounding. */
  expectQty?: { value: number; tolerance?: number };
  /** Tool names the agent must have called during investigation. */
  requiredEvidence?: string[];
  /** Hard-constraint codes that must be satisfied in the pre-validation. */
  constraintsRespected?: string[];
  /** Soft-constraint codes the agent is expected to have flagged. */
  expectSoftWarnings?: string[];
  /** Expected autonomy routing. */
  expectAutonomy?: ("auto_execute" | "require_approval" | "escalate")[];
  /** Expected run status at the end. */
  expectStatus?: string[];
  /** Whether a post-execution validation must have been recorded. */
  expectPostValidation?: boolean;
  /** Expected drift classification after acting. */
  expectDrift?: ("none" | "benign" | "material" | "critical")[];
  /** Minimum number of successful self-correction orders. */
  expectRemediationCount?: { min: number };
  /** Supplier the agent should end up buying from. */
  expectSupplier?: string;
  /** Assertions on the world AFTER the run, not just on the decision. */
  expectWorldState?: {
    /** Total confirmed units of this product inbound to this node must be >= value. */
    minInboundUnits?: number;
    /** Budget available at the node must never go negative. */
    budgetNonNegative?: boolean;
    /** Storage free slots at the node must never go negative. */
    storageNonNegative?: boolean;
  };
  /** Free-text: what this case is really protecting. */
  why: string;
};

export type EvalCase = {
  id: string;
  title: string;
  scenario: string;
  /** Approve any parked action automatically, to exercise the execution path. */
  autoApprove?: boolean;
  /** Disable supplier fault injection for this case. */
  disableFaults?: boolean;
  /**
   * Narrow the world further after seeding, before the agent runs.
   *
   * Failure paths are the hardest thing to evaluate, because the seed is
   * deliberately tuned so every scenario has *some* workable answer. Tightening
   * a single node here exercises the genuinely-no-option branches without
   * recalibrating the shared dataset every other case asserts against.
   */
  setup?: () => void;
  input: ScenarioInput;
  assertions: EvalAssertions;
};

export const EVAL_CASES: EvalCase[] = [
  // =========================================================================
  {
    id: "S1-over-recommendation",
    title: "Rejects an inflated recommendation and resizes it",
    scenario: "Scenario 1 — Purchase Recommendation Review",
    input: {
      scenario: "recommendation_review",
      node_id: "NODE-BOG-01",
      product_id: "PRD-1001",
      recommended_qty: 800,
    },
    assertions: {
      expectDecision: ["MODIFY"],
      expectQty: { value: 350, tolerance: 0 },
      requiredEvidence: [
        "get_inventory", "get_forecast", "get_demand_history",
        "get_open_purchase_orders", "list_supplier_options",
        "get_budget", "get_storage_capacity",
      ],
      constraintsRespected: ["MOQ", "LOT_SIZE", "BUDGET", "STORAGE"],
      expectAutonomy: ["require_approval"],
      expectStatus: ["awaiting_approval"],
      why:
        "The 800-unit recommendation ignores 150 units already in transit and overstates the " +
        "protection horizon. True net requirement is 338, which rounds to 350 on a 50-unit lot. " +
        "The agent must catch this independently and, because a 56% cut exceeds its autonomy band, " +
        "route the change to a buyer rather than silently applying it.",
    },
  },

  // =========================================================================
  {
    id: "S1-correct-recommendation",
    title: "Accepts a recommendation that is actually right",
    scenario: "Scenario 1 — Purchase Recommendation Review",
    input: {
      scenario: "recommendation_review",
      node_id: "NODE-MED-02",
      product_id: "PRD-1005",
      recommended_qty: 500,
    },
    autoApprove: true,
    assertions: {
      expectDecision: ["ACCEPT"],
      expectQty: { value: 500, tolerance: 0 },
      constraintsRespected: ["MOQ", "LOT_SIZE", "BUDGET", "STORAGE"],
      expectAutonomy: ["auto_execute", "require_approval"],
      expectStatus: ["completed"],
      expectPostValidation: true,
      expectDrift: ["none"],
      expectWorldState: { minInboundUnits: 500, budgetNonNegative: true, storageNonNegative: true },
      why:
        "A control case. An agent biased toward always 'finding something wrong' is as useless as one " +
        "that rubber-stamps. Here the recommendation matches the computed requirement, every constraint " +
        "clears and no soft warnings fire, so the agent must agree: ACCEPT, at exactly 500, executed " +
        "and independently verified. Those are asserted strictly. The routing is deliberately not: the " +
        "deterministic engine is certain enough to execute unattended, whereas a real model sometimes " +
        "reports lower confidence or proposes a different buffer, and the reconciler then sends the " +
        "decision to a buyer. Routing to a human on a correct decision is conservative, not wrong, so " +
        "both routes are accepted and the harness approves the parked action to confirm the purchase " +
        "still lands and still post-validates. Pinning routing to auto_execute would have made this " +
        "case fail intermittently for being safe.",
    },
  },

  // =========================================================================
  {
    id: "S2-supplier-shortfall",
    title: "Re-sources a supplier shortfall from a costlier alternate",
    scenario: "Scenario 2 — Supplier Cannot Fulfil the Purchase",
    input: {
      scenario: "supplier_shortfall",
      po_id: "PO-2001",
      product_id: "PRD-1002",
      confirmed_qty: 250,
      event_id: "EVT-5001",
    },
    assertions: {
      expectDecision: ["SPLIT_SOURCE"],
      expectSupplier: "SUP-04",
      requiredEvidence: ["get_purchase_order", "get_inventory", "list_supplier_options", "get_budget"],
      expectSoftWarnings: ["RELIABILITY"],
      expectAutonomy: ["require_approval"],
      expectStatus: ["awaiting_approval"],
      why:
        "The shortfall only matters if it leaves a real gap, so the agent must recompute requirement " +
        "against the partial delivery first. It does leave a gap, so the balance is sourced from SUP-04 " +
        "— which is 12% dearer and below the reliability floor. Both facts must surface, and together " +
        "they must force human approval rather than a silent switch to a worse supplier.",
    },
  },

  // =========================================================================
  {
    id: "S2-shortfall-absorbed",
    title: "Absorbs a shortfall too small to be worth buying against",
    scenario: "Scenario 2 — Supplier Cannot Fulfil the Purchase (negative control)",
    autoApprove: true,
    input: {
      scenario: "supplier_shortfall",
      po_id: "PO-2001",
      product_id: "PRD-1002",
      confirmed_qty: 480,
    },
    assertions: {
      expectDecision: ["ACCEPT"],
      expectQty: { value: 480, tolerance: 0 },
      requiredEvidence: ["get_purchase_order", "get_inventory"],
      expectAutonomy: ["auto_execute", "require_approval"],
      expectStatus: ["completed"],
      expectWorldState: { budgetNonNegative: true, storageNonNegative: true },
      why:
        "The control for Scenario 2, and the counterpart to the re-sourcing case. The supplier is " +
        "20 units short, which leaves a residual requirement of just 3 units — about two hours of " +
        "demand. A positive gap is not the same as a gap worth buying against: the cheapest alternate " +
        "will not sell fewer than 100 units, so covering 3 units costs $952 at a 12% premium plus an " +
        "expedite surcharge, to protect $25.50 of exposure. The agent must recognise the gap as " +
        "immaterial, amend the order to the confirmed quantity and move on. An agent that re-sources " +
        "every non-zero shortfall passes the case above and still loses money every week. " +
        "Routing is the one assertion left open: this is the case a real model argues with most often " +
        "— it wants to close the 3-unit gap — so reconciliation drops confidence to the contested " +
        "floor and the run is held for a human. The decision and the amended quantity are still " +
        "asserted exactly, in both modes; only who signs it off may vary.",
    },
  },

  // =========================================================================
  {
    id: "S3-real-demand-shift",
    title: "Detects a genuine demand shift, then self-corrects when the supplier short-ships",
    scenario: "Scenario 3 — Demand / Forecast Has Changed  +  feedback loop",
    autoApprove: true,
    input: {
      scenario: "demand_shift",
      node_id: "NODE-BOG-01",
      product_id: "PRD-1003",
    },
    assertions: {
      expectDecision: ["EXPEDITE", "MODIFY"],
      requiredEvidence: ["detect_demand_shift", "get_demand_history", "get_active_promotions", "get_open_purchase_orders"],
      expectAutonomy: ["require_approval"],
      expectPostValidation: true,
      expectDrift: ["material"],
      expectRemediationCount: { min: 1 },
      expectStatus: ["completed"],
      expectWorldState: { minInboundUnits: 1500, budgetNonNegative: true, storageNonNegative: true },
      why:
        "This is the end-to-end case. Demand has tripled, which clears all four evidence gates, so a " +
        "re-plan is justified. The order exceeds the autonomy ceiling and is approved by a human. " +
        "The chosen supplier then silently confirms only 400 of 1,500 units. The agent must discover " +
        "that by re-reading the world rather than trusting the write's success response, classify it as " +
        "material drift, and place a corrective order with a different supplier — without being told to.",
    },
  },

  // =========================================================================
  {
    id: "S3-promo-explained-spike",
    title: "Refuses to over-buy into a promotional spike",
    scenario: "Scenario 3 — Demand / Forecast Has Changed (negative control)",
    input: {
      scenario: "demand_shift",
      node_id: "NODE-BOG-01",
      product_id: "PRD-1005",
    },
    assertions: {
      expectDecision: ["NO_ACTION"],
      expectQty: { value: 0, tolerance: 0 },
      requiredEvidence: ["detect_demand_shift", "get_active_promotions"],
      expectStatus: ["completed"],
      why:
        "Sales are up 1.6x and sustained for seven days — superficially identical to a real shift. " +
        "The difference is a running 2-for-1 promotion that fully explains the uplift, and stock already " +
        "covers the remaining promo days. The correct answer is to do nothing. This is the case that " +
        "separates an agent reasoning about cause from one pattern-matching on a number going up.",
    },
  },

  // =========================================================================
  {
    id: "S4-storage-constrained",
    title: "Works around a binding storage constraint instead of failing",
    scenario: "Scenario 4 — Purchasing Constraint",
    input: {
      scenario: "constrained_purchase",
      node_id: "NODE-CTG-03",
      product_id: "PRD-1004",
    },
    assertions: {
      expectDecision: ["MODIFY"],
      expectQty: { value: 1000, tolerance: 0 },
      requiredEvidence: ["get_storage_capacity", "get_budget", "list_supplier_options"],
      constraintsRespected: ["MOQ", "LOT_SIZE", "BUDGET", "STORAGE"],
      expectSoftWarnings: ["LEAD_TIME"],
      expectAutonomy: ["require_approval"],
      why:
        "Requirement is 1,700 units but Cartagena has room for 1,000 and the water is bulky at 3 slots " +
        "per unit. Storage binds before budget does. The agent must identify which constraint actually " +
        "binds, order the largest lot-aligned quantity that fits, and propose a destination for the " +
        "balance — rather than either forcing the full order through or abandoning the purchase.",
    },
  },

  // =========================================================================
  {
    id: "S4-forced-onto-worse-supplier",
    title: "Never emits an impossible order, even boxed in",
    scenario: "Scenario 4 — Purchasing Constraint (hard block)",
    input: {
      scenario: "constrained_purchase",
      node_id: "NODE-CTG-03",
      product_id: "PRD-1004",
      supplier_id: "SUP-04",
    },
    assertions: {
      expectDecision: ["MODIFY", "ESCALATE"],
      constraintsRespected: ["MOQ", "BUDGET", "STORAGE"],
      why:
        "Forced onto SUP-04, whose 400-unit MOQ and higher price interact badly with Cartagena's " +
        "$4,000 remaining budget and limited space. Either resizing or escalating is defensible here, " +
        "so the decision is deliberately not pinned — what this case protects is the floor beneath " +
        "both: an order that breaches a hard constraint is never emitted, and the agent says which " +
        "limit bound it rather than failing silently. The genuine no-option escalation is asserted " +
        "separately by S4-no-feasible-quantity, because this situation still has a workable answer.",
    },
  },

  // =========================================================================
  {
    id: "S4-no-feasible-quantity",
    title: "Escalates when no quantity at all is feasible",
    scenario: "Scenario 4 — Purchasing Constraint (no option)",
    setup: () => {
      // Bottled water is 3 slots per unit and the cheapest supplier's MOQ is
      // 500 units, so 600 free slots cannot accommodate any legal order: the
      // smallest one permitted needs 1,500. This is the only way to reach the
      // branch, since the shared seed deliberately leaves every scenario an out.
      const node = getNode("NODE-CTG-03")!;
      consumeStorage("NODE-CTG-03", storageFreeSlots(node) - 600);
    },
    input: {
      scenario: "constrained_purchase",
      node_id: "NODE-CTG-03",
      product_id: "PRD-1004",
    },
    assertions: {
      expectDecision: ["ESCALATE"],
      expectQty: { value: 0, tolerance: 0 },
      requiredEvidence: ["get_storage_capacity", "get_budget", "list_supplier_options"],
      expectAutonomy: ["escalate"],
      expectStatus: ["escalated"],
      expectWorldState: { budgetNonNegative: true, storageNonNegative: true },
      why:
        "Cartagena is squeezed to 600 free slots. Water needs 3 slots a unit and the cheapest " +
        "supplier will not sell fewer than 500, so the smallest legal order needs 1,500 slots and " +
        "no quantity whatsoever is executable. The agent must not shave the order down until it " +
        "fits — there is nothing to shave to — and must not invent a workaround. It must stop, " +
        "return zero, escalate to a human, and name the binding limit. This is the case that " +
        "proves the escalation path is real rather than nominal, and that a blocked agent fails " +
        "loudly instead of quietly writing something it should not.",
    },
  },
];
