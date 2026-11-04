"use client";

import { useState } from "react";
import { Badge, Empty, PageHeader, Panel, Stat } from "@/components/ui";

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
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Evaluation"
        subtitle="Check decisions, constraints, and recorded outcomes against the evaluation cases."
        actions={
          <div className="flex items-center gap-2">
            <select
              aria-label="Evaluation reasoning mode"
              value={mode}
              disabled={busy}
              onChange={(e) => setMode(e.target.value as typeof mode)}
              className="min-h-11 rounded-xl border border-edge bg-white px-3 py-2 text-sm text-stone-800"
            >
              <option value="deterministic">Rules-based</option>
              <option value="llm" disabled={provider === "none"}>
                LLM ({provider})
              </option>
            </select>
            <button onClick={run} disabled={busy} className="btn btn-primary">
              {busy ? "Running checks…" : "Run evaluation"}
            </button>
          </div>
        }
      />

      <div className="mb-5 panel border-orange-200 bg-orange-50 p-4 text-sm leading-relaxed text-amber-900">
        <strong>Evaluation resets demo data.</strong> Running an evaluation
        resets the demo data for each case. Orders and decisions from your
        current scenarios will be replaced.
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 panel border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
        >
          {error}
        </div>
      )}

      {busy && (
        <p role="status" className="mb-4 text-sm font-medium text-emerald-800">
          Checking decisions and outcomes. Your report will update when the
          evaluation is complete.
        </p>
      )}

      {!report || report.total === 0 ? (
        <Panel>
          <Empty>
            <span className="mb-2 block text-base font-semibold text-stone-800">
              No evaluation results
            </span>
            Run an evaluation to view case results and failed checks.
          </Empty>
        </Panel>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Cases passed"
              value={`${report.passed}/${report.total}`}
              tone={report.passed === report.total ? "good" : "bad"}
            />
            <Stat
              label="Individual checks"
              value={`${report.passedChecks}/${report.totalChecks}`}
              tone={report.passedChecks === report.totalChecks ? "good" : "bad"}
            />
            <Stat
              label="Reasoning"
              value={
                report.mode === "deterministic" ? "Rules-based" : report.mode
              }
              hint="the reasoning used for this report"
            />
            {/* ISO slices rather than toLocaleString: locale formatting differs
                between the server and the browser and breaks hydration. */}
            <Stat
              label="Generated"
              value={
                report.generatedAt
                  ? `${report.generatedAt.slice(11, 19)} UTC`
                  : "—"
              }
              hint={
                report.generatedAt ? report.generatedAt.slice(0, 10) : undefined
              }
            />
          </div>

          <div className="mt-4">
            <Panel
              title="Evaluation criteria"
              subtitle="Six checks applied across the purchasing workflow."
            >
              <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
                {QUESTIONS.map(([q, a]) => (
                  <div
                    key={q}
                    className="flex flex-col gap-1 border-b border-edge/50 py-3 text-sm last:border-0"
                  >
                    <span className="text-stone-700">{q}</span>
                    <span className="text-xs text-stone-500">{a}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <div className="mt-4 space-y-3">
            {report.results.map((r) => (
              <div
                key={r.id}
                className={`panel p-5 ${r.passed ? "border-emerald-200" : "border-rose-200"}`}
              >
                <div className="flex flex-wrap items-center gap-2.5">
                  <Badge tone={r.passed ? "green" : "red"}>
                    {r.passed ? "PASS" : "FAIL"}
                  </Badge>
                  <h3 className="text-[14px] font-medium text-stone-900">
                    {r.title}
                  </h3>
                  <span className="mono ml-auto text-[11px] text-stone-600">
                    {r.durationMs}ms
                  </span>
                </div>
                <p className="mt-1 text-[11.5px] text-stone-500">
                  {r.scenario} · {r.id}
                </p>

                <p className="mt-3 border-l-2 border-stone-200 pl-3 text-[12.5px] leading-relaxed text-stone-600">
                  {r.why}
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
                  <Badge tone="slate">{r.decision}</Badge>
                  {r.qty > 0 && (
                    <span className="mono text-stone-700">{r.qty} units</span>
                  )}
                  <span className="text-stone-500">status {r.status}</span>
                  <span className="text-stone-500">
                    confidence {(r.confidence * 100).toFixed(0)}%
                  </span>
                </div>

                <div className="mt-3 grid gap-x-6 gap-y-1 border-t border-edge pt-3 lg:grid-cols-2">
                  {r.checks.map((c, i) => (
                    <div key={i} className="flex items-start gap-2 text-[12px]">
                      <span
                        className={`mt-0.5 shrink-0 ${c.passed ? "text-emerald-700" : "text-rose-700"}`}
                      >
                        {c.passed ? "✓" : "✗"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-stone-600">
                          {c.name}
                        </span>
                        <span className="text-stone-500">{c.detail}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
