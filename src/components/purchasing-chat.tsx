"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Icon, type IconName } from "./icons";
import { Mascot } from "./companion";
import "./purchasing-chat.css";

type Reply = {
  message: string;
  mode: "live-data" | "llm";
  suggestions: { label: string; prompt: string }[];
  actions: { label: string; href: string }[];
  sources: string[];
};

type Telemetry = {
  provider: string;
  model: string;
  streaming: boolean;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  accepted?: boolean;
  reason?: string;
  detail?: string;
};

type Message = {
  id: number;
  role: "user" | "assistant";
  content: string;
  reply?: Reply;
  streaming?: boolean;
  telemetry?: Telemetry;
};

const PROMPTS: { icon: IconName; label: string; prompt: string }[] = [
  {
    icon: "box",
    label: "Check stock alerts",
    prompt: "Which stock positions need attention right now?",
  },
  {
    icon: "wallet",
    label: "Review my budget",
    prompt: "How much purchasing budget is available at each location?",
  },
  {
    icon: "orders",
    label: "Look into suppliers",
    prompt: "Are there any supplier updates or delivery risks I should review?",
  },
  {
    icon: "check",
    label: "See pending approvals",
    prompt: "What purchasing decisions are waiting for my approval?",
  },
];
const ACTION_ROUTES = new Set([
  "/dashboard",
  "/inventory",
  "/approvals",
  "/purchase-orders",
  "/opportunities",
  "/runs",
  "/scenarios",
]);

function readReply(value: unknown): Reply {
  if (
    !value ||
    typeof value !== "object" ||
    !("message" in value) ||
    typeof value.message !== "string" ||
    !value.message.trim()
  ) {
    throw new Error("The reply was incomplete. Please try again.");
  }
  const data = value as Record<string, unknown>;
  return {
    message: value.message,
    mode: data.mode === "llm" ? "llm" : "live-data",
    suggestions: Array.isArray(data.suggestions)
      ? data.suggestions
          .filter(
            (item): item is Reply["suggestions"][number] =>
              !!item &&
              typeof item.label === "string" &&
              typeof item.prompt === "string",
          )
          .slice(0, 3)
      : [],
    actions: Array.isArray(data.actions)
      ? data.actions
          .filter(
            (item): item is Reply["actions"][number] =>
              !!item &&
              typeof item.label === "string" &&
              typeof item.href === "string" &&
              ACTION_ROUTES.has(item.href),
          )
          .slice(0, 3)
      : [],
    sources: Array.isArray(data.sources)
      ? data.sources
          .filter((item): item is string => typeof item === "string")
          .slice(0, 12)
      : [],
  };
}

function ProvenanceStrip({ telemetry }: { telemetry: Telemetry }) {
  const facts: string[] = [telemetry.provider, telemetry.model];
  if (telemetry.streaming) facts.push("streamed");
  if (typeof telemetry.latencyMs === "number")
    facts.push(`${(telemetry.latencyMs / 1000).toFixed(1)}s`);
  if (
    typeof telemetry.inputTokens === "number" ||
    typeof telemetry.outputTokens === "number"
  )
    facts.push(
      `${(telemetry.inputTokens ?? 0).toLocaleString("en-US")} in / ${(
        telemetry.outputTokens ?? 0
      ).toLocaleString("en-US")} out`,
    );
  if (typeof telemetry.costUsd === "number" && telemetry.costUsd > 0)
    facts.push(`$${telemetry.costUsd.toFixed(4)}`);
  const rejected = telemetry.accepted === false;
  return (
    <div className="pc-provenance" aria-label="Model call details">
      <ul>
        {facts.map((fact, index) => (
          <li key={`${index}-${fact}`}>{fact}</li>
        ))}
      </ul>
      {rejected && telemetry.reason && (
        <p className="pc-provenance-note">
          Streamed draft rejected and replaced with the verified answer —{" "}
          {telemetry.reason}
          {telemetry.detail ? ` (${telemetry.detail})` : ""}
        </p>
      )}
      {telemetry.accepted === true && (
        <p className="pc-provenance-note pc-provenance-note--ok">
          Streamed reply passed the verified-answer check.
        </p>
      )}
    </div>
  );
}

export function PurchasingChat({
  initialPrompt,
  onClose,
}: { initialPrompt?: string; onClose?: () => void } = {}) {
  const inputId = useId();
  const headingId = useId();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNewReply, setShowNewReply] = useState(false);
  const history = useRef<Message[]>([]);
  const nextId = useRef(1);
  const request = useRef<AbortController | null>(null);
  const pendingRetry = useRef<Message[] | null>(null);
  const inFlight = useRef(false);
  const disposed = useRef(false);
  const lastInitialPrompt = useRef("");
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const lastAssistant = useRef<HTMLElement>(null);
  const nearBottom = useRef(true);

  const scrollToLatest = useCallback(() => {
    const node = scroller.current;
    if (node) node.scrollTo({ top: node.scrollHeight, behavior: "auto" });
    nearBottom.current = true;
    setShowNewReply(false);
  }, []);

  const scrollToReply = useCallback(() => {
    const node = scroller.current;
    const reply = lastAssistant.current;
    if (!node || !reply) {
      scrollToLatest();
      return;
    }
    const top =
      reply.getBoundingClientRect().top -
      node.getBoundingClientRect().top +
      node.scrollTop -
      12;
    node.scrollTo({ top: Math.max(0, top), behavior: "auto" });
    nearBottom.current =
      node.scrollHeight - node.scrollTop - node.clientHeight < 100;
    setShowNewReply(false);
  }, [scrollToLatest]);

  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
      request.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (nearBottom.current) {
      const frame = requestAnimationFrame(() => {
        if (messages.at(-1)?.role === "assistant") scrollToReply();
        else scrollToLatest();
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [messages, busy, error, scrollToLatest, scrollToReply]);

  const send = useCallback(async (text: string, retry = false) => {
    const content = text.trim();
    if (inFlight.current || (!retry && !content)) return;
    if (!retry && content.length > 2000) {
      setError("Please keep your question under 2,000 characters.");
      return;
    }
    const updated = retry
      ? pendingRetry.current
      : [
          ...history.current,
          { id: nextId.current++, role: "user" as const, content },
        ];
    if (!updated?.length) return;
    if (!retry) {
      history.current = updated;
      setMessages(updated);
      setDraft("");
      nearBottom.current = true;
      setShowNewReply(false);
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    pendingRetry.current = updated;
    const controller = new AbortController();
    request.current = controller;
    let timedOut = false;
    const requestTimeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 75_000);
    try {
      let context = updated.slice(-20).map(({ role, content: message }) => ({
        role,
        content: message.slice(0, 2000),
      }));
      let body = JSON.stringify({ messages: context });
      // The endpoint also bounds UTF-8 bytes, not only JavaScript characters.
      const encoder = new TextEncoder();
      while (context.length > 1 && encoder.encode(body).byteLength > 48_000) {
        context = context.slice(1);
        body = JSON.stringify({ messages: context });
      }
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });
      if (!response.ok || !response.body)
        throw new Error(
          response.status === 429
            ? "Pip is receiving too many requests. Try again in a moment."
            : "Pip couldn’t load the workspace data. Please try again.",
        );

      const slotId = nextId.current++;
      let slot: Message = {
        id: slotId,
        role: "assistant",
        content: "",
        streaming: true,
      };
      const publish = () => {
        const next = [...updated, { ...slot }];
        history.current = next;
        setMessages(next);
      };
      publish();

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let settled = false;

      // Server-sent events arrive on arbitrary chunk boundaries, so a partial
      // frame has to survive until its terminator shows up in a later chunk.
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let split = buffer.indexOf("\n\n");
        while (split !== -1) {
          const frame = buffer.slice(0, split).trim();
          buffer = buffer.slice(split + 2);
          split = buffer.indexOf("\n\n");
          if (!frame.startsWith("data:")) continue;
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(frame.slice(5).trim()) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (disposed.current || controller.signal.aborted) return;
          if (event.type === "meta") {
            slot = {
              ...slot,
              telemetry: {
                provider: String(event.provider ?? "unknown"),
                model: String(event.model ?? "unknown"),
                streaming: event.streaming !== false,
              },
            };
            publish();
          } else if (event.type === "delta") {
            slot = { ...slot, content: slot.content + String(event.text ?? "") };
            publish();
          } else if (event.type === "settled") {
            const reply = readReply(event.reply);
            const usage = (event.usage ?? {}) as Record<string, unknown>;
            slot = {
              ...slot,
              content: reply.message,
              reply,
              streaming: false,
              telemetry: {
                provider: slot.telemetry?.provider ?? "none",
                model: slot.telemetry?.model ?? "—",
                streaming: slot.telemetry?.streaming ?? false,
                latencyMs:
                  typeof event.latencyMs === "number" ? event.latencyMs : undefined,
                inputTokens:
                  typeof usage.inputTokens === "number" ? usage.inputTokens : undefined,
                outputTokens:
                  typeof usage.outputTokens === "number" ? usage.outputTokens : undefined,
                costUsd: typeof usage.costUsd === "number" ? usage.costUsd : undefined,
                accepted: event.accepted === true,
                reason:
                  typeof event.reason === "string" ? event.reason : undefined,
                detail:
                  typeof event.detail === "string" ? event.detail : undefined,
              },
            };
            publish();
            settled = true;
          } else if (event.type === "error") {
            throw new Error(
              typeof event.message === "string"
                ? event.message
                : "Pip returned an incomplete reply. Please try again.",
            );
          }
        }
      }
      if (!settled)
        throw new Error("Pip returned an incomplete reply. Please try again.");
      pendingRetry.current = null;
      if (!nearBottom.current) setShowNewReply(true);
    } catch (cause) {
      if (!disposed.current && timedOut) {
        setError("The workspace took too long to respond. Please try again.");
      } else if (!disposed.current && !controller.signal.aborted)
        setError(
          cause instanceof TypeError
            ? "The connection was interrupted. Please try again."
            : cause instanceof Error
              ? cause.message
              : "Something went wrong. Please try again.",
        );
    } finally {
      clearTimeout(requestTimeout);
      if (!disposed.current) {
        inFlight.current = false;
        setBusy(false);
        request.current = null;
      }
    }
  }, []);

  useEffect(() => {
    if (!initialPrompt?.trim()) {
      lastInitialPrompt.current = "";
      return;
    }
    if (lastInitialPrompt.current === initialPrompt) return;
    const timer = setTimeout(() => {
      if (inFlight.current) return;
      lastInitialPrompt.current = initialPrompt;
      void send(initialPrompt);
    }, 0);
    return () => clearTimeout(timer);
  }, [initialPrompt, send, busy]);

  const reset = () => {
    if (inFlight.current) return;
    history.current = [];
    pendingRetry.current = null;
    nearBottom.current = true;
    setMessages([]);
    setDraft("");
    setError(null);
    setShowNewReply(false);
    input.current?.focus();
  };
  const latestReply = messages[messages.length - 1]?.reply;

  return (
    <section className="purchasing-chat" aria-labelledby={headingId}>
      <header className="pc-header">
        <div className="pc-header-identity">
          <span className="pc-avatar" aria-hidden="true">
            <Mascot compact />
          </span>
          <div>
            <h2 id={headingId}>
              Pip <span>· Purchasing assistant</span>
            </h2>
            <p>
              <span className="pc-status-dot" />
              Live workspace data
            </p>
          </div>
        </div>
        <div className="pc-header-controls">
          {messages.length > 0 && (
            <button
              type="button"
              className="pc-reset"
              onClick={reset}
              disabled={busy}
            >
              New conversation
            </button>
          )}
          {onClose && (
            <button
              type="button"
              className="pc-icon-button"
              aria-label="Close conversation"
              onClick={onClose}
            >
              <Icon name="close" size={19} />
            </button>
          )}
        </div>
      </header>

      <div
        className="pc-content"
        role="region"
        aria-label="Conversation messages"
        tabIndex={0}
        ref={scroller}
        onScroll={() => {
          const node = scroller.current;
          if (!node) return;
          nearBottom.current =
            node.scrollHeight - node.scrollTop - node.clientHeight < 100;
          if (nearBottom.current) setShowNewReply(false);
        }}
      >
        {messages.length === 0 ? (
          <div className="pc-welcome">
            <span className="pc-welcome-label">
              YOUR NEXT DECISION STARTS HERE
            </span>
            <h3>
              What would you like
              <br className="pc-desktop-break" /> to look into?
            </h3>
            <p>
              Ask about your stock, suppliers, or budget.
              <br />
              We’ll work through the next step together.
            </p>
            <div className="pc-prompt-grid">
              {PROMPTS.map((prompt) => (
                <button
                  key={prompt.label}
                  type="button"
                  onClick={() => void send(prompt.prompt)}
                  disabled={busy}
                >
                  <Icon name={prompt.icon} size={19} />
                  <span>{prompt.label}</span>
                  <Icon name="arrow" size={16} />
                </button>
              ))}
            </div>
            <div className="pc-welcome-note">
              <Icon name="shield" size={16} />
              <span>Review suggested actions before making a purchase.</span>
            </div>
          </div>
        ) : (
          <div
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            aria-label="Conversation with Pip"
            className="pc-thread"
          >
            {messages.map((message) => (
              <article
                key={message.id}
                ref={
                  message.role === "assistant" &&
                  message.id === messages.at(-1)?.id
                    ? lastAssistant
                    : undefined
                }
                className={`pc-message pc-message--${message.role}`}
                aria-label={message.role === "user" ? "You" : "Pip"}
              >
                {message.role === "assistant" && (
                  <span className="pc-message-avatar" aria-hidden="true">
                    <Mascot compact />
                  </span>
                )}
                <div className="pc-message-content">
                  {message.role === "assistant" && (
                    <div className="pc-message-author">
                      Pip
                      <span>
                        {message.streaming
                          ? "Streaming from the model…"
                          : message.reply?.mode === "llm"
                            ? "AI-assisted · Live data"
                            : "Workspace snapshot"}
                      </span>
                    </div>
                  )}
                  {message.telemetry && (
                    <ProvenanceStrip telemetry={message.telemetry} />
                  )}
                  <div className="pc-message-text">
                    {message.content}
                    {message.streaming && (
                      <span className="pc-caret" aria-hidden="true" />
                    )}
                  </div>
                  {message.reply && message.reply.actions.length > 0 && (
                    <div
                      className="pc-action-links"
                      aria-label="Suggested actions"
                    >
                      {message.reply.actions.map((action) => (
                        <Link
                          href={action.href}
                          key={`${action.href}-${action.label}`}
                          onNavigate={onClose}
                        >
                          {action.label}
                          <Icon name="arrow" size={16} />
                        </Link>
                      ))}
                    </div>
                  )}
                  {message.reply && message.reply.sources.length > 0 && (
                    <details className="pc-sources">
                      <summary>
                        Based on {message.reply.sources.length} workspace{" "}
                        {message.reply.sources.length === 1
                          ? "source"
                          : "sources"}
                      </summary>
                      <ul>
                        {message.reply.sources.map((source, index) => (
                          <li key={`${index}-${source}`}>{source}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
        {busy && messages.at(-1)?.role !== "assistant" && (
          <div className="pc-thinking" role="status">
            <span className="pc-thinking-dot" />
            <span>Checking your workspace…</span>
          </div>
        )}
        {error && (
          <div className="pc-error" role="alert">
            <span>{error}</span>
            {pendingRetry.current && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void send("", true)}
              >
                Try again <Icon name="arrow" size={15} />
              </button>
            )}
          </div>
        )}
        {!busy &&
          !error &&
          latestReply &&
          latestReply.suggestions.length > 0 && (
            <div className="pc-follow-ups" aria-label="Follow-up questions">
              {latestReply.suggestions.map((suggestion) => (
                <button
                  type="button"
                  key={suggestion.prompt}
                  onClick={() => void send(suggestion.prompt)}
                >
                  {suggestion.label}
                  <Icon name="arrow" size={14} />
                </button>
              ))}
            </div>
          )}
      </div>
      {showNewReply && (
        <button type="button" className="pc-jump" onClick={scrollToReply}>
          New reply <Icon name="arrow" size={14} />
        </button>
      )}
      <form
        className="pc-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        <div className="pc-input-shell">
          <label htmlFor={inputId} className="sr-only">
            Ask Pip a purchasing question
          </label>
          <textarea
            ref={input}
            id={inputId}
            rows={2}
            maxLength={2000}
            value={draft}
            placeholder="Ask Pip about your purchasing…"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void send(draft);
              }
            }}
          />
          <button
            type="submit"
            aria-label="Send message"
            disabled={busy || !draft.trim()}
          >
            <Icon name="arrow" size={20} />
          </button>
        </div>
        <div className="pc-composer-footer">
          <span>
            Answers from your workspace. Actions stay in your control.
          </span>
          <span className="pc-keyboard-hint">Enter to send</span>
        </div>
      </form>
    </section>
  );
}
