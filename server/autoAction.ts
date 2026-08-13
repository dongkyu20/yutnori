import { pendingThrowChoices } from "./game/reducer";
import type { GameCommand, GameState } from "./game/types";
import { throwYut } from "./game/yut";

function randomIndex(length: number, random: () => number): number {
  return Math.min(length - 1, Math.floor(random() * length));
}

function pickRandom<T>(values: readonly T[], random: () => number): T {
  return values[randomIndex(values.length, random)];
}

export function chooseAutoCommand(state: GameState, random: () => number): GameCommand {
  if (state.turnStage === "AWAITING_THROW") {
    return {
      type: "THROW",
      actorId: state.currentPlayerId,
      outcome: throwYut(random),
    };
  }

  if (state.turnStage === "AWAITING_PIECE") {
    const usableThrows = pendingThrowChoices(state).filter(
      (choice) => choice.legalPieceIds.length > 0,
    );
    if (usableThrows.length > 0) {
      const choice = pickRandom(usableThrows, random);
      return {
        type: "SELECT_PIECE",
        actorId: state.currentPlayerId,
        throwId: choice.id,
        pieceId: pickRandom(choice.legalPieceIds, random),
      };
    }
  }

  if (state.turnStage === "AWAITING_ROUTE" && state.legalRoutes.length > 0) {
    return {
      type: "SELECT_ROUTE",
      actorId: state.currentPlayerId,
      routeId: pickRandom(state.legalRoutes, random),
    };
  }

  throw new Error("자동으로 수행할 수 있는 행동이 없습니다.");
}
