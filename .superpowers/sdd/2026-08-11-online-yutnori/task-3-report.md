# Task 3: Board Graph and Legal Routes

## Changed files

- `server/game/types.ts` — added `PiecePosition` and `MoveOption` contracts.
- `server/game/board.ts` — added the frozen 20-node outer circuit, both center routes, `FINISH`, and legal forward/backward move resolution.
- `tests/unit/board.test.ts` — added focused behavior tests for both junctions, both center exits, route-aware Back-do, and exact/over-home finishes.

## TDD evidence

### RED

Command:

```powershell
$env:PATH = 'C:\Users\SSAFY\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH
& .\node_modules\.bin\vitest.cmd run tests/unit/board.test.ts
```

Result: exit 1. `tests/unit/board.test.ts` failed before production code existed with the expected error:

```text
Cannot find module '../../server/game/board' imported from .../tests/unit/board.test.ts
```

The requested `npm test -- tests/unit/board.test.ts` command could not run because `npm` is absent from the supplied runtime. The required local Vitest executable was used instead.

### GREEN

The same local Vitest command passed after the minimal graph implementation:

```text
Test Files  1 passed (1)
Tests  8 passed (8)
```

## Final verification

- Full suite: `node_modules\.bin\vitest.cmd run` — 3 files passed, 24 tests passed.
- Build: `node_modules\.bin\vinext.cmd build` — exit 0; all five build stages completed.
- Diff hygiene: `git diff --check` — no whitespace errors.

## Self-review

- `BOARD_NODES` includes `O0` through `O19`, both diagonal paths, the shared `CENTER`, their merge at `O15`, and `FINISH`.
- Nodes and all nested edge maps/branch lists are frozen, so the exported topology is immutable at runtime.
- Forward route selection happens only at `O5` and `O10`; the recorded route identity determines the center exit and Back-do predecessor.
- The traversal stops immediately on `FINISH`, making both exact arrival and an over-home move finish correctly.
- Tests use literal expected options/traversal paths and exercise real board code without mocks. Mutations to a branch edge, center exit, predecessor, or finish edge are each caught by at least one test.

## Concerns

No functional concerns identified. The repository's `vinext build` reports its existing informational note that dynamic routes cannot be statically classified; it still exits successfully and is unrelated to the board module.
