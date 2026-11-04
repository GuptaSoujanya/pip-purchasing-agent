"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import {
  Badge,
  DecisionBadge,
  DriftBadge,
  PageHeader,
  Panel,
  StatusBadge,
  moneyPrecise,
} from "@/components/ui";

type ScenarioPreset = {
  id: string;
  group: string;
  title: string;
  situation: string;
  tension: string;
  input: Record<string, unknown>;
};

const PRESETS: ScenarioPreset[] = [
  {
    id: "s1-over",
    group: "Recommendations",
    title: "Review an 800-unit oat milk recommendation",
    situation:
      "The replenishment system wants 800 units of SKU-1001 for Bogotá North DC. Stock looks low at a glance.",
    tension:
      "The recommendation overlooks 150 inbound units and uses a longer planning horizon. Recalculate the requirement using current supply and lead time.",
    input: {
      scenario: "recommendation_review",
      node_id: "NODE-BOG-01",
      product_id: "PRD-1001",
      recommended_qty: 800,
    },
  },
  {
    id: "s1-correct",
    group: "Recommendations",
    title: "Review a 500-unit yogurt recommendation",
    situation:
      "The same system recommends 500 units of SKU-1005 for Medellín Central DC.",
    tension:
      "The recommended quantity matches the seeded requirement. Check whether constraints still allow the purchase to proceed without approval.",
    input: {
      scenario: "recommendation_review",
      node_id: "NODE-MED-02",
      product_id: "PRD-1005",
      recommended_qty: 500,
    },
  },
  {
    id: "s2",
    group: "Supplier shortfalls",
    title: "Highland Coffee confirms 250 of 500 units",
    situation:
      "PO-2001 was raised for 500 units of coffee. The supplier now says it can only ship 250 this cycle.",
    tension:
      "Check whether existing stock covers the shortfall. The alternate supplier charges a 12% premium and falls below the reliability threshold, requiring buyer approval.",
    input: {
      scenario: "supplier_shortfall",
      po_id: "PO-2001",
      product_id: "PRD-1002",
      confirmed_qty: 250,
      event_id: "EVT-5001",
    },
  },
  {
    id: "s3-real",
    group: "Demand changes",
    title: "Energy drink sales have tripled",
    situation:
      "SKU-1003 was forecast at 40/day. It has been selling ~115/day for a week. A 600-unit order is already inbound, landing on day 9.",
    tension:
      "The seeded stock position runs out before the inbound order arrives. The supplier may partially confirm an expedited order, so the result needs independent verification.",
    input: {
      scenario: "demand_shift",
      node_id: "NODE-BOG-01",
      product_id: "PRD-1003",
    },
  },
  {
    id: "s3-promo",
    group: "Demand changes",
    title: "Yogurt demand rises during a promotion",
    situation:
      "SKU-1005 at Bogotá is selling 1.6x forecast, sustained for seven days. Statistically it looks exactly like the energy drink.",
    tension:
      "The 2-for-1 promotion ends in three days. Check whether it explains the demand increase and whether current stock covers the remaining promotion.",
    input: {
      scenario: "demand_shift",
      node_id: "NODE-BOG-01",
      product_id: "PRD-1005",
    },
  },
  {
    id: "s4",
    group: "Purchasing limits",
    title: "Water replenishment exceeds storage capacity",
    situation:
      "SKU-1004 is below safety stock at the Cartagena micro-FC. Requirement works out at 1,700 units.",
    tension:
      "Each unit uses three storage slots, limiting this site to 1,000 units. Check a partial order and capacity at other locations for the remaining requirement.",
    input: {
      scenario: "constrained_purchase",
      node_id: "NODE-CTG-03",
      product_id: "PRD-1004",
    },
  },
];

type RunResponse = {
  runId: string;
  status: string;
  decision: string;
  confidence: number;
  summary: string;
  recommendedQty: number;
  supplierId: string | null;
  orderValue: number;
  rationale: string[];
  keyFactors: { label: string; value: string; impact: string }[];
  validation: {
    passed: boolean;
    checks: {
      code: string;
      label: string;
      severity: string;
      passed: boolean;
      detail: string;
    }[];
    maxFeasibleQty: number;
    bindingConstraint: string | null;
  } | null;
  autonomy: {
    decision: string;
    riskLevel: string;
    reasons: string[];
    headline: string;
  } | null;
  approvalId: string | null;
  executedPoIds: string[];
  drift: {
    severity: string;
    summary: string;
    findings: {
      field: string;
      expected: unknown;
      actual: unknown;
      note: string;
      severity: string;
    }[];
  } | null;
  remediations: {
    attempt: number;
    rationale: string;
    poId: string | null;
    ok: boolean;
  }[];
  llmDivergence: { diverged: boolean; note: string } | null;
  mode: string;
  error?: string;
};

export default function ScenarioRunner({
  provider,
  pendingEvent,
}: {
  provider: string;
  pendingEvent: {
    id: string;
    po_id: string | null;
    supplier_id: string;
    payload: any;
  } | null;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<RunResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"auto" | "deterministic" | "llm">("auto");
  const [approving, setApproving] = useState(false);
  const [approvalOutcome, setApprovalOutcome] = useState<any>(null);
  const [category, setCategory] = useState("All scenarios");
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (result || error) resultRef.current?.focus();
  }, [result, error]);

  async function run(preset: ScenarioPreset) {
    setBusy(preset.id);
    setError(null);
    setResult(null);
    setApprovalOutcome(null);
    try {
      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...preset.input, mode }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Run failed.");
      setResult(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function decide(action: "approve" | "reject") {
    if (!result?.approvalId) return;
    setApproving(true);
    setError(null);
    try {
      const res = await fetch(`/api/approvals/${result.approvalId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          resolved_by: "buyer.maria",
          note: `${action} from scenario runner`,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed.");
      setApprovalOutcome({ action, ...json });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setApproving(false);
    }
  }

  const grouped = PRESETS.filter(
    (p) => category === "All scenarios" || p.group === category,
  ).reduce<Record<string, ScenarioPreset[]>>((acc, p) => {
    (acc[p.group] ??= []).push(p);
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        title="Scenarios"
        subtitle="Run a purchasing scenario to review the recommendation, constraint checks, and outcome."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="scenario-mode" className="label">
              Reasoning mode
            </label>
            <select
              id="scenario-mode"
              value={mode}
              disabled={!!busy || approving}
              onChange={(e) => setMode(e.target.value as typeof mode)}
              className="min-h-11 rounded-xl border border-edge bg-white px-3 py-2 text-sm text-stone-800"
            >
              <option value="auto">
                Automatic
                {provider === "none" ? " (rules-based)" : ` (${provider})`}
              </option>
              <option value="deterministic">Rules-based</option>
              <option value="llm" disabled={provider === "none"}>
                LLM reasoning
              </option>
            </select>
          </div>
        }
      />

      {pendingEvent && (
        <div className="mb-5 panel border-orange-200 bg-orange-50 p-4 text-sm leading-relaxed text-amber-900">
          <Badge tone="amber">Supplier update</Badge> {pendingEvent.supplier_id}{" "}
          on {pendingEvent.po_id}: can supply{" "}
          <strong>{pendingEvent.payload.confirmable_qty}</strong> of{" "}
          {pendingEvent.payload.ordered_qty} units —{" "}
          {pendingEvent.payload.reason}
        </div>
      )}

      <div
        className="mb-6 flex flex-wrap gap-2"
        role="group"
        aria-label="Filter scenarios by challenge"
      >
        {["All scenarios", ...new Set(PRESETS.map((p) => p.group))].map(
          (item) => (
            <button
              key={item}
              type="button"
              aria-pressed={category === item}
              onClick={() => setCategory(item)}
              className={`min-h-11 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${category === item ? "border-violet-950 bg-violet-950 text-white" : "border-edge bg-white text-stone-600 hover:bg-stone-50"}`}
            >
              {item}
            </button>
          ),
        )}
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="space-y-5">
          {Object.entries(grouped).map(([group, items]) => (
            <Panel key={group} title={group}>
              <div className="space-y-3">
                {items.map((p) => (
                  <div
                    key={p.id}
                    id={p.id}
                    className="rounded-xl border border-edge bg-white p-4"
                  >
                    <h3 className="text-base font-semibold leading-snug text-stone-900">
                      {p.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-stone-600">
                      {p.situation}
                    </p>
                    <details className="mt-3 rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-700">
                      <summary className="cursor-pointer py-1 font-medium">
                        Decision context
                      </summary>
                      <p className="pb-1 pt-2 leading-relaxed">{p.tension}</p>
                    </details>
                    <button
                      onClick={() => run(p)}
                      disabled={!!busy || approving}
                      className="btn btn-primary mt-3 w-full"
                    >
                      {busy === p.id ? "Agent working…" : "Run scenario"}
                    </button>
                  </div>
                ))}
              </div>
            </Panel>
          ))}
        </div>

        <div
          ref={resultRef}
          tabIndex={-1}
          className="min-w-0 space-y-4 rounded-xl focus:outline-none"
          aria-label="Scenario result"
          aria-busy={!!busy || approving}
        >
          {error && (
            <div
              role="alert"
              className="panel border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
            >
              {error}
            </div>
          )}

          {!result && !error && (
            <Panel title={busy ? "Scenario running" : "Scenario result"}>
              <div
                className="flex min-h-72 flex-col items-center justify-center px-4 py-10 text-center"
                role="status"
              >
                <span
                  className={`mb-5 grid h-16 w-16 place-items-center rounded-xl bg-stone-100 text-emerald-800 ${busy ? "motion-safe:animate-pulse" : ""}`}
                  aria-hidden="true"
                >
                  <Icon name={busy ? "activity" : "check"} size={28} />
                </span>
                <h3 className="text-lg font-semibold text-stone-900">
                  {busy ? "Checking the purchasing plan…" : "Select a scenario"}
                </h3>
                <p className="mt-2 max-w-sm text-sm leading-relaxed text-stone-600">
                  {busy
                    ? "Reviewing stock, supplier terms, and purchasing limits. Your recommendation will appear here when it is ready."
                    : "The recommendation, supporting evidence, and validation results will appear here."}
                </p>
              </div>
            </Panel>
          )}

          {result && (
            <>
              <Panel
                title="Decision"
                right={
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="slate">{result.mode}</Badge>
                    <StatusBadge status={result.status} />
                  </div>
                }
              >
                <div className="flex flex-wrap items-center gap-3">
                  <DecisionBadge decision={result.decision} />
                  {result.recommendedQty > 0 && (
                    <span className="text-lg font-semibold tabular-nums text-stone-900">
                      {result.recommendedQty.toLocaleString()} units
                    </span>
                  )}
                  {result.orderValue > 0 && (
                    <span className="mono text-stone-600">
                      {moneyPrecise(result.orderValue)}
                    </span>
                  )}
                  <span className="ml-auto text-[12px] text-stone-500">
                    confidence {(result.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="mt-3 text-[13px] leading-relaxed text-stone-700">
                  {result.summary}
                </p>
                <div className="mt-3">
                  <Link
                    href={`/runs/${result.runId}`}
                    className="text-[12.5px] text-emerald-800 hover:underline"
                  >
                    View the full reasoning trace →
                  </Link>
                </div>
              </Panel>

              {result.keyFactors?.length > 0 && (
                <Panel title="Decision factors">
                  <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                    {result.keyFactors.map((f, i) => (
                      <div key={i} className="kv">
                        <span className="text-stone-600">{f.label}</span>
                        <span
                          className={`mono text-right ${
                            f.impact === "opposes"
                              ? "text-amber-800"
                              : f.impact === "supports"
                                ? "text-emerald-700"
                                : "text-stone-800"
                          }`}
                        >
                          {f.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </Panel>
              )}

              <Panel title="Reasoning">
                <ol className="space-y-2">
                  {result.rationale.map((r, i) => (
                    <li
                      key={i}
                      className="flex gap-2.5 text-[12.5px] leading-relaxed text-stone-700"
                    >
                      <span className="mono shrink-0 text-stone-600">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ol>
              </Panel>

              {result.llmDivergence && (
                <Panel title="Model vs policy engine">
                  <div className="flex items-start gap-3">
                    <Badge
                      tone={result.llmDivergence.diverged ? "amber" : "green"}
                    >
                      {result.llmDivergence.diverged ? "diverged" : "agreed"}
                    </Badge>
                    <p className="text-[12.5px] leading-relaxed text-stone-700">
                      {result.llmDivergence.note}
                    </p>
                  </div>
                </Panel>
              )}

              {result.validation && (
                <Panel
                  title="Constraint checks"
                  subtitle="Hard constraints must pass before a purchase can proceed."
                  right={
                    <Badge tone={result.validation.passed ? "green" : "red"}>
                      {result.validation.passed
                        ? "all hard constraints pass"
                        : `blocked: ${result.validation.bindingConstraint}`}
                    </Badge>
                  }
                >
                  <div className="space-y-1.5">
                    {result.validation.checks.map((c) => (
                      <div
                        key={c.code}
                        className="flex items-start gap-2.5 text-[12.5px]"
                      >
                        <span
                          className={`mt-0.5 shrink-0 ${c.passed ? "text-emerald-700" : c.severity === "hard" ? "text-rose-700" : "text-amber-800"}`}
                        >
                          {c.passed ? "✓" : c.severity === "hard" ? "✕" : "!"}
                        </span>
                        <div className="min-w-0 flex-1">
                          <span className="block font-medium text-stone-800">
                            {c.label}
                          </span>
                          <span
                            className={
                              c.passed ? "text-stone-600" : "text-stone-800"
                            }
                          >
                            {c.detail}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </Panel>
              )}

              {result.autonomy && (
                <Panel
                  title="Autonomy gate"
                  subtitle="Policy determines whether the purchase proceeds or needs approval."
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      tone={
                        result.autonomy.decision === "auto_execute"
                          ? "green"
                          : result.autonomy.decision === "require_approval"
                            ? "amber"
                            : "red"
                      }
                    >
                      {result.autonomy.decision.replace(/_/g, " ")}
                    </Badge>
                    <Badge
                      tone={
                        result.autonomy.riskLevel === "high"
                          ? "red"
                          : result.autonomy.riskLevel === "medium"
                            ? "amber"
                            : "green"
                      }
                    >
                      {result.autonomy.riskLevel} risk
                    </Badge>
                  </div>
                  <ul className="mt-3 space-y-1.5">
                    {result.autonomy.reasons.map((r, i) => (
                      <li
                        key={i}
                        className="text-[12.5px] leading-relaxed text-stone-600"
                      >
                        — {r}
                      </li>
                    ))}
                  </ul>

                  {result.approvalId &&
                    result.status === "awaiting_approval" &&
                    !approvalOutcome && (
                      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-edge pt-4">
                        <span className="text-[12.5px] text-stone-600">
                          You are the buyer:
                        </span>
                        <button
                          onClick={() => decide("approve")}
                          disabled={approving}
                          className="btn btn-ok"
                        >
                          {approving ? "Saving decision…" : "Approve & execute"}
                        </button>
                        <button
                          onClick={() => decide("reject")}
                          disabled={approving}
                          className="btn btn-danger"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                </Panel>
              )}

              {approvalOutcome && (
                <Panel
                  title={
                    approvalOutcome.action === "approve"
                      ? "Executed after approval"
                      : "Rejected"
                  }
                  right={
                    approvalOutcome.status ? (
                      <StatusBadge status={approvalOutcome.status} />
                    ) : null
                  }
                >
                  {approvalOutcome.action === "reject" ? (
                    <p className="text-[13px] text-stone-700">
                      No purchase was made. The run is closed and the rejection
                      is recorded in the trace.
                    </p>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        {approvalOutcome.drift && (
                          <DriftBadge
                            severity={approvalOutcome.drift.severity}
                          />
                        )}
                        {approvalOutcome.executedPoIds?.map((id: string) => (
                          <Badge key={id} tone="slate">
                            {id}
                          </Badge>
                        ))}
                      </div>
                      {approvalOutcome.drift && (
                        <p className="mt-3 text-[13px] leading-relaxed text-stone-700">
                          {approvalOutcome.drift.summary}
                        </p>
                      )}
                      {approvalOutcome.remediations?.length > 0 && (
                        <div className="mt-3 border-t border-edge pt-3">
                          <div className="label mb-2">Self-correction</div>
                          {approvalOutcome.remediations.map(
                            (r: any, i: number) => (
                              <p
                                key={i}
                                className="text-[12.5px] leading-relaxed text-stone-600"
                              >
                                Attempt {r.attempt} {r.ok ? "✓" : "✕"} —{" "}
                                {r.rationale}
                                {r.poId && (
                                  <>
                                    {" "}
                                    Created{" "}
                                    <span className="mono text-emerald-800">
                                      {r.poId}
                                    </span>
                                    .
                                  </>
                                )}
                              </p>
                            ),
                          )}
                        </div>
                      )}
                      <Link
                        href={`/runs/${approvalOutcome.runId}`}
                        className="mt-3 inline-block text-[12.5px] text-emerald-800 hover:underline"
                      >
                        See the full trace including the correction →
                      </Link>
                    </>
                  )}
                </Panel>
              )}

              {result.drift && (
                <Panel
                  title="Post-execution verification"
                  subtitle="Checks the recorded order and stock position against the expected outcome."
                  right={<DriftBadge severity={result.drift.severity} />}
                >
                  <p className="text-[13px] leading-relaxed text-stone-700">
                    {result.drift.summary}
                  </p>
                  <div className="mt-3 space-y-1.5">
                    {result.drift.findings.map((f, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2.5 text-[12.5px]"
                      >
                        <span
                          className={`mt-0.5 shrink-0 ${f.severity === "none" ? "text-emerald-700" : f.severity === "benign" ? "text-emerald-800" : f.severity === "material" ? "text-amber-800" : "text-rose-700"}`}
                        >
                          {f.severity === "none" ? "✓" : "!"}
                        </span>
                        <div className="min-w-0 flex-1">
                          <span className="block font-medium text-stone-800">
                            {f.field}
                          </span>
                          <span className="text-stone-700">{f.note}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </Panel>
              )}

              {result.remediations?.length > 0 && (
                <Panel
                  title="Self-correction"
                  subtitle="Follow-up actions taken to resolve a difference in the outcome."
                >
                  {result.remediations.map((r, i) => (
                    <p
                      key={i}
                      className="text-[12.5px] leading-relaxed text-stone-700"
                    >
                      Attempt {r.attempt} {r.ok ? "✓" : "✕"} — {r.rationale}
                      {r.poId && (
                        <>
                          {" "}
                          Created{" "}
                          <span className="mono text-emerald-800">
                            {r.poId}
                          </span>
                          .
                        </>
                      )}
                    </p>
                  ))}
                </Panel>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
