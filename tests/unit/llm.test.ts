import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_CHOICE, isModelChoice, MODEL_IDS } from "../../src/lib/llm.js";

describe("model choices", () => {
  it("maps every choice to a claude-* model id", () => {
    for (const id of Object.values(MODEL_IDS)) expect(id).toMatch(/^claude-/);
  });

  it("defaults to a valid choice", () => {
    expect(isModelChoice(DEFAULT_MODEL_CHOICE)).toBe(true);
  });

  it("accepts only the three known choices", () => {
    expect(isModelChoice("opus")).toBe(true);
    expect(isModelChoice("sonnet")).toBe(true);
    expect(isModelChoice("haiku")).toBe(true);
    expect(isModelChoice("gpt")).toBe(false);
    expect(isModelChoice(undefined)).toBe(false);
  });
});
