/**
 * Headless end-to-end demo.
 *
 *   npm run demo
 *
 * Runs the complete purchasing loop in the terminal, with no browser and no
 * API key, and narrates what the agent is doing and why. The UI shows the same
 * thing more attractively; this exists so the system can be verified in twenty
 * seconds on a machine that has only cloned the repo.
 */

import { resetSchema } from "../src/lib/db/client";
import { seed } from "../src/lib/db/seed";
import { resumeApprovedAction, runAgent, type RunResult } from "../src/lib/agent/orchestrator";
import { getPo, listAudit, listPos, getBudget, budgetAvailable, listNodes, storageFreeSlots } from "../src/lib/db/repo";
import { runOpportunitySweep } from "../src/lib/domain/opportunities";
import { describeProvider } from "../src/lib/agent/llm";

const C = {
  reset: "\x1b[0m", dim: "\x1b[90m", bold: "\x1b[1m",
  green: "\x1b[32m", amber: "\x1b[33m", red: "\x1b[31m",
  cyan: "\x1b[36m", magenta: "\x1b[35m",
};

const line = (ch = "─") => console.log(C.dim + ch.repeat(78) + C.reset);
const h1 = (s: string) => { console.log(); line("═"); console.log(`${C.bold}${s}${C.reset}`); line("═"); };
const h2 = (s: string) => { console.log(); console.log(`${C.bold}${C.cyan}${s}${C.reset}`); line(); };
const kv = (k: string, v: string | number) => console.log(`  ${C.dim}${k.padEnd(22)}${C.reset}${v}`);
const note = (s: string) => console.log(`  ${C.dim}${s}${C.reset}`);
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function decisionColour(d: string) {
  if (d === "ACCEPT") return C.green;
  if (d === "REJECT" || d === "ESCALATE") return C.red;
  if (d === "NO_ACTION") return C.dim;
  return C.amber;
}

function printDecision(r: RunResult) {
  console.log(
    `  ${C.bold}Decision${C.reset}  ${decisionColour(r.decision)}${C.bold}${r.decision}${C.reset}` +
      `  ${C.dim}(confidence ${(r.confidence * 100).toFixed(0)}%)${C.reset}`,
  );
  if (r.recommendedQty) kv("Quantity", `${r.recommendedQty} units`);
  if (r.supplierId) kv("Supplier", r.supplierId);
  if (r.orderValue) kv("Order value", money(r.orderValue));
  kv("Autonomy", r.autonomy ? `${r.autonomy.decision}  (risk: ${r.autonomy.riskLevel})` : "n/a");
  kv("Run status", r.status);
  console.log(`\n  ${C.dim}Why:${C.reset}`);
  for (const reason of r.rationale.slice(0, 6)) console.log(`    • ${reason}`);
}

function printConstraints(r: RunResult) {
  const checks = r.validation?.checks ?? [];
  const failed = checks.filter((c) => !c.passed);
  if (!checks.length) return;
  console.log(`\n  ${C.dim}Constraint checks: ${checks.length} run, ${failed.length} failed${C.reset}`);
  for (const c of failed) {
    const tone = c.severity === "hard" ? C.red : C.amber;
    console.log(`    ${tone}${c.severity.toUpperCase().padEnd(5)}${C.reset} ${c.code} — ${c.detail}`);
  }
}

async function main() {
  const db = resetSchema();
  seed(db);
  db.close();

  h1("AI PURCHASING AGENT — END-TO-END DEMO");
  const provider = describeProvider();

  // The demo defaults to the deterministic engine even when a model is
  // available, so that it stays fast and returns the same numbers on every
  // machine — a walkthrough whose figures move between runs is a poor demo.
  // The model path is one environment variable away, and is what `eval:llm`
  // and `check:llm` exercise.
  const demoMode = process.env.AGENT_MODE === "llm" ? "llm" : "deterministic";
  kv("Reasoning mode", demoMode === "llm"
    ? `${provider.label}  — real model reasoning`
    : `deterministic policy engine  (reproducible; AGENT_MODE=llm runs this same demo through ${provider.real ? provider.label : "a model"})`);
  kv("Fault injection", (process.env.FAULT_INJECTION ?? "on") !== "off" ? "ON — suppliers will push back" : "off");
  note("Database rebuilt from seed. Everything below is computed, not scripted.");

  // =========================================================================
  h1("ACT 1 — The recommendation is wrong  (Scenario 1)");
  note("The purchasing system says buy 800 units of SKU-1001 at Bogotá North DC.");
  note("The agent is not told whether that is right.");

  const s1 = await runAgent({
    scenario: "recommendation_review",
    node_id: "NODE-BOG-01",
    product_id: "PRD-1001",
    recommended_qty: 800,
  }, { mode: demoMode });

  h2("What the agent worked out");
  for (const factor of s1.keyFactors.slice(0, 7)) {
    console.log(`  ${C.dim}·${C.reset} ${factor.label}: ${factor.value}`);
  }
  h2("What it decided");
  printDecision(s1);
  printConstraints(s1);
  console.log(
    `\n  ${C.magenta}The recommendation ignored 150 units already in transit.${C.reset}\n` +
      `  ${C.dim}A 56% cut exceeds the agent's autonomy band, so it routes to a buyer${C.reset}\n` +
      `  ${C.dim}rather than silently applying it.${C.reset}`,
  );

  // =========================================================================
  h1("ACT 2 — The recommendation is right  (negative control)");
  note("Same scenario type, different line: 500 units of SKU-1005 at Medellín.");
  note("An agent that always objects is as useless as one that always agrees.");

  const s1b = await runAgent({
    scenario: "recommendation_review",
    node_id: "NODE-MED-02",
    product_id: "PRD-1005",
    recommended_qty: 500,
  }, { mode: demoMode });
  printDecision(s1b);
  if (s1b.executedPoIds.length) {
    const po = getPo(s1b.executedPoIds[0]);
    console.log(`\n  ${C.green}Executed autonomously → ${po?.po_number} (${po?.status})${C.reset}`);
  }

  // =========================================================================
  h1("ACT 3 — A spike that is not a demand shift  (negative control)");
  note("Greek yogurt sales are up 61%. Statistically this looks like a real change.");

  const s3b = await runAgent({ scenario: "demand_shift", node_id: "NODE-BOG-01", product_id: "PRD-1005" }, { mode: demoMode });
  printDecision(s3b);
  console.log(
    `\n  ${C.magenta}A 2-for-1 promotion explains the lift, so the correct answer is to do nothing.${C.reset}\n` +
      `  ${C.dim}The agent also refuses to rebase the forecast — buying into a promotion${C.reset}\n` +
      `  ${C.dim}as though it were permanent is how buyers end up with dead stock.${C.reset}`,
  );

  // =========================================================================
  h1("ACT 4 — A real demand shift, and the supplier lets us down  (Scenario 3)");
  note("Energy drink sales have tripled. This one clears every evidence gate.");

  const s3 = await runAgent({ scenario: "demand_shift", node_id: "NODE-BOG-01", product_id: "PRD-1003" }, { mode: demoMode });
  printDecision(s3);

  if (s3.status === "awaiting_approval" && s3.approvalId) {
    console.log(
      `\n  ${C.amber}Parked for approval: ${money(s3.orderValue)} exceeds the $5,000 autonomy ceiling.${C.reset}`,
    );
    h2("The buyer approves — and this is where it gets interesting");
    const resumed = await resumeApprovedAction(s3.approvalId, "buyer.maria", "Approved from the demo script");

    kv("Execution status", resumed.status);
    for (const poId of resumed.executedPoIds) {
      const po = getPo(poId);
      const l = po?.lines[0];
      const short = l ? l.qty_ordered - l.qty_confirmed : 0;
      console.log(
        `  ${C.dim}PO${C.reset} ${po?.po_number}  ordered ${l?.qty_ordered}  confirmed ${l?.qty_confirmed}` +
          (short > 0 ? `  ${C.red}(short ${short})${C.reset}` : `  ${C.green}(in full)${C.reset}`),
      );
    }

    if (resumed.drift) {
      const tone = resumed.drift.severity === "material" ? C.amber
        : resumed.drift.severity === "critical" ? C.red : C.green;
      h2("Post-execution validation");
      note("The agent re-reads the database — deliberately NOT the write tool's return value.");
      console.log(`  ${C.bold}Drift${C.reset}     ${tone}${resumed.drift.severity}${C.reset}`);
      console.log(`  ${C.dim}${resumed.drift.summary}${C.reset}`);
      for (const f of resumed.drift.findings) {
        console.log(`    • ${f.field}: expected ${f.expected}, actual ${f.actual} — ${f.note}`);
      }
    }

    if (resumed.remediations.length) {
      h2("Self-correction");
      for (const r of resumed.remediations) {
        const po = r.poId ? getPo(r.poId) : null;
        console.log(
          `  ${r.ok ? C.green + "✓" : C.red + "✗"}${C.reset} attempt ${r.attempt}: ${r.rationale}` +
            (po ? `\n    ${C.dim}→ ${po.po_number}, ${po.lines[0]?.qty_confirmed} units confirmed from ${po.supplier_id}${C.reset}` : ""),
        );
      }
      console.log(
        `\n  ${C.magenta}Nobody asked it to do that.${C.reset} ${C.dim}The supplier accepted the order and${C.reset}\n` +
          `  ${C.dim}reported success; only an independent read of the database revealed${C.reset}\n` +
          `  ${C.dim}that 1,100 of the 1,500 units were never actually confirmed.${C.reset}`,
      );
    }
  }

  // =========================================================================
  h1("ACT 5 — Storage, not money, is what binds  (Scenario 4)");
  note("Cartagena needs bottled water. Both budget and storage block the full order —");
  note("the question is which one binds tighter, and what to do with the remainder.");

  const s4 = await runAgent({ scenario: "constrained_purchase", node_id: "NODE-CTG-03", product_id: "PRD-1004" }, { mode: demoMode });
  printDecision(s4);
  printConstraints(s4);

  h2("How it got around the constraint");
  for (const factor of s4.keyFactors) console.log(`  ${C.dim}·${C.reset} ${factor.label}: ${factor.value}`);
  const constraintReasoning = s4.rationale.filter((r) =>
    /BLOCKED|binding constraint|partial order|balance be delivered/i.test(r),
  );
  if (constraintReasoning.length) {
    console.log();
    for (const r of constraintReasoning) console.log(`  ${C.magenta}·${C.reset} ${r}`);
  }
  note("");
  note("Note the validation now reports no binding constraint — because the quantity");
  note("has already been fitted to it. Every failed hard check reports the largest");
  note("quantity that WOULD pass, which is what turns a blocked purchase into a");
  note("counter-proposal instead of an error.");

  // =========================================================================
  h1("ACT 6 — What nobody asked about  (the opportunity sweep)");
  note("The four scenarios are reactive. This reads the whole portfolio unprompted.");

  const sweep = runOpportunitySweep();
  kv("Positions scanned", sweep.scanned.positions);
  kv("Findings", sweep.opportunities.length);
  kv("Value at risk", money(sweep.totalValueAtRisk));
  console.log();
  for (const o of sweep.opportunities.slice(0, 6)) {
    const tone = o.severity === "critical" ? C.red : o.severity === "high" ? C.amber : C.dim;
    console.log(`  ${tone}[${o.severity.toUpperCase()}]${C.reset} ${o.title}`);
    console.log(`      ${C.dim}${o.headline}${C.reset}`);
  }
  if (sweep.opportunities.length > 6) {
    note(`… and ${sweep.opportunities.length - 6} more. Full list on the Opportunities page.`);
  }

  // =========================================================================
  h1("SAFETY INVARIANTS — checked against the database, not the agent's claims");

  let violations = 0;
  for (const node of listNodes()) {
    const budget = getBudget(node.id);
    const free = budget ? budgetAvailable(budget) : 0;
    const slots = storageFreeSlots(node);
    const budgetOk = free >= 0;
    const storageOk = slots >= 0;
    if (!budgetOk || !storageOk) violations++;
    console.log(
      `  ${budgetOk && storageOk ? C.green + "✓" : C.red + "✗"}${C.reset} ${node.name.padEnd(22)}` +
        ` budget free ${money(free).padStart(12)}   slots free ${slots.toLocaleString().padStart(7)}`,
    );
  }

  const pos = listPos();
  console.log();
  kv("Purchase orders now", pos.length);
  kv("Audit entries", listAudit(500).length);
  kv("Invariant violations", violations === 0 ? `${C.green}0${C.reset}` : `${C.red}${violations}${C.reset}`);

  console.log();
  line("═");
  console.log(
    `${C.bold}Demo complete.${C.reset} ` +
      `${C.dim}npm run eval${C.reset} for the 9-case assertion suite, ` +
      `${C.dim}npm run dev${C.reset} for the UI.`,
  );
  line("═");
  console.log();

  if (violations > 0) process.exit(1);
}

main().catch((e) => {
  console.error(`\n${C.red}Demo failed:${C.reset}`, e);
  process.exit(1);
});
