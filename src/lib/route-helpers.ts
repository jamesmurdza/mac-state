import type { ModelMessage } from "ai";
import { DEFAULT_MODEL_CHOICE, isModelChoice, type ModelChoice } from "./llm";
import type { SandboxDescriptor } from "./sandbox-handle";

export function textField(body: unknown, key: "prompt" | "script"): string {
  if (!body || typeof body !== "object") return "";
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

export function modelField(body: unknown): ModelChoice {
  const value = body && typeof body === "object" ? (body as Record<string, unknown>).model : undefined;
  return isModelChoice(value) ? value : DEFAULT_MODEL_CHOICE;
}

/**
 * `sandbox` is client-supplied, unauthenticated input in this stateless design (the client is the
 * only place a sandbox's identity persists between requests). Shape-validate only — an invalid or
 * partial value is treated as absent, so the caller falls back to creating a fresh sandbox rather
 * than erroring out.
 */
export function sandboxField(body: unknown): SandboxDescriptor | undefined {
  if (!body || typeof body !== "object") return undefined;
  const value = (body as Record<string, unknown>).sandbox;
  if (!value || typeof value !== "object") return undefined;
  const { sandboxId, host, vncUrl } = value as Record<string, unknown>;
  if (typeof sandboxId !== "string" || !sandboxId) return undefined;
  return { sandboxId, host: typeof host === "string" ? host : "", vncUrl: typeof vncUrl === "string" ? vncUrl : "" };
}

/**
 * `history` is client-supplied conversation state (see sandboxField's note — same threat model).
 * Only structurally validated (an array); its contents are trusted to the same degree the rest of
 * this app already trusts a localhost-only caller with the API key embedded in the VNC iframe URL.
 */
export function historyField(body: unknown): ModelMessage[] {
  if (!body || typeof body !== "object") return [];
  const value = (body as Record<string, unknown>).history;
  return Array.isArray(value) ? (value as ModelMessage[]) : [];
}

export const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));
