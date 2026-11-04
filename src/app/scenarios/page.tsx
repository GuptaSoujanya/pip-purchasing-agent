import { resolveProviderId } from "@/lib/agent/llm";
import { listSupplierEvents } from "@/lib/db/repo";
import ScenarioRunner from "./runner";

export const dynamic = "force-dynamic";

export default function ScenariosPage() {
  const provider = resolveProviderId();
  const pendingEvent = listSupplierEvents(true)[0] ?? null;
  return (
    <ScenarioRunner
      provider={provider}
      pendingEvent={pendingEvent ? { ...pendingEvent, payload: JSON.parse(pendingEvent.payload_json) } : null}
    />
  );
}
