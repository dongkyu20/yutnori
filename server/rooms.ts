import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  GameMode,
  InRoomCommand,
  PublicRoomSnapshot,
  TeamId,
} from "../shared/protocol";
import { nicknameSchema, roomCodeSchema } from "../shared/schemas";
import { chooseAutoCommand } from "./autoAction";
import { applyGameCommand, createGame, toPublicGameState } from "./game/reducer";
import type { GameState } from "./game/types";
import { throwYut } from "./game/yut";

const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const ACTION_TIMEOUT_MS = 45_000;
const EMPTY_ROOM_TTL_MS = 10 * 60_000;
const FINISHED_ROOM_TTL_MS = 30 * 60_000;
const ROOM_ERROR_MESSAGES = {
  ROOM_NOT_FOUND: "방을 찾을 수 없습니다.",
  GAME_ALREADY_STARTED: "이미 시작된 게임입니다.",
  GAME_NOT_PLAYING: "진행 중인 게임이 아닙니다.",
  ROOM_NOT_WAITING: "대기 중인 방에서만 수행할 수 있습니다.",
} as const;

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
  actionExpiresAt: number | null;
  actionTimerId: unknown | null;
  emptySince: number | null;
  finishedAt: number | null;
}

interface SessionLocation {
  roomCode: string;
  playerId: string;
}

export interface RoomServiceOptions {
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

  constructor(options: Partial<RoomServiceOptions> = {}) {
    this.options = { ...defaultOptions, ...options };
  }

  subscribe(listener: RoomChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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
      actionExpiresAt: null,
      actionTimerId: null,
      emptySince: null,
      finishedAt: null,
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
    room.players.push(session.player);
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
    if (command.roomVersion !== room.version) {
      throw new RoomError("STALE_VERSION", "오래된 방 버전입니다.");
    }

    this.applyCommand(room, player, command);
    player.processedRequestIds.add(command.requestId);
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
        return;
      case "KICK_PLAYER":
        this.assertWaiting(room);
        this.assertHost(room, actor.id);
        this.kickPlayer(room, actor.id, command.playerId);
        return;
      case "START_GAME":
        this.assertWaiting(room);
        this.assertHost(room, actor.id);
        this.startGame(room);
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
    room.game = applyGameCommand(room.game, command);
    if (room.game.turnStage === "COMPLETE") {
      this.finishRoom(room);
    } else {
      this.scheduleAction(room, ACTION_TIMEOUT_MS);
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
    const [removed] = room.players.splice(index, 1);
    this.sessions.delete(removed.reconnectTokenHash);
    this.playerRooms.delete(removed.id);
  }

  private startGame(room: Room): void {
    if (room.mode === "individual") {
      if (room.players.length < 2) {
        throw new RoomError("NOT_ENOUGH_PLAYERS", "개인전에는 두 명 이상이 필요합니다.");
      }
    } else {
      const teams: TeamId[] = ["A", "B", "C", "D"];
      if (
        room.players.length !== 8 ||
        teams.some((teamId) => room.players.filter((player) => player.teamId === teamId).length !== 2)
      ) {
        throw new RoomError("INVALID_TEAM_COMPOSITION", "각 팀에 두 명이 필요합니다.");
      }
    }
    if (room.players.some((player) => !player.connected || !player.ready)) {
      throw new RoomError("PLAYERS_NOT_READY", "모든 참가자가 준비해야 합니다.");
    }

    room.game = createGame({
      mode: room.mode,
      players: room.players.map((player) => ({
        id: player.id,
        ...(player.teamId ? { teamId: player.teamId } : {}),
      })),
    });
    room.phase = "playing";
    this.scheduleAction(room, ACTION_TIMEOUT_MS);
  }

  private finishRoom(room: Room): void {
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
    if (!preserveDeadline) room.actionExpiresAt = this.options.now() + ACTION_TIMEOUT_MS;
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
      this.scheduleAction(room, nextPlayer?.connected ? ACTION_TIMEOUT_MS : 0);
    }
    this.notify(room);
  }

  private assertWaiting(room: Room): void {
    if (room.phase !== "waiting") {
      throw new RoomError("ROOM_NOT_WAITING", ROOM_ERROR_MESSAGES.ROOM_NOT_WAITING);
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
    return {
      roomCode: room.roomCode,
      version: room.version,
      phase: room.phase,
      mode: room.mode,
      hostPlayerId: room.hostPlayerId,
      players: room.players.map((player) => ({
        id: player.id,
        nickname: player.nickname,
        connected: player.connected,
        ready: player.ready,
        ...(player.teamId ? { teamId: player.teamId } : {}),
      })),
      game: room.game
        ? toPublicGameState(room.game, room.phase === "playing" ? room.actionExpiresAt : null)
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
    if (room.actionTimerId !== null) this.options.cancel(room.actionTimerId);
    for (const player of room.players) {
      this.playerRooms.delete(player.id);
      this.sessions.delete(player.reconnectTokenHash);
    }
    this.rooms.delete(room.roomCode);
  }
}
