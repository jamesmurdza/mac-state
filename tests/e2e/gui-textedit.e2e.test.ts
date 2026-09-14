import { describe, expect, it } from "vitest";
import { isJpeg } from "../../src/image.js";
import { runAppleScript } from "../../src/sandbox.js";
import { processState, snap, useSandbox } from "./helpers.js";

const SCENARIO = "gui-textedit";
const SCRIPT = `
tell application "TextEdit"
  activate
  if (count of documents) is 0 then make new document
  set text of front document to "hello from mac-state"
end tell
return "textedit-ready"
`;

describe("TextEdit: launch an app and put text in a window", () => {
  const sandbox = useSandbox();

  it("shows one TextEdit window with the text after the script", async () => {
    const mac = sandbox();
    const before = await snap(mac, SCENARIO, "before");
    expect(isJpeg(before)).toBe(true);

    const result = await runAppleScript(mac, SCRIPT);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("textedit-ready");

    const state = await processState(mac, "TextEdit");
    expect(state.visible).toBe(true);
    expect(state.windows).toBe(1);

    const text = await mac.execSsh(`osascript -e 'tell application "TextEdit" to get text of front document'`);
    expect(text.stdout.trim()).toBe("hello from mac-state");

    const after = await snap(mac, SCENARIO, "after");
    expect(Buffer.from(after).equals(Buffer.from(before))).toBe(false);
  });
});
