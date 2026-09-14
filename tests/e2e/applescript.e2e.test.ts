import { mkdirSync, writeFileSync } from "node:fs";
import type { MacOSSandbox } from "use-computer-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isJpeg } from "../../src/image.js";
import { createSandboxFromEnv, runAppleScript, takeScreenshot } from "../../src/sandbox.js";

const SCRIPT = `
tell application "TextEdit"
  activate
  set d to make new document
  set text of d to "hello from mac-state"
end tell
return "textedit-ready"
`;

const OUT_DIR = "test-results";
const timed = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  const start = performance.now();
  const value = await fn();
  console.log(`${label}: ${((performance.now() - start) / 1000).toFixed(1)}s`);
  return value;
};

describe("AppleScript on a use.computer macOS sandbox", () => {
  let sandbox: MacOSSandbox;

  beforeAll(async () => {
    sandbox = await timed("create sandbox", createSandboxFromEnv);
    console.log(`sandbox ${sandbox.sandboxId} on ${sandbox.host}`);
  });

  afterAll(async () => {
    await sandbox?.close();
  });

  it("screenshots before and after running an AppleScript block", async () => {
    const before = await timed("screenshot before", () => takeScreenshot(sandbox));
    expect(isJpeg(before)).toBe(true);

    const result = await timed("run AppleScript", () => runAppleScript(sandbox, SCRIPT));
    console.log("osascript result:", result);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("textedit-ready");

    const state = await sandbox.execSsh(
      `osascript -e 'tell application "System Events" to tell process "TextEdit" to get {visible, count of windows}'`,
    );
    console.log("TextEdit {visible, windows}:", state.stdout.trim());
    expect(state.stdout.trim()).toMatch(/^true, [1-9]/);

    const after = await timed("screenshot after", () => takeScreenshot(sandbox));
    expect(isJpeg(after)).toBe(true);

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(`${OUT_DIR}/before.jpg`, before);
    writeFileSync(`${OUT_DIR}/after.jpg`, after);
    console.log(`saved ${OUT_DIR}/before.jpg (${before.length} bytes) and ${OUT_DIR}/after.jpg (${after.length} bytes)`);

    expect(Buffer.from(after).equals(Buffer.from(before))).toBe(false);
  });
});
