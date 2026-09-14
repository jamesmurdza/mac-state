import { describe, expect, it } from "vitest";
import { dismissScreenRecordingPrompt, takeScreenshot } from "../../src/sandbox.js";
import { processState, snap, useSandbox } from "./helpers.js";

const SCENARIO = "prompt-dismiss";
const OWNER = "UserNotificationCenter";

describe("Screen-recording prompt: present on a fresh sandbox, dismissed by the helper", () => {
  const sandbox = useSandbox({ dismissPrompt: false });

  it("is on screen at sandbox start, owned by UserNotificationCenter with an Allow button", async () => {
    const mac = sandbox();
    expect((await processState(mac, OWNER)).windows).toBe(1);
    const buttons = await mac.execSsh(
      `osascript -e 'tell application "System Events" to tell process "${OWNER}" to get name of every button of window 1'`,
    );
    expect(buttons.stdout.trim()).toBe("Allow, Open System Settings");
    await snap(mac, SCENARIO, "before");
  });

  it("dismissScreenRecordingPrompt clicks Allow, the window goes away, and it does not return", async () => {
    const mac = sandbox();
    expect(await dismissScreenRecordingPrompt(mac)).toBe(true);
    expect((await processState(mac, OWNER)).windows).toBe(0);

    await takeScreenshot(mac);
    await takeScreenshot(mac);
    expect((await processState(mac, OWNER)).windows).toBe(0);
    await snap(mac, SCENARIO, "after");
  });

  it("is a no-op when there is nothing to dismiss", async () => {
    expect(await dismissScreenRecordingPrompt(sandbox())).toBe(false);
  });
});
