"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { IconCheck, IconChevronDown } from "@tabler/icons-react";
import "./purchasing-select.css";

export type PurchasingSelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

type PurchasingSelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: PurchasingSelectOption[];
  label: string;
  id?: string;
  disabled?: boolean;
  className?: string;
};

type PopupPosition = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  side: "above" | "below";
};

/** Select-only combobox: focus stays on its trigger while the active option is announced. */
export function PurchasingSelect({
  value,
  onChange,
  options,
  label,
  id,
  disabled = false,
  className = "",
}: PurchasingSelectProps) {
  const generatedId = useId();
  const triggerId = id ?? `purchasing-select-${generatedId}`;
  const listId = `${triggerId}-options`;
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const optionElements = useRef<Array<HTMLDivElement | null>>([]);
  const typeahead = useRef("");
  const typeaheadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState<PopupPosition | null>(null);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex];
  const enabledIndexes = options.flatMap((option, index) =>
    option.disabled ? [] : [index],
  );
  const unavailable = disabled || enabledIndexes.length === 0;

  const clearTypeahead = useCallback(() => {
    typeahead.current = "";
    if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current);
    typeaheadTimer.current = null;
  }, []);

  const close = useCallback(
    (restoreFocus = false) => {
      setOpen(false);
      setPosition(null);
      clearTypeahead();
      if (restoreFocus) trigger.current?.focus({ preventScroll: true });
    },
    [clearTypeahead],
  );

  const openAt = (index?: number) => {
    if (unavailable) return;
    clearTypeahead();
    const preferred =
      index ??
      (selectedIndex >= 0 && !options[selectedIndex].disabled
        ? selectedIndex
        : enabledIndexes[0]);
    setActiveIndex(preferred ?? -1);
    setOpen(true);
  };

  const choose = (index: number) => {
    const option = options[index];
    if (unavailable || !option || option.disabled) return;
    close(true);
    if (option.value !== value) onChange(option.value);
  };

  const updatePosition = useCallback(() => {
    const button = trigger.current;
    const menu = popup.current;
    if (!button || !menu) return;
    const rect = button.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    if (
      rect.bottom <= viewportTop ||
      rect.top >= viewportTop + viewportHeight ||
      rect.right <= viewportLeft ||
      rect.left >= viewportLeft + viewportWidth
    ) {
      close();
      return;
    }
    const margin = 12;
    const gap = 7;
    const below = viewportTop + viewportHeight - rect.bottom - margin - gap;
    const above = rect.top - viewportTop - margin - gap;
    const desiredHeight = Math.min(menu.scrollHeight, 320);
    const side = below < desiredHeight && above > below ? "above" : "below";
    const maxHeight = Math.max(
      44,
      Math.min(320, side === "above" ? above : below),
    );
    const width = Math.min(
      Math.max(rect.width, 240),
      viewportWidth - margin * 2,
    );
    const left = Math.max(
      viewportLeft + margin,
      Math.min(rect.left, viewportLeft + viewportWidth - width - margin),
    );
    const proposedTop =
      side === "above"
        ? Math.max(
            viewportTop + margin,
            rect.top - gap - Math.min(menu.scrollHeight, maxHeight),
          )
        : rect.bottom + gap;
    const top = Math.max(
      viewportTop + margin,
      Math.min(
        proposedTop,
        viewportTop +
          viewportHeight -
          margin -
          Math.min(menu.scrollHeight, maxHeight),
      ),
    );
    setPosition((previous) =>
      previous?.top === top &&
      previous.left === left &&
      previous.width === width &&
      previous.maxHeight === maxHeight &&
      previous.side === side
        ? previous
        : { top, left, width, maxHeight, side },
    );
  }, [close]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    let frame = 0;
    const reposition = (event?: Event) => {
      if (
        event?.target instanceof Node &&
        popup.current?.contains(event.target)
      )
        return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updatePosition);
    };
    const observer = new ResizeObserver(() => reposition());
    if (trigger.current) observer.observe(trigger.current);
    if (popup.current) observer.observe(popup.current);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    window.visualViewport?.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("scroll", reposition);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      window.visualViewport?.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("scroll", reposition);
    };
  }, [open, updatePosition]);

  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, options, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: Event) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !trigger.current?.contains(target) &&
        !popup.current?.contains(target)
      )
        close();
    };
    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("focusin", dismissOutside);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("focusin", dismissOutside);
    };
  }, [open, close]);

  useEffect(() => {
    if (unavailable && open) close();
    else if (
      open &&
      (activeIndex < 0 ||
        !options[activeIndex] ||
        options[activeIndex].disabled)
    )
      setActiveIndex(enabledIndexes[0] ?? -1);
  }, [unavailable, open, activeIndex, options, enabledIndexes, close]);

  useLayoutEffect(() => {
    if (!open || activeIndex < 0) return;
    const menu = popup.current;
    const option = optionElements.current[activeIndex];
    if (!menu || !option) return;
    const top = option.offsetTop;
    const bottom = top + option.offsetHeight;
    if (top < menu.scrollTop) menu.scrollTop = top;
    else if (bottom > menu.scrollTop + menu.clientHeight)
      menu.scrollTop = bottom - menu.clientHeight;
  }, [open, activeIndex, position?.maxHeight]);

  useEffect(() => () => clearTypeahead(), [clearTypeahead]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (unavailable || event.nativeEvent.isComposing) return;
    const key = event.key;
    if (key === "Tab") {
      if (open) close();
      return;
    }
    if (key === "Escape") {
      if (open) {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      }
      return;
    }
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      clearTypeahead();
      if (!open)
        openAt(
          key === "ArrowUp" && selectedIndex < 0
            ? enabledIndexes.at(-1)
            : undefined,
        );
      else {
        const current = enabledIndexes.indexOf(activeIndex);
        const next =
          (current + (key === "ArrowDown" ? 1 : -1) + enabledIndexes.length) %
          enabledIndexes.length;
        setActiveIndex(enabledIndexes[next]);
      }
      return;
    }
    if (key === "Home" || key === "End") {
      event.preventDefault();
      const index = key === "Home" ? enabledIndexes[0] : enabledIndexes.at(-1);
      if (!open) openAt(index);
      else {
        clearTypeahead();
        setActiveIndex(index ?? -1);
      }
      return;
    }
    if (key === "Enter" || (key === " " && !typeahead.current)) {
      event.preventDefault();
      if (open) choose(activeIndex);
      else openAt();
      return;
    }
    if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const buffer = `${typeahead.current}${key}`.toLocaleLowerCase();
      const repeated = Array.from(buffer).every(
        (character) => character === buffer[0],
      );
      const search = repeated ? buffer[0] : buffer;
      if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current);
      typeahead.current = buffer;
      typeaheadTimer.current = setTimeout(clearTypeahead, 700);
      const start = open ? activeIndex : selectedIndex;
      const ordered = [
        ...enabledIndexes.filter((index) => index > start),
        ...enabledIndexes.filter((index) => index <= start),
      ];
      const match =
        !repeated &&
        open &&
        options[activeIndex]?.label.toLocaleLowerCase().startsWith(search)
          ? activeIndex
          : ordered.find((index) =>
              options[index].label.toLocaleLowerCase().startsWith(search),
            );
      if (match !== undefined) {
        setActiveIndex(match);
        setOpen(true);
      }
    }
  };

  return (
    <div className={`purchasing-select ${className}`}>
      <button
        ref={trigger}
        id={triggerId}
        type="button"
        role="combobox"
        className="pselect-trigger"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={
          open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined
        }
        disabled={unavailable}
        onKeyDown={onKeyDown}
        onClick={() => (open ? close() : openAt())}
      >
        <span className="pselect-value">
          {selected?.label ??
            (options.length ? "Choose an option" : "No options available")}
        </span>
        <IconChevronDown
          size={16}
          stroke={1.75}
          className="pselect-chevron"
          aria-hidden="true"
        />
      </button>
      {open &&
        createPortal(
          <div
            ref={popup}
            id={listId}
            role="listbox"
            aria-label={label}
            className="pselect-popup"
            data-side={position?.side ?? "below"}
            style={{
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              width: position?.width ?? 240,
              maxHeight: position?.maxHeight ?? 320,
              visibility: position ? "visible" : "hidden",
            }}
          >
            {options.map((option, index) => (
              <div
                key={option.value}
                ref={(element) => {
                  optionElements.current[index] = element;
                }}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                className={`pselect-option${activeIndex === index ? " is-active" : ""}`}
                onPointerMove={() => {
                  if (!option.disabled) setActiveIndex(index);
                }}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(index)}
              >
                <span className="pselect-option-copy">
                  <span>{option.label}</span>
                  {option.description && <small>{option.description}</small>}
                </span>
                {option.value === value && (
                  <IconCheck size={16} stroke={2} aria-hidden="true" />
                )}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
