import { anthropic } from "@ai-sdk/anthropic";
import { generateText, type ModelMessage, stepCountIs, streamText, tool } from "ai";
import { z } from "zod";
import { MODEL_IDS, type ModelChoice } from "./llm";
import { clickElement, openApp, pressKeys, typeText, uiTreeSummary } from "./sandbox";
import { type SandboxDescriptor, type SandboxHandle, type SandboxRef, toDescriptor, withSandbox } from "./sandbox-handle";

/**
 * Bound on tool-calling rounds per user turn — a runaway guard, not a target. Real GUI tasks
 * (open an app, navigate a multi-step sheet, fill fields, run) can take 20-30 inspect/act steps,
 * so this is generous; the loop normally ends earlier when the model stops calling tools.
 */
export const MAX_AGENT_STEPS = 40;

export const AGENT_SYSTEM_PROMPT = `You accomplish the user's instruction on a fresh macOS 15 virtual machine by driving its GUI with the tools available. The machine is logged in as a normal user; Automation and Accessibility permissions are already granted.

Your loop is: look → act → look. Never act blind. open_app, click_element, type_text and press_keys each RETURN the updated screen (a "screen" field) right after acting, so you normally do NOT need a separate read_accessibility_tree — just look at what the action returned and decide the next step.

- open_app to launch or focus an app. It waits until the app actually shows a window and returns what's on screen. If its "note" says the app is frontmost with no window, or a dialog appears, handle that before continuing.
- read_accessibility_tree to look again without acting (e.g. to wait for something to finish): it returns the frontmost app's "menus" (menu-bar titles) and each on-screen window (including dialogs and sheets) with its elements' roles and labels.
- click_element to click anything by its label from the tree — a button, tab, checkbox, table cell, template/icon, or a menu-bar menu. It works even for SwiftUI controls. If it returns "ambiguous", pick from the candidates with index; if "not-found", read the tree again (the label may differ, or the element isn't up yet). To use a menu: click_element the menu name (e.g. "File" or "Product") to open it, read the tree, then click_element the item (e.g. "Run").
- type_text to type into a field — click_element the field first to focus it, then type_text.
- press_keys for keys and shortcuts: "return"/"escape"/"tab" to confirm/dismiss/move, and app shortcuts like "cmd+shift+n" (Xcode: New Project), "cmd+r" (Run), "cmd+s" (Save). Use whichever is most reliable — a menu, a click, or a shortcut.

You drive the real GUI only — there is no shell, terminal, or scripting shortcut. Do the task the way a person would: through windows, menus, buttons and the keyboard. If a control isn't where you expect, look again (read the tree) and adjust — don't give up and don't invent another route.

Keep going, one step at a time, until the instruction is FULLY done — including any final step like actually running or saving. Do not stop after setup or assume a later step worked; look at each action's returned screen to verify it. Only when it's genuinely complete, reply with one short sentence describing what you did. If you truly cannot proceed (an app won't launch, a required control never appears after looking again), say so plainly and explain exactly where you got stuck — never claim success you didn't verify.`;

/**
 * The tools the model can call, each bound to a per-request `SandboxRef`. A tool call that hits a
 * "gone" sandbox (timed out mid-turn) transparently gets a fresh one via `withSandbox`; `onRotate`
 * (when given) is notified synchronously at the moment that happens, so a streaming caller can
 * surface it to the client before the tool's own result.
 */
function makeTools(ref: SandboxRef, onRotate?: (handle: SandboxHandle) => void) {
  const run = <T,>(fn: (sandbox: SandboxHandle) => Promise<T>) => withSandbox(ref, fn, { onRotate });
  return {
    read_accessibility_tree: tool({
      description:
        "Get a pruned JSON summary of what's currently on screen: running apps, the frontmost app's menu-bar menus, and each on-screen window (including dialogs and sheets, with its role and title) with its elements by role and label. Pass an element's label to click_element. A `note` may flag an app that's frontmost with no window.",
      inputSchema: z.object({
        summary: z
          .string()
          .describe(
            'A short present-tense description of what you\'re checking, shown live to the user, e.g. "Checking what\'s on screen".',
          ),
      }),
      execute: () => run((s) => uiTreeSummary(s)),
    }),
    click_element: tool({
      description:
        'Click an on-screen element (button, menu item, tab, checkbox, table cell, template icon, or a menu-bar menu like "File"/"Product") by its label. It finds the element in the live UI tree and clicks its center, so it works for standard and SwiftUI apps alike. Copy the exact label from read_accessibility_tree. Returns { status }: "ok", "not-found", "ambiguous" (with a candidates list — retry passing index), or "error". To use a menu, click the menu name to open it, read the tree, then click the item.',
      inputSchema: z.object({
        summary: z.string().describe('Short present-tense description, e.g. "Clicking the Save button".'),
        label: z.string().describe("The element's visible label/name/text, as shown in the tree."),
        role: z.string().optional().describe('Element role to disambiguate, e.g. "button", "menu item". Optional.'),
        app: z.string().optional().describe("Restrict to this app's windows. Optional."),
        index: z.number().int().optional().describe("1-based choice among candidates after an ambiguous result."),
      }),
      execute: ({ app, role, label, index }) => run((s) => clickElement(s, { app, role, label, index })),
    }),
    type_text: tool({
      description:
        "Type text into the control that currently has keyboard focus. Click the field with click_element first to focus it. Uses real keystrokes.",
      inputSchema: z.object({
        summary: z.string().describe('Short present-tense description, e.g. "Entering the project name".'),
        text: z.string().describe("The text to type."),
      }),
      execute: ({ text }) => run((s) => typeText(s, text)),
    }),
    press_keys: tool({
      description:
        'Press a key or keyboard shortcut, e.g. "return", "escape", "tab", "cmd+shift+n" (new project in Xcode), "cmd+r" (run), "cmd+s" (save), "cmd+a" (select all). Use for shortcuts and for confirming/dismissing dialogs.',
      inputSchema: z.object({
        summary: z.string().describe('Short present-tense description, e.g. "Running the project".'),
        keys: z.string().describe('The key or combo, e.g. "return" or "cmd+shift+n".'),
      }),
      execute: ({ keys }) => run((s) => pressKeys(s, keys)),
    }),
    open_app: tool({
      description:
        "Launch or focus an app and wait until it presents a window, then return what's on screen (same JSON as read_accessibility_tree). Use this to open an app instead of run_applescript + a guessed delay. If the app ends up frontmost with no window (still launching, or a dialog is blocking it), the result's note says so and any dialog appears in windows — read it and act, don't assume the app is ready.",
      inputSchema: z.object({
        summary: z.string().describe('Short present-tense description, e.g. "Opening Xcode".'),
        app: z.string().describe('The app to open, e.g. "Xcode", "Safari", "TextEdit".'),
      }),
      execute: ({ app }) => run((s) => openApp(s, app)),
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
function agentRequest(messages: ModelMessage[], modelChoice: ModelChoice, tools: ReturnType<typeof makeTools>) {
  return {
    model: anthropic(MODEL_IDS[modelChoice]),
    system: AGENT_SYSTEM_PROMPT,
    messages,
    tools,
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
  | "read_accessibility_tree"
  | "open_app"
  | "click_element"
  | "type_text"
  | "press_keys";

export interface AgentStep {
  tool: ToolName;
  input: unknown;
  /** ExecResult for run_applescript, the uiTreeSummary JSON string for read_accessibility_tree. */
  output?: unknown;
  /** Set when the tool's execute threw (the AI SDK feeds this back to the model as a tool-error). */
  error?: string;
}

/** Request-scoped input shared by runAgent and streamAgent — no server-held singletons. */
export interface AgentTurnInput {
  prompt: string;
  modelChoice: ModelChoice;
  /** The sandbox this turn acts on; may be swapped in place if it times out mid-turn. */
  sandboxRef: SandboxRef;
  /** The prior conversation, supplied by the caller (the client, in this stateless design). Never mutated. */
  history: ModelMessage[];
  /** streamAgent only: aborts the model call (Stop button / client disconnect). */
  signal?: AbortSignal;
}

export interface AgentResult {
  /** The model (or server-side fallback) that actually answered. */
  model: string;
  steps: AgentStep[];
  /** The model's final text once it stops calling tools. */
  reply: string;
  /** The full updated conversation — the caller's job is just to hold onto this for the next turn. */
  history: ModelMessage[];
  /** Whatever sandbox this turn ended up using (possibly a fresh one, if the original timed out). */
  sandbox: SandboxDescriptor;
}

/**
 * Run the tool-calling agent to completion and return the whole turn at once: the model may
 * call the GUI tools repeatedly, deciding for itself when the instruction is done. Used by the
 * non-streaming /api/run path.
 */
export async function runAgent(input: AgentTurnInput): Promise<AgentResult> {
  const { prompt, modelChoice, sandboxRef, history } = input;
  const messages: ModelMessage[] = [...history, { role: "user", content: prompt }];
  const result = await generateText(agentRequest(messages, modelChoice, makeTools(sandboxRef)));

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

  return {
    model: result.response?.modelId ?? MODEL_IDS[modelChoice],
    steps,
    reply: result.text,
    history: [...messages, ...result.responseMessages],
    sandbox: toDescriptor(sandboxRef.current),
  };
}

/** One event in the live agent stream, mapped from the AI SDK's fullStream parts. */
export type AgentEvent =
  | { t: "tool-call"; id: string; tool: ToolName; input: unknown }
  | { t: "tool-result"; id: string; output: unknown }
  | { t: "tool-error"; id: string; error: string }
  | { t: "text"; text: string }
  /** The sandbox this turn is using changed (it timed out and a fresh one was created mid-turn).
   *  Emitted before the tool-call's own tool-result/tool-error, so a client updates its VNC view
   *  and remembered descriptor causally before seeing the result that came from the new sandbox. */
  | { t: "sandbox"; sandboxId: string; host: string; vncUrl: string }
  | { t: "error"; error: string }
  /** `history` is the full updated conversation on a clean finish, or the caller's original
   *  `input.history` unchanged if the turn was aborted/errored before finishing cleanly. `sandbox`
   *  is *always* the sandbox this turn actually used -- not just on a mid-turn rotation. This is
   *  what lets the client learn about a sandbox the route created from scratch (no descriptor was
   *  sent, or the sandbox needed replacing) even when the turn made no tool calls at all: without
   *  it, a turn with pure text output (e.g. "hi") would silently strand the client on a stale/null
   *  descriptor, so *every* later turn re-creates yet another sandbox instead of reusing this one. */
  | { t: "done"; history: ModelMessage[]; sandbox: SandboxDescriptor };

/**
 * Run the agent and yield events as they happen (tool calls, tool results, streamed reply
 * text), so the UI can render the turn in real time. Errors surface as an "error" event rather
 * than throwing, since the HTTP response has already begun streaming by the time they occur.
 *
 * `signal`, when aborted (the user hit Stop / the client disconnected), stops the model from
 * taking further steps. The turn's messages are only folded into the returned `history` on a
 * clean finish, so an interrupted or failed turn doesn't leave a dangling user message or a tool
 * call with no result.
 */
export async function* streamAgent(input: AgentTurnInput): AsyncGenerator<AgentEvent> {
  const { prompt, modelChoice, sandboxRef, history, signal } = input;
  const messages: ModelMessage[] = [...history, { role: "user", content: prompt }];
  const rotations: SandboxDescriptor[] = [];
  const tools = makeTools(sandboxRef, (handle) => rotations.push(toDescriptor(handle)));

  function* drainRotations(): Generator<AgentEvent> {
    while (rotations.length) {
      const d = rotations.shift()!;
      yield { t: "sandbox", sandboxId: d.sandboxId, host: d.host, vncUrl: d.vncUrl };
    }
  }

  let clean = true;
  let finalHistory = history;
  try {
    const result = streamText({ ...agentRequest(messages, modelChoice, tools), abortSignal: signal });
    for await (const part of result.fullStream) {
      switch (part.type) {
        case "tool-call":
          yield { t: "tool-call", id: part.toolCallId, tool: part.toolName as ToolName, input: part.input };
          break;
        case "tool-result":
          yield* drainRotations();
          yield { t: "tool-result", id: part.toolCallId, output: part.output };
          break;
        case "tool-error":
          yield* drainRotations();
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
      finalHistory = [...messages, ...responseMessages];
    }
  } catch (err) {
    // An aborted stream throws AbortError — expected when the user hits Stop, not a real error.
    const aborted = signal?.aborted || (err instanceof Error && err.name === "AbortError");
    if (!aborted) yield { t: "error", error: err instanceof Error ? err.message : String(err) };
  }
  yield* drainRotations();
  yield { t: "done", history: finalHistory, sandbox: toDescriptor(sandboxRef.current) };
}
