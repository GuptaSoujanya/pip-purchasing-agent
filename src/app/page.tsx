import Link from "next/link";
import { resolveProviderId } from "@/lib/agent/llm";
import {
  budgetAvailable,
  getForecast,
  getProduct,
  listApprovals,
  listBudgets,
  listInventory,
  listNodes,
  listPos,
  listRuns,
  listSupplierEvents,
  storageFreeSlots,
  today,
} from "@/lib/db/repo";
import {
  Badge, Bar, DecisionBadge, Empty, PageHeader, Panel, RunLink,
  Stat, StatusBadge, Table, Td, money,
} from "@/components/ui";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const nodes = listNodes();
  const budgets = listBudgets();
  const runs = listRuns(6);
  const pending = listApprovals("pending");
  const pos = listPos();
  const events = listSupplierEvents(true);
  const provider = resolveProviderId();

  const stock = listInventory().map((i) => {
    const fc = getForecast(i.node_id, i.product_id);
    const daily = fc?.daily_forecast ?? 0;
    const atp = i.on_hand + i.in_transit - i.reserved;
    return {
      ...i,
      daily,
      atp,
      cover: daily > 0 ? Math.round((atp / daily) * 10) / 10 : null,
      belowReorder: i.on_hand + i.in_transit < i.reorder_point,
    };
  });

  const atRisk = stock.filter((s) => s.belowReorder || (s.cover !== null && s.cover < 12));
  const totalAvailable = budgets.reduce((s, b) => s + budgetAvailable(b), 0);
  const openPos = pos.filter((p) => ["submitted", "confirmed", "partially_confirmed"].includes(p.status));

  return (
    <>
      <PageHeader
        title="Purchasing control room"
        subtitle={`Simulated date ${today()}. The agent reasons over this live state — stock, demand, open orders, supplier terms, budget and storage — and every action it takes writes back here.`}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={provider === "none" ? "amber" : "green"}>
              {provider === "none" ? "deterministic mode (no API key)" : `LLM: ${provider}`}
            </Badge>
            <Link href="/scenarios" className="btn btn-primary">Run a scenario</Link>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Budget available"
          value={money(totalAvailable)}
          hint={`across ${budgets.length} nodes this period`}
          tone={totalAvailable < 20000 ? "warn" : "good"}
        />
        <Stat
          label="Lines at risk"
          value={atRisk.length}
          hint="below reorder point or under 12 days of cover"
          tone={atRisk.length ? "warn" : "good"}
        />
        <Stat
          label="Open purchase orders"
          value={openPos.length}
          hint={money(openPos.reduce((s, p) => s + p.total_cost, 0)) + " committed"}
        />
        <Stat
          label="Awaiting approval"
          value={pending.length}
          hint={pending.length ? "agent is blocked pending a buyer" : "nothing queued"}
          tone={pending.length ? "warn" : "good"}
        />
      </div>

      {events.length > 0 && (
        <div className="mt-4 panel border-amber-600/40 bg-amber-500/[0.06] p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone="amber">inbound supplier message</Badge>
            {events.map((e) => {
              const p = JSON.parse(e.payload_json);
              return (
                <span key={e.id} className="text-[13px] text-amber-200/90">
                  {e.supplier_id} on {e.po_id}: can supply{" "}
                  <strong>{p.confirmable_qty}</strong> of {p.ordered_qty} units — {p.reason}
                </span>
              );
            })}
            <Link href="/scenarios" className="btn ml-auto">Have the agent handle it</Link>
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Fulfilment nodes" subtitle="storage utilisation" className="lg:col-span-1">
          <div className="space-y-4">
            {nodes.map((n) => {
              const pct = Math.round((n.storage_used_slots / n.storage_capacity_slots) * 100);
              return (
                <div key={n.id}>
                  <div className="flex items-baseline justify-between">
                    <span className="text-[13px] text-slate-200">{n.name}</span>
                    <span className="mono text-slate-400">{pct}%</span>
                  </div>
                  <div className="mt-1.5">
                    <Bar pct={pct} tone={pct > 85 ? "red" : pct > 65 ? "amber" : "sky"} />
                  </div>
                  <div className="mt-1 text-[11.5px] text-slate-500">
                    {storageFreeSlots(n).toLocaleString()} of{" "}
                    {n.storage_capacity_slots.toLocaleString()} slots free
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel title="Budgets" subtitle="current period" className="lg:col-span-2">
          <Table head={["Node", "Total", "Committed", "Spent", "Available", ""]}>
            {budgets.map((b) => {
              const avail = budgetAvailable(b);
              const pct = Math.round(((b.committed + b.spent) / b.total_budget) * 100);
              return (
                <tr key={b.id}>
                  <Td>{nodes.find((n) => n.id === b.node_id)?.name ?? b.node_id}</Td>
                  <Td className="mono">{money(b.total_budget)}</Td>
                  <Td className="mono text-slate-400">{money(b.committed)}</Td>
                  <Td className="mono text-slate-400">{money(b.spent)}</Td>
                  <Td className={`mono ${avail < 5000 ? "text-amber-400" : "text-emerald-400"}`}>
                    {money(avail)}
                  </Td>
                  <Td className="w-32"><Bar pct={pct} tone={pct > 85 ? "red" : pct > 65 ? "amber" : "green"} /></Td>
                </tr>
              );
            })}
          </Table>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel
          title="Stock position"
          subtitle="days of cover at the current forecast rate"
          right={<Link href="/inventory" className="text-[12px] text-sky-400 hover:underline">All inventory →</Link>}
        >
          <Table head={["SKU", "Node", "On hand", "Inbound", "Cover", ""]}>
            {stock.slice(0, 8).map((s) => (
              <tr key={`${s.node_id}-${s.product_id}`}>
                <Td>
                  <div className="text-slate-200">{s.sku}</div>
                  <div className="text-[11.5px] text-slate-500">{s.name}</div>
                </Td>
                <Td className="text-[12px] text-slate-400">{s.node_name}</Td>
                <Td className="mono">{s.on_hand}</Td>
                <Td className="mono text-slate-400">{s.in_transit || "—"}</Td>
                <Td className={`mono ${s.cover !== null && s.cover < 12 ? "text-amber-400" : "text-slate-300"}`}>
                  {s.cover === null ? "—" : `${s.cover}d`}
                </Td>
                <Td>{s.belowReorder && <Badge tone="amber">below reorder</Badge>}</Td>
              </tr>
            ))}
          </Table>
        </Panel>

        <Panel
          title="Recent agent runs"
          right={<Link href="/runs" className="text-[12px] text-sky-400 hover:underline">All runs →</Link>}
        >
          {runs.length === 0 ? (
            <Empty>
              No runs yet. <Link href="/scenarios" className="text-sky-400 hover:underline">Start a scenario</Link> to see
              the agent investigate, decide, act and verify.
            </Empty>
          ) : (
            <Table head={["Run", "Scenario", "Decision", "Status", ""]}>
              {runs.map((r) => (
                <tr key={r.id}>
                  <Td><RunLink id={r.id}>{r.id.slice(-9)}</RunLink></Td>
                  <Td className="text-[12px] text-slate-400">{r.scenario.replace(/_/g, " ")}</Td>
                  <Td><DecisionBadge decision={r.decision} /></Td>
                  <Td><StatusBadge status={r.status} /></Td>
                  <Td className="text-[11.5px] text-slate-500">{r.mode}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Panel>
      </div>

      {pending.length > 0 && (
        <div className="mt-4">
          <Panel
            title="Waiting on you"
            subtitle="the agent reached a decision but policy requires a buyer to sign off"
            right={<Link href="/approvals" className="btn">Review queue</Link>}
          >
            <ul className="space-y-2.5">
              {pending.slice(0, 4).map((a) => (
                <li key={a.id} className="flex flex-wrap items-start gap-3 text-[13px]">
                  <Badge tone={a.risk_level === "high" ? "red" : "amber"}>{a.risk_level} risk</Badge>
                  <span className="flex-1 text-slate-300">{a.reason}</span>
                  <RunLink id={a.run_id}>{a.run_id.slice(-9)}</RunLink>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}
    </>
  );
}
