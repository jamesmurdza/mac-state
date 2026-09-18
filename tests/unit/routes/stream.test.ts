import { describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../../../src/lib/agent.js";
import { fakeHandle } from "./test-helpers.js";

vi.mock("../../../src/lib/sandbox-handle.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/sandbox-handle.js")>();
  return { ...actual, resolveSandbox: vi.fn() };
});
vi.mock("../../../src/lib/agent.js", () => ({ streamAgent: vi.fn() }));

const { resolveSandbox, toDescriptor } = await import("../../../src/lib/sandbox-handle.js");
const { streamAgent } = await import("../../../src/lib/agent.js");
const { POST } = await import("../../../src/app/api/stream/route.js");

async function readFrames(res: Response): Promise<AgentEvent[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((frame) => JSON.parse(frame.replace(/^data: /, "")));
}

async function* eventsOf(events: AgentEvent[]): AsyncGenerator<AgentEvent> {
  for (const ev of events) yield ev;
}

// mockReset() is called at the top of each test rather than in beforeEach -- see the comment in
// status.test.ts for why (a Vitest hook-timing quirk with beforeEach-scoped resets ahead of a
// mockImplementation(async () => { throw ... })).
describe("POST /api/stream", () => {
  it("rejects a blank prompt with 400 before touching the sandbox", async () => {
    vi.mocked(resolveSandbox).mockReset();
    vi.mocked(streamAgent).mockReset();
    const res = await POST(new Request("http://localhost/api/stream", { method: "POST", body: JSON.stringify({ prompt: "  " }) }));
    expect(res.status).toBe(400);
    expect(resolveSandbox).not.toHaveBeenCalled();
  });

  it("streams SSE frames with the right content type, in order, every frame carrying the current sandbox", async () => {
    vi.mocked(resolveSandbox).mockReset();
    vi.mocked(streamAgent).mockReset();
    const handle = fakeHandle("sb-1");
    vi.mocked(resolveSandbox).mockResolvedValue({ handle, descriptor: toDescriptor(handle) });
    const history = [{ role: "user" as const, content: "open TextEdit" }];
    const sb1 = { sandboxId: "sb-1", host: "mm001", vncUrl: "https://gw/vnc?sandbox=sb-1" };
    // A rotation mid-turn (the tool call found sb-1 gone and streamAgent transparently recreated
    // it) now shows up as a plain change in the `sandbox` field between events -- no dedicated
    // event type needed to carry it.
    const sb2 = { sandboxId: "sb-2", host: "mm002", vncUrl: "https://gw/vnc?sandbox=sb-2" };
    vi.mocked(streamAgent).mockReturnValue(
      eventsOf([
        { t: "tool-call", id: "1", tool: "open_app", input: { app: "TextEdit" }, sandbox: sb1 },
        { t: "tool-result", id: "1", output: { status: "ok" }, sandbox: sb2 },
        { t: "text", text: "Done.", sandbox: sb2 },
        { t: "done", history, sandbox: sb2 },
      ]),
    );

    const res = await POST(
      new Request("http://localhost/api/stream", { method: "POST", body: JSON.stringify({ prompt: "open TextEdit" }) }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");

    const frames = await readFrames(res);
    expect(frames.map((f) => f.t)).toEqual(["tool-call", "tool-result", "text", "done"]);
    expect(frames[0]).toMatchObject({ sandbox: sb1 });
    expect(frames[1]).toMatchObject({ sandbox: sb2 });
    expect(frames[3]).toEqual({ t: "done", history, sandbox: sb2 });
  });

  it("returns 500 when the sandbox can't be resolved before the stream opens", async () => {
    vi.mocked(resolveSandbox).mockReset();
    vi.mocked(streamAgent).mockReset();
    vi.mocked(resolveSandbox).mockImplementation(async () => {
      throw new Error("Missing env var USE_COMPUTER_API_KEY");
    });
    const res = await POST(new Request("http://localhost/api/stream", { method: "POST", body: JSON.stringify({ prompt: "hi" }) }));
    expect(res.status).toBe(500);
    expect(streamAgent).not.toHaveBeenCalled();
  });
});
