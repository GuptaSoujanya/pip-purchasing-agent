import { NextResponse } from "next/server";
import { listRuns } from "@/lib/db/repo";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(listRuns(100));
}
