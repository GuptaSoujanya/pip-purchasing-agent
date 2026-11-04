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

export const dynamic = "force-dynamic";

export default function RunsPage() {
  const runs = listRuns(100);

  return (
    <>
      <PageHeader
        title="Agent runs"
        subtitle="Review recorded decisions, supporting evidence, and execution outcomes."
        actions={
          <Link href="/scenarios" className="btn btn-primary">
            Run a scenario
          </Link>
        }
      />

      <Panel
        title="Recent activity"
        subtitle={`${runs.length} recorded ${runs.length === 1 ? "run" : "runs"}`}
      >
        {runs.length === 0 ? (
          <Empty>
            <span className="mb-2 block text-base font-semibold text-stone-800">
              No agent runs yet
            </span>
            Run a scenario to create a record of its recommendation and outcome.
            <Link
              href="/scenarios"
              className="mt-4 block font-medium text-emerald-800 hover:underline"
            >
              View scenarios →
            </Link>
          </Empty>
        ) : (
          <Table
            head={[
              "Run",
              "Scenario",
              "Mode",
              "Decision",
              "Confidence",
              "Status",
              "Summary",
            ]}
          >
            {runs.map((r) => (
              <tr key={r.id}>
                <Td>
                  <RunLink id={r.id}>{r.id.slice(-9)}</RunLink>
                </Td>
                <Td className="text-[12px] text-stone-600">
                  {r.scenario.replace(/_/g, " ")}
                </Td>
                <Td>
                  <Badge tone="slate">{r.mode}</Badge>
                </Td>
                <Td>
                  <DecisionBadge decision={r.decision} />
                </Td>
                <Td className="mono text-stone-600">
                  {r.confidence !== null
                    ? `${(r.confidence * 100).toFixed(0)}%`
                    : "—"}
                </Td>
                <Td>
                  <StatusBadge status={r.status} />
                </Td>
                <Td className="max-w-md text-[12px] leading-relaxed text-stone-600">
                  {r.summary ?? "—"}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}
