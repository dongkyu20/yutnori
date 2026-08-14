import type { GameMode, PublicGameState, TeamId } from "../../shared/protocol";
import { getLegalMoveOptions, getLegalMoves, getLegalPieceIds, movePieces } from "./pieces";
import { grantsExtraThrow } from "./yut";
import type {
  GameCommand,
  GamePlayer,
  GameState,
  MoveOption,
  PendingThrow,
  Piece,
  PieceController,
  ThrowOutcome,
} from "./types";

export type { GameCommand, GameState } from "./types";

const TEAM_IDS: readonly TeamId[] = ["A", "B", "C", "D"];
/** 차례가 시작되면 누구나 한 번은 던진다. */
const THROWS_PER_TURN = 1;

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
    lastThrowEventId: null,
    lastMove: null,
    pendingThrows: [],
    selectedThrowId: null,
    selectedPieceId: null,
    legalPieceIds: [],
    legalRoutes: [],
    pendingMoveOptions: [],
    throwsRemaining: THROWS_PER_TURN,
    winnerId: null,
    events: [],
    eventSequence: 0,
  };
}

/** 판을 쥐고 있는 편. 개인전은 참가자 자신, 팀전은 팀이다. */
function controllerOf(mode: GameMode, player: GamePlayer): string {
  return (mode === "team" ? player.teamId : player.id) ?? player.id;
}

/**
 * 판을 떠난 사람을 게임에서 지운다.
 *
 * 개인전이면 그 사람 말을 걷는다. 팀전이면 팀에 남은 사람이 있는지 보고, 팀이
 * 통째로 비었을 때만 그 팀 말을 걷는다. 남은 편이 하나뿐이면 그 편의 승리로 끝낸다.
 * 떠난 사람 차례였으면 다음 사람에게 넘기고 그 차례에 들고 있던 것은 버린다.
 */
export function removePlayer(state: GameState, playerId: string, nickname: string): GameState {
  const leaving = state.players.find((player) => player.id === playerId);
  if (!leaving) return state;

  const players = state.players.filter((player) => player.id !== playerId);
  const leavingController = controllerOf(state.mode, leaving);
  const remainingControllers = new Set(players.map((player) => controllerOf(state.mode, player)));
  const pieces = remainingControllers.has(leavingController)
    ? state.pieces
    : state.pieces.filter((piece) => (piece.teamId ?? piece.ownerId) !== leavingController);

  const turnOrder = state.turnOrder.filter((id) => id !== playerId);
  const wasTheirTurn = state.currentPlayerId === playerId;
  // 떠난 자리에서 순서를 잇는다. 앞으로 돌아가면 이미 둔 사람이 또 두게 된다.
  const nextIndex = state.turnOrder.indexOf(playerId);
  const currentPlayerId = wasTheirTurn
    ? state.turnOrder.slice(nextIndex + 1).concat(state.turnOrder.slice(0, nextIndex))
      .find((id) => turnOrder.includes(id)) ?? ""
    : state.currentPlayerId;

  const left = withEvent(
    { ...state, players, pieces, turnOrder, currentPlayerId },
    `${nickname}님이 방을 떠났습니다.`,
  );

  if (remainingControllers.size <= 1) {
    const winnerId = remainingControllers.size === 1 ? [...remainingControllers][0] : null;
    const ended: GameState = {
      ...clearedTurnSelection(left),
      turnStage: "COMPLETE",
      pendingThrows: [],
      throwsRemaining: 0,
      lastThrow: null,
      lastThrowEventId: null,
      lastMove: null,
      winnerId,
    };
    return winnerId === null ? ended : withEvent(ended, `${winnerId}님이 이겼습니다.`);
  }

  if (!wasTheirTurn) return left;

  return {
    ...clearedTurnSelection(left),
    turnStage: "AWAITING_THROW",
    pendingThrows: [],
    throwsRemaining: THROWS_PER_TURN,
    // 떠난 사람의 던지기와 이동은 더 이상 연출할 것이 없다.
    lastThrow: null,
    lastThrowEventId: null,
    lastMove: null,
  };
}

function currentController(state: GameState): PieceController {
  const player = state.players.find((candidate) => candidate.id === state.currentPlayerId);
  if (!player) {
    throw new Error("현재 참가자를 찾을 수 없습니다.");
  }
  return { ownerId: player.id, teamId: player.teamId };
}

/**
 * 기록은 스냅숏마다 통째로 실려 나간다. 한 판 내내 쌓으면 행동 한 번마다 전원에게
 * 수백 줄을 다시 보내게 되므로 최근 것만 남긴다. 화면에 보이는 것은 마지막 한 줄뿐이다.
 */
export const MAX_EVENTS = 50;

function withEvent(state: GameState, message: string): GameState {
  const sequence = state.eventSequence + 1;
  const events = [...state.events, { id: `event-${sequence}`, message, createdAt: sequence }];
  return {
    ...state,
    eventSequence: sequence,
    events: events.length > MAX_EVENTS ? events.slice(-MAX_EVENTS) : events,
  };
}

function clearedTurnSelection(state: GameState): GameState {
  return {
    ...state,
    selectedThrowId: null,
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
    pendingThrows: [],
    throwsRemaining: THROWS_PER_TURN,
  };
}

const RESULT_NAMES: Record<ThrowOutcome["result"], string> = {
  BACK_DO: "빽도",
  DO: "도",
  GAE: "개",
  GEOL: "걸",
  YUT: "윷",
  MO: "모",
};

function finalConsonant(word: string): number {
  const offset = word.charCodeAt(word.length - 1) - 0xac00;
  return offset >= 0 && offset <= 11171 ? offset % 28 : 0;
}

function objectParticle(word: string): string {
  return finalConsonant(word) === 0 ? "를" : "을";
}

function instrumentParticle(word: string): string {
  const consonant = finalConsonant(word);
  return consonant === 0 || consonant === 8 ? "로" : "으로";
}

/**
 * 아직 쓰지 않은 윷 결과와 각 결과로 움직일 수 있는 말. 말 선택 단계에서만 채워진다.
 */
/**
 * 손에 든 결과마다 움직일 수 있는 말과 그 말이 갈 곳을 함께 낸다.
 * 갈 곳은 말에 마우스를 올렸을 때 미리 보여 주는 데 쓰며, 두 목록은 한 번의 계산에서 나온다.
 */
export function pendingThrowChoices(
  state: GameState,
): Array<{
  id: string;
  result: ThrowOutcome["result"];
  legalPieceIds: string[];
  moves: Array<{ pieceId: string; destinationNodeId: string; path: string[]; finished: boolean }>;
}> {
  const controller = state.turnStage === "AWAITING_PIECE" ? currentController(state) : null;
  return state.pendingThrows.map((pending) => {
    const legalMoves = controller
      ? getLegalMoves(state.pieces, controller, pending.distance)
      : [];
    return {
      id: pending.id,
      result: pending.result,
      legalPieceIds: legalMoves.map((move) => move.pieceId),
      moves: legalMoves.map((move) => ({
        pieceId: move.pieceId,
        destinationNodeId: move.option.nodeId,
        path: [...move.option.traversed],
        finished: move.option.finished,
      })),
    };
  });
}

function beginMovePhase(state: GameState): GameState {
  const controller = currentController(state);
  const legalPieceIds = [
    ...new Set(
      state.pendingThrows.flatMap((pending) =>
        getLegalPieceIds(state.pieces, controller, pending.distance),
      ),
    ),
  ];

  if (legalPieceIds.length === 0) {
    return endTurn(withEvent(state, `${state.currentPlayerId}님은 이동할 수 있는 말이 없습니다.`));
  }

  return { ...clearedTurnSelection(state), turnStage: "AWAITING_PIECE", legalPieceIds };
}

/** 던질 기회가 남았으면 계속 던지고, 남은 결과가 있으면 배분하고, 둘 다 없으면 차례를 넘긴다. */
function continueTurn(state: GameState): GameState {
  if (state.throwsRemaining > 0) {
    return { ...clearedTurnSelection(state), turnStage: "AWAITING_THROW" };
  }
  if (state.pendingThrows.length === 0) {
    return endTurn(state);
  }
  return beginMovePhase(state);
}

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

function resolveMove(
  state: GameState,
  pending: PendingThrow,
  pieceId: string,
  option: MoveOption,
): GameState {
  // 이동 전 자리를 먼저 붙잡아 둔다. movePieces가 지나가면 이미 도착 칸으로 바뀐다.
  const departureNodeId = state.pieces.find((piece) => piece.id === pieceId)?.position?.nodeId ?? null;
  const resolution = movePieces(state.pieces, { pieceId, option });
  const resultName = RESULT_NAMES[pending.result];
  const captured = resolution.capturedPieceIds.length > 0;
  // 윷·모는 던지는 순간 이미 한 번 더 던지게 해 주었다. 그 결과로 잡았다면 잡기 몫을 또 주지 않는다.
  const captureBonus = grantsExtraThrow(pending.result) ? 0 : resolution.bonusThrowsEarned;
  const moved = withEvent(
    {
      ...state,
      pieces: resolution.pieces,
      pendingThrows: state.pendingThrows.filter((entry) => entry.id !== pending.id),
      throwsRemaining: state.throwsRemaining + captureBonus,
    },
    `${state.currentPlayerId}님이 ${resultName}${instrumentParticle(resultName)} `
    + `${captured ? "상대 말을 잡았습니다." : "말을 이동했습니다."}`,
  );
  const afterMove: GameState = {
    ...moved,
    lastMove: {
      // 방금 기록한 이동 이벤트의 id를 그대로 쓴다. 연출은 이 값이 바뀔 때만 재생한다.
      eventId: moved.events[moved.events.length - 1].id,
      pieceIds: [...resolution.movedPieceIds],
      fromNodeId: departureNodeId,
      path: [...option.traversed],
      capturedPieceIds: [...resolution.capturedPieceIds],
    },
  };

  if (resolution.finishedOwnerId) {
    return {
      ...clearedTurnSelection(afterMove),
      turnStage: "COMPLETE",
      pendingThrows: [],
      throwsRemaining: 0,
      winnerId: resolution.finishedOwnerId,
    };
  }

  return continueTurn(
    captureBonus > 0
      ? withEvent(afterMove, `${state.currentPlayerId}님이 한 번 더 던집니다.`)
      : afterMove,
  );
}

function applyThrow(state: GameState, command: Extract<GameCommand, { type: "THROW" }>): GameState {
  requireStage(state, "AWAITING_THROW");
  // 곧 withEvent가 붙일 기록의 id와 같은 값이어야 한다. 배열 길이에서 뽑으면
  // 기록을 잘라낸 뒤 같은 id가 다시 나오고, 연출이 "이미 본 던지기"로 여겨 건너뛴다.
  const throwEventId = `event-${state.eventSequence + 1}`;
  const outcome: ThrowOutcome = {
    ...command.outcome,
    sticks: [...command.outcome.sticks] as ThrowOutcome["sticks"],
  };
  const resultName = RESULT_NAMES[outcome.result];
  const thrownState = withEvent(
    {
      ...clearedTurnSelection(state),
      turnStage: "AWAITING_THROW",
      lastThrow: outcome,
      lastThrowEventId: throwEventId,
      pendingThrows: [
        ...state.pendingThrows,
        { id: throwEventId, result: outcome.result, distance: outcome.distance },
      ],
      throwsRemaining: state.throwsRemaining - 1 + outcome.bonusThrows,
    },
    `${state.currentPlayerId}님이 ${resultName}${objectParticle(resultName)} 던졌습니다.`,
  );

  return continueTurn(
    outcome.bonusThrows > 0
      ? withEvent(thrownState, `${state.currentPlayerId}님이 한 번 더 던집니다.`)
      : thrownState,
  );
}

function requirePendingThrow(state: GameState, throwId: string): PendingThrow {
  const pending = state.pendingThrows.find((entry) => entry.id === throwId);
  if (!pending) {
    throw new GameActionError("사용할 수 없는 윷 결과입니다.");
  }
  return pending;
}

function requireSelectablePiece(state: GameState, pending: PendingThrow, pieceId: string): Piece {
  const legalPieceIds = getLegalPieceIds(state.pieces, currentController(state), pending.distance);
  const piece = state.pieces.find((candidate) => candidate.id === pieceId);
  if (!piece || !legalPieceIds.includes(pieceId)) {
    throw new GameActionError("선택할 수 없는 말입니다.");
  }
  return piece;
}

function applyPieceSelection(
  state: GameState,
  command: Extract<GameCommand, { type: "SELECT_PIECE" }>,
): GameState {
  requireStage(state, "AWAITING_PIECE");
  const pending = requirePendingThrow(state, command.throwId);
  const selectedPiece = requireSelectablePiece(state, pending, command.pieceId);
  const options = getLegalMoveOptions(selectedPiece, pending.distance);

  if (options.length === 1) {
    return resolveMove(state, pending, command.pieceId, options[0]);
  }

  return {
    ...state,
    turnStage: "AWAITING_ROUTE",
    selectedThrowId: pending.id,
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
  if (!state.selectedPieceId || !state.selectedThrowId) {
    throw new Error("선택된 말이나 윷 결과가 없습니다.");
  }

  const pending = requirePendingThrow(state, state.selectedThrowId);
  const selectedPiece = requireSelectablePiece(state, pending, state.selectedPieceId);
  const option = getLegalMoveOptions(selectedPiece, pending.distance).find(
    (candidate) => candidate.routeId === command.routeId,
  );
  if (!option) {
    throw new GameActionError("선택할 수 없는 경로입니다.");
  }

  return resolveMove(state, pending, state.selectedPieceId, option);
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
    pendingThrows: pendingThrowChoices(state).map((choice) => ({
      id: choice.id,
      result: choice.result,
      legalPieceIds: [...choice.legalPieceIds],
      moves: choice.moves.map((move) => ({ ...move, path: [...move.path] })),
    })),
    throwsRemaining: state.throwsRemaining,
    legalPieceIds: [...state.legalPieceIds],
    legalRoutes: state.pendingMoveOptions.map((option) => ({
      routeId: option.routeId,
      destinationNodeId: option.nodeId,
    })),
    lastThrow: state.lastThrow
      ? {
          eventId: state.lastThrowEventId ?? (() => { throw new Error("Throw event id is missing"); })(),
          result: state.lastThrow.result,
          sticks: [...state.lastThrow.sticks] as ThrowOutcome["sticks"],
        }
      : null,
    lastMove: state.lastMove
      ? {
          eventId: state.lastMove.eventId,
          pieceIds: [...state.lastMove.pieceIds],
          fromNodeId: state.lastMove.fromNodeId,
          path: [...state.lastMove.path],
          capturedPieceIds: [...state.lastMove.capturedPieceIds],
        }
      : null,
    winnerId: state.winnerId,
    events: state.events.map((event) => ({ ...event })),
  };
}
