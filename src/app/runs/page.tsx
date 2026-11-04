import Link from "next/link";
import { listRuns } from "@/lib/db/repo";
import { Badge, DecisionBadge, Empty, PageHeader, Panel, RunLink, StatusBadge, Table, Td } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function RunsPage() {
  const runs = listRuns(100);

  return (
    <>
      <PageHeader
        title="Agent runs"
        subtitle="Every run is recorded end to end — the tools it called, the numbers it got back, the constraints it checked, what it did, and whether the result matched what it expected."
        actions={<Link href="/scenarios" className="btn btn-primary">Run a scenario</Link>}
      />

      <Panel>
        {runs.length === 0 ? (
          <Empty>
            Nothing yet. <Link href="/scenarios" className="text-sky-400 hover:underline">Run a scenario</Link>.
          </Empty>
        ) : (
          <Table head={["Run", "Scenario", "Mode", "Decision", "Confidence", "Status", "Summary"]}>
            {runs.map((r) => (
              <tr key={r.id}>
                <Td><RunLink id={r.id}>{r.id.slice(-9)}</RunLink></Td>
                <Td className="text-[12px] text-slate-400">{r.scenario.replace(/_/g, " ")}</Td>
                <Td><Badge tone="slate">{r.mode}</Badge></Td>
                <Td><DecisionBadge decision={r.decision} /></Td>
                <Td className="mono text-slate-400">
                  {r.confidence !== null ? `${(r.confidence * 100).toFixed(0)}%` : "—"}
                </Td>
                <Td><StatusBadge status={r.status} /></Td>
                <Td className="max-w-md text-[12px] leading-relaxed text-slate-400">{r.summary ?? "—"}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}
