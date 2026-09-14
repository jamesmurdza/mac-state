import { afterAll, describe, expect, it } from "vitest";
import { SandboxSession } from "../../src/session.js";

describe("SandboxSession against a real sandbox", () => {
  const session = new SandboxSession();
  afterAll(() => session.close());

  it("creates one sandbox and reuses it", async () => {
    const a = await session.get();
    const b = await session.get();
    expect(b.sandboxId).toBe(a.sandboxId);
    expect((await session.use((s) => s.execSsh("echo hi"))).stdout.trim()).toBe("hi");
  });

  it("recreates the sandbox after the gateway reports it gone", async () => {
    const first = await session.get();
    await first.close(); // out-of-band deletion, as the idle reaper would do
    await expect(session.use((s) => s.execSsh("true"))).rejects.toThrow(/^(404|410) /);
    const second = await session.get();
    expect(second.sandboxId).not.toBe(first.sandboxId);
    expect((await session.use((s) => s.execSsh("echo again"))).stdout.trim()).toBe("again");
  });
});
