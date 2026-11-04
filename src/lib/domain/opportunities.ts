/**
 * Opportunity sweep — the proactive half of the buyer's job.
 *
 * The four assignment scenarios are all *reactive*: something lands on the
 * buyer's desk and the agent responds to it. But the larger part of a real
 * buyer's day is noticing the things nobody flagged. The assignment's optional
 * section lists exactly those: open purchase orders, supplier reliability,
 * alternate suppliers, promotional buying, forecast anomalies, replenishment,
 * safety stock, seasonal demand.
 *
 * This module sweeps the whole portfolio and surfaces them. Critically it
 * reuses the *same* primitives the scenario agent uses — `computeNetRequirement`,
 * `detectDemandShift`, `spoilageRisk`, `listSupplierOptions` — so a finding here
 * is computed the same way the agent would compute it, and every finding links
 * to the scenario that would resolve it. The sweep detects and prioritises;
 * the agent decides and acts.
 *
 * Nothing in this file writes. Detection is separated from action on purpose:
 * a sweep that silently placed orders across the catalogue is exactly the kind
 * of unbounded autonomy the rest of the system is built to prevent.
 */

import {
  addDays,
  budgetAvailable,
  daysBetween,
  getActivePromotions,
  getBudget,
  getDemandHistory,
  getForecast,
  getInventory,
  getPolicies,
  getProduct,
  getSupplier,
  listInventory,
  listNodes,
  listPos,
  listSupplierEvents,
  listSupplierOptions,
  storageFreeSlots,
  today,
} from "@/lib/db/repo";
import {
  computeNetRequirement,
  demandStats,
  detectDemandShift,
  round2,
  shapeOrderQty,
  spoilageRisk,
} from "./math";
import { REVIEW_PERIOD_DAYS } from "./policy";
import type { PurchaseOrderWithLines } from "./types";

export type OpportunityKind =
  | "replenishment"
  | "open_po"
  | "supplier_reliability"
  | "forecast_anomaly"
  | "safety_stock"
  | "overstock";

export type OpportunitySeverity = "critical" | "high" | "medium" | "low";

export type Opportunity = {
  id: string;
  kind: OpportunityKind;
  severity: OpportunitySeverity;
  title: string;
  /** One-line statement of why this matters commercially. */
  headline: string;
  nodeId: string | null;
  nodeName: string | null;
  productId: string | null;
  sku: string | null;
  /** The numbers behind the finding, each already formatted for display. */
  evidence: string[];
  /** What a buyer (or the agent) should do about it. */
  suggestedAction: string;
  /**
   * Money the finding puts at risk — lost margin on a stockout, cash tied up
   * in overstock, or exposure on an undelivered order. Used for ranking.
   */
  valueAtRisk: number;
  /** Deep link into the scenario runner that would resolve this finding. */
  handoff: { scenario: string; label: string; params: Record<string, unknown> } | null;
};

export type OpportunityReport = {
  generatedAt: string;
  simulatedToday: string;
  scanned: { positions: number; purchaseOrders: number; suppliers: number };
  opportunities: Opportunity[];
  byKind: Record<OpportunityKind, number>;
  totalValueAtRisk: number;
};

const SEVERITY_RANK: Record<OpportunitySeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** Cheapest unit price we could currently buy this product for. */
function cheapestUnitPrice(productId: string): number {
  const options = listSupplierOptions(productId);
  if (!options.length) return 0;
  return Math.min(...options.map((o) => o.unit_price));
}

// ---------------------------------------------------------------------------
// 1. Replenishment — what needs buying that nobody has asked about
// ---------------------------------------------------------------------------

function sweepReplenishment(): Opportunity[] {
  const found: Opportunity[] = [];

  for (const inv of listInventory()) {
    const forecast = getForecast(inv.node_id, inv.product_id);
    const points = getDemandHistory(inv.node_id, inv.product_id, 35);
    const promos = getActivePromotions(inv.node_id, inv.product_id);
    const baseline = forecast?.daily_forecast ?? 0;
    const stats = demandStats(points, baseline);
    const shift = detectDemandShift({ points, forecast, promotions: promos });

    // Plan at the shifted rate if the shift is real; promotional lift is
    // temporary and must not inflate a replenishment buy.
    const dailyDemand = shift.shiftDetected ? shift.recommendedDailyForecast : baseline;
    if (dailyDemand <= 0) continue;

    const options = listSupplierOptions(inv.product_id);
    if (!options.length) continue;
    const preferred = options.find((o) => o.is_preferred === 1) ?? options[0];

    const req = computeNetRequirement({
      inventory: inv,
      dailyDemand,
      leadTimeDays: preferred.lead_time_days,
      reviewPeriodDays: REVIEW_PERIOD_DAYS,
    });

    if (req.netRequirement <= 0) continue;

    const shaped = shapeOrderQty(req.netRequirement, preferred);
    const cost = round2(shaped.shapedQty * preferred.unit_price);
    const stockoutDays = req.projectedStockoutInDays;

    // Urgency is driven by whether we run dry before replenishment can land.
    const coversBeforeLandfall =
      stockoutDays !== null && stockoutDays < preferred.lead_time_days;
    const severity: OpportunitySeverity =
      stockoutDays !== null && stockoutDays <= 3
        ? "critical"
        : coversBeforeLandfall
          ? "high"
          : req.currentDaysOfCover < REVIEW_PERIOD_DAYS
            ? "medium"
            : "low";

    // Lost-sales exposure: demand we cannot serve between stockout and arrival.
    const uncoveredDays = coversBeforeLandfall
      ? preferred.lead_time_days - (stockoutDays ?? 0)
      : 0;
    const valueAtRisk = round2(uncoveredDays * dailyDemand * preferred.unit_price);

    found.push({
      id: `repl-${inv.node_id}-${inv.product_id}`,
      kind: "replenishment",
      severity,
      title: `${inv.sku} needs replenishment at ${inv.node_name}`,
      headline: coversBeforeLandfall
        ? `Projected to run out in ${stockoutDays}d but the lead time is ${preferred.lead_time_days}d — a gap of ${uncoveredDays}d with no stock.`
        : `Net requirement of ${req.netRequirement} units over the ${req.horizonDays}-day protection horizon.`,
      nodeId: inv.node_id,
      nodeName: inv.node_name,
      productId: inv.product_id,
      sku: inv.sku,
      evidence: [
        ...req.workings,
        `Available to promise: ${req.availableToPromise} units = ${req.currentDaysOfCover}d of cover.`,
        shift.shiftDetected
          ? `Planning at the shifted rate of ${dailyDemand}/day, not the stale ${baseline}/day baseline.`
          : `Planning at the forecast baseline of ${baseline}/day (recent actual ${stats.last7Mean}/day).`,
        `Cheapest route: ${preferred.supplier.name} at $${preferred.unit_price.toFixed(2)}/unit, ${preferred.lead_time_days}d lead time.`,
        `Shaped to supplier terms: ${shaped.shapedQty} units (${shaped.adjustments.join('; ') || 'no adjustment needed'}) ≈ $${cost.toLocaleString()}.`,
      ],
      suggestedAction: `Raise a purchase order for ${shaped.shapedQty} units with ${preferred.supplier.name}.`,
      valueAtRisk,
      handoff: {
        scenario: "recommendation_review",
        label: "Review as a purchase recommendation",
        params: {
          scenario: "recommendation_review",
          node_id: inv.node_id,
          product_id: inv.product_id,
          recommended_qty: shaped.shapedQty,
          supplier_id: preferred.supplier_id,
        },
      },
    });
  }

  return found;
}

// ---------------------------------------------------------------------------
// 2. Open purchase orders — the ones already placed and quietly going wrong
// ---------------------------------------------------------------------------

function sweepOpenPos(pos: PurchaseOrderWithLines[]): Opportunity[] {
  const found: Opportunity[] = [];
  const now = today();

  // --- Unactioned supplier messages ----------------------------------------
  // A supplier telling us it cannot fulfil is worthless if nobody reads it.
  // This is the inbox that Scenario 2 exists to clear.
  for (const event of listSupplierEvents(true)) {
    const supplier = getSupplier(event.supplier_id);
    const po = event.po_id ? pos.find((p) => p.id === event.po_id) : null;
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(event.payload_json) as Record<string, unknown>;
    } catch {
      payload = {};
    }
    const availableQty =
      typeof payload.confirmable_qty === "number"
        ? payload.confirmable_qty
        : typeof payload.available_qty === "number"
          ? payload.available_qty
          : null;
    const line =
      (typeof payload.product_id === "string"
        ? po?.lines.find((l) => l.product_id === payload.product_id)
        : undefined) ?? po?.lines[0];
    const orderedQty =
      typeof payload.ordered_qty === "number" ? payload.ordered_qty : (line?.qty_ordered ?? null);
    const product = line ? getProduct(line.product_id) : null;
    const node = po ? listNodes().find((n) => n.id === po.node_id) : null;

    found.push({
      id: `evt-${event.id}`,
      kind: "open_po",
      severity: event.event_type === "cancellation" ? "critical" : "high",
      title: `Unactioned ${event.event_type.replace(/_/g, " ")} from ${supplier?.name ?? event.supplier_id}`,
      headline:
        availableQty !== null && orderedQty !== null
          ? `${po?.po_number ?? "An open order"} was placed for ${orderedQty} units; the supplier can only supply ${availableQty}.`
          : `${supplier?.name ?? event.supplier_id} has sent a ${event.event_type.replace(/_/g, " ")} that has not been processed.`,
      nodeId: po?.node_id ?? null,
      nodeName: node?.name ?? null,
      productId: line?.product_id ?? null,
      sku: product?.sku ?? null,
      evidence: [
        `Event ${event.id} received ${event.created_at.slice(0, 10)}, still unprocessed.`,
        typeof payload.reason === "string" ? `Supplier reason: ${payload.reason}` : "No reason given.",
        orderedQty !== null && availableQty !== null
          ? `Gap of ${orderedQty - availableQty} units against ${po?.po_number}.`
          : "No quantity detail on the event payload.",
        `Inbound stock still reflects the full ordered quantity until this is actioned, so cover is currently overstated.`,
      ],
      suggestedAction:
        availableQty !== null
          ? `Run the shortfall resolver: amend to ${availableQty} and decide whether to re-source the balance.`
          : `Process the event and re-plan the affected line.`,
      valueAtRisk:
        orderedQty !== null && availableQty !== null && line
          ? round2((orderedQty - availableQty) * line.unit_price)
          : 0,
      handoff:
        po && availableQty !== null
          ? {
              scenario: "supplier_shortfall",
              label: "Resolve the shortfall",
              params: {
                scenario: "supplier_shortfall",
                po_id: po.id,
                product_id: line?.product_id ?? "",
                confirmed_qty: availableQty,
                event_id: event.id,
              },
            }
          : null,
    });
  }

  for (const po of pos) {
    if (po.status === "received" || po.status === "cancelled") continue;

    const supplier = getSupplier(po.supplier_id);
    const supplierName = supplier?.name ?? po.supplier_id;

    for (const line of po.lines) {
      const product = getProduct(line.product_id);
      const sku = product?.sku ?? line.product_id;
      const inv = getInventory(po.node_id, line.product_id);
      const node = listNodes().find((n) => n.id === po.node_id);

      // --- 2a. Confirmed short of what was ordered -------------------------
      const shortfall = line.qty_ordered - line.qty_confirmed;
      if (po.status === "partially_confirmed" && shortfall > 0) {
        const forecast = getForecast(po.node_id, line.product_id);
        const dailyDemand = forecast?.daily_forecast ?? 0;
        // A shortfall only matters if it leaves a genuine requirement open.
        const stillShort =
          inv && dailyDemand > 0
            ? computeNetRequirement({
                inventory: inv,
                dailyDemand,
                leadTimeDays: supplier?.avg_lead_time_days ?? 7,
                reviewPeriodDays: REVIEW_PERIOD_DAYS,
              }).netRequirement
            : 0;

        found.push({
          id: `po-short-${po.id}-${line.id}`,
          kind: "open_po",
          severity: stillShort > 0 ? "high" : "low",
          title: `${po.po_number} confirmed ${line.qty_confirmed} of ${line.qty_ordered} ${sku}`,
          headline:
            stillShort > 0
              ? `${shortfall} units short, and ${stillShort} units of requirement remain uncovered.`
              : `${shortfall} units short, but current stock still covers the horizon — no action needed.`,
          nodeId: po.node_id,
          nodeName: node?.name ?? po.node_id,
          productId: line.product_id,
          sku,
          evidence: [
            `${supplierName} confirmed ${line.qty_confirmed} against an order of ${line.qty_ordered}.`,
            `Fill rate on this line: ${((line.qty_confirmed / line.qty_ordered) * 100).toFixed(0)}%.`,
            inv
              ? `Position at ${node?.name ?? po.node_id}: ${inv.on_hand} on hand, ${inv.in_transit} inbound, ${inv.reserved} reserved.`
              : "No stock record for this node/product pair.",
            stillShort > 0
              ? `Re-running the requirement maths against actual stock still shows a gap of ${stillShort} units.`
              : `Re-running the requirement maths shows no outstanding gap — the shortfall is benign.`,
          ],
          suggestedAction:
            stillShort > 0
              ? `Source the remaining ${shortfall} units elsewhere, or confirm existing cover is sufficient.`
              : "Record and monitor. No replacement order required.",
          valueAtRisk: stillShort > 0 ? round2(shortfall * line.unit_price) : 0,
          handoff:
            stillShort > 0
              ? {
                  scenario: "supplier_shortfall",
                  label: "Resolve the shortfall",
                  params: {
                    scenario: "supplier_shortfall",
                    po_id: po.id,
                    product_id: line.product_id,
                    confirmed_qty: line.qty_confirmed,
                  },
                }
              : null,
        });
      }

      // --- 2b. Overdue ------------------------------------------------------
      if (po.expected_delivery && po.expected_delivery < now) {
        const daysLate = daysBetween(po.expected_delivery, now);
        found.push({
          id: `po-late-${po.id}-${line.id}`,
          kind: "open_po",
          severity: daysLate > 7 ? "high" : "medium",
          title: `${po.po_number} is ${daysLate}d overdue`,
          headline: `${line.qty_ordered} units of ${sku} were due ${po.expected_delivery} and have not arrived.`,
          nodeId: po.node_id,
          nodeName: node?.name ?? po.node_id,
          productId: line.product_id,
          sku,
          evidence: [
            `Expected ${po.expected_delivery}, now ${now} — ${daysLate} days late.`,
            `${supplierName} stated lead time is ${supplier?.avg_lead_time_days ?? "?"}d.`,
            `Inbound stock still counts these ${line.qty_ordered} units as available to promise, which may be optimistic.`,
          ],
          suggestedAction: `Chase ${supplierName}, and consider whether inbound quantity should still be trusted in the cover calculation.`,
          valueAtRisk: round2(line.qty_ordered * line.unit_price),
          handoff: null,
        });
      }
    }
  }

  return found;
}

// ---------------------------------------------------------------------------
// 3. Supplier reliability — stated score vs what actually happened
// ---------------------------------------------------------------------------

function sweepSupplierReliability(pos: PurchaseOrderWithLines[]): Opportunity[] {
  const found: Opportunity[] = [];

  // Aggregate realised fill rate per supplier from the order book.
  const tally = new Map<string, { ordered: number; confirmed: number; lines: number }>();
  for (const po of pos) {
    if (po.status === "draft" || po.status === "cancelled") continue;
    for (const line of po.lines) {
      const t = tally.get(po.supplier_id) ?? { ordered: 0, confirmed: 0, lines: 0 };
      t.ordered += line.qty_ordered;
      t.confirmed += line.qty_confirmed;
      t.lines += 1;
      tally.set(po.supplier_id, t);
    }
  }

  for (const [supplierId, t] of tally) {
    if (t.ordered === 0) continue;
    const supplier = getSupplier(supplierId);
    if (!supplier) continue;

    const realised = t.confirmed / t.ordered;
    const stated = supplier.reliability_score;
    const gap = stated - realised;

    // Only interesting if the supplier is materially worse than advertised.
    if (gap < 0.1) continue;

    found.push({
      id: `rel-${supplierId}`,
      kind: "supplier_reliability",
      severity: realised < 0.5 ? "high" : "medium",
      title: `${supplier.name} is under-delivering against its reliability score`,
      headline: `Stated fill rate ${(stated * 100).toFixed(0)}%, realised ${(realised * 100).toFixed(0)}% across ${t.lines} order line${t.lines === 1 ? "" : "s"}.`,
      nodeId: null,
      nodeName: null,
      productId: null,
      sku: null,
      evidence: [
        `Ordered ${t.ordered} units in total; ${t.confirmed} confirmed.`,
        `Realised fill rate ${(realised * 100).toFixed(1)}% vs stated ${(stated * 100).toFixed(1)}% — a ${(gap * 100).toFixed(1)}pt gap.`,
        `Planning currently sizes orders using the stated score, so requirements sourced here are being systematically under-filled.`,
        `Lead time ${supplier.avg_lead_time_days}d ±${supplier.lead_time_stddev_days}.`,
      ],
      suggestedAction: `Revise ${supplier.name}'s reliability score toward the realised rate, and prefer an alternate supplier for time-critical lines until it recovers.`,
      // Exposure = units that historically failed to arrive, at their order price.
      valueAtRisk: round2(
        (t.ordered - t.confirmed) *
          (cheapestUnitPrice(
            pos.find((p) => p.supplier_id === supplierId)?.lines[0]?.product_id ?? "",
          ) || 0),
      ),
      handoff: null,
    });
  }

  return found;
}

// ---------------------------------------------------------------------------
// 4. Forecast anomalies — the planning baseline has drifted from reality
// ---------------------------------------------------------------------------

function sweepForecastAnomalies(): Opportunity[] {
  const found: Opportunity[] = [];

  for (const inv of listInventory()) {
    const forecast = getForecast(inv.node_id, inv.product_id);
    if (!forecast || forecast.daily_forecast <= 0) continue;

    const points = getDemandHistory(inv.node_id, inv.product_id, 35);
    const promos = getActivePromotions(inv.node_id, inv.product_id);
    const baseline = forecast.daily_forecast;
    const stats = demandStats(points, baseline);
    const shift = detectDemandShift({ points, forecast, promotions: promos });

    const ratio = stats.trendRatio;
    const divergent = ratio >= 1.4 || (ratio > 0 && ratio <= 0.65);
    if (!divergent) continue;

    const promoExplained = shift.explainedByPromotion;
    const direction = ratio >= 1.4 ? "above" : "below";
    const price = cheapestUnitPrice(inv.product_id);
    const dailyGap = Math.abs(stats.last7Mean - baseline);

    found.push({
      id: `fc-${inv.node_id}-${inv.product_id}`,
      kind: "forecast_anomaly",
      // A promo-explained spike is a *low* finding: it is working as intended.
      // The anomaly worth a buyer's attention is the unexplained one.
      severity: promoExplained ? "low" : shift.shiftDetected ? "high" : "medium",
      title: promoExplained
        ? `${inv.sku} is running hot at ${inv.node_name} — explained by a promotion`
        : `${inv.sku} forecast at ${inv.node_name} is ${direction} actual demand`,
      headline: promoExplained
        ? `Demand is ${ratio}x baseline, but "${shift.promotion?.description ?? "an active promotion"}" accounts for it. The baseline should NOT be rebased.`
        : `Actual demand is running at ${ratio}x the planning baseline with no promotion to explain it.`,
      nodeId: inv.node_id,
      nodeName: inv.node_name,
      productId: inv.product_id,
      sku: inv.sku,
      evidence: [
        `Planning baseline: ${baseline}/day (model ${forecast.model_version}, generated ${forecast.generated_at.slice(0, 10)}).`,
        `Trailing 7-day actual: ${stats.last7Mean}/day — ratio ${ratio}x.`,
        `Sustained elevation: ${shift.consecutiveElevatedDays} consecutive days. z-score ${shift.zScoreOfLast7}.`,
        promoExplained
          ? `Attributed to ${shift.promotion?.id ?? "promotion"} (+${shift.promotion?.uplift_pct ?? 0}% expected uplift, ends ${shift.promotion?.end_date ?? "?"}).`
          : `No active promotion covers this window — the lift is unexplained.`,
        ...shift.reasons.map((r) => `Gate: ${r}`),
      ],
      suggestedAction: promoExplained
        ? `Plan short-term cover for the promotion window only. Do not rebase the forecast — the agent's update_forecast_baseline tool will refuse it.`
        : shift.shiftDetected
          ? `Rebase the forecast to ~${shift.recommendedDailyForecast}/day and re-plan the purchasing position.`
          : `Investigate before acting — the lift is divergent but has not cleared every evidence gate.`,
      valueAtRisk: round2(dailyGap * REVIEW_PERIOD_DAYS * price),
      handoff: {
        scenario: "demand_shift",
        label: "Investigate the demand change",
        params: {
          scenario: "demand_shift",
          node_id: inv.node_id,
          product_id: inv.product_id,
        },
      },
    });
  }

  return found;
}

// ---------------------------------------------------------------------------
// 5. Safety stock — set from a round number rather than from demand variability
// ---------------------------------------------------------------------------

function sweepSafetyStock(): Opportunity[] {
  const found: Opportunity[] = [];

  for (const inv of listInventory()) {
    const forecast = getForecast(inv.node_id, inv.product_id);
    const baseline = forecast?.daily_forecast ?? 0;
    if (baseline <= 0) continue;

    const points = getDemandHistory(inv.node_id, inv.product_id, 35);
    const stats = demandStats(points, baseline);
    const options = listSupplierOptions(inv.product_id);
    if (!options.length) continue;
    const preferred = options.find((o) => o.is_preferred === 1) ?? options[0];
    const supplier = preferred.supplier;

    // Textbook safety stock for a target service level of ~95% (z = 1.65),
    // accounting for both demand variability and lead-time variability.
    const sigmaD = stats.dailyStdDev;
    const lt = preferred.lead_time_days;
    const sigmaLt = supplier.lead_time_stddev_days;
    const suggested = Math.ceil(
      1.65 * Math.sqrt(lt * sigmaD * sigmaD + stats.dailyMean * stats.dailyMean * sigmaLt * sigmaLt),
    );

    const current = inv.safety_stock;
    if (current === 0 && suggested === 0) continue;

    const delta = suggested - current;
    // Only surface a material mis-set, in either direction.
    if (Math.abs(delta) < Math.max(20, current * 0.35)) continue;

    const price = cheapestUnitPrice(inv.product_id);
    const under = delta > 0;

    found.push({
      id: `ss-${inv.node_id}-${inv.product_id}`,
      kind: "safety_stock",
      severity: under ? "medium" : "low",
      title: `${inv.sku} safety stock at ${inv.node_name} looks ${under ? "too low" : "too high"}`,
      headline: under
        ? `Holding ${current} units of buffer against demand and lead-time variability that implies ${suggested}.`
        : `Holding ${current} units of buffer where ${suggested} would meet the same service level — ${Math.abs(delta)} units of cash tied up.`,
      nodeId: inv.node_id,
      nodeName: inv.node_name,
      productId: inv.product_id,
      sku: inv.sku,
      evidence: [
        `Demand variability: mean ${stats.dailyMean}/day, standard deviation ${round2(sigmaD)}.`,
        `Lead-time variability: ${lt}d ±${sigmaLt} from ${supplier.name}.`,
        `Safety stock for ~95% service = 1.65 x √(${lt}·σd² + μ²·σlt²) = ${suggested} units.`,
        `Currently set to ${current} units — a ${under ? "shortfall" : "surplus"} of ${Math.abs(delta)}.`,
        `This is the limitation the README calls out: safety stock is a fixed per-line figure, not derived. This sweep derives it.`,
      ],
      suggestedAction: under
        ? `Raise safety stock to ~${suggested} units to hold the service level through lead-time variability.`
        : `Lower safety stock to ~${suggested} units and release the working capital.`,
      valueAtRisk: round2(Math.abs(delta) * price),
      handoff: null,
    });
  }

  return found;
}

// ---------------------------------------------------------------------------
// 6. Overstock and spoilage — cash and shelf life going the wrong way
// ---------------------------------------------------------------------------

function sweepOverstock(): Opportunity[] {
  const found: Opportunity[] = [];
  const policies = getPolicies();
  const overstockDays = policies.overstock_days_threshold ?? 45;

  for (const inv of listInventory()) {
    const forecast = getForecast(inv.node_id, inv.product_id);
    const baseline = forecast?.daily_forecast ?? 0;
    if (baseline <= 0) continue;

    const atp = inv.on_hand + inv.in_transit - inv.reserved;
    const cover = round2(atp / baseline);
    const product = getProduct(inv.product_id);
    const spoil = spoilageRisk({
      qty: inv.in_transit,
      dailyDemand: baseline,
      shelfLifeDays: product?.shelf_life_days ?? null,
      onHand: inv.on_hand,
    });

    if (cover <= overstockDays && !spoil.atRisk) continue;

    const price = cheapestUnitPrice(inv.product_id);
    const excessUnits = Math.max(0, Math.round(atp - baseline * overstockDays));

    found.push({
      id: `over-${inv.node_id}-${inv.product_id}`,
      kind: "overstock",
      severity: spoil.atRisk ? "high" : "low",
      title: spoil.atRisk
        ? `${inv.sku} at ${inv.node_name} may expire before it sells`
        : `${inv.sku} at ${inv.node_name} is overstocked`,
      headline: spoil.atRisk
        ? spoil.note
        : `${cover}d of cover against a ${overstockDays}d threshold — ${excessUnits} units of excess.`,
      nodeId: inv.node_id,
      nodeName: inv.node_name,
      productId: inv.product_id,
      sku: inv.sku,
      evidence: [
        `Available to promise ${atp} units at ${baseline}/day = ${cover}d of cover.`,
        `Overstock threshold is ${overstockDays}d (agent_policies.overstock_days_threshold).`,
        product?.shelf_life_days
          ? `Shelf life ${product.shelf_life_days}d. ${spoil.note}`
          : "Non-perishable — no spoilage exposure.",
        `Storage held: ${round2(atp * (product?.slots_per_unit ?? 1))} slots.`,
      ],
      suggestedAction: spoil.atRisk
        ? `Promote or redistribute before expiry, and suppress further replenishment on this line.`
        : `Suppress replenishment until cover falls below ${overstockDays}d; the slots and cash are better used elsewhere.`,
      valueAtRisk: round2(excessUnits * price),
      handoff: null,
    });
  }

  return found;
}

// ---------------------------------------------------------------------------
// Sweep
// ---------------------------------------------------------------------------

export function runOpportunitySweep(): OpportunityReport {
  const pos = listPos();
  const inventory = listInventory();

  const opportunities = [
    ...sweepReplenishment(),
    ...sweepOpenPos(pos),
    ...sweepSupplierReliability(pos),
    ...sweepForecastAnomalies(),
    ...sweepSafetyStock(),
    ...sweepOverstock(),
  ].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    return bySeverity !== 0 ? bySeverity : b.valueAtRisk - a.valueAtRisk;
  });

  const byKind = opportunities.reduce(
    (acc, o) => {
      acc[o.kind] = (acc[o.kind] ?? 0) + 1;
      return acc;
    },
    {
      replenishment: 0,
      open_po: 0,
      supplier_reliability: 0,
      forecast_anomaly: 0,
      safety_stock: 0,
      overstock: 0,
    } as Record<OpportunityKind, number>,
  );

  return {
    generatedAt: new Date().toISOString(),
    simulatedToday: today(),
    scanned: {
      positions: inventory.length,
      purchaseOrders: pos.length,
      suppliers: new Set(pos.map((p) => p.supplier_id)).size,
    },
    opportunities,
    byKind,
    totalValueAtRisk: round2(opportunities.reduce((sum, o) => sum + o.valueAtRisk, 0)),
  };
}

/**
 * Headroom summary — how much the network could actually absorb right now.
 * Shown alongside the sweep because every finding above is only actionable to
 * the extent that money and shelf space exist to act on it.
 */
export function networkHeadroom() {
  return listNodes().map((n) => {
    const budget = getBudget(n.id);
    return {
      nodeId: n.id,
      nodeName: n.name,
      budgetFree: budget ? round2(budgetAvailable(budget)) : 0,
      budgetTotal: budget?.total_budget ?? 0,
      slotsFree: storageFreeSlots(n),
      slotsTotal: n.storage_capacity_slots,
      nextReviewDate: addDays(today(), REVIEW_PERIOD_DAYS),
    };
  });
}
