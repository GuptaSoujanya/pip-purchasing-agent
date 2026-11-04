import fs from "node:fs";
import path from "node:path";
import { EVAL_CASES } from "../eval/cases";
import { runAllCases } from "../eval/runner";
import { resolveProviderId } from "../src/lib/agent/llm";

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m", grey: "\x1b[90m",
};

function wrap(text: string, width: number, indent: string): string {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > width) { lines.push(line.trim()); line = w; }
    else line += " " + w;
  }
  if (line.trim()) lines.push(line.trim());
  return lines.map((l) => indent + l).join("\n");
}

(async () => {
  const requested = (process.env.AGENT_MODE ?? "deterministic") as "llm" | "deterministic";
  const provider = resolveProviderId();
  const mode: "llm" | "deterministic" =
    requested === "llm" && provider === "none" ? "deterministic" : requested;

  console.log(`\n${C.bold}AI Purchasing Agent — evaluation${C.reset}`);
  console.log(`${C.grey}mode: ${mode}   provider: ${provider}   fault injection: ${process.env.FAULT_INJECTION ?? "on"}${C.reset}`);
  if (requested === "llm" && provider === "none") {
    console.log(`${C.yellow}No LLM API key configured — falling back to deterministic mode.${C.reset}`);
  }
  console.log("");

  const report = await runAllCases(EVAL_CASES, mode);

  for (const r of report.results) {
    const icon = r.passed ? `${C.green}PASS${C.reset}` : `${C.red}FAIL${C.reset}`;
    console.log(`${icon}  ${C.bold}${r.title}${C.reset}`);
    console.log(`${C.grey}      ${r.scenario}  ·  ${r.id}  ·  ${r.durationMs}ms${C.reset}`);
    console.log(`${C.cyan}      → ${r.decision} ${r.qty ? `${r.qty} units ` : ""}· status ${r.status} · confidence ${(r.confidence * 100).toFixed(0)}%${C.reset}`);

    for (const k of r.checks) {
      const mark = k.passed ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
      console.log(`      ${mark} ${k.name}${C.grey} — ${k.detail}${C.reset}`);
    }
    console.log(`${C.dim}${wrap(r.why, 96, "      ")}${C.reset}`);
    console.log("");
  }

  const allPassed = report.passed === report.total;
  console.log(
    `${C.bold}${allPassed ? C.green : C.red}${report.passed}/${report.total} cases passed` +
    `  (${report.passedChecks}/${report.totalChecks} individual checks)${C.reset}\n`,
  );

  // Persist for the in-app evaluation page.
  const out = path.join(process.cwd(), "eval", "latest-report.json");
  fs.writeFileSync(out, JSON.stringify({ ...report, generatedAt: new Date().toISOString() }, null, 2));
  console.log(`${C.grey}Report written to ${path.relative(process.cwd(), out)}${C.reset}\n`);

  process.exit(allPassed ? 0 : 1);
})();
