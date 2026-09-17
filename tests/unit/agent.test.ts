import { describe, expect, it } from "vitest";
import { AGENT_SYSTEM_PROMPT, MAX_AGENT_STEPS } from "../../src/lib/agent.js";

describe("AGENT_SYSTEM_PROMPT", () => {
  it("names the tools and steers toward the GUI ones", () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/read_accessibility_tree/);
    expect(AGENT_SYSTEM_PROMPT).toMatch(/open_app/);
    expect(AGENT_SYSTEM_PROMPT).toMatch(/click_element/);
    expect(AGENT_SYSTEM_PROMPT).toMatch(/type_text/);
    expect(AGENT_SYSTEM_PROMPT).toMatch(/press_keys/);
  });
});

describe("MAX_AGENT_STEPS", () => {
  it("is a sane positive bound", () => {
    expect(MAX_AGENT_STEPS).toBeGreaterThan(1);
    expect(MAX_AGENT_STEPS).toBeLessThanOrEqual(80);
  });
});
