import { describe, expect, it } from "vitest";
import { chooseAutoCommand } from "../../server/autoAction";
import { createGame } from "../../server/game/reducer";
import type { GameState } from "../../server/game/types";

const game = (): GameState =>
  createGame({ mode: "individual", players: [{ id: "A1" }, { id: "B1" }] });

describe("chooseAutoCommand", () => {
  it("uses the authoritative throw generator while awaiting a throw", () => {
    const command = chooseAutoCommand(game(), () => 0.1);

    expect(command).toEqual({
      type: "THROW",
      actorId: "A1",
      outcome: {
        sticks: [true, true, true, true],
        result: "MO",
        distance: 5,
        bonusThrows: 1,
      },
    });
  });

  it("selects a legal piece using the injected random value", () => {
    const state = {
      ...game(),
      turnStage: "AWAITING_PIECE" as const,
      legalPieceIds: ["A1-1", "A1-2", "A1-3"],
    };

    expect(chooseAutoCommand(state, () => 0.5)).toEqual({
      type: "SELECT_PIECE",
      actorId: "A1",
      pieceId: "A1-2",
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
