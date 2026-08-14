import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  GameMode,
  InRoomCommand,
  PublicRoomSnapshot,
  TeamId,
} from "../shared/protocol";
import { nicknameSchema, roomCodeSchema } from "../shared/schemas";
import { chooseAutoCommand } from "./autoAction";
import {
  applyGameCommand,
  createGame,
  GameActionError,
  removePlayer,
  toPublicGameState,
} from "./game/reducer";
import type { GameState } from "./game/types";
import { throwYut } from "./game/yut";

const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const DEFAULT_ACTION_TIMEOUT_MS = 45_000;
const EMPTY_ROOM_TTL_MS = 10 * 60_000;
const FINISHED_ROOM_TTL_MS = 30 * 60_000;
const MAX_PROCESSED_REQUEST_IDS = 256;
const ROOM_ERROR_MESSAGES = {
  ROOM_NOT_FOUND: "방을 찾을 수 없습니다.",
  GAME_ALREADY_STARTED: "이미 시작된 게임입니다.",
  GAME_NOT_PLAYING: "진행 중인 게임이 아닙니다.",
  ROOM_NOT_WAITING: "대기 중인 방에서만 수행할 수 있습니다.",
  ROOM_NOT_FINISHED: "경기가 끝난 방에서만 다시 시작할 수 있습니다.",
  COLOR_TAKEN: "이미 다른 참가자가 고른 색입니다.",
  TEAM_LEADER_ONLY: "팀에 먼저 들어온 참가자만 팀 색을 고를 수 있습니다.",
  NO_TEAM: "팀을 먼저 배정받아야 색을 고를 수 있습니다.",
} as const;

/** 고를 수 있는 말 색의 개수. 클라이언트 팔레트와 같아야 한다. */
const COLOR_SLOTS = 4;

type VersionedCommand = Exclude<InRoomCommand, { type: "REACT" }>;

interface RoomPlayer {
  id: string;
  nickname: string;
  connected: boolean;
  ready: boolean;
  teamId?: TeamId;
  reconnectTokenHash: string;
  processedRequestIds: Set<string>;
}

interface Room {
  roomCode: string;
  version: number;
  phase: PublicRoomSnapshot["phase"];
  mode: GameMode;
  hostPlayerId: string;
  players: RoomPlayer[];
  game: GameState | null;
  /**
   * 조작 주체(개인전은 참가자 id, 팀전은 팀 id)가 고른 색 자리.
   * 아무도 안 고른 채로 두었다가 게임을 시작할 때 빈 자리를 채운다.
   * 미리 나눠 주면 넷이 다 모였을 때 모든 색이 잠겨 아무도 바꿀 수 없다.
   */
  colorChoices: Map<string, number>;
  actionExpiresAt: number | null;
  actionTimerId: unknown | null;
  emptySince: number | null;
  finishedAt: number | null;
  winnerName: string | null;
}

interface SessionLocation {
  roomCode: string;
  playerId: string;
}

type StartEligibility =
  | { canStart: true; reason: null }
  | {
    canStart: false;
    reason: string;
    code: "NOT_ENOUGH_PLAYERS" | "INVALID_TEAM_COMPOSITION" | "PLAYERS_NOT_READY";
  };

export interface RoomServiceOptions {
  actionTimeoutMs: number;
  now: () => number;
  random: () => number;
  schedule: (fn: () => void, ms: number) => unknown;
  cancel: (id: unknown) => void;
  onListenerError?: (error: unknown) => void;
}

export interface SessionResult {
  snapshot: PublicRoomSnapshot;
  playerId: string;
  reconnectToken: string;
}

export interface RoomChange {
  roomCode: string;
  snapshot: PublicRoomSnapshot;
}

export type RoomChangeListener = (change: RoomChange) => void;

export interface RoomRemoval {
  roomCode: string;
  playerIds: string[];
}

export type RoomRemovalListener = (removal: RoomRemoval) => void;

export class RoomError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly recoverable = true,
  ) {
    super(message);
    this.name = "RoomError";
  }
}

const defaultOptions: RoomServiceOptions = {
  actionTimeoutMs: DEFAULT_ACTION_TIMEOUT_MS,
  now: Date.now,
  random: Math.random,
  schedule: (fn, ms) => setTimeout(fn, ms),
  cancel: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  onListenerError: (error) => console.error("Room change listener failed.", error),
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isVersionedCommand(command: InRoomCommand): command is VersionedCommand {
  return command.type !== "REACT";
}

function roomCapacity(mode: GameMode): number {
  return mode === "individual" ? 4 : 8;
}

export class RoomService {
  private readonly options: RoomServiceOptions;
  private readonly rooms = new Map<string, Room>();
  private readonly playerRooms = new Map<string, string>();
  private readonly sessions = new Map<string, SessionLocation>();
  private readonly listeners = new Set<RoomChangeListener>();
  private readonly removalListeners = new Set<RoomRemovalListener>();

  constructor(options: Partial<RoomServiceOptions> = {}) {
    this.options = { ...defaultOptions, ...options };
  }

  subscribe(listener: RoomChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeRemoval(listener: RoomRemovalListener): () => void {
    this.removalListeners.add(listener);
    return () => this.removalListeners.delete(listener);
  }

  createRoom(input: { nickname: string; mode: GameMode }): SessionResult {
    const nickname = nicknameSchema.parse(input.nickname);
    const roomCode = this.createRoomCode();
    const session = this.createPlayer(nickname);
    const room: Room = {
      roomCode,
      version: 0,
      phase: "waiting",
      mode: input.mode,
      hostPlayerId: session.player.id,
      players: [session.player],
      game: null,
      colorChoices: new Map(),
      actionExpiresAt: null,
      actionTimerId: null,
      emptySince: null,
      finishedAt: null,
      winnerName: null,
    };

    this.rooms.set(roomCode, room);
    this.playerRooms.set(session.player.id, roomCode);
    this.sessions.set(session.player.reconnectTokenHash, {
      roomCode,
      playerId: session.player.id,
    });

    const result = this.sessionResult(room, session.player.id, session.token);
    this.notify(room, result.snapshot);
    return result;
  }

  joinRoom(input: { roomCode: string; nickname: string }): SessionResult {
    const roomCode = roomCodeSchema.parse(input.roomCode);
    const nickname = nicknameSchema.parse(input.nickname);
    const room = this.rooms.get(roomCode);
    if (!room) {
      throw new RoomError("ROOM_NOT_FOUND", ROOM_ERROR_MESSAGES.ROOM_NOT_FOUND);
    }
    if (room.phase !== "waiting") {
      throw new RoomError("GAME_ALREADY_STARTED", ROOM_ERROR_MESSAGES.GAME_ALREADY_STARTED);
    }
    if (room.players.length >= roomCapacity(room.mode)) {
      throw new RoomError("ROOM_FULL", "방이 가득 찼습니다.");
    }
    const nicknameKey = nickname.toLowerCase();
    if (room.players.some((player) => player.nickname.toLowerCase() === nicknameKey)) {
      throw new RoomError("NICKNAME_TAKEN", "이미 사용 중인 닉네임입니다.");
    }

    const session = this.createPlayer(nickname);
    const joiningEmptyRoom = room.players.length === 0;
    room.players.push(session.player);
    if (joiningEmptyRoom) room.hostPlayerId = session.player.id;
    room.version += 1;
    room.emptySince = null;
    this.playerRooms.set(session.player.id, roomCode);
    this.sessions.set(session.player.reconnectTokenHash, {
      roomCode,
      playerId: session.player.id,
    });
    const result = this.sessionResult(room, session.player.id, session.token);
    this.notify(room, result.snapshot);
    return result;
  }

  reconnect(token: string): SessionResult {
    const location = this.sessions.get(hashToken(token));
    const room = location ? this.rooms.get(location.roomCode) : undefined;
    const player = room?.players.find((candidate) => candidate.id === location?.playerId);
    if (!room || !player) {
      throw new RoomError("SESSION_NOT_FOUND", "재접속 세션을 찾을 수 없습니다.", false);
    }

    let changed = false;
    if (!player.connected) {
      player.connected = true;
      room.emptySince = null;
      if (room.phase === "waiting" && !this.connectedPlayer(room, room.hostPlayerId)) {
        room.hostPlayerId = player.id;
      }
      room.version += 1;
      changed = true;
    }

    const result = this.sessionResult(room, player.id, token);
    if (changed) this.notify(room, result.snapshot);
    return result;
  }

  dispatch(playerId: string, command: InRoomCommand): PublicRoomSnapshot {
    const { room, player } = this.findPlayer(playerId);
    if (!player.connected) {
      throw new RoomError("PLAYER_DISCONNECTED", "연결된 참가자만 행동할 수 있습니다.");
    }

    if (!isVersionedCommand(command)) {
      return this.snapshot(room);
    }
    if (player.processedRequestIds.has(command.requestId)) {
      return this.snapshot(room);
    }
    // 나가기는 방 상태와 무관하게 늘 받아 준다. 오래된 버전이라고 되돌리면
    // 화면은 이미 로비로 나갔는데 자리만 남는다.
    if (command.type !== "LEAVE_ROOM" && command.roomVersion !== room.version) {
      throw new RoomError("STALE_VERSION", "오래된 방 버전입니다.");
    }

    this.applyCommand(room, player, command);
    player.processedRequestIds.add(command.requestId);
    if (player.processedRequestIds.size > MAX_PROCESSED_REQUEST_IDS) {
      const oldestRequestId = player.processedRequestIds.values().next().value;
      if (oldestRequestId !== undefined) player.processedRequestIds.delete(oldestRequestId);
    }
    room.version += 1;
    const snapshot = this.snapshot(room);
    this.notify(room, snapshot);
    return snapshot;
  }

  disconnect(playerId: string): void {
    const roomCode = this.playerRooms.get(playerId);
    const room = roomCode ? this.rooms.get(roomCode) : undefined;
    const player = room?.players.find((candidate) => candidate.id === playerId);
    if (!room || !player || !player.connected) return;

    player.connected = false;
    if (room.phase === "waiting" && room.hostPlayerId === playerId) {
      const nextHost = room.players.find((candidate) => candidate.connected);
      if (nextHost) room.hostPlayerId = nextHost.id;
    }
    if (!room.players.some((candidate) => candidate.connected)) {
      room.emptySince = this.options.now();
    }
    room.version += 1;

    if (room.phase === "playing" && room.game?.currentPlayerId === playerId) {
      this.scheduleAction(room, 0, true);
    }
    this.notify(room);
  }

  removeExpiredRooms(): void {
    const now = this.options.now();
    for (const room of this.rooms.values()) {
      const finishedExpired =
        room.phase === "finished" &&
        room.finishedAt !== null &&
        now - room.finishedAt >= FINISHED_ROOM_TTL_MS;
      const emptyExpired =
        room.phase !== "finished" &&
        room.emptySince !== null &&
        now - room.emptySince >= EMPTY_ROOM_TTL_MS;
      if (finishedExpired || emptyExpired) {
        this.deleteRoom(room);
      }
    }
  }

  private applyCommand(room: Room, actor: RoomPlayer, command: VersionedCommand): void {
    switch (command.type) {
      case "SET_READY":
        this.assertWaiting(room);
        actor.ready = command.ready;
        return;
      case "ASSIGN_TEAM":
        this.assertWaiting(room);
        this.assertHost(room, actor.id);
        this.assignTeam(room, command.playerId, command.teamId);
        // 옮기고 나서 빈 팀이 생겼으면 그 팀이 쥐고 있던 색을 놓아준다.
        this.releaseOrphanedColors(room);
        return;
      case "LEAVE_ROOM":
        // 어느 단계에서든 나갈 수 있다. 진행 중이면 판에서도 빠진다.
        this.leaveRoom(room, actor);
        return;
      case "KICK_PLAYER":
        this.assertWaiting(room);
        this.assertHost(room, actor.id);
        this.kickPlayer(room, actor.id, command.playerId);
        return;
      case "CHOOSE_COLOR":
        this.assertWaiting(room);
        this.chooseColor(room, actor, command.slot);
        return;
      case "START_GAME":
        this.assertWaiting(room);
        this.assertHost(room, actor.id);
        this.startGame(room);
        return;
      case "PLAY_AGAIN":
        this.assertFinished(room);
        this.restartRoom(room, actor);
        return;
      case "THROW_YUT":
        this.applyPlayerGameCommand(room, {
          type: "THROW",
          actorId: actor.id,
          outcome: throwYut(this.options.random),
        });
        return;
      case "SELECT_PIECE":
        this.applyPlayerGameCommand(room, {
          type: "SELECT_PIECE",
          actorId: actor.id,
          throwId: command.throwId,
          pieceId: command.pieceId,
        });
        return;
      case "SELECT_ROUTE":
        this.applyPlayerGameCommand(room, {
          type: "SELECT_ROUTE",
          actorId: actor.id,
          routeId: command.routeId,
        });
        return;
    }
  }

  private applyPlayerGameCommand(room: Room, command: Parameters<typeof applyGameCommand>[1]): void {
    if (room.phase !== "playing" || !room.game) {
      throw new RoomError("GAME_NOT_PLAYING", ROOM_ERROR_MESSAGES.GAME_NOT_PLAYING);
    }
    try {
      room.game = applyGameCommand(room.game, command);
    } catch (error) {
      if (error instanceof GameActionError) {
        throw new RoomError(
          "INVALID_ACTION",
          "현재 상태에서 수행할 수 없는 행동입니다.",
        );
      }
      throw error;
    }
    if (room.game.turnStage === "COMPLETE") {
      this.finishRoom(room);
    } else {
      const currentPlayer = room.players.find(
        (player) => player.id === room.game?.currentPlayerId,
      );
      this.scheduleAction(room, currentPlayer?.connected ? this.options.actionTimeoutMs : 0);
    }
  }

  private assignTeam(room: Room, playerId: string, teamId: TeamId): void {
    if (room.mode !== "team") {
      throw new RoomError("WRONG_MODE", "팀전에서만 팀을 배정할 수 있습니다.");
    }
    const player = room.players.find((candidate) => candidate.id === playerId);
    if (!player) {
      throw new RoomError("PLAYER_NOT_FOUND", "참가자를 찾을 수 없습니다.");
    }
    const teamSize = room.players.filter(
      (candidate) => candidate.id !== playerId && candidate.teamId === teamId,
    ).length;
    if (teamSize >= 2) {
      throw new RoomError("TEAM_FULL", "한 팀에는 두 명까지만 배정할 수 있습니다.");
    }
    player.teamId = teamId;
    player.ready = false;
  }

  private kickPlayer(room: Room, actorId: string, playerId: string): void {
    if (playerId === actorId) {
      throw new RoomError("HOST_CANNOT_KICK_SELF", "방장은 자신을 내보낼 수 없습니다.");
    }
    const index = room.players.findIndex((candidate) => candidate.id === playerId);
    if (index < 0) {
      throw new RoomError("PLAYER_NOT_FOUND", "참가자를 찾을 수 없습니다.");
    }
    this.dropMember(room, index);
  }

  /** 방에서 자리를 지운다. 다시 들어올 표도 함께 버려 그 표로는 돌아올 수 없게 한다. */
  private dropMember(room: Room, index: number): RoomPlayer {
    const [removed] = room.players.splice(index, 1);
    this.sessions.delete(removed.reconnectTokenHash);
    this.playerRooms.delete(removed.id);
    this.releaseOrphanedColors(room);
    return removed;
  }

  /**
   * 스스로 방을 떠난다.
   *
   * 자리와 색을 놓고, 방장이었다면 남은 사람에게 넘긴다. 진행 중인 판이라면 그 사람의
   * 말을 걷고 차례에서 빼서 남은 사람끼리 잇는다. 한 편만 남으면 그 편의 승리로 끝난다.
   * 아무도 남지 않은 방은 빈 방으로 표시해 두면 정리 주기가 지울 것이다.
   */
  private leaveRoom(room: Room, actor: RoomPlayer): void {
    const index = room.players.findIndex((candidate) => candidate.id === actor.id);
    if (index < 0) throw new RoomError("PLAYER_NOT_FOUND", "참가자를 찾을 수 없습니다.");
    this.dropMember(room, index);

    if (room.hostPlayerId === actor.id) {
      const nextHost = room.players.find((candidate) => candidate.connected) ?? room.players[0];
      if (nextHost) room.hostPlayerId = nextHost.id;
    }

    if (room.phase === "playing" && room.game) {
      const wasCurrentPlayer = room.game.currentPlayerId === actor.id;
      room.game = removePlayer(room.game, actor.id, actor.nickname);
      if (room.game.turnStage === "COMPLETE") {
        this.finishRoom(room);
      } else if (wasCurrentPlayer) {
        // 떠난 사람 차례였으면 다음 사람에게 넘어갔다. 그 사람 시계로 다시 잰다.
        const currentPlayer = this.connectedPlayer(room, room.game.currentPlayerId);
        this.scheduleAction(room, currentPlayer ? this.options.actionTimeoutMs : 0);
      }
    }

    if (!room.players.some((candidate) => candidate.connected)) {
      room.emptySince = this.options.now();
    }
    if (room.players.length === 0 && room.actionTimerId !== null) {
      this.options.cancel(room.actionTimerId);
      room.actionTimerId = null;
      room.actionExpiresAt = null;
    }
  }

  private startGame(room: Room): void {
    const eligibility = this.startEligibility(room);
    if (!eligibility.canStart) throw new RoomError(eligibility.code, eligibility.reason);

    this.fillMissingColors(room);
    room.game = createGame({
      mode: room.mode,
      players: room.players.map((player) => ({
        id: player.id,
        ...(player.teamId ? { teamId: player.teamId } : {}),
      })),
    });
    room.phase = "playing";
    room.winnerName = null;
    this.scheduleAction(room, this.options.actionTimeoutMs);
  }

  /**
   * 같은 사람들과 한 판 더. 참가자와 팀은 그대로 두고 방을 대기 상태로 되돌리며,
   * 요청한 사람만 준비로 표시해 나머지가 각자 뜻을 밝히게 한다.
   * 대기 상태가 되면 방 코드로 다시 들어올 수도 있어 도중에 나간 사람도 합류할 수 있다.
   */
  private restartRoom(room: Room, actor: RoomPlayer): void {
    room.phase = "waiting";
    room.game = null;
    room.finishedAt = null;
    room.actionExpiresAt = null;
    room.winnerName = null;
    for (const player of room.players) {
      player.ready = player.id === actor.id;
    }
    // 경기 중에 방장이 나갔다면 다시 하기를 부른 사람이 방장을 잇는다. 그러지 않으면 시작할 사람이 없다.
    if (!this.connectedPlayer(room, room.hostPlayerId)) {
      room.hostPlayerId = actor.id;
    }
  }

  private finishRoom(room: Room): void {
    const winnerId = room.game?.winnerId ?? null;
    room.winnerName = winnerId === null
      ? null
      : room.mode === "team"
        ? `${winnerId}팀`
        : room.players.find((player) => player.id === winnerId)?.nickname ?? null;
    room.phase = "finished";
    room.finishedAt = this.options.now();
    room.actionExpiresAt = null;
    if (room.actionTimerId !== null) {
      this.options.cancel(room.actionTimerId);
      room.actionTimerId = null;
    }
  }

  private scheduleAction(room: Room, delay: number, preserveDeadline = false): void {
    if (!room.game || room.phase !== "playing") return;
    if (room.actionTimerId !== null) this.options.cancel(room.actionTimerId);
    if (!preserveDeadline) room.actionExpiresAt = this.options.now() + this.options.actionTimeoutMs;
    room.actionTimerId = this.options.schedule(() => this.handleActionTimer(room.roomCode), delay);
  }

  private handleActionTimer(roomCode: string): void {
    const room = this.rooms.get(roomCode);
    if (!room || room.phase !== "playing" || !room.game) return;
    room.actionTimerId = null;

    const current = room.players.find((player) => player.id === room.game?.currentPlayerId);
    const now = this.options.now();
    if (current?.connected && room.actionExpiresAt !== null && now < room.actionExpiresAt) {
      this.scheduleAction(room, room.actionExpiresAt - now, true);
      return;
    }

    room.game = applyGameCommand(room.game, chooseAutoCommand(room.game, this.options.random));
    room.version += 1;
    if (room.game.turnStage === "COMPLETE") {
      this.finishRoom(room);
    } else {
      const nextPlayer = room.players.find((player) => player.id === room.game?.currentPlayerId);
      this.scheduleAction(room, nextPlayer?.connected ? this.options.actionTimeoutMs : 0);
    }
    this.notify(room);
  }

  private assertWaiting(room: Room): void {
    if (room.phase !== "waiting") {
      throw new RoomError("ROOM_NOT_WAITING", ROOM_ERROR_MESSAGES.ROOM_NOT_WAITING);
    }
  }

  /**
   * 색을 가진 주체. 개인전은 참가자 자신, 팀전은 그 팀이다.
   * 팀 색은 그 팀에 먼저 들어온 사람이 정한다. 둘이 같은 말을 쓰므로 색도 하나여야 한다.
   */
  private colorControllerFor(room: Room, actor: RoomPlayer): string {
    if (room.mode !== "team") return actor.id;
    if (!actor.teamId) {
      throw new RoomError("NO_TEAM", ROOM_ERROR_MESSAGES.NO_TEAM);
    }
    const leader = room.players.find((player) => player.teamId === actor.teamId);
    if (leader?.id !== actor.id) {
      throw new RoomError("TEAM_LEADER_ONLY", ROOM_ERROR_MESSAGES.TEAM_LEADER_ONLY);
    }
    return actor.teamId;
  }

  private chooseColor(room: Room, actor: RoomPlayer, slot: number): void {
    const controllerId = this.colorControllerFor(room, actor);
    for (const [holder, held] of room.colorChoices) {
      if (held === slot && holder !== controllerId) {
        throw new RoomError("COLOR_TAKEN", ROOM_ERROR_MESSAGES.COLOR_TAKEN);
      }
    }
    room.colorChoices.set(controllerId, slot);
  }

  /**
   * 주인이 사라진 색을 놓아준다. 내보내거나 팀을 옮겨 팀이 비면 그 색을 쥔 사람이 없어지는데,
   * 그대로 두면 아무도 고를 수 없는 색이 되어 넷뿐인 색이 금방 바닥난다.
   */
  private releaseOrphanedColors(room: Room): void {
    const held = new Set(
      room.players.flatMap((player) => {
        const controllerId = room.mode === "team" ? player.teamId : player.id;
        return controllerId ? [controllerId] : [];
      }),
    );
    for (const controllerId of [...room.colorChoices.keys()]) {
      if (!held.has(controllerId)) room.colorChoices.delete(controllerId);
    }
  }

  /** 게임을 시작할 때 아직 색이 없는 주체에게 남은 색을 앞에서부터 준다. */
  private fillMissingColors(room: Room): void {
    const taken = new Set(room.colorChoices.values());
    for (const player of room.players) {
      const controllerId = room.mode === "team" ? player.teamId : player.id;
      if (!controllerId || room.colorChoices.has(controllerId)) continue;
      const free = [...Array(COLOR_SLOTS).keys()].find((slot) => !taken.has(slot));
      if (free === undefined) continue;
      room.colorChoices.set(controllerId, free);
      taken.add(free);
    }
  }

  private assertFinished(room: Room): void {
    if (room.phase !== "finished") {
      throw new RoomError("ROOM_NOT_FINISHED", ROOM_ERROR_MESSAGES.ROOM_NOT_FINISHED);
    }
  }

  private assertHost(room: Room, playerId: string): void {
    if (room.hostPlayerId !== playerId) {
      throw new RoomError("HOST_ONLY", "방장만 수행할 수 있습니다.");
    }
  }

  private connectedPlayer(room: Room, playerId: string): RoomPlayer | undefined {
    return room.players.find((player) => player.id === playerId && player.connected);
  }

  private startEligibility(room: Room): StartEligibility {
    if (room.mode === "individual" && room.players.length < 2) {
      return {
        canStart: false,
        code: "NOT_ENOUGH_PLAYERS",
        reason: "게임을 시작하려면 2명 이상이 필요합니다.",
      };
    }
    if (room.mode === "team") {
      const teams: TeamId[] = ["A", "B", "C", "D"];
      const compositionIsValid = room.players.length === 8 && teams.every(
        (teamId) => room.players.filter((player) => player.teamId === teamId).length === 2,
      );
      if (!compositionIsValid) {
        return {
          canStart: false,
          code: "INVALID_TEAM_COMPOSITION",
          reason: "각 팀에 2명이 필요합니다.",
        };
      }
    }
    if (room.players.some((player) => !player.connected || !player.ready)) {
      return {
        canStart: false,
        code: "PLAYERS_NOT_READY",
        reason: "모든 참가자가 연결되고 준비되어야 합니다.",
      };
    }
    return { canStart: true, reason: null };
  }

  private findPlayer(playerId: string): { room: Room; player: RoomPlayer } {
    const roomCode = this.playerRooms.get(playerId);
    const room = roomCode ? this.rooms.get(roomCode) : undefined;
    const player = room?.players.find((candidate) => candidate.id === playerId);
    if (!room || !player) {
      throw new RoomError("PLAYER_NOT_FOUND", "참가자를 찾을 수 없습니다.", false);
    }
    return { room, player };
  }

  private createPlayer(nickname: string): { player: RoomPlayer; token: string } {
    const token = randomBytes(32).toString("base64url");
    return {
      token,
      player: {
        id: randomUUID(),
        nickname,
        connected: true,
        ready: false,
        reconnectTokenHash: hashToken(token),
        processedRequestIds: new Set(),
      },
    };
  }

  private createRoomCode(): string {
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      const code = Array.from({ length: 6 }, () => {
        const index = Math.min(
          ROOM_CODE_ALPHABET.length - 1,
          Math.floor(this.options.random() * ROOM_CODE_ALPHABET.length),
        );
        return ROOM_CODE_ALPHABET[index];
      }).join("");
      if (!this.rooms.has(code)) return code;
    }
    throw new RoomError("ROOM_CODE_EXHAUSTED", "방 코드를 생성할 수 없습니다.", false);
  }

  private sessionResult(room: Room, playerId: string, reconnectToken: string): SessionResult {
    return { snapshot: this.snapshot(room), playerId, reconnectToken };
  }

  private snapshot(room: Room): PublicRoomSnapshot {
    const eligibility = this.startEligibility(room);
    return {
      roomCode: room.roomCode,
      version: room.version,
      phase: room.phase,
      mode: room.mode,
      hostPlayerId: room.hostPlayerId,
      canStart: eligibility.canStart,
      startEligibilityReason: eligibility.reason,
      players: room.players.map((player) => {
        // 팀전은 팀이 색을 가지므로 팀원 둘이 같은 값을 받는다.
        const controllerId = room.mode === "team" ? player.teamId : player.id;
        const colorSlot = controllerId ? room.colorChoices.get(controllerId) : undefined;
        return {
          id: player.id,
          nickname: player.nickname,
          connected: player.connected,
          ready: player.ready,
          ...(player.teamId ? { teamId: player.teamId } : {}),
          ...(colorSlot === undefined ? {} : { colorSlot }),
        };
      }),
      game: room.game
        ? {
            ...toPublicGameState(room.game, room.phase === "playing" ? room.actionExpiresAt : null),
            winnerName: room.winnerName,
          }
        : null,
    };
  }

  private notify(room: Room, snapshot: PublicRoomSnapshot = this.snapshot(room)): void {
    const change = { roomCode: room.roomCode, snapshot };
    for (const listener of [...this.listeners]) {
      try {
        listener(change);
      } catch (error) {
        try {
          this.options.onListenerError?.(error);
        } catch {
          // Diagnostics must not change an already-committed room mutation.
        }
      }
    }
  }

  private deleteRoom(room: Room): void {
    const removal = {
      roomCode: room.roomCode,
      playerIds: room.players.map((player) => player.id),
    };
    if (room.actionTimerId !== null) this.options.cancel(room.actionTimerId);
    for (const player of room.players) {
      this.playerRooms.delete(player.id);
      this.sessions.delete(player.reconnectTokenHash);
    }
    this.rooms.delete(room.roomCode);
    for (const listener of [...this.removalListeners]) {
      try {
        listener(removal);
      } catch (error) {
        try {
          this.options.onListenerError?.(error);
        } catch {
          // Diagnostics must not interrupt completed room deletion.
        }
      }
    }
  }
}
