import {
  budgetAvailable,
  getBudget,
  getInventory,
  getNode,
  getPo,
  getProduct,
  listSupplierOptions,
  storageFreeSlots,
} from "../db/repo";
import { validatePurchase } from "../domain/constraints";
import { computeNetRequirement, daysOfCoverAfter, round2, shapeOrderQty } from "../domain/math";
import { REVIEW_PERIOD_DAYS } from "../domain/policy";
import type { DriftReport, DriftSeverity, Expectation, ProposedAction } from "../domain/types";

/**
 * The feedback loop.
 *
 * Executing an action is not the end of the job. Before acting, the agent
 * writes down an explicit, checkable *expectation* of the post-action world.
 * After acting, it re-reads that world **from the database rather than from the
 * action's own return value** and compares.
 *
 * Reading independently is the important part. A write tool that reports
 * success tells you the call succeeded, not that the outcome was what you
 * wanted. In this system a supplier can silently confirm 400 units against a
 * 1,500-unit order; the only way to find out is to look.
 *
 * Drift is then classified, and the classification decides what happens next:
 *
 *   none      -> done
 *   benign    -> record and continue (outcome differs but the goal still holds)
 *   material  -> self-correct: plan a remediating action and re-run the loop
 *   critical  -> stop and escalate; do not attempt further writes
 */

// ---------------------------------------------------------------------------
// Expectation contract
// ---------------------------------------------------------------------------

export function buildExpectation(args: {
  action: ProposedAction;
  nodeId: string;
  productId: string;
  dailyDemand: number;
  expectedQty: number;
  expectedUnitPrice: number;
}): Expectation {
  const { action, nodeId, productId, dailyDemand, expectedQty, expectedUnitPrice } = args;
  const inventory = getInventory(nodeId, productId);
  const budget = getBudget(nodeId);

  if (action.kind === "create_po") {
    const projectedCover = inventory
      ? daysOfCoverAfter({ inventory, incomingQty: expectedQty, dailyDemand })
      : 0;
    return {
      description:
        `Creating a purchase order with ${action.supplier_id} for ${expectedQty} units of ${productId} at ${nodeId}. ` +
        `Expect: order confirmed in full, total cost at most $${round2(expectedQty * expectedUnitPrice * 1.02)}, ` +
        `inbound stock up by ${expectedQty}, projected cover of ~${projectedCover} days, budget not overdrawn.`,
      poExists: { supplier_id: action.supplier_id, product_id: productId },
      expectedConfirmedQty: expectedQty,
      expectedStatus: ["confirmed"],
      // 2% tolerance absorbs rounding in surcharge arithmetic.
      expectedTotalCostMax: round2(expectedQty * expectedUnitPrice * 1.02),
      expectedBudgetCommittedMax: budget ? budget.total_budget : undefined,
      expectedInTransitMin: (inventory?.in_transit ?? 0) + expectedQty,
      expectedDaysOfCoverMin: Math.max(0, projectedCover - 1),
    };
  }

  if (action.kind === "amend_po") {
    return {
      description:
        `Amending ${action.po_id} to ${action.new_qty} units of ${productId}. ` +
        `Expect: the line reflects exactly ${action.new_qty}, and released budget and storage return to the pool.`,
      poExists: { po_id: action.po_id, supplier_id: "", product_id: productId },
      expectedConfirmedQty: action.new_qty,
      expectedStatus: action.new_qty === 0 ? ["cancelled"] : ["confirmed"],
    };
  }

  if (action.kind === "cancel_po") {
    return {
      description: `Cancelling ${action.po_id}. Expect: status cancelled and all committed budget and storage released.`,
      poExists: { po_id: action.po_id, supplier_id: "", product_id: productId },
      expectedConfirmedQty: 0,
      expectedStatus: ["cancelled"],
    };
  }

  return {
    description:
      action.kind === "no_action"
        ? `No write will occur. Expect the world to be unchanged: ${action.reason}`
        : `Escalating to a buyer. Expect an open approval item and no change to purchase orders.`,
  };
}

// ---------------------------------------------------------------------------
// Verification — re-read the world, compare against the contract
// ---------------------------------------------------------------------------

export function verifyExpectation(args: {
  expectation: Expectation;
  poId: string | null;
  nodeId: string;
  productId: string;
  dailyDemand: number;
}): DriftReport {
  const { expectation, poId, nodeId, productId, dailyDemand } = args;
  const findings: DriftReport["findings"] = [];

  // Nothing to verify for pure no-action outcomes.
  if (!expectation.expectedConfirmedQty && !expectation.poExists) {
    return { severity: "none", findings: [], summary: "No operational change was expected; none observed." };
  }

  if (!poId) {
    return {
      severity: "critical",
      findings: [{
        field: "purchase_order", expected: "created", actual: "missing",
        severity: "critical", note: "The action reported no purchase order identifier; nothing can be verified.",
      }],
      summary: "No purchase order was produced — the action did not take effect.",
    };
  }

  // Independent re-read. Deliberately not the write tool's return value.
  const po = getPo(poId);
  if (!po) {
    return {
      severity: "critical",
      findings: [{
        field: "purchase_order", expected: poId, actual: "not found",
        severity: "critical", note: "Purchase order is absent from the database after execution.",
      }],
      summary: `Purchase order ${poId} does not exist after the write reported success.`,
    };
  }

  const line = po.lines.find((l) => l.product_id === productId);
  const actualQty = line ? (line.qty_confirmed > 0 ? line.qty_confirmed : line.qty_ordered) : 0;

  // --- Quantity ----------------------------------------------------------
  if (expectation.expectedConfirmedQty !== undefined) {
    const expected = expectation.expectedConfirmedQty;
    if (actualQty !== expected) {
      const delta = actualQty - expected;
      // Is the shortfall actually harmful? Re-run the requirement maths with
      // what we really got. A shortfall that still covers demand is benign.
      const inventory = getInventory(nodeId, productId);
      let severity: DriftSeverity = "material";
      let note = `Supplier confirmed ${actualQty} against ${expected} requested (${delta > 0 ? "+" : ""}${delta}).`;

      if (inventory && delta < 0) {
        const remaining = computeNetRequirement({
          inventory,
          dailyDemand,
          leadTimeDays: 7,
          reviewPeriodDays: REVIEW_PERIOD_DAYS,
        });
        if (remaining.netRequirement === 0) {
          severity = "benign";
          note += " Remaining requirement is nonetheless zero — stock position is still adequate, so no corrective order is needed.";
        } else {
          note += ` A gap of ${remaining.netRequirement} units remains against the protection horizon; corrective sourcing required.`;
        }
      } else if (delta > 0) {
        severity = "benign";
        note += " Over-delivery against request; no corrective action, but worth flagging.";
      }

      findings.push({ field: "confirmed_qty", expected, actual: actualQty, delta, severity, note });
    } else {
      findings.push({
        field: "confirmed_qty", expected, actual: actualQty, delta: 0, severity: "none",
        note: "Quantity confirmed exactly as intended.",
      });
    }
  }

  // --- Status ------------------------------------------------------------
  if (expectation.expectedStatus?.length) {
    const matches = expectation.expectedStatus.includes(po.status);
    findings.push({
      field: "status",
      expected: expectation.expectedStatus.join(" | "),
      actual: po.status,
      severity: matches ? "none" : po.status === "cancelled" ? "critical" : "material",
      note: matches
        ? `Order status is "${po.status}" as expected.`
        : `Order status is "${po.status}", not the expected "${expectation.expectedStatus.join(" | ")}".`,
    });
  }

  // --- Cost --------------------------------------------------------------
  if (expectation.expectedTotalCostMax !== undefined) {
    const within = po.total_cost <= expectation.expectedTotalCostMax;
    findings.push({
      field: "total_cost",
      expected: `<= ${expectation.expectedTotalCostMax}`,
      actual: round2(po.total_cost),
      severity: within ? "none" : "material",
      note: within
        ? `Committed $${po.total_cost.toFixed(2)}, within the $${expectation.expectedTotalCostMax.toFixed(2)} ceiling.`
        : `Committed $${po.total_cost.toFixed(2)}, exceeding the $${expectation.expectedTotalCostMax.toFixed(2)} ceiling.`,
    });
  }

  // --- Budget integrity --------------------------------------------------
  const budget = getBudget(nodeId);
  if (budget) {
    const available = budgetAvailable(budget);
    findings.push({
      field: "budget_available",
      expected: ">= 0", actual: round2(available),
      severity: available < 0 ? "critical" : "none",
      note: available < 0
        ? `Budget overdrawn by $${Math.abs(available).toFixed(2)} — this must not happen.`
        : `$${available.toFixed(2)} of budget remains.`,
    });
  }

  // --- Storage integrity -------------------------------------------------
  const node = getNode(nodeId);
  if (node) {
    const free = storageFreeSlots(node);
    findings.push({
      field: "storage_free_slots",
      expected: ">= 0", actual: Math.round(free),
      severity: free < 0 ? "critical" : "none",
      note: free < 0
        ? `Storage oversubscribed by ${Math.abs(free).toFixed(0)} slots.`
        : `${free.toFixed(0)} storage slots free.`,
    });
  }

  const severity = worstSeverity(findings.map((f) => f.severity));
  return {
    severity,
    findings,
    summary: summarise(severity, findings),
  };
}

function worstSeverity(list: DriftSeverity[]): DriftSeverity {
  const rank: Record<DriftSeverity, number> = { none: 0, benign: 1, material: 2, critical: 3 };
  return list.reduce<DriftSeverity>((worst, s) => (rank[s] > rank[worst] ? s : worst), "none");
}

function summarise(severity: DriftSeverity, findings: DriftReport["findings"]): string {
  if (severity === "none") return "Outcome matched the expectation on every checked dimension.";
  const notable = findings.filter((f) => f.severity !== "none");
  const lead = notable[0]?.note ?? "";
  switch (severity) {
    case "benign": return `Outcome differs from expectation but the objective still holds. ${lead}`;
    case "material": return `Material drift detected — corrective action required. ${lead}`;
    case "critical": return `Critical drift — halting and escalating. ${lead}`;
    default: return lead;
  }
}

// ---------------------------------------------------------------------------
// Remediation planning
// ---------------------------------------------------------------------------

export type RemediationPlan = {
  possible: boolean;
  action: ProposedAction | null;
  rationale: string;
  supplierId?: string;
  qty?: number;
  unitPrice?: number;
};

/**
 * Given material drift on a purchase, work out how to close the gap.
 *
 * Preference order: a *different* supplier (the one that just under-delivered
 * has demonstrated it cannot serve the volume), shortest lead time that still
 * beats the projected stockout, then lowest cost.
 */
export function planRemediation(args: {
  nodeId: string;
  productId: string;
  dailyDemand: number;
  failedSupplierId: string;
  shortfallQty: number;
  attempt: number;
  maxAttempts: number;
}): RemediationPlan {
  const { nodeId, productId, dailyDemand, failedSupplierId, shortfallQty, attempt, maxAttempts } = args;

  if (attempt > maxAttempts) {
    return {
      possible: false, action: null,
      rationale: `Exhausted ${maxAttempts} self-correction attempts; escalating rather than continuing to retry.`,
    };
  }

  const inventory = getInventory(nodeId, productId);
  const product = getProduct(productId);
  if (!inventory || !product) {
    return { possible: false, action: null, rationale: "Cannot re-plan: inventory or product record missing." };
  }

  // Re-derive the gap from current state rather than trusting the reported shortfall.
  const net = computeNetRequirement({
    inventory, dailyDemand, leadTimeDays: 7, reviewPeriodDays: REVIEW_PERIOD_DAYS,
  });
  const gap = Math.max(net.netRequirement, 0);

  if (gap === 0) {
    return {
      possible: false, action: null,
      rationale: `Re-checked the stock position: the ${shortfallQty}-unit shortfall leaves no outstanding requirement. No corrective order needed.`,
    };
  }

  const alternates = listSupplierOptions(productId).filter((o) => o.supplier_id !== failedSupplierId);
  if (!alternates.length) {
    return {
      possible: false, action: null,
      rationale: `No alternate supplier can cover the remaining ${gap} units; the original supplier has already short-shipped.`,
    };
  }

  const sellable = inventory.on_hand - inventory.reserved;
  const stockoutDays = dailyDemand > 0 ? Math.floor(sellable / dailyDemand) : 999;

  const ranked = alternates
    .map((o) => ({
      option: o,
      inTime: o.lead_time_days <= stockoutDays,
      score: (o.lead_time_days <= stockoutDays ? 0 : 1000) + o.unit_price * 10 + (1 - o.supplier.reliability_score) * 50,
    }))
    .sort((a, b) => a.score - b.score);

  for (const candidate of ranked) {
    const o = candidate.option;
    const shaped = shapeOrderQty(gap, o);
    let qty = shaped.shapedQty;

    let v = validatePurchase({
      supplier_id: o.supplier_id, node_id: nodeId, product_id: productId,
      qty, dailyDemand,
    });
    if (!v.passed && v.maxFeasibleQty > 0) {
      qty = v.maxFeasibleQty;
      v = validatePurchase({
        supplier_id: o.supplier_id, node_id: nodeId, product_id: productId, qty, dailyDemand,
      });
    }
    if (!v.passed || qty === 0) continue;

    return {
      possible: true,
      supplierId: o.supplier_id,
      qty,
      unitPrice: o.unit_price,
      action: {
        kind: "create_po",
        supplier_id: o.supplier_id,
        node_id: nodeId,
        product_id: productId,
        qty,
        reason: `Corrective order: covers the ${gap}-unit gap left when ${failedSupplierId} confirmed short.`,
      },
      rationale:
        `Attempt ${attempt} of ${maxAttempts}: re-sourcing ${qty} units from ${o.supplier.name} ` +
        `($${o.unit_price}/unit, ${o.lead_time_days}d lead time, ${(o.supplier.reliability_score * 100).toFixed(0)}% fill rate)` +
        (candidate.inTime
          ? ` — arrives within the ~${stockoutDays}-day runway.`
          : ` — the fastest option available, though it lands after the ~${stockoutDays}-day runway.`),
    };
  }

  return {
    possible: false, action: null,
    rationale: `${alternates.length} alternate supplier(s) evaluated; none can supply the remaining ${gap} units within budget, storage and MOQ limits.`,
  };
}
