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

---

## Fix round 1/5

### Review findings addressed

- Added public `RoomService.subscribe(listener): () => void` with exported `RoomChange` and `RoomChangeListener` types. Each event contains only `{ roomCode, snapshot }`, where `snapshot` is produced through the existing secret-stripping public projection.
- Create, join, reconnect, accepted versioned commands, disconnect, and timer-driven automatic actions now emit exactly one notification after their mutation is complete. Duplicate requests, repeated disconnects, already-connected reconnects, reactions, and timer wakeups that only restore a preserved deadline emit none.
- The returned unsubscribe function removes the listener; a real timer test proves no notifications arrive after unsubscribe.
- Centralized the four cited user-facing messages as valid UTF-8 Korean constants. A UTF-8 audit of production source `server/rooms.ts` found no `U+FFFD` replacement characters, and a behavior test now rejects `?`/`\uFFFD` corruption while requiring readable Hangul.
- Replaced every exact Korean error-string assertion in `rooms.test.ts` with stable `RoomError.code` assertions. Message wording is no longer coupled to domain behavior.

### TDD evidence

Subscription RED before production changes:

```powershell
& .\node_modules\.bin\vitest.cmd run tests/unit/rooms.test.ts -t "RoomService change subscriptions"
```

```text
TypeError: service.subscribe is not a function
Test Files  1 failed (1)
Tests  4 failed | 21 skipped (25)
```

Subscription GREEN after the minimal listener set and notification calls:

```text
Test Files  1 passed (1)
Tests  4 passed | 21 skipped (25)
```

The Korean-message mutation check deliberately replaced `ROOM_NOT_FOUND` with `???`. The focused readability test failed as intended:

```text
expected '???' to match /[가-힣]/
Test Files  1 failed (1)
Tests  1 failed | 25 skipped (26)
```

After restoring `방을 찾을 수 없습니다.` the same focused test passed:

```text
Test Files  1 passed (1)
Tests  1 passed | 25 skipped (26)
```

### Verification

- Amended Task 5 suites: 2 files passed, 30 tests passed.
- Full suite: 7 files passed, 75 tests passed.
- Production build: all five Vinext stages completed; exit 0.
- Targeted ESLint and `git diff --check`: exit 0 with no lint or whitespace errors. Git only printed its existing LF-to-CRLF working-copy warning.
- Standalone TypeScript check still reports only the same pre-existing Cloudflare worker declarations and Zod `SafeParseReturnType` errors; no Task 5 type errors were reported.

### Fix-round self-review

- Notification happens after version increments and after timer scheduling/finish cleanup, so subscribers see the same complete snapshot returned by synchronous APIs or produced by the automatic action.
- The listener collection is copied before iteration, making unsubscribe-during-notification deterministic.
- Automatic actions emit once per reducer transition, including each immediate action needed while the current player remains disconnected.
- Public notification tests assert room code, version, connected/host state, generated throw result, secret stripping, duplicate suppression, and unsubscribe behavior rather than callback call mechanics.

### Updated concerns

- The earlier Task 6 broadcast-hook concern is resolved by `RoomService.subscribe()`; Task 6 can subscribe once and broadcast `change.snapshot` to `room:${change.roomCode}`.
- Vinext retains its informational route-classification message; the build exits successfully.

---

## Fix round 2/5

### Review finding addressed

- Isolated every room-change listener invocation with its own `try/catch`. A failed listener cannot escape from an already-committed synchronous mutation, cannot interrupt timer processing, and cannot prevent later listeners from receiving the same public snapshot.
- Added optional `RoomServiceOptions.onListenerError(error)` as the explicit infrastructure observation policy. Production defaults to `console.error`; tests inject a collector and assert the exact original error is reported once.
- Isolated the diagnostic hook itself so a broken reporter also cannot alter domain-command return behavior after mutation.
- Corrected the fix-round-1 production-source audit wording and changed the readability matcher to the explicit `\uFFFD` escape.

### TDD evidence

Focused RED command:

```powershell
$env:PATH='C:\Users\SSAFY\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH
& .\node_modules\.bin\vitest.cmd run tests/unit/rooms.test.ts -t "isolates a throwing listener"
```

Result before isolation:

```text
expected [Function] to not throw an error but 'Error: gateway listener failed' was thrown
expected [Function] to not throw an error but 'Error: timer listener failed' was thrown
Test Files  1 failed (1)
Tests  2 failed | 26 skipped (28)
```

Focused GREEN after per-listener isolation:

```text
Test Files  1 passed (1)
Tests  2 passed | 26 skipped (28)
```

### Exact final amended-suite evidence

Command:

```powershell
$env:PATH='C:\Users\SSAFY\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH
& .\node_modules\.bin\vitest.cmd run tests/unit/rooms.test.ts tests/unit/autoAction.test.ts
```

Output:

```text
RUN  v4.1.10 C:/Users/SSAFY/Documents/yut/online-yutnori
Test Files  2 passed (2)
Tests  32 passed (32)
Duration  344ms
```

### Full verification

- Full suite command: `node_modules\.bin\vitest.cmd run` — exit 0; 7 files passed, 77 tests passed.
- Production build command: `node_modules\.bin\vinext.cmd build` — exit 0; all five stages completed.
- Targeted lint command: `node_modules\.bin\eslint.cmd server/rooms.ts server/autoAction.ts tests/unit/rooms.test.ts tests/unit/autoAction.test.ts` — exit 0.
- `git diff --check` — exit 0; only Git's existing LF-to-CRLF working-copy warnings were printed.

### Fix-round self-review

- Both regression tests use two real subscribed callbacks: the first throws and the second records the actual service event.
- The command test verifies the accepted snapshot still returns, the committed readiness state is visible, the later subscriber receives it, and the error hook observes the original failure.
- The timer test verifies the fake scheduler does not surface the listener failure, the later subscriber receives the server-generated `MO` snapshot, and the error hook observes the original timer-listener failure.
- Listener failures are diagnostic-only. They never roll back room state, alter versioning, reschedule an action, or change the public snapshot.

### Updated concerns

- No open Task 5 correctness concerns from this review round.
- Vinext retains its informational route-classification message; the build exits successfully.
