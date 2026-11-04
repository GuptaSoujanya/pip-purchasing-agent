import { PurchasingOverview } from "@/components/purchasing-overview";
import { PurchasingExperience } from "@/components/purchasing-experience";
import {
  budgetAvailable,
  getForecast,
  listApprovals,
  listBudgets,
  listInventory,
  listNodes,
  listPos,
  listSupplierEvents,
  today,
} from "@/lib/db/repo";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pip · AI Purchasing Agent" };

export default function PurchasingHome() {
  const stock = listInventory().map((item) => {
    const daily =
      getForecast(item.node_id, item.product_id)?.daily_forecast ?? 0;
    const cover =
      daily > 0
        ? Math.round(
            ((item.on_hand + item.in_transit - item.reserved) / daily) * 10,
          ) / 10
        : null;
    return {
      ...item,
      cover,
      risk:
        item.on_hand + item.in_transit < item.reorder_point ||
        (cover !== null && cover < 12),
    };
  });
  const budgets = listBudgets();
  const nodes = listNodes().map((node) => {
    const inventory = stock.filter((item) => item.node_id === node.id);
    const covers = inventory.flatMap((item) =>
      item.cover === null ? [] : [item.cover],
    );
    const risks = inventory
      .filter((item) => item.risk)
      .sort((a, b) => (a.cover ?? Infinity) - (b.cover ?? Infinity));
    return {
      id: node.id,
      name: node.name,
      city: node.name.split(" ")[0],
      availableBudget: budgets
        .filter((budget) => budget.node_id === node.id)
        .reduce((sum, budget) => sum + budgetAvailable(budget), 0),
      usedCapacity:
        node.storage_capacity_slots > 0
          ? Math.round(
              (node.storage_used_slots / node.storage_capacity_slots) * 100,
            )
          : 0,
      lowestCover: covers.length ? Math.min(...covers) : null,
      alerts: risks.length,
      positions: inventory.length,
      risks: risks.map((item) => ({ name: item.name, cover: item.cover })),
    };
  });
  const stockAlerts = stock.filter((item) => item.risk).length;
  return (
    <>
      <PurchasingExperience
        stockAlerts={stockAlerts}
        supplierUpdates={listSupplierEvents(true).length}
        nodes={nodes}
        pendingApprovals={listApprovals("pending").length}
        openOrders={
          listPos().filter((order) =>
            ["submitted", "confirmed", "partially_confirmed"].includes(
              order.status,
            ),
          ).length
        }
        simulatedDate={today()}
      />
      <section
        id="operations"
        className="home-workspace"
        aria-label="Purchasing workspace"
      >
        <PurchasingOverview />
      </section>
    </>
  );
}
