import Link from "next/link";
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
  StatusBadge,
  Table,
  Td,
  money,
  moneyPrecise,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import "@/components/workflow-pages.css";

export const dynamic = "force-dynamic";
const OPEN_STATUSES = new Set([
  "submitted",
  "confirmed",
  "partially_confirmed",
]);

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view: requestedView } = await searchParams;
  const view = ["open", "shortfalls", "closed"].includes(requestedView ?? "")
    ? requestedView!
    : "all";
  const pos = listPos();
  const audit = listAudit(40).filter(
    (item) => item.entity_type === "purchase_order",
  );
  const open = pos.filter((po) => OPEN_STATUSES.has(po.status));
  const shortfalls = pos.filter((po) => po.status === "partially_confirmed");
  const closed = pos.filter(
    (po) => po.status === "received" || po.status === "cancelled",
  );
  const shown =
    view === "open"
      ? open
      : view === "shortfalls"
        ? shortfalls
        : view === "closed"
          ? closed
          : pos;
  const poNames = new Map(pos.map((po) => [po.id, po.po_number]));
  const tabs = [
    { value: "all", label: "All orders", count: pos.length },
    { value: "open", label: "Open", count: open.length },
    {
      value: "shortfalls",
      label: "Supplier shortfalls",
      count: shortfalls.length,
    },
    { value: "closed", label: "Closed", count: closed.length },
  ];

  return (
    <div className="workflow-page workflow-orders">
      <div className="workflow-kicker">OPERATIONS / ORDERS</div>
      <PageHeader
        title="Purchase orders"
        subtitle="See what’s ordered, what suppliers have confirmed, and what arrives next."
        actions={
          <Link href="/opportunities" className="btn">
            <Icon name="search" size={16} /> Review purchasing needs
          </Link>
        }
      />
      <dl className="workflow-summary" aria-label="Order summary">
        <div>
          <dt>All orders</dt>
          <dd>
            {pos.length}
            <small>Across your locations</small>
          </dd>
        </div>
        <div data-tone="blue">
          <dt>Open orders</dt>
          <dd>
            {open.length}
            <small>Submitted or confirmed</small>
          </dd>
        </div>
        <div>
          <dt>Open order value</dt>
          <dd>
            {money(open.reduce((total, po) => total + po.total_cost, 0))}
            <small>Total value of open purchases</small>
          </dd>
        </div>
        <div data-tone={shortfalls.length ? "peach" : "neutral"}>
          <dt>Supplier shortfalls</dt>
          <dd>
            {shortfalls.length}
            <small>Confirmed below requested quantity</small>
          </dd>
        </div>
      </dl>
      <Panel
        title="Order book"
        subtitle="Each order groups its products, supplier and destination."
        right={
          <span className="workflow-count">
            {shown.length} {shown.length === 1 ? "order" : "orders"}
          </span>
        }
      >
        <nav className="workflow-tabs" aria-label="Filter purchase orders">
          {tabs.map((tab) => (
            <Link
              key={tab.value}
              href={
                tab.value === "all"
                  ? "/purchase-orders"
                  : `/purchase-orders?view=${tab.value}`
              }
              aria-current={view === tab.value ? "page" : undefined}
            >
              {tab.label}
              <span>{tab.count}</span>
            </Link>
          ))}
        </nav>
        {shown.length === 0 ? (
          <Empty>
            <strong className="workflow-empty-title">
              {pos.length === 0 ? "No orders yet" : "No orders in this view"}
            </strong>
            <p>
              {pos.length === 0
                ? "Approved purchasing actions will appear here with their supplier confirmations."
                : "Switch views to see the rest of the order book."}
            </p>
            <Link
              className="btn workflow-empty-action"
              href={pos.length === 0 ? "/scenarios" : "/purchase-orders"}
            >
              {pos.length === 0
                ? "Explore purchasing scenarios"
                : "View all orders"}
              <Icon name="arrow" size={15} />
            </Link>
          </Empty>
        ) : (
          <Table
            head={[
              "Purchase order",
              "Product",
              "Ordered / confirmed",
              "Unit price",
              "Order total",
              "Delivery",
              "Status",
              "Raised by",
            ]}
          >
            {shown.flatMap((po) =>
              po.lines.map((line, index) => {
                const product = getProduct(line.product_id);
                const short =
                  line.qty_confirmed < line.qty_ordered &&
                  (po.status === "partially_confirmed" ||
                    po.status === "confirmed");
                const awaiting =
                  line.qty_confirmed === 0 && po.status === "submitted";
                const span = po.lines.length;
                return (
                  <tr
                    key={`${po.id}-${line.id}`}
                    className={index === 0 ? "workflow-order-start" : undefined}
                    data-attention={short || undefined}
                  >
                    {index === 0 && (
                      <td rowSpan={span}>
                        <strong className="workflow-cell-title mono">
                          {po.po_number}
                        </strong>
                        <span className="workflow-cell-meta">
                          {getSupplier(po.supplier_id)?.name ?? po.supplier_id}
                        </span>
                        <span className="workflow-location">
                          <Icon name="warehouse" size={13} />
                          {getNode(po.node_id)?.name ?? po.node_id}
                        </span>
                      </td>
                    )}
                    <Td>
                      <span className="workflow-cell-title">
                        {product?.name ?? line.product_id}
                      </span>
                      <span className="workflow-cell-meta mono">
                        {product?.sku}
                      </span>
                    </Td>
                    <Td>
                      <span className="workflow-quantities">
                        <strong>
                          {line.qty_ordered.toLocaleString("en-US")}
                        </strong>
                        <span>/</span>
                        <strong data-short={short || undefined}>
                          {line.qty_confirmed.toLocaleString("en-US")}
                        </strong>
                      </span>
                      {short ? (
                        <span className="workflow-cell-meta workflow-shortfall">
                          {(
                            line.qty_ordered - line.qty_confirmed
                          ).toLocaleString("en-US")}{" "}
                          units short
                        </span>
                      ) : awaiting ? (
                        <span className="workflow-cell-meta">
                          Awaiting confirmation
                        </span>
                      ) : null}
                    </Td>
                    <Td className="mono">{moneyPrecise(line.unit_price)}</Td>
                    {index === 0 && (
                      <>
                        <td rowSpan={span} className="mono workflow-money">
                          {moneyPrecise(po.total_cost)}
                        </td>
                        <td rowSpan={span}>
                          <span className="workflow-cell-title">
                            {po.expected_delivery ?? "Not scheduled"}
                          </span>
                        </td>
                        <td rowSpan={span}>
                          <StatusBadge status={po.status} />
                        </td>
                        <td rowSpan={span} className="workflow-actor">
                          {po.created_by}
                        </td>
                      </>
                    )}
                  </tr>
                );
              }),
            )}
          </Table>
        )}
      </Panel>
      {shortfalls.length > 0 && (
        <div className="workflow-next-step">
          <Icon name="orders" size={18} />
          <p>Review supplier shortfalls before planning replacement stock.</p>
          <Link href="/opportunities">
            Investigate findings
            <Icon name="arrow" size={15} />
          </Link>
        </div>
      )}
      <Panel
        title="Recent order changes"
        subtitle="Changes recorded in the latest 40 workspace audit events."
        className="workflow-secondary-panel"
      >
        {audit.length === 0 ? (
          <Empty>
            No purchase-order changes in the latest workspace activity.
          </Empty>
        ) : (
          <Table
            head={[
              "Recorded",
              "Purchase order",
              "Change",
              "Actor",
              "Agent run",
            ]}
          >
            {audit.map((item) => (
              <tr key={item.id}>
                <Td>
                  <span className="workflow-cell-title">
                    {item.created_at.slice(0, 10)}
                  </span>
                  <span className="workflow-cell-meta">
                    {item.created_at.slice(11, 19)} UTC
                  </span>
                </Td>
                <Td className="mono">
                  {poNames.get(item.entity_id) ?? item.entity_id}
                </Td>
                <Td>
                  <Badge
                    tone={
                      item.action === "create"
                        ? "green"
                        : item.action === "cancel"
                          ? "red"
                          : "amber"
                    }
                  >
                    {item.action.replace(/_/g, " ")}
                  </Badge>
                </Td>
                <Td className="workflow-actor">{item.actor}</Td>
                <Td>
                  {item.run_id ? (
                    <RunLink id={item.run_id}>{item.run_id.slice(-9)}</RunLink>
                  ) : (
                    <span className="workflow-cell-meta">No linked run</span>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  );
}
