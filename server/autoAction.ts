import type { GameCommand, GameState } from "./game/types";
import { throwYut } from "./game/yut";

function randomIndex(length: number, random: () => number): number {
  return Math.min(length - 1, Math.floor(random() * length));
}

export function chooseAutoCommand(state: GameState, random: () => number): GameCommand {
  if (state.turnStage === "AWAITING_THROW") {
    return {
      type: "THROW",
      actorId: state.currentPlayerId,
      outcome: throwYut(random),
    };
  }

  if (state.turnStage === "AWAITING_PIECE" && state.legalPieceIds.length > 0) {
    return {
      type: "SELECT_PIECE",
      actorId: state.currentPlayerId,
      pieceId: state.legalPieceIds[randomIndex(state.legalPieceIds.length, random)],
    };
  }

  if (state.turnStage === "AWAITING_ROUTE" && state.legalRoutes.length > 0) {
    return {
      type: "SELECT_ROUTE",
      actorId: state.currentPlayerId,
      routeId: state.legalRoutes[randomIndex(state.legalRoutes.length, random)],
    };
  }

  throw new Error("자동으로 수행할 수 있는 행동이 없습니다.");
}
