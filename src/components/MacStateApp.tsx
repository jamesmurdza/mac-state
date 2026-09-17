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
  // non-idempotent side effect (unlike e.g. a GET that's safe to fire twice), so this ref stops a
  // second invocation from ever making the request at all -- it intentionally survives the
  // simulated unmount/remount (a plain module-level `let` would not), and is never reset, since
  // this component mounts exactly once for the life of the page.
  //
  // Deliberately NOT paired with a `cancelled`-on-cleanup flag (an earlier version of this effect
  // had one): that pattern assumes a *second* invocation will start a fresh, uncancelled fetch to
  // pick up the work once the first's cleanup fires -- true for an ordinary un-guarded effect, but
  // false here. With the guard above, StrictMode's simulated cleanup still runs (nothing stops
  // it), but no second invocation ever follows it to restart the work. A `cancelled` flag set by
  // that cleanup would silently orphan the one real fetch's result forever, leaving `vncState`
  // stuck on "connecting" -- which is exactly the regression this comment is here to prevent
  // re-introducing. Since the ref already guarantees the fetch fires at most once for the whole
  // page's lifetime, its result should always be applied when it resolves.
  const statusRequested = useRef(false);

  // The sandbox is created on this first request; then the gateway's noVNC viewer is embedded.
  useEffect(() => {
    if (statusRequested.current) return;
    statusRequested.current = true;
    setVncState("connecting");
    (async () => {
      try {
        const res = await fetch("/api/status");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setSandbox(data);
        setVncState("connected");
      } catch (err) {
        setVncState("error");
        setConnectError(`Couldn't connect to a sandbox: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
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
          // Not just cosmetic: while the initial /api/status call is still in flight, `sandbox` is
          // null. If send() fired anyway it would post `sandbox: null`, and the route would create
          // a SECOND sandbox independently of the one /api/status is already creating -- racing
          // each other rather than one being derived from the other. Disabling the composer until
          // that first call settles (success or error) closes the window entirely, rather than
          // just cleaning up after it like the done.sandbox fix does for every turn after this one.
          ready={vncState !== "connecting"}
        />
      </div>
      <SysInfoModal open={sysinfoOpen} onClose={() => setSysinfoOpen(false)} sandbox={sandbox} onSandboxUpdate={onSandboxUpdate} />
    </>
  );
}
