export type ScenarioPreset = {
  id: string;
  group: string;
  title: string;
  situation: string;
  tension: string;
  input: Record<string, unknown>;
};

export const PRESETS: ScenarioPreset[] = [
  {
    id: "s1-over",
    group: "Recommendations",
    title: "Review an 800-unit oat milk recommendation",
    situation:
      "The replenishment system wants 800 units of SKU-1001 for Bogotá North DC. Stock looks low at a glance.",
    tension:
      "The recommendation overlooks 150 inbound units and uses a longer planning horizon. Recalculate the requirement using current supply and lead time.",
    input: {
      scenario: "recommendation_review",
      node_id: "NODE-BOG-01",
      product_id: "PRD-1001",
      recommended_qty: 800,
    },
  },
  {
    id: "s1-correct",
    group: "Recommendations",
    title: "Review a 500-unit yogurt recommendation",
    situation:
      "The same system recommends 500 units of SKU-1005 for Medellín Central DC.",
    tension:
      "The recommended quantity matches the seeded requirement. Check whether constraints still allow the purchase to proceed without approval.",
    input: {
      scenario: "recommendation_review",
      node_id: "NODE-MED-02",
      product_id: "PRD-1005",
      recommended_qty: 500,
    },
  },
  {
    id: "s2",
    group: "Supplier shortfalls",
    title: "Highland Coffee confirms 250 of 500 units",
    situation:
      "PO-2001 was raised for 500 units of coffee. The supplier now says it can only ship 250 this cycle.",
    tension:
      "Check whether existing stock covers the shortfall. The alternate supplier charges a 12% premium and falls below the reliability threshold, requiring buyer approval.",
    input: {
      scenario: "supplier_shortfall",
      po_id: "PO-2001",
      product_id: "PRD-1002",
      confirmed_qty: 250,
      event_id: "EVT-5001",
    },
  },
  {
    id: "s3-real",
    group: "Demand changes",
    title: "Energy drink sales have tripled",
    situation:
      "SKU-1003 was forecast at 40/day. It has been selling ~115/day for a week. A 600-unit order is already inbound, landing on day 9.",
    tension:
      "The seeded stock position runs out before the inbound order arrives. The supplier may partially confirm an expedited order, so the result needs independent verification.",
    input: {
      scenario: "demand_shift",
      node_id: "NODE-BOG-01",
      product_id: "PRD-1003",
    },
  },
  {
    id: "s3-promo",
    group: "Demand changes",
    title: "Yogurt demand rises during a promotion",
    situation:
      "SKU-1005 at Bogotá is selling 1.6x forecast, sustained for seven days. Statistically it looks exactly like the energy drink.",
    tension:
      "The 2-for-1 promotion ends in three days. Check whether it explains the demand increase and whether current stock covers the remaining promotion.",
    input: {
      scenario: "demand_shift",
      node_id: "NODE-BOG-01",
      product_id: "PRD-1005",
    },
  },
  {
    id: "s4",
    group: "Purchasing limits",
    title: "Water replenishment exceeds storage capacity",
    situation:
      "SKU-1004 is below safety stock at the Cartagena micro-FC. Requirement works out at 1,700 units.",
    tension:
      "Each unit uses three storage slots, limiting this site to 1,000 units. Check a partial order and capacity at other locations for the remaining requirement.",
    input: {
      scenario: "constrained_purchase",
      node_id: "NODE-CTG-03",
      product_id: "PRD-1004",
    },
  },
];

export type RunResponse = {
  runId: string;
  status: string;
  decision: string;
  confidence: number;
  summary: string;
  recommendedQty: number;
  supplierId: string | null;
  orderValue: number;
  rationale: string[];
  keyFactors: { label: string; value: string; impact: string }[];
  validation: {
    passed: boolean;
    checks: {
      code: string;
      label: string;
      severity: string;
      passed: boolean;
      detail: string;
    }[];
    maxFeasibleQty: number;
    bindingConstraint: string | null;
  } | null;
  autonomy: {
    decision: string;
    riskLevel: string;
    reasons: string[];
    headline: string;
  } | null;
  approvalId: string | null;
  executedPoIds: string[];
  drift: {
    severity: string;
    summary: string;
    findings: {
      field: string;
      expected: unknown;
      actual: unknown;
      note: string;
      severity: string;
    }[];
  } | null;
  remediations: {
    attempt: number;
    rationale: string;
    poId: string | null;
    ok: boolean;
  }[];
  llmDivergence: { diverged: boolean; note: string } | null;
  mode: string;
  error?: string;
};

export type CasePresentation = {
  title: string;
  location: string;
  product: string;
  signal: string;
  productName: string;
};
export const CASE_PRESENTATION: Record<string, CasePresentation> = {
  "s1-over": {
    title: "Oat milk recommendation",
    productName: "Oat milk",
    location: "Bogotá North DC",
    product: "SKU-1001",
    signal: "800 units proposed",
  },
  "s1-correct": {
    title: "Yogurt recommendation",
    productName: "Yogurt",
    location: "Medellín Central DC",
    product: "SKU-1005",
    signal: "500 units proposed",
  },
  s2: {
    title: "Coffee supplier shortfall",
    productName: "Coffee",
    location: "Highland Coffee",
    product: "PO-2001",
    signal: "250 of 500 units confirmed",
  },
  "s3-real": {
    title: "Energy drink demand",
    productName: "Energy drink",
    location: "Bogotá North DC",
    product: "SKU-1003",
    signal: "Demand nearly triples",
  },
  "s3-promo": {
    title: "Yogurt promotion",
    productName: "Yogurt",
    location: "Bogotá North DC",
    product: "SKU-1005",
    signal: "Demand at 1.6× forecast",
  },
  s4: {
    title: "Water storage limit",
    productName: "Bottled water",
    location: "Cartagena micro-FC",
    product: "SKU-1004",
    signal: "1,700 units required",
  },
};
export type ApprovalOutcome = {
  action: "approve" | "reject";
  status?: string;
  runId?: string;
  executedPoIds?: string[];
  drift?: RunResponse["drift"];
  remediations?: RunResponse["remediations"];
};
export type CaseRecord = {
  result: RunResponse | null;
  error: string | null;
  approvalOutcome: ApprovalOutcome | null;
  /** Set when the server knows a run is still in flight, so a reload can rejoin it. */
  pendingRunId?: string;
};
