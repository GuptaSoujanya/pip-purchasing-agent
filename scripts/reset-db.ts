import { resetSchema, DB_PATH } from "../src/lib/db/client";
import { seed } from "../src/lib/db/seed";

const db = resetSchema();
seed(db);

const counts = [
  "nodes", "products", "suppliers", "supplier_products", "inventory",
  "demand_history", "forecasts", "promotions", "purchase_orders", "po_lines",
  "supplier_events", "budgets", "agent_policies",
]
  .map((t) => {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number };
    return `${t}=${row.n}`;
  })
  .join("  ");

console.log(`Database rebuilt at ${DB_PATH}`);
console.log(counts);
db.close();
