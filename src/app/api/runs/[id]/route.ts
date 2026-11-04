import { NextResponse } from "next/server";
import { getRun, getSteps, getValidations, listApprovals } from "@/lib/db/repo";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });

  return NextResponse.json({
    run,
    steps: getSteps(id),
    validations: getValidations(id),
    approvals: listApprovals().filter((a) => a.run_id === id),
  });
}
