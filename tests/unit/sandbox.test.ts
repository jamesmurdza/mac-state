import type { MacOSSandbox } from "use-computer-sdk";
import { describe, expect, it } from "vitest";
import { screenshotUrl, uiTreeSummary } from "../../src/sandbox.js";

/** A trimmed real `uiTree()` response: one background app, one real window with nested elements. */
function fakeSandbox(uiTree: unknown): MacOSSandbox {
  return { uiTree: async () => uiTree } as unknown as MacOSSandbox;
}

describe("uiTreeSummary", () => {
  const sample = {
    applications: [
      { info: { name: "Finder", active: false }, windows: [10] },
      { info: { name: "Xcode", active: true }, windows: [38] },
      { info: { name: "universalaccessd", active: false }, windows: [] }, // no windows, not active -> dropped
    ],
    windows: [
      { name: "Unnamed Window", owner: "Finder", role: "app", is_on_screen: true, children: [] },
      {
        name: "Welcome to Xcode",
        owner: "Xcode",
        role: "app",
        is_on_screen: true,
        children: [
          {
            name: null,
            role: "AXGroup",
            description: null,
            value: null,
            enabled: false,
            children: [
              { name: null, role: "AXButton", description: "Close", value: null, enabled: true, children: [] },
              { name: null, role: "AXGroup", description: null, value: null, enabled: true, children: [] }, // empty wrapper -> dropped
            ],
          },
        ],
      },
      { name: "Menubar", owner: "Window Server", role: "menubar", is_on_screen: true, children: [] }, // not role "app" -> dropped
      { name: "Backstop", owner: "Window Server", role: "desktop", is_on_screen: true, children: [] }, // dropped
      { name: "Hidden window", owner: "Finder", role: "app", is_on_screen: false, children: [] }, // off-screen -> dropped
      { name: "Tips", owner: "Notification Center", role: "app", is_on_screen: true, children: [{ name: "unrelated widget copy" }] }, // system chrome -> dropped
    ],
  };

  it("keeps only active or windowed apps, and only on-screen app-role windows", async () => {
    const json = await uiTreeSummary(fakeSandbox(sample));
    const parsed = JSON.parse(json);
    expect(parsed.apps).toEqual([
      { name: "Finder", active: false },
      { name: "Xcode", active: true },
    ]);
    expect(parsed.windows).toHaveLength(2);
    expect(parsed.windows.map((w: { app: string }) => w.app)).toEqual(["Finder", "Xcode"]);
  });

  it("prunes elements to role/label, dropping empty wrappers and geometry", async () => {
    const json = await uiTreeSummary(fakeSandbox(sample));
    const parsed = JSON.parse(json);
    const xcodeWindow = parsed.windows.find((w: { app: string }) => w.app === "Xcode");
    // The outer AXGroup survives only because it has a labeled descendant (the Close button);
    // the sibling empty AXGroup is dropped entirely.
    expect(xcodeWindow.elements).toEqual([
      { role: "AXGroup", enabled: false, children: [{ role: "AXButton", label: "Close" }] },
    ]);
  });

  it("hard-caps the output length, since a real tree can run to hundreds of KB", async () => {
    const json = await uiTreeSummary(fakeSandbox(sample), { maxChars: 40 });
    expect(json.length).toBeGreaterThan(40); // cap + truncation marker
    expect(json).toContain("…(truncated");
  });
});

describe("screenshotUrl", () => {
  it("requests a JPEG at quality 80 by default", () => {
    expect(screenshotUrl("https://api.use.computer", "sb-1")).toBe(
      "https://api.use.computer/v1/sandboxes/sb-1/screenshot/compressed?format=jpeg&quality=80",
    );
  });

  it("passes quality and scale through", () => {
    expect(screenshotUrl("https://api.use.computer", "sb-1", { quality: 60, scale: 0.5 })).toBe(
      "https://api.use.computer/v1/sandboxes/sb-1/screenshot/compressed?format=jpeg&quality=60&scale=0.5",
    );
  });

  it("tolerates a trailing slash on the base URL", () => {
    expect(screenshotUrl("https://api.use.computer/", "sb-1")).toContain("computer/v1/sandboxes/sb-1/");
  });
});
