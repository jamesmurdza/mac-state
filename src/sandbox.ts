import { Computer, type ExecResult, type MacOSSandbox } from "use-computer-sdk";
import { requireEnv } from "./env.js";

export const SCRIPT_PATH = "/tmp/mac-state.applescript";

/**
 * Apps launched by `activate` from an SSH session start hidden (no windows on
 * screen, dock dot only). Unhiding every hidden foreground app afterwards makes
 * them visible and frontmost. Verified on macOS 15.4.1 in use.computer VMs.
 */
export const UNHIDE_SCRIPT =
  'tell application "System Events" to set visible of (every process whose visible is false and background only is false) to true';

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
 */
export async function createSandboxFromEnv(): Promise<MacOSSandbox> {
  const apiKey = requireEnv("USE_COMPUTER_API_KEY");
  const reservationId = requireEnv("USE_COMPUTER_RESERVATION_ID");
  const computer = new Computer({ apiKey });
  return computer.create({ type: "macos", reservationId });
}

/** Shell command that runs the uploaded script, unhides what it launched, and keeps the script's exit code. */
export function appleScriptCommand(scriptPath: string): string {
  return `osascript ${scriptPath}; rc=$?; osascript -e '${UNHIDE_SCRIPT}' >/dev/null 2>&1; exit $rc`;
}

/** Upload an AppleScript block to the sandbox and run it with osascript. */
export async function runAppleScript(sandbox: MacOSSandbox, script: string): Promise<ExecResult> {
  await sandbox.upload(new TextEncoder().encode(script), SCRIPT_PATH);
  return sandbox.execSsh(appleScriptCommand(SCRIPT_PATH));
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
export async function takeScreenshot(sandbox: MacOSSandbox, opts: ScreenshotOptions = {}): Promise<Uint8Array> {
  const baseUrl = process.env.USE_COMPUTER_BASE_URL || DEFAULT_BASE_URL;
  const res = await fetch(screenshotUrl(baseUrl, sandbox.sandboxId, opts), {
    headers: { Authorization: `Bearer ${requireEnv("USE_COMPUTER_API_KEY")}` },
  });
  if (!res.ok) throw new Error(`Screenshot failed: HTTP ${res.status} ${await res.text()}`);
  return new Uint8Array(await res.arrayBuffer());
}
