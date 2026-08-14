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

function leaveTimeoutError(): ServerError {
  return {
    code: "LEAVE_TIMEOUT",
    message: "방 나가기 응답을 받지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.",
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
  // 전송 도중 연결이 끊기면 같은 요청 ID로 다시 보내 서버의 중복 방지를 그대로 쓴다.
  const leaveCommandRef = useRef<Extract<InRoomCommand, { type: "LEAVE_ROOM" }> | null>(null);
  const leaveTimerRef = useRef<number | null>(null);

  const clearReactionState = useCallback((): void => {
    for (const timer of reactionTimersRef.current.values()) window.clearTimeout(timer);
    reactionTimersRef.current.clear();
    setReactions([]);
  }, []);

  /** 서버 확인을 기다리는 동안 화면만 입장 로비로 전환한다. 복구 정보는 아직 보존한다. */
  const hideRoomState = useCallback((): void => {
    clearReactionState();
    setSnapshot(null);
    setError(null);
  }, [clearReactionState]);

  /** 서버가 퇴장을 확인한 뒤 방에 속한 것을 모두 놓는다. */
  const clearRoomState = useCallback((): void => {
    snapshotRef.current = null;
    clearReconnectToken();
    clearReactionState();
    setPlayerId(null);
    setSnapshot(null);
    setError(null);
  }, [clearReactionState]);

  /** 거절·시간 초과에는 보존한 방을 다시 보여 주어 재시도할 수 있게 한다. */
  const cancelLeaving = useCallback((nextError: ServerError): void => {
    leavingRef.current = false;
    leaveCommandRef.current = null;
    if (leaveTimerRef.current !== null) {
      window.clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    setSnapshot(snapshotRef.current);
    setError(nextError);
    setConnectionState(socketRef.current?.connected ? "connected" : "reconnecting");
  }, []);

  /** 옛 소켓을 놓고 이름 없는 새 소켓으로 로비에 선다. */
  const finishLeaving = useCallback((): void => {
    leavingRef.current = false;
    leaveCommandRef.current = null;
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
    const markConnected = () => {
      const pendingLeave = leaveCommandRef.current;
      if (leavingRef.current && pendingLeave) {
        setConnectionState("connecting");
        socket.emit("command", pendingLeave);
        return;
      }
      setConnectionState("connected");
    };
    const markOffline = () => setConnectionState("offline");
    socket.io.on("reconnect_attempt", markReconnecting);
    socket.io.on("reconnect", markConnected);
    socket.io.on("reconnect_failed", markOffline);

    socket.on("connect", markConnected);
    socket.on("connect_error", markReconnecting);
    socket.on("disconnect", (reason) => {
      if (leavingRef.current) {
        // Socket.IO 서버가 직접 끊은 경우만 자리 삭제의 확인으로 본다.
        if (reason === "io server disconnect") finishLeaving();
        else setConnectionState("reconnecting");
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
      if (leavingRef.current) {
        if (TERMINAL_SESSION_ERROR_CODES.has(nextError.code)) finishLeaving();
        else cancelLeaving(nextError);
        return;
      }
      setError(nextError);
      if (TERMINAL_SESSION_ERROR_CODES.has(nextError.code)) {
        clearRoomState();
        setError(nextError);
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
      leaveCommandRef.current = null;
      for (const timer of reactionTimers.values()) window.clearTimeout(timer);
      reactionTimers.clear();
      socket.io.off("reconnect_attempt", markReconnecting);
      socket.io.off("reconnect", markConnected);
      socket.io.off("reconnect_failed", markOffline);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [socketFactory, cancelLeaving, clearRoomState, finishLeaving]);

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
    if (leavingRef.current) return;
    const socket = socketRef.current;
    const roomVersion = snapshotRef.current?.version;
    // 방에서 빼 달라고 먼저 알린다. 이 말을 빠뜨리면 자리와 색이 남아
    // 남은 사람들이 게임을 시작할 수 없다.
    // 알리고 곧바로 끊으면 그 패킷이 버려지므로, 서버가 소켓을 놓아 줄 때까지 기다린다.
    if (!socket?.connected || roomVersion === undefined) {
      setError(offlineError());
      return;
    }
    const command = { type: "LEAVE_ROOM", roomVersion, requestId: newRequestId() } as const;
    leavingRef.current = true;
    leaveCommandRef.current = command;
    socket.emit("command", command);
    // 화면은 기다리지 않고 입장 로비로 옮기되, 서버 확인 전에는 표를 버리지 않는다.
    hideRoomState();
    setConnectionState("connecting");
    leaveTimerRef.current = window.setTimeout(
      () => cancelLeaving(leaveTimeoutError()),
      LEAVE_GRACE_MS,
    );
  }, [cancelLeaving, hideRoomState]);

  return { playerId, snapshot, error, connectionState, reactions, createRoom, joinRoom, sendCommand, leaveRoom };
}
