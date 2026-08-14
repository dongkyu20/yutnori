# Room Leave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `방 나가기` permanently release a guest's room seat in every phase, continue active games with the remaining controllers, and keep every board piece circular regardless of nickname length.

**Architecture:** A versioned `LEAVE_ROOM` command is authenticated by the existing Socket.IO session and applied by `RoomService`; the game reducer removes only the leaving controller's pieces and resolves turn/winner state. The gateway treats successful eviction as the acknowledgement by disconnecting the old socket, after which the React session clears the reconnect token and reconnects anonymously.

**Tech Stack:** TypeScript 5.9, React 19, Socket.IO 4, Fastify 5, Zod 4, Vitest 4, Testing Library, Playwright 1.62, Vinext.

## Global Constraints

- Preserve all partial leave-room and piece-shape changes already present in the working tree; do not reset or overwrite unrelated user work.
- A deliberate leave permanently invalidates the reconnect token; an ordinary network disconnect continues to reserve the seat.
- A non-current player's leave must preserve the active player's selection state and original action deadline.
- `LEAVE_ROOM` must remain available after the normal per-socket command quota is exhausted.
- Individual pieces disappear with their owner; team pieces disappear only after the team's last member leaves.
- Nicknames remain restricted by the existing schema to Korean or English and at most 12 characters.
- Do not add a dependency or change the normal Yutnori rules.

---

## File Map

- `shared/protocol.ts`, `shared/schemas.ts`: define and validate the public `LEAVE_ROOM` command.
- `server/game/reducer.ts`: remove a player/controller from an active game and keep event IDs monotonic.
- `server/rooms.ts`: release membership, session, color, host, timer, and room lifecycle state.
- `server/gateway.ts`: validate commands, bypass only the leave command's general quota, broadcast the new snapshot, and evict the leaving socket.
- `client/useGameSession.ts`: send leave before disconnecting, clear local room state, and reconnect without credentials.
- `client/components/WaitingRoom.tsx`, `client/components/GameScreen.tsx`, `client/GameApp.tsx`: expose the leave action in all room phases.
- `client/components/YutBoard.tsx`, `app/globals.css`: keep piece labels short and pieces circular while preserving full accessible names.
- `tests/unit/reducer.test.ts`, `tests/unit/rooms.test.ts`: protect game and room lifecycle behavior.
- `tests/integration/gateway.test.ts`: protect the network command, eviction, and rate-limit boundary.
- `tests/ui/*.test.tsx`: protect the session handshake, buttons, confirmation, and accessible piece label.
- `tests/e2e/leave-room.spec.ts`: verify the complete two-browser user flow.

### Task 1: Preserve the active deadline when another player leaves

**Files:**
- Modify: `tests/unit/rooms.test.ts`
- Modify: `server/rooms.ts`

**Interfaces:**
- Consumes: `RoomService.dispatch(playerId, { type: "LEAVE_ROOM", roomVersion, requestId })`
- Produces: `RoomService.leaveRoom(room, actor)` that reschedules only when the leaving actor owned the current turn.

- [ ] **Step 1: Write the failing deadline test**

Add a three-player started game, advance the fake clock by 12 seconds, and make the third/non-current player leave. Derive the literal expected deadline from the configured 45-second turn:

```ts
it("다른 사람 차례에 나가면 현재 차례의 남은 시간을 늘리지 않는다", () => {
  const clock = new FakeClock();
  const service = new RoomService(clock.options());
  const sessions = createPlayers(service, "individual", ["Host", "Guest", "Third"]);
  let snapshot = sessions.at(-1)!.snapshot;
  for (const session of sessions) {
    snapshot = dispatch(service, session.playerId, snapshot, { type: "SET_READY", ready: true });
  }
  snapshot = dispatch(service, sessions[0].playerId, snapshot, { type: "START_GAME" });
  expect(snapshot.game?.actionExpiresAt).toBe(45_000);

  clock.advance(12_000);
  snapshot = dispatch(service, sessions[2].playerId, snapshot, { type: "LEAVE_ROOM" });

  expect(snapshot.game?.currentPlayerId).toBe(sessions[0].playerId);
  expect(snapshot.game?.actionExpiresAt).toBe(45_000);
  clock.advance(32_999);
  expect(clock.executed).toBe(0);
  clock.advance(1);
  expect(clock.executed).toBe(1);
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `vitest run tests/unit/rooms.test.ts -t "남은 시간을 늘리지 않는다"`

Expected: FAIL because the inherited implementation resets `actionExpiresAt` to `57_000`.

- [ ] **Step 3: Make timer rescheduling conditional**

Capture current-turn ownership before calling the reducer, and leave the existing timer untouched when a different player leaves:

```ts
const wasCurrentPlayer = room.game.currentPlayerId === actor.id;
room.game = removePlayer(room.game, actor.id, actor.nickname);
if (room.game.turnStage === "COMPLETE") {
  this.finishRoom(room);
} else if (wasCurrentPlayer) {
  const currentPlayer = this.connectedPlayer(room, room.game.currentPlayerId);
  this.scheduleAction(room, currentPlayer ? this.options.actionTimeoutMs : 0);
}
```

- [ ] **Step 4: Run focused server tests and confirm GREEN**

Run: `vitest run tests/unit/reducer.test.ts tests/unit/rooms.test.ts`

Expected: all reducer and room tests PASS, including current-player reset and non-current deadline preservation.

- [ ] **Step 5: Commit the reducer and room lifecycle slice**

Stage only `shared/protocol.ts`, `shared/schemas.ts`, `server/game/reducer.ts`, `server/rooms.ts`, `tests/unit/reducer.test.ts`, and `tests/unit/rooms.test.ts`.

Commit: `feat: remove players who leave a room`

### Task 2: Guarantee leave after the normal command quota is exhausted

**Files:**
- Modify: `tests/integration/gateway.test.ts`
- Modify: `server/gateway.ts`

**Interfaces:**
- Consumes: `parseClientCommand(raw)` and the existing per-socket fixed-window quota.
- Produces: a valid `LEAVE_ROOM` path that bypasses only `commandQuota`, then invalidates the session and disconnects the socket.

- [ ] **Step 1: Write the failing quota-boundary integration test**

Use a server with `maxCommands: 1`: the guest's `JOIN_ROOM` consumes its only general command, but a subsequent leave must still remove it.

```ts
it("lets a player leave after the general command quota is exhausted", async () => {
  const url = await startRateLimitedServer({
    now: () => 0,
    maxCommands: 1,
    maxReactions: 4,
  });
  const { host, guest, guestSession, snapshot } = await createAndJoin(url);
  const remainingEvent = event<PublicRoomSnapshot>(host, "snapshot");
  const disconnectedEvent = event(guest, "disconnect");

  guest.emit("command", {
    type: "LEAVE_ROOM",
    roomVersion: snapshot.version,
    requestId: requestId(10),
  });

  expect((await remainingEvent).players.map((player) => player.id))
    .not.toContain(guestSession.playerId);
  await disconnectedEvent;
});
```

- [ ] **Step 2: Run the integration test and confirm RED**

Run: `vitest run tests/integration/gateway.test.ts -t "quota is exhausted"`

Expected: FAIL with `RATE_LIMITED`/snapshot timeout because quota is currently checked before parsing the command.

- [ ] **Step 3: Parse first and bypass quota only for valid leave**

Keep malformed commands counted, while allowing a parsed leave command through:

```ts
const result = parseClientCommand(raw);
const bypassCommandQuota = result.success && result.data.type === "LEAVE_ROOM";
if (!bypassCommandQuota && !consumeQuota(commandQuota, now, rateLimit.windowMs, rateLimit.maxCommands)) {
  emitError(socket, RATE_LIMITED);
  return;
}
if (!result.success) {
  emitError(socket, INVALID_COMMAND);
  return;
}
```

- [ ] **Step 4: Run gateway tests and confirm GREEN**

Run: `vitest run tests/integration/gateway.test.ts`

Expected: all gateway tests PASS, including invalid-command quota counting, leave eviction, and rejected token reuse.

- [ ] **Step 5: Commit the gateway slice**

Stage only `server/gateway.ts` and `tests/integration/gateway.test.ts`.

Commit: `fix: make room leave reliable at the gateway`

### Task 3: Finish the client leave handshake and circular piece UI

**Files:**
- Modify: `client/useGameSession.ts`
- Modify: `client/GameApp.tsx`
- Modify: `client/components/WaitingRoom.tsx`
- Modify: `client/components/GameScreen.tsx`
- Modify: `client/components/YutBoard.tsx`
- Modify: `app/globals.css`
- Modify: `tests/ui/useGameSession.test.tsx`
- Modify: `tests/ui/WaitingRoom.test.tsx`
- Modify: `tests/ui/GameChrome.test.tsx`
- Modify: `tests/ui/YutBoard.test.tsx`

**Interfaces:**
- Consumes: `GameSession.leaveRoom(): void` and the server disconnect as successful-leave acknowledgement.
- Produces: visible leave controls, a playing-phase confirmation, anonymous reconnection, and fixed-size accessible pieces.

- [ ] **Step 1: Run the inherited focused UI tests**

Run: `vitest run tests/ui/useGameSession.test.tsx tests/ui/WaitingRoom.test.tsx tests/ui/GameChrome.test.tsx tests/ui/YutBoard.test.tsx`

Expected: all inherited leave/button/piece tests PASS. If one fails, use systematic debugging before changing production code.

- [ ] **Step 2: Add an unmount cleanup regression test if the leave timer survives unmount**

Use fake timers and a purpose-built fake socket. Trigger `leaveRoom`, unmount, advance by 1,500 ms, and assert no second `connect()` occurs after unmount. The break caught is a leaked grace timer reopening a socket after its React owner is gone.

- [ ] **Step 3: Clear the grace timer in the effect cleanup**

If Step 2 proves the leak, add this to the existing effect cleanup before disconnecting:

```ts
if (leaveTimerRef.current !== null) {
  window.clearTimeout(leaveTimerRef.current);
  leaveTimerRef.current = null;
}
leavingRef.current = false;
```

- [ ] **Step 4: Run focused UI tests and static checks**

Run:

```text
vitest run tests/ui/useGameSession.test.tsx tests/ui/WaitingRoom.test.tsx tests/ui/GameChrome.test.tsx tests/ui/YutBoard.test.tsx
npm run typecheck
npm run lint
```

Expected: all tests PASS, both TypeScript projects PASS, and ESLint exits 0.

- [ ] **Step 5: Commit the client/UI slice**

Stage only the six client/style files and four UI test files listed above.

Commit: `feat: add room leave controls`

### Task 4: Verify the complete browser flow and remove scratch artifacts

**Files:**
- Create: `tests/e2e/leave-room.spec.ts`
- Delete: `shot-tmp.mjs`

**Interfaces:**
- Consumes: existing E2E helpers `openPlayer`, `createRoom`, `joinRoom`, `readyPlayer`, `startGame`, `roomVersion`, and `closePlayers`.
- Produces: browser-level proof that waiting-room and active-game leave remove the seat for remaining players.

- [ ] **Step 1: Write the end-to-end leave test**

The spec must open host and guest contexts, verify waiting-room leave returns the guest to the entry screen and removes it from the host list, rejoin with a new nickname, start a game, accept the confirmation, and verify the remaining host sees a finished winner state.

```ts
await guest.page.getByRole("button", { name: "방 나가기" }).click();
await expect(guest.page.getByRole("heading", { name: "한판윷" })).toBeVisible();
await expect(host.page.locator("li[data-player-id]", { hasText: "Guest" })).toHaveCount(0);

await joinRoom(guest, roomCode); // after changing guest.nickname to a fresh valid name
await readyPlayer(host, players);
await readyPlayer(guest, players);
await startGame(host, players);
guest.page.once("dialog", (dialog) => dialog.accept());
await guest.page.getByRole("button", { name: "방 나가기" }).click();
await expect(host.page.getByRole("dialog", { name: /경기 결과/ })).toBeVisible();
```

- [ ] **Step 2: Run the focused E2E test**

Run: `playwright test tests/e2e/leave-room.spec.ts --config=playwright.config.ts --project=chromium-desktop`

Expected: PASS with two isolated browser contexts and no failure artifact.

- [ ] **Step 3: Remove the inherited browser scratch script**

Delete only the untracked `shot-tmp.mjs`; it is the previous AI's temporary screenshot runner and is superseded by the checked-in Playwright test.

- [ ] **Step 4: Run the full verification gate**

Run:

```text
npm run typecheck
npm test
npm run lint
npm run build
npm run build:server
npm run smoke:server
npm run test:e2e
git diff --check
```

Expected: both type environments PASS; every Vitest and Playwright test PASS; frontend and backend builds succeed; production health plus two-client Socket.IO smoke succeeds; diff check exits 0.

- [ ] **Step 5: Commit final E2E and cleanup**

Stage only `tests/e2e/leave-room.spec.ts` and the deletion of `shot-tmp.mjs` if Git tracks it. Do not stage generated screenshots, traces, build outputs, or reports.

Commit: `test: cover leaving a room end to end`

### Task 5: Review and completion

**Files:**
- Review: all files changed by Tasks 1–4

**Interfaces:**
- Consumes: the complete leave-room implementation and all fresh verification output.
- Produces: a clean, reviewable branch with no unresolved Critical or Important finding.

- [ ] **Step 1: Review against the design document**

Check every rule in `docs/superpowers/specs/2026-08-14-leave-room-design.md`, especially non-current timer preservation, rate-limit bypass scope, team shared pieces, token invalidation, and accessible full nicknames.

- [ ] **Step 2: Inspect repository state**

Run: `git status --short`, `git diff --check`, and `git log -5 --oneline`.

Expected: no generated artifact is staged or untracked; only deliberate commits remain.

- [ ] **Step 3: Apply review findings with TDD**

For each behavioral finding, add one focused failing test that names the break, confirm RED, apply the smallest production fix, and confirm focused plus full GREEN before committing.

- [ ] **Step 4: Prepare the final handoff**

Report the user-visible behavior, verification totals, commits created, any environment limitation, and the absolute links to the design and plan documents.
