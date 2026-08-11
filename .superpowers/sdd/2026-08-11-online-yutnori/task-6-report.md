# Task 6: Socket.IO Gateway and Production Server

## Implementation

- Added a Socket.IO gateway attached to the Fastify HTTP server. Every raw `command` payload is validated with `parseClientCommand` before it can reach `RoomService`.
- Routed `CREATE_ROOM`, `JOIN_ROOM`, authenticated in-room commands, and reconnect tokens into the existing memory-only `RoomService`; no database, shared cache, or multi-instance coordination was added.
- Joined authenticated sockets to `room:<code>` and subscribed once to `RoomService.subscribe()`. Public snapshots from joins, commands, disconnects, reconnects, and authoritative timers therefore use the same room broadcast path.
- Kept `{ playerId, reconnectToken }` private to the joining or reconnecting socket. Room events contain only the existing public snapshot projection; reaction broadcasts contain only `{ playerId, emoji }`.
- Broadcast reactions only after the strict protocol schema accepts one of `👏`, `🔥`, `😮`, or `🎉` and `RoomService` confirms an active session.
- Mapped schema failures, session state, `RoomError` codes, and reducer action failures into stable Korean `ServerError` objects without exception messages or stack traces.
- Added `GET /health`, Socket.IO CORS pinned to `PUBLIC_ORIGIN`, executable startup on `PORT` with default `3001`, and an import-safe `buildServer()` factory for real ephemeral integration tests.
- Added Engine.IO handshake enforcement so WebSocket clients whose `Origin` is not exactly `PUBLIC_ORIGIN` are rejected instead of relying on browser CORS behavior alone.
- Added one active-socket owner per player. Reusing a reconnect token replaces the prior socket without marking the restored player disconnected, and successful kicks disconnect the target after delivering the public removal snapshot.
- Added an unref'd process-local room-expiry interval, cleared during Fastify shutdown. Default action timers are also unref'd, while the HTTP server remains the production process owner.
- Added `dev:server`, `test:e2e`, and server `start` scripts while preserving the existing `test` script. No dependency versions changed, so `package-lock.json` remained unchanged.
- Added `.env.example` with `PORT=3001` and `PUBLIC_ORIGIN=http://localhost:3000`.

## Test-first evidence

### RED

Command:

```text
node_modules\.bin\vitest.cmd run tests\integration\gateway.test.ts
```

Result before production files existed: exit 1.

```text
Test Files  1 failed (1)
Tests       no tests
Error: Cannot find module '../../server/index'
```

This was the intended failure: the real integration suite could not import the absent server/gateway surface.

### First implementation run

The first production run exercised all five real integration cases. Four passed; the CORS assertion failed because Socket.IO returns the configured allowed-origin value for a disallowed request instead of omitting the header. The browser security boundary is the origin mismatch. The test was corrected to assert that the response remains pinned to `PUBLIC_ORIGIN` and never reflects the attacker origin.

```text
Test Files  1 failed (1)
Tests       1 failed | 4 passed (5)
AssertionError: expected true to be false
```

### GREEN

Command:

```text
node_modules\.bin\vitest.cmd run tests\integration\gateway.test.ts
```

Result: exit 0.

```text
Test Files  1 passed (1)
Tests       5 passed (5)
```

The focused suite starts a real server on an ephemeral port, opens real Socket.IO clients, verifies health and origin rejection, creates and joins a room, compares both clients' incremented snapshots, checks session secrecy, rejects malformed input and a wrong-turn throw, disconnects/reconnects with the issued token, verifies identity restoration, covers all four allowed reactions plus a rejected fifth emoji, expires rooms through server-owned maintenance, replaces overlapping reconnect sockets, and evicts kicked sockets. All clients and servers are disposed after every test.

### Review-driven RED/GREEN

An independent read-only review identified attacker-origin WebSocket admission, overlapping reconnect ownership, kicked-socket retention, and missing production expiry maintenance. Tests for these behaviors were added before their fixes.

RED: exit 1.

```text
Test Files  1 failed (1)
Tests       4 failed | 4 passed (8)
Failures: Disallowed origin connected; expiry did not run; duplicate and kicked sockets timed out waiting for disconnect
```

GREEN: exit 0.

```text
Test Files  1 passed (1)
Tests       8 passed (8)
```

The same reviewer re-checked the amended tree and marked all four Important findings resolved, with no new Critical or Important breakage and an assessment of “Ready for Task 6.”

## Full verification

- Full suite: `node_modules\.bin\vitest.cmd run` — exit 0; 8 files passed, 85 tests passed.
- Production build: `node_modules\.bin\vinext.cmd build` — exit 0; all five Vinext build phases completed. Vinext printed its existing informational note that some routes could not be statically classified.
- Lint: `node_modules\.bin\eslint.cmd . --ignore-pattern dist --ignore-pattern .next` — exit 0; no findings.
- Diff hygiene: `git diff --check` — exit 0.

## Files

- `.env.example`
- `package-lock.json`
- `package.json`
- `server/game/reducer.ts`
- `server/gateway.ts`
- `server/index.ts`
- `server/rooms.ts`
- `tests/integration/gateway.test.ts`
- `.superpowers/sdd/2026-08-11-online-yutnori/task-6-report.md`

The initial Task 6 commit did not change `package-lock.json`; review fix round 1 moves `tsx` to runtime dependencies and updates the lock accordingly.

## Self-review

- Removing the gateway subscription would break join/disconnect/reconnect delivery to existing room members; authoritative timer snapshots use that identical subscription path.
- Create, join, and reconnect mutate before the socket can join its room, so the new socket receives one direct copy of the same public snapshot while already-joined members receive the subscription broadcast. This avoids duplicate snapshots to existing members.
- Session payloads use `socket.emit`, never `io.emit`, `socket.broadcast`, or room emission. Tests prove one member never receives the other member's session and serialized snapshots contain neither token nor the `reconnectToken` key.
- Socket identity comes only from the issued/recovered server session. Reaction payloads ignore any client-supplied player identity and use `socket.data.playerId`.
- Schema validation precedes every command branch, including reactions. Invalid commands cannot mutate rooms or emit reactions.
- Transport errors serialize only `{ code, message, recoverable }`; raw validation details, domain exception text, and stacks are not exposed.
- CORS is configured with one exact `publicOrigin` string. The handshake test proves an untrusted request is not reflected as an allowed origin.
- Engine.IO `allowRequest` enforces the same exact origin at connection time; a real attacker-origin WebSocket client receives `connect_error`.
- Active player-to-socket ownership prevents an older overlapping connection from disconnecting its replacement. Kicks clear ownership and force-disconnect the removed socket after the removal broadcast.
- `Gateway.close()` unsubscribes from room changes and closes Socket.IO; Fastify invokes it from `preClose`. Test cleanup closes clients and Fastify after every case without open-handle warnings.
- Fastify clears its room-expiry interval during `preClose`; both maintenance and default action timers are unref'd so they cannot outlive the standalone HTTP server process.
- The default factory creates exactly one in-process `RoomService`, preserving the approved single-instance, memory-only model.

## Concerns

- A standalone `tsc --noEmit` remains red on pre-existing project-wide configuration errors in `db/index.ts` (`cloudflare:workers`), `worker/index.ts` (Cloudflare globals), and `shared/schemas.ts` (Zod v4 no longer exports `SafeParseReturnType`). Task 6 introduced two Socket.IO event-map diagnostics during development; those were fixed, and no Task 6 file remains in the TypeScript diagnostic output. The required Vinext production build and ESLint both pass.
- The server defaults `PUBLIC_ORIGIN` to `http://localhost:3000` for local startup when the environment variable is absent. Deployments must set `PUBLIC_ORIGIN` to their actual public web origin.
- Room state and reconnect sessions intentionally remain process-local. Horizontal scaling would require sticky routing or an explicitly approved shared adapter/store, outside this task.

---

# Review Fix Round 1/5

## Findings addressed

1. Added `RoomService.subscribeRemoval()` with `{ roomCode, playerIds }` lifecycle payloads emitted after an expired room is deleted. The gateway subscribes and clears ownership plus force-disconnects every remaining socket before the room code can expose later traffic.
2. Added typed `GameActionError` rejections for expected reducer input failures. `RoomService` converts only those typed failures to recoverable `RoomError("INVALID_ACTION")`; every unexpected exception now maps to sanitized, non-recoverable `INTERNAL_ERROR`.
3. Moved `tsx` from `devDependencies` to runtime `dependencies` and synchronized the npm lockfile. The lock also needed two already-referenced optional `@emnapi` records before npm's clean-install consistency check would pass.

## TDD evidence

### Expired-room socket leak RED

Command:

```text
node_modules\.bin\vitest.cmd run tests\integration\gateway.test.ts -t "evicts connected sockets when a finished room expires"
```

Result before removal lifecycle wiring: exit 1.

```text
Test Files  1 failed (1)
Tests       1 failed | 8 skipped (9)
AssertionError: expected true to be false
expect(oldSocket.connected).toBe(false)
```

GREEN after `subscribeRemoval()` and gateway eviction: exit 0.

```text
Test Files  1 passed (1)
Tests       1 passed | 8 skipped (9)
```

The final form is deterministic: it finishes a real two-player game with injected time/randomness, connects a real socket to the finished room, invokes the exact 30-minute expiry boundary, awaits forced disconnect, reuses the deterministic room code, and confirms the old socket receives zero new snapshots.

### Unexpected-error classification RED

Command:

```text
node_modules\.bin\vitest.cmd run tests\integration\gateway.test.ts -t "sanitizes an unexpected room-service exception"
```

Result before the typed boundary: exit 1.

```text
Test Files  1 failed (1)
Tests       1 failed | 9 skipped (10)
Expected: INTERNAL_ERROR / recoverable false
Received: INVALID_ACTION / recoverable true
```

GREEN command covering both expected and unexpected branches:

```text
node_modules\.bin\vitest.cmd run tests\integration\gateway.test.ts -t "unexpected room-service exception|out-of-turn throw"
```

Result: exit 0.

```text
Test Files  1 passed (1)
Tests       2 passed | 8 skipped (10)
```

The injected service exception carries `secret infrastructure detail` and `secret stack trace`; neither appears in the serialized `ServerError`.

## Production dependency and health smoke

- Lock generation: `pnpm.cmd dlx npm@10.9.2 install --package-lock-only --ignore-scripts` completed. Its broad metadata rewrite was intentionally reduced to the runtime `tsx` edge and the two optional entries required by npm's lock consistency check.
- First isolated clean install exposed those pre-existing missing optional records: `npm ci` reported missing `@emnapi/core@1.10.0` and `@emnapi/runtime@1.10.0`.
- Final isolated install: `pnpm.cmd dlx npm@10.9.2 ci --omit=dev --ignore-scripts --no-audit --no-fund` — exit 0; `added 87 packages in 6s`.
- Production-only start/health: launched `node node_modules/tsx/dist/cli.mjs server/index.ts` from the isolated omit-dev tree with `PORT=43127`; `GET /health` returned `{"status":"ok"}`. The exact process was terminated and the temporary tree was removed.

## Final verification

- Focused gateway: `node_modules\.bin\vitest.cmd run tests\integration\gateway.test.ts` — exit 0; 1 file passed, 10 tests passed.
- Affected Task 5/reducer suites: `node_modules\.bin\vitest.cmd run tests\unit\rooms.test.ts tests\unit\reducer.test.ts` — exit 0; 2 files passed, 41 tests passed.
- Full suite: `node_modules\.bin\vitest.cmd run` — exit 0; 8 files passed, 87 tests passed.
- Production build: `node_modules\.bin\vinext.cmd build` — exit 0; all five phases completed, with the existing route-classification informational note.
- Lint: `node_modules\.bin\eslint.cmd . --ignore-pattern dist --ignore-pattern .next` — exit 0; no findings.
- Diff hygiene: `git diff --check` — exit 0.

## Self-review

- Removal events expose only public room/player identities, never tokens or internal session hashes. Listener failures remain isolated after deletion has committed.
- Expiry eviction reuses the same gateway ownership cleanup as kicks, clears socket session data before force-disconnect, and prevents the disconnect handler from touching already-deleted service state.
- Expected invalid actions are explicitly typed at reducer input-validation boundaries; reducer invariants and injected infrastructure failures remain ordinary exceptions and cannot be downgraded to recoverable client mistakes.
- Unexpected errors serialize only the stable Korean internal-error payload. Exception messages and stacks are not copied into any socket event.
- The omit-dev smoke starts with the runtime dependency graph produced from the committed package/lock pair, not the workspace's development install.

## Remaining concerns

- Standalone `tsc --noEmit` still has the pre-existing Cloudflare global/module and Zod type-alias diagnostics recorded above; required build and lint gates pass.
- npm's lock-generation audit reported 20 existing dependency advisories (1 low, 6 moderate, 13 high). This fix did not run an audit mutation because dependency upgrades are outside the three approved findings.
- Memory-only, single-instance room/session behavior remains intentional.

## Fix-round re-review

The independent reviewer marked expired-room eviction, typed error classification, and production-only start all resolved. No new Critical or Important issues were found; verdict: Approved.
