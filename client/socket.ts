"use client";

import { io, type Socket } from "socket.io-client";
import type { InRoomCommand, PublicRoomSnapshot, ServerError } from "../shared/protocol";

export type ReactionEmoji = Extract<InRoomCommand, { type: "REACT" }>["emoji"];
export interface ReactionPayload { playerId: string; emoji: ReactionEmoji }
export interface ReactionEvent extends ReactionPayload { id: number }

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

export function createGameSocket(reconnectToken: string | null): GameSocket {
  return io(process.env.NEXT_PUBLIC_GAME_SERVER_URL, {
    autoConnect: false,
    auth: reconnectToken ? { reconnectToken } : undefined,
    reconnection: false,
  });
}
