# Task 8 — Waiting Room and Team Setup

## Delivered

- Added `WaitingRoom` and `PlayerRail` components and routed waiting snapshots from `GameApp` into them.
- Displays room code with accessible copy action, individual occupancy (`n/4`), player connection/ready state, and the host marker (`방장`).
- Provides host-only player kick controls with browser confirmation. Team-room hosts can assign every player, including themselves; full teams are unavailable for selection.
- Renders four named team cards (A–D), each with an explicit `n/2` seat count, plus an unassigned rail.
- Generates every waiting-room command with the supplied snapshot version and `crypto.randomUUID()`.
- Added authoritative `canStart` and `startEligibilityReason` fields to `PublicRoomSnapshot`. `RoomService` now derives this projection from the same helper used by `START_GAME`, avoiding client-side rule duplication.

## RED / GREEN

1. Created `tests/ui/WaitingRoom.test.tsx` before the waiting-room components existed. The focused RED run failed as expected with an unresolved `WaitingRoom` import.
2. Added the focused room-service eligibility test before the projection existed. Its RED run had 1 failing assertion because `canStart` and `startEligibilityReason` were absent.
3. Implemented the authoritative projection and minimal UI. Later host-self-assignment and unavailable-Clipboard tests also failed before their respective fixes. Focused UI and room-service tests then passed.

## Verification

- Focused: `vitest run tests/ui/WaitingRoom.test.tsx tests/unit/rooms.test.ts` — passing.
- Full suite: `vitest run` — 11 files, 103 passing tests.
- Lint: `eslint . --ignore-pattern dist --ignore-pattern .next` — no errors or warnings.
- Build: `vinext build` — completed successfully.

All commands used the workspace-local Vitest/ESLint/Vinext binaries with the provided Node runtime prepended to `PATH` because a global npm executable is unavailable.

## Files

- `client/GameApp.tsx`
- `client/components/WaitingRoom.tsx`
- `client/components/PlayerRail.tsx`
- `server/rooms.ts`
- `shared/protocol.ts`
- `tests/ui/WaitingRoom.test.tsx`
- `tests/unit/rooms.test.ts`

## Self-review

- Host authority is represented in the controls only; the server remains authoritative for every command.
- Start eligibility is calculated server-side for all snapshots and `START_GAME` consumes that same calculation.
- Tests use real Testing Library-rendered components; the only browser doubles are Clipboard and confirmation, which are external browser APIs whose observable calls are the UI boundary under test.
- A manual mutation check confirms the tests would fail if command versions/request IDs were omitted, host controls were shown to members, confirmation were removed, or an invalid start were enabled.
- Independent review approved the change with two minor follow-ups; both were addressed: hosts can assign themselves, and copy success is now shown only after a confirmed Clipboard write (with accessible manual-copy guidance on failure).

## Concerns

- The build emits Vinext's pre-existing informational notice that route classification is unknown; it does not fail the build.
