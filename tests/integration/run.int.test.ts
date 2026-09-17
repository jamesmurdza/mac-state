import { afterAll, describe, expect, it } from "vitest";
import { POST as runRoute } from "../../src/app/api/run/route.js";
import { GET as statusRoute } from "../../src/app/api/status/route.js";
import { attachSandbox, type SandboxDescriptor } from "../../src/lib/sandbox-handle.js";

// This app now holds no server-side session: the caller (here, the test) is responsible for
// remembering the sandbox descriptor a response returns and resending it on the next call, the
// same way the real client does. `current` starts undefined (first call creates a fresh sandbox)
// and is updated from every response's `sandbox` field, so the whole file reuses one sandbox --
// mirroring the old SandboxSession-backed test's behavior without any server-held state.
let current: SandboxDescriptor | undefined;

async function post(body: Record<string, unknown>): Promise<Response> {
  const res = await runRoute(
    new Request("http://localhost/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, sandbox: current }),
    }),
  );
  if (res.ok) {
    const data = await res.clone().json();
    if (data.sandbox) current = data.sandbox;
  }
  return res;
}

afterAll(async () => {
  if (current) await attachSandbox(current).close().catch(() => {});
});

describe("POST /api/run with a ready-made script (no agent) on a real sandbox", () => {
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

    const state = await attachSandbox(current!).execSsh(
      `osascript -e 'tell application "System Events" to tell process "TextEdit" to get visible'`,
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
  it("turns a prompt into tool calls that drive the GUI, and TextEdit shows the text", async () => {
    const started = performance.now();
    const res = await post({ prompt: "Open TextEdit and put the text 'hello from mac-state' in a new document" });
    console.log(`/api/run took ${((performance.now() - started) / 1000).toFixed(1)}s`);
    if (res.status !== 200) console.log("body:", await res.clone().text());
    expect(res.status).toBe(200);

    const data = await res.json();
    console.log(`served by ${data.model}\nsteps: ${data.steps.length}\nreply: ${data.reply}`);
    expect(data.model).toMatch(/^claude-/);
    expect(Array.isArray(data.history)).toBe(true);
    expect(data.history.length).toBeGreaterThan(0);

    const text = await attachSandbox(current!).execSsh(`osascript -e 'tell application "TextEdit" to get text of front document'`);
    expect(text.stdout).toContain("hello from mac-state");

    const status = await statusRoute(
      new Request(
        `http://localhost/api/status?${new URLSearchParams({ sandboxId: current!.sandboxId, host: current!.host, vncUrl: current!.vncUrl })}`,
      ),
    );
    expect(status.status).toBe(200);
    const info = await status.json();
    expect(info.sandboxId).toBe(current!.sandboxId); // attach, not a fresh create
    expect(info.vncUrl).toMatch(/\/vnc\?sandbox=sb-/);
  });
});
