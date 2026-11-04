import { getRun, listApprovals } from "@/lib/db/repo";
import ApprovalQueue from "./queue";

export const dynamic = "force-dynamic";

export default function ApprovalsPage() {
  const approvals = listApprovals().map((a) => ({
    ...a,
    action: safeParse(a.action_json),
    run: getRun(a.run_id),
  }));
  return <ApprovalQueue approvals={approvals} />;
}

function safeParse(s: string) {
  try { return JSON.parse(s); } catch { return { _raw: s }; }
}
