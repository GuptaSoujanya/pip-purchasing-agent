"use client";
import Link from "next/link";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type KeyboardEvent,
} from "react";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icons";

type Item = {
  href: string;
  label: string;
  description: string;
  icon: IconName;
};
export function WorkspaceMenu({
  items,
  activeHref,
  onNavigate,
}: {
  items: Item[];
  activeHref?: string;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const pathname = usePathname();
  const focusItem = (index: number) => {
    const links =
      host.current?.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]');
    if (links?.length) links[(index + links.length) % links.length]?.focus();
  };
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!host.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const navigateKeys = (event: KeyboardEvent<HTMLElement>) => {
    const links = Array.from(
      host.current?.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]') ??
        [],
    );
    const index = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusItem(index + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusItem(event.key === "Home" ? 0 : links.length - 1);
    }
  };
  return (
    <div
      className="workspace-menu"
      ref={host}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="workspace-menu-trigger"
        data-current={
          items.some((item) => item.href === activeHref) || undefined
        }
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setOpen((value) => !value);
          if (!open) requestAnimationFrame(() => focusItem(0));
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            requestAnimationFrame(() =>
              focusItem(event.key === "ArrowDown" ? 0 : items.length - 1),
            );
          }
        }}
      >
        More
        <Icon name="chevron" size={13} />
      </button>
      {open && (
        <div
          id={id}
          className="workspace-menu-popup"
          role="menu"
          aria-label="More purchasing pages"
          onKeyDown={navigateKeys}
        >
          <div className="workspace-menu-label" role="presentation">
            YOUR BUYING WORKSPACE
          </div>
          {items.map((item) => (
            <Link
              role="menuitem"
              key={item.href}
              href={item.href}
              aria-current={activeHref === item.href ? "page" : undefined}
              onClick={(event) => {
                onNavigate(event, item.href);
                setOpen(false);
              }}
            >
              <span className="workspace-menu-icon">
                <Icon name={item.icon} size={18} />
              </span>
              <span>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
              <Icon name="arrow-up-right" size={14} />
            </Link>
          ))}
          <div className="workspace-menu-footer" role="presentation">
            <Icon name="shield" size={13} />
            Every purchase has a trace.
          </div>
        </div>
      )}
    </div>
  );
}
