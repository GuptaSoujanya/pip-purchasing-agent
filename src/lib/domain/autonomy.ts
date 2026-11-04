import { getPolicies, getSupplier, getSupplierProduct, listSupplierOptions } from "../db/repo";
import type { ProposedAction, ValidationResult } from "./types";

/**
 * Autonomy gate: decides whether the agent may execute an action itself,
 * must ask a human first, or must stop and escalate.
 *
 * Thresholds live in the `agent_policies` table so a buyer can tighten or
 * loosen the agent's leash without a code change.
 */

export type AutonomyVerdict = {
  decision: "auto_execute" | "require_approval" | "escalate";
  riskLevel: "low" | "medium" | "high";
  reasons: string[];
  /** Short sentence shown to the human in the approval queue. */
  headline: string;
};

export function evaluateAutonomy(args: {
  action: ProposedAction;
  validation: ValidationResult;
  orderValue: number;
  confidence: number;
  /** Deviation from the originally recommended quantity, as a fraction. */
  qtyDeviationPct?: number;
  /** Price premium vs the cheapest available supplier, as a fraction. */
  pricePremiumPct?: number;
  isNewSupplier?: boolean;
}): AutonomyVerdict {
  const p = getPolicies();
  const maxAutoValue = p.max_auto_order_value ?? 5000;
  const maxDeviation = p.max_auto_qty_deviation_pct ?? 0.25;
  const maxPremium = p.max_auto_price_premium_pct ?? 0.1;
  const minConfidence = p.min_auto_confidence ?? 0.7;

  const reasons: string[] = [];
  let needsApproval = false;
  let escalate = false;

  if (args.action.kind === "escalate") {
    return {
      decision: "escalate",
      riskLevel: "high",
      reasons: [args.action.reason],
      headline: args.action.reason,
    };
  }

  if (args.action.kind === "no_action") {
    return {
      decision: "auto_execute",
      riskLevel: "low",
      reasons: ["No change to the operational world is required."],
      headline: "No action needed.",
    };
  }

  // Hard constraint breach that the agent could not design around.
  if (!args.validation.passed) {
    escalate = true;
    reasons.push(
      `Hard constraints still failing: ${args.validation.hardFailures.map((f) => f.code).join(", ")}.`,
    );
  }

  if (args.orderValue > maxAutoValue) {
    needsApproval = true;
    reasons.push(
      `Order value $${args.orderValue.toFixed(2)} exceeds the $${maxAutoValue} auto-approval ceiling.`,
    );
  }

  if (args.qtyDeviationPct !== undefined && Math.abs(args.qtyDeviationPct) > maxDeviation) {
    needsApproval = true;
    reasons.push(
      `Quantity deviates ${(args.qtyDeviationPct * 100).toFixed(0)}% from the original recommendation, beyond the ${(maxDeviation * 100).toFixed(0)}% auto-adjust band.`,
    );
  }

  if (args.pricePremiumPct !== undefined && args.pricePremiumPct > maxPremium) {
    needsApproval = true;
    reasons.push(
      `Unit price carries a ${(args.pricePremiumPct * 100).toFixed(0)}% premium over the cheapest qualified supplier, above the ${(maxPremium * 100).toFixed(0)}% threshold.`,
    );
  }

  if (args.isNewSupplier) {
    needsApproval = true;
    reasons.push("Sourcing from a supplier not previously used for this product at this node.");
  }

  if (args.confidence < minConfidence) {
    needsApproval = true;
    reasons.push(
      `Decision confidence ${(args.confidence * 100).toFixed(0)}% is below the ${(minConfidence * 100).toFixed(0)}% autonomous threshold.`,
    );
  }

  if (args.validation.softWarnings.length > 0) {
    needsApproval = true;
    reasons.push(
      `Soft constraint warnings present: ${args.validation.softWarnings.map((w) => w.code).join(", ")}.`,
    );
  }

  if (escalate) {
    return {
      decision: "escalate",
      riskLevel: "high",
      reasons,
      headline: "Cannot execute — unresolved hard constraints require a buyer decision.",
    };
  }

  if (needsApproval) {
    const riskLevel: "medium" | "high" =
      args.orderValue > maxAutoValue * 2 || args.confidence < 0.5 ? "high" : "medium";
    return {
      decision: "require_approval",
      riskLevel,
      reasons,
      headline: reasons[0],
    };
  }

  return {
    decision: "auto_execute",
    riskLevel: "low",
    reasons: ["Within every autonomous-execution threshold."],
    headline: "Auto-executed within policy limits.",
  };
}

/** Price premium of a supplier vs the cheapest active supplier for the product. */
export function pricePremium(supplierId: string, productId: string): number {
  const options = listSupplierOptions(productId);
  if (!options.length) return 0;
  const cheapest = Math.min(...options.map((o) => o.unit_price));
  const sp = getSupplierProduct(supplierId, productId);
  if (!sp || cheapest <= 0) return 0;
  return (sp.unit_price - cheapest) / cheapest;
}

export function supplierLabel(supplierId: string): string {
  return getSupplier(supplierId)?.name ?? supplierId;
}
