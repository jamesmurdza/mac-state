import type { MacOSSandbox } from "use-computer-sdk";
import { createSandboxFromEnv, dismissScreenRecordingPrompt } from "./sandbox.js";

const KEEPALIVE_MS = 30_000;

/** The SDK reports a reaped or deleted sandbox as an Error whose message starts with the HTTP status. */
export function isGone(err: unknown): boolean {
  return err instanceof Error && /^(404|410) /.test(err.message);
}

/**
 * One lazily created sandbox for the life of the server: created on first use, its
 * screen-recording prompt dismissed, kept alive every 30 s, deleted on close().
 * If the gateway says the sandbox is gone, the session forgets it and the next
 * call creates a fresh one.
 */
export class SandboxSession {
  private pending: Promise<MacOSSandbox> | undefined;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly create: () => Promise<MacOSSandbox> = createSandboxFromEnv) {}

  get(): Promise<MacOSSandbox> {
    this.pending ??= this.start().catch((err) => {
      this.forget();
      throw err;
    });
    return this.pending;
  }

  /** Run `fn` against the sandbox; on a 404/410 forget the sandbox so the next call recreates it. */
  async use<T>(fn: (sandbox: MacOSSandbox) => Promise<T>): Promise<T> {
    const sandbox = await this.get();
    try {
      return await fn(sandbox);
    } catch (err) {
      if (isGone(err)) this.forget();
      throw err;
    }
  }

  async close(): Promise<void> {
    const pending = this.pending;
    this.forget();
    if (pending) await pending.then((s) => s.close()).catch(() => {});
  }

  private async start(): Promise<MacOSSandbox> {
    const sandbox = await this.create();
    await dismissScreenRecordingPrompt(sandbox);
    this.timer = setInterval(() => void sandbox.keepalive().catch(() => {}), KEEPALIVE_MS);
    this.timer.unref();
    return sandbox;
  }

  private forget(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.pending = undefined;
  }
}
