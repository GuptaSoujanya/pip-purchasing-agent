import {
  getActivePromotions, getDemandHistory, getForecast, listInventory,
  listProducts, listSuppliers, listSupplierOptions,
} from "@/lib/db/repo";
import { demandStats, detectDemandShift } from "@/lib/domain/math";
import { Badge, PageHeader, Panel, Table, Td } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function InventoryPage() {
  const inventory = listInventory();
  const products = listProducts();
  const suppliers = listSuppliers();

  const rows = inventory.map((i) => {
    const fc = getForecast(i.node_id, i.product_id);
    const points = getDemandHistory(i.node_id, i.product_id, 35);
    const baseline = fc?.daily_forecast ?? 0;
    const stats = demandStats(points, baseline);
    const shift = detectDemandShift({
      points, forecast: fc, promotions: getActivePromotions(i.node_id, i.product_id),
    });
    const atp = i.on_hand + i.in_transit - i.reserved;
    return {
      ...i, baseline, stats, shift,
      atp,
      cover: baseline > 0 ? Math.round((atp / baseline) * 10) / 10 : null,
      belowReorder: i.on_hand + i.in_transit < i.reorder_point,
    };
  });

  return (
    <>
      <PageHeader
        title="Inventory & demand"
        subtitle="The data the agent reasons over. Where the trailing actuals diverge from the forecast, the demand-shift detector says whether that divergence is real — and whether a promotion explains it."
      />

      <Panel title="Stock and demand signal">
        <Table head={["SKU", "Node", "On hand", "Reserved", "Inbound", "Safety", "Reorder", "Cover", "Forecast", "Actual 7d", "Signal"]}>
          {rows.map((r) => (
            <tr key={`${r.node_id}-${r.product_id}`}>
              <Td>
                <div className="text-slate-200">{r.sku}</div>
                <div className="text-[11.5px] text-slate-500">{r.name}</div>
              </Td>
              <Td className="text-[12px] text-slate-400">{r.node_name}</Td>
              <Td className="mono">{r.on_hand}</Td>
              <Td className="mono text-slate-500">{r.reserved}</Td>
              <Td className="mono text-slate-400">{r.in_transit || "—"}</Td>
              <Td className="mono text-slate-500">{r.safety_stock}</Td>
              <Td className="mono text-slate-500">{r.reorder_point}</Td>
              <Td className={`mono ${r.cover !== null && r.cover < 12 ? "text-amber-400" : "text-slate-300"}`}>
                {r.cover === null ? "—" : `${r.cover}d`}
              </Td>
              <Td className="mono text-slate-400">{r.baseline}/d</Td>
              <Td className={`mono ${r.stats.trendRatio > 1.4 ? "text-amber-400" : "text-slate-400"}`}>
                {r.stats.last7Mean}/d
                {r.baseline > 0 && (
                  <span className="ml-1 text-[10.5px] text-slate-600">{r.stats.trendRatio}x</span>
                )}
              </Td>
              <Td>
                {r.shift.shiftDetected ? (
                  <Badge tone="red">demand shift</Badge>
                ) : r.shift.explainedByPromotion ? (
                  <Badge tone="violet">promo-driven</Badge>
                ) : r.belowReorder ? (
                  <Badge tone="amber">below reorder</Badge>
                ) : (
                  <Badge tone="green">stable</Badge>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Suppliers" subtitle="reliability is the historical fill rate; the agent flags anything under 85%">
          <Table head={["Supplier", "Lead time", "Reliability", "Terms", "Status"]}>
            {suppliers.map((s) => (
              <tr key={s.id}>
                <Td>
                  <div className="text-slate-200">{s.name}</div>
                  <div className="mono text-[11px] text-slate-500">{s.id}</div>
                </Td>
                <Td className="mono text-slate-400">{s.avg_lead_time_days}d ±{s.lead_time_stddev_days}</Td>
                <Td className={`mono ${s.reliability_score < 0.85 ? "text-amber-400" : "text-emerald-400"}`}>
                  {(s.reliability_score * 100).toFixed(0)}%
                </Td>
                <Td className="mono text-slate-500">net {s.payment_terms_days}</Td>
                <Td>{s.active ? <Badge tone="green">active</Badge> : <Badge tone="red">suspended</Badge>}</Td>
              </tr>
            ))}
          </Table>
        </Panel>

        <Panel title="Commercial terms" subtitle="MOQ and lot size are hard constraints on every order">
          <Table head={["Product", "Supplier", "Price", "MOQ", "Lot", "Lead", "Expedite"]}>
            {products.flatMap((p) =>
              listSupplierOptions(p.id).map((o) => (
                <tr key={`${p.id}-${o.supplier_id}`}>
                  <Td className="text-[12px]">
                    <span className="text-slate-200">{p.sku}</span>
                    {o.is_preferred ? <Badge tone="sky">preferred</Badge> : null}
                  </Td>
                  <Td className="text-[12px] text-slate-400">{o.supplier.name}</Td>
                  <Td className="mono">${o.unit_price.toFixed(2)}</Td>
                  <Td className="mono text-slate-400">{o.moq}</Td>
                  <Td className="mono text-slate-400">{o.lot_size}</Td>
                  <Td className="mono text-slate-400">{o.lead_time_days}d</Td>
                  <Td className="mono text-[11.5px] text-slate-500">
                    {o.expedite_available ? `${o.expedite_lead_time_days}d +${o.expedite_surcharge_pct}%` : "—"}
                  </Td>
                </tr>
              )),
            )}
          </Table>
        </Panel>
      </div>
    </>
  );
}
