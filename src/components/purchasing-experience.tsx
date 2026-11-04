"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Icon } from "./icons";
import { PurchasingChat } from "./purchasing-chat";
import "./purchasing-experience.css";

const PurchasingWorld = dynamic(
  () => import("./purchasing-world").then((module) => module.PurchasingWorld),
  { ssr: false },
);
const TOPICS = [
  {
    label: "Stock signals",
    title: (
      <>
        See the signal.
        <br />
        Stay one step ahead.
      </>
    ),
    description:
      "Find the stock that needs your attention. Understand the demand behind it before you decide.",
    prompt:
      "Which stock positions need attention, and what should I review first?",
    action: "Explore stock signals",
  },
  {
    label: "Supplier surprises",
    title: (
      <>
        A change of plan.
        <br />A clearer way forward.
      </>
    ),
    description:
      "Uncover supplier gaps, review your options, and keep your next delivery on course.",
    prompt: "What supplier updates or delivery risks should I review?",
    action: "Review supplier updates",
  },
  {
    label: "Smarter spending",
    title: (
      <>
        Know your limits.
        <br />
        Find your possibilities.
      </>
    ),
    description:
      "See the budget behind every decision. Balance what you need with the room you have.",
    prompt:
      "How much purchasing budget is available at each location, and what is already committed?",
    action: "Explore my budget",
  },
];

type Props = {
  stockAlerts: number;
  supplierUpdates: number;
  availableBudget: number;
  pendingApprovals: number;
  simulatedDate: string;
};
export function PurchasingExperience({
  stockAlerts,
  supplierUpdates,
  availableBudget,
  pendingApprovals,
  simulatedDate,
}: Props) {
  const [phase, setPhase] = useState<"intro" | "explore" | "chat">("intro");
  const [scene, setScene] = useState(0);
  const [initialPrompt, setInitialPrompt] = useState<string>();
  const [hasExplored, setHasExplored] = useState(false);
  const [returnPhase, setReturnPhase] = useState<"intro" | "explore">("intro");
  const heading = useRef<HTMLHeadingElement>(null);
  const activate = useRef<HTMLButtonElement>(null);
  const chatLayer = useRef<HTMLElement>(null);
  const chatTrigger = useRef<HTMLElement | null>(null);
  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  const openChat = useCallback((prompt?: string) => {
    if (phaseRef.current === "chat") {
      chatLayer.current?.querySelector("textarea")?.focus();
      return;
    }
    chatTrigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setReturnPhase(phaseRef.current === "explore" ? "explore" : "intro");
    setInitialPrompt(prompt);
    setPhase("chat");
  }, []);
  const explore = () => {
    setHasExplored(true);
    setPhase("explore");
  };
  const closeChat = useCallback(() => {
    setPhase(returnPhase);
    requestAnimationFrame(() => {
      const target = chatTrigger.current;
      if (target?.isConnected) target.focus();
      else activate.current?.focus();
    });
  }, [returnPhase]);
  useEffect(() => {
    if (phase === "chat")
      requestAnimationFrame(() =>
        chatLayer.current
          ?.querySelector("textarea")
          ?.focus({ preventScroll: true }),
      );
  }, [phase]);
  const changeScene = useCallback(
    (next: number) => setScene((next + TOPICS.length) % TOPICS.length),
    [],
  );
  useEffect(() => {
    if (phase === "explore") heading.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (phase === "chat" && event.key === "Escape") {
        event.preventDefault();
        closeChat();
        return;
      }
      if (
        phase !== "explore" ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      )
        return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        changeScene(scene + 1);
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        changeScene(scene - 1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [phase, scene, changeScene, closeChat]);
  const topic = TOPICS[scene];
  const signals = [
    `${stockAlerts} stock ${stockAlerts === 1 ? "position" : "positions"} to review`,
    `${supplierUpdates} supplier ${supplierUpdates === 1 ? "update" : "updates"}`,
    `${availableBudget.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} available`,
  ];
  return (
    <div
      className={`purchasing-experience experience-${phase}`}
      data-scene={scene}
    >
      <div className="experience-aurora" aria-hidden="true" />
      <div className="experience-grain" aria-hidden="true" />
      {hasExplored && (
        <div className="experience-world" aria-hidden="true">
          <PurchasingWorld
            activeScene={scene}
            onActivate={() => openChat(topic.prompt)}
          />
        </div>
      )}
      <a className="skip-link" href="#experience-main">
        Skip to experience
      </a>
      <header className="experience-header">
        <button
          type="button"
          className="experience-wordmark"
          onClick={() => setPhase("intro")}
          aria-label="Purchasing home"
        >
          purchasing
          <span />
          Pip
        </button>
        <nav aria-label="Experience navigation">
          <Link href="/dashboard" className="workspace-link">
            Open workspace
            <Icon name="arrow-up-right" size={14} />
          </Link>
          <button
            type="button"
            className="experience-ask"
            onClick={() => openChat()}
          >
            Ask Pip
            <Icon name="arrow" size={15} />
          </button>
        </nav>
      </header>
      <main id="experience-main" className="experience-main">
        {phase === "intro" && (
          <section className="intro-stage" aria-labelledby="intro-title">
            <article className="experience-intro-card">
              <div className="intro-art" aria-hidden="true">
                <PurchasingWorld miniature />
                <span className="intro-art-haze" />
              </div>
              <div className="intro-card-copy">
                <h1 id="intro-title">
                  Ready for a smarter
                  <br />
                  buying decision?
                </h1>
                <p>
                  Stock signals. Supplier surprises. Your next move.
                  <br />
                  Explore your purchasing world with Pip, and turn questions
                  into a clear way forward.
                </p>
                <button
                  ref={activate}
                  type="button"
                  className="intro-explore-button"
                  onClick={explore}
                >
                  Explore
                  <Icon name="arrow" size={16} />
                </button>
              </div>
            </article>
            <button
              className="intro-chat-link"
              type="button"
              onClick={() => openChat()}
            >
              Have a question? Ask Pip directly
              <Icon name="arrow-up-right" size={14} />
            </button>
          </section>
        )}
        {phase === "explore" && (
          <section className="topic-scene" aria-labelledby="topic-title">
            <div className="topic-copy" key={scene}>
              <span className="topic-number">0{scene + 1} / 03</span>
              <h1 id="topic-title" ref={heading} tabIndex={-1}>
                {topic.title}
              </h1>
              <p>{topic.description}</p>
            </div>
            <button
              type="button"
              className="scene-arrow scene-previous"
              onClick={() => changeScene(scene - 1)}
              aria-label="Previous topic"
            >
              <Icon name="arrow" size={21} />
            </button>
            <button
              type="button"
              className="scene-arrow scene-next"
              onClick={() => changeScene(scene + 1)}
              aria-label="Next topic"
            >
              <Icon name="arrow" size={21} />
            </button>
            <div className="world-action">
              <span className="world-signal">{signals[scene]}</span>
              <button
                ref={activate}
                type="button"
                onClick={() => openChat(topic.prompt)}
              >
                {topic.action}
                <Icon name="arrow-up-right" size={17} />
              </button>
            </div>
          </section>
        )}
        <section
          ref={chatLayer}
          className="experience-chat-layer"
          hidden={phase !== "chat"}
          aria-label="Purchasing assistant"
        >
          <div className="experience-chat-intro">
            <span>YOUR PURCHASING COMPANION</span>
            <h1>Let’s find your next move.</h1>
          </div>
          <PurchasingChat initialPrompt={initialPrompt} onClose={closeChat} />
        </section>
      </main>
      <footer className="experience-footer">
        <span className="experience-data-note">
          Live workspace · Simulated {simulatedDate}
        </span>
        <div
          className="experience-topic-nav"
          role="group"
          aria-label="Purchasing topics"
        >
          {TOPICS.map((item, index) => (
            <button
              key={item.label}
              type="button"
              aria-label={`${item.label}, topic ${index + 1} of 3`}
              aria-pressed={scene === index && phase === "explore"}
              onClick={() => {
                setHasExplored(true);
                setScene(index);
                setPhase("explore");
              }}
            >
              <span className="topic-nav-dot" />
              <span className="topic-nav-label">{item.label}</span>
            </button>
          ))}
        </div>
        <Link className="experience-approvals" href="/approvals">
          {pendingApprovals
            ? `${pendingApprovals} pending approvals`
            : "You’re in control"}
          <Icon name="shield" size={14} />
        </Link>
      </footer>
    </div>
  );
}
