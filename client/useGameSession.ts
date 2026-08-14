"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  GameMode,
  InRoomCommand,
  PublicRoomSnapshot,
  ServerError,
} from "../shared/protocol";
import { clearReconnectToken, readReconnectToken, writeReconnectToken } from "./reconnectToken";
import { newRequestId } from "./requestId";
import { createGameSocket, type GameSocket, type ReactionEvent } from "./socket";

const TERMINAL_SESSION_ERROR_CODES = new Set([
  "ROOM_NOT_FOUND",
  "SESSION_NOT_FOUND",
  "INVALID_SESSION",
]);
const REACTION_VISIBLE_MS = 2000;
/**
 * 나가겠다고 알린 뒤 서버가 소켓을 놓아 주기를 기다리는 시간.
 * 알림과 끊기를 한 호흡에 하면 그 패킷이 실려 나가지 못한 채 버려진다.
 * 서버가 조용하면 이만큼 뒤에 우리가 끊는다.
 */
const LEAVE_GRACE_MS = 1500;

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "offline";

export interface GameSession {
  playerId: string | null;
  snapshot: PublicRoomSnapshot | null;
  error: ServerError | null;
  connectionState: ConnectionState;
  reactions: ReactionEvent[];
  createRoom: (nickname: string, mode: GameMode) => Promise<void>;
  joinRoom: (nickname: string, roomCode: string) => Promise<void>;
  sendCommand: (command: InRoomCommand) => void;
  leaveRoom: () => void;
}

export interface UseGameSessionOptions {
  socketFactory?: (reconnectToken: string | null) => GameSocket;
}

function offlineError(): ServerError {
  return {
    code: "OFFLINE",
    message: "서버에 연결된 후 다시 시도해 주세요.",
    recoverable: true,
  };
}

function initialConnectionState(): ConnectionState {
  if (typeof window === "undefined") return "connecting";
  return readReconnectToken() ? "reconnecting" : "connecting";
}

export function useGameSession(options: UseGameSessionOptions = {}): GameSession {
  const socketFactory = options.socketFactory ?? createGameSocket;
  const socketRef = useRef<GameSocket | null>(null);
  const nextReactionIdRef = useRef(1);
  const reactionTimersRef = useRef(new Map<number, number>());
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<PublicRoomSnapshot | null>(null);
  const [error, setError] = useState<ServerError | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>(initialConnectionState);
  const [reactions, setReactions] = useState<ReactionEvent[]>([]);
  // 나갈 때 서버에 알리려면 가장 최근 방 버전이 필요하다. 그리는 값과 따로 둔다.
  const snapshotRef = useRef<PublicRoomSnapshot | null>(null);
  // 나가는 중. 이 사이에 오는 방 소식은 이미 내 것이 아니므로 받지 않는다.
  const leavingRef = useRef(false);
  const leaveTimerRef = useRef<number | null>(null);

  /** 방에 속한 것을 모두 놓는다. 화면은 이 순간부터 로비다. */
  const clearRoomState = useCallback((): void => {
    snapshotRef.current = null;
    clearReconnectToken();
    for (const timer of reactionTimersRef.current.values()) window.clearTimeout(timer);
    reactionTimersRef.current.clear();
    setPlayerId(null);
    setSnapshot(null);
    setReactions([]);
    setError(null);
  }, []);

  /** 옛 소켓을 놓고 이름 없는 새 소켓으로 로비에 선다. */
  const finishLeaving = useCallback((): void => {
    leavingRef.current = false;
    if (leaveTimerRef.current !== null) {
      window.clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    clearRoomState();
    const socket = socketRef.current;
    if (!socket) {
      setConnectionState("offline");
      return;
    }
    socket.auth = {};
    if (socket.connected) socket.disconnect();
    setConnectionState("connecting");
    socket.connect();
  }, [clearRoomState]);

  useEffect(() => {
    const reactionTimers = reactionTimersRef.current;
    const reconnectToken = readReconnectToken();
    const socket = socketFactory(reconnectToken);
    socketRef.current = socket;

    const markReconnecting = () => setConnectionState("reconnecting");
    const markConnected = () => setConnectionState("connected");
    const markOffline = () => setConnectionState("offline");
    socket.io.on("reconnect_attempt", markReconnecting);
    socket.io.on("reconnect", markConnected);
    socket.io.on("reconnect_failed", markOffline);

    socket.on("connect", markConnected);
    socket.on("connect_error", markReconnecting);
    socket.on("disconnect", (reason) => {
      // 나가겠다고 알린 뒤의 끊김은 서버가 자리를 지웠다는 뜻이다. 이제 새 소켓으로 로비에 선다.
      if (leavingRef.current) {
        finishLeaving();
        return;
      }
      setConnectionState(
        reason === "transport close" || reason === "transport error" || reason === "ping timeout"
          ? "reconnecting"
          : "offline",
      );
    });
    socket.on("session", (session) => {
      writeReconnectToken(session.reconnectToken);
      setPlayerId(session.playerId);
      setError(null);
    });
    socket.on("snapshot", (nextSnapshot) => {
      if (leavingRef.current) return;
      setSnapshot((currentSnapshot) => {
        if (currentSnapshot !== null && nextSnapshot.version < currentSnapshot.version) {
          return currentSnapshot;
        }
        // 방이 앞으로 나아갔다는 것은 누군가의 명령이 통했다는 뜻이다.
        // 조금 전 거절 문구를 계속 붙여 두면 무엇이 지금 잘못된 것인지 알 수 없다.
        setError(null);
        snapshotRef.current = nextSnapshot;
        return nextSnapshot;
      });
    });
    socket.on("reaction", (payload) => {
      const reaction = { id: nextReactionIdRef.current++, ...payload };
      setReactions((current) => [...current, reaction]);
      const timer = window.setTimeout(() => {
        setReactions((current) => current.filter((item) => item.id !== reaction.id));
        reactionTimers.delete(reaction.id);
      }, REACTION_VISIBLE_MS);
      reactionTimers.set(reaction.id, timer);
    });
    socket.on("server_error", (nextError) => {
      setError(nextError);
      if (TERMINAL_SESSION_ERROR_CODES.has(nextError.code)) {
        clearReconnectToken();
        setPlayerId(null);
        setSnapshot(null);
        socket.auth = {};
        socket.disconnect();
        setConnectionState("offline");
      }
    });

    socket.connect();
    return () => {
      if (leaveTimerRef.current !== null) {
        window.clearTimeout(leaveTimerRef.current);
        leaveTimerRef.current = null;
      }
      leavingRef.current = false;
      for (const timer of reactionTimers.values()) window.clearTimeout(timer);
      reactionTimers.clear();
      socket.io.off("reconnect_attempt", markReconnecting);
      socket.io.off("reconnect", markConnected);
      socket.io.off("reconnect_failed", markOffline);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [socketFactory, finishLeaving]);

  const emit = useCallback((command: unknown): boolean => {
    const socket = socketRef.current;
    if (!socket?.connected) {
      setError(offlineError());
      return false;
    }
    setError(null);
    socket.emit("command", command);
    return true;
  }, []);

  const createRoom = useCallback(async (nickname: string, mode: GameMode): Promise<void> => {
    emit({ type: "CREATE_ROOM", nickname, mode });
  }, [emit]);

  const joinRoom = useCallback(async (nickname: string, roomCode: string): Promise<void> => {
    emit({ type: "JOIN_ROOM", nickname, roomCode });
  }, [emit]);

  const sendCommand = useCallback((command: InRoomCommand): void => {
    emit(command);
  }, [emit]);

  const leaveRoom = useCallback((): void => {
    const socket = socketRef.current;
    const roomVersion = snapshotRef.current?.version;
    // 방에서 빼 달라고 먼저 알린다. 이 말을 빠뜨리면 자리와 색이 남아
    // 남은 사람들이 게임을 시작할 수 없다.
    // 알리고 곧바로 끊으면 그 패킷이 버려지므로, 서버가 소켓을 놓아 줄 때까지 기다린다.
    if (socket?.connected && roomVersion !== undefined) {
      leavingRef.current = true;
      socket.emit("command", { type: "LEAVE_ROOM", roomVersion, requestId: newRequestId() });
      // 화면은 기다리지 않고 곧바로 로비로 돌린다.
      clearRoomState();
      leaveTimerRef.current = window.setTimeout(finishLeaving, LEAVE_GRACE_MS);
      return;
    }
    finishLeaving();
  }, [clearRoomState, finishLeaving]);

  return { playerId, snapshot, error, connectionState, reactions, createRoom, joinRoom, sendCommand, leaveRoom };
}
