# Task 5: Room, Lobby, Sessions, and Timers

## Implementation

- Added a memory-only `RoomService` for individual and team room creation, normalized nickname admission, capacity enforcement, host controls, readiness, team assignment, kicking, game start, disconnect/reconnect, and cleanup.
- Added six-character codes from the unambiguous protocol alphabet, UUID player IDs, 256-bit reconnect tokens, and SHA-256-only token storage. Public snapshots contain neither reconnect credentials nor request-deduplication state.
- Added case-insensitive nickname uniqueness using locale-independent lowercase comparison.
- Added per-player request-ID deduplication before stale-version validation, with exactly one version increment after each accepted state-changing command.
- Preserved seats after game start, reassigned a disconnected waiting-room host, restored the same player ID from a reconnect token, and retained the active action deadline across reconnects.
- Converted public `THROW_YUT` commands to internal `THROW` commands using the injected server-side random source and `throwYut()`; no client throw outcome is consumed.
- Added 45-second authoritative action timers. Expiry chooses a legal server action, while disconnecting the current player schedules immediate automatic actions until play reaches a connected player or the game finishes.
- Added exact cleanup boundaries: non-finished empty rooms at 600,000 ms and finished rooms at 1,800,000 ms.
- Added `chooseAutoCommand()` for authoritative throws and uniform legal piece/route selection.

## Changed files

- `server/rooms.ts`
- `server/autoAction.ts`
- `tests/unit/rooms.test.ts`
- `tests/unit/autoAction.test.ts`
- `.superpowers/sdd/2026-08-11-online-yutnori/task-5-report.md`

## TDD evidence

### Initial RED

Command:

```powershell
$env:PATH='C:\Users\SSAFY\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH
& .\node_modules\.bin\vitest.cmd run tests/unit/rooms.test.ts tests/unit/autoAction.test.ts
```

Result: exit 1 before either production module existed:

```text
Cannot find module '../../server/autoAction'
Cannot find module '../../server/rooms'
Test Files  2 failed (2)
Tests  no tests
```

### Initial GREEN

The first focused implementation run exposed one test-fixture defect: the team-composition assertion sent the host's pre-join version and correctly received `오래된 방 버전입니다.`. After changing the test to send the latest joined snapshot, the same focused command exited 0:

```text
Test Files  2 passed (2)
Tests  21 passed (21)
```

### Disconnected-current-player RED/GREEN

The immediate-disconnect branch was isolated behind a focused behavior test.

RED with immediate scheduling removed:

```text
expected +0 to be 2
Test Files  1 failed (1)
Tests  1 failed | 17 skipped (18)
```

GREEN after restoring zero-delay scheduling while preserving the original deadline:

```text
Test Files  1 passed (1)
Tests  1 passed | 17 skipped (18)
```

### Final focused coverage

The Task 5 suites cover room-code uniqueness, nickname normalization/uniqueness, both capacities, individual readiness, exact team composition, each host-only control, waiting-room host reassignment, mid-game seat reservation and reconnect, secret stripping, deduplication, stale versions, timer expiry, reconnect deadline preservation, disconnected automatic actions, server-generated throws, both cleanup boundaries, and every automatic-command branch.

## Full verification

- Full suite: `node_modules\.bin\vitest.cmd run` — exit 0; 7 files passed, 70 tests passed.
- Production build: `node_modules\.bin\vinext.cmd build` — exit 0; all five build stages completed.
- Targeted ESLint plus `git diff --check` — exit 0 with no output.
- Standalone `tsc --noEmit --pretty false` reports only the pre-existing repository errors already documented in Task 4: missing Cloudflare worker declarations in `db/index.ts` and `worker/index.ts`, and the existing Zod `SafeParseReturnType` reference in `shared/schemas.ts`. Task 5 files report no TypeScript errors.

## Self-review

- Room state, token hashes, player lookup, request IDs, timers, and game state remain in process memory only.
- Raw reconnect tokens exist only at issuance and in the caller-supplied reconnect request; stored session keys and player records contain SHA-256 hashes only.
- Every public snapshot is rebuilt from explicit public fields and the reducer's public projection.
- Duplicate IDs are checked before room versions, so a transport retry with its original version is idempotent; rejected requests are not recorded.
- Lobby and game commands mutate only after phase, host, composition, readiness, actor, and reducer legality checks pass.
- Joining stops when play starts, but disconnected players remain in the roster and can recover only through their original token.
- A waiting host transfer is stable: the original host does not reclaim ownership merely by reconnecting after another connected player was promoted.
- Reconnect does not cancel or replace the active action timer. If it wins a race with a queued zero-delay disconnect action, the timer callback resumes only the remaining portion of the original deadline.
- Manual and automatic game actions each cancel the prior timer, apply one reducer transition, increment the room version once, and create one fresh action deadline unless the reducer completes the game.
- Finished snapshots expose `actionExpiresAt: null`; finished cleanup is based on the original finish time and is not extended by reconnects.
- Mutation coverage includes wrong capacity, case-sensitive duplicate admission, missing team slot, missing host check, request-version check before dedupe, client-controlled throw outcome, timer off-by-one, reconnect timer reset, missing disconnected auto-action, and incorrect cleanup comparison.

## Concerns

- Task 6 will need a broadcast hook or equivalent gateway integration for snapshots produced asynchronously by timer callbacks. The Task 5 interface does not specify a room-change subscription, so this task intentionally keeps the exact requested API and leaves transport notification wiring to the gateway task.
- Vinext still emits its existing informational message that some routes cannot be statically classified; the build exits successfully.
