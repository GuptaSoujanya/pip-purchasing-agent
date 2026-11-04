import { getNode, getProduct, getSupplier, listAudit, listPos } from "@/lib/db/repo";
import { Badge, Empty, PageHeader, Panel, RunLink, StatusBadge, Table, Td, moneyPrecise } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function PurchaseOrdersPage() {
  const pos = listPos();
  const audit = listAudit(40).filter((a) => a.entity_type === "purchase_order");

  return (
    <>
      <PageHeader
        title="Purchase orders"
        subtitle="Orders raised by buyers, by the replenishment system, and by the agent. Where ordered and confirmed quantities differ, the supplier did not accept the order in full — which is exactly what the agent's post-execution check is looking for."
      />

      <Panel>
        {pos.length === 0 ? (
          <Empty>No purchase orders.</Empty>
        ) : (
          <Table head={["PO", "Supplier", "Node", "Product", "Ordered", "Confirmed", "Unit", "Total", "Delivery", "Status", "Raised by"]}>
            {pos.flatMap((po) =>
              po.lines.map((l) => {
                const short = l.qty_confirmed > 0 && l.qty_confirmed < l.qty_ordered;
                return (
                  <tr key={`${po.id}-${l.id}`}>
                    <Td className="mono text-slate-200">{po.po_number}</Td>
                    <Td className="text-[12px] text-slate-400">{getSupplier(po.supplier_id)?.name}</Td>
                    <Td className="text-[12px] text-slate-400">{getNode(po.node_id)?.name}</Td>
                    <Td className="text-[12px]">
                      <span className="text-slate-200">{getProduct(l.product_id)?.sku}</span>
                      <div className="text-[11px] text-slate-500">{getProduct(l.product_id)?.name}</div>
                    </Td>
                    <Td className="mono">{l.qty_ordered}</Td>
                    <Td className={`mono ${short ? "text-amber-400" : "text-slate-300"}`}>
                      {l.qty_confirmed}
                      {short && <span className="ml-1.5 text-[10.5px]">(−{l.qty_ordered - l.qty_confirmed})</span>}
                    </Td>
                    <Td className="mono text-slate-400">${l.unit_price.toFixed(2)}</Td>
                    <Td className="mono">{moneyPrecise(po.total_cost)}</Td>
                    <Td className="mono text-[11.5px] text-slate-400">{po.expected_delivery ?? "—"}</Td>
                    <Td><StatusBadge status={po.status} /></Td>
                    <Td className="text-[11.5px] text-slate-500">{po.created_by}</Td>
                  </tr>
                );
              }),
            )}
          </Table>
        )}
      </Panel>

      <div className="mt-4">
        <Panel title="Audit log" subtitle="every mutation the agent made, with the run that caused it">
          {audit.length === 0 ? (
            <Empty>No agent writes yet.</Empty>
          ) : (
            <Table head={["Time", "Entity", "Action", "Actor", "Run"]}>
              {audit.map((a) => (
                <tr key={a.id}>
                  <Td className="mono text-[11.5px] text-slate-400">{a.created_at.slice(11, 19)}</Td>
                  <Td className="mono text-slate-300">{a.entity_id}</Td>
                  <Td><Badge tone={a.action === "create" ? "green" : a.action === "cancel" ? "red" : "amber"}>{a.action}</Badge></Td>
                  <Td className="text-[12px] text-slate-400">{a.actor}</Td>
                  <Td>{a.run_id ? <RunLink id={a.run_id}>{a.run_id.slice(-9)}</RunLink> : "—"}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Panel>
      </div>
    </>
  );
}
