/** Core domain types shared by the data layer, the policy engine and the agent. */

export type NodeRow = {
  id: string;
  name: string;
  region: string;
  storage_capacity_slots: number;
  storage_used_slots: number;
};

export type Product = {
  id: string;
  sku: string;
  name: string;
  category: string;
  slots_per_unit: number;
  shelf_life_days: number | null;
  abc_class: string;
};

export type Supplier = {
  id: string;
  name: string;
  reliability_score: number;
  avg_lead_time_days: number;
  lead_time_stddev_days: number;
  payment_terms_days: number;
  active: number;
};

export type SupplierProduct = {
  supplier_id: string;
  product_id: string;
  unit_price: number;
  moq: number;
  lot_size: number;
  lead_time_days: number;
  max_units_per_order: number | null;
  expedite_available: number;
  expedite_lead_time_days: number | null;
  expedite_surcharge_pct: number;
  is_preferred: number;
};

export type Inventory = {
  node_id: string;
  product_id: string;
  on_hand: number;
  reserved: number;
  in_transit: number;
  safety_stock: number;
  reorder_point: number;
};

export type Forecast = {
  id: number;
  node_id: string;
  product_id: string;
  daily_forecast: number;
  confidence_low: number;
  confidence_high: number;
  model_version: string;
  generated_at: string;
};

export type DemandPoint = { date: string; units_sold: number };

export type Promotion = {
  id: string;
  node_id: string;
  product_id: string;
  start_date: string;
  end_date: string;
  uplift_pct: number;
  description: string;
};

export type PurchaseOrderStatus =
  | "draft"
  | "submitted"
  | "confirmed"
  | "partially_confirmed"
  | "received"
  | "cancelled";

export type PurchaseOrder = {
  id: string;
  po_number: string;
  supplier_id: string;
  node_id: string;
  status: PurchaseOrderStatus;
  created_at: string;
  expected_delivery: string | null;
  total_cost: number;
  created_by: string;
  notes: string | null;
};

export type PoLine = {
  id: number;
  po_id: string;
  product_id: string;
  qty_ordered: number;
  qty_confirmed: number;
  qty_received: number;
  unit_price: number;
};

export type PurchaseOrderWithLines = PurchaseOrder & { lines: PoLine[] };

export type Budget = {
  id: string;
  node_id: string;
  period: string;
  total_budget: number;
  committed: number;
  spent: number;
};

export type SupplierEvent = {
  id: string;
  supplier_id: string;
  po_id: string | null;
  event_type: string;
  payload_json: string;
  created_at: string;
  processed: number;
};

// ---------------------------------------------------------------------------
// Agent-facing types
// ---------------------------------------------------------------------------

export type ScenarioKey =
  | "recommendation_review"
  | "supplier_shortfall"
  | "demand_shift"
  | "constrained_purchase";

export type AgentPhase =
  | "triage"
  | "investigate"
  | "decide"
  | "pre_validate"
  | "act"
  | "post_validate"
  | "remediate"
  | "escalate";

export type DecisionKind =
  | "ACCEPT"
  | "MODIFY"
  | "REJECT"
  | "INVESTIGATE"
  | "SPLIT_SOURCE"
  | "EXPEDITE"
  | "ESCALATE"
  | "NO_ACTION";

export type RunStatus =
  | "running"
  | "completed"
  | "awaiting_approval"
  | "escalated"
  | "failed";

export type AgentRun = {
  id: string;
  scenario: ScenarioKey;
  mode: "llm" | "deterministic";
  input_json: string;
  status: RunStatus;
  decision: DecisionKind | null;
  confidence: number | null;
  summary: string | null;
  started_at: string;
  finished_at: string | null;
};

export type AgentStep = {
  id: number;
  run_id: string;
  seq: number;
  phase: AgentPhase;
  type: "tool_call" | "reasoning" | "validation" | "decision" | "drift" | "note";
  tool_name: string | null;
  input_json: string | null;
  output_json: string | null;
  reasoning: string | null;
  ok: number;
  duration_ms: number;
  created_at: string;
};

export type Approval = {
  id: string;
  run_id: string;
  action_json: string;
  reason: string;
  risk_level: "low" | "medium" | "high";
  status: "pending" | "approved" | "rejected";
  requested_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
};

// ---------------------------------------------------------------------------
// Constraint / validation types
// ---------------------------------------------------------------------------

export type ConstraintSeverity = "hard" | "soft";

export type ConstraintCheck = {
  code: string;
  label: string;
  severity: ConstraintSeverity;
  passed: boolean;
  /** Human-readable explanation of what was compared. */
  detail: string;
  /** Numeric evidence so the UI and the evaluator can assert on it. */
  observed?: number;
  limit?: number;
  /** If the check failed, the largest quantity that WOULD pass. */
  maxFeasibleQty?: number;
};

export type ValidationResult = {
  passed: boolean;
  hardFailures: ConstraintCheck[];
  softWarnings: ConstraintCheck[];
  checks: ConstraintCheck[];
  /** Greatest quantity satisfying every hard constraint simultaneously. */
  maxFeasibleQty: number;
  /** Which constraint is actually limiting the order. */
  bindingConstraint: string | null;
};

/**
 * A proposed purchasing action. Everything the agent wants to do to the world
 * is expressed as one of these, so a single validator covers all paths.
 */
export type ProposedAction =
  | {
      kind: "create_po";
      supplier_id: string;
      node_id: string;
      product_id: string;
      qty: number;
      expedite?: boolean;
      reason: string;
    }
  | {
      kind: "amend_po";
      po_id: string;
      product_id: string;
      new_qty: number;
      reason: string;
    }
  | { kind: "cancel_po"; po_id: string; reason: string }
  | { kind: "no_action"; reason: string }
  | { kind: "escalate"; reason: string };

/**
 * What the agent asserts will be true after its action executes.
 * Post-validation re-reads the world and checks every field independently.
 */
export type Expectation = {
  description: string;
  poExists?: { po_id?: string; supplier_id: string; product_id: string };
  expectedConfirmedQty?: number;
  expectedStatus?: PurchaseOrderStatus[];
  expectedTotalCostMax?: number;
  expectedBudgetCommittedMax?: number;
  expectedDaysOfCoverMin?: number;
  expectedInTransitMin?: number;
};

export type DriftSeverity = "none" | "benign" | "material" | "critical";

export type DriftReport = {
  severity: DriftSeverity;
  findings: {
    field: string;
    expected: string | number;
    actual: string | number;
    delta?: number;
    severity: DriftSeverity;
    note: string;
  }[];
  summary: string;
};

export type EvidenceBundle = {
  product: Product;
  node: NodeRow;
  inventory: Inventory;
  forecast: Forecast | null;
  demand: DemandPoint[];
  openPos: PurchaseOrderWithLines[];
  suppliers: (SupplierProduct & { supplier: Supplier })[];
  budget: Budget | null;
  promotions: Promotion[];
  asOf: string;
};
