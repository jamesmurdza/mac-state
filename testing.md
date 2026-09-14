# Testing Guide

## Environment Setup
- Package manager: npm (Node 22, ESM project)
- Required env vars (put them in `.env`, loaded by `tests/setup.ts` via Node's `process.loadEnvFile`):
  - `USE_COMPUTER_API_KEY` — use.computer account key (`uc_live_...`)
  - `USE_COMPUTER_RESERVATION_ID` — an active Mac mini reservation; the code never reserves
  - `USE_COMPUTER_BASE_URL` — optional, defaults to `https://api.use.computer`
- Database: none
- Services: use.computer gateway (real macOS VM on the reserved Mac). No mocks anywhere.

## Running Tests

### Unit Tests
Command: `npm run test:unit`
Location: `tests/unit/` — pure functions only, no network.

### E2E Tests (real sandbox)
Command: `npm run test:e2e`
Location: `tests/e2e/`
What it does: creates a sandbox on the reservation, takes a JPEG screenshot, uploads and runs an
AppleScript block with `osascript`, asserts TextEdit is visible with a window, takes a second
screenshot, saves both to `test-results/`, deletes the sandbox. About 20 s end to end.
Missing env vars make the test FAIL (never skip).

### Everything
Command: `npm test` (also run `npm run typecheck`)

## Debugging Failed Tests
- Single file: `npx vitest run tests/e2e/applescript.e2e.test.ts`
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
