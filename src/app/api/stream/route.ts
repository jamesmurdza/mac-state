import { streamAgent } from "../../../lib/agent";
import { historyField, message, modelField, sandboxField, textField } from "../../../lib/route-helpers";
import { resolveSandbox, type SandboxRef } from "../../../lib/sandbox-handle";

export const runtime = "nodejs";

/**
 * Runs a full agent turn over SSE, abortable (Stop button / client disconnect -> AbortController).
 * Body: `{ prompt, model, sandbox?, history? }`. The response begins as soon as the model does, so
 * failures after that point arrive as an "error" event, not a non-200 status — except sandbox
 * resolution, which happens before the stream opens. This is the only path the page's chat UI
 * actually calls.
 *
 * Wire format is unchanged from the original Hono `streamSSE` implementation (`data: <json>\n\n`
 * frames of the same AgentEvent union), plus two additive fields every frame now carries: `sandbox`
 * (whatever handle this turn is using *right now* -- not just when it changes, so a turn that made
 * no tool calls at all still tells the client which sandbox got used) and, on `done` specifically,
 * the full updated `history` (since nothing server-side remembers it between requests).
 */
export async function POST(req: Request): Promise<Response> {
  const body = await req.json().catch(() => null);
  const prompt = textField(body, "prompt");
  if (!prompt) return Response.json({ error: "prompt is required" }, { status: 400 });
  const modelChoice = modelField(body);
  const history = historyField(body);

  let ref: SandboxRef;
  try {
    const { handle } = await resolveSandbox(sandboxField(body));
    ref = { current: handle };
  } catch (err) {
    return Response.json({ error: message(err) }, { status: 500 });
  }

  const encoder = new TextEncoder();
  // Stop button / client disconnect -> abort the model so it stops taking further steps.
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of streamAgent({ prompt, modelChoice, sandboxRef: ref, history, signal: abort.signal })) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
      } finally {
        controller.close();
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
