import Link from "next/link";
import { notFound } from "next/navigation";
import { getRun, getSteps, getValidations, listApprovals } from "@/lib/db/repo";
import {
  Badge,
  DecisionBadge,
  Empty,
  PageHeader,
  Panel,
  StatusBadge,
} from "@/components/ui";

export const dynamic = "force-dynamic";

const PHASE_META: Record<
  string,
  { label: string; tone: string; blurb: string }
> = {
  triage: {
    label: "Triage",
    tone: "border-stone-200 bg-stone-100 text-stone-700",
    blurb: "Classify the situation and name what is unknown",
  },
  investigate: {
    label: "Investigate",
    tone: "border-stone-200 bg-stone-100 text-stone-700",
    blurb: "Gather evidence with read-only tools",
  },
  decide: {
    label: "Decide",
    tone: "border-stone-200 bg-stone-100 text-stone-800",
    blurb: "Form a decision and cross-check it",
  },
  pre_validate: {
    label: "Pre-validate",
    tone: "border-stone-200 bg-stone-100 text-stone-700",
    blurb: "Test the decision against every constraint before writing",
  },
  act: {
    label: "Act",
    tone: "border-emerald-600/50 bg-emerald-500/10 text-emerald-800",
    blurb: "Execute, or hand to a buyer",
  },
  post_validate: {
    label: "Post-validate",
    tone: "border-stone-200 bg-stone-100 text-stone-700",
    blurb: "Re-read the world and compare against the expectation",
  },
  remediate: {
    label: "Remediate",
    tone: "border-orange-600/50 bg-orange-500/10 text-orange-800",
    blurb: "Self-correct material drift",
  },
  escalate: {
    label: "Escalate",
    tone: "border-rose-600/50 bg-rose-500/10 text-rose-800",
    blurb: "Hand over to a human",
  },
};

export default async function RunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) notFound();

  const steps = getSteps(id);
  const validations = getValidations(id);
  const approvals = listApprovals().filter((a) => a.run_id === id);
  const input = JSON.parse(run.input_json);

  // Group consecutive steps by phase so the trace reads as a narrative.
  const groups: { phase: string; steps: typeof steps }[] = [];
  for (const s of steps) {
    const last = groups[groups.length - 1];
    if (last && last.phase === s.phase) last.steps.push(s);
    else groups.push({ phase: s.phase, steps: [s] });
  }

  return (
    <>
      <Link
        href="/runs"
        className="mb-5 inline-flex min-h-11 items-center text-sm font-medium text-emerald-800 hover:underline"
      >
        ← All agent runs
      </Link>
      <PageHeader
        title="Agent run"
        subtitle={run.summary ?? undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="slate">{run.mode}</Badge>
            <DecisionBadge decision={run.decision} />
            <StatusBadge status={run.status} />
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <Panel
            title="Reasoning trace"
            subtitle={`${steps.length} recorded steps across ${groups.length} phase transitions`}
          >
            {steps.length === 0 ? (
              <Empty>No steps recorded.</Empty>
            ) : (
              <div className="space-y-5">
                {groups.map((g, gi) => {
                  const meta = PHASE_META[g.phase] ?? PHASE_META.triage;
                  return (
                    <div key={gi}>
                      <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
                        <span className={`chip ${meta.tone}`}>
                          {meta.label}
                        </span>
                        <span className="text-[11.5px] text-stone-500">
                          {meta.blurb}
                        </span>
                      </div>
                      <div className="space-y-2 border-l border-edge pl-4">
                        {g.steps.map((s) => (
                          <StepCard key={s.id} step={s} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Input">
            <dl className="space-y-0">
              {Object.entries(input).map(([k, v]) => (
                <div key={k} className="kv">
                  <dt className="text-stone-600">{k.replace(/_/g, " ")}</dt>
                  <dd className="mono min-w-0 break-all text-right text-stone-800">
                    {String(v)}
                  </dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel title="Outcome">
            <dl className="space-y-0">
              <div className="kv">
                <dt className="text-stone-600">decision</dt>
                <dd>
                  <DecisionBadge decision={run.decision} />
                </dd>
              </div>
              <div className="kv">
                <dt className="text-stone-600">status</dt>
                <dd>
                  <StatusBadge status={run.status} />
                </dd>
              </div>
              <div className="kv">
                <dt className="text-stone-600">confidence</dt>
                <dd className="mono text-stone-800">
                  {run.confidence !== null
                    ? `${(run.confidence * 100).toFixed(0)}%`
                    : "—"}
                </dd>
              </div>
              <div className="kv">
                <dt className="text-stone-600">started</dt>
                <dd className="mono text-[11px] text-stone-600">
                  {run.started_at.slice(11, 19)}
                </dd>
              </div>
              {run.finished_at && (
                <div className="kv">
                  <dt className="text-stone-600">finished</dt>
                  <dd className="mono text-[11px] text-stone-600">
                    {run.finished_at.slice(11, 19)}
                  </dd>
                </div>
              )}
            </dl>
          </Panel>

          <Panel
            title="Validations"
            subtitle="constraint checks recorded before and after acting"
          >
            {validations.length === 0 ? (
              <Empty>None recorded.</Empty>
            ) : (
              <div className="space-y-3">
                {validations.map((v) => {
                  const checks = JSON.parse(v.checks_json) as {
                    code: string;
                    passed: boolean;
                    severity: string;
                    detail: string;
                  }[];
                  const failed = checks.filter((c) => !c.passed);
                  return (
                    <div key={v.id}>
                      <div className="flex items-center gap-2">
                        <Badge tone="slate">{v.phase}-execution</Badge>
                        <Badge tone={v.passed ? "green" : "red"}>
                          {v.passed ? "passed" : "failed"}
                        </Badge>
                      </div>
                      <p className="mt-1.5 text-[11.5px] leading-relaxed text-stone-500">
                        {checks.length} checks, {failed.length} not satisfied
                        {failed.length > 0 &&
                          `: ${failed.map((f) => f.code).join(", ")}`}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          {approvals.length > 0 && (
            <Panel title="Human decisions">
              <div className="space-y-3">
                {approvals.map((a) => (
                  <div key={a.id}>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={a.status} />
                      <Badge tone={a.risk_level === "high" ? "red" : "amber"}>
                        {a.risk_level}
                      </Badge>
                    </div>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-stone-600">
                      {a.reason}
                    </p>
                    {a.resolved_by && (
                      <p className="mt-1 text-[11.5px] text-stone-500">
                        {a.status} by {a.resolved_by}
                        {a.resolution_note ? ` — "${a.resolution_note}"` : ""}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <Link
                href="/approvals"
                className="mt-3 inline-block text-[12px] text-emerald-800 hover:underline"
              >
                Approval queue →
              </Link>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}

function StepCard({ step }: { step: ReturnType<typeof getSteps>[number] }) {
  const output = step.output_json ? safeParse(step.output_json) : null;
  const input = step.input_json ? safeParse(step.input_json) : null;

  return (
    <details className="group rounded-xl border border-edge bg-stone-50/70 open:bg-white">
      <summary className="flex min-h-11 cursor-pointer list-none items-start gap-2.5 px-4 py-3">
        <span
          className={`mono mt-0.5 shrink-0 ${step.ok ? "text-stone-600" : "text-rose-700"}`}
        >
          {String(step.seq).padStart(2, "0")}
        </span>
        <div className="min-w-0 flex-1">
          {step.tool_name && (
            <span className="mono mr-2 break-all rounded bg-stone-50 px-1.5 py-0.5 text-[11px] text-emerald-900">
              {step.tool_name}
            </span>
          )}
          <span className="text-[12.5px] leading-relaxed text-stone-700">
            {step.reasoning ?? describeType(step.type)}
          </span>
        </div>
        {step.duration_ms > 0 && (
          <span className="mono shrink-0 text-[10.5px] text-stone-600">
            {step.duration_ms}ms
          </span>
        )}
        <span className="shrink-0 text-stone-600 transition group-open:rotate-90">
          ›
        </span>
      </summary>
      <div className="space-y-2 border-t border-edge px-3 py-2.5">
        {input && (
          <div>
            <div className="label mb-1">arguments</div>
            <pre className="mono overflow-x-auto rounded bg-stone-50 p-2 text-[11px] text-stone-600">
              {JSON.stringify(input, null, 2)}
            </pre>
          </div>
        )}
        {output !== null && (
          <div>
            <div className="label mb-1">result</div>
            <pre className="mono max-h-80 overflow-auto rounded bg-stone-50 p-2 text-[11px] text-stone-600">
              {JSON.stringify(output, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </details>
  );
}

function describeType(type: string) {
  return (
    {
      tool_call: "Tool call",
      reasoning: "Reasoning",
      validation: "Validation",
      decision: "Decision",
      drift: "Drift check",
      note: "Note",
    }[type] ?? type
  );
}

function safeParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
