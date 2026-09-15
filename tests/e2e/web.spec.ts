import { expect, test } from "@playwright/test";

const RAW_SCRIPT = [
  'tell application "TextEdit"',
  "\tactivate",
  "\tif (count of documents) is 0 then make new document",
  '\tset text of front document to "hello from playwright, sent as a ready-made script"',
  "end tell",
  'log "this line goes to stderr"',
  'return "opened TextEdit"',
].join("\n");

async function waitForSandbox(page: import("@playwright/test").Page) {
  // First load creates the sandbox and points the viewer at it. #sandbox shows "error: …" if creation fails.
  await expect(page.locator("#sandbox")).toContainText("sb-", { timeout: 90_000 });
  await expect(page.locator("#vnc")).toHaveAttribute("src", /\/vnc\?sandbox=sb-/);
  await expect(page.locator("#status")).toHaveText("idle");
}

test("send a ready-made AppleScript: no Claude, real sandbox, everything rendered", async ({ page }) => {
  await page.goto("/");
  const vnc = page.locator("#vnc");
  await waitForSandbox(page);

  // Layout: prompt sits under the view; the right column holds exactly two boxes, output empty at first.
  const viewBox = await vnc.boundingBox();
  const promptBox = await page.locator("#prompt").boundingBox();
  expect(promptBox!.y).toBeGreaterThan(viewBox!.y + viewBox!.height);
  await expect(page.locator(".console .result")).toHaveCount(2);
  await expect(page.locator("#stdout-box")).toBeHidden();
  await expect(page.locator("#stderr-box")).toBeHidden();

  const viewer = page.frameLocator("#vnc");
  await expect(viewer.locator("#status")).toHaveText("Connected", { timeout: 60_000 });
  await expect(page).toHaveScreenshot("initial.png", { mask: [vnc, page.locator("#sandbox")] });

  await page.check("#raw");
  await page.fill("#prompt", RAW_SCRIPT);
  await page.press("#prompt", "Enter");
  await expect(page.locator("#status")).toHaveText("running…");
  await expect(page.locator("#send")).toBeDisabled();

  await expect(page.locator("#status")).toHaveText("done", { timeout: 60_000 });
  await expect(page.locator("#model")).toHaveText("none (script sent as-is)");
  await expect(page.locator("#script")).toContainText("hello from playwright");
  await expect(page.locator("#script .hljs-keyword").first()).toBeVisible();
  // Code is shown as written: 4-column tabs, no wrapping, horizontal scroll instead.
  await expect(page.locator("#script")).toHaveCSS("tab-size", "4");
  await expect(page.locator("#script")).toHaveCSS("white-space", "pre");
  await expect(page.locator("#script")).toHaveCSS("overflow-x", "auto");

  // Both streams carried something, so both sub-boxes render.
  await expect(page.locator("#exit-code")).toHaveText("0");
  await expect(page.locator("#stdout-box")).toBeVisible();
  await expect(page.locator("#stdout")).toHaveText(/opened TextEdit/);
  await expect(page.locator("#stderr-box")).toBeVisible();
  await expect(page.locator("#stderr")).toHaveText(/this line goes to stderr/);
  await expect(page.locator("#send")).toBeEnabled();
  await expect(page.locator("#prompt")).toHaveValue("");
  await expect(page).toHaveScreenshot("after-run.png", { mask: [vnc, page.locator("#sandbox")] });
});

test("Enter sends a prompt to Claude, which writes the script (needs API credits)", async ({ page }) => {
  await page.goto("/");
  await waitForSandbox(page);

  await page.fill("#prompt", "Open TextEdit and put the text 'hello from playwright' in a new document");
  await page.press("#prompt", "Enter");
  await expect(page.locator("#status")).toHaveText("thinking…");
  await expect(page.locator("#status")).toHaveText("done", { timeout: 120_000 });
  await expect(page.locator("#model")).toContainText("claude-");
  await expect(page.locator("#script")).toContainText("TextEdit");
  await expect(page.locator("#exit-code")).toHaveText("0");
  await expect(page.locator("#stdout-box")).toBeVisible();
  await expect(page.locator("#stderr-box")).toBeHidden();
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
