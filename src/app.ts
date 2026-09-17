import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { DEFAULT_MODEL_CHOICE, isModelChoice, type Generation, type ModelChoice } from "./llm.js";
import { runAppleScript, systemInfo, uiTreeSummary } from "./sandbox.js";
import type { SandboxSession } from "./session.js";

export interface AppDeps {
  session: SandboxSession;
  generate: (prompt: string, model: ModelChoice, screenContext?: string) => Promise<Generation>;
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

/** Screen context is a nice-to-have for generation, not a requirement — never let it block a run. */
async function bestEffortScreenContext(session: SandboxSession): Promise<string | undefined> {
  try {
    return await session.use((s) => uiTreeSummary(s));
  } catch {
    return undefined;
  }
}

/** What /api/run reports as the author when the caller sent the script itself. */
export const RAW_SCRIPT_MODEL = "none (script sent as-is)";

export function createApp({ session, generate }: AppDeps): Hono {
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

  // { prompt, model } -> Claude writes the script, without running it. Lets the UI show a real
  // "generating" vs. "running" distinction instead of one opaque round trip.
  app.post("/api/generate", async (c) => {
    const body = await c.req.json().catch(() => null);
    const prompt = textField(body, "prompt");
    if (!prompt) return c.json({ error: "prompt is required" }, 400);
    const screenContext = await bestEffortScreenContext(session);
    try {
      const generated = await generate(prompt, modelField(body), screenContext);
      return c.json(generated);
    } catch (err) {
      return c.json({ error: `Claude: ${message(err)}` }, 502);
    }
  });

  // Body is either { prompt, model } (Claude writes the script) or { script } (run it as-is).
  app.post("/api/run", async (c) => {
    const body = await c.req.json().catch(() => null);
    const prompt = textField(body, "prompt");
    const script = textField(body, "script");
    if (!prompt && !script) return c.json({ error: "prompt or script is required" }, 400);

    let generated: Generation;
    if (script) {
      generated = { script, model: RAW_SCRIPT_MODEL };
    } else {
      try {
        const screenContext = await bestEffortScreenContext(session);
        generated = await generate(prompt, modelField(body), screenContext);
      } catch (err) {
        return c.json({ error: `Claude: ${message(err)}` }, 502);
      }
    }

    const result = await session.use((s) => runAppleScript(s, generated.script));
    return c.json({ ...generated, ...result });
  });

  app.onError((err, c) => c.json({ error: message(err) }, 500));
  app.use("/*", serveStatic({ root: "./public" }));
  return app;
}
