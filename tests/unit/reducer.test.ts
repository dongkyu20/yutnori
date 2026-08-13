import { describe, expect, it } from "vitest";
import { applyGameCommand, createGame, endTurn, toPublicGameState } from "../../server/game/reducer";
import type { GameState, ThrowOutcome } from "../../server/game/types";

const outcome = (
  result: ThrowOutcome["result"],
  distance: ThrowOutcome["distance"],
  bonusThrows: ThrowOutcome["bonusThrows"] = 0,
): ThrowOutcome => ({ sticks: [false, false, false, false], result, distance, bonusThrows });

const individualGame = () =>
  createGame({
    mode: "individual",
    players: [{ id: "A1" }, { id: "B1" }],
  });

const throwYut = (
  state: GameState,
  actorId: string,
  result: ThrowOutcome["result"],
  distance: ThrowOutcome["distance"],
  bonusThrows: ThrowOutcome["bonusThrows"] = 0,
): GameState =>
  applyGameCommand(state, { type: "THROW", actorId, outcome: outcome(result, distance, bonusThrows) });

/** 아직 쓰지 않은 결과 중 지정한 것으로 말을 옮긴다. 기본값은 가장 먼저 던진 결과다. */
const movePiece = (
  state: GameState,
  actorId: string,
  pieceId: string,
  result?: ThrowOutcome["result"],
): GameState => {
  const pending = result
    ? state.pendingThrows.find((entry) => entry.result === result)
    : state.pendingThrows[0];
  if (!pending) throw new Error(`쓸 수 있는 ${result ?? "윷"} 결과가 없습니다.`);
  return applyGameCommand(state, { type: "SELECT_PIECE", actorId, throwId: pending.id, pieceId });
};

const placePiece = (
  state: GameState,
  pieceId: string,
  value: Pick<NonNullable<GameState["pieces"][number]["position"]>, "nodeId" | "routeId"> | "FINISHED",
): GameState => ({
  ...state,
  pieces: state.pieces.map((piece) =>
    piece.id !== pieceId
      ? piece
      : value === "FINISHED"
        ? { ...piece, status: "FINISHED", position: undefined, stackId: undefined }
        : { ...piece, status: "BOARD", position: value, stackId: piece.id },
  ),
});

const nodeOf = (state: GameState, pieceId: string) =>
  state.pieces.find((piece) => piece.id === pieceId)?.position?.nodeId;

describe("game reducer", () => {
  it("creates four home pieces per individual and starts with the first player", () => {
    const state = individualGame();

    expect(state).toMatchObject({
      mode: "individual",
      currentPlayerId: "A1",
      turnOrder: ["A1", "B1"],
      turnStage: "AWAITING_THROW",
      throwsRemaining: 1,
      pendingThrows: [],
      legalPieceIds: [],
      legalRoutes: [],
      winnerId: null,
    });
    expect(state.pieces).toHaveLength(8);
    expect(state.pieces.filter((piece) => piece.ownerId === "A1")).toHaveLength(4);
    expect(state.pieces.every((piece) => piece.status === "HOME")).toBe(true);
  });

  it("derives legal pieces from a throw and does not mutate the prior state", () => {
    const state = individualGame();

    const next = throwYut(state, "A1", "DO", 1);

    expect(state.lastThrow).toBeNull();
    expect(state.pendingThrows).toEqual([]);
    expect(state.turnStage).toBe("AWAITING_THROW");
    expect(next.turnStage).toBe("AWAITING_PIECE");
    expect(next.legalPieceIds).toEqual(["A1-1", "A1-2", "A1-3", "A1-4"]);
    expect(next.pendingThrows).toMatchObject([{ result: "DO", distance: 1 }]);
    expect(next.lastThrow).toMatchObject({ result: "DO", distance: 1 });
  });

  it("rejects a command from anyone except the current player", () => {
    const state = individualGame();

    expect(() =>
      applyGameCommand(state, { type: "THROW", actorId: "B1", outcome: outcome("DO", 1) }),
    ).toThrowError("현재 차례");
    expect(state.turnStage).toBe("AWAITING_THROW");
  });

  it("resolves a move and rotates when nothing is left to throw or place", () => {
    const state = throwYut(individualGame(), "A1", "DO", 1);

    const next = movePiece(state, "A1", "A1-1");

    expect(next.currentPlayerId).toBe("B1");
    expect(next.turnStage).toBe("AWAITING_THROW");
    expect(next.pendingThrows).toEqual([]);
    expect(next.pieces.find((piece) => piece.id === "A1-1")).toMatchObject({
      status: "BOARD",
      position: { nodeId: "O1", routeId: "OUTER" },
    });
    expect(next.events.at(-1)?.message).toMatch(/[가-힣]/);
  });

  it("keeps throwing while yut or mo appears and holds every result until the throwing stops", () => {
    let state = throwYut(individualGame(), "A1", "YUT", 4, 1);

    expect(state.turnStage).toBe("AWAITING_THROW");
    expect(state.throwsRemaining).toBe(1);
    expect(state.legalPieceIds).toEqual([]);

    state = throwYut(state, "A1", "MO", 5, 1);
    expect(state.turnStage).toBe("AWAITING_THROW");

    state = throwYut(state, "A1", "DO", 1);
    expect(state.turnStage).toBe("AWAITING_PIECE");
    expect(state.throwsRemaining).toBe(0);
    expect(state.pendingThrows.map((pending) => pending.result)).toEqual(["YUT", "MO", "DO"]);
  });

  it("lets the player choose which held result to spend and on which piece", () => {
    let state = throwYut(individualGame(), "A1", "YUT", 4, 1);
    state = throwYut(state, "A1", "DO", 1);

    state = movePiece(state, "A1", "A1-1", "DO");
    expect(nodeOf(state, "A1-1")).toBe("O1");
    expect(state.currentPlayerId).toBe("A1");
    expect(state.turnStage).toBe("AWAITING_PIECE");
    expect(state.pendingThrows.map((pending) => pending.result)).toEqual(["YUT"]);

    state = movePiece(state, "A1", "A1-1", "YUT");
    expect(nodeOf(state, "A1-1")).toBe("O5");
    expect(state.pendingThrows).toEqual([]);
    expect(state.currentPlayerId).toBe("B1");
  });

  it("takes the shortcut without asking when a piece stops on a junction", () => {
    let state = placePiece(individualGame(), "A1-1", { nodeId: "O5", routeId: "OUTER" });
    state = throwYut(state, "A1", "GAE", 2);

    const next = movePiece(state, "A1", "A1-1");

    expect(next.turnStage).not.toBe("AWAITING_ROUTE");
    expect(next.pieces.find((piece) => piece.id === "A1-1")).toMatchObject({
      position: { nodeId: "D1_2", routeId: "CENTER_A" },
    });
  });

  it("validates a route against the options the server derived", () => {
    const base = placePiece(individualGame(), "A1-1", { nodeId: "O1", routeId: "OUTER" });
    const routeState: GameState = {
      ...base,
      turnStage: "AWAITING_ROUTE",
      pendingThrows: [{ id: "event-1", result: "DO", distance: 1 }],
      throwsRemaining: 0,
      selectedThrowId: "event-1",
      selectedPieceId: "A1-1",
      legalRoutes: ["OUTER"],
      pendingMoveOptions: [{ routeId: "OUTER", nodeId: "O2", finished: false, traversed: ["O2"] }],
    };

    expect(() =>
      applyGameCommand(routeState, { type: "SELECT_ROUTE", actorId: "A1", routeId: "CENTER_A" }),
    ).toThrowError("선택할 수 없는 경로");
    expect(
      applyGameCommand(routeState, { type: "SELECT_ROUTE", actorId: "A1", routeId: "OUTER" }),
    ).toMatchObject({ currentPlayerId: "B1" });
  });

  it("rejects a held result the current player does not have", () => {
    const state = throwYut(individualGame(), "A1", "DO", 1);

    expect(() =>
      applyGameCommand(state, {
        type: "SELECT_PIECE",
        actorId: "A1",
        throwId: "event-999",
        pieceId: "A1-1",
      }),
    ).toThrowError("사용할 수 없는 윷 결과");
  });

  it("grants one more throw after a capture and keeps the unspent results", () => {
    let state = placePiece(individualGame(), "A1-1", { nodeId: "O1", routeId: "OUTER" });
    state = placePiece(state, "B1-1", { nodeId: "O2", routeId: "OUTER" });
    state = throwYut(state, "A1", "YUT", 4, 1);
    state = throwYut(state, "A1", "DO", 1);

    const next = movePiece(state, "A1", "A1-1", "DO");

    expect(next.pieces.find((piece) => piece.id === "B1-1")?.status).toBe("HOME");
    expect(next.throwsRemaining).toBe(1);
    expect(next.turnStage).toBe("AWAITING_THROW");
    expect(next.currentPlayerId).toBe("A1");
    expect(next.pendingThrows.map((pending) => pending.result)).toEqual(["YUT"]);
  });

  it("traces a plain move with the path it stepped through", () => {
    let state = placePiece(individualGame(), "A1-1", { nodeId: "O1", routeId: "OUTER" });
    state = throwYut(state, "A1", "GAE", 2);

    const next = movePiece(state, "A1", "A1-1");

    expect(next.lastMove).toEqual({
      eventId: next.events.at(-1)?.id,
      pieceIds: ["A1-1"],
      fromNodeId: "O1",
      path: ["O2", "O3"],
      capturedPieceIds: [],
    });
  });

  it("traces the captured pieces so the board can knock them back", () => {
    let state = placePiece(individualGame(), "A1-1", { nodeId: "O1", routeId: "OUTER" });
    state = placePiece(state, "B1-1", { nodeId: "O2", routeId: "OUTER" });
    state = throwYut(state, "A1", "DO", 1);

    const next = movePiece(state, "A1", "A1-1");

    expect(next.lastMove?.capturedPieceIds).toEqual(["B1-1"]);
    expect(next.lastMove?.path).toEqual(["O2"]);
    expect(next.lastMove?.fromNodeId).toBe("O1");
  });

  it("traces a piece leaving the home rack with no departure node", () => {
    const state = throwYut(individualGame(), "A1", "DO", 1);

    const next = movePiece(state, "A1", "A1-1");

    expect(next.lastMove?.fromNodeId).toBeNull();
    expect(next.lastMove?.path).toEqual(["O1"]);
  });

  it("traces a back-do stepping backwards", () => {
    let state = placePiece(individualGame(), "A1-1", { nodeId: "O3", routeId: "OUTER" });
    state = throwYut(state, "A1", "BACK_DO", -1);

    const next = movePiece(state, "A1", "A1-1");

    expect(next.lastMove?.path).toEqual(["O2"]);
    expect(next.lastMove?.fromNodeId).toBe("O3");
  });

  it("traces every piece of a stack and the virtual finish node", () => {
    let state = placePiece(individualGame(), "A1-1", { nodeId: "O19", routeId: "OUTER" });
    state = placePiece(state, "A1-2", { nodeId: "O19", routeId: "OUTER" });
    // 같은 칸의 두 말을 한 묶음으로 묶어 함께 움직이게 한다.
    state = {
      ...state,
      pieces: state.pieces.map((piece) =>
        piece.id === "A1-1" || piece.id === "A1-2" ? { ...piece, stackId: "A1-1" } : piece,
      ),
    };
    state = throwYut(state, "A1", "DO", 1);

    const next = movePiece(state, "A1", "A1-1");

    expect(next.lastMove?.pieceIds).toEqual(["A1-1", "A1-2"]);
    expect(next.lastMove?.path).toEqual(["FINISH"]);
  });

  it("publishes the trace to the client and keeps the arrays separate", () => {
    let state = placePiece(individualGame(), "A1-1", { nodeId: "O1", routeId: "OUTER" });
    state = throwYut(state, "A1", "GAE", 2);
    const next = movePiece(state, "A1", "A1-1");

    const published = toPublicGameState(next);

    expect(published.lastMove?.path).toEqual(["O2", "O3"]);
    expect(published.lastMove?.path).not.toBe(next.lastMove?.path);
    expect(toPublicGameState(individualGame()).lastMove).toBeNull();
  });

  it("consumes a no-legal-move back-do and rotates the turn", () => {
    const next = throwYut(individualGame(), "A1", "BACK_DO", -1);

    expect(next.currentPlayerId).toBe("B1");
    expect(next.turnStage).toBe("AWAITING_THROW");
    expect(next.pendingThrows).toEqual([]);
    expect(next.lastThrow?.result).toBe("BACK_DO");
    expect(next.events.at(-1)?.message).toContain("이동할 수 있는 말이 없습니다");
  });

  it("keeps a back-do usable once another held result puts a piece on the board", () => {
    let state = throwYut(individualGame(), "A1", "MO", 5, 1);
    state = throwYut(state, "A1", "BACK_DO", -1);

    expect(state.turnStage).toBe("AWAITING_PIECE");
    state = movePiece(state, "A1", "A1-1", "MO");

    expect(state.turnStage).toBe("AWAITING_PIECE");
    expect(state.legalPieceIds).toEqual(["A1-1"]);
    state = movePiece(state, "A1", "A1-1", "BACK_DO");
    expect(nodeOf(state, "A1-1")).toBe("O4");
  });

  it("rotates the eight-player team order after bonuses", () => {
    const teamState = createGame({
      mode: "team",
      players: [
        { id: "A1", teamId: "A" },
        { id: "A2", teamId: "A" },
        { id: "B1", teamId: "B" },
        { id: "B2", teamId: "B" },
        { id: "C1", teamId: "C" },
        { id: "C2", teamId: "C" },
        { id: "D1", teamId: "D" },
        { id: "D2", teamId: "D" },
      ],
    });

    expect(endTurn(teamState).currentPlayerId).toBe("B1");
    expect(teamState.turnOrder).toEqual(["A1", "B1", "C1", "D1", "A2", "B2", "C2", "D2"]);
    expect(teamState.pieces).toHaveLength(16);
    expect(teamState.pieces.filter((piece) => piece.teamId === "A")).toHaveLength(4);
  });

  it("sets an individual winner after all four owned pieces finish", () => {
    let state = individualGame();
    state = placePiece(state, "A1-1", "FINISHED");
    state = placePiece(state, "A1-2", "FINISHED");
    state = placePiece(state, "A1-3", "FINISHED");
    state = placePiece(state, "A1-4", { nodeId: "O19", routeId: "OUTER" });
    state = throwYut(state, "A1", "DO", 1);

    const next = movePiece(state, "A1", "A1-4");

    expect(next.winnerId).toBe("A1");
    expect(next.turnStage).toBe("COMPLETE");
  });

  it("sets the team id as winner after all four shared pieces finish", () => {
    let state = createGame({
      mode: "team",
      players: [
        { id: "A1", teamId: "A" },
        { id: "B1", teamId: "B" },
        { id: "C1", teamId: "C" },
        { id: "D1", teamId: "D" },
        { id: "A2", teamId: "A" },
        { id: "B2", teamId: "B" },
        { id: "C2", teamId: "C" },
        { id: "D2", teamId: "D" },
      ],
    });
    state = placePiece(state, "A-1", "FINISHED");
    state = placePiece(state, "A-2", "FINISHED");
    state = placePiece(state, "A-3", "FINISHED");
    state = placePiece(state, "A-4", { nodeId: "O19", routeId: "OUTER" });
    state = throwYut(state, "A1", "DO", 1);

    const next = movePiece(state, "A1", "A-4");

    expect(next.winnerId).toBe("A");
    expect(next.turnStage).toBe("COMPLETE");
  });

  it("publishes each held result with the pieces it can move", () => {
    let state = placePiece(individualGame(), "A1-1", { nodeId: "O19", routeId: "OUTER" });
    state = throwYut(state, "A1", "YUT", 4, 1);
    state = throwYut(state, "A1", "BACK_DO", -1);

    const publicState = toPublicGameState(state, 12345);

    expect(publicState.actionExpiresAt).toBe(12345);
    expect(publicState.throwsRemaining).toBe(0);
    expect(publicState.pendingThrows).toEqual([
      { id: "event-1", result: "YUT", legalPieceIds: ["A1-1", "A1-2", "A1-3", "A1-4"] },
      { id: "event-3", result: "BACK_DO", legalPieceIds: ["A1-1"] },
    ]);
    expect(publicState.pieces.find((piece) => piece.id === "A1-1")).toMatchObject({
      nodeId: "O19",
      stackSize: 1,
    });
    expect(publicState).not.toHaveProperty("pendingMoveOptions");
  });

  it("hides held results while the player still has to throw", () => {
    const state = throwYut(individualGame(), "A1", "MO", 5, 1);

    expect(toPublicGameState(state).pendingThrows).toEqual([
      { id: "event-1", result: "MO", legalPieceIds: [] },
    ]);
  });

  it("projects a distinct authoritative event id for identical consecutive throws", () => {
    let state = individualGame();
    state = throwYut(state, "A1", "BACK_DO", -1);
    const firstThrow = toPublicGameState(state).lastThrow;

    state = throwYut(state, "B1", "BACK_DO", -1);
    const secondThrow = toPublicGameState(state).lastThrow;

    expect(firstThrow).toMatchObject({ eventId: "event-1", result: "BACK_DO" });
    expect(secondThrow).toMatchObject({ eventId: "event-3", result: "BACK_DO" });
    expect(secondThrow?.eventId).not.toBe(firstThrow?.eventId);
  });
});
