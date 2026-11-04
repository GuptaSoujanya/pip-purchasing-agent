import {
  budgetAvailable,
  getBudget,
  getInventory,
  getNode,
  getPo,
  getProduct,
  getSupplier,
  getSupplierProduct,
  storageFreeSlots,
} from "../db/repo";
import { daysOfCoverAfter, largestFeasibleQty, round2, spoilageRisk } from "./math";
import type { ConstraintCheck, ValidationResult } from "./types";

/**
 * The constraint engine.
 *
 * Every purchasing action is pushed through here twice:
 *   - PRE-validate : can this action legally execute? what is the max feasible qty?
 *   - POST-validate : after executing, does the resulting world still satisfy everything?
 *
 * HARD constraints block execution outright. SOFT constraints do not block but
 * downgrade confidence and can force human approval.
 *
 * Crucially, every failed hard check reports `maxFeasibleQty` — the largest
 * quantity that *would* pass. That is what lets the agent respond to a blocked
 * purchase with a workable counter-proposal instead of simply giving up
 * (Scenario 4).
 */

export type PurchaseValidationInput = {
  supplier_id: string;
  node_id: string;
  product_id: string;
  qty: number;
  expedite?: boolean;
  dailyDemand: number;
  /** Cost already committed by this same run, so repeated checks stay consistent. */
  additionalCommittedCost?: number;
  /** Exclude a PO's existing commitment when validating an amendment. */
  excludePoCost?: number;
  excludePoSlots?: number;
};

const ok = (
  code: string,
  label: string,
  severity: ConstraintCheck["severity"],
  detail: string,
  extra: Partial<ConstraintCheck> = {},
): ConstraintCheck => ({ code, label, severity, passed: true, detail, ...extra });

const fail = (
  code: string,
  label: string,
  severity: ConstraintCheck["severity"],
  detail: string,
  extra: Partial<ConstraintCheck> = {},
): ConstraintCheck => ({ code, label, severity, passed: false, detail, ...extra });

export function validatePurchase(input: PurchaseValidationInput): ValidationResult {
  const checks: ConstraintCheck[] = [];
  const caps: { qty: number; code: string }[] = [];

  const product = getProduct(input.product_id);
  const node = getNode(input.node_id);
  const supplier = getSupplier(input.supplier_id);
  const sp = getSupplierProduct(input.supplier_id, input.product_id);
  const inventory = getInventory(input.node_id, input.product_id);
  const budget = getBudget(input.node_id);

  // -- Referential integrity ------------------------------------------------
  if (!product || !node || !inventory) {
    checks.push(fail("REF_DATA", "Reference data", "hard", "Product, node or inventory record not found."));
    return summarise(checks, 0, input.qty);
  }
  if (!supplier) {
    checks.push(fail("SUPPLIER_EXISTS", "Supplier exists", "hard", `Supplier ${input.supplier_id} not found.`));
    return summarise(checks, 0, input.qty);
  }
  if (!supplier.active) {
    checks.push(fail("SUPPLIER_ACTIVE", "Supplier active", "hard", `Supplier ${supplier.name} is inactive and cannot receive orders.`));
    return summarise(checks, 0, input.qty);
  }
  if (!sp) {
    checks.push(
      fail("SUPPLIER_CATALOGUE", "Supplier lists product", "hard",
        `${supplier.name} has no commercial terms for ${product.sku}; it cannot supply this product.`),
    );
    return summarise(checks, 0, input.qty);
  }
  checks.push(ok("SUPPLIER_CATALOGUE", "Supplier lists product", "hard",
    `${supplier.name} supplies ${product.sku} at $${sp.unit_price}/unit.`));

  const unitPrice = sp.unit_price * (input.expedite ? 1 + sp.expedite_surcharge_pct / 100 : 1);
  const orderCost = unitPrice * input.qty;

  // -- HARD: minimum order quantity ----------------------------------------
  if (input.qty > 0 && input.qty < sp.moq) {
    checks.push(
      fail("MOQ", "Minimum order quantity", "hard",
        `Order of ${input.qty} is below ${supplier.name}'s MOQ of ${sp.moq} for ${product.sku}.`,
        { observed: input.qty, limit: sp.moq, maxFeasibleQty: 0 }),
    );
  } else {
    checks.push(ok("MOQ", "Minimum order quantity", "hard",
      `${input.qty} meets the MOQ of ${sp.moq}.`, { observed: input.qty, limit: sp.moq }));
  }

  // -- HARD: lot size ------------------------------------------------------
  if (sp.lot_size > 1 && input.qty % sp.lot_size !== 0) {
    checks.push(
      fail("LOT_SIZE", "Lot size alignment", "hard",
        `${input.qty} is not a multiple of the ${sp.lot_size}-unit lot size.`,
        { observed: input.qty, limit: sp.lot_size,
          maxFeasibleQty: Math.floor(input.qty / sp.lot_size) * sp.lot_size }),
    );
  } else {
    checks.push(ok("LOT_SIZE", "Lot size alignment", "hard",
      sp.lot_size > 1 ? `${input.qty} is a clean multiple of the ${sp.lot_size}-unit lot size.` : "No lot-size restriction."));
  }

  // -- HARD: supplier per-order capacity -----------------------------------
  if (sp.max_units_per_order != null) {
    if (input.qty > sp.max_units_per_order) {
      checks.push(
        fail("SUPPLIER_CAP", "Supplier order capacity", "hard",
          `${supplier.name} accepts at most ${sp.max_units_per_order} units per order; requested ${input.qty}.`,
          { observed: input.qty, limit: sp.max_units_per_order, maxFeasibleQty: sp.max_units_per_order }),
      );
    } else {
      checks.push(ok("SUPPLIER_CAP", "Supplier order capacity", "hard",
        `${input.qty} is within the supplier cap of ${sp.max_units_per_order}.`,
        { observed: input.qty, limit: sp.max_units_per_order }));
    }
    caps.push({ qty: sp.max_units_per_order, code: "SUPPLIER_CAP" });
  }

  // -- HARD: budget --------------------------------------------------------
  if (budget) {
    const available =
      budgetAvailable(budget) - (input.additionalCommittedCost ?? 0) + (input.excludePoCost ?? 0);
    const affordableUnits = unitPrice > 0 ? Math.floor(available / unitPrice) : 0;
    if (orderCost > available) {
      checks.push(
        fail("BUDGET", "Purchasing budget", "hard",
          `Order costs $${orderCost.toFixed(2)} but only $${available.toFixed(2)} remains in the ${budget.period} budget for ${node.name}.`,
          { observed: Math.round(orderCost), limit: Math.round(available),
            maxFeasibleQty: largestFeasibleQty(affordableUnits, sp) }),
      );
    } else {
      checks.push(ok("BUDGET", "Purchasing budget", "hard",
        `$${orderCost.toFixed(2)} fits within the $${available.toFixed(2)} available.`,
        { observed: Math.round(orderCost), limit: Math.round(available) }));
    }
    caps.push({ qty: affordableUnits, code: "BUDGET" });
  } else {
    checks.push(fail("BUDGET", "Purchasing budget", "hard",
      `No budget record exists for ${node.name} in the current period.`, { maxFeasibleQty: 0 }));
  }

  // -- HARD: storage capacity ----------------------------------------------
  const slotsNeeded = input.qty * product.slots_per_unit;
  const freeSlots = storageFreeSlots(node) + (input.excludePoSlots ?? 0);
  const storableUnits = product.slots_per_unit > 0 ? Math.floor(freeSlots / product.slots_per_unit) : input.qty;
  if (slotsNeeded > freeSlots) {
    checks.push(
      fail("STORAGE", "Storage capacity", "hard",
        `Order needs ${slotsNeeded.toFixed(0)} storage slots but ${node.name} has only ${freeSlots.toFixed(0)} free.`,
        { observed: Math.round(slotsNeeded), limit: Math.round(freeSlots),
          maxFeasibleQty: largestFeasibleQty(storableUnits, sp) }),
    );
  } else {
    checks.push(ok("STORAGE", "Storage capacity", "hard",
      `${slotsNeeded.toFixed(0)} slots required, ${freeSlots.toFixed(0)} free at ${node.name}.`,
      { observed: Math.round(slotsNeeded), limit: Math.round(freeSlots) }));
  }
  caps.push({ qty: storableUnits, code: "STORAGE" });

  // -- SOFT: overstock -----------------------------------------------------
  const cover = daysOfCoverAfter({ inventory, incomingQty: input.qty, dailyDemand: input.dailyDemand });
  const OVERSTOCK_DAYS = 45;
  if (cover > OVERSTOCK_DAYS) {
    checks.push(
      fail("OVERSTOCK", "Overstock risk", "soft",
        `This order yields ${cover} days of cover, beyond the ${OVERSTOCK_DAYS}-day overstock threshold. Capital would sit idle.`,
        { observed: cover, limit: OVERSTOCK_DAYS }),
    );
  } else {
    checks.push(ok("OVERSTOCK", "Overstock risk", "soft",
      `Resulting cover of ${cover} days is within the ${OVERSTOCK_DAYS}-day threshold.`,
      { observed: cover, limit: OVERSTOCK_DAYS }));
  }

  // -- SOFT: spoilage ------------------------------------------------------
  const spoil = spoilageRisk({
    qty: input.qty, dailyDemand: input.dailyDemand,
    shelfLifeDays: product.shelf_life_days, onHand: inventory.on_hand,
  });
  checks.push(
    spoil.atRisk
      ? fail("SPOILAGE", "Shelf-life risk", "soft", spoil.note,
          { observed: spoil.daysToSell, limit: spoil.shelfLifeDays ?? undefined })
      : ok("SPOILAGE", "Shelf-life risk", "soft", spoil.note),
  );

  // -- SOFT: supplier reliability ------------------------------------------
  const RELIABILITY_FLOOR = 0.85;
  if (supplier.reliability_score < RELIABILITY_FLOOR) {
    checks.push(
      fail("RELIABILITY", "Supplier reliability", "soft",
        `${supplier.name} has a ${(supplier.reliability_score * 100).toFixed(0)}% historical fill rate, below the ${RELIABILITY_FLOOR * 100}% comfort floor. Expect short delivery.`,
        { observed: supplier.reliability_score, limit: RELIABILITY_FLOOR }),
    );
  } else {
    checks.push(ok("RELIABILITY", "Supplier reliability", "soft",
      `${supplier.name} fill rate is ${(supplier.reliability_score * 100).toFixed(0)}%.`,
      { observed: supplier.reliability_score, limit: RELIABILITY_FLOOR }));
  }

  // -- SOFT: lead time vs projected stockout -------------------------------
  const leadTime = input.expedite && sp.expedite_available
    ? (sp.expedite_lead_time_days ?? sp.lead_time_days)
    : sp.lead_time_days;
  const sellable = inventory.on_hand - inventory.reserved;
  const daysUntilStockout = input.dailyDemand > 0 ? Math.floor(sellable / input.dailyDemand) : 9999;
  if (leadTime > daysUntilStockout) {
    checks.push(
      fail("LEAD_TIME", "Lead time vs stockout", "soft",
        `Stock runs out in ~${daysUntilStockout} days but this order takes ${leadTime} days to arrive — a ${leadTime - daysUntilStockout}-day stockout gap.`,
        { observed: leadTime, limit: daysUntilStockout }),
    );
  } else {
    checks.push(ok("LEAD_TIME", "Lead time vs stockout", "soft",
      `Delivery in ${leadTime} days arrives before the projected stockout at ~${daysUntilStockout} days.`,
      { observed: leadTime, limit: daysUntilStockout }));
  }

  // The largest quantity that clears EVERY hard cap at once.
  const rawCap = caps.length ? Math.min(...caps.map((c) => c.qty)) : input.qty;
  const maxFeasible = largestFeasibleQty(Math.max(0, rawCap), sp);
  const binding =
    caps.length && rawCap < input.qty
      ? caps.reduce((a, b) => (a.qty <= b.qty ? a : b)).code
      : null;

  return summarise(checks, maxFeasible, input.qty, binding);
}

function summarise(
  checks: ConstraintCheck[],
  maxFeasibleQty: number,
  _requestedQty: number,
  bindingConstraint: string | null = null,
): ValidationResult {
  const hardFailures = checks.filter((c) => c.severity === "hard" && !c.passed);
  const softWarnings = checks.filter((c) => c.severity === "soft" && !c.passed);
  return {
    passed: hardFailures.length === 0,
    hardFailures,
    softWarnings,
    checks,
    maxFeasibleQty,
    bindingConstraint:
      bindingConstraint ?? (hardFailures.length ? hardFailures[0].code : null),
  };
}

/**
 * POST-execution validation.
 *
 * Deliberately re-reads the world from the database rather than trusting what
 * the write tool returned. If a supplier gateway silently capped the order, or
 * a concurrent run consumed the budget, this is where we find out.
 */
export function validateResultingPo(args: {
  po_id: string;
  node_id: string;
  product_id: string;
  dailyDemand: number;
  expectedQty: number;
}): ValidationResult {
  const checks: ConstraintCheck[] = [];
  const po = getPo(args.po_id);
  const node = getNode(args.node_id);
  const inventory = getInventory(args.node_id, args.product_id);
  const budget = getBudget(args.node_id);

  if (!po) {
    checks.push(fail("PO_EXISTS", "Purchase order persisted", "hard",
      `Purchase order ${args.po_id} was not found after execution.`));
    return summarise(checks, 0, args.expectedQty);
  }
  checks.push(ok("PO_EXISTS", "Purchase order persisted", "hard",
    `${po.po_number} exists with status "${po.status}".`));

  const line = po.lines.find((l) => l.product_id === args.product_id);
  if (!line) {
    checks.push(fail("PO_LINE", "Order line present", "hard",
      `${po.po_number} has no line for ${args.product_id}.`));
    return summarise(checks, 0, args.expectedQty);
  }

  const effective = line.qty_confirmed > 0 ? line.qty_confirmed : line.qty_ordered;
  if (effective === args.expectedQty) {
    checks.push(ok("QTY_MATCH", "Quantity as expected", "hard",
      `Confirmed quantity ${effective} matches the ${args.expectedQty} the agent intended.`,
      { observed: effective, limit: args.expectedQty }));
  } else {
    checks.push(
      fail("QTY_MATCH", "Quantity as expected", "hard",
        `Expected ${args.expectedQty} units but the order settled at ${effective} — the supplier did not accept the full quantity.`,
        { observed: effective, limit: args.expectedQty }),
    );
  }

  if (budget) {
    const available = budgetAvailable(budget);
    if (available < 0) {
      checks.push(fail("BUDGET_POST", "Budget not overdrawn", "hard",
        `Budget is overdrawn by $${Math.abs(available).toFixed(2)} after this order.`,
        { observed: Math.round(available), limit: 0 }));
    } else {
      checks.push(ok("BUDGET_POST", "Budget not overdrawn", "hard",
        `$${available.toFixed(2)} remains after committing this order.`,
        { observed: Math.round(available), limit: 0 }));
    }
  }

  if (node) {
    const free = storageFreeSlots(node);
    if (free < 0) {
      checks.push(fail("STORAGE_POST", "Storage not oversubscribed", "hard",
        `Storage at ${node.name} is oversubscribed by ${Math.abs(free).toFixed(0)} slots.`,
        { observed: Math.round(free), limit: 0 }));
    } else {
      checks.push(ok("STORAGE_POST", "Storage not oversubscribed", "hard",
        `${free.toFixed(0)} storage slots still free at ${node.name}.`,
        { observed: Math.round(free), limit: 0 }));
    }
  }

  if (inventory) {
    const cover = daysOfCoverAfter({ inventory, incomingQty: 0, dailyDemand: args.dailyDemand });
    const STOCKOUT_FLOOR = 7;
    checks.push(
      cover < STOCKOUT_FLOOR
        ? fail("COVER_POST", "Post-order cover", "soft",
            `Even after this order, projected cover is only ${cover} days — still below the ${STOCKOUT_FLOOR}-day floor.`,
            { observed: cover, limit: STOCKOUT_FLOOR })
        : ok("COVER_POST", "Post-order cover", "soft",
            `Projected cover of ${cover} days clears the ${STOCKOUT_FLOOR}-day floor.`,
            { observed: cover, limit: STOCKOUT_FLOOR }),
    );
  }

  return summarise(checks, effective, args.expectedQty);
}

/**
 * Pre-flight check for amending or cancelling an existing purchase order.
 *
 * `validatePurchase` answers "may we buy this?", which is the wrong question
 * for an amendment: there is no new supplier selection and, when the quantity
 * falls, budget and storage are released rather than consumed. What has to be
 * established instead is that the order is actually amendable and that an
 * *increase* — which is a purchase of the delta in all but name — still clears
 * budget and storage. Without this an amendment upward would reach the database
 * having passed no constraint check at all.
 */
export function validateAmendment(args: {
  po_id: string;
  product_id: string;
  new_qty: number;
}): ValidationResult {
  const checks: ConstraintCheck[] = [];
  const po = getPo(args.po_id);

  if (!po) {
    checks.push({
      code: "PO_EXISTS", label: "Purchase order exists", severity: "hard", passed: false,
      detail: `No purchase order ${args.po_id} was found.`,
    });
    return summariseAmendment(checks);
  }

  const amendable: string[] = ["draft", "submitted", "confirmed", "partially_confirmed"];
  checks.push({
    code: "PO_AMENDABLE", label: "Purchase order is amendable", severity: "hard",
    passed: amendable.includes(po.status),
    detail: amendable.includes(po.status)
      ? `${po.po_number} is ${po.status} and may still be changed.`
      : `${po.po_number} is ${po.status}; it can no longer be amended.`,
  });

  const line = po.lines.find((l) => l.product_id === args.product_id);
  checks.push({
    code: "PO_LINE_EXISTS", label: "Line exists on the order", severity: "hard",
    passed: !!line,
    detail: line
      ? `${po.po_number} carries ${line.qty_ordered} units of ${args.product_id}.`
      : `${po.po_number} has no line for ${args.product_id}.`,
  });

  checks.push({
    code: "QTY_NON_NEGATIVE", label: "Quantity is not negative", severity: "hard",
    passed: args.new_qty >= 0,
    detail: `Requested new quantity is ${args.new_qty}.`,
    observed: args.new_qty, limit: 0,
  });

  if (line) {
    const delta = args.new_qty - line.qty_ordered;

    if (delta > 0) {
      const sp = getSupplierProduct(po.supplier_id, args.product_id);
      const product = getProduct(args.product_id);
      const node = getNode(po.node_id);
      const budget = getBudget(po.node_id);

      const deltaCost = round2(delta * (sp?.unit_price ?? 0));
      const freeBudget = budget ? budgetAvailable(budget) : 0;
      checks.push({
        code: "BUDGET", label: "Increase is funded", severity: "hard",
        passed: deltaCost <= freeBudget,
        detail: deltaCost <= freeBudget
          ? `Raising the order by ${delta} units costs $${deltaCost.toFixed(2)} against $${freeBudget.toFixed(2)} available.`
          : `Raising the order by ${delta} units costs $${deltaCost.toFixed(2)} but only $${freeBudget.toFixed(2)} remains.`,
        observed: deltaCost, limit: freeBudget,
        maxFeasibleQty: sp && sp.unit_price > 0
          ? line.qty_ordered + Math.floor(freeBudget / sp.unit_price)
          : line.qty_ordered,
      });

      const deltaSlots = delta * (product?.slots_per_unit ?? 1);
      const freeSlots = node ? storageFreeSlots(node) : 0;
      checks.push({
        code: "STORAGE", label: "Increase fits in storage", severity: "hard",
        passed: deltaSlots <= freeSlots,
        detail: deltaSlots <= freeSlots
          ? `The extra ${delta} units need ${deltaSlots} slots against ${freeSlots} free.`
          : `The extra ${delta} units need ${deltaSlots} slots but only ${freeSlots} are free.`,
        observed: deltaSlots, limit: freeSlots,
        maxFeasibleQty: product && product.slots_per_unit > 0
          ? line.qty_ordered + Math.floor(freeSlots / product.slots_per_unit)
          : line.qty_ordered,
      });
    } else {
      checks.push({
        code: "RELEASES_COMMITMENT", label: "Reduction releases commitment", severity: "soft",
        passed: true,
        detail: delta === 0
          ? `Quantity is unchanged at ${line.qty_ordered} units.`
          : `Reducing by ${Math.abs(delta)} units returns budget and storage to the pool.`,
        observed: Math.abs(delta),
      });
    }
  }

  return summariseAmendment(checks);
}

function summariseAmendment(checks: ConstraintCheck[]): ValidationResult {
  const hardFailures = checks.filter((c) => c.severity === "hard" && !c.passed);
  const softWarnings = checks.filter((c) => c.severity === "soft" && !c.passed);
  const caps = hardFailures.map((f) => f.maxFeasibleQty).filter((n): n is number => typeof n === "number");
  return {
    passed: hardFailures.length === 0,
    hardFailures,
    softWarnings,
    checks,
    maxFeasibleQty: caps.length ? Math.min(...caps) : 0,
    bindingConstraint: hardFailures.length
      ? hardFailures.reduce((a, b) => ((a.maxFeasibleQty ?? 0) <= (b.maxFeasibleQty ?? 0) ? a : b)).code
      : null,
  };
}
