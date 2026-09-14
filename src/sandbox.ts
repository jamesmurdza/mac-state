import { Computer, type ExecResult, type MacOSSandbox } from "use-computer-sdk";
import { requireEnv } from "./env.js";

export const SCRIPT_PATH = "/tmp/mac-state.applescript";
const DEFAULT_BASE_URL = "https://api.use.computer";

export interface ScreenshotOptions {
  /** JPEG quality 1-100. Default 80 (~100 KB at 1920x1080). */
  quality?: number;
  /** Downscale factor, e.g. 0.5 for half size. */
  scale?: number;
}

/**
 * Create a macOS sandbox on the already-reserved Mac.
 * Reads USE_COMPUTER_API_KEY and USE_COMPUTER_RESERVATION_ID; never reserves.
 * Call dismissScreenRecordingPrompt() on the result before driving the GUI.
 */
export async function createSandboxFromEnv(): Promise<MacOSSandbox> {
  const apiKey = requireEnv("USE_COMPUTER_API_KEY");
  const reservationId = requireEnv("USE_COMPUTER_RESERVATION_ID");
  const computer = new Computer({ apiKey });
  return computer.create({ type: "macos", reservationId });
}

/**
 * Every fresh sandbox shows a macOS prompt ("bash" is requesting to bypass the system
 * private window picker...) owned by UserNotificationCenter, mid-screen. While it is up,
 * apps launched by AppleScript `activate` stay hidden and never become frontmost,
 * System Events keystrokes go to Finder, and the prompt lands in every screenshot.
 * Clicking its Allow button through System Events fixes all of that for the life of
 * the sandbox. Returns true when a prompt was dismissed, false when there was none.
 */
export const DISMISS_PROMPT_SCRIPT = `
tell application "System Events"
  if not (exists process "UserNotificationCenter") then return "absent"
  tell process "UserNotificationCenter"
    if (count of windows) is 0 then return "absent"
    if not (exists button "Allow" of window 1) then return "absent"
    click button "Allow" of window 1
  end tell
end tell
return "dismissed"
`;

export async function dismissScreenRecordingPrompt(sandbox: MacOSSandbox): Promise<boolean> {
  const result = await sandbox.execSsh(`osascript -e '${DISMISS_PROMPT_SCRIPT.trim()}'`);
  if (result.exitCode !== 0) throw new Error(`Dismissing the screen-recording prompt failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim() === "dismissed";
}

/** Upload an AppleScript block to the sandbox and run it with osascript. */
export async function runAppleScript(sandbox: MacOSSandbox, script: string): Promise<ExecResult> {
  await sandbox.upload(new TextEncoder().encode(script), SCRIPT_PATH);
  return sandbox.execSsh(`osascript ${SCRIPT_PATH}`);
}

/** URL of the gateway's compressed-screenshot endpoint with JPEG parameters. */
export function screenshotUrl(baseUrl: string, sandboxId: string, opts: ScreenshotOptions = {}): string {
  const url = new URL(`${baseUrl.replace(/\/+$/, "")}/v1/sandboxes/${sandboxId}/screenshot/compressed`);
  url.searchParams.set("format", "jpeg");
  url.searchParams.set("quality", String(opts.quality ?? 80));
  if (opts.scale !== undefined) url.searchParams.set("scale", String(opts.scale));
  return url.toString();
}

/**
 * JPEG screenshot via the raw HTTP endpoint.
 *
 * Why not `sandbox.screenshot.takeCompressed()`: use-computer-sdk 0.1.13 sends
 * no format/quality params, so the gateway returns a ~1.6 MB PNG that takes
 * 30-60 s to transfer (~50 KB/s egress). A JPEG at quality 80 is ~100 KB and
 * arrives in 2-3 s. The Python SDK exposes these params; the npm one does not yet.
 */
export async function takeScreenshot(sandbox: MacOSSandbox, opts: ScreenshotOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
  const baseUrl = process.env.USE_COMPUTER_BASE_URL || DEFAULT_BASE_URL;
  const res = await fetch(screenshotUrl(baseUrl, sandbox.sandboxId, opts), {
    headers: { Authorization: `Bearer ${requireEnv("USE_COMPUTER_API_KEY")}` },
  });
  if (!res.ok) throw new Error(`Screenshot failed: HTTP ${res.status} ${await res.text()}`);
  return new Uint8Array(await res.arrayBuffer());
}
