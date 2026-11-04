import { NextResponse } from "next/server";
import { describeProvider, resolveProviderId } from "@/lib/agent/llm";
import {
  budgetAvailable,
  getForecast,
  listApprovals,
  listBudgets,
  listInventory,
  listNodes,
  listPolicyRows,
  listPos,
  listRuns,
  listSupplierEvents,
  listSuppliers,
  storageFreeSlots,
  today,
} from "@/lib/db/repo";

export const dynamic = "force-dynamic";

export async function GET() {
  const nodes = listNodes();
  const inventory = listInventory();

  // Days of cover per stock line, so the dashboard shows risk, not just counts.
  const stockLines = inventory.map((i) => {
    const fc = getForecast(i.node_id, i.product_id);
    const daily = fc?.daily_forecast ?? 0;
    const atp = i.on_hand + i.in_transit - i.reserved;
    const cover = daily > 0 ? Math.round((atp / daily) * 10) / 10 : null;
    const sellable = i.on_hand - i.reserved;
    return {
      ...i,
      daily_forecast: daily,
      available_to_promise: atp,
      days_of_cover: cover,
      days_to_stockout: daily > 0 ? Math.floor(sellable / daily) : null,
      below_reorder_point: i.on_hand + i.in_transit < i.reorder_point,
    };
  });

  return NextResponse.json({
    today: today(),
    provider: resolveProviderId(),
    providerLabel: describeProvider().label,
    reasoningIsReal: describeProvider().real,
    faultInjection: (process.env.FAULT_INJECTION ?? "on") !== "off",
    nodes: nodes.map((n) => ({
      ...n,
      free_slots: storageFreeSlots(n),
      utilisation_pct: Math.round((n.storage_used_slots / n.storage_capacity_slots) * 100),
    })),
    budgets: listBudgets().map((b) => ({
      ...b,
      available: budgetAvailable(b),
      used_pct: Math.round(((b.committed + b.spent) / b.total_budget) * 100),
    })),
    stock: stockLines,
    atRisk: stockLines.filter((s) => s.below_reorder_point || (s.days_of_cover !== null && s.days_of_cover < 10)),
    purchaseOrders: listPos().slice(0, 12),
    runs: listRuns(8),
    pendingApprovals: listApprovals("pending").map((a) => ({ ...a, action: safeParse(a.action_json) })),
    supplierEvents: listSupplierEvents().map((e) => ({ ...e, payload: safeParse(e.payload_json) })),
    suppliers: listSuppliers(),
    policies: listPolicyRows(),
  });
}

function safeParse(s: string) {
  try { return JSON.parse(s); } catch { return { _raw: s }; }
}
