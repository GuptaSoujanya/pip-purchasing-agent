import Link from "next/link";
import { listRuns } from "@/lib/db/repo";
import {
  Badge,
  DecisionBadge,
  Empty,
  PageHeader,
  Panel,
  RunLink,
  StatusBadge,
  Table,
  Td,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import "@/components/workflow-pages.css";

export const dynamic = "force-dynamic";
const ATTENTION = new Set(["awaiting_approval", "escalated", "failed"]);

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view: requestedView } = await searchParams;
  const view = ["attention", "completed", "running"].includes(
    requestedView ?? "",
  )
    ? requestedView!
    : "all";
  const runs = listRuns(100);
  const attention = runs.filter((run) => ATTENTION.has(run.status));
  const completed = runs.filter((run) => run.status === "completed");
  const active = runs.filter((run) => run.status === "running");
  const shown =
    view === "attention"
      ? attention
      : view === "completed"
        ? completed
        : view === "running"
          ? active
          : runs;
  const tabs = [
    { value: "all", label: "All activity", count: runs.length },
    { value: "attention", label: "Needs attention", count: attention.length },
    { value: "completed", label: "Completed", count: completed.length },
    { value: "running", label: "In progress", count: active.length },
  ];

  return (
    <div className="workflow-page workflow-runs">
      <div className="workflow-kicker">OPERATIONS / ACTIVITY</div>
      <PageHeader
        title="Agent activity"
        subtitle="Follow each decision from its evidence to the recorded outcome."
        actions={
          <Link href="/scenarios" className="btn btn-primary">
            <Icon name="workflow" size={17} /> Run a scenario
          </Link>
        }
      />
      <dl className="workflow-summary" aria-label="Activity summary">
        <div>
          <dt>Recorded runs</dt>
          <dd>
            {runs.length}
            <small>Latest 100 runs</small>
          </dd>
        </div>
        <div data-tone={attention.length ? "peach" : "neutral"}>
          <dt>Needs attention</dt>
          <dd>
            {attention.length}
            <small>Approval, escalation or failure</small>
          </dd>
        </div>
        <div data-tone="blue">
          <dt>Completed</dt>
          <dd>
            {completed.length}
            <small>Recorded execution outcomes</small>
          </dd>
        </div>
        <div>
          <dt>In progress</dt>
          <dd>
            {active.length}
            <small>Currently running</small>
          </dd>
        </div>
      </dl>
      <Panel
        title="Decision history"
        subtitle="Open a run to inspect its evidence, actions and validation."
        right={
          <span className="workflow-count">
            {shown.length} {shown.length === 1 ? "run" : "runs"}
          </span>
        }
      >
        <nav className="workflow-tabs" aria-label="Filter agent activity">
          {tabs.map((tab) => (
            <Link
              key={tab.value}
              href={tab.value === "all" ? "/runs" : `/runs?view=${tab.value}`}
              aria-current={view === tab.value ? "page" : undefined}
            >
              {tab.label}
              <span>{tab.count}</span>
            </Link>
          ))}
        </nav>
        {shown.length === 0 ? (
          <Empty>
            <strong className="workflow-empty-title">
              {runs.length === 0
                ? "Your first decision starts here"
                : "No runs in this view"}
            </strong>
            <p>
              {runs.length === 0
                ? "Run a scenario to keep a trace of what the agent considered, decided and verified."
                : "Choose another status to review the rest of your activity."}
            </p>
            <Link
              href={runs.length === 0 ? "/scenarios" : "/runs"}
              className="btn workflow-empty-action"
            >
              {runs.length === 0 ? "Choose a scenario" : "View all activity"}
              <Icon name="arrow" size={15} />
            </Link>
          </Empty>
        ) : (
          <Table
            head={[
              "Run",
              "Scenario & reasoning",
              "Decision",
              "Status",
              "Outcome",
              "Review",
            ]}
          >
            {shown.map((run) => (
              <tr
                key={run.id}
                data-attention={ATTENTION.has(run.status) || undefined}
              >
                <Td>
                  <RunLink id={run.id}>{run.id.slice(-9)}</RunLink>
                  <span className="workflow-cell-meta">
                    {run.started_at.slice(0, 10)}
                    <br />
                    {run.started_at.slice(11, 16)} UTC
                  </span>
                </Td>
                <Td>
                  <span className="workflow-cell-title">
                    {run.scenario.replace(/_/g, " ")}
                  </span>
                  <Badge tone="slate">
                    {run.mode === "deterministic" ? "Rules-based" : "LLM"}
                  </Badge>
                </Td>
                <Td>
                  <DecisionBadge decision={run.decision} />
                  <span className="workflow-cell-meta">
                    {run.confidence !== null
                      ? `${(run.confidence * 100).toFixed(0)}% confidence`
                      : "Confidence not recorded"}
                  </span>
                </Td>
                <Td>
                  <StatusBadge status={run.status} />
                </Td>
                <Td className="workflow-outcome">
                  {run.summary ||
                    (run.status === "running"
                      ? "This run is still in progress."
                      : "Open the run to review its recorded steps.")}
                </Td>
                <Td>
                  <Link
                    href={`/runs/${run.id}`}
                    className="workflow-row-action"
                    aria-label={`Review run ${run.id.slice(-9)}`}
                  >
                    View trace
                    <Icon name="arrow-up-right" size={15} />
                  </Link>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
      {attention.some((run) => run.status === "awaiting_approval") && (
        <div className="workflow-next-step">
          <Icon name="check" size={18} />
          <p>Some decisions are waiting for your sign-off.</p>
          <Link href="/approvals">
            Review approvals
            <Icon name="arrow" size={15} />
          </Link>
        </div>
      )}
    </div>
  );
}
