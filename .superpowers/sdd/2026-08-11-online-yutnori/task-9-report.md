# Task 9 Report: Accessible Board and Turn Controls

## Status

Implemented the playable game screen from authoritative `PublicRoomSnapshot.game` data. The client renders the fixed Yut board, grouped stacks, stage-specific controls, Korean turn/result text, and sends only server-projected legal action intent with the current room version and a fresh UUID.

## RED evidence

Tests were added before production code in:

- `tests/ui/YutBoard.test.tsx`
- `tests/ui/TurnPanel.test.tsx`
- `tests/unit/reducer.test.ts` (authoritative throw event identity)

Initial command (global npm is unavailable, so the bundled Node runtime and repository-local Vitest were used):

```text
$env:PATH='C:\Users\SSAFY\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH
.\node_modules\.bin\vitest.cmd run tests/unit/reducer.test.ts tests/ui/YutBoard.test.tsx tests/ui/TurnPanel.test.tsx
```

Observed RED:

- 3 test files failed.
- The two UI suites failed because `YutBoard`, `TurnPanel`, and `GameScreen` did not exist.
- The new reducer test failed because `lastThrow` did not contain `eventId`.
- The 13 pre-existing reducer tests still passed.

These failures matched the missing production behaviors rather than test setup errors.

## GREEN implementation

- Added a fixed 20-node outer path and nine shortcut-node coordinate map.
- Rendered board lines with CSS pseudo-elements/gradients; no SVG asset was authored.
- Grouped board stacks by authoritative position/controller and exposed visible team and stack-count text.
- Rendered pieces and route choices as native buttons, preserving Space/Enter activation and global visible focus styles.
- Enabled a piece only when its exact ID appears in `legalPieceIds`, the local player owns the current turn, and the server stage is `AWAITING_PIECE`.
- Rendered only entries supplied in `legalRoutes`, disabled them for non-current players, and sent their exact route IDs.
- Added Korean stage guidance (`윷을 던지세요`, `움직일 말을 고르세요`, `갈 길을 고르세요`) and Korean result names (`빽도`, `도`, `개`, `걸`, `윷`, `모`).
- Added an authoritative `lastThrow.eventId`. The reducer generates and retains it for each accepted throw, including identical consecutive outcomes.
- Keyed stick animation only to `lastThrow.eventId`; unrelated snapshot/event updates do not restart it. CSS disables the animation under `prefers-reduced-motion: reduce`.
- Routed non-waiting room snapshots from `GameApp` into `GameScreen`.
- `GameScreen` adds the current snapshot version and a new `crypto.randomUUID()` value to every throw, piece, and route command.

Focused GREEN result:

```text
Test Files  3 passed (3)
Tests       28 passed (28)
```

## Verification

- Focused reducer/UI: 28/28 passed.
- Full Vitest suite: 13 files, 118/118 passed.
- ESLint: exit 0, no diagnostics.
- `vinext build`: exit 0; all five build environments completed.
- `git diff --check`: exit 0 (Git emitted only repository line-ending notices).

The first full-suite run exposed one expected public-contract assertion in `tests/unit/rooms.test.ts`; it was updated to include the new authoritative `eventId`, after which the fresh full-suite run passed.

## Files

Created:

- `client/components/YutBoard.tsx`
- `client/components/TurnPanel.tsx`
- `client/components/GameScreen.tsx`
- `tests/ui/YutBoard.test.tsx`
- `tests/ui/TurnPanel.test.tsx`

Modified:

- `client/GameApp.tsx`
- `app/globals.css`
- `shared/protocol.ts`
- `server/game/types.ts`
- `server/game/reducer.ts`
- `tests/unit/reducer.test.ts`
- `tests/unit/rooms.test.ts`

## Self-review

- Authority boundary: callbacks cannot select a client-derived piece or route; disabled/non-rendered controls prevent unsupported intent.
- Mutation check: removing a node, stack grouping, legal-ID filtering, stage branch, Korean result mapping, keyboard-native button behavior, command version/UUID metadata, or throw event identity breaks a focused test.
- Accessibility: native controls, explicit Korean accessible names, live current-turn status, visible focus ring, non-color team/stack text, and reduced-motion handling are present.
- Scope: styling is limited to the core board/turn screen; Task 10 can refine responsive chrome without changing game authority.

## Concerns

- No blocking concern remains.
- The board has a minimal mobile stacking breakpoint only; detailed responsive chrome is intentionally deferred to Task 10.

## Review round 1/5

Addressed both Important review findings with a new RED/GREEN cycle.

RED command:

```text
.\node_modules\.bin\vitest.cmd run tests/unit/reducer.test.ts tests/ui/YutBoard.test.tsx tests/ui/TurnPanel.test.tsx
```

Observed RED:

- 2 focused tests failed while 28 passed.
- The board test could not find canonical `CENTER_B` segment metadata and exposed the old D4 coordinates that pointed toward O0.
- The rapid-animation test observed the same stick DOM subtree for `event-2` and `event-3`, proving that the boolean animation flag did not restart CSS within the 650 ms window.

Minimal fixes:

- Replaced the full-X board background with explicit CSS segment elements. Each segment exposes its physical `data-from`/`data-to` endpoints and draws through a gradient pseudo-element.
- Moved D4 nodes into the upper-right quadrant and represented the authoritative path `O10 → D3_1 → D3_2 → CENTER → D4_2 → D4_1 → O15`; no D4 segment targets O0.
- Keyed the animated stick subtree by `lastThrow.eventId`, so every distinct authoritative throw remounts and triggers a fresh animation even while the prior timer remains active.

GREEN and verification evidence:

- Focused reducer/board/panel: 3 files, 30/30 passed.
- Full Vitest suite: 13 files, 120/120 passed.
- ESLint: exit 0, no diagnostics.
- `vinext build`: exit 0; all five build environments completed.

The deferred Minor same-team-second-member coverage was intentionally not changed in this review round.
