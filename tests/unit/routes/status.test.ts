import { describe, expect, it, vi } from "vitest";
import { fakeHandle } from "./test-helpers.js";

vi.mock("../../../src/lib/sandbox-handle.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/sandbox-handle.js")>();
  return { ...actual, resolveSandbox: vi.fn() };
});

const { resolveSandbox, toDescriptor } = await import("../../../src/lib/sandbox-handle.js");
const { GET } = await import("../../../src/app/api/status/route.js");

const get = (qs = "") => GET(new Request(`http://localhost/api/status${qs}`));

describe("GET /api/status", () => {
  // mockReset() is called at the top of each test rather than in beforeEach: a beforeEach-scoped
  // reset shifts the microtask timing of a later mockImplementation(async () => { throw ... })
  // enough that Node's unhandled-rejection detector fires before this test's own `await` (which
  // does handle it, via the route's try/catch) gets a chance to -- a Vitest hook-timing quirk, not
  // a real bug. Confirmed empirically: identical rejection, identical route code, passes reliably
  // with an inline reset and fails intermittently with a beforeEach reset.
  it("with no query params, resolves with no descriptor (creates a fresh sandbox)", async () => {
    vi.mocked(resolveSandbox).mockReset();
    const handle = fakeHandle("sb-new");
    vi.mocked(resolveSandbox).mockResolvedValue({ handle, descriptor: toDescriptor(handle) });

    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sandboxId: "sb-new", host: "mm001", vncUrl: "https://gw.example/vnc?sandbox=sb-new" });
    expect(resolveSandbox).toHaveBeenCalledWith(undefined);
  });

  it("with sandboxId/host/vncUrl query params, resolves with that descriptor (attach, not create)", async () => {
    vi.mocked(resolveSandbox).mockReset();
    const handle = fakeHandle("sb-existing");
    vi.mocked(resolveSandbox).mockResolvedValue({ handle, descriptor: toDescriptor(handle) });

    await get("?sandboxId=sb-existing&host=mm002&vncUrl=https%3A%2F%2Fgw%2Fvnc");
    expect(resolveSandbox).toHaveBeenCalledWith({ sandboxId: "sb-existing", host: "mm002", vncUrl: "https://gw/vnc" });
  });

  it("returns 500 with the error message when resolving fails", async () => {
    vi.mocked(resolveSandbox).mockReset();
    vi.mocked(resolveSandbox).mockImplementation(async () => {
      throw new Error("Missing env var USE_COMPUTER_API_KEY");
    });
    const res = await get();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Missing env var USE_COMPUTER_API_KEY" });
  });
});
