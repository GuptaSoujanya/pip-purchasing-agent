import {
  addDays,
  budgetAvailable,
  getBudget,
  getDemandHistory,
  getForecast,
  getInventory,
  getNode,
  getOpenPos,
  getPo,
  getPolicies,
  getProduct,
  getActivePromotions,
  listNodes,
  listSupplierOptions,
  getSupplierProduct,
  storageFreeSlots,
  today,
} from "../db/repo";
import { pricePremium } from "./autonomy";
import { validatePurchase } from "./constraints";
import {
  computeNetRequirement,
  daysOfCoverAfter,
  demandStats,
  detectDemandShift,
  largestFeasibleQty,
  round2,
  shapeOrderQty,
  type DemandShiftEvidence,
  type NetRequirement,
} from "./math";
import type { DecisionKind, ProposedAction, SupplierProduct, Supplier, ValidationResult } from "./types";

/**
 * Deterministic policy engine.
 *
 * This computes what a *correct* buyer decision looks like, straight from the
 * data, with no language model involved. It serves three distinct purposes:
 *
 *   1. FALLBACK  — the whole system runs end-to-end with zero API keys.
 *   2. GUARDRAIL — the LLM's proposal is checked against this; a proposal that
 *                  breaches hard constraints is overridden, never executed.
 *   3. ORACLE    — the evaluation harness asserts LLM behaviour against it.
 *
 * Keeping the arithmetic here (rather than in a prompt) is what makes the
 * agent's numbers reproducible and auditable.
 */

export const REVIEW_PERIOD_DAYS = 14;

export type KeyFactor = {
  label: string;
  value: string;
  impact: "supports" | "opposes" | "neutral";
};

export type SupplierOption = SupplierProduct & { supplier: Supplier };

export type PolicyOutcome = {
  decision: DecisionKind;
  action: ProposedAction;
  /** Extra actions required to fully resolve the situation (split sourcing, staged orders). */
  followUpActions: ProposedAction[];
  recommendedQty: number;
  supplierId: string | null;
  confidence: number;
  rationale: string[];
  keyFactors: KeyFactor[];
  netRequirement: NetRequirement | null;
  validation: ValidationResult | null;
  demandSignal: {
    plannedDailyDemand: number;
    baselineForecast: number;
    recentActualDaily: number;
    shift: DemandShiftEvidence | null;
  };
  orderValue: number;
  alternatives: {
    supplierId: string;
    supplierName: string;
    unitPrice: number;
    leadTimeDays: number;
    reliability: number;
    maxQty: number;
    note: string;
  }[];
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Pick the demand rate to plan against.
 *
 * The planning system's forecast is the default, but if recent actuals show a
 * statistically significant, sustained, non-promotional shift, we plan against
 * the new rate instead. This is the mechanism that makes the agent refuse to
 * trust a stale forecast.
 */
function resolvePlanningDemand(nodeId: string, productId: string) {
  const forecast = getForecast(nodeId, productId);
  const points = getDemandHistory(nodeId, productId, 35);
  const promotions = getActivePromotions(nodeId, productId);
  const baseline = forecast?.daily_forecast ?? 0;
  const stats = demandStats(points, baseline);
  const shift = detectDemandShift({ points, forecast, promotions });

  let planned = baseline;
  if (shift.shiftDetected) {
    planned = shift.recommendedDailyForecast;
  } else if (shift.explainedByPromotion && stats.last7Mean > baseline) {
    // Plan at the elevated rate only for as long as the promotion runs,
    // but never rebase the long-run forecast on promotional demand.
    planned = stats.last7Mean;
  }

  return {
    forecast,
    points,
    promotions,
    stats,
    shift,
    plannedDailyDemand: round2(planned),
    baselineForecast: baseline,
  };
}

function chooseSupplier(productId: string, preferredId?: string): SupplierOption | null {
  const options = listSupplierOptions(productId);
  if (!options.length) return null;
  if (preferredId) {
    const match = options.find((o) => o.supplier_id === preferredId);
    if (match) return match;
  }
  return options.find((o) => o.is_preferred === 1) ?? options[0];
}

function describeAlternatives(productId: string, excludeSupplierId?: string) {
  return listSupplierOptions(productId)
    .filter((o) => o.supplier_id !== excludeSupplierId)
    .map((o) => ({
      supplierId: o.supplier_id,
      supplierName: o.supplier.name,
      unitPrice: o.unit_price,
      leadTimeDays: o.lead_time_days,
      reliability: o.supplier.reliability_score,
      maxQty: o.max_units_per_order ?? Infinity,
      note:
        `MOQ ${o.moq}, lot ${o.lot_size}, ${o.lead_time_days}d lead time, ` +
        `${(o.supplier.reliability_score * 100).toFixed(0)}% fill rate` +
        (o.expedite_available ? `, expedite in ${o.expedite_lead_time_days}d (+${o.expedite_surcharge_pct}%)` : ""),
    }))
    .map((a) => ({ ...a, maxQty: Number.isFinite(a.maxQty) ? a.maxQty : 999_999 }));
}

/** Find another node with enough free storage to take the overflow. */
export function findNodeWithCapacity(productId: string, units: number, excludeNodeId: string) {
  const product = getProduct(productId);
  if (!product) return null;
  const needed = units * product.slots_per_unit;
  return (
    listNodes()
      .filter((n) => n.id !== excludeNodeId && storageFreeSlots(n) >= needed)
      .sort((a, b) => storageFreeSlots(b) - storageFreeSlots(a))[0] ?? null
  );
}

/**
 * Shape a desired quantity against supplier terms, then squeeze it under every
 * hard constraint. Returns the executable quantity and the full validation.
 */
function fitToConstraints(args: {
  supplier: SupplierOption;
  nodeId: string;
  productId: string;
  desiredQty: number;
  dailyDemand: number;
  expedite?: boolean;
  excludePoCost?: number;
  excludePoSlots?: number;
}) {
  const shaping = shapeOrderQty(args.desiredQty, args.supplier);
  let qty = shaping.shapedQty;
  const notes = [...shaping.adjustments];

  let validation = validatePurchase({
    supplier_id: args.supplier.supplier_id,
    node_id: args.nodeId,
    product_id: args.productId,
    qty,
    expedite: args.expedite,
    dailyDemand: args.dailyDemand,
    excludePoCost: args.excludePoCost,
    excludePoSlots: args.excludePoSlots,
  });

  if (!validation.passed && validation.maxFeasibleQty < qty) {
    const capped = validation.maxFeasibleQty;
    notes.push(
      capped > 0
        ? `Reduced ${qty} to ${capped} — limited by ${validation.bindingConstraint}.`
        : `No quantity satisfies every constraint simultaneously (binding: ${validation.bindingConstraint}).`,
    );
    qty = capped;
    if (qty > 0) {
      validation = validatePurchase({
        supplier_id: args.supplier.supplier_id,
        node_id: args.nodeId,
        product_id: args.productId,
        qty,
        expedite: args.expedite,
        dailyDemand: args.dailyDemand,
        excludePoCost: args.excludePoCost,
        excludePoSlots: args.excludePoSlots,
      });
    }
  }

  return { qty, validation, notes, shaping };
}

// ===========================================================================
// SCENARIO 1 — Review a purchasing recommendation
// ===========================================================================

export function reviewRecommendation(args: {
  nodeId: string;
  productId: string;
  recommendedQty: number;
  supplierId?: string;
}): PolicyOutcome {
  const { nodeId, productId, recommendedQty } = args;
  const rationale: string[] = [];
  const keyFactors: KeyFactor[] = [];

  const product = getProduct(productId);
  const node = getNode(nodeId);
  const inventory = getInventory(nodeId, productId);
  const budget = getBudget(nodeId);

  if (!product || !node || !inventory) {
    return bail("Reference data missing for the requested product/node.");
  }

  const demand = resolvePlanningDemand(nodeId, productId);
  const supplier = chooseSupplier(productId, args.supplierId);
  if (!supplier) {
    return bail(`No active supplier lists ${product.sku}; the recommendation cannot be sourced.`);
  }

  // --- Evidence sufficiency gate: refuse to decide on thin data -----------
  if (!demand.forecast) {
    return {
      ...bail(`No forecast exists for ${product.sku} at ${node.name}.`),
      decision: "INVESTIGATE" as DecisionKind,
      rationale: [
        `No demand forecast is on file for ${product.sku} at ${node.name}.`,
        "Net requirement cannot be computed without a demand signal, so the 800-unit recommendation cannot be verified either way.",
        "Flagging for investigation rather than guessing at a quantity.",
      ],
    };
  }
  if (demand.points.length < 14) {
    return {
      ...bail(`Only ${demand.points.length} days of sales history available.`),
      decision: "INVESTIGATE" as DecisionKind,
      rationale: [
        `Only ${demand.points.length} days of demand history exist for ${product.sku} — below the 14-day minimum for a reliable net-requirement calculation.`,
        "Recommending investigation before committing budget.",
      ],
    };
  }

  // --- Net requirement ----------------------------------------------------
  const net = computeNetRequirement({
    inventory,
    dailyDemand: demand.plannedDailyDemand,
    leadTimeDays: supplier.lead_time_days,
    reviewPeriodDays: REVIEW_PERIOD_DAYS,
  });

  rationale.push(...net.workings);

  if (demand.shift.shiftDetected) {
    rationale.push(
      `Planning against ${demand.plannedDailyDemand}/day rather than the stale forecast of ${demand.baselineForecast}/day: ${demand.shift.reasons[0]}`,
    );
  }

  const openPos = getOpenPos(nodeId, productId);
  if (openPos.length) {
    rationale.push(
      `${openPos.length} open purchase order(s) already cover ${inventory.in_transit} units inbound: ` +
        openPos.map((p) => `${p.po_number} (${p.status}, due ${p.expected_delivery})`).join(", ") + ".",
    );
  }

  // --- Fit to supplier terms + constraints --------------------------------
  const fit = fitToConstraints({
    supplier, nodeId, productId,
    desiredQty: net.netRequirement,
    dailyDemand: demand.plannedDailyDemand,
  });
  rationale.push(...fit.notes);

  const unitPrice = supplier.unit_price;
  const orderValue = round2(fit.qty * unitPrice);

  // --- Compare against the system recommendation --------------------------
  const deviation = recommendedQty > 0 ? (fit.qty - recommendedQty) / recommendedQty : 1;
  const ACCEPT_TOLERANCE = 0.1;

  let decision: DecisionKind;
  if (fit.qty === 0) {
    decision = "REJECT";
    rationale.push(
      net.netRequirement === 0
        ? `Net requirement is zero — on-hand plus inbound stock already covers ${net.horizonDays} days of demand plus safety stock. Buying ${recommendedQty} units would be pure overstock.`
        : `No quantity can be ordered within current constraints (binding: ${fit.validation.bindingConstraint}).`,
    );
  } else if (Math.abs(deviation) <= ACCEPT_TOLERANCE) {
    decision = "ACCEPT";
    rationale.push(
      `Computed requirement of ${fit.qty} is within ${(ACCEPT_TOLERANCE * 100).toFixed(0)}% of the recommended ${recommendedQty} — the recommendation is sound.`,
    );
  } else {
    decision = "MODIFY";
    const dir = fit.qty < recommendedQty ? "over" : "under";
    rationale.push(
      `The system recommended ${recommendedQty} units but the evidence supports ${fit.qty}. ` +
        `The recommendation ${dir}-states requirement by ${Math.abs(fit.qty - recommendedQty)} units ` +
        `(${Math.abs(deviation * 100).toFixed(0)}%).`,
    );
    if (fit.qty < recommendedQty) {
      const wasted = round2((recommendedQty - fit.qty) * unitPrice);
      rationale.push(
        `Accepting the original recommendation would commit an extra $${wasted.toFixed(2)} and push cover to ` +
          `${daysOfCoverAfter({ inventory, incomingQty: recommendedQty, dailyDemand: demand.plannedDailyDemand })} days.`,
      );
    }
  }

  // --- Key factors for the UI --------------------------------------------
  keyFactors.push(
    { label: "Planned daily demand", value: `${demand.plannedDailyDemand}/day`, impact: "neutral" },
    { label: "Net requirement", value: `${net.netRequirement} units`, impact: "neutral" },
    { label: "On hand / in transit", value: `${inventory.on_hand} / ${inventory.in_transit}`, impact: inventory.in_transit > 0 ? "opposes" : "neutral" },
    { label: "Safety stock", value: `${inventory.safety_stock} units`, impact: "supports" },
    { label: "Supplier", value: `${supplier.supplier.name} (MOQ ${supplier.moq}, lot ${supplier.lot_size}, ${supplier.lead_time_days}d)`, impact: "neutral" },
    { label: "Current cover", value: `${net.currentDaysOfCover} days`, impact: net.currentDaysOfCover > 30 ? "opposes" : "supports" },
  );
  if (budget) {
    keyFactors.push({
      label: "Budget available",
      value: `$${budgetAvailable(budget).toFixed(2)}`,
      impact: orderValue > budgetAvailable(budget) * 0.8 ? "opposes" : "neutral",
    });
  }
  keyFactors.push({
    label: "Storage free",
    value: `${storageFreeSlots(node).toFixed(0)} slots`,
    impact: fit.validation.hardFailures.some((f) => f.code === "STORAGE") ? "opposes" : "neutral",
  });

  const confidence = scoreConfidence({
    validation: fit.validation,
    dataPoints: demand.points.length,
    cv: demand.stats.cv,
    qty: fit.qty,
  });

  const action: ProposedAction =
    fit.qty > 0
      ? {
          kind: "create_po",
          supplier_id: supplier.supplier_id,
          node_id: nodeId,
          product_id: productId,
          qty: fit.qty,
          reason: `Replenish ${product.sku} to cover ${net.horizonDays} days of demand plus safety stock.`,
        }
      : { kind: "no_action", reason: rationale[rationale.length - 1] };

  return {
    decision,
    action,
    followUpActions: [],
    recommendedQty: fit.qty,
    supplierId: supplier.supplier_id,
    confidence,
    rationale,
    keyFactors,
    netRequirement: net,
    validation: fit.validation,
    demandSignal: {
      plannedDailyDemand: demand.plannedDailyDemand,
      baselineForecast: demand.baselineForecast,
      recentActualDaily: demand.stats.last7Mean,
      shift: demand.shift,
    },
    orderValue,
    alternatives: describeAlternatives(productId, supplier.supplier_id),
  };
}

// ===========================================================================
// SCENARIO 2 — Supplier cannot fulfil the order
// ===========================================================================

export function resolveShortfall(args: {
  poId: string;
  productId: string;
  confirmedQty: number;
}): PolicyOutcome {
  const rationale: string[] = [];
  const keyFactors: KeyFactor[] = [];

  const po = getPo(args.poId);
  if (!po) return bail(`Purchase order ${args.poId} not found.`);

  const line = po.lines.find((l) => l.product_id === args.productId);
  if (!line) return bail(`Purchase order ${po.po_number} has no line for ${args.productId}.`);

  const product = getProduct(args.productId)!;
  const node = getNode(po.node_id)!;
  const inventory = getInventory(po.node_id, args.productId)!;
  const demand = resolvePlanningDemand(po.node_id, args.productId);

  const shortfall = line.qty_ordered - args.confirmedQty;
  rationale.push(
    `${po.po_number}: supplier confirmed ${args.confirmedQty} of ${line.qty_ordered} units — a shortfall of ${shortfall}.`,
  );

  const originalSupplier = getSupplierProduct(po.supplier_id, args.productId);

  // --- Step 1: is the shortfall actually a problem? -----------------------
  // Re-evaluate requirement with the confirmed quantity treated as inbound and
  // the unconfirmed balance removed from in_transit.
  const adjustedInventory = {
    ...inventory,
    in_transit: inventory.in_transit - line.qty_ordered + args.confirmedQty,
  };
  const leadTime = originalSupplier?.lead_time_days ?? 7;
  const net = computeNetRequirement({
    inventory: adjustedInventory,
    dailyDemand: demand.plannedDailyDemand,
    leadTimeDays: leadTime,
    reviewPeriodDays: REVIEW_PERIOD_DAYS,
  });
  rationale.push(...net.workings);

  keyFactors.push(
    { label: "Confirmed / ordered", value: `${args.confirmedQty} / ${line.qty_ordered}`, impact: "opposes" },
    { label: "Shortfall", value: `${shortfall} units`, impact: "opposes" },
    { label: "Remaining requirement", value: `${net.netRequirement} units`, impact: net.netRequirement > 0 ? "opposes" : "supports" },
    { label: "Days of cover after partial", value: `${net.currentDaysOfCover} days`, impact: net.currentDaysOfCover < 14 ? "opposes" : "supports" },
  );

  // Case A — the shortfall does not need re-sourcing, either because stock
  // absorbs it outright or because the residual gap is too small to be worth
  // buying against. The second test matters: a positive net requirement does
  // not make a purchase worthwhile. Supplier MOQ and lot size mean the smallest
  // orderable quantity can be tens of times the actual gap, so mechanically
  // filling any gap > 0 spends hundreds of dollars at a premium to protect a
  // few hours of cover. A buyer absorbs that and reorders on the normal cycle.
  const gapDays = demand.plannedDailyDemand > 0
    ? net.netRequirement / demand.plannedDailyDemand
    : 0;
  const immaterialGapDays = getPolicies().immaterial_gap_days ?? 1;
  const gapIsImmaterial = net.netRequirement > 0 && gapDays < immaterialGapDays;

  if (net.netRequirement === 0 || gapIsImmaterial) {
    if (gapIsImmaterial) {
      const cheapestAlternate = listSupplierOptions(args.productId)
        .filter((o) => o.supplier_id !== po.supplier_id)
        .sort((a, b) => a.unit_price * Math.max(a.moq, net.netRequirement) - b.unit_price * Math.max(b.moq, net.netRequirement))[0];
      const minOrderCost = cheapestAlternate
        ? round2(Math.max(cheapestAlternate.moq, net.netRequirement) * cheapestAlternate.unit_price)
        : null;
      rationale.push(
        `The residual gap of ${net.netRequirement} units is ${gapDays.toFixed(2)} days of demand — below the ` +
          `${immaterialGapDays}-day materiality threshold.` +
          (minOrderCost !== null
            ? ` Covering it would mean a ${Math.max(cheapestAlternate!.moq, net.netRequirement)}-unit minimum order ` +
              `costing $${minOrderCost.toFixed(2)} to protect $${round2(net.netRequirement * line.unit_price).toFixed(2)} ` +
              `of exposure, so the gap is absorbed and picked up on the normal replenishment cycle.`
            : ` The gap is absorbed and picked up on the normal replenishment cycle.`),
      );
      keyFactors.push({
        label: "Gap materiality",
        value: `${gapDays.toFixed(2)} days of cover`,
        impact: "supports",
      });
    } else {
      rationale.push(
        `After the partial delivery, on-hand plus inbound stock still covers ${net.horizonDays} days of demand plus safety stock. ` +
          `The shortfall of ${shortfall} units does not need to be re-sourced.`,
      );
    }
    return {
      decision: "ACCEPT",
      action: {
        kind: "amend_po",
        po_id: po.id,
        product_id: args.productId,
        new_qty: args.confirmedQty,
        reason: `Accept the supplier's confirmed ${args.confirmedQty} units; remaining requirement is zero.`,
      },
      followUpActions: [],
      recommendedQty: args.confirmedQty,
      supplierId: po.supplier_id,
      confidence: 0.9,
      rationale,
      keyFactors,
      netRequirement: net,
      validation: null,
      demandSignal: {
        plannedDailyDemand: demand.plannedDailyDemand,
        baselineForecast: demand.baselineForecast,
        recentActualDaily: demand.stats.last7Mean,
        shift: demand.shift,
      },
      orderValue: round2(args.confirmedQty * line.unit_price),
      alternatives: describeAlternatives(args.productId, po.supplier_id),
    };
  }

  // Case B — we still need stock. Find the best alternate source.
  rationale.push(
    `A gap of ${net.netRequirement} units remains after the partial delivery; stock would run out in ~${net.projectedStockoutInDays} days.`,
  );

  const alternates = listSupplierOptions(args.productId).filter((o) => o.supplier_id !== po.supplier_id);
  if (!alternates.length) {
    rationale.push("No alternate supplier lists this product — the gap cannot be sourced elsewhere.");
    return {
      decision: "ESCALATE",
      action: { kind: "escalate", reason: `No alternate source for ${product.sku}; ${net.netRequirement}-unit gap unresolved.` },
      followUpActions: [
        { kind: "amend_po", po_id: po.id, product_id: args.productId, new_qty: args.confirmedQty, reason: "Lock in the confirmed quantity while the gap is escalated." },
      ],
      recommendedQty: 0,
      supplierId: null,
      confidence: 0.85,
      rationale,
      keyFactors,
      netRequirement: net,
      validation: null,
      demandSignal: {
        plannedDailyDemand: demand.plannedDailyDemand,
        baselineForecast: demand.baselineForecast,
        recentActualDaily: demand.stats.last7Mean,
        shift: demand.shift,
      },
      orderValue: 0,
      alternatives: [],
    };
  }

  // Rank alternates: must arrive before stockout, then cheapest, then most reliable.
  const stockoutDays = net.projectedStockoutInDays ?? 999;
  const ranked = alternates
    .map((o) => {
      const arrivesInTime = o.lead_time_days <= stockoutDays;
      const expediteInTime =
        !!o.expedite_available && (o.expedite_lead_time_days ?? 99) <= stockoutDays;
      const effectivePrice = o.unit_price * (arrivesInTime ? 1 : 1 + o.expedite_surcharge_pct / 100);
      return {
        option: o,
        arrivesInTime,
        expediteInTime,
        needsExpedite: !arrivesInTime && expediteInTime,
        score:
          (arrivesInTime ? 0 : expediteInTime ? 1 : 3) * 1000 +
          effectivePrice * 10 +
          (1 - o.supplier.reliability_score) * 50,
      };
    })
    .sort((a, b) => a.score - b.score);

  const best = ranked[0];
  const bestOpt = best.option;
  rationale.push(
    `Evaluated ${alternates.length} alternate supplier(s). Selected ${bestOpt.supplier.name}: ` +
      `$${bestOpt.unit_price}/unit, ${bestOpt.lead_time_days}d lead time, ` +
      `${(bestOpt.supplier.reliability_score * 100).toFixed(0)}% fill rate` +
      (best.needsExpedite ? `, expedited to ${bestOpt.expedite_lead_time_days}d (+${bestOpt.expedite_surcharge_pct}%) to beat the projected stockout.` : "."),
  );

  if (!best.arrivesInTime && !best.expediteInTime) {
    rationale.push(
      `Warning: no supplier can deliver within the ~${stockoutDays}-day runway. A partial stockout is unavoidable; ordering anyway minimises its duration.`,
    );
  }

  // The original PO's unconfirmed balance frees budget and storage back up.
  const releasedCost = shortfall * line.unit_price;
  const releasedSlots = shortfall * product.slots_per_unit;

  const fit = fitToConstraints({
    supplier: bestOpt,
    nodeId: po.node_id,
    productId: args.productId,
    desiredQty: net.netRequirement,
    dailyDemand: demand.plannedDailyDemand,
    expedite: best.needsExpedite,
    excludePoCost: releasedCost,
    excludePoSlots: releasedSlots,
  });
  rationale.push(...fit.notes);

  const premium = pricePremium(bestOpt.supplier_id, args.productId);
  if (premium > 0) {
    rationale.push(
      `${bestOpt.supplier.name} carries a ${(premium * 100).toFixed(0)}% price premium over the cheapest option — flagged for approval review.`,
    );
  }

  keyFactors.push({
    label: "Replacement supplier",
    value: `${bestOpt.supplier.name} @ $${bestOpt.unit_price}`,
    impact: premium > 0.1 ? "opposes" : "supports",
  });

  const unit = bestOpt.unit_price * (best.needsExpedite ? 1 + bestOpt.expedite_surcharge_pct / 100 : 1);

  const amend: ProposedAction = {
    kind: "amend_po",
    po_id: po.id,
    product_id: args.productId,
    new_qty: args.confirmedQty,
    reason: `Accept ${args.confirmedQty} confirmed units; release the ${shortfall}-unit balance.`,
  };

  if (fit.qty === 0) {
    rationale.push(`The replacement order cannot be placed within constraints (binding: ${fit.validation.bindingConstraint}).`);
    return {
      decision: "ESCALATE",
      action: { kind: "escalate", reason: `Cannot source the ${net.netRequirement}-unit gap for ${product.sku} within budget/storage/MOQ constraints.` },
      followUpActions: [amend],
      recommendedQty: 0,
      supplierId: bestOpt.supplier_id,
      confidence: 0.8,
      rationale,
      keyFactors,
      netRequirement: net,
      validation: fit.validation,
      demandSignal: {
        plannedDailyDemand: demand.plannedDailyDemand,
        baselineForecast: demand.baselineForecast,
        recentActualDaily: demand.stats.last7Mean,
        shift: demand.shift,
      },
      orderValue: 0,
      alternatives: describeAlternatives(args.productId, po.supplier_id),
    };
  }

  return {
    decision: "SPLIT_SOURCE",
    // The primary action is the new sourcing order; the amendment follows.
    action: {
      kind: "create_po",
      supplier_id: bestOpt.supplier_id,
      node_id: po.node_id,
      product_id: args.productId,
      qty: fit.qty,
      expedite: best.needsExpedite,
      reason: `Cover the ${net.netRequirement}-unit gap left by ${po.po_number}.`,
    },
    followUpActions: [amend],
    recommendedQty: fit.qty,
    supplierId: bestOpt.supplier_id,
    confidence: scoreConfidence({
      validation: fit.validation,
      dataPoints: demand.points.length,
      cv: demand.stats.cv,
      qty: fit.qty,
    }),
    rationale,
    keyFactors,
    netRequirement: net,
    validation: fit.validation,
    demandSignal: {
      plannedDailyDemand: demand.plannedDailyDemand,
      baselineForecast: demand.baselineForecast,
      recentActualDaily: demand.stats.last7Mean,
      shift: demand.shift,
    },
    orderValue: round2(fit.qty * unit),
    alternatives: describeAlternatives(args.productId, bestOpt.supplier_id),
  };
}

// ===========================================================================
// SCENARIO 3 — Demand / forecast has changed
// ===========================================================================

export function assessDemandShift(args: { nodeId: string; productId: string }): PolicyOutcome {
  const { nodeId, productId } = args;
  const rationale: string[] = [];
  const keyFactors: KeyFactor[] = [];

  const product = getProduct(productId);
  const node = getNode(nodeId);
  const inventory = getInventory(nodeId, productId);
  if (!product || !node || !inventory) return bail("Reference data missing.");

  const demand = resolvePlanningDemand(nodeId, productId);
  const { shift, stats } = demand;

  rationale.push(
    `Forecast baseline is ${demand.baselineForecast}/day; trailing 7-day actuals average ${stats.last7Mean}/day (${shift.trendRatio}x).`,
  );
  rationale.push(...shift.reasons);

  keyFactors.push(
    { label: "Forecast baseline", value: `${demand.baselineForecast}/day`, impact: "neutral" },
    { label: "Actual (7d)", value: `${stats.last7Mean}/day`, impact: shift.trendRatio > 1.2 ? "opposes" : "neutral" },
    { label: "Trend ratio", value: `${shift.trendRatio}x`, impact: shift.trendRatio > 1.5 ? "opposes" : "neutral" },
    { label: "Sustained days", value: `${shift.consecutiveElevatedDays}`, impact: "neutral" },
    { label: "z-score", value: `${shift.zScoreOfLast7}`, impact: "neutral" },
    {
      label: "Promotion active",
      value: shift.promotion ? `${shift.promotion.description} (+${shift.promotion.uplift_pct}%)` : "none",
      impact: shift.explainedByPromotion ? "supports" : "neutral",
    },
  );

  const openPos = getOpenPos(nodeId, productId);
  const inboundDetail = openPos.length
    ? openPos.map((p) => {
        const l = p.lines.find((x) => x.product_id === productId);
        return `${p.po_number}: ${l?.qty_confirmed || l?.qty_ordered || 0} units due ${p.expected_delivery}`;
      }).join("; ")
    : "none";
  rationale.push(`Existing inbound supply — ${inboundDetail}.`);

  // --- Case A: the spike is a promotion. Do NOT rebase the forecast. ------
  if (shift.explainedByPromotion && shift.promotion) {
    const promoEndsIn = Math.max(0, daysUntil(shift.promotion.end_date));
    const sellable = inventory.on_hand - inventory.reserved;
    const coverDays = demand.plannedDailyDemand > 0 ? Math.floor(sellable / demand.plannedDailyDemand) : 999;

    rationale.push(
      `The uplift is attributable to the active promotion, which ends in ${promoEndsIn} day(s). ` +
        `Permanently raising the forecast would cause structural overstock once the promotion closes.`,
    );

    if (coverDays >= promoEndsIn) {
      rationale.push(
        `Current stock covers ${coverDays} days, enough to see out the promotion. No purchasing change required.`,
      );
      return finishNoAction(
        "NO_ACTION",
        `Demand spike explained by promotion "${shift.promotion.description}"; existing stock covers the promotional period.`,
        rationale, keyFactors, demand, 0.88,
      );
    }

    // Short-term top-up sized to the promo window only.
    const supplier = chooseSupplier(productId);
    if (!supplier) return bail(`No supplier for ${product.sku}.`);
    const promoNeed = Math.max(
      0,
      Math.ceil(demand.plannedDailyDemand * promoEndsIn) - sellable + inventory.safety_stock,
    );
    const fit = fitToConstraints({
      supplier, nodeId, productId,
      desiredQty: promoNeed,
      dailyDemand: demand.plannedDailyDemand,
    });
    rationale.push(
      `Stock covers only ${coverDays} of the ${promoEndsIn} remaining promotion days. ` +
        `Placing a one-off top-up of ${fit.qty} units sized to the promotion window, NOT a permanent forecast increase.`,
    );
    rationale.push(...fit.notes);

    return {
      decision: fit.qty > 0 ? "MODIFY" : "NO_ACTION",
      action: fit.qty > 0
        ? {
            kind: "create_po", supplier_id: supplier.supplier_id, node_id: nodeId,
            product_id: productId, qty: fit.qty,
            reason: `Promotional top-up for "${shift.promotion.description}" — deliberately not rebasing the forecast.`,
          }
        : { kind: "no_action", reason: "No feasible top-up within constraints." },
      followUpActions: [],
      recommendedQty: fit.qty,
      supplierId: supplier.supplier_id,
      confidence: 0.78,
      rationale,
      keyFactors,
      netRequirement: null,
      validation: fit.validation,
      demandSignal: {
        plannedDailyDemand: demand.plannedDailyDemand,
        baselineForecast: demand.baselineForecast,
        recentActualDaily: stats.last7Mean,
        shift,
      },
      orderValue: round2(fit.qty * supplier.unit_price),
      alternatives: describeAlternatives(productId, supplier.supplier_id),
    };
  }

  // --- Case B: no statistically supported shift. Hold. --------------------
  if (!shift.shiftDetected) {
    rationale.push(
      "The evidence does not clear the thresholds for a genuine demand shift. Changing the purchasing plan on this signal would be premature.",
    );
    return finishNoAction(
      "NO_ACTION",
      "Observed variation does not meet the evidence bar for a forecast change.",
      rationale, keyFactors, demand, round2(0.6 + shift.confidence * 0.3),
    );
  }

  // --- Case C: real, sustained shift. Re-plan. ----------------------------
  rationale.push(
    `Confirmed demand shift at ${(shift.confidence * 100).toFixed(0)}% confidence. Re-planning against ${demand.plannedDailyDemand}/day.`,
  );

  const supplier = chooseSupplier(productId);
  if (!supplier) return bail(`No supplier for ${product.sku}.`);

  const net = computeNetRequirement({
    inventory,
    dailyDemand: demand.plannedDailyDemand,
    leadTimeDays: supplier.lead_time_days,
    reviewPeriodDays: REVIEW_PERIOD_DAYS,
  });
  rationale.push(...net.workings);

  const stockoutDays = net.projectedStockoutInDays ?? 999;
  const earliestArrival = nextArrivalDays(openPos);
  const gap = earliestArrival !== null ? earliestArrival - stockoutDays : null;

  let needsExpedite = false;
  if (gap !== null && gap > 0) {
    rationale.push(
      `Stock runs out in ~${stockoutDays} days but the next delivery lands on day ${earliestArrival} — a ${gap}-day stockout window.`,
    );
    needsExpedite = !!supplier.expedite_available && (supplier.expedite_lead_time_days ?? 99) < stockoutDays;
    if (needsExpedite) {
      rationale.push(
        `${supplier.supplier.name} can expedite in ${supplier.expedite_lead_time_days} days (+${supplier.expedite_surcharge_pct}%), closing the gap.`,
      );
    }
  } else if (supplier.lead_time_days > stockoutDays) {
    needsExpedite = !!supplier.expedite_available && (supplier.expedite_lead_time_days ?? 99) < stockoutDays;
    rationale.push(
      `Standard lead time of ${supplier.lead_time_days}d exceeds the ~${stockoutDays}-day runway.` +
        (needsExpedite ? " Expediting to close the gap." : " No expedite option available."),
    );
  }

  const fit = fitToConstraints({
    supplier, nodeId, productId,
    desiredQty: net.netRequirement,
    dailyDemand: demand.plannedDailyDemand,
    expedite: needsExpedite,
  });
  rationale.push(...fit.notes);

  const unit = supplier.unit_price * (needsExpedite ? 1 + supplier.expedite_surcharge_pct / 100 : 1);

  return {
    decision: fit.qty === 0 ? "ESCALATE" : needsExpedite ? "EXPEDITE" : "MODIFY",
    action:
      fit.qty > 0
        ? {
            kind: "create_po", supplier_id: supplier.supplier_id, node_id: nodeId,
            product_id: productId, qty: fit.qty, expedite: needsExpedite,
            reason: `Demand shifted to ${demand.plannedDailyDemand}/day; existing supply leaves a ${net.netRequirement}-unit gap.`,
          }
        : { kind: "escalate", reason: `Confirmed demand shift but no feasible order (binding: ${fit.validation.bindingConstraint}).` },
    followUpActions: [],
    recommendedQty: fit.qty,
    supplierId: supplier.supplier_id,
    confidence: scoreConfidence({
      validation: fit.validation, dataPoints: demand.points.length,
      cv: stats.cv, qty: fit.qty,
    }),
    rationale,
    keyFactors,
    netRequirement: net,
    validation: fit.validation,
    demandSignal: {
      plannedDailyDemand: demand.plannedDailyDemand,
      baselineForecast: demand.baselineForecast,
      recentActualDaily: stats.last7Mean,
      shift,
    },
    orderValue: round2(fit.qty * unit),
    alternatives: describeAlternatives(productId, supplier.supplier_id),
  };
}

// ===========================================================================
// SCENARIO 4 — Purchase blocked by a constraint
// ===========================================================================

export function planConstrainedPurchase(args: {
  nodeId: string;
  productId: string;
  desiredQty?: number;
  supplierId?: string;
}): PolicyOutcome {
  const { nodeId, productId } = args;
  const rationale: string[] = [];
  const keyFactors: KeyFactor[] = [];

  const product = getProduct(productId);
  const node = getNode(nodeId);
  const inventory = getInventory(nodeId, productId);
  const budget = getBudget(nodeId);
  if (!product || !node || !inventory) return bail("Reference data missing.");

  const demand = resolvePlanningDemand(nodeId, productId);
  const supplier = chooseSupplier(productId, args.supplierId);
  if (!supplier) return bail(`No active supplier lists ${product.sku}.`);

  const net = computeNetRequirement({
    inventory,
    dailyDemand: demand.plannedDailyDemand,
    leadTimeDays: supplier.lead_time_days,
    reviewPeriodDays: REVIEW_PERIOD_DAYS,
  });
  const desired = args.desiredQty ?? net.netRequirement;
  rationale.push(...net.workings);
  rationale.push(`Target purchase quantity: ${desired} units from ${supplier.supplier.name}.`);

  // Validate the *full* desired quantity first so we can name what blocks it.
  const shaped = shapeOrderQty(desired, supplier);
  const fullValidation = validatePurchase({
    supplier_id: supplier.supplier_id, node_id: nodeId, product_id: productId,
    qty: shaped.shapedQty, dailyDemand: demand.plannedDailyDemand,
  });

  keyFactors.push(
    { label: "Desired quantity", value: `${shaped.shapedQty} units`, impact: "neutral" },
    { label: "Max feasible", value: `${fullValidation.maxFeasibleQty} units`, impact: fullValidation.maxFeasibleQty < shaped.shapedQty ? "opposes" : "supports" },
  );
  if (budget) {
    keyFactors.push({ label: "Budget available", value: `$${budgetAvailable(budget).toFixed(2)}`, impact: "neutral" });
  }
  keyFactors.push({ label: "Storage free", value: `${storageFreeSlots(node).toFixed(0)} slots`, impact: "neutral" });

  // --- Unblocked: just buy it --------------------------------------------
  if (fullValidation.passed) {
    rationale.push(`All hard constraints clear for ${shaped.shapedQty} units — no constraint resolution needed.`);
    return {
      decision: "ACCEPT",
      action: {
        kind: "create_po", supplier_id: supplier.supplier_id, node_id: nodeId,
        product_id: productId, qty: shaped.shapedQty,
        reason: `Replenish ${product.sku}; no binding constraints.`,
      },
      followUpActions: [],
      recommendedQty: shaped.shapedQty,
      supplierId: supplier.supplier_id,
      confidence: scoreConfidence({ validation: fullValidation, dataPoints: demand.points.length, cv: demand.stats.cv, qty: shaped.shapedQty }),
      rationale, keyFactors, netRequirement: net, validation: fullValidation,
      demandSignal: {
        plannedDailyDemand: demand.plannedDailyDemand,
        baselineForecast: demand.baselineForecast,
        recentActualDaily: demand.stats.last7Mean, shift: demand.shift,
      },
      orderValue: round2(shaped.shapedQty * supplier.unit_price),
      alternatives: describeAlternatives(productId, supplier.supplier_id),
    };
  }

  // --- Blocked: name the constraint and design around it ------------------
  for (const f of fullValidation.hardFailures) {
    rationale.push(`BLOCKED by ${f.code}: ${f.detail}`);
  }
  rationale.push(
    `Binding constraint is ${fullValidation.bindingConstraint}. Largest executable quantity is ${fullValidation.maxFeasibleQty} units.`,
  );

  const feasible = fullValidation.maxFeasibleQty;
  const residual = shaped.shapedQty - feasible;
  const followUps: ProposedAction[] = [];

  // Option 1 — nothing at all can be ordered. Escalate with specifics.
  if (feasible === 0) {
    const shortfallNote =
      fullValidation.hardFailures.find((f) => f.code === "BUDGET")
        ? `Budget of $${budget ? budgetAvailable(budget).toFixed(2) : "0"} cannot fund even the ${supplier.moq}-unit MOQ ($${(supplier.moq * supplier.unit_price).toFixed(2)}).`
        : `Available storage cannot hold even the ${supplier.moq}-unit MOQ.`;
    rationale.push(shortfallNote);

    // Can another node take the whole order instead?
    const altNode = findNodeWithCapacity(productId, supplier.moq, nodeId);
    if (altNode) {
      rationale.push(
        `${altNode.name} has ${storageFreeSlots(altNode).toFixed(0)} free slots and could receive the order instead, subject to transfer cost approval.`,
      );
    }
    return {
      decision: "ESCALATE",
      action: {
        kind: "escalate",
        reason: `${product.sku} at ${node.name}: ${shortfallNote} Requires a budget uplift, storage release${altNode ? `, or redirection to ${altNode.name}` : ""}.`,
      },
      followUpActions: [],
      recommendedQty: 0,
      supplierId: supplier.supplier_id,
      confidence: 0.82,
      rationale, keyFactors, netRequirement: net, validation: fullValidation,
      demandSignal: {
        plannedDailyDemand: demand.plannedDailyDemand,
        baselineForecast: demand.baselineForecast,
        recentActualDaily: demand.stats.last7Mean, shift: demand.shift,
      },
      orderValue: 0,
      alternatives: describeAlternatives(productId, supplier.supplier_id),
    };
  }

  // Option 2 — partial order now, plan the remainder.
  rationale.push(
    `Executing a partial order of ${feasible} units now (${((feasible / shaped.shapedQty) * 100).toFixed(0)}% of target), leaving ${residual} units unmet.`,
  );

  const coverAfter = daysOfCoverAfter({ inventory, incomingQty: feasible, dailyDemand: demand.plannedDailyDemand });
  rationale.push(`That yields ${coverAfter} days of cover versus the ${net.horizonDays}-day protection horizon.`);

  // Can a sibling node absorb the residual?
  const altNode = findNodeWithCapacity(productId, residual, nodeId);
  if (altNode && fullValidation.bindingConstraint === "STORAGE") {
    rationale.push(
      `Storage is the binding constraint. ${altNode.name} has ${storageFreeSlots(altNode).toFixed(0)} free slots — proposing the ${residual}-unit balance be delivered there and transferred as capacity frees up.`,
    );
    const altShaped = shapeOrderQty(residual, supplier);
    const altValidation = validatePurchase({
      supplier_id: supplier.supplier_id, node_id: altNode.id, product_id: productId,
      qty: altShaped.shapedQty, dailyDemand: demand.plannedDailyDemand,
    });
    if (altValidation.passed) {
      followUps.push({
        kind: "create_po", supplier_id: supplier.supplier_id, node_id: altNode.id,
        product_id: productId, qty: altShaped.shapedQty,
        reason: `Overflow of ${residual} units redirected to ${altNode.name}, which has spare storage.`,
      });
      keyFactors.push({ label: "Overflow node", value: altNode.name, impact: "supports" });
    } else {
      rationale.push(`${altNode.name} cannot take the balance either (${altValidation.bindingConstraint}).`);
    }
  } else if (fullValidation.bindingConstraint === "BUDGET") {
    rationale.push(
      `Budget is the binding constraint. The ${residual}-unit balance should be re-queued for the next budget period rather than sourced now.`,
    );
    keyFactors.push({ label: "Deferred to next period", value: `${residual} units`, impact: "neutral" });
  }

  const finalValidation = validatePurchase({
    supplier_id: supplier.supplier_id, node_id: nodeId, product_id: productId,
    qty: feasible, dailyDemand: demand.plannedDailyDemand,
  });

  return {
    decision: "MODIFY",
    action: {
      kind: "create_po", supplier_id: supplier.supplier_id, node_id: nodeId,
      product_id: productId, qty: feasible,
      reason: `Constraint-capped order: ${feasible} of ${shaped.shapedQty} units (limited by ${fullValidation.bindingConstraint}).`,
    },
    followUpActions: followUps,
    recommendedQty: feasible,
    supplierId: supplier.supplier_id,
    confidence: scoreConfidence({ validation: finalValidation, dataPoints: demand.points.length, cv: demand.stats.cv, qty: feasible }),
    rationale, keyFactors, netRequirement: net, validation: finalValidation,
    demandSignal: {
      plannedDailyDemand: demand.plannedDailyDemand,
      baselineForecast: demand.baselineForecast,
      recentActualDaily: demand.stats.last7Mean, shift: demand.shift,
    },
    orderValue: round2(feasible * supplier.unit_price),
    alternatives: describeAlternatives(productId, supplier.supplier_id),
  };
}

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

function daysUntil(dateIso: string): number {
  const t = new Date(today() + "T00:00:00Z").getTime();
  const d = new Date(dateIso + "T00:00:00Z").getTime();
  return Math.round((d - t) / 86_400_000);
}

function nextArrivalDays(openPos: { expected_delivery: string | null }[]): number | null {
  const dates = openPos.map((p) => p.expected_delivery).filter((d): d is string => !!d).sort();
  return dates.length ? daysUntil(dates[0]) : null;
}

/**
 * Confidence reflects how much we trust the decision, not how much we like it.
 * Soft warnings, noisy demand and thin history all reduce it; that in turn
 * trips the autonomy gate and routes the decision to a human.
 */
function scoreConfidence(args: {
  validation: ValidationResult | null;
  dataPoints: number;
  cv: number;
  qty: number;
}): number {
  let c = 0.95;
  if (args.validation) {
    c -= args.validation.softWarnings.length * 0.08;
    c -= args.validation.hardFailures.length * 0.25;
  }
  if (args.dataPoints < 21) c -= 0.1;
  if (args.dataPoints < 14) c -= 0.15;
  if (args.cv > 0.5) c -= 0.1;   // very noisy demand
  if (args.cv > 0.8) c -= 0.1;
  if (args.qty === 0) c -= 0.05;
  return round2(Math.max(0.2, Math.min(0.98, c)));
}

function finishNoAction(
  decision: DecisionKind,
  reason: string,
  rationale: string[],
  keyFactors: KeyFactor[],
  demand: ReturnType<typeof resolvePlanningDemand>,
  confidence: number,
): PolicyOutcome {
  return {
    decision,
    action: { kind: "no_action", reason },
    followUpActions: [],
    recommendedQty: 0,
    supplierId: null,
    confidence,
    rationale,
    keyFactors,
    netRequirement: null,
    validation: null,
    demandSignal: {
      plannedDailyDemand: demand.plannedDailyDemand,
      baselineForecast: demand.baselineForecast,
      recentActualDaily: demand.stats.last7Mean,
      shift: demand.shift,
    },
    orderValue: 0,
    alternatives: [],
  };
}

function bail(reason: string): PolicyOutcome {
  return {
    decision: "ESCALATE",
    action: { kind: "escalate", reason },
    followUpActions: [],
    recommendedQty: 0,
    supplierId: null,
    confidence: 0.3,
    rationale: [reason],
    keyFactors: [],
    netRequirement: null,
    validation: null,
    demandSignal: { plannedDailyDemand: 0, baselineForecast: 0, recentActualDaily: 0, shift: null },
    orderValue: 0,
    alternatives: [],
  };
}

export { resolvePlanningDemand, chooseSupplier, fitToConstraints, addDays };
