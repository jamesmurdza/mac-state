# macOS Computer Use

A Next.js app that drives a real macOS sandbox ([use.computer](https://use.computer)) with a
Claude agent. Type an instruction, and the agent looks at the screen, clicks, types, and presses
keys until it's done — while you watch a live view of the Mac next to the chat.

The app is stateless: the server holds no state between requests. Sandboxes are created
automatically and self-delete after a couple of minutes of inactivity.

## Requirements

- Node.js 22+
- A [use.computer](https://use.computer) API key and an active Mac mini reservation
- An [Anthropic](https://www.anthropic.com/) API key

## Setup

```bash
npm install
```

Create a `.env` file in the project root:

```
USE_COMPUTER_API_KEY=uc_live_...
USE_COMPUTER_RESERVATION_ID=...
ANTHROPIC_API_KEY=sk-ant-...
```

## Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). A sandbox is created automatically on first
load.

For a production build:

```bash
npm run build
npm start
```

## Test

```bash
npm run typecheck    # TypeScript
npm run test:unit    # unit tests, no network
npm run test:int     # integration tests against a real sandbox + Claude
npm run test:e2e     # sandbox scenario tests
npm run test:e2e:web # Playwright, drives the page against a real server
```

See [testing.md](testing.md) for more detail.

## Project structure

```
src/app/            Next.js pages and API routes
src/components/      React UI components
src/lib/             Sandbox handling, the agent loop, and other shared logic
tests/               Unit, integration, and end-to-end tests
tools/               Dev scripts
```

## How the agent works

The agent loop lives in `src/lib/agent.ts` and drives the sandbox purely through its GUI, the way
a person would — there's no shell or scripting shortcut available to it. Claude (via the Vercel AI
SDK) is given five tools bound to the current sandbox: `read_accessibility_tree` (a pruned JSON
summary of what's on screen), `open_app`, `click_element`, `type_text`, and `press_keys`. The
system prompt steers it through a simple loop — **look, act, look** — and most action tools return
the updated screen right after acting, so the model rarely needs a separate read in between. A
turn runs for up to 40 tool-calling steps before it's cut off as a runaway guard.

`streamAgent` runs that loop and yields each tool call, result, and reply chunk as it happens. It
backs `POST /api/stream`, the only route the page's chat UI calls, over a hand-rolled SSE protocol
the client parses with a plain `fetch()` + `ReadableStream` reader — no `EventSource`, no `useChat`.

Because the app is stateless, `streamAgent` doesn't own a sandbox or a conversation the way a
typical chat backend would. Each call takes a `SandboxRef` (a small mutable box holding the current
sandbox handle) and the full prior `history` as plain arguments; every tool call goes through
`withSandbox()`, which retries once against a freshly created sandbox if the gateway reports the
current one gone (timed out or otherwise deleted) — reconnecting is cheap because
`attachSandbox(sandboxId)` rebuilds a working handle from just the id, with no network call, since
the gateway's own API only ever needs the id in the URL path. Every event the agent emits carries
the sandbox it's currently using and, once done, the full updated conversation, so the client (the
only place any of this is actually remembered) can just replace its local copy wholesale rather
than track diffs.
