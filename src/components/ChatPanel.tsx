"use client";

import type { ModelMessage } from "ai";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_MODEL_CHOICE, type ModelChoice } from "../lib/llm";
import { renderMarkdown } from "../lib/markdown";
import type { SandboxDescriptor } from "../lib/sandbox-handle";
import { streamEvents } from "../lib/stream-events";
import {
  appendAssistantText,
  appendToolCall,
  updateToolEntry,
  withoutThinking,
  type ToolCallEntry,
  type TranscriptItem,
} from "../lib/transcript";
import { ToolRun } from "./ToolRun";

const SEND_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 19V5" />
    <path d="m5 12 7-7 7 7" />
  </svg>
);
const STOP_ICON = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x={6} y={6} width={12} height={12} rx={2} />
  </svg>
);

function ThinkingLine() {
  return (
    <details className="msg msg-status">
      <summary>
        <span className="status-text">Working…</span>
        <span className="chev" />
      </summary>
      <div className="tool-body" />
    </details>
  );
}

/**
 * The transcript + composer. This is the stateless heart of the port: `sandbox`/`history` are
 * held by the parent (MacStateApp) and resent on every /api/stream call; the server holds none of
 * it between requests, so every response's `sandbox`/`done.history` wholesale-replaces what the
 * parent remembers rather than being merged client-side.
 */
export function ChatPanel({
  sandbox,
  history,
  onHistoryUpdate,
  onSandboxUpdate,
  connectError,
  ready,
}: {
  sandbox: SandboxDescriptor | null;
  history: ModelMessage[];
  onHistoryUpdate: (history: ModelMessage[]) => void;
  onSandboxUpdate: (descriptor: SandboxDescriptor) => void;
  /** Set once if the initial /api/status call failed; shown as a one-off centered notice. */
  connectError?: string | null;
  /** False until the initial /api/status call has settled (success or error). The composer is
   *  disabled until then so send() can never race that call with its own `sandbox: null` request
   *  -- see the comment on this prop's call site in MacStateApp.tsx. */
  ready: boolean;
}) {
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [model, setModel] = useState<ModelChoice>(DEFAULT_MODEL_CHOICE);
  const [running, setRunning] = useState(false);
  const [hasText, setHasText] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const idCounter = useRef(0);
  const nextId = (prefix: string) => `${prefix}-${idCounter.current++}`;
  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Latest sandbox/history without forcing send() to be redeclared every render.
  const latest = useRef({ sandbox, history });
  latest.current = { sandbox, history };

  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  useEffect(() => {
    if (!connectError) return;
    setItems((prev) => [...prev, { kind: "system", id: nextId("system-connect"), text: connectError, error: true }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per distinct error message
  }, [connectError]);

  async function send() {
    if (!ready) return; // belt-and-braces: the composer is disabled while !ready, so this shouldn't fire
    const ta = textareaRef.current;
    const text = ta?.value.trim() ?? "";
    if (!text) return;
    if (ta) {
      ta.value = "";
      ta.style.height = "auto";
    }
    setHasText(false);

    const userId = nextId("user");
    const thinkingId = nextId("thinking");
    setItems((prev) => [...prev, { kind: "user", id: userId, text }, { kind: "thinking", id: thinkingId }]);

    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);

    let runId: string | null = null;
    let assistantId: string | null = null;
    let gotContent = false;
    let thinkingCleared = false;
    const clearThinking = () => {
      if (thinkingCleared) return;
      thinkingCleared = true;
      setItems((prev) => withoutThinking(prev));
    };

    try {
      const { sandbox: sb, history: hist } = latest.current;
      await streamEvents(
        "/api/stream",
        { prompt: text, model, sandbox: sb, history: hist },
        (ev) => {
          switch (ev.t) {
            case "tool-call": {
              gotContent = true;
              clearThinking();
              assistantId = null; // a following reply starts a fresh bubble below this run
              const entry: ToolCallEntry = { id: ev.id, tool: ev.tool, input: ev.input, pending: true };
              const newRunId = nextId("run");
              setItems((prev) => {
                const result = appendToolCall(prev, runId, entry, newRunId);
                runId = result.runId;
                return result.items;
              });
              break;
            }
            case "tool-result":
              setItems((prev) => updateToolEntry(prev, ev.id, { output: ev.output }));
              break;
            case "tool-error":
              setItems((prev) => updateToolEntry(prev, ev.id, { error: ev.error }));
              break;
            case "text": {
              gotContent = true;
              clearThinking();
              runId = null; // narration ends the current run of tool calls
              const newId = nextId("assistant");
              setItems((prev) => {
                const result = appendAssistantText(prev, assistantId, ev.text, newId);
                assistantId = result.assistantId;
                return result.items;
              });
              break;
            }
            case "sandbox":
              onSandboxUpdate({ sandboxId: ev.sandboxId, host: ev.host, vncUrl: ev.vncUrl });
              break;
            case "error": {
              gotContent = true;
              clearThinking();
              runId = null;
              const errId = nextId("assistant-err");
              setItems((prev) => [...prev, { kind: "assistant", id: errId, text: ev.error, error: true }]);
              break;
            }
            case "done":
              onHistoryUpdate(ev.history);
              // Always current, not just on a mid-turn rotation -- this is what lets a turn that
              // never called a tool (e.g. a plain "hi") still tell the client which sandbox got
              // used, so the next turn reuses it instead of silently creating yet another one.
              onSandboxUpdate({ sandboxId: ev.sandbox.sandboxId, host: ev.sandbox.host, vncUrl: ev.sandbox.vncUrl });
              break;
          }
        },
        controller.signal,
      );
      clearThinking();
      if (!gotContent) {
        const doneId = nextId("assistant-done");
        setItems((prev) => [...prev, { kind: "assistant", id: doneId, text: "Done." }]);
      }
    } catch (err) {
      clearThinking();
      // A user-initiated stop aborts the fetch; that's not an error to report.
      if ((err as Error).name === "AbortError" || controller.signal.aborted) {
        const stoppedId = nextId("system-stopped");
        setItems((prev) => [...prev, { kind: "system", id: stoppedId, text: "Stopped." }]);
      } else {
        const errId = nextId("assistant-exc");
        setItems((prev) => [...prev, { kind: "assistant", id: errId, text: (err as Error).message, error: true }]);
      }
    } finally {
      abortRef.current = null;
      setRunning(false);
      textareaRef.current?.focus();
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  return (
    <section className="chat">
      <div id="messages" className="messages" ref={messagesRef}>
        {items.map((item) => {
          switch (item.kind) {
            case "system":
              return (
                <div key={item.id} className={`msg msg-system${item.error ? " err" : ""}`}>
                  {item.text}
                </div>
              );
            case "user":
              return (
                <div key={item.id} className="msg msg-user">
                  <div className="bubble">{item.text}</div>
                </div>
              );
            case "assistant":
              return (
                <div key={item.id} className="msg msg-assistant">
                  {item.error ? (
                    <div className="bubble err">{item.text}</div>
                  ) : (
                    <div className="bubble" dangerouslySetInnerHTML={{ __html: renderMarkdown(item.text) }} />
                  )}
                </div>
              );
            case "thinking":
              return <ThinkingLine key={item.id} />;
            case "toolRun":
              return <ToolRun key={item.id} entries={item.entries} />;
            default:
              return null;
          }
        })}
      </div>
      <form
        className="composer"
        id="composer"
        onSubmit={(e) => e.preventDefault()}
      >
        <textarea
          id="prompt"
          ref={textareaRef}
          placeholder={ready ? "Write an instruction..." : "Connecting to a sandbox…"}
          spellCheck={false}
          aria-label="Write an instruction..."
          rows={1}
          disabled={!ready}
          onInput={(e) => {
            const ta = e.currentTarget;
            ta.style.height = "auto";
            ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
            if (!running) setHasText(!!ta.value.trim());
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (e.ctrlKey || e.metaKey || e.shiftKey) {
              const ta = e.currentTarget;
              ta.setRangeText("\n", ta.selectionStart ?? 0, ta.selectionEnd ?? 0, "end");
              ta.dispatchEvent(new Event("input", { bubbles: true }));
              return;
            }
            if (!running && ready) void send(); // don't submit a new prompt while a turn is running, or before a sandbox is known
          }}
        />
        <select
          id="model-select"
          className="model-select"
          title="Model"
          aria-label="Model"
          value={model}
          onChange={(e) => setModel(e.target.value as ModelChoice)}
        >
          <option value="opus">Opus</option>
          <option value="sonnet">Sonnet</option>
          <option value="haiku">Haiku</option>
        </select>
        <button
          id="send"
          type="button"
          className={[running ? "stop" : "", !running && !hasText ? "hidden" : ""].filter(Boolean).join(" ")}
          title={running ? "Stop" : "Send (Enter)"}
          aria-label={running ? "Stop" : "Send"}
          onClick={() => (running ? stop() : void send())}
        >
          {running ? STOP_ICON : SEND_ICON}
        </button>
      </form>
    </section>
  );
}
