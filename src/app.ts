import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { AgentResult } from "./agent.js";
import { DEFAULT_MODEL_CHOICE, isModelChoice, type ModelChoice } from "./llm.js";
import { runAppleScript, systemInfo } from "./sandbox.js";
import type { SandboxSession } from "./session.js";

export interface AppDeps {
  session: SandboxSession;
  runAgent: (prompt: string, model: ModelChoice) => Promise<AgentResult>;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function textField(body: unknown, key: "prompt" | "script"): string {
  if (!body || typeof body !== "object") return "";
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

function modelField(body: unknown): ModelChoice {
  const value = body && typeof body === "object" ? (body as Record<string, unknown>).model : undefined;
  return isModelChoice(value) ? value : DEFAULT_MODEL_CHOICE;
}

/** What /api/run reports as the author when the caller sent the script itself. */
export const RAW_SCRIPT_MODEL = "none (script sent as-is)";

export function createApp({ session, runAgent }: AppDeps): Hono {
  const app = new Hono();

  // The page embeds the gateway's noVNC viewer at vncUrl for a live view. The URL carries
  // the API key as its token, which is acceptable for a localhost tool only.
  app.get("/api/status", async (c) => {
    const s = await session.get();
    return c.json({ sandboxId: s.sandboxId, host: s.host, vncUrl: s.vncUrl });
  });

  // Standard macOS system info (version, model, CPU/memory, hostname, uptime), read live over SSH.
  app.get("/api/sysinfo", async (c) => {
    const info = await session.use((s) => systemInfo(s));
    return c.json(info);
  });

  // Body is either { prompt, model } (the agent inspects the screen and runs scripts until the
  // instruction is done) or { script } (run that script once, as-is, with no model in the loop).
  // Both return the same shape: { model, steps, reply }.
  app.post("/api/run", async (c) => {
    const body = await c.req.json().catch(() => null);
    const prompt = textField(body, "prompt");
    const script = textField(body, "script");
    if (!prompt && !script) return c.json({ error: "prompt or script is required" }, 400);

    if (script) {
      const result = await session.use((s) => runAppleScript(s, script));
      const reply =
        result.exitCode === 0
          ? result.stdout.trim() || "Done."
          : result.stderr.trim() || `Script failed (exit ${result.exitCode})`;
      return c.json({
        model: RAW_SCRIPT_MODEL,
        steps: [{ tool: "run_applescript", input: { script }, output: result }],
        reply,
      });
    }

    try {
      return c.json(await runAgent(prompt, modelField(body)));
    } catch (err) {
      return c.json({ error: `Claude: ${message(err)}` }, 502);
    }
  });

  app.onError((err, c) => c.json({ error: message(err) }, 500));
  app.use("/*", serveStatic({ root: "./public" }));
  return app;
}
