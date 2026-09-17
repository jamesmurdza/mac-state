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
