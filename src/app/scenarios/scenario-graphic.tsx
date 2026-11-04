"use client";

import Link from "next/link";
import { useId } from "react";
import { Icon } from "@/components/icons";
import { StatusBadge, moneyPrecise } from "@/components/ui";
import "./scenario-graphic.css";

const NUMBER = new Intl.NumberFormat("en-US");

function ComparisonBars({
  rows,
  maximum,
  ratio = false,
}: {
  rows: {
    label: string;
    value: number;
    tone: "paper" | "lime" | "ink";
    suffix?: string;
  }[];
  maximum: number;
  ratio?: boolean;
}) {
  return (
    <div className="case-comparison-bars">
      {rows.map((row) => (
        <div className="case-comparison-row" key={row.label}>
          <div className="case-comparison-label">
            <span>{row.label}</span>
            <strong>
              {ratio ? row.value : NUMBER.format(row.value)}
              {row.suffix ?? " units"}
            </strong>
          </div>
          <div className="case-comparison-track" aria-hidden="true">
            <span
              className={`is-${row.tone}`}
              style={{
                width: `${Math.max(0, Math.min(100, (row.value / maximum) * 100))}%`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ScenarioGraphic({ caseId }: { caseId: string }) {
  const headingId = useId();
  if (
    !["s1-over", "s1-correct", "s2", "s3-real", "s3-promo", "s4"].includes(
      caseId,
    )
  )
    return null;
  const supplier = caseId === "s2";
  const demand = caseId === "s3-real";
  const promotion = caseId === "s3-promo";
  const capacity = caseId === "s4";
  const correct = caseId === "s1-correct";
  const number = supplier
    ? "250"
    : demand
      ? "2.9×"
      : promotion
        ? "1.6×"
        : capacity
          ? "700"
          : correct
            ? "500"
            : "800";
  const label = supplier
    ? "units still unconfirmed"
    : demand
      ? "the daily forecast, approximately"
      : promotion
        ? "forecast demand during the offer"
        : capacity
          ? "units beyond this site's limit"
          : "units in the recommendation";
  const caption = supplier
    ? "A partial confirmation. A whole new decision."
    : demand
      ? "Demand moved. The delivery date did not."
      : promotion
        ? "The same signal can tell a different story."
        : capacity
          ? "The need is real. So is the ceiling."
          : correct
            ? "The quantities match. The rules still matter."
            : "An incoming order changes the picture.";

  return (
    <figure
      className={`case-graphic ${supplier || promotion ? "case-graphic-peach" : "case-graphic-blue"}`}
      aria-labelledby={headingId}
    >
      <div className="case-graphic-topline">
        <span>SCENARIO INPUTS</span>
        <span className="case-graphic-coordinate">
          {supplier
            ? "SUPPLY / GAP"
            : demand || promotion
              ? "DEMAND / CONTEXT"
              : capacity
                ? "NEED / CAPACITY"
                : "PROPOSAL / EVIDENCE"}
        </span>
      </div>
      <div className="case-graphic-body">
        <div className="case-graphic-number">
          <strong>{number}</strong>
          <span>{label}</span>
        </div>
        <div className="case-graphic-diagram">
          {!supplier && !demand && !promotion && !capacity && (
            <>
              <ComparisonBars
                maximum={correct ? 500 : 800}
                rows={
                  correct
                    ? [
                        { label: "Recommended", value: 500, tone: "paper" },
                        {
                          label: "Starting requirement",
                          value: 500,
                          tone: "lime",
                        },
                      ]
                    : [
                        { label: "Recommended", value: 800, tone: "paper" },
                        { label: "Already inbound", value: 150, tone: "lime" },
                      ]
                }
              />
              <div className="case-graphic-annotation">
                <Icon name={correct ? "shield" : "orders"} size={17} />
                <span>
                  {correct
                    ? "Quantity alignment still needs a policy check."
                    : "Inbound supply belongs in the requirement calculation."}
                </span>
              </div>
            </>
          )}
          {supplier && (
            <>
              <div className="case-allocation-heading">
                <span>PO-2001</span>
                <strong>500 units ordered</strong>
              </div>
              <div className="case-allocation-strip" aria-hidden="true">
                {Array.from({ length: 10 }, (_, index) => (
                  <span
                    key={index}
                    className={index < 5 ? "is-confirmed" : "is-shortfall"}
                  />
                ))}
              </div>
              <div className="case-allocation-labels">
                <span>
                  <i className="is-confirmed" />
                  <strong>250</strong> confirmed
                </span>
                <span>
                  <i className="is-shortfall" />
                  <strong>250</strong> shortfall
                </span>
              </div>
              <div className="case-graphic-annotation">
                <Icon name="shield" size={17} />
                <span>
                  Alternate supplier: +12% premium and a reliability check.
                </span>
              </div>
            </>
          )}
          {demand && (
            <>
              <div
                className="case-demand-bars"
                aria-label="Forecast 40 units per day; observed approximately 115 units per day"
              >
                <div>
                  <strong>40</strong>
                  <span
                    className="case-demand-column is-paper"
                    style={{ height: 58 }}
                    aria-hidden="true"
                  />
                  <small>Forecast / day</small>
                </div>
                <div>
                  <strong>~115</strong>
                  <span
                    className="case-demand-column is-lime"
                    style={{ height: 166.75 }}
                    aria-hidden="true"
                  />
                  <small>Observed / day</small>
                </div>
              </div>
              <div className="case-delivery-note">
                <Icon name="orders" size={18} />
                <span>
                  <strong>600 units inbound</strong>Scheduled for day 9
                </span>
                <span className="case-delivery-marker">09</span>
              </div>
            </>
          )}
          {promotion && (
            <>
              <ComparisonBars
                ratio
                maximum={1.6}
                rows={[
                  { label: "Forecast", value: 1, suffix: "×", tone: "paper" },
                  {
                    label: "During promotion",
                    value: 1.6,
                    suffix: "×",
                    tone: "ink",
                  },
                ]}
              />
              <div className="case-promotion-clock">
                <span className="case-promotion-offer">2 FOR 1</span>
                <span>
                  <strong>3 days left</strong>Temporary offer, sustained signal.
                </span>
                <Icon name="calendar" size={26} />
              </div>
            </>
          )}
          {capacity && (
            <>
              <div className="case-allocation-heading">
                <span>Required replenishment</span>
                <strong>1,700 units</strong>
              </div>
              <div className="case-capacity-strip" aria-hidden="true">
                <span style={{ width: `${(1000 / 1700) * 100}%` }} />
                <span style={{ width: `${(700 / 1700) * 100}%` }} />
              </div>
              <div className="case-capacity-labels">
                <span>
                  <strong>1,000</strong>Site capacity
                </span>
                <span>
                  <strong>700</strong>Beyond the limit
                </span>
              </div>
              <div className="case-graphic-annotation">
                <Icon name="warehouse" size={17} />
                <span>
                  Each unit occupies 3 slots. Review a feasible split.
                </span>
              </div>
            </>
          )}
        </div>
      </div>
      <figcaption id={headingId}>
        <strong>{caption}</strong>
        <span>Starting case facts. Each run checks the current workspace.</span>
      </figcaption>
    </figure>
  );
}

type ReceiptRun = {
  runId: string;
  status: string;
  decision: string;
  confidence: number;
  summary: string;
  recommendedQty: number;
  orderValue: number;
  mode: string;
  executedPoIds: string[];
  validation: {
    passed: boolean;
    checks: { passed: boolean; severity: string }[];
    bindingConstraint: string | null;
  } | null;
  autonomy: { decision: string } | null;
  drift: { severity: string } | null;
};
type ReceiptOutcome = {
  action: "approve" | "reject";
  status?: string;
  executedPoIds?: string[];
  drift?: { severity: string } | null;
};

export function ScenarioDecisionReceipt({
  result,
  outcome,
  submittedQty,
  onOpenSection,
}: {
  result: ReceiptRun;
  outcome: ReceiptOutcome | null;
  submittedQty?: number;
  onOpenSection: (section: "decision" | "checks" | "outcome") => void;
}) {
  const headingId = useId();
  const checks = result.validation?.checks ?? [];
  const passed = checks.filter((check) => check.passed).length;
  const status =
    outcome?.status ??
    (outcome
      ? outcome.action === "reject"
        ? "rejected"
        : "approved"
      : result.status);
  const orders = outcome?.executedPoIds ?? result.executedPoIds;
  const drift = outcome?.drift ?? result.drift;
  const verification = drift
    ? `Drift: ${drift.severity}`
    : status === "awaiting_approval"
      ? "Awaiting buyer decision"
      : outcome?.action === "reject"
        ? "Buyer rejected the proposal"
        : result.decision === "NO_ACTION" && orders.length === 0
          ? "No purchase action proposed"
          : "No verification recorded";
  const comparisonMax = Math.max(submittedQty ?? 0, result.recommendedQty, 1);
  const policy =
    result.autonomy?.decision.replace(/_/g, " ") ?? "No gate recorded";

  return (
    <section className="scenario-receipt" aria-labelledby={headingId}>
      <header className="scenario-receipt-heading">
        <span>
          <Icon name="orders" size={18} /> DECISION RECEIPT
        </span>
        <StatusBadge status={status} />
      </header>
      <div className="scenario-receipt-main">
        <div className="scenario-receipt-verdict">
          <span>
            {outcome ? "Original recommendation" : "Recorded recommendation"}
          </span>
          <h3 id={headingId}>
            {result.decision.toLowerCase().replace(/_/g, " ")}
            <span>.</span>
          </h3>
          <p>{result.summary}</p>
          <div className="scenario-receipt-reference">
            <span>{result.mode}</span>
            <span>{Math.round(result.confidence * 100)}% confidence</span>
          </div>
        </div>
        <div className="scenario-receipt-quantity">
          <span>Recommended quantity</span>
          <strong>{NUMBER.format(result.recommendedQty)}</strong>
          <span>units · {moneyPrecise(result.orderValue)}</span>
          {submittedQty !== undefined && (
            <div
              className="scenario-receipt-comparison"
              aria-label={`Submitted ${submittedQty} units; recommended ${result.recommendedQty} units`}
            >
              <div>
                <span>
                  Submitted <b>{NUMBER.format(submittedQty)}</b>
                </span>
                <i
                  aria-hidden="true"
                  style={{
                    width: `${Math.max(0, (submittedQty / comparisonMax) * 100)}%`,
                  }}
                />
              </div>
              <div>
                <span>
                  Recommended <b>{NUMBER.format(result.recommendedQty)}</b>
                </span>
                <i
                  aria-hidden="true"
                  style={{
                    width: `${Math.max(0, (result.recommendedQty / comparisonMax) * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="scenario-receipt-proof">
        <button type="button" onClick={() => onOpenSection("checks")}>
          <span>Policy checks</span>
          <strong>
            {checks.length
              ? `${passed} / ${checks.length} passed`
              : "Not recorded"}
          </strong>
          <small>{policy}</small>
          <Icon name="arrow-up-right" size={18} />
        </button>
        <button type="button" onClick={() => onOpenSection("outcome")}>
          <span>Execution record</span>
          <strong>
            {orders.length} purchase {orders.length === 1 ? "order" : "orders"}
          </strong>
          <small>{verification}</small>
          <Icon name="arrow-up-right" size={18} />
        </button>
        <Link href={`/runs/${result.runId}`}>
          <span>Full evidence</span>
          <strong>Open the run trace</strong>
          <small>{result.runId}</small>
          <Icon name="arrow-up-right" size={18} />
        </Link>
      </div>
      <footer>
        <span>Returned by the purchasing agent</span>
        <span>
          {outcome
            ? `Buyer decision: ${outcome.action === "approve" ? "approved" : "rejected"}`
            : "Every figure belongs to this run."}
        </span>
      </footer>
    </section>
  );
}
