import { describe, expect, it } from "vitest";
import { isGone } from "../../src/session.js";

describe("isGone", () => {
  it("is true for the SDK's 404 and 410 errors", () => {
    expect(isGone(new Error("404 /v1/sandboxes/sb-1/exec: not found"))).toBe(true);
    expect(isGone(new Error("410 /v1/sandboxes/sb-1/screenshot: gone"))).toBe(true);
  });

  it("is false for other errors and non-errors", () => {
    expect(isGone(new Error("500 /v1/sandboxes/sb-1/exec: boom"))).toBe(false);
    expect(isGone(new Error("sandbox 404 mentioned later"))).toBe(false);
    expect(isGone("404")).toBe(false);
  });
});
