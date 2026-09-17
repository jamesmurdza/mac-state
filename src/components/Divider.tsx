"use client";

import { useEffect, useRef } from "react";

const MIN = 160; // px kept clear on each side

/**
 * Draggable split between the VNC pane and the chat panel. Pointer capture keeps move/up events
 * targeted at the divider even while the pointer is over the cross-origin VNC iframe, so no
 * full-page overlay is needed. Ported near-verbatim from public/index.html's setupDivider().
 */
export function Divider({ appRef }: { appRef: React.RefObject<HTMLDivElement | null> }) {
  const dividerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const app = appRef.current;
    const divider = dividerRef.current;
    if (!app || !divider) return;

    const stackedQuery = window.matchMedia("(max-width: 860px)");
    const isStacked = () => stackedQuery.matches;

    try {
      const col = localStorage.getItem("macos-computer-use-split-col");
      const row = localStorage.getItem("macos-computer-use-split-row");
      if (col) app.style.setProperty("--split-col", col);
      if (row) app.style.setProperty("--split-row", row);
    } catch {
      // localStorage unavailable (private mode etc.) -- fall back to the CSS default split
    }

    let dragging = false;

    function onMove(e: PointerEvent) {
      if (!dragging || !app) return;
      const rect = app.getBoundingClientRect();
      if (isStacked()) {
        const h = Math.min(Math.max(e.clientY - rect.top, MIN), rect.height - MIN - 6);
        app.style.setProperty("--split-row", `${h}px`);
      } else {
        const w = Math.min(Math.max(e.clientX - rect.left, MIN), rect.width - MIN - 6);
        app.style.setProperty("--split-col", `${w}px`);
      }
    }

    function onUp(e: PointerEvent) {
      if (!dragging || !app || !divider) return;
      dragging = false;
      divider.classList.remove("dragging");
      divider.releasePointerCapture(e.pointerId);
      try {
        if (isStacked()) localStorage.setItem("macos-computer-use-split-row", app.style.getPropertyValue("--split-row"));
        else localStorage.setItem("macos-computer-use-split-col", app.style.getPropertyValue("--split-col"));
      } catch {
        // ignore
      }
    }

    function onDown(e: PointerEvent) {
      if (!divider) return;
      dragging = true;
      divider.classList.add("dragging");
      divider.setPointerCapture(e.pointerId);
    }

    function onDblClick() {
      if (!app) return;
      app.style.removeProperty("--split-col");
      app.style.removeProperty("--split-row");
      try {
        localStorage.removeItem("macos-computer-use-split-col");
        localStorage.removeItem("macos-computer-use-split-row");
      } catch {
        // ignore
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (!app) return;
      const step = 24;
      const stacked = isStacked();
      const grow = stacked ? e.key === "ArrowDown" : e.key === "ArrowRight";
      const shrink = stacked ? e.key === "ArrowUp" : e.key === "ArrowLeft";
      if (!grow && !shrink) return;
      e.preventDefault();
      const rect = app.getBoundingClientRect();
      const prop = stacked ? "--split-row" : "--split-col";
      const size = stacked ? rect.height : rect.width;
      const current = Number.parseFloat(getComputedStyle(app).getPropertyValue(prop)) || size * (stacked ? 0.42 : 0.58);
      const next = Math.min(Math.max(current + (grow ? step : -step), MIN), size - MIN - 6);
      app.style.setProperty(prop, `${next}px`);
      try {
        localStorage.setItem(stacked ? "macos-computer-use-split-row" : "macos-computer-use-split-col", `${next}px`);
      } catch {
        // ignore
      }
    }

    divider.addEventListener("pointerdown", onDown);
    divider.addEventListener("pointermove", onMove);
    divider.addEventListener("pointerup", onUp);
    divider.addEventListener("pointercancel", onUp);
    divider.addEventListener("dblclick", onDblClick);
    divider.addEventListener("keydown", onKeyDown);
    return () => {
      divider.removeEventListener("pointerdown", onDown);
      divider.removeEventListener("pointermove", onMove);
      divider.removeEventListener("pointerup", onUp);
      divider.removeEventListener("pointercancel", onUp);
      divider.removeEventListener("dblclick", onDblClick);
      divider.removeEventListener("keydown", onKeyDown);
    };
  }, [appRef]);

  return <div id="divider" ref={dividerRef} className="divider" role="separator" aria-orientation="vertical" aria-label="Resize panels" tabIndex={0} />;
}
