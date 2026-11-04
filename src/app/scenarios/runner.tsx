"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { PurchasingSelect } from "@/components/purchasing-select";
import {
  Badge,
  DriftBadge,
  PageHeader,
  Panel,
  StatusBadge,
} from "@/components/ui";
import {
  CASE_PRESENTATION,
  PRESETS,
  type ApprovalOutcome,
  type CaseRecord,
  type RunResponse,
  type ScenarioPreset,
} from "./presets";
import { ScenarioGraphic, ScenarioDecisionReceipt } from "./scenario-graphic";
import "./scenarios.css";

type ResultView = "decision" | "checks" | "outcome";
const RESULT_VIEWS: { id: ResultView; label: string }[] = [
  { id: "decision", label: "Reasoning" },
  { id: "checks", label: "Checks & approval" },
  { id: "outcome", label: "Execution & verification" },
];
const GROUPS = [...new Set(PRESETS.map((preset) => preset.group))];

export default function ScenarioRunner({
  provider,
  pendingEvent,
  initialRecords,
}: {
  provider: string;
  pendingEvent: {
    id: string;
    po_id: string | null;
    supplier_id: string;
    payload: any;
  } | null;
  initialRecords: Record<string, CaseRecord>;
}) {
  const [selectedId, setSelectedId] = useState(PRESETS[0].id);
  const [busy, setBusy] = useState<string | null>(
    Object.entries(initialRecords).find(([, record]) => record.pendingRunId)?.[0] ?? null,
  );
  const [records, setRecords] = useState<Record<string, CaseRecord>>(initialRecords);
  const [resetting, setResetting] = useState(false);
  const [mode, setMode] = useState<"auto" | "deterministic" | "llm">("auto");
  const [approvingCase, setApprovingCase] = useState<string | null>(null);
  const approving = approvingCase !== null;
  const [resultViews, setResultViews] = useState<Record<string, ResultView>>(
    {},
  );
  const [completion, setCompletion] = useState<{
    id: string;
    sequence: number;
  } | null>(null);
  const router = useRouter();
  const resultRef = useRef<HTMLDivElement>(null);
  const libraryRef = useRef<HTMLElement>(null);
  const selectedIdRef = useRef(selectedId);
  const operationInFlight = useRef(false);
  selectedIdRef.current = selectedId;
  const selected =
    PRESETS.find((preset) => preset.id === selectedId) ?? PRESETS[0];
  const presentation = CASE_PRESENTATION[selected.id];
  const result = records[selected.id]?.result ?? null;
  const error = records[selected.id]?.error ?? null;
  const approvalOutcome = records[selected.id]?.approvalOutcome ?? null;
  const resultView = resultViews[selected.id] ?? "decision";
  const runningThisCase = busy === selected.id;
  const waitingForApproval =
    result?.status === "awaiting_approval" &&
    !!result.approvalId &&
    !approvalOutcome;

  useEffect(() => {
    const selectFromHash = () => {
      const id = window.location.hash.slice(1);
      if (!id) setSelectedId(PRESETS[0].id);
      else if (PRESETS.some((preset) => preset.id === id)) setSelectedId(id);
    };
    selectFromHash();
    window.addEventListener("hashchange", selectFromHash);
    window.addEventListener("popstate", selectFromHash);
    return () => {
      window.removeEventListener("hashchange", selectFromHash);
      window.removeEventListener("popstate", selectFromHash);
    };
  }, []);
  useEffect(() => {
    if (completion?.id !== selectedIdRef.current) return;
    const result = resultRef.current;
    result?.focus({ preventScroll: true });
    result?.scrollIntoView({
      block: "start",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, [completion]);
  // A run lives on the server, so a reload mid-run rejoins it by polling instead of
  // dropping the work the agent is still doing.
  const rejoining = Object.entries(records).find(([, record]) => record.pendingRunId);
  const rejoinCaseId = rejoining?.[0];
  const rejoinRunId = rejoining?.[1].pendingRunId;
  useEffect(() => {
    if (!rejoinCaseId || !rejoinRunId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/runs/${rejoinRunId}`, { cache: "no-store" });
        if (!res.ok) throw new Error("Run not found.");
        const { run } = await res.json();
        if (cancelled || run.status === "running") return;
        // A failed run never gets a payload; anything else without one is still
        // mid-commit, so keep waiting rather than reporting it as empty.
        if (!run.result_json && run.status !== "failed") return;
        setRecords((current) => ({
          ...current,
          [rejoinCaseId]: {
            result: run.result_json ? JSON.parse(run.result_json) : null,
            error: run.result_json ? null : (run.summary ?? "This run failed before reaching a decision."),
            approvalOutcome: null,
          },
        }));
        setBusy((current) => (current === rejoinCaseId ? null : current));
        announceCompletion(rejoinCaseId);
      } catch {
        if (cancelled) return;
        setRecords((current) => ({
          ...current,
          [rejoinCaseId]: {
            result: null,
            error: "This run could not be recovered. Run the scenario again.",
            approvalOutcome: null,
          },
        }));
        setBusy((current) => (current === rejoinCaseId ? null : current));
      }
    };
    void poll();
    const timer = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [rejoinCaseId, rejoinRunId]);

  useEffect(() => {
    const list = libraryRef.current;
    const item = list?.querySelector<HTMLButtonElement>(
      '[aria-pressed="true"]',
    );
    if (!list || !item) return;
    const listBounds = list.getBoundingClientRect();
    const itemBounds = item.getBoundingClientRect();
    if (itemBounds.top < listBounds.top)
      list.scrollTop -= listBounds.top - itemBounds.top;
    else if (itemBounds.bottom > listBounds.bottom)
      list.scrollTop += itemBounds.bottom - listBounds.bottom;
  }, [selectedId]);

  const selectCase = (id: string) => {
    setSelectedId(id);
    if (window.location.hash !== `#${id}`)
      window.history.pushState(window.history.state, "", `#${id}`);
  };
  const selectResultView = (view: ResultView) =>
    setResultViews((current) => ({ ...current, [selected.id]: view }));
  const announceCompletion = (id: string) =>
    setCompletion((current) => ({
      id,
      sequence: (current?.sequence ?? 0) + 1,
    }));

  // Each run commits real changes to stock, budget and orders, so repeating a scenario
  // answers a different question unless the world is put back first.
  async function resetWorld() {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    setResetting(true);
    try {
      const res = await fetch("/api/reset", { method: "POST" });
      if (!res.ok) throw new Error("Reset failed.");
      setRecords({});
      setResultViews({});
      setCompletion(null);
      router.refresh();
    } catch (e) {
      setRecords((current) => ({
        ...current,
        [selectedIdRef.current]: {
          ...current[selectedIdRef.current],
          result: current[selectedIdRef.current]?.result ?? null,
          approvalOutcome: current[selectedIdRef.current]?.approvalOutcome ?? null,
          error: e instanceof Error ? e.message : "Could not reset the workspace.",
        },
      }));
    } finally {
      setResetting(false);
      operationInFlight.current = false;
    }
  }

  async function run(preset: ScenarioPreset) {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    setBusy(preset.id);
    setRecords((current) => ({
      ...current,
      [preset.id]: { result: null, error: null, approvalOutcome: null },
    }));
    setResultViews((current) => ({ ...current, [preset.id]: "decision" }));
    try {
      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...preset.input, mode }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Run failed.");
      setRecords((current) => ({
        ...current,
        [preset.id]: { result: json, error: null, approvalOutcome: null },
      }));
    } catch (e) {
      setRecords((current) => ({
        ...current,
        [preset.id]: {
          result: null,
          error: e instanceof Error ? e.message : "Run failed.",
          approvalOutcome: null,
        },
      }));
    } finally {
      setBusy(null);
      operationInFlight.current = false;
      announceCompletion(preset.id);
    }
  }

  async function decide(action: "approve" | "reject") {
    const caseId = selected.id;
    const caseResult = records[caseId]?.result;
    if (!caseResult?.approvalId || operationInFlight.current) return;
    operationInFlight.current = true;
    setApprovingCase(caseId);
    setRecords((current) => ({
      ...current,
      [caseId]: { ...current[caseId], error: null },
    }));
    try {
      const res = await fetch(`/api/approvals/${caseResult.approvalId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          resolved_by: "buyer.maria",
          note: `${action} from scenario runner`,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed.");
      setRecords((current) => ({
        ...current,
        [caseId]: { ...current[caseId], approvalOutcome: { ...json, action } },
      }));
      setResultViews((current) => ({ ...current, [caseId]: "outcome" }));
    } catch (e) {
      setRecords((current) => ({
        ...current,
        [caseId]: {
          ...current[caseId],
          error:
            e instanceof Error ? e.message : "Could not save the decision.",
        },
      }));
    } finally {
      setApprovingCase(null);
      operationInFlight.current = false;
      announceCompletion(caseId);
    }
  }

  return (
    <div className="scenarios-page">
      <PageHeader
        title="Scenario lab."
        subtitle="Six purchasing challenges. Follow the evidence. Own the decision."
        actions={
          <div className="scenario-header-controls">
            <div className="scenario-mode-control">
              <label htmlFor="scenario-mode">Reasoning mode</label>
              <PurchasingSelect
                id="scenario-mode"
                label="Reasoning mode"
                value={mode}
                disabled={!!busy || approving || resetting}
                onChange={(value) => setMode(value as typeof mode)}
                options={[
                  {
                    value: "auto",
                    label: `Automatic${provider === "none" ? " (rules-based)" : ` (${provider})`}`,
                  },
                  { value: "deterministic", label: "Rules-based" },
                  {
                    value: "llm",
                    label: "LLM reasoning",
                    disabled: provider === "none",
                  },
                ]}
              />
            </div>
            <button
              type="button"
              className="scenario-reset-button"
              onClick={resetWorld}
              disabled={!!busy || approving || resetting}
              title="Restore stock, budgets and orders to their starting values"
            >
              <Icon name={resetting ? "activity" : "workflow"} size={16} />
              {resetting ? "Restoring…" : "Reset workspace"}
            </button>
          </div>
        }
      />
      <p className="sr-only" role="status">
        {approvingCase
          ? `Saving your decision for ${CASE_PRESENTATION[approvingCase].title}.`
          : busy
            ? `Pip is running ${CASE_PRESENTATION[busy].title}.`
            : completion
              ? `${CASE_PRESENTATION[completion.id].title}: ${records[completion.id]?.error ? "an issue needs attention" : "result ready"}.`
              : ""}
      </p>
      <div className="scenario-workbench">
        <aside className="scenario-library" aria-label="Scenario library">
          <div className="scenario-library-heading">
            <div>
              <span className="scenario-eyebrow">Case library</span>
              <h2>The case files</h2>
            </div>
            <span className="scenario-library-count">{PRESETS.length}</span>
          </div>
          <nav
            ref={libraryRef}
            className="scenario-case-list"
            aria-label="Purchasing scenarios"
          >
            {GROUPS.map((group) => (
              <div className="scenario-case-group" key={group}>
                <h3>{group}</h3>
                {PRESETS.filter((preset) => preset.group === group).map(
                  (preset) => {
                    const item = CASE_PRESENTATION[preset.id];
                    const saved = records[preset.id];
                    const needsApproval =
                      saved?.result?.status === "awaiting_approval" &&
                      !saved.approvalOutcome;
                    return (
                      <button
                        type="button"
                        key={preset.id}
                        className={`scenario-case${selected.id === preset.id ? " is-selected" : ""}`}
                        aria-pressed={selected.id === preset.id}
                        aria-controls="scenario-detail"
                        onClick={() => selectCase(preset.id)}
                      >
                        <span
                          className="scenario-index-number"
                          aria-hidden="true"
                        >
                          {String(PRESETS.indexOf(preset) + 1).padStart(2, "0")}
                        </span>
                        <span className="scenario-case-copy">
                          <strong>{item.title}</strong>
                          <span>{item.signal}</span>
                          <small>{item.location}</small>
                        </span>
                        <span className="scenario-case-indicator">
                          {busy === preset.id || approvingCase === preset.id ? (
                            <span
                              className="scenario-running-dot"
                              aria-label="Running"
                            />
                          ) : needsApproval ? (
                            <span
                              className="scenario-review-dot"
                              aria-label="Approval needed"
                            />
                          ) : saved?.error ? (
                            <>
                              <Icon name="help" size={16} />
                              <span className="sr-only">
                                This run needs attention
                              </span>
                            </>
                          ) : saved?.result ? (
                            <>
                              <Icon name="chart" size={16} />
                              <span className="sr-only">Result available</span>
                            </>
                          ) : (
                            <Icon name="chevron" size={15} />
                          )}
                        </span>
                      </button>
                    );
                  },
                )}
              </div>
            ))}
          </nav>
          <div className="scenario-library-note">
            <Icon name="shield" size={16} />
            <p>
              Every case follows the same checks.
              <br />
              Investigate. Decide. Act. Verify.
            </p>
          </div>
        </aside>

        <section
          id="scenario-detail"
          className="scenario-detail"
          aria-labelledby="scenario-detail-title"
        >
          <article key={selected.id} className="scenario-brief">
            <div className="scenario-brief-topline">
              <span className="scenario-eyebrow">{selected.group}</span>
              <span className="scenario-case-number">
                CASE {String(PRESETS.indexOf(selected) + 1).padStart(2, "0")}
              </span>
            </div>
            <div className="scenario-brief-heading">
              <div>
                <h2 id="scenario-detail-title">
                  {presentation.productName}
                  <span>.</span>
                </h2>
                <p>
                  <span>{presentation.product}</span>
                  <span aria-hidden="true">·</span>
                  {presentation.location}
                </p>
              </div>
            </div>
            {!result && (
              <>
                <p className="scenario-situation">{selected.situation}</p>
                <ScenarioGraphic caseId={selected.id} />
                <div className="scenario-question">
                  <span className="scenario-eyebrow">
                    What needs to be resolved
                  </span>
                  <p>{selected.tension}</p>
                </div>
                <details className="scenario-process">
                  <summary>
                    Four stages. One accountable decision.{" "}
                    <Icon name="chevron" size={16} />
                  </summary>
                  <ol>
                    <li>
                      <Icon name="search" size={16} />
                      <strong>Investigate</strong>
                      <span>Check stock, incoming supply, and demand.</span>
                    </li>
                    <li>
                      <Icon name="shield" size={16} />
                      <strong>Decide</strong>
                      <span>
                        Test supplier terms, budget, and storage limits.
                      </span>
                    </li>
                    <li>
                      <Icon name="orders" size={16} />
                      <strong>Act</strong>
                      <span>
                        Execute within policy or request your approval.
                      </span>
                    </li>
                    <li>
                      <Icon name="activity" size={16} />
                      <strong>Verify</strong>
                      <span>Compare the actual outcome and correct drift.</span>
                    </li>
                  </ol>
                </details>
              </>
            )}
            {result && (
              <details className="scenario-brief-recap">
                <summary>Review the original scenario</summary>
                <p>{selected.situation}</p>
                <p>{selected.tension}</p>
              </details>
            )}
            {pendingEvent && selected.input.po_id === pendingEvent.po_id && (
              <div className="scenario-supplier-event">
                <Icon name="bell" size={17} />
                <div>
                  <strong>
                    Latest supplier event · {pendingEvent.supplier_id}
                  </strong>
                  <p>
                    {pendingEvent.payload.confirmable_qty} of{" "}
                    {pendingEvent.payload.ordered_qty} units available —{" "}
                    {pendingEvent.payload.reason}
                  </p>
                </div>
              </div>
            )}
            <div className="scenario-run-bar">
              <p>
                {result
                  ? "Run again to evaluate the current workspace."
                  : "Uses current workspace data. Policy determines whether an order executes or awaits approval."}
              </p>
              <button
                type="button"
                onClick={() => run(selected)}
                disabled={!!busy || approving}
                className="scenario-run-button"
                aria-busy={runningThisCase}
              >
                <Icon name={runningThisCase ? "activity" : "arrow"} size={17} />
                {runningThisCase
                  ? "Pip is investigating…"
                  : result
                    ? "Run again"
                    : "Run this scenario"}
              </button>
            </div>
            {runningThisCase && (
              <div className="scenario-progress" role="status">
                <span className="scenario-running-dot" />
                <div>
                  <strong>
                    {rejoinCaseId === selected.id
                      ? "Rejoining a run already in progress"
                      : "Checking the purchasing plan"}
                  </strong>
                  <p>
                    {rejoinCaseId === selected.id
                      ? "This scenario was already running on the server when the page loaded. Its result will appear below as soon as it finishes."
                      : "Reviewing inventory, supplier terms, and purchasing constraints. The completed result will appear below."}
                  </p>
                </div>
              </div>
            )}
            {busy && !runningThisCase && (
              <p className="scenario-other-running">
                {CASE_PRESENTATION[busy].title} is running. You can review this
                brief while it finishes.
              </p>
            )}
            {approvingCase && approvingCase !== selected.id && (
              <p className="scenario-other-running">
                Saving your decision for{" "}
                {CASE_PRESENTATION[approvingCase].title}. You can review this
                brief while it finishes.
              </p>
            )}
          </article>

          <div
            ref={resultRef}
            tabIndex={-1}
            className="scenario-results"
            aria-label={`Result for ${presentation.title}`}
            aria-busy={runningThisCase || approvingCase === selected.id}
          >
            {error && (
              <div role="alert" className="scenario-error">
                <Icon name="help" size={19} />
                <div>
                  <strong>
                    {result
                      ? "The decision could not be saved"
                      : "The scenario could not finish"}
                  </strong>
                  <p>{error}</p>
                  <span>
                    {result
                      ? "Review the error, then try the approval action again."
                      : "The brief is still available. Run the scenario again when you are ready."}
                  </span>
                </div>
              </div>
            )}
            {result && (
              <>
                <ScenarioDecisionReceipt
                  result={result}
                  outcome={approvalOutcome}
                  submittedQty={
                    typeof selected.input.recommended_qty === "number"
                      ? selected.input.recommended_qty
                      : undefined
                  }
                  onOpenSection={(view) => {
                    selectResultView(view);
                    requestAnimationFrame(() => {
                      const panel = document.getElementById(
                        "scenario-result-panel",
                      );
                      panel?.focus({ preventScroll: true });
                      panel?.scrollIntoView({
                        block: "start",
                        behavior: window.matchMedia(
                          "(prefers-reduced-motion: reduce)",
                        ).matches
                          ? "instant"
                          : "smooth",
                      });
                    });
                  }}
                />

                {waitingForApproval && resultView !== "checks" && (
                  <div className="scenario-approval-prompt">
                    <div>
                      <strong>Your decision is needed</strong>
                      <span>
                        Review the policy checks before approving or rejecting
                        this purchase.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => selectResultView("checks")}
                    >
                      Review approval <Icon name="arrow" size={16} />
                    </button>
                  </div>
                )}
                <div
                  className="scenario-result-tabs"
                  role="tablist"
                  aria-label="Run details"
                >
                  {RESULT_VIEWS.map((view, index) => (
                    <button
                      type="button"
                      role="tab"
                      key={view.id}
                      id={`scenario-tab-${view.id}`}
                      aria-selected={resultView === view.id}
                      aria-controls="scenario-result-panel"
                      tabIndex={resultView === view.id ? 0 : -1}
                      onClick={() => selectResultView(view.id)}
                      onKeyDown={(event) => {
                        let next = index;
                        if (event.key === "ArrowRight")
                          next = (index + 1) % RESULT_VIEWS.length;
                        else if (event.key === "ArrowLeft")
                          next =
                            (index + RESULT_VIEWS.length - 1) %
                            RESULT_VIEWS.length;
                        else if (event.key === "Home") next = 0;
                        else if (event.key === "End")
                          next = RESULT_VIEWS.length - 1;
                        else return;
                        event.preventDefault();
                        selectResultView(RESULT_VIEWS[next].id);
                        event.currentTarget.parentElement
                          ?.querySelectorAll<HTMLButtonElement>("button")
                          [next]?.focus();
                      }}
                    >
                      {view.label}
                      {view.id === "checks" && waitingForApproval && (
                        <span className="scenario-tab-dot" />
                      )}
                    </button>
                  ))}
                </div>
                <div
                  key={`${selected.id}-${resultView}`}
                  id="scenario-result-panel"
                  className="scenario-result-panel"
                  role="tabpanel"
                  aria-labelledby={`scenario-tab-${resultView}`}
                  tabIndex={0}
                >
                  {resultView === "decision" && (
                    <>
                      {result.keyFactors?.length > 0 && (
                        <Panel title="Decision factors">
                          <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                            {result.keyFactors.map((f, i) => (
                              <div key={i} className="kv">
                                <span className="text-stone-600">
                                  {f.label}
                                </span>
                                <span
                                  className={`mono text-right ${
                                    f.impact === "opposes"
                                      ? "text-amber-800"
                                      : f.impact === "supports"
                                        ? "text-emerald-700"
                                        : "text-stone-800"
                                  }`}
                                >
                                  {f.value}
                                </span>
                              </div>
                            ))}
                          </div>
                        </Panel>
                      )}

                      <Panel title="Reasoning">
                        <ol className="space-y-2">
                          {result.rationale.map((r, i) => (
                            <li
                              key={i}
                              className="flex gap-2.5 text-[12.5px] leading-relaxed text-stone-700"
                            >
                              <span className="mono shrink-0 text-stone-600">
                                {String(i + 1).padStart(2, "0")}
                              </span>
                              <span>{r}</span>
                            </li>
                          ))}
                        </ol>
                      </Panel>

                      {result.llmDivergence && (
                        <Panel title="Model vs policy engine">
                          <div className="flex items-start gap-3">
                            <Badge
                              tone={
                                result.llmDivergence.diverged
                                  ? "amber"
                                  : "green"
                              }
                            >
                              {result.llmDivergence.diverged
                                ? "diverged"
                                : "agreed"}
                            </Badge>
                            <p className="text-[12.5px] leading-relaxed text-stone-700">
                              {result.llmDivergence.note}
                            </p>
                          </div>
                        </Panel>
                      )}
                    </>
                  )}
                  {resultView === "checks" && (
                    <>
                      {result.validation && (
                        <Panel
                          title="Constraint checks"
                          subtitle="Hard constraints must pass before a purchase can proceed."
                          right={
                            <Badge
                              tone={result.validation.passed ? "green" : "red"}
                            >
                              {result.validation.passed
                                ? "all hard constraints pass"
                                : `blocked: ${result.validation.bindingConstraint}`}
                            </Badge>
                          }
                        >
                          <div className="space-y-1.5">
                            {result.validation.checks.map((c) => (
                              <div
                                key={c.code}
                                className="flex items-start gap-2.5 text-[12.5px]"
                              >
                                <span
                                  className={`mt-0.5 shrink-0 ${c.passed ? "text-emerald-700" : c.severity === "hard" ? "text-rose-700" : "text-amber-800"}`}
                                >
                                  {c.passed
                                    ? "✓"
                                    : c.severity === "hard"
                                      ? "✕"
                                      : "!"}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <span className="block font-medium text-stone-800">
                                    {c.label}
                                  </span>
                                  <span
                                    className={
                                      c.passed
                                        ? "text-stone-600"
                                        : "text-stone-800"
                                    }
                                  >
                                    {c.detail}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </Panel>
                      )}

                      {result.autonomy && (
                        <Panel
                          title="Autonomy gate"
                          subtitle="Policy determines whether the purchase proceeds or needs approval."
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              tone={
                                result.autonomy.decision === "auto_execute"
                                  ? "green"
                                  : result.autonomy.decision ===
                                      "require_approval"
                                    ? "amber"
                                    : "red"
                              }
                            >
                              {result.autonomy.decision.replace(/_/g, " ")}
                            </Badge>
                            <Badge
                              tone={
                                result.autonomy.riskLevel === "high"
                                  ? "red"
                                  : result.autonomy.riskLevel === "medium"
                                    ? "amber"
                                    : "green"
                              }
                            >
                              {result.autonomy.riskLevel} risk
                            </Badge>
                          </div>
                          <ul className="mt-3 space-y-1.5">
                            {result.autonomy.reasons.map((r, i) => (
                              <li
                                key={i}
                                className="text-[12.5px] leading-relaxed text-stone-600"
                              >
                                — {r}
                              </li>
                            ))}
                          </ul>

                          {result.approvalId &&
                            result.status === "awaiting_approval" &&
                            !approvalOutcome && (
                              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-edge pt-4">
                                <span className="text-[12.5px] text-stone-600">
                                  You are the buyer:
                                </span>
                                <button
                                  onClick={() => decide("approve")}
                                  disabled={!!busy || approving}
                                  className="btn btn-ok"
                                >
                                  {approvingCase === selected.id
                                    ? "Saving decision…"
                                    : "Approve & execute"}
                                </button>
                                <button
                                  onClick={() => decide("reject")}
                                  disabled={!!busy || approving}
                                  className="btn btn-danger"
                                >
                                  Reject
                                </button>
                              </div>
                            )}
                        </Panel>
                      )}

                      {!result.validation && !result.autonomy && (
                        <div className="scenario-outcome-note">
                          <Icon name="shield" size={22} />
                          <div>
                            <h3>No policy checks were recorded</h3>
                            <p>
                              Open the reasoning trace to inspect how this run
                              ended.
                            </p>
                            <Link href={`/runs/${result.runId}`}>
                              View run trace <Icon name="arrow" size={15} />
                            </Link>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  {resultView === "outcome" && (
                    <>
                      {result.executedPoIds.length > 0 && (
                        <Panel title="Purchase orders created">
                          <div className="scenario-created-orders">
                            {result.executedPoIds.map((id) => (
                              <Badge key={id} tone="slate">
                                {id}
                              </Badge>
                            ))}
                            <Link href="/purchase-orders">
                              Open purchase orders{" "}
                              <Icon name="arrow" size={15} />
                            </Link>
                          </div>
                        </Panel>
                      )}
                      {approvalOutcome && (
                        <Panel
                          title={
                            approvalOutcome.action === "approve"
                              ? "Executed after approval"
                              : "Rejected"
                          }
                          right={
                            approvalOutcome.status ? (
                              <StatusBadge status={approvalOutcome.status} />
                            ) : null
                          }
                        >
                          {approvalOutcome.action === "reject" ? (
                            <p className="text-[13px] text-stone-700">
                              No purchase was made. The run is closed and the
                              rejection is recorded in the trace.
                            </p>
                          ) : (
                            <>
                              <div className="flex flex-wrap items-center gap-2">
                                {approvalOutcome.drift && (
                                  <DriftBadge
                                    severity={approvalOutcome.drift.severity}
                                  />
                                )}
                                {approvalOutcome.executedPoIds?.map(
                                  (id: string) => (
                                    <Badge key={id} tone="slate">
                                      {id}
                                    </Badge>
                                  ),
                                )}
                              </div>
                              {approvalOutcome.drift && (
                                <p className="mt-3 text-[13px] leading-relaxed text-stone-700">
                                  {approvalOutcome.drift.summary}
                                </p>
                              )}
                              {(approvalOutcome.remediations?.length ?? 0) >
                                0 && (
                                <div className="mt-3 border-t border-edge pt-3">
                                  <div className="label mb-2">
                                    Self-correction
                                  </div>
                                  {approvalOutcome.remediations?.map(
                                    (r: any, i: number) => (
                                      <p
                                        key={i}
                                        className="text-[12.5px] leading-relaxed text-stone-600"
                                      >
                                        Attempt {r.attempt} {r.ok ? "✓" : "✕"} —{" "}
                                        {r.rationale}
                                        {r.poId && (
                                          <>
                                            {" "}
                                            Created{" "}
                                            <span className="mono text-emerald-800">
                                              {r.poId}
                                            </span>
                                            .
                                          </>
                                        )}
                                      </p>
                                    ),
                                  )}
                                </div>
                              )}
                              <Link
                                href={`/runs/${approvalOutcome.runId ?? result.runId}`}
                                className="mt-3 inline-block text-[12.5px] text-emerald-800 hover:underline"
                              >
                                See the full trace including the correction →
                              </Link>
                            </>
                          )}
                        </Panel>
                      )}

                      {result.drift && (
                        <Panel
                          title="Post-execution verification"
                          subtitle="Checks the recorded order and stock position against the expected outcome."
                          right={
                            <DriftBadge severity={result.drift.severity} />
                          }
                        >
                          <p className="text-[13px] leading-relaxed text-stone-700">
                            {result.drift.summary}
                          </p>
                          <div className="mt-3 space-y-1.5">
                            {result.drift.findings.map((f, i) => (
                              <div
                                key={i}
                                className="flex items-start gap-2.5 text-[12.5px]"
                              >
                                <span
                                  className={`mt-0.5 shrink-0 ${f.severity === "none" ? "text-emerald-700" : f.severity === "benign" ? "text-emerald-800" : f.severity === "material" ? "text-amber-800" : "text-rose-700"}`}
                                >
                                  {f.severity === "none" ? "✓" : "!"}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <span className="block font-medium text-stone-800">
                                    {f.field}
                                  </span>
                                  <span className="text-stone-700">
                                    {f.note}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </Panel>
                      )}

                      {result.remediations?.length > 0 && (
                        <Panel
                          title="Self-correction"
                          subtitle="Follow-up actions taken to resolve a difference in the outcome."
                        >
                          {result.remediations.map((r, i) => (
                            <p
                              key={i}
                              className="text-[12.5px] leading-relaxed text-stone-700"
                            >
                              Attempt {r.attempt} {r.ok ? "✓" : "✕"} —{" "}
                              {r.rationale}
                              {r.poId && (
                                <>
                                  {" "}
                                  Created{" "}
                                  <span className="mono text-emerald-800">
                                    {r.poId}
                                  </span>
                                  .
                                </>
                              )}
                            </p>
                          ))}
                        </Panel>
                      )}

                      {!approvalOutcome &&
                        !result.drift &&
                        !result.remediations?.length &&
                        !result.executedPoIds.length && (
                          <div className="scenario-outcome-note">
                            <Icon
                              name={waitingForApproval ? "clock" : "orders"}
                              size={22}
                            />
                            <div>
                              <h3>
                                {waitingForApproval
                                  ? "Waiting for your decision"
                                  : "No execution outcome recorded"}
                              </h3>
                              <p>
                                {waitingForApproval
                                  ? "Review the checks and approve or reject the proposed purchase."
                                  : "The run has a recorded decision. Its full reasoning trace contains the execution details."}
                              </p>
                              {waitingForApproval ? (
                                <button
                                  type="button"
                                  onClick={() => selectResultView("checks")}
                                >
                                  Review checks & approval{" "}
                                  <Icon name="arrow" size={15} />
                                </button>
                              ) : (
                                <Link href={`/runs/${result.runId}`}>
                                  View run trace <Icon name="arrow" size={15} />
                                </Link>
                              )}
                            </div>
                          </div>
                        )}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
