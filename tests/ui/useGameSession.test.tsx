/** @vitest-environment jsdom */
import { renderHook, waitFor } from "@testing-library/react";
import Fastify from "fastify";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createGateway, type Gateway } from "../../server/gateway";
import { RoomService } from "../../server/rooms";
import type { ServerError } from "../../shared/protocol";
import { useGameSession } from "../../client/useGameSession";

const RECONNECT_TOKEN_KEY = "hanpanyut.reconnectToken";
const terminalErrors: ServerError[] = [
  { code: "ROOM_NOT_FOUND", message: "room expired", recoverable: false },
  { code: "SESSION_NOT_FOUND", message: "session expired", recoverable: false },
  { code: "INVALID_SESSION", message: "session invalid", recoverable: false },
];

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
});
