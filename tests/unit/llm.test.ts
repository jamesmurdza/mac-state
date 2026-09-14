import { describe, expect, it } from "vitest";
import { extractAppleScript, SYSTEM_PROMPT } from "../../src/llm.js";

describe("extractAppleScript", () => {
  it("returns unfenced text trimmed", () => {
    expect(extractAppleScript('\n tell application "Finder" to activate \n')).toBe('tell application "Finder" to activate');
  });

  it("strips a ```applescript fence", () => {
    expect(extractAppleScript('```applescript\nreturn "x"\n```')).toBe('return "x"');
  });

  it("strips a bare ``` fence and ignores prose around it", () => {
    expect(extractAppleScript('Here you go:\n```\nreturn "y"\n```\nDone.')).toBe('return "y"');
  });

  it("returns an empty string for empty input", () => {
    expect(extractAppleScript("   ")).toBe("");
  });
});

describe("SYSTEM_PROMPT", () => {
  it("forbids fences and prose, and tells the model how to type keys", () => {
    expect(SYSTEM_PROMPT).toMatch(/no markdown fences/i);
    expect(SYSTEM_PROMPT).toMatch(/System Events/);
    expect(SYSTEM_PROMPT).toMatch(/activate/);
  });
});
