import type { ScenarioInput } from "../src/lib/agent/orchestrator";
import type { RunResult } from "../src/lib/agent/orchestrator";
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
    assertions: {
      expectDecision: ["ACCEPT"],
      expectQty: { value: 500, tolerance: 0 },
      constraintsRespected: ["MOQ", "LOT_SIZE", "BUDGET", "STORAGE"],
      expectAutonomy: ["auto_execute"],
      expectStatus: ["completed"],
      expectPostValidation: true,
      expectDrift: ["none"],
      expectWorldState: { minInboundUnits: 500, budgetNonNegative: true, storageNonNegative: true },
      why:
        "A control case. An agent biased toward always 'finding something wrong' is as useless as one " +
        "that rubber-stamps. Here the recommendation matches the computed requirement, every constraint " +
        "clears and no soft warnings fire, so the agent should execute it autonomously and verify the result.",
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
    id: "S4-infeasible-escalates",
    title: "Escalates when no quantity is feasible",
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
        "$4,000 remaining budget and limited space. Whatever the agent decides, it must never propose " +
        "a quantity that breaches a hard constraint — the floor this case protects is that an " +
        "impossible order is never emitted, and that the agent says why rather than failing silently.",
    },
  },
];
