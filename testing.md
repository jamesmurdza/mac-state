# Testing Guide

## Environment Setup
- Package manager: npm (Node 22, ESM project)
- Required env vars (put them in `.env`, loaded by `tests/setup.ts` and `src/server.ts` via Node's `process.loadEnvFile`):
  - `USE_COMPUTER_API_KEY` — use.computer account key (`uc_live_...`)
  - `USE_COMPUTER_RESERVATION_ID` — an active Mac mini reservation; the code never reserves
  - `ANTHROPIC_API_KEY` — Claude, for the integration and Playwright tests and the app itself
  - `USE_COMPUTER_BASE_URL` — optional, defaults to `https://api.use.computer`
- Database: none
- Services: use.computer gateway (real macOS VM on the reserved Mac) and the Anthropic API. No mocks anywhere.
- Only 2 VMs can exist at once on the reservation, so never run two sandbox-creating suites in parallel.

## Running Tests

### Unit Tests
Command: `npm run test:unit`
Location: `tests/unit/` — pure functions and route validation through `app.request()`, no network.

### Integration Tests (real sandbox + real Claude)
Command: `npm run test:int`
Location: `tests/integration/`
- `session.int.test.ts` — `SandboxSession` reuses one sandbox and recreates it after an out-of-band delete.
- `run.int.test.ts` — `POST /api/run` through `app.request()`: Claude writes the script, the sandbox runs it, TextEdit shows the text, `/api/status` reports the sandbox and VNC URL. About 20 s.

### E2E Tests (Playwright, the web page)
Command: `npm run test:e2e:web` (first time on a new OS: `npx playwright test --update-snapshots`)
Setup: `npx playwright install chromium`
Base URL: `http://localhost:3000` — `playwright.config.ts` starts `npx tsx src/server.ts` itself.
Location: `tests/e2e/web.spec.ts`; visual baseline in `tests/e2e/web.spec.ts-snapshots/` (live regions masked).
The spec reaches into the cross-origin noVNC iframe with `frameLocator("#vnc")` and waits for its `#status` to read "Connected".

### Sandbox Scenarios (real sandbox, vitest)
Command: `npm run test:e2e`
Location: `tests/e2e/` — one file per scenario (`gui-*.e2e.test.ts`), shared helpers in `tests/e2e/helpers.ts`.
Each file creates its own sandbox on the reservation (`useSandbox()`), dismisses the screen-recording
prompt, screenshots before and after into `test-results/<scenario>/`, verifies through System Events
or `uiTree()`, and deletes the sandbox. Pass `useSandbox({ dismissPrompt: false })` to keep the prompt.
Files run serially (`fileParallelism: false`) because the reservation allows 2 VMs at once.
Whole suite: 6 files, 10 tests, about 3 min. Missing env vars make the tests FAIL (never skip).

### Everything
Command: `npm test` (unit + integration + sandbox scenarios, serially) then `npm run test:e2e:web`. Also run `npm run typecheck`.

## Debugging Failed Tests
- Single file: `npx vitest run tests/e2e/gui-textedit.e2e.test.ts`
- Playwright headed: `npx playwright test --headed`; traces: `npx playwright show-trace test-results/*/trace.zip`
- Look at `test-results/before.jpg` and `test-results/after.jpg`
- Watch the VM live: log the sandbox's `vncUrl` (contains the API key, so it is not printed by default)
- A sandbox left running is reaped ~2 min after its last API/SSH/VNC activity (`ephemeral: true`)

## Known timings (mm010, macOS 15.4.1)
| Step | Time |
|---|---|
| create sandbox | ~2 s |
| JPEG screenshot (quality 80, ~100 KB) | 2-4 s |
| PNG screenshot via SDK (1.6 MB) | 30-60 s — avoid |
| upload + osascript (TextEdit) | 4-6 s |
