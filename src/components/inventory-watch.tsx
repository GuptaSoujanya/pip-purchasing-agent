"use client";
import { useState } from "react";
import Link from "next/link";
import { Badge } from "./ui";
import { Icon } from "./icons";

type StockLine = {
  node_id: string;
  product_id: string;
  sku: string;
  name: string;
  node_name: string;
  on_hand: number;
  in_transit: number;
  cover: number | null;
  belowReorder: boolean;
};
export function InventoryWatch({ stock }: { stock: StockLine[] }) {
  const [filter, setFilter] = useState<"attention" | "all">("attention");
  const [node, setNode] = useState("all");
  const risk = stock.filter(
    (s) => s.belowReorder || (s.cover !== null && s.cover < 12),
  );
  const visible = (filter === "attention" ? risk : stock).filter(
    (s) => node === "all" || s.node_id === node,
  );
  const locations = [
    ...new Map(stock.map((s) => [s.node_id, s.node_name])).entries(),
  ];
  return (
    <section className="panel inventory-watch" id="stock-watch">
      <header className="panel-heading">
        <div>
          <h2>Stock watch</h2>
          <p>Coverage at the current demand forecast.</p>
        </div>
        <Link href="/inventory" className="text-link">
          View inventory <Icon name="arrow" size={16} />
        </Link>
      </header>
      <div className="stock-toolbar">
        <div
          className="segmented-control"
          role="group"
          aria-label="Filter stock"
        >
          <button
            type="button"
            aria-pressed={filter === "attention"}
            onClick={() => setFilter("attention")}
          >
            Needs attention <span>{risk.length}</span>
          </button>
          <button
            type="button"
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
          >
            All stock <span>{stock.length}</span>
          </button>
        </div>
        <label className="location-filter">
          <span className="sr-only">Filter by location</span>
          <select
            value={node}
            onChange={(event) => setNode(event.target.value)}
          >
            <option value="all">All locations</option>
            {locations.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="sr-only" role="status">
        Showing {visible.length} stock positions.
      </p>
      <div className="stock-table" role="table" aria-label="Stock coverage">
        <div className="stock-table-head" role="row">
          <span role="columnheader">Product / location</span>
          <span role="columnheader">On hand</span>
          <span role="columnheader">Cover</span>
          <span role="columnheader">Status</span>
        </div>
        {visible.map((s) => (
          <div
            key={`${s.node_id}-${s.product_id}`}
            className="stock-row"
            role="row"
          >
            <div className="stock-product" role="cell">
              <strong>{s.name}</strong>
              <span>{s.node_name}</span>
            </div>
            <div className="stock-quantity" role="cell">
              <span className="mobile-cell-label" aria-hidden="true">
                On hand
              </span>
              {s.on_hand.toLocaleString()}
            </div>
            <div className="stock-cover" role="cell">
              <span className="mobile-cell-label" aria-hidden="true">
                Cover
              </span>
              <strong>{s.cover === null ? "—" : `${s.cover}d`}</strong>
            </div>
            <div className="stock-status" role="cell">
              <Badge
                tone={
                  s.belowReorder || (s.cover !== null && s.cover < 12)
                    ? "amber"
                    : "green"
                }
              >
                {s.belowReorder
                  ? "Reorder"
                  : s.cover !== null && s.cover < 12
                    ? "Low cover"
                    : "On track"}
              </Badge>
            </div>
          </div>
        ))}
        {visible.length === 0 && (
          <div className="stock-clear">
            <Icon name="shield" size={24} />
            <strong>
              No stock alerts{node !== "all" ? " at this location" : ""}
            </strong>
            <p>
              {filter === "attention"
                ? "All visible stock positions meet the current coverage thresholds."
                : "No stock positions match this location."}
            </p>
          </div>
        )}
      </div>
      <footer className="stock-footer">
        <span>
          {visible.length} {visible.length === 1 ? "position" : "positions"}
        </span>
        <span>Review threshold: 12 days’ cover</span>
      </footer>
    </section>
  );
}
