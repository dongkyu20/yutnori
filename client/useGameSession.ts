"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  GameMode,
  InRoomCommand,
  PublicRoomSnapshot,
  ServerError,
} from "../shared/protocol";
import { createGameSocket, type GameSocket } from "./socket";

const RECONNECT_TOKEN_KEY = "hanpanyut.reconnectToken";
const TERMINAL_SESSION_ERROR_CODES = new Set([
  "ROOM_NOT_FOUND",
  "SESSION_NOT_FOUND",
  "INVALID_SESSION",
]);

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "offline";

export interface GameSession {
  playerId: string | null;
  snapshot: PublicRoomSnapshot | null;
  error: ServerError | null;
  connectionState: ConnectionState;
  createRoom: (nickname: string, mode: GameMode) => Promise<void>;
  joinRoom: (nickname: string, roomCode: string) => Promise<void>;
  sendCommand: (command: InRoomCommand) => void;
  leaveRoom: () => void;
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
  return window.localStorage.getItem(RECONNECT_TOKEN_KEY) ? "reconnecting" : "connecting";
}

export function useGameSession(): GameSession {
  const socketRef = useRef<GameSocket | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<PublicRoomSnapshot | null>(null);
  const [error, setError] = useState<ServerError | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>(initialConnectionState);

  useEffect(() => {
    const reconnectToken = window.localStorage.getItem(RECONNECT_TOKEN_KEY);
    const socket = createGameSocket(reconnectToken);
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnectionState("connected");
    });
    socket.on("connect_error", () => {
      setConnectionState("offline");
    });
    socket.on("disconnect", () => {
      setConnectionState("offline");
    });
    socket.on("session", (session) => {
      window.localStorage.setItem(RECONNECT_TOKEN_KEY, session.reconnectToken);
      setPlayerId(session.playerId);
      setError(null);
    });
    socket.on("snapshot", (nextSnapshot) => {
      setSnapshot((currentSnapshot) => (
        currentSnapshot === null || nextSnapshot.version >= currentSnapshot.version
          ? nextSnapshot
          : currentSnapshot
      ));
    });
    socket.on("server_error", (nextError) => {
      setError(nextError);
      if (TERMINAL_SESSION_ERROR_CODES.has(nextError.code)) {
        window.localStorage.removeItem(RECONNECT_TOKEN_KEY);
        setPlayerId(null);
        setSnapshot(null);
        socket.auth = {};
        socket.disconnect();
        setConnectionState("offline");
      }
    });

    socket.connect();
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

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
    window.localStorage.removeItem(RECONNECT_TOKEN_KEY);
    socketRef.current?.disconnect();
    setPlayerId(null);
    setSnapshot(null);
    setError(null);
    setConnectionState("offline");
  }, []);

  return { playerId, snapshot, error, connectionState, createRoom, joinRoom, sendCommand, leaveRoom };
}
