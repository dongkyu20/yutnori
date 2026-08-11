export type GameMode = "individual" | "team";
export type TeamId = "A" | "B" | "C" | "D";
export type RoomPhase = "waiting" | "playing" | "finished";
export type ClientCommand =
  | { type: "CREATE_ROOM"; nickname: string; mode: GameMode }
  | { type: "JOIN_ROOM"; nickname: string; roomCode: string }
  | { type: "SET_READY"; ready: boolean; roomVersion: number; requestId: string }
  | { type: "ASSIGN_TEAM"; playerId: string; teamId: TeamId; roomVersion: number; requestId: string }
  | { type: "KICK_PLAYER"; playerId: string; roomVersion: number; requestId: string }
  | { type: "START_GAME"; roomVersion: number; requestId: string }
  | { type: "THROW_YUT"; roomVersion: number; requestId: string }
  | { type: "SELECT_PIECE"; pieceId: string; roomVersion: number; requestId: string }
  | { type: "SELECT_ROUTE"; routeId: string; roomVersion: number; requestId: string }
  | { type: "REACT"; emoji: "\uD83D\uDC4F" | "\uD83D\uDD25" | "\uD83D\uDE2E" | "\uD83C\uDF89" };
export type InRoomCommand = Exclude<ClientCommand, { type: "CREATE_ROOM" | "JOIN_ROOM" }>;
export interface ServerError { code: string; message: string; recoverable: boolean }
export interface PublicGameState {
  currentPlayerId: string;
  turnStage: "AWAITING_THROW" | "AWAITING_PIECE" | "AWAITING_ROUTE" | "COMPLETE";
  actionExpiresAt: number | null;
  pieces: Array<{ id: string; ownerId: string; teamId?: TeamId; status: "HOME" | "BOARD" | "FINISHED"; nodeId?: string; stackSize: number }>;
  legalPieceIds: string[];
  legalRoutes: Array<{ routeId: string; destinationNodeId: string }>;
  lastThrow: { result: "BACK_DO" | "DO" | "GAE" | "GEOL" | "YUT" | "MO"; sticks: [boolean, boolean, boolean, boolean] } | null;
  winnerId: string | null;
  events: Array<{ id: string; message: string; createdAt: number }>;
}
export interface PublicRoomSnapshot {
  roomCode: string; version: number; phase: RoomPhase; mode: GameMode; hostPlayerId: string;
  players: Array<{ id: string; nickname: string; connected: boolean; ready: boolean; teamId?: TeamId }>;
  canStart: boolean;
  startEligibilityReason: string | null;
  game: PublicGameState | null;
}
