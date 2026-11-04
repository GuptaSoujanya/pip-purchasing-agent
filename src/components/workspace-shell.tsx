"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./icons";
import { BuyerAvatar } from "./companion";

const NAV: {
  href: string;
  label: string;
  icon: IconName;
  description: string;
  group: "Workspace" | "Operations" | "Tools";
}[] = [
  {
    href: "/dashboard",
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

export function WorkspaceShell({
  children,
  simulatedDate,
}: {
  children: React.ReactNode;
  simulatedDate: string;
}) {
  const pathname = usePathname();
  const active =
    NAV.find((n) =>
      n.href === "/" ? pathname === "/" : pathname.startsWith(n.href),
    ) ?? NAV[0];
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const search = useRef<HTMLDialogElement>(null);
  const menu = useRef<HTMLDialogElement>(null);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const openSearch = () => {
    setQuery("");
    search.current?.showModal();
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setQuery("");
        search.current?.showModal();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    menu.current?.close();
    setMenuOpen(false);
    search.current?.close();
  }, [pathname]);
  const results = NAV.filter((n) =>
    `${n.label} ${n.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  if (pathname === "/") return <>{children}</>;

  const sidebarContent = (
    <>
      <Link href="/" className="brand" aria-label="AI Purchasing Agent home">
        purchasing<span className="brand-caption">Operations workspace</span>
      </Link>
      <nav aria-label="Main navigation" className="workspace-nav">
        {(["Workspace", "Operations", "Tools"] as const).map((group) => (
          <div className="nav-group" key={group}>
            <div className="workspace-label">{group}</div>
            {NAV.filter((item) => item.group === group).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => {
                  menu.current?.close();
                  setMenuOpen(false);
                }}
                className={`nav-item ${active.href === item.href ? "is-active" : ""}`}
                aria-current={active.href === item.href ? "page" : undefined}
              >
                <Icon name={item.icon} size={18} />
                <span>{item.label}</span>
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <Link href="/" className="nav-item assistant-nav-link">
          <Icon name="workflow" size={18} />
          <span>Ask Pip</span>
          <Icon name="arrow-up-right" size={15} />
        </Link>
        <div className="workspace-note">
          <Icon name="shield" size={18} />
          <span>
            Policy checks before
            <br />
            every purchase.
          </span>
        </div>
        <div className="buyer-profile">
          <BuyerAvatar />
          <div>
            <strong>Buyer workspace</strong>
            <span>Purchasing team</span>
          </div>
        </div>
      </div>
    </>
  );
  return (
    <div className="workspace-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="desktop-sidebar">{sidebarContent}</aside>
      <div className="workspace-body">
        <header className="workspace-topbar">
          <button
            ref={menuTrigger}
            type="button"
            className="icon-button mobile-menu-button"
            aria-label="Open navigation"
            aria-expanded={menuOpen}
            onClick={() => {
              menu.current?.showModal();
              setMenuOpen(true);
            }}
          >
            <Icon name="menu" />
          </button>
          <div className="breadcrumb">
            <span>{active.group}</span>
            <Icon name="chevron" size={14} />
            <strong>{active.label}</strong>
          </div>
          <div className="topbar-actions">
            <button
              ref={searchTrigger}
              type="button"
              className="search-trigger"
              aria-label="Search workspace"
              onClick={openSearch}
            >
              <Icon name="search" size={16} />
              <span>Search workspace</span>
              <kbd>⌘ K</kbd>
            </button>
            <Link
              href="/approvals"
              className="icon-button"
              aria-label="Review approvals"
            >
              <Icon name="bell" size={19} />
            </Link>
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="workspace-main">
          {children}
        </main>
        <footer className="workspace-page-footer">
          <span>Purchasing workspace</span>
          <span>Simulation · {simulatedDate}</span>
        </footer>
      </div>
      <dialog
        ref={menu}
        aria-label="Workspace navigation"
        className="mobile-nav-dialog"
        onClose={() => {
          setMenuOpen(false);
          menuTrigger.current?.focus();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) menu.current?.close();
        }}
      >
        <div className="mobile-sidebar">
          <button
            className="icon-button mobile-nav-close"
            aria-label="Close navigation"
            onClick={() => menu.current?.close()}
          >
            <Icon name="close" />
          </button>
          {sidebarContent}
        </div>
      </dialog>
      <dialog
        ref={search}
        className="search-dialog"
        aria-labelledby="search-title"
        onClose={() => searchTrigger.current?.focus()}
        onClick={(event) => {
          if (event.target === event.currentTarget) search.current?.close();
        }}
      >
        <div className="search-dialog-heading">
          <h2 id="search-title">Search workspace</h2>
          <button
            className="icon-button"
            aria-label="Close search"
            onClick={() => search.current?.close()}
          >
            <Icon name="close" />
          </button>
        </div>
        <label className="command-input">
          <Icon name="search" />
          <input
            autoFocus
            aria-label="Search workspace pages"
            placeholder="Find a page…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd>esc</kbd>
        </label>
        <nav aria-label="Search results" className="command-results">
          {results.map((item) => (
            <Link
              href={item.href}
              key={item.href}
              onClick={() => search.current?.close()}
            >
              <span className="command-icon">
                <Icon name={item.icon} />
              </span>
              <span>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
              <Icon name="arrow" size={16} />
            </Link>
          ))}
          {results.length === 0 && (
            <p role="status" className="command-empty">
              No pages found. Try “inventory” or “orders”.
            </p>
          )}
        </nav>
      </dialog>
    </div>
  );
}
