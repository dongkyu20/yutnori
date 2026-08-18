import type { GameMode, TeamId, ThrowPower } from "../../shared/protocol";

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

/** 한 번의 이동이 어떻게 벌어졌는지. 판이 연출하는 데만 쓰고 판정에는 쓰지 않는다. */
export interface MoveTrace {
  /** 이 이동을 기록한 이벤트의 id. 연출을 한 번만 재생하는 열쇠. */
  eventId: string;
  /** 함께 움직인 말. 업힌 묶음이면 여럿이다. */
  pieceIds: string[];
  /** 떠난 칸. 출발 대기에서 나왔으면 null. */
  fromNodeId: string | null;
  /** 밟고 지나간 칸을 순서대로. 마지막이 도착 칸이며, 참으로 나면 FINISH다. */
  path: string[];
  /** 이 이동으로 잡힌 상대 말. */
  capturedPieceIds: string[];
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
  /** 마지막 던지기에 실린 힘. 모두가 같은 높이로 연출하도록 스냅숏에 실어 보낸다. */
  lastThrowPower: ThrowPower;
  lastMove: MoveTrace | null;
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
  /**
   * 지금까지 기록한 사건 수. 기록은 잘라내지만 id는 계속 자라야 한다.
   * 배열 길이에서 id를 뽑으면 잘라낸 뒤 예전 id가 다시 나오고,
   * 던지기와 이동 연출이 그 id를 "이미 본 것"으로 여겨 재생하지 않는다.
   */
  eventSequence: number;
}

export type GameCommand =
  | { type: "THROW"; actorId: string; outcome: ThrowOutcome; power?: ThrowPower }
  | { type: "SELECT_PIECE"; actorId: string; throwId: string; pieceId: string }
  | { type: "SELECT_ROUTE"; actorId: string; routeId: string };
