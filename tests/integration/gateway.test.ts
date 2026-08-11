import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { io as connect, type Socket } from "socket.io-client";
import type { PublicRoomSnapshot, ServerError } from "../../shared/protocol";
import { buildServer } from "../../server/index";
import { RoomError, RoomService } from "../../server/rooms";

const PUBLIC_ORIGIN = "http://client.example";

interface SessionPayload {
  playerId: string;
  reconnectToken: string;
}

interface ReactionPayload {
  playerId: string;
  emoji: "👏" | "🔥" | "😮" | "🎉";
}

function event<T>(socket: Socket, name: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(name, onEvent);
      reject(new Error(`Timed out waiting for ${name}`));
    }, 2_000);
    const onEvent = (payload: T) => {
      clearTimeout(timeout);
      resolve(payload);
    };
    socket.once(name, onEvent);
  });
}

function requestId(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

describe("Socket.IO gateway", () => {
  const sockets: Socket[] = [];
  const servers: Array<ReturnType<typeof buildServer>> = [];

  async function startServer() {
    const server = buildServer({ publicOrigin: PUBLIC_ORIGIN });
    servers.push(server);
    await server.listen({ host: "127.0.0.1", port: 0 });
    const { port } = server.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  async function openSocket(url: string, reconnectToken?: string): Promise<Socket> {
    const socket = connect(url, {
      autoConnect: false,
      transports: ["websocket"],
      extraHeaders: { Origin: PUBLIC_ORIGIN },
      ...(reconnectToken ? { auth: { reconnectToken } } : {}),
    });
    sockets.push(socket);
    const connected = event(socket, "connect");
    socket.connect();
    await connected;
    return socket;
  }

  async function createAndJoin(url: string) {
    const host = await openSocket(url);
    const hostSessionEvent = event<SessionPayload>(host, "session");
    const hostSnapshotEvent = event<PublicRoomSnapshot>(host, "snapshot");
    host.emit("command", { type: "CREATE_ROOM", nickname: "Host", mode: "individual" });
    const [hostSession, created] = await Promise.all([hostSessionEvent, hostSnapshotEvent]);

    const hostSessions: SessionPayload[] = [hostSession];
    host.on("session", (session: SessionPayload) => hostSessions.push(session));
    const guest = await openSocket(url);
    const hostJoinedEvent = event<PublicRoomSnapshot>(host, "snapshot");
    const guestSessionEvent = event<SessionPayload>(guest, "session");
    const guestJoinedEvent = event<PublicRoomSnapshot>(guest, "snapshot");
    guest.emit("command", { type: "JOIN_ROOM", nickname: "Guest", roomCode: created.roomCode });
    const [hostJoined, guestSession, guestJoined] = await Promise.all([
      hostJoinedEvent,
      guestSessionEvent,
      guestJoinedEvent,
    ]);

    expect(hostJoined).toEqual(guestJoined);
    expect(hostJoined.version).toBe(created.version + 1);
    expect(hostSessions).toEqual([hostSession]);
    expect(JSON.stringify(hostJoined)).not.toContain(hostSession.reconnectToken);
    expect(JSON.stringify(hostJoined)).not.toContain(guestSession.reconnectToken);
    expect(JSON.stringify(hostJoined)).not.toContain("reconnectToken");

    return { host, guest, hostSession, guestSession, snapshot: hostJoined };
  }

  afterEach(async () => {
    for (const socket of sockets.splice(0)) {
      socket.removeAllListeners();
      socket.disconnect();
    }
    for (const server of servers.splice(0)) {
      await server.close();
    }
  });

  it("serves health and exposes Socket.IO CORS only to the configured public origin", async () => {
    const url = await startServer();

    const health = await fetch(`${url}/health`);
    const allowedHandshake = await fetch(`${url}/socket.io/?EIO=4&transport=polling`, {
      headers: { Origin: PUBLIC_ORIGIN },
    });
    const disallowedHandshake = await fetch(`${url}/socket.io/?EIO=4&transport=polling`, {
      headers: { Origin: "https://attacker.example" },
    });
    const attacker = connect(url, {
      autoConnect: false,
      transports: ["websocket"],
      extraHeaders: { Origin: "https://attacker.example" },
    });
    sockets.push(attacker);
    const rejectedConnection = new Promise<Error>((resolve, reject) => {
      attacker.once("connect_error", resolve);
      attacker.once("connect", () => reject(new Error("Disallowed origin connected")));
    });
    attacker.connect();

    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });
    expect(allowedHandshake.headers.get("access-control-allow-origin")).toBe(PUBLIC_ORIGIN);
    expect(disallowedHandshake.headers.get("access-control-allow-origin")).toBe(PUBLIC_ORIGIN);
    expect(disallowedHandshake.headers.get("access-control-allow-origin")).not.toBe("https://attacker.example");
    expect((await rejectedConnection).message).toMatch(/websocket error|xhr poll error/);
  });

  it("runs expiry maintenance for the process-local room service", async () => {
    let now = 0;
    const roomService = new RoomService({ now: () => now });
    const created = roomService.createRoom({ nickname: "Host", mode: "individual" });
    roomService.disconnect(created.playerId);
    const server = buildServer({
      publicOrigin: PUBLIC_ORIGIN,
      roomService,
      cleanupIntervalMs: 5,
    });
    servers.push(server);
    await server.listen({ host: "127.0.0.1", port: 0 });

    now = 600_000;
    await new Promise((resolve) => setTimeout(resolve, 20));

    let reconnectError: RoomError | undefined;
    try {
      roomService.reconnect(created.reconnectToken);
    } catch (error) {
      reconnectError = error as RoomError;
    }
    expect(reconnectError).toBeInstanceOf(RoomError);
    expect(reconnectError?.code).toBe("SESSION_NOT_FOUND");
  });

  it("issues private sessions and sends both room members the same incremented public snapshot", async () => {
    const url = await startServer();

    const { hostSession, guestSession, snapshot } = await createAndJoin(url);

    expect(hostSession.playerId).toBe(snapshot.players[0].id);
    expect(guestSession.playerId).toBe(snapshot.players[1].id);
    expect(hostSession.reconnectToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(guestSession.reconnectToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("validates commands and reports an out-of-turn throw without changing the room", async () => {
    const url = await startServer();
    const { host, guest, snapshot } = await createAndJoin(url);

    const invalidErrorEvent = event<ServerError>(guest, "server_error");
    guest.emit("command", { type: "REACT", emoji: "👍" });
    expect(await invalidErrorEvent).toEqual({
      code: "INVALID_COMMAND",
      message: "요청 형식이 올바르지 않습니다.",
      recoverable: true,
    });

    let current = snapshot;
    for (const [socket, ready, sequence] of [
      [host, true, 1],
      [guest, true, 2],
    ] as const) {
      const nextSnapshot = event<PublicRoomSnapshot>(host, "snapshot");
      socket.emit("command", {
        type: "SET_READY",
        ready,
        roomVersion: current.version,
        requestId: requestId(sequence),
      });
      current = await nextSnapshot;
    }
    const startedEvent = event<PublicRoomSnapshot>(host, "snapshot");
    host.emit("command", {
      type: "START_GAME",
      roomVersion: current.version,
      requestId: requestId(3),
    });
    current = await startedEvent;

    const outOfTurnErrorEvent = event<ServerError>(guest, "server_error");
    guest.emit("command", {
      type: "THROW_YUT",
      roomVersion: current.version,
      requestId: requestId(4),
    });

    expect(await outOfTurnErrorEvent).toEqual({
      code: "INVALID_ACTION",
      message: "현재 상태에서 수행할 수 없는 행동입니다.",
      recoverable: true,
    });
  });

  it("restores the issued player session and broadcasts disconnect and reconnect snapshots", async () => {
    const url = await startServer();
    const { host, guest, guestSession, snapshot } = await createAndJoin(url);
    const disconnectedEvent = event<PublicRoomSnapshot>(host, "snapshot");

    guest.disconnect();
    const disconnected = await disconnectedEvent;
    expect(disconnected.version).toBe(snapshot.version + 1);
    expect(disconnected.players.find((player) => player.id === guestSession.playerId)?.connected).toBe(false);

    const restored = connect(url, {
      autoConnect: false,
      transports: ["websocket"],
      extraHeaders: { Origin: PUBLIC_ORIGIN },
      auth: { reconnectToken: guestSession.reconnectToken },
    });
    sockets.push(restored);
    const restoredSessionEvent = event<SessionPayload>(restored, "session");
    const restoredSnapshotEvent = event<PublicRoomSnapshot>(restored, "snapshot");
    const hostRestoredEvent = event<PublicRoomSnapshot>(host, "snapshot");
    restored.connect();
    const [restoredSession, restoredSnapshot, hostRestored] = await Promise.all([
      restoredSessionEvent,
      restoredSnapshotEvent,
      hostRestoredEvent,
    ]);

    expect(restoredSession).toEqual(guestSession);
    expect(restoredSnapshot).toEqual(hostRestored);
    expect(restoredSnapshot.version).toBe(disconnected.version + 1);
    expect(restoredSnapshot.players.find((player) => player.id === guestSession.playerId)?.connected).toBe(true);
  });

  it("replaces a live socket that reconnects with the same token without disconnecting the player", async () => {
    const url = await startServer();
    const { host, guest, guestSession } = await createAndJoin(url);
    const replacedEvent = event(guest, "disconnect");
    const replacement = connect(url, {
      autoConnect: false,
      transports: ["websocket"],
      extraHeaders: { Origin: PUBLIC_ORIGIN },
      auth: { reconnectToken: guestSession.reconnectToken },
    });
    sockets.push(replacement);
    const replacementSessionEvent = event<SessionPayload>(replacement, "session");
    replacement.connect();

    expect(await replacementSessionEvent).toEqual(guestSession);
    await replacedEvent;

    const reactionEvent = event<ReactionPayload>(host, "reaction");
    replacement.emit("command", { type: "REACT", emoji: "🔥" });
    expect(await reactionEvent).toEqual({ playerId: guestSession.playerId, emoji: "🔥" });
  });

  it("evicts a kicked socket from the room", async () => {
    const url = await startServer();
    const { host, guest, guestSession, snapshot } = await createAndJoin(url);
    const removedSnapshotEvent = event<PublicRoomSnapshot>(guest, "snapshot");
    const kickedEvent = event(guest, "disconnect");

    host.emit("command", {
      type: "KICK_PLAYER",
      playerId: guestSession.playerId,
      roomVersion: snapshot.version,
      requestId: requestId(5),
    });

    const removedSnapshot = await removedSnapshotEvent;
    expect(removedSnapshot.players.some((player) => player.id === guestSession.playerId)).toBe(false);
    await kickedEvent;
  });

  it("broadcasts only the four protocol reactions with the authenticated player ID", async () => {
    const url = await startServer();
    const { host, guest, guestSession } = await createAndJoin(url);
    const allowed = ["👏", "🔥", "😮", "🎉"] as const;

    for (const emoji of allowed) {
      const hostReactionEvent = event<ReactionPayload>(host, "reaction");
      const guestReactionEvent = event<ReactionPayload>(guest, "reaction");
      guest.emit("command", { type: "REACT", emoji });
      const [hostReaction, guestReaction] = await Promise.all([hostReactionEvent, guestReactionEvent]);
      expect(hostReaction).toEqual({ playerId: guestSession.playerId, emoji });
      expect(guestReaction).toEqual(hostReaction);
    }

    let leakedReaction = false;
    host.once("reaction", () => { leakedReaction = true; });
    const invalidErrorEvent = event<ServerError>(guest, "server_error");
    guest.emit("command", { type: "REACT", emoji: "👍" });
    expect((await invalidErrorEvent).code).toBe("INVALID_COMMAND");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(leakedReaction).toBe(false);
  });
});
