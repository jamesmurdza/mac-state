import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { Generation } from "./llm.js";
import { runAppleScript } from "./sandbox.js";
import type { SandboxSession } from "./session.js";

export interface AppDeps {
  session: SandboxSession;
  generate: (prompt: string) => Promise<Generation>;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function textField(body: unknown, key: "prompt" | "script"): string {
  if (!body || typeof body !== "object") return "";
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
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

  // Body is either { prompt } (Claude writes the script) or { script } (run it as-is).
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
        generated = await generate(prompt);
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
