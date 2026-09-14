import { beforeAll, describe, expect, it } from "vitest";
import { runAppleScript } from "../../src/sandbox.js";
import { processState, sleep, snap, useSandbox } from "./helpers.js";

const SCENARIO = "gui-keystroke";
const SETUP = `
tell application "TextEdit"
  activate
  if (count of documents) is 0 then make new document
end tell
return "ok"
`;
const KEYSTROKE = `
tell application "System Events"
  set frontmost of process "TextEdit" to true
  delay 0.5
  keystroke "n" using command down
end tell
delay 1
return "ok"
`;

describe("Keystrokes: cmd+N reaches TextEdit via System Events and via the SDK keyboard", () => {
  const sandbox = useSandbox();

  beforeAll(async () => {
    const result = await runAppleScript(sandbox(), SETUP);
    expect(result.exitCode).toBe(0);
    await snap(sandbox(), SCENARIO, "before");
  });

  it("`activate` from an SSH script does not bring the app to the front; Finder stays frontmost", async () => {
    const textEdit = await processState(sandbox(), "TextEdit");
    expect(textEdit).toEqual({ visible: true, frontmost: false, windows: 1 });
    expect((await processState(sandbox(), "Finder")).frontmost).toBe(true);
  });

  it("System Events `set frontmost` then `keystroke` opens a second window (Accessibility is granted)", async () => {
    const result = await runAppleScript(sandbox(), KEYSTROKE);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(await processState(sandbox(), "TextEdit")).toEqual({ visible: true, frontmost: true, windows: 2 });
    await snap(sandbox(), SCENARIO, "after-system-events");
  });

  it("SDK keyboard.hotkey opens a third window", async () => {
    await sandbox().keyboard.hotkey("cmd+n");
    await sleep(1_000);
    expect((await processState(sandbox(), "TextEdit")).windows).toBe(3);
    await snap(sandbox(), SCENARIO, "after-sdk-hotkey");
  });
});
