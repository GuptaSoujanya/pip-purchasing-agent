"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Icon, type IconName } from "./icons";
import { PurchasingChat } from "./purchasing-chat";
import { WorkspaceMenu } from "./workspace-menu";
import { DesktopMotion } from "./desktop-motion";
import { BuyerAvatar } from "./companion";
import "./workspace-shell.css";

const NAV: {
  href: string;
  label: string;
  icon: IconName;
  description: string;
  group: "Workspace" | "Operations" | "Tools";
}[] = [
  {
    href: "/#workspace",
    label: "Overview",
    icon: "grid",
    description: "Stock, suppliers and purchasing capacity",
    group: "Workspace",
  },
  {
    href: "/opportunities",
    label: "Opportunities",
    icon: "search",
    description: "Find and investigate purchasing risks",
    group: "Workspace",
  },
  {
    href: "/approvals",
    label: "Approvals",
    icon: "check",
    description: "Review decisions waiting for your sign-off",
    group: "Workspace",
  },
  {
    href: "/purchase-orders",
    label: "Purchase orders",
    icon: "orders",
    description: "Track orders and deliveries",
    group: "Operations",
  },
  {
    href: "/inventory",
    label: "Inventory",
    icon: "box",
    description: "Stock levels across your locations",
    group: "Operations",
  },
  {
    href: "/runs",
    label: "Agent activity",
    icon: "activity",
    description: "Inspect decisions and reasoning",
    group: "Operations",
  },
  {
    href: "/scenarios",
    label: "Scenarios",
    icon: "workflow",
    description: "Run a purchasing scenario",
    group: "Tools",
  },
  {
    href: "/evaluation",
    label: "Evaluation",
    icon: "chart",
    description: "Check agent performance",
    group: "Tools",
  },
];

type AssistantContextValue = {
  openChat: (prompt?: string) => void;
  setScene: (index: number) => void;
  setImmersive: (active: boolean) => void;
  selectedNode: number;
  setSelectedNode: (index: number) => void;
};
const PurchasingAssistantContext = createContext<AssistantContextValue | null>(
  null,
);
export function usePurchasingAssistant() {
  const context = useContext(PurchasingAssistantContext);
  if (!context)
    throw new Error(
      "usePurchasingAssistant must be used inside WorkspaceShell",
    );
  return context;
}

type ModalKind = "chat" | "search" | "menu";
const ROUTE_STAGES: Record<string, { label: string; icon: IconName }> = {
  "/opportunities": { label: "Investigate", icon: "search" },
  "/inventory": { label: "Investigate", icon: "search" },
  "/scenarios": { label: "Decide", icon: "workflow" },
  "/approvals": { label: "Decide", icon: "check" },
  "/purchase-orders": { label: "Act", icon: "orders" },
  "/runs": { label: "Verify", icon: "activity" },
  "/evaluation": { label: "Verify", icon: "chart" },
};
function dismissBackdrop(event: MouseEvent<HTMLDialogElement>) {
  if (event.target !== event.currentTarget) return;
  const rect = event.currentTarget.getBoundingClientRect();
  if (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  )
    event.currentTarget.close();
}

function scrollToFragment(hash: string, behavior: ScrollBehavior = "instant") {
  let fragment = hash.replace(/^#/, "");
  try {
    fragment = decodeURIComponent(fragment);
  } catch {
    // A malformed fragment can still be a literal element ID.
  }
  const target = fragment
    ? (document.getElementById(fragment) ??
      document.getElementsByName(fragment)[0])
    : null;
  if (target) target.scrollIntoView({ block: "start", behavior });
  else window.scrollTo({ top: 0, left: 0, behavior });
}

export function WorkspaceShell({
  children,
  simulatedDate,
}: {
  children: ReactNode;
  simulatedDate: string;
}) {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const previousPath = useRef(pathname);
  const historyTraversal = useRef(false);
  const [, setScene] = useState(0);
  const [selectedNode, setSelectedNode] = useState(0);
  const [, setImmersive] = useState(isHome);
  const [activeModal, setActiveModal] = useState<ModalKind | null>(null);
  const [initialPrompt, setInitialPrompt] = useState<string>();
  const [query, setQuery] = useState("");
  const chat = useRef<HTMLDialogElement>(null);
  const menu = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const askButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const suppressFocusReturn = useRef(false);
  const active = NAV.find((item) =>
    item.href === "/#workspace" ? isHome : pathname.startsWith(item.href),
  );
  const stage = active ? ROUTE_STAGES[active.href] : undefined;

  const closeDialogs = useCallback(() => {
    chat.current?.close();
    menu.current?.close();
    search.current?.close();
  }, []);

  const navigateToPage = (
    event: MouseEvent<HTMLAnchorElement>,
    href: string,
  ) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.defaultPrevented ||
      (event.currentTarget.target && event.currentTarget.target !== "_self") ||
      event.currentTarget.hasAttribute("download")
    )
      return;
    const destination = new URL(href, window.location.href);
    if (destination.origin !== window.location.origin) return;
    suppressFocusReturn.current = true;
    historyTraversal.current = false;
    closeDialogs();
    if (
      destination.pathname !== pathname ||
      destination.search !== window.location.search
    )
      return;
    event.preventDefault();
    const previousUrl = window.location.href;
    if (destination.href !== previousUrl) {
      window.history.pushState(window.history.state, "", destination.href);
      window.dispatchEvent(
        new HashChangeEvent("hashchange", {
          oldURL: previousUrl,
          newURL: destination.href,
        }),
      );
    }
    requestAnimationFrame(() => {
      if (historyTraversal.current || window.location.href !== destination.href)
        return;
      scrollToFragment(
        destination.hash,
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      );
    });
  };

  const openDialog = useCallback((kind: ModalKind) => {
    suppressFocusReturn.current = false;
    const dialogs = {
      chat: chat.current,
      menu: menu.current,
      search: search.current,
    };
    if (!Object.values(dialogs).some((dialog) => dialog?.open)) {
      returnFocus.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    }
    Object.entries(dialogs).forEach(([name, dialog]) => {
      if (name !== kind) dialog?.close();
    });
    const dialog = dialogs[kind];
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    setActiveModal(kind);
    requestAnimationFrame(() => {
      if (!dialog.open) return;
      if (kind === "search") searchInput.current?.focus();
      if (kind === "chat") dialog.querySelector("textarea")?.focus();
    });
  }, []);

  const openChat = useCallback(
    (prompt?: string) => {
      setInitialPrompt(prompt);
      openDialog("chat");
    },
    [openDialog],
  );
  const openSearch = useCallback(() => {
    setQuery("");
    openDialog("search");
  }, [openDialog]);

  const onDialogClose = (kind: ModalKind) => {
    setActiveModal((current) => (current === kind ? null : current));
    if (kind === "chat") setInitialPrompt(undefined);
    requestAnimationFrame(() => {
      if (suppressFocusReturn.current) return;
      if (chat.current?.open || menu.current?.open || search.current?.open)
        return;
      const previous = returnFocus.current;
      if (previous?.isConnected && !previous.closest("dialog:not([open])"))
        previous.focus({ preventScroll: true });
      else askButton.current?.focus({ preventScroll: true });
    });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearch();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openSearch]);
  useEffect(() => {
    const preserveHistoryPosition = () => {
      historyTraversal.current = true;
    };
    const markLinkNavigation = (event: globalThis.MouseEvent) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.defaultPrevented
      )
        return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (
        !anchor ||
        anchor.hasAttribute("download") ||
        (anchor.target && anchor.target !== "_self")
      )
        return;
      if (
        new URL(anchor.href, window.location.href).origin !==
        window.location.origin
      )
        return;
      historyTraversal.current = false;
      suppressFocusReturn.current = true;
    };
    window.addEventListener("popstate", preserveHistoryPosition);
    document.addEventListener("click", markLinkNavigation, true);
    return () => {
      window.removeEventListener("popstate", preserveHistoryPosition);
      document.removeEventListener("click", markLinkNavigation, true);
    };
  }, []);
  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    suppressFocusReturn.current = true;
    if (historyTraversal.current) {
      historyTraversal.current = false;
      return;
    }
    // Next can retain a visible page fragment beneath the sticky navigation.
    // New destinations start at their heading; back/forward keeps native restoration.
    const frame = requestAnimationFrame(() => {
      if (historyTraversal.current || window.location.pathname !== pathname)
        return;
      scrollToFragment(window.location.hash);
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname]);
  useEffect(() => {
    closeDialogs();
    setImmersive(isHome);
    if (!isHome) setScene(0);
  }, [pathname, isHome, closeDialogs]);
  useEffect(() => {
    if (!activeModal) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [activeModal]);

  const assistant = useMemo(
    () => ({ openChat, setScene, setImmersive, selectedNode, setSelectedNode }),
    [openChat, selectedNode],
  );
  const results = NAV.filter((item) =>
    `${item.label} ${item.description}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );

  return (
    <PurchasingAssistantContext.Provider value={assistant}>
      <DesktopMotion />
      <div
        className={`unified-shell ${isHome ? "unified-shell-home is-immersive" : "unified-shell-workspace"}${activeModal ? " has-dialog" : ""}`}
      >
        <a className="unified-skip" href="#main-content">
          Skip to content
        </a>
        <header className="unified-header">
          <Link
            href="/"
            className="unified-wordmark"
            aria-label="Purchasing with Pip, home"
            onClick={(event) => navigateToPage(event, "/")}
          >
            <span className="unified-brand-copy">
              <strong>
                pip<span>.</span>
              </strong>
              <small>
                Purchasing
                <br />
                with perspective
              </small>
            </span>
          </Link>
          <nav className="unified-primary-nav" aria-label="Main navigation">
            {[NAV[0], NAV[1], NAV[4], NAV[2], NAV[3], NAV[6]].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active?.href === item.href ? "page" : undefined}
                onClick={(event) => navigateToPage(event, item.href)}
              >
                {item.label}
              </Link>
            ))}
            <WorkspaceMenu
              items={[NAV[5], NAV[7]]}
              activeHref={active?.href}
              onNavigate={navigateToPage}
            />
          </nav>
          <div className="unified-header-actions">
            <button
              type="button"
              className="unified-search-trigger unified-icon-button"
              aria-label="Search workspace (Command or Control K)"
              aria-haspopup="dialog"
              aria-controls="workspace-search"
              onClick={openSearch}
            >
              <Icon name="search" size={18} />
              <kbd>⌘ K</kbd>
            </button>
            <button
              ref={askButton}
              type="button"
              className="unified-ask"
              aria-haspopup="dialog"
              aria-controls="purchasing-assistant"
              onClick={() => openChat()}
            >
              <span className="unified-pip-dot" />
              Ask Pip <Icon name="arrow-up-right" size={15} />
            </button>
            <span className="unified-buyer-avatar" title="Buyer workspace">
              <BuyerAvatar />
            </span>
            <button
              type="button"
              className="unified-mobile-menu unified-icon-button"
              aria-label="Open workspace navigation"
              aria-haspopup="dialog"
              aria-controls="workspace-navigation"
              aria-expanded={activeModal === "menu"}
              onClick={() => openDialog("menu")}
            >
              <Icon name="menu" size={21} />
            </button>
          </div>
        </header>
        {!isHome && active && (
          <nav className="unified-breadcrumb" aria-label="Breadcrumb">
            <ol>
              <li>
                <Link
                  href="/#workspace"
                  onClick={(event) => navigateToPage(event, "/#workspace")}
                >
                  Overview
                </Link>
              </li>
              {stage && (
                <li>
                  <Icon name="chevron" size={12} />
                  <span className="unified-stage">
                    <Icon name={stage.icon} size={14} />
                    {stage.label}
                  </span>
                </li>
              )}
              <li>
                <Icon name="chevron" size={12} />
                <span aria-current="page">{active.label}</span>
              </li>
            </ol>
          </nav>
        )}
        <main
          key={pathname}
          id="main-content"
          tabIndex={-1}
          className={isHome ? "unified-home" : "unified-content"}
        >
          {children}
        </main>
        <footer className="unified-footer">
          <span className="unified-footer-brand">
            <strong>pip.</strong>
            <span>Every move, considered.</span>
          </span>
          <span>Simulation · {simulatedDate}</span>
        </footer>
        <dialog
          id="purchasing-assistant"
          ref={chat}
          className="unified-dialog unified-chat-dialog"
          aria-label="Ask Pip, purchasing assistant"
          onClose={() => onDialogClose("chat")}
          onClick={dismissBackdrop}
        >
          <PurchasingChat
            initialPrompt={initialPrompt}
            onClose={() => chat.current?.close()}
          />
        </dialog>
        <dialog
          id="workspace-navigation"
          ref={menu}
          className="unified-dialog unified-menu-dialog"
          aria-labelledby="workspace-navigation-title"
          onClose={() => onDialogClose("menu")}
          onClick={dismissBackdrop}
        >
          <div className="unified-dialog-heading">
            <div>
              <span className="unified-dialog-eyebrow">Your workspace</span>
              <h2 id="workspace-navigation-title">
                A clearer view of purchasing.
              </h2>
            </div>
            <button
              type="button"
              className="unified-dialog-close"
              aria-label="Close navigation"
              onClick={() => menu.current?.close()}
            >
              <Icon name="close" size={20} />
            </button>
          </div>
          <button
            className="unified-menu-search"
            type="button"
            onClick={openSearch}
          >
            <Icon name="search" size={18} />
            <span>Find a page</span>
            <kbd>⌘ K</kbd>
          </button>
          <nav
            className="unified-route-groups"
            aria-label="All workspace pages"
          >
            {(["Workspace", "Operations", "Tools"] as const).map((group) => (
              <div key={group} className="unified-route-group">
                <h3>{group}</h3>
                {NAV.filter((item) => item.group === group).map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={
                      active?.href === item.href ? "page" : undefined
                    }
                    onClick={(event) => navigateToPage(event, item.href)}
                  >
                    <Icon name={item.icon} size={18} />
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                    </span>
                    <Icon name="arrow-up-right" size={16} />
                  </Link>
                ))}
              </div>
            ))}
          </nav>
        </dialog>
        <dialog
          id="workspace-search"
          ref={search}
          className="unified-dialog unified-search-dialog"
          aria-labelledby="workspace-search-title"
          onClose={() => onDialogClose("search")}
          onClick={dismissBackdrop}
        >
          <div className="unified-dialog-heading">
            <h2 id="workspace-search-title">Find your next step.</h2>
            <button
              type="button"
              className="unified-dialog-close"
              aria-label="Close search"
              onClick={() => search.current?.close()}
            >
              <Icon name="close" size={20} />
            </button>
          </div>
          <label className="unified-search-field">
            <Icon name="search" size={20} />
            <input
              ref={searchInput}
              type="search"
              aria-label="Search workspace pages"
              placeholder="Search inventory, orders, approvals…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <kbd>esc</kbd>
          </label>
          <nav className="unified-search-results" aria-label="Search results">
            {results.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={(event) => navigateToPage(event, item.href)}
              >
                <Icon name={item.icon} size={19} />
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
                <Icon name="arrow-up-right" size={17} />
              </Link>
            ))}
            {results.length === 0 && (
              <p className="unified-search-empty" role="status">
                No pages found. Try “inventory” or “orders”.
              </p>
            )}
          </nav>
        </dialog>
      </div>
    </PurchasingAssistantContext.Provider>
  );
}
