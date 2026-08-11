import type { GameMode, PublicGameState, TeamId } from "../../shared/protocol";
import { getLegalMoveOptions, getLegalPieceIds, movePieces } from "./pieces";
import type {
  GameCommand,
  GameEvent,
  GamePlayer,
  GameState,
  MoveOption,
  Piece,
  PieceController,
  ThrowOutcome,
} from "./types";

export type { GameCommand, GameState } from "./types";

const TEAM_IDS: readonly TeamId[] = ["A", "B", "C", "D"];

export interface CreateGameInput {
  mode: GameMode;
  players: GamePlayer[];
}

export class GameActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameActionError";
  }
}

function createIndividualPieces(players: readonly GamePlayer[]): Piece[] {
  return players.flatMap((player) =>
    Array.from({ length: 4 }, (_, index): Piece => ({
      id: `${player.id}-${index + 1}`,
      ownerId: player.id,
      status: "HOME",
    })),
  );
}

function createTeamPieces(players: readonly GamePlayer[]): Piece[] {
  const presentTeams = new Set(players.map((player) => player.teamId));
  return TEAM_IDS.filter((teamId) => presentTeams.has(teamId)).flatMap((teamId) =>
    Array.from({ length: 4 }, (_, index): Piece => ({
      id: `${teamId}-${index + 1}`,
      ownerId: teamId,
      teamId,
      status: "HOME",
    })),
  );
}

function createTurnOrder(mode: GameMode, players: readonly GamePlayer[]): string[] {
  if (mode === "individual") {
    return players.map((player) => player.id);
  }

  return [0, 1].flatMap((memberIndex) =>
    TEAM_IDS.flatMap((teamId) => {
      const member = players.filter((player) => player.teamId === teamId)[memberIndex];
      return member ? [member.id] : [];
    }),
  );
}

export function createGame(input: CreateGameInput): GameState {
  if (input.players.length === 0) {
    throw new Error("게임에는 참가자가 필요합니다.");
  }

  const players = input.players.map((player) => ({ ...player }));
  const turnOrder = createTurnOrder(input.mode, players);
  return {
    mode: input.mode,
    players,
    turnOrder,
    currentPlayerId: turnOrder[0],
    turnStage: "AWAITING_THROW",
    pieces: input.mode === "team" ? createTeamPieces(players) : createIndividualPieces(players),
    lastThrow: null,
    selectedPieceId: null,
    legalPieceIds: [],
    legalRoutes: [],
    pendingMoveOptions: [],
    bonusThrowsRemaining: 0,
    winnerId: null,
    events: [],
  };
}

function currentController(state: GameState): PieceController {
  const player = state.players.find((candidate) => candidate.id === state.currentPlayerId);
  if (!player) {
    throw new Error("현재 참가자를 찾을 수 없습니다.");
  }
  return { ownerId: player.id, teamId: player.teamId };
}

function nextEvent(events: readonly GameEvent[], message: string): GameEvent {
  const sequence = events.length + 1;
  return { id: `event-${sequence}`, message, createdAt: sequence };
}

function withEvent(state: GameState, message: string): GameState {
  return { ...state, events: [...state.events, nextEvent(state.events, message)] };
}

function clearedTurnSelection(state: GameState): GameState {
  return {
    ...state,
    selectedPieceId: null,
    legalPieceIds: [],
    legalRoutes: [],
    pendingMoveOptions: [],
  };
}

export function endTurn(state: GameState): GameState {
  const currentIndex = state.turnOrder.indexOf(state.currentPlayerId);
  if (currentIndex < 0 || state.turnOrder.length === 0) {
    throw new Error("턴 순서가 올바르지 않습니다.");
  }

  return {
    ...clearedTurnSelection(state),
    currentPlayerId: state.turnOrder[(currentIndex + 1) % state.turnOrder.length],
    turnStage: "AWAITING_THROW",
    bonusThrowsRemaining: 0,
  };
}

function awaitBonusOrEndTurn(state: GameState): GameState {
  if (state.bonusThrowsRemaining > 0) {
    return { ...clearedTurnSelection(state), turnStage: "AWAITING_THROW" };
  }
  return endTurn(state);
}

const RESULT_NAMES: Record<ThrowOutcome["result"], string> = {
  BACK_DO: "빽도",
  DO: "도",
  GAE: "개",
  GEOL: "걸",
  YUT: "윷",
  MO: "모",
};

function assertCommandActor(state: GameState, command: GameCommand): void {
  if (command.actorId !== state.currentPlayerId) {
    throw new GameActionError("현재 차례인 참가자만 행동할 수 있습니다.");
  }
  if (state.turnStage === "COMPLETE") {
    throw new GameActionError("이미 끝난 게임입니다.");
  }
}

function requireStage(state: GameState, expected: GameState["turnStage"]): void {
  if (state.turnStage !== expected) {
    throw new GameActionError("현재 단계에서 수행할 수 없는 행동입니다.");
  }
}

function resolveMove(state: GameState, pieceId: string, option: MoveOption): GameState {
  const resolution = movePieces(state.pieces, { pieceId, option });
  const afterMove = withEvent(
    {
      ...state,
      pieces: resolution.pieces,
      bonusThrowsRemaining: state.bonusThrowsRemaining + resolution.bonusThrowsEarned,
    },
    resolution.capturedPieceIds.length > 0
      ? `${state.currentPlayerId}님이 상대 말을 잡았습니다.`
      : `${state.currentPlayerId}님이 말을 이동했습니다.`,
  );

  if (resolution.finishedOwnerId) {
    return {
      ...clearedTurnSelection(afterMove),
      turnStage: "COMPLETE",
      winnerId: resolution.finishedOwnerId,
    };
  }

  return awaitBonusOrEndTurn(afterMove);
}

function applyThrow(state: GameState, command: Extract<GameCommand, { type: "THROW" }>): GameState {
  requireStage(state, "AWAITING_THROW");
  const bonusThrowsRemaining =
    Math.max(0, state.bonusThrowsRemaining - 1) + command.outcome.bonusThrows;
  const legalPieceIds = getLegalPieceIds(
    state.pieces,
    currentController(state),
    command.outcome.distance,
  );
  const thrownState = withEvent(
    {
      ...clearedTurnSelection(state),
      turnStage: "AWAITING_PIECE",
      lastThrow: { ...command.outcome, sticks: [...command.outcome.sticks] as ThrowOutcome["sticks"] },
      bonusThrowsRemaining,
      legalPieceIds,
    },
    `${state.currentPlayerId}님이 ${RESULT_NAMES[command.outcome.result]}를 던졌습니다.`,
  );

  if (legalPieceIds.length > 0) {
    return thrownState;
  }

  return awaitBonusOrEndTurn(
    withEvent(thrownState, `${state.currentPlayerId}님은 이동할 수 있는 말이 없습니다.`),
  );
}

function applyPieceSelection(
  state: GameState,
  command: Extract<GameCommand, { type: "SELECT_PIECE" }>,
): GameState {
  requireStage(state, "AWAITING_PIECE");
  if (!state.lastThrow) {
    throw new Error("윷 결과가 없습니다.");
  }

  const legalPieceIds = getLegalPieceIds(
    state.pieces,
    currentController(state),
    state.lastThrow.distance,
  );
  if (!legalPieceIds.includes(command.pieceId)) {
    throw new GameActionError("선택할 수 없는 말입니다.");
  }

  const selectedPiece = state.pieces.find((piece) => piece.id === command.pieceId);
  if (!selectedPiece) {
    throw new Error("선택할 수 없는 말입니다.");
  }
  const options = getLegalMoveOptions(selectedPiece, state.lastThrow.distance);

  if (options.length === 1) {
    return resolveMove(state, command.pieceId, options[0]);
  }

  return {
    ...state,
    turnStage: "AWAITING_ROUTE",
    selectedPieceId: command.pieceId,
    legalPieceIds: [],
    legalRoutes: options.map((option) => option.routeId),
    pendingMoveOptions: options.map((option) => ({ ...option, traversed: [...option.traversed] })),
  };
}

function applyRouteSelection(
  state: GameState,
  command: Extract<GameCommand, { type: "SELECT_ROUTE" }>,
): GameState {
  requireStage(state, "AWAITING_ROUTE");
  if (!state.selectedPieceId || !state.lastThrow) {
    throw new Error("선택된 말이나 윷 결과가 없습니다.");
  }

  const legalPieceIds = getLegalPieceIds(
    state.pieces,
    currentController(state),
    state.lastThrow.distance,
  );
  if (!legalPieceIds.includes(state.selectedPieceId)) {
    throw new Error("선택할 수 없는 말입니다.");
  }
  const selectedPiece = state.pieces.find((piece) => piece.id === state.selectedPieceId);
  const option = selectedPiece
    ? getLegalMoveOptions(selectedPiece, state.lastThrow.distance).find(
        (candidate) => candidate.routeId === command.routeId,
      )
    : undefined;
  if (!option) {
    throw new GameActionError("선택할 수 없는 경로입니다.");
  }

  return resolveMove(state, state.selectedPieceId, option);
}

export function applyGameCommand(state: GameState, command: GameCommand): GameState {
  assertCommandActor(state, command);
  switch (command.type) {
    case "THROW":
      return applyThrow(state, command);
    case "SELECT_PIECE":
      return applyPieceSelection(state, command);
    case "SELECT_ROUTE":
      return applyRouteSelection(state, command);
  }
}

function stackSizeFor(piece: Piece, pieces: readonly Piece[]): number {
  return piece.stackId
    ? pieces.filter((candidate) => candidate.stackId === piece.stackId).length
    : 1;
}

export function toPublicGameState(
  state: GameState,
  actionExpiresAt: number | null = null,
): PublicGameState {
  return {
    currentPlayerId: state.currentPlayerId,
    turnStage: state.turnStage,
    actionExpiresAt,
    pieces: state.pieces.map((piece) => ({
      id: piece.id,
      ownerId: piece.ownerId,
      ...(piece.teamId ? { teamId: piece.teamId } : {}),
      status: piece.status,
      ...(piece.position ? { nodeId: piece.position.nodeId } : {}),
      stackSize: stackSizeFor(piece, state.pieces),
    })),
    legalPieceIds: [...state.legalPieceIds],
    legalRoutes: state.pendingMoveOptions.map((option) => ({
      routeId: option.routeId,
      destinationNodeId: option.nodeId,
    })),
    lastThrow: state.lastThrow
      ? { result: state.lastThrow.result, sticks: [...state.lastThrow.sticks] as ThrowOutcome["sticks"] }
      : null,
    winnerId: state.winnerId,
    events: state.events.map((event) => ({ ...event })),
  };
}
