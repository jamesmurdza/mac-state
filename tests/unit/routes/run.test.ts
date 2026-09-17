import { describe, expect, it, vi } from "vitest";
import { fakeHandle } from "./test-helpers.js";

vi.mock("../../../src/lib/sandbox-handle.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/sandbox-handle.js")>();
  return { ...actual, resolveSandbox: vi.fn() };
});
vi.mock("../../../src/lib/sandbox.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/sandbox.js")>();
  return { ...actual, runAppleScript: vi.fn() };
});
vi.mock("../../../src/lib/agent.js", () => ({ runAgent: vi.fn() }));

const { resolveSandbox, toDescriptor } = await import("../../../src/lib/sandbox-handle.js");
const { runAppleScript } = await import("../../../src/lib/sandbox.js");
const { runAgent } = await import("../../../src/lib/agent.js");
const { POST, RAW_SCRIPT_MODEL } = await import("../../../src/app/api/run/route.js");

const post = (body: string) => POST(new Request("http://localhost/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body }));
const postJson = (body: unknown) => post(JSON.stringify(body));

describe("POST /api/run validation", () => {
  // No dependency is mocked to return anything here -- the 400 checks happen before the sandbox
  // (or the agent) is ever touched, so real (unmocked-in-effect) modules are safe to import.
  it("rejects a body with neither prompt nor script with 400", async () => {
    const res = await post("{}");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "prompt or script is required" });
  });

  it("rejects a blank script with 400", async () => {
    expect((await postJson({ script: " \n" })).status).toBe(400);
  });

  it("rejects a blank prompt with 400", async () => {
    expect((await postJson({ prompt: "   " })).status).toBe(400);
  });

  it("rejects invalid JSON with 400", async () => {
    expect((await post("not json")).status).toBe(400);
  });
});

// mockReset() is called at the top of each test rather than in beforeEach -- see the comment in
// status.test.ts for why (a Vitest hook-timing quirk with beforeEach-scoped resets ahead of a
// mockImplementation(async () => { throw ... })).
describe("POST /api/run with a ready-made script (no agent)", () => {
  it("runs the script as-is and returns one step with both streams, the exit code, and the sandbox descriptor", async () => {
    vi.mocked(resolveSandbox).mockReset();
    vi.mocked(runAppleScript).mockReset();
    const handle = fakeHandle("sb-1");
    vi.mocked(resolveSandbox).mockResolvedValue({ handle, descriptor: toDescriptor(handle) });
    vi.mocked(runAppleScript).mockResolvedValue({ stdout: "to stdout\n", stderr: "to stderr\n", exitCode: 0 });

    const res = await postJson({ script: 'return "to stdout"' });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.model).toBe(RAW_SCRIPT_MODEL);
    expect(data.steps).toEqual([
      { tool: "run_applescript", input: { script: 'return "to stdout"' }, output: { stdout: "to stdout\n", stderr: "to stderr\n", exitCode: 0 } },
    ]);
    expect(data.reply).toBe("to stdout");
    expect(data.sandbox).toEqual(toDescriptor(handle));
  });

  it("reports a failing script with its exit code and stderr as the reply", async () => {
    vi.mocked(resolveSandbox).mockReset();
    vi.mocked(runAppleScript).mockReset();
    const handle = fakeHandle("sb-1");
    vi.mocked(resolveSandbox).mockResolvedValue({ handle, descriptor: toDescriptor(handle) });
    vi.mocked(runAppleScript).mockResolvedValue({ stdout: "", stderr: "boom", exitCode: 42 });

    const res = await postJson({ script: 'error "boom" number 42' });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.reply).toBe("boom");
    expect(data.steps[0].output.exitCode).toBe(42);
  });
});

describe("POST /api/run with the agent", () => {
  it("returns the agent's result on success", async () => {
    vi.mocked(resolveSandbox).mockReset();
    vi.mocked(runAgent).mockReset();
    const handle = fakeHandle("sb-1");
    vi.mocked(resolveSandbox).mockResolvedValue({ handle, descriptor: toDescriptor(handle) });
    vi.mocked(runAgent).mockResolvedValue({
      model: "claude-haiku-4-5",
      steps: [],
      reply: "Done.",
      history: [{ role: "user", content: "hi" }],
      sandbox: toDescriptor(handle),
    });

    const res = await postJson({ prompt: "open TextEdit" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      model: "claude-haiku-4-5",
      steps: [],
      reply: "Done.",
      history: [{ role: "user", content: "hi" }],
      sandbox: toDescriptor(handle),
    });
  });

  it("maps a thrown agent error to a 502", async () => {
    vi.mocked(resolveSandbox).mockReset();
    vi.mocked(runAgent).mockReset();
    const handle = fakeHandle("sb-1");
    vi.mocked(resolveSandbox).mockResolvedValue({ handle, descriptor: toDescriptor(handle) });
    vi.mocked(runAgent).mockImplementation(async () => {
      throw new Error("overloaded");
    });

    const res = await postJson({ prompt: "open TextEdit" });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Claude: overloaded" });
  });

  it("returns 500 when the sandbox can't be resolved at all", async () => {
    vi.mocked(resolveSandbox).mockReset();
    vi.mocked(runAgent).mockReset();
    vi.mocked(resolveSandbox).mockImplementation(async () => {
      throw new Error("Missing env var USE_COMPUTER_API_KEY");
    });
    const res = await postJson({ prompt: "open TextEdit" });
    expect(res.status).toBe(500);
  });
});
