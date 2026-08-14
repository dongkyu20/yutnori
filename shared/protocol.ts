export type GameMode = "individual" | "team";
export type TeamId = "A" | "B" | "C" | "D";
export type RoomPhase = "waiting" | "playing" | "finished";
export type YutResult = "BACK_DO" | "DO" | "GAE" | "GEOL" | "YUT" | "MO";
export type ClientCommand =
  | { type: "CREATE_ROOM"; nickname: string; mode: GameMode }
  | { type: "JOIN_ROOM"; nickname: string; roomCode: string }
  | { type: "SET_READY"; ready: boolean; roomVersion: number; requestId: string }
  | { type: "ASSIGN_TEAM"; playerId: string; teamId: TeamId; roomVersion: number; requestId: string }
  /** 내 말 색을 고른다. 팀전에서는 팀에 먼저 들어온 사람이 팀 색을 정한다. */
  | { type: "CHOOSE_COLOR"; slot: number; roomVersion: number; requestId: string }
  | { type: "KICK_PLAYER"; playerId: string; roomVersion: number; requestId: string }
  /** 스스로 방을 떠난다. 진행 중인 판에서는 그 사람의 말도 함께 걷힌다. */
  | { type: "LEAVE_ROOM"; roomVersion: number; requestId: string }
  | { type: "START_GAME"; roomVersion: number; requestId: string }
  /** 경기가 끝난 방을 같은 참가자와 팀 그대로 대기 상태로 되돌린다. */
  | { type: "PLAY_AGAIN"; roomVersion: number; requestId: string }
  | { type: "THROW_YUT"; roomVersion: number; requestId: string }
  | { type: "SELECT_PIECE"; throwId: string; pieceId: string; roomVersion: number; requestId: string }
  | { type: "SELECT_ROUTE"; routeId: string; roomVersion: number; requestId: string }
  | { type: "REACT"; emoji: "\uD83D\uDC4F" | "\uD83D\uDD25" | "\uD83D\uDE2E" | "\uD83C\uDF89" };
export type InRoomCommand = Exclude<ClientCommand, { type: "CREATE_ROOM" | "JOIN_ROOM" }>;
export interface ServerError { code: string; message: string; recoverable: boolean }
export interface PublicGameState {
  currentPlayerId: string;
  turnStage: "AWAITING_THROW" | "AWAITING_PIECE" | "AWAITING_ROUTE" | "COMPLETE";
  actionExpiresAt: number | null;
  pieces: Array<{ id: string; ownerId: string; teamId?: TeamId; status: "HOME" | "BOARD" | "FINISHED"; nodeId?: string; stackSize: number }>;
  pendingThrows: Array<{
    id: string;
    result: YutResult;
    legalPieceIds: string[];
    /** 이 결과로 각 말이 갈 곳. 말에 마우스를 올렸을 때 미리 보여 준다. */
    moves: Array<{
      pieceId: string;
      /** 도착 칸. 참으로 나면 판에 좌표가 없는 FINISH다. */
      destinationNodeId: string;
      /** 밟고 지나갈 칸을 순서대로. */
      path: string[];
      finished: boolean;
    }>;
  }>;
  throwsRemaining: number;
  legalPieceIds: string[];
  legalRoutes: Array<{ routeId: string; destinationNodeId: string }>;
  lastThrow: { eventId: string; result: YutResult; sticks: [boolean, boolean, boolean, boolean] } | null;
  /** 마지막 이동의 자취. 판이 말을 걸어가게 하고 잡기 연출을 재생하는 데 쓴다. */
  lastMove: {
    eventId: string;
    pieceIds: string[];
    fromNodeId: string | null;
    path: string[];
    capturedPieceIds: string[];
  } | null;
  winnerId: string | null;
  /** 종료 시점의 승자 표시 이름. 승자가 먼저 나가도 결과 문구를 안정적으로 유지한다. */
  winnerName?: string | null;
  events: Array<{ id: string; message: string; createdAt: number }>;
}
export interface PublicRoomSnapshot {
  roomCode: string; version: number; phase: RoomPhase; mode: GameMode; hostPlayerId: string;
  players: Array<{
    id: string;
    nickname: string;
    connected: boolean;
    ready: boolean;
    teamId?: TeamId;
    /** 고른 말 색 자리(0~3). 아직 아무도 고르지 않았으면 없다. 팀전은 팀원이 같은 값을 받는다. */
    colorSlot?: number;
  }>;
  canStart: boolean;
  startEligibilityReason: string | null;
  game: PublicGameState | null;
}
