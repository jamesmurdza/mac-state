import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { generateAppleScript } from "../../src/llm.js";
import { SandboxSession } from "../../src/session.js";

const session = new SandboxSession();
const app = createApp({ session, generate: generateAppleScript });

describe("POST /api/run with real Claude and a real sandbox", () => {
  afterAll(() => session.close());

  it("turns a prompt into AppleScript, runs it, and TextEdit shows the text", async () => {
    const started = performance.now();
    const res = await app.request("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Open TextEdit and put the text 'hello from mac-state' in a new document" }),
    });
    console.log(`/api/run took ${((performance.now() - started) / 1000).toFixed(1)}s`);
    if (res.status !== 200) console.log("body:", await res.clone().text());
    expect(res.status).toBe(200);

    const data = await res.json();
    console.log(`served by ${data.model}\nscript:\n${data.script}\nstdout: ${data.stdout} stderr: ${data.stderr}`);
    expect(data.model).toMatch(/^claude-/);
    expect(data.script).toContain("TextEdit");
    expect(data.script).not.toContain("```");
    expect(data.exitCode).toBe(0);

    const text = await session.use((s) => s.execSsh(`osascript -e 'tell application "TextEdit" to get text of front document'`));
    expect(text.stdout).toContain("hello from mac-state");

    const status = await app.request("/api/status");
    expect(status.status).toBe(200);
    const info = await status.json();
    expect(info.sandboxId).toMatch(/^sb-/);
    expect(info.vncUrl).toMatch(/\/vnc\?sandbox=sb-/);
  });
});
