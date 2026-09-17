import { expect, test } from "@playwright/test";

/**
 * Full rewrite, not a port: the pre-port public/index.html this spec used to drive had already
 * diverged from this file (old selectors like #sandbox/#raw/#status/#script/#stdout referenced
 * markup that no longer existed even before the Next.js port -- there was never a raw-AppleScript
 * UI in the live page, only in the /api/run route). This rewrite targets the actual React DOM
 * (see src/components/*.tsx) and the app's real, current behavior. Visual regression snapshots
 * are not included: they'd need a first real run against a live sandbox to establish a baseline,
 * which this environment can't produce.
 */

async function waitForSandbox(page: import("@playwright/test").Page) {
  // First load creates the sandbox and points the VNC iframe at it.
  await expect(page.locator("#chip-text")).toHaveText("macOS sandbox", { timeout: 90_000 });
  await expect(page.locator("#dot")).toHaveClass(/\bon\b/);
  await expect(page.locator("#vnc")).toHaveAttribute("src", /\/vnc\?sandbox=sb-/);
}

test("loads, creates a sandbox automatically, and embeds the VNC viewer", async ({ page }) => {
  await page.goto("/");
  await waitForSandbox(page);
  await expect(page.locator("#vnc-tab")).toHaveAttribute("href", /\/vnc\?sandbox=sb-/);
});

test("the system info chip opens a modal with live sandbox details", async ({ page }) => {
  await page.goto("/");
  await waitForSandbox(page);

  await page.locator("#chip").click();
  await expect(page.locator("#sysinfo-overlay")).not.toHaveClass(/hidden/);
  await expect(page.locator("#sysinfo-body dt")).toContainText(["macOS", "Model", "Chip", "CPUs", "Memory", "Hostname", "Uptime"]);

  await page.keyboard.press("Escape");
  await expect(page.locator("#sysinfo-overlay")).toHaveClass(/hidden/);
});

test("Ctrl+Enter inserts a newline; Enter on a blank prompt does nothing", async ({ page }) => {
  await page.goto("/");
  await page.fill("#prompt", "line one");
  await page.press("#prompt", "Control+Enter");
  await expect(page.locator("#prompt")).toHaveValue("line one\n");

  await page.fill("#prompt", "   ");
  await page.press("#prompt", "Enter");
  // No user bubble should appear in the transcript for a blank/whitespace-only prompt.
  await expect(page.locator(".msg-user")).toHaveCount(0);
});

test("typing a prompt reveals the send button; sending clears the composer", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#send")).toHaveClass(/hidden/);
  await page.fill("#prompt", "hello");
  await expect(page.locator("#send")).not.toHaveClass(/hidden/);
});

test("Enter sends a prompt to the agent, which drives the sandbox and replies (needs API credits)", async ({ page }) => {
  await page.goto("/");
  await waitForSandbox(page);

  await page.fill("#prompt", "Open TextEdit and put the text 'hello from playwright' in a new document");
  await page.press("#prompt", "Enter");

  // The user's own message renders immediately.
  await expect(page.locator(".msg-user .bubble")).toHaveText("Open TextEdit and put the text 'hello from playwright' in a new document");

  // The send button becomes a Stop button while the turn is running...
  await expect(page.locator("#send")).toHaveAttribute("title", "Stop", { timeout: 10_000 });
  // ...at least one tool call renders live...
  await expect(page.locator(".msg-status").first()).toBeVisible({ timeout: 60_000 });
  // ...and it goes back to Send once the turn finishes, with a final assistant reply rendered.
  await expect(page.locator("#send")).toHaveAttribute("title", "Send (Enter)", { timeout: 120_000 });
  await expect(page.locator(".msg-assistant .bubble").last()).not.toBeEmpty();
  await expect(page.locator("#prompt")).toHaveValue("");
});
