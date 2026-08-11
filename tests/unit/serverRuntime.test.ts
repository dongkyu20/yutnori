import { describe, expect, it, vi } from "vitest";
import {
  buildServer,
  registerGracefulShutdown,
  resolveServerRoomOptions,
  startServer,
} from "../../server/index";

describe("server room runtime", () => {
  it("uses repeatable randomness and a one-second action timeout only in test mode", () => {
    const first = resolveServerRoomOptions({ NODE_ENV: "test", YUT_RANDOM_SEED: "task-11" });
    const second = resolveServerRoomOptions({ NODE_ENV: "test", YUT_RANDOM_SEED: "task-11" });

    expect(first.actionTimeoutMs).toBe(1_000);
    expect([first.random(), first.random(), first.random()]).toEqual([
      second.random(),
      second.random(),
      second.random(),
    ]);

    const productionRandom = vi.fn(() => 0.625);
    const production = resolveServerRoomOptions(
      { NODE_ENV: "production", YUT_RANDOM_SEED: "task-11" },
      productionRandom,
    );

    expect(production.actionTimeoutMs).toBe(45_000);
    expect(production.random()).toBe(0.625);
    expect(productionRandom).toHaveBeenCalledOnce();
  });

  it("closes Fastify and Socket.IO once when the container requests shutdown", async () => {
    const listeners = new Map<string, () => void>();
    const signals = {
      once: vi.fn((signal: string, listener: () => void) => {
        listeners.set(signal, listener);
        return signals;
      }),
    };
    const server = { close: vi.fn(async () => undefined) };

    registerGracefulShutdown(server, signals);
    listeners.get("SIGTERM")?.();
    listeners.get("SIGINT")?.();
    await vi.waitFor(() => expect(server.close).toHaveBeenCalledOnce());

    expect(signals.once).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
    expect(signals.once).toHaveBeenCalledWith("SIGINT", expect.any(Function));
  });

  it("the production starter wires both signals through the real Fastify preClose path", async () => {
    const listeners = new Map<string, () => void>();
    const signals = {
      once: vi.fn((signal: string, listener: () => void) => {
        listeners.set(signal, listener);
        return signals;
      }),
    };
    const server = buildServer({ publicOrigin: "http://localhost:3000" });
    const preClose = vi.fn(async () => undefined);
    server.addHook("preClose", preClose);
    const close = vi.spyOn(server, "close");

    try {
      await startServer({ port: 0, server, signals });
      const address = server.server.address();
      if (!address || typeof address === "string") throw new Error("Server did not bind a TCP port");
      await expect(fetch(`http://127.0.0.1:${address.port}/health`).then((response) => response.status)).resolves.toBe(200);

      listeners.get("SIGTERM")?.();
      listeners.get("SIGINT")?.();
      await vi.waitFor(() => expect(server.server.listening).toBe(false));

      expect(close).toHaveBeenCalledOnce();
      expect(preClose).toHaveBeenCalledOnce();
    } finally {
      if (server.server.listening) await server.close();
    }
  });
});
