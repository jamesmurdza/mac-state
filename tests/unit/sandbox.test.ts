import { describe, expect, it } from "vitest";
import { appleScriptCommand, screenshotUrl, UNHIDE_SCRIPT } from "../../src/sandbox.js";

describe("appleScriptCommand", () => {
  const cmd = appleScriptCommand("/tmp/x.applescript");

  it("runs osascript on the uploaded script path", () => {
    expect(cmd).toContain("osascript /tmp/x.applescript");
  });

  it("unhides apps the script launched, since SSH-launched apps come up hidden", () => {
    expect(cmd).toContain(`osascript -e '${UNHIDE_SCRIPT}'`);
    expect(cmd.indexOf("osascript /tmp/x.applescript")).toBeLessThan(cmd.indexOf(UNHIDE_SCRIPT));
  });

  it("preserves the script's own exit code and keeps the unhide step silent", () => {
    expect(cmd).toMatch(/rc=\$\?/);
    expect(cmd).toMatch(/exit \$rc$/);
    expect(cmd).toContain(">/dev/null 2>&1");
  });
});

describe("screenshotUrl", () => {
  it("requests a JPEG at quality 80 by default", () => {
    expect(screenshotUrl("https://api.use.computer", "sb-1")).toBe(
      "https://api.use.computer/v1/sandboxes/sb-1/screenshot/compressed?format=jpeg&quality=80",
    );
  });

  it("passes quality and scale through", () => {
    expect(screenshotUrl("https://api.use.computer", "sb-1", { quality: 60, scale: 0.5 })).toBe(
      "https://api.use.computer/v1/sandboxes/sb-1/screenshot/compressed?format=jpeg&quality=60&scale=0.5",
    );
  });

  it("tolerates a trailing slash on the base URL", () => {
    expect(screenshotUrl("https://api.use.computer/", "sb-1")).toContain("computer/v1/sandboxes/sb-1/");
  });
});
