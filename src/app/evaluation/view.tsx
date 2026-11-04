"use client";

import { useState } from "react";
import { Badge, Empty, PageHeader, Panel, Stat } from "@/components/ui";

type CheckResult = { name: string; passed: boolean; detail: string };
type CaseResult = {
  id: string; title: string; scenario: string; passed: boolean;
  checks: CheckResult[]; decision: string; qty: number; status: string;
  confidence: number; summary: string; why: string; durationMs: number;
};
type Report = {
  mode: string; results: CaseResult[]; passed: number; total: number;
  totalChecks: number; passedChecks: number; generatedAt: string | null;
};

const QUESTIONS = [
  ["Was the decision correct?", "decision, quantity, supplier"],
  ["Did it obtain the necessary information?", "evidence gathered"],
  ["Did it respect relevant constraints?", "constraints respected, soft warnings surfaced"],
  ["Did it take the appropriate action?", "autonomy routing, final status"],
  ["Did it validate the result?", "pre-flight validation, post-execution validation"],
  ["What happens when the action does not work?", "drift classification, self-correction"],
];

export default function EvaluationView({ initial, provider }: { initial: Report | null; provider: string }) {
  const [report, setReport] = useState<Report | null>(initial);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"deterministic" | "llm">("deterministic");
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/evaluation?mode=${mode}`, { method: "POST" });
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
        subtitle="Each case runs against a freshly rebuilt database and asserts against three sources: what the agent decided, what the recorded trace shows it actually looked at, and what the database looks like afterwards. The last one matters most — an agent can claim anything, so the honest test is the state of the world."
        actions={
          <div className="flex items-center gap-2">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
              className="rounded-md border border-edge bg-slate-800/60 px-2.5 py-1.5 text-[13px] text-slate-200"
            >
              <option value="deterministic">deterministic</option>
              <option value="llm" disabled={provider === "none"}>LLM ({provider})</option>
            </select>
            <button onClick={run} disabled={busy} className="btn btn-primary">
              {busy ? "Running…" : "Run suite"}
            </button>
          </div>
        }
      />

      <div className="mb-4 panel border-amber-600/30 bg-amber-500/[0.04] p-3 text-[12.5px] text-amber-200/70">
        Running the suite rebuilds the database for each case, which discards any state created by hand
        in the scenario runner.
      </div>

      {error && (
        <div className="mb-4 panel border-rose-600/40 bg-rose-500/[0.06] p-4 text-[13px] text-rose-200">{error}</div>
      )}

      {!report || report.total === 0 ? (
        <Panel>
          <Empty>
            No report yet. Run the suite above, or <span className="mono text-sky-400">npm run eval</span> from the terminal.
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
            <Stat label="Mode" value={report.mode} hint="deterministic runs need no API key" />
            {/* ISO slices rather than toLocaleString: locale formatting differs
                between the server and the browser and breaks hydration. */}
            <Stat
              label="Generated"
              value={report.generatedAt ? `${report.generatedAt.slice(11, 19)} UTC` : "—"}
              hint={report.generatedAt ? report.generatedAt.slice(0, 10) : undefined}
            />
          </div>

          <div className="mt-4">
            <Panel title="What each case checks" subtitle="the assignment's six evaluation questions, mapped to machine-checkable assertions">
              <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
                {QUESTIONS.map(([q, a]) => (
                  <div key={q} className="flex items-baseline justify-between gap-4 border-b border-edge/50 py-1.5 text-[12.5px] last:border-0">
                    <span className="text-slate-300">{q}</span>
                    <span className="mono shrink-0 text-right text-[11px] text-slate-500">{a}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <div className="mt-4 space-y-3">
            {report.results.map((r) => (
              <div
                key={r.id}
                className={`panel p-5 ${r.passed ? "border-emerald-800/40" : "border-rose-700/50"}`}
              >
                <div className="flex flex-wrap items-center gap-2.5">
                  <Badge tone={r.passed ? "green" : "red"}>{r.passed ? "PASS" : "FAIL"}</Badge>
                  <h3 className="text-[14px] font-medium text-slate-100">{r.title}</h3>
                  <span className="mono ml-auto text-[11px] text-slate-600">{r.durationMs}ms</span>
                </div>
                <p className="mt-1 text-[11.5px] text-slate-500">{r.scenario} · {r.id}</p>

                <p className="mt-3 border-l-2 border-slate-700 pl-3 text-[12.5px] leading-relaxed text-slate-400">
                  {r.why}
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
                  <Badge tone="violet">{r.decision}</Badge>
                  {r.qty > 0 && <span className="mono text-slate-300">{r.qty} units</span>}
                  <span className="text-slate-500">status {r.status}</span>
                  <span className="text-slate-500">confidence {(r.confidence * 100).toFixed(0)}%</span>
                </div>

                <div className="mt-3 grid gap-x-6 gap-y-1 border-t border-edge pt-3 lg:grid-cols-2">
                  {r.checks.map((c, i) => (
                    <div key={i} className="flex items-start gap-2 text-[12px]">
                      <span className={`mt-0.5 shrink-0 ${c.passed ? "text-emerald-400" : "text-rose-400"}`}>
                        {c.passed ? "✓" : "✗"}
                      </span>
                      <span className="w-40 shrink-0 text-slate-400">{c.name}</span>
                      <span className="text-slate-500">{c.detail}</span>
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
