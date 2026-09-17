import Anthropic from "@anthropic-ai/sdk";

/** The model choices exposed in the web UI's dropdown. */
export type ModelChoice = "opus" | "sonnet" | "haiku";

export const MODEL_IDS: Record<ModelChoice, string> = {
  opus: "claude-opus-5",
  sonnet: "claude-sonnet-5",
  haiku: "claude-haiku-4-5",
};

export const DEFAULT_MODEL_CHOICE: ModelChoice = "haiku";

export function isModelChoice(value: unknown): value is ModelChoice {
  return value === "opus" || value === "sonnet" || value === "haiku";
}

export const SYSTEM_PROMPT = `You write AppleScript that will be run with osascript on a fresh macOS 15 virtual machine, logged in as a normal user. Automation and Accessibility permissions are already granted.

Output rules:
- Output only AppleScript source. No markdown fences, no prose, no explanation before or after.
- The script must be complete and runnable as a single osascript file.
- End with a "return" of a short status string saying what was done.

Environment rules:
- Bring an app to the front with: tell application "X" to activate
- After launching an app, add "delay 1" before driving it.
- Type text or press keys only through System Events (keystroke, key code), after activating the target app.
- Prefer an app's own scripting (TextEdit "make new document", Safari "open location", Finder "make new file") over UI scripting.
- Do not display dialogs or wait for user input unless the request asks for it.`;

/** The model is told not to use fences, but strip them if it does. */
export function extractAppleScript(text: string): string {
  const fenced = /```(?:applescript|osascript)?[ \t]*\n([\s\S]*?)```/i.exec(text);
  return (fenced ? fenced[1] : text).trim();
}

export interface Generation {
  script: string;
  /** The model that produced the script, or the server-side fallback that took over. */
  model: string;
}

interface RawResponse {
  stop_reason: string | null;
  stop_details?: { explanation?: string | null; category?: string | null } | null;
  content: Array<{ type: string; text?: string }>;
  model: string;
}

function toGeneration(res: RawResponse): Generation {
  if (res.stop_reason === "refusal") {
    const why = res.stop_details?.explanation ?? res.stop_details?.category ?? "no reason given";
    throw new Error(`Claude declined: ${why}`);
  }
  if (res.stop_reason === "max_tokens") throw new Error("Claude's reply was cut off at max_tokens");
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const script = extractAppleScript(text);
  if (!script) throw new Error("Claude returned no script");
  return { script, model: res.model };
}

/**
 * One non-streaming call: the prompt in, AppleScript source out.
 *
 * Opus's safety classifiers decline "automate this Mac" requests under the cyber
 * category, so an Opus request opts into Anthropic's server-side fallback routing:
 * a decline is re-run on the recommended fallback model inside the same call.
 *
 * `screenContext`, when given, is a pre-summarized JSON string of what's currently on
 * screen (see `uiTreeSummary` in sandbox.ts) — prepended so the script can reference
 * actual open apps/windows/controls instead of guessing blind.
 */
export async function generateAppleScript(
  prompt: string,
  modelChoice: ModelChoice = DEFAULT_MODEL_CHOICE,
  screenContext?: string,
  client: Anthropic = new Anthropic(),
): Promise<Generation> {
  const model = MODEL_IDS[modelChoice] ?? MODEL_IDS[DEFAULT_MODEL_CHOICE];
  const userContent = screenContext
    ? `Current screen (JSON; running apps and, per on-screen window, a pruned accessibility tree — may be truncated):\n${screenContext}\n\nInstruction: ${prompt}`
    : prompt;

  if (modelChoice === "opus") {
    const res = await client.beta.messages.create({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    return toGeneration(res);
  }

  const res = await client.messages.create({
    model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });
  return toGeneration(res);
}
