import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import { createGateway } from "./gateway";
import { RoomService } from "./rooms";

const DEFAULT_PORT = 3001;
const DEFAULT_PUBLIC_ORIGIN = "http://localhost:3000";
const DEFAULT_CLEANUP_INTERVAL_MS = 60_000;
const PRODUCTION_ACTION_TIMEOUT_MS = 45_000;
const TEST_ACTION_TIMEOUT_MS = 1_000;

interface ServerEnvironment {
  NODE_ENV?: string;
  YUT_RANDOM_SEED?: string;
}

interface ServerRoomOptions {
  actionTimeoutMs: number;
  random: () => number;
}

export interface BuildServerOptions {
  cleanupIntervalMs?: number;
  publicOrigin?: string;
  roomService?: RoomService;
}

function seededRandom(seed: string): () => number {
  let state = 2_166_136_261;
  for (const character of seed) {
    state ^= character.codePointAt(0) ?? 0;
    state = Math.imul(state, 16_777_619);
  }

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function resolveServerRoomOptions(
  environment: ServerEnvironment = process.env,
  productionRandom: () => number = Math.random,
): ServerRoomOptions {
  const testMode = environment.NODE_ENV === "test";
  return {
    actionTimeoutMs: testMode ? TEST_ACTION_TIMEOUT_MS : PRODUCTION_ACTION_TIMEOUT_MS,
    random: testMode && environment.YUT_RANDOM_SEED
      ? seededRandom(environment.YUT_RANDOM_SEED)
      : productionRandom,
  };
}

function createServerRoomService(): RoomService {
  return new RoomService({
    ...resolveServerRoomOptions(),
    schedule: (fn, ms) => {
      const timer = setTimeout(fn, ms);
      timer.unref();
      return timer;
    },
    cancel: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  });
}

export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const server = Fastify();
  const roomService = options.roomService ?? createServerRoomService();
  const gateway = createGateway(server.server, {
    publicOrigin: options.publicOrigin ?? DEFAULT_PUBLIC_ORIGIN,
    roomService,
  });
  const cleanupTimer = setInterval(
    () => roomService.removeExpiredRooms(),
    options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS,
  );
  cleanupTimer.unref();

  server.get("/health", async () => ({ status: "ok" }));
  server.addHook("preClose", async () => {
    clearInterval(cleanupTimer);
    await gateway.close();
  });

  return server;
}

async function start(): Promise<void> {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  const server = buildServer({ publicOrigin: process.env.PUBLIC_ORIGIN });
  await server.listen({ host: "0.0.0.0", port });
}

const entrypoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false;

if (entrypoint) {
  start().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
