/** The model choices exposed in the web UI's dropdown. */
export type ModelChoice = "opus" | "sonnet" | "haiku";

export const MODEL_IDS: Record<ModelChoice, string> = {
  opus: "claude-opus-5",
  sonnet: "claude-sonnet-5",
  haiku: "claude-haiku-4-5",
};

export const DEFAULT_MODEL_CHOICE: ModelChoice = "haiku";

export function isModelChoice(value: unknown): value is ModelChoice {
  return value === "opus" || value === "sonnet" || value === "haiku";
}
