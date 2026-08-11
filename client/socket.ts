"use client";

import { io, type Socket } from "socket.io-client";
import type { PublicRoomSnapshot, ServerError } from "../shared/protocol";

interface ClientToServerEvents {
  command: (command: unknown) => void;
}

interface ServerToClientEvents {
  reaction: (reaction: { playerId: string; emoji: "👏" | "🔥" | "😮" | "🎉" }) => void;
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
