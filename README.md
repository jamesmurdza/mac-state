# mac-state

Experiment: drive a [use.computer](https://use.computer) macOS sandbox with a Claude agent and
watch the screen change. A one-page Next.js app: type what the Mac should do, and the agent (via
the Vercel AI SDK) works the task on the sandbox — inspecting the accessibility tree and driving
the GUI through tool calls, looping until it's done — while you watch it live.

```bash
npm run dev          # http://localhost:3000 — a sandbox is created automatically on first load
```

The page embeds the gateway's noVNC viewer, so you watch the agent work live and can click and
type in the Mac yourself. Next to it, the chat shows each tool call as a collapsible line and the
agent's final reply.

**Stateless by design**: the Next.js server holds no state between requests — no in-memory
sandbox handle, no running conversation. The browser holds the current sandbox's connection info
and the full message history, resending both with every request; the server rebuilds a working
sandbox handle from just the id it's given (see finding 7 below) and, if that sandbox has since
timed out, transparently creates a fresh one and reports it back. This means closing the tab (or
just leaving it idle) is enough to let a sandbox clean itself up — there's no explicit shutdown
hook, and a page refresh starts a new conversation against a new sandbox. Design and plan (for the
pre-port Hono implementation, kept for history):
[docs/specs](docs/specs/2026-09-14-web-app-design.md), [docs/plans](docs/plans/2026-09-14-web-app.md).

Before the web app came a set of sandbox E2E scenarios that establish how the VMs behave. Each one:
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
ANTHROPIC_API_KEY=sk-ant-...      # for the web app's AppleScript generation
```

## Run

```bash
npm run dev              # the web app in dev mode
npm run build && npm start  # production build + serve
npm run test:unit        # pure functions + route handlers (mocked deps), no network
npm run test:int         # sandbox-handle reconnect/rotation + the /api/run path with real Claude and a real sandbox
npm run test:e2e         # sandbox scenarios, ~3 min, writes test-results/<scenario>/*.jpg
npm run test:e2e:web     # Playwright drives the page against a real server
```

See [testing.md](testing.md) for details.

## Findings about the sandboxes (npm `use-computer-sdk` 0.1.13, macOS 15.4.1)

1. **Sandbox creation is fast**: about 2 s on the warm pool. SSH user is `lume`, uid 501, console session.
2. **A screen-recording prompt is up on every fresh sandbox, and it breaks GUI automation.**
   "bash is requesting to bypass the system private window picker..." sits mid-screen, owned by
   `UserNotificationCenter`. While it is up: apps launched with AppleScript `activate` come up
   hidden and never become frontmost, System Events keystrokes go to Finder, and it appears in
   every screenshot. `dismissScreenRecordingPrompt()` in `src/lib/sandbox.ts` clicks its Allow
   button through System Events. After that, `activate`, keystrokes and screenshots behave like a
   normal Mac for the life of the sandbox. Call it right after `create()`.
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
7. **Idle reaping — leaned into, not fought.** `ephemeral: true` sandboxes are deleted about 2 min
   after the last activity. The app used to run its own 30 s keepalive interval to suppress this;
   the stateless port drops that entirely and lets sandboxes actually die on schedule, since
   `src/lib/sandbox-handle.ts`'s `withSandbox()` transparently creates a fresh one and retries
   whenever the gateway answers 404 or 410. This only works because `MacOSSandbox`'s methods
   (verified against the SDK's compiled source) address `${baseUrl}/v1/sandboxes/{id}/...` using
   nothing but the sandbox id — `attachSandbox(descriptor)` rebuilds a fully working handle from an
   id alone, with zero network calls, so "reconnecting" after a timeout is just a local object
   construction, not a round trip.
8. **The hosted noVNC viewer can be embedded.** `sandbox.vncUrl` points at a small noVNC page on
   the gateway with no `X-Frame-Options` or CSP, so an `<iframe>` gives a live, interactive view
   (viewport scaling, mouse and keyboard). The URL's `token` is the account API key, so this is for
   a localhost/trusted deployment only — see the security note in `src/lib/route-helpers.ts`. Being
   connected also counts as activity, which keeps the sandbox alive for as long as it's open.
9. **Claude Opus 5 declines "automate this Mac" prompts** under its cyber classifier
   (`stop_reason: "refusal"`, category `cyber`). The request opts into server-side fallbacks
   (`fallbacks: "default"` with the `server-side-fallback-2026-07-01` beta), so the API re-runs a
   declined prompt on the recommended fallback model in the same call. In practice every run so far
   was served by `claude-opus-4-8`; the page shows which model wrote the script.
