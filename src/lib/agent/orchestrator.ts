import {
  appendStep,
  createRun,
  finishRun,
  getApproval,
  getInventory,
  getPo,
  getPolicies,
  getProduct,
  getSteps,
  getSupplier,
  getSupplierProduct,
  markEventProcessed,
  recordValidation,
  resolveApproval,
} from "../db/repo";
import { evaluateAutonomy, pricePremium } from "../domain/autonomy";
import { validatePurchase, validateResultingPo } from "../domain/constraints";
import { round2 } from "../domain/math";
import {
  assessDemandShift,
  planConstrainedPurchase,
  resolveShortfall,
  reviewRecommendation,
  type PolicyOutcome,
} from "../domain/policy";
import type { DecisionKind, DriftReport, ProposedAction, RunStatus, ScenarioKey } from "../domain/types";
import { buildExpectation, planRemediation, verifyExpectation } from "./feedback";
import { getProvider, resolveProviderId, type LlmMessage, type LlmToolSpec } from "./llm";
import { buildSystemPrompt, buildSituationPrompt, SUBMIT_DECISION_TOOL } from "./prompt";
import { callTool, TOOLS, toolsAsJsonSchema, type ToolContext } from "./tools";

/**
 * Agent orchestrator.
 *
 * A six-phase state machine, not a chat loop:
 *
 *   TRIAGE        classify the situation and state what is unknown
 *   INVESTIGATE   gather evidence with read-only tools
 *   DECIDE        form a decision — LLM proposes, the policy engine cross-checks
 *   PRE-VALIDATE  push the decision through the constraint engine BEFORE writing
 *   ACT           execute, request approval, or escalate, per the autonomy policy
 *   POST-VALIDATE re-read the world, compare against the expectation contract,
 *                 and self-correct on material drift
 *
 * The phases are explicit because the interesting failures happen *between*
 * them: a decision that looked right but cannot execute, or an action that
 * executed but did not achieve what it claimed.
 */

export type ScenarioInput =
  | { scenario: "recommendation_review"; node_id: string; product_id: string; recommended_qty: number; supplier_id?: string }
  | { scenario: "supplier_shortfall"; po_id: string; product_id: string; confirmed_qty: number; event_id?: string }
  | { scenario: "demand_shift"; node_id: string; product_id: string }
  | { scenario: "constrained_purchase"; node_id: string; product_id: string; desired_qty?: number; supplier_id?: string };

export type RunOptions = {
  /** "llm" uses the model for investigation + proposal; "deterministic" uses the policy engine alone. */
  mode?: "llm" | "deterministic" | "auto";
  actor?: string;
  /** Skip the autonomy gate and execute directly. Used by the evaluation harness. */
  forceExecute?: boolean;
};

export type RunResult = {
  runId: string;
  scenario: ScenarioKey;
  mode: "llm" | "deterministic";
  status: RunStatus;
  decision: DecisionKind;
  confidence: number;
  summary: string;
  recommendedQty: number;
  supplierId: string | null;
  orderValue: number;
  rationale: string[];
  keyFactors: PolicyOutcome["keyFactors"];
  validation: PolicyOutcome["validation"];
  autonomy: ReturnType<typeof evaluateAutonomy> | null;
  approvalId: string | null;
  executedPoIds: string[];
  drift: DriftReport | null;
  remediations: { attempt: number; rationale: string; poId: string | null; ok: boolean }[];
  llmDivergence: { diverged: boolean; note: string } | null;
  policyOutcome: PolicyOutcome;
};

const MAX_INVESTIGATION_STEPS = Number(process.env.MAX_INVESTIGATION_STEPS ?? 10);

// ---------------------------------------------------------------------------
// Trace helper
// ---------------------------------------------------------------------------

class Trace {
  private seq: number;
  constructor(private runId: string) {
    // Continue numbering from any steps already recorded, so a run resumed
    // after human approval appends cleanly rather than colliding with itself.
    this.seq = getSteps(runId).reduce((max, s) => Math.max(max, s.seq), 0);
  }
  add(step: Omit<Parameters<typeof appendStep>[0], "run_id" | "seq">) {
    this.seq += 1;
    appendStep({ ...step, run_id: this.runId, seq: this.seq });
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runAgent(input: ScenarioInput, opts: RunOptions = {}): Promise<RunResult> {
  const requestedMode = opts.mode ?? "auto";
  const providerAvailable = resolveProviderId() !== "none";
  const mode: "llm" | "deterministic" =
    requestedMode === "llm" ? "llm"
    : requestedMode === "deterministic" ? "deterministic"
    : providerAvailable ? "llm" : "deterministic";

  const runId = `RUN-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const actor = opts.actor ?? "agent.purchasing";
  createRun({ id: runId, scenario: input.scenario, mode, input });

  const trace = new Trace(runId);
  const ctx: ToolContext = { runId, actor, allowWrites: true };

  try {
    // === PHASE 1 — TRIAGE =================================================
    const triage = describeSituation(input);
    trace.add({
      phase: "triage", type: "note",
      reasoning: triage.summary,
      output: { unknowns: triage.unknowns, scenario: input.scenario },
    });

    // === PHASE 2 — INVESTIGATE ============================================
    let llmProposal: LlmProposal | null = null;
    if (mode === "llm") {
      llmProposal = await investigateWithLlm(input, triage, trace, ctx);
    } else {
      gatherEvidenceDeterministically(input, trace, ctx);
    }

    // === PHASE 3 — DECIDE =================================================
    // The policy engine always runs. In LLM mode it acts as a cross-check:
    // the model's proposal is accepted only if it is constraint-legal and does
    // not diverge materially from what the data supports.
    const policy = runPolicyEngine(input);
    trace.add({
      phase: "decide", type: "decision",
      reasoning: `Policy engine: ${policy.decision} ${policy.recommendedQty} units` +
        (policy.supplierId ? ` from ${getSupplier(policy.supplierId)?.name}` : "") +
        ` at ${(policy.confidence * 100).toFixed(0)}% confidence.`,
      output: {
        decision: policy.decision,
        qty: policy.recommendedQty,
        supplier_id: policy.supplierId,
        confidence: policy.confidence,
        rationale: policy.rationale,
      },
    });

    let effective = policy;
    let divergence: RunResult["llmDivergence"] = null;

    if (llmProposal) {
      const reconciled = reconcile(policy, llmProposal, input);
      divergence = reconciled.divergence;
      effective = reconciled.outcome;
      trace.add({
        phase: "decide", type: "reasoning",
        reasoning: reconciled.divergence.note,
        output: {
          llm: {
            decision: llmProposal.decision, qty: llmProposal.recommended_qty,
            supplier_id: llmProposal.supplier_id, confidence: llmProposal.confidence,
          },
          policy: { decision: policy.decision, qty: policy.recommendedQty, supplier_id: policy.supplierId },
          accepted: reconciled.acceptedSource,
        },
      });
    }

    // === PHASE 4 — PRE-VALIDATE ===========================================
    const action = effective.action;
    let preValidation = effective.validation;

    if (action.kind === "create_po") {
      preValidation = validatePurchase({
        supplier_id: action.supplier_id, node_id: action.node_id,
        product_id: action.product_id, qty: action.qty,
        expedite: action.expedite, dailyDemand: effective.demandSignal.plannedDailyDemand,
      });
    }

    if (preValidation) {
      recordValidation(runId, "pre", preValidation.passed, preValidation.checks);
      trace.add({
        phase: "pre_validate", type: "validation",
        ok: preValidation.passed,
        reasoning: preValidation.passed
          ? `All ${preValidation.checks.filter((c) => c.severity === "hard").length} hard constraints satisfied` +
            (preValidation.softWarnings.length ? `; ${preValidation.softWarnings.length} soft warning(s): ${preValidation.softWarnings.map((w) => w.code).join(", ")}.` : " with no soft warnings.")
          : `Hard constraint failure: ${preValidation.hardFailures.map((f) => f.code).join(", ")}. Max feasible quantity ${preValidation.maxFeasibleQty}.`,
        output: preValidation,
      });
    }

    // === PHASE 5 — ACT ====================================================
    const orderValue = effective.orderValue;
    const deviation =
      input.scenario === "recommendation_review" && input.recommended_qty > 0
        ? (effective.recommendedQty - input.recommended_qty) / input.recommended_qty
        : undefined;

    const premium =
      action.kind === "create_po" ? pricePremium(action.supplier_id, action.product_id) : undefined;

    const autonomy = evaluateAutonomy({
      action,
      validation: preValidation ?? { passed: true, hardFailures: [], softWarnings: [], checks: [], maxFeasibleQty: 0, bindingConstraint: null },
      orderValue,
      confidence: effective.confidence,
      qtyDeviationPct: deviation,
      pricePremiumPct: premium,
      isNewSupplier: isNewSupplierForNode(action),
    });

    trace.add({
      phase: "act", type: "reasoning",
      reasoning: `Autonomy gate -> ${autonomy.decision} (${autonomy.riskLevel} risk). ${autonomy.reasons.join(" ")}`,
      output: autonomy,
    });

    const executedPoIds: string[] = [];
    let drift: DriftReport | null = null;
    const remediations: RunResult["remediations"] = [];
    let approvalId: string | null = null;
    let status: RunStatus = "completed";

    const shouldExecute = opts.forceExecute || autonomy.decision === "auto_execute";

    if (autonomy.decision === "escalate" && !opts.forceExecute) {
      const res = callTool("escalate_to_buyer", {
        reason: autonomy.headline,
        blocking_constraints: preValidation?.hardFailures.map((f) => `${f.code}: ${f.detail}`) ?? [],
        options_considered: effective.alternatives.map((a) => `${a.supplierName}: ${a.note}`),
      }, ctx);
      approvalId = (res.data as any)?.escalation_id ?? null;
      status = "escalated";
      trace.add({
        phase: "escalate", type: "tool_call", tool_name: "escalate_to_buyer",
        ok: res.ok, output: res.data ?? res.error,
        reasoning: "Situation handed to a buyer — the agent cannot resolve it within its constraints.",
      });
    } else if (!shouldExecute) {
      // Park the fully-specified action so approval can execute it verbatim.
      const res = callTool("request_human_approval", {
        action: {
          ...action,
          _context: {
            runId,
            dailyDemand: effective.demandSignal.plannedDailyDemand,
            followUps: effective.followUpActions,
            orderValue,
          },
        },
        reason: autonomy.reasons.join(" "),
        risk_level: autonomy.riskLevel,
      }, ctx);
      approvalId = (res.data as any)?.approval_id ?? null;
      status = "awaiting_approval";
      trace.add({
        phase: "act", type: "tool_call", tool_name: "request_human_approval",
        ok: res.ok, output: res.data ?? res.error,
        reasoning: `Held for buyer approval: ${autonomy.headline}`,
      });
    } else {
      const outcome = await executeAndVerify({
        runId, trace, ctx,
        action,
        followUps: effective.followUpActions,
        dailyDemand: effective.demandSignal.plannedDailyDemand,
      });
      executedPoIds.push(...outcome.poIds);
      drift = outcome.drift;
      remediations.push(...outcome.remediations);
      status = outcome.status;
    }

    // Mark the originating supplier message as handled.
    if (input.scenario === "supplier_shortfall" && input.event_id) {
      markEventProcessed(input.event_id);
    }

    const summary = buildSummary(effective, autonomy, drift, remediations, status);
    finishRun(runId, {
      status, decision: effective.decision,
      confidence: effective.confidence, summary,
    });

    return {
      runId, scenario: input.scenario, mode, status,
      decision: effective.decision,
      confidence: effective.confidence,
      summary,
      recommendedQty: effective.recommendedQty,
      supplierId: effective.supplierId,
      orderValue,
      rationale: effective.rationale,
      keyFactors: effective.keyFactors,
      validation: preValidation,
      autonomy, approvalId, executedPoIds, drift, remediations,
      llmDivergence: divergence,
      policyOutcome: policy,
    };
  } catch (err) {
    const message = (err as Error).message;
    trace.add({ phase: "escalate", type: "note", ok: false, reasoning: `Run failed: ${message}` });
    finishRun(runId, { status: "failed", summary: message });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// PHASE 5/6 — execute, verify, self-correct
// ---------------------------------------------------------------------------

async function executeAndVerify(args: {
  runId: string;
  trace: Trace;
  ctx: ToolContext;
  action: ProposedAction;
  followUps: ProposedAction[];
  dailyDemand: number;
}): Promise<{ poIds: string[]; drift: DriftReport | null; remediations: RunResult["remediations"]; status: RunStatus }> {
  const { trace, ctx, action, followUps, dailyDemand } = args;
  const poIds: string[] = [];
  const remediations: RunResult["remediations"] = [];

  if (action.kind === "no_action") {
    trace.add({
      phase: "act", type: "note",
      reasoning: `No action taken: ${action.reason}`,
    });
    return { poIds, drift: null, remediations, status: "completed" };
  }

  if (action.kind === "escalate") {
    const res = callTool("escalate_to_buyer", { reason: action.reason, blocking_constraints: [], options_considered: [] }, ctx);
    trace.add({ phase: "escalate", type: "tool_call", tool_name: "escalate_to_buyer", ok: res.ok, output: res.data ?? res.error });
    return { poIds, drift: null, remediations, status: "escalated" };
  }

  // --- Follow-ups that must land first (e.g. amend the short-shipped PO) ---
  for (const f of followUps.filter((x) => x.kind === "amend_po" || x.kind === "cancel_po")) {
    const res = executeAction(f, dailyDemand, ctx);
    trace.add({
      phase: "act", type: "tool_call", tool_name: toolNameFor(f),
      input: f, output: res.data ?? res.error, ok: res.ok,
      reasoning: f.kind === "amend_po"
        ? `Amended ${f.po_id} to ${f.new_qty} units — ${f.reason}`
        : `Cancelled ${(f as any).po_id}.`,
    });
  }

  if (action.kind === "amend_po" || action.kind === "cancel_po") {
    const res = executeAction(action, dailyDemand, ctx);
    trace.add({
      phase: "act", type: "tool_call", tool_name: toolNameFor(action),
      input: action, output: res.data ?? res.error, ok: res.ok,
    });
    if (res.ok && "po_id" in action) poIds.push(action.po_id);
    return { poIds, drift: null, remediations, status: res.ok ? "completed" : "failed" };
  }

  // --- PHASE 5: the main purchase ----------------------------------------
  const sp = getSupplierProduct(action.supplier_id, action.product_id);
  const unitPrice = sp ? sp.unit_price * (action.expedite ? 1 + sp.expedite_surcharge_pct / 100 : 1) : 0;

  // Write the expectation contract BEFORE acting.
  const expectation = buildExpectation({
    action, nodeId: action.node_id, productId: action.product_id,
    dailyDemand, expectedQty: action.qty, expectedUnitPrice: unitPrice,
  });
  trace.add({
    phase: "act", type: "note",
    reasoning: `Expectation contract — ${expectation.description}`,
    output: expectation,
  });

  const res = executeAction(action, dailyDemand, ctx);
  trace.add({
    phase: "act", type: "tool_call", tool_name: "create_purchase_order",
    input: action, output: res.data ?? res.error, ok: res.ok,
    reasoning: res.ok
      ? `Submitted order for ${action.qty} units to ${getSupplier(action.supplier_id)?.name}.`
      : `Order submission failed: ${res.error}`,
  });

  if (!res.ok) {
    const esc = callTool("escalate_to_buyer", {
      reason: `Purchase order could not be created: ${res.error}`,
      blocking_constraints: [res.error ?? ""], options_considered: [],
    }, ctx);
    trace.add({ phase: "escalate", type: "tool_call", tool_name: "escalate_to_buyer", ok: esc.ok, output: esc.data });
    return { poIds, drift: null, remediations, status: "escalated" };
  }

  const created = res.data as { po_id: string; confirmed_qty: number; supplier_message: string };
  poIds.push(created.po_id);

  // --- PHASE 6: POST-VALIDATE ---------------------------------------------
  // Independent re-read of the world, not the write tool's own report.
  const structural = validateResultingPo({
    po_id: created.po_id, node_id: action.node_id, product_id: action.product_id,
    dailyDemand, expectedQty: action.qty,
  });
  recordValidation(args.runId, "post", structural.passed, structural.checks);

  const drift = verifyExpectation({
    expectation, poId: created.po_id,
    nodeId: action.node_id, productId: action.product_id, dailyDemand,
  });

  trace.add({
    phase: "post_validate", type: "drift",
    ok: drift.severity === "none" || drift.severity === "benign",
    reasoning: drift.summary,
    output: { drift, structuralChecks: structural.checks, supplierMessage: created.supplier_message },
  });

  let status: RunStatus = "completed";

  // --- Self-correction ----------------------------------------------------
  if (drift.severity === "material") {
    const maxAttempts = getPolicies().max_remediation_attempts ?? 2;
    let attempt = 1;
    let failedSupplier = action.supplier_id;
    let shortfall = action.qty - created.confirmed_qty;
    let resolved = false;

    while (attempt <= maxAttempts && !resolved) {
      const plan = planRemediation({
        nodeId: action.node_id, productId: action.product_id,
        dailyDemand, failedSupplierId: failedSupplier,
        shortfallQty: shortfall, attempt, maxAttempts,
      });

      trace.add({
        phase: "remediate", type: "reasoning",
        reasoning: plan.rationale,
        output: { attempt, possible: plan.possible, plan: plan.action },
      });

      if (!plan.possible || !plan.action) {
        // Either nothing more is needed, or nothing more is possible.
        resolved = plan.rationale.includes("no outstanding requirement");
        if (!resolved) {
          const esc = callTool("escalate_to_buyer", {
            reason: `Self-correction exhausted after ${attempt - 1} attempt(s): ${plan.rationale}`,
            blocking_constraints: [], options_considered: [plan.rationale],
          }, ctx);
          trace.add({ phase: "escalate", type: "tool_call", tool_name: "escalate_to_buyer", ok: esc.ok, output: esc.data });
          status = "escalated";
        }
        break;
      }

      const rem = plan.action as Extract<ProposedAction, { kind: "create_po" }>;
      const remExpectation = buildExpectation({
        action: rem, nodeId: rem.node_id, productId: rem.product_id,
        dailyDemand, expectedQty: rem.qty, expectedUnitPrice: plan.unitPrice ?? 0,
      });

      const remRes = executeAction(rem, dailyDemand, ctx);
      trace.add({
        phase: "remediate", type: "tool_call", tool_name: "create_purchase_order",
        input: rem, output: remRes.data ?? remRes.error, ok: remRes.ok,
        reasoning: `Corrective order attempt ${attempt}: ${rem.qty} units from ${getSupplier(rem.supplier_id)?.name}.`,
      });

      if (!remRes.ok) {
        remediations.push({ attempt, rationale: plan.rationale, poId: null, ok: false });
        attempt += 1;
        continue;
      }

      const remCreated = remRes.data as { po_id: string; confirmed_qty: number };
      poIds.push(remCreated.po_id);

      const remDrift = verifyExpectation({
        expectation: remExpectation, poId: remCreated.po_id,
        nodeId: rem.node_id, productId: rem.product_id, dailyDemand,
      });
      trace.add({
        phase: "post_validate", type: "drift",
        ok: remDrift.severity === "none" || remDrift.severity === "benign",
        reasoning: `Corrective order verification — ${remDrift.summary}`,
        output: remDrift,
      });

      remediations.push({ attempt, rationale: plan.rationale, poId: remCreated.po_id, ok: true });

      if (remDrift.severity === "none" || remDrift.severity === "benign") {
        resolved = true;
      } else {
        failedSupplier = rem.supplier_id;
        shortfall = rem.qty - remCreated.confirmed_qty;
        attempt += 1;
      }
    }

    if (!resolved && status !== "escalated") {
      const esc = callTool("escalate_to_buyer", {
        reason: `Material drift remains after ${maxAttempts} self-correction attempt(s).`,
        blocking_constraints: [], options_considered: remediations.map((r) => r.rationale),
      }, ctx);
      trace.add({ phase: "escalate", type: "tool_call", tool_name: "escalate_to_buyer", ok: esc.ok, output: esc.data });
      status = "escalated";
    }
  } else if (drift.severity === "critical") {
    const esc = callTool("escalate_to_buyer", {
      reason: `Critical drift after execution: ${drift.summary}`,
      blocking_constraints: drift.findings.filter((f) => f.severity === "critical").map((f) => f.note),
      options_considered: [],
    }, ctx);
    trace.add({ phase: "escalate", type: "tool_call", tool_name: "escalate_to_buyer", ok: esc.ok, output: esc.data });
    status = "escalated";
  }

  // --- Remaining follow-ups (e.g. overflow order at a sibling node) -------
  for (const f of followUps.filter((x) => x.kind === "create_po")) {
    const fRes = executeAction(f, dailyDemand, ctx);
    trace.add({
      phase: "act", type: "tool_call", tool_name: "create_purchase_order",
      input: f, output: fRes.data ?? fRes.error, ok: fRes.ok,
      reasoning: `Follow-up order: ${f.reason}`,
    });
    if (fRes.ok) poIds.push((fRes.data as any).po_id);
  }

  return { poIds, drift, remediations, status };
}

function executeAction(action: ProposedAction, dailyDemand: number, ctx: ToolContext) {
  switch (action.kind) {
    case "create_po":
      return callTool("create_purchase_order", {
        supplier_id: action.supplier_id, node_id: action.node_id,
        product_id: action.product_id, qty: action.qty,
        daily_demand: dailyDemand, expedite: action.expedite ?? false,
        reason: action.reason,
      }, ctx);
    case "amend_po":
      return callTool("amend_purchase_order", {
        po_id: action.po_id, product_id: action.product_id,
        new_qty: action.new_qty, reason: action.reason,
      }, ctx);
    case "cancel_po":
      return callTool("cancel_purchase_order", { po_id: action.po_id, reason: action.reason }, ctx);
    default:
      return { ok: true, data: { noop: true } };
  }
}

function toolNameFor(a: ProposedAction) {
  return a.kind === "create_po" ? "create_purchase_order"
    : a.kind === "amend_po" ? "amend_purchase_order"
    : a.kind === "cancel_po" ? "cancel_purchase_order"
    : "none";
}

// ---------------------------------------------------------------------------
// Approval resumption — a human unblocks a parked action
// ---------------------------------------------------------------------------

export async function resumeApprovedAction(approvalId: string, resolvedBy: string, note?: string) {
  const approval = getApproval(approvalId);
  if (!approval) throw new Error(`Approval ${approvalId} not found.`);
  if (approval.status !== "pending") throw new Error(`Approval ${approvalId} is already ${approval.status}.`);

  resolveApproval(approvalId, "approved", resolvedBy, note);

  const parsed = JSON.parse(approval.action_json) as ProposedAction & {
    _context?: { runId: string; dailyDemand: number; followUps: ProposedAction[] };
  };
  const context = parsed._context;
  const runId = approval.run_id;
  const trace = new Trace(runId);
  const ctx: ToolContext = { runId, actor: resolvedBy, allowWrites: true };

  trace.add({
    phase: "act", type: "note",
    reasoning: `Buyer ${resolvedBy} approved the parked action${note ? `: "${note}"` : "."} Resuming execution.`,
    output: { approvalId, resolvedBy },
  });

  const { _context, ...action } = parsed as any;
  const outcome = await executeAndVerify({
    runId, trace, ctx,
    action: action as ProposedAction,
    followUps: context?.followUps ?? [],
    dailyDemand: context?.dailyDemand ?? 0,
  });

  finishRun(runId, {
    status: outcome.status,
    decision: null,
    summary: outcome.drift
      ? `Executed after approval. ${outcome.drift.summary}`
      : "Executed after approval; outcome matched expectation.",
  });

  return {
    runId, approvalId, status: outcome.status,
    executedPoIds: outcome.poIds,
    drift: outcome.drift,
    remediations: outcome.remediations,
  };
}

export function rejectAction(approvalId: string, resolvedBy: string, note?: string) {
  const approval = getApproval(approvalId);
  if (!approval) throw new Error(`Approval ${approvalId} not found.`);
  resolveApproval(approvalId, "rejected", resolvedBy, note);
  const trace = new Trace(approval.run_id);
  trace.add({
    phase: "act", type: "note", ok: false,
    reasoning: `Buyer ${resolvedBy} rejected the proposed action${note ? `: "${note}"` : "."} No purchase was made.`,
  });
  finishRun(approval.run_id, { status: "completed", summary: `Rejected by ${resolvedBy}. No action taken.` });
  return { approvalId, status: "rejected" as const };
}

// ---------------------------------------------------------------------------
// Policy engine dispatch
// ---------------------------------------------------------------------------

function runPolicyEngine(input: ScenarioInput): PolicyOutcome {
  switch (input.scenario) {
    case "recommendation_review":
      return reviewRecommendation({
        nodeId: input.node_id, productId: input.product_id,
        recommendedQty: input.recommended_qty, supplierId: input.supplier_id,
      });
    case "supplier_shortfall":
      return resolveShortfall({
        poId: input.po_id, productId: input.product_id, confirmedQty: input.confirmed_qty,
      });
    case "demand_shift":
      return assessDemandShift({ nodeId: input.node_id, productId: input.product_id });
    case "constrained_purchase":
      return planConstrainedPurchase({
        nodeId: input.node_id, productId: input.product_id,
        desiredQty: input.desired_qty, supplierId: input.supplier_id,
      });
  }
}

// ---------------------------------------------------------------------------
// Triage
// ---------------------------------------------------------------------------

function describeSituation(input: ScenarioInput): { summary: string; unknowns: string[] } {
  switch (input.scenario) {
    case "recommendation_review": {
      const p = getProduct(input.product_id);
      return {
        summary:
          `Purchasing system recommends ${input.recommended_qty} units of ${p?.sku ?? input.product_id} ` +
          `(${p?.name}) for ${input.node_id}. The recommendation is a claim, not a fact — it must be verified ` +
          `against stock, inbound supply, demand, supplier terms, budget and storage before acting.`,
        unknowns: [
          "What is the true net requirement, independent of the recommendation?",
          "Is any stock already inbound that the recommendation ignored?",
          "Is the forecast still consistent with recent actual sales?",
          "Do supplier MOQ/lot terms, budget or storage permit the recommended quantity?",
        ],
      };
    }
    case "supplier_shortfall": {
      const po = getPo(input.po_id);
      const line = po?.lines.find((l) => l.product_id === input.product_id);
      return {
        summary:
          `Supplier has confirmed only ${input.confirmed_qty} of ${line?.qty_ordered ?? "?"} units on ${po?.po_number ?? input.po_id}. ` +
          `The gap may or may not matter — that depends on the current stock position, not on the size of the shortfall.`,
        unknowns: [
          "After the partial delivery, is there still an unmet requirement?",
          "How long until stock runs out at the current demand rate?",
          "Which alternate suppliers carry this product, and can any deliver in time?",
          "What price premium and reliability trade-off does switching involve?",
        ],
      };
    }
    case "demand_shift": {
      const p = getProduct(input.product_id);
      return {
        summary:
          `Actual sales for ${p?.sku ?? input.product_id} at ${input.node_id} appear to have diverged from forecast. ` +
          `Before changing the purchasing plan, the divergence must be shown to be real and sustained rather than noise or a promotion.`,
        unknowns: [
          "Is the elevation statistically significant versus the prior period?",
          "Has it been sustained for enough consecutive days to rule out a blip?",
          "Is there an active promotion that fully explains it?",
          "Does existing inventory plus inbound supply still cover the revised demand?",
        ],
      };
    }
    case "constrained_purchase": {
      const p = getProduct(input.product_id);
      return {
        summary:
          `Replenishment is indicated for ${p?.sku ?? input.product_id} at ${input.node_id}, but one or more constraints ` +
          `may block the purchase. The task is to find the best executable action, not to force the original quantity through.`,
        unknowns: [
          "Which constraint actually binds — budget, storage, MOQ or supplier capacity?",
          "What is the largest quantity that satisfies every hard constraint at once?",
          "Can the balance be deferred, split, or redirected to another node?",
        ],
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Deterministic evidence gathering (no LLM)
// ---------------------------------------------------------------------------

function gatherEvidenceDeterministically(input: ScenarioInput, trace: Trace, ctx: ToolContext) {
  const nodeId = "node_id" in input ? input.node_id : getPo(input.po_id)?.node_id ?? "";
  const productId = input.product_id;

  const plan: { tool: string; args: Record<string, unknown> }[] = [
    { tool: "get_inventory", args: { node_id: nodeId, product_id: productId } },
    { tool: "get_forecast", args: { node_id: nodeId, product_id: productId } },
    { tool: "get_demand_history", args: { node_id: nodeId, product_id: productId, days: 35 } },
    { tool: "detect_demand_shift", args: { node_id: nodeId, product_id: productId } },
    { tool: "get_active_promotions", args: { node_id: nodeId, product_id: productId } },
    { tool: "get_open_purchase_orders", args: { node_id: nodeId, product_id: productId } },
    { tool: "list_supplier_options", args: { product_id: productId } },
    { tool: "get_budget", args: { node_id: nodeId } },
    { tool: "get_storage_capacity", args: { node_id: nodeId } },
  ];
  if (input.scenario === "supplier_shortfall") {
    plan.unshift({ tool: "get_purchase_order", args: { po_id: input.po_id } });
  }

  for (const step of plan) {
    const started = Date.now();
    const res = callTool(step.tool, step.args, ctx);
    trace.add({
      phase: "investigate", type: "tool_call", tool_name: step.tool,
      input: step.args, output: res.data ?? res.error, ok: res.ok,
      duration_ms: Date.now() - started,
    });
  }
}

// ---------------------------------------------------------------------------
// LLM-driven investigation
// ---------------------------------------------------------------------------

export type LlmProposal = {
  decision: DecisionKind;
  recommended_qty: number;
  supplier_id: string | null;
  expedite: boolean;
  confidence: number;
  key_factors: string[];
  rationale: string;
};

async function investigateWithLlm(
  input: ScenarioInput,
  triage: { summary: string; unknowns: string[] },
  trace: Trace,
  ctx: ToolContext,
): Promise<LlmProposal | null> {
  const provider = getProvider();
  if (!provider) return null;

  // Read-only tools during investigation. Writes are the orchestrator's job,
  // gated by the autonomy policy — the model never writes directly.
  const readTools: LlmToolSpec[] = toolsAsJsonSchema().filter((t) =>
    TOOLS.find((x) => x.name === t.name)?.kind === "read",
  ) as LlmToolSpec[];
  const tools = [...readTools, SUBMIT_DECISION_TOOL];

  const messages: LlmMessage[] = [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: buildSituationPrompt(input, triage) },
  ];

  for (let i = 0; i < MAX_INVESTIGATION_STEPS; i++) {
    let res;
    try {
      res = await provider.chat(messages, tools);
    } catch (e) {
      trace.add({
        phase: "investigate", type: "note", ok: false,
        reasoning: `LLM provider "${provider.id}" failed (${(e as Error).message}). Falling back to the deterministic policy engine.`,
      });
      return null;
    }

    if (res.text?.trim()) {
      trace.add({ phase: "investigate", type: "reasoning", reasoning: res.text.trim() });
    }

    if (!res.toolCalls.length) {
      trace.add({
        phase: "investigate", type: "note",
        reasoning: "Model produced no tool call; ending investigation and deferring to the policy engine.",
      });
      return null;
    }

    const assistantMsg: LlmMessage = { role: "assistant", content: res.text ?? "", toolCalls: res.toolCalls };
    messages.push(assistantMsg);

    for (const call of res.toolCalls) {
      if (call.name === "submit_decision") {
        const proposal = call.args as unknown as LlmProposal;
        trace.add({
          phase: "decide", type: "decision",
          reasoning: `Model proposes ${proposal.decision}` +
            (proposal.recommended_qty ? ` of ${proposal.recommended_qty} units` : "") +
            ` at ${Math.round((proposal.confidence ?? 0) * 100)}% confidence. ${proposal.rationale ?? ""}`,
          output: proposal,
        });
        return proposal;
      }

      const started = Date.now();
      const result = callTool(call.name, call.args, { ...ctx, allowWrites: false });
      trace.add({
        phase: "investigate", type: "tool_call", tool_name: call.name,
        input: call.args, output: result.data ?? result.error, ok: result.ok,
        duration_ms: Date.now() - started,
      });
      messages.push({
        role: "tool", toolCallId: call.id, name: call.name,
        content: JSON.stringify(result.ok ? result.data : { error: result.error }).slice(0, 12_000),
      });
    }
  }

  trace.add({
    phase: "investigate", type: "note",
    reasoning: `Investigation budget of ${MAX_INVESTIGATION_STEPS} steps exhausted without a decision; deferring to the policy engine.`,
  });
  return null;
}

// ---------------------------------------------------------------------------
// Reconciliation — LLM proposes, the deterministic engine disposes
// ---------------------------------------------------------------------------

function reconcile(
  policy: PolicyOutcome,
  proposal: LlmProposal,
  input: ScenarioInput,
): { outcome: PolicyOutcome; divergence: { diverged: boolean; note: string }; acceptedSource: "llm" | "policy" } {
  const DIVERGENCE_TOLERANCE = 0.15;

  // No purchase on either side — nothing to reconcile.
  if (policy.action.kind !== "create_po" || !proposal.supplier_id || !proposal.recommended_qty) {
    const agrees = proposal.decision === policy.decision;
    return {
      outcome: policy,
      acceptedSource: "policy",
      divergence: {
        diverged: !agrees,
        note: agrees
          ? `Model and policy engine agree on ${policy.decision}; no quantity to reconcile.`
          : `Model proposed ${proposal.decision} while the policy engine computed ${policy.decision}. ` +
            `The policy engine's conclusion is authoritative here because it is derived directly from the data; ` +
            `the divergence is recorded for review.`,
      },
    };
  }

  // The model's own proposal must survive the constraint engine.
  const proposedValidation = validatePurchase({
    supplier_id: proposal.supplier_id,
    node_id: policy.action.node_id,
    product_id: policy.action.product_id,
    qty: proposal.recommended_qty,
    expedite: proposal.expedite,
    dailyDemand: policy.demandSignal.plannedDailyDemand,
  });

  if (!proposedValidation.passed) {
    return {
      outcome: policy,
      acceptedSource: "policy",
      divergence: {
        diverged: true,
        note:
          `Model proposed ${proposal.recommended_qty} units from ${proposal.supplier_id}, but that breaches ` +
          `${proposedValidation.hardFailures.map((f) => f.code).join(", ")}. Overridden with the policy engine's ` +
          `constraint-legal quantity of ${policy.recommendedQty}.`,
      },
    };
  }

  const delta = Math.abs(proposal.recommended_qty - policy.recommendedQty) /
    Math.max(1, policy.recommendedQty);

  if (delta > DIVERGENCE_TOLERANCE) {
    return {
      // Keep the policy quantity, but carry the model's lower confidence so the
      // autonomy gate routes the disagreement to a human.
      outcome: { ...policy, confidence: round2(Math.min(policy.confidence, 0.65)) },
      acceptedSource: "policy",
      divergence: {
        diverged: true,
        note:
          `Model proposed ${proposal.recommended_qty} units; the policy engine computed ${policy.recommendedQty} ` +
          `(${Math.round(delta * 100)}% apart, beyond the ${DIVERGENCE_TOLERANCE * 100}% tolerance). ` +
          `Proceeding with the policy quantity and lowering confidence so the decision is reviewed by a buyer.`,
      },
    };
  }

  // Agreement: adopt the model's narrative, keep the engine's arithmetic.
  return {
    outcome: {
      ...policy,
      rationale: [...policy.rationale, `Model assessment: ${proposal.rationale}`],
      keyFactors: [
        ...policy.keyFactors,
        ...(proposal.key_factors ?? []).slice(0, 3).map((f) => ({
          label: "Model note", value: f, impact: "neutral" as const,
        })),
      ],
    },
    acceptedSource: "llm",
    divergence: {
      diverged: false,
      note:
        `Model and policy engine agree within ${Math.round(delta * 100)}% ` +
        `(${proposal.recommended_qty} vs ${policy.recommendedQty}). Proceeding with the validated quantity.`,
    },
  };
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

function isNewSupplierForNode(action: ProposedAction): boolean {
  if (action.kind !== "create_po") return false;
  const sp = getSupplierProduct(action.supplier_id, action.product_id);
  // "New" here means not the preferred/contracted source for this product.
  return !sp?.is_preferred;
}

function buildSummary(
  outcome: PolicyOutcome,
  autonomy: ReturnType<typeof evaluateAutonomy>,
  drift: DriftReport | null,
  remediations: RunResult["remediations"],
  status: RunStatus,
): string {
  const parts: string[] = [];
  parts.push(
    outcome.action.kind === "create_po"
      ? `${outcome.decision}: order ${outcome.recommendedQty} units from ${getSupplier(outcome.supplierId ?? "")?.name ?? outcome.supplierId} ($${outcome.orderValue.toFixed(2)}).`
      : outcome.action.kind === "amend_po"
        ? `${outcome.decision}: amend ${outcome.action.po_id} to ${outcome.action.new_qty} units.`
        : `${outcome.decision}: ${outcome.action.reason}`,
  );

  if (status === "awaiting_approval") parts.push(`Held for buyer approval — ${autonomy.headline}`);
  if (status === "escalated") parts.push("Escalated to a buyer.");

  if (drift && drift.severity !== "none") {
    parts.push(`Post-execution check: ${drift.summary}`);
  }
  if (remediations.length) {
    const good = remediations.filter((r) => r.ok).length;
    parts.push(`${good} corrective order(s) placed to close the gap.`);
  }
  return parts.join(" ");
}

export { runPolicyEngine };
