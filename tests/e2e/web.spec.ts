import { expect, test } from "@playwright/test";

test("Enter sends the prompt, the script is highlighted, only captured output boxes render", async ({ page }) => {
  await page.goto("/");
  const vnc = page.locator("#vnc");

  // First load creates the sandbox and points the viewer at it. #sandbox shows "error: …" if creation fails.
  await expect(page.locator("#sandbox")).toContainText("sb-", { timeout: 90_000 });
  await expect(vnc).toHaveAttribute("src", /\/vnc\?sandbox=sb-/);
  await expect(page.locator("#status")).toHaveText("idle");

  // Layout: prompt sits under the view; the right column holds exactly two boxes.
  const viewBox = await vnc.boundingBox();
  const promptBox = await page.locator("#prompt").boundingBox();
  expect(promptBox!.y).toBeGreaterThan(viewBox!.y + viewBox!.height);
  await expect(page.locator(".console .result")).toHaveCount(2);
  await expect(page.locator("#stdout-box")).toBeHidden();
  await expect(page.locator("#stderr-box")).toBeHidden();

  const viewer = page.frameLocator("#vnc");
  await expect(viewer.locator("#status")).toHaveText("Connected", { timeout: 60_000 });
  await expect(page).toHaveScreenshot("initial.png", { mask: [vnc, page.locator("#sandbox")] });

  await page.fill("#prompt", "Open TextEdit and put the text 'hello from playwright' in a new document");
  await page.press("#prompt", "Enter");
  await expect(page.locator("#status")).toHaveText("thinking…");
  await expect(page.locator("#send")).toBeDisabled();

  await expect(page.locator("#status")).toHaveText("done", { timeout: 120_000 });
  await expect(page.locator("#script")).toContainText("TextEdit");
  await expect(page.locator("#script .hljs-keyword").first()).toBeVisible();
  // Code is shown as written: 4-column tabs, no wrapping, horizontal scroll instead.
  await expect(page.locator("#script")).toHaveCSS("tab-size", "4");
  await expect(page.locator("#script")).toHaveCSS("white-space", "pre");
  await expect(page.locator("#script")).toHaveCSS("overflow-x", "auto");
  await expect(page.locator("#exit-code")).toHaveText("0");
  await expect(page.locator("#model")).toContainText("claude-");
  await expect(page.locator("#stdout-box")).toBeVisible();
  await expect(page.locator("#stderr-box")).toBeHidden();
  await expect(page.locator("#send")).toBeEnabled();
  await expect(page.locator("#prompt")).toHaveValue("");
});

test("Ctrl+Enter inserts a newline; Enter on a blank prompt is refused without calling the server", async ({ page }) => {
  await page.goto("/");
  await page.fill("#prompt", "line one");
  await page.press("#prompt", "Control+Enter");
  await expect(page.locator("#prompt")).toHaveValue("line one\n");
  await expect(page.locator("#status")).toHaveText("idle");

  await page.fill("#prompt", "   ");
  await page.press("#prompt", "Enter");
  await expect(page.locator("#status")).toHaveText("type a prompt first");
  await expect(page.locator("#status")).toHaveClass(/error/);
});
