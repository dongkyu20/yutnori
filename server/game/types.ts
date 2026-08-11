import type { GameMode, TeamId } from "../../shared/protocol";

export type YutResult = "BACK_DO" | "DO" | "GAE" | "GEOL" | "YUT" | "MO";

export interface ThrowOutcome {
  sticks: [boolean, boolean, boolean, boolean];
  result: YutResult;
  distance: -1 | 1 | 2 | 3 | 4 | 5;
  bonusThrows: 0 | 1;
}

export interface PiecePosition {
  nodeId: string;
  routeId: "OUTER" | "CENTER_A" | "CENTER_B";
}

export interface MoveOption {
  routeId: PiecePosition["routeId"];
  nodeId: string;
  finished: boolean;
  traversed: string[];
}

export type PieceStatus = "HOME" | "BOARD" | "FINISHED";

export interface Piece {
  id: string;
  ownerId: string;
  teamId?: TeamId;
  status: PieceStatus;
  position?: PiecePosition;
  stackId?: string;
}

export interface PieceController {
  ownerId: string;
  teamId?: TeamId;
}

export interface MoveResolution {
  pieces: Piece[];
  capturedPieceIds: string[];
  movedPieceIds: string[];
  bonusThrowsEarned: 0 | 1;
  finishedOwnerId?: string;
}

export type TurnStage = "AWAITING_THROW" | "AWAITING_PIECE" | "AWAITING_ROUTE" | "COMPLETE";

export interface GamePlayer {
  id: string;
  teamId?: TeamId;
}

export interface GameEvent {
  id: string;
  message: string;
  createdAt: number;
}

export interface GameState {
  mode: GameMode;
  players: GamePlayer[];
  turnOrder: string[];
  currentPlayerId: string;
  turnStage: TurnStage;
  pieces: Piece[];
  lastThrow: ThrowOutcome | null;
  selectedPieceId: string | null;
  legalPieceIds: string[];
  legalRoutes: PiecePosition["routeId"][];
  pendingMoveOptions: MoveOption[];
  bonusThrowsRemaining: number;
  winnerId: string | null;
  events: GameEvent[];
}

export type GameCommand =
  | { type: "THROW"; actorId: string; outcome: ThrowOutcome }
  | { type: "SELECT_PIECE"; actorId: string; pieceId: string }
  | { type: "SELECT_ROUTE"; actorId: string; routeId: string };
