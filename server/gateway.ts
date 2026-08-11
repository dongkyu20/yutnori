import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer, type Socket } from "socket.io";
import type {
  InRoomCommand,
  PublicRoomSnapshot,
  ServerError,
} from "../shared/protocol";
import { parseClientCommand } from "../shared/schemas";
import { RoomError, RoomService, type SessionResult } from "./rooms";

const INVALID_COMMAND: ServerError = {
  code: "INVALID_COMMAND",
  message: "요청 형식이 올바르지 않습니다.",
  recoverable: true,
};

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  ROOM_NOT_FOUND: "방을 찾을 수 없습니다.",
  GAME_ALREADY_STARTED: "이미 시작된 게임입니다.",
  GAME_NOT_PLAYING: "진행 중인 게임이 아닙니다.",
  ROOM_NOT_WAITING: "대기 중인 방에서만 수행할 수 있습니다.",
  ROOM_FULL: "방이 가득 찼습니다.",
  NICKNAME_TAKEN: "이미 사용 중인 닉네임입니다.",
  SESSION_NOT_FOUND: "재접속 세션을 찾을 수 없습니다.",
  PLAYER_DISCONNECTED: "연결된 참가자만 행동할 수 있습니다.",
  STALE_VERSION: "오래된 방 버전입니다.",
  WRONG_MODE: "팀전에서만 팀을 배정할 수 있습니다.",
  PLAYER_NOT_FOUND: "참가자를 찾을 수 없습니다.",
  TEAM_FULL: "한 팀에는 두 명까지만 배정할 수 있습니다.",
  HOST_CANNOT_KICK_SELF: "방장은 자신을 내보낼 수 없습니다.",
  NOT_ENOUGH_PLAYERS: "개인전에는 두 명 이상이 필요합니다.",
  INVALID_TEAM_COMPOSITION: "각 팀에 두 명이 필요합니다.",
  PLAYERS_NOT_READY: "모든 참가자가 준비해야 합니다.",
  HOST_ONLY: "방장만 수행할 수 있습니다.",
  ROOM_CODE_EXHAUSTED: "방 코드를 생성할 수 없습니다.",
  INVALID_ACTION: "현재 상태에서 수행할 수 없는 행동입니다.",
};

interface SocketData {
  playerId?: string;
  roomCode?: string;
}

interface ClientToServerEvents {
  command: (raw: unknown) => void;
}

interface ServerToClientEvents {
  reaction: (reaction: { playerId: string; emoji: Extract<InRoomCommand, { type: "REACT" }>["emoji"] }) => void;
  server_error: (error: ServerError) => void;
  session: (session: { playerId: string; reconnectToken: string }) => void;
  snapshot: (snapshot: PublicRoomSnapshot) => void;
}

type GatewayServer = SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

type GatewaySocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

export interface GatewayOptions {
  publicOrigin: string;
  roomService?: RoomService;
}

export interface Gateway {
  io: GatewayServer;
  close: () => Promise<void>;
}

function roomChannel(roomCode: string): string {
  return `room:${roomCode}`;
}

function emitError(socket: GatewaySocket, error: ServerError): void {
  socket.emit("server_error", error);
}

function mapError(error: unknown): ServerError {
  if (error instanceof RoomError) {
    return {
      code: error.code,
      message: ERROR_MESSAGES[error.code] ?? "요청을 처리할 수 없습니다.",
      recoverable: error.recoverable,
    };
  }
  return {
    code: "INTERNAL_ERROR",
    message: "서버 오류가 발생했습니다.",
    recoverable: false,
  };
}

function attachSession(socket: GatewaySocket, session: SessionResult): void {
  socket.data.playerId = session.playerId;
  socket.data.roomCode = session.snapshot.roomCode;
  void socket.join(roomChannel(session.snapshot.roomCode));
  socket.emit("session", {
    playerId: session.playerId,
    reconnectToken: session.reconnectToken,
  });
  socket.emit("snapshot", session.snapshot);
}

function handleValidatedCommand(
  io: GatewayServer,
  roomService: RoomService,
  socket: GatewaySocket,
  command: InRoomCommand,
): void {
  const { playerId, roomCode } = socket.data;
  if (!playerId || !roomCode) {
    emitError(socket, {
      code: "SESSION_REQUIRED",
      message: "먼저 방에 참여해 주세요.",
      recoverable: true,
    });
    return;
  }

  roomService.dispatch(playerId, command);
  if (command.type === "REACT") {
    io.to(roomChannel(roomCode)).emit("reaction", { playerId, emoji: command.emoji });
  }
}

export function createGateway(httpServer: HttpServer, options: GatewayOptions): Gateway {
  const roomService = options.roomService ?? new RoomService();
  const activeSockets = new Map<string, string>();
  let closing = false;
  const io = new SocketIOServer<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
  >(httpServer, {
    cors: { origin: options.publicOrigin },
    allowRequest: (request, callback) => {
      callback(null, request.headers.origin === options.publicOrigin);
    },
  });

  const evictPlayer = (playerId: string): void => {
    const socketId = activeSockets.get(playerId);
    if (!socketId) return;
    activeSockets.delete(playerId);
    const target = io.sockets.sockets.get(socketId);
    if (!target) return;
    target.data.playerId = undefined;
    target.data.roomCode = undefined;
    target.disconnect(true);
  };

  const unsubscribe = roomService.subscribe(({ roomCode, snapshot }) => {
    io.to(roomChannel(roomCode)).emit("snapshot", snapshot);
  });
  const unsubscribeRemoval = roomService.subscribeRemoval(({ playerIds }) => {
    for (const playerId of playerIds) evictPlayer(playerId);
  });

  const attachGatewaySession = (socket: GatewaySocket, session: SessionResult): void => {
    const previousSocketId = activeSockets.get(session.playerId);
    if (previousSocketId && previousSocketId !== socket.id) {
      const previousSocket = io.sockets.sockets.get(previousSocketId);
      if (previousSocket) {
        previousSocket.data.playerId = undefined;
        previousSocket.data.roomCode = undefined;
        previousSocket.disconnect(true);
      }
    }
    activeSockets.set(session.playerId, socket.id);
    attachSession(socket, session);
  };

  io.on("connection", (socket: GatewaySocket) => {
    const reconnectToken = socket.handshake.auth.reconnectToken;
    if (reconnectToken !== undefined) {
      if (typeof reconnectToken !== "string" || reconnectToken.length === 0) {
        emitError(socket, {
          code: "INVALID_SESSION",
          message: "재접속 정보가 올바르지 않습니다.",
          recoverable: false,
        });
      } else {
        try {
          attachGatewaySession(socket, roomService.reconnect(reconnectToken));
        } catch (error) {
          emitError(socket, mapError(error));
        }
      }
    }

    socket.on("command", (raw: unknown) => {
      const result = parseClientCommand(raw);
      if (!result.success) {
        emitError(socket, INVALID_COMMAND);
        return;
      }
      try {
        const kickedPlayerId = result.data.type === "KICK_PLAYER"
          ? result.data.playerId
          : undefined;
        if (result.data.type === "CREATE_ROOM" || result.data.type === "JOIN_ROOM") {
          if (socket.data.playerId) {
            emitError(socket, {
              code: "ALREADY_IN_ROOM",
              message: "이미 방에 참여하고 있습니다.",
              recoverable: true,
            });
            return;
          }
          const session = result.data.type === "CREATE_ROOM"
            ? roomService.createRoom({ nickname: result.data.nickname, mode: result.data.mode })
            : roomService.joinRoom({
                nickname: result.data.nickname,
                roomCode: result.data.roomCode,
              });
          attachGatewaySession(socket, session);
          return;
        }
        handleValidatedCommand(io, roomService, socket, result.data);
        if (kickedPlayerId) evictPlayer(kickedPlayerId);
      } catch (error) {
        emitError(socket, mapError(error));
      }
    });

    socket.on("disconnect", () => {
      const { playerId } = socket.data;
      if (!closing && playerId && activeSockets.get(playerId) === socket.id) {
        activeSockets.delete(playerId);
        roomService.disconnect(playerId);
      }
    });
  });

  return {
    io,
    close: async () => {
      closing = true;
      unsubscribe();
      unsubscribeRemoval();
      activeSockets.clear();
      await io.close();
    },
  };
}
