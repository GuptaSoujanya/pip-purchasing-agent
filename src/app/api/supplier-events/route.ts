import { NextResponse } from "next/server";
import { z } from "zod";
import { getPo, insertSupplierEvent, listSupplierEvents } from "@/lib/db/repo";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    listSupplierEvents().map((e) => ({ ...e, payload: JSON.parse(e.payload_json) })),
  );
}

const schema = z.object({
  po_id: z.string(),
  product_id: z.string(),
  confirmable_qty: z.number().int().min(0),
  reason: z.string().default("Supply constrained at origin."),
});

/**
 * Simulate an inbound supplier message.
 *
 * This is the hook a real EDI / supplier-portal integration would call. It lets
 * the demo create new shortfall situations on the fly rather than only
 * replaying the seeded one.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload.", issues: parsed.error.issues }, { status: 400 });
  }

  const po = getPo(parsed.data.po_id);
  if (!po) return NextResponse.json({ error: `Purchase order ${parsed.data.po_id} not found.` }, { status: 404 });

  const line = po.lines.find((l) => l.product_id === parsed.data.product_id);
  if (!line) {
    return NextResponse.json(
      { error: `${po.po_number} has no line for ${parsed.data.product_id}.` },
      { status: 400 },
    );
  }

  const event = insertSupplierEvent({
    id: `EVT-${Date.now().toString(36).toUpperCase()}`,
    supplier_id: po.supplier_id,
    po_id: po.id,
    event_type: "partial_fulfilment",
    payload_json: JSON.stringify({
      product_id: parsed.data.product_id,
      ordered_qty: line.qty_ordered,
      confirmable_qty: parsed.data.confirmable_qty,
      reason: parsed.data.reason,
    }),
  });

  return NextResponse.json({ ...event, payload: JSON.parse(event.payload_json) });
}
