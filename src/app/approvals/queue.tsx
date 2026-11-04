"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Badge,
  DriftBadge,
  Empty,
  PageHeader,
  Panel,
  StatusBadge,
} from "@/components/ui";

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
  run: {
    scenario: string;
    decision: string | null;
    summary: string | null;
  } | null;
};

export default function ApprovalQueue({
  approvals,
}: {
  approvals: Approval[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Record<string, any>>({});
  const [error, setError] = useState<string | null>(null);

  const pending = approvals.filter((a) => a.status === "pending");
  const resolved = approvals.filter((a) => a.status !== "pending");

  async function decide(id: string, action: "approve" | "reject") {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/approvals/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          resolved_by: "buyer.maria",
          note: `${action}d from approval queue`,
        }),
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
        title="Approvals"
        subtitle="Review proposed purchases before execution. Approval places the order and triggers an outcome check."
        actions={
          <Badge tone={pending.length ? "amber" : "green"}>
            {pending.length
              ? `${pending.length} awaiting review`
              : "No pending approvals"}
          </Badge>
        }
      />

      {error && (
        <div
          role="alert"
          className="mb-4 panel border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
        >
          {error}
        </div>
      )}

      <Panel
        title="Pending review"
        subtitle={
          pending.length
            ? `${pending.length} ${pending.length === 1 ? "decision needs" : "decisions need"} your approval`
            : "No decisions need your attention right now"
        }
      >
        {pending.length === 0 ? (
          <Empty>
            <span className="mb-2 block text-base font-semibold text-stone-800">
              No approvals pending
            </span>
            Purchases that exceed policy limits will appear here for review.
            <Link
              href="/scenarios"
              className="mt-4 block font-medium text-emerald-800 hover:underline"
            >
              View scenarios →
            </Link>
          </Empty>
        ) : (
          <div className="space-y-3">
            {pending.map((a) => {
              const res = outcome[a.id];
              return (
                <div
                  key={a.id}
                  className="rounded-xl border border-edge bg-stone-50/70 p-5"
                  aria-busy={busy === a.id}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={a.risk_level === "high" ? "red" : "amber"}>
                      {a.risk_level} risk
                    </Badge>
                    {a.run?.decision && (
                      <Badge tone="slate">{a.run.decision}</Badge>
                    )}
                    <Badge tone="slate">
                      {a.run?.scenario.replace(/_/g, " ")}
                    </Badge>
                    <Link
                      href={`/runs/${a.run_id}`}
                      className="mono ml-auto text-[12px] text-emerald-800 hover:underline"
                    >
                      {a.run_id.slice(-9)} →
                    </Link>
                  </div>

                  <p className="mt-2.5 text-[13px] leading-relaxed text-stone-700">
                    {a.reason}
                  </p>

                  {a.action?.kind === "create_po" && (
                    <div className="mt-4 grid gap-x-6 gap-y-2 rounded-xl border border-edge bg-white p-4 sm:grid-cols-2">
                      <Row k="action" v="create purchase order" />
                      <Row k="supplier" v={a.action.supplier_id} />
                      <Row k="node" v={a.action.node_id} />
                      <Row k="product" v={a.action.product_id} />
                      <Row k="quantity" v={`${a.action.qty} units`} />
                      {a.action.expedite && <Row k="expedited" v="yes" />}
                      {a.action._context?.orderValue != null && (
                        <Row
                          k="value"
                          v={`$${Number(a.action._context.orderValue).toFixed(2)}`}
                        />
                      )}
                    </div>
                  )}
                  {a.action?.kind === "escalation" && (
                    <div className="mt-3 rounded border border-rose-200 bg-rose-50 p-3 text-[12.5px] text-rose-800">
                      <div className="label mb-1.5 text-rose-800">
                        escalation — no autonomous path forward
                      </div>
                      {a.action.blocking_constraints?.length > 0 && (
                        <ul className="space-y-1">
                          {a.action.blocking_constraints.map(
                            (b: string, i: number) => (
                              <li key={i}>— {b}</li>
                            ),
                          )}
                        </ul>
                      )}
                      {a.action.options_considered?.length > 0 && (
                        <>
                          <div className="label mb-1 mt-2.5 text-rose-800">
                            options considered
                          </div>
                          <ul className="space-y-1">
                            {a.action.options_considered.map(
                              (o: string, i: number) => (
                                <li key={i}>— {o}</li>
                              ),
                            )}
                          </ul>
                        </>
                      )}
                    </div>
                  )}

                  {!res && a.action?.kind !== "escalation" && (
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => decide(a.id, "approve")}
                        disabled={!!busy}
                        className="btn btn-ok"
                      >
                        {busy === a.id
                          ? "Saving decision…"
                          : "Approve & execute"}
                      </button>
                      <button
                        onClick={() => decide(a.id, "reject")}
                        disabled={!!busy}
                        className="btn btn-danger"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                  {!res && a.action?.kind === "escalation" && (
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => decide(a.id, "reject")}
                        disabled={!!busy}
                        className="btn"
                      >
                        Acknowledge & close
                      </button>
                    </div>
                  )}

                  {res && (
                    <div className="mt-3 border-t border-edge pt-3">
                      {res.action === "reject" ? (
                        <p className="text-[12.5px] text-stone-600">
                          Rejected. No purchase was made.
                        </p>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone="green">executed</Badge>
                            {res.drift && (
                              <DriftBadge severity={res.drift.severity} />
                            )}
                            {res.executedPoIds?.map((p: string) => (
                              <Badge key={p} tone="slate">
                                {p}
                              </Badge>
                            ))}
                          </div>
                          {res.drift && (
                            <p className="mt-2 text-[12.5px] leading-relaxed text-stone-700">
                              {res.drift.summary}
                            </p>
                          )}
                          {res.remediations?.map((r: any, i: number) => (
                            <p
                              key={i}
                              className="mt-1.5 text-[12.5px] leading-relaxed text-stone-600"
                            >
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
          <Panel
            title="Decision history"
            subtitle="Previous approvals and rejections, linked to their agent runs."
          >
            <div className="space-y-2.5">
              {resolved.map((a) => (
                <div
                  key={a.id}
                  className="flex flex-wrap items-start gap-3 border-b border-edge/50 pb-2.5 text-[12.5px] last:border-0"
                >
                  <StatusBadge status={a.status} />
                  <span className="flex-1 text-stone-600">{a.reason}</span>
                  <span className="text-stone-500">
                    {a.resolved_by}
                    {a.resolution_note ? ` — "${a.resolution_note}"` : ""}
                  </span>
                  <Link
                    href={`/runs/${a.run_id}`}
                    className="mono text-emerald-800 hover:underline"
                  >
                    {a.run_id.slice(-9)}
                  </Link>
                  {outcome[a.id] && (
                    <div
                      role="status"
                      className="basis-full rounded-xl bg-stone-50 p-3 text-sm text-emerald-900"
                    >
                      {outcome[a.id].action === "reject"
                        ? "Decision saved. No purchase was made."
                        : "Approval saved. The order has been processed."}
                      {outcome[a.id].drift?.summary && (
                        <p className="mt-1 leading-relaxed">
                          {outcome[a.id].drift.summary}
                        </p>
                      )}
                    </div>
                  )}
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
      <span className="text-stone-500">{k}</span>
      <span className="mono min-w-0 break-words text-right text-stone-800">
        {v}
      </span>
    </div>
  );
}
