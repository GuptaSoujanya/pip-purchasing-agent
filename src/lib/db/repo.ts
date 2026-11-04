import { getDb } from "./client";
import type {
  AgentPhase,
  AgentRun,
  AgentStep,
  Approval,
  Budget,
  DemandPoint,
  DecisionKind,
  Forecast,
  Inventory,
  NodeRow,
  PoLine,
  Product,
  Promotion,
  PurchaseOrder,
  PurchaseOrderStatus,
  PurchaseOrderWithLines,
  RunStatus,
  ScenarioKey,
  Supplier,
  SupplierEvent,
  SupplierProduct,
} from "../domain/types";

export const nowIso = () => new Date().toISOString();

/**
 * The system's "today". Fixed by default so that seeded demand history, forecast
 * windows and evaluation assertions stay stable no matter when the repo is run.
 */
export function today(): string {
  return process.env.SIM_TODAY ?? "2026-11-04";
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  const d1 = new Date(a + "T00:00:00Z").getTime();
  const d2 = new Date(b + "T00:00:00Z").getTime();
  return Math.round((d2 - d1) / 86_400_000);
}

export function currentPeriod(): string {
  return today().slice(0, 7);
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

export const getNode = (id: string) =>
  getDb().prepare<[string], NodeRow>("SELECT * FROM nodes WHERE id = ?").get(id) ?? null;

export const listNodes = () =>
  getDb().prepare<[], NodeRow>("SELECT * FROM nodes ORDER BY id").all();

export const getProduct = (id: string) =>
  getDb().prepare<[string], Product>("SELECT * FROM products WHERE id = ?").get(id) ?? null;

export const getProductBySku = (sku: string) =>
  getDb().prepare<[string], Product>("SELECT * FROM products WHERE sku = ?").get(sku) ?? null;

export const listProducts = () =>
  getDb().prepare<[], Product>("SELECT * FROM products ORDER BY sku").all();

export const getSupplier = (id: string) =>
  getDb().prepare<[string], Supplier>("SELECT * FROM suppliers WHERE id = ?").get(id) ?? null;

export const listSuppliers = () =>
  getDb().prepare<[], Supplier>("SELECT * FROM suppliers ORDER BY id").all();

/** Every supplier that can supply a product, preferred first, then cheapest. */
export function listSupplierOptions(productId: string): (SupplierProduct & { supplier: Supplier })[] {
  const rows = getDb()
    .prepare<[string], SupplierProduct>(
      `SELECT sp.* FROM supplier_products sp
       JOIN suppliers s ON s.id = sp.supplier_id
       WHERE sp.product_id = ? AND s.active = 1
       ORDER BY sp.is_preferred DESC, sp.unit_price ASC`,
    )
    .all(productId);
  return rows.map((r) => ({ ...r, supplier: getSupplier(r.supplier_id)! }));
}

export function getSupplierProduct(supplierId: string, productId: string) {
  return (
    getDb()
      .prepare<[string, string], SupplierProduct>(
        "SELECT * FROM supplier_products WHERE supplier_id = ? AND product_id = ?",
      )
      .get(supplierId, productId) ?? null
  );
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export function getInventory(nodeId: string, productId: string) {
  return (
    getDb()
      .prepare<[string, string], Inventory>(
        "SELECT * FROM inventory WHERE node_id = ? AND product_id = ?",
      )
      .get(nodeId, productId) ?? null
  );
}

export const listInventory = () =>
  getDb()
    .prepare<[], Inventory & { sku: string; name: string; node_name: string }>(
      `SELECT i.*, p.sku, p.name, n.name AS node_name
       FROM inventory i
       JOIN products p ON p.id = i.product_id
       JOIN nodes n ON n.id = i.node_id
       ORDER BY p.sku, i.node_id`,
    )
    .all();

export function adjustInTransit(nodeId: string, productId: string, delta: number) {
  getDb()
    .prepare("UPDATE inventory SET in_transit = MAX(0, in_transit + ?) WHERE node_id = ? AND product_id = ?")
    .run(delta, nodeId, productId);
}

// ---------------------------------------------------------------------------
// Demand & forecast
// ---------------------------------------------------------------------------

export function getDemandHistory(nodeId: string, productId: string, days: number): DemandPoint[] {
  const from = addDays(today(), -days);
  return getDb()
    .prepare<[string, string, string], DemandPoint>(
      `SELECT date, units_sold FROM demand_history
       WHERE node_id = ? AND product_id = ? AND date >= ?
       ORDER BY date ASC`,
    )
    .all(nodeId, productId, from);
}

export function getForecast(nodeId: string, productId: string) {
  return (
    getDb()
      .prepare<[string, string], Forecast>(
        `SELECT * FROM forecasts WHERE node_id = ? AND product_id = ?
         ORDER BY generated_at DESC LIMIT 1`,
      )
      .get(nodeId, productId) ?? null
  );
}

export function updateForecast(nodeId: string, productId: string, dailyForecast: number, modelVersion: string) {
  const f = getForecast(nodeId, productId);
  if (!f) return null;
  getDb()
    .prepare(
      `UPDATE forecasts SET daily_forecast = ?, confidence_low = ?, confidence_high = ?,
       model_version = ?, generated_at = ? WHERE id = ?`,
    )
    .run(dailyForecast, dailyForecast * 0.8, dailyForecast * 1.2, modelVersion, nowIso(), f.id);
  return getForecast(nodeId, productId);
}

export function getActivePromotions(nodeId: string, productId: string): Promotion[] {
  const t = today();
  return getDb()
    .prepare<[string, string, string, string], Promotion>(
      `SELECT * FROM promotions
       WHERE node_id = ? AND product_id = ? AND start_date <= ? AND end_date >= ?`,
    )
    .all(nodeId, productId, t, t);
}

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------

export function getPoLines(poId: string): PoLine[] {
  return getDb().prepare<[string], PoLine>("SELECT * FROM po_lines WHERE po_id = ?").all(poId);
}

export function getPo(poId: string): PurchaseOrderWithLines | null {
  const po = getDb()
    .prepare<[string], PurchaseOrder>("SELECT * FROM purchase_orders WHERE id = ?")
    .get(poId);
  if (!po) return null;
  return { ...po, lines: getPoLines(poId) };
}

export function getPoByNumber(poNumber: string): PurchaseOrderWithLines | null {
  const po = getDb()
    .prepare<[string], PurchaseOrder>("SELECT * FROM purchase_orders WHERE po_number = ?")
    .get(poNumber);
  return po ? getPo(po.id) : null;
}

const OPEN_STATUSES = "('draft','submitted','confirmed','partially_confirmed')";

/** Open POs that will bring stock of this product into this node. */
export function getOpenPos(nodeId: string, productId: string): PurchaseOrderWithLines[] {
  const pos = getDb()
    .prepare<[string, string], PurchaseOrder>(
      `SELECT DISTINCT po.* FROM purchase_orders po
       JOIN po_lines l ON l.po_id = po.id
       WHERE po.node_id = ? AND l.product_id = ? AND po.status IN ${OPEN_STATUSES}
       ORDER BY po.expected_delivery ASC`,
    )
    .all(nodeId, productId);
  return pos.map((p) => ({ ...p, lines: getPoLines(p.id) }));
}

export function listPos(): PurchaseOrderWithLines[] {
  const pos = getDb()
    .prepare<[], PurchaseOrder>("SELECT * FROM purchase_orders ORDER BY created_at DESC")
    .all();
  return pos.map((p) => ({ ...p, lines: getPoLines(p.id) }));
}

let poCounter = 0;
export function nextPoNumber(): string {
  const row = getDb()
    .prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM purchase_orders")
    .get()!;
  poCounter += 1;
  return `PO-${3000 + row.n + poCounter}`;
}

export function insertPo(args: {
  id: string;
  po_number: string;
  supplier_id: string;
  node_id: string;
  status: PurchaseOrderStatus;
  expected_delivery: string | null;
  total_cost: number;
  created_by: string;
  notes?: string | null;
  lines: { product_id: string; qty_ordered: number; qty_confirmed?: number; unit_price: number }[];
}): PurchaseOrderWithLines {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO purchase_orders
       (id, po_number, supplier_id, node_id, status, created_at, expected_delivery, total_cost, created_by, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      args.id,
      args.po_number,
      args.supplier_id,
      args.node_id,
      args.status,
      nowIso(),
      args.expected_delivery,
      args.total_cost,
      args.created_by,
      args.notes ?? null,
    );
    for (const l of args.lines) {
      db.prepare(
        `INSERT INTO po_lines (po_id, product_id, qty_ordered, qty_confirmed, qty_received, unit_price)
         VALUES (?,?,?,?,0,?)`,
      ).run(args.id, l.product_id, l.qty_ordered, l.qty_confirmed ?? 0, l.unit_price);
    }
  });
  tx();
  return getPo(args.id)!;
}

export function updatePoStatus(poId: string, status: PurchaseOrderStatus, notes?: string) {
  getDb()
    .prepare("UPDATE purchase_orders SET status = ?, notes = COALESCE(?, notes) WHERE id = ?")
    .run(status, notes ?? null, poId);
}

export function updatePoLineQty(
  poId: string,
  productId: string,
  patch: { qty_ordered?: number; qty_confirmed?: number; qty_received?: number },
) {
  const sets: string[] = [];
  const vals: number[] = [];
  if (patch.qty_ordered !== undefined) { sets.push("qty_ordered = ?"); vals.push(patch.qty_ordered); }
  if (patch.qty_confirmed !== undefined) { sets.push("qty_confirmed = ?"); vals.push(patch.qty_confirmed); }
  if (patch.qty_received !== undefined) { sets.push("qty_received = ?"); vals.push(patch.qty_received); }
  if (!sets.length) return;
  getDb()
    .prepare(`UPDATE po_lines SET ${sets.join(", ")} WHERE po_id = ? AND product_id = ?`)
    .run(...vals, poId, productId);
}

export function recomputePoTotal(poId: string) {
  const lines = getPoLines(poId);
  // Cost commitment follows confirmed quantity once confirmed, else ordered.
  const total = lines.reduce(
    (s, l) => s + (l.qty_confirmed > 0 ? l.qty_confirmed : l.qty_ordered) * l.unit_price,
    0,
  );
  getDb().prepare("UPDATE purchase_orders SET total_cost = ? WHERE id = ?").run(total, poId);
  return total;
}

// ---------------------------------------------------------------------------
// Supplier events
// ---------------------------------------------------------------------------

export function listSupplierEvents(onlyUnprocessed = false): SupplierEvent[] {
  const sql = onlyUnprocessed
    ? "SELECT * FROM supplier_events WHERE processed = 0 ORDER BY created_at DESC"
    : "SELECT * FROM supplier_events ORDER BY created_at DESC";
  return getDb().prepare<[], SupplierEvent>(sql).all();
}

export function getSupplierEvent(id: string) {
  return (
    getDb().prepare<[string], SupplierEvent>("SELECT * FROM supplier_events WHERE id = ?").get(id) ??
    null
  );
}

export function markEventProcessed(id: string) {
  getDb().prepare("UPDATE supplier_events SET processed = 1 WHERE id = ?").run(id);
}

export function insertSupplierEvent(e: Omit<SupplierEvent, "created_at" | "processed">) {
  getDb()
    .prepare(
      `INSERT INTO supplier_events (id, supplier_id, po_id, event_type, payload_json, created_at, processed)
       VALUES (?,?,?,?,?,?,0)`,
    )
    .run(e.id, e.supplier_id, e.po_id, e.event_type, e.payload_json, nowIso());
  return getSupplierEvent(e.id)!;
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

export function getBudget(nodeId: string, period = currentPeriod()) {
  return (
    getDb()
      .prepare<[string, string], Budget>("SELECT * FROM budgets WHERE node_id = ? AND period = ?")
      .get(nodeId, period) ?? null
  );
}

export const listBudgets = () =>
  getDb().prepare<[], Budget>("SELECT * FROM budgets ORDER BY node_id").all();

export function commitBudget(nodeId: string, amount: number, period = currentPeriod()) {
  getDb()
    .prepare("UPDATE budgets SET committed = committed + ? WHERE node_id = ? AND period = ?")
    .run(amount, nodeId, period);
}

export const budgetAvailable = (b: Budget) => b.total_budget - b.committed - b.spent;

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export function consumeStorage(nodeId: string, slots: number) {
  getDb()
    .prepare("UPDATE nodes SET storage_used_slots = storage_used_slots + ? WHERE id = ?")
    .run(slots, nodeId);
}

export const storageFreeSlots = (n: NodeRow) => n.storage_capacity_slots - n.storage_used_slots;

// ---------------------------------------------------------------------------
// Agent policies
// ---------------------------------------------------------------------------

export function getPolicies(): Record<string, number> {
  const rows = getDb()
    .prepare<[], { key: string; value: number }>("SELECT key, value FROM agent_policies")
    .all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function listPolicyRows() {
  return getDb()
    .prepare<[], { key: string; value: number; description: string }>(
      "SELECT * FROM agent_policies ORDER BY key",
    )
    .all();
}

// ---------------------------------------------------------------------------
// Agent runs & trace
// ---------------------------------------------------------------------------

export function createRun(args: {
  id: string;
  scenario: ScenarioKey;
  mode: "llm" | "deterministic";
  input: unknown;
}) {
  getDb()
    .prepare(
      `INSERT INTO agent_runs (id, scenario, mode, input_json, status, started_at)
       VALUES (?,?,?,?,'running',?)`,
    )
    .run(args.id, args.scenario, args.mode, JSON.stringify(args.input), nowIso());
}

export function finishRun(
  id: string,
  patch: { status: RunStatus; decision?: DecisionKind | null; confidence?: number | null; summary?: string },
) {
  getDb()
    .prepare(
      `UPDATE agent_runs SET status = ?, decision = ?, confidence = ?, summary = ?, finished_at = ?
       WHERE id = ?`,
    )
    .run(
      patch.status,
      patch.decision ?? null,
      patch.confidence ?? null,
      patch.summary ?? null,
      nowIso(),
      id,
    );
}

export function getRun(id: string) {
  return getDb().prepare<[string], AgentRun>("SELECT * FROM agent_runs WHERE id = ?").get(id) ?? null;
}

export const listRuns = (limit = 50) =>
  getDb()
    .prepare<[number], AgentRun>("SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT ?")
    .all(limit);

export function appendStep(step: {
  run_id: string;
  seq: number;
  phase: AgentPhase;
  type: AgentStep["type"];
  tool_name?: string | null;
  input?: unknown;
  output?: unknown;
  reasoning?: string | null;
  ok?: boolean;
  duration_ms?: number;
}) {
  getDb()
    .prepare(
      `INSERT INTO agent_steps
       (run_id, seq, phase, type, tool_name, input_json, output_json, reasoning, ok, duration_ms, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      step.run_id,
      step.seq,
      step.phase,
      step.type,
      step.tool_name ?? null,
      step.input === undefined ? null : JSON.stringify(step.input),
      step.output === undefined ? null : JSON.stringify(step.output),
      step.reasoning ?? null,
      step.ok === false ? 0 : 1,
      step.duration_ms ?? 0,
      nowIso(),
    );
}

export const getSteps = (runId: string) =>
  getDb()
    .prepare<[string], AgentStep>("SELECT * FROM agent_steps WHERE run_id = ? ORDER BY seq ASC")
    .all(runId);

export function recordValidation(runId: string, phase: "pre" | "post", passed: boolean, checks: unknown) {
  getDb()
    .prepare(
      "INSERT INTO validations (run_id, phase, passed, checks_json, created_at) VALUES (?,?,?,?,?)",
    )
    .run(runId, phase, passed ? 1 : 0, JSON.stringify(checks), nowIso());
}

export const getValidations = (runId: string) =>
  getDb()
    .prepare<[string], { id: number; run_id: string; phase: string; passed: number; checks_json: string; created_at: string }>(
      "SELECT * FROM validations WHERE run_id = ? ORDER BY id ASC",
    )
    .all(runId);

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

export function createApproval(a: {
  id: string;
  run_id: string;
  action: unknown;
  reason: string;
  risk_level: "low" | "medium" | "high";
}) {
  getDb()
    .prepare(
      `INSERT INTO approvals (id, run_id, action_json, reason, risk_level, status, requested_at)
       VALUES (?,?,?,?,?,'pending',?)`,
    )
    .run(a.id, a.run_id, JSON.stringify(a.action), a.reason, a.risk_level, nowIso());
  return getApproval(a.id)!;
}

export const getApproval = (id: string) =>
  getDb().prepare<[string], Approval>("SELECT * FROM approvals WHERE id = ?").get(id) ?? null;

export const listApprovals = (status?: string) =>
  status
    ? getDb()
        .prepare<[string], Approval>("SELECT * FROM approvals WHERE status = ? ORDER BY requested_at DESC")
        .all(status)
    : getDb().prepare<[], Approval>("SELECT * FROM approvals ORDER BY requested_at DESC").all();

export function resolveApproval(id: string, status: "approved" | "rejected", by: string, note?: string) {
  getDb()
    .prepare(
      "UPDATE approvals SET status = ?, resolved_at = ?, resolved_by = ?, resolution_note = ? WHERE id = ?",
    )
    .run(status, nowIso(), by, note ?? null, id);
  return getApproval(id)!;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export function audit(a: {
  entity_type: string;
  entity_id: string;
  action: string;
  actor: string;
  run_id?: string | null;
  before?: unknown;
  after?: unknown;
}) {
  getDb()
    .prepare(
      `INSERT INTO audit_log (entity_type, entity_id, action, actor, run_id, before_json, after_json, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(
      a.entity_type,
      a.entity_id,
      a.action,
      a.actor,
      a.run_id ?? null,
      a.before === undefined ? null : JSON.stringify(a.before),
      a.after === undefined ? null : JSON.stringify(a.after),
      nowIso(),
    );
}

export const listAudit = (limit = 100) =>
  getDb()
    .prepare<[number], {
      id: number; entity_type: string; entity_id: string; action: string;
      actor: string; run_id: string | null; before_json: string | null;
      after_json: string | null; created_at: string;
    }>("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?")
    .all(limit);
