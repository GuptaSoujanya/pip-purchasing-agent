"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge, Empty, PageHeader, Panel, Stat, money } from "@/components/ui";
import { Icon } from "@/components/icons";
import type {
  Opportunity,
  OpportunityKind,
  OpportunityReport,
} from "@/lib/domain/opportunities";

type Headroom = {
  nodeId: string;
  nodeName: string;
  budgetFree: number;
  budgetTotal: number;
  slotsFree: number;
  slotsTotal: number;
  nextReviewDate: string;
};

type Report = OpportunityReport & { headroom: Headroom[] };

const KIND_LABEL: Record<OpportunityKind, string> = {
  replenishment: "Replenishment",
  open_po: "Open purchase orders",
  supplier_reliability: "Supplier reliability",
  forecast_anomaly: "Forecast anomalies",
  safety_stock: "Safety stock",
  overstock: "Overstock & spoilage",
};

const KIND_BLURB: Record<OpportunityKind, string> = {
  replenishment: "Stock positions that need replenishment.",
  open_po: "Open orders with delivery or confirmation issues.",
  supplier_reliability: "Supplier performance below the planning threshold.",
  forecast_anomaly: "Demand that differs from the forecast baseline.",
  safety_stock: "Safety stock levels compared with demand variability.",
  overstock: "Excess stock and products at risk of spoilage.",
};

const SEVERITY_TONE = {
  critical: "red",
  high: "amber",
  medium: "slate",
  low: "slate",
} as const;

export default function OpportunityBoard() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<OpportunityKind | "all">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [handing, setHanding] = useState<string | null>(null);
  const [handoffResult, setHandoffResult] = useState<{
    id: string;
    title: string;
    runId: string;
    decision: string | null;
    summary: string;
    ok: boolean;
    resolvedAway: boolean;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/opportunities", { cache: "no-store" });
      if (!res.ok) throw new Error(`Sweep failed (${res.status})`);
      const next = (await res.json()) as Report;
      setReport(next);
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sweep failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handOff(opportunity: Opportunity) {
    if (!opportunity.handoff) return;
    setHanding(opportunity.id);
    setHandoffResult(null);
    try {
      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...opportunity.handoff.params,
          mode: "auto",
          actor: "opportunity.sweep",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Agent run failed");
      const refreshed = await load();
      setHandoffResult({
        id: opportunity.id,
        title: opportunity.title,
        runId: data.runId ?? data.run?.id ?? "",
        decision: data.decision ?? data.run?.decision ?? null,
        summary:
          data.summary ?? data.run?.summary ?? "The agent completed its run.",
        ok: true,
        resolvedAway: !refreshed?.opportunities.some((x) => x.id === opportunity.id),
      });
    } catch (e) {
      setHandoffResult({
        id: opportunity.id,
        title: opportunity.title,
        runId: "",
        decision: null,
        summary: e instanceof Error ? e.message : "Agent run failed",
        ok: false,
        resolvedAway: false,
      });
    } finally {
      setHanding(null);
    }
  }

  const shown =
    report?.opportunities.filter(
      (o) => filter === "all" || o.kind === filter,
    ) ?? [];

  const counts = report?.byKind;
  const critical =
    report?.opportunities.filter((o) => o.severity === "critical").length ?? 0;
  const actionable = report?.opportunities.filter((o) => o.handoff).length ?? 0;

  return (
    <>
      <PageHeader
        title="Opportunities"
        subtitle="Review replenishment gaps, supplier risks, and forecast exceptions across the network."
        actions={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh findings"}
          </button>
        }
      />

      {error && (
        <Panel>
          <p role="alert" className="text-red-700">
            {error}
          </p>
        </Panel>
      )}

      {handoffResult && (
        <div
          role={handoffResult.ok ? "status" : "alert"}
          className={`mb-6 rounded-2xl border p-4 ${handoffResult.ok ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}
        >
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Badge tone={handoffResult.ok ? "green" : "red"}>
              {handoffResult.ok ? "Agent run complete" : "Review failed"}
            </Badge>
            {handoffResult.decision && (
              <Badge tone="violet">
                {handoffResult.decision.toLowerCase().replace(/_/g, " ")}
              </Badge>
            )}
            {handoffResult.resolvedAway && <Badge tone="sky">finding cleared</Badge>}
            <button
              type="button"
              className="ml-auto text-[12px] text-stone-500 underline-offset-4 hover:underline"
              onClick={() => setHandoffResult(null)}
            >
              Dismiss
            </button>
          </div>
          <div className="text-[13px] text-stone-800">{handoffResult.title}</div>
          <p className="mt-1 text-[12.5px] text-stone-700">{handoffResult.summary}</p>
          {handoffResult.resolvedAway && (
            <p className="mt-1 text-[12.5px] text-stone-600">
              This finding no longer appears in the sweep — the agent&rsquo;s action resolved the
              underlying condition.
            </p>
          )}
          {handoffResult.runId && (
            <Link
              href={`/runs/${handoffResult.runId}`}
              className="mt-2 inline-block text-[12.5px] text-emerald-800 underline-offset-4 hover:underline"
            >
              Open the full reasoning trace &rarr;
            </Link>
          )}
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Findings"
          value={report?.opportunities.length ?? "—"}
          hint={`across ${report?.scanned.positions ?? 0} stock positions and ${report?.scanned.purchaseOrders ?? 0} purchase orders`}
          icon="search"
        />
        <Stat
          label="Needs attention now"
          value={critical}
          hint="projected to run out before replenishment can land"
          tone={critical > 0 ? "warn" : "good"}
          icon="clock"
        />
        <Stat
          label="Value at risk"
          value={report ? money(report.totalValueAtRisk) : "—"}
          hint="lost sales, undelivered orders and capital tied up"
          icon="wallet"
        />
        <Stat
          label="Ready for review"
          value={actionable}
          hint="findings supported by an agent workflow"
          tone="good"
          icon="check"
        />
      </div>

      {report && (
        <Panel
          title="Budget & capacity"
          subtitle="Available budget and storage by location."
          className="mb-4"
        >
          <div className="grid gap-3 sm:grid-cols-3">
            {report.headroom.map((h) => (
              <div
                key={h.nodeId}
                className="rounded-xl border border-stone-200 p-3"
              >
                <div className="text-stone-800">{h.nodeName}</div>
                <div className="mt-1 text-[12px] text-stone-600">
                  Budget free{" "}
                  <span className="mono text-stone-800">
                    {money(h.budgetFree)}
                  </span>{" "}
                  of {money(h.budgetTotal)}
                </div>
                <div className="text-[12px] text-stone-600">
                  Space free{" "}
                  <span className="mono text-stone-800">
                    {h.slotsFree.toLocaleString()}
                  </span>{" "}
                  of {h.slotsTotal.toLocaleString()} slots
                </div>
                <div className="mt-1 text-[11.5px] text-stone-500">
                  Next review {h.nextReviewDate}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <div
        className="mb-4 flex flex-wrap gap-2"
        role="group"
        aria-label="Filter opportunities"
      >
        <button
          type="button"
          className={`min-h-11 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${filter === "all" ? "border-stone-700 bg-stone-800 text-white" : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50"}`}
          onClick={() => setFilter("all")}
          aria-pressed={filter === "all"}
        >
          All findings {report ? `(${report.opportunities.length})` : ""}
        </button>
        {(Object.keys(KIND_LABEL) as OpportunityKind[]).map((kind) => (
          <button
            key={kind}
            type="button"
            className={`min-h-11 rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40 ${filter === kind ? "border-stone-700 bg-stone-800 text-white" : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50"}`}
            onClick={() => setFilter(kind)}
            aria-pressed={filter === kind}
            disabled={!counts?.[kind]}
            title={KIND_BLURB[kind]}
          >
            {KIND_LABEL[kind]} {counts ? `(${counts[kind]})` : ""}
          </button>
        ))}
      </div>

      {filter !== "all" && (
        <p className="mb-3 text-[13px] text-stone-600">{KIND_BLURB[filter]}</p>
      )}

      {loading && !report && (
        <Panel>
          <p role="status" className="text-stone-600">
            Reviewing stock, demand, supplier terms, and open orders…
          </p>
        </Panel>
      )}

      {report && shown.length === 0 && (
        <Panel>
          <Empty>
            No findings in this category. Select another category or refresh
            findings.
          </Empty>
        </Panel>
      )}

      <div className="grid gap-3">
        {shown.map((o) => {
          const open = expanded === o.id;
          return (
            <Panel key={o.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Badge tone={SEVERITY_TONE[o.severity]}>{o.severity}</Badge>
                    <Badge tone="slate">{KIND_LABEL[o.kind]}</Badge>
                    {o.sku && (
                      <span className="mono text-[11.5px] text-stone-500">
                        {o.sku}
                      </span>
                    )}
                    {o.nodeName && (
                      <span className="text-[11.5px] text-stone-500">
                        {o.nodeName}
                      </span>
                    )}
                  </div>
                  <h2 className="font-medium text-stone-800">{o.title}</h2>
                  <p className="mt-1 text-[13px] text-stone-600">
                    {o.headline}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[11px] uppercase tracking-wide text-stone-500">
                    Value at risk
                  </div>
                  <div className="mono text-stone-800">
                    {money(o.valueAtRisk)}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn"
                  onClick={() => setExpanded(open ? null : o.id)}
                  aria-expanded={open}
                >
                  {open ? "Hide evidence" : "View evidence"}
                  <Icon name="chevron" size={14} />
                </button>
                {o.handoff && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void handOff(o)}
                    disabled={!!handing}
                  >
                    {handing === o.id
                      ? "Agent working…"
                      : `Run review · ${o.handoff.label}`}
                  </button>
                )}
              </div>

              {open && (
                <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50 p-3">
                  <div className="mb-2 text-[11px] uppercase tracking-wide text-stone-500">
                    Evidence
                  </div>
                  <ul className="grid gap-1">
                    {o.evidence.map((line, i) => (
                      <li key={i} className="text-[12.5px] text-stone-700">
                        {line}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 border-t border-stone-200 pt-2">
                    <div className="mb-1 text-[11px] uppercase tracking-wide text-stone-500">
                      Suggested action
                    </div>
                    <p className="text-[12.5px] text-stone-700">
                      {o.suggestedAction}
                    </p>
                  </div>
                </div>
              )}

            </Panel>
          );
        })}
      </div>

      <Panel title="About these findings" className="mt-4">
        <p className="text-[13px] text-stone-600">
          Findings are calculated from current stock, demand, supplier
          performance, and open orders. Refreshing this list does not place
          orders or change the purchasing plan.
        </p>
        <p className="mt-2 text-[13px] text-stone-600">
          Select Run review to investigate a finding. The agent checks
          constraints and approval requirements before acting, then verifies the
          recorded outcome.
        </p>
      </Panel>
    </>
  );
}
