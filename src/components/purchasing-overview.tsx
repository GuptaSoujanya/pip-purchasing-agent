import Link from "next/link";
import {
  budgetAvailable,
  getForecast,
  listApprovals,
  listBudgets,
  listInventory,
  listNodes,
  listRuns,
  listSupplierEvents,
  storageFreeSlots,
  today,
} from "@/lib/db/repo";
import {
  Badge,
  Bar,
  DecisionBadge,
  Panel,
  StatusBadge,
  money,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import { InventoryWatch } from "@/components/inventory-watch";

export function PurchasingOverview() {
  const nodes = listNodes(),
    budgets = listBudgets(),
    runs = listRuns(5),
    pending = listApprovals("pending"),
    events = listSupplierEvents(true);
  const stock = listInventory().map((i) => {
    const daily = getForecast(i.node_id, i.product_id)?.daily_forecast ?? 0;
    return {
      ...i,
      cover:
        daily > 0
          ? Math.round(((i.on_hand + i.in_transit - i.reserved) / daily) * 10) /
            10
          : null,
      belowReorder: i.on_hand + i.in_transit < i.reorder_point,
    };
  });
  const totalAvailable = budgets.reduce((s, b) => s + budgetAvailable(b), 0);
  const totalBudget = budgets.reduce((s, b) => s + b.total_budget, 0);
  const committed = budgets.reduce((s, b) => s + b.committed, 0);
  const spent = budgets.reduce((s, b) => s + b.spent, 0);
  const dateLabel = new Date(`${today()}T12:00:00Z`).toLocaleDateString(
    "en-GB",
    { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" },
  );
  const budgetPercentage = (amount: number) =>
    totalBudget > 0 ? Math.max(0, (amount / totalBudget) * 100) : 0;

  return (
    <div className="dashboard desk-operations">
      <div className="overview-workspace">
        <div className="overview-primary">
          {events.length > 0 && (
            <section className="supplier-updates" aria-label="Supplier updates">
              {events.map((event) => {
                const payload = JSON.parse(event.payload_json);
                return (
                  <div className="supplier-update" key={event.id}>
                    <span className="supplier-update-icon">
                      <Icon name="bell" size={18} />
                    </span>
                    <div>
                      <strong>
                        Supplier shortfall <span>{event.po_id}</span>
                      </strong>
                      <p>
                        {event.supplier_id} can fulfil {payload.confirmable_qty}{" "}
                        of {payload.ordered_qty} units. {payload.reason}
                      </p>
                    </div>
                    <Link
                      href="/scenarios#s2"
                      aria-label={`Review supplier shortfall for ${event.po_id}`}
                    >
                      <Icon name="arrow-up-right" size={19} />
                    </Link>
                  </div>
                );
              })}
            </section>
          )}
          <InventoryWatch stock={stock} />
          <Panel
            title="Recent decisions"
            subtitle="Every decision has a trace you can inspect."
            right={
              <Link href="/runs" className="text-link">
                View activity <Icon name="arrow" size={16} />
              </Link>
            }
            className="recent-decisions"
          >
            {runs.length ? (
              <div className="decision-list">
                {runs.map((run) => (
                  <Link
                    href={`/runs/${run.id}`}
                    key={run.id}
                    className="decision-row"
                  >
                    <span className="decision-icon">
                      <Icon name="activity" size={17} />
                    </span>
                    <div>
                      <strong>{run.scenario.replace(/_/g, " ")}</strong>
                      <span>
                        {run.id.slice(-9)} ·{" "}
                        {run.mode === "deterministic"
                          ? "Rules-based"
                          : run.mode}
                      </span>
                    </div>
                    <div className="decision-status">
                      <DecisionBadge decision={run.decision} />
                      <StatusBadge status={run.status} />
                    </div>
                    <Icon name="chevron" size={15} />
                  </Link>
                ))}
              </div>
            ) : (
              <div className="activity-empty">
                <Icon name="activity" size={24} />
                <strong>No decisions yet</strong>
                <p>
                  Run a scenario to review the recommendation and its supporting
                  checks.
                </p>
                <Link href="/scenarios" className="text-link">
                  Explore scenarios <Icon name="arrow" size={16} />
                </Link>
              </div>
            )}
          </Panel>
          {pending.length > 0 && (
            <Panel
              title="Awaiting your approval"
              right={
                <Link href="/approvals" className="text-link">
                  Review queue
                  <Icon name="arrow" size={16} />
                </Link>
              }
            >
              {pending.slice(0, 3).map((approval) => (
                <Link
                  className="pending-row"
                  key={approval.id}
                  href="/approvals"
                >
                  <Badge
                    tone={approval.risk_level === "high" ? "red" : "amber"}
                  >
                    {approval.risk_level} risk
                  </Badge>
                  <span>{approval.reason}</span>
                  <Icon name="arrow" size={16} />
                </Link>
              ))}
            </Panel>
          )}
        </div>
        <aside
          className="overview-aside"
          id="purchasing-budget"
          aria-label="Budget and storage capacity"
        >
          <Panel
            title="Purchasing budget"
            right={
              <span className="period-label">
                {dateLabel.split(" ").slice(1).join(" ")}
              </span>
            }
            className="budget-panel"
          >
            <div className="budget-total">
              <span>Available to spend</span>
              <strong>{money(totalAvailable)}</strong>
              <p>of {money(totalBudget)} allocated this period</p>
            </div>
            <div
              className="budget-stack"
              role="img"
              aria-label={`${money(totalAvailable)} available, ${money(committed)} committed, ${money(spent)} spent`}
            >
              <span style={{ width: `${budgetPercentage(totalAvailable)}%` }} />
              <span style={{ width: `${budgetPercentage(committed)}%` }} />
              <span style={{ width: `${budgetPercentage(spent)}%` }} />
            </div>
            <dl className="budget-breakdown">
              <div>
                <dt>
                  <i className="budget-dot available-dot" />
                  Available
                </dt>
                <dd>{money(totalAvailable)}</dd>
              </div>
              <div>
                <dt>
                  <i className="budget-dot committed-dot" />
                  Committed
                </dt>
                <dd>{money(committed)}</dd>
              </div>
              <div>
                <dt>
                  <i className="budget-dot spent-dot" />
                  Spent
                </dt>
                <dd>{money(spent)}</dd>
              </div>
            </dl>
            <div className="budget-location-heading">Available by location</div>
            <div className="budget-locations">
              {budgets.map((budget) => (
                <div key={budget.id}>
                  <span>
                    {nodes.find((node) => node.id === budget.node_id)?.name ??
                      budget.node_id}
                  </span>
                  <strong>{money(budgetAvailable(budget))}</strong>
                </div>
              ))}
            </div>
            <div className="budget-note">
              <Icon name="shield" size={16} />
              <span>Budget checks run before every purchase.</span>
            </div>
          </Panel>
          <Panel
            title="Storage capacity"
            subtitle="Used space by fulfilment location"
            className="capacity-panel"
          >
            <div className="node-grid">
              {nodes.map((node) => {
                const pct = Math.round(
                  (node.storage_used_slots / node.storage_capacity_slots) * 100,
                );
                return (
                  <div className="node-item" key={node.id}>
                    <div className="node-heading">
                      <strong>{node.name}</strong>
                      <span>{pct}%</span>
                    </div>
                    <Bar
                      pct={pct}
                      tone={pct > 85 ? "red" : pct > 65 ? "amber" : "green"}
                    />
                    <p>
                      {storageFreeSlots(node).toLocaleString()} of{" "}
                      {node.storage_capacity_slots.toLocaleString()} slots free
                    </p>
                  </div>
                );
              })}
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
