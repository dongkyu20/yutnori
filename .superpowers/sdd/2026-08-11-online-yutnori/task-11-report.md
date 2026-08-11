# Task 11 Report: Multi-Browser End-to-End Flows

## Status

Implemented the Task 11 browser verification suite and its minimal server-owned test support. The final desktop and mobile Playwright matrix passes all six tests, the full Vitest suite passes all 134 tests, and both build and lint complete with exit code 0.

## RED evidence

### Deterministic server runtime and configurable action deadline

Command:

```powershell
$env:PATH="C:\Users\SSAFY\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;$env:PATH"
.\node_modules\.bin\vitest.cmd run tests/unit/serverRuntime.test.ts tests/unit/rooms.test.ts --reporter=verbose
```

Observed before implementation:

- 2 test files failed.
- 2 tests failed and 29 passed.
- The injected 1,000 ms action timeout still produced `actionExpiresAt = 45_000`.
- `resolveServerRoomOptions` did not exist.

This proved both missing behaviors independently: `RoomService` could not yet use an injected deadline, and server startup could not yet select seeded test randomness without affecting production.

### Browser state convergence contract

Command:

```powershell
.\node_modules\.bin\playwright.cmd test tests/e2e/individual.spec.ts --config=playwright.config.ts --project=chromium-desktop --timeout=15000 --reporter=list
```

Observed before the public-state DOM attributes were added:

- 1 desktop test failed after 15.1 seconds.
- The test could not locate `main[data-room-version]`, so two real browser contexts could not assert authoritative version convergence.

The minimal implementation exposed only fields already present in the public snapshot: room version/phase, current/player/team IDs, and piece IDs/status/location/controller. It did not expose reconnect tokens, random seeds, new commands, or private server state.

## GREEN evidence during implementation

- Focused server tests: 2 files, 31 tests passed.
- Individual desktop E2E: passed through a seeded winner in 47.9 seconds.
- Reconnect desktop E2E: passed in 8.2 seconds.
- Eight-player team desktop E2E: passed in 29.9 seconds.

Two test-only issues were found and corrected without weakening production validation:

- Restored game pages use `서버와 연결되었습니다.` while lobby pages use `서버에 연결되었습니다.`; the shared browser opener now recognizes both real connected-state messages.
- Nicknames containing digits are invalid by the real nickname schema. The team browsers use `AOne` through `DTwo` while asserting the logical A1/B1/C1/D1/A2/B2/C2/D2 order through their team/member assignments.

## Browser setup

- Playwright Test: 1.62.1.
- Node: bundled runtime v24.14.0, prepended to `PATH` for every command.
- Browser used on this machine: system Google Chrome at `C:\Program Files\Google\Chrome\Application\chrome.exe`.
- Browser discovery order: `PLAYWRIGHT_CHROME_EXECUTABLE`, system Chrome, system Edge, then Playwright's managed default if none of those paths exists.
- Desktop project: Chromium engine, 1,440 × 900 viewport.
- Mobile project: Playwright `Pixel 7` device profile.
- Each simulated player owns a separate `BrowserContext`; cleanup closes every context, including failure paths.
- One worker runs the suite sequentially so the single seeded server process remains reproducible.
- Frontend: `http://localhost:3000` through Vinext.
- Authoritative game server: `http://localhost:3001` through Fastify and Socket.IO.
- The browser processes use the project's real UI, Socket.IO transport, reconnect token storage, schemas, authentication/session binding, room versions, and server command authorization.

The Playwright web server sets `NODE_ENV=test`, `YUT_RANDOM_SEED=task-11-e2e`, and the matching `PUBLIC_ORIGIN` only on the server process. The client receives only `NEXT_PUBLIC_GAME_SERVER_URL`; it receives no seed and no command for choosing throws.

## Covered flows

### Individual

- Two isolated contexts create and join a personal room.
- Both players ready and the host starts.
- Both pages agree on current turn, incremented room version, and throw presentation.
- The current player makes a legal move.
- Both pages agree on serialized public piece positions.
- The seeded authoritative game is played with legal UI actions until both pages show the same winner dialog.

### Eight-player teams

- Eight isolated contexts fill exactly two seats in teams A, B, C, and D.
- The host start button remains disabled through assignment and until the eighth player is ready.
- The game follows the logical order A1/B1/C1/D1/A2/B2/C2/D2 and returns to A1.
- Every player sees the same four piece IDs for each team.
- Only the current teammate can use the throw and legal piece controls; the other teammate sees the shared pieces but cannot control them out of turn.

### Reload, disconnect, automatic action, and recovery

- The current player's reconnect token and player ID survive a real page reload.
- The restored page returns to the same reserved seat.
- Closing that context produces a disconnect snapshot.
- The test-only 1,000 ms deadline or the server's immediate disconnected-player path performs authoritative legal actions until the remaining connected player has the turn.
- A new isolated context initialized with the stored token restores the original seat and converges on the remaining client's latest version.

## Server safety

- `RoomService` accepts an injected `actionTimeoutMs`; its default remains exactly 45,000 ms.
- Server startup selects 1,000 ms only when `NODE_ENV === "test"`.
- `YUT_RANDOM_SEED` is read only when `NODE_ENV === "test"`.
- Production ignores `YUT_RANDOM_SEED`, uses `Math.random`, and retains the 45,000 ms deadline. This behavior has a unit test.
- Throws remain generated inside `RoomService` after an authenticated `THROW_YUT` command. No client payload can set a seed, sticks, result, distance, or bonus throw.
- Existing room-version checks, request deduplication, Socket.IO session attachment, team authority, and host-only actions remain unchanged.

## Final verification

### Full desktop and mobile E2E

Command:

```powershell
.\node_modules\.bin\playwright.cmd test --config=playwright.config.ts --reporter=list
```

Final fresh result:

- Exit code 0.
- 6/6 passed in 173.8 seconds (2.9 minutes).
- Desktop individual: 47.9 seconds.
- Desktop reconnect: 6.3 seconds.
- Desktop team: 34.0 seconds.
- Mobile individual: 39.2 seconds.
- Mobile reconnect: 6.4 seconds.
- Mobile team: 22.4 seconds.

### Full Vitest

Command:

```powershell
.\node_modules\.bin\vitest.cmd run
```

Result: exit code 0; 15 files and 134 tests passed in 7.71 seconds.

### Build

Command:

```powershell
.\node_modules\.bin\vinext.cmd build
```

Result: exit code 0; all five Vinext build stages completed.

### Lint

Command:

```powershell
.\node_modules\.bin\eslint.cmd . --ignore-pattern dist --ignore-pattern .next
```

Result: exit code 0 with no lint output.

## Files

Created:

- `playwright.config.ts`
- `tests/e2e/helpers.ts`
- `tests/e2e/individual.spec.ts`
- `tests/e2e/team.spec.ts`
- `tests/e2e/reconnect.spec.ts`
- `tests/unit/serverRuntime.test.ts`
- `.superpowers/sdd/2026-08-11-online-yutnori/task-11-report.md`

Modified:

- `package.json`
- `server/index.ts`
- `server/rooms.ts`
- `tests/unit/rooms.test.ts`
- `client/components/GameScreen.tsx`
- `client/components/PlayerRail.tsx`
- `client/components/WaitingRoom.tsx`
- `client/components/YutBoard.tsx`

`package-lock.json` did not change because `@playwright/test` 1.62.1 was already declared and installed in the starting tree.

## Self-review

- Re-read the Task 11 brief and mapped every required scenario to an E2E assertion.
- Confirmed there is no client command or environment variable for selecting throws.
- Confirmed the only test-only server switches are gated by exact `NODE_ENV === "test"`.
- Confirmed production timeout behavior with both the existing exact 45,000 ms test and the new runtime-isolation test.
- Confirmed all contexts are isolated and closed.
- Confirmed desktop and mobile projects run the same three real flows.
- Confirmed no generated Playwright traces/screenshots remain in the worktree.
- Ran `git diff --check` before report creation; no whitespace errors were reported.

## Concerns

- Vinext's Cloudflare development plugin emits a non-fatal `Request.cf` fallback warning under the managed sandbox, and sandboxed Windows process-tree teardown can hang. Running the local E2E command with normal process permissions completed cleanly with exit code 0. This is an execution-environment limitation, not a product or test failure.
- The full matrix is intentionally sequential and takes about three minutes because it creates real isolated contexts and plays two games through an actual winner.
- A Chromium-compatible executable is required. The config supports an explicit `PLAYWRIGHT_CHROME_EXECUTABLE`, detects this machine's Chrome/Edge installations, and otherwise lets Playwright use its managed browser.
