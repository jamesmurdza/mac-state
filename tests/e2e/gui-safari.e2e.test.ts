import { describe, expect, it } from "vitest";
import { runAppleScript } from "../../src/lib/sandbox.js";
import { pollUntil, processState, snap, useSandbox } from "./helpers.js";

const SCENARIO = "gui-safari";
const SCRIPT = `
tell application "Safari"
  activate
  open location "https://example.com"
end tell
return "ok"
`;

describe("Safari: open a URL and let the page load (VM has network)", () => {
  const sandbox = useSandbox();

  it("loads example.com in a visible Safari window", async () => {
    const mac = sandbox();
    await snap(mac, SCENARIO, "before");

    const result = await runAppleScript(mac, SCRIPT);
    expect(result.exitCode).toBe(0);

    const doc = await pollUntil(
      () => mac.execSsh(`osascript -e 'tell application "Safari" to get {URL, name} of front document'`),
      (r) => /Example Domain/.test(r.stdout),
      30_000,
    );
    expect(doc.stdout.trim()).toBe("https://example.com/, Example Domain");

    const state = await processState(mac, "Safari");
    expect(state.visible).toBe(true);
    expect(state.windows).toBeGreaterThanOrEqual(1);

    await snap(mac, SCENARIO, "after");
  });
});
