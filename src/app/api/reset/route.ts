import { NextResponse } from "next/server";
import { resetSchema } from "@/lib/db/client";
import { seed } from "@/lib/db/seed";

export const dynamic = "force-dynamic";

/** Rebuild the demo world from scratch. Handy between demo runs. */
export async function POST() {
  const db = resetSchema();
  seed(db);
  return NextResponse.json({ ok: true, message: "Database reset and reseeded." });
}
