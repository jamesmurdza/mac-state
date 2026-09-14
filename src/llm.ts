import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5";

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
  /** The model that produced the script: claude-opus-5, or the server-side fallback that took over. */
  model: string;
}

/**
 * One non-streaming call: the prompt in, AppleScript source out.
 *
 * Opus 5's safety classifiers decline "automate this Mac" requests under the cyber
 * category, so the request opts into Anthropic's server-side fallback routing:
 * a decline is re-run on the recommended fallback model inside the same call.
 */
export async function generateAppleScript(prompt: string, client: Anthropic = new Anthropic()): Promise<Generation> {
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
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
