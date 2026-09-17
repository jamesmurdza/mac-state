"use client";

import type { SandboxDescriptor } from "./sandbox-handle";

/**
 * Memoized for the life of the page: the first caller triggers `GET /api/status` (which creates a
 * sandbox); every caller after that -- including ones that arrive after it's already settled --
 * shares the exact same promise instead of making their own request.
 *
 * This is what actually prevents two independent sandbox creations racing each other, not just a
 * UI-level convention like a disabled button: anything that needs a sandbox before one is known
 * (the initial page load, or a chat message sent before that load finishes) awaits this directly,
 * so there is only ever one in-flight "create a sandbox" request for the whole page, by
 * construction, regardless of how many places end up calling this.
 *
 * It's also safe under React Strict Mode's dev-mode double-invoked effects with no cancellation
 * bookkeeping needed: calling this twice just attaches two `.then()`s to the same promise -- no
 * second fetch -- and a Promise is fine to have multiple consumers, unlike re-running an effect
 * body. (An earlier version of the code that called `/api/status` directly from a `useEffect`
 * needed a guard ref *and* had a real bug where a leftover `cancelled` flag from that ref-guard
 * orphaned the fetch's result; this sidesteps that whole class of mistake.)
 *
 * On failure, the memo is cleared so the *next* call gets a fresh attempt rather than being
 * permanently wedged on one failed request.
 */
let initialSandbox: Promise<SandboxDescriptor> | null = null;

export function ensureInitialSandbox(): Promise<SandboxDescriptor> {
  if (!initialSandbox) {
    initialSandbox = fetch("/api/status")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        return data as SandboxDescriptor;
      })
      .catch((err) => {
        initialSandbox = null;
        throw err;
      });
  }
  return initialSandbox;
}
