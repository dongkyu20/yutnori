# Task 4: Piece Rules and Turn Reducer

## Implementation

- Added immutable piece transitions for home starts, stack movement, friendly merging, whole-stack capture/reset, finish handling, and individual/team ownership.
- Added legal piece and route derivation on top of the existing `getMoveOptions()` contract, including no-move Back-do behavior and one selectable ID per stack.
- Added the authoritative turn reducer with actor/stage validation, server-rederived piece and route legality, queued bonus consumption, Yut/Mo and capture bonus accumulation, turn rotation, Korean event entries, and individual/team winner detection.
- Added deterministic team ordering as `A1 → B1 → C1 → D1 → A2 → B2 → C2 → D2`, independent of the room player array being grouped by team.
- Added `toPublicGameState()` to strip internal route-option data while projecting public piece stack sizes and route destinations.
- Resolved the shared-center merge rule explicitly: the arriving stack's selected route becomes the route history of the entire merged friendly stack.

## Changed files

- `server/game/types.ts`
- `server/game/pieces.ts`
- `server/game/reducer.ts`
- `tests/unit/pieces.test.ts`
- `tests/unit/reducer.test.ts`

## TDD evidence

### Initial RED

Command:

```powershell
$env:PATH='C:/Users/SSAFY/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin;' + $env:PATH
& .\node_modules\.bin\vitest.cmd run tests/unit/pieces.test.ts tests/unit/reducer.test.ts
```

Result: exit 1. Both suites failed before production code existed:

```text
Cannot find module '../../server/game/pieces'
Cannot find module '../../server/game/reducer'
Test Files  2 failed (2)
```

After adding the opposite-route center merge test, `pieces.test.ts` was rerun before implementation and failed for the same expected missing-module reason.

### Initial GREEN

After the minimal piece and reducer implementation, the same focused command passed:

```text
Test Files  2 passed (2)
Tests  21 passed (21)
```

### Team-order RED/GREEN

Mutation review identified that preserving a team-grouped input array would incorrectly rotate `A1 → A2`. A focused test was changed to supply grouped teams while requiring the designed interleaving.

RED:

```text
expected 'A2' to be 'B1'
Tests  1 failed | 12 skipped (13)
```

GREEN after deriving the interleaved team order:

```text
Test Files  1 passed (1)
Tests  1 passed | 12 skipped (13)
```

### Final focused verification

Targeted ESLint plus both engine suites exited 0:

```text
Test Files  2 passed (2)
Tests  21 passed (21)
```

## Full verification

- Full suite: `node_modules\.bin\vitest.cmd run` — exit 0; 5 files passed, 45 tests passed.
- Production build: `node_modules\.bin\vinext.cmd build` — exit 0; all five stages completed.
- Targeted ESLint: `server/game/types.ts`, `pieces.ts`, `reducer.ts`, and both new tests — exit 0.
- Diff hygiene: `git diff --check` — no whitespace errors.

The standalone repository-wide `tsc --noEmit` remains unavailable as a clean gate because of pre-existing errors outside Task 4: missing Cloudflare worker globals/modules in `db/index.ts` and `worker/index.ts`, plus the existing Zod `SafeParseReturnType` reference in `shared/schemas.ts`. The Vinext production build type/transformation pipeline succeeds.

## Self-review

- Every command checks the current actor, and each command checks its required turn stage.
- Piece and route legality is recomputed from authoritative pieces and the recorded throw; cached legal arrays are never trusted to authorize a selection.
- Bonus throws are consumed when the next throw begins. A new Yut/Mo bonus and a capture bonus are then accumulated, so both conditions produce exactly two queued throws.
- No-legal-move Back-do consumes the current throw and either continues with a queued bonus or rotates.
- All piece transforms return new arrays and objects; tests confirm prior states remain unchanged.
- Captures compare team identity when present and owner identity otherwise; all opponents at the destination return to exact `HOME` objects without stale positions or stack IDs.
- Friendly center merges rewrite every merged piece to the arriving option's route, protecting subsequent forward and backward traversal semantics.
- Team pieces are created once per team (four shared pieces), while turns remain participant-specific and interleaved by team/member slot.
- Winner IDs are participant IDs in individual mode and team IDs in team mode.
- Public projection omits internal `pendingMoveOptions`, exposes route destinations, and calculates stack sizes from internal stack IDs.
- Mutation check coverage includes wrong ownership, missing whole-stack movement/reset, wrong center route history, illegal Back-do starts, trusted illegal routes, lost/overcounted bonuses, wrong team order, missing rotation, and missing winner completion.

## Concerns

- Event `createdAt` values are deterministic logical sequence numbers because the required pure reducer API has no clock input. If wall-clock timestamps are desired, the room layer should stamp them when producing/broadcasting snapshots without making the game reducer impure.
- Vinext retains its existing informational message that some routes cannot yet be statically classified; the build still exits successfully.
