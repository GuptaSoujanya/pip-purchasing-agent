import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({
  title, subtitle, actions,
}: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-100">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-slate-400">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Panel({
  title, subtitle, children, right, className = "",
}: { title?: string; subtitle?: string; children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      {(title || right) && (
        <header className="flex items-center justify-between gap-3 border-b border-edge px-5 py-3">
          <div>
            {title && <h2 className="text-[13px] font-semibold text-slate-200">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[11.5px] text-slate-500">{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Stat({
  label, value, hint, tone = "default",
}: { label: string; value: ReactNode; hint?: string; tone?: "default" | "good" | "warn" | "bad" }) {
  const toneClass = {
    default: "text-slate-100",
    good: "text-emerald-400",
    warn: "text-amber-400",
    bad: "text-rose-400",
  }[tone];
  return (
    <div className="panel-pad">
      <div className="label">{label}</div>
      <div className={`mt-1.5 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
      {hint && <div className="mt-1 text-[11.5px] leading-snug text-slate-500">{hint}</div>}
    </div>
  );
}

const TONES: Record<string, string> = {
  slate: "border-slate-600/40 bg-slate-700/30 text-slate-300",
  sky: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  green: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  amber: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  red: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  violet: "border-violet-500/40 bg-violet-500/10 text-violet-300",
};

export function Badge({
  children, tone = "slate",
}: { children: ReactNode; tone?: keyof typeof TONES }) {
  return <span className={`chip ${TONES[tone]}`}>{children}</span>;
}

export function DecisionBadge({ decision }: { decision: string | null }) {
  const tone: keyof typeof TONES =
    decision === "ACCEPT" ? "green"
    : decision === "MODIFY" ? "amber"
    : decision === "REJECT" ? "red"
    : decision === "ESCALATE" ? "red"
    : decision === "SPLIT_SOURCE" ? "violet"
    : decision === "EXPEDITE" ? "sky"
    : decision === "INVESTIGATE" ? "sky"
    : "slate";
  return <Badge tone={tone}>{decision ?? "—"}</Badge>;
}

export function StatusBadge({ status }: { status: string }) {
  const tone: keyof typeof TONES =
    status === "completed" ? "green"
    : status === "awaiting_approval" ? "amber"
    : status === "escalated" ? "red"
    : status === "failed" ? "red"
    : status === "running" ? "sky"
    : status === "approved" ? "green"
    : status === "rejected" ? "red"
    : status === "pending" ? "amber"
    : status === "confirmed" ? "green"
    : status === "partially_confirmed" ? "amber"
    : status === "cancelled" ? "red"
    : "slate";
  return <Badge tone={tone}>{status.replace(/_/g, " ")}</Badge>;
}

export function DriftBadge({ severity }: { severity: string }) {
  const tone: keyof typeof TONES =
    severity === "none" ? "green"
    : severity === "benign" ? "sky"
    : severity === "material" ? "amber"
    : "red";
  return <Badge tone={tone}>drift: {severity}</Badge>;
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-edge">
            {head.map((h) => (
              <th key={h} className="px-5 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-slate-500">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <td className={`border-b border-edge/50 px-5 py-2.5 align-top ${className}`}>{children}</td>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-[13px] text-slate-500">{children}</p>;
}

export function RunLink({ id, children }: { id: string; children?: ReactNode }) {
  return (
    <Link href={`/runs/${id}`} className="mono text-sky-400 underline-offset-2 hover:underline">
      {children ?? id}
    </Link>
  );
}

export function Bar({ pct, tone = "sky" }: { pct: number; tone?: "sky" | "amber" | "red" | "green" }) {
  const colour = { sky: "bg-sky-500", amber: "bg-amber-500", red: "bg-rose-500", green: "bg-emerald-500" }[tone];
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
      <div className={`h-full rounded-full ${colour}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  );
}

export const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export const moneyPrecise = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
