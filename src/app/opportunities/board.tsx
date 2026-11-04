"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  DecisionBadge,
  Empty,
  PageHeader,
  Panel,
  StatusBadge,
  money,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import "@/components/workflow-pages.css";
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

const normalizeSearch = (value: string) =>
  value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export default function OpportunityBoard() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<OpportunityKind | "all">("all");
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState<"all" | "urgent" | "actionable">(
    "all",
  );
  const [expanded, setExpanded] = useState<string | null>(null);
  const [handing, setHanding] = useState<string | null>(null);
  const [handoffResult, setHandoffResult] = useState<{
    id: string;
    title: string;
    runId: string;
    decision: string | null;
    status: string | null;
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
        status: data.status ?? data.run?.status ?? null,
        summary:
          data.summary ?? data.run?.summary ?? "The agent completed its run.",
        ok: true,
        resolvedAway: refreshed
          ? !refreshed.opportunities.some((x) => x.id === opportunity.id)
          : false,
      });
    } catch (e) {
      setHandoffResult({
        id: opportunity.id,
        title: opportunity.title,
        runId: "",
        decision: null,
        status: null,
        summary: e instanceof Error ? e.message : "Agent run failed",
        ok: false,
        resolvedAway: false,
      });
    } finally {
      setHanding(null);
    }
  }

  const search = normalizeSearch(query.trim());
  const shown =
    report?.opportunities.filter((opportunity) => {
      const matchesKind = filter === "all" || opportunity.kind === filter;
      const matchesPriority =
        priority === "all" ||
        (priority === "actionable"
          ? Boolean(opportunity.handoff)
          : ["critical", "high"].includes(opportunity.severity));
      const matchesSearch =
        !search ||
        [
          opportunity.title,
          opportunity.headline,
          opportunity.nodeName,
          opportunity.sku,
        ].some((value) => value && normalizeSearch(value).includes(search));
      return matchesKind && matchesPriority && matchesSearch;
    }) ?? [];
  const counts = report?.byKind;
  const critical =
    report?.opportunities.filter((item) => item.severity === "critical")
      .length ?? 0;
  const actionable =
    report?.opportunities.filter((item) => item.handoff).length ?? 0;
  const resetFilters = () => {
    setFilter("all");
    setPriority("all");
    setQuery("");
  };

  return (
    <div className="workflow-page workflow-opportunities">
      <div className="workflow-kicker">BUYING / OPPORTUNITIES</div>
      <PageHeader
        title="Find your next purchasing action"
        subtitle="Prioritise stock gaps, supplier risks and demand changes across your locations."
        actions={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void load()}
            disabled={loading || Boolean(handing)}
          >
            <Icon name="search" size={16} />
            {loading ? "Refreshing…" : "Refresh findings"}
          </button>
        }
      />
      {error && (
        <div className="workflow-feedback" data-tone="error" role="alert">
          <strong>Findings could not be refreshed</strong>
          <p>{error}</p>
          <button
            type="button"
            className="btn"
            onClick={() => void load()}
            disabled={loading}
          >
            Try again
          </button>
        </div>
      )}
      {handoffResult && (
        <div
          className="workflow-feedback"
          data-tone={
            !handoffResult.ok || handoffResult.status === "failed"
              ? "error"
              : "success"
          }
          role={
            handoffResult.ok && handoffResult.status !== "failed"
              ? "status"
              : "alert"
          }
        >
          <div className="workflow-feedback-heading">
            {handoffResult.ok && handoffResult.status ? (
              <StatusBadge status={handoffResult.status} />
            ) : (
              <Badge tone={handoffResult.ok ? "slate" : "red"}>
                {handoffResult.ok ? "Review returned" : "Review failed"}
              </Badge>
            )}
            {handoffResult.decision && (
              <DecisionBadge decision={handoffResult.decision} />
            )}
            {handoffResult.resolvedAway && (
              <Badge tone="sky">Finding cleared</Badge>
            )}
            <button
              type="button"
              className="workflow-dismiss"
              aria-label="Dismiss review result"
              onClick={() => setHandoffResult(null)}
            >
              <Icon name="close" size={17} />
            </button>
          </div>
          <strong>{handoffResult.title}</strong>
          <p>{handoffResult.summary}</p>
          {handoffResult.resolvedAway && (
            <p>
              This finding cleared after the refresh. Review the trace to see
              what changed.
            </p>
          )}
          {handoffResult.runId && (
            <Link
              href={`/runs/${handoffResult.runId}`}
              className="workflow-row-action"
            >
              Review the full decision
              <Icon name="arrow" size={15} />
            </Link>
          )}
        </div>
      )}
      <dl
        className="workflow-summary"
        aria-label="Findings summary"
        aria-busy={loading}
      >
        <div>
          <dt>Findings</dt>
          <dd>
            {report?.opportunities.length ?? "—"}
            <small>
              {report
                ? `${report.scanned.positions} stock positions · ${report.scanned.purchaseOrders} orders`
                : "Reviewing your network"}
            </small>
          </dd>
        </div>
        <div data-tone={critical ? "peach" : "neutral"}>
          <dt>Critical findings</dt>
          <dd>
            {report ? critical : "—"}
            <small>Highest priority in this snapshot</small>
          </dd>
        </div>
        <div>
          <dt>Value at risk</dt>
          <dd>
            {report ? money(report.totalValueAtRisk) : "—"}
            <small>Sales, open orders and excess stock</small>
          </dd>
        </div>
        <div data-tone="blue">
          <dt>Ready for agent review</dt>
          <dd>
            {report ? actionable : "—"}
            <small>Supported purchasing workflows</small>
          </dd>
        </div>
      </dl>
      <section
        className="workflow-findings"
        aria-labelledby="findings-heading"
        aria-busy={loading}
      >
        <div className="workflow-section-heading">
          <div>
            <h2 id="findings-heading">Findings to investigate</h2>
            <p>
              {filter === "all"
                ? "Prioritised by severity and value at risk."
                : KIND_BLURB[filter]}
            </p>
          </div>
          <span className="workflow-count" role="status">
            {loading
              ? "Updating findings…"
              : `${shown.length} ${shown.length === 1 ? "finding" : "findings"}`}
          </span>
        </div>
        <div className="workflow-filter-surface">
          <div className="workflow-filter-top">
            <label className="workflow-search">
              <Icon name="search" size={17} />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search product, SKU or location"
                aria-label="Search purchasing findings"
              />
            </label>
            <div
              className="workflow-priority"
              role="group"
              aria-label="Finding priority"
            >
              {(
                [
                  { value: "all", label: "All priorities" },
                  { value: "urgent", label: "Critical & high" },
                  { value: "actionable", label: "Agent-ready" },
                ] as const
              ).map((item) => (
                <button
                  type="button"
                  key={item.value}
                  aria-pressed={priority === item.value}
                  onClick={() => setPriority(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div
            className="workflow-category-filters"
            role="group"
            aria-label="Finding category"
          >
            <button
              type="button"
              onClick={() => setFilter("all")}
              aria-pressed={filter === "all"}
            >
              All findings<span>{report?.opportunities.length ?? "—"}</span>
            </button>
            {(Object.keys(KIND_LABEL) as OpportunityKind[]).map((kind) => (
              <button
                type="button"
                key={kind}
                onClick={() => setFilter(kind)}
                aria-pressed={filter === kind}
                title={KIND_BLURB[kind]}
              >
                {KIND_LABEL[kind]}
                <span>{counts?.[kind] ?? "—"}</span>
              </button>
            ))}
          </div>
        </div>
        {loading && !report && (
          <Panel>
            <div className="workflow-loading" role="status">
              <Icon name="search" size={22} />
              <strong>Reviewing your purchasing network</strong>
              <p>Checking stock, demand, supplier terms and open orders.</p>
            </div>
          </Panel>
        )}
        {report && shown.length === 0 && (
          <Panel>
            <Empty>
              <strong className="workflow-empty-title">
                {report.opportunities.length === 0
                  ? "No purchasing findings right now"
                  : "No findings match these filters"}
              </strong>
              <p>
                {report.opportunities.length === 0
                  ? "Refresh after inventory, supplier or demand data changes."
                  : "Try another product, priority or category."}
              </p>
              {report.opportunities.length > 0 && (
                <button
                  type="button"
                  className="btn workflow-empty-action"
                  onClick={resetFilters}
                >
                  Clear filters
                </button>
              )}
            </Empty>
          </Panel>
        )}
        <div className="workflow-finding-list">
          {shown.map((opportunity) => {
            const open = expanded === opportunity.id;
            return (
              <article
                key={opportunity.id}
                className="workflow-finding"
                data-severity={opportunity.severity}
              >
                <div className="workflow-finding-main">
                  <div className="workflow-finding-copy">
                    <div className="workflow-finding-meta">
                      <Badge tone={SEVERITY_TONE[opportunity.severity]}>
                        {opportunity.severity}
                      </Badge>
                      <span>{KIND_LABEL[opportunity.kind]}</span>
                      {opportunity.nodeName && (
                        <span>
                          <Icon name="warehouse" size={13} />
                          {opportunity.nodeName}
                        </span>
                      )}
                      {opportunity.sku && (
                        <span className="mono">{opportunity.sku}</span>
                      )}
                    </div>
                    <h3>{opportunity.title}</h3>
                    <p>{opportunity.headline}</p>
                  </div>
                  <dl className="workflow-risk">
                    <dt>Value at risk</dt>
                    <dd>{money(opportunity.valueAtRisk)}</dd>
                  </dl>
                </div>
                <div className="workflow-finding-footer">
                  <p>
                    <span>Suggested next step</span>
                    {opportunity.suggestedAction}
                  </p>
                  <div className="workflow-card-actions">
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setExpanded(open ? null : opportunity.id)}
                      aria-expanded={open}
                      aria-controls={`finding-evidence-${opportunity.id}`}
                    >
                      {open ? "Hide evidence" : "View evidence"}
                      <Icon name="chevron" size={14} />
                    </button>
                    {opportunity.handoff && (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => void handOff(opportunity)}
                        disabled={Boolean(handing) || loading}
                        title={opportunity.handoff.label}
                        aria-label={`Review and act on ${opportunity.title}`}
                      >
                        {handing === opportunity.id
                          ? "Agent working…"
                          : "Review & act"}
                        <Icon name="arrow" size={14} />
                      </button>
                    )}
                  </div>
                </div>
                {open && (
                  <section
                    id={`finding-evidence-${opportunity.id}`}
                    className="workflow-evidence"
                    aria-label={`Evidence for ${opportunity.title}`}
                  >
                    <h4>Supporting evidence</h4>
                    <ul>
                      {opportunity.evidence.map((line, index) => (
                        <li key={index}>{line}</li>
                      ))}
                    </ul>
                    {opportunity.handoff && (
                      <p className="workflow-evidence-route">
                        Review workflow: {opportunity.handoff.label}
                      </p>
                    )}
                  </section>
                )}
              </article>
            );
          })}
        </div>
      </section>
      {report && (
        <details className="workflow-reference workflow-capacity">
          <summary>
            <span>
              <Icon name="wallet" size={18} />
              Budget & storage by location
            </span>
            <span>
              {report.headroom.length} locations
              <Icon name="chevron" size={16} />
            </span>
          </summary>
          <div className="workflow-capacity-grid">
            {report.headroom.map((headroom) => (
              <article key={headroom.nodeId}>
                <h3>{headroom.nodeName}</h3>
                <dl>
                  <div>
                    <dt>Available budget</dt>
                    <dd>
                      {money(headroom.budgetFree)}
                      <small>of {money(headroom.budgetTotal)}</small>
                    </dd>
                  </div>
                  <div>
                    <dt>Free storage</dt>
                    <dd>
                      {headroom.slotsFree.toLocaleString("en-US")} slots
                      <small>
                        of {headroom.slotsTotal.toLocaleString("en-US")}
                      </small>
                    </dd>
                  </div>
                </dl>
                <p>Next review {headroom.nextReviewDate}</p>
              </article>
            ))}
          </div>
        </details>
      )}
      <details className="workflow-reference">
        <summary>
          <span>
            <Icon name="help" size={18} />
            How findings and reviews work
          </span>
          <Icon name="chevron" size={16} />
        </summary>
        <div className="workflow-reference-copy">
          <p>
            Findings use current stock, demand, supplier performance and open
            orders. Refreshing only updates this list. Running an agent review
            can take purchasing actions after checking constraints and approval
            requirements, then verifies the recorded outcome.
          </p>
          {report && (
            <p>
              Snapshot: {report.generatedAt.slice(0, 10)} ·{" "}
              {report.generatedAt.slice(11, 19)} UTC. Simulation date:{" "}
              {report.simulatedToday}.
            </p>
          )}
        </div>
      </details>
    </div>
  );
}
