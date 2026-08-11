"use client";

import { io, type Socket } from "socket.io-client";
import type { InRoomCommand, PublicRoomSnapshot, ServerError } from "../shared/protocol";

export type ReactionEmoji = Extract<InRoomCommand, { type: "REACT" }>["emoji"];
export interface ReactionPayload { playerId: string; emoji: ReactionEmoji }
export interface ReactionEvent extends ReactionPayload { id: number }
export interface SocketRetryOptions {
  reconnection: boolean;
  reconnectionAttempts: number;
  reconnectionDelay: number;
  reconnectionDelayMax: number;
  timeout: number;
}

export const PRODUCTION_SOCKET_RETRY_OPTIONS: SocketRetryOptions = {
  reconnection: true,
  reconnectionAttempts: 3,
  reconnectionDelay: 500,
  reconnectionDelayMax: 1500,
  timeout: 2500,
};

interface ClientToServerEvents {
  command: (command: unknown) => void;
}

interface ServerToClientEvents {
  reaction: (reaction: ReactionPayload) => void;
  server_error: (error: ServerError) => void;
  session: (session: { playerId: string; reconnectToken: string }) => void;
  snapshot: (snapshot: PublicRoomSnapshot) => void;
}

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function createGameSocket(
  reconnectToken: string | null,
  retryOptions: SocketRetryOptions = PRODUCTION_SOCKET_RETRY_OPTIONS,
): GameSocket {
  return io(process.env.NEXT_PUBLIC_GAME_SERVER_URL, {
    autoConnect: false,
    auth: reconnectToken ? { reconnectToken } : undefined,
    ...retryOptions,
  });
}
