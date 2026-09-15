import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { generateAppleScript } from "../../src/llm.js";
import { SandboxSession } from "../../src/session.js";

const session = new SandboxSession();
const app = createApp({ session, generate: generateAppleScript });
const post = (body: unknown) =>
  app.request("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("POST /api/run with a ready-made script (no Claude) on a real sandbox", () => {
  afterAll(() => session.close());

  it("runs the script as-is and returns both streams and the exit code", async () => {
    const script = 'log "to stderr"\ntell application "TextEdit" to activate\nreturn "to stdout"';
    const res = await post({ script });
    if (res.status !== 200) console.log("body:", await res.clone().text());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ script, model: "none (script sent as-is)", exitCode: 0 });
    expect(data.stdout.trim()).toBe("to stdout");
    expect(data.stderr.trim()).toBe("to stderr");

    const state = await session.use((s) =>
      s.execSsh(`osascript -e 'tell application "System Events" to tell process "TextEdit" to get visible'`),
    );
    expect(state.stdout.trim()).toBe("true");
  });

  it("reports a failing script with its exit code and stderr", async () => {
    const res = await post({ script: 'error "boom" number 42' });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.exitCode).not.toBe(0);
    expect(data.stderr).toContain("boom");
  });
});

describe("POST /api/run with real Claude and a real sandbox", () => {
  it("turns a prompt into AppleScript, runs it, and TextEdit shows the text", async () => {
    const started = performance.now();
    const res = await post({ prompt: "Open TextEdit and put the text 'hello from mac-state' in a new document" });
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
