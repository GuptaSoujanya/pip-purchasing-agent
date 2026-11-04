import Link from "next/link";
import {
  getActivePromotions,
  getDemandHistory,
  getForecast,
  listInventory,
  listNodes,
  listProducts,
  listSuppliers,
  listSupplierOptions,
} from "@/lib/db/repo";
import { demandStats, detectDemandShift } from "@/lib/domain/math";
import { Badge, Panel, Table, Td } from "@/components/ui";
import { Icon } from "@/components/icons";
import { InventoryWorkspace } from "@/components/inventory-workspace";
import "@/components/operations-workspace.css";

export const dynamic = "force-dynamic";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string }>;
}) {
  const { location } = await searchParams;
  const nodes = listNodes();
  const selectedLocation = nodes.find((node) => node.id === location);
  const inventory = listInventory().filter(
    (item) => !selectedLocation || item.node_id === selectedLocation.id,
  );
  const products = listProducts();
  const suppliers = listSuppliers();

  const rows = inventory.map((i) => {
    const fc = getForecast(i.node_id, i.product_id);
    const points = getDemandHistory(i.node_id, i.product_id, 35);
    const baseline = fc?.daily_forecast ?? 0;
    const stats = demandStats(points, baseline);
    const shift = detectDemandShift({
      points,
      forecast: fc,
      promotions: getActivePromotions(i.node_id, i.product_id),
    });
    const atp = i.on_hand + i.in_transit - i.reserved;
    return {
      ...i,
      points,
      baseline,
      stats,
      shift,
      atp,
      cover: baseline > 0 ? Math.round((atp / baseline) * 10) / 10 : null,
      belowReorder: i.on_hand + i.in_transit < i.reorder_point,
    };
  });

  return (
    <div className="ops-workspace ops-inventory">
      <header className="ops-page-header">
        <div>
          <span className="ops-eyebrow">Field report / Stock & supply</span>
          <h1>
            Inventory <span>& demand.</span>
          </h1>
          <p>
            Stock on hand. Supply on the way. A clear view of what comes next.
          </p>
        </div>
        <Link href="/opportunities" className="ops-button ops-button-secondary">
          <Icon name="workflow" size={17} /> Review opportunities
        </Link>
      </header>
      <nav
        aria-label="Filter inventory by location"
        className="ops-location-nav"
      >
        <Link
          href="/inventory"
          aria-current={!selectedLocation ? "page" : undefined}
        >
          <Icon name="warehouse" size={17} /> All locations
        </Link>
        {nodes.map((node) => (
          <Link
            key={node.id}
            href={`/inventory?location=${encodeURIComponent(node.id)}`}
            aria-current={selectedLocation?.id === node.id ? "page" : undefined}
          >
            {node.name}
          </Link>
        ))}
      </nav>
      <InventoryWorkspace
        key={selectedLocation?.id ?? "all"}
        rows={rows}
        locationName={selectedLocation?.name}
      />
      <section
        className="ops-supply-context"
        aria-labelledby="supply-context-heading"
      >
        <div className="ops-section-heading">
          <div>
            <span className="ops-eyebrow">Network-wide sourcing</span>
            <h2 id="supply-context-heading">Supplier context</h2>
            <p>
              {suppliers.filter((supplier) => supplier.active).length} active
              suppliers ·{" "}
              {
                suppliers.filter(
                  (supplier) =>
                    supplier.active && supplier.reliability_score < 0.85,
                ).length
              }{" "}
              below the 85% reliability threshold. Terms apply across locations.
            </p>
          </div>
          <Link href="/purchase-orders" className="ops-link">
            View incoming orders <Icon name="arrow" size={15} />
          </Link>
        </div>
        <div className="ops-supplier-grid">
          <Panel
            title="Suppliers"
            subtitle="Fill rates below 85% are flagged for review"
          >
            <Table
              head={["Supplier", "Lead time", "Reliability", "Terms", "Status"]}
            >
              {suppliers.map((s) => (
                <tr key={s.id}>
                  <Td>
                    <div className="text-stone-800">{s.name}</div>
                    <div className="mono text-[11px] text-stone-500">
                      {s.id}
                    </div>
                  </Td>
                  <Td className="mono text-stone-600">
                    {s.avg_lead_time_days}d ±{s.lead_time_stddev_days}
                  </Td>
                  <Td
                    className={`mono ${s.reliability_score < 0.85 ? "text-amber-800" : "text-emerald-700"}`}
                  >
                    {(s.reliability_score * 100).toFixed(0)}%
                  </Td>
                  <Td className="mono text-stone-500">
                    net {s.payment_terms_days}
                  </Td>
                  <Td>
                    {s.active ? (
                      <Badge tone="green">active</Badge>
                    ) : (
                      <Badge tone="red">suspended</Badge>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          </Panel>

          <Panel
            title="Supplier terms"
            subtitle="Minimum order quantities, pack sizes, and delivery terms."
          >
            <Table
              head={[
                "Product",
                "Supplier",
                "Price",
                "MOQ",
                "Lot",
                "Lead",
                "Expedite",
              ]}
            >
              {products.flatMap((p) =>
                listSupplierOptions(p.id).map((o) => (
                  <tr key={`${p.id}-${o.supplier_id}`}>
                    <Td className="text-[12px]">
                      <div className="ops-supply-product">{p.name}</div>
                      <span className="ops-secondary">{p.sku}</span>
                      {o.is_preferred ? (
                        <Badge tone="slate">preferred</Badge>
                      ) : null}
                    </Td>
                    <Td className="text-[12px] text-stone-600">
                      {o.supplier.name}
                    </Td>
                    <Td className="mono">${o.unit_price.toFixed(2)}</Td>
                    <Td className="mono text-stone-600">{o.moq}</Td>
                    <Td className="mono text-stone-600">{o.lot_size}</Td>
                    <Td className="mono text-stone-600">{o.lead_time_days}d</Td>
                    <Td className="mono text-[11.5px] text-stone-500">
                      {o.expedite_available
                        ? `${o.expedite_lead_time_days}d +${o.expedite_surcharge_pct}%`
                        : "—"}
                    </Td>
                  </tr>
                )),
              )}
            </Table>
          </Panel>
        </div>
      </section>
    </div>
  );
}
