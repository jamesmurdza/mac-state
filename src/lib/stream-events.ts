import type { AgentEvent } from "./agent";

/**
 * POST to an SSE endpoint and invoke `onEvent` for each `data:` frame as it arrives. Ported
 * near-verbatim from public/index.html's `streamEvents()` — a hand-rolled `fetch()` +
 * `reader.getReader()` parser, not `EventSource`/the Vercel AI SDK's `useChat` protocol, so the
 * server's wire format (see src/app/api/stream/route.ts) stays framework-agnostic on both ends.
 * `signal` lets the caller abort the stream (the Stop button).
 */
export async function streamEvents(
  url: string,
  body: unknown,
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    let data: { error?: string } | undefined;
    try {
      data = JSON.parse(await res.text());
    } catch {
      // not JSON -- fall through to the generic HTTP-status error below
    }
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const data = frame
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^ /, ""))
        .join("\n");
      if (!data) continue;
      let ev: AgentEvent;
      try {
        ev = JSON.parse(data);
      } catch {
        continue;
      }
      onEvent(ev);
    }
  }
}
