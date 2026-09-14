import { expect, test } from "@playwright/test";

const loaded = (img: HTMLImageElement) => img.complete && img.naturalWidth > 0;

test("prompt → AppleScript → run → fresh screenshot", async ({ page }) => {
  await page.goto("/");
  const shot = page.locator("#screenshot");

  // First load creates the sandbox and fetches the first screenshot.
  await expect.poll(() => shot.evaluate(loaded), { timeout: 60_000 }).toBe(true);
  await expect(page.locator("#sandbox")).toContainText("sb-");
  await expect(page.locator("#status")).toHaveText("idle");
  await expect(page).toHaveScreenshot("initial.png", { mask: [shot, page.locator("#sandbox"), page.locator("#shot-info")] });

  const srcBefore = await shot.getAttribute("src");
  await page.fill("#prompt", "Open TextEdit and put the text 'hello from playwright' in a new document");
  await page.click("#run");
  await expect(page.locator("#status")).toHaveText("thinking…");
  await expect(page.locator("#run")).toBeDisabled();

  await expect(page.locator("#status")).toHaveText("done", { timeout: 120_000 });
  await expect(page.locator("#script")).toContainText("TextEdit");
  await expect(page.locator("#exit-code")).toHaveText("0");
  await expect(page.locator("#run")).toBeEnabled();

  expect(await shot.getAttribute("src")).not.toBe(srcBefore);
  await expect.poll(() => shot.evaluate(loaded), { timeout: 30_000 }).toBe(true);
});

test("a blank prompt is refused without calling the server", async ({ page }) => {
  await page.goto("/");
  await page.click("#run");
  await expect(page.locator("#status")).toHaveText("type a prompt first");
  await expect(page.locator("#status")).toHaveClass(/error/);
});
