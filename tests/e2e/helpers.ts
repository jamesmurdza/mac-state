import { mkdirSync, writeFileSync } from "node:fs";
import type { MacOSSandbox } from "use-computer-sdk";
import { afterAll, beforeAll } from "vitest";
import { createSandboxFromEnv, takeScreenshot } from "../../src/sandbox.js";

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** One sandbox per test file: created before the first test, deleted after the last. */
export function useSandbox(): () => MacOSSandbox {
  let sandbox: MacOSSandbox | undefined;
  beforeAll(async () => {
    sandbox = await createSandboxFromEnv();
    console.log(`sandbox ${sandbox.sandboxId} on ${sandbox.host}`);
  });
  afterAll(async () => {
    await sandbox?.close();
  });
  return () => {
    if (!sandbox) throw new Error("sandbox not created yet");
    return sandbox;
  };
}

/** JPEG screenshot saved to test-results/<scenario>/<name>.jpg for eyeballing. */
export async function snap(sandbox: MacOSSandbox, scenario: string, name: string): Promise<Uint8Array> {
  const start = performance.now();
  const bytes = await takeScreenshot(sandbox);
  const dir = `test-results/${scenario}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${name}.jpg`, bytes);
  console.log(`${dir}/${name}.jpg (${bytes.length} bytes, ${((performance.now() - start) / 1000).toFixed(1)}s)`);
  return bytes;
}

export interface ProcessState {
  visible: boolean;
  frontmost: boolean;
  windows: number;
}

/** What System Events says about a running app. Throws if the app is not running. */
export async function processState(sandbox: MacOSSandbox, app: string): Promise<ProcessState> {
  const r = await sandbox.execSsh(
    `osascript -e 'tell application "System Events" to tell process "${app}" to get {visible, frontmost, count of windows}'`,
  );
  if (r.exitCode !== 0) throw new Error(`System Events failed for ${app}: ${r.stderr || r.stdout}`);
  const [visible, frontmost, windows] = r.stdout.trim().split(", ");
  return { visible: visible === "true", frontmost: frontmost === "true", windows: Number(windows) };
}

/** Window titles of a running app, as System Events reports them. */
export async function windowNames(sandbox: MacOSSandbox, app: string): Promise<string> {
  const r = await sandbox.execSsh(`osascript -e 'tell application "System Events" to tell process "${app}" to get name of windows'`);
  return r.stdout.trim();
}

interface UiApp {
  info: { name: string; pid: number; active: boolean; hidden: boolean };
  windows: number[];
}

/** The gateway's UI tree entry for one process (by pid), or undefined when it has no UI presence. */
export async function uiApp(sandbox: MacOSSandbox, pid: number): Promise<UiApp | undefined> {
  const tree = (await sandbox.uiTree()) as { applications?: UiApp[] };
  return tree.applications?.find((a) => a.info?.pid === pid);
}

/** Re-run `fn` every `intervalMs` until `ok(value)` or the deadline; returns the last value either way. */
export async function pollUntil<T>(
  fn: () => Promise<T>,
  ok: (v: T) => boolean,
  timeoutMs = 30_000,
  intervalMs = 2_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = await fn();
  while (!ok(last) && Date.now() < deadline) {
    await sleep(intervalMs);
    last = await fn();
  }
  return last;
}
