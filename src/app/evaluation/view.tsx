"use client";

import { useState } from "react";
import {
  Badge,
  DecisionBadge,
  Empty,
  PageHeader,
  Panel,
  StatusBadge,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import "@/components/workflow-pages.css";
import { PurchasingSelect } from "@/components/purchasing-select";

type CheckResult = { name: string; passed: boolean; detail: string };
type CaseResult = {
  id: string;
  title: string;
  scenario: string;
  passed: boolean;
  checks: CheckResult[];
  decision: string;
  qty: number;
  status: string;
  confidence: number;
  summary: string;
  why: string;
  durationMs: number;
};
type Report = {
  mode: string;
  results: CaseResult[];
  passed: number;
  total: number;
  totalChecks: number;
  passedChecks: number;
  generatedAt: string | null;
};

const QUESTIONS = [
  ["Was the decision correct?", "decision, quantity, supplier"],
  ["Did it obtain the necessary information?", "evidence gathered"],
  [
    "Did it respect relevant constraints?",
    "constraints respected, soft warnings surfaced",
  ],
  ["Did it take the appropriate action?", "autonomy routing, final status"],
  [
    "Did it validate the result?",
    "pre-flight validation, post-execution validation",
  ],
  [
    "What happens when the action does not work?",
    "drift classification, self-correction",
  ],
];

export default function EvaluationView({
  initial,
  provider,
}: {
  initial: Report | null;
  provider: string;
}) {
  const [report, setReport] = useState<Report | null>(initial);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"all" | "failed" | "passed">("all");
  const [mode, setMode] = useState<"deterministic" | "llm">("deterministic");
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/evaluation?mode=${mode}`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Evaluation failed.");
      setReport(json);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Evaluation could not be completed.",
      );
    } finally {
      setBusy(false);
    }
  }

  const results = [...(report?.results ?? [])].sort(
    (a, b) => Number(a.passed) - Number(b.passed),
  );
  const failed = results.filter((item) => !item.passed).length;
  const shown = results.filter(
    (item) =>
      filter === "all" || (filter === "passed" ? item.passed : !item.passed),
  );

  return (
    <div className="workflow-page workflow-evaluation">
      <div className="workflow-kicker">TOOLS / QUALITY</div>
      <PageHeader
        title="Agent evaluation"
        subtitle="Check the quality of a purchasing decision, from evidence through execution."
        actions={
          <div className="workflow-evaluation-controls">
            <PurchasingSelect
              label="Evaluation reasoning mode"
              value={mode}
              disabled={busy}
              onChange={(value) => setMode(value as typeof mode)}
              options={[
                { value: "deterministic", label: "Rules-based" },
                {
                  value: "llm",
                  label: `LLM (${provider})`,
                  disabled: provider === "none",
                },
              ]}
            />
            <button
              type="button"
              onClick={run}
              disabled={busy}
              className="btn btn-primary"
            >
              <Icon name="chart" size={17} />
              {busy ? "Running checks…" : "Run evaluation"}
            </button>
          </div>
        }
      />
      <div className="workflow-evaluation-notice">
        <Icon name="shield" size={20} />
        <div>
          <strong>Running evaluation replaces the current demo data.</strong>
          <p>
            Each case starts from a reset dataset. Orders and decisions from
            your current scenarios will be replaced.
          </p>
        </div>
      </div>
      {error && (
        <div role="alert" className="workflow-feedback" data-tone="error">
          <strong>Evaluation could not be completed</strong>
          <p>{error}</p>
        </div>
      )}
      {busy && (
        <div role="status" className="workflow-evaluation-progress">
          <Icon name="activity" size={18} />
          <span>
            Checking decisions, constraints and outcomes. The report will update
            when the evaluation finishes.
          </span>
        </div>
      )}
      {!report || report.total === 0 ? (
        <Panel>
          <Empty>
            <strong className="workflow-empty-title">
              Ready for the first evaluation
            </strong>
            <p>
              Choose a reasoning mode and run the cases to see passed checks,
              failed expectations and decision evidence.
            </p>
            <span className="workflow-empty-note">
              Review the reset notice above before starting.
            </span>
          </Empty>
        </Panel>
      ) : (
        <>
          <dl
            className="workflow-summary"
            aria-label="Evaluation summary"
            aria-busy={busy}
          >
            <div data-tone={report.passed === report.total ? "blue" : "peach"}>
              <dt>Cases passed</dt>
              <dd>
                {report.passed}
                <span className="workflow-denominator"> / {report.total}</span>
                <small>
                  {failed
                    ? `${failed} ${failed === 1 ? "case needs" : "cases need"} attention`
                    : "All recorded cases passed"}
                </small>
              </dd>
            </div>
            <div>
              <dt>Checks passed</dt>
              <dd>
                {report.passedChecks}
                <span className="workflow-denominator">
                  {" "}
                  / {report.totalChecks}
                </span>
                <small>Assertions across all cases</small>
              </dd>
            </div>
            <div>
              <dt>Report reasoning</dt>
              <dd className="workflow-summary-text">
                {report.mode === "deterministic" ? "Rules-based" : report.mode}
                <small>Mode used for this report</small>
              </dd>
            </div>
            <div>
              <dt>Last generated</dt>
              <dd className="workflow-summary-text">
                {report.generatedAt
                  ? `${report.generatedAt.slice(11, 19)} UTC`
                  : "Not recorded"}
                <small>
                  {report.generatedAt?.slice(0, 10) ?? "No timestamp available"}
                </small>
              </dd>
            </div>
          </dl>
          <section
            aria-labelledby="evaluation-results-heading"
            aria-busy={busy}
          >
            <div className="workflow-section-heading">
              <div>
                <h2 id="evaluation-results-heading">Case results</h2>
                <p>
                  {failed
                    ? "Cases needing attention appear first, with their checks expanded."
                    : "Open a case to review the decision and each supporting check."}
                </p>
              </div>
              <div
                className="workflow-priority"
                role="group"
                aria-label="Filter evaluation cases"
              >
                {(
                  [
                    { value: "all", label: `All cases ${results.length}` },
                    { value: "failed", label: `Needs attention ${failed}` },
                    {
                      value: "passed",
                      label: `Passed ${results.length - failed}`,
                    },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    aria-pressed={filter === item.value}
                    onClick={() => setFilter(item.value)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            {shown.length === 0 && (
              <Panel>
                <Empty>
                  <strong className="workflow-empty-title">
                    No cases in this view
                  </strong>
                  <p>Choose another filter to review the recorded results.</p>
                  <button
                    type="button"
                    className="btn workflow-empty-action"
                    onClick={() => setFilter("all")}
                  >
                    View all cases
                  </button>
                </Empty>
              </Panel>
            )}
            <div className="workflow-case-list">
              {shown.map((result) => (
                <details
                  key={result.id}
                  className="workflow-case"
                  data-passed={result.passed}
                  open={!result.passed}
                >
                  <summary>
                    <span className="workflow-case-indicator">
                      <Icon name={result.passed ? "check" : "bell"} size={20} />
                    </span>
                    <span className="workflow-case-heading">
                      <strong>{result.title}</strong>
                      <small>
                        {result.scenario.replace(/_/g, " ")} · {result.id}
                      </small>
                    </span>
                    <Badge tone={result.passed ? "green" : "red"}>
                      {result.passed ? "Passed" : "Needs attention"}
                    </Badge>
                    <span className="workflow-case-check-count">
                      {result.checks.filter((check) => check.passed).length}/
                      {result.checks.length} checks
                    </span>
                    <span className="workflow-case-duration">
                      {result.durationMs.toLocaleString("en-US")} ms
                    </span>
                    <Icon name="chevron" size={17} />
                  </summary>
                  <div className="workflow-case-body">
                    <div className="workflow-case-context">
                      <p>{result.why}</p>
                      {result.summary && result.summary !== result.why && (
                        <p className="workflow-case-summary">
                          {result.summary}
                        </p>
                      )}
                      <div className="workflow-case-outcome">
                        <DecisionBadge decision={result.decision} />
                        <StatusBadge status={result.status} />
                        {result.qty > 0 && (
                          <span>
                            {result.qty.toLocaleString("en-US")} units
                          </span>
                        )}
                        <span>
                          {(result.confidence * 100).toFixed(0)}% confidence
                        </span>
                      </div>
                    </div>
                    <div className="workflow-checks">
                      {[...result.checks]
                        .sort((a, b) => Number(a.passed) - Number(b.passed))
                        .map((check, index) => (
                          <div
                            className="workflow-check"
                            key={index}
                            data-passed={check.passed}
                          >
                            <span
                              className="workflow-check-symbol"
                              aria-label={check.passed ? "Passed" : "Failed"}
                            >
                              {check.passed ? "✓" : "×"}
                            </span>
                            <div>
                              <strong>{check.name}</strong>
                              <p>{check.detail}</p>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                </details>
              ))}
            </div>
          </section>
        </>
      )}
      <details className="workflow-reference">
        <summary>
          <span>
            <Icon name="shield" size={18} />
            What the evaluation checks
          </span>
          <span>
            6 criteria
            <Icon name="chevron" size={16} />
          </span>
        </summary>
        <div className="workflow-criteria-grid">
          {QUESTIONS.map(([question, detail], index) => (
            <div key={question}>
              <span>0{index + 1}</span>
              <div>
                <h3>{question}</h3>
                <p>{detail}</p>
              </div>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
