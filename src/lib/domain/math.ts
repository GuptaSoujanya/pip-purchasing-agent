import type { DemandPoint, Forecast, Inventory, Promotion, SupplierProduct } from "./types";

/**
 * Replenishment mathematics.
 *
 * These functions are the agent's "calculator". The LLM never does arithmetic;
 * it calls these through tools. That removes a whole class of hallucinated
 * numbers and makes every figure in the final decision reproducible.
 */

export const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Demand statistics
// ---------------------------------------------------------------------------

export function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

export type DemandStats = {
  windowDays: number;
  totalUnits: number;
  dailyMean: number;
  dailyStdDev: number;
  /** Coefficient of variation — how noisy demand is. */
  cv: number;
  last7Mean: number;
  prior21Mean: number;
  /** last7Mean / forecast baseline. >1 means we are underforecasting. */
  trendRatio: number;
};

export function demandStats(points: DemandPoint[], baselineForecast: number): DemandStats {
  const values = points.map((p) => p.units_sold);
  const last7 = values.slice(-7);
  const prior21 = values.slice(-28, -7);
  const m = mean(values);
  const sd = stddev(values);
  return {
    windowDays: values.length,
    totalUnits: values.reduce((a, b) => a + b, 0),
    dailyMean: round2(m),
    dailyStdDev: round2(sd),
    cv: m > 0 ? round2(sd / m) : 0,
    last7Mean: round2(mean(last7)),
    prior21Mean: round2(mean(prior21)),
    trendRatio: baselineForecast > 0 ? round2(mean(last7) / baselineForecast) : 0,
  };
}

// ---------------------------------------------------------------------------
// Demand-shift detection (Scenario 3)
// ---------------------------------------------------------------------------

export type DemandShiftEvidence = {
  shiftDetected: boolean;
  /** How confident we are that this is a real, sustained shift (0..1). */
  confidence: number;
  trendRatio: number;
  consecutiveElevatedDays: number;
  zScoreOfLast7: number;
  explainedByPromotion: boolean;
  promotion: Promotion | null;
  recommendedDailyForecast: number;
  reasons: string[];
};

/**
 * Decide whether a demand spike is a real baseline shift worth re-planning for.
 *
 * Evidence gates (all must hold to declare a shift):
 *   1. Recent demand is materially above forecast (ratio >= threshold).
 *   2. The elevation is *sustained*, not a one-day blip.
 *   3. It is statistically unusual vs the prior period.
 *   4. It is not fully explained by an active promotion.
 *
 * Gate 4 is the one that stops the agent over-buying into a temporary promo lift.
 */
export function detectDemandShift(args: {
  points: DemandPoint[];
  forecast: Forecast | null;
  promotions: Promotion[];
  ratioThreshold?: number;
  minConsecutiveDays?: number;
}): DemandShiftEvidence {
  const { points, forecast, promotions } = args;
  const ratioThreshold = args.ratioThreshold ?? 1.5;
  const minConsecutive = args.minConsecutiveDays ?? 5;
  const baseline = forecast?.daily_forecast ?? 0;
  const reasons: string[] = [];

  const stats = demandStats(points, baseline);
  const values = points.map((p) => p.units_sold);

  // Count the trailing run of days above 1.2x baseline.
  let consecutive = 0;
  for (let i = values.length - 1; i >= 0; i--) {
    if (baseline > 0 && values[i] >= baseline * 1.2) consecutive++;
    else break;
  }

  // z-score of the recent mean against the earlier period's distribution.
  const prior = values.slice(0, Math.max(0, values.length - 7));
  const priorMean = mean(prior);
  const priorSd = stddev(prior);
  const z = priorSd > 0 ? round2((stats.last7Mean - priorMean) / priorSd) : 0;

  const promo = promotions[0] ?? null;
  // A promo "explains" the spike if the observed uplift is within ~1.25x of
  // what the promotion was expected to deliver.
  const observedUplift = baseline > 0 ? stats.last7Mean / baseline - 1 : 0;
  const explainedByPromotion =
    !!promo && observedUplift <= (promo.uplift_pct / 100) * 1.25;

  const ratioOk = stats.trendRatio >= ratioThreshold;
  const sustainedOk = consecutive >= minConsecutive;
  const statOk = z >= 2;

  if (ratioOk) reasons.push(`Last-7-day demand is ${stats.trendRatio}x the forecast baseline of ${baseline}/day.`);
  else reasons.push(`Last-7-day demand is only ${stats.trendRatio}x baseline (threshold ${ratioThreshold}x).`);

  if (sustainedOk) reasons.push(`Elevated demand sustained for ${consecutive} consecutive days (>= ${minConsecutive} required).`);
  else reasons.push(`Only ${consecutive} consecutive elevated days — below the ${minConsecutive}-day sustainment gate.`);

  if (statOk) reasons.push(`Recent mean is ${z} standard deviations above the prior period — statistically significant.`);
  else reasons.push(`z-score of ${z} is below the significance gate of 2.0.`);

  if (explainedByPromotion && promo) {
    reasons.push(
      `Active promotion "${promo.description}" (expected +${promo.uplift_pct}%) explains the observed +${Math.round(observedUplift * 100)}% uplift. Treating the spike as TEMPORARY — the baseline must not be permanently raised.`,
    );
  }

  const shiftDetected = ratioOk && sustainedOk && statOk && !explainedByPromotion;

  // Confidence blends the three statistical gates.
  const confidence = round2(
    Math.min(
      1,
      (Math.min(stats.trendRatio / ratioThreshold, 2) / 2) * 0.4 +
        (Math.min(consecutive / minConsecutive, 2) / 2) * 0.3 +
        (Math.min(Math.max(z, 0) / 2, 2) / 2) * 0.3,
    ),
  );

  // If a promo explains it, plan against the promo-period rate but do not
  // rebase the long-run forecast.
  const recommendedDailyForecast = shiftDetected
    ? round2(stats.last7Mean)
    : explainedByPromotion
      ? round2(baseline)
      : round2(baseline);

  return {
    shiftDetected,
    confidence: explainedByPromotion ? round2(confidence * 0.5) : confidence,
    trendRatio: stats.trendRatio,
    consecutiveElevatedDays: consecutive,
    zScoreOfLast7: z,
    explainedByPromotion,
    promotion: promo,
    recommendedDailyForecast,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Net requirement
// ---------------------------------------------------------------------------

export type NetRequirement = {
  horizonDays: number;
  dailyDemand: number;
  demandOverHorizon: number;
  safetyStock: number;
  onHand: number;
  inTransit: number;
  reserved: number;
  availableToPromise: number;
  /** The quantity we actually need to buy, before supplier rounding. */
  netRequirement: number;
  /** Days of cover we have today at the current demand rate. */
  currentDaysOfCover: number;
  /** Day index at which we run out if nothing arrives. */
  projectedStockoutInDays: number | null;
  workings: string[];
};

/**
 * Net requirement = demand over the protection horizon
 *                 + safety stock
 *                 - on hand
 *                 - already-inbound
 *                 + units already promised to customers
 *
 * The protection horizon is lead time + review period: we must cover demand
 * until the *next* order would arrive, not just until this one lands.
 */
export function computeNetRequirement(args: {
  inventory: Inventory;
  dailyDemand: number;
  leadTimeDays: number;
  reviewPeriodDays: number;
}): NetRequirement {
  const { inventory, dailyDemand, leadTimeDays, reviewPeriodDays } = args;
  const horizonDays = leadTimeDays + reviewPeriodDays;
  const demandOverHorizon = Math.ceil(dailyDemand * horizonDays);
  const availableToPromise = inventory.on_hand + inventory.in_transit - inventory.reserved;
  const net = Math.max(
    0,
    demandOverHorizon + inventory.safety_stock - inventory.on_hand - inventory.in_transit + inventory.reserved,
  );
  const currentDaysOfCover = dailyDemand > 0 ? round2(availableToPromise / dailyDemand) : Infinity;
  const sellableNow = inventory.on_hand - inventory.reserved;
  const projectedStockoutInDays =
    dailyDemand > 0 ? Math.max(0, Math.floor(sellableNow / dailyDemand)) : null;

  return {
    horizonDays,
    dailyDemand: round2(dailyDemand),
    demandOverHorizon,
    safetyStock: inventory.safety_stock,
    onHand: inventory.on_hand,
    inTransit: inventory.in_transit,
    reserved: inventory.reserved,
    availableToPromise,
    netRequirement: net,
    currentDaysOfCover: Number.isFinite(currentDaysOfCover) ? currentDaysOfCover : 9999,
    projectedStockoutInDays,
    workings: [
      `Protection horizon = lead time ${leadTimeDays}d + review period ${reviewPeriodDays}d = ${horizonDays}d.`,
      `Demand over horizon = ${round2(dailyDemand)}/day x ${horizonDays}d = ${demandOverHorizon} units.`,
      `Requirement = ${demandOverHorizon} (demand) + ${inventory.safety_stock} (safety stock) = ${demandOverHorizon + inventory.safety_stock}.`,
      `Supply = ${inventory.on_hand} (on hand) + ${inventory.in_transit} (in transit) - ${inventory.reserved} (reserved) = ${availableToPromise}.`,
      `Net requirement = ${demandOverHorizon + inventory.safety_stock} - ${availableToPromise} = ${net} units.`,
    ],
  };
}

// ---------------------------------------------------------------------------
// Supplier order shaping
// ---------------------------------------------------------------------------

export type OrderShaping = {
  requestedQty: number;
  shapedQty: number;
  adjustments: string[];
  meetsMoq: boolean;
  lotAligned: boolean;
  exceedsSupplierCap: boolean;
};

/**
 * Turn a raw desired quantity into something the supplier will actually accept:
 * round up to the lot size, lift to MOQ, and cap at the supplier's per-order max.
 */
export function shapeOrderQty(qty: number, sp: SupplierProduct): OrderShaping {
  const adjustments: string[] = [];
  let shaped = Math.max(0, Math.ceil(qty));

  if (shaped === 0) {
    return {
      requestedQty: qty, shapedQty: 0, adjustments: ["Quantity is zero — no order required."],
      meetsMoq: true, lotAligned: true, exceedsSupplierCap: false,
    };
  }

  if (sp.lot_size > 1 && shaped % sp.lot_size !== 0) {
    const up = Math.ceil(shaped / sp.lot_size) * sp.lot_size;
    adjustments.push(`Rounded ${shaped} up to ${up} to match lot size of ${sp.lot_size}.`);
    shaped = up;
  }

  if (shaped < sp.moq) {
    adjustments.push(`Raised ${shaped} to supplier MOQ of ${sp.moq}.`);
    shaped = sp.moq;
    if (sp.lot_size > 1 && shaped % sp.lot_size !== 0) {
      shaped = Math.ceil(shaped / sp.lot_size) * sp.lot_size;
      adjustments.push(`Re-aligned MOQ to lot size -> ${shaped}.`);
    }
  }

  let exceedsCap = false;
  if (sp.max_units_per_order != null && shaped > sp.max_units_per_order) {
    adjustments.push(
      `Supplier caps a single order at ${sp.max_units_per_order} units; ${shaped} exceeds it.`,
    );
    exceedsCap = true;
  }

  return {
    requestedQty: qty,
    shapedQty: shaped,
    adjustments,
    meetsMoq: shaped >= sp.moq,
    lotAligned: sp.lot_size <= 1 || shaped % sp.lot_size === 0,
    exceedsSupplierCap: exceedsCap,
  };
}

/** Largest lot-aligned quantity that does not exceed `cap`. */
export function largestFeasibleQty(cap: number, sp: SupplierProduct): number {
  if (cap < sp.moq) return 0; // cannot meet MOQ at all
  let q = Math.floor(cap);
  if (sp.lot_size > 1) q = Math.floor(q / sp.lot_size) * sp.lot_size;
  if (sp.max_units_per_order != null) q = Math.min(q, sp.max_units_per_order);
  return q >= sp.moq ? q : 0;
}

// ---------------------------------------------------------------------------
// Risk scoring
// ---------------------------------------------------------------------------

/**
 * Expected delivered units, discounted by the supplier's historical fill rate.
 * Used to decide whether to over-order slightly from an unreliable supplier.
 */
export function reliabilityAdjustedQty(qty: number, reliability: number): number {
  return Math.round(qty / Math.max(0.5, reliability));
}

/** Days of cover the order will deliver once received. */
export function daysOfCoverAfter(args: {
  inventory: Inventory;
  incomingQty: number;
  dailyDemand: number;
}): number {
  const { inventory, incomingQty, dailyDemand } = args;
  if (dailyDemand <= 0) return 9999;
  const total = inventory.on_hand + inventory.in_transit + incomingQty - inventory.reserved;
  return round2(total / dailyDemand);
}

/** Does the quantity risk expiring before it can be sold? */
export function spoilageRisk(args: {
  qty: number;
  dailyDemand: number;
  shelfLifeDays: number | null;
  onHand: number;
}): { atRisk: boolean; daysToSell: number; shelfLifeDays: number | null; note: string } {
  const { qty, dailyDemand, shelfLifeDays, onHand } = args;
  if (!shelfLifeDays || dailyDemand <= 0) {
    return { atRisk: false, daysToSell: 0, shelfLifeDays, note: "Non-perishable or no demand signal." };
  }
  const daysToSell = round2((onHand + qty) / dailyDemand);
  const atRisk = daysToSell > shelfLifeDays;
  return {
    atRisk,
    daysToSell,
    shelfLifeDays,
    note: atRisk
      ? `At ${dailyDemand}/day it takes ${daysToSell}d to sell through, exceeding the ${shelfLifeDays}d shelf life.`
      : `Sell-through in ${daysToSell}d is within the ${shelfLifeDays}d shelf life.`,
  };
}
