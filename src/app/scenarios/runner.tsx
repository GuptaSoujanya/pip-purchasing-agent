"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Badge, DecisionBadge, DriftBadge, PageHeader, Panel, StatusBadge, moneyPrecise,
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
    group: "Scenario 1 — Purchase recommendation review",
    title: "System recommends 800 units of Oat Milk",
    situation:
      "The replenishment system wants 800 units of SKU-1001 for Bogotá North DC. Stock looks low at a glance.",
    tension:
      "It ignores 150 units already in transit and sizes against a longer horizon than the supplier's lead time warrants. The agent has to recompute requirement from scratch and push back.",
    input: { scenario: "recommendation_review", node_id: "NODE-BOG-01", product_id: "PRD-1001", recommended_qty: 800 },
  },
  {
    id: "s1-correct",
    group: "Scenario 1 — Purchase recommendation review",
    title: "System recommends 500 units of Greek Yogurt",
    situation:
      "The same system recommends 500 units of SKU-1005 for Medellín Central DC.",
    tension:
      "This one is actually right. A useful agent has to be able to agree — and then execute autonomously, because every constraint clears and nothing is flagged.",
    input: { scenario: "recommendation_review", node_id: "NODE-MED-02", product_id: "PRD-1005", recommended_qty: 500 },
  },
  {
    id: "s2",
    group: "Scenario 2 — Supplier cannot fulfil",
    title: "Highland Coffee confirms 250 of 500 units",
    situation:
      "PO-2001 was raised for 500 units of coffee. The supplier now says it can only ship 250 this cycle.",
    tension:
      "Whether that matters depends on the stock position, not the size of the gap. It does leave a hole — and the only alternate supplier is 12% dearer and below the reliability floor, so a human has to sign off.",
    input: { scenario: "supplier_shortfall", po_id: "PO-2001", product_id: "PRD-1002", confirmed_qty: 250, event_id: "EVT-5001" },
  },
  {
    id: "s3-real",
    group: "Scenario 3 — Demand has changed",
    title: "Energy drink sales have tripled",
    situation:
      "SKU-1003 was forecast at 40/day. It has been selling ~115/day for a week. A 600-unit order is already inbound, landing on day 9.",
    tension:
      "Stock runs out around day 4. This is the full loop: the agent re-plans, a buyer approves, the supplier then silently confirms only 400 of 1,500 units — and the agent has to catch that itself and fix it.",
    input: { scenario: "demand_shift", node_id: "NODE-BOG-01", product_id: "PRD-1003" },
  },
  {
    id: "s3-promo",
    group: "Scenario 3 — Demand has changed",
    title: "Yogurt sales are up 60% — but there's a promotion on",
    situation:
      "SKU-1005 at Bogotá is selling 1.6x forecast, sustained for seven days. Statistically it looks exactly like the energy drink.",
    tension:
      "A 2-for-1 promotion fully explains the lift and ends in three days, and stock covers that. The right answer is to do nothing — and to refuse to rebase the forecast.",
    input: { scenario: "demand_shift", node_id: "NODE-BOG-01", product_id: "PRD-1005" },
  },
  {
    id: "s4",
    group: "Scenario 4 — Purchasing constraint",
    title: "Cartagena needs water it has nowhere to put",
    situation:
      "SKU-1004 is below safety stock at the Cartagena micro-FC. Requirement works out at 1,700 units.",
    tension:
      "Bottled water takes 3 storage slots per unit, and the site has room for 1,000. Storage binds before budget does. The agent must part-order and find a home for the balance rather than forcing or abandoning the purchase.",
    input: { scenario: "constrained_purchase", node_id: "NODE-CTG-03", product_id: "PRD-1004" },
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
    checks: { code: string; label: string; severity: string; passed: boolean; detail: string }[];
    maxFeasibleQty: number;
    bindingConstraint: string | null;
  } | null;
  autonomy: { decision: string; riskLevel: string; reasons: string[]; headline: string } | null;
  approvalId: string | null;
  executedPoIds: string[];
  drift: { severity: string; summary: string; findings: { field: string; expected: unknown; actual: unknown; note: string; severity: string }[] } | null;
  remediations: { attempt: number; rationale: string; poId: string | null; ok: boolean }[];
  llmDivergence: { diverged: boolean; note: string } | null;
  mode: string;
  error?: string;
};

export default function ScenarioRunner({
  provider, pendingEvent,
}: {
  provider: string;
  pendingEvent: { id: string; po_id: string | null; supplier_id: string; payload: any } | null;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<RunResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"auto" | "deterministic" | "llm">("auto");
  const [approving, setApproving] = useState(false);
  const [approvalOutcome, setApprovalOutcome] = useState<any>(null);

  async function run(preset: ScenarioPreset) {
    setBusy(preset.id); setError(null); setResult(null); setApprovalOutcome(null);
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
    try {
      const res = await fetch(`/api/approvals/${result.approvalId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, resolved_by: "buyer.maria", note: `${action} from scenario runner` }),
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

  const grouped = PRESETS.reduce<Record<string, ScenarioPreset[]>>((acc, p) => {
    (acc[p.group] ??= []).push(p);
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        title="Scenarios"
        subtitle="Each one is built so the obvious answer is wrong. Run it and watch the agent investigate, decide, check itself against the constraint engine, act, and then verify what actually happened."
        actions={
          <div className="flex items-center gap-2">
            <span className="label">mode</span>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
              className="rounded-md border border-edge bg-slate-800/60 px-2.5 py-1.5 text-[13px] text-slate-200"
            >
              <option value="auto">auto{provider === "none" ? " (no key → deterministic)" : ` (${provider})`}</option>
              <option value="deterministic">deterministic only</option>
              <option value="llm" disabled={provider === "none"}>LLM reasoning</option>
            </select>
          </div>
        }
      />

      {pendingEvent && (
        <div className="mb-4 panel border-amber-600/40 bg-amber-500/[0.06] p-4 text-[13px] text-amber-200/90">
          <Badge tone="amber">unprocessed supplier message</Badge>{" "}
          {pendingEvent.supplier_id} on {pendingEvent.po_id}: can supply{" "}
          <strong>{pendingEvent.payload.confirmable_qty}</strong> of {pendingEvent.payload.ordered_qty} units —{" "}
          {pendingEvent.payload.reason}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="space-y-5">
          {Object.entries(grouped).map(([group, items]) => (
            <Panel key={group} title={group}>
              <div className="space-y-3">
                {items.map((p) => (
                  <div key={p.id} className="rounded-md border border-edge bg-slate-900/40 p-3.5">
                    <h3 className="text-[13.5px] font-medium text-slate-100">{p.title}</h3>
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-400">{p.situation}</p>
                    <p className="mt-2 border-l-2 border-amber-600/50 pl-2.5 text-[12.5px] leading-relaxed text-amber-200/70">
                      {p.tension}
                    </p>
                    <button
                      onClick={() => run(p)}
                      disabled={!!busy}
                      className="btn btn-primary mt-3 w-full"
                    >
                      {busy === p.id ? "Agent working…" : "Run agent"}
                    </button>
                  </div>
                ))}
              </div>
            </Panel>
          ))}
        </div>

        <div className="space-y-4">
          {error && (
            <div className="panel border-rose-600/40 bg-rose-500/[0.06] p-4 text-[13px] text-rose-200">{error}</div>
          )}

          {!result && !error && (
            <Panel title="Result">
              <p className="py-10 text-center text-[13px] text-slate-500">
                Pick a scenario on the left. The decision, the constraint checks behind it, and the
                post-execution verification all appear here.
              </p>
            </Panel>
          )}

          {result && (
            <>
              <Panel
                title="Decision"
                right={
                  <div className="flex items-center gap-2">
                    <Badge tone="slate">{result.mode}</Badge>
                    <StatusBadge status={result.status} />
                  </div>
                }
              >
                <div className="flex flex-wrap items-center gap-3">
                  <DecisionBadge decision={result.decision} />
                  {result.recommendedQty > 0 && (
                    <span className="text-lg font-semibold tabular-nums text-slate-100">
                      {result.recommendedQty.toLocaleString()} units
                    </span>
                  )}
                  {result.orderValue > 0 && (
                    <span className="mono text-slate-400">{moneyPrecise(result.orderValue)}</span>
                  )}
                  <span className="ml-auto text-[12px] text-slate-500">
                    confidence {(result.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="mt-3 text-[13px] leading-relaxed text-slate-300">{result.summary}</p>
                <div className="mt-3">
                  <Link href={`/runs/${result.runId}`} className="text-[12.5px] text-sky-400 hover:underline">
                    View the full reasoning trace →
                  </Link>
                </div>
              </Panel>

              {result.keyFactors?.length > 0 && (
                <Panel title="What drove it">
                  <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                    {result.keyFactors.map((f, i) => (
                      <div key={i} className="kv">
                        <span className="text-slate-400">{f.label}</span>
                        <span
                          className={`mono text-right ${
                            f.impact === "opposes" ? "text-amber-400"
                            : f.impact === "supports" ? "text-emerald-400" : "text-slate-200"
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
                    <li key={i} className="flex gap-2.5 text-[12.5px] leading-relaxed text-slate-300">
                      <span className="mono shrink-0 text-slate-600">{String(i + 1).padStart(2, "0")}</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ol>
              </Panel>

              {result.llmDivergence && (
                <Panel title="Model vs policy engine">
                  <div className="flex items-start gap-3">
                    <Badge tone={result.llmDivergence.diverged ? "amber" : "green"}>
                      {result.llmDivergence.diverged ? "diverged" : "agreed"}
                    </Badge>
                    <p className="text-[12.5px] leading-relaxed text-slate-300">{result.llmDivergence.note}</p>
                  </div>
                </Panel>
              )}

              {result.validation && (
                <Panel
                  title="Constraint checks"
                  subtitle="run before any write; hard failures block execution outright"
                  right={
                    <Badge tone={result.validation.passed ? "green" : "red"}>
                      {result.validation.passed ? "all hard constraints pass" : `blocked: ${result.validation.bindingConstraint}`}
                    </Badge>
                  }
                >
                  <div className="space-y-1.5">
                    {result.validation.checks.map((c) => (
                      <div key={c.code} className="flex items-start gap-2.5 text-[12.5px]">
                        <span className={`mt-0.5 shrink-0 ${c.passed ? "text-emerald-400" : c.severity === "hard" ? "text-rose-400" : "text-amber-400"}`}>
                          {c.passed ? "✓" : c.severity === "hard" ? "✕" : "!"}
                        </span>
                        <span className="w-28 shrink-0 text-slate-400">{c.label}</span>
                        <span className={c.passed ? "text-slate-400" : "text-slate-200"}>{c.detail}</span>
                      </div>
                    ))}
                  </div>
                </Panel>
              )}

              {result.autonomy && (
                <Panel title="Autonomy gate" subtitle="how much the agent is allowed to do on its own">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={
                      result.autonomy.decision === "auto_execute" ? "green"
                      : result.autonomy.decision === "require_approval" ? "amber" : "red"
                    }>
                      {result.autonomy.decision.replace(/_/g, " ")}
                    </Badge>
                    <Badge tone={result.autonomy.riskLevel === "high" ? "red" : result.autonomy.riskLevel === "medium" ? "amber" : "green"}>
                      {result.autonomy.riskLevel} risk
                    </Badge>
                  </div>
                  <ul className="mt-3 space-y-1.5">
                    {result.autonomy.reasons.map((r, i) => (
                      <li key={i} className="text-[12.5px] leading-relaxed text-slate-400">— {r}</li>
                    ))}
                  </ul>

                  {result.approvalId && result.status === "awaiting_approval" && !approvalOutcome && (
                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-edge pt-4">
                      <span className="text-[12.5px] text-slate-400">You are the buyer:</span>
                      <button onClick={() => decide("approve")} disabled={approving} className="btn btn-ok">
                        {approving ? "Executing…" : "Approve & execute"}
                      </button>
                      <button onClick={() => decide("reject")} disabled={approving} className="btn btn-danger">
                        Reject
                      </button>
                    </div>
                  )}
                </Panel>
              )}

              {approvalOutcome && (
                <Panel
                  title={approvalOutcome.action === "approve" ? "Executed after approval" : "Rejected"}
                  right={approvalOutcome.status ? <StatusBadge status={approvalOutcome.status} /> : null}
                >
                  {approvalOutcome.action === "reject" ? (
                    <p className="text-[13px] text-slate-300">
                      No purchase was made. The run is closed and the rejection is recorded in the trace.
                    </p>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        {approvalOutcome.drift && <DriftBadge severity={approvalOutcome.drift.severity} />}
                        {approvalOutcome.executedPoIds?.map((id: string) => (
                          <Badge key={id} tone="sky">{id}</Badge>
                        ))}
                      </div>
                      {approvalOutcome.drift && (
                        <p className="mt-3 text-[13px] leading-relaxed text-slate-300">
                          {approvalOutcome.drift.summary}
                        </p>
                      )}
                      {approvalOutcome.remediations?.length > 0 && (
                        <div className="mt-3 border-t border-edge pt-3">
                          <div className="label mb-2">Self-correction</div>
                          {approvalOutcome.remediations.map((r: any, i: number) => (
                            <p key={i} className="text-[12.5px] leading-relaxed text-slate-400">
                              Attempt {r.attempt} {r.ok ? "✓" : "✕"} — {r.rationale}
                              {r.poId && <> Created <span className="mono text-sky-400">{r.poId}</span>.</>}
                            </p>
                          ))}
                        </div>
                      )}
                      <Link href={`/runs/${approvalOutcome.runId}`} className="mt-3 inline-block text-[12.5px] text-sky-400 hover:underline">
                        See the full trace including the correction →
                      </Link>
                    </>
                  )}
                </Panel>
              )}

              {result.drift && (
                <Panel
                  title="Post-execution verification"
                  subtitle="the world was re-read independently, not taken from the write's own response"
                  right={<DriftBadge severity={result.drift.severity} />}
                >
                  <p className="text-[13px] leading-relaxed text-slate-300">{result.drift.summary}</p>
                  <div className="mt-3 space-y-1.5">
                    {result.drift.findings.map((f, i) => (
                      <div key={i} className="flex items-start gap-2.5 text-[12.5px]">
                        <span className={`mt-0.5 shrink-0 ${f.severity === "none" ? "text-emerald-400" : f.severity === "benign" ? "text-sky-400" : f.severity === "material" ? "text-amber-400" : "text-rose-400"}`}>
                          {f.severity === "none" ? "✓" : "!"}
                        </span>
                        <span className="w-32 shrink-0 text-slate-400">{f.field}</span>
                        <span className="text-slate-300">{f.note}</span>
                      </div>
                    ))}
                  </div>
                </Panel>
              )}

              {result.remediations?.length > 0 && (
                <Panel title="Self-correction" subtitle="the agent fixed this without being asked">
                  {result.remediations.map((r, i) => (
                    <p key={i} className="text-[12.5px] leading-relaxed text-slate-300">
                      Attempt {r.attempt} {r.ok ? "✓" : "✕"} — {r.rationale}
                      {r.poId && <> Created <span className="mono text-sky-400">{r.poId}</span>.</>}
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
