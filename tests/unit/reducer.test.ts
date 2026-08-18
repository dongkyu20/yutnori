import { describe, expect, it } from "vitest";
import {
  applyGameCommand,
  createGame,
  endTurn,
  removePlayer,
  toPublicGameState,
  MAX_EVENTS,
} from "../../server/game/reducer";
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
    let state = placePiece(individualGame(), "A1-1", { nodeId: "GOAL", routeId: "OUTER" });
    state = placePiece(state, "A1-2", { nodeId: "GOAL", routeId: "OUTER" });
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

  it.each([
    { name: "윷", result: "YUT", distance: 4, prey: "O5" },
    { name: "모", result: "MO", distance: 5, prey: "O6" },
  ] as const)("does not add a throw when the capture was made with $name", ({ result, distance, prey }) => {
    let state = placePiece(individualGame(), "A1-1", { nodeId: "O1", routeId: "OUTER" });
    state = placePiece(state, "B1-1", { nodeId: prey, routeId: "OUTER" });
    // 윷·모는 던지는 순간 이미 한 번 더 던지게 해 준다. 그 결과를 손에 들고 다음을 던진다.
    state = throwYut(state, "A1", result, distance, 1);
    state = throwYut(state, "A1", "DO", 1);

    const next = movePiece(state, "A1", "A1-1", result);

    expect(next.pieces.find((piece) => piece.id === "B1-1")?.status).toBe("HOME");
    // 잡긴 했지만 그 몫은 던질 때 이미 받았으므로 더 주지 않는다.
    expect(next.throwsRemaining).toBe(0);
    expect(next.turnStage).toBe("AWAITING_PIECE");
    // 던질 때의 "한 번 더"는 이미 기록에 있다. 잡은 뒤로는 더 붙지 않아야 한다.
    expect(next.events.at(-1)?.message).toContain("상대 말을 잡았습니다");
  });

  it("still adds a throw when the capture was made with a plain result", () => {
    let state = placePiece(individualGame(), "A1-1", { nodeId: "O1", routeId: "OUTER" });
    state = placePiece(state, "B1-1", { nodeId: "O3", routeId: "OUTER" });
    state = throwYut(state, "A1", "GAE", 2);

    const next = movePiece(state, "A1", "A1-1");

    expect(next.pieces.find((piece) => piece.id === "B1-1")?.status).toBe("HOME");
    expect(next.throwsRemaining).toBe(1);
    expect(next.turnStage).toBe("AWAITING_THROW");
    expect(next.events.at(-1)?.message).toContain("한 번 더 던집니다");
  });

  it("steps a piece on the do square back onto the start as a lapped piece", () => {
    // 도로 들어선 말이 곧바로 빽도를 만나면 출발점으로 되돌아간다. 한 바퀴 돈 것으로 친다.
    let state = placePiece(individualGame(), "A1-1", { nodeId: "O1", routeId: "OUTER" });
    state = throwYut(state, "A1", "BACK_DO", -1);

    const next = movePiece(state, "A1", "A1-1");

    expect(nodeOf(next, "A1-1")).toBe("RETURN");
    expect(next.pieces.find((piece) => piece.id === "A1-1")?.status).toBe("BOARD");
  });

  it("finishes a lapped piece on any forward move", () => {
    let state = placePiece(individualGame(), "A1-1", { nodeId: "RETURN", routeId: "OUTER" });
    state = throwYut(state, "A1", "GEOL", 3);

    const next = movePiece(state, "A1", "A1-1");

    expect(next.pieces.find((piece) => piece.id === "A1-1")?.status).toBe("FINISHED");
    // 말 하나가 났을 뿐이므로 아직 승부는 나지 않는다.
    expect(next.winnerId).toBeNull();
  });

  it("sends a lapped piece back to the do square when back-do comes again", () => {
    let state = placePiece(individualGame(), "A1-1", { nodeId: "RETURN", routeId: "OUTER" });
    state = throwYut(state, "A1", "BACK_DO", -1);

    const next = movePiece(state, "A1", "A1-1");

    expect(nodeOf(next, "A1-1")).toBe("O1");
    expect(next.pieces.find((piece) => piece.id === "A1-1")?.status).toBe("BOARD");
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

  it("alternates two teams and gives only those teams pieces", () => {
    // 팀이 둘뿐이어도 판은 선다. 빈 팀의 말은 아예 놓지 않는다.
    const state = createGame({
      mode: "team",
      players: [
        { id: "A1", teamId: "A" },
        { id: "A2", teamId: "A" },
        { id: "B1", teamId: "B" },
        { id: "B2", teamId: "B" },
      ],
    });

    expect(state.turnOrder).toEqual(["A1", "B1", "A2", "B2"]);
    expect(state.pieces).toHaveLength(8);
    expect(new Set(state.pieces.map((piece) => piece.teamId))).toEqual(new Set(["A", "B"]));
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

  it("걸로 도착점에 닿은 말은 다음 차례에 도가 나와야 난다", () => {
    // 도착점은 설 수 있는 칸이다. 정확히 닿았다고 나는 것이 아니라 한 칸을 더 가야 난다.
    let state = placePiece(individualGame(), "A1-1", { nodeId: "O17", routeId: "OUTER" });
    state = throwYut(state, "A1", "GEOL", 3);
    state = movePiece(state, "A1", "A1-1");

    expect(nodeOf(state, "A1-1")).toBe("GOAL");
    expect(state.pieces.find((piece) => piece.id === "A1-1")?.status).toBe("BOARD");

    // 이동으로 차례는 이미 넘어갔다. 상대가 한 번 두면 다시 내 차례다.
    expect(state.currentPlayerId).toBe("B1");
    state = endTurn(state);
    state = throwYut(state, "A1", "DO", 1);
    state = movePiece(state, "A1", "A1-1");

    expect(state.pieces.find((piece) => piece.id === "A1-1")?.status).toBe("FINISHED");
  });

  it("윷이 나오면 도착점을 지나 그 자리에서 난다", () => {
    let state = placePiece(individualGame(), "A1-1", { nodeId: "O17", routeId: "OUTER" });
    state = throwYut(state, "A1", "YUT", 4, 1);
    state = throwYut(state, "A1", "DO", 1);
    state = movePiece(state, "A1", "A1-1", "YUT");

    expect(state.pieces.find((piece) => piece.id === "A1-1")?.status).toBe("FINISHED");
  });

  it("sets an individual winner after all four owned pieces finish", () => {
    let state = individualGame();
    state = placePiece(state, "A1-1", "FINISHED");
    state = placePiece(state, "A1-2", "FINISHED");
    state = placePiece(state, "A1-3", "FINISHED");
    state = placePiece(state, "A1-4", { nodeId: "GOAL", routeId: "OUTER" });
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
    state = placePiece(state, "A-4", { nodeId: "GOAL", routeId: "OUTER" });
    state = throwYut(state, "A1", "DO", 1);

    const next = movePiece(state, "A1", "A-4");

    expect(next.winnerId).toBe("A");
    expect(next.turnStage).toBe("COMPLETE");
  });

  describe("떠난 사람 지우기", () => {
    const threeWayGame = () =>
      createGame({ mode: "individual", players: [{ id: "A1" }, { id: "B1" }, { id: "C1" }] });

    it("개인전에서는 그 사람 말을 걷고 차례에서 뺀다", () => {
      let state = placePiece(threeWayGame(), "B1-1", { nodeId: "O5", routeId: "OUTER" });
      state = removePlayer(state, "B1", "지수");

      expect(state.players.map((player) => player.id)).toEqual(["A1", "C1"]);
      expect(state.turnOrder).toEqual(["A1", "C1"]);
      expect(state.pieces.some((piece) => piece.ownerId === "B1")).toBe(false);
      expect(state.pieces).toHaveLength(8);
      expect(state.winnerId).toBeNull();
      expect(state.events.at(-1)?.message).toContain("지수");
    });

    it("떠난 사람 차례였으면 다음 사람에게 넘긴다", () => {
      let state = threeWayGame();
      state = throwYut(state, "A1", "DO", 1);
      expect(state.currentPlayerId).toBe("A1");

      state = removePlayer(state, "A1", "민수");

      expect(state.currentPlayerId).toBe("B1");
      expect(state.turnStage).toBe("AWAITING_THROW");
      expect(state.pendingThrows).toEqual([]);
      expect(state.throwsRemaining).toBe(1);
      expect(state.lastThrow).toBeNull();
    });

    it("다른 사람 차례에 떠나면 그 사람이 든 결과는 건드리지 않는다", () => {
      let state = threeWayGame();
      state = throwYut(state, "A1", "DO", 1);
      const held = state.pendingThrows.map((pending) => pending.result);

      state = removePlayer(state, "C1", "영희");

      expect(state.currentPlayerId).toBe("A1");
      expect(state.pendingThrows.map((pending) => pending.result)).toEqual(held);
      expect(state.turnStage).toBe("AWAITING_PIECE");
    });

    it("혼자 남으면 그 사람의 승리로 판을 끝낸다", () => {
      const state = removePlayer(individualGame(), "B1", "지수");

      expect(state.winnerId).toBe("A1");
      expect(state.turnStage).toBe("COMPLETE");
      expect(state.events.at(-1)?.message).toContain("이겼습니다");
    });

    it("팀전에서 한 사람만 떠나면 팀 말은 그대로 두고 남은 팀원이 잇는다", () => {
      const teamState = createGame({
        mode: "team",
        players: [{ id: "A1", teamId: "A" }, { id: "A2", teamId: "A" }, { id: "B1", teamId: "B" }, { id: "B2", teamId: "B" }],
      });

      const state = removePlayer(teamState, "A1", "민수");

      expect(state.turnOrder).toEqual(["B1", "A2", "B2"]);
      expect(state.currentPlayerId).toBe("B1");
      expect(state.pieces.filter((piece) => piece.teamId === "A")).toHaveLength(4);
      expect(state.winnerId).toBeNull();
    });

    it("팀이 통째로 비면 그 팀 말을 걷는다", () => {
      const teamState = createGame({
        mode: "team",
        players: [{ id: "A1", teamId: "A" }, { id: "B1", teamId: "B" }, { id: "B2", teamId: "B" }],
      });

      const state = removePlayer(teamState, "A1", "민수");

      expect(state.pieces.some((piece) => piece.teamId === "A")).toBe(false);
      // B팀만 남았으므로 판은 B팀의 승리로 끝난다.
      expect(state.winnerId).toBe("B");
      expect(state.turnStage).toBe("COMPLETE");
    });

    it("마지막 사람까지 떠나면 승자 없이 끝난다", () => {
      let state = removePlayer(individualGame(), "B1", "지수");
      state = removePlayer(state, "A1", "민수");

      expect(state.players).toEqual([]);
      expect(state.turnOrder).toEqual([]);
      expect(state.winnerId).toBeNull();
      expect(state.turnStage).toBe("COMPLETE");
    });

    it("없는 사람을 지우라고 하면 그대로 둔다", () => {
      const state = individualGame();
      expect(removePlayer(state, "없는사람", "누구")).toBe(state);
    });
  });

  it("keeps the log from growing without bound, and still gives every event its own id", () => {
    // 기록은 스냅숏마다 통째로 실려 나가므로 한 판 내내 쌓게 두면 안 된다.
    // 다만 id를 배열 길이에서 뽑고 있어, 잘라내면 예전 id가 다시 나온다.
    // 그러면 던지기·이동 연출이 "이미 본 것"으로 오인해 재생되지 않는다.
    let state = individualGame();
    const seen = new Set<string>();
    // 던지기마다 달린 id. 이 값이 되풀이되면 윷 굴리는 연출이 "이미 본 던지기"로
    // 여겨 건너뛴다. 기록을 잘라내도 이 값은 계속 자라야 한다.
    const throwIds: string[] = [];
    for (let step = 0; step < 300; step += 1) {
      if (state.turnStage === "AWAITING_THROW") {
        state = throwYut(state, state.currentPlayerId, "DO", 1);
        if (state.lastThrowEventId) throwIds.push(state.lastThrowEventId);
      } else if (state.turnStage === "AWAITING_PIECE") {
        state = movePiece(state, state.currentPlayerId, state.legalPieceIds[0]);
      } else {
        break;
      }
      state.events.forEach((event) => seen.add(event.id));
    }

    expect(throwIds.length).toBeGreaterThan(MAX_EVENTS);
    expect(new Set(throwIds).size).toBe(throwIds.length);

    expect(state.events.length).toBeLessThanOrEqual(MAX_EVENTS);
    // 남아 있는 기록끼리도, 지나간 것과도 id가 겹치지 않는다.
    const ids = state.events.map((event) => event.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(seen.size).toBeGreaterThan(MAX_EVENTS);
    // 시간 순서도 유지된다.
    const stamps = state.events.map((event) => event.createdAt);
    expect([...stamps].sort((left, right) => left - right)).toEqual(stamps);
  });

  it("publishes each held result with the pieces it can move", () => {
    let state = placePiece(individualGame(), "A1-1", { nodeId: "O19", routeId: "OUTER" });
    state = throwYut(state, "A1", "YUT", 4, 1);
    state = throwYut(state, "A1", "BACK_DO", -1);

    const publicState = toPublicGameState(state, 12345);

    expect(publicState.actionExpiresAt).toBe(12345);
    expect(publicState.throwsRemaining).toBe(0);
    // 말마다 그 결과로 갈 곳까지 함께 실어 보낸다. 마우스를 올렸을 때 미리 보여 주는 값이다.
    expect(publicState.pendingThrows).toEqual([
      {
        id: "event-1",
        result: "YUT",
        legalPieceIds: ["A1-1", "A1-2", "A1-3", "A1-4"],
        moves: [
          // 참으로 나는 말은 판에 좌표가 없는 FINISH로 간다. 도착점을 밟고 지나간다.
          { pieceId: "A1-1", destinationNodeId: "FINISH", path: ["GOAL", "FINISH"], finished: true },
          { pieceId: "A1-2", destinationNodeId: "O4", path: ["O1", "O2", "O3", "O4"], finished: false },
          { pieceId: "A1-3", destinationNodeId: "O4", path: ["O1", "O2", "O3", "O4"], finished: false },
          { pieceId: "A1-4", destinationNodeId: "O4", path: ["O1", "O2", "O3", "O4"], finished: false },
        ],
      },
      {
        id: "event-3",
        result: "BACK_DO",
        legalPieceIds: ["A1-1"],
        moves: [{ pieceId: "A1-1", destinationNodeId: "O18", path: ["O18"], finished: false }],
      },
    ]);
    expect(publicState.pieces.find((piece) => piece.id === "A1-1")).toMatchObject({
      nodeId: "O19",
      stackSize: 1,
    });
    expect(publicState).not.toHaveProperty("pendingMoveOptions");
  });

  it("previews the shortcut a piece would take from a junction", () => {
    // 길목에 정확히 선 말은 다음 이동에서 지름길로 빠진다. 미리 보기가 그 길을 그대로 보여 준다.
    let state = placePiece(individualGame(), "A1-1", { nodeId: "O5", routeId: "OUTER" });
    state = throwYut(state, "A1", "GAE", 2);

    const preview = toPublicGameState(state).pendingThrows[0].moves
      .find((move) => move.pieceId === "A1-1");

    expect(preview).toEqual({
      pieceId: "A1-1",
      destinationNodeId: "D1_2",
      path: ["D1_1", "D1_2"],
      finished: false,
    });
  });

  it("gives one preview per stack, not per piece riding it", () => {
    let state = placePiece(individualGame(), "A1-1", { nodeId: "O1", routeId: "OUTER" });
    state = placePiece(state, "A1-2", { nodeId: "O1", routeId: "OUTER" });
    state = {
      ...state,
      pieces: state.pieces.map((piece) =>
        piece.id === "A1-1" || piece.id === "A1-2" ? { ...piece, stackId: "A1-1" } : piece,
      ),
    };
    state = throwYut(state, "A1", "DO", 1);

    const { moves, legalPieceIds } = toPublicGameState(state).pendingThrows[0];

    // 업힌 묶음은 대표 말 하나로만 나오고, 미리 보기도 그 하나에 달린다.
    expect(moves.filter((move) => move.pieceId.startsWith("A1-"))).toContainEqual({
      pieceId: "A1-1",
      destinationNodeId: "O2",
      path: ["O2"],
      finished: false,
    });
    expect(moves.some((move) => move.pieceId === "A1-2")).toBe(false);
    expect(moves.map((move) => move.pieceId)).toEqual(legalPieceIds);
  });

  it("hides held results while the player still has to throw", () => {
    const state = throwYut(individualGame(), "A1", "MO", 5, 1);

    // 아직 던질 차례이므로 고를 말도, 미리 보여 줄 자리도 없다.
    expect(toPublicGameState(state).pendingThrows).toEqual([
      { id: "event-1", result: "MO", legalPieceIds: [], moves: [] },
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
