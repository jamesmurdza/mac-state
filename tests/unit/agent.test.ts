import { describe, expect, it } from "vitest";
import { AGENT_SYSTEM_PROMPT, MAX_AGENT_STEPS } from "../../src/agent.js";

describe("AGENT_SYSTEM_PROMPT", () => {
  it("names both tools and tells the model how to drive apps", () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/read_accessibility_tree/);
    expect(AGENT_SYSTEM_PROMPT).toMatch(/run_applescript/);
    expect(AGENT_SYSTEM_PROMPT).toMatch(/System Events/);
    expect(AGENT_SYSTEM_PROMPT).toMatch(/activate/);
  });
});

describe("MAX_AGENT_STEPS", () => {
  it("is a sane positive bound", () => {
    expect(MAX_AGENT_STEPS).toBeGreaterThan(1);
    expect(MAX_AGENT_STEPS).toBeLessThanOrEqual(20);
  });
});
