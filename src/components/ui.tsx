import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-heading-actions">{actions}</div>}
    </div>
  );
}
export function Panel({
  title,
  subtitle,
  children,
  right,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || right) && (
        <header className="panel-heading">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      <div className="panel-content">{children}</div>
    </section>
  );
}
export function Stat({
  label,
  value,
  hint,
  tone = "default",
  icon,
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad";
  icon?: IconName;
  href?: string;
}) {
  const content = (
    <>
      <div className="stat-top">
        <span>{label}</span>
        {icon && (
          <span className="stat-icon">
            <Icon name={icon} size={19} />
          </span>
        )}
      </div>
      <div className="stat-value">{value}</div>
      {hint && (
        <div className="stat-hint">
          {hint}
          {href && <Icon name="arrow" size={15} />}
        </div>
      )}
    </>
  );
  return href ? (
    <Link href={href} className={`stat-card stat-${tone}`}>
      {content}
    </Link>
  ) : (
    <div className={`stat-card stat-${tone}`}>{content}</div>
  );
}
const TONES: Record<string, string> = {
  slate: "badge-slate",
  sky: "badge-sky",
  green: "badge-green",
  amber: "badge-amber",
  red: "badge-red",
  violet: "badge-violet",
};
export function Badge({
  children,
  tone = "slate",
}: {
  children: ReactNode;
  tone?: keyof typeof TONES;
}) {
  return <span className={`chip ${TONES[tone]}`}>{children}</span>;
}
export function DecisionBadge({ decision }: { decision: string | null }) {
  const tone =
    decision === "ACCEPT"
      ? "green"
      : decision === "MODIFY"
        ? "amber"
        : decision === "REJECT" || decision === "ESCALATE"
          ? "red"
          : decision === "SPLIT_SOURCE"
            ? "violet"
            : decision === "EXPEDITE" || decision === "INVESTIGATE"
              ? "sky"
              : "slate";
  return (
    <Badge tone={tone}>
      {decision ? decision.toLowerCase().replace(/_/g, " ") : "Pending"}
    </Badge>
  );
}
export function StatusBadge({ status }: { status: string }) {
  const tone = ["completed", "approved", "confirmed"].includes(status)
    ? "green"
    : ["awaiting_approval", "pending", "partially_confirmed"].includes(status)
      ? "amber"
      : ["escalated", "failed", "rejected", "cancelled"].includes(status)
        ? "red"
        : status === "running"
          ? "sky"
          : "slate";
  return <Badge tone={tone}>{status.replace(/_/g, " ")}</Badge>;
}
export function DriftBadge({ severity }: { severity: string }) {
  return (
    <Badge
      tone={
        severity === "none"
          ? "green"
          : severity === "benign"
            ? "sky"
            : severity === "material"
              ? "amber"
              : "red"
      }
    >
      drift: {severity}
    </Badge>
  );
}
export function Table({
  head,
  children,
}: {
  head: string[];
  children: ReactNode;
}) {
  return (
    <div
      className="table-scroll"
      role="region"
      aria-label={head.filter(Boolean).join(", ") + " table"}
      tabIndex={0}
    >
      <table className="data-table">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={`${h}-${i}`} scope="col">
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
export function Td({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <td className={className}>{children}</td>;
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon">
        <Icon name="box" size={24} />
      </span>
      <div>{children}</div>
    </div>
  );
}
export function RunLink({
  id,
  children,
}: {
  id: string;
  children?: ReactNode;
}) {
  return (
    <Link
      href={`/runs/${id}`}
      className="mono text-emerald-800 underline-offset-4 hover:underline"
    >
      {children ?? id}
    </Link>
  );
}
export function Bar({
  pct,
  tone = "sky",
}: {
  pct: number;
  tone?: "sky" | "amber" | "red" | "green";
}) {
  return (
    <div
      className={`progress-bar progress-${tone}`}
      role="meter"
      aria-label="Utilisation"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  );
}
export const money = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
export const moneyPrecise = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
