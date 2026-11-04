"use client";

import { useEffect, useRef } from "react";
import "./desktop-motion.css";

const REVEAL_SELECTOR =
  ".panel, .stat-card, .studio-signal, .studio-briefing, .scenario-brief, .ops-approval-card";
const NATIVE_CURSOR_SELECTOR =
  "input, textarea, select, option, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='combobox'], [data-native-cursor], iframe, video, audio, dialog[open]";
const ACTION_SELECTOR =
  "a[href], button:not(:disabled), [role='button']:not([aria-disabled='true']), summary, [data-cursor-action]";

/** One decorative motion layer for the desktop workspace; all content stays usable without it. */
export function DesktopMotion() {
  const layer = useRef<HTMLDivElement>(null);
  const point = useRef<HTMLDivElement>(null);
  const trail = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = layer.current;
    const dot = point.current;
    const ring = trail.current;
    if (!node || !dot || !ring) return;

    const root = document.documentElement;
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const previousMotion = root.getAttribute("data-desktop-motion");
    const previousCursor = root.getAttribute("data-desktop-cursor");
    const observed = new Set<HTMLElement>();
    const revealed = new WeakSet<HTMLElement>();
    const animations = new Set<Animation>();
    let observer: IntersectionObserver | null = null;
    let enabled = false;
    let visible = false;
    let frame = 0;
    let x = 0;
    let y = 0;
    let ringX = 0;
    let ringY = 0;

    const hideCursor = () => {
      visible = false;
      node.dataset.visible = "false";
      node.dataset.pressed = "false";
      root.removeAttribute("data-desktop-cursor");
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const renderPointer = () => {
      frame = 0;
      if (!enabled || !visible || document.hidden) return;
      ringX += (x - ringX) * 0.24;
      ringY += (y - ringY) * 0.24;
      const settled = Math.abs(x - ringX) + Math.abs(y - ringY) < 0.12;
      if (settled) {
        ringX = x;
        ringY = y;
      }
      dot.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      ring.style.transform = `translate3d(${ringX}px, ${ringY}px, 0)`;
      if (!settled) frame = requestAnimationFrame(renderPointer);
    };
    const movePointer = (event: PointerEvent) => {
      if (!enabled || event.pointerType !== "mouse" || document.hidden) {
        hideCursor();
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      // Native dialogs occupy the browser's top layer. Keep a native cursor
      // there rather than concealing it behind a modal or an editable control.
      if (
        !target ||
        target.closest(NATIVE_CURSOR_SELECTOR) ||
        event.clientX >= root.clientWidth ||
        event.clientY >= root.clientHeight
      ) {
        hideCursor();
        return;
      }
      x = event.clientX;
      y = event.clientY;
      if (!visible) {
        ringX = x;
        ringY = y;
        dot.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        ring.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      }
      visible = true;
      node.dataset.visible = "true";
      const actionable = target.closest(ACTION_SELECTOR);
      node.dataset.actionable = String(
        Boolean(
          actionable && actionable.getAttribute("aria-disabled") !== "true",
        ) ||
          (!actionable &&
            target instanceof HTMLElement &&
            target.style.cursor === "pointer"),
      );
      root.setAttribute("data-desktop-cursor", "active");
      if (!frame) frame = requestAnimationFrame(renderPointer);
    };
    const pressPointer = (event: PointerEvent) => {
      if (enabled && visible && event.pointerType === "mouse")
        node.dataset.pressed = "true";
    };
    const releasePointer = () => {
      node.dataset.pressed = "false";
    };
    const leavePointer = (event: PointerEvent) => {
      if (!event.relatedTarget) hideCursor();
    };
    const onFocus = (event: FocusEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(NATIVE_CURSOR_SELECTOR)
      )
        hideCursor();
    };

    const reveal = (element: HTMLElement) => {
      if (revealed.has(element)) return;
      revealed.add(element);
      element.dataset.motionReveal = "visible";
      observer?.unobserve(element);
      if (!enabled || document.hidden || typeof element.animate !== "function")
        return;
      const style = window.getComputedStyle(element);
      const opacity = Number.parseFloat(style.opacity);
      const finalOpacity = Number.isFinite(opacity) ? opacity : 1;
      const finalTranslate =
        style.translate === "none" ? "0px 0px" : style.translate;
      const animation = element.animate(
        [
          { opacity: finalOpacity * 0.5, translate: "0px 10px" },
          { opacity: finalOpacity, translate: finalTranslate },
        ],
        {
          duration: 420,
          easing: "cubic-bezier(0.22, 0.68, 0, 1)",
          fill: "none",
        },
      );
      animations.add(animation);
      const finished = () => {
        animations.delete(animation);
      };
      animation.addEventListener("finish", finished, { once: true });
      animation.addEventListener("cancel", finished, { once: true });
    };
    const observeElement = (element: Element) => {
      if (
        !(element instanceof HTMLElement) ||
        revealed.has(element) ||
        observed.has(element)
      )
        return;
      // Animate a panel once, without multiplying the motion of nested panels.
      if (element.parentElement?.closest(REVEAL_SELECTOR)) return;
      observed.add(element);
      element.dataset.motionReveal = "observed";
      observer?.observe(element);
    };
    const scan = (element: Element) => {
      if (!enabled) return;
      if (element.matches(REVEAL_SELECTOR)) observeElement(element);
      element.querySelectorAll(REVEAL_SELECTOR).forEach(observeElement);
    };
    const configure = () => {
      enabled = finePointer.matches && !reducedMotion.matches;
      hideCursor();
      observer?.disconnect();
      observer = null;
      for (const animation of animations) animation.cancel();
      animations.clear();
      for (const element of observed)
        element.removeAttribute("data-motion-reveal");
      observed.clear();
      if (!enabled) {
        root.removeAttribute("data-desktop-motion");
        return;
      }
      root.setAttribute("data-desktop-motion", "enabled");
      if ("IntersectionObserver" in window) {
        observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries)
              if (entry.isIntersecting) reveal(entry.target as HTMLElement);
          },
          { threshold: 0.08, rootMargin: "0px 0px -20px 0px" },
        );
        scan(document.body);
      }
    };
    const mutations = new MutationObserver((records) => {
      if (!enabled) return;
      for (const record of records)
        for (const added of record.addedNodes)
          if (added instanceof Element) scan(added);
      for (const element of observed) {
        if (!element.isConnected) {
          observer?.unobserve(element);
          element.removeAttribute("data-motion-reveal");
          observed.delete(element);
        }
      }
    });
    const onVisibility = () => {
      if (document.hidden) {
        hideCursor();
        for (const animation of animations) animation.pause();
      } else if (enabled) {
        for (const animation of animations) animation.play();
      }
    };

    configure();
    mutations.observe(document.body, { childList: true, subtree: true });
    finePointer.addEventListener("change", configure);
    reducedMotion.addEventListener("change", configure);
    document.addEventListener("pointermove", movePointer, { passive: true });
    document.addEventListener("pointerdown", pressPointer, { passive: true });
    document.addEventListener("pointerup", releasePointer, { passive: true });
    document.addEventListener("pointercancel", hideCursor, { passive: true });
    document.addEventListener("pointerout", leavePointer, { passive: true });
    document.addEventListener("focusin", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", hideCursor);

    return () => {
      hideCursor();
      observer?.disconnect();
      mutations.disconnect();
      for (const animation of animations) animation.cancel();
      for (const element of observed)
        element.removeAttribute("data-motion-reveal");
      finePointer.removeEventListener("change", configure);
      reducedMotion.removeEventListener("change", configure);
      document.removeEventListener("pointermove", movePointer);
      document.removeEventListener("pointerdown", pressPointer);
      document.removeEventListener("pointerup", releasePointer);
      document.removeEventListener("pointercancel", hideCursor);
      document.removeEventListener("pointerout", leavePointer);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", hideCursor);
      if (previousMotion === null) root.removeAttribute("data-desktop-motion");
      else root.setAttribute("data-desktop-motion", previousMotion);
      if (previousCursor === null) root.removeAttribute("data-desktop-cursor");
      else root.setAttribute("data-desktop-cursor", previousCursor);
    };
  }, []);

  return (
    <div
      ref={layer}
      className="desktop-motion"
      aria-hidden="true"
      data-visible="false"
    >
      <div ref={trail} className="desktop-motion-ring">
        <span />
      </div>
      <div ref={point} className="desktop-motion-point">
        <span />
      </div>
    </div>
  );
}
