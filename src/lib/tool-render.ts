/**
 * Presentation helpers for a tool call's disclosure body, ported near-verbatim from
 * public/index.html's inline script. These build raw HTML strings (same approach the original
 * page used) rendered via dangerouslySetInnerHTML in <ToolCallEntry>; text content is always
 * escaped first, so the only tags that can appear are the fixed set introduced here.
 */
import { escapeHtml } from "./markdown";

declare global {
  interface Window {
    hljs?: {
      highlight(code: string, opts: { language: string }): { value: string };
      getLanguage(name: string): unknown;
    };
  }
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

// The model's own present-tense description of a step ("Opening TextEdit…"), falling back to a
// generic label if it didn't provide one.
export function stepLabel(input: unknown): string {
  const summary = input && typeof input === "object" ? (input as Record<string, unknown>).summary : undefined;
  return typeof summary === "string" && summary ? summary : "Working…";
}

export interface ToolBody {
  html: string;
  failed: boolean;
}

/** The filled-in body for a tool call that has a result or error: the returned JSON, or the
 *  tool-execution error if it threw. */
export function toolBody(output: unknown, error?: string): ToolBody {
  const badStatus = output && typeof output === "object" && "status" in output && (output as { status?: string }).status !== "ok";
  const failed = !!error || !!badStatus;
  const html = error ? `<pre>${escapeHtml(String(error))}</pre>` : jsonHtml(output);
  return { html, failed };
}
