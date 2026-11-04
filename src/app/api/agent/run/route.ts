import { NextResponse } from "next/server";
import { z } from "zod";
import { runAgent, type ScenarioInput } from "@/lib/agent/orchestrator";

export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("scenario", [
  z.object({
    scenario: z.literal("recommendation_review"),
    node_id: z.string(),
    product_id: z.string(),
    recommended_qty: z.number().int().min(0),
    supplier_id: z.string().optional(),
  }),
  z.object({
    scenario: z.literal("supplier_shortfall"),
    po_id: z.string(),
    product_id: z.string(),
    confirmed_qty: z.number().int().min(0),
    event_id: z.string().optional(),
  }),
  z.object({
    scenario: z.literal("demand_shift"),
    node_id: z.string(),
    product_id: z.string(),
  }),
  z.object({
    scenario: z.literal("constrained_purchase"),
    node_id: z.string(),
    product_id: z.string(),
    desired_qty: z.number().int().positive().optional(),
    supplier_id: z.string().optional(),
  }),
]);

const optsSchema = z.object({
  mode: z.enum(["llm", "deterministic", "auto"]).optional(),
  actor: z.string().optional(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const { mode, actor, ...rest } = (body ?? {}) as Record<string, unknown>;
  const parsed = schema.safeParse(rest);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid scenario input.", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const opts = optsSchema.safeParse({ mode, actor });

  try {
    const result = await runAgent(parsed.data as ScenarioInput, opts.success ? opts.data : {});
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
