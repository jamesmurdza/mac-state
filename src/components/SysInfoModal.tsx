"use client";

import { useEffect, useRef, useState } from "react";
import { escapeHtml } from "../lib/markdown";
import type { SandboxDescriptor } from "../lib/sandbox-handle";

interface SystemInfo {
  product: string;
  version: string;
  build: string;
  hostname: string;
  arch: string;
  model: string;
  cpus: string;
  memBytes: string;
  uptime: string;
}

function bytesToGB(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? `${(n / 1e9).toFixed(1)} GB` : value;
}

function renderSysinfo(info: SystemInfo): string {
  const rows: [string, string][] = [
    ["macOS", `${info.product} ${info.version} (${info.build})`],
    ["Model", info.model],
    ["Chip", info.arch],
    ["CPUs", info.cpus],
    ["Memory", bytesToGB(info.memBytes)],
    ["Hostname", info.hostname],
    ["Uptime", info.uptime],
  ];
  return `<dl>${rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v ?? ""))}</dd>`).join("")}</dl>`;
}

/**
 * Full-page modal with live system info, read from the sandbox over SSH on first open and
 * cached for the life of the page. Ported from openSysinfo()/renderSysinfo() in the original
 * public/index.html.
 */
export function SysInfoModal({
  open,
  onClose,
  sandbox,
  onSandboxUpdate,
}: {
  open: boolean;
  onClose: () => void;
  sandbox: SandboxDescriptor | null;
  onSandboxUpdate: (descriptor: SandboxDescriptor) => void;
}) {
  const [cache, setCache] = useState<SystemInfo | null>(null);
  const [bodyHtml, setBodyHtml] = useState("");
  // Read via refs inside the effect below so a parent re-render (new sandbox/onSandboxUpdate
  // identity) doesn't retrigger the fetch -- only `open` transitioning to true should.
  const latest = useRef({ sandbox, onSandboxUpdate });
  latest.current = { sandbox, onSandboxUpdate };

  useEffect(() => {
    if (!open) return;
    if (cache) {
      setBodyHtml(renderSysinfo(cache));
      return;
    }
    setBodyHtml(`<div class="note">Reading system info…</div>`);
    const { sandbox: sb, onSandboxUpdate: notify } = latest.current;
    const params = sb
      ? `?sandboxId=${encodeURIComponent(sb.sandboxId)}&host=${encodeURIComponent(sb.host)}&vncUrl=${encodeURIComponent(sb.vncUrl)}`
      : "";
    (async () => {
      try {
        const res = await fetch(`/api/sysinfo${params}`);
        const text = await res.text();
        let data: (SystemInfo & { sandbox?: SandboxDescriptor; error?: string }) | undefined;
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error(`Unexpected response from the server (HTTP ${res.status})`);
        }
        if (!res.ok || !data) throw new Error(data?.error || `HTTP ${res.status}`);
        if (data.sandbox) notify(data.sandbox);
        setCache(data);
        setBodyHtml(renderSysinfo(data));
      } catch (err) {
        setBodyHtml(`<div class="note">${escapeHtml(err instanceof Error ? err.message : String(err))}</div>`);
      }
    })();
  }, [open, cache]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div
      id="sysinfo-overlay"
      className={`modal-overlay${open ? "" : " hidden"}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="System information">
        <button className="modal-close" id="sysinfo-close" type="button" aria-label="Close" onClick={onClose}>
          &times;
        </button>
        <h2>System information</h2>
        <div id="sysinfo-body" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
      </div>
    </div>
  );
}
