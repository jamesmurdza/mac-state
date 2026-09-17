import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { runAgent, streamAgent } from "./agent.js";
import { createApp } from "./app.js";
import { SandboxSession } from "./session.js";

if (existsSync(".env")) process.loadEnvFile(".env");

const port = Number(process.env.PORT ?? 3000);
const session = new SandboxSession();
const app = createApp({
  session,
  runAgent: (prompt, model) => runAgent(prompt, model, session),
  streamAgent: (prompt, model) => streamAgent(prompt, model, session),
});

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`mac-state listening on http://localhost:${info.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    console.log("closing sandbox…");
    await session.close();
    server.close();
    process.exit(0);
  });
}
