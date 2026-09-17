import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import type { ModelMessage } from "ai";
import { runAgent, streamAgent } from "./agent.js";
import { createApp } from "./app.js";
import { SandboxSession } from "./session.js";

if (existsSync(".env")) process.loadEnvFile(".env");

const port = Number(process.env.PORT ?? 3000);
const session = new SandboxSession();
// One continuous conversation for the life of the server, shared by both the streaming and
// buffered paths, so the agent remembers earlier turns (and the sandbox they acted on).
const history: ModelMessage[] = [];
const app = createApp({
  session,
  runAgent: (prompt, model) => runAgent(prompt, model, session, history),
  streamAgent: (prompt, model, signal) => streamAgent(prompt, model, session, history, signal),
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
