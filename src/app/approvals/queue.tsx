"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, DriftBadge, Empty, PageHeader, Panel, StatusBadge } from "@/components/ui";

type Approval = {
  id: string;
  run_id: string;
  reason: string;
  risk_level: string;
  status: string;
  requested_at: string;
  resolved_by: string | null;
  resolution_note: string | null;
  action: any;
  run: { scenario: string; decision: string | null; summary: string | null } | null;
};

export default function ApprovalQueue({ approvals }: { approvals: Approval[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Record<string, any>>({});
  const [error, setError] = useState<string | null>(null);

  const pending = approvals.filter((a) => a.status === "pending");
  const resolved = approvals.filter((a) => a.status !== "pending");

  async function decide(id: string, action: "approve" | "reject") {
    setBusy(id); setError(null);
    try {
      const res = await fetch(`/api/approvals/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, resolved_by: "buyer.maria", note: `${action}d from approval queue` }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed.");
      setOutcome((o) => ({ ...o, [id]: { action, ...json } }));
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Approval queue"
        subtitle="Where the agent stops and asks. Approving does not merely tick a box — it resumes the parked action, executes it, verifies the outcome against the agent's original expectation, and self-corrects if the supplier does something unexpected."
      />

      {error && (
        <div className="mb-4 panel border-rose-600/40 bg-rose-500/[0.06] p-4 text-[13px] text-rose-200">{error}</div>
      )}

      <Panel title="Pending" subtitle={`${pending.length} item(s) blocking the agent`}>
        {pending.length === 0 ? (
          <Empty>Nothing waiting. Run a scenario that exceeds the autonomy thresholds to populate this queue.</Empty>
        ) : (
          <div className="space-y-3">
            {pending.map((a) => {
              const res = outcome[a.id];
              return (
                <div key={a.id} className="rounded-md border border-edge bg-slate-900/40 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={a.risk_level === "high" ? "red" : "amber"}>{a.risk_level} risk</Badge>
                    {a.run?.decision && <Badge tone="violet">{a.run.decision}</Badge>}
                    <Badge tone="slate">{a.run?.scenario.replace(/_/g, " ")}</Badge>
                    <Link href={`/runs/${a.run_id}`} className="mono ml-auto text-[12px] text-sky-400 hover:underline">
                      {a.run_id.slice(-9)} →
                    </Link>
                  </div>

                  <p className="mt-2.5 text-[13px] leading-relaxed text-slate-300">{a.reason}</p>

                  {a.action?.kind === "create_po" && (
                    <div className="mt-3 grid gap-x-6 gap-y-1 rounded border border-edge bg-black/20 p-3 sm:grid-cols-2">
                      <Row k="action" v="create purchase order" />
                      <Row k="supplier" v={a.action.supplier_id} />
                      <Row k="node" v={a.action.node_id} />
                      <Row k="product" v={a.action.product_id} />
                      <Row k="quantity" v={`${a.action.qty} units`} />
                      {a.action.expedite && <Row k="expedited" v="yes" />}
                      {a.action._context?.orderValue != null && (
                        <Row k="value" v={`$${Number(a.action._context.orderValue).toFixed(2)}`} />
                      )}
                    </div>
                  )}
                  {a.action?.kind === "escalation" && (
                    <div className="mt-3 rounded border border-rose-800/40 bg-rose-500/[0.05] p-3 text-[12.5px] text-rose-200/80">
                      <div className="label mb-1.5 text-rose-400/70">escalation — no autonomous path forward</div>
                      {a.action.blocking_constraints?.length > 0 && (
                        <ul className="space-y-1">
                          {a.action.blocking_constraints.map((b: string, i: number) => <li key={i}>— {b}</li>)}
                        </ul>
                      )}
                      {a.action.options_considered?.length > 0 && (
                        <>
                          <div className="label mb-1 mt-2.5 text-rose-400/70">options considered</div>
                          <ul className="space-y-1">
                            {a.action.options_considered.map((o: string, i: number) => <li key={i}>— {o}</li>)}
                          </ul>
                        </>
                      )}
                    </div>
                  )}

                  {!res && a.action?.kind !== "escalation" && (
                    <div className="mt-3 flex gap-2">
                      <button onClick={() => decide(a.id, "approve")} disabled={!!busy} className="btn btn-ok">
                        {busy === a.id ? "Executing…" : "Approve & execute"}
                      </button>
                      <button onClick={() => decide(a.id, "reject")} disabled={!!busy} className="btn btn-danger">
                        Reject
                      </button>
                    </div>
                  )}
                  {!res && a.action?.kind === "escalation" && (
                    <div className="mt-3 flex gap-2">
                      <button onClick={() => decide(a.id, "reject")} disabled={!!busy} className="btn">
                        Acknowledge & close
                      </button>
                    </div>
                  )}

                  {res && (
                    <div className="mt-3 border-t border-edge pt-3">
                      {res.action === "reject" ? (
                        <p className="text-[12.5px] text-slate-400">Rejected. No purchase was made.</p>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone="green">executed</Badge>
                            {res.drift && <DriftBadge severity={res.drift.severity} />}
                            {res.executedPoIds?.map((p: string) => <Badge key={p} tone="sky">{p}</Badge>)}
                          </div>
                          {res.drift && (
                            <p className="mt-2 text-[12.5px] leading-relaxed text-slate-300">{res.drift.summary}</p>
                          )}
                          {res.remediations?.map((r: any, i: number) => (
                            <p key={i} className="mt-1.5 text-[12.5px] leading-relaxed text-slate-400">
                              Self-correction {r.attempt}: {r.rationale}
                            </p>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {resolved.length > 0 && (
        <div className="mt-4">
          <Panel title="Resolved">
            <div className="space-y-2.5">
              {resolved.map((a) => (
                <div key={a.id} className="flex flex-wrap items-start gap-3 border-b border-edge/50 pb-2.5 text-[12.5px] last:border-0">
                  <StatusBadge status={a.status} />
                  <span className="flex-1 text-slate-400">{a.reason}</span>
                  <span className="text-slate-500">
                    {a.resolved_by}
                    {a.resolution_note ? ` — "${a.resolution_note}"` : ""}
                  </span>
                  <Link href={`/runs/${a.run_id}`} className="mono text-sky-400 hover:underline">
                    {a.run_id.slice(-9)}
                  </Link>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-[12.5px]">
      <span className="text-slate-500">{k}</span>
      <span className="mono text-slate-200">{v}</span>
    </div>
  );
}
