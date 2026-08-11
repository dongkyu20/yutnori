# Online Multiplayer Yutnori Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser-based, server-authoritative Yutnori game supporting 2–4 player free-for-all rooms and four-team, eight-player rooms using guest nicknames and room codes.

**Architecture:** A Sites-hosted Vinext/React client renders server snapshots and sends commands over Socket.IO. A separately deployed Node.js Socket.IO service owns ephemeral rooms, reconnection sessions, timers, and an isolated pure TypeScript game engine; the browser receives the server origin from `NEXT_PUBLIC_GAME_SERVER_URL` and the server restricts CORS to `PUBLIC_ORIGIN`.

**Tech Stack:** TypeScript, React, Vinext/Vite, Node.js 22, Fastify, Socket.IO, Zod, Vitest, Testing Library, Playwright

## Global Constraints

- Individual rooms accept 2–4 players; team rooms require exactly 8 players in four teams of two.
- Team turn order is `A1 → B1 → C1 → D1 → A2 → B2 → C2 → D2`.
- Team members share four pieces and retain the turn until all earned bonus throws are consumed.
- The server alone generates throws and validates turns, moves, routes, captures, stacking, finishes, and wins.
- Yut or Mo earns one bonus throw; capturing earns one bonus throw; both conditions together earn two.
- Each action expires after 45 seconds and is completed by a legal server-selected action.
- Guest nicknames are 2–12 normalized characters and unique case-insensitively within a room.
- Room codes contain six uppercase unambiguous letters or digits.
- Reconnection uses an unguessable browser-stored token; server restarts do not preserve rooms in the first version.
- Empty rooms expire after 10 minutes and finished rooms expire after 30 minutes.
- The UI uses Korean copy, responsive layouts, keyboard controls, visible focus, text status announcements, and reduced-motion support.
- Free-text chat, accounts, persistent records, spectators, bots, and mid-game replacement players remain out of scope.

## File Structure

```text
app/
  layout.tsx                 site metadata and global shell
  page.tsx                   mounts the game application
  globals.css                tokens, board layout, responsive and accessible states
  _sites-preview/            starter-only directory removed in Task 1
client/
  GameApp.tsx                screen routing from connection snapshots
  socket.ts                  typed Socket.IO client and reconnection token storage
  useGameSession.ts          client session state and command API
  components/
    Lobby.tsx                nickname, mode, create/join forms
    WaitingRoom.tsx          roster, teams, ready and host controls
    GameScreen.tsx           game composition and action orchestration
    YutBoard.tsx             accessible board nodes, paths, pieces, and choices
    TurnPanel.tsx            throw/move/path controls and countdown
    PlayerRail.tsx           individual/team status
    EventLog.tsx             text history and live announcements
    EmojiReactions.tsx       predefined reactions only
    ResultDialog.tsx         winner and return-to-lobby action
shared/
  protocol.ts                command, public game snapshot, and error contracts
  schemas.ts                 Zod input schemas and nickname/code normalization
server/
  index.ts                   Fastify/Socket.IO process and health endpoint
  gateway.ts                 socket event validation and room broadcasts
  rooms.ts                   room lifecycle, host, roster, sessions, and timers
  autoAction.ts              deterministic legal fallback selection interface
  game/
    types.ts                 engine state and board value types
    yut.ts                   four-stick outcome generation
    board.ts                 immutable Yut board graph and route calculation
    pieces.ts                stacking, captures, start, backward move, and finish
    reducer.ts               authoritative command/state transition reducer
tests/
  unit/                      engine, schema, and room unit tests
  integration/               Socket.IO room and reconnection tests
  ui/                        React component tests
  e2e/                       multi-browser Playwright flows
playwright.config.ts         desktop and mobile projects
vitest.config.ts             unit, integration, and jsdom projects
```

---

### Task 1: Project Foundation and Shared Protocol

**Files:**
- Create: `shared/protocol.ts`
- Create: `shared/schemas.ts`
- Create: `client/GameApp.tsx`
- Create: `tests/unit/schemas.test.ts`
- Modify: `package.json`
- Modify: `app/layout.tsx`
- Modify: `app/page.tsx`
- Modify: `app/globals.css`
- Delete: `app/_sites-preview/`

**Interfaces:**
- Produces: `GameMode`, `ClientCommand`, `PublicRoomSnapshot`, `ServerError`, `normalizeNickname()`, `roomCodeSchema`, and `nicknameSchema` for every later task.

- [ ] **Step 1: Initialize the Sites starter and test runner**

Run:

```powershell
bash "C:/Users/SSAFY/.codex/plugins/cache/openai-bundled/sites/0.1.34/scripts/init-site.sh" "$PWD"
npm install fastify socket.io socket.io-client zod
npm install -D vitest @vitest/coverage-v8 @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom @playwright/test tsx
npm uninstall react-loading-skeleton
```

Preserve the initializer's package manager and lockfile. Set `scripts.test` to `vitest run` and `scripts.test:watch` to `vitest`.

- [ ] **Step 2: Write failing schema tests**

```ts
import { describe, expect, it } from "vitest";
import { nicknameSchema, normalizeNickname, roomCodeSchema } from "../../shared/schemas";

describe("guest inputs", () => {
  it("normalizes internal whitespace", () => {
    expect(normalizeNickname("  윷   고수 ")).toBe("윷 고수");
  });
  it("rejects a one-character nickname", () => {
    expect(nicknameSchema.safeParse("김").success).toBe(false);
  });
  it("accepts an unambiguous six-character room code", () => {
    expect(roomCodeSchema.parse("7KM2RX")).toBe("7KM2RX");
  });
  it("rejects ambiguous room-code characters", () => {
    expect(roomCodeSchema.safeParse("O0IL12").success).toBe(false);
  });
});
```

- [ ] **Step 3: Run the schema test and confirm red**

Run: `npm test -- tests/unit/schemas.test.ts`

Expected: FAIL because `shared/schemas.ts` does not exist.

- [ ] **Step 4: Define protocol and schemas**

```ts
// shared/protocol.ts
export type GameMode = "individual" | "team";
export type TeamId = "A" | "B" | "C" | "D";
export type RoomPhase = "waiting" | "playing" | "finished";

export type ClientCommand =
  | { type: "CREATE_ROOM"; nickname: string; mode: GameMode }
  | { type: "JOIN_ROOM"; nickname: string; roomCode: string }
  | { type: "SET_READY"; ready: boolean; roomVersion: number; requestId: string }
  | { type: "ASSIGN_TEAM"; playerId: string; teamId: TeamId; roomVersion: number; requestId: string }
  | { type: "KICK_PLAYER"; playerId: string; roomVersion: number; requestId: string }
  | { type: "START_GAME"; roomVersion: number; requestId: string }
  | { type: "THROW_YUT"; roomVersion: number; requestId: string }
  | { type: "SELECT_PIECE"; pieceId: string; roomVersion: number; requestId: string }
  | { type: "SELECT_ROUTE"; routeId: string; roomVersion: number; requestId: string }
  | { type: "REACT"; emoji: "👏" | "🔥" | "😮" | "🎉" };
export type InRoomCommand = Exclude<ClientCommand, { type: "CREATE_ROOM" | "JOIN_ROOM" }>;

export interface ServerError { code: string; message: string; recoverable: boolean }
export interface PublicGameState {
  currentPlayerId: string;
  turnStage: "AWAITING_THROW" | "AWAITING_PIECE" | "AWAITING_ROUTE" | "COMPLETE";
  actionExpiresAt: number | null;
  pieces: Array<{ id: string; ownerId: string; teamId?: TeamId; status: "HOME" | "BOARD" | "FINISHED"; nodeId?: string; stackSize: number }>;
  legalPieceIds: string[];
  legalRoutes: Array<{ routeId: string; destinationNodeId: string }>;
  lastThrow: { result: "BACK_DO" | "DO" | "GAE" | "GEOL" | "YUT" | "MO"; sticks: [boolean, boolean, boolean, boolean] } | null;
  winnerId: string | null;
  events: Array<{ id: string; message: string; createdAt: number }>;
}
export interface PublicRoomSnapshot {
  roomCode: string;
  version: number;
  phase: RoomPhase;
  mode: GameMode;
  hostPlayerId: string;
  players: Array<{ id: string; nickname: string; connected: boolean; ready: boolean; teamId?: TeamId }>;
  game: PublicGameState | null;
}
```

```ts
// shared/schemas.ts
import { z } from "zod";
import type { ClientCommand } from "./protocol";
export const normalizeNickname = (value: string) => value.trim().replace(/\s+/g, " ");
export const nicknameSchema = z.string().transform(normalizeNickname).pipe(z.string().min(2).max(12));
export const roomCodeSchema = z.string().trim().toUpperCase().regex(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
const versioned = { roomVersion: z.number().int().nonnegative(), requestId: z.string().uuid() };
export const clientCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("CREATE_ROOM"), nickname: nicknameSchema, mode: z.enum(["individual", "team"]) }).strict(),
  z.object({ type: z.literal("JOIN_ROOM"), nickname: nicknameSchema, roomCode: roomCodeSchema }).strict(),
  z.object({ type: z.literal("SET_READY"), ready: z.boolean(), ...versioned }).strict(),
  z.object({ type: z.literal("ASSIGN_TEAM"), playerId: z.string().uuid(), teamId: z.enum(["A", "B", "C", "D"]), ...versioned }).strict(),
  z.object({ type: z.literal("KICK_PLAYER"), playerId: z.string().uuid(), ...versioned }).strict(),
  z.object({ type: z.literal("START_GAME"), ...versioned }).strict(),
  z.object({ type: z.literal("THROW_YUT"), ...versioned }).strict(),
  z.object({ type: z.literal("SELECT_PIECE"), pieceId: z.string().min(1), ...versioned }).strict(),
  z.object({ type: z.literal("SELECT_ROUTE"), routeId: z.string().min(1), ...versioned }).strict(),
  z.object({ type: z.literal("REACT"), emoji: z.enum(["👏", "🔥", "😮", "🎉"]) }).strict(),
]);
export const parseClientCommand = (raw: unknown) => clientCommandSchema.safeParse(raw) as z.SafeParseReturnType<unknown, ClientCommand>;
```

- [ ] **Step 5: Replace starter UI and metadata with a minimal Korean shell**

Set the title to `한판윷`, description to `친구들과 실시간으로 즐기는 온라인 윷놀이`, create `client/GameApp.tsx` with an exported `GameApp` that renders `<main><h1>한판윷</h1><p>실시간 대국을 준비하고 있습니다.</p></main>`, render `<GameApp />` from `app/page.tsx`, remove starter preview imports/directories and `codex-preview` metadata, and leave only foundational color/font/focus tokens in `app/globals.css`.

- [ ] **Step 6: Run tests and build**

Run: `npm test -- tests/unit/schemas.test.ts && npm run build`

Expected: schema tests PASS and production build succeeds.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json app client shared tests/unit/schemas.test.ts
git commit -m "chore: initialize online yutnori app"
```

---

### Task 2: Yut Throw Generator

**Files:**
- Create: `server/game/types.ts`
- Create: `server/game/yut.ts`
- Create: `tests/unit/yut.test.ts`

**Interfaces:**
- Produces: `YutResult`, `ThrowOutcome`, and `throwYut(random: () => number): ThrowOutcome`.

- [ ] **Step 1: Write failing deterministic outcome tests**

```ts
import { describe, expect, it } from "vitest";
import { throwYut } from "../../server/game/yut";
const rng = (values: number[]) => { let i = 0; return () => values[i++]; };

describe("throwYut", () => {
  it("returns back-do when only the marked stick is flat", () => {
    expect(throwYut(rng([0.1, 0.9, 0.9, 0.9]))).toMatchObject({ result: "BACK_DO", distance: -1 });
  });
  it("returns yut for four rounded sides", () => {
    expect(throwYut(rng([0.9, 0.9, 0.9, 0.9]))).toMatchObject({ result: "YUT", distance: 4, bonusThrows: 1 });
  });
  it("returns mo for four flat sides", () => {
    expect(throwYut(rng([0.1, 0.1, 0.1, 0.1]))).toMatchObject({ result: "MO", distance: 5, bonusThrows: 1 });
  });
});
```

- [ ] **Step 2: Run tests and confirm red**

Run: `npm test -- tests/unit/yut.test.ts`

Expected: FAIL because `throwYut` is absent.

- [ ] **Step 3: Implement the four-stick generator**

```ts
export type YutResult = "BACK_DO" | "DO" | "GAE" | "GEOL" | "YUT" | "MO";
export interface ThrowOutcome { sticks: [boolean, boolean, boolean, boolean]; result: YutResult; distance: -1 | 1 | 2 | 3 | 4 | 5; bonusThrows: 0 | 1 }

export function throwYut(random: () => number = Math.random): ThrowOutcome {
  const sticks = [random() < 0.5, random() < 0.5, random() < 0.5, random() < 0.5] as ThrowOutcome["sticks"];
  const flatCount = sticks.filter(Boolean).length;
  if (flatCount === 1 && sticks[0]) return { sticks, result: "BACK_DO", distance: -1, bonusThrows: 0 };
  const table = [
    ["YUT", 4, 1], ["DO", 1, 0], ["GAE", 2, 0], ["GEOL", 3, 0], ["MO", 5, 1],
  ] as const;
  const [result, distance, bonusThrows] = table[flatCount];
  return { sticks, result, distance, bonusThrows };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/unit/yut.test.ts`

Expected: PASS for Back-do, Yut, Mo, and add table-driven assertions for Do, Gae, and Geol.

- [ ] **Step 5: Commit**

```bash
git add server/game/types.ts server/game/yut.ts tests/unit/yut.test.ts
git commit -m "feat: add deterministic yut throw engine"
```

---

### Task 3: Board Graph and Legal Routes

**Files:**
- Create: `server/game/board.ts`
- Create: `tests/unit/board.test.ts`
- Modify: `server/game/types.ts`

**Interfaces:**
- Consumes: `PiecePosition` and `MoveOption` from `server/game/types.ts`.
- Produces: `getMoveOptions(position: PiecePosition, distance: number): MoveOption[]` and exported immutable `BOARD_NODES`.

- [ ] **Step 1: Define graph behavior in failing tests**

```ts
import { describe, expect, it } from "vitest";
import { getMoveOptions } from "../../server/game/board";

describe("Yut board routes", () => {
  it("offers outer and center routes from the first corner", () => {
    expect(getMoveOptions({ nodeId: "O5", routeId: "OUTER" }, 2).map(x => x.routeId).sort()).toEqual(["CENTER_A", "OUTER"]);
  });
  it("merges both diagonals at center", () => {
    expect(getMoveOptions({ nodeId: "CENTER", routeId: "CENTER_A" }, 1)[0].nodeId).toBe("D2_2");
  });
  it("returns the prior node for back-do", () => {
    expect(getMoveOptions({ nodeId: "O8", routeId: "OUTER" }, -1)[0].nodeId).toBe("O7");
  });
  it("finishes when movement passes home", () => {
    expect(getMoveOptions({ nodeId: "O19", routeId: "OUTER" }, 2)[0].finished).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests and confirm red**

Run: `npm test -- tests/unit/board.test.ts`

Expected: FAIL because board functions are absent.

- [ ] **Step 3: Implement an immutable graph with explicit route identities**

Use 20 outer nodes (`O0`–`O19`), two five-step diagonal routes from `O5` and `O10`, a shared `CENTER` node, merge toward `O15`, and a terminal `FINISH`. Store both `next` and `previous` edges so Back-do can follow the piece's recorded `routeId`. Return multiple `MoveOption` values only when a move starts at a junction or a backward move has multiple legal predecessors.

```ts
export interface PiecePosition { nodeId: string; routeId: "OUTER" | "CENTER_A" | "CENTER_B" }
export interface MoveOption { routeId: PiecePosition["routeId"]; nodeId: string; finished: boolean; traversed: string[] }
export function getMoveOptions(position: PiecePosition, distance: number): MoveOption[];
```

- [ ] **Step 4: Run exhaustive route tests**

Run: `npm test -- tests/unit/board.test.ts`

Expected: PASS for both junctions, center merge, Back-do, exact home arrival, and passing home.

- [ ] **Step 5: Commit**

```bash
git add server/game/types.ts server/game/board.ts tests/unit/board.test.ts
git commit -m "feat: model yut board routes"
```

---

### Task 4: Piece Rules and Turn Reducer

**Files:**
- Create: `server/game/pieces.ts`
- Create: `server/game/reducer.ts`
- Create: `tests/unit/pieces.test.ts`
- Create: `tests/unit/reducer.test.ts`
- Modify: `server/game/types.ts`

**Interfaces:**
- Consumes: `throwYut()` and `getMoveOptions()`.
- Produces: `createGame()`, `getLegalPieceIds()`, `applyGameCommand()`, `PublicGameState`, and immutable `GameState` transitions.

- [ ] **Step 1: Write failing piece behavior tests**

Cover starting a piece, stacking friendly pieces, capturing an entire opposing stack, returning captured pieces to `HOME`, finishing a stack, rejecting Back-do when every piece is home, and exposing two route choices at a junction.

```ts
expect(movePieces(state, { pieceId: "A-1", option })).toMatchObject({ capturedPieceIds: ["B-1", "B-2"], bonusThrowsEarned: 1 });
```

- [ ] **Step 2: Write failing reducer tests**

```ts
it("keeps the actor after earning yut and capture bonuses", () => {
  const next = applyGameCommand(capturingStateWithYut, { type: "SELECT_ROUTE", routeId: "OUTER" });
  expect(next.bonusThrowsRemaining).toBe(2);
  expect(next.currentPlayerId).toBe("A1");
});

it("rotates the eight-player team order after bonuses", () => {
  expect(endTurn(teamState).currentPlayerId).toBe("B1");
});
```

- [ ] **Step 3: Run tests and confirm red**

Run: `npm test -- tests/unit/pieces.test.ts tests/unit/reducer.test.ts`

Expected: FAIL because piece and reducer modules are absent.

- [ ] **Step 4: Implement immutable piece transitions**

```ts
export type PieceStatus = "HOME" | "BOARD" | "FINISHED";
export interface Piece { id: string; ownerId: string; teamId?: TeamId; status: PieceStatus; position?: PiecePosition; stackId?: string }
export interface MoveResolution { pieces: Piece[]; capturedPieceIds: string[]; movedPieceIds: string[]; bonusThrowsEarned: 0 | 1; finishedOwnerId?: string }
```

`movePieces()` must copy state, move every piece sharing the selected `stackId`, merge friendly stacks at the destination, reset an opposing destination stack, and mark all moved pieces finished when the option finishes.

- [ ] **Step 5: Implement the turn state machine**

```ts
export type TurnStage = "AWAITING_THROW" | "AWAITING_PIECE" | "AWAITING_ROUTE" | "COMPLETE";
export type GameCommand =
  | { type: "THROW"; actorId: string; outcome: ThrowOutcome }
  | { type: "SELECT_PIECE"; actorId: string; pieceId: string }
  | { type: "SELECT_ROUTE"; actorId: string; routeId: string };
export function applyGameCommand(state: GameState, command: GameCommand): GameState;
```

Reject an actor other than `currentPlayerId`; derive legal pieces and routes on the server; consume a no-legal-move Back-do; add throw and capture bonuses; rotate only when no bonuses remain; emit Korean event entries; set the winner after four pieces for an individual or team finish.

- [ ] **Step 6: Run engine tests**

Run: `npm test -- tests/unit/pieces.test.ts tests/unit/reducer.test.ts`

Expected: PASS for personal and team ownership, every turn stage, bonus accumulation, turn rotation, and winner detection.

- [ ] **Step 7: Commit**

```bash
git add server/game tests/unit/pieces.test.ts tests/unit/reducer.test.ts
git commit -m "feat: implement authoritative yut game reducer"
```

---

### Task 5: Room, Lobby, Sessions, and Timers

**Files:**
- Create: `server/rooms.ts`
- Create: `server/autoAction.ts`
- Create: `tests/unit/rooms.test.ts`
- Create: `tests/unit/autoAction.test.ts`

**Interfaces:**
- Consumes: `ClientCommand`, shared schemas, and engine reducer.
- Produces: `RoomService.createRoom()`, `joinRoom()`, `reconnect()`, `dispatch()`, `disconnect()`, `removeExpiredRooms()`, and `chooseAutoCommand()`.

- [ ] **Step 1: Write failing room lifecycle tests**

Test unique six-character codes, case-insensitive nickname rejection, individual capacity four, team capacity eight, readiness requirements, team composition, host-only controls, host reassignment before play, mid-game seat reservation, request-id deduplication, stale-version rejection, and expired empty/finished room deletion.

```ts
const created = service.createRoom({ nickname: "방장", mode: "team" });
expect(created.snapshot.roomCode).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
expect(() => service.dispatch(created.playerId, {
  type: "START_GAME", roomVersion: created.snapshot.version, requestId: crypto.randomUUID(),
})).toThrowError("각 팀에 두 명이 필요합니다");
```

- [ ] **Step 2: Write failing timer/automatic action tests**

Use a fake clock and injected random function. Assert expiration at 45,000 ms, no timer reset on reconnect, legal throw selection, legal piece selection, and legal route selection.

- [ ] **Step 3: Run tests and confirm red**

Run: `npm test -- tests/unit/rooms.test.ts tests/unit/autoAction.test.ts`

Expected: FAIL because services are absent.

- [ ] **Step 4: Implement the room service**

```ts
export interface RoomServiceOptions { now: () => number; random: () => number; schedule: (fn: () => void, ms: number) => unknown; cancel: (id: unknown) => void }
export interface SessionResult { snapshot: PublicRoomSnapshot; playerId: string; reconnectToken: string }
export class RoomService {
  createRoom(input: { nickname: string; mode: GameMode }): SessionResult;
  joinRoom(input: { roomCode: string; nickname: string }): SessionResult;
  reconnect(token: string): SessionResult;
  dispatch(playerId: string, command: InRoomCommand): PublicRoomSnapshot;
  disconnect(playerId: string): void;
}
```

Store only hashes of reconnect tokens, keep processed request IDs per player, increment `version` exactly once per accepted state-changing command, expose snapshots stripped of secrets, delete empty rooms after 10 minutes, and delete finished rooms after 30 minutes.

- [ ] **Step 5: Implement automatic actions**

```ts
export function chooseAutoCommand(state: GameState, random: () => number): GameCommand {
  if (state.turnStage === "AWAITING_THROW") return { type: "THROW", actorId: state.currentPlayerId, outcome: throwYut(random) };
  const choices = state.turnStage === "AWAITING_PIECE" ? state.legalPieceIds : state.legalRoutes;
  const choice = choices[Math.floor(random() * choices.length)];
  return state.turnStage === "AWAITING_PIECE"
    ? { type: "SELECT_PIECE", actorId: state.currentPlayerId, pieceId: choice }
    : { type: "SELECT_ROUTE", actorId: state.currentPlayerId, routeId: choice };
}
```

- [ ] **Step 6: Run room tests**

Run: `npm test -- tests/unit/rooms.test.ts tests/unit/autoAction.test.ts`

Expected: PASS with fake timers and deterministic random selection.

- [ ] **Step 7: Commit**

```bash
git add server/rooms.ts server/autoAction.ts tests/unit/rooms.test.ts tests/unit/autoAction.test.ts
git commit -m "feat: add rooms sessions and turn timers"
```

---

### Task 6: Socket.IO Gateway and Production Server

**Files:**
- Create: `server/gateway.ts`
- Create: `server/index.ts`
- Create: `tests/integration/gateway.test.ts`
- Modify: `package.json`
- Create: `.env.example`

**Interfaces:**
- Consumes: `RoomService` and `ClientCommand`.
- Produces: Socket events `command`, `snapshot`, `server_error`, `session`, `reaction`, and HTTP `GET /health`.

- [ ] **Step 1: Write failing multi-client gateway tests**

Start the server on an ephemeral port, connect two Socket.IO clients, create and join a room, assert both receive the same incremented snapshot, reject an out-of-turn throw, disconnect/reconnect with the issued token, and confirm reaction payloads are restricted to the four allowed emoji.

- [ ] **Step 2: Run the integration test and confirm red**

Run: `npm test -- tests/integration/gateway.test.ts`

Expected: FAIL because the gateway is absent.

- [ ] **Step 3: Implement gateway validation and broadcasts**

```ts
io.on("connection", socket => {
  socket.on("command", raw => {
    const result = parseClientCommand(raw);
    if (!result.success) return socket.emit("server_error", { code: "INVALID_COMMAND", message: "요청 형식이 올바르지 않습니다.", recoverable: true });
    handleValidatedCommand(socket, result.data);
  });
  socket.on("disconnect", () => roomService.disconnect(socket.data.playerId));
});
```

Join sockets to `room:<code>`, emit `session` with `{ playerId, reconnectToken }` only to the joining socket, emit identical public snapshots to the room, and map domain errors to stable Korean `ServerError` messages without stack traces.

- [ ] **Step 4: Implement the executable server**

Create Fastify, attach Socket.IO to its HTTP server, expose `/health`, allow Socket.IO CORS only from `PUBLIC_ORIGIN`, use `PORT` default `3001`, and add scripts `dev:server`, `test`, `test:e2e`, and `start`.

- [ ] **Step 5: Run integration tests and health check**

Run: `npm test -- tests/integration/gateway.test.ts`

Expected: PASS, with sockets closed and server disposed after each test.

- [ ] **Step 6: Commit**

```bash
git add server/index.ts server/gateway.ts tests/integration/gateway.test.ts package.json package-lock.json .env.example
git commit -m "feat: expose realtime game gateway"
```

---

### Task 7: Client Session Hook and Lobby

**Files:**
- Create: `client/socket.ts`
- Create: `client/useGameSession.ts`
- Modify: `client/GameApp.tsx`
- Create: `client/components/Lobby.tsx`
- Create: `tests/ui/Lobby.test.tsx`

**Interfaces:**
- Consumes: shared protocol and Socket.IO gateway.
- Produces: `useGameSession()` with `{ snapshot, error, connectionState, createRoom, joinRoom, sendCommand, leaveRoom }`.

- [ ] **Step 1: Write failing lobby interaction tests**

Render the lobby with an injected session API. Verify trimmed nickname submission, personal/team mode buttons, uppercased room code, inline validation, disabled duplicate submission, and accessible labels.

- [ ] **Step 2: Run UI tests and confirm red**

Run: `npm test -- tests/ui/Lobby.test.tsx`

Expected: FAIL because the component is absent.

- [ ] **Step 3: Implement typed socket/session state**

Connect to the build-time `NEXT_PUBLIC_GAME_SERVER_URL`, persist the reconnect token under `hanpanyut.reconnectToken`, retain `playerId` from the private `session` event, attempt one reconnect when the socket connects, replace local snapshots only when their version is at least the current version, clear stale session data on `ROOM_NOT_FOUND`, and expose connection state as `connecting | connected | reconnecting | offline`.

- [ ] **Step 4: Implement the Korean lobby**

Use heading `같이 던지고, 함께 웃는 한판`, mode copy `2–4명 개인전` and `8명 · 4팀 대항전`, room-code joining, visible field errors, and a short rule summary. Submit only validated values.

- [ ] **Step 5: Run UI tests**

Run: `npm test -- tests/ui/Lobby.test.tsx`

Expected: PASS including keyboard-only submission.

- [ ] **Step 6: Commit**

```bash
git add client/socket.ts client/useGameSession.ts client/GameApp.tsx client/components/Lobby.tsx tests/ui/Lobby.test.tsx
git commit -m "feat: add guest lobby and realtime session"
```

---

### Task 8: Waiting Room and Team Setup

**Files:**
- Create: `client/components/WaitingRoom.tsx`
- Create: `client/components/PlayerRail.tsx`
- Create: `tests/ui/WaitingRoom.test.tsx`
- Modify: `client/GameApp.tsx`

**Interfaces:**
- Consumes: `PublicRoomSnapshot` and `sendCommand()`.
- Produces: waiting-room controls for ready state, copyable code, host kick, team assignment, and valid start.

- [ ] **Step 1: Write failing waiting-room tests**

Assert individual occupancy `2/4`, team slots A–D with two seats each, connected/ready labels, host-only kick and team controls, disabled start until requirements pass, and `START_GAME` using the current room version and a unique request ID.

- [ ] **Step 2: Run tests and confirm red**

Run: `npm test -- tests/ui/WaitingRoom.test.tsx`

Expected: FAIL because waiting-room components are absent.

- [ ] **Step 3: Implement waiting-room presentation and controls**

Render code with a `방 코드 복사` button, identify the host as `방장`, show disconnected status in text, group team players under named/marked A–D cards, require confirmation before kick, and render the server-provided start eligibility reason.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/ui/WaitingRoom.test.tsx`

Expected: PASS for host and non-host snapshots in both modes.

- [ ] **Step 5: Commit**

```bash
git add client/GameApp.tsx client/components/WaitingRoom.tsx client/components/PlayerRail.tsx tests/ui/WaitingRoom.test.tsx
git commit -m "feat: build ready room and team setup"
```

---

### Task 9: Accessible Board and Turn Controls

**Files:**
- Create: `client/components/YutBoard.tsx`
- Create: `client/components/TurnPanel.tsx`
- Create: `client/components/GameScreen.tsx`
- Create: `tests/ui/YutBoard.test.tsx`
- Create: `tests/ui/TurnPanel.test.tsx`
- Modify: `client/GameApp.tsx`

**Interfaces:**
- Consumes: `PublicGameState`, legal piece IDs/routes, and command sender.
- Produces: selectable board pieces/routes and stage-appropriate turn actions.

- [ ] **Step 1: Write failing board and turn-panel tests**

Assert 20 outer nodes plus shortcut nodes, grouped stack count, team text labels, only legal pieces enabled, route options exposed as buttons, current turn announcement, Korean yut result names, disabled actions for non-current players, and Space/Enter activation.

- [ ] **Step 2: Run tests and confirm red**

Run: `npm test -- tests/ui/YutBoard.test.tsx tests/ui/TurnPanel.test.tsx`

Expected: FAIL because game UI components are absent.

- [ ] **Step 3: Implement the board without authored SVG assets**

Use semantic HTML buttons positioned by CSS custom properties from a fixed node-coordinate map. Draw connecting lines with CSS pseudo-elements and gradients, render pieces as high-contrast patterned circles, show stack counts as text, and attach `aria-label="A팀 말 2개, 가운데 지점"`-style labels.

- [ ] **Step 4: Implement stage-specific controls**

Show `윷 던지기`, `움직일 말을 고르세요`, or `갈 길을 고르세요` based on server state. Animate the four sticks only after a new throw event; always display `빽도/도/개/걸/윷/모` text and honor `prefers-reduced-motion`.

- [ ] **Step 5: Run UI tests**

Run: `npm test -- tests/ui/YutBoard.test.tsx tests/ui/TurnPanel.test.tsx`

Expected: PASS for mouse and keyboard interaction states.

- [ ] **Step 6: Commit**

```bash
git add client/GameApp.tsx client/components/YutBoard.tsx client/components/TurnPanel.tsx client/components/GameScreen.tsx tests/ui/YutBoard.test.tsx tests/ui/TurnPanel.test.tsx
git commit -m "feat: render interactive yut board"
```

---

### Task 10: Event Log, Reactions, Results, and Responsive Visual System

**Files:**
- Create: `client/components/EventLog.tsx`
- Create: `client/components/EmojiReactions.tsx`
- Create: `client/components/ResultDialog.tsx`
- Create: `tests/ui/GameChrome.test.tsx`
- Modify: `client/components/GameScreen.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: event history, reaction events, winner, player/team status, and connection state.
- Produces: complete responsive game screen and accessible live updates.

- [ ] **Step 1: Write failing chrome tests**

Assert capped chronological history, `aria-live="polite"` on the newest event, exactly four reaction buttons, winner dialog focus management, offline/reconnecting text, mobile panel toggles, and result return action.

- [ ] **Step 2: Run tests and confirm red**

Run: `npm test -- tests/ui/GameChrome.test.tsx`

Expected: FAIL because components are absent.

- [ ] **Step 3: Implement event, reaction, and result components**

Keep the newest 50 event entries, announce only newly appended events, debounce reactions client-side for 800 ms, display reactions ephemerally without adding them to permanent game history, trap focus in the result dialog, and return to the lobby by clearing only the room session token.

- [ ] **Step 4: Build the finished visual system**

Define hanji `#F4EAD3`, ink `#1F2724`, jade `#147D73`, vermilion `#C84A35`, and gold `#D5A62D`; use a readable Korean system font stack; create a board-first desktop grid and single-column mobile flow at 760 px; add 44 px minimum touch targets, visible `:focus-visible`, high-contrast team patterns, collapsible rail/log panels, safe-area padding, and reduced-motion overrides.

- [ ] **Step 5: Run UI tests and build**

Run: `npm test -- tests/ui && npm run build`

Expected: all UI tests PASS and the production build succeeds.

- [ ] **Step 6: Commit**

```bash
git add client/components app/globals.css tests/ui/GameChrome.test.tsx
git commit -m "feat: complete responsive game experience"
```

---

### Task 11: Multi-Browser End-to-End Flows

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/individual.spec.ts`
- Create: `tests/e2e/team.spec.ts`
- Create: `tests/e2e/reconnect.spec.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: complete server and client.
- Produces: repeatable browser verification for both modes and reconnection.

- [ ] **Step 1: Add deterministic test-only throw injection**

Allow `YUT_RANDOM_SEED` only when `NODE_ENV=test`; create a seeded PRNG at server startup so E2E movement is repeatable. Production must ignore client-provided seeds and must never expose a command that sets throws.

- [ ] **Step 2: Write the individual game flow**

Open two isolated browser contexts, create/join a personal room, ready/start, assert both see the same turn and throw result, make a legal move, verify versions and piece positions match, and play the seeded sequence until one player wins.

- [ ] **Step 3: Write the eight-player team flow**

Open eight contexts, fill teams A–D, verify start remains disabled until all are ready, start, assert turn order through A1/B1/C1/D1/A2/B2/C2/D2, and verify teammates see/control the same four pieces only on their own turns.

- [ ] **Step 4: Write reconnection and timeout flows**

Reload the current player's page and assert seat restoration; close that page, advance the fake test clock or use a test timeout of 1 second configured only in `NODE_ENV=test`, assert an automatic legal action on all remaining clients, then reopen with the stored token and assert the latest version.

- [ ] **Step 5: Run desktop and mobile E2E**

Run: `npm run test:e2e`

Expected: individual, team, and reconnection projects PASS in Chromium desktop and mobile emulation.

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts tests/e2e package.json package-lock.json server/index.ts
git commit -m "test: cover multiplayer browser flows"
```

---

### Task 12: Final Verification and Deployment Packaging

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Modify: `.env.example`
- Modify: `app/layout.tsx`
- Modify: `README.md`

**Interfaces:**
- Consumes: verified web and server build.
- Produces: one WebSocket-capable backend container, a Sites-hosted frontend, health check, and documented environment values.

- [ ] **Step 1: Package the WebSocket backend**

Use a Node 22 multi-stage Docker build for the backend: install with the committed lockfile, run the TypeScript server build, copy production dependencies and server/shared output, expose `3001`, start `node dist/server/index.js`, and health-check `/health`.

- [ ] **Step 2: Add exact run documentation**

Document `npm install`, `npm run dev`, `npm test`, `npm run test:e2e`, `npm run build`, `npm start`, `PORT`, `PUBLIC_ORIGIN`, `NEXT_PUBLIC_GAME_SERVER_URL`, and the first-version limitation that active rooms are lost on server restart. Include the 2–4 player and 8-player mode rules.

- [ ] **Step 3: Set final metadata and social preview**

Set canonical title/description and Open Graph/X metadata to `한판윷 — 실시간 온라인 윷놀이`. Generate exactly one site-specific `public/og.png` only after the finished visual direction is stable; inspect its Korean text and omit `og:image` if the generated card is unusable after one retry.

- [ ] **Step 4: Run the full verification suite**

Run: `npm test && npm run test:e2e && npm run build`

Expected: every unit, integration, UI, and E2E test passes; build exits 0.

- [ ] **Step 5: Smoke-test the production artifact**

Start the production server, verify `GET /health` returns HTTP 200, connect two production Socket.IO clients, create and join one room, and stop the process cleanly.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile .dockerignore .env.example app/layout.tsx README.md
test ! -f public/og.png || git add public/og.png
git commit -m "chore: package online yutnori for deployment"
```

- [ ] **Step 7: Publish backend and frontend**

Deploy the backend container as one application instance for this in-memory first version, confirm its secure WebSocket upgrade, set the frontend's `NEXT_PUBLIC_GAME_SERVER_URL` to that HTTPS origin, publish the frontend through Sites, update backend `PUBLIC_ORIGIN` to the resulting Sites origin, and repeat the two-browser create/join smoke flow against the deployed URL.
