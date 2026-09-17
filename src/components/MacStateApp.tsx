"use client";

import type { ModelMessage } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SandboxDescriptor } from "../lib/sandbox-handle";
import { ChatPanel } from "./ChatPanel";
import { Divider } from "./Divider";
import { SysInfoModal } from "./SysInfoModal";
import { VncPane, type VncState } from "./VncPane";

/**
 * Owns the two pieces of state that used to live on the server for the life of the process
 * (SandboxSession, the running conversation history) and now live only in this component: the
 * current sandbox descriptor and the full message history. Both are sent with every /api/run or
 * /api/stream call and wholesale-replaced from the server's response -- the server holds none of
 * it between requests, so a page refresh starts a fresh sandbox and a fresh conversation.
 */
export function MacStateApp() {
  const appRef = useRef<HTMLDivElement>(null);
  const [sandbox, setSandbox] = useState<SandboxDescriptor | null>(null);
  const [vncState, setVncState] = useState<VncState>("connecting");
  const [connectError, setConnectError] = useState<string | null>(null);
  const [history, setHistory] = useState<ModelMessage[]>([]);
  const [sysinfoOpen, setSysinfoOpen] = useState(false);
  // Guards against React 19's dev-mode Strict Mode double-invoking this effect (mount -> cleanup
  // -> mount again, to surface non-idempotent effects). Creating a sandbox is a real, expensive,
  // non-idempotent side effect (unlike e.g. a GET that's safe to fire twice), so unlike the
  // `cancelled` flag below -- which only discards a *stale response* -- this ref stops the second
  // invocation from ever making the request at all. It intentionally survives the simulated
  // unmount/remount (a plain module-level `let` would not), and is never reset, since this
  // component mounts exactly once for the life of the page.
  const statusRequested = useRef(false);

  // The sandbox is created on this first request; then the gateway's noVNC viewer is embedded.
  useEffect(() => {
    if (statusRequested.current) return;
    statusRequested.current = true;
    let cancelled = false;
    (async () => {
      setVncState("connecting");
      try {
        const res = await fetch("/api/status");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        if (cancelled) return;
        setSandbox(data);
        setVncState("connected");
      } catch (err) {
        if (cancelled) return;
        setVncState("error");
        setConnectError(`Couldn't connect to a sandbox: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // A tool call or a /api/sysinfo lookup can discover mid-session that the sandbox timed out and
  // was transparently recreated; this is the single place that lands the new descriptor.
  const onSandboxUpdate = useCallback((descriptor: SandboxDescriptor) => {
    setSandbox(descriptor);
    setVncState("connected");
  }, []);

  return (
    <>
      <div className="app" id="app" ref={appRef}>
        <VncPane vncUrl={sandbox?.vncUrl ?? null} state={vncState} onOpenSysInfo={() => setSysinfoOpen(true)} />
        <Divider appRef={appRef} />
        <ChatPanel
          sandbox={sandbox}
          history={history}
          onHistoryUpdate={setHistory}
          onSandboxUpdate={onSandboxUpdate}
          connectError={connectError}
        />
      </div>
      <SysInfoModal open={sysinfoOpen} onClose={() => setSysinfoOpen(false)} sandbox={sandbox} onSandboxUpdate={onSandboxUpdate} />
    </>
  );
}
