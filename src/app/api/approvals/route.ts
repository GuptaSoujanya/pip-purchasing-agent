import { NextResponse } from "next/server";
import { getRun, listApprovals } from "@/lib/db/repo";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const status = new URL(req.url).searchParams.get("status") ?? undefined;
  const approvals = listApprovals(status).map((a) => ({
    ...a,
    action: safeParse(a.action_json),
    run: getRun(a.run_id),
  }));
  return NextResponse.json(approvals);
}

function safeParse(s: string) {
  try { return JSON.parse(s); } catch { return { _raw: s }; }
}
