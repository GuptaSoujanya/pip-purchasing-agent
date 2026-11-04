import { PurchasingOverview } from "@/components/purchasing-overview";
import { PurchasingExperience } from "@/components/purchasing-experience";
import {
  budgetAvailable,
  getForecast,
  listApprovals,
  listBudgets,
  listInventory,
  listSupplierEvents,
  today,
} from "@/lib/db/repo";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pip · AI Purchasing Agent" };

export default function PurchasingHome() {
  const stock = listInventory();
  const stockAlerts = stock.filter((item) => {
    const daily =
      getForecast(item.node_id, item.product_id)?.daily_forecast ?? 0;
    const cover =
      daily > 0
        ? (item.on_hand + item.in_transit - item.reserved) / daily
        : Infinity;
    return item.on_hand + item.in_transit < item.reorder_point || cover < 12;
  }).length;
  return (
    <>
    <PurchasingExperience
      stockAlerts={stockAlerts}
      supplierUpdates={listSupplierEvents(true).length}
      availableBudget={listBudgets().reduce(
        (sum, budget) => sum + budgetAvailable(budget),
        0,
      )}
      pendingApprovals={listApprovals("pending").length}
      simulatedDate={today()}
    />
    <section id="workspace" className="home-workspace" aria-label="Purchasing workspace">
      <PurchasingOverview />
    </section>
    </>
  );
}
