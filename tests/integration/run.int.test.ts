import { afterAll, describe, expect, it } from "vitest";
import { runAgent, streamAgent } from "../../src/agent.js";
import { createApp } from "../../src/app.js";
import { SandboxSession } from "../../src/session.js";

const session = new SandboxSession();
const app = createApp({
  session,
  runAgent: (prompt, model) => runAgent(prompt, model, session),
  streamAgent: (prompt, model) => streamAgent(prompt, model, session),
});
const post = (body: unknown) =>
  app.request("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("POST /api/run with a ready-made script (no agent) on a real sandbox", () => {
  afterAll(() => session.close());

  it("runs the script as-is and returns one step with both streams and the exit code", async () => {
    const script = 'log "to stderr"\ntell application "TextEdit" to activate\nreturn "to stdout"';
    const res = await post({ script });
    if (res.status !== 200) console.log("body:", await res.clone().text());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.model).toBe("none (script sent as-is)");
    expect(data.steps).toHaveLength(1);
    const step = data.steps[0];
    expect(step.tool).toBe("run_applescript");
    expect(step.input.script).toBe(script);
    expect(step.output.exitCode).toBe(0);
    expect(step.output.stdout.trim()).toBe("to stdout");
    expect(step.output.stderr.trim()).toBe("to stderr");
    expect(data.reply.trim()).toBe("to stdout");

    const state = await session.use((s) =>
      s.execSsh(`osascript -e 'tell application "System Events" to tell process "TextEdit" to get visible'`),
    );
    expect(state.stdout.trim()).toBe("true");
  });

  it("reports a failing script with its exit code and stderr", async () => {
    const res = await post({ script: 'error "boom" number 42' });
    expect(res.status).toBe(200);
    const data = await res.json();
    const step = data.steps[0];
    expect(step.output.exitCode).not.toBe(0);
    expect(step.output.stderr).toContain("boom");
  });
});

describe("POST /api/run with the real agent and a real sandbox", () => {
  it("turns a prompt into tool calls that run AppleScript, and TextEdit shows the text", async () => {
    const started = performance.now();
    const res = await post({ prompt: "Open TextEdit and put the text 'hello from mac-state' in a new document" });
    console.log(`/api/run took ${((performance.now() - started) / 1000).toFixed(1)}s`);
    if (res.status !== 200) console.log("body:", await res.clone().text());
    expect(res.status).toBe(200);

    const data = await res.json();
    console.log(`served by ${data.model}\nsteps: ${data.steps.length}\nreply: ${data.reply}`);
    expect(data.model).toMatch(/^claude-/);
    const scriptSteps = data.steps.filter((s: { tool: string }) => s.tool === "run_applescript");
    expect(scriptSteps.length).toBeGreaterThanOrEqual(1);
    expect(scriptSteps.some((s: { input: { script: string } }) => s.input.script.includes("TextEdit"))).toBe(true);

    const text = await session.use((s) => s.execSsh(`osascript -e 'tell application "TextEdit" to get text of front document'`));
    expect(text.stdout).toContain("hello from mac-state");

    const status = await app.request("/api/status");
    expect(status.status).toBe(200);
    const info = await status.json();
    expect(info.sandboxId).toMatch(/^sb-/);
    expect(info.vncUrl).toMatch(/\/vnc\?sandbox=sb-/);
  });
});
