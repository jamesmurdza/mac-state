import type { ToolName } from "./agent";

export interface ToolCallEntry {
  id: string;
  tool: ToolName | "run_applescript";
  input: unknown;
  output?: unknown;
  error?: string;
  pending: boolean;
}

/**
 * One line in the chat transcript. `toolRun` unifies the "single status line" and "collapsed
 * group of consecutive tool calls" cases from the original page: a run with one entry renders
 * flat, a run with two or more renders as a group whose children are each independently
 * collapsible — the rendering component decides which, based on `entries.length`.
 */
export type TranscriptItem =
  | { kind: "system"; id: string; text: string; error?: boolean }
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string; error?: boolean }
  | { kind: "thinking"; id: string }
  | { kind: "toolRun"; id: string; entries: ToolCallEntry[] };

export function withoutThinking(items: TranscriptItem[]): TranscriptItem[] {
  return items.filter((i) => i.kind !== "thinking");
}

/**
 * Append a new tool-call entry, either starting a fresh run (when `runId` is null, e.g. right
 * after a `text` event ended the previous one) or joining the still-open run with that id.
 */
export function appendToolCall(
  items: TranscriptItem[],
  runId: string | null,
  entry: ToolCallEntry,
  newRunId: string,
): { items: TranscriptItem[]; runId: string } {
  if (runId) {
    const idx = items.findIndex((i) => i.kind === "toolRun" && i.id === runId);
    if (idx !== -1) {
      const run = items[idx] as Extract<TranscriptItem, { kind: "toolRun" }>;
      const next = [...items];
      next[idx] = { ...run, entries: [...run.entries, entry] };
      return { items: next, runId };
    }
  }
  return { items: [...items, { kind: "toolRun", id: newRunId, entries: [entry] }], runId: newRunId };
}

/** Fill in a pending entry's result/error, wherever it lives (always the currently-open run). */
export function updateToolEntry(items: TranscriptItem[], entryId: string, patch: { output?: unknown; error?: string }): TranscriptItem[] {
  return items.map((item) => {
    if (item.kind !== "toolRun" || !item.entries.some((e) => e.id === entryId)) return item;
    return { ...item, entries: item.entries.map((e) => (e.id === entryId ? { ...e, ...patch, pending: false } : e)) };
  });
}

/**
 * Append streamed reply text, either starting a fresh assistant bubble (when `assistantId` is
 * null, e.g. right after a run of tool calls ended) or continuing the still-open one.
 */
export function appendAssistantText(
  items: TranscriptItem[],
  assistantId: string | null,
  text: string,
  newId: string,
): { items: TranscriptItem[]; assistantId: string } {
  if (assistantId) {
    const idx = items.findIndex((i) => i.kind === "assistant" && i.id === assistantId);
    if (idx !== -1) {
      const msg = items[idx] as Extract<TranscriptItem, { kind: "assistant" }>;
      const next = [...items];
      next[idx] = { ...msg, text: msg.text + text };
      return { items: next, assistantId };
    }
  }
  return { items: [...items, { kind: "assistant", id: newId, text }], assistantId: newId };
}
