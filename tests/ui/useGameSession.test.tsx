/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import Fastify from "fastify";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGateway, type Gateway } from "../../server/gateway";
import { RoomError, RoomService } from "../../server/rooms";
import type { ServerError } from "../../shared/protocol";
import { createGameSocket, type GameSocket } from "../../client/socket";
import { useGameSession } from "../../client/useGameSession";

const RECONNECT_TOKEN_KEY = "hanpanyut.reconnectToken";
const terminalErrors: ServerError[] = [
  { code: "ROOM_NOT_FOUND", message: "room expired", recoverable: false },
  { code: "SESSION_NOT_FOUND", message: "session expired", recoverable: false },
  { code: "INVALID_SESSION", message: "session invalid", recoverable: false },
];

function roomError(action: () => unknown): RoomError {
  try {
    action();
  } catch (error) {
    if (error instanceof RoomError) return error;
    throw error;
  }
  throw new Error("RoomError가 발생해야 합니다.");
}

class LeavePendingSocket {
  auth: Record<string, unknown> = {};
  connected = false;
  connectCalls = 0;
  readonly commands: unknown[] = [];
  private readonly handlers = new Map<string, Array<(payload: unknown) => void>>();
  readonly io = {
    on: () => this.io,
    off: () => this.io,
  };

  on(event: string, handler: (payload: unknown) => void): this {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(handler);
    this.handlers.set(event, handlers);
    return this;
  }

  emit(event: string, payload: unknown): this {
    if (event === "command") this.commands.push(payload);
    return this;
  }

  connect(): this {
    this.connectCalls += 1;
    this.connected = true;
    this.serverEmit("connect", undefined);
    return this;
  }

  disconnect(): this {
    if (!this.connected) return this;
    this.connected = false;
    this.serverEmit("disconnect", "io client disconnect");
    return this;
  }

  serverEmit(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }
}

describe("useGameSession terminal reconnect errors", () => {
  const servers: Array<ReturnType<typeof Fastify>> = [];
  const gateways: Gateway[] = [];
  const serverUrls: string[] = [];
  const originalServerUrl = process.env.NEXT_PUBLIC_GAME_SERVER_URL;

  async function startGateway(roomService: RoomService): Promise<Gateway> {
    const server = Fastify();
    const gateway = createGateway(server.server, {
      // Socket.IO's Node transport does not attach a browser Origin in JSDOM.
      publicOrigin: undefined as unknown as string,
      roomService,
    });
    servers.push(server);
    gateways.push(gateway);
    await server.listen({ host: "127.0.0.1", port: 0 });
    const { port } = server.server.address() as AddressInfo;
    serverUrls.push(`http://127.0.0.1:${port}`);
    return gateway;
  }

  afterEach(async () => {
    vi.useRealTimers();
    window.localStorage.clear();
    if (originalServerUrl === undefined) delete process.env.NEXT_PUBLIC_GAME_SERVER_URL;
    else process.env.NEXT_PUBLIC_GAME_SERVER_URL = originalServerUrl;
    for (const gateway of gateways.splice(0)) await gateway.close();
    for (const server of servers.splice(0)) await server.close();
    serverUrls.length = 0;
  });

  it.each(terminalErrors)("clears a restored local session and does not retry after $code", async (terminalError) => {
    const roomService = new RoomService();
    const issuedSession = roomService.createRoom({ nickname: "Host", mode: "individual" });
    const gateway = await startGateway(roomService);
    process.env.NEXT_PUBLIC_GAME_SERVER_URL = serverUrls[0];
    window.localStorage.setItem(RECONNECT_TOKEN_KEY, issuedSession.reconnectToken);
    let connections = 0;
    gateway.io.on("connection", () => { connections += 1; });

    const { result, unmount } = renderHook(() => useGameSession());

    await waitFor(() => {
      expect(result.current.playerId).toBe(issuedSession.playerId);
      expect(result.current.snapshot?.roomCode).toBe(issuedSession.snapshot.roomCode);
    });
    const connectedSocket = [...gateway.io.sockets.sockets.values()][0];
    connectedSocket.emit("server_error", terminalError);

    await waitFor(() => {
      expect(result.current.error?.code).toBe(terminalError.code);
      expect(result.current.playerId).toBeNull();
      expect(result.current.snapshot).toBeNull();
    });
    expect(window.localStorage.getItem(RECONNECT_TOKEN_KEY)).toBeNull();

    connectedSocket.disconnect(true);
    await waitFor(() => expect(result.current.connectionState).toBe("offline"));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(connections).toBe(1);
    unmount();
  });

  it("does not send a stale reconnect token or restore the old session after remounting", async () => {
    const roomService = new RoomService();
    const issuedSession = roomService.createRoom({ nickname: "Host", mode: "individual" });
    const gateway = await startGateway(roomService);
    process.env.NEXT_PUBLIC_GAME_SERVER_URL = serverUrls[0];
    window.localStorage.setItem(RECONNECT_TOKEN_KEY, issuedSession.reconnectToken);
    const handshakeTokens: unknown[] = [];
    gateway.io.on("connection", (socket) => {
      handshakeTokens.push(socket.handshake.auth.reconnectToken);
    });

    const first = renderHook(() => useGameSession());
    await waitFor(() => expect(first.result.current.playerId).toBe(issuedSession.playerId));
    const connectedSocket = [...gateway.io.sockets.sockets.values()][0];
    connectedSocket.emit("server_error", terminalErrors[1]);

    await waitFor(() => {
      expect(window.localStorage.getItem(RECONNECT_TOKEN_KEY)).toBeNull();
      expect(first.result.current.playerId).toBeNull();
      expect(first.result.current.snapshot).toBeNull();
    });
    first.unmount();

    const second = renderHook(() => useGameSession());
    await waitFor(() => {
      expect(handshakeTokens).toHaveLength(2);
      expect(second.result.current.connectionState).toBe("connected");
    });

    expect(handshakeTokens).toEqual([issuedSession.reconnectToken, undefined]);
    expect(second.result.current.playerId).toBeNull();
    expect(second.result.current.snapshot).toBeNull();
    second.unmount();
  });

  it("exposes received reactions briefly without adding them to the room snapshot", async () => {
    const roomService = new RoomService();
    const issuedSession = roomService.createRoom({ nickname: "Host", mode: "individual" });
    const gateway = await startGateway(roomService);
    process.env.NEXT_PUBLIC_GAME_SERVER_URL = serverUrls[0];
    window.localStorage.setItem(RECONNECT_TOKEN_KEY, issuedSession.reconnectToken);
    const { result, unmount } = renderHook(() => useGameSession());

    await waitFor(() => expect(result.current.playerId).toBe(issuedSession.playerId));
    const connectedSocket = [...gateway.io.sockets.sockets.values()][0];
    connectedSocket.emit("reaction", { playerId: issuedSession.playerId, emoji: "🎉" });

    await waitFor(() => {
      expect(result.current.reactions).toEqual([
        { id: 1, playerId: issuedSession.playerId, emoji: "🎉" },
      ]);
    });
    expect(result.current.snapshot?.game?.events ?? []).not.toContainEqual(
      expect.objectContaining({ emoji: "🎉" }),
    );

    await waitFor(() => expect(result.current.reactions).toEqual([]), { timeout: 2500 });
    unmount();
  });

  it("leaves only the room session and reconnects a clean lobby socket", async () => {
    const roomService = new RoomService();
    const issuedSession = roomService.createRoom({ nickname: "Host", mode: "individual" });
    const gateway = await startGateway(roomService);
    process.env.NEXT_PUBLIC_GAME_SERVER_URL = serverUrls[0];
    window.localStorage.setItem(RECONNECT_TOKEN_KEY, issuedSession.reconnectToken);
    const handshakeTokens: unknown[] = [];
    gateway.io.on("connection", (socket) => handshakeTokens.push(socket.handshake.auth.reconnectToken));
    const { result, unmount } = renderHook(() => useGameSession());

    await waitFor(() => {
      expect(result.current.connectionState).toBe("connected");
      expect(result.current.snapshot).not.toBeNull();
    });
    act(() => result.current.leaveRoom());

    await waitFor(() => {
      expect(result.current.playerId).toBeNull();
      expect(result.current.snapshot).toBeNull();
      expect(result.current.connectionState).toBe("connected");
      expect(handshakeTokens).toEqual([issuedSession.reconnectToken, undefined]);
    });
    expect(window.localStorage.getItem(RECONNECT_TOKEN_KEY)).toBeNull();
    // 자리까지 비워야 한다. 소켓만 끊으면 남은 사람들이 게임을 시작할 수 없다.
    await waitFor(() => {
      expect(roomError(() => roomService.reconnect(issuedSession.reconnectToken)).code)
        .toBe("SESSION_NOT_FOUND");
    });
    unmount();
  });

  it("does not reopen a socket after unmounting during the leave grace period", () => {
    vi.useFakeTimers();
    const roomService = new RoomService();
    const issuedSession = roomService.createRoom({ nickname: "Host", mode: "individual" });
    const socket = new LeavePendingSocket();
    const socketFactory = () => socket as unknown as GameSocket;
    const { result, unmount } = renderHook(() => useGameSession({
      socketFactory,
    }));
    act(() => socket.serverEmit("snapshot", issuedSession.snapshot));
    const initialConnectCalls = socket.connectCalls;

    act(() => result.current.leaveRoom());
    expect(socket.commands).toEqual([
      expect.objectContaining({ type: "LEAVE_ROOM", roomVersion: issuedSession.snapshot.version }),
    ]);
    unmount();
    act(() => vi.advanceTimersByTime(1_500));

    expect(socket.connectCalls).toBe(initialConnectCalls);
  });

  it("reports reconnecting through a transport retry, connected after recovery, and offline after retries fail", async () => {
    const roomService = new RoomService();
    const issuedSession = roomService.createRoom({ nickname: "Host", mode: "individual" });
    const gateway = await startGateway(roomService);
    process.env.NEXT_PUBLIC_GAME_SERVER_URL = serverUrls[0];
    window.localStorage.setItem(RECONNECT_TOKEN_KEY, issuedSession.reconnectToken);
    const connectionStates: string[] = [];
    let connections = 0;
    const reconnectAttempts: number[] = [];
    gateway.io.on("connection", () => { connections += 1; });
    const socketFactory = (reconnectToken: string | null) => {
      const socket = createGameSocket(reconnectToken, {
        reconnection: true,
        reconnectionAttempts: 3,
        reconnectionDelay: 25,
        reconnectionDelayMax: 75,
        timeout: 250,
      });
      socket.io.on("reconnect_attempt", (attempt) => reconnectAttempts.push(attempt));
      return socket;
    };
    const { result, unmount } = renderHook(() => {
      const session = useGameSession({ socketFactory });
      connectionStates.push(session.connectionState);
      return session;
    });

    await waitFor(() => expect(result.current.connectionState).toBe("connected"));
    const firstSocket = [...gateway.io.sockets.sockets.values()][0];
    firstSocket.conn.close();

    await waitFor(() => expect(connectionStates).toContain("reconnecting"));
    await waitFor(() => {
      expect(result.current.connectionState).toBe("connected");
      expect(connections).toBe(2);
    }, { timeout: 5000 });
    reconnectAttempts.length = 0;

    const server = servers.at(-1);
    if (!server) throw new Error("Test gateway server is missing");
    const serverStopped = new Promise<void>((resolve, reject) => {
      server.server.close((error?: Error) => error ? reject(error) : resolve());
    });
    const recoveredSocket = [...gateway.io.sockets.sockets.values()][0];
    recoveredSocket.conn.close();
    server.server.closeAllConnections();
    await serverStopped;
    await waitFor(() => expect(result.current.connectionState).toBe("reconnecting"));
    await waitFor(() => expect(reconnectAttempts).toEqual([1, 2, 3]), { timeout: 8000 });
    await waitFor(() => expect(result.current.connectionState).toBe("offline"), { timeout: 8000 });
    unmount();
  }, 12000);
});
