import type Database from "better-sqlite3";
import { addDays, today } from "./repo";

/**
 * Seed data.
 *
 * The numbers here are not arbitrary. Each scenario is tuned so that the
 * obvious answer is the wrong one, which is the whole point of the exercise:
 *
 *   S1  SKU-1001 @ Bogotá   — system recommends 800; true requirement is 350.
 *   S1b SKU-1005 @ Medellín — recommendation is actually correct; agent accepts.
 *   S2  SKU-1002 @ Bogotá   — supplier confirms 250 of 500; gap must be re-sourced
 *                             from a pricier, less reliable alternate, expedited.
 *   S3  SKU-1003 @ Bogotá   — real 2.9x demand shift; the chosen supplier then
 *                             silently caps the order, forcing remediation.
 *   S3b SKU-1005 @ Bogotá   — demand spike that is fully explained by a running
 *                             promotion; the agent must NOT rebase the forecast.
 *   S4  SKU-1004 @ Cartagena— storage is the binding constraint; agent part-orders
 *                             and redirects the overflow to a node with space.
 */

/** Deterministic PRNG so demand history — and therefore every assertion — is stable. */
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function noisy(base: number, rng: () => number, spread = 0.18): number {
  return Math.max(0, Math.round(base * (1 + (rng() - 0.5) * spread)));
}

export function seed(db: Database.Database) {
  const t = today();

  // -------------------------------------------------------------------------
  // Fulfilment nodes
  // -------------------------------------------------------------------------
  const nodes: [string, string, string, number, number][] = [
    ["NODE-BOG-01", "Bogotá North DC", "Colombia — Central", 50_000, 31_000],
    ["NODE-MED-02", "Medellín Central DC", "Colombia — Antioquia", 30_000, 12_000],
    ["NODE-CTG-03", "Cartagena Micro-FC", "Colombia — Caribbean", 6_000, 3_000],
  ];
  const insNode = db.prepare(
    "INSERT INTO nodes (id, name, region, storage_capacity_slots, storage_used_slots) VALUES (?,?,?,?,?)",
  );
  nodes.forEach((n) => insNode.run(...n));

  // -------------------------------------------------------------------------
  // Products
  // -------------------------------------------------------------------------
  const products: [string, string, string, string, number, number | null, string][] = [
    ["PRD-1001", "SKU-1001", "Oat Milk 1L", "Dairy Alternatives", 1.0, 45, "A"],
    ["PRD-1002", "SKU-1002", "Premium Coffee Beans 500g", "Coffee", 0.8, 180, "A"],
    ["PRD-1003", "SKU-1003", "Energy Drink 330ml 4-pack", "Beverages", 1.2, 270, "A"],
    ["PRD-1004", "SKU-1004", "Bottled Water 12x500ml", "Water", 3.0, null, "C"],
    ["PRD-1005", "SKU-1005", "Greek Yogurt 500g", "Dairy", 0.6, 28, "B"],
  ];
  const insProduct = db.prepare(
    "INSERT INTO products (id, sku, name, category, slots_per_unit, shelf_life_days, abc_class) VALUES (?,?,?,?,?,?,?)",
  );
  products.forEach((p) => insProduct.run(...p));

  // -------------------------------------------------------------------------
  // Suppliers
  // -------------------------------------------------------------------------
  const suppliers: [string, string, number, number, number, number, number][] = [
    ["SUP-01", "Valle Verde Foods", 0.94, 7, 1.2, 30, 1],
    ["SUP-02", "Highland Coffee Traders", 0.88, 5, 1.0, 45, 1],
    // Deliberately unreliable, and silently caps orders — drives the remediation demo.
    ["SUP-03", "Andes Beverage Collective", 0.79, 6, 2.5, 30, 1],
    ["SUP-04", "Pacifico Distribution", 0.82, 10, 2.0, 60, 1],
    ["SUP-05", "RapidStock Logistics", 0.91, 4, 0.8, 30, 1],
    ["SUP-06", "Cordillera Dairy Co-op", 0.96, 3, 0.5, 21, 1],
    ["SUP-07", "Litoral Trading (suspended)", 0.61, 12, 4.0, 30, 0],
  ];
  const insSupplier = db.prepare(
    `INSERT INTO suppliers (id, name, reliability_score, avg_lead_time_days,
     lead_time_stddev_days, payment_terms_days, active) VALUES (?,?,?,?,?,?,?)`,
  );
  suppliers.forEach((s) => insSupplier.run(...s));

  // -------------------------------------------------------------------------
  // Commercial terms
  // -------------------------------------------------------------------------
  const insSp = db.prepare(
    `INSERT INTO supplier_products
     (supplier_id, product_id, unit_price, moq, lot_size, lead_time_days, max_units_per_order,
      expedite_available, expedite_lead_time_days, expedite_surcharge_pct, is_preferred)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const sp: [string, string, number, number, number, number, number | null, number, number | null, number, number][] = [
    // SKU-1001 Oat Milk
    ["SUP-01", "PRD-1001", 2.10, 200, 50, 7, 5000, 0, null, 0, 1],
    ["SUP-06", "PRD-1001", 2.35, 100, 25, 3, 2000, 0, null, 0, 0],

    // SKU-1002 Coffee — SUP-04 is 12% dearer, which trips the price-premium gate.
    ["SUP-02", "PRD-1002", 8.50, 100, 25, 5, 2000, 1, 3, 12, 1],
    ["SUP-04", "PRD-1002", 9.52, 100, 50, 10, 1500, 1, 5, 8, 0],

    // SKU-1003 Energy Drink — SUP-03 is preferred but silently caps at 400 units.
    ["SUP-03", "PRD-1003", 5.20, 200, 100, 6, 3000, 1, 2, 10, 1],
    ["SUP-05", "PRD-1003", 5.60, 150, 50, 4, 2000, 0, null, 0, 0],

    // SKU-1004 Bottled Water — bulky, 3 slots per unit.
    ["SUP-05", "PRD-1004", 2.40, 500, 100, 4, 5000, 0, null, 0, 1],
    ["SUP-04", "PRD-1004", 2.62, 400, 100, 9, 4000, 0, null, 0, 0],

    // SKU-1005 Yogurt
    ["SUP-06", "PRD-1005", 1.45, 100, 50, 3, 3000, 1, 1, 15, 1],
    ["SUP-01", "PRD-1005", 1.58, 200, 50, 6, 2500, 0, null, 0, 0],
  ];
  sp.forEach((r) => insSp.run(...r));

  // -------------------------------------------------------------------------
  // Inventory
  // -------------------------------------------------------------------------
  const insInv = db.prepare(
    `INSERT INTO inventory (node_id, product_id, on_hand, reserved, in_transit, safety_stock, reorder_point)
     VALUES (?,?,?,?,?,?,?)`,
  );
  const inventory: [string, string, number, number, number, number, number][] = [
    // S1 — healthy stock plus 150 already inbound. 800 would be gross overstock.
    ["NODE-BOG-01", "PRD-1001", 320, 40, 150, 180, 260],
    // S2 — 500 inbound on PO-2001, of which the supplier will only confirm 250.
    ["NODE-BOG-01", "PRD-1002", 260, 15, 500, 120, 200],
    // S3 — 600 inbound on PO-2002, but demand has tripled.
    ["NODE-BOG-01", "PRD-1003", 480, 30, 600, 250, 400],
    // S3b — promotional spike; stock is adequate for the promo window.
    ["NODE-BOG-01", "PRD-1005", 400, 20, 0, 150, 220],
    // S4 — low stock at a storage-constrained node.
    ["NODE-CTG-03", "PRD-1004", 200, 20, 0, 300, 400],
    // S1b — recommendation that is actually correct.
    ["NODE-MED-02", "PRD-1005", 140, 20, 0, 90, 150],
    // Background records
    ["NODE-MED-02", "PRD-1001", 600, 50, 0, 200, 300],
    ["NODE-BOG-01", "PRD-1004", 2400, 100, 0, 800, 1200],
  ];
  inventory.forEach((i) => insInv.run(...i));

  // -------------------------------------------------------------------------
  // Forecasts (what the planning system currently believes)
  // -------------------------------------------------------------------------
  const insFc = db.prepare(
    `INSERT INTO forecasts (node_id, product_id, daily_forecast, confidence_low, confidence_high, model_version, generated_at)
     VALUES (?,?,?,?,?,?,?)`,
  );
  const forecasts: [string, string, number, string][] = [
    ["NODE-BOG-01", "PRD-1001", 28, "demand-v2.3"],
    ["NODE-BOG-01", "PRD-1002", 32, "demand-v2.3"],
    // Stale: actual demand is running at ~115/day.
    ["NODE-BOG-01", "PRD-1003", 40, "demand-v2.1"],
    ["NODE-BOG-01", "PRD-1005", 50, "demand-v2.3"],
    ["NODE-CTG-03", "PRD-1004", 85, "demand-v2.3"],
    ["NODE-MED-02", "PRD-1005", 30, "demand-v2.3"],
    ["NODE-MED-02", "PRD-1001", 35, "demand-v2.3"],
    ["NODE-BOG-01", "PRD-1004", 210, "demand-v2.3"],
  ];
  forecasts.forEach(([n, p, d, v]) =>
    insFc.run(n, p, d, d * 0.85, d * 1.15, v, new Date(t + "T06:00:00Z").toISOString()),
  );

  // -------------------------------------------------------------------------
  // Demand history — 35 completed days ending yesterday
  // -------------------------------------------------------------------------
  const insDemand = db.prepare(
    "INSERT INTO demand_history (node_id, product_id, date, units_sold) VALUES (?,?,?,?)",
  );

  /**
   * @param spike  optional { fromDayOffset, dailyBase } applied to the trailing days
   */
  function generateDemand(
    nodeId: string, productId: string, base: number, seedNum: number,
    spike?: { lastNDays: number; base: number },
  ) {
    const rng = makeRng(seedNum);
    for (let i = 35; i >= 1; i--) {
      const date = addDays(t, -i);
      const inSpike = spike ? i <= spike.lastNDays : false;
      const level = inSpike ? spike!.base : base;
      // Tighter noise in the baseline period keeps the z-score meaningful.
      insDemand.run(nodeId, productId, date, noisy(level, rng, inSpike ? 0.12 : 0.16));
    }
  }

  generateDemand("NODE-BOG-01", "PRD-1001", 28, 101);
  generateDemand("NODE-BOG-01", "PRD-1002", 32, 202);
  // S3: flat at 40/day for four weeks, then a sustained jump to ~115/day.
  generateDemand("NODE-BOG-01", "PRD-1003", 40, 303, { lastNDays: 7, base: 115 });
  // S3b: 50/day baseline, lifted to ~80/day by the running promotion.
  generateDemand("NODE-BOG-01", "PRD-1005", 50, 404, { lastNDays: 7, base: 80 });
  generateDemand("NODE-CTG-03", "PRD-1004", 85, 505);
  generateDemand("NODE-MED-02", "PRD-1005", 30, 606);
  generateDemand("NODE-MED-02", "PRD-1001", 35, 707);
  generateDemand("NODE-BOG-01", "PRD-1004", 210, 808);

  // -------------------------------------------------------------------------
  // Promotions — the control that stops the agent over-buying into a promo
  // -------------------------------------------------------------------------
  db.prepare(
    `INSERT INTO promotions (id, node_id, product_id, start_date, end_date, uplift_pct, description)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(
    "PROMO-11-YOG", "NODE-BOG-01", "PRD-1005",
    addDays(t, -8), addDays(t, 3), 60,
    "2-for-1 Greek Yogurt weekend",
  );

  // -------------------------------------------------------------------------
  // Existing purchase orders
  // -------------------------------------------------------------------------
  const insPo = db.prepare(
    `INSERT INTO purchase_orders
     (id, po_number, supplier_id, node_id, status, created_at, expected_delivery, total_cost, created_by, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  const insLine = db.prepare(
    `INSERT INTO po_lines (po_id, product_id, qty_ordered, qty_confirmed, qty_received, unit_price)
     VALUES (?,?,?,?,0,?)`,
  );

  // S2 subject: 500 units of coffee, supplier about to short-ship.
  insPo.run("PO-2001", "PO-2001", "SUP-02", "NODE-BOG-01", "confirmed",
    new Date(addDays(t, -4) + "T09:00:00Z").toISOString(), addDays(t, 1), 4250, "buyer.maria", null);
  insLine.run("PO-2001", "PRD-1002", 500, 500, 8.50);

  // S3 subject: 600 energy drinks already inbound, landing on day 9.
  insPo.run("PO-2002", "PO-2002", "SUP-03", "NODE-BOG-01", "confirmed",
    new Date(addDays(t, -3) + "T11:30:00Z").toISOString(), addDays(t, 9), 3120, "buyer.maria", null);
  insLine.run("PO-2002", "PRD-1003", 600, 600, 5.20);

  // S1 context: 150 oat milk inbound.
  insPo.run("PO-2003", "PO-2003", "SUP-01", "NODE-BOG-01", "confirmed",
    new Date(addDays(t, -2) + "T08:15:00Z").toISOString(), addDays(t, 5), 315, "system.replenishment", null);
  insLine.run("PO-2003", "PRD-1001", 150, 150, 2.10);

  // -------------------------------------------------------------------------
  // Inbound supplier message that kicks off Scenario 2
  // -------------------------------------------------------------------------
  db.prepare(
    `INSERT INTO supplier_events (id, supplier_id, po_id, event_type, payload_json, created_at, processed)
     VALUES (?,?,?,?,?,?,0)`,
  ).run(
    "EVT-5001", "SUP-02", "PO-2001", "partial_fulfilment",
    JSON.stringify({
      product_id: "PRD-1002",
      ordered_qty: 500,
      confirmable_qty: 250,
      reason: "Harvest shortfall at origin; remaining volume unavailable this cycle.",
    }),
    new Date(t + "T07:40:00Z").toISOString(),
  );

  // -------------------------------------------------------------------------
  // Budgets
  // -------------------------------------------------------------------------
  const period = t.slice(0, 7);
  const insBudget = db.prepare(
    "INSERT INTO budgets (id, node_id, period, total_budget, committed, spent) VALUES (?,?,?,?,?,?)",
  );
  insBudget.run("BUD-BOG-01", "NODE-BOG-01", period, 120_000, 18_000, 25_000); // $77,000 free
  insBudget.run("BUD-MED-02", "NODE-MED-02", period, 60_000, 8_000, 12_000);   // $40,000 free
  insBudget.run("BUD-CTG-03", "NODE-CTG-03", period, 20_000, 12_000, 4_000);   //  $4,000 free — tight

  // -------------------------------------------------------------------------
  // Agent governance thresholds
  // -------------------------------------------------------------------------
  const insPolicy = db.prepare("INSERT INTO agent_policies (key, value, description) VALUES (?,?,?)");
  const policies: [string, number, string][] = [
    ["max_auto_order_value", 5000, "Orders above this value (USD) require buyer approval."],
    ["max_auto_qty_deviation_pct", 0.25, "Max deviation from the recommended quantity the agent may apply unilaterally."],
    ["max_auto_price_premium_pct", 0.10, "Max price premium over the cheapest qualified supplier before approval is needed."],
    ["min_auto_confidence", 0.70, "Below this decision confidence, a human must review."],
    ["demand_shift_ratio_threshold", 1.5, "Actual/forecast ratio required to declare a demand shift."],
    ["demand_shift_min_days", 5, "Consecutive elevated days required before a spike counts as a shift."],
    ["review_period_days", 14, "Replenishment review cycle used to size the protection horizon."],
    ["overstock_days_threshold", 45, "Days of cover beyond which an order is flagged as overstock."],
    ["max_remediation_attempts", 2, "How many times the agent may self-correct before escalating."],
    ["immaterial_gap_days", 1, "A residual supply gap smaller than this many days of demand is absorbed rather than re-sourced, since supplier MOQ would force a disproportionate order."],
  ];
  policies.forEach((p) => insPolicy.run(...p));
}
