import fs from "node:fs";
import path from "node:path";
import { resolveProviderId } from "@/lib/agent/llm";
import EvaluationView from "./view";

export const dynamic = "force-dynamic";

export default function EvaluationPage() {
  const file = path.join(process.cwd(), "eval", "latest-report.json");
  const report = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  return <EvaluationView initial={report} provider={resolveProviderId()} />;
}
