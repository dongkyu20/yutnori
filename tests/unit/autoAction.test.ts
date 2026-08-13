import { describe, expect, it } from "vitest";
import { chooseAutoCommand } from "../../server/autoAction";
import { createGame } from "../../server/game/reducer";
import type { GameState, PendingThrow } from "../../server/game/types";

const game = (): GameState =>
  createGame({ mode: "individual", players: [{ id: "A1" }, { id: "B1" }] });

const awaitingPiece = (pendingThrows: PendingThrow[]): GameState => ({
  ...game(),
  turnStage: "AWAITING_PIECE",
  throwsRemaining: 0,
  pendingThrows,
});

describe("chooseAutoCommand", () => {
  it("uses the authoritative throw generator while awaiting a throw", () => {
    const command = chooseAutoCommand(game(), () => 0.1);

    expect(command).toEqual({
      type: "THROW",
      actorId: "A1",
      outcome: {
        sticks: [true, true, true, true],
        result: "YUT",
        distance: 4,
        bonusThrows: 1,
      },
    });
  });

  it("selects a held result and one of its legal pieces using the injected random value", () => {
    const state = awaitingPiece([{ id: "event-1", result: "DO", distance: 1 }]);

    expect(chooseAutoCommand(state, () => 0.5)).toEqual({
      type: "SELECT_PIECE",
      actorId: "A1",
      throwId: "event-1",
      pieceId: "A1-3",
    });
  });

  it("never picks a held result that cannot move any piece", () => {
    const state = awaitingPiece([
      { id: "event-1", result: "BACK_DO", distance: -1 },
      { id: "event-3", result: "GAE", distance: 2 },
    ]);

    expect(chooseAutoCommand(state, () => 0)).toMatchObject({
      type: "SELECT_PIECE",
      throwId: "event-3",
      pieceId: "A1-1",
    });
  });

  it("selects a legal route using the injected random value", () => {
    const state = {
      ...game(),
      turnStage: "AWAITING_ROUTE" as const,
      legalRoutes: ["OUTER", "CENTER_A"] as GameState["legalRoutes"],
    };

    expect(chooseAutoCommand(state, () => 0.99)).toEqual({
      type: "SELECT_ROUTE",
      actorId: "A1",
      routeId: "CENTER_A",
    });
  });

  it("rejects automatic selection when no action is legal", () => {
    expect(() =>
      chooseAutoCommand({ ...game(), turnStage: "COMPLETE" }, () => 0),
    ).toThrowError("자동으로 수행할 수 있는 행동이 없습니다");
  });
});
