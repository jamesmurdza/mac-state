import { describe, expect, it } from "vitest";
import { AGENT_SYSTEM_PROMPT, MAX_AGENT_STEPS } from "../../src/agent.js";

describe("AGENT_SYSTEM_PROMPT", () => {
  it("names the tools and steers toward the semantic ones", () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/read_accessibility_tree/);
    expect(AGENT_SYSTEM_PROMPT).toMatch(/open_app/);
    expect(AGENT_SYSTEM_PROMPT).toMatch(/click_element/);
    expect(AGENT_SYSTEM_PROMPT).toMatch(/set_field_value/);
    expect(AGENT_SYSTEM_PROMPT).toMatch(/run_applescript/);
  });
});

describe("MAX_AGENT_STEPS", () => {
  it("is a sane positive bound", () => {
    expect(MAX_AGENT_STEPS).toBeGreaterThan(1);
    expect(MAX_AGENT_STEPS).toBeLessThanOrEqual(20);
  });
});
