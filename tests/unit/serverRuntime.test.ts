import { describe, expect, it, vi } from "vitest";
import { registerGracefulShutdown, resolveServerRoomOptions } from "../../server/index";

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
});
