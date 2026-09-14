# mac-state web app — design

Date: 2026-09-14. Status: approved in conversation (stack, flow, lifecycle, tests).

**Amendment (same day):** the screenshot image was replaced by an embedded noVNC `<iframe>` of the
gateway's own viewer (`sandbox.vncUrl`), which is embeddable (no framing headers). Live view, no
refresh cycle, and manual mouse/keyboard on the Mac. `GET /api/screenshot` was removed from the app;
`takeScreenshot()` remains for the sandbox scenario tests. The API key travels in the viewer URL,
acceptable for localhost only.

## Purpose

A local test page for a use.computer macOS sandbox: see the screen, type what you want done,
Claude writes AppleScript, the sandbox runs it, the screen refreshes. Not an agent: one prompt,
one script, one run. The point is to learn how the sandboxes behave.

## Architecture

- **Node 22 + TypeScript (ESM)**, `tsx` runs the server. `hono` + `@hono/node-server` for routing
  and static files. `@anthropic-ai/sdk` for Claude. `use-computer-sdk` for the sandbox.
- One process, one sandbox. `SandboxSession` creates the sandbox lazily on the first API call,
  dismisses the screen-recording prompt, pings `keepalive()` every 30 s, deletes it on SIGINT or
  SIGTERM. If the gateway reports the sandbox gone (`404`/`410` in the SDK error), the session
  forgets it and the next call creates a new one.
- The page is one static HTML file with vanilla JS.

## Components

| File | Responsibility |
|---|---|
| `src/llm.ts` | `generateAppleScript(prompt)`: system prompt with the sandbox rules, one non-streaming `messages.create` on `claude-opus-5`, refusal and truncation surfaced as errors, `extractAppleScript()` strips code fences defensively |
| `src/session.ts` | `SandboxSession`: lazy create + prompt dismissal + keepalive + recreate-on-gone + close; `isGone(err)` |
| `src/app.ts` | `createApp({ session, generate })` → Hono app with the routes below |
| `src/server.ts` | loads `.env`, wires real deps, listens on `PORT` (3000), closes the sandbox on shutdown |
| `public/index.html` | the page |
| existing `src/sandbox.ts` | `createSandboxFromEnv`, `dismissScreenRecordingPrompt`, `runAppleScript`, `takeScreenshot` |

## Routes

| Route | Response |
|---|---|
| `GET /` | `public/index.html` |
| `GET /api/status` | `{ sandboxId, host, vncUrl }` — creates the sandbox if needed |
| `GET /api/screenshot` | `image/jpeg` (quality 80, ~100 KB), `Cache-Control: no-store` |
| `POST /api/run` `{ prompt }` | `{ script, stdout, stderr, exitCode }`; `400 { error }` on missing prompt; `502 { error }` when Claude fails or declines; `500 { error }` on sandbox failure |

## Data flow

1. Page loads → `GET /api/status` fills the header → `GET /api/screenshot?t=…` fills the image.
2. User types a prompt, presses Run (or Ctrl+Enter) → `POST /api/run`.
3. Server: `generate(prompt)` → `runAppleScript(sandbox, script)` → JSON back.
4. Page shows script, stdout, stderr, exit code, then reloads the image with a new cache-buster.
5. Refresh button reloads the image any time.

## Error handling

- Missing prompt → 400 shown in the status line.
- Claude refusal (`stop_reason: "refusal"`) or cut-off (`max_tokens`) → 502 with the reason.
- osascript failure → 200 with non-zero `exitCode` and `stderr` shown in red; the screenshot still refreshes.
- Sandbox gone → 500 once, next call recreates the sandbox.
- Server startup does not touch the sandbox, so the page always loads.

## Testing (no mocks, real services)

- Unit (`tests/unit/`): `extractAppleScript`, `isGone`, `/api/run` validation and `GET /` through `app.request()` (deps are the real objects, never invoked on these paths).
- Integration (`tests/integration/`): `SandboxSession` against a real sandbox (same sandbox twice, recreate after an out-of-band close); `POST /api/run` through `app.request()` with real Claude and a real sandbox, then verify TextEdit state on the sandbox.
- E2E (`tests/e2e/web.spec.ts`, Playwright): real server, real everything. Load page, screenshot appears, type prompt, run, script and exit code shown, screenshot reloads. One masked visual snapshot of the initial layout.
- Existing sandbox scenarios (`tests/e2e/*.e2e.test.ts`) stay as they are.

## Out of scope

Multi-turn agent loops, streaming, auth, deployment, more than one sandbox, choosing models in the UI.
