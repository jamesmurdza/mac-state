import { describe, expect, it } from "vitest";
import { runAppleScript } from "../../src/sandbox.js";
import { processState, snap, useSandbox, windowNames } from "./helpers.js";

const SCENARIO = "gui-finder-desktop";
const FILE = "mac-state.txt";
const SCRIPT = `
tell application "Finder"
  make new file at desktop with properties {name:"${FILE}"}
  activate
  open (path to desktop)
end tell
return "ok"
`;

describe("Finder: create a file on the Desktop and open a Finder window on it", () => {
  const sandbox = useSandbox();

  it("creates the file and shows a Finder window titled Desktop", async () => {
    const mac = sandbox();
    const lsBefore = await mac.execSsh("ls ~/Desktop");
    expect(lsBefore.stdout).not.toContain(FILE);
    await snap(mac, SCENARIO, "before");

    const result = await runAppleScript(mac, SCRIPT);
    expect(result.exitCode).toBe(0);

    const lsAfter = await mac.execSsh("ls ~/Desktop");
    expect(lsAfter.stdout).toContain(FILE);

    const state = await processState(mac, "Finder");
    expect(state.visible).toBe(true);
    expect(state.frontmost).toBe(true);
    expect(state.windows).toBeGreaterThanOrEqual(1);
    expect(await windowNames(mac, "Finder")).toContain("Desktop");

    await snap(mac, SCENARIO, "after");
  });
});
