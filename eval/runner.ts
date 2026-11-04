import { resumeApprovedAction, runAgent, type RunResult } from "../src/lib/agent/orchestrator";
import { resetSchema } from "../src/lib/db/client";
import {
  budgetAvailable,
  getBudget,
  getInventory,
  getNode,
  getSteps,
  getValidations,
  storageFreeSlots,
} from "../src/lib/db/repo";
import { seed } from "../src/lib/db/seed";
import type { EvalCase } from "./cases";

/**
 * Evaluation runner.
 *
 * Each case runs against a freshly rebuilt database so results are independent
 * and reproducible. Assertions are checked against three sources:
 *
 *   - the run result        (what the agent decided)
 *   - the recorded trace    (what it actually looked at, and whether it validated)
 *   - the database          (what the world looks like afterwards)
 *
 * The third source matters most. An agent can claim anything; the only honest
 * test is whether the operational world ended up in an acceptable state.
 */

export type CheckResult = {
  name: string;
  passed: boolean;
  detail: string;
};

export type CaseResult = {
  id: string;
  title: string;
  scenario: string;
  passed: boolean;
  checks: CheckResult[];
  decision: string;
  qty: number;
  status: string;
  confidence: number;
  summary: string;
  why: string;
  durationMs: number;
  error?: string;
};

function check(name: string, passed: boolean, detail: string): CheckResult {
  return { name, passed, detail };
}

export async function runCase(c: EvalCase, mode: "llm" | "deterministic"): Promise<CaseResult> {
  const started = Date.now();

  // Fresh world per case.
  const db = resetSchema();
  seed(db);

  const prevFaults = process.env.FAULT_INJECTION;
  if (c.disableFaults) process.env.FAULT_INJECTION = "off";

  const checks: CheckResult[] = [];
  let result: RunResult;

  try {
    result = await runAgent(c.input, { mode });
  } catch (e) {
    if (c.disableFaults) process.env.FAULT_INJECTION = prevFaults;
    return {
      id: c.id, title: c.title, scenario: c.scenario, passed: false,
      checks: [check("run completes", false, (e as Error).message)],
      decision: "-", qty: 0, status: "failed", confidence: 0,
      summary: "", why: c.assertions.why,
      durationMs: Date.now() - started, error: (e as Error).message,
    };
  }

  const a = c.assertions;
  let finalStatus: string = result.status;
  let drift = result.drift;
  let remediations = result.remediations;
  let executedPoIds = result.executedPoIds;

  // --- 1. Was the decision correct? --------------------------------------
  checks.push(check(
    "decision",
    a.expectDecision.includes(result.decision),
    `expected one of [${a.expectDecision.join(", ")}], got ${result.decision}`,
  ));

  if (a.expectQty) {
    const tol = a.expectQty.tolerance ?? 0;
    const diff = Math.abs(result.recommendedQty - a.expectQty.value);
    checks.push(check(
      "quantity",
      diff <= tol,
      `expected ${a.expectQty.value}${tol ? ` ±${tol}` : ""}, got ${result.recommendedQty}`,
    ));
  }

  if (a.expectSupplier) {
    checks.push(check(
      "supplier",
      result.supplierId === a.expectSupplier,
      `expected ${a.expectSupplier}, got ${result.supplierId}`,
    ));
  }

  // --- 2. Did the agent obtain the necessary information? ----------------
  const steps = getSteps(result.runId);
  const toolsCalled = new Set(steps.filter((s) => s.type === "tool_call").map((s) => s.tool_name!));
  if (a.requiredEvidence?.length) {
    const missing = a.requiredEvidence.filter((t) => !toolsCalled.has(t));
    checks.push(check(
      "evidence gathered",
      missing.length === 0,
      missing.length ? `never called: ${missing.join(", ")}` : `all ${a.requiredEvidence.length} required tools called`,
    ));
  }

  // --- 3. Did it respect relevant constraints? ---------------------------
  if (a.constraintsRespected?.length) {
    const v = result.validation;
    if (!v) {
      checks.push(check("constraints respected", false, "no pre-validation was recorded"));
    } else {
      const violated = a.constraintsRespected.filter((code) =>
        v.checks.some((chk) => chk.code === code && chk.severity === "hard" && !chk.passed),
      );
      const absent = a.constraintsRespected.filter((code) => !v.checks.some((chk) => chk.code === code));
      checks.push(check(
        "constraints respected",
        violated.length === 0 && absent.length === 0,
        violated.length ? `hard violations: ${violated.join(", ")}`
          : absent.length ? `constraints never evaluated: ${absent.join(", ")}`
          : `all of [${a.constraintsRespected.join(", ")}] evaluated and satisfied`,
      ));
    }
  }

  if (a.expectSoftWarnings?.length) {
    const soft = new Set(result.validation?.softWarnings.map((w) => w.code) ?? []);
    const missed = a.expectSoftWarnings.filter((w) => !soft.has(w));
    checks.push(check(
      "soft warnings surfaced",
      missed.length === 0,
      missed.length ? `expected warnings not raised: ${missed.join(", ")}` : `raised: ${[...soft].join(", ")}`,
    ));
  }

  // --- 4. Did it take the appropriate action? ----------------------------
  if (a.expectAutonomy?.length) {
    checks.push(check(
      "autonomy routing",
      !!result.autonomy && a.expectAutonomy.includes(result.autonomy.decision),
      `expected one of [${a.expectAutonomy.join(", ")}], got ${result.autonomy?.decision}`,
    ));
  }

  // Exercise the human-approval path where the case asks for it.
  if (c.autoApprove && result.approvalId && result.status === "awaiting_approval") {
    const resumed = await resumeApprovedAction(result.approvalId, "eval.buyer", "Auto-approved by evaluation harness.");
    finalStatus = resumed.status;
    drift = resumed.drift;
    remediations = resumed.remediations;
    executedPoIds = [...executedPoIds, ...resumed.executedPoIds];
    checks.push(check("approval executed", resumed.executedPoIds.length > 0,
      `approval ${result.approvalId} produced ${resumed.executedPoIds.length} purchase order(s)`));
  }

  if (a.expectStatus?.length) {
    checks.push(check(
      "final status",
      a.expectStatus.includes(finalStatus),
      `expected one of [${a.expectStatus.join(", ")}], got ${finalStatus}`,
    ));
  }

  // --- 5. Did it validate the result? ------------------------------------
  const validations = getValidations(result.runId);
  const hasPre = validations.some((v) => v.phase === "pre");
  const hasPost = validations.some((v) => v.phase === "post");

  if (a.expectPostValidation) {
    checks.push(check(
      "post-execution validation",
      hasPost,
      hasPost ? "agent re-read and validated the resulting purchase order" : "no post-execution validation recorded",
    ));
  }
  if (executedPoIds.length > 0) {
    checks.push(check(
      "pre-flight validation",
      hasPre,
      hasPre ? "constraints were checked before writing" : "a write occurred with no prior validation",
    ));
  }

  // --- 6. What happens when the initial action does not work? ------------
  if (a.expectDrift?.length) {
    const severity = drift?.severity ?? "none";
    checks.push(check(
      "drift classification",
      a.expectDrift.includes(severity),
      `expected one of [${a.expectDrift.join(", ")}], got ${severity}` +
        (drift ? ` — ${drift.summary}` : ""),
    ));
  }

  if (a.expectRemediationCount) {
    const ok = remediations.filter((r) => r.ok).length;
    checks.push(check(
      "self-correction",
      ok >= a.expectRemediationCount.min,
      `expected >= ${a.expectRemediationCount.min} successful corrective order(s), got ${ok}`,
    ));
  }

  // --- World state: the ground truth -------------------------------------
  if (a.expectWorldState) {
    const nodeId = "node_id" in c.input ? c.input.node_id : null;
    const productId = c.input.product_id;

    if (a.expectWorldState.minInboundUnits !== undefined && nodeId) {
      const inv = getInventory(nodeId, productId);
      const inbound = inv?.in_transit ?? 0;
      checks.push(check(
        "inbound stock",
        inbound >= a.expectWorldState.minInboundUnits,
        `in_transit is ${inbound}, expected >= ${a.expectWorldState.minInboundUnits}`,
      ));
    }
    if (a.expectWorldState.budgetNonNegative && nodeId) {
      const b = getBudget(nodeId);
      const avail = b ? budgetAvailable(b) : 0;
      checks.push(check("budget not overdrawn", avail >= 0, `available $${avail.toFixed(2)}`));
    }
    if (a.expectWorldState.storageNonNegative && nodeId) {
      const n = getNode(nodeId);
      const free = n ? storageFreeSlots(n) : 0;
      checks.push(check("storage not oversubscribed", free >= 0, `${free.toFixed(0)} slots free`));
    }
  }

  // --- Universal safety invariants, applied to every case ----------------
  const allNodes = ["NODE-BOG-01", "NODE-MED-02", "NODE-CTG-03"];
  const overdrawn = allNodes.filter((n) => {
    const b = getBudget(n);
    return b ? budgetAvailable(b) < 0 : false;
  });
  checks.push(check(
    "invariant: no budget overdrawn",
    overdrawn.length === 0,
    overdrawn.length ? `overdrawn at ${overdrawn.join(", ")}` : "all node budgets non-negative",
  ));

  const oversubscribed = allNodes.filter((n) => {
    const node = getNode(n);
    return node ? storageFreeSlots(node) < 0 : false;
  });
  checks.push(check(
    "invariant: no storage oversubscribed",
    oversubscribed.length === 0,
    oversubscribed.length ? `oversubscribed at ${oversubscribed.join(", ")}` : "all node storage within capacity",
  ));

  if (c.disableFaults) process.env.FAULT_INJECTION = prevFaults;

  return {
    id: c.id,
    title: c.title,
    scenario: c.scenario,
    passed: checks.every((k) => k.passed),
    checks,
    decision: result.decision,
    qty: result.recommendedQty,
    status: finalStatus,
    confidence: result.confidence,
    summary: result.summary,
    why: a.why,
    durationMs: Date.now() - started,
  };
}

export async function runAllCases(cases: EvalCase[], mode: "llm" | "deterministic") {
  const results: CaseResult[] = [];
  for (const c of cases) {
    results.push(await runCase(c, mode));
  }
  const totalChecks = results.reduce((s, r) => s + r.checks.length, 0);
  const passedChecks = results.reduce((s, r) => s + r.checks.filter((k) => k.passed).length, 0);
  return {
    mode,
    results,
    passed: results.filter((r) => r.passed).length,
    total: results.length,
    totalChecks,
    passedChecks,
  };
}
