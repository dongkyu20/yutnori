"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  GameMode,
  InRoomCommand,
  PublicRoomSnapshot,
  ServerError,
} from "../shared/protocol";
import { createGameSocket, type GameSocket, type ReactionEvent } from "./socket";

const RECONNECT_TOKEN_KEY = "hanpanyut.reconnectToken";
const TERMINAL_SESSION_ERROR_CODES = new Set([
  "ROOM_NOT_FOUND",
  "SESSION_NOT_FOUND",
  "INVALID_SESSION",
]);
const REACTION_VISIBLE_MS = 2000;

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
  const nextReactionIdRef = useRef(1);
  const reactionTimersRef = useRef(new Map<number, number>());
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<PublicRoomSnapshot | null>(null);
  const [error, setError] = useState<ServerError | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>(initialConnectionState);
  const [reactions, setReactions] = useState<ReactionEvent[]>([]);

  useEffect(() => {
    const reactionTimers = reactionTimersRef.current;
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
      for (const timer of reactionTimers.values()) window.clearTimeout(timer);
      reactionTimers.clear();
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
    for (const timer of reactionTimersRef.current.values()) window.clearTimeout(timer);
    reactionTimersRef.current.clear();
    setPlayerId(null);
    setSnapshot(null);
    setReactions([]);
    setError(null);
    const socket = socketRef.current;
    if (!socket) {
      setConnectionState("offline");
      return;
    }
    socket.auth = {};
    socket.disconnect();
    setConnectionState("connecting");
    socket.connect();
  }, []);

  return { playerId, snapshot, error, connectionState, reactions, createRoom, joinRoom, sendCommand, leaveRoom };
}
