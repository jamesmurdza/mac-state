# mac-state

Experiment: drive a [use.computer](https://use.computer) macOS sandbox with AppleScript and
watch the screen change. Step 1 is a set of E2E scenarios, no web app yet. Each one:
create sandbox → screenshot → run an AppleScript block via `osascript` → verify → screenshot.

| Scenario file (`tests/e2e/`) | What it proves |
|---|---|
| `gui-textedit` | Launch an app, put text in a document, one window on screen |
| `gui-safari` | `open location` loads a real page, so the VM has network |
| `gui-finder-desktop` | Finder scripting creates a file and opens a window on the Desktop |
| `gui-keystroke` | `activate` never brings an app to the front; System Events `set frontmost` + `keystroke` works, and so does the SDK `keyboard.hotkey` |
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
npm run test:e2e    # real sandbox, ~20 s, writes test-results/before.jpg and after.jpg
```

See [testing.md](testing.md) for details.

## Findings about the sandboxes (npm `use-computer-sdk` 0.1.13, macOS 15.4.1)

1. **Sandbox creation is fast**: about 2 s on the warm pool. SSH user is `lume`, uid 501, console session.
2. **`osascript` over SSH works, including app automation.** `tell application "TextEdit"` ran with
   no permission prompt. Exit code and stdout come back through `execSsh`.
3. **Apps launched with `activate` from SSH start hidden.** Dock dot appears, no window on screen,
   System Events reports `visible: false`. A second `activate` does not fix it. What works:
   `open -g -a App` before the script, or after the script
   `tell application "System Events" to set visible of (every process whose visible is false and background only is false) to true`.
   `runAppleScript()` in `src/sandbox.ts` appends that unhide step and keeps the script's exit code.
4. **Full-size PNG screenshots are slow**: 1.6 MB takes 30 to 60 s. Capture inside the VM takes
   0.14 s; the time is transfer out of the gateway at roughly 50 KB/s. A JPEG at quality 80 is
   about 100 KB and arrives in 2 to 4 s. The npm SDK's `takeCompressed()` sends no parameters and
   the gateway then returns PNG, so `takeScreenshot()` calls
   `GET /v1/sandboxes/{id}/screenshot/compressed?format=jpeg&quality=80` directly.
5. **A screen-recording prompt appears after the first capture** ("bash is requesting to bypass the
   system private window picker...") and stays on the desktop, so it shows up in screenshots. Its
   Allow button is at about (959, 439) on the 1920x1080 display.
6. **Idle reaping**: `ephemeral: true` sandboxes are deleted about 2 min after the last activity.
   Keep-alive is one-shot in the npm SDK (`sandbox.keepalive()`), so a long-running server needs its own interval.
7. **`activate` from SSH never makes an app frontmost.** Finder keeps focus, so keystrokes go to
   Finder. `tell application "System Events" to set frontmost of process "X" to true` fixes it.
   Scripts that type or press keys must do this first.
8. **UI scripting is allowed.** System Events `keystroke` works from `osascript` over SSH, so
   Accessibility permission is already granted. `sandbox.keyboard.hotkey("cmd+n")` works too.
9. **`display dialog` works from SSH** without `tell application "System Events"`. The dialog
   belongs to the `osascript` process, which appears in `uiTree()` with one window while it is up.
   Routing it through System Events instead blocks System Events queries until the dialog closes.
10. **Network and Finder scripting just work**: Safari loads `https://example.com` in about 2 s,
    Finder's `make new file at desktop` and `open (path to desktop)` behave as on a normal Mac.
