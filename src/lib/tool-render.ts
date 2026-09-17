/**
 * Presentation helpers for a tool call's disclosure body, ported near-verbatim from
 * public/index.html's inline script. These build raw HTML strings (same approach the original
 * page used) rendered via dangerouslySetInnerHTML in <ToolCallEntry>; text content is always
 * escaped first, so the only tags that can appear are the fixed set introduced here.
 */
import { escapeHtml } from "./markdown";
import type { ExecResult } from "./sandbox-handle";
import type { ToolName } from "./agent";

declare global {
  interface Window {
    hljs?: {
      highlight(code: string, opts: { language: string }): { value: string };
      getLanguage(name: string): unknown;
    };
  }
}

export function scriptHtml(script: string): string {
  const hljs = typeof window !== "undefined" ? window.hljs : undefined;
  if (hljs) {
    const { value } = hljs.highlight(script, { language: "applescript" });
    return `<pre><code class="hljs language-applescript">${value}</code></pre>`;
  }
  return `<pre>${escapeHtml(script)}</pre>`;
}

// The accessibility-tree tool returns a JSON string (already stringified and possibly
// truncated). Pretty-print it if it parses, then syntax-highlight as JSON.
export function jsonHtml(output: unknown): string {
  let text = typeof output === "string" ? output : JSON.stringify(output, null, 2);
  if (typeof output === "string") {
    try {
      text = JSON.stringify(JSON.parse(output), null, 2);
    } catch {
      // not JSON -- show the raw string
    }
  }
  const hljs = typeof window !== "undefined" ? window.hljs : undefined;
  if (hljs?.getLanguage("json")) {
    const { value } = hljs.highlight(text, { language: "json" });
    return `<pre><code class="hljs language-json">${value}</code></pre>`;
  }
  return `<pre>${escapeHtml(text)}</pre>`;
}

// The output half of an AppleScript bubble: stdout, stderr and the exit code, no labels, all in
// one distinct-background block. Each piece is shown only when there's something to show.
export function execHtml(output: unknown): string {
  if (!output || typeof output !== "object") return "";
  const result = output as Partial<ExecResult>;
  const parts: string[] = [];
  const stdout = (result.stdout || "").trim();
  const stderr = (result.stderr || "").trim();
  if (stdout) parts.push(`<pre>${escapeHtml(stdout)}</pre>`);
  if (stderr) parts.push(`<pre>${escapeHtml(stderr)}</pre>`);
  if (typeof result.exitCode === "number") parts.push(`<div class="exit">exit ${result.exitCode}</div>`);
  return parts.length ? `<div class="output">${parts.join("")}</div>` : "";
}

// A plain-text output half (used for a tool-execution error under the script).
export function outputText(text: string): string {
  return `<div class="output"><pre>${escapeHtml(text)}</pre></div>`;
}

// The model's own present-tense description of a step ("Opening TextEdit…"), falling back to a
// generic label if it didn't provide one.
export function stepLabel(tool: ToolName | "run_applescript", input: unknown): string {
  const summary = input && typeof input === "object" ? (input as Record<string, unknown>).summary : undefined;
  if (typeof summary === "string" && summary) return summary;
  return tool === "run_applescript" ? "Running script…" : "Working…";
}

export interface ToolBody {
  html: string;
  failed: boolean;
}

/**
 * The filled-in body for a tool call that has a result or error: a run_applescript step (the
 * server-side raw-script /api/run path) reveals the script and its output; every other tool
 * reveals the returned JSON. Either can also carry a tool-execution error.
 */
export function toolBody(tool: ToolName | "run_applescript", input: unknown, output: unknown, error?: string): ToolBody {
  if (tool === "run_applescript") {
    const script = (input && typeof input === "object" && (input as Record<string, unknown>).script) || "";
    const result = output as Partial<ExecResult> | undefined;
    const failed = !!error || (!!result && result.exitCode !== 0);
    const html = error ? scriptHtml(String(script)) + outputText(String(error)) : scriptHtml(String(script)) + execHtml(output);
    return { html, failed };
  }
  const badStatus = output && typeof output === "object" && "status" in output && (output as { status?: string }).status !== "ok";
  const failed = !!error || !!badStatus;
  const html = error ? `<pre>${escapeHtml(String(error))}</pre>` : jsonHtml(output);
  return { html, failed };
}

/** A tool call that has started but not yet returned: the script body shows immediately (so you
 *  can watch it run); other tools show nothing until a result/error arrives. */
export function pendingBody(tool: ToolName | "run_applescript", input: unknown): string {
  if (tool !== "run_applescript") return "";
  const script = (input && typeof input === "object" && (input as Record<string, unknown>).script) || "";
  return scriptHtml(String(script));
}
