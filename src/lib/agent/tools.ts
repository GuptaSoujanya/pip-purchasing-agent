import { z } from "zod";
import {
  addDays,
  adjustInTransit,
  audit,
  budgetAvailable,
  commitBudget,
  consumeStorage,
  createApproval,
  getActivePromotions,
  getBudget,
  getDemandHistory,
  getForecast,
  getInventory,
  getNode,
  getOpenPos,
  getPo,
  getProduct,
  getSupplier,
  getSupplierProduct,
  insertPo,
  listSupplierOptions,
  nextPoNumber,
  recomputePoTotal,
  storageFreeSlots,
  today,
  updateForecast,
  updatePoLineQty,
  updatePoStatus,
} from "../db/repo";
import { validatePurchase } from "../domain/constraints";
import {
  computeNetRequirement,
  demandStats,
  detectDemandShift,
  shapeOrderQty,
} from "../domain/math";
import { findNodeWithCapacity, REVIEW_PERIOD_DAYS } from "../domain/policy";
import { checkAvailability, submitOrder } from "../mock/supplier-gateway";

/**
 * The agent's tool surface.
 *
 * Two hard rules shape this file:
 *
 *   1. The model never does arithmetic. Anything numeric is a tool that runs
 *      real code against real data, so figures are reproducible and auditable.
 *   2. Every mutating tool re-validates against the constraint engine itself.
 *      Even if the orchestrator or the model skipped a check, a write that
 *      would breach a hard constraint is refused at the tool boundary.
 */

export type ToolContext = {
  runId: string;
  actor: string;
  /** When false, mutating tools report what they *would* do without writing. */
  allowWrites: boolean;
};

export type ToolResult = { ok: boolean; data?: unknown; error?: string };

export type ToolDef = {
  name: string;
  description: string;
  /** read tools are always available; write tools are gated by the autonomy layer. */
  kind: "read" | "write";
  schema: z.ZodTypeAny;
  handler: (args: any, ctx: ToolContext) => ToolResult;
};

const okResult = (data: unknown): ToolResult => ({ ok: true, data });
const errResult = (error: string): ToolResult => ({ ok: false, error });

// ===========================================================================
// READ TOOLS — investigation
// ===========================================================================

const getInventoryTool: ToolDef = {
  name: "get_inventory",
  description:
    "Current stock position for a product at a node: on hand, reserved for customer orders, in transit on open POs, safety stock and reorder point.",
  kind: "read",
  schema: z.object({ node_id: z.string(), product_id: z.string() }),
  handler: ({ node_id, product_id }) => {
    const inv = getInventory(node_id, product_id);
    if (!inv) return errResult(`No inventory record for ${product_id} at ${node_id}.`);
    const product = getProduct(product_id);
    return okResult({
      ...inv,
      sku: product?.sku,
      product_name: product?.name,
      available_to_promise: inv.on_hand + inv.in_transit - inv.reserved,
      sellable_now: inv.on_hand - inv.reserved,
      shelf_life_days: product?.shelf_life_days,
      slots_per_unit: product?.slots_per_unit,
    });
  },
};

const getDemandHistoryTool: ToolDef = {
  name: "get_demand_history",
  description:
    "Daily units sold over a trailing window, plus summary statistics (mean, standard deviation, coefficient of variation, last-7-day mean, trend ratio vs the forecast baseline).",
  kind: "read",
  schema: z.object({
    node_id: z.string(),
    product_id: z.string(),
    days: z.number().int().min(1).max(90).default(35),
  }),
  handler: ({ node_id, product_id, days }) => {
    const points = getDemandHistory(node_id, product_id, days ?? 35);
    if (!points.length) return errResult(`No demand history for ${product_id} at ${node_id}.`);
    const fc = getForecast(node_id, product_id);
    return okResult({
      window_days: points.length,
      stats: demandStats(points, fc?.daily_forecast ?? 0),
      series: points,
    });
  },
};

const getForecastTool: ToolDef = {
  name: "get_forecast",
  description:
    "The demand forecast the planning system is currently using, with its confidence band, model version and generation timestamp. Treat this as a claim to be verified, not as truth.",
  kind: "read",
  schema: z.object({ node_id: z.string(), product_id: z.string() }),
  handler: ({ node_id, product_id }) => {
    const fc = getForecast(node_id, product_id);
    if (!fc) return errResult(`No forecast on file for ${product_id} at ${node_id}.`);
    return okResult(fc);
  },
};

const getOpenPosTool: ToolDef = {
  name: "get_open_purchase_orders",
  description:
    "Open purchase orders that will bring stock of this product into this node, with ordered/confirmed quantities and expected delivery dates.",
  kind: "read",
  schema: z.object({ node_id: z.string(), product_id: z.string() }),
  handler: ({ node_id, product_id }) => {
    const pos = getOpenPos(node_id, product_id);
    return okResult(
      pos.map((p) => {
        const line = p.lines.find((l) => l.product_id === product_id);
        return {
          po_number: p.po_number,
          po_id: p.id,
          supplier: getSupplier(p.supplier_id)?.name,
          supplier_id: p.supplier_id,
          status: p.status,
          expected_delivery: p.expected_delivery,
          days_until_delivery: p.expected_delivery
            ? Math.round(
                (new Date(p.expected_delivery + "T00:00:00Z").getTime() -
                  new Date(today() + "T00:00:00Z").getTime()) / 86_400_000,
              )
            : null,
          qty_ordered: line?.qty_ordered ?? 0,
          qty_confirmed: line?.qty_confirmed ?? 0,
          unit_price: line?.unit_price ?? 0,
        };
      }),
    );
  },
};

const getPurchaseOrderTool: ToolDef = {
  name: "get_purchase_order",
  description: "Full detail of a single purchase order including all of its lines.",
  kind: "read",
  schema: z.object({ po_id: z.string() }),
  handler: ({ po_id }) => {
    const po = getPo(po_id);
    if (!po) return errResult(`Purchase order ${po_id} not found.`);
    return okResult({ ...po, supplier_name: getSupplier(po.supplier_id)?.name });
  },
};

const listSuppliersTool: ToolDef = {
  name: "list_supplier_options",
  description:
    "Every active supplier that can supply a product, with unit price, MOQ, lot size, lead time, per-order capacity, expedite terms and historical reliability (fill rate).",
  kind: "read",
  schema: z.object({ product_id: z.string() }),
  handler: ({ product_id }) => {
    const opts = listSupplierOptions(product_id);
    if (!opts.length) return errResult(`No active supplier lists ${product_id}.`);
    return okResult(
      opts.map((o) => ({
        supplier_id: o.supplier_id,
        supplier_name: o.supplier.name,
        unit_price: o.unit_price,
        moq: o.moq,
        lot_size: o.lot_size,
        lead_time_days: o.lead_time_days,
        max_units_per_order: o.max_units_per_order,
        expedite_available: !!o.expedite_available,
        expedite_lead_time_days: o.expedite_lead_time_days,
        expedite_surcharge_pct: o.expedite_surcharge_pct,
        reliability_score: o.supplier.reliability_score,
        is_preferred: !!o.is_preferred,
      })),
    );
  },
};

const getBudgetTool: ToolDef = {
  name: "get_budget",
  description: "Purchasing budget for a node in the current period: total, committed to open POs, already spent, and what remains available.",
  kind: "read",
  schema: z.object({ node_id: z.string() }),
  handler: ({ node_id }) => {
    const b = getBudget(node_id);
    if (!b) return errResult(`No budget record for ${node_id}.`);
    return okResult({ ...b, available: budgetAvailable(b) });
  },
};

const getStorageTool: ToolDef = {
  name: "get_storage_capacity",
  description: "Storage capacity and current utilisation at a node, in abstract slots. Bulky products consume more slots per unit.",
  kind: "read",
  schema: z.object({ node_id: z.string() }),
  handler: ({ node_id }) => {
    const n = getNode(node_id);
    if (!n) return errResult(`Node ${node_id} not found.`);
    return okResult({
      node_id: n.id,
      node_name: n.name,
      capacity_slots: n.storage_capacity_slots,
      used_slots: n.storage_used_slots,
      free_slots: storageFreeSlots(n),
      utilisation_pct: Math.round((n.storage_used_slots / n.storage_capacity_slots) * 100),
    });
  },
};

const getPromotionsTool: ToolDef = {
  name: "get_active_promotions",
  description:
    "Promotions running right now for a product at a node. Essential context: a demand spike during a promotion is temporary and must not be used to permanently raise the forecast.",
  kind: "read",
  schema: z.object({ node_id: z.string(), product_id: z.string() }),
  handler: ({ node_id, product_id }) => okResult(getActivePromotions(node_id, product_id)),
};

const computeNetRequirementTool: ToolDef = {
  name: "compute_net_requirement",
  description:
    "Compute how many units actually need to be bought: demand over (lead time + review period) + safety stock - on hand - in transit + reserved. Returns the full working so the arithmetic is auditable.",
  kind: "read",
  schema: z.object({
    node_id: z.string(),
    product_id: z.string(),
    daily_demand: z.number().positive(),
    lead_time_days: z.number().int().positive(),
    review_period_days: z.number().int().min(0).default(REVIEW_PERIOD_DAYS),
  }),
  handler: ({ node_id, product_id, daily_demand, lead_time_days, review_period_days }) => {
    const inv = getInventory(node_id, product_id);
    if (!inv) return errResult(`No inventory record for ${product_id} at ${node_id}.`);
    return okResult(
      computeNetRequirement({
        inventory: inv,
        dailyDemand: daily_demand,
        leadTimeDays: lead_time_days,
        reviewPeriodDays: review_period_days ?? REVIEW_PERIOD_DAYS,
      }),
    );
  },
};

const detectDemandShiftTool: ToolDef = {
  name: "detect_demand_shift",
  description:
    "Test whether recent demand represents a genuine, sustained shift rather than noise or a promotional blip. Applies four evidence gates: magnitude vs forecast, sustainment over consecutive days, statistical significance (z-score), and promotional attribution.",
  kind: "read",
  schema: z.object({ node_id: z.string(), product_id: z.string() }),
  handler: ({ node_id, product_id }) => {
    const points = getDemandHistory(node_id, product_id, 35);
    if (!points.length) return errResult(`No demand history for ${product_id} at ${node_id}.`);
    return okResult(
      detectDemandShift({
        points,
        forecast: getForecast(node_id, product_id),
        promotions: getActivePromotions(node_id, product_id),
      }),
    );
  },
};

const shapeOrderTool: ToolDef = {
  name: "shape_order_quantity",
  description:
    "Adjust a desired quantity to something a supplier will accept: round up to the lot size, lift to the MOQ, and flag if it exceeds the per-order cap.",
  kind: "read",
  schema: z.object({
    supplier_id: z.string(),
    product_id: z.string(),
    desired_qty: z.number().int().min(0),
  }),
  handler: ({ supplier_id, product_id, desired_qty }) => {
    const sp = getSupplierProduct(supplier_id, product_id);
    if (!sp) return errResult(`${supplier_id} does not supply ${product_id}.`);
    return okResult(shapeOrderQty(desired_qty, sp));
  },
};

const validatePurchaseTool: ToolDef = {
  name: "validate_purchase",
  description:
    "Dry-run a proposed purchase against every constraint — budget, storage, MOQ, lot size, supplier capacity, overstock, shelf life, reliability, lead time vs stockout. Returns pass/fail per check plus the largest quantity that would satisfy all hard constraints. Call this BEFORE creating any purchase order.",
  kind: "read",
  schema: z.object({
    supplier_id: z.string(),
    node_id: z.string(),
    product_id: z.string(),
    qty: z.number().int().min(0),
    daily_demand: z.number().min(0),
    expedite: z.boolean().optional(),
  }),
  handler: (a) =>
    okResult(
      validatePurchase({
        supplier_id: a.supplier_id,
        node_id: a.node_id,
        product_id: a.product_id,
        qty: a.qty,
        dailyDemand: a.daily_demand,
        expedite: a.expedite,
      }),
    ),
};

const checkAvailabilityTool: ToolDef = {
  name: "check_supplier_availability",
  description:
    "Ask the supplier's external system what it can actually deliver right now. This can differ from the contracted terms — a supplier may be on allocation. Use before committing to a large order.",
  kind: "read",
  schema: z.object({
    supplier_id: z.string(),
    product_id: z.string(),
    qty: z.number().int().positive(),
  }),
  handler: (a) => okResult(checkAvailability(a)),
};

const findCapacityTool: ToolDef = {
  name: "find_node_with_capacity",
  description:
    "Find another fulfilment node with enough free storage to receive a given quantity. Used to redirect overflow when the target node is storage-constrained.",
  kind: "read",
  schema: z.object({
    product_id: z.string(),
    units: z.number().int().positive(),
    exclude_node_id: z.string(),
  }),
  handler: ({ product_id, units, exclude_node_id }) => {
    const n = findNodeWithCapacity(product_id, units, exclude_node_id);
    if (!n) return okResult({ found: false });
    return okResult({
      found: true,
      node_id: n.id,
      node_name: n.name,
      free_slots: storageFreeSlots(n),
    });
  },
};

// ===========================================================================
// WRITE TOOLS — action
// ===========================================================================

const createPoTool: ToolDef = {
  name: "create_purchase_order",
  description:
    "Create and submit a purchase order to a supplier. The supplier's external system may confirm less than requested, so the result MUST be verified afterwards. Refuses outright if any hard constraint would be breached.",
  kind: "write",
  schema: z.object({
    supplier_id: z.string(),
    node_id: z.string(),
    product_id: z.string(),
    qty: z.number().int().positive(),
    daily_demand: z.number().min(0),
    expedite: z.boolean().optional(),
    reason: z.string(),
  }),
  handler: (a, ctx) => {
    // Tool-boundary guard: never write something that breaches a hard constraint,
    // regardless of what the caller believes.
    const v = validatePurchase({
      supplier_id: a.supplier_id, node_id: a.node_id, product_id: a.product_id,
      qty: a.qty, dailyDemand: a.daily_demand, expedite: a.expedite,
    });
    if (!v.passed) {
      return errResult(
        `Refused: hard constraints would be breached (${v.hardFailures.map((f) => f.code).join(", ")}). ` +
          `Largest feasible quantity is ${v.maxFeasibleQty}.`,
      );
    }

    const product = getProduct(a.product_id)!;
    const sp = getSupplierProduct(a.supplier_id, a.product_id)!;
    const poNumber = nextPoNumber();

    if (!ctx.allowWrites) {
      return okResult({ dryRun: true, would_create: { ...a, po_number: poNumber } });
    }

    // Submit to the external supplier system. This is where reality bites.
    const resp = submitOrder({
      supplier_id: a.supplier_id, product_id: a.product_id,
      qty: a.qty, expedite: a.expedite, po_number: poNumber,
    });

    if (!resp.accepted || resp.confirmedQty === 0) {
      return errResult(`Supplier rejected the order: ${resp.message}`);
    }

    const status =
      resp.confirmedQty === a.qty ? "confirmed" : "partially_confirmed";
    const totalCost = resp.confirmedQty * resp.unitPrice;

    const po = insertPo({
      id: poNumber,
      po_number: poNumber,
      supplier_id: a.supplier_id,
      node_id: a.node_id,
      status,
      expected_delivery: addDays(today(), resp.leadTimeDays),
      total_cost: totalCost,
      created_by: ctx.actor,
      notes: `${a.reason} | Supplier response: ${resp.message}`,
      lines: [
        {
          product_id: a.product_id,
          qty_ordered: a.qty,
          qty_confirmed: resp.confirmedQty,
          unit_price: resp.unitPrice,
        },
      ],
    });

    // Commit money, space and inbound stock against the CONFIRMED quantity only.
    commitBudget(a.node_id, totalCost);
    consumeStorage(a.node_id, resp.confirmedQty * product.slots_per_unit);
    adjustInTransit(a.node_id, a.product_id, resp.confirmedQty);

    audit({
      entity_type: "purchase_order", entity_id: po.id, action: "create",
      actor: ctx.actor, run_id: ctx.runId, after: po,
    });

    return okResult({
      po_id: po.id,
      po_number: po.po_number,
      status,
      requested_qty: a.qty,
      confirmed_qty: resp.confirmedQty,
      shortfall: a.qty - resp.confirmedQty,
      unit_price: resp.unitPrice,
      total_cost: totalCost,
      expected_delivery: po.expected_delivery,
      lead_time_days: resp.leadTimeDays,
      supplier_message: resp.message,
      moq: sp.moq,
      lot_size: sp.lot_size,
    });
  },
};

const amendPoTool: ToolDef = {
  name: "amend_purchase_order",
  description:
    "Change the quantity on an existing purchase order line, releasing or committing the corresponding budget and storage. Used to lock in a partial delivery or to resize an order.",
  kind: "write",
  schema: z.object({
    po_id: z.string(),
    product_id: z.string(),
    new_qty: z.number().int().min(0),
    reason: z.string(),
  }),
  handler: ({ po_id, product_id, new_qty, reason }, ctx) => {
    const po = getPo(po_id);
    if (!po) return errResult(`Purchase order ${po_id} not found.`);
    const line = po.lines.find((l) => l.product_id === product_id);
    if (!line) return errResult(`${po.po_number} has no line for ${product_id}.`);

    if (!ctx.allowWrites) {
      return okResult({ dryRun: true, would_amend: { po_id, product_id, new_qty } });
    }

    const before = { ...po };
    const product = getProduct(product_id)!;
    const previousEffective = line.qty_confirmed > 0 ? line.qty_confirmed : line.qty_ordered;
    const delta = new_qty - previousEffective;

    updatePoLineQty(po_id, product_id, { qty_ordered: new_qty, qty_confirmed: new_qty });
    const newTotal = recomputePoTotal(po_id);

    // Release (or commit) the difference in money, space and inbound stock.
    commitBudget(po.node_id, delta * line.unit_price);
    consumeStorage(po.node_id, delta * product.slots_per_unit);
    adjustInTransit(po.node_id, product_id, delta);

    const status = new_qty === 0 ? "cancelled" : "confirmed";
    updatePoStatus(po_id, status, `${po.notes ?? ""} | Amended: ${reason}`.trim());

    const after = getPo(po_id)!;
    audit({
      entity_type: "purchase_order", entity_id: po_id, action: "amend",
      actor: ctx.actor, run_id: ctx.runId, before, after,
    });

    return okResult({
      po_id, po_number: po.po_number, previous_qty: previousEffective,
      new_qty, delta, new_total_cost: newTotal, status,
    });
  },
};

const cancelPoTool: ToolDef = {
  name: "cancel_purchase_order",
  description: "Cancel a purchase order entirely, releasing all committed budget, storage and inbound stock.",
  kind: "write",
  schema: z.object({ po_id: z.string(), reason: z.string() }),
  handler: ({ po_id, reason }, ctx) => {
    const po = getPo(po_id);
    if (!po) return errResult(`Purchase order ${po_id} not found.`);
    if (!ctx.allowWrites) return okResult({ dryRun: true, would_cancel: po_id });

    const before = { ...po };
    for (const line of po.lines) {
      const product = getProduct(line.product_id)!;
      const effective = line.qty_confirmed > 0 ? line.qty_confirmed : line.qty_ordered;
      commitBudget(po.node_id, -effective * line.unit_price);
      consumeStorage(po.node_id, -effective * product.slots_per_unit);
      adjustInTransit(po.node_id, line.product_id, -effective);
      updatePoLineQty(po_id, line.product_id, { qty_confirmed: 0 });
    }
    updatePoStatus(po_id, "cancelled", `Cancelled: ${reason}`);
    audit({
      entity_type: "purchase_order", entity_id: po_id, action: "cancel",
      actor: ctx.actor, run_id: ctx.runId, before, after: getPo(po_id),
    });
    return okResult({ po_id, po_number: po.po_number, status: "cancelled" });
  },
};

const updateForecastTool: ToolDef = {
  name: "update_forecast_baseline",
  description:
    "Permanently change the forecast baseline for a product at a node. Only appropriate when a demand shift has been confirmed as genuine and sustained — never for a promotional spike.",
  kind: "write",
  schema: z.object({
    node_id: z.string(),
    product_id: z.string(),
    new_daily_forecast: z.number().positive(),
    justification: z.string(),
  }),
  handler: ({ node_id, product_id, new_daily_forecast, justification }, ctx) => {
    // Guard: refuse to rebase on demand that a promotion explains.
    const evidence = detectDemandShift({
      points: getDemandHistory(node_id, product_id, 35),
      forecast: getForecast(node_id, product_id),
      promotions: getActivePromotions(node_id, product_id),
    });
    if (evidence.explainedByPromotion) {
      return errResult(
        `Refused: the elevated demand is explained by the active promotion "${evidence.promotion?.description}". ` +
          "Rebasing the forecast on promotional demand would cause structural overstock once it ends.",
      );
    }
    if (!evidence.shiftDetected) {
      return errResult(
        `Refused: evidence does not support a baseline change (trend ratio ${evidence.trendRatio}x, ` +
          `${evidence.consecutiveElevatedDays} sustained days, z=${evidence.zScoreOfLast7}).`,
      );
    }
    if (!ctx.allowWrites) return okResult({ dryRun: true, would_set: new_daily_forecast });

    const before = getForecast(node_id, product_id);
    const after = updateForecast(node_id, product_id, new_daily_forecast, "agent-rebase-v1");
    audit({
      entity_type: "forecast", entity_id: `${node_id}:${product_id}`, action: "rebase",
      actor: ctx.actor, run_id: ctx.runId, before, after,
    });
    return okResult({ previous: before?.daily_forecast, current: new_daily_forecast, justification });
  },
};

const requestApprovalTool: ToolDef = {
  name: "request_human_approval",
  description:
    "Queue an action for a buyer to approve before it executes. Use when the action exceeds the agent's autonomy limits — high value, large deviation from the recommendation, price premium, new supplier, or low confidence.",
  kind: "write",
  schema: z.object({
    action: z.record(z.any()),
    reason: z.string(),
    risk_level: z.enum(["low", "medium", "high"]),
  }),
  handler: ({ action, reason, risk_level }, ctx) => {
    const id = `APR-${ctx.runId.slice(-6)}-${Date.now().toString(36).slice(-4)}`;
    const approval = createApproval({ id, run_id: ctx.runId, action, reason, risk_level });
    audit({
      entity_type: "approval", entity_id: id, action: "request",
      actor: ctx.actor, run_id: ctx.runId, after: approval,
    });
    return okResult({ approval_id: id, status: "pending", reason, risk_level });
  },
};

const escalateTool: ToolDef = {
  name: "escalate_to_buyer",
  description:
    "Stop and hand the situation to a human, with the full picture. Use when constraints cannot be satisfied by any available action, when evidence is contradictory, or when self-correction has been exhausted.",
  kind: "write",
  schema: z.object({
    reason: z.string(),
    blocking_constraints: z.array(z.string()).default([]),
    options_considered: z.array(z.string()).default([]),
  }),
  handler: (a, ctx) => {
    const id = `ESC-${ctx.runId.slice(-6)}-${Date.now().toString(36).slice(-4)}`;
    createApproval({
      id, run_id: ctx.runId,
      action: { kind: "escalation", ...a },
      reason: a.reason, risk_level: "high",
    });
    audit({
      entity_type: "escalation", entity_id: id, action: "escalate",
      actor: ctx.actor, run_id: ctx.runId, after: a,
    });
    return okResult({ escalation_id: id, ...a });
  },
};

// ===========================================================================
// Registry
// ===========================================================================

export const TOOLS: ToolDef[] = [
  getInventoryTool,
  getDemandHistoryTool,
  getForecastTool,
  getOpenPosTool,
  getPurchaseOrderTool,
  listSuppliersTool,
  getBudgetTool,
  getStorageTool,
  getPromotionsTool,
  computeNetRequirementTool,
  detectDemandShiftTool,
  shapeOrderTool,
  validatePurchaseTool,
  checkAvailabilityTool,
  findCapacityTool,
  createPoTool,
  amendPoTool,
  cancelPoTool,
  updateForecastTool,
  requestApprovalTool,
  escalateTool,
];

export const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

export function callTool(name: string, rawArgs: unknown, ctx: ToolContext): ToolResult {
  const tool = TOOL_MAP.get(name);
  if (!tool) return errResult(`Unknown tool "${name}".`);
  const parsed = tool.schema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return errResult(
      `Invalid arguments for ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  try {
    return tool.handler(parsed.data, ctx);
  } catch (e) {
    return errResult(`${name} threw: ${(e as Error).message}`);
  }
}

/** JSON-Schema tool definitions for LLM function calling. */
export function toolsAsJsonSchema() {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: zodToJsonSchema(t.schema as z.ZodObject<any>),
  }));
}

/**
 * Minimal Zod -> JSON Schema conversion covering the shapes used above.
 * Avoids pulling in a dependency for what is a dozen flat object schemas.
 */
function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def: any = (schema as any)._def;

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value);
      if (!value.isOptional()) required.push(key);
    }
    return { type: "object", properties, required, additionalProperties: false };
  }
  if (schema instanceof z.ZodString) return { type: "string" };
  if (schema instanceof z.ZodNumber) {
    return def.checks?.some((c: any) => c.kind === "int")
      ? { type: "integer" }
      : { type: "number" };
  }
  if (schema instanceof z.ZodBoolean) return { type: "boolean" };
  if (schema instanceof z.ZodArray) return { type: "array", items: zodToJsonSchema(def.type) };
  if (schema instanceof z.ZodEnum) return { type: "string", enum: def.values };
  if (schema instanceof z.ZodRecord) return { type: "object", additionalProperties: true };
  if (schema instanceof z.ZodDefault) return zodToJsonSchema(def.innerType);
  if (schema instanceof z.ZodOptional) return zodToJsonSchema(def.innerType);
  if (schema instanceof z.ZodNullable) return zodToJsonSchema(def.innerType);
  if (schema instanceof z.ZodAny) return {};
  return {};
}
