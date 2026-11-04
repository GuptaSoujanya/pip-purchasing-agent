import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { EVAL_CASES } from "../../../../eval/cases";
import { runAllCases } from "../../../../eval/runner";
import { resolveProviderId } from "@/lib/agent/llm";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const REPORT = path.join(process.cwd(), "eval", "latest-report.json");

/** Return the most recent persisted report, if any. */
export async function GET() {
  if (!fs.existsSync(REPORT)) {
    return NextResponse.json({ generatedAt: null, results: [], total: 0, passed: 0 });
  }
  return NextResponse.json(JSON.parse(fs.readFileSync(REPORT, "utf8")));
}

/**
 * Run the full evaluation suite on demand.
 *
 * Each case rebuilds the database, so running this resets any state the user
 * created by hand. That is called out in the UI before the button is pressed.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const requested = (url.searchParams.get("mode") ?? "deterministic") as "llm" | "deterministic";
  const mode = requested === "llm" && resolveProviderId() === "none" ? "deterministic" : requested;

  const report = await runAllCases(EVAL_CASES, mode);
  const payload = { ...report, generatedAt: new Date().toISOString() };
  try {
    fs.writeFileSync(REPORT, JSON.stringify(payload, null, 2));
  } catch {
    // Read-only filesystem is fine; the report is still returned to the caller.
  }
  return NextResponse.json(payload);
}
