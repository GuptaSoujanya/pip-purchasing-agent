"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { Mascot } from "./companion";
import { usePurchasingAssistant } from "./workspace-shell";
import "./purchasing-experience.css";

const PipSupplySculpture = dynamic(
  () => import("./pip-supply-sculpture").then((m) => m.PipSupplySculpture),
  { ssr: false },
);

export type PurchasingNode = {
  id: string;
  name: string;
  city: string;
  availableBudget: number;
  usedCapacity: number;
  lowestCover: number | null;
  alerts: number;
  positions: number;
  risks: { name: string; cover: number | null }[];
};
const currency = (value: number) =>
  value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

export function PurchasingExperience({
  nodes,
  stockAlerts,
  supplierUpdates,
  pendingApprovals,
  openOrders,
  simulatedDate,
}: {
  nodes: PurchasingNode[];
  stockAlerts: number;
  supplierUpdates: number;
  pendingApprovals: number;
  openOrders: number;
  simulatedDate: string;
}) {
  const { openChat, selectedNode, setSelectedNode } = usePurchasingAssistant();
  const [visible, setVisible] = useState(true);
  const scene = useRef<HTMLDivElement>(null);
  const node = nodes[selectedNode] ?? nodes[0];
  const lowest = [...nodes]
    .filter((n) => n.lowestCover !== null)
    .sort(
      (a, b) => (a.lowestCover ?? Infinity) - (b.lowestCover ?? Infinity),
    )[0];
  useEffect(() => {
    if (!scene.current) return;
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry.isIntersecting),
    );
    observer.observe(scene.current);
    return () => observer.disconnect();
  }, []);
  const date = new Date(simulatedDate + "T12:00:00Z").toLocaleDateString(
    "en-GB",
    { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" },
  );
  return (
    <section
      id="workspace"
      className="studio-overview"
      aria-labelledby="studio-title"
    >
      <div className="studio-issue-line">
        <span>
          <i />
          PURCHASING, WITH PERSPECTIVE.
        </span>
        <span>
          {date}
          <b>SIMULATION</b>
        </span>
      </div>
      <div className="studio-hero">
        <div className="studio-hero-copy">
          <div className="studio-edition">
            <span>THE BUYER’S VIEW</span>
            <span>01 — 08</span>
          </div>
          <h1 id="studio-title">
            <span>Make your</span>
            <span>next move</span>
            <span className="studio-title-accent">
              count<span className="studio-period">.</span>
            </span>
          </h1>
          <p className="studio-hero-intro">
            A little foresight goes a long way.
            <br />
            See the signals. Weigh your options.
            <br />
            Make a purchase you can explain.
          </p>
          <div className="studio-hero-actions">
            <Link
              href={pendingApprovals ? "/approvals" : "/opportunities"}
              className="studio-action"
            >
              <span>
                {pendingApprovals
                  ? "Review " +
                    pendingApprovals +
                    (pendingApprovals === 1 ? " decision" : " decisions")
                  : "Find your next move"}
              </span>
              <i>
                <Icon name="arrow-up-right" size={21} />
              </i>
            </Link>
            <Link href="/scenarios" className="studio-secondary-action">
              Explore the scenario lab <Icon name="arrow" size={17} />
            </Link>
          </div>
          <div className="studio-hero-footnote">
            <Icon name="shield" size={15} />
            <span>Evidence before action. A check after every move.</span>
          </div>
        </div>
        <div className="studio-hero-art" ref={scene}>
          <div className="studio-art-reference">
            <span>YOUR SUPPLY NETWORK</span>
            <span>
              {String(nodes.length).padStart(2, "0")} LOCATIONS / ONE PICTURE
            </span>
          </div>
          <PipSupplySculpture
            nodes={nodes}
            selectedNode={selectedNode}
            onSelectNode={setSelectedNode}
            paused={!visible}
          />
          <div className="studio-art-note">
            <span className="studio-note-orbit">
              <Icon name="arrow-up-right" size={22} />
            </span>
            <span>
              Everything
              <br />
              is connected.
            </span>
          </div>
        </div>
      </div>
      {node && (
        <div className="studio-location-strip" key={node.id}>
          <div className="studio-location-name">
            <span className="studio-location-index">0{selectedNode + 1}</span>
            <div>
              <span>LOCATION IN FOCUS</span>
              <strong>{node.name}</strong>
            </div>
          </div>
          <div className="studio-location-stat">
            <span>Shortest stock cover</span>
            <strong>
              {node.lowestCover === null ? "—" : node.lowestCover}
              <small>{node.lowestCover === null ? "" : " days"}</small>
            </strong>
          </div>
          <div className="studio-location-stat">
            <span>Available budget</span>
            <strong>{currency(node.availableBudget)}</strong>
          </div>
          <div className="studio-location-stat studio-location-storage">
            <span>Space in use</span>
            <div>
              <strong>
                {node.usedCapacity}
                <small>%</small>
              </strong>
              <div
                className="studio-capacity-track"
                role="meter"
                aria-label={node.name + " storage used"}
                aria-valuenow={node.usedCapacity}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <span
                  style={{ width: Math.min(100, node.usedCapacity) + "%" }}
                />
              </div>
            </div>
          </div>
          <Link
            href={"/inventory?location=" + node.id}
            className="studio-location-link"
          >
            Explore stock
            <Icon name="arrow-up-right" size={21} />
          </Link>
        </div>
      )}

      <section className="studio-radar" aria-labelledby="studio-radar-title">
        <header className="studio-section-heading">
          <div>
            <span className="studio-section-index">
              01 / THE OPERATING PICTURE
            </span>
            <h2 id="studio-radar-title">
              On your radar<span>.</span>
            </h2>
          </div>
          <p>
            The details worth your attention.
            <br />
            Straight from your workspace.
          </p>
          <a href="#operations" aria-label="Jump to stock watch and budget">
            <Icon name="arrow" size={23} />
          </a>
        </header>
        <div className="studio-radar-grid">
          <Link
            href={lowest ? "/inventory?location=" + lowest.id : "/inventory"}
            className="studio-signal studio-signal-stock"
          >
            <div className="studio-signal-top">
              <span>STOCK / COVERAGE</span>
              <Icon name="arrow-up-right" size={26} />
            </div>
            <h3>
              {stockAlerts
                ? "Catch the gap.\nBefore it grows."
                : "Room to breathe.\nStock is on track."}
            </h3>
            <div
              className="studio-cover-graphic"
              role="img"
              aria-label={
                lowest?.lowestCover != null
                  ? `Lowest stock coverage: ${lowest.lowestCover} days in ${lowest.city}, against a 12-day review threshold.`
                  : "Stock coverage is unavailable. The review threshold is 12 days."
              }
            >
              <span
                style={{
                  width:
                    Math.max(
                      0,
                      Math.min(100, ((lowest?.lowestCover ?? 0) / 30) * 100),
                    ) + "%",
                }}
              />
              <i />
              <b>12d target</b>
              <em>
                {lowest?.lowestCover === null || !lowest
                  ? "—"
                  : lowest.lowestCover + "d"}
              </em>
            </div>
            <div className="studio-signal-bottom">
              <strong>{String(stockAlerts).padStart(2, "0")}</strong>
              <span>
                stock {stockAlerts === 1 ? "signal" : "signals"}
                <small>
                  {lowest
                    ? "Lowest cover in " + lowest.city
                    : "Across your locations"}
                </small>
              </span>
            </div>
          </Link>
          <Link
            href={supplierUpdates ? "/scenarios#s2" : "/purchase-orders"}
            className="studio-signal studio-signal-supply"
          >
            <div className="studio-signal-top">
              <span>SUPPLY / CHANGES</span>
              <Icon name="arrow-up-right" size={26} />
            </div>
            <h3>
              {supplierUpdates
                ? "The plan changed.\nLet’s respond."
                : "No loose ends.\nSupply is in view."}
            </h3>
            <div className="studio-supply-glyph" aria-hidden="true">
              <Icon name="box" size={48} />
              <span />
              <Icon name="workflow" size={48} />
              <span />
              <Icon name="check" size={48} />
            </div>
            <div className="studio-signal-bottom">
              <strong>{String(supplierUpdates).padStart(2, "0")}</strong>
              <span>
                supplier {supplierUpdates === 1 ? "update" : "updates"}
                <small>Reconcile what’s confirmed</small>
              </span>
            </div>
          </Link>
          <Link
            href="/purchase-orders"
            className="studio-signal studio-signal-orders"
          >
            <div className="studio-signal-top">
              <span>ORDERS / IN MOTION</span>
              <Icon name="arrow-up-right" size={26} />
            </div>
            <h3>
              From a good call.
              <br />
              To a real delivery.
            </h3>
            <div className="studio-order-glyph" aria-hidden="true">
              <span>PO</span>
              <i />
              <span>
                <Icon name="arrow-up-right" size={54} />
              </span>
            </div>
            <div className="studio-signal-bottom">
              <strong>{String(openOrders).padStart(2, "0")}</strong>
              <span>
                open {openOrders === 1 ? "order" : "orders"}
                <small>Track the next handoff</small>
              </span>
            </div>
          </Link>
        </div>
      </section>
      <div className="studio-briefing">
        <div className="studio-briefing-mascot">
          <Mascot compact />
        </div>
        <div>
          <span>YOUR THINKING PARTNER</span>
          <h2>A second opinion, one conversation away.</h2>
        </div>
        <button
          type="button"
          onClick={() =>
            openChat(
              "What should I focus on in this purchasing workspace, and what evidence should I review first?",
            )
          }
        >
          Talk it through with Pip
          <Icon name="arrow-up-right" size={20} />
        </button>
      </div>
      <header className="studio-section-heading studio-operations-heading">
        <div>
          <span className="studio-section-index">02 / UNDER THE SURFACE</span>
          <h2>
            The working details<span>.</span>
          </h2>
        </div>
        <p>
          Stock, spending and every decision.
          <br />
          The evidence is all here.
        </p>
      </header>
    </section>
  );
}
