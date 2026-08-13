import type { GameMode, TeamId } from "../../shared/protocol";

export type YutResult = "BACK_DO" | "DO" | "GAE" | "GEOL" | "YUT" | "MO";

export interface ThrowOutcome {
  sticks: [boolean, boolean, boolean, boolean];
  result: YutResult;
  distance: -1 | 1 | 2 | 3 | 4 | 5;
  bonusThrows: 0 | 1;
}

/** 아직 말에 배분하지 않은 윷 결과. 던지기가 끝난 뒤 원하는 순서로 사용한다. */
export interface PendingThrow {
  id: string;
  result: YutResult;
  distance: ThrowOutcome["distance"];
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
  lastThrowEventId: string | null;
  pendingThrows: PendingThrow[];
  selectedThrowId: string | null;
  selectedPieceId: string | null;
  legalPieceIds: string[];
  legalRoutes: PiecePosition["routeId"][];
  pendingMoveOptions: MoveOption[];
  /** 현재 참가자가 아직 던져야 하는 횟수. 0이 되어야 말을 옮길 수 있다. */
  throwsRemaining: number;
  winnerId: string | null;
  events: GameEvent[];
}

export type GameCommand =
  | { type: "THROW"; actorId: string; outcome: ThrowOutcome }
  | { type: "SELECT_PIECE"; actorId: string; throwId: string; pieceId: string }
  | { type: "SELECT_ROUTE"; actorId: string; routeId: string };
