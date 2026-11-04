import { resolveProviderId } from "@/lib/agent/llm";
import { listLatestRunsBySituation, listSupplierEvents } from "@/lib/db/repo";
import { PRESETS, type CaseRecord } from "./presets";
import ScenarioRunner from "./runner";

export const dynamic = "force-dynamic";

// A run belongs to a preset when the scenario and every identifier the preset pins match,
// which is what makes the stored result re-attachable after a reload.
function restoreRecords(): Record<string, CaseRecord> {
  const latest = listLatestRunsBySituation();
  const records: Record<string, CaseRecord> = {};
  for (const preset of PRESETS) {
    const input = preset.input as Record<string, unknown>;
    const key = [preset.input.scenario, input.node_id, input.product_id, input.po_id]
      .map((part) => part ?? "-")
      .join("|");
    const run = latest.get(key);
    if (!run) continue;
    if (run.status === "running") {
      records[preset.id] = { result: null, error: null, approvalOutcome: null, pendingRunId: run.id };
      continue;
    }
    if (!run.result_json) continue;
    try {
      records[preset.id] = {
        result: JSON.parse(run.result_json),
        error: null,
        approvalOutcome: null,
      };
    } catch {
      continue;
    }
  }
  return records;
}

export default function ScenariosPage() {
  const provider = resolveProviderId();
  const pendingEvent = listSupplierEvents(true)[0] ?? null;
  return (
    <ScenarioRunner
      provider={provider}
      initialRecords={restoreRecords()}
      pendingEvent={pendingEvent ? { ...pendingEvent, payload: JSON.parse(pendingEvent.payload_json) } : null}
    />
  );
}
