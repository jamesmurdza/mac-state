# macOS Computer Use

A Next.js app that drives a real macOS sandbox ([use.computer](https://use.computer)) with a
Claude agent. Type an instruction, and the agent reads the screen, then clicks, types, and presses
keys until it's done — while you watch a live view of the Mac next to the chat.

## Features

- Built on the [Vercel AI SDK](https://sdk.vercel.ai/), giving access to
  [100+ models](https://ai-sdk.dev/providers/ai-sdk-providers) across every major provider
- Drives a real macOS sandbox via mouse, keyboard, and app launching — no shell or scripting shortcuts
- Sees the screen through macOS's accessibility API — no screenshots, no vision model, just a
  JSON tree of on-screen elements
- Live view of the sandbox's screen next to the chat
- Streams tool calls, results, and replies live as the agent works
- Stateless server: sandboxes are created automatically and self-delete after a couple minutes of
  inactivity

## How the agent works

The agent drives the sandbox purely through its GUI, the way a person would. It uses helper
functions built on macOS's accessibility API to read the screen and perform actions. Claude is
given five tools, all bound to the current sandbox:

- `read_accessibility_tree` — a pruned JSON summary of what's on screen, read via the accessibility API
- `open_app` — launch or focus an app and wait for its window
- `click_element` — click something on screen
- `type_text` — type text
- `press_keys` — press a key or a hotkey combo

The system prompt steers it through a simple loop — **look, act, look** — and most action tools
return the updated screen right after acting, so the model rarely needs a separate read in
between. A turn runs for up to 40 tool-calling steps before it's cut off as a runaway guard.

## LLM support

The agent talks to the model through the [Vercel AI SDK](https://sdk.vercel.ai/), which supports
[100+ models](https://ai-sdk.dev/providers/ai-sdk-providers) across every major provider — so
you're not locked into Anthropic.

To change the model:

1. Install the provider's AI SDK package, e.g. `npm install @ai-sdk/openai`.
2. In `src/lib/llm.ts`, change `MODEL_IDS` to the model id(s) you want.
3. In `src/lib/agent.ts`, swap the import and the `model:` line:

   ```ts
   import { openai } from "@ai-sdk/openai";
   // ...
   model: openai(MODEL_IDS[modelChoice]),
   ```

The rest of the code — the tool-calling loop, tool definitions, and streaming — all work the
same regardless of provider.

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
