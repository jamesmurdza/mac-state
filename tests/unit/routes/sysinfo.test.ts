import { describe, expect, it, vi } from "vitest";
import { fakeHandle } from "./test-helpers.js";

vi.mock("../../../src/lib/sandbox-handle.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/sandbox-handle.js")>();
  return { ...actual, resolveSandbox: vi.fn() };
});
vi.mock("../../../src/lib/sandbox.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/sandbox.js")>();
  return { ...actual, systemInfo: vi.fn() };
});

const { resolveSandbox, toDescriptor } = await import("../../../src/lib/sandbox-handle.js");
const { systemInfo } = await import("../../../src/lib/sandbox.js");
const { GET } = await import("../../../src/app/api/sysinfo/route.js");

const SYSINFO = {
  product: "macOS",
  version: "15.4.1",
  build: "24E263",
  hostname: "mac-1",
  arch: "arm64",
  model: "Mac16,1",
  cpus: "8",
  memBytes: "17179869184",
  uptime: "up 1 day",
};

// mockReset() is called at the top of each test rather than in beforeEach -- see the comment in
// status.test.ts for why (a Vitest hook-timing quirk with beforeEach-scoped resets ahead of a
// mockImplementation(async () => { throw ... })).
describe("GET /api/sysinfo", () => {
  it("resolves a sandbox, reads system info over SSH, and echoes the sandbox descriptor", async () => {
    vi.mocked(resolveSandbox).mockReset();
    vi.mocked(systemInfo).mockReset();
    const handle = fakeHandle("sb-1");
    vi.mocked(resolveSandbox).mockResolvedValue({ handle, descriptor: toDescriptor(handle) });
    vi.mocked(systemInfo).mockResolvedValue(SYSINFO);

    const res = await GET(new Request("http://localhost/api/sysinfo"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...SYSINFO, sandbox: toDescriptor(handle) });
  });

  it("returns 500 with the error message on failure", async () => {
    vi.mocked(resolveSandbox).mockReset();
    vi.mocked(systemInfo).mockReset();
    vi.mocked(resolveSandbox).mockImplementation(async () => {
      throw new Error("boom");
    });
    const res = await GET(new Request("http://localhost/api/sysinfo"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "boom" });
  });
});
