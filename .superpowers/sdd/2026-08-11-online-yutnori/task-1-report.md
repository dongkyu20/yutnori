# Task 1 Report

## Implementation

Initialized the Sites starter; added protocol and Zod schema contracts, Vitest runner configuration, Korean application shell, metadata, and foundational CSS tokens. Removed the starter preview.

## TDD evidence

- RED: `npm test -- tests/unit/schemas.test.ts` failed because `shared/schemas.ts` was missing.
- GREEN: focused schema suite passed with 4 tests.

## Verification

- `npm test`: 1 file, 4 tests passed.
- Production build passed using the starter build command with its Wrangler variable expressed in PowerShell-compatible form.

## Files changed

`app/`, `client/GameApp.tsx`, `shared/protocol.ts`, `shared/schemas.ts`, `tests/unit/schemas.test.ts`, `package.json`, `package-lock.json`, and `vitest.config.ts`.

## Self-review

Validated shared contracts, strict command schemas, nickname normalization, unambiguous room codes, metadata, and starter preview removal. Corrected a CSS token self-reference before final verification.

## Follow-up verification

The build script now uses `vinext build`, removing the POSIX-only environment assignment.

- `npm test -- tests/unit/schemas.test.ts`: 1 file, 4 tests passed.
- `npm test`: 1 file, 4 tests passed.
- `npm run build`: completed successfully.

The initializer's source/config files and .gitignore are included in the follow-up commit; the obsolete rendered-HTML starter test was removed.

## Concerns

The generated starter build script uses POSIX inline environment-variable syntax and does not execute as-is on Windows PowerShell. The equivalent build completed when `WRANGLER_LOG_PATH` was set in PowerShell first.

## Nickname validation fix

Added test coverage in `tests/unit/schemas.test.ts` for emoji, whitespace, digit, and 13-character rejection plus 2- and 12-character acceptance. RED: the focused suite failed for emoji, whitespace, and digit inputs because the schema only enforced length. GREEN: constrained normalized nicknames to ASCII English letters or Hangul syllables while retaining the 2–12 character limit.

Commands and results:

- `npm test -- tests/unit/schemas.test.ts`: 10 tests passed.
- `npm test`: 10 tests passed.
- `npm run build`: completed successfully.
