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

describe("game reducer", () => {
  it("creates four home pieces per individual and starts with the first player", () => {
    const state = individualGame();

    expect(state).toMatchObject({
      mode: "individual",
      currentPlayerId: "A1",
      turnOrder: ["A1", "B1"],
      turnStage: "AWAITING_THROW",
      bonusThrowsRemaining: 0,
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

    const next = applyGameCommand(state, { type: "THROW", actorId: "A1", outcome: outcome("DO", 1) });

    expect(state.lastThrow).toBeNull();
    expect(state.turnStage).toBe("AWAITING_THROW");
    expect(next.turnStage).toBe("AWAITING_PIECE");
    expect(next.legalPieceIds).toEqual(["A1-1", "A1-2", "A1-3", "A1-4"]);
    expect(next.lastThrow).toMatchObject({ result: "DO", distance: 1 });
  });

  it("rejects a command from anyone except the current player", () => {
    const state = individualGame();

    expect(() =>
      applyGameCommand(state, { type: "THROW", actorId: "B1", outcome: outcome("DO", 1) }),
    ).toThrowError("현재 차례");
    expect(state.turnStage).toBe("AWAITING_THROW");
  });

  it("resolves a single-route move and rotates when no bonus remains", () => {
    let state = individualGame();
    state = applyGameCommand(state, { type: "THROW", actorId: "A1", outcome: outcome("DO", 1) });

    const next = applyGameCommand(state, { type: "SELECT_PIECE", actorId: "A1", pieceId: "A1-1" });

    expect(next.currentPlayerId).toBe("B1");
    expect(next.turnStage).toBe("AWAITING_THROW");
    expect(next.pieces.find((piece) => piece.id === "A1-1")).toMatchObject({
      status: "BOARD",
      position: { nodeId: "O1", routeId: "OUTER" },
    });
    expect(next.events.at(-1)?.message).toMatch(/[가-힣]/);
  });

  it("requires a server-derived route choice at a junction", () => {
    let state = placePiece(individualGame(), "A1-1", { nodeId: "O5", routeId: "OUTER" });
    state = applyGameCommand(state, { type: "THROW", actorId: "A1", outcome: outcome("GAE", 2) });

    const next = applyGameCommand(state, { type: "SELECT_PIECE", actorId: "A1", pieceId: "A1-1" });

    expect(next.turnStage).toBe("AWAITING_ROUTE");
    expect(next.legalRoutes).toEqual(["OUTER", "CENTER_A"]);
    expect(next.selectedPieceId).toBe("A1-1");
  });

  it("rejects a route the server did not derive", () => {
    let state = placePiece(individualGame(), "A1-1", { nodeId: "O5", routeId: "OUTER" });
    state = applyGameCommand(state, { type: "THROW", actorId: "A1", outcome: outcome("GAE", 2) });
    state = applyGameCommand(state, { type: "SELECT_PIECE", actorId: "A1", pieceId: "A1-1" });

    expect(() =>
      applyGameCommand(state, { type: "SELECT_ROUTE", actorId: "A1", routeId: "CENTER_B" }),
    ).toThrowError("선택할 수 없는 경로");
  });

  it("keeps the actor after earning yut and capture bonuses", () => {
    let state = placePiece(individualGame(), "A1-1", { nodeId: "O5", routeId: "OUTER" });
    state = placePiece(state, "B1-1", { nodeId: "O9", routeId: "OUTER" });
    state = applyGameCommand(state, { type: "THROW", actorId: "A1", outcome: outcome("YUT", 4, 1) });
    state = applyGameCommand(state, { type: "SELECT_PIECE", actorId: "A1", pieceId: "A1-1" });

    const next = applyGameCommand(state, { type: "SELECT_ROUTE", actorId: "A1", routeId: "OUTER" });

    expect(next.bonusThrowsRemaining).toBe(2);
    expect(next.currentPlayerId).toBe("A1");
    expect(next.turnStage).toBe("AWAITING_THROW");
    expect(next.pieces.find((piece) => piece.id === "B1-1")?.status).toBe("HOME");
  });

  it("consumes queued bonuses one throw at a time", () => {
    let state = placePiece(individualGame(), "A1-1", { nodeId: "O5", routeId: "OUTER" });
    state = placePiece(state, "B1-1", { nodeId: "O9", routeId: "OUTER" });
    state = applyGameCommand(state, { type: "THROW", actorId: "A1", outcome: outcome("YUT", 4, 1) });
    state = applyGameCommand(state, { type: "SELECT_PIECE", actorId: "A1", pieceId: "A1-1" });
    state = applyGameCommand(state, { type: "SELECT_ROUTE", actorId: "A1", routeId: "OUTER" });

    const next = applyGameCommand(state, { type: "THROW", actorId: "A1", outcome: outcome("DO", 1) });

    expect(next.bonusThrowsRemaining).toBe(1);
    expect(next.currentPlayerId).toBe("A1");
    expect(next.turnStage).toBe("AWAITING_PIECE");
  });

  it("consumes a no-legal-move back-do and rotates the turn", () => {
    const state = individualGame();

    const next = applyGameCommand(state, {
      type: "THROW",
      actorId: "A1",
      outcome: outcome("BACK_DO", -1),
    });

    expect(next.currentPlayerId).toBe("B1");
    expect(next.turnStage).toBe("AWAITING_THROW");
    expect(next.lastThrow?.result).toBe("BACK_DO");
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
    state = applyGameCommand(state, { type: "THROW", actorId: "A1", outcome: outcome("DO", 1) });

    const next = applyGameCommand(state, { type: "SELECT_PIECE", actorId: "A1", pieceId: "A1-4" });

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
    state = applyGameCommand(state, { type: "THROW", actorId: "A1", outcome: outcome("DO", 1) });

    const next = applyGameCommand(state, { type: "SELECT_PIECE", actorId: "A1", pieceId: "A-4" });

    expect(next.winnerId).toBe("A");
    expect(next.turnStage).toBe("COMPLETE");
  });

  it("builds the public piece and route projection without internal move data", () => {
    let state = placePiece(individualGame(), "A1-1", { nodeId: "O5", routeId: "OUTER" });
    state = applyGameCommand(state, { type: "THROW", actorId: "A1", outcome: outcome("GAE", 2) });
    state = applyGameCommand(state, { type: "SELECT_PIECE", actorId: "A1", pieceId: "A1-1" });

    const publicState = toPublicGameState(state, 12345);

    expect(publicState.actionExpiresAt).toBe(12345);
    expect(publicState.legalRoutes).toEqual([
      { routeId: "OUTER", destinationNodeId: "O7" },
      { routeId: "CENTER_A", destinationNodeId: "D1_2" },
    ]);
    expect(publicState.pieces.find((piece) => piece.id === "A1-1")).toMatchObject({
      nodeId: "O5",
      stackSize: 1,
    });
    expect(publicState).not.toHaveProperty("pendingMoveOptions");
  });

  it("projects a distinct authoritative event id for identical consecutive throws", () => {
    let state = individualGame();
    state = applyGameCommand(state, {
      type: "THROW",
      actorId: "A1",
      outcome: outcome("BACK_DO", -1),
    });
    const firstThrow = toPublicGameState(state).lastThrow;

    state = applyGameCommand(state, {
      type: "THROW",
      actorId: "B1",
      outcome: outcome("BACK_DO", -1),
    });
    const secondThrow = toPublicGameState(state).lastThrow;

    expect(firstThrow).toMatchObject({ eventId: "event-1", result: "BACK_DO" });
    expect(secondThrow).toMatchObject({ eventId: "event-3", result: "BACK_DO" });
    expect(secondThrow?.eventId).not.toBe(firstThrow?.eventId);
  });
});
