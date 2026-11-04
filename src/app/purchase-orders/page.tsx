import {
  getNode,
  getProduct,
  getSupplier,
  listAudit,
  listPos,
} from "@/lib/db/repo";
import {
  Badge,
  Empty,
  PageHeader,
  Panel,
  RunLink,
  Stat,
  StatusBadge,
  Table,
  Td,
  money,
  moneyPrecise,
} from "@/components/ui";

export const dynamic = "force-dynamic";

export default function PurchaseOrdersPage() {
  const pos = listPos();
  const audit = listAudit(40).filter((a) => a.entity_type === "purchase_order");
  const open = pos.filter((po) =>
    ["submitted", "confirmed", "partially_confirmed"].includes(po.status),
  );

  return (
    <>
      <PageHeader
        title="Purchase orders"
        subtitle="Track ordered quantities, supplier confirmations, and delivery status."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="All purchase orders"
          value={pos.length}
          hint="orders across all locations"
        />
        <Stat
          label="Open orders"
          value={open.length}
          hint="submitted or confirmed with suppliers"
        />
        <Stat
          label="Open order value"
          value={money(open.reduce((total, po) => total + po.total_cost, 0))}
          hint="total value of open purchases"
        />
        <Stat
          label="Partially confirmed"
          value={pos.filter((po) => po.status === "partially_confirmed").length}
          hint="suppliers have confirmed less than requested"
          tone={
            pos.some((po) => po.status === "partially_confirmed")
              ? "warn"
              : "good"
          }
        />
      </div>

      <Panel
        title="Order book"
        subtitle="Ordered and confirmed quantities, side by side"
      >
        {pos.length === 0 ? (
          <Empty>No purchase orders have been created.</Empty>
        ) : (
          <Table
            head={[
              "PO",
              "Supplier",
              "Node",
              "Product",
              "Ordered",
              "Confirmed",
              "Unit",
              "Total",
              "Delivery",
              "Status",
              "Raised by",
            ]}
          >
            {pos.flatMap((po) =>
              po.lines.map((l) => {
                const short =
                  l.qty_confirmed > 0 && l.qty_confirmed < l.qty_ordered;
                return (
                  <tr key={`${po.id}-${l.id}`}>
                    <Td className="mono text-stone-800">{po.po_number}</Td>
                    <Td className="text-[12px] text-stone-600">
                      {getSupplier(po.supplier_id)?.name}
                    </Td>
                    <Td className="text-[12px] text-stone-600">
                      {getNode(po.node_id)?.name}
                    </Td>
                    <Td className="text-[12px]">
                      <span className="text-stone-800">
                        {getProduct(l.product_id)?.sku}
                      </span>
                      <div className="text-[11px] text-stone-500">
                        {getProduct(l.product_id)?.name}
                      </div>
                    </Td>
                    <Td className="mono">{l.qty_ordered}</Td>
                    <Td
                      className={`mono ${short ? "text-amber-800" : "text-stone-700"}`}
                    >
                      {l.qty_confirmed}
                      {short && (
                        <span className="ml-1.5 text-[10.5px]">
                          (−{l.qty_ordered - l.qty_confirmed})
                        </span>
                      )}
                    </Td>
                    <Td className="mono text-stone-600">
                      ${l.unit_price.toFixed(2)}
                    </Td>
                    <Td className="mono">{moneyPrecise(po.total_cost)}</Td>
                    <Td className="mono text-[11.5px] text-stone-600">
                      {po.expected_delivery ?? "—"}
                    </Td>
                    <Td>
                      <StatusBadge status={po.status} />
                    </Td>
                    <Td className="text-[11.5px] text-stone-500">
                      {po.created_by}
                    </Td>
                  </tr>
                );
              }),
            )}
          </Table>
        )}
      </Panel>

      <div className="mt-4">
        <Panel
          title="Order activity"
          subtitle="A record of each change and the agent run behind it"
        >
          {audit.length === 0 ? (
            <Empty>No order changes recorded.</Empty>
          ) : (
            <Table head={["Time", "Entity", "Action", "Actor", "Run"]}>
              {audit.map((a) => (
                <tr key={a.id}>
                  <Td className="mono text-[11.5px] text-stone-600">
                    {a.created_at.slice(11, 19)}
                  </Td>
                  <Td className="mono text-stone-700">{a.entity_id}</Td>
                  <Td>
                    <Badge
                      tone={
                        a.action === "create"
                          ? "green"
                          : a.action === "cancel"
                            ? "red"
                            : "amber"
                      }
                    >
                      {a.action}
                    </Badge>
                  </Td>
                  <Td className="text-[12px] text-stone-600">{a.actor}</Td>
                  <Td>
                    {a.run_id ? (
                      <RunLink id={a.run_id}>{a.run_id.slice(-9)}</RunLink>
                    ) : (
                      "—"
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Panel>
      </div>
    </>
  );
}
