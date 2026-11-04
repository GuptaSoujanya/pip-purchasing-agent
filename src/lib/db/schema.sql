-- =============================================================================
-- AI Purchasing Agent — operational schema
--
-- Models the slice of a retail / quick-commerce purchasing system that a buyer
-- actually touches: what we hold, what we expect to sell, what we already
-- ordered, who can supply it, and what limits us (money + space + supplier terms).
--
-- Every table the agent can WRITE to is mirrored by audit_log so that any action
-- is reconstructable after the fact.
-- =============================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Network
-- ---------------------------------------------------------------------------
CREATE TABLE nodes (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  region                TEXT NOT NULL,
  -- Storage is modelled in abstract "slots". One slot == one unit of volume.
  storage_capacity_slots INTEGER NOT NULL,
  storage_used_slots     INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------
CREATE TABLE products (
  id              TEXT PRIMARY KEY,
  sku             TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL,
  -- Slots consumed per unit. Bulky goods eat storage faster than money.
  slots_per_unit  REAL NOT NULL DEFAULT 1.0,
  shelf_life_days INTEGER,            -- NULL = non-perishable
  abc_class       TEXT NOT NULL DEFAULT 'B'  -- A/B/C importance class
);

-- ---------------------------------------------------------------------------
-- Suppliers and commercial terms
-- ---------------------------------------------------------------------------
CREATE TABLE suppliers (
  id                     TEXT PRIMARY KEY,
  name                   TEXT NOT NULL,
  -- Historical fill rate: fraction of ordered units actually delivered on time.
  reliability_score      REAL NOT NULL,
  avg_lead_time_days     INTEGER NOT NULL,
  lead_time_stddev_days  REAL NOT NULL DEFAULT 1.0,
  payment_terms_days     INTEGER NOT NULL DEFAULT 30,
  active                 INTEGER NOT NULL DEFAULT 1
);

-- The commercial relationship between a supplier and a product.
-- This is where MOQ / lot size / price / capacity live.
CREATE TABLE supplier_products (
  supplier_id          TEXT NOT NULL REFERENCES suppliers(id),
  product_id           TEXT NOT NULL REFERENCES products(id),
  unit_price           REAL NOT NULL,
  moq                  INTEGER NOT NULL DEFAULT 0,   -- minimum order quantity
  lot_size             INTEGER NOT NULL DEFAULT 1,   -- order must be a multiple
  lead_time_days       INTEGER NOT NULL,
  max_units_per_order  INTEGER,                      -- supplier-side capacity cap
  expedite_available   INTEGER NOT NULL DEFAULT 0,
  expedite_lead_time_days INTEGER,
  expedite_surcharge_pct  REAL NOT NULL DEFAULT 0,
  is_preferred         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (supplier_id, product_id)
);

-- ---------------------------------------------------------------------------
-- Stock position
-- ---------------------------------------------------------------------------
CREATE TABLE inventory (
  node_id       TEXT NOT NULL REFERENCES nodes(id),
  product_id    TEXT NOT NULL REFERENCES products(id),
  on_hand       INTEGER NOT NULL DEFAULT 0,
  reserved      INTEGER NOT NULL DEFAULT 0,  -- allocated to open customer orders
  in_transit    INTEGER NOT NULL DEFAULT 0,  -- confirmed on open POs, not yet received
  safety_stock  INTEGER NOT NULL DEFAULT 0,
  reorder_point INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (node_id, product_id)
);

-- ---------------------------------------------------------------------------
-- Demand: what actually happened, and what we think will happen
-- ---------------------------------------------------------------------------
CREATE TABLE demand_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id    TEXT NOT NULL REFERENCES nodes(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  date       TEXT NOT NULL,            -- ISO yyyy-mm-dd
  units_sold INTEGER NOT NULL
);
CREATE INDEX idx_demand_lookup ON demand_history(node_id, product_id, date);

CREATE TABLE forecasts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id          TEXT NOT NULL REFERENCES nodes(id),
  product_id       TEXT NOT NULL REFERENCES products(id),
  -- Baseline daily rate the planning system is currently using.
  daily_forecast   REAL NOT NULL,
  confidence_low   REAL NOT NULL,
  confidence_high  REAL NOT NULL,
  model_version    TEXT NOT NULL,
  generated_at     TEXT NOT NULL
);
CREATE INDEX idx_forecast_lookup ON forecasts(node_id, product_id);

-- Promotions explain demand spikes. A spike during a promo is temporary and
-- must NOT be treated as a permanent shift in the baseline.
CREATE TABLE promotions (
  id          TEXT PRIMARY KEY,
  node_id     TEXT NOT NULL REFERENCES nodes(id),
  product_id  TEXT NOT NULL REFERENCES products(id),
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  uplift_pct  REAL NOT NULL,
  description TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Purchase orders
-- ---------------------------------------------------------------------------
CREATE TABLE purchase_orders (
  id                TEXT PRIMARY KEY,
  po_number         TEXT NOT NULL UNIQUE,
  supplier_id       TEXT NOT NULL REFERENCES suppliers(id),
  node_id           TEXT NOT NULL REFERENCES nodes(id),
  -- draft | submitted | confirmed | partially_confirmed | received | cancelled
  status            TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  expected_delivery TEXT,
  total_cost        REAL NOT NULL DEFAULT 0,
  created_by        TEXT NOT NULL DEFAULT 'system',
  notes             TEXT
);

CREATE TABLE po_lines (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id        TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id   TEXT NOT NULL REFERENCES products(id),
  qty_ordered  INTEGER NOT NULL,
  qty_confirmed INTEGER NOT NULL DEFAULT 0,
  qty_received INTEGER NOT NULL DEFAULT 0,
  unit_price   REAL NOT NULL
);
CREATE INDEX idx_po_lines_po ON po_lines(po_id);

-- Inbound messages from suppliers (partial fulfilment, delays, cancellations).
-- This is what triggers Scenario 2.
CREATE TABLE supplier_events (
  id           TEXT PRIMARY KEY,
  supplier_id  TEXT NOT NULL REFERENCES suppliers(id),
  po_id        TEXT REFERENCES purchase_orders(id),
  event_type   TEXT NOT NULL,   -- partial_fulfilment | delay | cancellation | price_change
  payload_json TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  processed    INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Money
-- ---------------------------------------------------------------------------
CREATE TABLE budgets (
  id           TEXT PRIMARY KEY,
  node_id      TEXT NOT NULL REFERENCES nodes(id),
  period       TEXT NOT NULL,            -- e.g. '2026-11'
  total_budget REAL NOT NULL,
  committed    REAL NOT NULL DEFAULT 0,  -- reserved by open POs
  spent        REAL NOT NULL DEFAULT 0   -- already invoiced
);

-- ---------------------------------------------------------------------------
-- Agent governance: thresholds that define how much autonomy the agent has.
-- Stored in the DB (not hard-coded) so a buyer can tune the agent's leash.
-- ---------------------------------------------------------------------------
CREATE TABLE agent_policies (
  key         TEXT PRIMARY KEY,
  value       REAL NOT NULL,
  description TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Agent execution record — the full, replayable trace
-- ---------------------------------------------------------------------------
CREATE TABLE agent_runs (
  id            TEXT PRIMARY KEY,
  scenario      TEXT NOT NULL,
  mode          TEXT NOT NULL,            -- llm | deterministic
  input_json    TEXT NOT NULL,
  status        TEXT NOT NULL,            -- running | completed | escalated | failed
  decision      TEXT,                     -- ACCEPT | MODIFY | REJECT | INVESTIGATE | SPLIT_SOURCE | ESCALATE
  confidence    REAL,
  summary       TEXT,
  started_at    TEXT NOT NULL,
  finished_at   TEXT
);

CREATE TABLE agent_steps (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  phase       TEXT NOT NULL,   -- triage|investigate|decide|pre_validate|act|post_validate|remediate|escalate
  type        TEXT NOT NULL,   -- tool_call | reasoning | validation | decision | drift | note
  tool_name   TEXT,
  input_json  TEXT,
  output_json TEXT,
  reasoning   TEXT,
  ok          INTEGER NOT NULL DEFAULT 1,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_steps_run ON agent_steps(run_id, seq);

-- Result of running a decision through the constraint engine, before and after acting.
CREATE TABLE validations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  phase       TEXT NOT NULL,   -- pre | post
  passed      INTEGER NOT NULL,
  checks_json TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- Human-in-the-loop queue.
CREATE TABLE approvals (
  id              TEXT PRIMARY KEY,
  run_id          TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  action_json     TEXT NOT NULL,
  reason          TEXT NOT NULL,
  risk_level      TEXT NOT NULL,   -- low | medium | high
  status          TEXT NOT NULL,   -- pending | approved | rejected
  requested_at    TEXT NOT NULL,
  resolved_at     TEXT,
  resolved_by     TEXT,
  resolution_note TEXT
);

-- ---------------------------------------------------------------------------
-- Audit: every mutation the agent makes to the operational world
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  action      TEXT NOT NULL,
  actor       TEXT NOT NULL,
  run_id      TEXT,
  before_json TEXT,
  after_json  TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
