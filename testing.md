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
Location: `tests/e2e/` — one file per scenario (`gui-*.e2e.test.ts`), shared helpers in `tests/e2e/helpers.ts`.
Each file creates its own sandbox on the reservation (`useSandbox()`), screenshots before and after
into `test-results/<scenario>/`, verifies through System Events or `uiTree()`, and deletes the sandbox.
Files run serially (`fileParallelism: false`) because the reservation allows 2 VMs at once.
Whole suite: 5 files, 7 tests, about 2.5 min. Missing env vars make the tests FAIL (never skip).

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
