"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { Badge } from "@/components/ui";
import { Icon } from "@/components/icons";
import { PurchasingSelect } from "@/components/purchasing-select";
import type { DemandShiftEvidence, DemandStats } from "@/lib/domain/math";
import type { DemandPoint, Inventory } from "@/lib/domain/types";

type StockRow = Inventory & {
  name: string;
  sku: string;
  node_name: string;
  baseline: number;
  points: DemandPoint[];
  stats: DemandStats;
  shift: DemandShiftEvidence;
  atp: number;
  cover: number | null;
  belowReorder: boolean;
};
const normalize = (value: string) =>
  value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const count = (value: number) => value.toLocaleString("en-US");
const needsReview = (row: StockRow) =>
  row.belowReorder ||
  row.shift.shiftDetected ||
  row.cover === null ||
  row.cover < 12;
const TICKS = [0, 7, 14, 21, 30];

export function InventoryWorkspace({
  rows,
  locationName,
}: {
  rows: StockRow[];
  locationName?: string;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("cover");
  const [view, setView] = useState<"coverage" | "table">("coverage");
  const [expanded, setExpanded] = useState<string | null>(null);
  const normalizedQuery = normalize(query.trim());
  const shown = useMemo(
    () =>
      rows
        .filter((row) => {
          const matchesQuery = normalize(
            `${row.name} ${row.sku} ${row.node_name}`,
          ).includes(normalizedQuery);
          const matchesStatus =
            status === "all" ||
            (status === "review" && needsReview(row)) ||
            (status === "reorder" && row.belowReorder) ||
            (status === "demand" && row.shift.shiftDetected) ||
            (status === "stable" && !needsReview(row));
          return matchesQuery && matchesStatus;
        })
        .sort((a, b) =>
          sort === "product"
            ? a.name.localeCompare(b.name) ||
              a.node_name.localeCompare(b.node_name)
            : sort === "inbound"
              ? b.in_transit - a.in_transit
              : (a.cover ?? Infinity) - (b.cover ?? Infinity),
        ),
    [rows, normalizedQuery, status, sort],
  );
  const clear = () => {
    setQuery("");
    setStatus("all");
  };
  const toggle = (id: string) => setExpanded(expanded === id ? null : id);
  return (
    <section className="ops-stock-panel" aria-labelledby="stock-heading">
      <div className="ops-stock-title">
        <div>
          <span className="ops-eyebrow">01 / Inventory outlook</span>
          <h2 id="stock-heading">How far will your stock go?</h2>
          <p>
            {locationName ?? "Every fulfillment location"} · Cover includes
            inbound supply.
          </p>
        </div>
        <div
          className="ops-view-switch"
          role="group"
          aria-label="Inventory view"
        >
          <button
            type="button"
            aria-pressed={view === "coverage"}
            onClick={() => setView("coverage")}
          >
            <Icon name="chart" size={16} /> Coverage map
          </button>
          <button
            type="button"
            aria-pressed={view === "table"}
            onClick={() => setView("table")}
          >
            <Icon name="grid" size={16} /> Stock table
          </button>
        </div>
      </div>
      <div className="ops-stock-toolbar">
        <label className="ops-search">
          <Icon name="search" size={18} />
          <span className="ops-sr-only">
            Search products, SKUs or locations
          </span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Product, SKU or location"
          />
        </label>
        <div className="ops-labeled-control">
          <span>Stock status</span>
          <PurchasingSelect
            label="Filter stock status"
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: "All stock" },
              { value: "review", label: "Needs review" },
              { value: "reorder", label: "Below reorder" },
              { value: "demand", label: "Demand change" },
              { value: "stable", label: "Stable cover" },
            ]}
          />
        </div>
        <div className="ops-labeled-control">
          <span>Sort by</span>
          <PurchasingSelect
            label="Sort stock positions"
            value={sort}
            onChange={setSort}
            options={[
              { value: "cover", label: "Lowest cover" },
              { value: "product", label: "Product name" },
              { value: "inbound", label: "Most inbound" },
            ]}
          />
        </div>
      </div>
      <div className="ops-stock-result-count">
        <span role="status" aria-live="polite">
          {shown.length} of {rows.length} positions
          {status !== "all" || query ? " match your filters" : ""}
        </span>
        {(query || status !== "all") && (
          <button type="button" onClick={clear} className="ops-link">
            Clear filters <Icon name="close" size={13} />
          </button>
        )}
        <div className="ops-coverage-legend">
          <span>
            <i className="legend-onhand" /> Available on hand
          </span>
          <span>
            <i className="legend-low-cover" /> On hand · cover below 12 days
          </span>
          <span>
            <i className="legend-inbound" /> Inbound
          </span>
          <span>
            <i className="legend-threshold" /> 12-day alert
          </span>
        </div>
      </div>
      {shown.length === 0 ? (
        <div className="ops-empty">
          <span className="ops-empty-symbol">
            <Icon name="search" size={30} />
          </span>
          <h3>No stock in this selection.</h3>
          <p>Try a different product or clear your stock filters.</p>
          <button
            type="button"
            className="ops-button ops-button-secondary"
            onClick={clear}
          >
            Clear filters
          </button>
        </div>
      ) : view === "coverage" ? (
        <div
          className="ops-coverage-region"
          role="region"
          aria-label="Stock coverage map, zero to thirty days"
          tabIndex={0}
        >
          <div className="ops-coverage-map">
            <div className="ops-coverage-axis">
              <span>Product / location</span>
              <div className="ops-coverage-scale">
                <span className="ops-axis-caption">DAYS OF COVER</span>
                <div className="ops-axis-ticks">
                  {TICKS.map((tick) => (
                    <span key={tick} style={{ left: `${(tick / 30) * 100}%` }}>
                      {tick}
                    </span>
                  ))}
                </div>
              </div>
              <span>
                Actual demand{" "}
                <small>
                  Last {Math.max(0, ...rows.map((row) => row.points.length))}{" "}
                  days / forecast · · ·
                </small>
              </span>
              <span className="ops-sr-only">Details</span>
            </div>
            {shown.map((row, index) => {
              const id = `${row.node_id}-${row.product_id}`;
              return (
                <Fragment key={id}>
                  <div
                    className={`ops-coverage-row ${expanded === id ? "is-expanded" : ""}`}
                  >
                    <div className="ops-coverage-product">
                      <span className="ops-position-index">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <strong>{row.name}</strong>
                        <span>
                          {row.sku} / {row.node_name}
                        </span>
                        <StockSignal row={row} />
                      </div>
                    </div>
                    <CoverageBar row={row} />
                    <div className="ops-demand-mini">
                      <DemandSparkline row={row} />
                      <p>
                        <strong>{row.stats.last7Mean}</strong> actual /{" "}
                        <span>{row.baseline} forecast</span>
                        <small>units per day · trailing 7-day actual</small>
                      </p>
                    </div>
                    <button
                      type="button"
                      className="ops-row-detail"
                      aria-expanded={expanded === id}
                      aria-controls={
                        expanded === id ? `detail-${id}` : undefined
                      }
                      aria-label={`${expanded === id ? "Hide" : "Show"} details for ${row.name} at ${row.node_name}`}
                      onClick={() => toggle(id)}
                    >
                      <Icon name="chevron" size={19} />
                    </button>
                  </div>
                  {expanded === id && (
                    <div className="ops-coverage-expansion" id={`detail-${id}`}>
                      <StockEvidence row={row} />
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>
        </div>
      ) : (
        <div
          className="ops-table-region"
          role="region"
          aria-label="Stock positions and demand signals"
          tabIndex={0}
        >
          <table className="ops-stock-table">
            <thead>
              <tr>
                <th scope="col">Product / location</th>
                <th scope="col">On hand</th>
                <th scope="col">Inbound</th>
                <th scope="col">Stock cover</th>
                <th scope="col">Demand / day</th>
                <th scope="col">Signal</th>
                <th scope="col">
                  <span className="ops-sr-only">Details</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const id = `${row.node_id}-${row.product_id}`;
                return (
                  <Fragment key={id}>
                    <tr className={expanded === id ? "is-expanded" : undefined}>
                      <th scope="row">
                        <div className="ops-product-cell">
                          <strong>{row.name}</strong>
                          <span>
                            {row.sku} · {row.node_name}
                          </span>
                        </div>
                      </th>
                      <td>
                        <strong className="ops-number">
                          {count(row.on_hand)}
                        </strong>
                        <small>{count(row.reserved)} reserved</small>
                      </td>
                      <td>
                        <strong className="ops-number">
                          {count(row.in_transit)}
                        </strong>
                        <small>units expected</small>
                      </td>
                      <td>
                        <strong
                          className={`ops-number ${row.cover !== null && row.cover < 12 ? "ops-warn" : ""}`}
                        >
                          {row.cover === null
                            ? "No forecast"
                            : `${row.cover} days`}
                        </strong>
                      </td>
                      <td>
                        <strong className="ops-number">
                          {row.stats.last7Mean} actual
                        </strong>
                        <small>
                          {row.baseline} forecast
                          {row.baseline > 0
                            ? ` · ${row.stats.trendRatio}×`
                            : ""}
                        </small>
                      </td>
                      <td>
                        <StockSignal row={row} />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="ops-row-detail"
                          aria-label={`${expanded === id ? "Hide" : "Show"} details for ${row.name} at ${row.node_name}`}
                          aria-expanded={expanded === id}
                          aria-controls={
                            expanded === id ? `detail-${id}` : undefined
                          }
                          onClick={() => toggle(id)}
                        >
                          <Icon name="chevron" size={19} />
                        </button>
                      </td>
                    </tr>
                    {expanded === id && (
                      <tr className="ops-stock-detail-row" id={`detail-${id}`}>
                        <td colSpan={7}>
                          <StockEvidence row={row} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <footer className="ops-stock-footnote">
        <Icon name="help" size={16} />
        <p>
          Cover = (on hand + inbound − reserved) ÷ daily forecast. The ruler
          stops at 30 days; labels show the full value. Inbound is expected
          supply, with no arrival date assumed. The dashed demand line is the
          current forecast.
        </p>
        <Link href="/opportunities" className="ops-link">
          Investigate signals <Icon name="arrow" size={15} />
        </Link>
      </footer>
    </section>
  );
}

function StockSignal({ row }: { row: StockRow }) {
  return (
    <div className="ops-stock-signals">
      {row.shift.shiftDetected && <Badge tone="red">Demand change</Badge>}
      {row.belowReorder && <Badge tone="amber">Below reorder</Badge>}
      {row.cover !== null && row.cover < 12 && !row.belowReorder && (
        <Badge tone="amber">Low cover</Badge>
      )}
      {row.shift.explainedByPromotion && <Badge tone="slate">Promotion</Badge>}
      {row.cover === null && <Badge tone="slate">No forecast</Badge>}
      {!needsReview(row) && !row.shift.explainedByPromotion && (
        <Badge tone="green">Stable</Badge>
      )}
    </div>
  );
}
function CoverageBar({ row }: { row: StockRow }) {
  // Split the same net position used by the cover label. Reservations consume on-hand first.
  const onHandUnits = Math.max(0, row.on_hand - row.reserved);
  const incomingUnits = Math.max(0, row.atp - onHandUnits);
  const onHandDays = row.baseline > 0 ? onHandUnits / row.baseline : 0;
  const inboundDays = row.baseline > 0 ? incomingUnits / row.baseline : 0;
  const onHandWidth = Math.min(100, (onHandDays / 30) * 100);
  const incomingWidth = Math.min(100 - onHandWidth, (inboundDays / 30) * 100);
  return (
    <div
      className="ops-coverage-plot"
      role="img"
      aria-label={
        row.cover === null
          ? "No forecast available to calculate stock cover"
          : `${row.cover} days of net cover, including ${count(row.in_transit)} inbound units`
      }
    >
      <div className="ops-coverage-grid" aria-hidden="true">
        {TICKS.map((tick) => (
          <i key={tick} style={{ left: `${(tick / 30) * 100}%` }} />
        ))}
        <i className="ops-coverage-threshold" style={{ left: "40%" }} />
      </div>
      {row.cover === null ? (
        <span className="ops-cover-unknown">Forecast needed</span>
      ) : (
        <>
          <div
            className={`ops-coverage-bar ${row.cover < 12 ? "is-short" : ""}`}
            aria-hidden="true"
          >
            <span
              className="coverage-onhand"
              style={{ width: `${onHandWidth}%` }}
            />
            <span
              className="coverage-inbound"
              style={{ width: `${incomingWidth}%` }}
            />
          </div>
          <div className="ops-coverage-label">
            <strong>{row.cover}</strong>
            <span>days{row.cover > 30 ? " ↗" : ""}</span>
            <small>{count(row.atp)} available incl. inbound</small>
          </div>
        </>
      )}
    </div>
  );
}
function DemandSparkline({
  row,
  large = false,
}: {
  row: StockRow;
  large?: boolean;
}) {
  if (row.points.length === 0)
    return <span className="ops-no-demand">No sales history recorded</span>;
  const width = large ? 620 : 180,
    height = large ? 130 : 44,
    pad = 4;
  const high =
    Math.max(1, row.baseline, ...row.points.map((point) => point.units_sold)) *
    1.1;
  const y = (value: number) =>
    height - pad - (Math.max(0, value) / high) * (height - pad * 2);
  const points = row.points
    .map(
      (point, index) =>
        `${pad + (index / Math.max(1, row.points.length - 1)) * (width - pad * 2)},${y(point.units_sold)}`,
    )
    .join(" ");
  return (
    <svg
      className={`ops-demand-sparkline ${row.shift.shiftDetected ? "has-shift" : ""} ${large ? "is-large" : ""}`}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${row.name}: ${row.points.length} recorded sales days, ${row.stats.last7Mean} units per day over the last seven days, current forecast ${row.baseline} units per day`}
    >
      <line
        className="demand-baseline"
        x1={pad}
        x2={width - pad}
        y1={y(row.baseline)}
        y2={y(row.baseline)}
      />
      <polyline points={points} fill="none" className="demand-actual" />
      {row.points.length === 1 && (
        <circle
          cx={pad}
          cy={y(row.points[0].units_sold)}
          r="2"
          className="demand-single"
        />
      )}
    </svg>
  );
}
function StockEvidence({ row }: { row: StockRow }) {
  return (
    <div className="ops-stock-detail">
      <div>
        <span className="ops-eyebrow">
          Recorded sales / {row.points.length} days
        </span>
        <DemandSparkline row={row} large />
        <div className="ops-demand-dates">
          <span>{row.points[0]?.date ?? "—"}</span>
          <span>{row.points.at(-1)?.date ?? "—"}</span>
        </div>
        <dl className="ops-stock-evidence-numbers">
          <div>
            <dt>On hand / reserved</dt>
            <dd>
              {count(row.on_hand)} / {count(row.reserved)}
            </dd>
          </div>
          <div>
            <dt>Inbound</dt>
            <dd>{count(row.in_transit)} units</dd>
          </div>
          <div>
            <dt>Safety stock</dt>
            <dd>{count(row.safety_stock)} units</dd>
          </div>
          <div>
            <dt>Reorder point</dt>
            <dd>{count(row.reorder_point)} units</dd>
          </div>
          <div>
            <dt>Available incl. inbound</dt>
            <dd>{count(row.atp)} units</dd>
          </div>
          <div>
            <dt>Actual / forecast ratio</dt>
            <dd>
              {row.baseline > 0 ? `${row.stats.trendRatio}×` : "No forecast"}
            </dd>
          </div>
        </dl>
      </div>
      <div className="ops-demand-evidence">
        <h3>What the evidence says.</h3>
        <ul>
          {row.shift.reasons.map((reason, index) => (
            <li key={index}>{reason}</li>
          ))}
        </ul>
        {row.shift.promotion && (
          <p>Promotion: {row.shift.promotion.description}</p>
        )}
        <details>
          <summary>See recorded daily sales</summary>
          <div className="ops-history-values">
            {row.points.map((point) => (
              <div key={point.date}>
                <span>{point.date}</span>
                <strong>{point.units_sold} units</strong>
              </div>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}
