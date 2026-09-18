import { describe, expect, it } from "vitest";
import { attachSandbox, createSandbox, toDescriptor, withSandbox, type SandboxRef } from "../../src/lib/sandbox-handle.js";

describe("sandbox-handle against a real sandbox", () => {
  it("attachSandbox() reconnects using nothing but the sandbox id -- no host/vncUrl needed", async () => {
    // This is the load-bearing claim the whole stateless port rests on: MacOSSandbox's own methods
    // (verified by reading use-computer-sdk's compiled source) only ever address
    // `${baseUrl}/v1/sandboxes/{id}/...`, never sshUrl/vmIp/host, so a bare id is enough to rebuild
    // a fully working handle with zero network calls at construction time.
    const created = await createSandbox();
    try {
      const bareAttach = attachSandbox({ sandboxId: created.sandboxId, host: "", vncUrl: "" });
      expect((await bareAttach.execSsh("echo hi")).stdout.trim()).toBe("hi");
    } finally {
      await created.close();
    }
  });

  it("withSandbox recreates the sandbox once the gateway reports the old one gone", async () => {
    const first = await createSandbox();
    const ref: SandboxRef = { current: first };

    await first.close(); // out-of-band deletion, as the idle reaper would do

    const result = await withSandbox(ref, (s) => s.execSsh("echo again"));

    try {
      expect(result.stdout.trim()).toBe("again");
      // ref.current is the single source of truth for "which sandbox did this end up using" --
      // no separate rotation-notification callback to check.
      expect(ref.current.sandboxId).not.toBe(first.sandboxId);
      // The new handle is independently reconnectable by id too.
      const reattached = attachSandbox(toDescriptor(ref.current));
      expect((await reattached.execSsh("echo once more")).stdout.trim()).toBe("once more");
    } finally {
      await ref.current.close();
    }
  });
});
