# mac-state

Experiment: drive a [use.computer](https://use.computer) macOS sandbox with AppleScript and
watch the screen change. Step 1 is a set of E2E scenarios, no web app yet. Each one:
create sandbox → dismiss the screen-recording prompt → screenshot → run an AppleScript block via
`osascript` → verify → screenshot.

| Scenario file (`tests/e2e/`) | What it proves |
|---|---|
| `prompt-dismiss` | Every fresh sandbox shows a screen-recording prompt; `dismissScreenRecordingPrompt()` clicks Allow and it stays gone |
| `gui-textedit` | Launch an app, put text in a document, one window on screen |
| `gui-safari` | `open location` loads a real page, so the VM has network |
| `gui-finder-desktop` | Finder scripting creates a file and opens a window on the Desktop |
| `gui-keystroke` | `activate` makes the app frontmost; System Events `keystroke` and SDK `keyboard.hotkey` both reach it |
| `gui-dialog` | `display dialog` from an SSH-run script shows on screen and gives up on its own |

## Setup

```bash
npm install
```

`.env` (gitignored):

```
USE_COMPUTER_API_KEY=uc_live_...
USE_COMPUTER_RESERVATION_ID=...   # an active Mac mini reservation; the code never reserves
```

## Run

```bash
npm run test:unit   # pure functions, no network
npm run test:e2e    # real sandboxes, ~3 min, writes test-results/<scenario>/*.jpg
```

See [testing.md](testing.md) for details.

## Findings about the sandboxes (npm `use-computer-sdk` 0.1.13, macOS 15.4.1)

1. **Sandbox creation is fast**: about 2 s on the warm pool. SSH user is `lume`, uid 501, console session.
2. **A screen-recording prompt is up on every fresh sandbox, and it breaks GUI automation.**
   "bash is requesting to bypass the system private window picker..." sits mid-screen, owned by
   `UserNotificationCenter`. While it is up: apps launched with AppleScript `activate` come up
   hidden and never become frontmost, System Events keystrokes go to Finder, and it appears in
   every screenshot. `dismissScreenRecordingPrompt()` in `src/sandbox.ts` clicks its Allow button
   through System Events. After that, `activate`, keystrokes and screenshots behave like a normal
   Mac for the life of the sandbox. Call it right after `create()`.
3. **`osascript` over SSH works, including app automation and UI scripting.** `tell application
   "TextEdit"` and System Events `keystroke` run with no permission prompt, so Automation and
   Accessibility are already granted. `sandbox.keyboard.hotkey("cmd+n")` works too.
4. **Full-size PNG screenshots are slow**: 1.6 MB takes 30 to 60 s. Capture inside the VM takes
   0.14 s; the time is transfer out of the gateway at roughly 50 KB/s. A JPEG at quality 80 is
   about 100 KB and arrives in 2 to 4 s. The npm SDK's `takeCompressed()` sends no parameters and
   the gateway then returns PNG, so `takeScreenshot()` calls
   `GET /v1/sandboxes/{id}/screenshot/compressed?format=jpeg&quality=80` directly.
5. **`display dialog` works from SSH** without `tell application "System Events"`. The dialog
   belongs to the `osascript` process, which appears in `uiTree()` with one window while it is up.
   Routing it through System Events instead blocks System Events queries until the dialog closes.
6. **Network and Finder scripting just work**: Safari loads `https://example.com` in about 2 s,
   Finder's `make new file at desktop` and `open (path to desktop)` behave as on a normal Mac.
7. **Idle reaping**: `ephemeral: true` sandboxes are deleted about 2 min after the last activity.
   Keep-alive is one-shot in the npm SDK (`sandbox.keepalive()`), so a long-running server needs its own interval.
