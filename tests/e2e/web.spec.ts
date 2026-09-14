import { expect, test } from "@playwright/test";

test("prompt → AppleScript → run, with the live VNC view connected", async ({ page }) => {
  await page.goto("/");
  const vnc = page.locator("#vnc");

  // First load creates the sandbox and points the viewer at it. #sandbox shows "error: …" if creation fails.
  await expect(page.locator("#sandbox")).toContainText("sb-", { timeout: 60_000 });
  await expect(vnc).toHaveAttribute("src", /\/vnc\?sandbox=sb-/);
  await expect(page.locator("#status")).toHaveText("idle");

  const viewer = page.frameLocator("#vnc");
  await expect(viewer.locator("#status")).toHaveText("Connected", { timeout: 60_000 });
  await expect(viewer.locator("canvas")).toHaveCount(1);
  await expect(page).toHaveScreenshot("initial.png", { mask: [vnc, page.locator("#sandbox")] });

  await page.fill("#prompt", "Open TextEdit and put the text 'hello from playwright' in a new document");
  await page.click("#run");
  await expect(page.locator("#status")).toHaveText("thinking…");
  await expect(page.locator("#run")).toBeDisabled();

  await expect(page.locator("#status")).toHaveText("done", { timeout: 120_000 });
  await expect(page.locator("#script")).toContainText("TextEdit");
  await expect(page.locator("#exit-code")).toHaveText("0");
  await expect(page.locator("#model")).toContainText("claude-");
  await expect(page.locator("#run")).toBeEnabled();
  await expect(viewer.locator("#status")).toHaveText("Connected");
});

test("a blank prompt is refused without calling the server", async ({ page }) => {
  await page.goto("/");
  await page.click("#run");
  await expect(page.locator("#status")).toHaveText("type a prompt first");
  await expect(page.locator("#status")).toHaveClass(/error/);
});
