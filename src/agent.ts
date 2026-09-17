import { anthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { MODEL_IDS, type ModelChoice } from "./llm.js";
import { runAppleScript, uiTreeSummary } from "./sandbox.js";
import type { SandboxSession } from "./session.js";

/**
 * Bound on tool-calling rounds per user turn. A realistic worst case is inspect→run a few
 * times over plus a final text-only step; 10 leaves margin for a retry-after-error while
 * capping both token cost (each step resends the growing transcript) and the number of real
 * side effects (osascript runs click/type on a live VM) one message can trigger.
 */
export const MAX_AGENT_STEPS = 10;

export const AGENT_SYSTEM_PROMPT = `You accomplish the user's instruction on a fresh macOS 15 virtual machine using the tools available. The machine is logged in as a normal user; Automation and Accessibility permissions are already granted.

- Call read_accessibility_tree when you need to know what's currently on screen before acting — don't guess blindly about what's open or how a window is laid out.
- Call run_applescript to act. Bring an app to the front with: tell application "X" to activate. After launching an app, add "delay 1" before driving it. Type text or press keys only through System Events (keystroke, key code), after activating the target app. Prefer an app's own scripting (TextEdit "make new document", Safari "open location", Finder "make new file") over UI scripting. Do not display dialogs or wait for user input unless the request asks for it.
- Keep going — inspecting the screen and running more scripts as needed — until the instruction is fully done, then reply with one short sentence describing what you did.`;

/** The two tools the model can call, each bound to the live sandbox session. */
function makeTools(session: SandboxSession) {
  return {
    run_applescript: tool({
      description:
        "Run an AppleScript block on the sandbox with osascript. Returns its stdout, stderr, and exit code.",
      inputSchema: z.object({
        script: z.string().describe("Complete, runnable AppleScript source. No markdown fences."),
      }),
      execute: ({ script }) => session.use((s) => runAppleScript(s, script)),
    }),
    read_accessibility_tree: tool({
      description:
        "Get a pruned JSON summary of what's currently on screen: running apps and, per on-screen window, its accessibility tree by role and label.",
      inputSchema: z.object({}),
      execute: () => session.use((s) => uiTreeSummary(s)),
    }),
  };
}

export type ToolName = "run_applescript" | "read_accessibility_tree";

export interface AgentStep {
  tool: ToolName;
  input: unknown;
  /** ExecResult for run_applescript, the uiTreeSummary JSON string for read_accessibility_tree. */
  output?: unknown;
  /** Set when the tool's execute threw (the AI SDK feeds this back to the model as a tool-error). */
  error?: string;
}

export interface AgentResult {
  /** The model (or server-side fallback) that actually answered. */
  model: string;
  steps: AgentStep[];
  /** The model's final text once it stops calling tools. */
  reply: string;
}

/**
 * Run the tool-calling agent to completion: the model may call read_accessibility_tree and
 * run_applescript repeatedly, deciding for itself when the instruction is done.
 *
 * Opus's safety classifier declines "automate this Mac" prompts under the cyber category, so an
 * Opus request opts into Anthropic's server-side fallback routing (a decline is re-run on the
 * recommended fallback model within the same call) via the beta header and provider option.
 */
export async function runAgent(
  prompt: string,
  modelChoice: ModelChoice,
  session: SandboxSession,
): Promise<AgentResult> {
  const result = await generateText({
    model: anthropic(MODEL_IDS[modelChoice]),
    system: AGENT_SYSTEM_PROMPT,
    prompt,
    tools: makeTools(session),
    stopWhen: stepCountIs(MAX_AGENT_STEPS),
    ...(modelChoice === "opus"
      ? {
          headers: { "anthropic-beta": "server-side-fallback-2026-07-01" },
          providerOptions: { anthropic: { fallbacks: "default" } },
        }
      : {}),
  });

  const steps: AgentStep[] = [];
  for (const step of result.steps) {
    for (const part of step.content) {
      if (part.type !== "tool-call") continue;
      const outcome = step.content.find(
        (p) =>
          (p.type === "tool-result" || p.type === "tool-error") && p.toolCallId === part.toolCallId,
      );
      steps.push({
        tool: part.toolName as ToolName,
        input: part.input,
        output: outcome?.type === "tool-result" ? outcome.output : undefined,
        error: outcome?.type === "tool-error" ? String(outcome.error) : undefined,
      });
    }
  }

  return { model: result.response?.modelId ?? MODEL_IDS[modelChoice], steps, reply: result.text };
}
