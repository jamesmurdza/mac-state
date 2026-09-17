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

/** Escape a string for embedding inside an AppleScript double-quoted literal. */
function escapeAppleScript(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

export interface UiActionOptions {
  /** The app/process that owns the element (the window's `app` in uiTreeSummary). */
  app: string;
  /** Element role as shown in the tree (e.g. "button", "text field"); matched loosely. Optional. */
  role?: string;
  /** The element's visible label — matched against its name, description, then value. */
  label: string;
  /** find = locate/wait only; click = AXPress (falls back to click); set = write `value`. */
  action: "find" | "click" | "set";
  /** Value to write for the `set` action. */
  value?: string;
  /** 1-based choice among candidates, used to resolve a prior "ambiguous" result. */
  index?: number;
  /** How long to keep retrying while the element is absent (polling every 0.5s). */
  timeoutSeconds?: number;
}

export interface UiActionResult {
  status: "ok" | "not-found" | "ambiguous" | "error";
  message?: string;
  /** For an ambiguous match: the matching elements, so the model can retry with `index`. */
  candidates?: string[];
}

/**
 * One hardened recursive-search AppleScript, generated per call. It scopes to the front sheet or
 * window of the target process, walks `entire contents` (every descendant, each read inside a
 * try so a flaky element can't abort the search), matches by role (normalized: case-insensitive,
 * "AX" prefix and spaces ignored, substring either way) and by label (exact on name/description/
 * value, else a substring fallback), and returns a structured token: OK/FOUND, NOTFOUND,
 * NOWINDOW, NOPROCESS, `AMBIGUOUS\t<n>` + one candidate per line, or `ERR\t<message>`. Clicks use
 * `perform action "AXPress"` and fall back to `click`. The whole search retries on a poll until
 * the element appears or the timeout elapses.
 */
function uiActionScript(opts: UiActionOptions): string {
  const app = escapeAppleScript(opts.app);
  const role = escapeAppleScript(opts.role ?? "");
  const label = escapeAppleScript(opts.label);
  const value = escapeAppleScript(opts.value ?? "");
  const index = Number.isInteger(opts.index) && (opts.index as number) > 0 ? (opts.index as number) : 0;
  const secs = opts.timeoutSeconds ?? (opts.action === "find" ? 10 : 4);
  const tries = Math.max(1, Math.round(secs / 0.5));
  return `on run
  set _app to "${app}"
  set _role to "${role}"
  set _label to "${label}"
  set _action to "${opts.action}"
  set _value to "${value}"
  set _index to ${index}
  set _tries to ${tries}
  tell application "System Events"
    if not (exists process _app) then return "NOPROCESS"
    try
      set frontmost of process _app to true
    end try
  end tell
  delay 0.2
  set _res to "NOTFOUND"
  repeat _tries times
    set _res to my findAndAct(_app, _role, _label, _action, _value, _index)
    if _res is not "NOTFOUND" and _res is not "NOWINDOW" then return _res
    delay 0.5
  end repeat
  return _res
end run

on findAndAct(_app, _role, _label, _action, _value, _index)
  tell application "System Events"
    tell process _app
      set _win to missing value
      try
        if (exists sheet 1 of window 1) then
          set _win to sheet 1 of window 1
        else if (exists window 1) then
          set _win to window 1
        end if
      end try
      if _win is missing value then return "NOWINDOW"
      set _all to {}
      try
        set _all to entire contents of _win
      end try
      set _exact to {}
      set _loose to {}
      repeat with _i from 1 to (count of _all)
        set _el to item _i of _all
        set _r to ""
        try
          set _r to (role of _el) as text
        end try
        set _nm to ""
        try
          set _nm to (name of _el) as text
        end try
        set _ds to ""
        try
          set _ds to (description of _el) as text
        end try
        set _vv to ""
        try
          set _vv to (value of _el) as text
        end try
        set _roleOk to true
        if _role is not "" then set _roleOk to my roleMatches(_r, _role)
        if _roleOk then
          ignoring case
            if (_nm is _label) or (_ds is _label) or (_vv is _label) then
              set end of _exact to _el
            else if (_label is not "") and ((_nm contains _label) or (_ds contains _label)) then
              set end of _loose to _el
            end if
          end ignoring
        end if
      end repeat
      set _matches to _exact
      if (count of _matches) is 0 then set _matches to _loose
      set _n to (count of _matches)
      if _n is 0 then return "NOTFOUND"
      set _target to missing value
      if _index > 0 then
        if _index > _n then return "ERR" & tab & "index out of range"
        set _target to item _index of _matches
      else if _n is 1 then
        set _target to item 1 of _matches
      else
        set _out to "AMBIGUOUS" & tab & _n
        set _cap to _n
        if _cap > 10 then set _cap to 10
        repeat with _j from 1 to _cap
          set _c to item _j of _matches
          set _cr to ""
          try
            set _cr to (role of _c) as text
          end try
          set _cn to ""
          try
            set _cn to (name of _c) as text
          end try
          if _cn is "" then
            try
              set _cn to (description of _c) as text
            end try
          end if
          set _out to _out & linefeed & (_j as text) & ") " & _cr & " " & _cn
        end repeat
        return _out
      end if
      if _action is "find" then return "FOUND"
      if _action is "set" then
        try
          set value of _target to _value
          return "OK"
        on error errMsg
          return "ERR" & tab & errMsg
        end try
      end if
      try
        perform action "AXPress" of _target
        return "OK"
      on error
        try
          click _target
          return "OK"
        on error errMsg2
          return "ERR" & tab & errMsg2
        end try
      end try
    end tell
  end tell
end findAndAct

on roleMatches(_axRole, _want)
  set a to my normRole(_axRole)
  set b to my normRole(_want)
  if b is "" then return true
  ignoring case
    if a contains b then return true
    if b contains a then return true
  end ignoring
  return false
end roleMatches

on normRole(s)
  set AppleScript's text item delimiters to " "
  set _parts to text items of s
  set AppleScript's text item delimiters to ""
  set s to _parts as text
  set AppleScript's text item delimiters to ""
  ignoring case
    if (count of s) > 2 and (text 1 thru 2 of s) is "ax" then set s to text 3 thru -1 of s
  end ignoring
  return s
end normRole`;
}

/** Parse the structured token returned by uiActionScript into a UiActionResult. */
function parseUiResult(stdout: string): UiActionResult {
  const s = stdout.replace(/\r/g, "").trim();
  if (s === "OK" || s === "FOUND") return { status: "ok" };
  if (s === "NOTFOUND") return { status: "not-found", message: "no matching element found" };
  if (s === "NOWINDOW") return { status: "error", message: "that app has no front window" };
  if (s === "NOPROCESS") return { status: "error", message: "that app isn't running" };
  const [head, ...rest] = s.split("\n");
  if (head.startsWith("AMBIGUOUS")) {
    const n = Number(head.split("\t")[1]) || rest.length;
    return {
      status: "ambiguous",
      message: `${n} elements match — retry with a more specific label, or call again with "index" to pick one`,
      candidates: rest,
    };
  }
  if (head.startsWith("ERR")) return { status: "error", message: head.split("\t")[1] || "error" };
  return { status: "error", message: s || "no result" };
}

/**
 * Locate a UI element by role + label in the front window/sheet of an app and optionally act on
 * it (click or set a value), retrying until it appears. This is the code-side traversal that lets
 * the model say *what* to interact with (from uiTreeSummary) without constructing element paths.
 */
export async function uiAction(sandbox: MacOSSandbox, opts: UiActionOptions): Promise<UiActionResult> {
  const res = await runAppleScript(sandbox, uiActionScript(opts));
  if (!res.stdout.trim() && res.exitCode !== 0) {
    return { status: "error", message: res.stderr.trim() || `osascript exited ${res.exitCode}` };
  }
  return parseUiResult(res.stdout);
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
