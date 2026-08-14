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

const RATE_LIMITED: ServerError = {
  code: "RATE_LIMITED",
  message: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
  recoverable: true,
};

const DEFAULT_RATE_LIMIT = {
  windowMs: 1_000,
  maxCommands: 30,
  maxReactions: 4,
  now: Date.now,
} satisfies GatewayRateLimitOptions;

interface SocketData {
  playerId?: string;
  roomCode?: string;
}

interface ClientToServerEvents {
  command: (raw: unknown, acknowledge?: () => void) => void;
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
  rateLimit?: Partial<GatewayRateLimitOptions>;
}

export interface GatewayRateLimitOptions {
  windowMs: number;
  maxCommands: number;
  maxReactions: number;
  now: () => number;
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

interface FixedWindowState {
  startedAt: number;
  count: number;
}

function consumeQuota(
  state: FixedWindowState,
  now: number,
  windowMs: number,
  maximum: number,
): boolean {
  if (now < state.startedAt || now - state.startedAt >= windowMs) {
    state.startedAt = now;
    state.count = 0;
  }
  if (state.count >= maximum) return false;
  state.count += 1;
  return true;
}

function mapError(error: unknown): ServerError {
  if (error instanceof RoomError) {
    // RoomError가 이미 사람이 읽을 한국어 문구를 들고 온다. 여기서 표를 따로 두면
    // 새 오류를 만들 때마다 등록을 잊게 되고, 잊은 것은 "요청을 처리할 수 없습니다"로 뭉개진다.
    return {
      code: error.code,
      message: error.message,
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
  const rateLimit = { ...DEFAULT_RATE_LIMIT, ...options.rateLimit };
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
    const connectedAt = rateLimit.now();
    const commandQuota: FixedWindowState = { startedAt: connectedAt, count: 0 };
    const reactionQuota: FixedWindowState = { startedAt: connectedAt, count: 0 };
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

    socket.on("command", (raw: unknown, acknowledge?: () => void) => {
      const now = rateLimit.now();
      const result = parseClientCommand(raw);
      const bypassCommandQuota = result.success
        && result.data.type === "LEAVE_ROOM"
        && socket.data.playerId !== undefined;
      if (
        !bypassCommandQuota &&
        !consumeQuota(commandQuota, now, rateLimit.windowMs, rateLimit.maxCommands)
      ) {
        emitError(socket, RATE_LIMITED);
        return;
      }
      if (!result.success) {
        emitError(socket, INVALID_COMMAND);
        return;
      }
      if (
        result.data.type === "REACT" &&
        !consumeQuota(reactionQuota, now, rateLimit.windowMs, rateLimit.maxReactions)
      ) {
        emitError(socket, RATE_LIMITED);
        return;
      }
      try {
        const kickedPlayerId = result.data.type === "KICK_PLAYER"
          ? result.data.playerId
          : undefined;
        // 스스로 나간 사람의 자리는 서버가 지웠다. 소켓도 함께 놓아 주어야
        // 남은 표로 다시 붙지 않는다.
        const leavingPlayerId = result.data.type === "LEAVE_ROOM"
          ? socket.data.playerId
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
        if (leavingPlayerId) {
          if (typeof acknowledge === "function") acknowledge();
          setImmediate(() => evictPlayer(leavingPlayerId));
        }
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
