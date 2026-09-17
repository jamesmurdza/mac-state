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

export interface SystemInfo {
  product: string;
  version: string;
  build: string;
  hostname: string;
  arch: string;
  model: string;
  cpus: string;
  memBytes: string;
  uptime: string;
}

/** One line per field, `key=value`, so the reply is trivial to parse even over a single SSH round trip. */
const SYSTEM_INFO_SCRIPT = [
  'echo "product=$(sw_vers -productName)"',
  'echo "version=$(sw_vers -productVersion)"',
  'echo "build=$(sw_vers -buildVersion)"',
  'echo "hostname=$(hostname)"',
  'echo "arch=$(uname -m)"',
  'echo "model=$(sysctl -n hw.model)"',
  'echo "cpus=$(sysctl -n hw.ncpu)"',
  'echo "memBytes=$(sysctl -n hw.memsize)"',
  "echo \"uptime=$(uptime | sed 's/^ *//')\"",
].join("\n");

/** Standard system info (macOS version, model, CPU/memory, hostname, uptime) via `sw_vers`/`sysctl`/`uptime` over SSH. */
export async function systemInfo(sandbox: MacOSSandbox): Promise<SystemInfo> {
  const result = await sandbox.execSsh(SYSTEM_INFO_SCRIPT);
  if (result.exitCode !== 0) throw new Error(`Reading system info failed: ${result.stderr || result.stdout}`);
  const fields: Record<string, string> = {};
  for (const line of result.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    fields[trimmed.slice(0, i)] = trimmed.slice(i + 1);
  }
  return {
    product: fields.product ?? "",
    version: fields.version ?? "",
    build: fields.build ?? "",
    hostname: fields.hostname ?? "",
    arch: fields.arch ?? "",
    model: fields.model ?? "",
    cpus: fields.cpus ?? "",
    memBytes: fields.memBytes ?? "",
    uptime: fields.uptime ?? "",
  };
}

interface UiElementNode {
  name?: string | null;
  role?: string;
  description?: string | null;
  role_description?: string;
  value?: unknown;
  enabled?: boolean;
  children?: UiElementNode[];
}

interface UiWindowNode {
  name?: string | null;
  owner: string;
  role: string;
  is_on_screen?: boolean;
  children?: UiElementNode[];
}

interface UiTreeResponse {
  applications?: Array<{ info: { name: string; active: boolean }; windows: unknown[] }>;
  windows?: UiWindowNode[];
}

interface PrunedElement {
  role: string;
  label?: string;
  enabled?: false;
  children?: PrunedElement[];
}

/**
 * Background OS chrome, not app windows a user would ask about. Observed empirically: Notification
 * Center's own panels (widgets like "Tips"/weather, shown even when nothing is actually open) can
 * dwarf the one window that matters in the char budget — e.g. one real Finder window vs. a widget
 * tree of unrelated marketing copy. Dock/Control Center windows are similarly irrelevant chrome.
 */
const SYSTEM_CHROME_OWNERS = new Set(["Notification Center", "Control Center", "Dock", "Window Server"]);

/** role/label/children only — drops ids, geometry, and structural wrappers with nothing in them. */
function pruneElement(node: UiElementNode, depth: number, maxDepth: number): PrunedElement | null {
  const label = node.name || node.description || (typeof node.value === "string" ? node.value : undefined) || undefined;
  const children =
    depth < maxDepth && Array.isArray(node.children)
      ? node.children.map((c) => pruneElement(c, depth + 1, maxDepth)).filter((c): c is PrunedElement => c !== null)
      : [];
  if (!label && children.length === 0) return null;
  const pruned: PrunedElement = { role: node.role_description || node.role || "element" };
  if (label) pruned.label = label;
  if (node.enabled === false) pruned.enabled = false;
  if (children.length) pruned.children = children;
  return pruned;
}

export interface UiSummaryOptions {
  /** Hard cap on the returned JSON string's length. A full tree can run to hundreds of KB. */
  maxChars?: number;
  /** How many levels deep to walk each window's element tree. */
  maxDepth?: number;
}

/**
 * Compact JSON summary of what's on screen — running/frontmost apps, and per on-screen
 * window a pruned accessibility tree (role + label only, no ids/geometry) — meant to be
 * dropped into a generation prompt as context. `sandbox.uiTree()` itself is an untyped,
 * unbounded dump of the native macOS accessibility tree (routinely tens of KB even for an
 * idle desktop), so this always prunes and then hard-caps the result.
 */
export async function uiTreeSummary(sandbox: MacOSSandbox, opts: UiSummaryOptions = {}): Promise<string> {
  const maxChars = opts.maxChars ?? 4000;
  const maxDepth = opts.maxDepth ?? 6;
  const raw = (await sandbox.uiTree()) as UiTreeResponse;

  const apps = (raw.applications ?? [])
    .filter((a) => a.info.active || a.windows.length > 0)
    .map((a) => ({ name: a.info.name, active: a.info.active }));

  const windows = (raw.windows ?? [])
    .filter((w) => w.is_on_screen && w.role === "app" && !SYSTEM_CHROME_OWNERS.has(w.owner))
    .map((w) => ({
      app: w.owner,
      title: w.name || undefined,
      elements: (w.children ?? []).map((c) => pruneElement(c, 0, maxDepth)).filter((c): c is PrunedElement => c !== null),
    }));

  let json = JSON.stringify({ apps, windows });
  if (json.length > maxChars) {
    json = `${json.slice(0, maxChars)}…(truncated, ${json.length} chars total)`;
  }
  return json;
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
