import { getSupplier, getSupplierProduct } from "../db/repo";

/**
 * Mock external supplier gateway.
 *
 * Stands in for the EDI / supplier-portal integration a real buyer would hit.
 * Critically, it is NOT a rubber stamp: suppliers here push back, silently cap
 * quantities, and occasionally reject orders outright.
 *
 * This is deliberate. An agent that only ever sees happy-path responses has no
 * feedback loop worth testing. These faults are what the post-execution
 * validation and remediation logic exist to catch.
 */

export type SubmitOrderRequest = {
  supplier_id: string;
  product_id: string;
  qty: number;
  expedite?: boolean;
  po_number: string;
};

export type SubmitOrderResponse = {
  accepted: boolean;
  confirmedQty: number;
  unitPrice: number;
  leadTimeDays: number;
  /** Supplier-side message explaining any deviation. */
  message: string;
  faultInjected: string | null;
};

/**
 * Per-supplier behavioural quirks. Keyed by supplier id.
 *
 * SUP-03 (Andes Beverage Collective) is the interesting one: it silently caps
 * every order at 400 units regardless of what was agreed. The agent only finds
 * out by re-reading the order after submission.
 */
const SUPPLIER_BEHAVIOUR: Record<
  string,
  (req: SubmitOrderRequest) => Partial<SubmitOrderResponse> | null
> = {
  "SUP-03": (req) => {
    const CAP = 400;
    if (req.qty > CAP) {
      return {
        accepted: true,
        confirmedQty: CAP,
        message: `Allocation limit reached: only ${CAP} units can be released this cycle (requested ${req.qty}).`,
        faultInjected: "SILENT_QTY_CAP",
      };
    }
    return null;
  },

  "SUP-05": (req) => {
    // Rejects expedite requests it cannot actually service.
    if (req.expedite) {
      return {
        accepted: false,
        confirmedQty: 0,
        message: "Expedited shipping is not available for this lane at present.",
        faultInjected: "EXPEDITE_REJECTED",
      };
    }
    return null;
  },
};

/** Set FAULT_INJECTION=off to make every supplier behave perfectly. */
const faultsEnabled = () => (process.env.FAULT_INJECTION ?? "on") !== "off";

export function submitOrder(req: SubmitOrderRequest): SubmitOrderResponse {
  const supplier = getSupplier(req.supplier_id);
  const sp = getSupplierProduct(req.supplier_id, req.product_id);

  if (!supplier || !sp) {
    return {
      accepted: false, confirmedQty: 0, unitPrice: 0, leadTimeDays: 0,
      message: `Supplier ${req.supplier_id} cannot supply ${req.product_id}.`,
      faultInjected: null,
    };
  }
  if (!supplier.active) {
    return {
      accepted: false, confirmedQty: 0, unitPrice: sp.unit_price, leadTimeDays: sp.lead_time_days,
      message: `${supplier.name} is not accepting orders.`, faultInjected: null,
    };
  }

  const unitPrice = sp.unit_price * (req.expedite ? 1 + sp.expedite_surcharge_pct / 100 : 1);
  const leadTimeDays =
    req.expedite && sp.expedite_available ? (sp.expedite_lead_time_days ?? sp.lead_time_days) : sp.lead_time_days;

  const base: SubmitOrderResponse = {
    accepted: true,
    confirmedQty: req.qty,
    unitPrice,
    leadTimeDays,
    message: `Order ${req.po_number} confirmed in full: ${req.qty} units at $${unitPrice.toFixed(2)}, delivery in ${leadTimeDays} days.`,
    faultInjected: null,
  };

  // Contractual limits the supplier always enforces.
  if (req.qty < sp.moq) {
    return { ...base, accepted: false, confirmedQty: 0,
      message: `Order below contractual MOQ of ${sp.moq} units.`, faultInjected: null };
  }
  if (sp.max_units_per_order != null && req.qty > sp.max_units_per_order) {
    return { ...base, accepted: true, confirmedQty: sp.max_units_per_order,
      message: `Capped at the contractual per-order maximum of ${sp.max_units_per_order} units.`,
      faultInjected: null };
  }

  if (faultsEnabled()) {
    const quirk = SUPPLIER_BEHAVIOUR[req.supplier_id]?.(req);
    if (quirk) return { ...base, ...quirk };
  }

  return base;
}

/** Ask a supplier what it can actually deliver before committing to an order. */
export function checkAvailability(args: { supplier_id: string; product_id: string; qty: number }) {
  const sp = getSupplierProduct(args.supplier_id, args.product_id);
  const supplier = getSupplier(args.supplier_id);
  if (!sp || !supplier) {
    return { available: false, maxAvailableQty: 0, leadTimeDays: 0, note: "Supplier does not carry this product." };
  }

  let maxQty = sp.max_units_per_order ?? args.qty;
  let note = `${supplier.name} can supply up to ${maxQty} units in a single order.`;

  if (faultsEnabled() && args.supplier_id === "SUP-03" && maxQty > 400) {
    maxQty = 400;
    note = "Allocation limit: 400 units per cycle.";
  }

  return {
    available: maxQty >= sp.moq,
    maxAvailableQty: maxQty,
    leadTimeDays: sp.lead_time_days,
    expediteLeadTimeDays: sp.expedite_available ? sp.expedite_lead_time_days : null,
    unitPrice: sp.unit_price,
    moq: sp.moq,
    lotSize: sp.lot_size,
    note,
  };
}
