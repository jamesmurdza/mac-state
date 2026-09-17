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
  // The static page's spinner was visible by default and only explicitly hidden once the iframe
  // had loaded and settled -- i.e. shown for the whole "don't have anything to look at yet"
  // window, including before vncUrl even exists. Gating on `!!vncUrl` (an earlier version of this
  // component did) inverts that: vncUrl is null for the entire "connecting" state, so the spinner
  // was suppressed exactly when it was most needed, leaving a bare black .stage background with
  // only the chip's "connecting…" text. Gate on `state` instead: show for anything short of an
  // outright connection failure (which gets the disconnected overlay instead), until spinnerHidden.
  const showSpinner = state !== "error" && !spinnerHidden;

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
      {/* Conditionally rendered rather than `hidden={!vncUrl}`: the native `hidden` attribute
          loses to this element's own `display: grid` in globals.css -- author-stylesheet rules
          beat the UA stylesheet's `[hidden]{display:none}` at equal (or lower) specificity
          regardless of source order, so the attribute alone doesn't actually hide it. The
          pre-port static page had the identical `hidden` + `display: grid` combination and (as
          far as I can tell from the markup) the identical bug; it just never fired for long
          enough to notice there. */}
      {vncUrl && (
        <a id="vnc-tab" className="vnc-tab" href={vncUrl} target="_blank" rel="noopener" title="Open in a new tab" aria-label="Open in a new tab">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <path d="M15 3h6v6" />
            <path d="M10 14 21 3" />
          </svg>
        </a>
      )}
    </section>
  );
}
