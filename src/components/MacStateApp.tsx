"use client";

import type { ModelMessage } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import { ensureInitialSandbox } from "../lib/client-sandbox";
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

  // The sandbox is created on this first request (via the shared, page-lifetime-memoized
  // ensureInitialSandbox()); then the gateway's noVNC viewer is embedded. Safe under Strict Mode's
  // double-invoked dev effect with no guard ref or cancellation bookkeeping needed: both
  // invocations call ensureInitialSandbox(), which only ever starts one real fetch and hands back
  // the same promise to both, so this just attaches two independent .then()/.catch() pairs to it.
  useEffect(() => {
    let cancelled = false;
    setVncState("connecting");
    ensureInitialSandbox()
      .then((data) => {
        if (cancelled) return;
        setSandbox(data);
        setVncState("connected");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setVncState("error");
        setConnectError(`Couldn't connect to a sandbox: ${err instanceof Error ? err.message : String(err)}`);
      });
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
