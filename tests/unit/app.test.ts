import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { generateAppleScript } from "../../src/llm.js";
import { SandboxSession } from "../../src/session.js";

// Real dependencies. The paths exercised here never reach them, so no sandbox is created
// and Claude is never called.
const app = createApp({ session: new SandboxSession(), generate: generateAppleScript });

const post = (body: string, headers: Record<string, string> = { "Content-Type": "application/json" }) =>
  app.request("/api/run", { method: "POST", headers, body });

describe("POST /api/run validation", () => {
  it("rejects a missing prompt with 400", async () => {
    const res = await post("{}");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "prompt is required" });
  });

  it("rejects a blank prompt with 400", async () => {
    expect((await post(JSON.stringify({ prompt: "   " }))).status).toBe(400);
  });

  it("rejects invalid JSON with 400", async () => {
    expect((await post("not json", {})).status).toBe(400);
  });
});

describe("GET /", () => {
  it("serves the page with the prompt box, run button and VNC viewer frame", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="prompt"');
    expect(html).toContain('id="send"');
    expect(html).not.toContain('id="run"');
    expect(html).toContain('<iframe id="vnc"');
    expect(html).not.toContain('id="screenshot"');
  });

  it("no longer serves /api/screenshot; the page uses VNC", async () => {
    expect((await app.request("/api/screenshot")).status).toBe(404);
  });
});
