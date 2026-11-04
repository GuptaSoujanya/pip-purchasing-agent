import { NextResponse } from "next/server";
import { z } from "zod";
import { rejectAction, resumeApprovedAction } from "@/lib/agent/orchestrator";

export const dynamic = "force-dynamic";

const schema = z.object({
  action: z.enum(["approve", "reject"]),
  resolved_by: z.string().default("buyer.maria"),
  note: z.string().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload.", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    if (parsed.data.action === "approve") {
      // Approving resumes the parked action: it executes, is verified against
      // the original expectation, and self-corrects if the outcome drifts.
      const result = await resumeApprovedAction(id, parsed.data.resolved_by, parsed.data.note);
      return NextResponse.json(result);
    }
    return NextResponse.json(rejectAction(id, parsed.data.resolved_by, parsed.data.note));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
