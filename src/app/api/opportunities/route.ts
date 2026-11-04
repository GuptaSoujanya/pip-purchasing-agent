import { NextResponse } from "next/server";
import { networkHeadroom, runOpportunitySweep } from "@/lib/domain/opportunities";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ...runOpportunitySweep(),
    headroom: networkHeadroom(),
  });
}
