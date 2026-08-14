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

interface DeterministicRandom {
  random: () => number;
  useVaryingThrows: (varying: boolean) => void;
}

/**
 * 방 코드는 늘 같은 값으로 뽑아 코드 재사용을 검증할 수 있게 하고, 윷 던지기에는 변하는 값을 준다.
 * 고정값만 쓰면 매번 윷이 나와 보너스 던지기가 끝나지 않아 차례가 넘어가지 않는다.
 */
function deterministicRandom(): DeterministicRandom {
  let varying = false;
  let state = 1;
  return {
    random: () => {
      if (!varying) return 0.1;
      state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
      return state / 4_294_967_296;
    },
    useVaryingThrows: (next: boolean) => {
      varying = next;
    },
  };
}

function finishDeterministicRoom(service: RoomService, rng: DeterministicRandom) {
  const host = service.createRoom({ nickname: "Host", mode: "individual" });
  const guest = service.joinRoom({ roomCode: host.snapshot.roomCode, nickname: "Guest" });
  let sequence = 100;
  let snapshot = service.dispatch(host.playerId, {
    type: "SET_READY",
    ready: true,
    roomVersion: guest.snapshot.version,
    requestId: requestId(sequence++),
  });
  snapshot = service.dispatch(guest.playerId, {
    type: "SET_READY",
    ready: true,
    roomVersion: snapshot.version,
    requestId: requestId(sequence++),
  });
  snapshot = service.dispatch(host.playerId, {
    type: "START_GAME",
    roomVersion: snapshot.version,
    requestId: requestId(sequence++),
  });

  rng.useVaryingThrows(true);
  let guard = 0;
  while (snapshot.phase === "playing") {
    if (++guard > 20_000) {
      throw new Error(`게임이 끝나지 않았습니다. 마지막 단계: ${snapshot.game!.turnStage}`);
    }
    const playerId = snapshot.game!.currentPlayerId;
    if (snapshot.game!.turnStage === "AWAITING_THROW") {
      snapshot = service.dispatch(playerId, {
        type: "THROW_YUT",
        roomVersion: snapshot.version,
        requestId: requestId(sequence++),
      });
    } else if (snapshot.game!.turnStage === "AWAITING_PIECE") {
      const usableThrow = snapshot.game!.pendingThrows.find(
        (pending) => pending.legalPieceIds.length > 0,
      )!;
      snapshot = service.dispatch(playerId, {
        type: "SELECT_PIECE",
        throwId: usableThrow.id,
        pieceId: usableThrow.legalPieceIds[0],
        roomVersion: snapshot.version,
        requestId: requestId(sequence++),
      });
    } else if (snapshot.game!.turnStage === "AWAITING_ROUTE") {
      snapshot = service.dispatch(playerId, {
        type: "SELECT_ROUTE",
        routeId: snapshot.game!.legalRoutes[0].routeId,
        roomVersion: snapshot.version,
        requestId: requestId(sequence++),
      });
    } else {
      throw new Error(`처리할 수 없는 단계입니다: ${snapshot.game!.turnStage}`);
    }
  }

  // 교체 방이 같은 코드를 다시 받도록 고정값으로 되돌린다.
  rng.useVaryingThrows(false);
  return { host, roomCode: snapshot.roomCode };
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

  async function startRateLimitedServer(input: {
    now: () => number;
    maxCommands: number;
    maxReactions: number;
  }) {
    const server = buildServer({
      publicOrigin: PUBLIC_ORIGIN,
      gatewayRateLimit: {
        ...input,
        windowMs: 1_000,
      },
    });
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

  it("evicts connected sockets when a finished room expires before its code is reused", async () => {
    let now = 0;
    const rng = deterministicRandom();
    const roomService = new RoomService({
      now: () => now,
      random: rng.random,
      schedule: () => Symbol("timer"),
      cancel: () => undefined,
    });
    const finished = finishDeterministicRoom(roomService, rng);
    const server = buildServer({
      publicOrigin: PUBLIC_ORIGIN,
      roomService,
      cleanupIntervalMs: 60_000,
    });
    servers.push(server);
    await server.listen({ host: "127.0.0.1", port: 0 });
    const { port } = server.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}`;

    const oldSocket = connect(url, {
      autoConnect: false,
      transports: ["websocket"],
      extraHeaders: { Origin: PUBLIC_ORIGIN },
      auth: { reconnectToken: finished.host.reconnectToken },
    });
    sockets.push(oldSocket);
    const oldSessionEvent = event<SessionPayload>(oldSocket, "session");
    const oldSnapshotEvent = event<PublicRoomSnapshot>(oldSocket, "snapshot");
    oldSocket.connect();
    await Promise.all([oldSessionEvent, oldSnapshotEvent]);
    let leakedSnapshots = 0;
    oldSocket.on("snapshot", () => { leakedSnapshots += 1; });

    const expiredSocketEvent = event(oldSocket, "disconnect");
    now = 1_800_000;
    roomService.removeExpiredRooms();
    await expiredSocketEvent;
    const replacement = roomService.createRoom({ nickname: "NewHost", mode: "individual" });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(replacement.snapshot.roomCode).toBe(finished.roomCode);
    expect(oldSocket.connected).toBe(false);
    expect(leakedSnapshots).toBe(0);
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

  it("passes a refusal's own wording through instead of a generic apology", async () => {
    const url = await startServer();
    const { host, guest, snapshot } = await createAndJoin(url);

    const chosen = event<PublicRoomSnapshot>(host, "snapshot");
    host.emit("command", {
      type: "CHOOSE_COLOR",
      slot: 1,
      roomVersion: snapshot.version,
      requestId: requestId(1),
    });
    const afterChoice = await chosen;

    const refusal = event<ServerError>(guest, "server_error");
    guest.emit("command", {
      type: "CHOOSE_COLOR",
      slot: 1,
      roomVersion: afterChoice.version,
      requestId: requestId(2),
    });

    // 게이트웨이가 코드별 문구를 따로 들고 있으면 새 오류마다 등록을 잊고 뭉개진다.
    // RoomError가 들고 온 문구가 그대로 나와야 왜 거절됐는지 알 수 있다.
    expect(await refusal).toEqual({
      code: "COLOR_TAKEN",
      message: "이미 다른 참가자가 고른 색입니다.",
      recoverable: true,
    });
  });

  it("sanitizes an unexpected room-service exception as a non-recoverable internal error", async () => {
    class FailingRoomService extends RoomService {
      override createRoom(): never {
        const error = new Error("secret infrastructure detail");
        error.stack = "secret stack trace";
        throw error;
      }
    }

    const server = buildServer({
      publicOrigin: PUBLIC_ORIGIN,
      roomService: new FailingRoomService(),
    });
    servers.push(server);
    await server.listen({ host: "127.0.0.1", port: 0 });
    const { port } = server.server.address() as AddressInfo;
    const socket = await openSocket(`http://127.0.0.1:${port}`);
    const errorEvent = event<ServerError>(socket, "server_error");

    socket.emit("command", { type: "CREATE_ROOM", nickname: "Host", mode: "individual" });
    const serverError = await errorEvent;

    expect(serverError).toEqual({
      code: "INTERNAL_ERROR",
      message: "서버 오류가 발생했습니다.",
      recoverable: false,
    });
    expect(JSON.stringify(serverError)).not.toContain("secret");
    expect(JSON.stringify(serverError)).not.toContain("stack");
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

  it("releases the socket of a player who leaves, and tells the room", async () => {
    const url = await startServer();
    const { host, guest, guestSession, snapshot } = await createAndJoin(url);
    const hostSnapshotEvent = event<PublicRoomSnapshot>(host, "snapshot");
    const leftEvent = event(guest, "disconnect");

    guest.emit("command", {
      type: "LEAVE_ROOM",
      roomVersion: snapshot.version,
      requestId: requestId(9),
    });

    const remaining = await hostSnapshotEvent;
    expect(remaining.players.some((player) => player.id === guestSession.playerId)).toBe(false);
    // 소켓까지 놓아 주어야 남은 표로 다시 붙지 않는다.
    await leftEvent;
    // 거절은 붙는 그 순간 날아오므로 붙기 전에 귀를 대 둔다.
    const returning = connect(url, {
      autoConnect: false,
      transports: ["websocket"],
      extraHeaders: { Origin: PUBLIC_ORIGIN },
      auth: { reconnectToken: guestSession.reconnectToken },
    });
    sockets.push(returning);
    const rejected = event<ServerError>(returning, "server_error");
    returning.connect();
    expect((await rejected).code).toBe("SESSION_NOT_FOUND");
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

  it("rate limits reactions without broadcasting them and resets the quota after the window", async () => {
    let now = 0;
    const url = await startRateLimitedServer({
      now: () => now,
      maxCommands: 30,
      maxReactions: 1,
    });
    const { host, guest, guestSession } = await createAndJoin(url);
    const reactions: ReactionPayload[] = [];
    host.on("reaction", (reaction: ReactionPayload) => reactions.push(reaction));

    const firstReaction = event<ReactionPayload>(host, "reaction");
    guest.emit("command", { type: "REACT", emoji: "👏" });
    expect(await firstReaction).toEqual({ playerId: guestSession.playerId, emoji: "👏" });

    const limitedError = event<ServerError>(guest, "server_error");
    guest.emit("command", { type: "REACT", emoji: "🔥" });
    expect(await limitedError).toEqual({
      code: "RATE_LIMITED",
      message: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
      recoverable: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(reactions).toEqual([{ playerId: guestSession.playerId, emoji: "👏" }]);

    now = 1_000;
    const resetReaction = event<ReactionPayload>(host, "reaction");
    guest.emit("command", { type: "REACT", emoji: "🎉" });
    expect(await resetReaction).toEqual({ playerId: guestSession.playerId, emoji: "🎉" });
  });

  it("lets a player leave after the general command quota is exhausted", async () => {
    const url = await startRateLimitedServer({
      now: () => 0,
      maxCommands: 1,
      maxReactions: 4,
    });
    const { host, guest, guestSession, snapshot } = await createAndJoin(url);
    const remainingEvent = event<PublicRoomSnapshot>(host, "snapshot");
    const disconnectedEvent = event(guest, "disconnect");

    guest.emit("command", {
      type: "LEAVE_ROOM",
      roomVersion: snapshot.version,
      requestId: requestId(10),
    });

    expect((await remainingEvent).players.map((player) => player.id))
      .not.toContain(guestSession.playerId);
    await disconnectedEvent;
  });

  it("counts unauthenticated leave attempts against the general command quota", async () => {
    const url = await startRateLimitedServer({
      now: () => 0,
      maxCommands: 1,
      maxReactions: 4,
    });
    const socket = await openSocket(url);
    const firstError = event<ServerError>(socket, "server_error");
    socket.emit("command", {
      type: "LEAVE_ROOM",
      roomVersion: 0,
      requestId: requestId(11),
    });
    expect((await firstError).code).toBe("SESSION_REQUIRED");

    const limitedError = event<ServerError>(socket, "server_error");
    socket.emit("command", {
      type: "LEAVE_ROOM",
      roomVersion: 0,
      requestId: requestId(12),
    });
    expect((await limitedError).code).toBe("RATE_LIMITED");
  });

  it("counts invalid raw commands against the general per-socket quota", async () => {
    const url = await startRateLimitedServer({
      now: () => 0,
      maxCommands: 1,
      maxReactions: 4,
    });
    const socket = await openSocket(url);
    const invalidError = event<ServerError>(socket, "server_error");
    socket.emit("command", { type: "NOT_A_COMMAND" });
    expect((await invalidError).code).toBe("INVALID_COMMAND");

    const limitedError = event<ServerError>(socket, "server_error");
    socket.emit("command", { type: "CREATE_ROOM", nickname: "Host", mode: "individual" });
    expect((await limitedError).code).toBe("RATE_LIMITED");
  });
});
