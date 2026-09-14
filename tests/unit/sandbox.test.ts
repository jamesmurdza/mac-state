import { describe, expect, it } from "vitest";
import { screenshotUrl } from "../../src/sandbox.js";

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
