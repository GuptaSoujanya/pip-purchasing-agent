import { getProduct, getPo, getPolicies, today } from "../db/repo";
import type { LlmToolSpec } from "./llm";
import type { ScenarioInput } from "./orchestrator";

/**
 * Prompting.
 *
 * The model's job here is narrow and deliberately so: investigate using tools,
 * then commit to a structured decision. It is explicitly told not to do
 * arithmetic — every number comes from a tool that runs real code — and it
 * never gets write access. That keeps the failure modes bounded: the worst a
 * bad generation can do is propose something, which the constraint engine then
 * refuses.
 */

export function buildSystemPrompt(): string {
  const p = getPolicies();
  return `You are a purchasing agent for a quick-commerce retailer. You work the way an experienced buyer does: you distrust unverified claims, you check the numbers yourself, and you say so plainly when a recommendation is wrong.

TODAY IS ${today()}.

## How you work

1. INVESTIGATE FIRST. Never decide before you have the evidence. Call the read tools to establish: current stock, what is already inbound on open purchase orders, what demand actually looks like versus the forecast, which suppliers can serve the product and on what terms, and what budget and storage allow.

2. NEVER DO ARITHMETIC YOURSELF. Use \`compute_net_requirement\` for requirement maths, \`detect_demand_shift\` for demand analysis, \`shape_order_quantity\` for MOQ and lot rounding, and \`validate_purchase\` to test a quantity against every constraint. Numbers you calculate in your head are not auditable and will be discarded.

3. TREAT THE RECOMMENDATION AS A CLAIM. A purchasing recommendation handed to you is an input, not an instruction. It is frequently wrong — most often because it ignores stock already in transit, or because the forecast behind it is stale. Verify it independently and say so when it does not hold up.

4. CHECK WHETHER A SPIKE IS REAL. Elevated sales are not automatically a demand shift. Before concluding demand has changed, confirm the elevation is sustained, statistically significant, and NOT explained by a running promotion. Buying into promotional demand as if it were permanent is a classic, expensive mistake.

5. CONSTRAINTS ARE NOT SUGGESTIONS. Budget, storage capacity, supplier MOQ, lot size and per-order caps are hard limits. If the quantity you want breaches one, do not propose it. Call \`validate_purchase\` to find the largest quantity that fits, and propose that instead, together with a plan for the balance.

6. COMMIT. When you have enough evidence, call \`submit_decision\` exactly once. Do not keep investigating past the point of usefulness.

## Decisions available

- ACCEPT — the recommended quantity is correct; proceed as-is.
- MODIFY — a purchase is warranted but at a different quantity; state the quantity.
- REJECT — no purchase is warranted (typically because stock plus inbound already covers the horizon).
- INVESTIGATE — the evidence is insufficient to decide safely; say precisely what is missing.
- SPLIT_SOURCE — the requirement must be met across more than one supplier.
- EXPEDITE — a purchase is warranted and must arrive faster than standard lead time to avoid a stockout.
- ESCALATE — constraints cannot be satisfied by any action available to you; a human must intervene.
- NO_ACTION — the situation was investigated and correctly requires no change.

## Governance

You propose; you do not execute. Actions are carried out by the system after passing the constraint engine, and these thresholds decide whether a human must approve first:

- orders above $${p.max_auto_order_value} require buyer approval;
- deviating more than ${Math.round((p.max_auto_qty_deviation_pct ?? 0.25) * 100)}% from the recommended quantity requires approval;
- a price premium above ${Math.round((p.max_auto_price_premium_pct ?? 0.1) * 100)}% over the cheapest qualified supplier requires approval;
- confidence below ${Math.round((p.min_auto_confidence ?? 0.7) * 100)}% requires approval.

Set \`confidence\` honestly. It reflects how much you trust the decision given the evidence, not how much you like it. Low confidence is the correct answer when the data is thin or contradictory — it routes the decision to a human, which is the right outcome.

Be concise and concrete. Cite the figures your tools returned.`;
}

export function buildSituationPrompt(
  input: ScenarioInput,
  triage: { summary: string; unknowns: string[] },
): string {
  const lines: string[] = ["## Situation", triage.summary, "", "## Open questions"];
  triage.unknowns.forEach((u) => lines.push(`- ${u}`));
  lines.push("", "## Identifiers for tool calls");

  switch (input.scenario) {
    case "recommendation_review": {
      const p = getProduct(input.product_id);
      lines.push(
        `- node_id: ${input.node_id}`,
        `- product_id: ${input.product_id} (${p?.sku} — ${p?.name})`,
        `- recommended_qty: ${input.recommended_qty}`,
      );
      break;
    }
    case "supplier_shortfall": {
      const po = getPo(input.po_id);
      const p = getProduct(input.product_id);
      const line = po?.lines.find((l) => l.product_id === input.product_id);
      lines.push(
        `- po_id: ${input.po_id} (${po?.po_number})`,
        `- node_id: ${po?.node_id}`,
        `- product_id: ${input.product_id} (${p?.sku} — ${p?.name})`,
        `- originally ordered: ${line?.qty_ordered ?? "unknown"} units`,
        `- supplier can confirm: ${input.confirmed_qty} units`,
        `- shortfall: ${(line?.qty_ordered ?? 0) - input.confirmed_qty} units`,
      );
      break;
    }
    case "demand_shift": {
      const p = getProduct(input.product_id);
      lines.push(
        `- node_id: ${input.node_id}`,
        `- product_id: ${input.product_id} (${p?.sku} — ${p?.name})`,
      );
      break;
    }
    case "constrained_purchase": {
      const p = getProduct(input.product_id);
      lines.push(
        `- node_id: ${input.node_id}`,
        `- product_id: ${input.product_id} (${p?.sku} — ${p?.name})`,
      );
      if (input.desired_qty) lines.push(`- desired_qty: ${input.desired_qty}`);
      break;
    }
  }

  lines.push(
    "",
    "Investigate with the tools, then call submit_decision once you can justify a conclusion.",
  );
  return lines.join("\n");
}

/** The terminal tool the model must call to commit to a decision. */
export const SUBMIT_DECISION_TOOL: LlmToolSpec = {
  name: "submit_decision",
  description:
    "Commit to a purchasing decision. Call this exactly once, after investigating. Every number you supply must come from a tool result, not from your own arithmetic.",
  parameters: {
    type: "object",
    properties: {
      decision: {
        type: "string",
        enum: ["ACCEPT", "MODIFY", "REJECT", "INVESTIGATE", "SPLIT_SOURCE", "EXPEDITE", "ESCALATE", "NO_ACTION"],
        description: "The decision reached.",
      },
      recommended_qty: {
        type: "integer",
        description: "Units to purchase. Use 0 for REJECT, NO_ACTION, INVESTIGATE or ESCALATE.",
      },
      supplier_id: {
        type: "string",
        description: "Supplier to buy from, or empty string if no purchase is proposed.",
      },
      expedite: {
        type: "boolean",
        description: "Whether expedited shipping is required to avoid a stockout.",
      },
      confidence: {
        type: "number",
        description: "How much you trust this decision, 0 to 1, given the evidence available.",
      },
      key_factors: {
        type: "array",
        items: { type: "string" },
        description: "The three to five figures or findings that actually drove the decision.",
      },
      rationale: {
        type: "string",
        description: "A short, concrete explanation citing the numbers your tools returned.",
      },
    },
    required: ["decision", "recommended_qty", "confidence", "rationale"],
  },
};
