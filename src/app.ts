import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { Generation } from "./llm.js";
import { runAppleScript, takeScreenshot } from "./sandbox.js";
import type { SandboxSession } from "./session.js";

export interface AppDeps {
  session: SandboxSession;
  generate: (prompt: string) => Promise<Generation>;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function promptFrom(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const prompt = (body as { prompt?: unknown }).prompt;
  return typeof prompt === "string" ? prompt.trim() : "";
}

export function createApp({ session, generate }: AppDeps): Hono {
  const app = new Hono();

  app.get("/api/status", async (c) => {
    const s = await session.get();
    return c.json({ sandboxId: s.sandboxId, host: s.host, vncUrl: s.vncUrl });
  });

  app.get("/api/screenshot", async (c) => {
    const jpeg = await session.use((s) => takeScreenshot(s));
    return c.body(jpeg, 200, { "Content-Type": "image/jpeg", "Cache-Control": "no-store" });
  });

  app.post("/api/run", async (c) => {
    const prompt = promptFrom(await c.req.json().catch(() => null));
    if (!prompt) return c.json({ error: "prompt is required" }, 400);

    let generated: Generation;
    try {
      generated = await generate(prompt);
    } catch (err) {
      return c.json({ error: `Claude: ${message(err)}` }, 502);
    }

    const result = await session.use((s) => runAppleScript(s, generated.script));
    return c.json({ ...generated, ...result });
  });

  app.onError((err, c) => c.json({ error: message(err) }, 500));
  app.use("/*", serveStatic({ root: "./public" }));
  return app;
}
