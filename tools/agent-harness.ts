/**
 * Dev harness for iterating on the agent loop. Drives the exact production streamAgent() against
 * a real sandbox, prints a timestamped trace of every tool call/result/reply, and saves a
 * screenshot after each step to /tmp/logs/shots so a developer (not the agent) can see the actual
 * screen state at each decision point.
 *
 * Usage:  npx tsx tools/agent-harness.ts "use xcode to make and run a hello world script"
 *         MODEL=sonnet npx tsx tools/agent-harness.ts "open safari and go to example.com"
 *         SHOTS=0 npx tsx tools/agent-harness.ts "..."     # skip screenshots (faster)
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
if (existsSync(".env")) process.loadEnvFile(".env");
const { streamAgent } = await import("../src/agent.js");
const { SandboxSession } = await import("../src/session.js");
const { takeScreenshot } = await import("../src/sandbox.js");
const { isModelChoice, DEFAULT_MODEL_CHOICE } = await import("../src/llm.js");

const prompt = process.argv.slice(2).join(" ") || "use xcode to make and run a hello world script";
const model = isModelChoice(process.env.MODEL) ? process.env.MODEL : DEFAULT_MODEL_CHOICE;
const wantShots = process.env.SHOTS !== "0";
const SHOTS = "/tmp/logs/shots";
mkdirSync(SHOTS, { recursive: true });

const session = new SandboxSession();
let stepN = 0;

const short = (v: unknown, n = 500): string => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s && s.length > n ? `${s.slice(0, n)}…(${s.length})` : (s ?? "");
};

async function snap(label: string): Promise<void> {
  if (!wantShots) return;
  try {
    const buf = await session.use((s) => takeScreenshot(s, { quality: 55, scale: 0.6 }));
    const name = `${String(stepN).padStart(2, "0")}-${label}.jpg`;
    writeFileSync(`${SHOTS}/${name}`, buf);
    console.log(`        📷 ${SHOTS}/${name}`);
  } catch (e) {
    console.log("        (screenshot failed)", (e as Error).message);
  }
}

try {
  console.log(`PROMPT: ${prompt}\nMODEL:  ${model}\n${"-".repeat(70)}`);
  const pending = new Map<string, { tool: string }>();
  const t0 = Date.now();
  let replyBuf = "";
  for await (const ev of streamAgent(prompt, model, session)) {
    const dt = ((Date.now() - t0) / 1000).toFixed(1).padStart(5);
    if (ev.t === "tool-call") {
      stepN++;
      pending.set(ev.id, { tool: ev.tool });
      const input = (ev.input ?? {}) as Record<string, unknown>;
      const { summary, ...rest } = input;
      console.log(`\n[${dt}s] #${stepN} → ${ev.tool}(${short(rest, 300)})`);
      if (summary) console.log(`        “${summary}”`);
    } else if (ev.t === "tool-result") {
      const p = pending.get(ev.id);
      console.log(`[${dt}s]        ✓ → ${short(ev.output)}`);
      await snap(p?.tool ?? "result");
    } else if (ev.t === "tool-error") {
      console.log(`[${dt}s]        ✗ ERROR → ${short(ev.error, 400)}`);
      await snap("error");
    } else if (ev.t === "text") {
      replyBuf += ev.text;
    } else if (ev.t === "error") {
      console.log(`[${dt}s] !! STREAM ERROR: ${ev.error}`);
    } else if (ev.t === "done") {
      console.log(`\n${"-".repeat(70)}\n[${dt}s] DONE — ${stepN} tool call(s)`);
    }
  }
  console.log(`\nREPLY: ${replyBuf.trim() || "(none)"}`);
  await snap("final");
} finally {
  await session.close();
  console.log("\n(sandbox closed)");
}
