"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Badge, DecisionBadge, DriftBadge, StatusBadge } from "@/components/ui";
import { Icon } from "@/components/icons";
import "@/components/operations-workspace.css";

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
  product_name?: string;
  product_sku?: string;
  node_name?: string;
  supplier_name?: string;
  requested_qty?: number;
  requested_label?: string;
  validation_checks?: {
    code: string;
    label: string;
    passed: boolean;
    detail: string;
  }[];
  run: {
    scenario: string;
    decision: string | null;
    summary: string | null;
  } | null;
};
type Outcome = {
  action: "approve" | "reject";
  status?: string;
  executedPoIds?: string[];
  drift?: { severity: string; summary: string } | null;
  remediations?: {
    attempt: number;
    rationale: string;
    poId?: string | null;
    ok?: boolean;
  }[];
};
const currency = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
const isEscalation = (approval: Approval) =>
  approval.action?.kind === "escalation";

export default function ApprovalQueue({
  approvals,
}: {
  approvals: Approval[];
}) {
  const router = useRouter();
  const operationInFlight = useRef(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [latestId, setLatestId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<{ id: string; message: string } | null>(
    null,
  );
  const [filter, setFilter] = useState("all");
  const pending = approvals.filter(
    (a) => a.status === "pending" && !outcomes[a.id],
  );
  const resolved = approvals.filter(
    (a) => a.status !== "pending" || outcomes[a.id],
  );
  const escalations = pending.filter(isEscalation);
  const shown = pending.filter(
    (a) =>
      filter === "all" ||
      (filter === "escalations" ? isEscalation(a) : !isEscalation(a)),
  );
  const listedValue = pending.reduce(
    (total, a) => total + (Number(a.action?._context?.orderValue) || 0),
    0,
  );
  const latestApproval = approvals.find((a) => a.id === latestId);
  const latestOutcome = latestId ? outcomes[latestId] : undefined;

  async function decide(id: string, action: "approve" | "reject") {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/approvals/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          resolved_by: "buyer.maria",
          note:
            notes[id]?.trim() ||
            `${action === "approve" ? "Approved" : "Rejected"} from approval queue`,
        }),
      });
      const json = await res.json();
      if (!res.ok)
        throw new Error(
          json.error ?? "The decision could not be saved. Try again.",
        );
      setOutcomes((current) => ({ ...current, [id]: { action, ...json } }));
      setLatestId(id);
      router.refresh();
    } catch (e) {
      setError({
        id,
        message:
          e instanceof Error ? e.message : "The decision could not be saved.",
      });
    } finally {
      operationInFlight.current = false;
      setBusy(null);
    }
  }

  return (
    <div className="ops-workspace ops-approvals">
      <header className="ops-page-header">
        <div>
          <span className="ops-eyebrow">Decision ledger / Human review</span>
          <h1>
            Your call<span>.</span>
          </h1>
          <p>Every purchase has a reason. Give the next one your sign-off.</p>
        </div>
        <Link href="/runs" className="ops-button ops-button-secondary">
          <Icon name="activity" size={17} /> View agent runs
        </Link>
      </header>

      {latestOutcome && latestApproval && (
        <section
          className="ops-outcome"
          role={latestOutcome.status === "failed" ? "alert" : "status"}
        >
          <div className="ops-inline">
            <StatusBadge
              status={
                latestOutcome.status ??
                (latestOutcome.action === "reject" ? "rejected" : "approved")
              }
            />
            {latestOutcome.drift && (
              <DriftBadge severity={latestOutcome.drift.severity} />
            )}
            <button
              type="button"
              className="ops-link ops-dismiss"
              onClick={() => setLatestId(null)}
            >
              Dismiss
            </button>
          </div>
          <p>
            {latestOutcome.action === "reject"
              ? "Decision saved. No purchase was made."
              : approvalOutcomeMessage(latestOutcome)}
          </p>
          {latestOutcome.drift && <p>{latestOutcome.drift.summary}</p>}
          {latestOutcome.executedPoIds?.length ? (
            <div className="ops-inline">
              <span className="ops-secondary">Purchase orders</span>
              {latestOutcome.executedPoIds.map((id) => (
                <Badge key={id} tone="slate">
                  {id}
                </Badge>
              ))}
            </div>
          ) : null}
          {latestOutcome.remediations?.map((r) => (
            <p key={r.attempt}>
              Self-correction {r.attempt}
              {r.ok === true
                ? " · order created"
                : r.ok === false
                  ? " · attempt failed"
                  : ""}
              {r.poId ? ` · ${r.poId}` : ""}: {r.rationale}
            </p>
          ))}
          <Link className="ops-link" href={`/runs/${latestApproval.run_id}`}>
            Review execution and checks <Icon name="arrow" size={15} />
          </Link>
        </section>
      )}

      <div className="ops-review-layout">
        <section className="ops-review-main" aria-labelledby="pending-heading">
          <div className="ops-section-heading">
            <div>
              <h2 id="pending-heading">
                Approvals <span>{pending.length}</span>
              </h2>
              <p>Each proposal stays on hold until you decide.</p>
            </div>
          </div>
          {pending.length > 0 && (
            <div
              className="ops-filter-tabs"
              role="group"
              aria-label="Filter pending approvals"
            >
              {[
                { value: "all", label: "All decisions", count: pending.length },
                {
                  value: "purchases",
                  label: "Purchase requests",
                  count: pending.length - escalations.length,
                },
                {
                  value: "escalations",
                  label: "Escalations",
                  count: escalations.length,
                },
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={filter === item.value}
                  onClick={() => setFilter(item.value)}
                >
                  {item.label}
                  <span>{item.count}</span>
                </button>
              ))}
            </div>
          )}
          {shown.length === 0 ? (
            <div
              className={`ops-empty ${pending.length === 0 ? "ops-queue-clear" : ""}`}
            >
              <span className="ops-empty-symbol">
                <Icon name={pending.length ? "search" : "check"} size={29} />
              </span>
              <h3>
                {pending.length
                  ? "No decisions in this category"
                  : "Your approval queue is clear"}
              </h3>
              <p>
                {pending.length
                  ? "Choose another category to review the remaining decisions."
                  : "Purchases that exceed policy limits appear here with their evidence and proposed action. Run a scenario to review the complete workflow."}
              </p>
              {pending.length ? (
                <button
                  className="ops-button ops-button-secondary"
                  onClick={() => setFilter("all")}
                >
                  Show all decisions
                </button>
              ) : (
                <Link
                  href="/scenarios"
                  className="ops-button ops-button-primary"
                >
                  Explore purchasing scenarios <Icon name="arrow" size={16} />
                </Link>
              )}
            </div>
          ) : (
            <div className="ops-decision-list">
              {shown.map((a, index) => (
                <article
                  key={a.id}
                  className="ops-decision-card"
                  aria-busy={busy === a.id}
                >
                  <div className="ops-receipt-reference">
                    <span>
                      Purchase proposal / {String(index + 1).padStart(2, "0")}
                    </span>
                    <span>{a.id}</span>
                  </div>
                  <div className="ops-decision-top">
                    <div className="ops-inline">
                      <Badge
                        tone={
                          a.risk_level === "high"
                            ? "red"
                            : a.risk_level === "low"
                              ? "slate"
                              : "amber"
                        }
                      >
                        {a.risk_level} risk
                      </Badge>
                      {a.run?.decision && (
                        <DecisionBadge decision={a.run.decision} />
                      )}
                      {a.action?.expedite && (
                        <Badge tone="sky">Expedited</Badge>
                      )}
                    </div>
                    <span className="ops-date">
                      Requested {a.requested_at.slice(0, 16).replace("T", " ")}{" "}
                      UTC
                    </span>
                  </div>
                  <div className="ops-decision-title">
                    <div>
                      <h3>
                        {isEscalation(a)
                          ? "A purchasing constraint needs your review"
                          : (a.product_name ??
                            a.action?.product_id ??
                            "Review purchasing proposal")}
                      </h3>
                      <p>
                        {a.node_name ??
                          a.action?.node_id ??
                          a.run?.scenario.replace(/_/g, " ")}
                        {a.supplier_name || a.action?.supplier_id
                          ? ` · ${a.supplier_name ?? a.action.supplier_id}`
                          : ""}
                      </p>
                    </div>
                  </div>
                  {a.action?.kind === "create_po" && (
                    <ProposalReceipt approval={a} />
                  )}
                  <div className="ops-review-reason">
                    <Icon name="shield" size={18} />
                    <div>
                      <span>Why your review is needed</span>
                      <p>{a.reason}</p>
                    </div>
                  </div>
                  {!!a.validation_checks?.length && (
                    <div
                      className="ops-receipt-checks"
                      aria-label="Recorded pre-purchase checks"
                    >
                      {a.validation_checks
                        .filter((check) =>
                          ["BUDGET", "STORAGE", "MOQ", "LOT_SIZE"].includes(
                            check.code,
                          ),
                        )
                        .map((check) => (
                          <details key={check.code}>
                            <summary>
                              <span
                                className={
                                  check.passed ? "is-passed" : "is-failed"
                                }
                              >
                                {check.passed ? "✓" : "!"}
                              </span>
                              {check.label}
                              <Icon name="chevron" size={14} />
                            </summary>
                            <p>{check.detail}</p>
                          </details>
                        ))}
                    </div>
                  )}
                  {isEscalation(a) && (
                    <div className="ops-escalation-details">
                      {a.action.blocking_constraints?.length > 0 && (
                        <>
                          <h4>Blocking constraints</h4>
                          <ul>
                            {a.action.blocking_constraints.map(
                              (text: string, i: number) => (
                                <li key={i}>{text}</li>
                              ),
                            )}
                          </ul>
                        </>
                      )}
                      {a.action.options_considered?.length > 0 && (
                        <>
                          <h4>Options considered</h4>
                          <ul>
                            {a.action.options_considered.map(
                              (text: string, i: number) => (
                                <li key={i}>{text}</li>
                              ),
                            )}
                          </ul>
                        </>
                      )}
                    </div>
                  )}
                  <details className="ops-evidence">
                    <summary>
                      <Icon name="chevron" size={16} /> Proposal & supporting
                      details
                    </summary>
                    <div>
                      {a.run?.summary && <p>{a.run.summary}</p>}
                      <p className="ops-secondary">
                        Saved action, including any follow-up purchases
                      </p>
                      <pre>{JSON.stringify(a.action, null, 2)}</pre>
                      <Link className="ops-link" href={`/runs/${a.run_id}`}>
                        Open the complete evidence trail{" "}
                        <Icon name="arrow" size={15} />
                      </Link>
                    </div>
                  </details>
                  <div className="ops-decision-footer">
                    <div className="ops-decision-note">
                      <label htmlFor={`note-${a.id}`}>
                        Decision note <span>optional</span>
                      </label>
                      <input
                        id={`note-${a.id}`}
                        value={notes[a.id] ?? ""}
                        onChange={(event) =>
                          setNotes((current) => ({
                            ...current,
                            [a.id]: event.target.value,
                          }))
                        }
                        placeholder="Add context for the audit trail"
                        maxLength={1000}
                        disabled={!!busy}
                      />
                    </div>
                    <div className="ops-decision-actions">
                      {isEscalation(a) ? (
                        <button
                          type="button"
                          className="ops-button ops-button-secondary"
                          disabled={!!busy}
                          onClick={() => decide(a.id, "reject")}
                        >
                          {busy === a.id ? "Saving…" : "Acknowledge & close"}
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="ops-button ops-button-reject"
                            disabled={!!busy}
                            onClick={() => decide(a.id, "reject")}
                          >
                            Reject
                          </button>
                          <button
                            type="button"
                            className="ops-button ops-button-primary"
                            disabled={!!busy}
                            onClick={() => decide(a.id, "approve")}
                          >
                            {busy === a.id
                              ? "Processing decision…"
                              : "Approve & execute"}
                            <Icon name="arrow" size={16} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {error?.id === a.id && (
                    <p className="ops-error" role="alert">
                      {error.message}
                    </p>
                  )}
                  <Link
                    href={`/runs/${a.run_id}`}
                    className="ops-card-trace ops-link"
                  >
                    Review run {a.run_id.slice(-9)}{" "}
                    <Icon name="arrow-up-right" size={14} />
                  </Link>
                </article>
              ))}
            </div>
          )}
        </section>
        <aside
          className="ops-review-guide"
          aria-labelledby="review-guide-heading"
        >
          <span className="ops-eyebrow">In the approval ledger</span>
          <strong className="ops-ledger-value">{currency(listedValue)}</strong>
          <p className="ops-ledger-caption">
            Recorded value of primary purchase proposals. Follow-up orders
            remain in the saved action.
          </p>
          <div className="ops-ledger-rule" />
          <div className="ops-ledger-escalations">
            <strong>{String(escalations.length).padStart(2, "0")}</strong>
            <span>
              escalations requiring
              <br />a buyer decision
            </span>
          </div>
          <h2 id="review-guide-heading">The decision is yours.</h2>
          <p>
            Approval resumes the saved proposal, then checks what the supplier
            actually confirmed.
          </p>
          <ol>
            <li>
              <span>01</span>
              <div>
                <strong>Check the proposal</strong>
                <p>
                  Review quantity, cost, supplier and the reason it was held.
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>Make your decision</strong>
                <p>
                  Approve to execute, or reject to close without a purchase.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>Review the outcome</strong>
                <p>
                  Follow the run to see confirmations, drift and corrective
                  actions.
                </p>
              </div>
            </li>
          </ol>
          <Link className="ops-link" href="/purchase-orders">
            See purchase orders <Icon name="arrow" size={15} />
          </Link>
        </aside>
      </div>

      <section className="ops-history" aria-labelledby="history-heading">
        <div className="ops-section-heading">
          <div>
            <h2 id="history-heading">
              Decision history <span>{resolved.length}</span>
            </h2>
            <p>Previous decisions and the evidence behind them.</p>
          </div>
        </div>
        {resolved.length === 0 ? (
          <p className="ops-history-empty">
            Your completed reviews will appear here.
          </p>
        ) : (
          <div className="ops-history-list">
            {resolved.map((a) => (
              <details key={a.id} className="ops-history-row">
                <summary>
                  <Icon name="chevron" size={16} />
                  <StatusBadge
                    status={
                      outcomes[a.id]
                        ? outcomes[a.id].action === "reject"
                          ? "rejected"
                          : "approved"
                        : a.status
                    }
                  />
                  <div>
                    <strong>
                      {a.product_name ??
                        a.run?.scenario.replace(/_/g, " ") ??
                        "Purchasing decision"}
                    </strong>
                    <span>{a.reason}</span>
                  </div>
                  <small>
                    {a.resolved_by ?? (outcomes[a.id] ? "buyer.maria" : "—")}
                  </small>
                </summary>
                <div className="ops-history-detail">
                  <p>{a.reason}</p>
                  {a.resolution_note && (
                    <p>Decision note: {a.resolution_note}</p>
                  )}
                  {outcomes[a.id] && (
                    <p>
                      {outcomes[a.id].action === "reject"
                        ? "Decision saved. No purchase was made."
                        : approvalOutcomeMessage(outcomes[a.id])}
                    </p>
                  )}
                  <Link href={`/runs/${a.run_id}`} className="ops-link">
                    Review run {a.run_id.slice(-9)}{" "}
                    <Icon name="arrow-up-right" size={15} />
                  </Link>
                </div>
              </details>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function approvalOutcomeMessage(result: Outcome) {
  if (result.status === "escalated")
    return "Approval saved. The run needs further buyer review; open its trace for the outcome.";
  if (result.status === "failed")
    return "Approval saved, but execution failed. Open the run trace to review the failure.";
  if (result.status === "completed") {
    const count = result.executedPoIds?.length ?? 0;
    return count
      ? `Approval saved. ${count} purchase ${count === 1 ? "order was" : "orders were"} processed. Review the outcome checks below.`
      : "Approval saved. The run completed without reporting a processed purchase order; open its trace for details.";
  }
  return "Approval saved. Open the run trace to review its execution status.";
}

function ProposalReceipt({ approval }: { approval: Approval }) {
  const proposed =
    typeof approval.action.qty === "number" &&
    Number.isFinite(approval.action.qty) &&
    approval.action.qty >= 0
      ? approval.action.qty
      : null;
  const original =
    typeof approval.requested_qty === "number" &&
    Number.isFinite(approval.requested_qty) &&
    approval.requested_qty >= 0
      ? approval.requested_qty
      : null;
  const compared = original !== null && proposed !== null;
  const difference = compared ? proposed - original : 0;
  const scale = Math.max(1, original ?? 0, proposed ?? 0);
  const value = approval.action._context?.orderValue;
  const followUps: any[] = Array.isArray(approval.action._context?.followUps)
    ? approval.action._context.followUps
    : [];
  const additionalPurchases = followUps.filter(
    (action) => action?.kind === "create_po",
  );
  const hasAdditionalPurchases = additionalPurchases.length > 0;
  return (
    <div className={`ops-proposal-receipt ${compared ? "has-comparison" : ""}`}>
      <div className="ops-quantity-story">
        {compared ? (
          <>
            <div className="ops-quantity-comparison">
              <div>
                <span>{approval.requested_label ?? "Requested quantity"}</span>
                <strong>{original.toLocaleString("en-US")}</strong>
                <small>units</small>
              </div>
              <Icon name="arrow" size={32} />
              <div className="is-proposed">
                <span>
                  {hasAdditionalPurchases
                    ? "Primary purchase"
                    : "Pip's proposal"}
                </span>
                <strong>{proposed.toLocaleString("en-US")}</strong>
                <small>units</small>
              </div>
            </div>
            <div className="ops-quantity-bars" aria-hidden="true">
              <div>
                <i style={{ width: `${(original / scale) * 100}%` }} />
              </div>
              <div>
                <i style={{ width: `${(proposed / scale) * 100}%` }} />
              </div>
            </div>
            <p className="ops-quantity-change">
              {difference === 0
                ? "The quantity holds. Review the purchasing checks."
                : `${Math.abs(difference).toLocaleString("en-US")} ${difference < 0 ? "fewer" : "additional"} units${hasAdditionalPurchases ? " in this primary purchase" : original > 0 ? ` · ${Math.round((Math.abs(difference) / original) * 100)}% ${difference < 0 ? "reduction" : "increase"}` : ""}`}
            </p>
          </>
        ) : (
          <>
            <span className="ops-eyebrow">
              {hasAdditionalPurchases
                ? "Primary proposed purchase"
                : "Pip's proposed purchase"}
            </span>
            <div className="ops-single-quantity">
              <strong>
                {proposed === null ? "—" : proposed.toLocaleString("en-US")}
              </strong>
              <span>units</span>
            </div>
            <p className="ops-quantity-change">
              Original requested quantity not recorded for this case.
            </p>
          </>
        )}
        {hasAdditionalPurchases && (
          <div className="ops-split-purchase-note">
            <strong>A split purchase plan</strong>
            <p>
              The figures above cover the primary purchase only. The saved plan
              also includes:
            </p>
            <ul>
              {additionalPurchases.map((action, index) => (
                <li key={index}>
                  {typeof action.qty === "number" &&
                  Number.isFinite(action.qty) &&
                  action.qty >= 0
                    ? `${action.qty.toLocaleString("en-US")} units`
                    : "An additional purchase"}
                  {typeof action.node_id === "string"
                    ? ` at ${action.node_id}`
                    : ""}
                  {typeof action.product_id === "string" &&
                  action.product_id !== approval.action.product_id
                    ? ` · ${action.product_id}`
                    : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="ops-receipt-value">
        <span>
          {hasAdditionalPurchases
            ? "Primary value / USD"
            : "Purchase value / USD"}
        </span>
        <strong>
          {value != null && Number.isFinite(Number(value))
            ? currency(Number(value))
            : "Not recorded"}
        </strong>
        <div>
          <span>Product reference</span>
          <b>{approval.product_sku ?? approval.action.product_id}</b>
        </div>
        <div>
          <span>Planned demand</span>
          <b>
            {approval.action._context?.dailyDemand != null
              ? `${approval.action._context.dailyDemand} units / day`
              : "See evidence"}
          </b>
        </div>
      </div>
    </div>
  );
}
