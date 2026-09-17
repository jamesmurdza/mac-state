import { anthropic } from "@ai-sdk/anthropic";
import { generateText, type ModelMessage, stepCountIs, streamText, tool } from "ai";
import { z } from "zod";
import { MODEL_IDS, type ModelChoice } from "./llm.js";
import { runAppleScript, uiAction, uiTreeSummary } from "./sandbox.js";
import type { SandboxSession } from "./session.js";

/**
 * Bound on tool-calling rounds per user turn. A realistic worst case is inspect→run a few
 * times over plus a final text-only step; 10 leaves margin for a retry-after-error while
 * capping both token cost (each step resends the growing transcript) and the number of real
 * side effects (osascript runs click/type on a live VM) one message can trigger.
 */
export const MAX_AGENT_STEPS = 10;

export const AGENT_SYSTEM_PROMPT = `You accomplish the user's instruction on a fresh macOS 15 virtual machine using the tools available. The machine is logged in as a normal user; Automation and Accessibility permissions are already granted.

- Call read_accessibility_tree to see what's on screen: it lists each on-screen window's app and, per element, a role and label. Use those exact values with the interaction tools — never build UI element paths by hand or guess element indices.
- To interact, prefer the semantic tools over raw scripting:
  - click_element to click a button, menu item, checkbox, tab, etc.
  - set_field_value to type into a text field or set a control's value.
  - wait_for_element to wait for something to appear instead of guessing a delay.
  Pass the exact app, role, and label you saw in the tree. If a call returns "ambiguous", pick from the returned candidates by calling again with index. If "not-found", re-read the tree and try again.
- Use run_applescript only as an escape hatch — to launch or activate an app (tell application "X" to activate), for an app's own scripting (TextEdit "make new document", Safari "open location", Finder "make new file"), or for anything the semantic tools don't cover. After launching an app, use wait_for_element rather than a fixed delay.
- Keep going — inspecting, waiting, and acting as needed — until the instruction is fully done, then reply with one short sentence describing what you did.`;

/** The tools the model can call, each bound to the live sandbox session. */
function makeTools(session: SandboxSession) {
  return {
    read_accessibility_tree: tool({
      description:
        "Get a pruned JSON summary of what's currently on screen: running apps and, per on-screen window, its accessibility tree by role and label. Pass an element's exact app, role, and label to click_element / set_field_value / wait_for_element.",
      inputSchema: z.object({
        summary: z
          .string()
          .describe(
            'A short present-tense description of what you\'re checking, shown live to the user, e.g. "Checking what\'s on screen".',
          ),
      }),
      execute: () => session.use((s) => uiTreeSummary(s)),
    }),
    click_element: tool({
      description:
        'Click a UI element (button, menu item, checkbox, tab, …) located by its role and label — the code finds it for you, so you never build UI paths. Copy the exact app/role/label from read_accessibility_tree. Returns { status } of "ok", "not-found", "ambiguous" (with a candidates list — retry passing index), or "error". Prefer this over run_applescript for clicking.',
      inputSchema: z.object({
        summary: z.string().describe('Short present-tense description, e.g. "Clicking the Save button".'),
        app: z.string().describe("The app/process that owns the element (the window's app in the tree)."),
        role: z.string().optional().describe('Element role as shown in the tree, e.g. "button", "menu item". Optional but helps.'),
        label: z.string().describe("The element's visible label/name, exactly as shown in the tree."),
        index: z.number().int().optional().describe("1-based choice among candidates after an ambiguous result."),
      }),
      execute: ({ app, role, label, index }) =>
        session.use((s) => uiAction(s, { app, role, label, index, action: "click" })),
    }),
    set_field_value: tool({
      description:
        "Set the value of a text field or control located by role and label (same matching as click_element). Use for typing into fields instead of System Events keystrokes.",
      inputSchema: z.object({
        summary: z.string().describe('Short present-tense description, e.g. "Entering the project name".'),
        app: z.string().describe("The app/process that owns the element."),
        role: z.string().optional().describe('Element role, e.g. "text field". Optional but helps.'),
        label: z.string().describe("The field's label/name, exactly as shown in the tree."),
        value: z.string().describe("The value to write into the field."),
        index: z.number().int().optional().describe("1-based choice among candidates after an ambiguous result."),
      }),
      execute: ({ app, role, label, value, index }) =>
        session.use((s) => uiAction(s, { app, role, label, value, index, action: "set" })),
    }),
    wait_for_element: tool({
      description:
        "Wait until an element with the given role and label appears (polls up to timeoutSeconds). Use this instead of guessing a fixed delay after launching or navigating.",
      inputSchema: z.object({
        summary: z.string().describe('Short present-tense description, e.g. "Waiting for the dialog".'),
        app: z.string().describe("The app/process to look in."),
        role: z.string().optional().describe("Element role. Optional but helps."),
        label: z.string().describe("The element's label/name to wait for."),
        timeoutSeconds: z.number().optional().describe("Max seconds to wait (default 10)."),
      }),
      execute: ({ app, role, label, timeoutSeconds }) =>
        session.use((s) => uiAction(s, { app, role, label, timeoutSeconds, action: "find" })),
    }),
    run_applescript: tool({
      description:
        'Escape hatch: run an arbitrary AppleScript block with osascript (launch/activate an app, app-specific scripting, or anything the semantic tools don\'t cover). Returns stdout, stderr, and exit code. Prefer click_element / set_field_value for interacting with on-screen controls.',
      inputSchema: z.object({
        summary: z
          .string()
          .describe(
            'A short present-tense description of what this step does, shown live to the user, e.g. "Opening TextEdit".',
          ),
        script: z.string().describe("Complete, runnable AppleScript source. No markdown fences."),
      }),
      execute: ({ script }) => session.use((s) => runAppleScript(s, script)),
    }),
  };
}

/**
 * Shared request options for both the buffered (generateText) and streaming (streamText) paths.
 *
 * Opus's safety classifier declines "automate this Mac" prompts under the cyber category, so an
 * Opus request opts into Anthropic's server-side fallback routing (a decline is re-run on the
 * recommended fallback model within the same call) via the beta header and provider option.
 */
function agentRequest(messages: ModelMessage[], modelChoice: ModelChoice, session: SandboxSession) {
  return {
    model: anthropic(MODEL_IDS[modelChoice]),
    system: AGENT_SYSTEM_PROMPT,
    messages,
    tools: makeTools(session),
    stopWhen: stepCountIs(MAX_AGENT_STEPS),
    ...(modelChoice === "opus"
      ? {
          headers: { "anthropic-beta": "server-side-fallback-2026-07-01" },
          providerOptions: { anthropic: { fallbacks: "default" } },
        }
      : {}),
  };
}

export type ToolName =
  | "run_applescript"
  | "read_accessibility_tree"
  | "click_element"
  | "set_field_value"
  | "wait_for_element";

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
 * Run the tool-calling agent to completion and return the whole turn at once: the model may
 * call read_accessibility_tree and run_applescript repeatedly, deciding for itself when the
 * instruction is done. Used by the non-streaming /api/run path.
 *
 * `history` is the running conversation. The new user turn and the model's response messages are
 * committed to it on success, so later turns see the full prior context.
 */
export async function runAgent(
  prompt: string,
  modelChoice: ModelChoice,
  session: SandboxSession,
  history: ModelMessage[] = [],
): Promise<AgentResult> {
  const messages: ModelMessage[] = [...history, { role: "user", content: prompt }];
  const result = await generateText(agentRequest(messages, modelChoice, session));
  history.splice(0, history.length, ...messages, ...result.responseMessages);

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

/** One event in the live agent stream, mapped from the AI SDK's fullStream parts. */
export type AgentEvent =
  | { t: "tool-call"; id: string; tool: ToolName; input: unknown }
  | { t: "tool-result"; id: string; output: unknown }
  | { t: "tool-error"; id: string; error: string }
  | { t: "text"; text: string }
  | { t: "error"; error: string }
  | { t: "done" };

/**
 * Run the agent and yield events as they happen (tool calls, tool results, streamed reply
 * text), so the UI can render the turn in real time. Errors surface as an "error" event rather
 * than throwing, since the HTTP response has already begun streaming by the time they occur.
 *
 * `signal`, when aborted (the user hit Stop / the client disconnected), stops the model from
 * taking further steps. `history` is the running conversation; the new user turn and the model's
 * response messages are committed to it only on a clean finish, so an interrupted or failed turn
 * doesn't leave a dangling user message or a tool call with no result.
 */
export async function* streamAgent(
  prompt: string,
  modelChoice: ModelChoice,
  session: SandboxSession,
  history: ModelMessage[] = [],
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const messages: ModelMessage[] = [...history, { role: "user", content: prompt }];
  let clean = true;
  try {
    const result = streamText({ ...agentRequest(messages, modelChoice, session), abortSignal: signal });
    for await (const part of result.fullStream) {
      switch (part.type) {
        case "tool-call":
          yield { t: "tool-call", id: part.toolCallId, tool: part.toolName as ToolName, input: part.input };
          break;
        case "tool-result":
          yield { t: "tool-result", id: part.toolCallId, output: part.output };
          break;
        case "tool-error":
          yield { t: "tool-error", id: part.toolCallId, error: String(part.error) };
          break;
        case "text-delta":
          if (part.text) yield { t: "text", text: part.text };
          break;
        case "abort":
          clean = false;
          break;
        case "error":
          clean = false;
          yield { t: "error", error: String(part.error) };
          break;
      }
    }
    if (clean) {
      const responseMessages = await result.responseMessages;
      history.splice(0, history.length, ...messages, ...responseMessages);
    }
  } catch (err) {
    // An aborted stream throws AbortError — expected when the user hits Stop, not a real error.
    const aborted = signal?.aborted || (err instanceof Error && err.name === "AbortError");
    if (!aborted) yield { t: "error", error: err instanceof Error ? err.message : String(err) };
  }
  yield { t: "done" };
}
