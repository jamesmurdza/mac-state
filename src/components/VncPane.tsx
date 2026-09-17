"use client";

import { useEffect, useRef, useState } from "react";

export type VncState = "connecting" | "connected" | "error";

/**
 * The left-hand live view: the gateway's embedded noVNC iframe, a connecting spinner, a
 * disconnected overlay, and the status chip that doubles as the "open system info" button.
 * Ported from public/index.html's #vnc/#vnc-loading/#vnc-disconnected/#chip/#vnc-tab markup.
 */
export function VncPane({
  vncUrl,
  state,
  onOpenSysInfo,
}: {
  vncUrl: string | null;
  state: VncState;
  onOpenSysInfo: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [spinnerHidden, setSpinnerHidden] = useState(false);

  useEffect(() => {
    if (!vncUrl) return;
    setSpinnerHidden(false);
    const iframe = iframeRef.current;
    if (!iframe) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The iframe's own "load" fires once noVNC's HTML shell is parsed, not once it has connected
    // and is painting frames -- the page is cross-origin, so there's no signal for that, and no
    // way to reach into its DOM to hide its own connecting-state UI. This delay is a heuristic
    // buffer to bridge past both before we reveal the iframe.
    const onLoad = () => {
      timer = setTimeout(() => setSpinnerHidden(true), 2000);
    };
    iframe.addEventListener("load", onLoad, { once: true });
    return () => {
      iframe.removeEventListener("load", onLoad);
      if (timer) clearTimeout(timer);
    };
  }, [vncUrl]);

  const dotClass = state === "connecting" ? "dot busy" : state === "connected" ? "dot on" : "dot err";
  const chipText = state === "connecting" ? "connecting…" : state === "connected" ? "macOS sandbox" : "Disconnected";
  const showSpinner = !!vncUrl && !spinnerHidden;

  return (
    <section className="stage">
      <iframe id="vnc" ref={iframeRef} title="Sandbox screen (live VNC)" allow="clipboard-read; clipboard-write" src={vncUrl ?? undefined} />
      <div id="vnc-loading" className={`vnc-loading${showSpinner ? "" : " hidden"}`}>
        <div className="spinner" />
      </div>
      <div id="vnc-disconnected" className={`vnc-disconnected${state === "error" ? "" : " hidden"}`}>
        Disconnected
      </div>
      <div
        id="chip"
        className="chip"
        role="button"
        tabIndex={0}
        title="Show system information"
        aria-label="Show system information"
        onClick={onOpenSysInfo}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          onOpenSysInfo();
        }}
      >
        <span id="dot" className={dotClass} />
        <span id="chip-text">{chipText}</span>
      </div>
      <a id="vnc-tab" className="vnc-tab" href={vncUrl ?? "#"} target="_blank" rel="noopener" hidden={!vncUrl} title="Open in a new tab" aria-label="Open in a new tab">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <path d="M15 3h6v6" />
          <path d="M10 14 21 3" />
        </svg>
      </a>
    </section>
  );
}
